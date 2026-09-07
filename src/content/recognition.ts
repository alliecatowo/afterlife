/**
 * Recognition that earns its claims.
 *
 * `scan(engine, rect)` looks at the live cells inside `rect` and tries, in
 * order:
 *
 *  1. **Exact match** against a precomputed table of every orientation
 *     (rotation x reflection, the 8-element dihedral group) and every
 *     oscillation phase of the curated `SPECIMENS`. A still life has one
 *     phase; an oscillator or spaceship has `period` phases; an emitter
 *     (glider gun) is matched against its own fixed footprint window at each
 *     of its `period` phases, because its emitted gliders are *meant* to
 *     leave that window — see the "Emitters" note below.
 *  2. **Repetition/translation observation**: an unmatched-but-isolated
 *     cluster is cloned into a small private engine and stepped up to
 *     `OBSERVE_WINDOW` generations. If its normalised shape reappears
 *     (in place, or translated), that period/displacement is reported —
 *     but never a curated name, since it isn't one of the 24.
 *  3. **Interference**: if another live cell sits within `ISOLATION_MARGIN`
 *     cells of a cluster's bounding box (or the box runs up against the
 *     edge of the scanned rect, where we can't see what's beyond), the
 *     observation is not clean. A static snapshot might coincidentally match
 *     a known shape, but a neighbour that close will perturb its very next
 *     generation, so naming it would be a claim we can't back up. Reported
 *     unverified rather than named.
 *
 * Unmatched, clean, non-repeating clusters stay `unknown` — the guide never
 * invents a name.
 *
 * Cost: matching is table lookups (O(1)-ish) plus, only for clusters that
 * fail the exact match, a bounded isolated re-simulation (<= 40 steps on a
 * small private engine, skipped entirely for clusters too large to be cheap).
 * `scan` never touches the caller's engine or steps the real simulation —
 * call it from a throttle (a few Hz at most), not every generation.
 */
import { createEngine, transformPattern, wrap, type LifeEngine } from '@/core/engine';
import type { Rect, StampTransform } from '@/core/types';
import { SPECIMENS, type Specimen, type SpecimenCategory } from '@/content/specimens';

/** Cells within this Chebyshev distance of a cluster's bounding box count as interference. */
export const ISOLATION_MARGIN = 2;

/** How many generations an unmatched cluster is observed for before giving up. */
export const OBSERVE_WINDOW = 40;

/** Clusters whose bounding box exceeds this on either axis skip repetition observation entirely. */
const MAX_OBSERVE_SIZE = 64;

export type RecognitionStatus = 'named' | 'characterized' | 'unverified' | 'unknown';

export interface RecognizedCluster {
  status: RecognitionStatus;
  /** World-space tight bounding box of the cluster's live cells at observation time. */
  bbox: Rect;
  population: number;
  /** Only set when `status === 'named'`: one of the curated `SPECIMENS`. */
  name?: string;
  category?: SpecimenCategory;
  /** Generations per cycle. Set for named oscillators/spaceships/emitters and characterized clusters. */
  period?: number;
  /** Cells moved per `period`, for spaceships (named or characterized). */
  translation?: { dx: number; dy: number };
  /** Human-readable account of what was actually observed, for the guide's copy. */
  note: string;
}

export interface ScanResult {
  rect: Rect;
  clusters: RecognizedCluster[];
}

// ---------------------------------------------------------------------------
// Bit-grid helpers
// ---------------------------------------------------------------------------

interface Grid {
  w: number;
  h: number;
  bits: Uint8Array;
}

