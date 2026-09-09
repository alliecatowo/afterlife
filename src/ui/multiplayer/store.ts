/**
 * Multiplayer UI state + the ONLY place that constructs a `Transport`/
 * `LockstepRoom`/session bridge in response to a user action ("Host" /
 * "Join"). A fresh page load never calls any of this — see
 * `tests/net-guard.test.ts`. This is a store local to `src/ui/multiplayer/**`
 * (not `@/ui/store`, which is architect-owned and frozen); it follows the
 * same zustand conventions.
 *
 * Join flow, honestly: two independently-running AFTERLIFE tabs are not
 * guaranteed to be at the same generation (each boots the same curated
 * opening scene, but may have been running independently for any amount of
 * time before joining). "Host" resets the local world to a clean, known
 * generation 0 (`loadScene(OPENING_SCENE)`) so there's an unambiguous
 * starting point; "Join" immediately requests a full resync (see
 * `LockstepRoom.requestResync`) and rebuilds local history from whatever
 * the room already agrees on before participating normally. See
 * `docs/MULTIPLAYER.md` "joining a room already in progress".
 */
import { create } from 'zustand';
import {
  BroadcastChannelTransport,
  WebSocketTransport,
  attachSessionToRoom,
  createLockstepRoom,
  generateRoomCode,
  type LockstepRoom,
  type PeerInfo,
  type RoomEvent,
  type RoomSpec,
  type SessionBridgeHandle,
  type Transport,
  type TransportStatus,
} from '@/net';
import { getSession, WORLD_SPEC } from '@/ui/session';
import { bus } from '@/ui/bus';
import { OPENING_SCENE } from '@/content/scenes';

export type MultiplayerPhase = 'offline' | 'connecting' | 'in-room';
export type TransportKind = 'local' | 'relay';

export interface StallInfo {
  peerId: string;
  stalledMs: number;
}

export interface DesyncInfo {
  gen: number;
  fromPeer: string;
}

function randomPeerId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `peer-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

function randomName(): string {
  const n = 1000 + Math.floor(Math.random() * 9000);
  return `Observer ${n}`;
}

interface MultiplayerState {
  phase: MultiplayerPhase;
  roomCode: string | null;
  localPeerId: string;
  localName: string;
  transportKind: TransportKind;
  relayUrl: string;
  transportStatus: TransportStatus;
  peers: PeerInfo[];
  stall: StallInfo[] | null;
  desync: DesyncInfo | null;
  error: string | null;

  /** Whether the `MultiplayerPanel` dialog is open. Lifted here (rather than
   *  `MultiplayerRoot`'s own local `useState`) so an external trigger — the
   *  HUD's "Multiplayer" entry, mounted via `@/ui/hud/multiplayerLazy` — can
   *  open/reopen it without needing its own render tree reference to
   *  whatever mounted `<MultiplayerRoot/>`. Purely UI state; never touched
   *  by `@/net/**`. */
  panelOpen: boolean;
  setPanelOpen(open: boolean): void;

  setLocalName(name: string): void;
  setTransportKind(kind: TransportKind): void;
  setRelayUrl(url: string): void;
  hostRoom(): void;
  joinRoom(code: string): void;
  leaveRoom(): void;
  requestResync(): void;
  dismissDesync(): void;
}

// Live objects, deliberately kept OUTSIDE zustand state (they're not
// serializable/comparable app data — `@/ui/store`'s own doc is explicit
// that state should be cheap to compare; a live `Transport` isn't).
let liveRoom: LockstepRoom | null = null;
let liveTransport: Transport | null = null;
let liveRoomSub: { dispose(): void } | null = null;
let bridge: SessionBridgeHandle | null = null;

function teardown(): void {
  bridge?.detach();
  bridge = null;
  liveRoomSub?.dispose();
  liveRoomSub = null;
  liveRoom?.leave();
  liveRoom = null;
  liveTransport = null;
}

function buildRoomSpec(code: string): RoomSpec | null {
  const session = getSession();
  if (!session) return null;
  return {
    code,
    world: { width: WORLD_SPEC.width, height: WORLD_SPEC.height, boundary: WORLD_SPEC.boundary, rule: session.engine.rule },
    // The app never uses `engine.seed()` random starts in its normal flow
    // (curated scenes are recorded as an explicit gen-0 `EditOp`) — this
    // field is reserved for a future seeded-random start, not load-bearing
    // for today's join/resync flow (see the module doc).
    seed: 0,
    startGen: 0,
    createdAt: Date.now(),
  };
}

