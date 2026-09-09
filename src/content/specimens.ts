/**
 * The specimen corpus — 24 curated patterns backing the drawer and the Field
 * Guide. Every period, translation vector and transient figure here was
 * confirmed by simulating the real pattern (see `/tmp/afterlife-scenes/
 * VERIFICATION.md` § 5, "Specimen drawer"). There is deliberately no puffer:
 * every candidate tried could not be verified, so none is included — do not
 * add one without the same rigor.
 *
 * Patterns are authored as RLE body strings (no header line — just the run-
 * length body up to `!`) and parsed with `fromRLE`, which
 * `tests/content-specimens.test.ts` cross-checks by simulation: every
 * claimed period/displacement must actually hold when the parsed pattern is
 * stepped on the real engine.
 */
import type { StampPattern } from '@/core/types';

export type SpecimenCategory = 'still' | 'oscillator' | 'spaceship' | 'emitter' | 'seed';

interface StillFact {
  kind: 'still';
}
interface OscillatorFact {
  kind: 'oscillator';
  period: number;
}
interface SpaceshipFact {
  kind: 'spaceship';
  period: number;
  /** Cells moved per `period` generations. */
  dx: number;
  dy: number;
}
interface EmitterFact {
  kind: 'emitter';
  /** Generations between successive gliders. */
  period: number;
  /** Population gained (a full glider) each period. */
  popGainPerPeriod: number;
}
interface SeedFact {
  kind: 'seed';
  /** All seed transients below were measured on an UNBOUNDED grid — stated
   *  explicitly because our 256x160 torus is small enough that a long-lived
   *  methuselah's debris can wrap around and re-interact with itself well
   *  before these generations, so the actual outcome here will differ. */
  gridCaveat: 'unbounded (sparse) grid';
  outcome: 'stabilizes' | 'dies';
  stabilizesAtGen?: number;
  populationAtStabilization?: number;
  peakPopulation?: number;
  peakGen?: number;
  dieGen?: number;
  peakPop?: number;
}
export type VerifiedFact = StillFact | OscillatorFact | SpaceshipFact | EmitterFact | SeedFact;

/** A tiny, self-contained live preview: fixed timestep, independent engine per instance. */
export interface LiveMiniatureSpec {
  width: number;
  height: number;
  /** Row-major, 1 = alive, pattern-local (0,0 = top-left of the bounding box). */
  cells: Uint8Array;
  /** Suggested step rate for the miniature, generations/second. */
  fps: number;
  /** Suggested margin of dead cells padded around the pattern so motion/growth stays visible. */
  padding: number;
}

export interface Specimen {
  id: string;
  name: string;
  category: SpecimenCategory;
  width: number;
  height: number;
  population: number;
  rle: string;
  /** Parsed once at module load from `rle`. Row-major, 1 = alive. */
  cells: Uint8Array;
  /** One or two sentences, natural-history-plate voice: precise, unfussy, no exclamation marks. */
  explanation: string;
  verified: VerifiedFact;
  liveMiniature: LiveMiniatureSpec;
}

/**
 * Parse a Life 1.06/RLE-style body string ("2o$2o!") into a row-major
 * `Uint8Array`. No header line is expected — `w`/`h` are supplied directly.
 * Standard semantics: a run-count prefixes `b` (dead), `o` (alive) or `$`
 * (end of line, count = blank lines to skip); `!` terminates.
 */
export function fromRLE(rle: string, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  let x = 0;
  let y = 0;
  let count = 0;
  for (const ch of rle) {
    if (ch >= '0' && ch <= '9') {
      count = count * 10 + Number(ch);
      continue;
    }
    const n = count || 1;
    if (ch === 'b') {
      x += n;
    } else if (ch === 'o') {
      for (let i = 0; i < n; i++) {
        if (x >= 0 && x < w && y >= 0 && y < h) out[y * w + x] = 1;
        x++;
      }
    } else if (ch === '$') {
      y += n;
      x = 0;
    } else if (ch === '!') {
      break;
    }
    count = 0;
  }
  return out;
}

/** Build a `StampPattern` (for `LifeEngine.stamp`) from a specimen. */
export function toStampPattern(s: Specimen): StampPattern {
  return { name: s.name, w: s.width, h: s.height, cells: s.cells };
}

interface RawSpecimen {
  name: string;
  category: SpecimenCategory;
  width: number;
  height: number;
  population: number;
  rle: string;
  explanation: string;
  verified: VerifiedFact;
}

