import { expect, test, type Page } from '@playwright/test';
import {
  applyEditDirect, collectConsoleErrors, dismissTitle, ensurePaused, openApp, suppressTour,
} from './utils';

/**
 * ACID ART / Art mode PERFORMANCE AND RESOURCE-SAFETY harness. Owned by the
 * `render` agent (`src/render/**`, `e2e/art*.spec.ts`).
 *
 * WHY THIS FILE EXISTS: a real production report said Art mode "literally
 * crash[ed] the mac it crashed so hard" while rendering nothing visible.
 * `e2e/art.spec.ts` (was `describe.skip`'d during the containment period;
 * re-enabled once the warm-up pass lifted it — see its own doc) only ever
 * asserted "renders without a console error," which cannot fail on resource
 * exhaustion — a real user's fair complaint was exactly that: "you
 * should've caught that." This file is the harness that can.
 *
 * WHAT WAS FOUND (full story in `renderer.ts`'s `ART_FRAME_BUDGET_MS` doc
 * and `glyphAtlas.ts`'s webfont doc): direct measurement of the glyph draw
 * path found real, reproducible SINGLE-FRAME stalls of roughly one to
 * several seconds — the main thread frozen solid for that whole span, which
 * is both "renders nothing visible" (no repaint can happen mid-synchronous-
 * call) and, repeated forever with nothing to stop it, exactly what a user
 * experiences as "crashed." The stall did NOT scale predictably with live
 * cell count or config complexity, and was NOT explained by garbage
 * collection — evidence it's closer to a browser/graphics-stack-level
 * lazy-initialisation cost than anything this file's per-cell logic
 * controls, which is precisely why the fix is a MECHANISM-AGNOSTIC
 * frame-time watchdog (reacts to real measured cost, not a guessed cause)
 * rather than a tuned constant. A second, independently real contributing
 * risk (canvas `fillText` synchronously blocking on an unloaded webfont) was
 * found and fixed alongside it.
 *
 * THIS FILE BYPASSES `artMount.ts`'s containment ON PURPOSE, by calling
 * `renderer.setArtConfig()`/`renderer.draw()` directly via
 * `window.__AFTERLIFE__` (the same pattern `e2e/art.spec.ts`'s `forceDraw`
 * already established) — containment only unmounts the UI/store bridge, it
 * doesn't remove `WorldRenderer`'s own API. That's what makes it possible to
 * performance-test the underlying renderer while the feature stays
 * contained at the UI layer, and it's also what let this harness be proven
 * against the ACTUAL unfixed code before any fix existed: temporarily
 * reverting `src/render/renderer.ts`/`glyphAtlas.ts` and re-running the
 * "watchdog catches a catastrophic frame" test below reproduces the exact
 * failure this exists to catch — the pre-fix code has no
 * `consumeArtWatchdogTrip`/`getArtDebugStats` API at all, so every
 * assertion in this file fails outright against it (either a thrown
 * TypeError calling a method that doesn't exist, or — for the
 * `MAX_GLYPH_LIVE_CELLS` test — the multi-second stall itself blowing the
 * test's own timeout). That regression was confirmed by hand while building
 * this harness; it is not asserted by an automated "run against git stash"
 * step here (out of scope for a committed spec), but every fix this file
 * protects is real and independently re-verifiable via `git stash` on
 * `src/render/renderer.ts`/`src/render/glyphAtlas.ts`.
 */

const WORLD = { width: 256, height: 160 };

async function seedDenseArea(
  page: Page,
  x0: number,
  y0: number,
  w: number,
  h: number,
): Promise<number> {
  const cells: Array<{ x: number; y: number; alive: boolean }> = [];
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      // A busy, non-uniform pattern (not a solid block — see `art.spec.ts`'s
      // own note on why a uniform fill doesn't stay a meaningful "dense
      // live" stress case) that stays a nontrivial fraction alive.
      if (((x * 7 + y * 13) % 5) < 3) cells.push({ x, y, alive: true });
    }
  }
  await applyEditDirect(page, cells);
  return cells.length;
}

async function setCamera(page: Page, cam: { x: number; y: number; scale: number }): Promise<void> {
  await page.evaluate((c) => {
    (window as unknown as { __AFTERLIFE__: { camera: { set(next: typeof c): void } } })
      .__AFTERLIFE__.camera.set(c);
  }, cam);
}

interface ArtDebugStats {
  atlasEntries: number;
  atlasBytes: number;
  atlasBuildCount: number;
  fillStyleCacheEntries: number;
  cellCanvasCount: number;
  lastArtFrameMs: number;
  artFrameMsWindow: number[];
}

