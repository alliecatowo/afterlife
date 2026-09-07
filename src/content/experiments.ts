/**
 * The three authored experiments. Each pairs a `SceneDef` (from
 * `@/content/scenes`) with instructions and a pure evaluator: a function
 * from simulation state (region snapshots the caller has already read off
 * `@/core/engine`) to a verdict, with no hidden state and no engine access
 * of its own. That keeps the evaluators trivially unit-testable and keeps
 * this module ignorant of *how* the app steps or renders the simulation.
 *
 * Division of responsibility: this module says what a "win" looks like and
 * what the starting world is. It does not implement restart, branching or
 * time travel — those are `@/core/history`'s `TimelineStore` (`reset()`,
 * `branchFrom()`, `goto()`). An integration layer wires a `TimelineStore` to
 * a scene's `cells`/`world` for restart, calls `branchFrom(0, edits)` for an
 * intervention, and uses `goto()` for time travel; this module just needs to
 * be told the resulting state to judge it.
 */
import { createEngine } from '@/core/engine';
import type { CellCoord, EditOp, Rect, StampPattern, StampTransform, WorldSpec } from '@/core/types';
import { transformPattern } from '@/core/engine';
import {
  FIRST_CONTACT_SCENE,
  FIRST_CONTACT_VERIFIED,
  KEEP_ALIVE_SCENE,
  KEEP_ALIVE_VERIFIED,
  ONE_CELL_SCENE,
  ONE_CELL_VERIFIED,
  type SceneDef,
} from '@/content/scenes';

export interface ExperimentDef {
  id: 'first-contact' | 'one-cell' | 'keep-alive';
  title: string;
  /** One or two sentences: what to do. */
  instructions: string;
  scene: SceneDef;
  /** Maximum number of cell edits allowed, or `null` for no limit. */
  editBudget: number | null;
  /** The generation success/failure is judged at. */
  targetGen: number;
}

/** True iff `editCount` edits fit within `budget` (always true for `budget === null`). */
export function withinEditBudget(editCount: number, budget: number | null): boolean {
  return budget === null || editCount <= budget;
}

/** Turn a stamped specimen into a recordable `EditOp` — the same transform math `LifeEngine.stamp` uses. */
export function toEditOp(pattern: StampPattern, x: number, y: number, transform: StampTransform): EditOp {
  const t = transformPattern(pattern, transform);
  const cells: EditOp['cells'] = [];
  for (let j = 0; j < t.h; j++) {
    for (let i = 0; i < t.w; i++) {
      cells.push({ x: x + i, y: y + j, alive: t.cells[j * t.w + i] === 1 });
    }
  }
  return { kind: 'set', cells };
}

/**
 * Deterministically simulate `world` seeded with `cells`, apply `edits` at
 * generation 0, run to `targetGen`, and read back `rect`. Impure (it steps a
 * fresh engine) but has no side effects outside its return value — the
 * harness the pure evaluators below are tested against.
 */
export function simulateSceneOutcome(
  cells: readonly CellCoord[],
  world: WorldSpec,
  edits: EditOp[],
  targetGen: number,
  rect: Rect,
): Uint8Array {
  const engine = createEngine({ width: world.width, height: world.height });
  for (const c of cells) engine.set(c.x, c.y, true);
  for (const op of edits) for (const e of op.cells) engine.set(e.x, e.y, e.alive);
  for (let g = 0; g < targetGen; g++) engine.step();
  return engine.region(rect);
}

/** A record of how a success happened, worth preserving so the player can inspect the replay. */
export interface ExperimentReplay {
  experimentId: ExperimentDef['id'];
  edits: EditOp[];
  achievedAtGen: number;
}

export function createReplay(experimentId: ExperimentDef['id'], edits: EditOp[], achievedAtGen: number): ExperimentReplay {
  return { experimentId, edits, achievedAtGen };
}

