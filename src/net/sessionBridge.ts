/**
 * AFTERLIFE multiplayer — the ONLY file that connects a `LockstepRoom` to a
 * real running `Session` (`@/ui/session`). Everything else in `src/net/**`
 * is transport/protocol-agnostic to what the app actually does with a
 * generation; this file is the glue, and it is intentionally small.
 *
 * What it wires, generation by generation:
 *  1. `setMultiplayerGate` — the local sim may not step past a generation
 *     the room doesn't yet consider safe (see `LockstepRoom.canAdvanceTo`).
 *  2. `setMultiplayerEditSource` — edits due at the current generation are
 *     pulled from the room and applied authoritatively.
 *  3. `setMultiplayerEditInterceptor` — every local edit-commit (drawing,
 *     undo, `applyEdit()`) is redirected into `room.submitEdit()` instead of
 *     applying immediately, UNLESS the user is editing behind `maxGen`
 *     (scrubbed into the past) — that's local "what if" exploration and
 *     deliberately never synced; see the inline comment.
 *  4. Once per `gen:changed`, the room is told our watermark
 *     (`reportGen`), and every `HASH_INTERVAL_GENS` generations a cheap
 *     world hash is exchanged for desync detection.
 *
 * `attachSessionToRoom` returns a handle whose `detach()` undoes all of the
 * above — call it when the user leaves the room. After `detach()`, `session`
 * behaves exactly as it did before multiplayer ever existed.
 */
import { bus } from '@/ui/bus';
import {
  setMultiplayerEditInterceptor,
  setMultiplayerEditSource,
  setMultiplayerGate,
  type Session,
} from '@/ui/session';
import { useAppStore } from '@/ui/store';
import type { EditOp } from '@/core/types';
import { HASH_INTERVAL_GENS, hashBits, type NetEditOp, type StampedEdit } from './protocol';
import type { LockstepRoom, RoomEvent } from './room';

export interface SessionBridgeHandle {
  /** Undo every hook installed by `attachSessionToRoom`. Idempotent. */
  detach(): void;
}

// `EditOp`/`NetEditOp` are structurally identical (`{ kind: 'set', cells:
// Array<{x,y,alive}> }`) — see `@/net/protocol`'s doc for why this module
// keeps its own copy of the shape instead of importing `@/core/types`
// directly. These are explicit, allocation-free reinterpretations, not a
// blind cast: if either shape ever diverges, this is the one place that
// needs to change to keep compiling.
function toNetEditOp(op: EditOp): NetEditOp {
  return { kind: 'set', cells: op.cells };
}
function toEditOp(op: NetEditOp): EditOp {
  return { kind: 'set', cells: op.cells };
}

/**
 * Wire a live `Session` to a joined `LockstepRoom`. Call once per room
 * membership; call the returned `detach()` exactly once, on leaving.
 */
export function attachSessionToRoom(session: Session, room: LockstepRoom): SessionBridgeHandle {
  setMultiplayerEditInterceptor((atGen, edits) => {
    // Editing behind `maxGen` only happens after scrubbing back while
    // paused — that's the existing single-player "alternate futures"
    // feature (ARCHITECTURE.md § Edits commit atomically). A shared room has
    // no way to represent "my own private past" for every peer at once, so
    // it's deliberately left as local-only exploration: return `false` here
    // and `recordOrFork` falls through to its normal (unsynced) behaviour.
    if (atGen !== session.history.maxGen) return false;
    for (const op of edits) room.submitEdit(toNetEditOp(op), atGen);
    return true;
  });

  setMultiplayerEditSource((gen) => {
    const nets = room.takeDueEdits(gen);
    return nets.length > 0 ? nets.map(toEditOp) : undefined;
  });

  setMultiplayerGate((nextGen) => room.canAdvanceTo(nextGen));

  const genSub = bus.on('gen:changed', ({ gen }) => {
    room.reportGen(gen);
    if (gen % HASH_INTERVAL_GENS === 0) {
      const { width, height } = session.engine.spec;
      room.reportHash(gen, hashBits(session.engine.region({ x: 0, y: 0, w: width, h: height })));
    }
  });

  /**
   * Resync recovery: rebuild local state entirely from another peer's
   * authoritative edit log (see `docs/MULTIPLAYER.md` "desync detection and
   * recovery"). Deliberately a full `reset()` + `loadEntries()` — the same
   * mechanism `@/ui/session`'s `applyExperimentDoc` already uses to restore
   * a persisted save — rather than a partial patch, so recovery is provably
   * exact rather than "hopefully closer now".
   */
  const roomSub = room.on((event: RoomEvent) => {
    if (event.type !== 'resync') return;
    const byGen = new Map<number, EditOp[]>();
    for (const e of event.edits as StampedEdit[]) {
      const list = byGen.get(e.targetGen) ?? [];
      list.push(toEditOp(e.op));
      byGen.set(e.targetGen, list);
    }
    const entries = [...byGen.entries()]
      .sort(([a], [b]) => a - b)
      .map(([gen, edits]) => ({ gen, edits }));
    session.loop.stop();
    useAppStore.getState().setPlaying(false);
    session.history.reset();
    void session.history.loadEntries(entries, event.toGen).then(() => {
      bus.emit('toast', { message: 'Resynced with the room — replayed the authoritative history.', tone: 'success' });
    });
  });

  return {
    detach(): void {
      setMultiplayerGate(null);
      setMultiplayerEditSource(null);
      setMultiplayerEditInterceptor(null);
      genSub.dispose();
      roomSub.dispose();
    },
  };
}
