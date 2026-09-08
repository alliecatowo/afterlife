/**
 * Glyph vocabulary for Art mode's ASCII/character rendering — which
 * characters exist, and the pure maths for picking one from real simulation
 * state. Owned by the `render` agent (`src/render/**`).
 *
 * ASCII is the headline glyph set: a proper density ramp (`' .:-=+*#%@'`)
 * that reads as genuine text-art, not a novelty. The other built-in sets
 * (blocks, box-drawing, dots/braille, geometric) share the exact same
 * selection maths — only the character list differs — plus a user-editable
 * `custom` set.
 *
 * "Which glyph a cell gets" is always driven by a real per-cell number
 * (age, activity, live-neighbour count, lineage hue, local density, or the
 * modulation field) via the small pure normalisers below, never by anything
 * invented — this is what makes it "changing what cell is what" rather than
 * a fixed lookup table. Everything here is a pure function of plain numbers,
 * independent of `LifeEngine`/canvas/DOM, so it's directly unit-testable.
 */

export type GlyphSetId = 'ascii' | 'blocks' | 'box' | 'dots' | 'geometric' | 'custom';

export const GLYPH_SET_LABELS: Record<GlyphSetId, string> = {
  ascii: 'Classic ASCII',
  blocks: 'Block elements',
  box: 'Box drawing',
  dots: 'Dots / braille',
  geometric: 'Geometric',
  custom: 'Custom',
};

/**
 * Built-in glyph ramps, LOW to HIGH intensity. `ascii` is the canonical
 * density ramp — the exact `' .:-=+*#%@'` progression from the brief, ten
 * steps from "almost nothing" to "solid ink", which is what makes classic
 * ASCII art read as tonal rather than a fixed dot pattern.
 */
export const GLYPH_SETS: Record<Exclude<GlyphSetId, 'custom'>, readonly string[]> = {
  ascii: [' ', '.', ':', '-', '=', '+', '*', '#', '%', '@'],
  blocks: [' ', '░', '▒', '▓', '█'],
  box: [' ', '·', '─', '┼', '╋', '█'],
  dots: [' ', '⠁', '⠃', '⠇', '⠏', '⠟', '⠿', '⣿'],
  geometric: [' ', '·', '▵', '◇', '◆', '■'],
};

/** Sensible default custom ramp shown the first time a user opens the
 *  custom-glyph editor — deliberately still a density ramp, so switching to
 *  "custom" and changing nothing looks identical to `ascii`. */
export const DEFAULT_CUSTOM_GLYPHS = ' .:-=+*#%@';

export const MIN_CUSTOM_GLYPHS = 2;
export const MAX_CUSTOM_GLYPHS = 16;

/** Resolve a glyph set id (+ the live custom string) to the actual ordered
 *  character list to render with. A `custom` string shorter than
 *  `MIN_CUSTOM_GLYPHS` or empty falls back to `ascii` rather than crashing
 *  glyph-index maths on a zero-length array. */
export function resolveGlyphChars(setId: GlyphSetId, customChars: string): readonly string[] {
  if (setId === 'custom') {
    const chars = Array.from(customChars).slice(0, MAX_CUSTOM_GLYPHS);
    return chars.length >= MIN_CUSTOM_GLYPHS ? chars : GLYPH_SETS.ascii;
  }
  return GLYPH_SETS[setId];
}

export type GlyphDriver = 'age' | 'activity' | 'neighbors' | 'lineage' | 'density' | 'field';

export const GLYPH_DRIVERS: readonly GlyphDriver[] = ['age', 'activity', 'neighbors', 'lineage', 'density', 'field'];

export const GLYPH_DRIVER_LABELS: Record<GlyphDriver, string> = {
  age: 'Age',
  activity: 'Activity',
  neighbors: 'Live neighbours',
  lineage: 'Lineage hue',
  density: 'Local density',
  field: 'Modulation field',
};

/** Clamp `t` into `[0, 1]`. */
function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** Map a normalised `t` in `[0, 1]` to an index into a glyph list of length
 *  `count` — the one piece of maths every driver funnels through, so
 *  "denser/older/busier reads differently" is consistent across all six
 *  drivers and every built-in/custom set. `count <= 0` returns 0. */
export function glyphIndexForValue(t: number, count: number): number {
  if (count <= 0) return 0;
  const c = clamp01(t);
  return Math.min(count - 1, Math.floor(c * count));
}

/** Full pipeline: normalised value -> the actual character. */
export function selectGlyph(chars: readonly string[], t: number): string {
  if (chars.length === 0) return ' ';
  return chars[glyphIndexForValue(t, chars.length)]!;
}

// ---- Per-driver normalisers: raw simulation numbers -> [0, 1] -------------
// Each takes only plain numbers (never the engine itself), so these are
// testable without any `LifeEngine`/canvas fixture at all.

/** `age` in generations since birth -> [0, 1], saturating at `maxAge`. */
export function normalizeAge(age: number, maxAge = 32): number {
  if (maxAge <= 0) return 0;
  return clamp01(age / maxAge);
}

/** Activity heat is already a decaying [0, 1] value in the engine; this just
 *  guards against out-of-range input from a future engine change. */
export function normalizeActivity(heat: number): number {
  return clamp01(heat);
}

/** Live-neighbour count (0..8) -> [0, 1]. */
export function normalizeNeighbors(count: number): number {
  return clamp01(count / 8);
}

/** Lineage hue in degrees [0, 360) -> [0, 1]. */
export function normalizeLineage(hueDeg: number): number {
  const h = ((hueDeg % 360) + 360) % 360;
  return h / 360;
}

/** Local live-cell density (already a [0, 1] fraction over some sampled
 *  neighbourhood) — pass-through with clamping, kept for symmetry/safety. */
export function normalizeDensity(fraction: number): number {
  return clamp01(fraction);
}

/** The modulation field already samples to [0, 1]; pass-through, kept for
 *  API symmetry with the other five normalisers. */
export function normalizeField(value: number): number {
  return clamp01(value);
}
