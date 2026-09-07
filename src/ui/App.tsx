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
import { useEffect, useRef, useState } from 'react';
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

const TOOL_KEYS: Record<string, Tool> = { d: 'draw', e: 'erase', p: 'pan', s: 'select' };

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
}

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
  const dismissTitle = useUIState((s) => s.dismissTitle);
  const setWorldTouched = useUIState((s) => s.setWorldTouched);
  const shortcutsOpen = useUIState((s) => s.shortcutsOpen);
  const setShortcutsOpen = useUIState((s) => s.setShortcutsOpen);

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

  // Wire the now-implemented core/render/interact modules into a running
  // universe once the canvases exist. See `@/ui/session` — idempotent, so
  // StrictMode's double-invoke is harmless.
  useEffect(() => {
    if (supported) initSession();
  }, [supported]);

  // Global keyboard shortcuts NOT already owned by `@/interact/input.ts`
  // (which handles Space, arrows [camera pan], 1/2/3 [lens], g [grid],
  // r/f [stamp rotate/flip], +/-/=/_ [zoom], ., [, ], z once attached by
  // `initSession()`). Ignored while typing or while a dialog owns focus.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || shortcutsOpen) {
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
  }, [presentation, rightPanel, shortcutsOpen, setPresentation, setRightPanel, setTool, setShortcutsOpen]);

  if (!supported) return <UnsupportedShell />;

  return (
    <TooltipProvider delayDuration={400}>
      <div
        ref={rootRef}
        className={
          'grid h-full w-full bg-ink-900 text-ivory-200 ' +
          (presentation
            ? 'grid-rows-[0_1fr_0]'
            : 'grid-rows-[var(--size-hud)_1fr_var(--size-timeline)]')
        }
      >
        <header
          id="hud-top"
          className={
            'relative z-[var(--z-chrome)] overflow-hidden border-line bg-ink-800 transition-[height] duration-[var(--duration-base)] ' +
            (presentation ? 'h-0 border-b-0' : 'h-[var(--size-hud)] border-b')
          }
        >
          <Hud />
        </header>

        <main className="relative grid min-h-0 grid-cols-1 md:grid-cols-[var(--size-drawer)_1fr_var(--size-panel)]">
          <aside
            id="drawer-left"
            data-open={drawerOpen}
            className={
              // Below `md` this is a slide-over sheet, not the desktop rail — width
              // matches the desktop column's own `--size-drawer` (240px, already
              // proven to fit the pattern list's two-column rows) rather than the
              // old fixed 288px/85vw, which ate ~74% of a 390px phone screen and
              // left almost no world (or room for the pattern tooltips) visible.
              'fixed inset-y-0 left-0 z-[var(--z-overlay)] w-[var(--size-drawer)] max-w-[78vw] -translate-x-full border-r border-line ' +
              'bg-ink-800 transition-transform duration-[var(--duration-base)] ease-[var(--ease-standard)] ' +
              'data-[open=true]:translate-x-0 md:static md:z-auto md:w-auto md:max-w-none md:translate-x-0 ' +
              (presentation ? 'md:hidden' : 'min-h-0 overflow-y-auto md:block')
            }
          >
            <Drawer />
          </aside>

          <section ref={canvasWrapRef} className="relative min-h-0 min-w-0">
            <canvas
              id="world-canvas"
              className={'absolute inset-y-0 left-0 h-full ' + (compareWith ? 'w-1/2 border-r border-line' : 'w-full')}
              data-show-grid={showGrid}
            />
            <canvas
              id="compare-canvas"
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
            data-open={Boolean(rightPanel)}
            className={
              // Same "mobile sheet, not a squeezed desktop column" fix as
              // `#drawer-left` — width matches the desktop `--size-panel`
              // column (304px) instead of the old 320px/90vw, which left only
              // a sliver of world visible on a phone.
              'fixed inset-y-0 right-0 z-[var(--z-overlay)] w-[var(--size-panel)] max-w-[80vw] translate-x-full border-l border-line ' +
              'bg-ink-800 transition-transform duration-[var(--duration-base)] ease-[var(--ease-standard)] ' +
              'data-[open=true]:translate-x-0 md:static md:z-auto md:max-w-none md:translate-x-0 ' +
              (rightPanel ? 'md:w-auto' : 'md:w-0 md:translate-x-0') +
              ' min-h-0 overflow-y-auto ' +
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
            (presentation ? 'h-0 border-t-0' : 'h-[var(--size-timeline)] border-t')
          }
        >
          <Timeline />
        </footer>

        <div
          id="toast-layer"
          className="pointer-events-none fixed bottom-[calc(var(--size-timeline)+var(--spacing)*4)] left-1/2 z-[var(--z-toast)] -translate-x-1/2"
          role="status"
          aria-live="polite"
        />
      </div>
      <ToastLayer />
      <ShortcutsDialog />
    </TooltipProvider>
  );
}
