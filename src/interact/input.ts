/**
 * Pointer/keyboard interaction on the world canvas. Owned by the `render`
 * agent (`src/interact/**`).
 *
 * Emits intent onto the bus (`selection:changed`, `lens:changed`,
 * `playback:*`, `camera:changed` via the camera controller) and onto
 * `useAppStore` for low-frequency app state (tool-driven selection, lens,
 * grid, speed) per ARCHITECTURE.md's sanctioned bridges. It never mutates
 * the engine directly and never calls `setState` during a drag — cells are
 * accumulated into a pending `EditOp` and only exposed via `pending`/
 * `commit()`. See ARCHITECTURE.md § Atomic edit commit for why: the CALLER
 * (whoever owns the `TimelineStore` and the sim loop) is responsible for
 * calling `commit()` and handing the result to `history.record()` — either
 * immediately (paused) or at the next generation boundary (playing) — then
 * emitting `edit:committed`. This module intentionally does not import
 * `@/core/history` to avoid taking on that orchestration itself.
 */
import {
  IDENTITY_TRANSFORM,
  type CellCoord,
  type Disposable,
  type EditOp,
  type Rect,
  type StampPattern,
  type StampTransform,
} from '@/core/types';
import { rectFromCorners, transformPattern, type LifeEngine } from '@/core/engine';
import { bus } from '@/ui/bus';
import { readState, useAppStore } from '@/ui/store';
import type { WorldRenderer } from '@/render/renderer';
import type { CameraController } from '@/render/camera';

export interface InputController extends Disposable {
  attach(canvas: HTMLCanvasElement): void;
  /** Pending, uncommitted edits from the current (or most recent unflushed) gesture. */
  readonly pending: EditOp | null;
  /** Flush pending edits; the caller records them into the TimelineStore. */
  commit(): EditOp | null;
  /** Fires right after a draw/erase/stamp gesture finalizes its pending edit.
   *  The caller decides when to actually commit (immediately if paused, or
   *  buffered to the next generation boundary if playing). */
  onGestureEnd(cb: () => void): Disposable;

  /** Arm the stamp tool with a pattern (or null to disarm). Drives the ghost preview. */
  setStampPattern(pattern: StampPattern | null): void;
  setStampTransform(transform: StampTransform): void;
  readonly stampTransform: Readonly<StampTransform>;

  /** True if a local undo entry is available (see `InputOptions.engine`). */
  readonly canUndo: boolean;
  /**
   * Pop the most recent local undo entry and return the INVERSE `EditOp` that
   * restores prior cell state. The caller applies it exactly like `commit()`
   * output: `history.record(currentGen, [inverse])`. Returns null if there is
   * nothing to undo, or if no `engine` was supplied (undo needs prior state
   * to invert an absolute `set` edit).
   */
  undo(): EditOp | null;
}

export interface InputOptions {
  renderer: WorldRenderer;
  camera: CameraController;
  /**
   * Optional. When supplied, input captures each touched cell's PRIOR value
   * at the start of a gesture so `undo()` can produce an exact inverse edit.
   * Without it, edits still work fine — only local undo is unavailable.
   */
  engine?: LifeEngine;
}

const SPEED_PRESETS = [1, 4, 12, 30, 60];
const PAN_STEP_PX = 48;
const ZOOM_KEY_FACTOR = 1.2;
const UNDO_STACK_LIMIT = 64;

/**
 * Bresenham's line algorithm over integer cell coordinates. Guarantees a
 * connected 8-neighbour path between two cells — used to interpolate a
 * continuous stroke between two pointer samples so fast drags never leave
 * gaps. Includes both endpoints.
 */
export function bresenhamLine(x0: number, y0: number, x1: number, y1: number): CellCoord[] {
  const pts: CellCoord[] = [];
  let cx = x0;
  let cy = y0;
  const dx = Math.abs(x1 - x0);
  const sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0);
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  // Safety bound: never loop past the Chebyshev distance + 1.
  const maxSteps = Math.max(dx, -dy) + 2;
  for (let i = 0; i < maxSteps; i++) {
    pts.push({ x: cx, y: cy });
    if (cx === x1 && cy === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; cx += sx; }
    if (e2 <= dx) { err += dx; cy += sy; }
  }
  return pts;
}

