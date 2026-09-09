/**
 * The shell. Owned by the `ui` agent from here on.
 *
 * Layout contract — these element ids are ANCHORS other agents mount into.
 * Do not rename them:
 *   #world-canvas      the simulation canvas (render agent)
 *   #sculpture-canvas  the R3F Time Sculpture host (sculpture agent)
 *   #hud-top           top status/transport bar
 *   #timeline          bottom scrubber + branch track
 *   #drawer-left       tools, patterns, lenses
 *   #panel-right       inspector, branches, discoveries
 *   #toast-layer       transient notices
 *   #compare-canvas    side-by-side branch diff canvas
 *
 * Composition rule: the world dominates; chrome holds a slim perimeter.
 * Below `md` the drawer/panel become slide-over sheets instead of grid
 * columns, so the canvas keeps the screen on a 390px phone.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import '@/styles/motion.css';
import { useAppStore, type Tool } from '@/ui/store';
import { useUIState } from '@/ui/uiState';
import { bus } from '@/ui/bus';
import { getSession, initSession } from '@/ui/session';
import { Hud } from '@/ui/hud/Hud';
import { Drawer } from '@/ui/drawer/Drawer';
import { PanelRight } from '@/ui/panels/PanelRight';
import { Timeline } from '@/ui/timeline/Timeline';
import { TitlePlate } from '@/ui/TitlePlate';
import { WorldHint } from '@/ui/WorldHint';
import { WorldStateOverlay } from '@/ui/WorldStateOverlay';
import { SceneAnnotation } from '@/ui/SceneAnnotation';
import { ShortcutsDialog } from '@/ui/dialogs/ShortcutsDialog';
import { ToastLayer, TooltipProvider } from '@/ui/primitives';
import { shouldIgnoreGlobalShortcut } from '@/interact/globalShortcutGuard';
import { TourOverlay } from '@/ui/tutorial/TourOverlay';
import { AboutDialog } from '@/ui/tutorial/AboutDialog';
import { useTourStore } from '@/ui/tutorial/tourStore';
// The achievements logbook's dialog — mounted here (not inside `Hud.tsx`)
// for the same reason `ShortcutsDialog`/`AboutDialog` are: it must stay
// reachable/functional independent of `Hud`'s own presentation-mode early
// return. The trigger BUTTON lives in `Hud.tsx`/`HudMoreSheet.tsx` (and
// correctly disappears in presentation mode, like every other HUD icon).
import { AchievementsPanel } from '@/ui/achievements';
// The opt-in multiplayer feature's mount point. Renders NOTHING and fetches
// no code until the user explicitly asks for it from a HUD entry point —
// see `@/ui/hud/multiplayerLazy`'s doc and `tests/net-guard.test.ts` for the
// guarantee this preserves (this file's own static imports never reach
// `@/net` or `@/ui/multiplayer`, only this local lazy-loading module).
import { MultiplayerLazyHost } from '@/ui/hud/multiplayerLazy';

const TOOL_KEYS: Record<string, Tool> = { d: 'draw', e: 'erase', p: 'pan', s: 'select' };

function UnsupportedShell() {
  return (
    <div className="grid h-full w-full place-items-center bg-ink-900 px-6 text-center text-ivory-200">
      <div className="flex max-w-sm flex-col items-center gap-3">
        <h1 className="display-face text-display text-ivory-100">AFTERLIFE needs a newer browser.</h1>
        <p className="text-sm text-ivory-300">
          This observatory draws its universe on a 2D canvas, which this browser does not report
          support for. Try the latest Chrome, Firefox, Safari or Edge.
        </p>
      </div>
    </div>
  );
}

export function App() {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const presentation = useAppStore((s) => s.presentation);
  const setPresentation = useAppStore((s) => s.setPresentation);
  const setTool = useAppStore((s) => s.setTool);
  const showGrid = useAppStore((s) => s.showGrid);
  const drawerOpen = useAppStore((s) => s.drawerOpen);
  const compareWith = useAppStore((s) => s.compareWith);
  const rightPanel = useUIState((s) => s.rightPanel);
  const setRightPanel = useUIState((s) => s.setRightPanel);
  const titleDismissed = useUIState((s) => s.titleDismissed);
  const dismissTitle = useUIState((s) => s.dismissTitle);
  const setWorldTouched = useUIState((s) => s.setWorldTouched);
  const setShortcutsOpen = useUIState((s) => s.setShortcutsOpen);
  const logbookOpen = useUIState((s) => s.logbookOpen);
  const setLogbookOpen = useUIState((s) => s.setLogbookOpen);

  const [supported] = useState(() => typeof window === 'undefined' || 'CanvasRenderingContext2D' in window);
  const setDrawerOpen = useAppStore((s) => s.setDrawerOpen);

  // The drawer's shared `drawerOpen` flag defaults to true, which is right
  // for desktop (a 240px rail beside a wide canvas) but would cover most of
  // a phone screen as a slide-over sheet. Start it closed on narrow
  // viewports only — the world should be the very first thing a phone user
  // sees, per DESIGN's "world dominates" rule.
  useEffect(() => {
    if (window.innerWidth < 768) setDrawerOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // First pointer interaction anywhere dismisses the title plate immediately
  // — no click-to-continue gate. A pointer specifically over the world
  // canvas also marks it "touched" for the quiet drawing invitation. It is
  // also the one and only real user gesture the soundscape's `AudioContext`
  // is created from (browsers refuse otherwise) — see `@/audio/audio.ts`'s
  // doc comment. Muted stays muted; this only makes unmuting later actually
  // produce sound instead of a silently-blocked context.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let audioInited = false;
    const onPointerDown = (e: PointerEvent) => {
      dismissTitle();
      if (canvasWrapRef.current?.contains(e.target as Node)) setWorldTouched();
      if (!audioInited) {
        audioInited = true;
        void getSession()?.soundscape.init();
      }
    };
    root.addEventListener('pointerdown', onPointerDown, { capture: true });
    return () => root.removeEventListener('pointerdown', onPointerDown, { capture: true });
  }, [dismissTitle, setWorldTouched]);

  // The pointerdown listener above is the only thing that ever dismissed the
  // title plate, which meant a keyboard-only visitor could never dismiss it
  // (and, by extension, could never reach the guided tour below, which waits
  // for that same dismissal) — an oversight this tour work needed fixed
  // regardless of the tour itself, since "fully keyboard operable" applies to
  // getting the tour to start at all. Any first keypress now does the same.
  useEffect(() => {
    const onKeyDown = () => {
      // Guard against re-setting an already-true flag on every keystroke —
      // `dismissTitle()` is a plain zustand `set()`, which notifies
      // subscribers on every call regardless of whether the value actually
      // changed, and this listener runs in the capture phase on EVERY key
      // press app-wide (renaming a branch, typing in a save dialog, ...).
      if (!useUIState.getState().titleDismissed) dismissTitle();
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [dismissTitle]);

  // Wire the now-implemented core/render/interact modules into a running
  // universe once the canvases exist. See `@/ui/session` — idempotent, so
  // StrictMode's double-invoke is harmless.
  useEffect(() => {
    if (supported) initSession();
  }, [supported]);

  // The guided tour auto-runs exactly once per browser, the first time the
  // title plate is dismissed (the same "first real interaction" signal
  // `setWorldTouched` above already uses) — never before, so it doesn't
  // compete with the title card, and never gated behind a click specifically
  // on the world, so a keyboard-only first interaction still triggers it.
  // `start()` is itself a no-op once `tourStore.seen` is true, so this is
  // safe to run on every mount; the actual "don't show it again" persistence
  // lives in `@/ui/tutorial/tourStore`.
  useEffect(() => {
    if (titleDismissed) useTourStore.getState().start();
  }, [titleDismissed]);

  // Global keyboard shortcuts NOT already owned by `@/interact/input.ts`
  // (which handles Space, arrows [camera pan], 1-8 [lens], g [grid],
  // r/f [stamp rotate/flip], +/-/=/_ [zoom], ., [, ], z once attached by
  // `initSession()`). Ignored while typing, while a dialog owns focus, or
  // while the focused control would consume this key itself — see
  // `@/interact/globalShortcutGuard.ts`.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (shouldIgnoreGlobalShortcut(e.target, e.key)) {
        // The shortcuts sheet is the one dialog currently in the app;
        // Radix already closes it on Escape internally (this call is a
        // harmless no-op otherwise), kept explicit so a future non-Radix
        // dialog can't leave `shortcutsOpen` stuck true.
        if (e.key === 'Escape') setShortcutsOpen(false);
        return;
      }
      if (e.key === '?') { setShortcutsOpen(true); return; }
      if (e.key === 'Escape') {
        if (presentation) { setPresentation(false); bus.emit('presentation:toggle', { on: false }); }
        else if (rightPanel) setRightPanel(null);
        return;
      }
      const lower = e.key.toLowerCase();
      if (lower in TOOL_KEYS) { setTool(TOOL_KEYS[lower]!); return; }
      if (lower === 'v') {
        const next = !presentation;
        setPresentation(next);
        bus.emit('presentation:toggle', { on: next });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [presentation, rightPanel, setPresentation, setRightPanel, setTool, setShortcutsOpen]);

  if (!supported) return <UnsupportedShell />;

  return (
    <TooltipProvider delayDuration={400}>
      <div
        ref={rootRef}
        className={
          // Rows grow by the notch/home-indicator inset (via `env()`) rather
          // than the fixed `--size-hud`/`--size-timeline` tokens shrinking to
          // fit inside it — a real iPhone's safe area would otherwise eat
          // straight into the 48px HUD row's already-tight icon row. `_+_`
          // is Tailwind's escape for the literal space CSS `calc()` requires
          // around `+`/`-` (a bare `+` with no surrounding space is invalid
          // calc syntax and silently no-ops). `env(safe-area-inset-*)`
          // resolves to `0px` on any device without a safe area (desktop,
          // older phones), so this is a no-op there.
          'grid h-full w-full bg-ink-900 text-ivory-200 ' +
          (presentation
            ? 'grid-rows-[0_1fr_0]'
            : 'grid-rows-[calc(var(--size-hud)_+_env(safe-area-inset-top))_1fr_calc(var(--size-timeline)_+_env(safe-area-inset-bottom))]')
        }
      >
        <header
          id="hud-top"
          className={
            'relative z-[var(--z-chrome)] overflow-hidden border-line bg-ink-800 transition-[height] duration-[var(--duration-base)] ' +
            (presentation ? 'h-0 border-b-0' : 'h-[calc(var(--size-hud)_+_env(safe-area-inset-top))] border-b')
          }
        >
          <Hud />
        </header>

        <main
          className="relative grid min-h-0 grid-cols-1 md:grid-cols-[var(--col-drawer)_1fr_var(--col-panel)]"
          style={
            {
              // CSS Grid tracks with an explicit length (the old static
              // `var(--size-drawer)_1fr_var(--size-panel)` template) never
              // shrink to fit a narrower child — `#drawer-left`'s collapsed
              // rail and `#panel-right`'s closed state both set `md:w-auto`/
              // `md:w-0` on THEMSELVES, but a grid item's own width is
              // irrelevant once its track has a fixed size; the item just
              // stretches (or clips) to fill that track regardless. That left
              // the canvas permanently 240px+304px narrower than the
              // viewport no matter what was open — collapsing the drawer just
              // uncovered a dead black column, not more world, which is the
              // opposite of DESIGN.md's "world dominates" rule.
              //
              // The fix drives the TRACK sizes themselves from the same state
              // that drives each aside's own width: `max-content` lets the
              // drawer column shrink to exactly the collapsed rail's
              // intrinsic width, and `0px` truly removes the panel column
              // (and, in presentation mode, both) instead of merely hiding
              // content inside a track that still reserves the space.
              '--col-drawer': presentation ? '0px' : drawerOpen ? 'var(--size-drawer)' : 'max-content',
              '--col-panel': presentation ? '0px' : rightPanel ? 'var(--size-panel)' : '0px',
            } as CSSProperties
          }
        >
          <aside
            id="drawer-left"
            aria-label="Specimen drawer"
            data-open={drawerOpen}
            className={
              // Below `md` this is a slide-over sheet, not the desktop rail — width
              // matches the desktop column's own `--size-drawer` (240px, already
              // proven to fit the pattern list's two-column rows) rather than the
              // old fixed 288px/85vw, which ate ~74% of a 390px phone screen and
              // left almost no world (or room for the pattern tooltips) visible.
              'fixed inset-y-0 left-0 z-[var(--z-overlay)] w-[var(--size-drawer)] max-w-[78vw] -translate-x-full border-r border-line ' +
              'bg-ink-800 transition-transform duration-[var(--duration-base)] ease-[var(--ease-standard)] ' +
              // Explicit column placement, not auto-placement: in
              // presentation mode this aside AND `#panel-right` both go
              // `md:hidden`, and a `display:none` grid item is skipped
              // entirely by auto-placement — without an explicit start, the
              // world `<section>` below would slide into column 1 (0px) and
              // `#panel-right` into column 2 (the world's own 1fr track),
              // leaving the canvas at 0 width. Pinning every child to its
              // column makes that immune to which siblings are hidden.
              // `data-[open=false]:pointer-events-none` (mobile sheet mode
              // only — `md:data-[open=false]:pointer-events-auto` restores it
              // for the desktop rail, which is never actually "closed" the
              // same way): closing this still takes `--duration-base` (220ms)
              // to slide fully off-screen. Without this, a tap landing in the
              // strip it's still animating across during that window hits the
              // now-logically-closed drawer instead of the canvas underneath
              // it — real, findable jank on a quick two-tap sequence (close,
              // then immediately draw/select in that region), not just a test
              // timing artifact.
              //
              // BUG (found via e2e/layout.spec.ts failing at desktop width
              // with the collapsed rail entirely unclickable): a bare
              // `md:pointer-events-auto` does NOT reliably override
              // `data-[open=false]:pointer-events-none` here. Tailwind
              // compiles `data-[open=false]:pointer-events-none` to
              // `.data-\[open\=false\]\:pointer-events-none[data-open=false]`
              // — a CLASS selector plus an ATTRIBUTE selector, specificity
              // (0,2,0) — while a plain `md:pointer-events-auto` compiles to
              // just `.md\:pointer-events-auto` inside a media query,
              // specificity (0,1,0). The higher-specificity rule wins
              // regardless of viewport, so the desktop "override" never
              // actually applied — verified: `getComputedStyle(...)
              // .pointerEvents` was `'none'` at 1440px whenever the rail was
              // collapsed. Repeating the SAME `data-[open=false]` condition in
              // the desktop override (`md:data-[open=false]:pointer-events-auto`)
              // gives it the matching (0,2,0) specificity, so it wins on
              // source order (Tailwind emits `md:` rules after the base
              // layer) instead of losing to a specificity mismatch.
              'data-[open=true]:translate-x-0 data-[open=false]:pointer-events-none md:data-[open=false]:pointer-events-auto md:static md:z-auto md:col-start-1 md:w-auto md:max-w-none md:translate-x-0 ' +
              // Only matters in the mobile `fixed inset-y-0` sheet mode above
              // (`md:static` opts back into the ordinary grid row, which is
              // already safe-area-aware via the header/footer track heights):
              // this sheet spans the full viewport height directly, including
              // any notch/home-indicator band the header/footer rows don't
              // cover for it.
              'pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] md:p-0 ' +
              (presentation ? 'md:hidden' : 'min-h-0 overflow-y-auto md:block')
            }
          >
            <Drawer />
          </aside>

          <section ref={canvasWrapRef} className="relative min-h-0 min-w-0 md:col-start-2">
            {/* A `<canvas>` is otherwise completely opaque to assistive tech —
                no text, no DOM structure, nothing but pixels. `role="img"` +
                `aria-label` gives it a name; `aria-describedby` points at a
                longer, visually-hidden description of how it's actually
                operated (the live generation/population summary lives in the
                HUD's own throttled `aria-live` region instead, so it isn't
                repeated here). */}
            <canvas
              id="world-canvas"
              role="img"
              aria-label="The living world"
              aria-describedby="world-canvas-description"
              className={'absolute inset-y-0 left-0 h-full ' + (compareWith ? 'w-1/2 border-r border-line' : 'w-full')}
              data-show-grid={showGrid}
            />
            <p id="world-canvas-description" className="sr-only">
              A toroidal cellular-automaton grid running Conway&apos;s Life. Draw, erase, pan,
              select or stamp with the tools in the drawer; play, pause and step from the
              transport bar; generation and population are announced there periodically. Press
              the question mark key for the full list of controls.
            </p>
            <canvas
              id="compare-canvas"
              role="img"
              aria-label="Comparison branch B world"
              aria-hidden={!compareWith}
              className={'absolute inset-y-0 h-full ' + (compareWith ? 'right-0 w-1/2' : 'hidden w-full left-0')}
            />
            <div id="sculpture-canvas" className="absolute inset-0 hidden" aria-hidden="true" />
            <TitlePlate />
            <WorldHint />
            <WorldStateOverlay />
            <SceneAnnotation />
          </section>

          <aside
            id="panel-right"
            aria-label="Inspector panel"
            data-open={Boolean(rightPanel)}
            className={
              // Same "mobile sheet, not a squeezed desktop column" fix as
              // `#drawer-left` — width matches the desktop `--size-panel`
              // column (304px) instead of the old 320px/90vw, which left only
              // a sliver of world visible on a phone.
              'fixed inset-y-0 right-0 z-[var(--z-overlay)] w-[var(--size-panel)] max-w-[80vw] translate-x-full border-l border-line ' +
              'bg-ink-800 transition-transform duration-[var(--duration-base)] ease-[var(--ease-standard)] ' +
              // See `#drawer-left`'s comment: explicit column placement so
              // this aside can never slide into the world's own track just
              // because `#drawer-left` happens to be `display:none`.
              // See `#drawer-left`'s matching comment above — same
              // specificity-mismatch fix (`md:data-[open=false]:pointer-events-auto`,
              // not a bare `md:pointer-events-auto`), same real bug: this
              // panel was UNCLICKABLE at desktop widths whenever it was
              // "closed" (`rightPanel === null`), even though it should never
              // need pointer-events disabled at desktop at all — there is no
              // slide-off-screen animation state to guard against there,
              // `md:w-0` already collapses it to zero width instantly.
              'data-[open=true]:translate-x-0 data-[open=false]:pointer-events-none md:data-[open=false]:pointer-events-auto md:static md:z-auto md:col-start-3 md:max-w-none md:translate-x-0 ' +
              (rightPanel ? 'md:w-auto' : 'md:w-0 md:translate-x-0') +
              ' min-h-0 overflow-y-auto ' +
              // See `#drawer-left`'s matching comment.
              'pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pr-[env(safe-area-inset-right)] md:p-0 ' +
              (presentation ? 'md:hidden' : '')
            }
          >
            <PanelRight />
          </aside>

          {(drawerOpen || rightPanel) && (
            <button
              type="button"
              aria-label="Close overlay"
              onClick={() => { setDrawerOpen(false); setRightPanel(null); }}
              className="fixed inset-0 z-[calc(var(--z-overlay)-1)] bg-ink-900/90 md:hidden"
            />
          )}
        </main>

        <footer
          id="timeline"
          className={
            'relative z-[var(--z-chrome)] overflow-hidden border-line bg-ink-800 px-4 transition-[height] duration-[var(--duration-base)] ' +
            (presentation ? 'h-0 border-t-0' : 'h-[calc(var(--size-timeline)_+_env(safe-area-inset-bottom))] border-t')
          }
        >
          <Timeline />
        </footer>

        <div
          id="toast-layer"
          className="pointer-events-none fixed bottom-[calc(var(--size-timeline)_+_env(safe-area-inset-bottom)_+_var(--spacing)*4)] left-1/2 z-[var(--z-toast)] -translate-x-1/2"
          role="status"
          aria-live="polite"
        />
      </div>
      <ToastLayer />
      <ShortcutsDialog />
      <AboutDialog />
      <TourOverlay />
      <AchievementsPanel open={logbookOpen} onOpenChange={setLogbookOpen} />
      <MultiplayerLazyHost />
    </TooltipProvider>
  );
}
