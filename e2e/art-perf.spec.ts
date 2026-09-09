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
 * `e2e/art.spec.ts` (still `describe.skip`'d — see its own doc) only ever
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
  setArtConfig(config: unknown): void;
  draw(engine: unknown): void;
  getArtDebugStats(): ArtDebugStats;
  consumeArtWatchdogTrip(): string | null;
  dpr: number;
};

async function draw(page: Page): Promise<void> {
  await page.evaluate(() => {
    const s = (window as unknown as { __AFTERLIFE__: { renderer: RendererHandle; engine: unknown } }).__AFTERLIFE__;
    s.renderer.draw(s.engine);
  });
}

async function setArtConfig(page: Page, config: unknown): Promise<void> {
  await page.evaluate((cfg) => {
    (window as unknown as { __AFTERLIFE__: { renderer: RendererHandle } }).__AFTERLIFE__.renderer.setArtConfig(cfg);
  }, config);
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

async function bootTo(page: Page): Promise<void> {
  await suppressTour(page);
  await openApp(page);
  await dismissTitle(page);
  await ensurePaused(page);
}

test.describe('Art mode performance/resource-safety harness', () => {
  test('the frame-time watchdog catches a single catastrophic frame and immediately, permanently stops paying its cost', async ({ page }) => {
    test.setTimeout(30_000);
    const errors = collectConsoleErrors(page);
    await bootTo(page);
    await seedDenseArea(page, 40, 40, 20, 20);
    await setCamera(page, { x: 50, y: 50, scale: 16 });

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
    // ambient render loop (camera/HUD-driven redraws, unrelated to this
    // test) can and does call `fillRect` for other reasons between this
    // `page.evaluate` and the explicit `draw()` call below, which armed on
    // "next call ever" would consume without ever reaching Art mode's code.
    await page.evaluate(() => {
      const proto = CanvasRenderingContext2D.prototype;
      const original = proto.fillRect;
      let armed = true;
      proto.fillRect = function fillRectSpy(this: CanvasRenderingContext2D, ...args: Parameters<typeof original>) {
        if (armed && this.globalCompositeOperation === 'source-in' && (this.canvas as HTMLCanvasElement | undefined)?.id === 'world-canvas') {
          armed = false;
          const until = performance.now() + 400; // exceeds ART_FRAME_HARD_CEILING_MS (250ms)
          while (performance.now() < until) { /* deterministic busy-wait stand-in for a real stall */ }
        }
        return original.apply(this, args);
      };
    });

    await setArtConfig(page, realisticArtConfig());

    const t0 = Date.now();
    await draw(page);
    const firstDrawMs = Date.now() - t0;
    expect(firstDrawMs).toBeGreaterThanOrEqual(390); // confirms the injected stall actually happened this frame

    const reason = await consumeWatchdogTrip(page);
    expect(reason, 'watchdog should have tripped and reported why').not.toBeNull();
    expect(reason).toMatch(/frame took|averaged/);

    // The renderer force-disabled Art mode on itself the instant it
    // detected the stall — every SUBSEQUENT draw must be cheap, proving
    // this is a one-frame cost ceiling, not a repeating one.
    for (let i = 0; i < 10; i++) {
      const dt0 = Date.now();
      await draw(page);
      const dt = Date.now() - dt0;
      expect(dt, `frame ${i} after the watchdog tripped should be cheap`).toBeLessThan(100);
    }
    expect(await consumeWatchdogTrip(page)).toBeNull(); // nothing new tripped — it isn't re-triggering itself

    expect(errors, `console errors: ${errors.join('\n')}`).toEqual([]);
  });

  test('MAX_GLYPH_LIVE_CELLS: a dense scene beyond the live-cell cap never attempts the expensive glyph path at all', async ({ page }) => {
    await bootTo(page);
    // Densely fill most of the world (well beyond the 6,000-live-cell cap)
    // and zoom so the visible rect covers a large fraction of it.
    const seeded = await seedDenseArea(page, 0, 0, WORLD.width, WORLD.height);
    expect(seeded).toBeGreaterThan(6_000);
    await setCamera(page, { x: 90, y: 56, scale: 8 });
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

    const before = await page.evaluate(() => {
      const c = document.getElementById('world-canvas') as HTMLCanvasElement;
      return Array.from(c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data);
    });

    await setArtConfig(page, realisticArtConfig());
    await draw(page);
    const during = await page.evaluate(() => {
      const c = document.getElementById('world-canvas') as HTMLCanvasElement;
      return Array.from(c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data);
    });
    expect(during).not.toEqual(before);

    await setArtConfig(page, null);
    await draw(page);
    const after = await page.evaluate(() => {
      const c = document.getElementById('world-canvas') as HTMLCanvasElement;
      return Array.from(c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data);
    });
    expect(after).toEqual(before);

    expect(errors, `console errors: ${errors.join('\n')}`).toEqual([]);
  });
});
