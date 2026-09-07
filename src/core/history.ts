/**
 * Time travel. Fully implemented — owned by the `core` agent (`src/core/**`).
 *
 * Model
 * -----
 * History is NOT stored as a snapshot per generation (too big). It is stored as
 * keyframe snapshots every `KEYFRAME_INTERVAL` generations plus the sparse list
 * of `EditOp`s recorded at each generation. Any generation is reconstructed by
 * restoring the nearest preceding keyframe and replaying steps + edits forward.
 * Because the engine is deterministic and edits are exact absolute sets, replay
 * is bit-exact (this only concerns `Snapshot.bits` — `age`/`activity` are
 * cosmetic lens data and are NOT required to replay identically, see engine.ts).
 *
 * Bounded window
 * --------------
 * Memory is capped: only the most recent `HISTORY_WINDOW` generations are
 * retained, per branch. Keyframes/entries older than `windowStart` are dropped
 * (a fresh keyframe is materialised at the new `windowStart` boundary first, so
 * `goto(windowStart)` always stays valid). `goto(g)`/`sliceStack`/`branchFrom`
 * with `g < windowStart` REJECT with a `HistoryWindowError`; the UI must clamp
 * the scrubber to `[windowStart, maxGen]`.
 *
 * Atomic edits
 * ------------
 * Edits recorded for generation `g` are applied at the START of `g`, before the
 * step that produces `g + 1`. A batch of cells in a single `EditOp` commits
 * together; there is no partial application. See ARCHITECTURE.md.
 *
 * Branching
 * ---------
 * `branchFrom(gen, edits)` never deep-copies the parent's history: it shallow-
 * copies the parent's keyframe/entry Maps (cheap — at most a few dozen pointers
 * to snapshots, never the underlying `Uint8Array` payloads are duplicated by
 * this copy) into a brand-new Map for the child, then truncates anything past
 * `gen` and records the fork edits. The parent's own Maps are untouched, so its
 * future is preserved exactly. Branches are capped at `MAX_BRANCHES`; the
 * least-recently-used branch is evicted to make room, but a branch that has
 * been renamed or is currently active is never evicted.
 *
 * Integration note (see INTEGRATION-NOTES.md)
 * --------------------------------------------
 * `record()`/`goto()`/`branchFrom()` are sufficient for correctness on their
 * own (replay always works from the gen-0 keyframe if nothing else is warm).
 * But whichever module wires up `SimLoop` should also call
 * `history.advance(engine.gen)` once per generation right after `engine.step()`
 * during normal playback — this is what keeps `maxGen` current and populates
 * keyframes every `KEYFRAME_INTERVAL` generations for fast seeking. It is O(1)
 * most generations and O(area) only every 64th, so it is cheap to call from the
 * hot loop.
 */

import type {
  BranchId,
  BranchMeta,
  DiffResult,
  EditOp,
  Generation,
  HistoryEntry,
  Rect,
  Snapshot,
} from './types';
import type { LifeEngine } from './engine';
import { normalizeRect } from './engine';

/** Snapshot cadence, in generations. */
export const KEYFRAME_INTERVAL = 64;

/** Retained generations behind `maxGen`. ~4096 gens ≈ 64 keyframes. */
export const HISTORY_WINDOW = 4096;

/** Maximum number of branches retained at once (including root). */
export const MAX_BRANCHES = 8;

/** Thrown by `goto()`/`sliceStack()`/`branchFrom()` when the target generation has fallen out of the window. */
export class HistoryWindowError extends Error {
  constructor(
    public readonly requested: Generation,
    public readonly windowStart: Generation,
  ) {
    super(`generation ${requested} is older than the retained window (starts at ${windowStart})`);
    this.name = 'HistoryWindowError';
  }
}

export interface TimelineStore {
  /** The engine this store drives. `goto()` mutates it in place. */
  readonly engine: LifeEngine;

  /** Highest generation ever reached on the active branch. */
  readonly maxGen: Generation;