type DragMode = 'draw' | 'erase' | 'pan' | 'select' | null;

interface PendingCell { x: number; y: number; alive: boolean }

class InputControllerImpl implements InputController {
  #renderer: WorldRenderer;
  #camera: CameraController;
  #engine: LifeEngine | undefined;

  #canvas: HTMLCanvasElement | null = null;
  #teardown: Array<() => void> = [];

  #pendingMap: Map<string, PendingCell> | null = null;
  #gesturePrior: Map<string, boolean> | null = null;
  #gestureEndCbs = new Set<() => void>();
  #undoStack: EditOp[] = [];

  #dragMode: DragMode = null;
  #activePointerId: number | null = null;
  #lastCell: CellCoord | null = null;
  #lastPanScreen: { x: number; y: number } | null = null;
  #selectStart: CellCoord | null = null;
  #lastSelectionRect: Rect | null = null;
  #spaceHeld = false;

  #activeTouches = new Map<number, { x: number; y: number }>();
  #pinchLastDist = 0;
  #pinchLastMid = { x: 0, y: 0 };

  #stampPattern: StampPattern | null = null;
  #stampTransform: StampTransform = { ...IDENTITY_TRANSFORM };

  constructor(opts: InputOptions) {
    this.#renderer = opts.renderer;
    this.#camera = opts.camera;
    this.#engine = opts.engine;
  }

