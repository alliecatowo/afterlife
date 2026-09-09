/**
 * Median-cut colour quantiser — reduces an RGBA image (or a sampled set of
 * pixels drawn from several frames) down to at most `maxColors` (<=256, a
 * hard GIF format limit) representative colours. Pure, hand-written per this
 * project's "zero new dependencies" rule — no `canvas`-native quantiser
 * exists, so this is the one place a GIF pipeline genuinely needs bespoke
 * code, not a shortcut.
 *
 * Algorithm: start with one "box" containing every distinct colour (weighted
 * by how many pixels have it); repeatedly split the box with the largest
 * (population-weighted) axis range along its longest channel, at the
 * weighted median, until there are `maxColors` boxes or no box can be split
 * further. Each final box's palette entry is its population-weighted average
 * colour — the standard median-cut construction (Heckbert 1982).
 */

export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

interface ColorEntry extends RgbColor {
  count: number;
}

interface Box {
  entries: ColorEntry[];
  totalCount: number;
}

function boxRangeChannel(box: Box): { channel: 'r' | 'g' | 'b'; range: number } {
  let minR = 255, maxR = 0, minG = 255, maxG = 0, minB = 255, maxB = 0;
  for (const e of box.entries) {
    if (e.r < minR) minR = e.r;
    if (e.r > maxR) maxR = e.r;
    if (e.g < minG) minG = e.g;
    if (e.g > maxG) maxG = e.g;
    if (e.b < minB) minB = e.b;
    if (e.b > maxB) maxB = e.b;
  }
  const rangeR = maxR - minR;
  const rangeG = maxG - minG;
  const rangeB = maxB - minB;
  if (rangeR >= rangeG && rangeR >= rangeB) return { channel: 'r', range: rangeR };
  if (rangeG >= rangeB) return { channel: 'g', range: rangeG };
  return { channel: 'b', range: rangeB };
}

/** Split `box` at its weighted median along its longest channel. Returns
 *  `null` if the box holds only one distinct colour (can't be split further). */
function splitBox(box: Box): [Box, Box] | null {
  if (box.entries.length <= 1) return null;
  const { channel } = boxRangeChannel(box);
  const sorted = [...box.entries].sort((a, b) => a[channel] - b[channel]);
  const half = box.totalCount / 2;
  let running = 0;
  let splitAt = 1;
  for (let i = 0; i < sorted.length; i++) {
    running += sorted[i]!.count;
    if (running >= half) {
      splitAt = i + 1;
      break;
    }
  }
  // Guard against a degenerate split (all weight in one entry) producing an
  // empty half — always leave at least one entry on each side.
  splitAt = Math.max(1, Math.min(sorted.length - 1, splitAt));
  const left = sorted.slice(0, splitAt);
  const right = sorted.slice(splitAt);
  const leftCount = left.reduce((s, e) => s + e.count, 0);
  const rightCount = right.reduce((s, e) => s + e.count, 0);
  return [{ entries: left, totalCount: leftCount }, { entries: right, totalCount: rightCount }];
}

function averageColor(box: Box): RgbColor {
  let r = 0, g = 0, b = 0;
  for (const e of box.entries) {
    r += e.r * e.count;
    g += e.g * e.count;
    b += e.b * e.count;
  }
  const n = box.totalCount || 1;
  return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) };
}

/**
 * Build a palette of at most `maxColors` colours from RGBA pixel data.
 * `pixels` is a flat RGBA buffer (4 bytes/pixel, alpha ignored — every
 * canvas this pipeline reads from is fully opaque). Fully alpha-transparent
 * pixels, if any, are skipped so they don't skew the palette toward black.
 */
export function medianCutQuantize(pixels: Uint8ClampedArray | Uint8Array, maxColors: number): RgbColor[] {
  const cap = Math.max(1, Math.min(256, Math.floor(maxColors)));
  const counts = new Map<number, number>();
  for (let i = 0; i < pixels.length; i += 4) {
    const a = pixels[i + 3]!;
    if (a === 0) continue;
    const key = (pixels[i]! << 16) | (pixels[i + 1]! << 8) | pixels[i + 2]!;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  if (counts.size === 0) return [{ r: 0, g: 0, b: 0 }];

  const entries: ColorEntry[] = [];
  for (const [key, count] of counts) {
    entries.push({ r: (key >> 16) & 0xff, g: (key >> 8) & 0xff, b: key & 0xff, count });
  }

  if (entries.length <= cap) {
    return entries.map((e) => ({ r: e.r, g: e.g, b: e.b }));
  }

  let boxes: Box[] = [{ entries, totalCount: entries.reduce((s, e) => s + e.count, 0) }];

  while (boxes.length < cap) {
    // Split the box with the largest population (a simple, effective
    // heuristic — bigger boxes get priority, same spirit as classic
    // median-cut implementations that weight by population*range).
    let splitIndex = -1;
    let splitResult: [Box, Box] | null = null;
    let bestScore = -1;
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i]!;
      if (box.entries.length <= 1) continue;
      const score = box.totalCount;
      if (score > bestScore) {
        const result = splitBox(box);
        if (result) {
          bestScore = score;
          splitIndex = i;
          splitResult = result;
        }
      }
    }
    if (splitIndex === -1 || !splitResult) break; // nothing left splittable
    boxes.splice(splitIndex, 1, splitResult[0], splitResult[1]);
  }

  return boxes.map(averageColor);
}

/** Squared Euclidean distance in RGB space — cheap and good enough for
 *  nearest-palette-colour mapping (no perceptual weighting; this app's
 *  content is flat and few-coloured enough that it doesn't matter). */
function distSq(a: RgbColor, b: RgbColor): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return dr * dr + dg * dg + db * db;
}

/**
 * Map RGBA pixel data to palette indices. Memoises exact-colour lookups
 * (this app's rendering is mostly flat/few-coloured, so most pixels share an
 * exact colour with something already resolved) so the expensive nearest-
 * neighbour linear scan over the palette only runs once per DISTINCT colour
 * actually present in `pixels`, not once per pixel.
 */
export function mapToPalette(
  pixels: Uint8ClampedArray | Uint8Array,
  palette: readonly RgbColor[],
  cache: Map<number, number> = new Map(),
): Uint8Array {
  const pixelCount = pixels.length / 4;
  const indices = new Uint8Array(pixelCount);
  for (let p = 0; p < pixelCount; p++) {
    const i = p * 4;
    const key = (pixels[i]! << 16) | (pixels[i + 1]! << 8) | pixels[i + 2]!;
    let index = cache.get(key);
    if (index === undefined) {
      let best = 0;
      let bestDist = Infinity;
      const color: RgbColor = { r: pixels[i]!, g: pixels[i + 1]!, b: pixels[i + 2]! };
      for (let c = 0; c < palette.length; c++) {
        const d = distSq(color, palette[c]!);
        if (d < bestDist) {
          bestDist = d;
          best = c;
          if (d === 0) break;
        }
      }
      index = best;
      cache.set(key, index);
    }
    indices[p] = index;
  }
  return indices;
}