  /** Oldest generation still reachable via `goto()`. See bounded window above. */
  readonly windowStart: Generation;

  /** The branch currently driving `engine`. */
  readonly activeBranch: BranchId;

  /** All known branches, root first. */
  readonly branches: readonly BranchMeta[];

  /** The stride actually used by the most recent `sliceStack()` call (1 if no stride-sampling was needed). */
  readonly lastSliceStride: number;

  /**
   * Record edits committed at `gen` on the active branch and advance bookkeeping.
   * Recording at a generation that already has entries appends to them.
   * Recording at a gen < maxGen truncates the future of this branch — callers
   * that want to preserve it must `branchFrom()` instead. If `gen` equals the
   * engine's current generation, the edits are also applied to the live engine
   * immediately (so the caller sees instant feedback without a `goto()`).
   */
  record(gen: Generation, edits: EditOp[]): void;

  /**
   * Advance bookkeeping (maxGen, keyframe capture) to reflect that the live
   * engine — driving the active branch — has reached `gen` via plain `step()`
   * calls outside this store (e.g. the render loop). Cheap; see module doc.
   */
  advance(gen: Generation): void;

  /**
   * Scrub the engine to `gen`. Long replays yield to the event loop, so this is
   * async and CANCELLABLE: calling `goto()` again (or aborting `signal`)
   * rejects the in-flight call with an `AbortError` DOMException. Rejects with
   * `HistoryWindowError` if `gen < windowStart`. `onProgress(done, total)` is
   * called at each yield point so the UI can show a progress affordance for
   * long seeks.
   */
  goto(gen: Generation, signal?: AbortSignal, onProgress?: (done: number, total: number) => void): Promise<void>;

  /** All recorded entries for the active branch within the window, ascending. */
  entries(): readonly HistoryEntry[];

  /**
   * Fork a new branch off the active branch at `gen`, immediately applying
   * `edits` at that generation. Does NOT switch to it — call `switchBranch`.
   */
  branchFrom(gen: Generation, edits: EditOp[]): BranchId;

  /** Rename a branch for display. Throws if `id` is unknown. Renamed branches are never auto-evicted. */
  renameBranch(id: BranchId, name: string): void;

  /** Make `id` active and scrub the engine to `gen` (default: that branch's maxGen). */
  switchBranch(id: BranchId, gen?: Generation): Promise<void>;

  /**
   * Compare two branches at the same generation over `rect`.
   * `cells` is row-major over `rect`: 0 = same, 1 = alive only in `a`,
   * 2 = alive only in `b`.
   */
  diff(a: BranchId, b: BranchId, gen: Generation, rect: Rect): Promise<DiffResult>;

  /**
   * REAL recorded history for the Time Sculpture: one row-major
   * `rect.w * rect.h` slice per generation in `[fromGen, toGen]` inclusive,
   * reconstructed by replay. Rejects with `HistoryWindowError` if `fromGen` is
   * outside the window. If the range spans more than `maxSlices` generations,
   * slices are stride-sampled evenly (always including `fromGen`); the stride
   * used is reported via `lastSliceStride`.
   */
  sliceStack(rect: Rect, fromGen: Generation, toGen: Generation, maxSlices?: number): Promise<Uint8Array[]>;

  /** Drop every branch and entry, resetting to `gen` 0 on the root branch (using the engine's current bits as the new baseline). */
  reset(): void;

  /**
   * An independent, fully-populated `LifeEngine` holding branch `id`'s REAL
   * recorded state at `gen` (clamped to that branch's own `maxGen`), built by
   * replay from its nearest keyframe — never a fabricated or interpolated
   * state. Used for a synchronized side-by-side view of a second branch
   * without disturbing the active branch's own `engine`. Rejects with
   * `HistoryWindowError` if `gen` predates that branch's window.
   */
  cloneBranchAt(id: BranchId, gen: Generation, signal?: AbortSignal): Promise<LifeEngine>;

