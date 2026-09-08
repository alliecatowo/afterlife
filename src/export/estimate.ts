/**
 * Rough, honestly-labelled output-size/duration estimates shown to the user
 * BEFORE an export starts. Pure heuristics, not measured from a real encode
 * — see each function's doc for the model. AFTERLIFE's worlds are flat,
 * few-coloured, mostly-still images (a torus of on/off cells), which
 * compresses far better than photographic video/GIF content; the constants
 * below lean into that rather than reusing generic codec assumptions.
 */

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ['KB', 'MB', 'GB'];
  let n = bytes / 1024;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n < 10 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}

/** Bits per pixel per frame for a mid-quality VP8/VP9 encode of flat,
 *  low-motion cellular-automaton content — well below generic photographic
 *  presets (~0.1-0.2 bpp) since most of the frame is a static torus. */
const WEBM_BITS_PER_PIXEL_PER_FRAME = 0.035;

export function estimateWebmBytes(width: number, height: number, fps: number, durationSeconds: number): number {
  const bitsPerSecond = width * height * fps * WEBM_BITS_PER_PIXEL_PER_FRAME;
  return Math.round((bitsPerSecond / 8) * durationSeconds);
}

/** PNG (via canvas `toBlob`) of a flat two/few-colour cellular pattern
 *  compresses very well with plain deflate. */
export function estimatePngZipBytes(width: number, height: number, frameCount: number): number {
  const bytesPerFramePng = width * height * 0.12;
  const zipOverheadPerEntry = 96; // local + central-directory header, no compression on the zip layer itself
  return Math.round((bytesPerFramePng + zipOverheadPerEntry) * frameCount) + 128;
}
