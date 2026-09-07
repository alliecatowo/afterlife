/**
 * App orchestration — wires the now-implemented core/render/interact modules
 * together into one running universe. Per `sculpture.tsx`'s own doc comment
 * ("Mounted into #sculpture-canvas by whoever owns app orchestration (the ui
 * agent)") and `history.ts`'s INTEGRATION-NOTES entry ("whoever wires up
 * SimLoop should call history.advance()"), this composition root belongs to
 * `ui` — the other modules only expose factories and interfaces, not a
 * running app. `App.tsx` calls `initSession()` once, after the canvases in
 * the DOM exist.
 *
 * Two independent loops, on purpose:
 *  - a persistent `requestAnimationFrame` loop that reads camera/engine state
 *    and paints every frame, REGARDLESS of play state (panning, ghost
 *    preview and selection must stay live while paused);
 *  - the core `SimLoop`, which only advances generations while `playing`.
 *
 * Every bus emission this module performs mirrors a payload another agent's
 * code already reads (`gen:changed`, `edit:committed`, `toast`, …). Nothing
 * here calls React/Zustand `setState` from inside the per-frame or
 * per-generation paths — only from response to a discrete user action
 * (branch switch, scrub release), same discipline as everywhere else.
 */
import { bus } from '@/ui/bus';
import { readState, useAppStore } from '@/ui/store';
import { createEngine, type LifeEngine } from '@/core/engine';
import { createTimelineStore, HistoryWindowError, type TimelineStore } from '@/core/history';
import { createSimLoop, type SimLoop } from '@/core/loop';
import { createRenderer, type WorldRenderer } from '@/render/renderer';
import { createCamera, type CameraController } from '@/render/camera';
import { createInput, type InputController } from '@/interact/input';
import { createSculpture, type TimeSculpture } from '@/sculpture/sculpture';
import type { EditOp, WorldSpec } from '@/core/types';

/** The one universe AFTERLIFE observes. 512×512 matches the budget ARCHITECTURE.md
 *  sizes HISTORY_WINDOW against (262kB/keyframe × 64 keyframes ≈ 16MB). */
export const WORLD_SPEC: WorldSpec = { width: 512, height: 512, boundary: 'torus' };

export interface Session {
  engine: LifeEngine;
  history: TimelineStore;
  camera: CameraController;
  renderer: WorldRenderer;
  input: InputController;
  loop: SimLoop;
  sculpture: TimeSculpture;
  /** Ask the sculpture to open on the current selection (or the whole world). */
  openSculpture(): void;
  closeSculpture(): void;
}

let session: Session | null = null;

/** Non-reactive accessor for anything that needs the live session (panels, etc.). */
export function getSession(): Session | null {
  return session;
}