type RendererHandle = {
  setArtConfig(config: unknown, opts?: { warmupGrace?: boolean }): void;
  draw(engine: unknown): void;
  getArtDebugStats(): ArtDebugStats;
  consumeArtWatchdogTrip(): string | null;
  dpr: number;
};

/** Explicit `draw()`; resolves to the renderer's OWN in-page cost (ms) of
 *  that call, measured with `performance.now()` around it — never the
 *  Playwright round-trip wall-clock, which on a loaded CI box (or a shared
 *  dev machine with other suites running) also includes scheduling delay
 *  that has nothing to do with what the renderer paid. */
async function draw(page: Page): Promise<number> {
  return page.evaluate(() => {
    const s = (window as unknown as { __AFTERLIFE__: { renderer: RendererHandle; engine: unknown } }).__AFTERLIFE__;
    const t0 = performance.now();
    s.renderer.draw(s.engine);
    return performance.now() - t0;
  });
}

/** Own-property override of THIS renderer's `draw` (shadows the prototype
 *  method for this instance, so the app's ambient rAF loop and `warmUpArt`'s
 *  chunk-restoration draws are captured too) that records every draw's
 *  in-page cost — see `recordedDrawTimes`. */
async function installDrawTimeRecorder(page: Page): Promise<void> {
  await page.evaluate(() => {
    const s = (window as unknown as { __AFTERLIFE__: { renderer: { draw: (...a: unknown[]) => void } } }).__AFTERLIFE__;
    const w = window as unknown as { __drawTimes__: number[] };
    w.__drawTimes__ = [];
    const original = s.renderer.draw.bind(s.renderer);
    s.renderer.draw = (...args: unknown[]) => {
      const t0 = performance.now();
      original(...args);
      w.__drawTimes__.push(performance.now() - t0);
    };
  });
}

async function recordedDrawTimes(page: Page): Promise<number[]> {
  return page.evaluate(() => (window as unknown as { __drawTimes__: number[] }).__drawTimes__);
}

async function setArtConfig(page: Page, config: unknown, opts?: { warmupGrace?: boolean }): Promise<void> {
  await page.evaluate(({ cfg, opts }) => {
    (window as unknown as { __AFTERLIFE__: { renderer: RendererHandle } }).__AFTERLIFE__.renderer.setArtConfig(cfg, opts);
  }, { cfg: config, opts });
}

/** Wrap THIS renderer instance's poll-and-clear `consumeArtWatchdogTrip()`
 *  so every trip is recorded regardless of who consumes it — the app's own
 *  rAF `pollWatchdog` in `artMount.ts` races any test that reads the
 *  poll-and-clear API directly (see the first test's doc). */
async function installWatchdogTripRecorder(page: Page): Promise<void> {
  await page.evaluate(() => {
    const s = (window as unknown as { __AFTERLIFE__: { renderer: RendererHandle } }).__AFTERLIFE__;
    const w = window as unknown as { __watchdogTrips__: string[] };
    w.__watchdogTrips__ = [];
    const original = s.renderer.consumeArtWatchdogTrip.bind(s.renderer);
    s.renderer.consumeArtWatchdogTrip = () => {
      const reason = original();
      if (reason) w.__watchdogTrips__.push(reason);
      return reason;
    };
  });
}

async function recordedWatchdogTrips(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __watchdogTrips__: string[] }).__watchdogTrips__);
}

/**
 * Arm ONE deterministic busy-wait stall of `ms` inside the next Art-mode
 * frame's own compositing work — a controlled stand-in for the real,
 * environment-dependent stall this harness was built around. Re-armable:
 * each call installs a fresh one-shot.
 *
 * Uses `renderer.ts`'s `#testOnlyBeforeGlyphComposite` instrumentation seam
 * rather than sniffing a specific canvas call shape (the previous version
 * hooked `CanvasRenderingContext2D.prototype.fillRect`, armed specifically
 * on `globalCompositeOperation === 'source-in'` on `#world-canvas` — the
 * exact shape the OLD per-cell tint pass used). That sniff broke when
 * `#drawGlyphs` was rewritten from "one `drawImage`+`source-in fillRect`
 * pair per live cell" to "one shared pixel buffer, composited with a single
 * plain `source-over` `drawImage`" (see that method's doc for the perf
 * story: real Chrome measured a 900-live-cell scene at ~72ms/frame p95
 * under the old per-cell approach) — the new final blit is call-shape-
 * identical to the plain lens's own `#drawZoomedIn`/`#drawZoomedOut` fast
 * paths, so no canvas-primitive sniff can distinguish "this is Art mode's
 * own work" from "this is the ambient render loop's honest lens" anymore.
 * The explicit seam sidesteps that by being unambiguous BY CONSTRUCTION: it
 * only ever fires from inside `#drawGlyphs`, immediately before that one
 * real per-frame canvas call.
 */