  /**
   * Restore a persisted document's entries (see `@/persist/codec`) onto the
   * active branch — call immediately after `reset()`. Unlike `record()`,
   * this also re-simulates the plain (edit-free) steps up to `toGen` and
   * genuinely advances `maxGen` to match: a document's `edits` only capture
   * generations that had an explicit edit, never the ordinary steps in
   * between, so `record()` alone would leave the branch's bookkeeping
   * stuck at the last edited generation instead of wherever it was actually
   * saved from. Leaves `engine` at `toGen`.
   */
  loadEntries(entries: readonly HistoryEntry[], toGen: Generation): Promise<void>;
}

export interface TimelineOptions {
  engine: LifeEngine;
  keyframeInterval?: number;
  historyWindow?: number;
}

function applyEditOp(target: LifeEngine, op: EditOp): void {
  for (const c of op.cells) target.set(c.x, c.y, c.alive);
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

interface BranchRecord {
  meta: BranchMeta;
  /** gen -> edits, flattened (includes everything inherited from ancestors at fork time). */
  entries: Map<Generation, EditOp[]>;
  /** gen -> keyframe snapshot, flattened. Always has an entry <= any reachable gen. */
  keyframes: Map<Generation, Snapshot>;
  maxGen: Generation;
  windowStart: Generation;
  renamed: boolean;
  lastAccessed: number;
}

class TimelineStoreImpl implements TimelineStore {
  readonly engine: LifeEngine;
  private readonly keyframeInterval: number;
  private readonly historyWindow: number;

  private branchMap = new Map<BranchId, BranchRecord>();
  private branchOrder: BranchId[] = [];
  private activeBranchId: BranchId;
  private branchCounter = 0;
  private clock = 0;
  private pendingGoto: AbortController | null = null;
  private _lastSliceStride = 1;

  constructor(options: TimelineOptions) {
    this.engine = options.engine;
    this.keyframeInterval = options.keyframeInterval ?? KEYFRAME_INTERVAL;
    this.historyWindow = options.historyWindow ?? HISTORY_WINDOW;

    const rootId: BranchId = 'root';
    const startGen = this.engine.gen;
    const root: BranchRecord = {
      meta: { id: rootId, name: 'root', parent: null, fromGen: 0, createdAt: Date.now() },
      entries: new Map(),
      keyframes: new Map([[startGen, this.engine.snapshot()]]),
      maxGen: startGen,
      windowStart: startGen,
      renamed: true,
      lastAccessed: 0,
    };
    this.branchMap.set(rootId, root);
    this.branchOrder.push(rootId);
    this.activeBranchId = rootId;
  }

  get maxGen(): Generation {
    return this.activeBranchRecord().maxGen;
  }

  get windowStart(): Generation {
    return this.activeBranchRecord().windowStart;
  }

  get activeBranch(): BranchId {
    return this.activeBranchId;
  }

  get branches(): readonly BranchMeta[] {
    return this.branchOrder.map((id) => this.branchMap.get(id)!.meta);
  }

  get lastSliceStride(): number {
    return this._lastSliceStride;
  }

  private activeBranchRecord(): BranchRecord {
    const b = this.branchMap.get(this.activeBranchId);
    if (!b) throw new Error('history: active branch record missing (internal invariant violated)');
    return b;
  }

  private touch(b: BranchRecord): void {
    b.lastAccessed = ++this.clock;
  }

  private findBaseline(b: BranchRecord, gen: Generation): { kfGen: number; snapshot: Snapshot } {
    let kfGen = -1;
    for (const g of b.keyframes.keys()) {
      if (g <= gen && g > kfGen) kfGen = g;
    }
    if (kfGen === -1) {
      throw new Error(`history: no keyframe at or before generation ${gen} (internal invariant violated)`);
    }
    return { kfGen, snapshot: b.keyframes.get(kfGen)! };
  }

  /** Synchronous replay for internal maintenance (window shifts, branch forks). No yielding. */
  private replaySync(target: LifeEngine, b: BranchRecord, targetGen: Generation): void {
    const { kfGen, snapshot } = this.findBaseline(b, targetGen);
    target.restore(snapshot);
    for (let g = kfGen + 1; g <= targetGen; g++) {
      target.step();
      const ops = b.entries.get(g);
      if (ops) for (const op of ops) applyEditOp(target, op);
    }
  }

  /** Chunked, cancellable replay used by the public async API. */
  private async replayAsync(
    target: LifeEngine,
    b: BranchRecord,
    targetGen: Generation,
    opts: { chunk?: number; onProgress?: (done: number, total: number) => void; signals?: Array<AbortSignal | undefined> },
  ): Promise<void> {
    const chunk = opts.chunk ?? 64;
    const { kfGen, snapshot } = this.findBaseline(b, targetGen);
    target.restore(snapshot);
    const total = Math.max(1, targetGen - kfGen);
    let sinceYield = 0;
    const checkAbort = (): void => {
      for (const s of opts.signals ?? []) {
        if (s?.aborted) throw new DOMException('goto superseded', 'AbortError');
      }
    };
    for (let g = kfGen + 1; g <= targetGen; g++) {
      checkAbort();
      target.step();
      const ops = b.entries.get(g);
      if (ops) for (const op of ops) applyEditOp(target, op);
      sinceYield++;
      if (sinceYield >= chunk) {
        opts.onProgress?.(g - kfGen, total);
        await yieldToEventLoop();
        sinceYield = 0;
        checkAbort();
      }
    }
    opts.onProgress?.(total, total);
  }

  private pruneWindow(b: BranchRecord): void {
    const idealStart = Math.max(0, b.maxGen - this.historyWindow);
    const floorStart = Math.floor(idealStart / this.keyframeInterval) * this.keyframeInterval;
    if (floorStart <= b.windowStart) return;
    if (!b.keyframes.has(floorStart)) {
      const scratch = this.engine.clone();
      this.replaySync(scratch, b, floorStart);
      b.keyframes.set(floorStart, scratch.snapshot());
    }
    for (const g of [...b.keyframes.keys()]) if (g < floorStart) b.keyframes.delete(g);
    for (const g of [...b.entries.keys()]) if (g < floorStart) b.entries.delete(g);
    b.windowStart = floorStart;
  }

  private evictIfNeeded(): void {
    if (this.branchOrder.length <= MAX_BRANCHES) return;
    let victim: BranchId | null = null;
    let victimTime = Infinity;
    for (const id of this.branchOrder) {
      const b = this.branchMap.get(id)!;
      if (id === 'root' || id === this.activeBranchId || b.renamed) continue;
      if (b.lastAccessed < victimTime) {
        victimTime = b.lastAccessed;
        victim = id;
      }
    }
    if (victim) {
      this.branchMap.delete(victim);
      this.branchOrder = this.branchOrder.filter((id) => id !== victim);
    }
  }

  record(gen: Generation, edits: EditOp[]): void {
    const b = this.activeBranchRecord();
    if (gen < b.windowStart) throw new HistoryWindowError(gen, b.windowStart);
    if (edits.length === 0) return;
    this.touch(b);

    const existing = b.entries.get(gen) ?? [];
    b.entries.set(gen, [...existing, ...edits]);

    if (gen < b.maxGen) {
      for (const g of [...b.entries.keys()]) if (g > gen) b.entries.delete(g);
      for (const g of [...b.keyframes.keys()]) if (g > gen) b.keyframes.delete(g);
      b.maxGen = gen;
    } else if (gen > b.maxGen) {
      b.maxGen = gen;
    }

    if (gen === this.engine.gen) {
      for (const op of edits) applyEditOp(this.engine, op);
      if (b.keyframes.has(gen)) b.keyframes.set(gen, this.engine.snapshot());
    }

    this.pruneWindow(b);
  }

  advance(gen: Generation): void {
    const b = this.activeBranchRecord();
    this.touch(b);
    if (gen > b.maxGen) b.maxGen = gen;
    if (gen % this.keyframeInterval === 0 && !b.keyframes.has(gen)) {
      b.keyframes.set(gen, this.engine.snapshot());
    }
    this.pruneWindow(b);
  }

  async goto(gen: Generation, signal?: AbortSignal, onProgress?: (done: number, total: number) => void): Promise<void> {
    const b = this.activeBranchRecord();
    if (gen < b.windowStart) throw new HistoryWindowError(gen, b.windowStart);
    const clamped = Math.min(Math.max(gen, b.windowStart), b.maxGen);

    this.pendingGoto?.abort();
    const internal = new AbortController();
    this.pendingGoto = internal;
    try {
      await this.replayAsync(this.engine, b, clamped, {
        onProgress,
        signals: [signal, internal.signal],
      });
      this.touch(b);
    } finally {
      if (this.pendingGoto === internal) this.pendingGoto = null;
    }
  }

  entries(): readonly HistoryEntry[] {
    const b = this.activeBranchRecord();
    return [...b.entries.entries()]
      .filter(([g]) => g >= b.windowStart)
      .sort((x, y) => x[0] - y[0])
      .map(([gen, edits]) => ({ gen, edits }));
  }

  branchFrom(gen: Generation, edits: EditOp[]): BranchId {
    const parent = this.activeBranchRecord();
    if (gen < parent.windowStart) throw new HistoryWindowError(gen, parent.windowStart);
    if (gen > parent.maxGen) {
      throw new Error(`branchFrom: gen ${gen} exceeds the active branch's maxGen (${parent.maxGen})`);
    }

    const id: BranchId = `branch-${++this.branchCounter}`;
    const entries = new Map(parent.entries);
    const keyframes = new Map(parent.keyframes);
    for (const g of [...entries.keys()]) if (g > gen) entries.delete(g);
    for (const g of [...keyframes.keys()]) if (g > gen) keyframes.delete(g);

    if (edits.length > 0) {
      const existing = entries.get(gen) ?? [];
      entries.set(gen, [...existing, ...edits]);
    }

    const child: BranchRecord = {
      meta: { id, name: id, parent: parent.meta.id, fromGen: gen, createdAt: Date.now() },
      entries,
      keyframes,
      maxGen: gen,
      windowStart: parent.windowStart,
      renamed: false,
      lastAccessed: ++this.clock,
    };

    // Eagerly materialise a keyframe at the fork point (with fork edits baked
    // in) — the fork point is the single most likely place this branch will
    // be viewed from first, so make it cheap.
    const scratch = this.engine.clone();
    this.replaySync(scratch, child, gen);
    keyframes.set(gen, scratch.snapshot());

    this.branchMap.set(id, child);
    this.branchOrder.push(id);
    this.evictIfNeeded();
    return id;
  }

  renameBranch(id: BranchId, name: string): void {
    const b = this.branchMap.get(id);
    if (!b) throw new Error(`renameBranch: unknown branch "${id}"`);
    b.meta = { ...b.meta, name };
    b.renamed = true;
  }

  async switchBranch(id: BranchId, gen?: Generation): Promise<void> {
    const b = this.branchMap.get(id);
    if (!b) throw new Error(`switchBranch: unknown branch "${id}"`);
    this.activeBranchId = id;
    this.touch(b);
    await this.goto(gen ?? b.maxGen);
  }

  async diff(aId: BranchId, bId: BranchId, gen: Generation, rect: Rect): Promise<DiffResult> {
    const A = this.branchMap.get(aId);
    const B = this.branchMap.get(bId);
    if (!A || !B) throw new Error('diff: unknown branch id');
    if (gen < A.windowStart) throw new HistoryWindowError(gen, A.windowStart);
    if (gen < B.windowStart) throw new HistoryWindowError(gen, B.windowStart);

    const r = normalizeRect(rect);
    const scratchA = this.engine.clone();
    const scratchB = this.engine.clone();
    await this.replayAsync(scratchA, A, Math.min(gen, A.maxGen), {});
    await this.replayAsync(scratchB, B, Math.min(gen, B.maxGen), {});
    const regionA = scratchA.region(r);
    const regionB = scratchB.region(r);
    const cells = new Uint8Array(r.w * r.h);
    let count = 0;
    for (let i = 0; i < cells.length; i++) {
      const av = regionA[i];
      const bv = regionB[i];
      if (av === bv) {
        cells[i] = 0;
      } else if (av === 1 && bv === 0) {
        cells[i] = 1;
        count++;
      } else {
        cells[i] = 2;
        count++;
      }
    }
    return { count, cells };
  }

  async sliceStack(rect: Rect, fromGen: Generation, toGen: Generation, maxSlices = 256): Promise<Uint8Array[]> {
    const b = this.activeBranchRecord();
    if (fromGen < b.windowStart) throw new HistoryWindowError(fromGen, b.windowStart);
    if (toGen < fromGen) throw new Error('sliceStack: toGen must be >= fromGen');
    if (toGen > b.maxGen) throw new Error(`sliceStack: toGen ${toGen} exceeds maxGen ${b.maxGen}`);

    const r = normalizeRect(rect);
    const span = toGen - fromGen + 1;
    const stride = Math.max(1, Math.ceil(span / Math.max(1, maxSlices)));
    this._lastSliceStride = stride;

    const scratch = this.engine.clone();
    const { kfGen, snapshot } = this.findBaseline(b, fromGen);
    scratch.restore(snapshot);
    let cursor = kfGen;
    const out: Uint8Array[] = [];
    let sinceYield = 0;

    for (let g = fromGen; g <= toGen; g += stride) {
      while (cursor < g) {
        scratch.step();
        cursor++;
        const ops = b.entries.get(cursor);
        if (ops) for (const op of ops) applyEditOp(scratch, op);
        sinceYield++;
        if (sinceYield >= 64) {
          await yieldToEventLoop();
          sinceYield = 0;
        }
      }
      out.push(scratch.region(r));
    }
    return out;
  }

  async cloneBranchAt(id: BranchId, gen: Generation, signal?: AbortSignal): Promise<LifeEngine> {
    const b = this.branchMap.get(id);
    if (!b) throw new Error(`cloneBranchAt: unknown branch "${id}"`);
    if (gen < b.windowStart) throw new HistoryWindowError(gen, b.windowStart);
    const scratch = this.engine.clone();
    await this.replayAsync(scratch, b, Math.min(gen, b.maxGen), { signals: [signal] });
    return scratch;
  }

  async loadEntries(entries: readonly HistoryEntry[], toGen: Generation): Promise<void> {
    const b = this.activeBranchRecord();
    for (const { gen, edits } of entries) {
      if (edits.length === 0) continue;
      const existing = b.entries.get(gen) ?? [];
      b.entries.set(gen, [...existing, ...edits]);
    }
    await this.replayAsync(this.engine, b, toGen, {});
    if (toGen > b.maxGen) b.maxGen = toGen;
    this.touch(b);
    this.pruneWindow(b);
  }

  reset(): void {
    this.pendingGoto?.abort();
    this.pendingGoto = null;
    const bits = this.engine.snapshot().bits;
    this.engine.restore({ gen: 0, bits });

    this.branchMap.clear();
    this.branchOrder = [];
    const rootId: BranchId = 'root';
    const root: BranchRecord = {
      meta: { id: rootId, name: 'root', parent: null, fromGen: 0, createdAt: Date.now() },
      entries: new Map(),
      keyframes: new Map([[0, this.engine.snapshot()]]),
      maxGen: 0,
      windowStart: 0,
      renamed: true,
      lastAccessed: ++this.clock,
    };
    this.branchMap.set(rootId, root);
    this.branchOrder.push(rootId);
    this.activeBranchId = rootId;
  }
}

/** Implemented by the `core` agent. */
export function createTimelineStore(options: TimelineOptions): TimelineStore {
  return new TimelineStoreImpl(options);
}
