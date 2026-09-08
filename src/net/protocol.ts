/**
 * AFTERLIFE multiplayer — the lockstep protocol.
 *
 * Owned by the multiplayer work (`src/net/**`, `src/ui/multiplayer/**`). Pure
 * TypeScript: no DOM, no transport, no React. Everything here is plain data
 * and deterministic functions/classes so it can be unit-tested without a
 * browser and reused identically by `room.ts` (the stateful client) and by
 * tests that want to poke the algorithm directly.
 *
 * The whole idea in one paragraph
 * --------------------------------
 * AFTERLIFE already persists a world as a seed plus a sparse, generation-
 * stamped `EditOp` log (`src/core/history.ts`), and edits already commit
 * atomically at a generation boundary (ARCHITECTURE.md § Edits commit
 * atomically). That is EXACTLY the shape lockstep netcode wants: instead of
 * ever sending world state, every peer sends the same tiny edits everyone
 * already knows how to replay, stamped to land at a generation far enough in
 * the future that every peer is guaranteed to have received it before the
 * simulation gets there. No peer is authoritative; every peer computes the
 * same thing from the same inputs, deterministically ordered.
 *
 * The latency buffer
 * -------------------
 * `LATENCY_BUFFER_GENS` (default 12, ~1s at the app's default 12 gens/sec) is
 * how far in the future an edit is stamped relative to the sender's own
 * generation at the moment they made it (`stampEdit`). This applies to EVERY
 * edit, including the author's own — a multiplayer edit never applies
 * "now" for anyone, not even the person who drew it. That symmetry is the
 * entire point: if the author saw their own edit land instantly while every
 * other peer saw it land `LATENCY_BUFFER_GENS` later, the author's own
 * replayable history would disagree with everyone else's from the very
 * next generation, which is a desync by definition, not an edge case of one.
 * The trade-off is honest input lag (~1s), documented in
 * `docs/MULTIPLAYER.md` — this suits collaborative building, not twitch
 * play.
 *
 * Deterministic ordering
 * -----------------------
 * Two edits landing on the same `targetGen` are ordered by
 * `(targetGen, peerId, seq)` — see `compareStampedEdits`. Every peer computes
 * this ordering independently from the same wire data, so no server or
 * "first writer wins" race is needed to agree on an outcome: whichever cell
 * two edits disagree on, every peer applies them in the same order and gets
 * the same last-write-wins result.
 *
 * Stall policy
 * ------------
 * A peer only knows an edit can no longer land on generation G once every
 * other peer's own local generation has advanced far enough that they could
 * no longer schedule anything for G (see `StallTracker.safeGen`'s doc). The
 * simulation must not step past that point — see `docs/MULTIPLAYER.md`
 * "stall policy" and the `@/ui/session.ts` hook that enforces it.
 *
 * Desync detection
 * ----------------
 * Every `HASH_INTERVAL_GENS` generations, every peer hashes its own world
 * (see `hashBits`) and broadcasts it. `DesyncMonitor` compares a remote hash
 * against the local hash recorded for that same generation. A mismatch is
 * reported loudly (`RoomEvent` of type `'desync'` in `room.ts`) — never
 * silently absorbed.
 */

/** How far in the future (in generations) an edit is scheduled relative to
 *  the sender's local generation at submit time. ~1s at the app's default
 *  12 gens/sec. */
export const LATENCY_BUFFER_GENS = 12;

/** Cadence (in generations) at which peers exchange a world hash to detect
 *  divergence. Matches `KEYFRAME_INTERVAL` in `@/core/history` so the check
 *  always lands on a generation the local peer can already re-derive cheaply
 *  if it needs to resync. */
export const HASH_INTERVAL_GENS = 64;

/** How long a peer's watermark may go unrefreshed before it's reported as
 *  the reason the room is stalled, rather than just "hasn't ticked yet". */
export const PEER_STALL_REPORT_MS = 1500;

/** How many generations of edits a room keeps for resync purposes. */
export const EDIT_LOG_RETENTION_GENS = 4096;

export type PeerId = string;