async function armArtFrameStall(page: Page, ms: number): Promise<void> {
  await page.evaluate((stallMs) => {
    const s = (window as unknown as {
      __AFTERLIFE__: { renderer: { __testOnlyBeforeGlyphComposite: (() => void) | null } };
    }).__AFTERLIFE__;
    let armed = true;
    s.renderer.__testOnlyBeforeGlyphComposite = () => {
      if (!armed) return;
      armed = false;
      s.renderer.__testOnlyBeforeGlyphComposite = null; // one-shot: never fire again after this
      const until = performance.now() + stallMs;
      while (performance.now() < until) { /* deterministic busy-wait stand-in for a real stall */ }
    };
  }, ms);
}

async function getDebugStats(page: Page): Promise<ArtDebugStats> {
  return page.evaluate(() => (
    window as unknown as { __AFTERLIFE__: { renderer: RendererHandle } }
  ).__AFTERLIFE__.renderer.getArtDebugStats());
}

async function consumeWatchdogTrip(page: Page): Promise<string | null> {
  return page.evaluate(() => (
    window as unknown as { __AFTERLIFE__: { renderer: RendererHandle } }
  ).__AFTERLIFE__.renderer.consumeArtWatchdogTrip());
}

/** A moderately busy but bounded Art config — a real preset shape (field +
 *  a couple of LFOs + custom colour), never a config designed only to be
 *  expensive. Used by the "realistic session" test, which is meant to prove
 *  ordinary usage stays cheap, not to reproduce the pathological case. */
function realisticArtConfig(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    glyphs: { setId: 'ascii', customChars: ' .:-=+*#%@', driver: 'age' },
    field: {
      source: 'perlin', targets: ['glyph'], scale: 1.2, offsetX: 0, offsetY: 0, rotationDeg: 0, seed: 3, threshold: 0.5,
    },
    lfos: [
      { id: 'l1', shape: 'sine', rateHz: 0.15, depth: 0.4, phase: 0, target: 'hueRotate' },
    ],
    color: {
      source: 'lens', stops: [{ t: 0, color: 'oklch(0.55 0.20 260)' }, { t: 1, color: 'oklch(0.87 0.155 155)' }],
      hueRotateDeg: 0, cycleSpeedHz: 0.05, trails: { enabled: false, decay: 0.15 },
    },
    ...overrides,
  };
}

/** A cheap, in-page digest (FNV-1a over every RGBA byte) of `#world-canvas`.
 *  Compared with `toBe`/`not.toBe` — never the raw pixel arrays. Shipping
 *  ~5M numbers per sample across CDP and then asking `expect`'s pretty-
 *  printer to diff two of them on a FAILED assertion is a real hazard this
 *  harness hit: the Playwright worker spun at 100% CPU for 40+ minutes
 *  formatting the diff, which reads as "the suite hung" rather than
 *  "assertion failed". Hashing in-page keeps a failure a fast, honest
 *  failure. */