function tightBbox(g: Grid): { x: number; y: number; w: number; h: number } | null {
  let minX = g.w;
  let minY = g.h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      if (g.bits[y * g.w + x]) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function crop(g: Grid, box: { x: number; y: number; w: number; h: number }): Grid {
  const bits = new Uint8Array(box.w * box.h);
  for (let y = 0; y < box.h; y++) {
    for (let x = 0; x < box.w; x++) {
      bits[y * box.w + x] = g.bits[(box.y + y) * g.w + (box.x + x)]!;
    }
  }
  return { w: box.w, h: box.h, bits };
}

const D4: StampTransform[] = [];
for (const flipX of [false, true]) {
  for (let rotate = 0 as 0 | 1 | 2 | 3; rotate < 4; rotate++) {
    D4.push({ rotate, flipX, flipY: false });
  }
}

/** Canonical, orientation-invariant key: the lexicographically smallest of the 8 D4 transforms. */
function canonicalKey(g: Grid): string {
  let best: string | null = null;
  for (const t of D4) {
    const tp = transformPattern({ name: '', w: g.w, h: g.h, cells: g.bits }, t);
    const key = `${tp.w}x${tp.h}:${tp.cells.join('')}`;
    if (best === null || key < best) best = key;
  }
  return best!;
}

function gridsEqual(a: Grid, b: Grid): boolean {
  if (a.w !== b.w || a.h !== b.h) return false;
  for (let i = 0; i < a.bits.length; i++) if (a.bits[i] !== b.bits[i]) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The precomputed match table
// ---------------------------------------------------------------------------

interface TableEntry {
  name: string;
  category: SpecimenCategory;
  period: number;
  /** Spaceships only. */
  dx?: number;
  dy?: number;
}

function isolatedEngineFor(w: number, h: number, cells: Uint8Array, pad: number): { engine: LifeEngine; ox: number; oy: number } {
  const engine = createEngine({ width: w + pad * 2, height: h + pad * 2 });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (cells[y * w + x]) engine.set(x + pad, y + pad, true);
    }
  }
  return { engine, ox: pad, oy: pad };
}

function buildTable(): Map<string, TableEntry> {
  const table = new Map<string, TableEntry>();
  const add = (key: string, entry: TableEntry) => {
    // Two specimens should never collide; first write wins, and collisions
    // would be a data bug worth surfacing rather than silently overwriting.
    if (!table.has(key)) table.set(key, entry);
  };

  for (const s of SPECIMENS) {
    if (s.verified.kind === 'still') {
      add(canonicalKey({ w: s.width, h: s.height, bits: s.cells }), { name: s.name, category: s.category, period: 1 });
      continue;
    }

    if (s.verified.kind === 'oscillator' || s.verified.kind === 'spaceship') {
      const period = s.verified.period;
      const pad = Math.max(8, period * 2);
      const { engine } = isolatedEngineFor(s.width, s.height, s.cells, pad);
      for (let phase = 0; phase < period; phase++) {
        const region = engine.region({ x: 0, y: 0, w: engine.spec.width, h: engine.spec.height });
        const box = tightBbox({ w: engine.spec.width, h: engine.spec.height, bits: region });
        if (box) {
          const shape = crop({ w: engine.spec.width, h: engine.spec.height, bits: region }, box);
          const entry: TableEntry =
            s.verified.kind === 'spaceship'
              ? { name: s.name, category: s.category, period, dx: s.verified.dx, dy: s.verified.dy }
              : { name: s.name, category: s.category, period };
          add(canonicalKey(shape), entry);
        }
        engine.step();
      }
      continue;
    }

    if (s.verified.kind === 'emitter') {
      // Emitters are matched against their own FIXED footprint window, not a
      // recomputed bounding box — the whole point of a gun is that its
      // gliders leave the box, so "identical to gen 0" is only true of that
      // exact window (verified in VERIFICATION.md). A caller recognising a
      // placed gun should scan exactly the rect it was stamped into.
      const period = s.verified.period;
      const pad = Math.max(16, Math.ceil(period / 4) + 8);
      const { engine, ox, oy } = isolatedEngineFor(s.width, s.height, s.cells, pad);
      for (let phase = 0; phase < period; phase++) {
        const window = engine.region({ x: ox, y: oy, w: s.width, h: s.height });
        add(canonicalKey({ w: s.width, h: s.height, bits: window }), { name: s.name, category: s.category, period });
        engine.step();
      }
    }
  }

  return table;
}

let _table: Map<string, TableEntry> | null = null;
function table(): Map<string, TableEntry> {
  if (!_table) _table = buildTable();
  return _table;
}

// ---------------------------------------------------------------------------
// Reading a rect off the real engine
// ---------------------------------------------------------------------------

function readRect(engine: LifeEngine, rect: Rect): Grid {
  return { w: rect.w, h: rect.h, bits: engine.region(rect) };
}

function countLive(g: Grid): number {
  let n = 0;
  for (const b of g.bits) n += b;
  return n;
}