/**
 * A room's shared world identity. Mirrors `@/core/types`' `WorldSpec` plus a
 * `rule` string (the `rules` agent's concurrent work is making the B/S rule
 * part of world identity — see ARCHITECTURE.md). Kept as an independent,
 * plain-data type here (not imported from `@/core/types`) so this module has
 * no compile-time dependency on that landing first; `describeWorldMismatch`
 * is the actual join-time contract two peers must agree on.
 */
export interface RoomWorldSpec {
  width: number;
  height: number;
  boundary: 'torus';
  /** LifeWiki B/S notation, e.g. `"B3/S23"`. */
  rule: string;
}

/** Everything two peers must agree on before they can share a room. */
export interface RoomSpec {
  /** Short, shareable, human-typeable room code. */
  code: string;
  world: RoomWorldSpec;
  /** RNG seed the room's world was (or will be) seeded from. */
  seed: number;
  /** The generation the room started counting from (normally 0). */
  startGen: number;
  createdAt: number;
}

/** Returns a human-readable mismatch reason, or `null` if the two specs
 *  describe the same shared world. */
export function describeWorldMismatch(a: RoomWorldSpec, b: RoomWorldSpec): string | null {
  if (a.width !== b.width || a.height !== b.height) {
    return `world size differs (${a.width}x${a.height} vs ${b.width}x${b.height})`;
  }
  if (a.boundary !== b.boundary) return `boundary differs (${a.boundary} vs ${b.boundary})`;
  if (a.rule !== b.rule) return `rule differs (${a.rule} vs ${b.rule})`;
  return null;
}

/** Wire shape of an edit. Structurally identical to `@/core/types`' `EditOp`
 *  (kept independent for the same reason as `RoomWorldSpec` above — this
 *  module doesn't import core). */
export interface NetEditOp {
  kind: 'set';
  cells: Array<{ x: number; y: number; alive: boolean }>;
}

/** An edit, stamped with everything every peer needs to apply it at the same
 *  generation in the same deterministic order. */
export interface StampedEdit {
  peerId: PeerId;
  /** Per-peer monotonic counter — the final tiebreaker when `(targetGen,
   *  peerId)` still isn't unique (a peer submitting two edits at once). */
  seq: number;
  /** The sender's own generation at submit time. Diagnostic only. */
  originGen: number;
  /** The generation this edit MUST be applied at, by every peer. */
  targetGen: number;
  op: NetEditOp;
}

/** Stamp a local edit for broadcast. Every edit — including the sender's
 *  own — is scheduled `bufferGens` generations into the sender's own future;
 *  see the module doc's "latency buffer" section for why. */
export function stampEdit(peerId: PeerId, seq: number, originGen: number, op: NetEditOp, bufferGens: number = LATENCY_BUFFER_GENS): StampedEdit {
  return { peerId, seq, originGen, targetGen: originGen + bufferGens, op };
}

/** The total order every peer agrees on for edits landing on the same
 *  generation: `(targetGen, peerId, seq)`. Deterministic across peers
 *  regardless of arrival order — see the module doc. */
export function compareStampedEdits(a: StampedEdit, b: StampedEdit): number {
  if (a.targetGen !== b.targetGen) return a.targetGen - b.targetGen;
  if (a.peerId !== b.peerId) return a.peerId < b.peerId ? -1 : 1;
  return a.seq - b.seq;
}

/** Stable dedup key for an edit — a given `(peerId, seq)` is only ever
 *  accepted once, so a retransmit or a message seen twice (e.g. once direct,
 *  once via a resync payload) never double-applies. */
export function editKey(e: StampedEdit): string {
  return `${e.peerId}:${e.seq}`;
}

export type EditAcceptResult =
  | { ok: true }
  | { ok: false; reason: 'late'; deadline: number }
  | { ok: false; reason: 'duplicate' };