async function canvasDigest(page: Page): Promise<string> {
  return page.evaluate(() => {
    const c = document.getElementById('world-canvas') as HTMLCanvasElement;
    const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let h = 0x811c9dc5;
    for (let i = 0; i < data.length; i++) {
      h ^= data[i]!;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return `${h.toString(16)}:${c.width}x${c.height}`;
  });
}

async function bootTo(page: Page): Promise<void> {
  await suppressTour(page);
  await openApp(page);
  await dismissTitle(page);
  await ensurePaused(page);
}

// Real installed Chrome, not bundled Chromium: this harness measures the
// path a user actually gets. Must be file-level — Playwright forbids
// `test.use({ channel })` inside a describe group.
test.use({ channel: 'chrome' });

test.describe('Art mode performance/resource-safety harness', () => {
  test('the frame-time watchdog catches a single catastrophic frame and immediately, permanently stops paying its cost', async ({ page }) => {
    test.setTimeout(30_000);
    const errors = collectConsoleErrors(page);
    await bootTo(page);
    await seedDenseArea(page, 40, 40, 20, 20);
    await setCamera(page, { x: 50, y: 50, scale: 16 });

    // Record EVERY watchdog trip no matter who consumes it. `setArtConfig`
    // marks the renderer dirty, so the app's own rAF render loop
    // (`session.ts`) usually draws the first art-active frame BEFORE this
    // test's explicit `draw()` below can — the injected stall then lands in
    // that ambient frame, and `artMount.ts`'s own rAF `pollWatchdog` wins the
    // race to `consumeArtWatchdogTrip()` (poll-and-clear) and turns the
    // trip into the user-facing toast. In real Chrome that race was lost
    // reliably; the earlier version of this test read the poll-and-clear API
    // directly and reported "watchdog never tripped" while it had in fact
    // tripped, disabled Art mode, and toasted. This recorder makes the
    // assertion independent of which consumer gets there first.
    await installWatchdogTripRecorder(page);

    // Inject ONE deterministic catastrophic frame — a controlled stand-in
    // for the real (environment-dependent, not reliably reproducible on
    // every machine/CI runner) stall this harness found by direct
    // measurement (see this file's own doc). This is dependency injection
    // at the browser-API boundary, not a weakened assertion: it tests the
    // watchdog's REACTION to a genuinely slow frame deterministically,
    // independent of whether any particular CI box happens to reproduce the
    // underlying browser/graphics-stack quirk today.
    //
    // Armed specifically on the exact call shape Art mode's own tint pass
    // uses (`globalCompositeOperation === 'source-in'` on `#world-canvas`)
    // rather than "the very next `fillRect` call anywhere" — the app's own
    // ambient render loop can and does call `fillRect` for other reasons,
    // which armed on "next call ever" would consume without ever reaching
    // Art mode's code.
    await armArtFrameStall(page, 400); // exceeds ART_FRAME_HARD_CEILING_MS (250ms)

    await setArtConfig(page, realisticArtConfig());
    await draw(page); // whichever of this or the ambient loop's draw ran first paid the stall

    // The stall genuinely happened inside an art-active frame the watchdog
    // measured — read the renderer's own measurement, not wall-clock around
    // an `evaluate` round-trip that could just be queued behind the stall.
    await expect.poll(() => recordedWatchdogTrips(page), {
      message: 'watchdog should have tripped and reported why',
      timeout: 5_000,
    }).toHaveLength(1);
    const trips = await recordedWatchdogTrips(page);
    expect(trips[0]).toMatch(/a single Art-mode frame took (?:[4-9]\d\d|\d{4,})ms \(ceiling 250ms\)/); // >= the 400ms injected, whatever the draw itself cost on top

    // The renderer force-disabled Art mode on itself the instant it
    // detected the stall — every SUBSEQUENT draw must be cheap, proving
    // this is a one-frame cost ceiling, not a repeating one.
    for (let i = 0; i < 10; i++) {
      const dt = await draw(page);
      expect(dt, `frame ${i} after the watchdog tripped should be cheap`).toBeLessThan(100);
    }
    expect(await consumeWatchdogTrip(page)).toBeNull(); // nothing new tripped — it isn't re-triggering itself
    expect(await recordedWatchdogTrips(page)).toHaveLength(1);

    // The user is told, honestly, via `artMount.ts`'s poller -> toast — the
    // full pipeline, not just the renderer-side flag.
    await expect(page.getByText(/Art mode turned itself off/).first()).toBeVisible({ timeout: 5_000 });

    expect(errors, `console errors: ${errors.join('\n')}`).toEqual([]);
  });

  test('the one-shot warm-up grace is not a hole: a bounded first frame is forgiven once, an egregious one still trips, and the very next slow frame trips normally', async ({ page }) => {
    test.setTimeout(45_000);
    const errors = collectConsoleErrors(page);
    await bootTo(page);
    await seedDenseArea(page, 40, 40, 20, 20);
    await setCamera(page, { x: 50, y: 50, scale: 16 });
    await installWatchdogTripRecorder(page);
    await installDrawTimeRecorder(page);

    // 1) Grace armed (exactly what `artMount.ts`'s `enableWithWarmup` does
    //    after `warmUpArt()` resolves) + a stall over the normal 250ms
    //    ceiling but under `ART_WARMUP_GRACE_CEILING_MS` (2000ms): forgiven,
    //    Art mode stays on. This is the intended, documented exemption.
    await armArtFrameStall(page, 400);
    await setArtConfig(page, realisticArtConfig(), { warmupGrace: true });
    await draw(page);
    await page.waitForTimeout(300); // give `pollWatchdog` (rAF) every chance to consume a trip if one happened
    expect(await recordedWatchdogTrips(page), 'a bounded warm-up frame must be graced exactly once').toEqual([]);
    // The stall really was paid inside an art-active frame (whichever of
    // the ambient loop's draw or ours ran first) ...
    expect(Math.max(...(await recordedDrawTimes(page)))).toBeGreaterThanOrEqual(390);
    // ... and that graced frame was kept OUT of the sustained-average window
    // (later cheap frames may have been pushed since — only the stalled one
    // must be absent).
    expect((await getDebugStats(page)).artFrameMsWindow.filter((ms) => ms >= 250), 'the graced frame must not poison the sustained-average window').toEqual([]);

    // 2) The grace is ONE-SHOT: the very next frame over the ceiling trips
    //    normally, with the normal reason.
    await armArtFrameStall(page, 400);
    await draw(page);
    await expect.poll(() => recordedWatchdogTrips(page), { timeout: 5_000 }).toHaveLength(1);
    expect((await recordedWatchdogTrips(page))[0]).toMatch(/a single Art-mode frame took \d+ms \(ceiling 250ms\)/);

    // 3) The grace has a hard absolute bail: with grace freshly armed again,
    //    a genuinely egregious frame (beyond ART_WARMUP_GRACE_CEILING_MS)
    //    trips the watchdog anyway — a real multi-second hang during warm-up
    //    cannot hide behind the grace.
    await armArtFrameStall(page, 2_200);
    await setArtConfig(page, realisticArtConfig(), { warmupGrace: true });
    await draw(page);
    await expect.poll(() => recordedWatchdogTrips(page), { timeout: 8_000 }).toHaveLength(2);
    expect((await recordedWatchdogTrips(page))[1]).toMatch(/warm-up frame itself took 2\d{3}ms, beyond even the warm-up grace ceiling \(2000ms\)/);

    // And it stays off — subsequent frames are cheap.
    for (let i = 0; i < 5; i++) {
      expect(await draw(page), `frame ${i} after the grace-ceiling trip should be cheap`).toBeLessThan(100);
    }
    expect(await recordedWatchdogTrips(page)).toHaveLength(2);
    expect(errors, `console errors: ${errors.join('\n')}`).toEqual([]);
  });

  test('MAX_GLYPH_LIVE_CELLS: a dense scene beyond the live-cell cap never attempts the expensive glyph path at all', async ({ page }) => {
    await bootTo(page);
    // `MAX_GLYPH_LIVE_CELLS` was raised from 6,000 to 20,000 once `#drawGlyphs`
    // moved off the old "N live cells == N real canvas draw calls" cost model
    // (see that constant's own doc in `renderer.ts` for the real-Chrome
    // numbers justifying the new value) — this app's own world (`WORLD`,
    // 256x160 = 40,960 cells) can produce at most ~24,576 live cells with
    // this file's own dense fill pattern (~60% alive), so exceeding 20,000
    // at all requires the WHOLE world in view at once, not just "most of
    // it." The default 1440x900 viewport at the smallest legible-for-glyphs
    // zoom (scale 8 at this suite's forced 1x DPR) only shows ~12,000 live
    // cells — comfortably UNDER the new cap — so this test enlarges the
    // viewport enough to bring the entire world on screen.
    await page.setViewportSize({ width: 2600, height: 1300 });
    await page.waitForTimeout(200); // let the resize/ResizeObserver settle before reading canvas geometry
    // Densely fill the ENTIRE world (well beyond the 20,000-live-cell cap)
    // and zoom so the visible rect covers all of it.
    const seeded = await seedDenseArea(page, 0, 0, WORLD.width, WORLD.height);
    expect(seeded).toBeGreaterThan(20_000);
    await setCamera(page, { x: 128, y: 80, scale: 8 });
    await setArtConfig(page, realisticArtConfig());

    const t0 = Date.now();
    await draw(page);
    const dt = Date.now() - t0;

    const stats = await getDebugStats(page);
    // The pre-count bailed to the honest zoomed-in path BEFORE ever
    // building an atlas or issuing a single glyph draw call — the whole
    // point of a pre-emptive cap over "try it and see."
    expect(stats.atlasBuildCount).toBe(0);
    expect(stats.atlasEntries).toBe(0);
    expect(dt).toBeLessThan(500); // the honest fallback path is always cheap, regardless of live-cell count
  });

  test('a realistic animated session (zoom, pan, glyph-set/palette/lens switches, LFOs running) stays within a real frame-time and memory budget', async ({ page }) => {
    test.setTimeout(45_000);
    await bootTo(page);
    await seedDenseArea(page, 50, 40, 40, 40); // a real but modest live population, comfortably under the live-cell cap
    await setCamera(page, { x: 70, y: 60, scale: 10 });
    await setArtConfig(page, realisticArtConfig());

    const glyphSets = ['ascii', 'blocks', 'box', 'dots', 'geometric'] as const;
    const lenses = ['life', 'age', 'activity', 'lineage'] as const;

    const frameTimes: number[] = await page.evaluate(async ({ glyphSets, lenses }) => {
      const s = (window as unknown as {
        __AFTERLIFE__: { renderer: RendererHandle & { setLens(l: string): void }; engine: unknown; camera: { camera: { x: number; y: number; scale: number }; set(c: unknown): void } };
      }).__AFTERLIFE__;
      const times: number[] = [];
      for (let i = 0; i < 150; i++) {
        // Zoom in/out and pan — a real, continuously varying camera, not a
        // fixed one.
        const cam = s.camera.camera;
        const scale = Math.max(8, Math.min(24, cam.scale + Math.sin(i / 12) * 1.5));
        s.camera.set({ x: cam.x + Math.cos(i / 9) * 0.6, y: cam.y + Math.sin(i / 7) * 0.6, scale });
        if (i % 20 === 0) {
          s.renderer.setLens(lenses[(i / 20) % lenses.length]!);
        }
        if (i % 15 === 0) {
          const setId = glyphSets[(i / 15) % glyphSets.length]!;
          s.renderer.setArtConfig({
            enabled: true,
            glyphs: { setId, customChars: ' .:-=+*#%@', driver: 'age' },
            field: { source: 'perlin', targets: ['glyph'], scale: 1.2, offsetX: 0, offsetY: 0, rotationDeg: 0, seed: 3, threshold: 0.5 },
            lfos: [{ id: 'l1', shape: 'sine', rateHz: 0.15, depth: 0.4, phase: 0, target: 'hueRotate' }],
            color: { source: 'lens', stops: [{ t: 0, color: 'oklch(0.55 0.20 260)' }, { t: 1, color: 'oklch(0.87 0.155 155)' }], hueRotateDeg: 0, cycleSpeedHz: 0.05, trails: { enabled: false, decay: 0.15 } },
          });
        }
        const t0 = performance.now();
        s.renderer.draw(s.engine);
        times.push(performance.now() - t0);
      }
      return times;
    }, { glyphSets, lenses });

    await page.evaluate(() => { (window as unknown as { gc?: () => void }).gc?.(); });

    const avg = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
    const max = Math.max(...frameTimes);
    // Generous but real budgets — this is a functional/CI browser, not a
    // benchmark rig; the point is catching a REGRESSION back toward
    // multi-hundred-ms/multi-second territory, not chasing a specific
    // millisecond count.
    expect(avg, `avg frame time ${avg.toFixed(1)}ms`).toBeLessThan(80);
    expect(max, `max frame time ${max.toFixed(1)}ms`).toBeLessThan(400);

    const stats = await getDebugStats(page);
    // Canvas/atlas allocation ceilings — the actual "assert hard ceilings"
    // ask: the LRU cache never grows past its own cap, and total retained
    // atlas bytes stays small regardless of how many glyph-set switches ran.
    expect(stats.atlasEntries).toBeLessThanOrEqual(24);
    expect(stats.atlasBytes).toBeLessThanOrEqual(24 * 64 * 64 * 4);
    expect(stats.cellCanvasCount).toBeLessThanOrEqual(1);
    // The per-frame fillStyle cache is cleared every `#drawGlyphs` call (see
    // its doc) — this reads whatever the LAST frame left behind, which
    // should be a small, bounded set of distinct colours, not one entry per
    // live cell.
    expect(stats.fillStyleCacheEntries).toBeLessThan(2_000);
    expect(await consumeWatchdogTrip(page)).toBeNull(); // a realistic session should never need the safety net
  });

  test('renders something visibly different from the plain lens, and turning it off restores the honest lens exactly', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await bootTo(page);
    await seedDenseArea(page, 50, 40, 20, 20);
    await setCamera(page, { x: 60, y: 50, scale: 16 });
    await draw(page);

    const before = await canvasDigest(page);

    await setArtConfig(page, realisticArtConfig());
    await draw(page);
    const during = await canvasDigest(page);
    expect(during).not.toBe(before);

    await setArtConfig(page, null);
    await draw(page);
    const after = await canvasDigest(page);
    expect(after).toBe(before);

    expect(errors, `console errors: ${errors.join('\n')}`).toEqual([]);
  });
});