/** Chebyshev distance between two axis-aligned boxes; 0 if they touch or overlap. */
function boxDistance(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): number {
  const dx = Math.max(a.x - (b.x + b.w - 1), b.x - (a.x + a.w - 1), 0);
  const dy = Math.max(a.y - (b.y + b.h - 1), b.y - (a.y + a.h - 1), 0);
  return Math.max(dx, dy);
}

function toWorldRect(rect: Rect, local: { x: number; y: number; w: number; h: number }, worldW: number, worldH: number): Rect {
  return { x: wrap(rect.x + local.x, worldW), y: wrap(rect.y + local.y, worldH), w: local.w, h: local.h };
}

// ---------------------------------------------------------------------------
// Repetition / translation observation for unmatched clusters
// ---------------------------------------------------------------------------

interface ObserveResult {
  period?: number;
  translation?: { dx: number; dy: number };
  note: string;
}

function observe(local: Grid, box: { x: number; y: number; w: number; h: number }): ObserveResult {
  const pad = OBSERVE_WINDOW + 4;
  const seed = crop(local, box);
  const { engine } = isolatedEngineFor(seed.w, seed.h, seed.bits, pad);
  const origin = { x: pad, y: pad, w: seed.w, h: seed.h };

  for (let gen = 1; gen <= OBSERVE_WINDOW; gen++) {
    engine.step();
    const full = { w: engine.spec.width, h: engine.spec.height, bits: engine.region({ x: 0, y: 0, w: engine.spec.width, h: engine.spec.height }) };
    const nowBox = tightBbox(full);
    if (!nowBox) {
      return { note: `died out after ${gen} generation${gen === 1 ? '' : 's'} in isolation, observed over ${OBSERVE_WINDOW}.` };
    }
    if (nowBox.w !== seed.w || nowBox.h !== seed.h) continue;
    const now = crop(full, nowBox);
    if (gridsEqual(now, seed)) {
      const dx = nowBox.x - origin.x;
      const dy = nowBox.y - origin.y;
      if (dx === 0 && dy === 0) {
        return { period: gen, note: `returned to its initial form after ${gen} generations, observed over ${OBSERVE_WINDOW}.` };
      }
      return {
        period: gen,
        translation: { dx, dy },
        note: `returned to its initial shape shifted by (${dx}, ${dy}) after ${gen} generations, observed over ${OBSERVE_WINDOW}.`,
      };
    }
  }
  return { note: `did not repeat within ${OBSERVE_WINDOW} generations of observation.` };
}

// ---------------------------------------------------------------------------
// Connected components (8-connectivity) — the multi-object fallback
// ---------------------------------------------------------------------------

function connectedComponents(g: Grid): Array<{ x: number; y: number; w: number; h: number }> {
  const seen = new Uint8Array(g.w * g.h);
  const boxes: Array<{ x: number; y: number; w: number; h: number }> = [];
  const stack: number[] = [];
  for (let y0 = 0; y0 < g.h; y0++) {
    for (let x0 = 0; x0 < g.w; x0++) {
      const i0 = y0 * g.w + x0;
      if (!g.bits[i0] || seen[i0]) continue;
      let minX = x0, maxX = x0, minY = y0, maxY = y0;
      seen[i0] = 1;
      stack.push(i0);
      while (stack.length) {
        const i = stack.pop()!;
        const x = i % g.w;
        const y = (i / g.w) | 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= g.w || ny >= g.h) continue;
            const ni = ny * g.w + nx;
            if (!g.bits[ni] || seen[ni]) continue;
            seen[ni] = 1;
            if (nx < minX) minX = nx;
            if (nx > maxX) maxX = nx;
            if (ny < minY) minY = ny;
            if (ny > maxY) maxY = ny;
            stack.push(ni);
          }
        }
      }
      boxes.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 });
    }
  }
  return boxes;
}

// ---------------------------------------------------------------------------
// scan()
// ---------------------------------------------------------------------------