/**
 * The room's shared edit log: every `StampedEdit` any peer has ever
 * broadcast, keyed by the generation it must apply at, always returned in
 * the deterministic `compareStampedEdits` order. Also the seat of "late
 * edit" detection: once a generation has been marked `applied` (the local
 * simulation has actually stepped past it), any edit that still claims that
 * generation as its deadline is REJECTED, not silently accepted — see
 * `docs/MULTIPLAYER.md` "stall policy and late edits".
 */
export class EditLog {
  private byGen = new Map<number, StampedEdit[]>();
  private seen = new Set<string>();
  private highestApplied = -1;

  /** Record that generation `gen` has now been simulated locally — no edit
   *  may still land there. Idempotent; only ever moves forward. */
  markApplied(gen: number): void {
    if (gen > this.highestApplied) this.highestApplied = gen;
  }

  get highestAppliedGen(): number {
    return this.highestApplied;
  }

  add(edit: StampedEdit): EditAcceptResult {
    const key = editKey(edit);
    if (this.seen.has(key)) return { ok: false, reason: 'duplicate' };
    if (edit.targetGen <= this.highestApplied) {
      return { ok: false, reason: 'late', deadline: edit.targetGen };
    }
    this.seen.add(key);
    const list = this.byGen.get(edit.targetGen) ?? [];
    list.push(edit);
    list.sort(compareStampedEdits);
    this.byGen.set(edit.targetGen, list);
    return { ok: true };
  }

  /** Edits scheduled at exactly `gen`, deterministically ordered. Does not
   *  remove them — see `consume`. */
  editsAt(gen: number): StampedEdit[] {
    return this.byGen.get(gen) ?? [];
  }

  /** Mark `gen` applied and return its edits. Kept in storage (bounded by
   *  `prune`) so a later resync request can still serve them. */
  consume(gen: number): StampedEdit[] {
    const edits = this.editsAt(gen);
    this.markApplied(gen);
    return edits;
  }

  /** Every edit with `targetGen > sinceGen`, deterministically ordered —
   *  the authoritative payload sent back in response to a resync request. */
  since(sinceGen: number): StampedEdit[] {
    const out: StampedEdit[] = [];
    for (const [gen, edits] of this.byGen) {
      if (gen > sinceGen) out.push(...edits);
    }
    return out.sort(compareStampedEdits);
  }

  /** Drop edits older than the retention window, bounding memory the same
   *  way `@/core/history`'s `HISTORY_WINDOW` does. */
  prune(retentionGens: number = EDIT_LOG_RETENTION_GENS): void {
    if (this.highestApplied < 0) return;
    const floor = this.highestApplied - retentionGens;
    for (const gen of [...this.byGen.keys()]) {
      if (gen < floor) this.byGen.delete(gen);
    }
  }
}

/** A peer's last-known generation, and when we last heard it. */
export interface PeerWatermark {
  peerId: PeerId;
  gen: number;
  updatedAt: number;
}

/**
 * Tracks every known peer's own generation ("watermark") and computes the
 * highest generation it is SAFE for the local simulation to have reached.
 *
 * Why this is the correct condition: a peer's own edits are always stamped
 * to `theirGen + buffer` at submit time (see `stampEdit`), and `theirGen`
 * only ever increases. So once we know a peer's watermark has reached `g`,
 * they can never subsequently submit an edit landing before `g + buffer`
 * (the earliest they could still target is `g + buffer` itself, if they
 * submit one right now). That means generation `g + buffer - 1` is fully
 * decided — no known peer can still add an edit there — and it's safe to
 * simulate up to (and including) it. `safeGen()` is the minimum of that
 * bound over every known peer, which is exactly "wait for the slowest
 * peer" — the lockstep stall rule.
 */
export class StallTracker {
  private peers = new Map<PeerId, PeerWatermark>();

  constructor(private readonly bufferGens: number = LATENCY_BUFFER_GENS) {}

  upsert(peerId: PeerId, gen: number, now: number = Date.now()): void {
    const existing = this.peers.get(peerId);
    // Watermarks are monotonic — an out-of-order/duplicate heartbeat must
    // never move one backwards (that would let a since-passed generation
    // look "unsafe" again, or worse, let a stale watermark undercut a real
    // one that already arrived).
    if (existing && gen < existing.gen) return;
    this.peers.set(peerId, { peerId, gen, updatedAt: now });
  }