/**
 * REAL CHROME regression test for the warm-up/watchdog-grace pass that
 * finally lifted `artMount.ts`'s containment (see that file's updated doc).
 * Every test above drives the renderer directly against whatever browser
 * `playwright.art-perf.config.ts`'s `devices['Desktop Chrome']` resolves to
 * (bundled Chromium unless overridden) — useful for deterministic
 * measurement, but the actual production report and the follow-up
 * measurement that root-caused it were both about REAL Chrome specifically
 * (`channel: 'chrome'`, the same binary a real user runs, installed at
 * `/Applications/Google Chrome.app` in this environment). `test.use` below
 * overrides just the browser channel for this one describe block — every
 * other `use` option from the parent config (viewport, the `--expose-gc`
 * launch flag, etc.) still applies.
 *
 * This test also deliberately goes through the REAL reachable UI path (the
 * `a` keyboard shortcut on a fresh/untouched config, which `artStore.ts`'s
 * `toggleEnabled` resolves to the app's own `classicAsciiPreset()` — not a
 * synthetic config this test builds itself) rather than
 * `renderer.setArtConfig()` directly, so it exercises `artMount.ts`'s real
 * `enableWithWarmup` orchestration end to end: warm-up, the watchdog's
 * one-shot grace, and the trigger tab's own enabled/disabled reflection —
 * the exact integration containment used to keep unreachable.
 */
