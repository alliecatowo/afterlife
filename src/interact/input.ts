/**
 * Pointer/keyboard interaction on the world canvas. STUB, owned by the
 * `render` agent (`src/interact/**`).
 *
 * Emits intent onto the bus (`edit:committed`, `selection:changed`,
 * `camera:changed`); it never mutates app state directly and never calls
 * `setState` during a drag — accumulate into a pending `EditOp` and commit at
 * the generation boundary (see ARCHITECTURE.md § Atomic edit commit).
 */
import type { Disposable, EditOp } from '@/core/types';
import type { WorldRenderer } from '@/render/renderer';
import type { CameraController } from '@/render/camera';

export interface InputController extends Disposable {
  attach(canvas: HTMLCanvasElement): void;
  /** Pending, uncommitted edits from the current drag. */
  readonly pending: EditOp | null;
  /** Flush pending edits; the caller records them into the TimelineStore. */
  commit(): EditOp | null;
}

export interface InputOptions {
  renderer: WorldRenderer;
  camera: CameraController;
}

export function createInput(_options: InputOptions): InputController {
  throw new Error('not implemented');
}
