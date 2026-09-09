/**
 * Curated scenes — the opening tableau and the seed states for the three
 * authored experiments (`@/content/experiments`).
 *
 * All cell coordinates and generation numbers here were produced by running
 * the REAL B3/S23 engine on a 256x160 torus (see `/tmp/afterlife-scenes/` in
 * the scene-lab agent's workspace, `VERIFICATION.md`). They are reproduced
 * here exactly, not re-derived — `tests/content-*.test.ts` re-simulates each
 * scene with `@/core/engine` and checks the engine agrees with these figures.
 * If a test disagrees, the bug is almost certainly in the engine, not here.
 */
import type { CellCoord, Rect, WorldSpec } from '@/core/types';

/** Every scene in AFTERLIFE runs on the same world shape. */
export const WORLD: WorldSpec = { width: 256, height: 160, boundary: 'torus' };

/** A camera framing: `centerX`/`centerY` in world cells, `pxPerCell` zoom for a 1440x900 viewport. */
export interface CameraSpec {
  centerX: number;
  centerY: number;
  pxPerCell: number;
  /** One line of editorial framing context, e.g. what this camera is showing and why. */
  note: string;
}

/**
 * A subtle scripted moment. Beats are quiet by design and NEVER move the
 * camera during ordinary play — see `@/ui/session.ts`'s `checkBeats` doc:
 * a real user report was that auto-panning the camera around during normal
 * (non-cinematic) use hijacks a view the user was actively looking at.
 * `camera-ease` (the name is historical) surfaces only an anticipatory
 * toast; `annotate` shows a small world-anchored label. Never a modal,
 * never a cutscene — see ARCHITECTURE.md's "world dominates" rule.
 */
export type SceneBeat =
  | { kind: 'camera-ease'; atGen: number; toward: Rect; label: string }
  | { kind: 'annotate'; atGen: number; at: CellCoord; label: string };

export interface SceneDef {
  id: string;
  title: string;
  /** One or two sentences, natural-history-plate voice. */
  description: string;
  world: WorldSpec;
  /** Absolute world-cell coordinates of every live cell at generation 0. */
  cells: readonly CellCoord[];
  population0: number;
  /** Generations per second. Matches the UI's speed presets (1, 4, 12, 30, 60). */
  defaultSpeed: number;
  cameras: {
    /** Wide framing for generation 0. */
    establishing: CameraSpec;
    /** Tight framing for the scene's focal moment. */
    focus: CameraSpec;
  };
  beats: readonly SceneBeat[];
}

// ---------------------------------------------------------------------------
// Opening
// ---------------------------------------------------------------------------

