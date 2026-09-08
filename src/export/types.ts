/**
 * Shared types for the export pipeline. A `FrameSource` decouples "how a
 * frame's pixels are produced" (deterministic world replay, or a sculpture
 * turntable orbit) from "how frames become a file" (WebM/GIF/PNG-zip
 * encoders in this directory) — every encoder is written once, against this
 * interface, and works for both.
 */

export interface FrameSource {
  readonly frameCount: number;
  readonly width: number;
  readonly height: number;
  /**
   * Render frame `index` (0-based, < `frameCount`) and return the canvas it
   * was drawn to. Implementations are free to reuse ONE backing canvas
   * across calls — callers must fully consume (draw/encode/copy) a frame
   * before requesting the next one.
   */
  frame(index: number): Promise<HTMLCanvasElement>;
  /** Release any canvases/engines/contexts this source allocated. */
  dispose(): void;
}

export interface ExportProgress {
  /** 0-based index of the frame/unit of work just completed. */
  done: number;
  total: number;
}

export type ProgressCallback = (progress: ExportProgress) => void;

/** Cancellable async task returned by every export entry point. `promise`
 *  rejects with a `DOMException` named `'AbortError'` on cancellation. */
export interface ExportHandle<T> {
  promise: Promise<T>;
  cancel(): void;
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export { yieldToEventLoop };