test.describe('Art mode performance/resource-safety harness (real Chrome, full integration)', () => {

  test('classic ASCII preset survives 30 zoom steps + 10 pans in real Chrome: bounded post-warm-up frames, stable heap, Art mode stays enabled, canvas visibly changes', async ({ page }) => {
    test.setTimeout(60_000);
    const errors = collectConsoleErrors(page);
    await bootTo(page);
    await seedDenseArea(page, 50, 40, 30, 30); // a real but modest live population
    await setCamera(page, { x: 65, y: 55, scale: 16 }); // already above the legibility floor
    await draw(page);

    const before = await canvasDigest(page);

    // Instrument the REAL `draw()` the app's own render loop calls (an
    // own-property override shadows the prototype method for this instance,
    // so every internal `this.draw(...)` call — including `warmUpArt`'s own
    // chunk-restoration draws — is captured too) rather than bypassing it,
    // so every measured frame is one a real session would actually produce.
    await page.evaluate(() => {
      const s = (window as unknown as { __AFTERLIFE__: { renderer: { draw: (...a: unknown[]) => void } } }).__AFTERLIFE__;
      (window as unknown as { __artFrameTimes__: number[] }).__artFrameTimes__ = [];
      const original = s.renderer.draw.bind(s.renderer);
      s.renderer.draw = (...args: unknown[]) => {
        const t0 = performance.now();
        original(...args);
        (window as unknown as { __artFrameTimes__: number[] }).__artFrameTimes__.push(performance.now() - t0);
      };
    });

    // The real reachable entry point — see this describe block's doc for
    // why this, not `setArtConfig()` directly.
    await page.keyboard.press('a');

    // Warm-up (font + atlas + the canvas's own lazy-init cost, chunked off
    // the main thread — `renderer.ts`'s `warmUpArt`) and the camera's
    // auto-ease-to-legible-zoom both run asynchronously; give them generous
    // real wall-clock room to fully settle before measuring steady state.
    await page.waitForTimeout(3_000);

    const duringEnabled = await canvasDigest(page);
    expect(duringEnabled, 'canvas must visibly differ once Art mode is on').not.toBe(before);

    // Everything measured from here on is STEADY-STATE — after the one
    // known, explicitly graced warm-up-adjacent frame (see
    // `ART_WARMUP_GRACE_CEILING_MS`'s doc in `renderer.ts`) — which is
    // exactly what "once warmed" means for this harness's budgets below.
    await page.evaluate(() => { (window as unknown as { __artFrameTimes__: number[] }).__artFrameTimes__ = []; });

    const readHeap = () => page.evaluate(async () => {
      (window as unknown as { gc?: () => void }).gc?.();
      await new Promise((resolve) => setTimeout(resolve, 50));
      return (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0;
    });
    const heapBefore = await readHeap();

    for (let i = 0; i < 30; i++) {
      const scale = 8 + (i % 15) * 1.5; // sweeps back and forth across the legible range
      await page.evaluate((s) => {
        const cam = (window as unknown as {
          __AFTERLIFE__: { camera: { camera: { x: number; y: number }; set(c: unknown): void } };
        }).__AFTERLIFE__.camera;
        cam.set({ x: cam.camera.x, y: cam.camera.y, scale: s });
      }, scale);
      await page.waitForTimeout(40);
    }

    for (let i = 0; i < 10; i++) {
      await page.evaluate(() => {
        const cam = (window as unknown as {
          __AFTERLIFE__: { camera: { camera: { x: number; y: number; scale: number }; set(c: unknown): void } };
        }).__AFTERLIFE__.camera;
        const c = cam.camera;
        cam.set({ x: c.x + 3, y: c.y + 2, scale: c.scale });
      });
      await page.waitForTimeout(40);
    }

    const heapAfter = await readHeap();

    const times: number[] = await page.evaluate(() => (
      window as unknown as { __artFrameTimes__: number[] }
    ).__artFrameTimes__);
    expect(times.length, 'the 30 zoom + 10 pan steps should have produced real draw() calls').toBeGreaterThan(10);
    const sorted = [...times].sort((a, b) => a - b);
    const max = sorted[sorted.length - 1]!;
    const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]!;

    // Once warmed, no frame should approach the watchdog's hard ceiling
    // (250ms) — the real-Chrome reproduction that motivated this whole pass
    // measured 881ms/333ms worst frames WITHOUT this warm-up; this budget
    // exists to catch a real regression back toward that territory.
    expect(max, `max post-warm-up frame ${max.toFixed(1)}ms`).toBeLessThan(250);
    expect(p95, `p95 post-warm-up frame ${p95.toFixed(1)}ms`).toBeLessThan(ART_FRAME_BUDGET_MS_REF);

    // No UNBOUNDED memory growth across a real animated session. The original
    // budget here (5MB) matched the pre-single-blit renderer, which had
    // essentially no large per-frame allocations (35.4->28.6MB / 30.8->31.2MB
    // in that reproduction — heap actually fell). `#drawGlyphs`'s single-blit
    // rewrite (see that method's doc — the fix for this file's own dense-
    // scene p95 budget just below) deliberately trades that for a REUSED,
    // grow-only `Uint8ClampedArray` pixel buffer sized to the live cells'
    // on-screen bounding box: real measurement of this exact 30-zoom-step
    // sweep (scale 8->29, so the buffer's needed capacity grows several times
    // over) found 5.4-8.8MB of growth across repeated runs — a real, but
    // ONE-TIME, bounded convergence to a working-set size (the buffer never
    // reallocates again once big enough for every size a session's zoom range
    // actually uses), not a per-frame leak. 25MB comfortably covers that
    // legitimate cost (this test's worst-case buffer, a ~1740x1740 device-
    // pixel bbox at this sweep's largest zoom, is ~12MB) while still catching
    // a genuine regression back toward runaway, unbounded growth. Skipped if
    // `performance.memory` isn't available at all rather than asserting on a
    // 0 that would trivially "pass".
    if (heapBefore > 0 && heapAfter > 0) {
      expect(heapAfter, `heap grew from ${(heapBefore / 1e6).toFixed(1)}MB to ${(heapAfter / 1e6).toFixed(1)}MB`)
        .toBeLessThan(heapBefore + 25_000_000);
    }

    // The whole point: the watchdog must not have needed to fire to protect
    // this session, and the real UI must still show Art mode ON.
    const watchdogTripped = await page.evaluate(() => (
      window as unknown as { __AFTERLIFE__: { renderer: { consumeArtWatchdogTrip(): string | null } } }
    ).__AFTERLIFE__.renderer.consumeArtWatchdogTrip());
    expect(watchdogTripped, `watchdog should not have needed to fire: ${watchdogTripped}`).toBeNull();
    await expect(page.getByRole('button', { name: 'Turn off Art mode' })).toBeVisible();

    expect(errors, `console errors: ${errors.join('\n')}`).toEqual([]);
  });
});

/** Mirrors `renderer.ts`'s `ART_FRAME_BUDGET_MS` (32) — not imported so this
 *  spec file stays independent of that module's internals the same way
 *  every other budget in this file is a plain literal with an explanatory
 *  comment, but named to make the correspondence explicit. */
const ART_FRAME_BUDGET_MS_REF = 32;
