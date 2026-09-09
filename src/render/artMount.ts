/**
 * Reachability for Art mode: a self-mounted trigger tab + a Dialog hosting
 * the full `ArtPanel`, plus the `a` keyboard shortcut. Owned by the `render`
 * agent (`src/render/**`).
 *
 * WHY SELF-MOUNTED rather than a `Hud.tsx`/`PanelRight.tsx`/`uiState.ts`
 * edit: those files are outside this pass's assigned ownership (see
 * `ArtPanel.tsx`'s doc), and per this repo's own established precedent —
 * `@/ui/achievements`'s logbook originally shipped exactly this way for the
 * same reason (see INTEGRATION-NOTES.md's achievements entries) before a
 * later integration pass relocated it to a proper HUD button. The exact
 * diff for that permanent home is proposed in INTEGRATION-NOTES.md here too.
 *
 * `ensureArtUiMounted(renderer)` is called once from `WorldRendererImpl.
 * attach()` (this agent's own file, passing itself) — the one lifecycle
 * hook guaranteed to run whenever a real session boots, without needing any
 * other module's cooperation OR `@/ui/session`'s `getSession()` (which is
 * still `null` at exactly this point in boot — `initSession()` calls
 * `renderer.attach()` well before it finishes assigning the module-level
 * session). Taking the renderer instance directly, rather than looking it
 * up later via `getSession()`, means the store->renderer bridge below works
 * correctly from the very first frame, including a persisted `enabled:
 * true` config from a previous visit. Idempotent; a no-op outside a real
 * browser DOM (SSR, most unit tests) and skipped entirely under Vitest so
 * the render-dirty/camera/pattern test suites never see it mount anything
 * into `document.body`.
 */
import { createRoot } from 'react-dom/client';
import { createElement } from 'react';
import { shouldIgnoreGlobalShortcut } from '@/interact/globalShortcutGuard';
import { TooltipProvider } from '@/ui/primitives';
import { bus } from '@/ui/bus';
import { getSession } from '@/ui/session';
import { ArtTrigger } from './ArtTrigger';
import { useArtStore } from './artStore';
import type { ArtConfig } from './artConfig';
import { GLYPH_COMFORTABLE_DEVICE_PX, glyphsLegibleAt, type WorldRenderer } from './renderer';

let mounted = false;

function syncToRenderer(renderer: WorldRenderer, config: ArtConfig): void {
  renderer.setArtConfig(config.enabled ? config : null);
}

/**
 * "and I hate you have to zoom in" (real user report): the legibility gate
 * (`glyphsLegibleAt`) is correct and necessary — below it a glyph is just an
 * illegible smear — but a user who flips Art mode on at whatever zoom they
 * already happen to be at, below that floor, sees literally nothing change.
 * That reads as broken, not as "zoom in more to find the feature".
 *
 * So: on the OFF->ON transition only (never on every subsequent config
 * tweak — see the one call site below), ease the camera to a comfortably
 * legible scale if it isn't already there, keeping the CURRENT look-at
 * point fixed (only `scale` is a `follow()` target here, so this zooms,
 * it never pans). Uses the exact same `follow()`/`tick()` path cinematic
 * mode's zooms already use, so `prefers-reduced-motion` is honoured for
 * free (that path snaps straight to the target instead of easing — see
 * `camera.ts`'s `prefersReducedMotion()` — no separate check needed here),
 * and a manual pan/zoom/drag from the user releases it immediately like any
 * other `follow()`, same as a scene beat's camera-ease.
 *
 * `getSession()` — safe here despite the general rule of preferring the
 * `renderer` reference passed into `ensureArtUiMounted` over it (see this
 * file's top doc): unlike THAT call, which happens mid-boot before the
 * module-level session is assigned, this only ever runs from inside the
 * `useArtStore` subscription below, which nothing can trigger before a
 * user has actually interacted with an already-booted app. `ArtPanel.tsx`
 * (this same feature's own settings surface) already establishes this
 * exact pattern.
 */
function easeToLegibleZoomOnEnable(renderer: WorldRenderer): void {
  const camera = getSession()?.camera;
  if (!camera) return;
  const current = camera.camera;
  if (glyphsLegibleAt(current.scale, renderer.dpr)) return; // already legible — leave the user's framing alone
  const targetScale = GLYPH_COMFORTABLE_DEVICE_PX / renderer.dpr;
  camera.follow({ x: current.x, y: current.y }, targetScale);
}

