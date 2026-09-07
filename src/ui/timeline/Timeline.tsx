/**
 * The history ribbon — AFTERLIFE's signature feature. A draggable,
 * keyboard-operable canvas the user scrubs through recorded time. Renders on
 * its own canvas (never a generic `<input type=range>`) so the profile can
 * stay smooth at any zoom.
 *
 * Emits the documented bus intent (`playback:scrub`) and never mutates
 * simulation state directly — whatever owns the `TimelineStore` instance is
 * responsible for calling `goto()`, catching `HistoryWindowError`, and
 * emitting the `--accent-warn` toast (ARCHITECTURE.md § History). This
 * component only ever clamps its own requests to `[windowStart, maxGen]` and
 * reflects `scrubbing` back as a seek-in-progress cue.
 *
 * PERFORMANCE: `gen:changed` can fire up to 60x/sec. Nothing in this
 * component calls `setState` from the draw loop — the caption row and a11y
 * value attrs are written straight to DOM refs, same discipline as the HUD
 * readouts.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { bus } from '@/ui/bus';
import { useAppStore } from '@/ui/store';
import { getSession } from '@/ui/session';
import { subscribeReadout } from '@/ui/hooks/useSimulationReadout';
import { HISTORY_WINDOW, KEYFRAME_INTERVAL } from '@/core/history';
import { historyRing } from './historyRing';
import { drawRibbon, readRibbonColors, ribbonGeometry, type RibbonColors } from './ribbon';

export function Timeline() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const captionRef = useRef<HTMLSpanElement>(null);
  const colorsRef = useRef<RibbonColors | null>(null);
  const currentGenRef = useRef(0);

  const branches = useAppStore((s) => s.branches);
  const activeBranch = useAppStore((s) => s.activeBranch);
  const scrubbing = useAppStore((s) => s.scrubbing);
  const setScrubbing = useAppStore((s) => s.setScrubbing);

  const [dragGen, setDragGen] = useState<number | null>(null);
  const draggingRef = useRef(false);

  // A quiet, one-time invitation: "explore its past". Dismissed permanently
  // the first time the ribbon is actually scrubbed.
  const [everScrubbed, setEverScrubbed] = useState(false);
  useEffect(() => {
    if (scrubbing) setEverScrubbed(true);
  }, [scrubbing]);

  const branchName = useMemo(
    () => branches.find((b) => b.id === activeBranch)?.name ?? 'root',
    [branches, activeBranch],
  );

  // Imperative gen readout — zero React renders per generation.
  useEffect(() => subscribeReadout((r) => {
    currentGenRef.current = r.gen;
  }), []);

  // The authoritative bounds come from the live `TimelineStore`, never from
  // `historyRing` alone: the ring only remembers generations this session has
  // actually observed via `gen:changed` and — by design — resets its trace
  // whenever the generation moves backward or sideways (a scrub, a branch
  // switch). Deriving the scrub ceiling from the ring would leave the user
  // stuck unable to drag past wherever they currently sit immediately after
  // scrubbing backward, since the ring's own "maxGen" resets right along with
  // the scrub. The ring is still exactly right for the population/activity
  // trace itself, which legitimately only has data for observed generations.
  const clampGen = useCallback((gen: number) => {
    const session = getSession();
    const maxGen = session ? session.history.maxGen : Math.max(currentGenRef.current, historyRing.snapshot().maxGen);
    const windowStart = session ? session.history.windowStart : Math.max(0, maxGen - HISTORY_WINDOW);
    return Math.min(maxGen, Math.max(windowStart, Math.round(gen)));
  }, []);

  const commitScrub = useCallback((gen: number, done: boolean) => {
    const clamped = clampGen(gen);
    if (done) {
      setScrubbing(false);
      setDragGen(null);
    } else {
      setScrubbing(true);
      setDragGen(clamped);
    }
    bus.emit('playback:scrub', { gen: clamped, done });
  }, [clampGen, setScrubbing]);

  // rAF draw loop + imperative caption/a11y writes. Cheap (<=4096 samples, one
  // small canvas) — redraw is gated on an actual change so an idle, paused
  // timeline burns nothing.
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    colorsRef.current ??= readRibbonColors();

    let raf = 0;
    let lastKey = '';
    let lastCssW = 0;
    let lastCssH = 0;

    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      lastCssW = rect.width;
      lastCssH = rect.height;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const tick = () => {
      const snap = historyRing.snapshot();
      const gen = currentGenRef.current;
      const session = getSession();
      const maxGen = session ? Math.max(gen, session.history.maxGen) : Math.max(gen, snap.maxGen);
      const windowStart = session ? session.history.windowStart : Math.max(0, maxGen - HISTORY_WINDOW);
      const shownGen = dragGen ?? gen;

      const key = [snap.version, gen, dragGen, scrubbing, lastCssW, lastCssH, branches.length, maxGen, windowStart].join(':');
      if (key !== lastKey) {
        lastKey = key;
        drawRibbon(ctx, lastCssW, lastCssH, {
          snapshot: snap,
          windowStart,
          currentGen: gen,
          branches,
          scrubGen: dragGen,
          seeking: scrubbing,
          colors: colorsRef.current!,
        });
        if (captionRef.current) {
          captionRef.current.textContent = scrubbing ? 'seeking…' : `gen ${windowStart}–${maxGen}`;
        }
        wrap.setAttribute('aria-valuemin', String(windowStart));
        wrap.setAttribute('aria-valuemax', String(maxGen));
        wrap.setAttribute('aria-valuenow', String(shownGen));
        wrap.setAttribute('aria-valuetext', `generation ${shownGen} of ${maxGen}`);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [branches, dragGen, scrubbing]);

  const genFromPointer = useCallback((clientX: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return currentGenRef.current;
    const rect = canvas.getBoundingClientRect();
    const session = getSession();
    const geo = ribbonGeometry(rect.width, {
      snapshot: historyRing.snapshot(),
      windowStart: session ? session.history.windowStart : 0,
      currentGen: session ? session.history.maxGen : currentGenRef.current,
    });
    return geo.xToGen(clientX - rect.left);
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    draggingRef.current = true;
    commitScrub(genFromPointer(e.clientX), false);
  }, [commitScrub, genFromPointer]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    commitScrub(genFromPointer(e.clientX), false);
  }, [commitScrub, genFromPointer]);

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    commitScrub(genFromPointer(e.clientX), true);
  }, [commitScrub, genFromPointer]);

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const gen = dragGen ?? currentGenRef.current;
    const jump = KEYFRAME_INTERVAL;
    let next: number | null = null;
    switch (e.key) {
      case 'ArrowLeft': next = gen - (e.shiftKey ? jump : 1); break;
      case 'ArrowRight': next = gen + (e.shiftKey ? jump : 1); break;
      case 'Home': next = 0; break;
      case 'End': {
        const session = getSession();
        next = session ? session.history.maxGen : Math.max(currentGenRef.current, historyRing.snapshot().maxGen);
        break;
      }
      default: return;
    }
    e.preventDefault();
    // `@/interact/input.ts` also binds arrow keys globally (camera pan). Stop
    // native propagation so a focused ribbon scrubs time, not the camera.
    e.stopPropagation();
    commitScrub(next, true);
  }, [commitScrub, dragGen]);

  return (
    <div className="flex h-full flex-col justify-center gap-1 py-1.5">
      <div className="flex items-baseline justify-between text-micro uppercase tracking-[0.18em] text-ivory-300">
        <span>
          {branchName}
          {!everScrubbed && <span className="ml-2 normal-case italic tracking-normal">— drag to explore its past</span>}
        </span>
        <span ref={captionRef} className="tabular normal-case tracking-normal">gen 0–0</span>
      </div>
      <div
        ref={wrapRef}
        role="slider"
        tabIndex={0}
        aria-label="History timeline"
        aria-valuemin={0}
        aria-valuemax={0}
        aria-valuenow={0}
        className="relative h-11 w-full cursor-ew-resize rounded-sm focus-visible:focus-ring outline-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onKeyDown={onKeyDown}
      >
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      </div>
    </div>
  );
}
