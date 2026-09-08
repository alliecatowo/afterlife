/**
 * `FrameSource` -> a zipped sequence of numbered PNGs — the escape hatch for
 * anyone who wants to bring a clip into real editing software. Fully offline
 * and deterministic: each PNG is `canvas.toBlob('image/png')` of an exact
 * replayed generation, zipped with `@/export/zip.ts` (stored, no second
 * compression pass — PNG is already compressed).
 */
import { buildZipBlob, type ZipEntry } from './zip';
import type { FrameSource, ProgressCallback } from './types';
import { yieldToEventLoop } from './types';

export interface PngZipExportOptions {
  onProgress?: ProgressCallback;
  signal?: AbortSignal;
  /** Base name for each numbered entry, e.g. `"frame"` -> `frame-0001.png`. */
  baseName?: string;
}

function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) { reject(new Error('pngZipExport: toBlob returned null')); return; }
      blob.arrayBuffer().then((buf) => resolve(new Uint8Array(buf)), reject);
    }, 'image/png');
  });
}

export async function encodePngZip(source: FrameSource, opts: PngZipExportOptions = {}): Promise<Blob> {
  const baseName = opts.baseName ?? 'frame';
  const pad = String(source.frameCount).length;
  const entries: ZipEntry[] = [];

  try {
    for (let i = 0; i < source.frameCount; i++) {
      if (opts.signal?.aborted) throw new DOMException('export cancelled', 'AbortError');
      const canvas = await source.frame(i);
      const data = await canvasToPngBytes(canvas);
      entries.push({ name: `${baseName}-${String(i + 1).padStart(pad, '0')}.png`, data });
      opts.onProgress?.({ done: i + 1, total: source.frameCount });
      if (i % 4 === 3) await yieldToEventLoop();
    }
  } finally {
    source.dispose();
  }

  return buildZipBlob(entries);
}
