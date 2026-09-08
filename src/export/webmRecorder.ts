/**
 * WebM video encoding via `MediaRecorder` + `HTMLCanvasElement.captureStream`
 * — the native, no-dependency path. Frames are already computed deterministically
 * by a `FrameSource` (see `worldFrameSource.ts`/`sculptureFrameSource.ts`);
 * this module's only job is getting them into a `MediaStream` and letting the
 * browser's encoder do its work.
 *
 * Honesty note: `MediaRecorder` timestamps frames by real (wall-clock)
 * arrival, not by a caller-supplied presentation time, so producing a
 * correctly-paced Nfps clip means requesting frames roughly Nfps apart in
 * real time — an inherent platform constraint, not a determinism gap. The
 * PIXEL CONTENT of every frame is still exactly the deterministic replay's
 * output for that frame's generation (no dropped/skipped/duplicated
 * generations the way a live capture could produce under load); only the
 * wall-clock time to *encode* the file scales with the output's duration.
 */
import type { FrameSource, ProgressCallback } from './types';
import { ExportUnsupportedError } from './errors';

export const WEBM_MIME_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=vp8',
  'video/webm',
];

export function pickSupportedMimeType(
  candidates: readonly string[],
  isSupported: (type: string) => boolean,
): string | null {
  for (const candidate of candidates) {
    if (isSupported(candidate)) return candidate;
  }
  return null;
}

interface CanvasCaptureTrack extends MediaStreamTrack {
  requestFrame?(): void;
}

export interface RecordWebmOptions {
  fps: number;
  videoBitsPerSecond?: number;
  onProgress?: ProgressCallback;
  signal?: AbortSignal;
  mimeCandidates?: readonly string[];
  isTypeSupported?: (type: string) => boolean;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('export cancelled', 'AbortError')); return; }
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new DOMException('export cancelled', 'AbortError'));
    }, { once: true });
  });
}

/** Encode a `FrameSource` into a WebM `Blob`. Rejects with
 *  `ExportUnsupportedError` if no candidate codec is supported, or an
 *  `AbortError` `DOMException` if `signal` fires mid-encode. Always disposes
 *  `source` and stops the `MediaRecorder`/tracks it creates, even on error. */
export async function recordWebm(source: FrameSource, opts: RecordWebmOptions): Promise<Blob> {
  const isSupported = opts.isTypeSupported ?? ((t: string) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t));
  const mimeType = pickSupportedMimeType(opts.mimeCandidates ?? WEBM_MIME_CANDIDATES, isSupported);
  if (!mimeType) {
    source.dispose();
    throw new ExportUnsupportedError(
      'This browser has no supported WebM video encoder (MediaRecorder.isTypeSupported rejected every candidate codec) — try a recent Chrome, Edge, or Firefox.',
    );
  }

  let recorder: MediaRecorder | null = null;
  let videoTrack: CanvasCaptureTrack | null = null;
  try {
    const firstCanvas = await source.frame(0);
    const canvasStream = firstCanvas.captureStream(0) as MediaStream;
    videoTrack = canvasStream.getVideoTracks()[0] as CanvasCaptureTrack | undefined ?? null;
    if (!videoTrack) throw new ExportUnsupportedError('This browser could not create a canvas capture stream for video export.');

    const stream = new MediaStream([videoTrack]);

    const chunks: Blob[] = [];
    recorder = new MediaRecorder(stream, {
      mimeType,
      ...(opts.videoBitsPerSecond ? { videoBitsPerSecond: opts.videoBitsPerSecond } : {}),
    });
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

    const stopped = new Promise<void>((resolve, reject) => {
      recorder!.onstop = () => resolve();
      recorder!.onerror = (e) => reject((e as unknown as { error?: Error }).error ?? new Error('MediaRecorder error'));
    });

    recorder.start();

    const frameIntervalMs = 1000 / opts.fps;
    const startTime = performance.now();
    const requestFrame = (): void => { videoTrack!.requestFrame?.(); };

    // Frame 0 is already rendered (used above to create the capture stream).
    requestFrame();
    opts.onProgress?.({ done: 1, total: source.frameCount });

    for (let i = 1; i < source.frameCount; i++) {
      if (opts.signal?.aborted) throw new DOMException('export cancelled', 'AbortError');
      await source.frame(i);
      if (opts.signal?.aborted) throw new DOMException('export cancelled', 'AbortError');
      requestFrame();
      opts.onProgress?.({ done: i + 1, total: source.frameCount });

      const targetElapsed = (i + 1) * frameIntervalMs;
      const actualElapsed = performance.now() - startTime;
      const waitMs = targetElapsed - actualElapsed;
      if (waitMs > 0) await sleep(waitMs, opts.signal);
    }

    recorder.stop();
    await stopped;
    return new Blob(chunks, { type: mimeType });
  } catch (err) {
    if (recorder && recorder.state !== 'inactive') {
      try { recorder.stop(); } catch { /* already stopping */ }
    }
    throw err;
  } finally {
    videoTrack?.stop();
    source.dispose();
  }
}
