/**
 * The glyph raster cache for Art mode's ASCII/character rendering. Owned by
 * the `render` agent (`src/render/**`).
 *
 * PERFORMANCE CONTRACT: every character in the active glyph set is rasterised
 * to an offscreen canvas ONCE (on build/rebuild — glyph set change, custom
 * string edit, or a materially different device-pixel cell size), never per
 * cell per frame. `fillText` is genuinely expensive (font shaping + hinting)
 * and calling it per cell for a 512x512 world would be the "catastrophically
 * slow" failure mode the brief calls out explicitly.
 *
 * Glyphs are rasterised in flat WHITE (full-alpha shape, transparent
 * elsewhere) rather than any particular colour, so one atlas serves every
 * colour a cell might need: the renderer draws the white glyph with
 * `drawImage` (a cheap blit, no text engine involved), then recolours just
 * that cell's rect with a `'source-in'` composited `fillRect` — two cheap
 * canvas ops per visible cell instead of one `fillText` per cell, and no
 * atlas rebuild is ever needed just because a colour (hue rotation, an LFO,
 * a modulation field) changed.
 *
 * Uses the app's self-hosted JetBrains Mono Variable (already the numerals
 * face everywhere else — `--font-mono` in `tokens.css`) so ASCII mode reads
 * as genuinely typeset, matching the project's own typographic identity,
 * not a generic system-monospace fallback.
 */

export const GLYPH_FONT_STACK = '"JetBrains Mono Variable", ui-monospace, "SFMono-Regular", Menlo, monospace';

/** The same stack with the custom webfont removed — every remaining face is
 *  either a locally-installed system font (`ui-monospace`/`SFMono-Regular`/
 *  Menlo) or the generic `monospace` fallback, none of which ever require a
 *  network fetch, so `fillText` with this stack can NEVER hit the
 *  synchronous webfont-load block described below. Used by `buildGlyphAtlas`
 *  whenever the real face isn't confirmed loaded yet. */
const GLYPH_FALLBACK_FONT_STACK = 'ui-monospace, "SFMono-Regular", Menlo, monospace';

/**
 * A CONFIRMED, INDEPENDENTLY REAL contributing risk to the "Art mode
 * hard-crashed a Mac while rendering nothing visible" production report —
 * found while measuring the glyph path directly (`e2e/art-perf.spec.ts`),
 * though NOT proven to be the sole or even dominant cause of every stall
 * reproduced there (see `renderer.ts`'s frame-time watchdog doc for the full
 * picture, including what was ruled out). This one is real regardless: unlike
 * DOM/CSS text (which renders progressively — FOUT/FOIT — while a webfont
 * loads), a `<canvas>` 2D context's `fillText` BLOCKS THE MAIN THREAD
 * SYNCHRONOUSLY the first time it's asked to draw with a font that hasn't
 * finished loading yet — a real, spec-documented Canvas2D/Font-Loading
 * interaction, not specific to this app. `buildGlyphAtlas` below is the ONLY
 * place this codebase calls `fillText` with the custom "JetBrains Mono
 * Variable" webfont, and `artMount.ts` applies a PERSISTED `enabled: true`
 * Art config immediately on every boot (so a returning user's preference
 * survives a reload) — meaning a returning user with Art mode left on would
 * hit this exact synchronous-load risk on every page load, competing with
 * everything else boot does for the network/disk. Worth closing regardless
 * of how much of the originally measured stall it explains.
 *
 * FIX, two layers (a warm-up alone was NOT reliably fast enough in testing —
 * still blocked for over a second with roughly half a second of head start,
 * an entirely realistic amount of time for a fast/returning user to reach
 * Art mode in):
 *
 *  1. Kick off a real (async, non-blocking) load of this exact font via the
 *     standard CSS Font Loading API as early as this module is ever
 *     imported — `renderer.ts` imports `buildGlyphAtlas` unconditionally at
 *     construction time (see `createRenderer()`), so this fires at app boot
 *     for every session, whether or not Art mode is ever used. This head
 *     start helps the common case but is NOT the safety guarantee — a slow
 *     enough network/disk can still leave the font unloaded by the time
 *     Art mode first needs it.
 *  2. The actual guarantee: `buildGlyphAtlas` (below) checks
 *     `document.fonts.check()` — a synchronous, NON-blocking query that
 *     never itself triggers a load — before ever setting `ctx.font` to the
 *     custom face. If it isn't confirmed ready yet, the atlas is built with
 *     `GLYPH_FALLBACK_FONT_STACK` instead (every face in it is a local
 *     system font — zero network cost, so `fillText` can never block on it)
 *     — Art mode still renders immediately, just in a system-monospace face
 *     for the brief window until the real font finishes loading, rather
 *     than freezing the tab to wait for it. `renderer.ts`'s atlas cache key
 *     includes this readiness flag (see its own doc), so the moment the real
 *     font DOES finish loading, the next frame naturally rebuilds with it —
 *     no permanent fallback, no stale atlas, and the rebuild itself is cheap
 *     (the font is loaded by then, so no block).
 *
 * Together: no user can ever hit the synchronous block this file used to
 * risk, on any timing, without losing the feature — worst case is a
 * fraction-of-a-second cosmetic font substitution, not a frozen tab.
 */
