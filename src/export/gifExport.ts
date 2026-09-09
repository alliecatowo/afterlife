/**
 * `FrameSource` -> animated GIF. Fully offline and deterministic, using the
 * same replay/frame-source pipeline the WebM/PNG-sequence exports already
 * use (see `@/export/index.ts`). Hand-written median-cut quantiser
 * (`gif/quantize.ts`) + GIF-flavoured LZW encoder + GIF89a container writer
 * (`gif/gifWriter.ts`) — this project ships zero new dependencies.
 *
 * Palette strategy: each frame gets its OWN local colour table, quantised
 * fresh from that frame's own pixels (up to 256 colours via median-cut).
 * This was a deliberate choice over one shared global palette across the
 * whole clip: `WorldFrameSource`'s replay cursor is forward-only (see
 * `replay.ts`), so there is no cheap way to sample every frame's colours
 * BEFORE encoding the first one without either buffering every frame's full
 * pixel buffer in memory at once (expensive: up to `MAX_GIF_FRAMES` x
 * `MAX_GIF_DIMENSION`² x 4 bytes) or replaying the whole history twice. A
 * fresh per-frame palette also means every frame — including a genuinely
 * colourful one from the `lineage` lens or an Art mode — gets the most
 * accurate 256-colour palette FOR ITS OWN CONTENT, never a compromise
 * averaged across frames with different colour needs. The per-frame colour
 * table overhead (<=768 bytes) is negligible next to pixel data.
 */
import { encodeGifBlob, type GifFrame } from './gif/gifWriter';
import { mapToPalette, medianCutQuantize, type RgbColor } from './gif/quantize';
import type { FrameSource, ProgressCallback } from './types';
import { yieldToEventLoop } from './types';

export interface GifExportOptions {
  fps: number;
  /** 0 = loop forever. */
  loopCount?: number;
  onProgress?: ProgressCallback;
  signal?: AbortSignal;
}

/** GIF's native delay unit is 1/100s; most decoders treat a delay under 2
 *  (20ms) as "as fast as this decoder allows" rather than honouring it
 *  literally — clamp to a value every real decoder treats consistently. */
function delayCentisecondsForFps(fps: number): number {
  return Math.max(2, Math.round(100 / fps));
}

export async function encodeGifExport(source: FrameSource, opts: GifExportOptions): Promise<Blob> {
  const delayCentiseconds = delayCentisecondsForFps(opts.fps);
  const frames: GifFrame[] = [];

  try {
    for (let i = 0; i < source.frameCount; i++) {
      if (opts.signal?.aborted) throw new DOMException('export cancelled', 'AbortError');
      const canvas = await source.frame(i);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('gifExport: could not get a 2D context on the frame canvas');
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const palette: RgbColor[] = medianCutQuantize(imageData.data, 256);
      const indices = mapToPalette(imageData.data, palette, new Map());
      frames.push({ indices, palette, delayCentiseconds });
      opts.onProgress?.({ done: i + 1, total: source.frameCount });
      if (i % 4 === 3) await yieldToEventLoop();
    }
  } finally {
    source.dispose();
  }

  return encodeGifBlob({
    width: source.width,
    height: source.height,
    frames,
    loopCount: opts.loopCount ?? 0,
  });
}