const RAW: readonly RawSpecimen[] = [
  { name: 'block', category: 'still', width: 2, height: 2, population: 4, rle: '2o$2o!',
    explanation: 'Four cells in a square; the smallest and most common still life.',
    verified: { kind: 'still' } },
  { name: 'beehive', category: 'still', width: 4, height: 3, population: 6, rle: 'b2o$o2bo$b2o!',
    explanation: 'A six-cell hexagonal still life, the second most common ash object.',
    verified: { kind: 'still' } },
  { name: 'loaf', category: 'still', width: 4, height: 4, population: 7, rle: 'b2o$o2bo$bobo$2bo!',
    explanation: 'A seven-cell still life shaped like a beehive with a tail.',
    verified: { kind: 'still' } },
  { name: 'boat', category: 'still', width: 3, height: 3, population: 5, rle: '2o$obo$bo!',
    explanation: 'A five-cell still life; the only five-cell still life besides its reflections.',
    verified: { kind: 'still' } },
  { name: 'tub', category: 'still', width: 3, height: 3, population: 4, rle: 'bo$obo$bo!',
    explanation: 'Four cells in a diamond, the smallest still life with a hole.',
    verified: { kind: 'still' } },
  { name: 'ship', category: 'still', width: 3, height: 3, population: 6, rle: '2o$obo$b2o!',
    explanation: 'A six-cell still life; two boats fused along a diagonal.',
    verified: { kind: 'still' } },
  { name: 'pond', category: 'still', width: 4, height: 4, population: 8, rle: 'b2o$o2bo$o2bo$b2o!',
    explanation: 'An eight-cell still life with a 2x2 hole.',
    verified: { kind: 'still' } },
  { name: 'blinker', category: 'oscillator', width: 3, height: 1, population: 3, rle: '3o!',
    explanation: 'Three cells that flip between horizontal and vertical every generation.',
    verified: { kind: 'oscillator', period: 2 } },
  { name: 'toad', category: 'oscillator', width: 4, height: 2, population: 6, rle: 'b3o$3o!',
    explanation: 'Two offset rows of three that breathe in and out.',
    verified: { kind: 'oscillator', period: 2 } },
  { name: 'beacon', category: 'oscillator', width: 4, height: 4, population: 8, rle: '2o$2o$2b2o$2b2o!',
    explanation: 'Two diagonally touching blocks whose inner corners blink off and on.',
    verified: { kind: 'oscillator', period: 2 } },
  { name: 'clock', category: 'oscillator', width: 4, height: 4, population: 6, rle: '2bo$obo$bobo$bo!',
    explanation: 'A six-cell period-2 oscillator whose arms rotate a quarter turn.',
    verified: { kind: 'oscillator', period: 2 } },
  { name: 'pulsar', category: 'oscillator', width: 13, height: 13, population: 48,
    rle: '2b3o3b3o$$o4bobo4bo$o4bobo4bo$o4bobo4bo$2b3o3b3o$$2b3o3b3o$o4bobo4bo$o4bobo4bo$o4bobo4bo$$2b3o3b3o!',
    explanation: 'A large, highly symmetric period-3 oscillator; the most common of its period.',
    verified: { kind: 'oscillator', period: 3 } },
  { name: 'pentadecathlon', category: 'oscillator', width: 10, height: 3, population: 12,
    rle: '2bo4bo$2ob4ob2o$2bo4bo!',
    explanation: 'A period-15 oscillator that stretches and pinches along its long axis.',
    verified: { kind: 'oscillator', period: 15 } },
  { name: 'glider', category: 'spaceship', width: 3, height: 3, population: 5, rle: 'bo$2bo$3o!',
    explanation: 'The smallest spaceship: five cells that walk one square diagonally every four generations.',
    verified: { kind: 'spaceship', period: 4, dx: 1, dy: 1 } },
  { name: 'lwss', category: 'spaceship', width: 5, height: 4, population: 9, rle: 'bo2bo$o$o3bo$4o!',
    explanation: 'Lightweight spaceship: nine cells travelling two squares orthogonally every four generations.',
    verified: { kind: 'spaceship', period: 4, dx: -2, dy: 0 } },
  { name: 'mwss', category: 'spaceship', width: 6, height: 5, population: 11, rle: '3bo$bo3bo$o$o4bo$5o!',
    explanation: 'Middleweight spaceship: an LWSS with one extra bump, same speed.',
    verified: { kind: 'spaceship', period: 4, dx: -2, dy: 0 } },
  { name: 'hwss', category: 'spaceship', width: 7, height: 5, population: 13, rle: '3b2o$bo4bo$o$o5bo$6o!',
    explanation: 'Heavyweight spaceship: the largest of the three classic orthogonal ships.',
    verified: { kind: 'spaceship', period: 4, dx: -2, dy: 0 } },
  { name: 'gosper-glider-gun', category: 'emitter', width: 36, height: 9, population: 36,
    rle: '24bo$22bobo$12b2o6b2o12b2o$11bo3bo4b2o12b2o$2o8bo5bo3b2o$2o8bo3bob2o4bobo$10bo5bo7bo$11bo3bo$12b2o!',
    explanation: 'Two shuttles whose collision debris condenses into a new glider every 30 generations.',
    verified: { kind: 'emitter', period: 30, popGainPerPeriod: 5 } },
  { name: 'simkin-glider-gun', category: 'emitter', width: 33, height: 21, population: 36,
    rle: '2o5b2o$2o5b2o$$4b2o$4b2o$$$$$22b2ob2o$21bo5bo$21bo6bo2b2o$21b3o3bo3b2o$26bo$$$$20b2o$20bo$21b3o$23bo!',
    explanation: 'A gun built from four blocks and two shuttles that fires one glider every 120 generations.',
    verified: { kind: 'emitter', period: 120, popGainPerPeriod: 5 } },
  { name: 'r-pentomino', category: 'seed', width: 3, height: 3, population: 5, rle: 'b2o$2o$bo!',
    explanation: 'Five cells that churn for over a thousand generations before settling — on an '
      + 'unbounded grid. This world is a torus: here the debris wraps and re-enters, and it '
      + 'actually settles into a period-2 cycle at generation 2189, population 109.',
    verified: {
      kind: 'seed', gridCaveat: 'unbounded (sparse) grid', outcome: 'stabilizes',
      stabilizesAtGen: 1103, populationAtStabilization: 116, peakPopulation: 319, peakGen: 821,
    } },
  { name: 'acorn', category: 'seed', width: 7, height: 3, population: 7, rle: 'bo$3bo$2o2b3o!',
    explanation: 'Seven cells that take more than five thousand generations to settle — on an '
      + 'unbounded grid. This world is a torus, small enough that the sprawling debris will wrap '
      + 'and re-interact with itself well before then, so the actual course here differs.',
    verified: {
      kind: 'seed', gridCaveat: 'unbounded (sparse) grid', outcome: 'stabilizes',
      stabilizesAtGen: 5206, populationAtStabilization: 633, peakPopulation: 1057, peakGen: 4408,
    } },
  { name: 'diehard', category: 'seed', width: 8, height: 3, population: 7, rle: '6bo$2o$bo3b3o!',
    explanation: 'Seven cells that thrash for 130 generations and then vanish completely — on an '
      + 'unbounded grid. This world is a torus, so its wandering gliders can wrap and return '
      + 'before that; the outcome here is not verified to match.',
    verified: { kind: 'seed', gridCaveat: 'unbounded (sparse) grid', outcome: 'dies', dieGen: 130, peakPop: 40 } },
  { name: 'b-heptomino', category: 'seed', width: 4, height: 3, population: 7, rle: '3o$b3o$2bo!',
    explanation: 'A seven-cell methuselah that settles quickly compared to its cousins — figures '
      + 'measured on an unbounded grid. This world is a torus, so behaviour here may differ.',
    verified: {
      kind: 'seed', gridCaveat: 'unbounded (sparse) grid', outcome: 'stabilizes',
      stabilizesAtGen: 148, populationAtStabilization: 28, peakPopulation: 123, peakGen: 121,
    } },
  { name: 'pi-heptomino', category: 'seed', width: 3, height: 3, population: 7, rle: '3o$obo$obo!',
    explanation: 'A seven-cell methuselah with a longer, showier burn than the b-heptomino — '
      + 'figures measured on an unbounded grid. This world is a torus, so behaviour here may '
      + 'differ.',
    verified: {
      kind: 'seed', gridCaveat: 'unbounded (sparse) grid', outcome: 'stabilizes',
      stabilizesAtGen: 173, populationAtStabilization: 55, peakPopulation: 201, peakGen: 115,
    } },
];

function buildLiveMiniature(width: number, height: number, cells: Uint8Array, category: SpecimenCategory): LiveMiniatureSpec {
  // Guns and long-burning seeds want more headroom to show their behaviour;
  // everything else gets a modest halo so oscillation/motion stays framed.
  const padding = category === 'emitter' ? 24 : category === 'seed' ? 16 : 6;
  const fps = category === 'seed' ? 24 : category === 'emitter' ? 16 : 8;
  return { width, height, cells, fps, padding };
}

export const SPECIMENS: readonly Specimen[] = RAW.map((r) => {
  const cells = fromRLE(r.rle, r.width, r.height);
  return {
    id: r.name,
    name: r.name,
    category: r.category,
    width: r.width,
    height: r.height,
    population: r.population,
    rle: r.rle,
    cells,
    explanation: r.explanation,
    verified: r.verified,
    liveMiniature: buildLiveMiniature(r.width, r.height, cells, r.category),
  };
});

const BY_ID = new Map(SPECIMENS.map((s) => [s.id, s]));

export function getSpecimen(id: string): Specimen | undefined {
  return BY_ID.get(id);
}
