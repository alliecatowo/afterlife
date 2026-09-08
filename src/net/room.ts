/**
 * AFTERLIFE multiplayer — the room client.
 *
 * `LockstepRoom` wires a `Transport` (see `./transport`) to the pure
 * protocol logic in `./protocol`: it tracks peers/presence, submits and
 * receives edits, decides when it's safe to advance (the stall policy), and
 * watches for desyncs. It never touches the DOM, React, or `@/core/**`
 * directly — `./sessionBridge.ts` is the (only) file that connects a room to
 * a real running `Session`. Tests exercise `LockstepRoom` directly with two
 * in-process instances; the UI (`src/ui/multiplayer/**`) exercises it via a
 * real `BroadcastChannelTransport`.
 */
import {
  DesyncMonitor,
  EditLog,
  StallTracker,
  compareStampedEdits,
  describeWorldMismatch,
  stampEdit,
  type NetEditOp,
  type PeerId,
  type RoomSpec,
  type StampedEdit,
  type WireMessage,
} from './protocol';
import type { Disposable, Transport, TransportStatus } from './transport';

export interface PeerInfo {
  peerId: PeerId;
  name: string;
  color: string;
  /** Last-known generation reported by this peer. */
  gen: number;
  lastSeen: number;
}

export type RoomEvent =
  | { type: 'peers'; peers: PeerInfo[] }
  | { type: 'status'; status: TransportStatus }
  /** `null` once the room is no longer stalled. */
  | { type: 'stall'; blocking: Array<{ peerId: PeerId; stalledMs: number }> | null }
  | { type: 'desync'; gen: number; local: string; remote: string; fromPeer: PeerId }
  | { type: 'resync'; edits: StampedEdit[]; toGen: number; fromPeer: PeerId }
  | { type: 'rejectedEdit'; fromPeer: PeerId; reason: 'late'; targetGen: number }
  | { type: 'worldMismatch'; fromPeer: PeerId; reason: string };

export interface LockstepRoomOptions {
  transport: Transport;
  room: RoomSpec;
  localPeerId: PeerId;
  localName: string;
  localColor: string;
  /** How often (ms) to emit a liveness heartbeat even if the generation
   *  hasn't advanced (e.g. the local simulation is paused). Keeps peers from
   *  wrongly reporting a healthy-but-idle peer as dropped. */
  heartbeatMs?: number;
}

/**
 * A joined multiplayer room. Construct with `join()`; call `leave()` exactly
 * once when done — it is the caller's job to route that through whatever UI
 * affordance returns the user to solo play (see `src/ui/multiplayer/**`).
 */
export class LockstepRoom {
  readonly spec: RoomSpec;
  readonly localPeerId: PeerId;

  private readonly transport: Transport;
  private readonly log = new EditLog();
  private readonly stall: StallTracker;
  private readonly desync = new DesyncMonitor();
  private readonly peers = new Map<PeerId, PeerInfo>();
  private readonly listeners = new Set<(e: RoomEvent) => void>();
  private readonly disposables: Disposable[] = [];
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private seq = 0;
  private lastReportedGen = 0;
  private joined = false;

  constructor(private readonly opts: LockstepRoomOptions) {
    this.spec = opts.room;
    this.localPeerId = opts.localPeerId;
    this.transport = opts.transport;
    this.stall = new StallTracker();
  }

  /** Subscribe to room events. Returns a disposer. */
  on(cb: (e: RoomEvent) => void): Disposable {
    this.listeners.add(cb);
    return { dispose: () => this.listeners.delete(cb) };
  }

  private emit(e: RoomEvent): void {
    for (const l of [...this.listeners]) l(e);
  }

  /** Connect the transport and announce ourselves. `localGen` is the
   *  generation the local world is at right now. */
  join(localGen: number): void {
    if (this.joined) return;
    this.joined = true;
    this.lastReportedGen = localGen;
    this.stall.upsert(this.localPeerId, localGen);
    this.disposables.push(this.transport.onMessage((m) => this.handleMessage(m)));
    this.disposables.push(this.transport.onStatusChange((s) => this.emit({ type: 'status', status: s })));
    this.transport.connect();
    this.transport.send({
      type: 'hello',
      peerId: this.localPeerId,
      name: this.opts.localName,
      color: this.opts.localColor,
      gen: localGen,
      room: this.spec,
    });
    const heartbeatMs = this.opts.heartbeatMs ?? 1500;
    this.heartbeatTimer = setInterval(() => {
      this.transport.send({ type: 'heartbeat', peerId: this.localPeerId, gen: this.lastReportedGen });
    }, heartbeatMs);
    this.emit({ type: 'status', status: this.transport.status });
  }

  /** Announce departure, tear down subscriptions, disconnect the transport.
   *  Idempotent. The local world is untouched — leaving a room always
   *  returns to solo play with the world intact. */
  leave(): void {
    if (!this.joined) return;
    this.joined = false;
    this.transport.send({ type: 'leave', peerId: this.localPeerId });
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    for (const d of this.disposables.splice(0)) d.dispose();
    this.transport.disconnect();
    this.peers.clear();
  }

  get status(): TransportStatus {
    return this.transport.status;
  }

  peerList(): PeerInfo[] {
    return [...this.peers.values()];
  }

  /** Call once per local generation tick so peers know our watermark and the
   *  stall computation stays current. See `./sessionBridge.ts`. */
  reportGen(gen: number): void {
    this.lastReportedGen = gen;
    this.stall.upsert(this.localPeerId, gen);
    this.transport.send({ type: 'heartbeat', peerId: this.localPeerId, gen });
    this.log.prune();
    this.recomputeStall();
  }