export const useMultiplayerStore = create<MultiplayerState>((set, get) => ({
  phase: 'offline',
  roomCode: null,
  localPeerId: randomPeerId(),
  localName: randomName(),
  transportKind: 'local',
  relayUrl: '',
  transportStatus: 'idle',
  peers: [],
  stall: null,
  desync: null,
  error: null,

  panelOpen: false,
  setPanelOpen(panelOpen) {
    set({ panelOpen });
  },

  setLocalName(name) {
    set({ localName: name });
  },
  setTransportKind(kind) {
    set({ transportKind: kind });
  },
  setRelayUrl(url) {
    set({ relayUrl: url });
  },

  hostRoom() {
    const session = getSession();
    if (!session) {
      set({ error: 'The world is still loading — try again in a moment.' });
      return;
    }
    const code = generateRoomCode();
    const spec = buildRoomSpec(code);
    if (!spec) return;
    // A well-defined generation 0 every joiner can resync to.
    session.loadScene(OPENING_SCENE);
    startRoom(spec, get, set, session.engine.gen);
  },

  joinRoom(codeRaw) {
    const session = getSession();
    if (!session) {
      set({ error: 'The world is still loading — try again in a moment.' });
      return;
    }
    const code = codeRaw.trim().toUpperCase();
    if (!code) {
      set({ error: 'Enter a room code.' });
      return;
    }
    const spec = buildRoomSpec(code);
    if (!spec) return;
    startRoom(spec, get, set, session.engine.gen, /* requestFullResync */ true);
  },

  leaveRoom() {
    teardown();
    set({ phase: 'offline', roomCode: null, peers: [], stall: null, desync: null, transportStatus: 'idle', error: null });
    bus.emit('toast', { message: 'Left the room — you are back to solo play, world intact.', tone: 'info' });
  },

  requestResync() {
    liveRoom?.requestResync(-1);
    set({ desync: null });
  },

  dismissDesync() {
    set({ desync: null });
  },
}));

function startRoom(
  spec: RoomSpec,
  get: () => MultiplayerState,
  set: (partial: Partial<MultiplayerState>) => void,
  localGen: number,
  requestFullResync = false,
): void {
  teardown();
  const { localPeerId, localName, transportKind, relayUrl } = get();
  const transport: Transport =
    transportKind === 'relay'
      ? new WebSocketTransport({ url: relayUrl || null })
      : new BroadcastChannelTransport(spec.code);
  liveTransport = transport;

  const room = createLockstepRoom({
    transport,
    room: spec,
    localPeerId,
    localName,
    // Every peer announces this same fixed value over the wire — it is NOT
    // a real per-peer colour negotiation. Nothing reads `PeerInfo.color` on
    // receipt either: `MultiplayerPanel`'s `PeerRow` computes colour locally
    // from role (`colorForRole('local' | 'remote')`, see `./colors.ts`) and
    // tells additional peers apart by shape instead of inventing more
    // accent colours. If real per-peer colour ever becomes a requirement,
    // wire the received `color` into `PeerRow` instead of trusting this.
    localColor: 'var(--color-accent-branch-a)',
  });
  liveRoom = room;

  const roomSub = room.on((event: RoomEvent) => {
    switch (event.type) {
      case 'status':
        set({ transportStatus: event.status });
        if (event.status === 'open') {
          set({ phase: 'in-room' });
        } else if (event.status === 'unavailable') {
          set({
            error:
              transportKind === 'relay'
                ? 'No relay configured — enter a relay URL, or switch to "this browser" to play across tabs with no server.'
                : 'This browser does not support local multiplayer (BroadcastChannel unavailable).',
            phase: 'offline',
          });
        } else if (event.status === 'closed' || event.status === 'error') {
          if (get().phase !== 'offline') set({ phase: 'offline', error: 'Connection lost.' });
        }
        break;
      case 'peers':
        set({ peers: event.peers });
        break;
      case 'stall':
        set({ stall: event.blocking });
        break;
      case 'desync':
        set({ desync: { gen: event.gen, fromPeer: event.fromPeer } });
        bus.emit('toast', { message: `Desync detected at generation ${event.gen} — resync available.`, tone: 'warn', ms: 8000 });
        break;
      case 'worldMismatch':
        set({ error: `A peer's world doesn't match yours (${event.reason}) — they were not added to the room.` });
        break;
      case 'rejectedEdit':
        // Surfaced for honesty (see the module/protocol doc) — a late edit
        // from a peer that missed its own scheduling deadline, never
        // silently applied.
        bus.emit('toast', { message: 'A peer’s edit arrived too late and was rejected — it never applied.', tone: 'warn' });
        break;
      default:
        break;
    }
  });

  liveRoomSub = roomSub;
  set({ phase: 'connecting', roomCode: spec.code, error: null, peers: [], stall: null, desync: null });

  room.join(localGen);
  const session = getSession();
  if (session) bridge = attachSessionToRoom(session, room);
  if (requestFullResync) room.requestResync(-1);

  // `BroadcastChannelTransport.connect()` (called synchronously by `join()`
  // above) resolves to `'open'`/`'unavailable'` immediately, before the
  // `status` event subscription above even had a chance to fire during
  // `join()` itself (it was registered before `join()` was called, so it
  // DID fire — this just covers the case where `phase` still reads its
  // pre-`join()` value because `set()` batched). Idempotent with the event
  // handler above either way.
  if (transport.status === 'open') set({ phase: 'in-room' });
}