  remove(peerId: PeerId): void {
    this.peers.delete(peerId);
  }

  get peerCount(): number {
    return this.peers.size;
  }

  watermarks(): PeerWatermark[] {
    return [...this.peers.values()];
  }

  /** Highest generation it is currently safe to have simulated, given every
   *  known peer's watermark. `Infinity` (no ceiling) when solo. */
  safeGen(): number {
    if (this.peers.size === 0) return Infinity;
    let min = Infinity;
    for (const w of this.peers.values()) min = Math.min(min, w.gen);
    return min + this.bufferGens - 1;
  }

  /** Peers whose watermark is the reason `targetGen` isn't safe yet, with
   *  how long (ms) since we last heard from each. */
  blocking(targetGen: number, now: number = Date.now()): Array<{ peerId: PeerId; stalledMs: number; gen: number }> {
    const out: Array<{ peerId: PeerId; stalledMs: number; gen: number }> = [];
    for (const w of this.peers.values()) {
      if (w.gen + this.bufferGens - 1 < targetGen) {
        out.push({ peerId: w.peerId, stalledMs: now - w.updatedAt, gen: w.gen });
      }
    }
    return out;
  }
}

/**
 * Cheap, deterministic 32-bit FNV-1a hash over a row-major cell buffer.
 * Not cryptographic — it only needs to make an accidental divergence
 * astronomically unlikely to hide, which FNV-1a comfortably does for a
 * fixed-size grid of 0/1 bytes.
 */
export function hashBits(bits: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < bits.length; i++) {
    h ^= bits[i]!;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export type DesyncCheckResult =
  | { status: 'match' }
  | { status: 'mismatch'; local: string; remote: string }
  /** We haven't recorded (or have already pruned) our own hash for this
   *  generation — not evidence of anything either way. */
  | { status: 'unknown' };

/**
 * Compares remote world hashes against ones the local peer recorded for the
 * same generation. See the module doc's "desync detection" section — a
 * mismatch must always be surfaced, never swallowed.
 */
export class DesyncMonitor {
  private local = new Map<number, string>();

  constructor(private readonly retainPoints: number = 64) {}

  recordLocal(gen: number, hash: string): void {
    this.local.set(gen, hash);
    if (this.local.size > this.retainPoints) {
      let oldest = Infinity;
      for (const g of this.local.keys()) if (g < oldest) oldest = g;
      this.local.delete(oldest);
    }
  }

  check(gen: number, remoteHash: string): DesyncCheckResult {
    const mine = this.local.get(gen);
    if (mine === undefined) return { status: 'unknown' };
    return mine === remoteHash ? { status: 'match' } : { status: 'mismatch', local: mine, remote: remoteHash };
  }
}

/** Messages exchanged between peers. Transport-agnostic — `transport.ts`
 *  just moves these; it never interprets them. */
export type WireMessage =
  | { type: 'hello'; peerId: PeerId; name: string; color: string; gen: number; room: RoomSpec }
  | { type: 'welcome'; peerId: PeerId; peers: Array<{ peerId: PeerId; name: string; color: string }> }
  | { type: 'heartbeat'; peerId: PeerId; gen: number }
  | { type: 'edit'; edit: StampedEdit }
  | { type: 'hash'; peerId: PeerId; gen: number; hash: string }
  | { type: 'resyncRequest'; peerId: PeerId; sinceGen: number }
  | { type: 'resyncData'; peerId: PeerId; edits: StampedEdit[]; toGen: number }
  | { type: 'leave'; peerId: PeerId };

/** Generate a short, shareable, human-typeable room code — no account, no
 *  server round-trip, just enough entropy to avoid accidental collisions
 *  between unrelated rooms sharing a browser. */
export function generateRoomCode(random: () => number = Math.random): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I — avoids read-back ambiguity
  let out = '';
  for (let i = 0; i < 6; i++) out += alphabet[Math.floor(random() * alphabet.length)];
  return out;
}
