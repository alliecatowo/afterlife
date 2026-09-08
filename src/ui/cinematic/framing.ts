/**
 * Pure camera-framing math for cinematic mode — kept separate from
 * `director.ts` so the "how zoomed in" decision is unit-testable without a
 * live camera/engine. See DESIGN's brief: close-ups read individual cells
 * (roughly 10-26 px/cell); the occasional wide shot is an establishing pull-
 * back, well below that floor, for contrast.
 */
import { clampScale, MIN_SCALE, type Viewport } from '@/render/camera';

/** Close-up scale never goes tighter/wider than this, regardless of subject size. */
export const CLOSEUP_MIN_SCALE = 10;
export const CLOSEUP_MAX_SCALE = 26;

/**
 * Pick a close-up scale that frames a subject spanning `spanCells` (its
 * bounding box's longer side) with generous breathing room, clamped to the
 * cinematic close-up band. A small traveller (a glider, span ~3) gets
 * pushed toward the tight end; a sprawling cluster (span ~40+) toward the
 * wide end of the band — never outside it.
 */
export function chooseCloseScale(spanCells: number, viewport: Viewport): number {
  const span = Math.max(1, spanCells);
  // 5x the subject's span gives room to see it move/react, not just sit
  // centred and cropped.
  const raw = viewport.width / (span * 5);
  return Math.min(CLOSEUP_MAX_SCALE, Math.max(CLOSEUP_MIN_SCALE, raw));
}

/**
 * Scale that fits (most of) the whole world into the viewport, for the
 * establishing wide shot. Below the close-up band by construction on any
 * world/viewport this app ships (verified by the unit test) — that contrast
 * is the entire point of the wide shot.
 */
export function chooseWideScale(world: { width: number; height: number }, viewport: Viewport, paddingFactor = 1.08): number {
  const scale = Math.min(
    viewport.width / (world.width * paddingFactor),
    viewport.height / (world.height * paddingFactor),
  );
  return clampScale(Math.max(MIN_SCALE, scale));
}