  /** Stamp and broadcast a local edit. Applied later, uniformly, once its
   *  `targetGen` is reached — see `./protocol`'s module doc. */
  submitEdit(op: NetEditOp, localGen: number): StampedEdit {
    const edit = stampEdit(this.localPeerId, ++this.seq, localGen, op);
    this.log.add(edit); // our own edit; always in-window relative to our own watermark.
    this.transport.send({ type: 'edit', edit });
    return edit;
  }

  /** Edits due to apply at exactly `gen`, deterministically ordered. Marks
   *  `gen` applied (no edit may target it after this). */
  takeDueEdits(gen: number): NetEditOp[] {
    return this.log.consume(gen).map((e) => e.op);
  }

  /** Whether it is currently safe for the local simulation to advance to
   *  `nextGen` — the lockstep stall gate. `true` when solo (no peers yet). */
  canAdvanceTo(nextGen: number): boolean {
    return this.stall.safeGen() >= nextGen;
  }

  /** Broadcast + record our own hash for `gen` (call at `HASH_INTERVAL_GENS`
   *  boundaries — see `./sessionBridge.ts`). */
  reportHash(gen: number, hash: string): void {
    this.desync.recordLocal(gen, hash);
    this.transport.send({ type: 'hash', peerId: this.localPeerId, gen, hash });
  }

  /** Ask every peer for their authoritative edit log since `sinceGen` —
   *  the "offer resync" recovery path after a reported desync. */
  requestResync(sinceGen: number): void {
    this.transport.send({ type: 'resyncRequest', peerId: this.localPeerId, sinceGen });
  }

  private recomputeStall(): void {
    const next = this.lastReportedGen + 1;
    const blocking = this.stall.blocking(next).map(({ peerId, stalledMs }) => ({ peerId, stalledMs }));
    this.emit({ type: 'stall', blocking: blocking.length > 0 ? blocking : null });
  }

  private handleMessage(msg: WireMessage): void {
    switch (msg.type) {
      case 'hello': {
        if (msg.peerId === this.localPeerId) return;
        const mismatch = describeWorldMismatch(this.spec.world, msg.room.world);
        if (mismatch || this.spec.seed !== msg.room.seed) {
          this.emit({ type: 'worldMismatch', fromPeer: msg.peerId, reason: mismatch ?? 'seed differs' });
          return;
        }
        this.upsertPeer(msg.peerId, msg.name, msg.color, msg.gen);
        this.transport.send({
          type: 'welcome',
          peerId: this.localPeerId,
          peers: [
            { peerId: this.localPeerId, name: this.opts.localName, color: this.opts.localColor },
            ...[...this.peers.values()].map((p) => ({ peerId: p.peerId, name: p.name, color: p.color })),
          ],
        });
        break;
      }
      case 'welcome': {
        for (const p of msg.peers) {
          if (p.peerId === this.localPeerId) continue;
          if (!this.peers.has(p.peerId)) this.upsertPeer(p.peerId, p.name, p.color, 0);
        }
        break;
      }
      case 'heartbeat': {
        if (msg.peerId === this.localPeerId) return;
        const existing = this.peers.get(msg.peerId);
        if (existing) {
          existing.gen = Math.max(existing.gen, msg.gen);
          existing.lastSeen = Date.now();
          this.emit({ type: 'peers', peers: this.peerList() });
        }
        this.stall.upsert(msg.peerId, msg.gen);
        this.recomputeStall();
        break;
      }
      case 'edit': {
        if (msg.edit.peerId === this.localPeerId) return;
        const result = this.log.add(msg.edit);
        if (!result.ok && result.reason === 'late') {
          this.emit({ type: 'rejectedEdit', fromPeer: msg.edit.peerId, reason: 'late', targetGen: result.deadline });
        }
        break;
      }
      case 'hash': {
        if (msg.peerId === this.localPeerId) return;
        const result = this.desync.check(msg.gen, msg.hash);
        if (result.status === 'mismatch') {
          this.emit({ type: 'desync', gen: msg.gen, local: result.local, remote: result.remote, fromPeer: msg.peerId });
        }
        break;
      }
      case 'resyncRequest': {
        if (msg.peerId === this.localPeerId) return;
        const edits = this.log.since(msg.sinceGen);
        this.transport.send({ type: 'resyncData', peerId: this.localPeerId, edits, toGen: this.lastReportedGen });
        break;
      }
      case 'resyncData': {
        if (msg.peerId === this.localPeerId) return;
        for (const e of msg.edits) this.log.add(e);
        this.emit({ type: 'resync', edits: [...msg.edits].sort(compareStampedEdits), toGen: msg.toGen, fromPeer: msg.peerId });
        break;
      }
      case 'leave': {
        this.peers.delete(msg.peerId);
        this.stall.remove(msg.peerId);
        this.emit({ type: 'peers', peers: this.peerList() });
        this.recomputeStall();
        break;
      }
    }
  }

  private upsertPeer(peerId: PeerId, name: string, color: string, gen: number): void {
    this.peers.set(peerId, { peerId, name, color, gen, lastSeen: Date.now() });
    this.stall.upsert(peerId, gen);
    this.emit({ type: 'peers', peers: this.peerList() });
    this.recomputeStall();
  }
}

export function createLockstepRoom(opts: LockstepRoomOptions): LockstepRoom {
  return new LockstepRoom(opts);
}
