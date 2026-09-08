/**
 * Impure media plumbing for the modulation field's image/video/webcam
 * sources. Owned by the `render` agent (`src/render/**`). Kept separate from
 * `./field.ts` (pure sampling maths) so that module stays trivially
 * unit-testable; only the two pure helpers at the bottom of this file
 * (`computeLuminanceGrid`, `thresholdToBits`) are tested directly, the same
 * way — plain typed-array in, typed-array out, no DOM.
 *
 * SAFETY CONTRACT for the webcam source: capture only ever starts from an
 * explicit user gesture (a button click in `ArtPanel`, never automatically),
 * and `stop()`/`dispose()` — and a `pagehide` listener registered the
 * instant a stream starts — always call `track.stop()` on every track of the
 * `MediaStream`. A forgotten live camera after the panel closes, the tab is
 * hidden, or the page is torn down is exactly the class of bug this exists
 * to prevent; there is no code path that leaves a stream running without an
 * owner.
 */
import { sampleGridBilinear, type SampledGrid } from './field';

export { sampleGridBilinear };

const SAMPLE_W = 96;
const SAMPLE_H = 96;
/** Cap sampling to ~12fps — plenty smooth for a texture that only nudges
 *  glyph/hue/brightness, and a real cost saving over sampling every rAF. */
const SAMPLE_INTERVAL_MS = 80;

/** Luminance (Rec. 601, normalised 0..1) of an RGBA byte at `i`. */
function luminanceAt(data: Uint8ClampedArray, i: number): number {
  return (0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!) / 255;
}

/** Pure: RGBA pixel buffer -> a row-major luminance grid in [0, 1]. */
export function computeLuminanceGrid(data: Uint8ClampedArray, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  for (let p = 0, i = 0; p < out.length; p++, i += 4) out[p] = luminanceAt(data, i);
  return out;
}

/** Pure: threshold an RGBA pixel buffer into a row-major `1 = alive`
 *  `Uint8Array` the same shape `@/core/types`' `EditOp`/`Snapshot` bits use —
 *  the honest "seed the world from an image" on-ramp. `invert` flips which
 *  side of the threshold counts as alive (bright-on-dark source images vs.
 *  dark-on-bright line art both work without pre-processing). */
export function thresholdToBits(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  threshold: number,
  invert = false,
): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let p = 0, i = 0; p < out.length; p++, i += 4) {
    const lum = luminanceAt(data, i);
    const alive = invert ? lum < threshold : lum >= threshold;
    out[p] = alive ? 1 : 0;
  }
  return out;
}

export type MediaFieldState =
  | { kind: 'idle' }
  | { kind: 'image' }
  | { kind: 'video' }
  | { kind: 'webcam' }
  | { kind: 'error'; message: string };

/**
 * Owns exactly one active media source at a time (image snapshot, playing
 * `<video>` from a file, or a live webcam stream) and exposes its current
 * frame as a sampled luminance grid via `getGrid()`. Never referenced by
 * `renderer.ts` directly — `ArtPanel`/`artStore` own an instance and hand
 * `getGrid()`'s result to `renderer.setModulationGrid()` on a timer.
 */
export class MediaFieldSource {
  #state: MediaFieldState = { kind: 'idle' };
  #grid: SampledGrid | null = null;
  #sampleCanvas: HTMLCanvasElement | null = null;
  #sampleCtx: CanvasRenderingContext2D | null = null;
  #video: HTMLVideoElement | null = null;
  #stream: MediaStream | null = null;
  #rafHandle: number | null = null;
  #lastSampleAt = 0;
  #objectUrl: string | null = null;
  #onPageHide = () => this.stop();

  get state(): MediaFieldState {
    return this.#state;
  }

  getGrid(): SampledGrid | null {
    return this.#grid;
  }

