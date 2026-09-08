/**
 * Burned-in caption strip, drawn consistently across every export format
 * (WebM frames, GIF frames, PNG sequence, sculpture turntable) — same idea
 * as `@/sculpture/export.ts`'s still-PNG caption, generalised to a reusable
 * per-frame overlay instead of a one-shot bottom strip.
 */
import { buildAnnotationText, type AnnotationInfo } from './filename';

/** Draw the annotation text into the bottom-left corner of `ctx`, sized
 *  relative to `canvasWidth` so it stays legible at both 480p and 1080p. */
export function drawAnnotation(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  info: AnnotationInfo,
): void {
  const text = buildAnnotationText(info);
  const fontPx = Math.max(11, Math.round(canvasWidth / 110));
  const pad = Math.round(fontPx * 0.8);

  ctx.save();
  ctx.font = `${fontPx}px "JetBrains Mono Variable", ui-monospace, monospace`;
  ctx.textBaseline = 'bottom';
  const metrics = ctx.measureText(text);
  const stripHeight = fontPx + pad * 2;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.fillRect(0, canvasHeight - stripHeight, Math.min(canvasWidth, metrics.width + pad * 2), stripHeight);

  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
  ctx.fillText(text, pad, canvasHeight - pad);
  ctx.restore();
}

export type { AnnotationInfo };