/**
 * TEMPORARY CONTAINMENT HOTFIX — 2026-09-08, RESOLVED 2026-09-08/09 (kept
 * here as history, not deleted, per this repo's convention of leaving the
 * "why" in place — see REVERT CONDITION below for exactly what changed).
 *
 * Real production report: Art mode was rendering NOTHING visible while
 * pinning the CPU hard enough to hard-crash the reporter's Mac ("literally
 * crashing the mac it crashed so hard"). A prior pass believed it had fixed
 * the performance cliff (atlas raster cap, LRU cache, batched composite
 * toggles) — that evidently did not hold.
 *
 * WHAT THE FOLLOW-UP FOUND (measured, not guessed — see `renderer.ts`'s
 * `ART_FRAME_BUDGET_MS` doc and `glyphAtlas.ts`'s webfont doc for the full
 * story): real, reproducible single-frame stalls of roughly one to several
 * seconds in the glyph draw path — the main thread frozen solid for that
 * whole span, which is both "renders nothing visible" and, repeated forever
 * with nothing to stop it, exactly what reads as "crashed." The stall did
 * NOT scale predictably with live cell count or config complexity and
 * persisted after forcing garbage collection — evidence pointing at a
 * browser/graphics-stack-level cost this file's own logic doesn't control,
 * more than a tunable per-cell inefficiency.
 *
 * WHAT WAS FIXED since: (1) a frame-time watchdog in `renderer.ts` that
 * measures the real cost of every art-active frame and force-disables Art
 * mode on itself, same frame, the instant a frame is catastrophically slow
 * or a short run of frames is sustainably too slow — proven via both a
 * deterministic injected-stall e2e test and reproduction of the original
 * uncapped scenario; (2) `MAX_GLYPH_LIVE_CELLS`, a pre-emptive cap that
 * stops a dense scene from ever attempting the expensive draw path at all;
 * (3) elimination of the original per-cell array/string allocation churn;
 * (4) a real, independently-valid fix for canvas `fillText` synchronously
 * blocking on an unloaded webfont (a confirmed contributing risk, not
 * confirmed as the sole cause).
 *
 * WHY CONTAINMENT STAYED ON even with all of that fixed and tested: the
 * watchdog guaranteed the runaway CANNOT repeat, but did not guarantee the
 * FIRST bad frame is short — real-Chrome measurement (headed, real Chrome
 * via `channel: 'chrome'`, not just sandboxed headless) subsequently found
 * it consistently WAS short once the webfont was actually warmed rather than
 * merely kicked off (881ms with no wait -> 333ms after awaiting
 * `document.fonts.ready` + an explicit `fonts.load()`) — see
 * `glyphAtlas.ts`'s `warmUpGlyphFont` doc — but 333ms still exceeds the
 * watchdog's 250ms hard ceiling, which is what a naive "just await the font"
 * fix would still have tripped on the very first real frame.
 *
 * WHAT CLOSED IT: `renderer.ts`'s `warmUpArt()` — awaits the font AND
 * pre-rasterises the atlas AND pre-warms the exact `drawImage`+`source-in`
 * canvas call shape `#drawGlyphs` batches, chunked off the main thread across
 * idle callbacks, entirely BEFORE Art mode's first real frame — plus a
 * narrowly-scoped, one-shot watchdog grace (`ART_WARMUP_GRACE_CEILING_MS`)
 * for exactly that one already-expected frame, so a warm-up that doesn't
 * fully eliminate the residual cost on some browser/GPU still doesn't get
 * permanently punished for the one frame it explicitly flagged as expected.
 * `enableWithWarmup` below is the orchestration: warm, THEN flip Art mode on
 * with grace armed, never the other way around.
 *
 * REVERT CONDITION (met): real-Chrome (not just headless) confirmation, via
 * `e2e/art-perf.spec.ts`'s "real Chrome" describe block, that a full
 * classic-ASCII-preset session (30 zoom steps + 10 pans) never exceeds the
 * watchdog's hard ceiling once warm, stays within budget at p95, keeps a
 * flat/falling heap, and — critically — leaves Art mode STILL ENABLED at the
 * end (the watchdog never had to fire). Reachability (the trigger tab, the
 * `a` shortcut, the persisted-`enabled:true`-on-boot path — all now routed
 * through `enableWithWarmup`) is restored below.
 */
/**
 * How long a warm-up is allowed to run before this tells the user anything
 * at all. Real-Chrome measurement (see `glyphAtlas.ts`'s `warmUpGlyphFont`
 * doc) found the font/atlas/canvas warm-up itself typically resolves fast
 * enough to be imperceptible — this delay is only ever what a user actually
 * sees, never a fixed "always show a spinner" tax. If `warmUpArt` resolves
 * before this timer fires, the toast is simply never shown.
 */
const PREPARING_TOAST_DELAY_MS = 150;

/**
 * Monotonic token guarding in-flight `warmUpArt()` calls from this module's
 * side: bumped on every OFF->ON edge and every OTHER config sync, so a
 * warm-up superseded by a later toggle/edit (the user flips Art mode
 * on/off/on again, or edits the config, while the first warm-up is still
 * resolving) never applies its now-stale config once it finally settles.
 * `renderer.ts`'s own `#artWarmupToken` guards the CANVAS side of the same
 * race independently — this one guards which config actually gets applied.
 */
let warmupToken = 0;