  #ensureSampleCanvas(): CanvasRenderingContext2D {
    if (!this.#sampleCanvas) {
      this.#sampleCanvas = document.createElement('canvas');
      this.#sampleCanvas.width = SAMPLE_W;
      this.#sampleCanvas.height = SAMPLE_H;
      this.#sampleCtx = this.#sampleCanvas.getContext('2d', { willReadFrequently: true });
    }
    return this.#sampleCtx!;
  }

  /** Draw whatever's currently in `source` into the small sample canvas and
   *  recompute the luminance grid — shared by the image/video/webcam paths. */
  #resample(source: CanvasImageSource): void {
    const ctx = this.#ensureSampleCanvas();
    ctx.drawImage(source, 0, 0, SAMPLE_W, SAMPLE_H);
    const { data } = ctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H);
    this.#grid = { data: computeLuminanceGrid(data, SAMPLE_W, SAMPLE_H), w: SAMPLE_W, h: SAMPLE_H };
  }

  /** Load a still image (from a `File` via drag-drop/file input, or an
   *  already-decoded `HTMLImageElement`) and sample it once — images don't
   *  need a running rAF loop since nothing about them changes over time. */
  async loadImage(source: File | HTMLImageElement): Promise<void> {
    this.stop();
    try {
      let img: HTMLImageElement;
      if (source instanceof HTMLImageElement) {
        img = source;
      } else {
        img = await decodeImageFile(source);
        this.#objectUrl = img.src;
      }
      this.#resample(img);
      this.#state = { kind: 'image' };
    } catch (err) {
      this.#state = { kind: 'error', message: (err as Error).message || 'Could not load image' };
    }
  }

  /** Get the raw pixel buffer of the last-loaded image at a given size, for
   *  the "seed the world" one-shot action — separate from the small
   *  continuous sample grid because seeding wants real resolution, not the
   *  96x96 modulation-field sample. */
  async imagePixelsAt(source: File, w: number, h: number): Promise<{ data: Uint8ClampedArray; w: number; h: number }> {
    const img = await decodeImageFile(source);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0, w, h);
    return { data: ctx.getImageData(0, 0, w, h).data, w, h };
  }

  async loadVideoFile(file: File): Promise<void> {
    this.stop();
    try {
      const url = URL.createObjectURL(file);
      this.#objectUrl = url;
      const video = document.createElement('video');
      video.src = url;
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      await video.play().catch(() => undefined);
      this.#video = video;
      this.#state = { kind: 'video' };
      window.addEventListener('pagehide', this.#onPageHide);
      this.#startSampleLoop();
    } catch (err) {
      this.#state = { kind: 'error', message: (err as Error).message || 'Could not load video' };
    }
  }

  /** Start the webcam. MUST only be called from a real user gesture (a
   *  click handler) — `getUserMedia` requires it, and this codebase's own
   *  rule (see module doc) is that capture never starts itself. */
  async startWebcam(): Promise<void> {
    this.stop();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240 }, audio: false });
      this.#stream = stream;
      const video = document.createElement('video');
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      await video.play().catch(() => undefined);
      this.#video = video;
      this.#state = { kind: 'webcam' };
      window.addEventListener('pagehide', this.#onPageHide);
      this.#startSampleLoop();
    } catch (err) {
      this.#state = { kind: 'error', message: (err as Error).message || 'Camera access was denied or unavailable' };
    }
  }

  #startSampleLoop(): void {
    const tick = (t: number) => {
      if (t - this.#lastSampleAt >= SAMPLE_INTERVAL_MS && this.#video && this.#video.readyState >= 2) {
        this.#lastSampleAt = t;
        this.#resample(this.#video);
      }
      this.#rafHandle = requestAnimationFrame(tick);
    };
    this.#rafHandle = requestAnimationFrame(tick);
  }

  /** Full, unconditional teardown: cancels the sample loop, stops every
   *  track of any live `MediaStream` (the actual camera-off signal to the
   *  OS/browser chrome), releases the video element and any object URL, and
   *  removes the `pagehide` listener. Safe to call repeatedly / when idle. */
  stop(): void {
    if (this.#rafHandle !== null) { cancelAnimationFrame(this.#rafHandle); this.#rafHandle = null; }
    if (this.#stream) { for (const track of this.#stream.getTracks()) track.stop(); this.#stream = null; }
    if (this.#video) {
      this.#video.pause();
      this.#video.srcObject = null;
      this.#video.removeAttribute('src');
      this.#video.load();
      this.#video = null;
    }
    if (this.#objectUrl) { URL.revokeObjectURL(this.#objectUrl); this.#objectUrl = null; }
    window.removeEventListener('pagehide', this.#onPageHide);
    this.#state = { kind: 'idle' };
    this.#grid = null;
  }

  dispose(): void {
    this.stop();
    this.#sampleCanvas = null;
    this.#sampleCtx = null;
  }
}

function decodeImageFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode image file'));
    img.src = url;
  });
}