/** Build a fresh scene from whatever is alive right now — the "keep playing" / free-exploration route. */
export function toFreeExploration(exp: ExperimentDef, liveCells: readonly CellCoord[]): SceneDef {
  return {
    id: `${exp.id}-exploration`,
    title: `${exp.scene.title} — free exploration`,
    description: 'Continued from the experiment, now open-ended: no target, no budget, just the world.',
    world: exp.scene.world,
    cells: liveCells,
    population0: liveCells.length,
    defaultSpeed: exp.scene.defaultSpeed,
    cameras: exp.scene.cameras,
    beats: [],
  };
}

// ---------------------------------------------------------------------------
// First Contact
// ---------------------------------------------------------------------------

export const FIRST_CONTACT_EXPERIMENT: ExperimentDef = {
  id: 'first-contact',
  title: 'First Contact',
  instructions:
    'Watch the glider and the spaceship close the gap and touch, then change what happens when they meet.',
  scene: FIRST_CONTACT_SCENE,
  editBudget: null,
  targetGen: FIRST_CONTACT_VERIFIED.outcomeCompareGen,
};

export interface FirstContactVerdict {
  changedOutcome: boolean;
  note: string;
}

let _fcBaseline: Uint8Array | null = null;
/** The untouched timeline's outcome, memoised — simulated once, never re-derived by hand. */
export function firstContactBaselineOutcome(): Uint8Array {
  if (!_fcBaseline) {
    _fcBaseline = simulateSceneOutcome(
      FIRST_CONTACT_SCENE.cells,
      FIRST_CONTACT_SCENE.world,
      [],
      FIRST_CONTACT_VERIFIED.outcomeCompareGen,
      FIRST_CONTACT_VERIFIED.outcomeCompareRect,
    );
  }
  return _fcBaseline;
}

/**
 * Pure: compare a candidate's settled outcome (region bits, same rect/gen as
 * `firstContactBaselineOutcome`) against the baseline. Success is simply
 * "the player changed history" — any difference counts, matching the
 * experiment's framing (there is no single "correct" intervention).
 */
export function evaluateFirstContact(candidateOutcome: Uint8Array, baselineOutcome = firstContactBaselineOutcome()): FirstContactVerdict {
  if (candidateOutcome.length !== baselineOutcome.length) {
    throw new Error('evaluateFirstContact: outcome buffers must be the same shape (same rect).');
  }
  let same = true;
  for (let i = 0; i < candidateOutcome.length; i++) {
    if (candidateOutcome[i] !== baselineOutcome[i]) { same = false; break; }
  }
  return same
    ? { changedOutcome: false, note: 'The outcome is identical to the untouched timeline: the same traffic light.' }
    : { changedOutcome: true, note: 'The outcome differs from the untouched timeline — the intervention changed history.' };
}

// ---------------------------------------------------------------------------
// One Cell
// ---------------------------------------------------------------------------

export const ONE_CELL_EXPERIMENT: ExperimentDef = {
  id: 'one-cell',
  title: 'One Cell',
  instructions:
    'This world and its minimally changed sibling are running side by side — one flipped cell. Watch them come apart.',
  scene: ONE_CELL_SCENE,
  editBudget: null,
  targetGen: 200,
};

export interface OneCellComparison {
  divergentCells: number;
  baseAlive: number;
  flippedAlive: number;
  flippedExtinct: boolean;
}

/** Pure: compare two same-shaped region snapshots (base vs. flipped sibling) cell by cell. */
export function evaluateOneCell(baseRegion: Uint8Array, flippedRegion: Uint8Array): OneCellComparison {
  if (baseRegion.length !== flippedRegion.length) {
    throw new Error('evaluateOneCell: regions must be the same shape (same rect).');
  }
  let divergentCells = 0;
  let baseAlive = 0;
  let flippedAlive = 0;
  for (let i = 0; i < baseRegion.length; i++) {
    if (baseRegion[i]) baseAlive++;
    if (flippedRegion[i]) flippedAlive++;
    if (baseRegion[i] !== flippedRegion[i]) divergentCells++;
  }
  return { divergentCells, baseAlive, flippedAlive, flippedExtinct: flippedAlive === 0 };
}

// ---------------------------------------------------------------------------
// Keep Something Alive
// ---------------------------------------------------------------------------

