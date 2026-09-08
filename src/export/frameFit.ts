/**
 * Pure camera-framing math for export: fit a world rect into an output
 * viewport, centred, letterboxed to the tighter axis. No `CameraController`
 * needed — export renders a static or slowly-orbiting shot, never pans/zooms
 * interactively, so a plain `{ x, y, scale }` is enough to drive
 * `WorldRenderer.setCamera()` directly.
 */
import { MIN_SCALE, MAX_SCALE, type Camera } from '@/render/camera';
import type { Rect } from '@/core/types';

export function fitCameraToRect(rect: Rect, viewportWidth: number, viewportHeight: number): Camera {
  const rawScale = Math.min(viewportWidth / Math.max(1, rect.w), viewportHeight / Math.max(1, rect.h));
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, rawScale));
  return {
    x: rect.x + rect.w / 2,
    y: rect.y + rect.h / 2,
    scale,
  };
}