function isTypingTarget(el: EventTarget | null): boolean {
  return el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

/** Idempotent: a second call is a no-op (React 18/19 StrictMode double-invokes effects). */
export function initSession(): Session {
  if (session) return session;

  const worldCanvas = document.getElementById('world-canvas') as HTMLCanvasElement;
  const sculptureHost = document.getElementById('sculpture-canvas') as HTMLElement;

  const engine = createEngine({ width: WORLD_SPEC.width, height: WORLD_SPEC.height });
  const history = createTimelineStore({ engine });
  const camera = createCamera({ scale: 8 });
  const renderer = createRenderer();
  renderer.attach(worldCanvas);
  renderer.setShowGrid(readState().showGrid);
  renderer.setLens(readState().lens);
  const input = createInput({ renderer, camera, engine });
  input.attach(worldCanvas);
  const sculptureController = createSculpture(sculptureHost);

  // ---- rendering: always live, independent of play state -----------------
  let lastFrameTime = 0;
  function frame(now: number): void {
    const dt = lastFrameTime ? Math.min(0.1, (now - lastFrameTime) / 1000) : 0;
    lastFrameTime = now;
    camera.tick(dt);
    renderer.setCamera(camera.camera);
    renderer.draw(engine);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // ---- simulation stepping: edits commit atomically at the boundary ------
  let queuedEdits: EditOp[] = [];

  function flushEdits(atGen: number): void {
    if (queuedEdits.length === 0) return;
    const cellCount = queuedEdits.reduce((n, op) => n + op.cells.length, 0);
    history.record(atGen, queuedEdits);
    bus.emit('edit:committed', { gen: atGen, cellCount });
    queuedEdits = [];
  }

  input.onGestureEnd(() => {
    const op = input.commit();
    if (!op) return;
    if (readState().playing) {
      queuedEdits.push(op);
    } else {
      flushEdits(engine.gen);
    }
  });

  function step(): void {
    flushEdits(engine.gen);
    engine.step();
    history.advance(engine.gen);
    bus.emit('gen:changed', { gen: engine.gen, population: engine.population });
  }

  const loop = createSimLoop(step);
  loop.setSpeed(readState().speed);

  // ---- playback intents ----------------------------------------------------
  bus.on('playback:play', () => loop.start());
  bus.on('playback:pause', () => loop.stop());
  bus.on('playback:speed', ({ speed }) => loop.setSpeed(speed));
  bus.on('playback:step', ({ by }) => {
    if (readState().playing) return;
    if (by >= 0) {
      loop.stepOnce(Math.max(1, by));
    } else {
      const target = Math.max(history.windowStart, engine.gen + by);
      history.goto(target).catch(() => {});
    }
  });

  // ---- timeline scrubbing: goto() is self-cancelling, so rapid-fire is fine --
  bus.on('playback:scrub', ({ gen }) => {
    history.goto(gen).catch((err: unknown) => {
      if (err instanceof HistoryWindowError) {
        bus.emit('toast', { message: 'That generation has fallen out of the retained window.', tone: 'warn' });
      }
      // AbortError = superseded by a newer scrub; not an error worth surfacing.
    });
  });

  // ---- branching -----------------------------------------------------------
  function syncBranches(): void {
    useAppStore.getState().setBranches([...history.branches]);
  }
  bus.on('branch:switched', ({ id }) => {
    history.switchBranch(id).then(() => {
      useAppStore.getState().setActiveBranch(id);
      syncBranches();
    }).catch(() => {
      bus.emit('toast', { message: `Could not switch to that branch.`, tone: 'warn' });
    });
  });
  bus.on('branch:renamed', ({ id, name }) => {
    try {
      history.renameBranch(id, name);
      syncBranches();
    } catch {
      bus.emit('toast', { message: 'Could not rename that branch.', tone: 'warn' });
    }
  });

  // ---- undo: input.ts intentionally leaves 'z' to whoever owns history -----
  window.addEventListener('keydown', (e) => {
    if (isTypingTarget(e.target) || e.key.toLowerCase() !== 'z') return;
    const inverse = input.undo();
    if (!inverse) return;
    history.record(engine.gen, [inverse]);
    bus.emit('edit:committed', { gen: engine.gen, cellCount: inverse.cells.length });
  });

  // ---- audio + presentation + lens: mirror intents onto the live modules ---
  bus.on('lens:changed', ({ lens }) => renderer.setLens(lens));

  // ---- time sculpture --------------------------------------------------------
  const MAX_SCULPTURE_SLICES = 256;

  function showSculptureCanvas(show: boolean): void {
    worldCanvas.classList.toggle('hidden', show);
    sculptureHost.classList.toggle('hidden', !show);
    sculptureHost.setAttribute('aria-hidden', show ? 'false' : 'true');
    useAppStore.getState().setSculptureOpen(show);
  }

  bus.on('sculpture:open', ({ rect, fromGen, toGen }) => {
    const from = Math.max(history.windowStart, toGen - MAX_SCULPTURE_SLICES + 1, fromGen);
    history.sliceStack(rect, from, toGen).then((slices) => {
      sculptureController.open(rect, from, toGen, slices);
      showSculptureCanvas(true);
    }).catch((err: unknown) => {
      if (err instanceof HistoryWindowError) {
        bus.emit('toast', { message: 'That range has fallen out of the retained window.', tone: 'warn' });
      } else {
        bus.emit('toast', { message: 'Could not build the time sculpture for that region.', tone: 'warn' });
      }
    });
  });
  bus.on('sculpture:close', () => {
    sculptureController.close();
    showSculptureCanvas(false);
  });
  bus.on('sculpture:sliceSelected', ({ gen }) => {
    history.goto(gen).catch(() => {});
  });

  session = {
    engine, history, camera, renderer, input, loop, sculpture: sculptureController,
    openSculpture() {
      const sel = readState().selection;
      const rect = sel ?? { x: 0, y: 0, w: Math.min(64, WORLD_SPEC.width), h: Math.min(64, WORLD_SPEC.height) };
      const toGen = engine.gen;
      const fromGen = Math.max(history.windowStart, toGen - MAX_SCULPTURE_SLICES + 1);
      bus.emit('sculpture:open', { rect, fromGen, toGen });
    },
    closeSculpture() {
      bus.emit('sculpture:close', undefined);
    },
  };
  return session;
}