const OPENING_CELLS: ReadonlyArray<[number, number]> = [
  [28,4],[26,5],[28,5],[16,6],[17,6],[24,6],[25,6],[38,6],[39,6],[15,7],
  [19,7],[24,7],[25,7],[38,7],[39,7],[4,8],[5,8],[14,8],[20,8],[24,8],
  [25,8],[4,9],[5,9],[14,9],[18,9],[20,9],[21,9],[26,9],[28,9],[14,10],
  [20,10],[28,10],[172,10],[173,10],[174,10],[178,10],[179,10],[180,10],[210,10],[211,10],
  [219,10],[220,10],[229,10],[230,10],[238,10],[239,10],[247,10],[15,11],[19,11],[210,11],
  [211,11],[218,11],[221,11],[228,11],[231,11],[238,11],[240,11],[246,11],[248,11],[16,12],
  [17,12],[170,12],[175,12],[177,12],[182,12],[219,12],[220,12],[229,12],[231,12],[239,12],
  [247,12],[170,13],[175,13],[177,13],[182,13],[230,13],[170,14],[175,14],[177,14],[182,14],
  [172,15],[173,15],[174,15],[178,15],[179,15],[180,15],[172,17],[173,17],[174,17],[178,17],
  [179,17],[180,17],[170,18],[175,18],[177,18],[182,18],[211,18],[212,18],[220,18],[221,18],
  [229,18],[230,18],[231,18],[238,18],[239,18],[170,19],[175,19],[177,19],[182,19],[210,19],
  [213,19],[220,19],[222,19],[228,19],[229,19],[230,19],[238,19],[239,19],[170,20],[175,20],
  [177,20],[182,20],[210,20],[213,20],[221,20],[222,20],[240,20],[241,20],[211,21],[212,21],
  [240,21],[241,21],[172,22],[173,22],[174,22],[178,22],[179,22],[180,22],[210,26],[211,26],
  [212,26],[220,26],[228,26],[229,26],[237,26],[245,26],[246,26],[218,27],[220,27],[228,27],
  [229,27],[236,27],[238,27],[244,27],[247,27],[219,28],[221,28],[236,28],[239,28],[245,28],
  [246,28],[219,29],[237,29],[238,29],[194,34],[199,34],[211,34],[212,34],[219,34],[224,34],
  [230,34],[231,34],[238,34],[239,34],[248,34],[192,35],[193,35],[195,35],[196,35],[197,35],
  [198,35],[200,35],[201,35],[210,35],[212,35],[218,35],[220,35],[224,35],[230,35],[231,35],
  [238,35],[239,35],[248,35],[249,35],[194,36],[199,36],[211,36],[219,36],[224,36],[240,36],
  [241,36],[248,36],[249,36],[240,37],[241,37],[249,37],[211,42],[212,42],[219,42],[220,42],
  [229,42],[230,42],[237,42],[238,42],[244,42],[245,42],[246,42],[250,42],[251,42],[210,43],
  [213,43],[218,43],[221,43],[228,43],[231,43],[236,43],[238,43],[250,43],[251,43],[211,44],
  [213,44],[218,44],[221,44],[229,44],[230,44],[236,44],[237,44],[212,45],[219,45],[220,45],
  [154,60],[153,61],[153,62],[154,62],[155,62],[91,64],[92,65],[90,66],[91,66],[92,66],
];

export const OPENING_SCENE: SceneDef = {
  id: 'opening',
  title: 'Opening',
  description:
    'A distant machine in the top-left corner fires a steady procession of gliders. A dense garden ' +
    'of still lifes and oscillators pulses in the top-right. Two travellers cross the empty southern ' +
    'expanse and meet.',
  world: WORLD,
  cells: OPENING_CELLS.map(([x, y]) => ({ x, y })),
  population0: 250,
  defaultSpeed: 12,
  cameras: {
    establishing: {
      centerX: 128,
      centerY: 80,
      pxPerCell: 5.6,
      note: 'Generation 0: the whole 256x160 world fits the frame.',
    },
    focus: {
      centerX: 123,
      centerY: 103,
      pxPerCell: 26,
      note: 'Frames the encounter bounding box with generous margin.',
    },
  },
  beats: [
    {
      kind: 'camera-ease',
      atGen: 108,
      toward: { x: 107, y: 91, w: 32, h: 24 },
      label: 'Something is about to meet in the empty south.',
    },
    {
      kind: 'annotate',
      atGen: 123,
      at: { x: 123, y: 94 },
      label: 'First contact.',
    },
  ],
};

/** Verified reference facts for `OPENING_SCENE`, used by tests. Not part of `SceneDef`. */
export const OPENING_VERIFIED = {
  encounterGen: 123,
  firstInteractingCell: { x: 123, y: 94 } satisfies CellCoord,
  encounterBbox: { x: 107, y: 91, w: 139 - 107 + 1, h: 115 - 91 + 1 } satisfies Rect,
  /** No live cell may enter the 2-cell border band at any generation 0..300. */
  noBorderTouchThroughGen: 300,
  borderMargin: 2,
} as const;

// ---------------------------------------------------------------------------
// One Cell
// ---------------------------------------------------------------------------

const ONE_CELL_BASE_CELLS: ReadonlyArray<[number, number]> = [
  [122,73],[123,74],[121,75],[122,75],[123,75], // glider
  [131,88],[129,89],[131,89],[130,90],[132,90],[130,91], // clock
];

