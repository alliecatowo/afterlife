/** Export a clean PNG of the sculpture canvas, optionally annotated. */
import { resolveCssColorString } from './tokens';

export interface ExportAnnotation {
  rule: string;
  fromGen: number;
  toGen: number;
  reductionNote?: string;
}

/**
 * Composite the WebGL canvas onto an offscreen canvas with an optional
 * caption strip, then resolve a PNG `Blob`. The caller's `<Canvas>` must be
 * created with `gl={{ preserveDrawingBuffer: true }}` — otherwise the buffer
 * is cleared before this can read it back.
 */
export async function exportSculpturePng(source: HTMLCanvasElement, annotation?: ExportAnnotation): Promise<Blob> {
  const captionHeight = annotation ? 48 : 0;
  const out = document.createElement('canvas');
  out.width = source.width;
  out.height = source.height + captionHeight;
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable for sculpture export');

  const ink900 = resolveCssColorString('--color-ink-900', '#111');
  ctx.fillStyle = ink900;
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(source, 0, 0);

  if (annotation) {
    const ivory200 = resolveCssColorString('--color-ivory-200', '#eee');
    const ivory300 = resolveCssColorString('--color-ivory-300', '#aaa');
    ctx.fillStyle = ivory200;
    ctx.font = '13px "Inter Variable", Inter, sans-serif';
    ctx.textBaseline = 'middle';
    const line1 = `${annotation.rule} — gen ${annotation.fromGen}–${annotation.toGen}`;
    ctx.fillText(line1, 16, source.height + captionHeight / 2 - (annotation.reductionNote ? 10 : 0));
    if (annotation.reductionNote) {
      ctx.fillStyle = ivory300;
      ctx.font = '11px "Inter Variable", Inter, sans-serif';
      ctx.fillText(annotation.reductionNote, 16, source.height + captionHeight / 2 + 12);
    }
  }

  return await new Promise<Blob>((resolve, reject) => {
    out.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('toBlob returned null'));
    }, 'image/png');
  });
}