function classify(local: Grid, box: { x: number; y: number; w: number; h: number }, rect: Rect, worldW: number, worldH: number, clean: boolean): RecognizedCluster {
  const shape = crop(local, box);
  const worldBox = toWorldRect(rect, box, worldW, worldH);
  const population = countLive(shape);

  if (!clean) {
    return {
      status: 'unverified',
      bbox: worldBox,
      population,
      note: 'a live cell nearby means this observation is not clean; enlarge the selection to confirm isolation.',
    };
  }

  const hit = table().get(canonicalKey(shape));
  if (hit) {
    return {
      status: 'named',
      bbox: worldBox,
      population,
      name: hit.name,
      category: hit.category,
      period: hit.period,
      translation: hit.dx !== undefined ? { dx: hit.dx, dy: hit.dy! } : undefined,
      note: `matches the curated ${hit.name}.`,
    };
  }

  if (Math.max(box.w, box.h) > MAX_OBSERVE_SIZE) {
    return { status: 'unknown', bbox: worldBox, population, note: 'too large to observe cheaply; not evaluated.' };
  }

  const observed = observe(local, box);
  if (observed.period !== undefined) {
    return {
      status: 'characterized',
      bbox: worldBox,
      population,
      period: observed.period,
      translation: observed.translation,
      note: observed.note,
    };
  }
  return { status: 'unknown', bbox: worldBox, population, note: observed.note };
}

/**
 * Scan `rect` of `engine` for recognisable structures. Synchronous and
 * bounded — safe to call on a throttle (a few Hz), never from the per-
 * generation hot path.
 */
export function scan(engine: LifeEngine, rect: Rect): ScanResult {
  const local = readRect(engine, rect);
  if (countLive(local) === 0) return { rect, clusters: [] };

  // Strategy 1: the whole rect, uncropped — the right read for a fixed-
  // footprint emitter, or any specimen scanned at exactly its own size.
  const wholeKey = canonicalKey(local);
  const wholeHit = table().get(wholeKey);
  if (wholeHit) {
    const box = tightBbox(local) ?? { x: 0, y: 0, w: local.w, h: local.h };
    return {
      rect,
      clusters: [
        {
          status: 'named',
          bbox: toWorldRect(rect, box, engine.spec.width, engine.spec.height),
          population: countLive(local),
          name: wholeHit.name,
          category: wholeHit.category,
          period: wholeHit.period,
          translation: wholeHit.dx !== undefined ? { dx: wholeHit.dx, dy: wholeHit.dy! } : undefined,
          note: `matches the curated ${wholeHit.name}.`,
        },
      ],
    };
  }

  // Strategy 2: the whole rect, tight-cropped — the single-object case
  // (a user-drawn selection with margin around one specimen).
  const box = tightBbox(local)!;
  const touchesEdge = box.x === 0 || box.y === 0 || box.x + box.w === local.w || box.y + box.h === local.h;
  if (!touchesEdge) {
    const cropped = crop(local, box);
    const key = canonicalKey(cropped);
    if (table().has(key)) {
      return { rect, clusters: [classify(local, box, rect, engine.spec.width, engine.spec.height, true)] };
    }
  }

  // Strategy 3: connected components (8-connectivity) — the multi-object
  // fallback. Note: specimens with large internal gaps (the pulsar, the
  // pentadecathlon, both glider guns) will fragment here and typically
  // report as several small unknown/unverified pieces rather than being
  // named — they are reliably named only via strategies 1/2, i.e. when
  // scanned as the sole occupant of `rect`. This is a known, documented
  // limitation of gap-based segmentation, not a false claim: fragments are
  // never given a name they don't earn.
  const boxes = connectedComponents(local);
  const clusters: RecognizedCluster[] = boxes.map((b, i) => {
    const others = boxes.filter((_, j) => j !== i);
    const nearOther = others.some((o) => boxDistance(b, o) <= ISOLATION_MARGIN);
    const nearEdge = b.x < ISOLATION_MARGIN || b.y < ISOLATION_MARGIN || local.w - (b.x + b.w) < ISOLATION_MARGIN || local.h - (b.y + b.h) < ISOLATION_MARGIN;
    const clean = !nearOther && !nearEdge;
    return classify(local, b, rect, engine.spec.width, engine.spec.height, clean);
  });
  return { rect, clusters };
}

/**
 * Cancellable wrapper around `scan`. `scan` itself is bounded and fast for
 * reasonably sized rects, so this mostly exists so callers can use the same
 * abort-on-supersede pattern as `TimelineStore.goto` without special-casing
 * recognition.
 */
export async function scanCancellable(engine: LifeEngine, rect: Rect, signal?: AbortSignal): Promise<ScanResult> {
  if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
  await Promise.resolve();
  if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
  return scan(engine, rect);
}