export const ONE_CELL_SCENE: SceneDef = {
  id: 'one-cell',
  title: 'One Cell',
  description:
    'A glider is already in flight toward a clock oscillator. Adding a single cell to the edge of the ' +
    'clock decides whether the meeting produces a growing debris field or wipes the world clean.',
  world: WORLD,
  cells: ONE_CELL_BASE_CELLS.map(([x, y]) => ({ x, y })),
  population0: ONE_CELL_BASE_CELLS.length,
  defaultSpeed: 12,
  cameras: {
    establishing: {
      centerX: 127,
      centerY: 84,
      pxPerCell: 12,
      note: 'Both the glider and the clock, with room to watch them close the gap.',
    },
    focus: {
      centerX: 127,
      centerY: 84,
      pxPerCell: 40,
      note: 'Generation 43: the moment the two futures visibly part.',
    },
  },
  beats: [
    { kind: 'annotate', atGen: 43, at: { x: 128, y: 89 }, label: 'The futures diverge here.' },
  ],
};

export const ONE_CELL_VERIFIED = {
  /** The single edit that separates the two futures. */
  flip: { x: 128, y: 89, from: false, to: true },
  measurementRect: { x: 64, y: 16, w: 191 - 64 + 1, h: 143 - 16 + 1 } satisfies Rect,
  firstVisibleDivergenceGen: 43,
  /** Divergent-cell count inside the measurement rect at gen 0,10,20,...200. */
  divergenceCurve: {
    gens: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200],
    divergentCells: [1, 6, 6, 6, 6, 17, 11, 25, 29, 36, 48, 72, 52, 75, 97, 121, 139, 152, 163, 176, 221],
  },
  gen200: { basePop: 221, flippedPop: 0, basePopInRect: 221, flippedPopInRect: 0 },
  flippedExtinctFromGen: 54,
} as const;

// ---------------------------------------------------------------------------
// First Contact
// ---------------------------------------------------------------------------

const FIRST_CONTACT_CELLS: ReadonlyArray<[number, number]> = [
  [98,49],[99,50],[97,51],[98,51],[99,51], // glider
  [187,76],[188,76],[189,76],[190,76],[187,77],[191,77],[187,78],[188,79],[191,79], // lwss
];

export const FIRST_CONTACT_SCENE: SceneDef = {
  id: 'first-contact',
  title: 'First Contact',
  description:
    'A glider drifting south-east and a lightweight spaceship running due west approach across 90 ' +
    'cells of empty space, visibly separated for 115 generations, and meet.',
  world: WORLD,
  cells: FIRST_CONTACT_CELLS.map(([x, y]) => ({ x, y })),
  population0: FIRST_CONTACT_CELLS.length,
  defaultSpeed: 12,
  cameras: {
    establishing: {
      centerX: 144,
      centerY: 73,
      pxPerCell: 12,
      note: 'Both travellers and the whole approach corridor, gen 0.',
    },
    focus: {
      centerX: 129,
      centerY: 83,
      pxPerCell: 30,
      note: 'Frames the collision bounding box.',
    },
  },
  beats: [
    {
      kind: 'camera-ease',
      atGen: 100,
      toward: { x: 122, y: 74, w: 15, h: 19 },
      label: 'The gap is closing.',
    },
    { kind: 'annotate', atGen: 116, at: { x: 129, y: 83 }, label: 'Contact.' },
  ],
};

export const FIRST_CONTACT_VERIFIED = {
  collisionGen: 116,
  collisionBbox: { x: 122, y: 74, w: 136 - 122 + 1, h: 92 - 74 + 1 } satisfies Rect,
  outcomeAtGen400: {
    description: 'a traffic light: four blinkers',
    population: 12,
    bbox: { x: 118, y: 85, w: 9, h: 9 } satisfies Rect,
  },
  /** Destroys the LWSS before it can reach the glider. */
  intervention: { x: 188, y: 74, from: false, to: true },
  interventionOutcomeAtGen400: { population: 5, description: 'the lone glider, still travelling' },
  /** A generous, fixed rect around the collision site used to compare settled outcomes. */
  outcomeCompareRect: { x: 100, y: 65, w: 60, h: 50 } satisfies Rect,
  outcomeCompareGen: 400,
} as const;