if (typeof document !== 'undefined' && document.fonts?.load) {
  void document.fonts.load(`16px ${GLYPH_FONT_STACK}`).catch(() => {
    // Best-effort warm-up only — see this block's doc above; `isGlyphFontReady`
    // below is what actually GUARANTEES no synchronous block regardless of
    // whether this settles in time.
  });
}

/**
 * Synchronous, non-blocking (never itself triggers a load — see the
 * `document.fonts.check()` spec) check: is the custom webfont confirmed
 * loaded and available to `fillText` right now? `buildGlyphAtlas` uses this
 * to decide which font stack is SAFE to use this call — see the doc above
 * for why this, not the warm-up alone, is the real guarantee. Environments
 * with no Font Loading API at all (SSR, `vitest`'s jsdom) report `true`:
 * there's no async loading concept to race there in the first place, and
 * jsdom doesn't implement canvas `getContext` at all, so `buildGlyphAtlas`
 * is never actually invoked under it regardless.
 */
export function isGlyphFontReady(): boolean {
  if (typeof document === 'undefined' || !document.fonts?.check) return true;
  try {
    return document.fonts.check(`16px ${GLYPH_FONT_STACK}`);
  } catch {
    return false; // an unparsable/unsupported check argument — degrade to the always-safe fallback, never throw
  }
}

export interface AtlasRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/**
 * Pure layout: index -> source rect within a single-row atlas strip of
 * `count` cells, each `cellPx` device pixels square. Exported separately so
 * the indexing maths is testable without ever creating a canvas.
 */
export function atlasCellRect(index: number, cellPx: number): AtlasRect {
  return { sx: index * cellPx, sy: 0, sw: cellPx, sh: cellPx };
}

export function atlasCanvasSize(charCount: number, cellPx: number): { w: number; h: number } {
  return { w: Math.max(1, charCount) * cellPx, h: cellPx };
}

export interface GlyphAtlasHandle {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  cellPx: number;
  chars: readonly string[];
  rectFor(index: number): AtlasRect;
}

/**
 * Count of atlas rasters actually built (one `document.createElement
 * ('canvas')` + N `fillText` calls each) since page load. Dev/test
 * instrumentation only — never read by anything on the hot draw path, never
 * influences rendering. Exists so `WorldRenderer.getArtDebugStats()` (and the
 * perf e2e harness in `e2e/art-perf.spec.ts`, built after a real production
 * crash report — see that file's doc) can assert atlas churn actually stays
 * bounded (capped at `#glyphAtlasCache`'s 24-entry LRU in `renderer.ts`)
 * instead of trusting a comment.
 */
let atlasBuildCount = 0;

/** Current value of the atlas-build counter. Monotonic for the life of the page. */
export function getAtlasBuildCount(): number {
  return atlasBuildCount;
}

/**
 * Build (or rebuild) a glyph atlas for `chars` at `cellPx` DEVICE pixels per
 * cell. Centres each glyph in its cell with `textAlign='center'`/
 * `textBaseline='middle'`, at a font size just under the cell so dense
 * characters (`@`, `%`, box-drawing) don't clip — this is what keeps the
 * grid reading as "tight and even" rather than "squares with letters
 * stamped on them": every cell is exactly `cellPx` wide with no inter-glyph
 * gap, and the glyph itself is optically centred within it.
 */