  get pending(): EditOp | null {
    if (!this.#pendingMap || this.#pendingMap.size === 0) return null;
    return { kind: 'set', cells: [...this.#pendingMap.values()] };
  }

  get stampTransform(): Readonly<StampTransform> {
    return this.#stampTransform;
  }

  get canUndo(): boolean {
    return this.#undoStack.length > 0;
  }

  commit(): EditOp | null {
    const op = this.pending;
    this.#pendingMap = null;
    return op;
  }

  onGestureEnd(cb: () => void): Disposable {
    this.#gestureEndCbs.add(cb);
    return { dispose: () => this.#gestureEndCbs.delete(cb) };
  }

  setStampPattern(pattern: StampPattern | null): void {
    this.#stampPattern = pattern;
    if (!pattern) this.#renderer.setGhost(null, 0, 0, IDENTITY_TRANSFORM);
  }

  setStampTransform(transform: StampTransform): void {
    this.#stampTransform = transform;
  }

  undo(): EditOp | null {
    return this.#undoStack.pop() ?? null;
  }

  attach(canvas: HTMLCanvasElement): void {
    this.#canvas = canvas;
    canvas.style.touchAction = 'none';

    const on = <K extends keyof HTMLElementEventMap>(
      type: K,
      handler: (e: HTMLElementEventMap[K]) => void,
      opts?: AddEventListenerOptions,
    ): void => {
      canvas.addEventListener(type, handler as EventListener, opts);
      this.#teardown.push(() => canvas.removeEventListener(type, handler as EventListener, opts));
    };
    const onWin = <K extends keyof WindowEventMap>(
      type: K,
      handler: (e: WindowEventMap[K]) => void,
    ): void => {
      window.addEventListener(type, handler as EventListener);
      this.#teardown.push(() => window.removeEventListener(type, handler as EventListener));
    };

    on('pointerdown', this.#onPointerDown);
    on('pointermove', this.#onPointerMove);
    on('pointerup', this.#onPointerUp);
    on('pointercancel', this.#onPointerUp);
    on('wheel', this.#onWheel, { passive: false });
    on('contextmenu', this.#onContextMenu);
    // Higher-frequency-than-pointermove samples where supported (Chromium).
    if ('onpointerrawupdate' in window) {
      on('pointerrawupdate' as never, this.#onPointerMove as never);
    }
    onWin('keydown', this.#onKeyDown);
    onWin('keyup', this.#onKeyUp);

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => this.#syncViewport());
      ro.observe(canvas);
      this.#teardown.push(() => ro.disconnect());
    }
    this.#syncViewport();
  }

  dispose(): void {
    for (const off of this.#teardown) off();
    this.#teardown = [];
    this.#gestureEndCbs.clear();
  }

  #syncViewport(): void {
    this.#renderer.resize();
    const vp = this.#renderer.viewport;
    this.#camera.setViewport(vp.width, vp.height);
  }

  #canvasPoint(e: PointerEvent): { x: number; y: number } {
    const rect = this.#canvas!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  // ---- cell editing -------------------------------------------------------

  #paintCell(x: number, y: number, alive: boolean): void {
    this.#pendingMap ??= new Map();
    if (this.#engine) {
      this.#gesturePrior ??= new Map();
      const key = `${x},${y}`;
      if (!this.#gesturePrior.has(key)) this.#gesturePrior.set(key, this.#engine.get(x, y));
    }
    this.#pendingMap.set(`${x},${y}`, { x, y, alive });
  }

  #finishGesture(): void {
    const op = this.pending;
    if (op && this.#engine && this.#gesturePrior) {
      const inverse: EditOp = {
        kind: 'set',
        cells: op.cells.map((c) => ({ x: c.x, y: c.y, alive: this.#gesturePrior!.get(`${c.x},${c.y}`) ?? false })),
      };
      this.#undoStack.push(inverse);
      if (this.#undoStack.length > UNDO_STACK_LIMIT) this.#undoStack.shift();
    }
    this.#gesturePrior = null;
    if (op) for (const cb of [...this.#gestureEndCbs]) cb();
  }

  #commitStamp(at: CellCoord): void {
    if (!this.#stampPattern) return;
    const { w, h, cells } = transformPattern(this.#stampPattern, this.#stampTransform);
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        this.#paintCell(at.x + i, at.y + j, cells[j * w + i] === 1);
      }
    }
    this.#finishGesture();
  }

  // ---- pointer --------------------------------------------------------

  #onPointerDown = (e: PointerEvent): void => {
    const canvas = this.#canvas!;
    canvas.setPointerCapture(e.pointerId);
    const { x: sx, y: sy } = this.#canvasPoint(e);

    if (e.pointerType === 'touch') {
      this.#activeTouches.set(e.pointerId, { x: sx, y: sy });
      if (this.#activeTouches.size === 2) {
        this.#stopDrag();
        this.#beginPinch();
        return;
      }
      if (this.#activeTouches.size > 2) return;
    }

    if (this.#activePointerId !== null) return;

    const tool = readState().tool;
    const spacePan = this.#spaceHeld && e.button === 0;
    const middlePan = e.button === 1;
    const touchPan = e.pointerType === 'touch' && tool === 'pan';

    this.#activePointerId = e.pointerId;

    if (middlePan || spacePan || (tool === 'pan' && e.button === 0) || touchPan) {
      this.#dragMode = 'pan';
      this.#lastPanScreen = { x: sx, y: sy };
      return;
    }

    const world = this.#renderer.screenToWorld(sx, sy);
    const cell = { x: Math.floor(world.x), y: Math.floor(world.y) };

    if (tool === 'select') {
      this.#dragMode = 'select';
      this.#selectStart = cell;
      const rect: Rect = { x: cell.x, y: cell.y, w: 1, h: 1 };
      this.#lastSelectionRect = rect;
      this.#renderer.setSelection(rect);
      bus.emit('selection:changed', { rect });
      return;
    }

    if (tool === 'stamp' && this.#stampPattern) {
      this.#commitStamp(cell);
      this.#activePointerId = null;
      return;
    }

    const erase = e.button === 2 || tool === 'erase' || e.altKey;
    this.#dragMode = erase ? 'erase' : 'draw';
    this.#lastCell = cell;
    this.#paintCell(cell.x, cell.y, !erase);
  };

  #onPointerMove = (e: PointerEvent): void => {
    if (!this.#canvas) return;
    const { x: sx, y: sy } = this.#canvasPoint(e);

    if (e.pointerType === 'touch' && this.#activeTouches.has(e.pointerId)) {
      this.#activeTouches.set(e.pointerId, { x: sx, y: sy });
      if (this.#activeTouches.size >= 2) {
        this.#updatePinch();
        return;
      }
    }

    if (readState().tool === 'stamp' && this.#stampPattern) {
      const world = this.#renderer.screenToWorld(sx, sy);
      this.#renderer.setGhost(
        this.#stampPattern,
        Math.floor(world.x),
        Math.floor(world.y),
        this.#stampTransform,
      );
    }

    if (e.pointerId !== this.#activePointerId) return;

    if (this.#dragMode === 'pan') {
      const last = this.#lastPanScreen!;
      this.#camera.panByScreen(sx - last.x, sy - last.y);
      this.#lastPanScreen = { x: sx, y: sy };
      return;
    }

    const world = this.#renderer.screenToWorld(sx, sy);
    const cell = { x: Math.floor(world.x), y: Math.floor(world.y) };

    if (this.#dragMode === 'select' && this.#selectStart) {
      const rect = rectFromCorners(this.#selectStart, cell);
      this.#lastSelectionRect = rect;
      this.#renderer.setSelection(rect);
      bus.emit('selection:changed', { rect });
      return;
    }

    if (this.#dragMode === 'draw' || this.#dragMode === 'erase') {
      const from = this.#lastCell ?? cell;
      const alive = this.#dragMode === 'draw';
      for (const p of bresenhamLine(from.x, from.y, cell.x, cell.y)) {
        this.#paintCell(p.x, p.y, alive);
      }
      this.#lastCell = cell;
    }
  };

  #onPointerUp = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') {
      this.#activeTouches.delete(e.pointerId);
      if (this.#activeTouches.size < 2) this.#endPinch();
    }
    if (e.pointerId !== this.#activePointerId) return;
    this.#stopDrag();
  };

  /** Ends the current gesture's tracking. Never discards `pending` — only `commit()` does that. */
  #stopDrag(): void {
    if (this.#dragMode === 'select') {
      if (this.#lastSelectionRect) useAppStore.getState().setSelection(this.#lastSelectionRect);
    } else if (this.#dragMode === 'draw' || this.#dragMode === 'erase') {
      this.#finishGesture();
    }
    this.#dragMode = null;
    this.#activePointerId = null;
    this.#lastCell = null;
    this.#lastPanScreen = null;
    this.#selectStart = null;
  }

  #onContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
  };

  // ---- pinch (two-finger pan/zoom) ----------------------------------------

  #beginPinch(): void {
    const pts = [...this.#activeTouches.values()];
    if (pts.length < 2) return;
    const [a, b] = pts as [{ x: number; y: number }, { x: number; y: number }];
    this.#pinchLastDist = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    this.#pinchLastMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  #updatePinch(): void {
    const pts = [...this.#activeTouches.values()];
    if (pts.length < 2) return;
    const [a, b] = pts as [{ x: number; y: number }, { x: number; y: number }];
    const dist = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };

    const factor = dist / this.#pinchLastDist;
    if (Number.isFinite(factor) && factor > 0 && Math.abs(factor - 1) > 1e-4) {
      this.#camera.zoomAt(mid, factor);
    }
    this.#camera.panByScreen(mid.x - this.#pinchLastMid.x, mid.y - this.#pinchLastMid.y);

    this.#pinchLastDist = dist;
    this.#pinchLastMid = mid;
  }

  #endPinch(): void {
    if (this.#activeTouches.size < 2) {
      this.#dragMode = null;
      this.#lastPanScreen = null;
    }
  }

  // ---- wheel ---------------------------------------------------------

  #onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const rect = this.#canvas!.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const factor = Math.pow(1.0015, -e.deltaY);
    this.#camera.zoomAt({ x: sx, y: sy }, factor);
  };

  // ---- keyboard --------------------------------------------------------

  #onKeyDown = (e: KeyboardEvent): void => {
    const target = e.target as HTMLElement | null;
    if (target && /^(input|textarea|select)$/i.test(target.tagName)) return;

    switch (e.key) {
      case ' ': {
        e.preventDefault();
        this.#spaceHeld = true;
        if (!e.repeat) {
          const playing = readState().playing;
          if (playing) bus.emit('playback:pause', undefined);
          else bus.emit('playback:play', undefined);
        }
        return;
      }
      case '.':
        bus.emit('playback:step', { by: 1 });
        return;
      case '[':
        this.#adjustSpeed(-1);
        return;
      case ']':
        this.#adjustSpeed(1);
        return;
      case '1':
        this.#setLens('life');
        return;
      case '2':
        this.#setLens('age');
        return;
      case '3':
        this.#setLens('activity');
        return;
      case 'g':
      case 'G': {
        const show = !readState().showGrid;
        useAppStore.getState().setShowGrid(show);
        this.#renderer.setShowGrid(show);
        return;
      }
      case 'r':
      case 'R':
        this.#stampTransform = {
          ...this.#stampTransform,
          rotate: (((this.#stampTransform.rotate + 1) % 4) as 0 | 1 | 2 | 3),
        };
        return;
      case 'f':
      case 'F':
        this.#stampTransform = { ...this.#stampTransform, flipX: !this.#stampTransform.flipX };
        return;
      case 'Escape':
        this.#cancelAll();
        return;
      case 'ArrowLeft':
        this.#camera.panByScreen(-PAN_STEP_PX, 0);
        return;
      case 'ArrowRight':
        this.#camera.panByScreen(PAN_STEP_PX, 0);
        return;
      case 'ArrowUp':
        this.#camera.panByScreen(0, -PAN_STEP_PX);
        return;
      case 'ArrowDown':
        this.#camera.panByScreen(0, PAN_STEP_PX);
        return;
      case '+':
      case '=':
        this.#zoomAtCenter(ZOOM_KEY_FACTOR);
        return;
      case '-':
      case '_':
        this.#zoomAtCenter(1 / ZOOM_KEY_FACTOR);
        return;
      case 'z':
      case 'Z':
        // The bus event, not a direct call: this module doesn't own the
        // TimelineStore (see the InputController.undo() doc comment) — `@/ui/session`
        // listens for `history:undo`, calls `input.undo()` itself, and records
        // the inverse edit.
        bus.emit('history:undo', undefined);
        return;
      default:
        return;
    }
  };

  #onKeyUp = (e: KeyboardEvent): void => {
    if (e.key === ' ') this.#spaceHeld = false;
  };

  #adjustSpeed(dir: number): void {
    const cur = readState().speed;
    let idx = SPEED_PRESETS.indexOf(cur);
    if (idx === -1) {
      idx = SPEED_PRESETS.reduce(
        (best, p, i) => (Math.abs(p - cur) < Math.abs(SPEED_PRESETS[best]! - cur) ? i : best),
        0,
      );
    }
    idx = Math.min(SPEED_PRESETS.length - 1, Math.max(0, idx + dir));
    const speed = SPEED_PRESETS[idx]!;
    useAppStore.getState().setSpeed(speed);
    bus.emit('playback:speed', { speed });
  }

  #setLens(lens: 'life' | 'age' | 'activity'): void {
    useAppStore.getState().setLens(lens);
    this.#renderer.setLens(lens);
    bus.emit('lens:changed', { lens });
  }

  #zoomAtCenter(factor: number): void {
    const vp = this.#camera.viewport;
    this.#camera.zoomAt({ x: vp.width / 2, y: vp.height / 2 }, factor);
  }

  #cancelAll(): void {
    this.#dragMode = null;
    this.#selectStart = null;
    this.#lastSelectionRect = null;
    this.#renderer.setSelection(null);
    useAppStore.getState().setSelection(null);
    bus.emit('selection:changed', { rect: null });
    this.#stampPattern = null;
    this.#renderer.setGhost(null, 0, 0, IDENTITY_TRANSFORM);
  }
}

export function createInput(options: InputOptions): InputController {
  return new InputControllerImpl(options);
}
