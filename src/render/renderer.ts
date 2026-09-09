/**
 * Canvas2D world renderer. Owned by the `render` agent (`src/render/**`).
 * Reads the engine; never mutates it. Colours come from `src/styles/tokens.css`
 * custom properties, resolved once at `attach()` (token values are static;
 * only which lens is active changes at runtime).
 *
 * Two-path LOD strategy (see `ZOOM_LOD_THRESHOLD`):
 *  - Zoomed IN (scale >= ZOOM_LOD_THRESHOLD px/cell): a 1-pixel-per-cell
 *    `ImageData` covering only the visible world rect, blitted with
 *    `imageSmoothingEnabled = false` for crisp cells.
 *  - Zoomed OUT (scale < ZOOM_LOD_THRESHOLD px/cell): a coverage buffer sized
 *    to the on-screen footprint of the visible rect (so each output pixel
 *    aggregates several world cells), mapped through a curve that keeps
 *    sparse structures faintly visible instead of vanishing.
 */
import type { LifeEngine } from '@/core/engine';
import { transformPattern, wrap } from '@/core/engine';
import type {
  CellCoord, Rect, RenderOverlays, StampPattern, StampTransform,
} from '@/core/types';
import type { Camera, Viewport } from './camera';
import {
  resolveToken, resolveCssColor, withAlpha, type TokenColor,
  type ColorLens, type PaletteMode, type RGB, type RgbStop,
  buildHueRamp, sampleHueRamp, buildNeighborRamp, buildRgbRamp, sampleRgbRamp,
  resolveQuadPalette, resolveImmigrationPalette, quadColorForSpecies, immigrationColorForSpecies,
  blendRgbWeighted, rotateHueRgb, sampleStopsRgb, relativeLuminance,
} from './color';
import type { ArtConfig, PaletteStop, LfoTarget } from './artConfig';
import { isArtConfigAnimated } from './artConfig';
import {
  GLYPH_SETS, resolveGlyphChars, glyphIndexForValue, type GlyphSetId,
  normalizeAge, normalizeActivity, normalizeNeighbors, normalizeLineage, normalizeDensity, normalizeField,
} from './glyphs';
import {
  buildGlyphAtlas, atlasCellPxBucket, getAtlasBuildCount, isGlyphFontReady, type GlyphAtlasHandle,
} from './glyphAtlas';
import {
  sampleField, isFieldAnimated, type SampledGrid, type FieldSampleParams, type FieldTransform,
} from './field';
import { lfoValue, smoothNoise1D, type LfoShape } from './lfo';

export type { ColorLens } from './color';

/**
 * Below this many DEVICE pixels per cell, a rasterised glyph is too small to
 * read as a character (see `buildGlyphAtlas`'s ~0.86x-cell font sizing — 8
 * device px of cell height is roughly a 7px font, the practical floor for
 * "reads as dense text art" before it's just a blur) — Art mode falls all
 * the way back to the honest, unmodified lens rendering (the same fallback
 * the LOD boundary above already uses for the aggregated zoomed-out path).
 *
 * DEVICE pixels, deliberately, not CSS ones (this used to be a raw CSS-`px/
 * cell` threshold, `GLYPH_MIN_SCALE`): text legibility is a function of how
 * many real pixels draw it, not of CSS layout units, so the same CSS scale
 * needs a much LOWER threshold on a high-DPR phone than on a 1x desktop
 * monitor. A real user report — "acid mode... and I hate you have to zoom
 * in [to see it]" — was this exact gap: the old CSS-only threshold was
 * tuned for 1x desktop and required a needlessly large CSS zoom on mobile,
 * even though the device's own extra pixel density already made much
 * smaller CSS cells perfectly legible. `glyphsLegibleAt` is the one place
 * both the renderer and `ArtPanel`'s "zoom in to see glyphs" hint read this
 * from, so they can never disagree about where the threshold is.
 */
export const GLYPH_MIN_DEVICE_PX = 8;

/** A comfortably-legible device-pixel cell size (well above the bare
 *  `GLYPH_MIN_DEVICE_PX` floor) — the target `artMount.ts` eases the camera
 *  toward when Art mode is switched on below the legibility threshold, so
 *  turning it on always visibly does something immediately rather than
 *  requiring the user to separately discover "zoom in more". */
export const GLYPH_COMFORTABLE_DEVICE_PX = 16;

/** Pure: is a glyph legible at this CSS scale and device-pixel ratio? The
 *  one shared gate `draw()` and `ArtPanel`'s hint both read, so they can
 *  never drift apart. */
export function glyphsLegibleAt(scale: number, dpr: number): boolean {
  return scale * dpr >= GLYPH_MIN_DEVICE_PX;
}

/** Hard cap on the VISIBLE RECT's total area (cells, live + dead) considered
 *  for the glyph path at all — a cheap pre-check on `rect.w * rect.h` (no
 *  engine reads needed) against a pathological camera/viewport/DPR
 *  combination. Deliberately generous: this app's actual world
 *  (`@/content/scenes.ts`'s `WORLD`, 256x160 = 40,960 cells) is smaller than
 *  this, so it exists only as a sanity ceiling, never the load-bearing
 *  defence — see `MAX_GLYPH_LIVE_CELLS` and the watchdog below for that. */
export const MAX_GLYPH_CELLS = 100_000;

/**
 * Hard cap on LIVE cells actually drawn as glyphs in one frame — each one
 * costs two real canvas draw calls (a cached-raster blit + a `source-in`
 * tint fill). `MAX_GLYPH_CELLS`'s rect-AREA check above never actually
 * protects this app in practice (its whole world is smaller than that
 * threshold — see its own doc), because dead cells in the rect are nearly
 * free (`engine.get()` and `continue`) — only LIVE ones pay the expensive
 * two-draw-call path. `#drawGlyphs` counts live cells in the rect FIRST,
 * with only that cheap `engine.get()` check (no field sampling, no hue
 * rotation, no draw calls — this pre-count itself is not the expensive
 * part), and bails to the honest `#drawZoomedIn` path if the count exceeds
 * this, so a dense scene degrades gracefully to a fast, honest render
 * instead of ever attempting the expensive pass.
 *
 * This is defence-in-depth, not the primary fix — see the frame-time
 * watchdog's doc above for why: direct measurement (`e2e/art-perf.spec.ts`)
 * found real multi-hundred-ms-to-multi-second single-frame stalls that did
 * NOT scale predictably with live cell count (a smaller/simpler scene
 * stalled in one run while a larger/busier one didn't, in a comparable run),
 * so no live-cell number, however conservative, can be *proven* to prevent
 * every version of the stall actually observed. What lowering this number
 * DOES reliably reduce is exposure: fewer live glyph cells per frame means
 * fewer real canvas draw calls, which is the one dimension that clearly
 * correlates with worse outcomes across every measured run even if not
 * perfectly linearly. The frame-time watchdog remains the backstop that
 * doesn't depend on this number being right for whatever hardware/browser
 * state is actually running it. */
export const MAX_GLYPH_LIVE_CELLS = 6_000;

/**
 * FRAME-TIME/MEMORY WATCHDOG — added after a real production report: Art
 * mode hard-crashed a reporter's Mac while rendering nothing visible.
 * `e2e/art-perf.spec.ts` (built to catch exactly this class of bug) measured
 * the glyph path directly rather than guessing, and found real, reproducible
 * SINGLE-FRAME stalls of roughly one to several seconds — the whole main
 * thread frozen solid for that entire span, which is both "renders nothing
 * visible" (no repaint can happen mid-synchronous-call) and, sustained
 * across repeated frames with no way to stop, exactly what a user
 * experiences as "crashed."
 *
 * What that measurement ruled out matters as much as what it found: the
 * stall did NOT scale linearly with live cell count (a config with FEWER
 * live cells was, in one measured run, dramatically SLOWER than a config
 * with many more), was NOT explained by per-cell feature complexity (a
 * "simple" single-driver config stalled while a config with 4 LFOs, a full
 * modulation field, and trails did not, in comparable runs), and did NOT go
 * away when garbage collection was forced immediately beforehand. What IS
 * consistent across every reproduction: it coincides with the first
 * substantial batch of real, non-trivial alpha-composited canvas draw calls
 * (`drawImage` + `source-in` `fillRect`) issued against a given render
 * context — behaviour more consistent with a browser/graphics-stack-level
 * lazy-initialisation cost (a GPU/compositor code path warming up) than
 * anything this file's own per-cell logic controls. Two real, independently
 * justified contributing risks were found and fixed alongside this
 * (`glyphAtlas.ts`'s webfont-load-blocking fix, and `MAX_GLYPH_LIVE_CELLS`
 * below) — but neither was confirmed as the SOLE explanation, and the exact
 * browser-internal trigger remains not fully pinned down.
 *
 * That uncertainty is precisely why this watchdog — reacting to REAL
 * measured wall-clock cost, mechanism-agnostic by design — is the primary
 * defence rather than any static cell-count ceiling: a number tuned against
 * this measurement environment cannot promise anything about a different
 * browser, GPU, driver state, or the reporter's actual machine. The instant
 * a frame is (or a short run of frames sustainably is) too expensive for
 * whatever is actually running it, this degrades immediately — same frame,
 * before another expensive one can start — regardless of why it was
 * expensive. `MAX_GLYPH_CELLS` stays as a last-resort sanity ceiling (a
 * pathological viewport/DPR combination), not the load-bearing defence.
 */
export const ART_FRAME_BUDGET_MS = 32;
/** A single catastrophic frame (a stall, not just "a bit slow") trips the
 *  watchdog immediately, without waiting to accumulate a rolling window —
 *  see `watchdogShouldTrip`'s doc for why a sustained-average check alone
 *  isn't enough. */
export const ART_FRAME_HARD_CEILING_MS = 250;
/** How many recent art-active frames the rolling average is judged over —
 *  large enough that one-off jank (a GC pause, a background tab hiccup)
 *  can't trip it, small enough that a genuinely sustained problem is caught
 *  well within a second at 30+ fps. */
export const ART_WATCHDOG_WINDOW = 20;

/**
 * Pure: should the art-mode frame-cost watchdog trip? Two independent
 * triggers, checked separately by the caller (see `#recordArtFrameCost`):
 * a single frame at or above `hardCeilingMs` (a stall bad enough that
 * waiting for a rolling average to confirm it would itself be the mistake —
 * this is exactly the "one frame took 900ms and everything downstream backs
 * up" shape a real thermal/GPU-driver event produces), or a SUSTAINED
 * average across the last `samples` frames above `budgetMs` (this is the
 * "every frame is a bit too expensive, forever" shape the crash report
 * actually described — no single frame looks alarming, but the main thread
 * never gets a moment of idle time for the browser's own GC/compositor to
 * catch up, which is what a real resource-exhaustion crash looks like from
 * the inside). Exported and pure (plain numbers in, boolean out) so this
 * decision logic is unit-testable without a canvas or a real clock.
 */
export function watchdogShouldTrip(
  samples: readonly number[],
  budgetMs: number,
  minSamples: number,
): boolean {
  if (samples.length < minSamples) return false;
  const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
  return avg > budgetMs;
}

/** Debug/perf-test-only snapshot of Art mode's real resource usage — see
 *  `WorldRenderer.getArtDebugStats()`'s doc. */
