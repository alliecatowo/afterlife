/**
 * Time Sculpture — a 3D extrusion of REAL recorded history, built with
 * @react-three/fiber + drei. Mounted into `#sculpture-canvas` by whoever owns
 * app orchestration (the `ui` agent), which is expected to:
 *
 *   const sculpture = createSculpture(document.getElementById('sculpture-canvas')!);
 *   bus.on('sculpture:open', ({ rect, fromGen, toGen }) => {
 *     const slices = await history.sliceStack(rect, fromGen, toGen);
 *     sculpture.open(rect, fromGen, toGen, slices);
 *   });
 *   // sculpture.close() should be called in response to `sculpture:close`,
 *   // which this module ALSO emits itself when the user hits the built-in
 *   // "return to living plane" button or Escape — see SculptureApp.tsx.
 *   sculpture.onSliceSelected((gen) => bus.emit('sculpture:sliceSelected', { gen }));
 *
 * Geometry: slice `k` of `slices` is the world rect at generation
 * `fromGen + k`. If the total live-cell count across all slices exceeds
 * `INSTANCE_BUDGET` (200k), slices are thinned by TIME STRIDE (never by
 * shrinking the rect) — see `./budget.ts` — and the reduction is surfaced in
 * an on-screen note, never silently applied. All live cells become instanced
 * boxes on a single InstancedMesh (never one mesh per cell), built in chunks
 * across animation frames so opening a large sculpture never freezes the UI.
 *
 * `open()`/`close()` fully mount/unmount the React root each time, so
 * closing always disposes every geometry, material and GPU buffer this
 * module created — and each `open()` replays the flat-plane -> three-quarter
 * camera intro from scratch, which is exactly the desired feel (discovering
 * the SAME object's depth), not an oversight.
 */
import { createRoot, type Root } from 'react-dom/client';
import type { Generation, Rect } from '@/core/types';
import type { SculptureController } from './SculptureApp';
import { SculptureLoading } from './SculptureLoading';

/**
 * Cached across every `open()` in the session: three.js + @react-three/fiber
 * + drei (the entire weight of the Time Sculpture, see the module doc above)
 * are only fetched the FIRST time a sculpture is opened, via a dynamic
 * `import()` — this is the one line that makes the sculpture its own Vite
 * chunk instead of eagerly loading with the core experience. Every open
 * after the first resolves instantly from this cache.
 */
let sculptureAppModule: Promise<typeof import('./SculptureApp')> | null = null;
function loadSculptureApp(): Promise<typeof import('./SculptureApp')> {
  sculptureAppModule ??= import('./SculptureApp');
  return sculptureAppModule;
}

/** Hard cap; beyond this the sculpture reduces via time stride (see ./budget.ts). */
export const MAX_SLICES = 256;

export interface SculptureProps {
  rect: Rect;
  fromGen: Generation;
  toGen: Generation;
  /** One row-major `rect.w * rect.h` buffer per generation, ascending. */
  slices: Uint8Array[];
  onSliceSelected?: (gen: Generation) => void;
}

export interface TimeSculpture {
  /** Mount and populate. Safe to call again with new data (replaces contents). */
  open(rect: Rect, fromGen: Generation, toGen: Generation, slices: Uint8Array[]): void;
  /** Unmount and free geometry/materials/textures. */
  close(): void;
  /**
   * Move the highlighted cutting plane. `t` in [0, 1] maps linearly across
   * `[fromGen, toGen]` (0 = the oldest generation currently shown, 1 = the
   * present). Slices behind the plane fade to `--ink-600`.
   */
  setSlicePlane(t: number): void;
  /** How many slices behind the plane stay visible. 0 = only the plane. */
  setHistoryDepth(n: number): void;
  /** Nudge the orbit camera. Angles in radians, `dolly` is a scale factor. */
  orbit(deltaAzimuth: number, deltaPolar: number, dolly?: number): void;
  /**
   * Register a click handler; receives the Generation of the picked slice.
   * Note: this module ALSO emits `bus.emit('sculpture:sliceSelected', { gen })`
   * itself on pick (see SculptureApp), so the UI does not have to wire that
   * part up manually — this callback is for anything additional you need.
   * Returns an unsubscribe function.
   */
  onSliceSelected(cb: (gen: Generation) => void): () => void;
  /** Move the slice plane to whichever rendered slot corresponds to `gen`, if any. */
  goto(gen: Generation): void;
  /** Export a PNG of the current view. Rejects if nothing is open. */
  exportPng(annotation?: { rule: string; reductionNote?: string }): Promise<Blob>;
}

export function createSculpture(host: HTMLElement): TimeSculpture {
  let root: Root | null = null;
  let controller: SculptureController | null = null;
  let pending: Array<(c: SculptureController) => void> = [];
  const sliceSelectedCallbacks = new Set<(gen: Generation) => void>();
  // Bumped on every open()/close() so a dynamic import() that resolves after
  // the sculpture was closed (or reopened with newer data) never renders
  // into a stale/unmounted root.
  let openToken = 0;

  function withController(fn: (c: SculptureController) => void): void {
    if (controller) fn(controller);
    else pending.push(fn);
  }

  function handleControllerReady(c: SculptureController | null): void {
    controller = c;
    if (c) {
      const queued = pending;
      pending = [];
      queued.forEach((fn) => fn(c));
    }
  }

  return {
    open(rect, fromGen, toGen, slices) {
      if (root) { root.unmount(); root = null; controller = null; }
      pending = [];
      const myToken = ++openToken;
      root = createRoot(host);
      // Paint the (cheap, three.js-free) loading state immediately — the
      // real chunk (three.js + @react-three/fiber + drei) is fetched lazily
      // below and only ever downloaded once per session.
      root.render(<SculptureLoading />);
      void loadSculptureApp().then(({ SculptureApp }) => {
        if (myToken !== openToken || !root) return; // closed/reopened meanwhile
        root.render(
          <SculptureApp
            rect={rect}
            fromGen={fromGen}
            toGen={toGen}
            slices={slices}
            onSliceSelected={(gen) => sliceSelectedCallbacks.forEach((cb) => cb(gen))}
            onControllerReady={handleControllerReady}
          />,
        );
      });
    },

    close() {
      ++openToken;
      if (root) { root.unmount(); root = null; }
      controller = null;
      pending = [];
    },

    setSlicePlane(t) { withController((c) => c.setSlicePlane(t)); },
    setHistoryDepth(n) { withController((c) => c.setHistoryDepth(n)); },
    orbit(deltaAzimuth, deltaPolar, dolly) { withController((c) => c.orbit(deltaAzimuth, deltaPolar, dolly)); },
    goto(gen) { withController((c) => c.goto(gen)); },
    exportPng(annotation) {
      return new Promise((resolve, reject) => {
        withController((c) => c.exportPng(annotation).then(resolve, reject));
      });
    },

    onSliceSelected(cb) {
      sliceSelectedCallbacks.add(cb);
      return () => sliceSelectedCallbacks.delete(cb);
    },
  };
}