export function buildGlyphAtlas(chars: readonly string[], cellPx: number): GlyphAtlasHandle {
  atlasBuildCount += 1;
  const px = Math.max(1, Math.round(cellPx));
  const { w, h } = atlasCanvasSize(chars.length, px);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // 0.86x the cell: large enough to read as solid ink for '@'/'#' while
  // leaving enough margin that JetBrains Mono's tallest glyphs never clip
  // the cell above/below at typical DPR rounding.
  const fontPx = Math.max(1, Math.round(px * 0.86));
  // See `isGlyphFontReady`'s doc: never risk the synchronous webfont-load
  // block by setting `ctx.font` to the custom face before it's CONFIRMED
  // loaded — a local system-monospace substitute for one frame beats
  // freezing the tab to wait for a network fetch.
  ctx.font = `${fontPx}px ${isGlyphFontReady() ? GLYPH_FONT_STACK : GLYPH_FALLBACK_FONT_STACK}`;
  for (let i = 0; i < chars.length; i++) {
    const cx = i * px + px / 2;
    const cy = h / 2;
    ctx.fillText(chars[i]!, cx, cy);
  }
  return {
    canvas,
    cellPx: px,
    chars,
    rectFor: (index: number) => atlasCellRect(Math.min(chars.length - 1, Math.max(0, index)), px),
  };
}

/**
 * Hard cap on the RASTER resolution an atlas is ever built at, independent
 * of how large a cell actually appears on screen. `#drawGlyphs` always blits
 * via `drawImage(atlas.canvas, srcRect, dx, dy, dw, dh)` — a source rect at
 * this fixed size scaled to whatever `dw`/`dh` the current zoom actually
 * needs — so raster resolution and on-screen size were already decoupled;
 * nothing stopped the BUCKET from growing unbounded with zoom before this
 * existed. See `atlasCellPxBucket`'s doc for the perf bug this closes.
 */
export const MAX_ATLAS_CELL_PX = 64;

/** Round a raw device-pixel cell size to a coarser bucket so the atlas isn't
 *  rebuilt on every fractional zoom tick — rebuilding is cheap (a handful of
 *  `fillText` calls) but there's no reason to do it every frame while
 *  zooming continuously. 2px buckets are imperceptible in the final glyph
 *  size but cut rebuild frequency by roughly half versus integer rounding.
 *
 *  PERF BUG (real user report: "acid mode once I zoomed in enough fucking
 *  destroyed the machine"): with no ceiling, this bucket kept growing
 *  linearly with `devicePx` (`camera.scale * dpr`, where `dpr` is already
 *  capped at 2x by `WorldRendererImpl.resize()`) — at `MAX_SCALE` (40 CSS
 *  px/cell) that's up to an 80px-per-glyph atlas on a capped-2x-DPR phone
 *  (40 on a 1x desktop). Rasterising a VARIABLE font (JetBrains Mono
 *  Variable — see `GLYPH_FONT_STACK`) at that size is real, non-trivial work
 *  (font shaping/instancing + hinting, not a cheap blit) — measurably worse
 *  on real mobile hardware than on a fast desktop's text stack — and because
 *  the bucket is still only 2px wide, a SINGLE continuous pinch-zoom gesture
 *  crosses dozens of distinct buckets on its way there — each one a full
 *  atlas rebuild (`buildGlyphAtlas`'s `document.createElement('canvas')` +
 *  one `fillText` per character), repeated every animation frame the
 *  gesture keeps moving (`#drawGlyphs` recomputes the bucket every `draw()`
 *  call). That is the "destroyed the machine" cliff: a font-shaping cost
 *  that scaled with zoom level, paid continuously while zooming, at exactly
 *  the large-cell end where each rebuild is also the most expensive one.
 *  Capping the bucket means the atlas simply stops being rebuilt at all once
 *  zoomed in that far — the same cached large-enough raster is reused and
 *  scaled up by the GPU/canvas compositor (`drawImage`'s free dest-size
 *  scaling), which is what that call was already doing on every other zoom
 *  level anyway. 64px is comfortably larger than `@/render/renderer`'s
 *  `GLYPH_MIN_DEVICE_PX` legibility floor while staying cheap to rasterise
 *  and small to upscale from. */
export function atlasCellPxBucket(devicePx: number): number {
  return Math.min(MAX_ATLAS_CELL_PX, Math.max(4, Math.round(devicePx / 2) * 2));
}