/**
 * Orchestrates a real Art-mode ENABLE: warm up (font + atlas + the canvas's
 * lazy-init cost — see `renderer.ts`'s `warmUpArt` doc) BEFORE the config
 * that turns Art mode on ever reaches the renderer, then apply it with the
 * watchdog's one-shot warm-up grace armed (`ART_WARMUP_GRACE_CEILING_MS`).
 * Never blocks the UI thread — `warmUpArt` itself is chunked off the main
 * thread, and this function is `async`/fire-and-forget from every call site.
 * Only the ONE real enable path (the OFF->ON store edge and the
 * persisted-`enabled:true` boot sync) ever calls this — a later tweak while
 * already enabled goes through the plain `syncToRenderer` below instead,
 * since only the true first-enable frame has the expected one-time cost
 * warm-up and grace both exist for.
 */
async function enableWithWarmup(renderer: WorldRenderer, config: ArtConfig): Promise<void> {
  const token = ++warmupToken;
  const prepTimer = setTimeout(() => {
    if (token === warmupToken) {
      bus.emit('toast', { message: 'Preparing Art mode…', tone: 'info' });
    }
  }, PREPARING_TOAST_DELAY_MS);
  try {
    await renderer.warmUpArt(config);
  } finally {
    clearTimeout(prepTimer);
  }
  // Superseded by a later toggle/edit while warming (e.g. rapid on/off/on,
  // or the user changed a control before this settled) — the newer call
  // owns applying whatever config is now current; this stale one must not
  // stomp it.
  if (token !== warmupToken) return;
  renderer.setArtConfig(config, { warmupGrace: true });
  easeToLegibleZoomOnEnable(renderer);
}

export function ensureArtUiMounted(renderer: WorldRenderer): void {
  if (mounted) return;
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  // Vitest sets `MODE=test`; keep the (already-noisy, canvas-less) jsdom
  // unit-test environment free of an extra DOM root and keydown listener
  // that no test suite asks for or asserts on. Real dev/prod/e2e all mount.
  if (import.meta.env?.MODE === 'test') return;
  mounted = true;

  // The one bridge between "user changed a control" and "the canvas
  // actually looks different" — every `artStore` mutation re-pushes the
  // whole config to this exact renderer instance. The OFF->ON edge is
  // special-cased through `enableWithWarmup` (see its doc) rather than
  // applied immediately — every OTHER edge (a tweak while already on, or
  // turning off, which is always cheap) still syncs synchronously here.
  useArtStore.subscribe((s, prev) => {
    const turningOn = s.config.enabled && !prev.config.enabled;
    if (turningOn) {
      void enableWithWarmup(renderer, s.config); // applies the config itself once warm — see its doc
      return;
    }
    warmupToken += 1; // invalidate any warm-up still in flight for a now-superseded config
    syncToRenderer(renderer, s.config);
  });

  // Run once immediately so a config persisted as `enabled: true` from a
  // previous visit applies on load, not only after the next store change —
  // this is exactly the "returning user" path `glyphAtlas.ts`'s webfont doc
  // calls out as the highest-risk case, so it gets the same warm-up
  // treatment as a live toggle, not a bare `syncToRenderer`.
  const initialConfig = useArtStore.getState().config;
  if (initialConfig.enabled) {
    void enableWithWarmup(renderer, initialConfig);
  } else {
    syncToRenderer(renderer, initialConfig);
  }

  // Frame-time/memory watchdog (see `renderer.ts`'s `watchdogShouldTrip` doc)
  // — the renderer already force-disables ITSELF (nulls its own art field)
  // the instant a frame/sustained-average is too expensive, so the actual
  // safety property doesn't depend on this loop running promptly. This is
  // purely how the rest of the app finds out: sync `useArtStore` so the
  // panel's checkbox reflects reality instead of silently disagreeing with
  // an already-dark canvas, and tell the user honestly via a toast rather
  // than leaving them wondering why Art mode just stopped. Polled once per
  // animation frame — cheap (a single flag check) — rather than a fixed
  // interval, so it can never itself contribute a scheduling gap on a
  // struggling tab.
  const pollWatchdog = () => {
    const reason = renderer.consumeArtWatchdogTrip();
    if (reason) {
      useArtStore.getState().setEnabled(false);
      bus.emit('toast', {
        message: `Art mode turned itself off — it was too expensive for this device right now (${reason}). Your other settings are unchanged; you can turn it back on any time.`,
        tone: 'warn',
      });
    }
    requestAnimationFrame(pollWatchdog);
  };
  requestAnimationFrame(pollWatchdog);

  window.addEventListener('keydown', (e) => {
    if (shouldIgnoreGlobalShortcut(e.target, e.key)) return;
    if (e.key.toLowerCase() === 'a' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      useArtStore.getState().toggleEnabled();
    }
  });

  const host = document.createElement('div');
  host.id = 'art-mode-trigger-root';
  document.body.appendChild(host);
  // This mounts as its OWN React root, entirely separate from `App.tsx`'s
  // tree — it does not inherit that tree's `TooltipProvider`, so `Tooltip`
  // (used by the trigger's two `IconButton`s) needs its own instance here,
  // or every render throws "Tooltip must be used within TooltipProvider".
  createRoot(host).render(createElement(TooltipProvider, null, createElement(ArtTrigger)));
}
