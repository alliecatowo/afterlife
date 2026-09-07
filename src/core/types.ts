/**
 * AFTERLIFE — shared vocabulary.
 *
 * FROZEN FILE. Owned by the architect. Do not edit; propose changes in
 * INTEGRATION-NOTES.md (append-only).
 *
 * Conventions used everywhere in this codebase:
 *  - Coordinates are integer **world cell** coordinates unless a name says `screen*`.
 *  - The world is a torus: every (x, y) is valid; implementations wrap with a
 *    floor-mod into [0, width) x [0, height).
 *  - Bit buffers (`Snapshot.bits`, `region()`, `StampPattern.cells`, diff cells)
 *    are ROW-MAJOR `Uint8Array`, one byte per cell, `1 = alive`, `0 = dead`.
 *    Index of (x, y) within a w-wide buffer is `y * w + x`.
 */

/** Integer generation index, >= 0. Generation 0 is the seeded initial state. */
export type Generation = number;

/** Integer world-cell coordinate pair. */
export type CellCoord = { x: number; y: number };

/** Axis-aligned rectangle in world cells. `w`/`h` are > 0 and integral. */
export type Rect = { x: number; y: number; w: number; h: number };

/** Opaque identifier for a timeline branch. The root branch id is `'root'`. */
export type BranchId = string;

/** Immutable description of a universe's shape. */
export interface WorldSpec {
  width: number;
  height: number;
  /** Only toroidal wrap is supported in v1. See ARCHITECTURE.md § Boundary model. */
  boundary: 'torus';
}

/** A full world state at a generation. `bits.length === width * height`. */
export interface Snapshot {
  gen: Generation;
  bits: Uint8Array;
}

/** A user (or agent) authored mutation. Currently only absolute cell sets. */
export interface EditOp {
  kind: 'set';
  cells: Array<{ x: number; y: number; alive: boolean }>;
}

/**
 * Edits recorded against a generation. Edits are applied AT THE START of `gen`,
 * i.e. before the B3/S23 step that produces `gen + 1`. See ARCHITECTURE.md
 * § Atomic edit commit.
 */
export interface HistoryEntry {
  gen: Generation;
  edits: EditOp[];
}

/** A stampable pattern (glider, pulsar, …). `cells` is row-major, 1 = alive. */
export interface StampPattern {
  name: string;
  w: number;
  h: number;
  cells: Uint8Array;
}

/** Rotation/mirror applied when stamping or ghost-previewing a pattern. */
export interface StampTransform {
  /** Quarter-turns clockwise. 0 | 1 | 2 | 3. */
  rotate: 0 | 1 | 2 | 3;
  /** Mirror across the vertical axis, applied BEFORE rotation. */
  flipX: boolean;
  /** Mirror across the horizontal axis, applied BEFORE rotation. */
  flipY: boolean;
}

/** Identity transform constant for convenience. */
export const IDENTITY_TRANSFORM: StampTransform = { rotate: 0, flipX: false, flipY: false };

/**
 * How the renderer colours cells.
 *  - 'life'     — binary alive/dead, `--accent-life`.
 *  - 'age'      — generations since the cell was born, `--accent-age` ramp.
 *  - 'activity' — recent-change heat, decaying 0..1, `--accent-activity` ramp.
 */
export type RenderLens = 'life' | 'age' | 'activity';

/** Playback transport state owned by the UI module and mirrored in AppState. */
export interface PlaybackState {
  playing: boolean;
  /** Target generations per second, > 0. UI presets: 1, 4, 12, 30, 60. */
  speed: number;
  /** True while a `TimelineStore.goto()` scrub is in flight. */
  scrubbing: boolean;
}

/** Current selection / marquee state. */
export interface SelectionState {
  rect: Rect | null;
  /** True while the user is actively dragging out `rect`. */
  dragging: boolean;
}

/** Anything with teardown. Event-bus subscriptions return one of these. */
export interface Disposable {
  dispose(): void;
}

/** A named branch of history diverging from `fromGen` of `parent`. */
export interface BranchMeta {
  id: BranchId;
  name: string;
  parent: BranchId | null;
  /** Generation of `parent` this branch forked from. `0` for the root branch. */
  fromGen: Generation;
  createdAt: number;
}

/** Result of comparing two branches over a rect at a generation. */
export interface DiffResult {
  /** Number of differing cells. */
  count: number;
  /**
   * Row-major over the queried rect. 0 = same, 1 = alive only in A,
   * 2 = alive only in B.
   */
  cells: Uint8Array;
}

/** Overlays the renderer draws on top of the world layer. */
export interface RenderOverlays {
  selection?: Rect | null;
  ghost?: { pattern: StampPattern; x: number; y: number; transform: StampTransform } | null;
  diff?: { rect: Rect; cells: Uint8Array } | null;
  /** Draw the world grid lines when the zoom level allows. */
  grid?: boolean;
}

/** A noteworthy thing the simulation did — fed to audio, toasts and the codex. */
export interface DiscoveryEvent {
  id: string;
  kind: 'still-life' | 'oscillator' | 'spaceship' | 'extinction' | 'explosion' | 'stability';
  gen: Generation;
  rect: Rect;
  label: string;
  /** Period in generations for oscillators/spaceships. */
  period?: number;
}