export const KEEP_ALIVE_EXPERIMENT: ExperimentDef = {
  id: 'keep-alive',
  title: 'Keep Something Alive',
  instructions:
    `Using at most ${KEEP_ALIVE_VERIFIED.editBudget} edits, keep the rectangle from ever falling silent through generation ${KEEP_ALIVE_VERIFIED.targetGen}.`,
  scene: KEEP_ALIVE_SCENE,
  editBudget: KEEP_ALIVE_VERIFIED.editBudget,
  targetGen: KEEP_ALIVE_VERIFIED.targetGen,
};

/** Pure: number of cells that differ between two same-shaped region snapshots. */
export function countChanged(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length) throw new Error('countChanged: buffers must be the same shape.');
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
}

export interface ActivitySample {
  gen: number;
  activity: number;
}

/**
 * Pure: given one region snapshot per generation starting at gen 0
 * (`snapshots[g]` = the rect's bits at generation `g`), compute the activity
 * series — "cells that changed state over the last `windowSize`
 * generations" — for every generation from `windowSize` to the end.
 */
export function activitySeries(snapshots: readonly Uint8Array[], windowSize = KEEP_ALIVE_VERIFIED.activityWindow): ActivitySample[] {
  const out: ActivitySample[] = [];
  for (let gen = windowSize; gen < snapshots.length; gen++) {
    out.push({ gen, activity: countChanged(snapshots[gen]!, snapshots[gen - windowSize]!) });
  }
  return out;
}

export interface KeepAliveVerdict {
  success: boolean;
  /** First generation (a multiple of `windowSize`, up to `targetGen`) where activity was 0, or `null` if never. */
  failedAtGen: number | null;
  minActivity: number;
}

/**
 * Pure: success iff activity is > 0 at every `windowSize`-generation
 * checkpoint from `windowSize` through `targetGen` inclusive. `series` must
 * cover at least that range (see `activitySeries`/`runKeepAliveSeries`).
 */
export function evaluateKeepAlive(
  series: readonly ActivitySample[],
  targetGen = KEEP_ALIVE_VERIFIED.targetGen,
  windowSize = KEEP_ALIVE_VERIFIED.activityWindow,
): KeepAliveVerdict {
  const byGen = new Map(series.map((s) => [s.gen, s.activity]));
  let minActivity = Infinity;
  let failedAtGen: number | null = null;
  for (let gen = windowSize; gen <= targetGen; gen += windowSize) {
    const activity = byGen.get(gen);
    if (activity === undefined) continue;
    if (activity < minActivity) minActivity = activity;
    if (activity <= 0 && failedAtGen === null) failedAtGen = gen;
  }
  if (minActivity === Infinity) minActivity = 0;
  return { success: failedAtGen === null, failedAtGen, minActivity };
}

/**
 * Impure harness: simulate `world` seeded with `cells` plus `edits` at gen 0,
 * step to `toGen`, and return the activity series over `rect`. Used by tests
 * and by any caller that wants to judge a candidate solution end to end
 * without re-implementing the stepping loop.
 */
export function runKeepAliveSeries(
  cells: readonly CellCoord[],
  world: WorldSpec,
  edits: EditOp[],
  rect: Rect,
  toGen: number,
  windowSize = KEEP_ALIVE_VERIFIED.activityWindow,
): ActivitySample[] {
  const engine = createEngine({ width: world.width, height: world.height });
  for (const c of cells) engine.set(c.x, c.y, true);
  for (const op of edits) for (const e of op.cells) engine.set(e.x, e.y, e.alive);
  const snapshots: Uint8Array[] = [engine.region(rect)];
  for (let g = 1; g <= toGen; g++) {
    engine.step();
    snapshots.push(engine.region(rect));
  }
  return activitySeries(snapshots, windowSize);
}

export const EXPERIMENTS: readonly ExperimentDef[] = [FIRST_CONTACT_EXPERIMENT, ONE_CELL_EXPERIMENT, KEEP_ALIVE_EXPERIMENT];
