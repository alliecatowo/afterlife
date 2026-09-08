/**
 * Pure colour-genetics helpers for the "lineage" family of lenses. Owned by
 * the `core` agent (`src/core/**`).
 *
 * These functions are the ENTIRE rulebook for how colour rides along with
 * cells. None of them ever see population counts or feed anything back into
 * `engine.ts`'s B3/S23 step decision — they only decide what colour a cell
 * gets, strictly AFTER that decision has already been made elsewhere.
 *
 * Two independent colour systems, both maintained per-cell by `engine.ts`:
 *
 *  - `hue` (continuous, degrees 0..360): a newborn's hue is the CIRCULAR MEAN
 *    of its exactly-three parents' hues (birth only ever happens with exactly
 *    3 live neighbours in B3/S23, so "the three parents" is never ambiguous).
 *    Survivors keep their hue unchanged. This is the classic "heritage/lineage"
 *    coloring: families blend visibly where two populations' descendants meet.
 *    Used by the `lineage` lens.
 *
 *  - `species` (discrete, 1..4, 0 = none): a newborn takes the MAJORITY
 *    species among its three parents (guaranteed whenever two or more of the
 *    three agree); if all three parents are pairwise distinct, it takes the
 *    ONE species value in {1,2,3,4} that is NOT among them. This is the
 *    textbook Immigration (species restricted to {1,2} at authoring time) /
 *    QuadLife (all four in play) birth rule — see
 *    https://conwaylife.com/wiki/Immigration and
 *    https://conwaylife.com/wiki/QuadLife. Both lenses read the SAME species
 *    buffer; "Immigration" is presented as a coarser 2-bucket view
 *    ({1,2} -> colour A, {3,4} -> colour B) of the identical simulation
 *    QuadLife shows at full 4-colour resolution — the birth math is
 *    identical either way (see `quadSpeciesFromParents`'s doc), so there is
 *    no second code path to keep in sync or accidentally diverge from
 *    B3/S23.
 *
 * Both are cosmetic, exactly like `age`/`activity` in `engine.ts`: never
 * read by the B3/S23 step decision, reset on `restore()` to a deterministic
 * position-derived default, and made bit-exact across rewind/branching by
 * `history.ts`, which snapshots/restores them alongside (not instead of) the
 * bits keyframe. See `history.ts`'s module doc for why that's necessary
 * (unlike `age`, a colour value on a long-lived SURVIVOR is not
 * self-correcting from a flat post-restore default — it never gets
 * recomputed again until that cell dies and is reborn — so it must be
 * captured in the keyframe itself, not just replayed forward).
 */

import { hashSeed } from './rng';

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

/** Wrap any real degree value into [0, 360). */
export function normalizeHue(deg: number): number {
  const m = deg % 360;
  return m < 0 ? m + 360 : m;
}

/**
 * Circular mean of an arbitrary list of hues (degrees). Used by tests and by
 * anything blending more than 3 hues; the engine's hot birth path uses the
 * specialised 3-argument `circularMean3` below to avoid allocating an array
 * per birth.
 *
 * When the vectors exactly cancel (e.g. two hues 180 degrees apart with a
 * third splitting the difference) the mean angle is undefined; we fall back
 * to the first input rather than NaN, deterministically.
 */
export function circularMeanHue(huesDeg: readonly number[]): number {
  if (huesDeg.length === 0) return 0;
  let sx = 0;
  let sy = 0;
  for (const h of huesDeg) {
    const r = h * DEG2RAD;
    sx += Math.cos(r);
    sy += Math.sin(r);
  }
  if (Math.abs(sx) < 1e-9 && Math.abs(sy) < 1e-9) return normalizeHue(huesDeg[0]!);
  return normalizeHue(Math.atan2(sy, sx) * RAD2DEG);
}

/** Circular mean of exactly three hues — the engine's birth rule. No array allocation. */
export function circularMean3(a: number, b: number, c: number): number {
  const ra = a * DEG2RAD;
  const rb = b * DEG2RAD;
  const rc = c * DEG2RAD;
  const sx = Math.cos(ra) + Math.cos(rb) + Math.cos(rc);
  const sy = Math.sin(ra) + Math.sin(rb) + Math.sin(rc);
  if (Math.abs(sx) < 1e-9 && Math.abs(sy) < 1e-9) return normalizeHue(a);
  return normalizeHue(Math.atan2(sy, sx) * RAD2DEG);
}

/**
 * The classic Immigration/QuadLife birth rule for exactly three parent
 * species (each in 1..4): majority wins outright (guaranteed whenever at
 * least two of the three agree, since 3 parents can never be a 3-way tie
 * among only 2 present values); if all three are pairwise distinct, the
 * newborn takes the ONE value in {1,2,3,4} not present among them — always
 * unique, since exactly 3 of the 4 possible values are used.
 */
export function quadSpeciesFromParents(a: number, b: number, c: number): number {
  if (a === b || a === c) return a;
  if (b === c) return b;
  // All three pairwise distinct: find the missing one of {1,2,3,4}.
  for (let s = 1; s <= 4; s++) {
    if (s !== a && s !== b && s !== c) return s;
  }
  /* istanbul ignore next -- unreachable: 3 pairwise-distinct values drawn
     from {1,2,3,4} always leave exactly one value out. */
  return a;
}

const HUE_BLOCK = 24;
const SPECIES_BLOCK = 24;

/**
 * Deterministic, RNG-free starting hue for a freshly-seeded or restored
 * cell, coherent over `HUE_BLOCK`-sized regions so nearby cells in a fresh
 * soup start as visibly related "families" (per the design brief: "seed the
 * initial world with a spread of hues so distinct regions have distinct
 * lineages") rather than salt-and-pepper noise. Deliberately independent of
 * the seeding RNG stream — see `engine.ts`'s `seed()` — so inserting this
 * NEVER perturbs which cells end up alive, only what colour the alive ones
 * start with.
 */
export function regionHue(x: number, y: number): number {
  const bx = Math.floor(x / HUE_BLOCK);
  const by = Math.floor(y / HUE_BLOCK);
  return hashSeed(`hue:${bx}:${by}`) % 360;
}

/** Same idea as `regionHue`, for the discrete species buffer. */
export function regionSpecies(x: number, y: number): number {
  const bx = Math.floor(x / SPECIES_BLOCK);
  const by = Math.floor(y / SPECIES_BLOCK);
  return 1 + (hashSeed(`species:${bx}:${by}`) % 4);
}

/**
 * Deterministic starter hue for a cell brought alive by a direct edit/stamp
 * (no simulated parents to inherit from). Salted with the generation so
 * replaying the exact same `EditOp` at the exact same generation always
 * reproduces the exact same colour, keeping edits replay-safe.
 */
export function spontaneousHue(x: number, y: number, gen: number): number {
  return hashSeed(`edit-hue:${x}:${y}:${gen}`) % 360;
}

/** Same idea as `spontaneousHue`, for the discrete species buffer. */
export function spontaneousSpecies(x: number, y: number, gen: number): number {
  return 1 + (hashSeed(`edit-species:${x}:${y}:${gen}`) % 4);
}