// ---------------------------------------------------------------------------
// Keep Something Alive
// ---------------------------------------------------------------------------

const KEEP_ALIVE_BASE_CELLS: ReadonlyArray<[number, number]> = [
  [130,61],[128,62],[129,62],[130,62],[97,68],[98,68],[99,68],[100,68],[102,68],[103,68],
  [95,69],[97,69],[100,69],[102,69],[106,69],[94,70],[95,70],[98,70],[99,70],[102,70],
  [103,70],[94,71],[97,71],[98,71],[99,71],[100,71],[101,71],[102,71],[103,71],[105,71],
  [95,72],[96,72],[97,72],[100,72],[102,72],[104,72],[106,72],[94,73],[95,73],[96,73],
  [97,73],[101,73],[102,73],[106,73],[96,74],[97,74],[99,74],[101,74],[102,74],[103,74],
  [106,74],[97,75],[98,75],[99,75],[100,75],[101,75],[94,76],[97,76],[98,76],[99,76],
  [100,76],[102,76],[103,76],[96,96],[98,96],
];

export const KEEP_ALIVE_SCENE: SceneDef = {
  id: 'keep-alive',
  title: 'Keep Something Alive',
  description:
    'A burnt-out patch of soup: 65 cells that quiet into stillness within a hundred generations. ' +
    'Three edits, one target generation — find a change that keeps the rectangle from ever falling silent.',
  world: WORLD,
  cells: KEEP_ALIVE_BASE_CELLS.map(([x, y]) => ({ x, y })),
  population0: KEEP_ALIVE_BASE_CELLS.length,
  defaultSpeed: 12,
  cameras: {
    establishing: {
      centerX: 99,
      centerY: 80,
      pxPerCell: 16,
      note: 'The whole measurement rect, gen 0.',
    },
    focus: {
      centerX: 99,
      centerY: 80,
      pxPerCell: 16,
      note: 'Same framing throughout — the point is to watch this one rectangle.',
    },
  },
  beats: [
    { kind: 'annotate', atGen: 85, at: { x: 100, y: 80 }, label: 'This is where the baseline falls silent.' },
  ],
};

export const KEEP_ALIVE_VERIFIED = {
  targetGen: 150,
  editBudget: 3,
  measurementRect: { x: 84, y: 56, w: 171 - 84 + 1, h: 103 - 56 + 1 } satisfies Rect,
  activityWindow: 8,
  /** Raw fact: the last generation any cell inside the rect changes state, untouched. */
  baselineDeathGen: 85,
  /** Activity ("cells changed over the last 8 generations") at gens 8,16,...,152. Untouched world. */
  baselineActivityCurve: {
    gens: [8, 16, 24, 32, 40, 48, 56, 64, 72, 80, 88, 96, 104, 112, 120, 128, 136, 144, 152],
    activity: [103, 102, 92, 106, 134, 142, 186, 166, 90, 34, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  /** Same curve, with the verified solution applied at generation 0. */
  solutionActivityCurve: {
    gens: [8, 16, 24, 32, 40, 48, 56, 64, 72, 80, 88, 96, 104, 112, 120, 128, 136, 144, 152],
    activity: [111, 117, 107, 121, 149, 157, 201, 181, 105, 49, 15, 15, 15, 15, 15, 15, 15, 15, 15],
  },
  /** The minimal verified fix: completes a headless glider. */
  solution: { edits: [{ x: 129, y: 60, from: false, to: true }], name: 'complete-the-glider' },
  solutionMinActivity: 15,
} as const;

// ---------------------------------------------------------------------------

/** All four curated scenes, in presentation order. */
export const SCENES: readonly SceneDef[] = [OPENING_SCENE, ONE_CELL_SCENE, FIRST_CONTACT_SCENE, KEEP_ALIVE_SCENE];

export function getScene(id: string): SceneDef | undefined {
  return SCENES.find((s) => s.id === id);
}
