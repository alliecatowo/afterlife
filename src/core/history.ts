/**
 * Time travel. STUB — owned by the `core` agent (`src/core/**`).
 *
 * Model
 * -----
 * History is NOT stored as a snapshot per generation (too big). It is stored as
 * keyframe snapshots every `KEYFRAME_INTERVAL` generations plus the sparse list
 * of `EditOp`s recorded at each generation. Any generation is reconstructed by
 * restoring the nearest preceding keyframe and replaying steps + edits forward.
 * Because the engine is deterministic and edits are exact absolute sets, replay
 * is bit-exact.
 *
 * Bounded window
 * --------------
 * Memory is capped: only the most recent `HISTORY_WINDOW` generations are
 * retained. Keyframes older than `maxGen - HISTORY_WINDOW` are dropped and
 * `windowStart` advances. `goto(g)` with `g < windowStart` REJECTS with a
 * `HistoryWindowError`; the UI must clamp the scrubber to
 * `[windowStart, maxGen]`.
 *
 * Atomic edits
 * ------------
 * Edits recorded for generation `g` are applied at the START of `g`, before the
 * step that produces `g + 1`. A batch of cells in a single `EditOp` commits
 * together; there is no partial application. See ARCHITECTURE.md.
 */

import type {
  BranchId,
  BranchMeta,
  DiffResult,
  EditOp,
  Generation,
  HistoryEntry,
  Rect,
} from './types';
import type { LifeEngine } from './engine';

/** Snapshot cadence, in generations. */
export const KEYFRAME_INTERVAL = 64;

/** Retained generations behind `maxGen`. ~4096 gens ≈ 64 keyframes. */
export const HISTORY_WINDOW = 4096;

/** Thrown by `goto()` when the target generation has fallen out of the window. */
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

  /**
   * Record edits committed at `gen` on the active branch and advance bookkeeping.
   * Recording at a generation that already has entries appends to them.
   * Recording at a gen < maxGen truncates the future of this branch — callers
   * that want to preserve it must `branchFrom()` instead.
   */
  record(gen: Generation, edits: EditOp[]): void;

  /**
   * Scrub the engine to `gen`. Long replays yield to the event loop, so this is
   * async and CANCELLABLE: calling `goto()` again (or passing an aborted signal)
   * rejects the in-flight call with an `AbortError` DOMException. Rejects with
   * `HistoryWindowError` if `gen < windowStart`.
   */
  goto(gen: Generation, signal?: AbortSignal): Promise<void>;

  /** All recorded entries for the active branch within the window, ascending. */
  entries(): readonly HistoryEntry[];

  /**
   * Fork a new branch off the active branch at `gen`, immediately applying
   * `edits` at that generation. Does NOT switch to it — call `switchBranch`.
   */
  branchFrom(gen: Generation, edits: EditOp[]): BranchId;

  /** Rename a branch for display. Throws if `id` is unknown. */
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
   * outside the window. Cost is O((toGen - fromGen) * area) — callers should
   * cap the request (the sculpture uses <= 256 slices).
   */
  sliceStack(rect: Rect, fromGen: Generation, toGen: Generation): Promise<Uint8Array[]>;

  /** Drop every branch and entry, resetting to `gen` 0 on the root branch. */
  reset(): void;
}

export interface TimelineOptions {
  engine: LifeEngine;
  keyframeInterval?: number;
  historyWindow?: number;
}

/** Implemented by the `core` agent. */
export function createTimelineStore(_options: TimelineOptions): TimelineStore {
  throw new Error('not implemented');
}
