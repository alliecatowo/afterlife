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
import { Hud } from '@/ui/hud/Hud';
import { Drawer } from '@/ui/drawer/Drawer';
import { PanelRight } from '@/ui/panels/PanelRight';
import { Timeline } from '@/ui/timeline/Timeline';
import { TitlePlate } from '@/ui/TitlePlate';
import { WorldHint } from '@/ui/WorldHint';
import { WorldStateOverlay } from '@/ui/WorldStateOverlay';
import { ShortcutsDialog } from '@/ui/dialogs/ShortcutsDialog';
import { ToastLayer, TooltipProvider } from '@/ui/primitives';
import type { RenderLens } from '@/core/types';

const LENS_CYCLE: RenderLens[] = ['life', 'age', 'activity'];
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
  const playing = useAppStore((s) => s.playing);
  const setPlaying = useAppStore((s) => s.setPlaying);
  const setTool = useAppStore((s) => s.setTool);
  const showGrid = useAppStore((s) => s.showGrid);
  const setShowGrid = useAppStore((s) => s.setShowGrid);
  const lens = useAppStore((s) => s.lens);
  const setLens = useAppStore((s) => s.setLens);
  const drawerOpen = useAppStore((s) => s.drawerOpen);
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
  // canvas also marks it "touched" for the quiet drawing invitation.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onPointerDown = (e: PointerEvent) => {
      dismissTitle();
      if (canvasWrapRef.current?.contains(e.target as Node)) setWorldTouched();
    };
    root.addEventListener('pointerdown', onPointerDown, { capture: true });
    return () => root.removeEventListener('pointerdown', onPointerDown, { capture: true });
  }, [dismissTitle, setWorldTouched]);

  // Global keyboard shortcuts. Ignored while typing (branch rename, etc.) or
  // while a dialog already owns focus.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || shortcutsOpen) {
        if (e.key === 'Escape') setShortcutsOpen(false);
        return;
      }
      if (e.key === '?') { setShortcutsOpen(true); return; }
      if (e.key === 'Escape') {
        if (presentation) setPresentation(false);
        else if (rightPanel) setRightPanel(null);
        return;
      }
      if (e.key === ' ') {
        e.preventDefault();
        const next = !playing;
        setPlaying(next);
        bus.emit(next ? 'playback:play' : 'playback:pause', undefined);
        return;
      }
      if (e.key === 'ArrowRight' && !playing) { bus.emit('playback:step', { by: 1 }); return; }
      if (e.key === 'ArrowLeft' && !playing) { bus.emit('playback:step', { by: -1 }); return; }
      const lower = e.key.toLowerCase();
      if (lower in TOOL_KEYS) { setTool(TOOL_KEYS[lower]!); return; }
      if (lower === 'g') { setShowGrid(!showGrid); return; }
      if (lower === 'f') {
        const next = !presentation;
        setPresentation(next);
        bus.emit('presentation:toggle', { on: next });
        return;
      }
      if (lower === 'l') {
        const next = LENS_CYCLE[(LENS_CYCLE.indexOf(lens) + 1) % LENS_CYCLE.length]!;
        setLens(next);
        bus.emit('lens:changed', { lens: next });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [playing, presentation, rightPanel, lens, showGrid, shortcutsOpen, setPlaying, setPresentation, setRightPanel, setTool, setShowGrid, setLens, setShortcutsOpen]);

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
              'fixed inset-y-0 left-0 z-[var(--z-overlay)] w-72 max-w-[85vw] -translate-x-full border-r border-line ' +
              'bg-ink-800 transition-transform duration-[var(--duration-base)] ease-[var(--ease-standard)] ' +
              'data-[open=true]:translate-x-0 md:static md:z-auto md:w-auto md:max-w-none md:translate-x-0 ' +
              (presentation ? 'md:hidden' : 'min-h-0 overflow-y-auto md:block')
            }
          >
            <Drawer />
          </aside>

          <section ref={canvasWrapRef} className="relative min-h-0 min-w-0">
            <canvas id="world-canvas" className="absolute inset-0 h-full w-full" data-show-grid={showGrid} />
            <canvas id="compare-canvas" className="absolute inset-0 hidden h-full w-full" />
            <div id="sculpture-canvas" className="absolute inset-0 hidden" aria-hidden="true" />
            <TitlePlate />
            <WorldHint />
            <WorldStateOverlay />
          </section>

          <aside
            id="panel-right"
            data-open={Boolean(rightPanel)}
            className={
              'fixed inset-y-0 right-0 z-[var(--z-overlay)] w-80 max-w-[90vw] translate-x-full border-l border-line ' +
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
