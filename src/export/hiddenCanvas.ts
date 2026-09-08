/**
 * A canvas element that is genuinely laid out (so `getBoundingClientRect()`
 * reports real, non-zero dimensions — `WorldRenderer.resize()` depends on
 * that) but never visible or interactive. `display:none`/detached-from-DOM
 * canvases both report a zero box, which is why this exists rather than a
 * plain `document.createElement('canvas')`.
 *
 * Sized so the renderer's own `min(devicePixelRatio, 2)` backing-store
 * multiplier lands on the EXACT requested pixel dimensions (within rounding),
 * by pre-dividing the CSS size we hand it by that same factor.
 */
export interface HiddenCanvasHandle {
  canvas: HTMLCanvasElement;
  cssWidth: number;
  cssHeight: number;
  dispose(): void;
}

export function createHiddenCanvas(pixelWidth: number, pixelHeight: number): HiddenCanvasHandle {
  const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
  const cssWidth = Math.max(1, Math.round(pixelWidth / dpr));
  const cssHeight = Math.max(1, Math.round(pixelHeight / dpr));

  const canvas = document.createElement('canvas');
  canvas.style.position = 'fixed';
  canvas.style.top = '0';
  canvas.style.left = '0';
  canvas.style.visibility = 'hidden';
  canvas.style.pointerEvents = 'none';
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  document.body.appendChild(canvas);

  return {
    canvas,
    cssWidth,
    cssHeight,
    dispose() {
      canvas.remove();
    },
  };
}