export interface ArtDebugStats {
  /** Live entries in the glyph-atlas LRU cache (`renderer.ts`'s own, capped at 24). */
  atlasEntries: number;
  /** Total device-pixel bytes (`width * height * 4`) retained across every cached atlas canvas right now. */
  atlasBytes: number;
  /** Cumulative atlas rebuilds since page load (module-level counter — see `glyphAtlas.ts`'s `getAtlasBuildCount`). */
  atlasBuildCount: number;
  /** Distinct `fillStyle` strings computed for the MOST RECENT glyph frame — cleared every `#drawGlyphs` call, so this is a per-frame number, not cumulative. */
  fillStyleCacheEntries: number;
  /** 0 or 1 — the single reused offscreen canvas every zoomed-in/zoomed-out/glyph path shares. */
  cellCanvasCount: number;
  /** Wall-clock cost (ms) of the most recent art-active `draw()` call. */
  lastArtFrameMs: number;
  /** Rolling window of recent art-active frame costs the watchdog judges a sustained-average trip against. */
  artFrameMsWindow: number[];
}

function nowSeconds(): number {
  return (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function hashStringSeed(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

const BUILTIN_GLYPH_SET_IDS: readonly Exclude<GlyphSetId, 'custom'>[] = ['ascii', 'blocks', 'box', 'dots', 'geometric'];

export interface ExportImageOptions {
  /** Multiplier over CSS pixel size. Default 2. */
  scale?: number;
  /** Include the HUD-free world only (true) or overlays too (false). Default false. */
  bare?: boolean;
  mimeType?: 'image/png' | 'image/webp';
  /** Burn a small caption (branch + generation) into the corner. Default true. */
  caption?: boolean;
}

export interface WorldRenderer {
  /** Bind to a canvas; sets up the DPR-aware backing store. Idempotent. */
  attach(canvas: HTMLCanvasElement): void;
  setCamera(camera: Camera): void;
  /**
   * `ColorLens` is a superset of the architect-owned `RenderLens` (life/age/
   * activity) that also covers the "lineage" family added for the colourful
   * rewrite (lineage/immigration/quadlife/velocity/neighbors) — see
   * `@/render/color.ts`'s doc and `INTEGRATION-NOTES.md` for the pending
   * `RenderLens` widening this anticipates.
   */
  setLens(lens: ColorLens): void;
  /**
   * Which palette the discrete species lenses (immigration/quadlife) draw
   * from. `'cvd'` is the colourblind-safe option. Marks dirty on change.
   */
  setPalette(mode: PaletteMode): void;
  /**
   * ACID ART / Art mode (`@/render/artConfig.ts`). `null`/`enabled: false`
   * restores rendering byte-identical to before Art mode ever existed —
   * every code path this touches is gated on `this.#art?.enabled`. Above the
   * legibility floor (see `glyphsLegibleAt`'s doc), live cells render as
   * cached-raster glyph characters whose shape/colour/position are driven by
   * real per-cell state (age/activity/neighbours/lineage/density) and
   * optionally the modulation field; below it, Art mode has no visible
   * effect at all and the honest lens renders exactly as it always did.
   * Never affects which cells are alive — purely cosmetic, like every
   * existing lens.
   */
  setArtConfig(config: ArtConfig | null): void;
  /**
   * The modulation field's sampled image/video/webcam frame, refreshed by
   * whatever owns a `@/render/mediaField.ts` `MediaFieldSource` (currently
   * `ArtPanel`) on its own timer. `null` when no media source is active —
   * `@/render/field.ts`'s `sampleField` treats that as a neutral 0.5, never
   * a crash.
   */
  setModulationGrid(grid: SampledGrid | null): void;
  /** Draw one frame. Cheap enough to call every rAF at 60fps for 512x512 worlds. */
  draw(engine: LifeEngine, overlays?: RenderOverlays): void;
  /** Re-read the canvas' CSS size and devicePixelRatio. Call on resize. */
  resize(): void;
  /** CSS-pixel canvas coords -> fractional world cell coords. */
  screenToWorld(px: number, py: number): { x: number; y: number };
  /** World cell coords -> CSS-pixel canvas coords. */
  worldToScreen(x: number, y: number): { x: number; y: number };
  /** Translucent pattern preview under the cursor. Pass null to clear. */
  setGhost(pattern: StampPattern | null, x: number, y: number, transform: StampTransform): void;
  setSelection(rect: Rect | null): void;
  /** Row-major diff cells over the last selection rect. 0 same / 1 A-only / 2 B-only. */
  setDiffOverlay(cells: Uint8Array | null): void;
  /**
   * Live, uncommitted stroke cells (from an in-progress draw/erase gesture)
   * to paint immediately, before the caller commits them to the engine. Pass
   * null to clear. See BUG 2: without this, a drawn stroke was invisible
   * until the gesture ended AND the edit was flushed to the engine (instant
   * while paused, but delayed to the next generation boundary while
   * playing) — nothing showed under the cursor while actually dragging.
   */
  setStrokePreview(cells: ReadonlyArray<{ x: number; y: number; alive: boolean }> | null): void;
  /** Show/hide the world grid when the zoom level allows (default true). */
  setShowGrid(show: boolean): void;
  /**
   * Force the next `consumeDirty()` to report true. For state changes the
   * renderer can't observe itself (the engine mutating — a step or a
   * committed edit — since `draw()` takes the engine as a parameter rather
   * than the renderer holding a reference to it).
   */
  invalidate(): void;
  /**
   * True if anything visible has changed since the last call (camera, lens,
   * grid, ghost, selection, diff overlay, stroke preview, an explicit
   * `invalidate()`, or a `resize()`) — and clears that flag. The render loop
   * uses this to skip the (comparatively expensive) `draw()` call entirely
   * when nothing would look different, so an idle paused world costs
   * ~nothing per frame instead of rebuilding a full `ImageData` 60 times a
   * second for no visible change. `draw()` itself is unaffected by this flag
   * — it always draws when called; gating is the caller's job.
   */
  consumeDirty(): boolean;
  /** Current CSS-pixel viewport size, for wiring the camera controller. */
  readonly viewport: Readonly<Viewport>;
  /** The device-pixel ratio this renderer's backing store is actually using
   *  (capped — see `resize()`'s implementation), for anything outside this
   *  module that needs to reason in real device pixels rather than CSS ones
   *  (`glyphsLegibleAt`'s CSS-scale-and-dpr gate, `ArtPanel`'s matching
   *  hint, `artMount.ts`'s auto-ease-to-legible-zoom target). */
  readonly dpr: number;
  exportImage(opts?: ExportImageOptions): Promise<Blob>;
  /**
   * Debug/perf-test-only snapshot of Art mode's real resource usage (atlas
   * cache size/bytes, fillStyle cache size, last frame cost). Cheap enough to
   * call every frame from a test harness; never called from any production
   * code path. See `ArtDebugStats`'s doc and `e2e/art-perf.spec.ts`.
   */
  getArtDebugStats(): ArtDebugStats;
  /**
   * Poll-and-clear: `null` unless the frame-time watchdog (see
   * `watchdogShouldTrip`'s doc) has tripped since the last call, in which
   * case this returns a human-readable reason and resets the flag. The
   * watchdog itself already force-disabled Art mode on THIS renderer the
   * instant it tripped (`#art` is nulled synchronously, before this is ever
   * read) — this is purely how `artMount.ts` finds out, so it can sync
   * `useArtStore` (so the UI reflects "off") and tell the user honestly via
   * a toast, rather than the store silently disagreeing with what's on
   * screen.
   */
  consumeArtWatchdogTrip(): string | null;
  /** Release GPU/canvas resources and listeners. */
  dispose(): void;
}

/** Below this CSS px/cell, switch from crisp per-cell rendering to aggregated coverage. */
export const ZOOM_LOD_THRESHOLD = 3;
/** Grid hairlines only appear once cells are large enough to read. */
export const GRID_MIN_SCALE = 8;
/** A stronger rule line every N cells, for orientation. */
export const GRID_MAJOR_EVERY = 10;
/** Generations to reach full intensity on the age ramp. */
export const AGE_RAMP_GENERATIONS = 32;

/** Pure: raw visible world rect (cells) for a camera/viewport, padded by one
 *  cell, NOT wrapped or bounds-clamped. No canvas needed — testable in isolation. */
export function computeRawVisibleRect(
  camera: Readonly<Camera>,
  viewport: Readonly<Viewport>,
): Rect {
  const tl = projectScreenToWorld(camera, viewport, 0, 0);
  const br = projectScreenToWorld(camera, viewport, viewport.width, viewport.height);
  const pad = 1;
  const x = Math.floor(Math.min(tl.x, br.x)) - pad;
  const y = Math.floor(Math.min(tl.y, br.y)) - pad;
  const w = Math.ceil(Math.abs(br.x - tl.x)) + pad * 2;
  const h = Math.ceil(Math.abs(br.y - tl.y)) + pad * 2;
  return { x, y, w: Math.max(1, w), h: Math.max(1, h) };
}

/**
 * Pure: visible rect capped to at most one world-tile per axis (the torus
 * repeats beyond that — see the module doc's LOD strategy). No canvas needed
 * — testable in isolation.
 *
 * When the raw rect already fits within the world on an axis (the common
 * case — zoomed in enough, or zoomed out but not past the world's own
 * extent), this reuses the RAW rect's own `x`/`y` exactly, rather than
 * recomputing an origin from `camera.x`/`camera.y` independently. Those two
 * computations round (floor/ceil) slightly differently, so recomputing
 * introduced up to a 1-cell drift between the rect this function returned
 * and the rect the raw computation actually derived from the on-screen
 * corners — invisible most of the time, but right at the boundary where a
 * zoom changes whether an axis needs clamping, that drift flips which edge
 * cells are included and structures visibly pop in/out. Only when an axis
 * genuinely needs clamping (the world is smaller than the viewport shows) do
 * we re-anchor on the camera, and in that case any anchor is equally valid —
 * the wrap makes every cell appear exactly once regardless of starting
 * offset.
 */
export function computeVisibleWorldRect(
  camera: Readonly<Camera>,
  viewport: Readonly<Viewport>,
  spec: { width: number; height: number },
): Rect {
  const raw = computeRawVisibleRect(camera, viewport);
  const w = Math.min(raw.w, spec.width);
  const h = Math.min(raw.h, spec.height);
  const x = w === raw.w ? raw.x : Math.floor(camera.x - w / 2);
  const y = h === raw.h ? raw.y : Math.floor(camera.y - h / 2);
  return { x, y, w, h };
}

/** Pure: CSS-pixel screen point -> fractional world coords. No canvas needed — testable in isolation. */
export function projectScreenToWorld(
  camera: Readonly<Camera>,
  viewport: Readonly<Viewport>,
  px: number,
  py: number,
): { x: number; y: number } {
  return {
    x: camera.x + (px - viewport.width / 2) / camera.scale,
    y: camera.y + (py - viewport.height / 2) / camera.scale,
  };
}

/** Pure: world coords -> CSS-pixel screen point. Exact inverse of `projectScreenToWorld`. */
export function projectWorldToScreen(
  camera: Readonly<Camera>,
  viewport: Readonly<Viewport>,
  x: number,
  y: number,
): { x: number; y: number } {
  return {
    x: (x - camera.x) * camera.scale + viewport.width / 2,
    y: (y - camera.y) * camera.scale + viewport.height / 2,
  };
}

/**
 * Pure: the world-space x/y coordinates, if any, where the currently-drawn
 * content actually wraps — i.e. where `wrap()` makes the rendered column/row
 * jump discontinuously from `spec.width - 1`/`spec.height - 1` back to `0`.
 * No canvas needed — testable in isolation.
 *
 * TWO PRIOR ATTEMPTS at a "torus boundary" overlay both failed the same way:
 * they recomputed the box's position from `camera` independently of what the
 * cell paths (`#drawZoomedIn`/`#drawZoomedOut`/`#drawGlyphs`) actually drew,
 * so the two could — and, per real user reports, DID — disagree after
 * panning. The first version stroked a rect fixed at literal world coords
 * `[0, spec.width] x [0, spec.height]`. The second (`torusBoundaryOrigin`,
 * since removed) picked whichever period-copy of the grid the camera was
 * nearest to, by rounding `camera.x`/`camera.y` — an improvement, but still
 * an independent, parallel derivation of "where is the world," guessed from
 * the camera rather than read from the actual draw.
 *
 * The world is NEVER tiled/repeated on screen — `computeVisibleWorldRect`
 * always caps the drawn rect to at most one period per axis, so exactly one
 * `ImageData`/coverage-buffer blit is drawn per frame, at exactly the world
 * rect `{x, y, w, h}` every cell path already computes once in `draw()`.
 * That rect, screen-projected, is therefore BY DEFINITION where every live
 * cell in view actually is — there is nothing left to guess. The only
 * genuine "boundary" fact left to show is: does the rendered rect's own
 * span cross a multiple of `spec.width`/`spec.height`? If so, the column/row
 * just past that world coordinate is `wrap()`-sampled back to `0`, i.e. a
 * real seam is visible inside the drawn content right now. If the rect
 * doesn't span a full period (typical zoomed-in case), there's at most one
 * such seam per axis (never a whole rect's worth) — sometimes none at all,
 * which is the honest answer when no wrap edge is currently on screen.
 *
 * This is why the overlay draws SEAM LINES, not a rectangle: a "bounding
 * box" implies the world has one canonical position, which a torus doesn't
 * — only where consecutive on-screen content stops being spatially
 * contiguous is a real, drawable fact, and that fact comes directly from the
 * same `rect` the pixels were placed from, not a second calculation.
 */
export function computeTorusSeams(
  rect: Readonly<Rect>,
  spec: { width: number; height: number },
): { xs: number[]; ys: number[] } {
  const xs: number[] = [];
  const kStart = Math.ceil(rect.x / spec.width);
  const kEnd = Math.floor((rect.x + rect.w) / spec.width);
  // `+ 0` normalises a `-0` result (e.g. `Math.ceil(-0.3) === -0`) to `0` —
  // mathematically identical, but `-0` reads oddly in a seam-position list
  // and trips exact-equality assertions that (rightly) distinguish it.
  for (let k = kStart; k <= kEnd; k++) xs.push(k * spec.width + 0);

  const ys: number[] = [];
  const jStart = Math.ceil(rect.y / spec.height);
  const jEnd = Math.floor((rect.y + rect.h) / spec.height);
  for (let j = jStart; j <= jEnd; j++) ys.push(j * spec.height + 0);

  return { xs, ys };
}

interface GhostState {
  pattern: StampPattern;
  x: number;
  y: number;
  transform: StampTransform;
}

function coverageAlpha(fraction: number): number {
  if (fraction <= 0) return 0;
  // Floor + sub-linear curve: a single live cell in a mostly-dead block still
  // reads as a faint presence rather than rounding away to nothing.
  return Math.min(1, 0.26 + 0.74 * Math.pow(fraction, 0.45));
}

class WorldRendererImpl implements WorldRenderer {
  #canvas: HTMLCanvasElement | null = null;
  #ctx: CanvasRenderingContext2D | null = null;
  #dpr = 1;
  #cssW = 1;
  #cssH = 1;

  #camera: Camera = { x: 0, y: 0, scale: 8 };
  #lens: ColorLens = 'life';
  #paletteMode: PaletteMode = 'default';
  #showGrid = true;

  #selection: Rect | null = null;
  #ghost: GhostState | null = null;
  #diffCells: Uint8Array | null = null;
  #diffRect: Rect | null = null;
  #strokePreview: Array<{ x: number; y: number; alive: boolean }> | null = null;

  // See `WorldRenderer.consumeDirty()`'s doc. Starts true so the very first
  // frame after `attach()` always draws.
  #dirty = true;

  // Offscreen buffer reused across frames for the per-cell / coverage paths.
  #cellCanvas: HTMLCanvasElement | null = null;
  #cellCtx: CanvasRenderingContext2D | null = null;

  // Tokens resolved once (values are static; only which lens is *used* varies per draw).
  #tokLife!: TokenColor;
  #tokAge!: TokenColor;
  #tokActivity!: TokenColor;
  #tokDiff!: TokenColor;
  #tokLine!: TokenColor;
  #tokLineStrong!: TokenColor;
  #tokIvory!: TokenColor;

  // The "lineage" family's precomputed ramps/palettes — built once at
  // `attach()`/`setPalette()`, indexed per-pixel thereafter. Never rebuilt
  // inside a draw call (see `buildHueRamp`'s doc for why).
  #hueRamp!: RGB[];
  #neighborRamp!: RGB[];
  #ageRamp!: RGB[];
  #activityRamp!: RGB[];
  #quadPalette!: RGB[];
  #immigrationPalette!: [RGB, RGB];

  // ---- Art mode state (`@/render/artConfig.ts`) — all `null`/empty by
  // default, so an app that never calls `setArtConfig` pays nothing beyond
  // one extra `?.` per `draw()` call.
  #art: ArtConfig | null = null;
  #artGrid: SampledGrid | null = null;
  #glyphAtlasCache = new Map<string, GlyphAtlasHandle>();
  #customStopsCacheKey = '';
  #customStopsRgb: RgbStop[] = [];
  #tokInk900!: TokenColor;
  #currentTSec = 0;
  #currentLfoAcc: Partial<Record<LfoTarget, number>> = {};

  // Frame-time watchdog (see `watchdogShouldTrip`'s doc) — the primary
  // defence against the real "hard-crashed a Mac" report, since a static
  // cell-count ceiling can't account for how much cheaper/more expensive the
  // same cell count is on different hardware.
  #artFrameMsWindow: number[] = [];
  #artWatchdogTripped = false;
  #artWatchdogReason: string | null = null;
  #lastArtFrameMs = 0;

  // Reused across every `#drawGlyphs` call (never re-`new`'d per frame — see
  // that method's doc) to stop the batched-draw command list from being 6
  // fresh array allocations on every single animated frame, on top of the
  // per-cell work that's already unavoidable.
  #glyphDx: number[] = [];
  #glyphDy: number[] = [];
  #glyphDw: number[] = [];
  #glyphDh: number[] = [];
  #glyphSx: number[] = [];
  #glyphFillStyles: string[] = [];
  // Per-FRAME (cleared at the top of every `#drawGlyphs` call, never carried
  // across frames — seeing hue rotation/colour cycling continuously shift
  // the base hue every frame, the SET of distinct colours in use changes
  // every frame too, so a cache that persisted across frames would grow
  // unboundedly over a long session) dedup of the `rgba(...)` fillStyle
  // string per exact (r, g, b, alpha) byte tuple. Many cells in a frame
  // routinely share the exact same ramp-bucket colour, so this turns what
  // used to be one template-literal string allocation PER LIVE CELL PER
  // FRAME into one per DISTINCT colour actually used that frame.
  #fillStyleCache = new Map<number, string>();

  get viewport(): Readonly<Viewport> {
    return { width: this.#cssW, height: this.#cssH };
  }

  get dpr(): number {
    return this.#dpr;
  }

  attach(canvas: HTMLCanvasElement): void {
    this.#canvas = canvas;
    this.#ctx = canvas.getContext('2d');
    this.#resolveTokens();
    this.resize();
    // Art mode's reachability (trigger tab + 'a' shortcut) self-mounts from
    // here — see `./artMount.ts`'s doc for why this hook, not `Hud.tsx`.
    // Fire-and-forget: never blocks/affects attach() itself, and this
    // module has no other reference to React outside this one dynamic
    // import, so a renderer used headlessly (tests) never pays for it.
    //
    // GATED ON THE CANVAS ID: `@/ui/session.ts` creates a SECOND
    // `WorldRenderer` for the compare view (`#compare-canvas`) and calls
    // `attach()` on it too, unconditionally, moments after this one — both
    // calls race the same dynamic `import('./artMount')`, and that module's
    // own `mounted` guard (a plain boolean, set inside the FIRST `.then()`
    // callback to actually run) has no way to tell the two apart on its
    // own. Observed in practice: the compare renderer's `attach()` call
    // sometimes won that race, permanently binding Art mode's store-to-
    // renderer sync to the almost-never-drawn compare canvas instead of the
    // visible world one — Art mode would toggle in the UI (the store change
    // is real) with NO visible effect whatsoever, and no error anywhere.
    // Restricting this to the one stable DOM id `#world-canvas` (see
    // ARCHITECTURE.md's "DOM anchors" contract) makes which renderer wins
    // unambiguous regardless of promise-resolution timing.
    if (canvas.id === 'world-canvas') {
      void import('./artMount').then((m) => m.ensureArtUiMounted(this));
    }
  }

  #resolveTokens(): void {
    this.#tokLife = resolveToken('--color-accent-life', 'oklch(0.87 0.155 155)');
    this.#tokAge = resolveToken('--color-accent-age', 'oklch(0.79 0.130 78)');
    this.#tokActivity = resolveToken('--color-accent-activity', 'oklch(0.72 0.185 25)');
    this.#tokDiff = resolveToken('--color-accent-diff', 'oklch(0.85 0.170 330)');
    this.#tokLine = resolveToken('--color-line', 'oklch(0.32 0.018 198)');
    this.#tokLineStrong = resolveToken('--color-line-strong', 'oklch(0.44 0.020 199)');
    this.#tokIvory = resolveToken('--color-ivory-100', 'oklch(0.96 0.014 92)');
    this.#tokInk900 = resolveToken('--color-ink-900', 'oklch(0.16 0.012 200)');

    // Theme-aware hue-ramp lightness: `lineage`/`velocity`/`neighbors` are
    // continuous hue-wheel lenses (see `buildHueRamp`'s doc) rather than a
    // single fixed accent token, so — unlike the other 5 lenses, which
    // resolve real `--color-accent-*` custom properties a theme can tune
    // per-ground — they need an explicit ground-aware lightness choice to
    // stay legible. `l=0.80` (this file's original default, still used for
    // the dark "Observatory" ground) measures ~1.6-1.9:1 contrast against a
    // LIGHT ground across the whole hue wheel — a real legibility failure a
    // concurrent theming pass measured directly. Reused for both ramps
    // rather than duplicated: same ground, same contrast requirement.
    const groundIsLight = relativeLuminance(this.#tokInk900.rgb) > 0.5;
    const hueRampL = groundIsLight ? 0.40 : 0.80;
    this.#hueRamp = buildHueRamp(180, hueRampL, 0.15);
    this.#neighborRamp = buildNeighborRamp(hueRampL, groundIsLight ? 0.18 : 0.16);
    // Spectral, multi-hue age/activity ramps that still terminate exactly on
    // the real design token at full intensity (see `buildRgbRamp`'s doc for
    // why lerping already-resolved RGB bytes here doesn't reintroduce any
    // regex/string parsing of the token's CSS value).
    this.#ageRamp = buildRgbRamp([
      resolveCssColor('oklch(0.55 0.20 260)'),
      resolveCssColor('oklch(0.70 0.20 155)'),
      this.#tokAge.rgb,
    ]);
    this.#activityRamp = buildRgbRamp([
      resolveCssColor('oklch(0.55 0.20 260)'),
      resolveCssColor('oklch(0.75 0.20 100)'),
      this.#tokActivity.rgb,
    ]);
    this.#resolvePalettes();
  }

  #resolvePalettes(): void {
    this.#quadPalette = resolveQuadPalette(this.#paletteMode);
    this.#immigrationPalette = resolveImmigrationPalette(this.#paletteMode);
  }

  setPalette(mode: PaletteMode): void {
    if (mode === this.#paletteMode) return;
    this.#paletteMode = mode;
    this.#resolvePalettes();
    this.#dirty = true;
  }

  setArtConfig(config: ArtConfig | null): void {
    this.#art = config;
    // A fresh config (a new glyph set/preset/toggle-on) is a natural reset
    // point for the watchdog's rolling window — otherwise a single
    // more-expensive-than-usual frame right after a config CHANGE (e.g. the
    // one-time atlas rebuild a new glyph set needs) could count against a
    // budget measured under the PREVIOUS config's very different cost
    // profile. Not needed for correctness (the window is short and
    // self-corrects within `ART_WATCHDOG_WINDOW` frames either way) but
    // avoids a spurious trip from a single unlucky transition frame.
    this.#artFrameMsWindow = [];
    this.#dirty = true;
  }

  setModulationGrid(grid: SampledGrid | null): void {
    this.#artGrid = grid;
    if (this.#art?.enabled) this.#dirty = true;
  }

  invalidate(): void {
    this.#dirty = true;
  }

  consumeDirty(): boolean {
    const d = this.#dirty;
    this.#dirty = false;
    return d;
  }

  setCamera(camera: Camera): void {
    if (camera.x !== this.#camera.x || camera.y !== this.#camera.y || camera.scale !== this.#camera.scale) {
      this.#dirty = true;
    }
    this.#camera = { ...camera };
  }

  setLens(lens: ColorLens): void {
    if (lens !== this.#lens) this.#dirty = true;
    this.#lens = lens;
  }

  setShowGrid(show: boolean): void {
    if (show !== this.#showGrid) this.#dirty = true;
    this.#showGrid = show;
  }

  setGhost(pattern: StampPattern | null, x: number, y: number, transform: StampTransform): void {
    const prev = this.#ghost;
    const changed = (prev === null) !== (pattern === null)
      || (pattern !== null && (
        prev!.pattern !== pattern || prev!.x !== x || prev!.y !== y
        || prev!.transform.rotate !== transform.rotate
        || prev!.transform.flipX !== transform.flipX
        || prev!.transform.flipY !== transform.flipY
      ));
    if (changed) this.#dirty = true;
    this.#ghost = pattern ? { pattern, x, y, transform } : null;
  }

  setSelection(rect: Rect | null): void {
    const prev = this.#selection;
    const changed = (prev === null) !== (rect === null)
      || (rect !== null && (prev!.x !== rect.x || prev!.y !== rect.y || prev!.w !== rect.w || prev!.h !== rect.h));
    if (changed) this.#dirty = true;
    this.#selection = rect;
  }

  setDiffOverlay(cells: Uint8Array | null): void {
    if (cells !== this.#diffCells) this.#dirty = true;
    this.#diffCells = cells;
    this.#diffRect = cells ? this.#selection : null;
  }

  setStrokePreview(cells: ReadonlyArray<{ x: number; y: number; alive: boolean }> | null): void {
    // Called continuously while a draw/erase gesture is in progress (see
    // `@/interact/input.ts`) — always mark dirty rather than diffing, since
    // a live stroke changing is, by definition, always a visible change the
    // instant it's called.
    this.#dirty = true;
    this.#strokePreview = cells && cells.length > 0 ? [...cells] : null;
  }

  resize(): void {
    if (!this.#canvas) return;
    const rect = this.#canvas.getBoundingClientRect();
    // Capped at 2x, same as `@/ui/timeline/Timeline`'s ribbon canvas: a 3x
    // phone screen (iPhone Pro class) would otherwise size the backing
    // buffer at 3x CSS pixels, tripling fill-rate cost for a sharpness gain
    // invisible on a cellular-automaton grid of flat-colour rects. Purely a
    // display-resolution cap — never touches simulation state, camera math,
    // or world-space coordinates, all of which stay in CSS/world units.
    this.#dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
    this.#cssW = Math.max(1, rect.width || this.#canvas.clientWidth || 1);
    this.#cssH = Math.max(1, rect.height || this.#canvas.clientHeight || 1);
    const dw = Math.max(1, Math.round(this.#cssW * this.#dpr));
    const dh = Math.max(1, Math.round(this.#cssH * this.#dpr));
    if (this.#canvas.width !== dw) this.#canvas.width = dw;
    if (this.#canvas.height !== dh) this.#canvas.height = dh;
    this.#dirty = true;
  }

  screenToWorld(px: number, py: number): { x: number; y: number } {
    return projectScreenToWorld(this.#camera, this.viewport, px, py);
  }

  worldToScreen(x: number, y: number): { x: number; y: number } {
    return projectWorldToScreen(this.#camera, this.viewport, x, y);
  }

  /** Visible rect capped to at most one world-tile per axis (the torus repeats beyond that),
   *  centred on the camera so zooming out past the world's extent doesn't blow up iteration cost.
   *  See the exported `computeVisibleWorldRect` for the pure implementation (BUG 3 fix doc). */
  #visibleWorldRect(spec: { width: number; height: number }): Rect {
    return computeVisibleWorldRect(this.#camera, this.viewport, spec);
  }

  draw(engine: LifeEngine, overlays?: RenderOverlays): void {
    this.#lastEngine = engine;
    const ctx = this.#ctx;
    const canvas = this.#canvas;
    if (!ctx || !canvas) return;

    // Art mode is only visually active once cells are legible as glyphs
    // (see `glyphsLegibleAt`'s doc) — below that, and always when zoomed all
    // the way out, this is `false` and every honest lens renders completely
    // unmodified, byte-identical to before Art mode existed.
    const artActive = Boolean(this.#art?.enabled) && glyphsLegibleAt(this.#camera.scale, this.#dpr);
    // Measures the WHOLE rest of this art-active frame (trails fill, the
    // glyph/zoomed-in draw, grid, torus boundary, and every overlay below —
    // not just `#drawGlyphs`). See `ART_FRAME_BUDGET_MS`'s doc: a real
    // reproduction found the expensive stall this exists to catch landing in
    // whichever canvas call happened to be first after a cold/lazy internal
    // browser state, which is NOT guaranteed to be inside `#drawGlyphs`
    // specifically — narrower timing around one sub-call would have missed
    // exactly the failure this was built to catch.
    const artFrameStart = artActive ? nowMs() : 0;
    if (artActive) {
      this.#currentTSec = nowSeconds();
      this.#currentLfoAcc = this.#evalLfos(this.#art!, this.#currentTSec);
    }
    const trailsActive = artActive && this.#art!.color.trails.enabled;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (trailsActive) {
      // Fade the previous frame toward the page background instead of
      // clearing it — an explicit, Art-mode-only "trails show PAST state"
      // effect (see `ArtPanel`'s caption). `decay` is how much of the old
      // frame survives each draw; LFO "trailLength" targets multiply it.
      const decay = this.#effectiveTrailDecay();
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = withAlpha(this.#tokInk900, decay);
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    const spec = engine.spec;
    const rect = this.#visibleWorldRect(spec);

    if (this.#camera.scale >= ZOOM_LOD_THRESHOLD) {
      if (artActive) {
        this.#drawGlyphs(engine, rect);
      } else {
        this.#drawZoomedIn(engine, rect);
      }
    } else {
      this.#drawZoomedOut(engine, rect);
    }

    if (this.#strokePreview) this.#drawStrokePreview(this.#strokePreview);

    const showGrid = overlays?.grid ?? this.#showGrid;
    if (showGrid && this.#camera.scale >= GRID_MIN_SCALE) {
      this.#drawGrid(rect);
    }

    this.#drawTorusBoundary(rect, spec);

    const diff = overlays && 'diff' in overlays
      ? overlays.diff
      : (this.#diffCells && this.#diffRect ? { rect: this.#diffRect, cells: this.#diffCells } : null);
    if (diff) this.#drawDiff(diff.rect, diff.cells);

    const selection = overlays && 'selection' in overlays ? overlays.selection : this.#selection;
    if (selection) this.#drawSelection(selection);

    const ghost = overlays && 'ghost' in overlays ? overlays.ghost : this.#ghost;
    if (ghost) this.#drawGhost(ghost);

    if (artActive) this.#recordArtFrameCost(nowMs() - artFrameStart);

    // Self-perpetuating animation: only while Art mode is actually visible
    // AND actually configured to change over time (an LFO, colour cycling,
    // trails decaying, or an inherently time-varying field like plasma/
    // video/webcam) does this renderer mark itself dirty again — a static
    // Art config (e.g. a fixed noise field, no LFOs) costs exactly one draw,
    // same as any other lens. This is what lets an animated Art mode keep
    // animating with NO changes to `@/core/loop.ts` or `@/ui/session.ts`'s
    // rAF loop: it already calls `consumeDirty()` every frame regardless.
    if (artActive && this.#art && isArtConfigAnimated(this.#art, isFieldAnimated)) {
      this.#dirty = true;
    }
  }

  /** Feed one glyph-frame's real wall-clock cost into the watchdog (see
   *  `watchdogShouldTrip`'s doc) and trip it if warranted. Called exactly
   *  once per `draw()` call that actually ran `#drawGlyphs`. */
  #recordArtFrameCost(dt: number): void {
    this.#lastArtFrameMs = dt;
    this.#artFrameMsWindow.push(dt);
    if (this.#artFrameMsWindow.length > ART_WATCHDOG_WINDOW) this.#artFrameMsWindow.shift();

    if (dt >= ART_FRAME_HARD_CEILING_MS) {
      this.#tripArtWatchdog(`a single Art-mode frame took ${Math.round(dt)}ms (ceiling ${ART_FRAME_HARD_CEILING_MS}ms)`);
      return;
    }
    if (watchdogShouldTrip(this.#artFrameMsWindow, ART_FRAME_BUDGET_MS, ART_WATCHDOG_WINDOW)) {
      const avg = this.#artFrameMsWindow.reduce((a, b) => a + b, 0) / this.#artFrameMsWindow.length;
      this.#tripArtWatchdog(`Art-mode frames averaged ${Math.round(avg)}ms over the last ${this.#artFrameMsWindow.length} frames (budget ${ART_FRAME_BUDGET_MS}ms)`);
    }
  }

  /** Immediately stop paying Art mode's cost — same frame, before another
   *  expensive one can start — and record why, for `consumeArtWatchdogTrip()`
   *  to relay to `artMount.ts` (which syncs `useArtStore` off and tells the
   *  user via a toast). Disabling here, at the renderer, rather than only
   *  waiting for the store round-trip, is what makes this a genuine safety
   *  net rather than best-effort: even if the store sync lags a frame (a
   *  paused tab, a slow event loop — exactly the conditions this exists
   *  for), the actual expensive computation has already stopped. */
  #tripArtWatchdog(reason: string): void {
    this.#art = null;
    this.#artFrameMsWindow = [];
    this.#artWatchdogTripped = true;
    this.#artWatchdogReason = reason;
    this.#dirty = true; // redraw once more, honestly, without Art mode
  }

  getArtDebugStats(): ArtDebugStats {
    let atlasBytes = 0;
    for (const atlas of this.#glyphAtlasCache.values()) {
      atlasBytes += atlas.canvas.width * atlas.canvas.height * 4;
    }
    return {
      atlasEntries: this.#glyphAtlasCache.size,
      atlasBytes,
      atlasBuildCount: getAtlasBuildCount(),
      fillStyleCacheEntries: this.#fillStyleCache.size,
      cellCanvasCount: this.#cellCanvas ? 1 : 0,
      lastArtFrameMs: this.#lastArtFrameMs,
      artFrameMsWindow: [...this.#artFrameMsWindow],
    };
  }

  consumeArtWatchdogTrip(): string | null {
    if (!this.#artWatchdogTripped) return null;
    this.#artWatchdogTripped = false;
    const reason = this.#artWatchdogReason;
    this.#artWatchdogReason = null;
    return reason;
  }

  #ensureCellCanvas(w: number, h: number): CanvasRenderingContext2D {
    if (!this.#cellCanvas) {
      this.#cellCanvas = document.createElement('canvas');
    }
    if (this.#cellCanvas.width !== w) this.#cellCanvas.width = w;
    if (this.#cellCanvas.height !== h) this.#cellCanvas.height = h;
    if (!this.#cellCtx) this.#cellCtx = this.#cellCanvas.getContext('2d');
    return this.#cellCtx!;
  }

  /**
   * A cell's local "directional bias": the vector sum of the 8 neighbour
   * offsets weighted by whether that neighbour is alive — points toward
   * where the rest of a moving structure currently is, which for an
   * asymmetric, translating pattern (a glider, a spaceship) correlates with
   * its heading. Purely derived from the current bits (`engine.get()`,
   * already wrapping toroidally) — nothing stored, nothing snapshotted, no
   * history needed. This is a proxy, not literal instantaneous velocity
   * (Life cells don't move — only birth/death patterns do), and the
   * `velocity` lens's legend says so explicitly. `{dx:0,dy:0}` means "no
   * detectable bias" (e.g. a symmetric still life) — rendered as a neutral,
   * hue-free grey rather than an arbitrary colour, per "never rely on hue
   * alone to convey a critical state."
   */
  #directionalBias(engine: LifeEngine, x: number, y: number): { dx: number; dy: number } {
    let sx = 0;
    let sy = 0;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        if (ox === 0 && oy === 0) continue;
        if (engine.get(x + ox, y + oy)) { sx += ox; sy += oy; }
      }
    }
    return { dx: sx, dy: sy };
  }

  #writeCellPixel(engine: LifeEngine, x: number, y: number, data: Uint8ClampedArray, idx: number): void {
    switch (this.#lens) {
      case 'activity': {
        const heat = engine.activityAt(x, y);
        if (heat > 0.01) {
          const rgb = sampleRgbRamp(this.#activityRamp, Math.pow(Math.min(1, heat), 0.6));
          data[idx] = rgb.r; data[idx + 1] = rgb.g; data[idx + 2] = rgb.b;
          data[idx + 3] = Math.round(Math.pow(Math.min(1, heat), 0.6) * 255);
        }
        return;
      }
      case 'neighbors': {
        // Unlike every other lens, this one draws DEAD cells too (at reduced
        // alpha) — "the rule itself visible" means showing about-to-be-born
        // cells (dead, count === 3), not just live ones.
        const n = engine.liveNeighborCount(x, y);
        if (n === 0) return;
        const rgb = this.#neighborRamp[n]!;
        data[idx] = rgb.r; data[idx + 1] = rgb.g; data[idx + 2] = rgb.b;
        data[idx + 3] = engine.get(x, y) ? 255 : 110;
        return;
      }
      default:
        break;
    }

    if (!engine.get(x, y)) return;

    switch (this.#lens) {
      case 'age': {
        const age = engine.ageAt(x, y);
        const t = Math.min(1, age / AGE_RAMP_GENERATIONS);
        const rgb = sampleRgbRamp(this.#ageRamp, t);
        data[idx] = rgb.r; data[idx + 1] = rgb.g; data[idx + 2] = rgb.b;
        data[idx + 3] = Math.round((0.35 + 0.65 * t) * 255);
        return;
      }
      case 'lineage': {
        const rgb = sampleHueRamp(this.#hueRamp, engine.hueAt(x, y));
        data[idx] = rgb.r; data[idx + 1] = rgb.g; data[idx + 2] = rgb.b; data[idx + 3] = 255;
        return;
      }
      case 'immigration': {
        const rgb = immigrationColorForSpecies(this.#immigrationPalette, engine.speciesAt(x, y));
        if (!rgb) return;
        data[idx] = rgb.r; data[idx + 1] = rgb.g; data[idx + 2] = rgb.b; data[idx + 3] = 255;
        return;
      }
      case 'quadlife': {
        const rgb = quadColorForSpecies(this.#quadPalette, engine.speciesAt(x, y));
        if (!rgb) return;
        data[idx] = rgb.r; data[idx + 1] = rgb.g; data[idx + 2] = rgb.b; data[idx + 3] = 255;
        return;
      }
      case 'velocity': {
        const { dx, dy } = this.#directionalBias(engine, x, y);
        if (dx === 0 && dy === 0) {
          // Undefined direction (symmetric neighbourhood) — neutral, hue-free.
          data[idx] = this.#tokIvory.rgb.r; data[idx + 1] = this.#tokIvory.rgb.g; data[idx + 2] = this.#tokIvory.rgb.b;
          data[idx + 3] = 90;
          return;
        }
        const hueDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
        const rgb = sampleHueRamp(this.#hueRamp, hueDeg);
        data[idx] = rgb.r; data[idx + 1] = rgb.g; data[idx + 2] = rgb.b; data[idx + 3] = 255;
        return;
      }
      default: {
        data[idx] = this.#tokLife.rgb.r;
        data[idx + 1] = this.#tokLife.rgb.g;
        data[idx + 2] = this.#tokLife.rgb.b;
        data[idx + 3] = 255;
      }
    }
  }

  // ---------------------------------------------------------------------
  // Art mode: LFO evaluation, trails, the modulation field's colour/glyph
  // effects, and the glyph draw path itself. Everything below is reached
  // ONLY from `draw()`'s `artActive` branch — an app that never enables Art
  // mode never executes any of it.
  // ---------------------------------------------------------------------

  /** Sum every configured LFO's contribution per target, once per frame
   *  (never per cell — an LFO's value only depends on wall-clock time, so
   *  it's the same number for every cell this frame). Multiple LFOs may
   *  target the same parameter; their (depth-scaled) outputs simply add. */
  #evalLfos(art: ArtConfig, tSec: number): Partial<Record<LfoTarget, number>> {
    const acc: Partial<Record<LfoTarget, number>> = {};
    for (const l of art.lfos) {
      if (l.target === 'none') continue;
      const v = lfoValue(l.shape as LfoShape, tSec, l.rateHz, l.phase, hashStringSeed(l.id)) * l.depth;
      acc[l.target] = (acc[l.target] ?? 0) + v;
    }
    return acc;
  }

  #effectiveTrailDecay(): number {
    const base = this.#art?.color.trails.decay ?? 0.15;
    const lfo = this.#currentLfoAcc.trailLength ?? 0;
    return Math.min(0.9, Math.max(0.02, base * (1 + lfo)));
  }

  /** Fraction of live cells in a small (2*radius+1)^2 neighbourhood — the
   *  `density` glyph driver. Deliberately a plain box count over the raw
   *  bits (`engine.get`), same honesty guarantee as `#directionalBias`:
   *  nothing invented, nothing beyond what the engine already exposes. */
  #localDensity(engine: LifeEngine, x: number, y: number, radius = 2): number {
    let live = 0;
    let total = 0;
    for (let oy = -radius; oy <= radius; oy++) {
      for (let ox = -radius; ox <= radius; ox++) {
        total++;
        if (engine.get(x + ox, y + oy)) live++;
      }
    }
    return total > 0 ? live / total : 0;
  }

  /** The colour a live cell would have under the CURRENTLY ACTIVE lens —
   *  reimplements just the alive-cell cases of `#writeCellPixel` (never the
   *  dead-cell special casing `activity`/`neighbors` do, since Art mode's
   *  glyph path only ever visits live cells — see `#drawGlyphs`). Kept as
   *  its own method rather than refactoring `#writeCellPixel` to share it,
   *  so the existing, already-tested per-pixel path is untouched. */
  #aliveCellColorForGlyph(engine: LifeEngine, x: number, y: number): { rgb: RGB; alpha: number } {
    switch (this.#lens) {
      case 'age': {
        const age = engine.ageAt(x, y);
        const t = Math.min(1, age / AGE_RAMP_GENERATIONS);
        return { rgb: sampleRgbRamp(this.#ageRamp, t), alpha: Math.round((0.35 + 0.65 * t) * 255) };
      }
      case 'lineage':
        return { rgb: sampleHueRamp(this.#hueRamp, engine.hueAt(x, y)), alpha: 255 };
      case 'immigration': {
        const rgb = immigrationColorForSpecies(this.#immigrationPalette, engine.speciesAt(x, y));
        return { rgb: rgb ?? this.#tokLife.rgb, alpha: 255 };
      }
      case 'quadlife': {
        const rgb = quadColorForSpecies(this.#quadPalette, engine.speciesAt(x, y));
        return { rgb: rgb ?? this.#tokLife.rgb, alpha: 255 };
      }
      case 'velocity': {
        const { dx, dy } = this.#directionalBias(engine, x, y);
        if (dx === 0 && dy === 0) return { rgb: this.#tokIvory.rgb, alpha: 90 };
        const hueDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
        return { rgb: sampleHueRamp(this.#hueRamp, hueDeg), alpha: 255 };
      }
      case 'activity': {
        const heat = engine.activityAt(x, y);
        const eased = Math.pow(Math.min(1, heat), 0.6);
        return { rgb: sampleRgbRamp(this.#activityRamp, eased), alpha: Math.max(80, Math.round(eased * 255)) };
      }
      case 'neighbors': {
        const n = engine.liveNeighborCount(x, y);
        return { rgb: this.#neighborRamp[n] ?? this.#tokLife.rgb, alpha: 255 };
      }
      default:
        return { rgb: this.#tokLife.rgb, alpha: 255 };
    }
  }

  /** Resolve+cache a custom Art palette's CSS stop strings to RGB, keyed by
   *  the stops' own JSON — cheap to recompute only when the user actually
   *  edits the palette, never per cell/frame. Falls back per-stop to the
   *  `life` accent on an unparseable colour (e.g. a hand-edited import)
   *  rather than throwing mid-frame. */
  #resolveCustomStops(stops: readonly PaletteStop[]): RgbStop[] {
    const key = JSON.stringify(stops);
    if (key !== this.#customStopsCacheKey) {
      this.#customStopsRgb = stops
        .map((s) => {
          try {
            return { t: s.t, rgb: resolveCssColor(s.color) };
          } catch {
            return { t: s.t, rgb: this.#tokLife.rgb };
          }
        })
        .sort((a, b) => a.t - b.t);
      this.#customStopsCacheKey = key;
    }
    return this.#customStopsRgb;
  }

  /** Get (building + caching on first use) the glyph atlas for an exact
   *  character list at a device-pixel cell-size bucket. Cache is bounded so
   *  a long session of custom-string edits or an animated glyph-set LFO
   *  (which needs every built-in set's atlas available at once — see below)
   *  can't grow it unboundedly.
   *
   *  Real LRU, not FIFO: a `Map` already preserves insertion order, and
   *  re-inserting a key on every HIT (delete then set) moves it to the most-
   *  recently-used end for free, with eviction still just "read the first
   *  key" — no extra bookkeeping. This matters once an animated glyph-set
   *  LFO (`glyphSetShift` above) is cycling through several character lists
   *  at the SAME bucket: with plain insertion-order eviction, cycling
   *  through more than 24 (chars, bucket) combinations evicted whichever was
   *  simply oldest by wall-clock, including ones still in active rotation —
   *  paying a full rebuild for them again next cycle even though nothing
   *  about their zoom level had changed. Touching on every hit keeps
   *  anything still genuinely in use alive regardless of insertion order.
   *
   *  Key also includes whether the custom glyph webfont is confirmed loaded
   *  right now (see `isGlyphFontReady`'s doc in `glyphAtlas.ts`) — an atlas
   *  built BEFORE the font finished loading used the local system-monospace
   *  fallback (never the network-dependent custom face, which is what
   *  guarantees `buildGlyphAtlas` can never block the main thread). Folding
   *  readiness into the key means the exact moment the font finishes
   *  loading, the next `#ensureAtlas` call for the same (chars, bucket)
   *  naturally misses the old fallback-built entry and rebuilds with the
   *  real face — no stale fallback-font atlas lingers for the rest of the
   *  session, and no separate invalidation bookkeeping is needed. */
  #ensureAtlas(chars: readonly string[], bucket: number): GlyphAtlasHandle {
    const key = `${chars.join('')}|${bucket}|${isGlyphFontReady() ? 1 : 0}`;
    let atlas = this.#glyphAtlasCache.get(key);
    if (atlas) {
      this.#glyphAtlasCache.delete(key);
      this.#glyphAtlasCache.set(key, atlas);
    } else {
      atlas = buildGlyphAtlas(chars, bucket);
      this.#glyphAtlasCache.set(key, atlas);
      if (this.#glyphAtlasCache.size > 24) {
        const oldest = this.#glyphAtlasCache.keys().next().value;
        if (oldest) this.#glyphAtlasCache.delete(oldest);
      }
    }
    return atlas;
  }

  /**
   * The ASCII/glyph draw path: live cells only (HONESTY — see the module
   * doc and `WorldRenderer.setArtConfig`'s doc), each rendered as a cached
   * glyph raster tinted to that cell's colour, positioned with the exact
   * same shared-corner device-pixel rounding every other overlay in this
   * file uses (`#drawGhost`/`#drawSelection`/`#drawDiff`) — this is what
   * keeps the glyph grid "tight and even… no gaps or drift" at every zoom
   * level above the legibility floor, not just at one magic zoom value.
   */
  #drawGlyphs(engine: LifeEngine, rect: Rect): void {
    const art = this.#art!;
    const ctx = this.#ctx!;
    const dpr = this.#dpr;
    const spec = engine.spec;

    if (rect.w * rect.h > MAX_GLYPH_CELLS) { this.#drawZoomedIn(engine, rect); return; }

    // Cheap pre-count: only `engine.get()` + a wrap, no field/hue/draw work
    // — see `MAX_GLYPH_LIVE_CELLS`'s doc for why this (live cells), not the
    // rect-area check above, is the number that actually matters. Bailing
    // HERE, before any expensive per-cell work has run, is what makes this a
    // real pre-emptive bound rather than "notice it was too expensive after
    // already paying for it."
    let liveCount = 0;
    for (let j = 0; j < rect.h && liveCount <= MAX_GLYPH_LIVE_CELLS; j++) {
      const wy = wrap(rect.y + j, spec.height);
      for (let i = 0; i < rect.w; i++) {
        if (engine.get(wrap(rect.x + i, spec.width), wy)) liveCount++;
      }
    }
    if (liveCount > MAX_GLYPH_LIVE_CELLS) { this.#drawZoomedIn(engine, rect); return; }

    const tSec = this.#currentTSec;
    const lfoAcc = this.#currentLfoAcc;

    const devicePx = this.#camera.scale * dpr;
    const bucket = atlasCellPxBucket(devicePx);
    const baseChars = resolveGlyphChars(art.glyphs.setId, art.glyphs.customChars);
    let chars = baseChars;
    const glyphSetShift = lfoAcc.glyphSetIndex;
    if (glyphSetShift && art.glyphs.setId !== 'custom') {
      const ids = BUILTIN_GLYPH_SET_IDS;
      const baseIdx = Math.max(0, ids.indexOf(art.glyphs.setId as Exclude<GlyphSetId, 'custom'>));
      const n = ids.length;
      const shifted = (((baseIdx + Math.round(glyphSetShift * n)) % n) + n) % n;
      chars = GLYPH_SETS[ids[shifted]!];
    }
    const atlas = this.#ensureAtlas(chars, bucket);

    const fieldTransform: FieldTransform = {
      scale: Math.max(0.01, art.field.scale * (1 + (lfoAcc.fieldScale ?? 0))),
      offsetX: art.field.offsetX + (lfoAcc.fieldOffsetX ?? 0) * 50,
      offsetY: art.field.offsetY + (lfoAcc.fieldOffsetY ?? 0) * 50,
      rotationDeg: art.field.rotationDeg + (lfoAcc.fieldRotation ?? 0) * 180,
    };
    const fieldParams: FieldSampleParams = {
      source: art.field.source, seed: art.field.seed, transform: fieldTransform, grid: this.#artGrid,
    };
    const fieldOn = art.field.source !== 'none';
    const wantsGlyphField = fieldOn && art.field.targets.includes('glyph');
    const wantsHueField = fieldOn && art.field.targets.includes('hue');
    const wantsBrightnessField = fieldOn && art.field.targets.includes('brightness');
    const wantsJitterField = fieldOn && art.field.targets.includes('jitter');
    const needsFieldSample = wantsGlyphField || wantsHueField || wantsBrightnessField || wantsJitterField;

    const hueRotateBase = art.color.hueRotateDeg
      + (lfoAcc.hueRotate ?? 0) * 180
      + tSec * art.color.cycleSpeedHz * 360
      + (lfoAcc.paletteCycle ?? 0) * 180;
    const brightnessLfo = lfoAcc.brightness ?? 0;

    const customStops = art.color.source === 'custom' ? this.#resolveCustomStops(art.color.stops) : null;

    // Two passes over a buffered command list, rather than drawing+tinting
    // each cell immediately, so `globalCompositeOperation` is only ever
    // toggled TWICE per frame (once per pass) instead of twice PER LIVE
    // CELL — the second perf hypothesis from the "acid mode... destroyed the
    // machine" report (glyph atlas thrash, fixed above via `MAX_ATLAS_CELL_
    // PX`, was the dominant one, since it's the cost that actually scales
    // UP with zoom; this compositing-state churn scales with on-screen live
    // cell COUNT instead, worst at the low end near the legibility floor where
    // the most cells are visible at once — fixing it too closes out the
    // hypothesis rather than leaving it unchecked). Safe to reorder this way
    // even where jittered cells overlap: each `fillRect` only ever touches
    // the exact pixels its OWN `drawImage` call touched a moment earlier in
    // pass one, in the same relative per-cell order as before — a later
    // cell's tint still lands after an earlier cell's in either scheme, so
    // an overlap's visible winner is unchanged.
    // Reused instance arrays (see their field docs) — truncating via
    // `.length = 0` reuses the existing backing store instead of allocating 6
    // fresh arrays every single animated frame, on top of the per-cell work
    // below that's already unavoidable.
    const dxs = this.#glyphDx; dxs.length = 0;
    const dys = this.#glyphDy; dys.length = 0;
    const dws = this.#glyphDw; dws.length = 0;
    const dhs = this.#glyphDh; dhs.length = 0;
    const sxs = this.#glyphSx; sxs.length = 0;
    const fillStyles = this.#glyphFillStyles; fillStyles.length = 0;
    // Per-frame colour->fillStyle dedup — see `#fillStyleCache`'s field doc
    // for why this is cleared every call rather than persisted.
    const fillStyleCache = this.#fillStyleCache; fillStyleCache.clear();

    for (let j = 0; j < rect.h; j++) {
      const wy = wrap(rect.y + j, spec.height);
      for (let i = 0; i < rect.w; i++) {
        const wx = wrap(rect.x + i, spec.width);
        if (!engine.get(wx, wy)) continue; // HONESTY: never draw a glyph for a dead cell.

        let baseT: number;
        switch (art.glyphs.driver) {
          case 'age': baseT = normalizeAge(engine.ageAt(wx, wy)); break;
          case 'activity': baseT = normalizeActivity(engine.activityAt(wx, wy)); break;
          case 'neighbors': baseT = normalizeNeighbors(engine.liveNeighborCount(wx, wy)); break;
          case 'lineage': baseT = normalizeLineage(engine.hueAt(wx, wy)); break;
          case 'density': baseT = normalizeDensity(this.#localDensity(engine, wx, wy)); break;
          case 'field': baseT = normalizeField(sampleField(fieldParams, wx, wy, tSec)); break;
          default: baseT = 0.5;
        }

        const fieldSample = needsFieldSample ? sampleField(fieldParams, wx, wy, tSec) : 0.5;
        let glyphT = baseT;
        if (wantsGlyphField && art.glyphs.driver !== 'field') {
          glyphT = Math.min(1, Math.max(0, baseT * 0.6 + fieldSample * 0.4));
        }
        const glyphIndex = glyphIndexForValue(glyphT, chars.length);
        const srcRect = atlas.rectFor(glyphIndex);

        let rgb: RGB;
        let alpha: number;
        if (customStops) {
          rgb = sampleStopsRgb(customStops, art.glyphs.driver === 'field' ? glyphT : baseT);
          alpha = 255;
        } else {
          const c = this.#aliveCellColorForGlyph(engine, wx, wy);
          rgb = c.rgb;
          alpha = c.alpha;
        }

        let effectiveHue = hueRotateBase;
        if (wantsHueField) effectiveHue += (fieldSample - 0.5) * 360;
        if (((effectiveHue % 360) + 360) % 360 !== 0) rgb = rotateHueRgb(rgb, effectiveHue);

        let brightness = 1 + brightnessLfo;
        if (wantsBrightnessField) brightness *= 0.4 + fieldSample * 1.2;
        brightness = Math.min(1.8, Math.max(0.15, brightness));
        alpha = Math.min(255, Math.max(0, Math.round(alpha * brightness)));

        const p0 = this.worldToScreen(wx, wy);
        const p1 = this.worldToScreen(wx + 1, wy + 1);
        let dx = Math.round(p0.x * dpr);
        let dy = Math.round(p0.y * dpr);
        const dw = Math.max(1, Math.round(p1.x * dpr) - dx);
        const dh = Math.max(1, Math.round(p1.y * dpr) - dy);

        if (wantsJitterField && fieldSample > 0) {
          const seedA = ((wx * 92821 + wy * 68917) % 997 + 997) % 997;
          const seedB = ((wx * 68917 + wy * 92821 + 50) % 997 + 997) % 997;
          const j1 = smoothNoise1D(tSec * 0.5 + wx * 0.7 + wy * 0.31, seedA);
          const j2 = smoothNoise1D(tSec * 0.5 + wx * 0.31 + wy * 0.7, seedB);
          const amp = dw * 0.22 * fieldSample;
          dx = Math.round(dx + (j1 - 0.5) * 2 * amp);
          dy = Math.round(dy + (j2 - 0.5) * 2 * amp);
        }

        // Exact (not quantised) byte-tuple key — `alpha` is already an
        // integer 0..255 by this point (`Math.round` above), so this cache
        // hits every time a cell shares its EXACT colour with an earlier one
        // this frame (routine: many cells land in the same ramp bucket) and
        // never trades correctness for a coarser bucket. Bitwise ops are
        // 32-bit signed in JS, so the top byte can produce a negative key —
        // irrelevant for a `Map`, which just needs distinct keys per tuple.
        const styleKey = ((rgb.r & 255) << 24) | ((rgb.g & 255) << 16) | ((rgb.b & 255) << 8) | (alpha & 255);
        let fillStyle = fillStyleCache.get(styleKey);
        if (fillStyle === undefined) {
          fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${(alpha / 255).toFixed(3)})`;
          fillStyleCache.set(styleKey, fillStyle);
        }

        dxs.push(dx); dys.push(dy); dws.push(dw); dhs.push(dh); sxs.push(srcRect.sx);
        fillStyles.push(fillStyle);
      }
    }

    ctx.save();
    const n = dxs.length;
    const cellPx = atlas.cellPx;
    ctx.globalCompositeOperation = 'source-over';
    for (let k = 0; k < n; k++) {
      ctx.drawImage(atlas.canvas, sxs[k]!, 0, cellPx, cellPx, dxs[k]!, dys[k]!, dws[k]!, dhs[k]!);
    }
    ctx.globalCompositeOperation = 'source-in';
    for (let k = 0; k < n; k++) {
      ctx.fillStyle = fillStyles[k]!;
      ctx.fillRect(dxs[k]!, dys[k]!, dws[k]!, dhs[k]!);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();
  }

  #drawZoomedIn(engine: LifeEngine, rect: Rect): void {
    const spec = engine.spec;
    const cellCtx = this.#ensureCellCanvas(rect.w, rect.h);
    const img = cellCtx.createImageData(rect.w, rect.h);
    const data = img.data;

    for (let j = 0; j < rect.h; j++) {
      const wy = wrap(rect.y + j, spec.height);
      for (let i = 0; i < rect.w; i++) {
        const wx = wrap(rect.x + i, spec.width);
        this.#writeCellPixel(engine, wx, wy, data, (j * rect.w + i) * 4);
      }
    }
    cellCtx.putImageData(img, 0, 0);

    const dst = this.worldToScreen(rect.x, rect.y);
    const dx = Math.round(dst.x * this.#dpr);
    const dy = Math.round(dst.y * this.#dpr);
    const dw = Math.round(rect.w * this.#camera.scale * this.#dpr);
    const dh = Math.round(rect.h * this.#camera.scale * this.#dpr);

    const ctx = this.#ctx!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.#cellCanvas!, 0, 0, rect.w, rect.h, dx, dy, dw, dh);
  }

  #drawZoomedOut(engine: LifeEngine, rect: Rect): void {
    const spec = engine.spec;
    const scale = this.#camera.scale;
    const lens = this.#lens;
    // Size the coverage buffer in DEVICE pixels (scale * dpr), not CSS
    // pixels — on a high-DPR display the previous CSS-pixel sizing meant
    // this buffer covered a quarter as many output pixels as the canvas
    // actually has at dpr=2, so the final `drawImage` upscaled it, blurring
    // the aggregation and (worse) making its 1-buffer-pixel-per-CSS-pixel
    // assumption used by `coverageAlpha` inconsistent with what's really on
    // screen. See BUG 3's "DPR not accounted for" suspect.
    const bufW = Math.max(1, Math.round(rect.w * scale * this.#dpr));
    const bufH = Math.max(1, Math.round(rect.h * scale * this.#dpr));
    const cellsPerPxX = rect.w / bufW;
    const cellsPerPxY = rect.h / bufH;

    const n = bufW * bufH;
    const area = new Float32Array(n);
    const liveCount = new Float32Array(n);
    const ageSum = lens === 'age' ? new Float32Array(n) : null;
    const heatMax = lens === 'activity' ? new Float32Array(n) : null;
    // 'lineage'/'velocity': accumulate hue as a circular-mean vector (cos/sin
    // sums), not a naive average — a genuine BLEND of the covered cells'
    // directions/hues, not a point sample. Both share one accumulator shape.
    const hueSin = (lens === 'lineage' || lens === 'velocity') ? new Float32Array(n) : null;
    const hueCos = (lens === 'lineage' || lens === 'velocity') ? new Float32Array(n) : null;
    // 'immigration'/'quadlife': per-species live counts, blended by weight at
    // the end rather than snapping to whichever species a single sampled
    // cell happened to be — this is what makes a colony border read as an
    // actual blended colour instead of dithering between two flat swatches.
    const speciesCount = (lens === 'immigration' || lens === 'quadlife') ? [
      new Float32Array(n), new Float32Array(n), new Float32Array(n), new Float32Array(n),
    ] : null;
    // 'neighbors': unlike every other lens this one covers DEAD cells too
    // (birth-eligible cells read as meaningfully as live ones — see
    // `#writeCellPixel`), so it tracks its own coverage fraction rather than
    // reusing `liveCount`.
    const neighborSum = lens === 'neighbors' ? new Float32Array(n) : null;
    const neighborNonZero = lens === 'neighbors' ? new Float32Array(n) : null;

    for (let j = 0; j < rect.h; j++) {
      const wy = wrap(rect.y + j, spec.height);
      const by = Math.min(bufH - 1, Math.floor(j / cellsPerPxY));
      for (let i = 0; i < rect.w; i++) {
        const wx = wrap(rect.x + i, spec.width);
        const bx = Math.min(bufW - 1, Math.floor(i / cellsPerPxX));
        const bidx = by * bufW + bx;
        area[bidx]! += 1;

        if (lens === 'activity') {
          const heat = engine.activityAt(wx, wy);
          if (heat > heatMax![bidx]!) heatMax![bidx] = heat;
          if (heat > 0.01) liveCount[bidx]! += 1;
          continue;
        }
        if (lens === 'neighbors') {
          const cnt = engine.liveNeighborCount(wx, wy);
          if (cnt > 0) {
            neighborSum![bidx]! += cnt;
            neighborNonZero![bidx]! += 1;
          }
          if (engine.get(wx, wy)) liveCount[bidx]! += 1;
          continue;
        }

        const alive = engine.get(wx, wy);
        if (!alive) continue;
        liveCount[bidx]! += 1;
        if (lens === 'age') ageSum![bidx]! += engine.ageAt(wx, wy);
        if (lens === 'lineage') {
          const r = (engine.hueAt(wx, wy) * Math.PI) / 180;
          hueCos![bidx]! += Math.cos(r);
          hueSin![bidx]! += Math.sin(r);
        }
        if (lens === 'velocity') {
          const { dx, dy } = this.#directionalBias(engine, wx, wy);
          if (dx !== 0 || dy !== 0) {
            const r = Math.atan2(dy, dx);
            hueCos![bidx]! += Math.cos(r);
            hueSin![bidx]! += Math.sin(r);
          }
        }
        if (speciesCount) {
          const sp = engine.speciesAt(wx, wy);
          if (sp >= 1 && sp <= 4) speciesCount[sp - 1]![bidx]! += 1;
        }
      }
    }

    const cellCtx = this.#ensureCellCanvas(bufW, bufH);
    const img = cellCtx.createImageData(bufW, bufH);
    const data = img.data;
    const singleToken = lens === 'age' ? this.#tokAge : lens === 'activity' ? this.#tokActivity : this.#tokLife;

    for (let p = 0; p < n; p++) {
      const a = area[p] || 1;
      const heat = heatMax ? heatMax[p]! : 0;
      const idx = p * 4;

      if (lens === 'neighbors') {
        const nz = neighborNonZero![p]!;
        if (nz <= 0) continue;
        const avgCount = Math.round(neighborSum![p]! / nz);
        const rgb = this.#neighborRamp[Math.min(8, Math.max(0, avgCount))]!;
        const alpha = coverageAlpha(nz / a) * (liveCount[p]! > 0 ? 1 : 0.55);
        data[idx] = rgb.r; data[idx + 1] = rgb.g; data[idx + 2] = rgb.b;
        data[idx + 3] = Math.round(Math.min(1, Math.max(0, alpha)) * 255);
        continue;
      }

      const frac = liveCount[p]! / a;
      if (frac <= 0 && heat <= 0) continue;

      if (lens === 'lineage' || lens === 'velocity') {
        if (lens === 'velocity' && hueCos![p] === 0 && hueSin![p] === 0) {
          // No cell in this bucket had a defined direction — neutral grey,
          // never an arbitrary hue.
          data[idx] = this.#tokIvory.rgb.r; data[idx + 1] = this.#tokIvory.rgb.g; data[idx + 2] = this.#tokIvory.rgb.b;
          data[idx + 3] = Math.round(coverageAlpha(frac) * 0.4 * 255);
          continue;
        }
        const meanHue = (Math.atan2(hueSin![p]!, hueCos![p]!) * 180) / Math.PI;
        const rgb = sampleHueRamp(this.#hueRamp, meanHue);
        data[idx] = rgb.r; data[idx + 1] = rgb.g; data[idx + 2] = rgb.b;
        data[idx + 3] = Math.round(coverageAlpha(frac) * 255);
        continue;
      }

      if (speciesCount) {
        const weights = [speciesCount[0]![p]!, speciesCount[1]![p]!, speciesCount[2]![p]!, speciesCount[3]![p]!];
        const palette = lens === 'quadlife'
          ? this.#quadPalette
          : [this.#immigrationPalette[0], this.#immigrationPalette[0], this.#immigrationPalette[1], this.#immigrationPalette[1]];
        const rgb = blendRgbWeighted(palette, weights);
        data[idx] = rgb.r; data[idx + 1] = rgb.g; data[idx + 2] = rgb.b;
        data[idx + 3] = Math.round(coverageAlpha(frac) * 255);
        continue;
      }

      let alpha = lens === 'activity' ? Math.pow(Math.min(1, heat), 0.6) : coverageAlpha(frac);
      let rgb: RGB = singleToken.rgb;
      if (lens === 'age' && liveCount[p]! > 0) {
        const avgAge = ageSum![p]! / liveCount[p]!;
        const t = Math.min(1, avgAge / AGE_RAMP_GENERATIONS);
        rgb = sampleRgbRamp(this.#ageRamp, t);
        alpha = Math.min(1, alpha * (0.5 + 0.5 * t));
      } else if (lens === 'activity') {
        rgb = sampleRgbRamp(this.#activityRamp, Math.pow(Math.min(1, heat), 0.6));
      }

      data[idx] = rgb.r;
      data[idx + 1] = rgb.g;
      data[idx + 2] = rgb.b;
      data[idx + 3] = Math.round(Math.min(1, Math.max(0, alpha)) * 255);
    }
    cellCtx.putImageData(img, 0, 0);

    const dst = this.worldToScreen(rect.x, rect.y);
    const dx = Math.round(dst.x * this.#dpr);
    const dy = Math.round(dst.y * this.#dpr);
    const dw = Math.round(rect.w * scale * this.#dpr);
    const dh = Math.round(rect.h * scale * this.#dpr);

    const ctx = this.#ctx!;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.#cellCanvas!, 0, 0, bufW, bufH, dx, dy, dw, dh);
  }

  /**
   * BUG 2 fix: paint cells from an in-progress, not-yet-committed draw/erase
   * gesture immediately, so a stroke is visible under the cursor in real
   * time — regardless of play/pause state and independent of whenever the
   * caller actually flushes the edit into the engine (instantly while
   * paused; deferred to the next generation boundary while playing). Alive
   * cells render as a strong "wet paint" life-coloured fill; erased cells as
   * a dark cover, since the live cell beneath is still in the engine until
   * commit.
   */
  #drawStrokePreview(cells: ReadonlyArray<{ x: number; y: number; alive: boolean }>): void {
    const ctx = this.#ctx!;
    const dpr = this.#dpr;
    ctx.save();
    for (const c of cells) {
      const p0 = this.worldToScreen(c.x, c.y);
      const p1 = this.worldToScreen(c.x + 1, c.y + 1);
      const rx = Math.round(p0.x * dpr);
      const ry = Math.round(p0.y * dpr);
      const rw = Math.max(1, Math.round(p1.x * dpr) - rx);
      const rh = Math.max(1, Math.round(p1.y * dpr) - ry);
      ctx.fillStyle = c.alive ? withAlpha(this.#tokLife, 0.95) : withAlpha(this.#tokLineStrong, 0.95);
      ctx.fillRect(rx, ry, rw, rh);
    }
    ctx.restore();
  }

  #drawGrid(rect: Rect): void {
    const ctx = this.#ctx!;
    const dpr = this.#dpr;
    const canvas = this.#canvas!;
    const startX = rect.x;
    const endX = rect.x + rect.w;
    const startY = rect.y;
    const endY = rect.y + rect.h;

    ctx.save();
    ctx.lineWidth = 1;

    ctx.strokeStyle = this.#tokLine.css;
    ctx.beginPath();
    for (let gx = Math.ceil(startX); gx <= endX; gx++) {
      if (gx % GRID_MAJOR_EVERY === 0) continue;
      const sx = Math.round(this.worldToScreen(gx, 0).x * dpr) + 0.5;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, canvas.height);
    }
    for (let gy = Math.ceil(startY); gy <= endY; gy++) {
      if (gy % GRID_MAJOR_EVERY === 0) continue;
      const sy = Math.round(this.worldToScreen(0, gy).y * dpr) + 0.5;
      ctx.moveTo(0, sy);
      ctx.lineTo(canvas.width, sy);
    }
    ctx.stroke();

    ctx.strokeStyle = this.#tokLineStrong.css;
    ctx.beginPath();
    const firstMajorX = Math.ceil(startX / GRID_MAJOR_EVERY) * GRID_MAJOR_EVERY;
    for (let gx = firstMajorX; gx <= endX; gx += GRID_MAJOR_EVERY) {
      const sx = Math.round(this.worldToScreen(gx, 0).x * dpr) + 0.5;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, canvas.height);
    }
    const firstMajorY = Math.ceil(startY / GRID_MAJOR_EVERY) * GRID_MAJOR_EVERY;
    for (let gy = firstMajorY; gy <= endY; gy += GRID_MAJOR_EVERY) {
      const sy = Math.round(this.worldToScreen(0, gy).y * dpr) + 0.5;
      ctx.moveTo(0, sy);
      ctx.lineTo(canvas.width, sy);
    }
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Draws a dashed hairline at every world x/y where the content actually
   * drawn THIS FRAME (`rect` — the exact same value `#drawZoomedIn`/
   * `#drawZoomedOut`/`#drawGlyphs` just blitted from) wraps. See
   * `computeTorusSeams`'s doc for why this is seam lines rather than a
   * bounding rect, and why deriving from `rect` (not `camera` again) is what
   * makes this impossible to desync from the rendered cells. Draws nothing
   * at all when no seam is currently on screen — the honest answer, rather
   * than a stale or guessed box sitting somewhere unrelated to the world.
   */
  #drawTorusBoundary(rect: Rect, spec: { width: number; height: number }): void {
    const { xs, ys } = computeTorusSeams(rect, spec);
    if (xs.length === 0 && ys.length === 0) return;

    const ctx = this.#ctx!;
    const dpr = this.#dpr;
    ctx.save();
    // A neutral hairline (`--color-line-strong`, "the active edge" per
    // DESIGN.md §1's own table), not `--color-accent-warn` — wrapping is
    // geography, not something destructive or attention-needing, which is
    // that token's one fixed meaning.
    ctx.strokeStyle = withAlpha(this.#tokLineStrong, 0.55);
    ctx.lineWidth = 1;
    ctx.setLineDash([4 * dpr, 4 * dpr]);
    ctx.beginPath();
    for (const x of xs) {
      const p0 = this.worldToScreen(x, rect.y);
      const p1 = this.worldToScreen(x, rect.y + rect.h);
      const sx = Math.round(p0.x * dpr) + 0.5;
      ctx.moveTo(sx, Math.round(p0.y * dpr));
      ctx.lineTo(sx, Math.round(p1.y * dpr));
    }
    for (const y of ys) {
      const p0 = this.worldToScreen(rect.x, y);
      const p1 = this.worldToScreen(rect.x + rect.w, y);
      const sy = Math.round(p0.y * dpr) + 0.5;
      ctx.moveTo(Math.round(p0.x * dpr), sy);
      ctx.lineTo(Math.round(p1.x * dpr), sy);
    }
    ctx.stroke();
    ctx.restore();
  }

  #drawSelection(rect: Rect): void {
    const ctx = this.#ctx!;
    const dpr = this.#dpr;
    const tl = this.worldToScreen(rect.x, rect.y);
    const br = this.worldToScreen(rect.x + rect.w, rect.y + rect.h);
    // Snap to device-pixel cell boundaries — never fractional pixels.
    const x0 = Math.round(tl.x * dpr);
    const y0 = Math.round(tl.y * dpr);
    const x1 = Math.round(br.x * dpr);
    const y1 = Math.round(br.y * dpr);

    ctx.save();
    ctx.fillStyle = withAlpha(this.#tokIvory, 0.08);
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    ctx.strokeStyle = withAlpha(this.#tokIvory, 0.9);
    ctx.lineWidth = 1;
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0 - 1, y1 - y0 - 1);
    ctx.restore();
  }

  #drawGhost(ghost: GhostState): void {
    const ctx = this.#ctx!;
    const dpr = this.#dpr;
    const { pattern, x, y, transform } = ghost;
    const { w, h, cells } = transformPattern(pattern, transform);

    ctx.save();
    ctx.fillStyle = withAlpha(this.#tokLife, 0.4);
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        if (!cells[j * w + i]) continue;
        const p0 = this.worldToScreen(x + i, y + j);
        const p1 = this.worldToScreen(x + i + 1, y + j + 1);
        const rx = Math.round(p0.x * dpr);
        const ry = Math.round(p0.y * dpr);
        ctx.fillRect(rx, ry, Math.max(1, Math.round(p1.x * dpr) - rx), Math.max(1, Math.round(p1.y * dpr) - ry));
      }
    }

    const tl = this.worldToScreen(x, y);
    const br = this.worldToScreen(x + w, y + h);
    ctx.strokeStyle = this.#tokIvory.css;
    ctx.lineWidth = 1;
    ctx.strokeRect(
      Math.round(tl.x * dpr) + 0.5,
      Math.round(tl.y * dpr) + 0.5,
      Math.round((br.x - tl.x) * dpr) - 1,
      Math.round((br.y - tl.y) * dpr) - 1,
    );
    ctx.restore();
  }

  #drawDiff(rect: Rect, cells: Uint8Array): void {
    const ctx = this.#ctx!;
    const dpr = this.#dpr;
    ctx.save();
    for (let j = 0; j < rect.h; j++) {
      for (let i = 0; i < rect.w; i++) {
        const v = cells[j * rect.w + i];
        if (!v) continue;
        const p0 = this.worldToScreen(rect.x + i, rect.y + j);
        const p1 = this.worldToScreen(rect.x + i + 1, rect.y + j + 1);
        const rx = Math.round(p0.x * dpr);
        const ry = Math.round(p0.y * dpr);
        const rw = Math.max(1, Math.round(p1.x * dpr) - rx);
        const rh = Math.max(1, Math.round(p1.y * dpr) - ry);
        if (v === 1) {
          // A-only: solid fill.
          ctx.fillStyle = withAlpha(this.#tokDiff, 0.6);
          ctx.fillRect(rx, ry, rw, rh);
        } else {
          // B-only: diagonal hatch, so it reads without colour too.
          ctx.fillStyle = withAlpha(this.#tokDiff, 0.22);
          ctx.fillRect(rx, ry, rw, rh);
          ctx.strokeStyle = withAlpha(this.#tokDiff, 0.9);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(rx, ry + rh);
          ctx.lineTo(rx + rw, ry);
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  async exportImage(opts: ExportImageOptions = {}): Promise<Blob> {
    if (!this.#canvas) throw new Error('exportImage: renderer not attached');
    const scale = opts.scale ?? 2;
    const bare = opts.bare ?? false;
    const mimeType = opts.mimeType ?? 'image/png';
    const caption = opts.caption ?? true;

    // Render through the same pipeline at a higher-resolution offscreen target
    // by temporarily redirecting internal canvas/ctx/dpr, then restoring them.
    const engineRef = this.#lastEngine;
    if (!engineRef) throw new Error('exportImage: nothing has been drawn yet');

    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = Math.max(1, Math.round(this.#cssW * scale));
    exportCanvas.height = Math.max(1, Math.round(this.#cssH * scale));
    const exportCtx = exportCanvas.getContext('2d')!;

    const savedCanvas = this.#canvas;
    const savedCtx = this.#ctx;
    const savedDpr = this.#dpr;
    this.#canvas = exportCanvas;
    this.#ctx = exportCtx;
    this.#dpr = scale;

    try {
      this.draw(engineRef, bare ? { selection: null, ghost: null, diff: null, grid: false } : undefined);
    } finally {
      this.#canvas = savedCanvas;
      this.#ctx = savedCtx;
      this.#dpr = savedDpr;
    }

    if (caption) {
      const fontPx = Math.max(10, Math.round(12 * scale));
      exportCtx.save();
      exportCtx.font = `${fontPx}px "JetBrains Mono Variable", ui-monospace, monospace`;
      exportCtx.fillStyle = this.#tokIvory.css;
      exportCtx.textBaseline = 'bottom';
      const text = `gen ${engineRef.gen} · B3/S23`;
      exportCtx.fillText(text, 8 * scale, exportCanvas.height - 8 * scale);
      exportCtx.restore();
    }

    return new Promise<Blob>((resolve, reject) => {
      exportCanvas.toBlob((blob) => {
        if (blob) resolve(blob); else reject(new Error('exportImage: toBlob failed'));
      }, mimeType);
    });
  }

  #lastEngine: LifeEngine | null = null;

  dispose(): void {
    this.#canvas = null;
    this.#ctx = null;
    this.#cellCanvas = null;
    this.#cellCtx = null;
    this.#lastEngine = null;
    this.#art = null;
    this.#artGrid = null;
    this.#glyphAtlasCache.clear();
    this.#fillStyleCache.clear();
    this.#artFrameMsWindow = [];
    this.#artWatchdogTripped = false;
    this.#artWatchdogReason = null;
  }
}

export function createRenderer(): WorldRenderer {
  return new WorldRendererImpl();
}

/** Convenience: cell under a screen point, floored. */
export function cellAt(r: WorldRenderer, px: number, py: number): CellCoord {
  const w = r.screenToWorld(px, py);
  return { x: Math.floor(w.x), y: Math.floor(w.y) };
}
