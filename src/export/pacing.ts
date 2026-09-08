/**
 * Frame-timing / pacing math for offline deterministic export. Pure — no
 * DOM, no canvas, no timers. Given a generation range and a requested output
 * cadence, decides exactly which generation each output frame renders.
 *
 * "gensPerSecond" is the SIMULATED speed the export plays back at (how many
 * generations advance per second of output), independent of "fps" (how many
 * discrete frames the video/GIF actually contains). A 640-generation range
 * exported at 64 gens/sec plays back as 10 seconds of footage; at 30fps that
 * is 300-ish frames, each covering ~2.13 generations.
 */

export interface PacingInput {
  fromGen: number;
  toGen: number;
  /** Output frames per second. */
  fps: number;
  /** Simulated generations advanced per second of output. */
  gensPerSecond: number;
}

export interface FramePlan {
  /** The generation to render for each output frame, ascending, inclusive of `fromGen` and `toGen`. */
  frameGens: number[];
  frameCount: number;
  durationSeconds: number;
  /** Generations represented by one output frame at this pacing (may be < 1 for slow motion). */
  gensPerFrame: number;
}

/**
 * Compute which generation each output frame should show. Always includes
 * `fromGen` as frame 0 and `toGen` as the last frame. Frame generations are
 * rounded to the nearest integer (the engine only has integer generations)
 * and are always non-decreasing.
 */
export function computeFramePlan(input: PacingInput): FramePlan {
  const { fromGen, toGen, fps, gensPerSecond } = input;
  if (!(fps > 0)) throw new Error(`computeFramePlan: fps must be > 0, got ${fps}`);
  if (!(gensPerSecond > 0)) throw new Error(`computeFramePlan: gensPerSecond must be > 0, got ${gensPerSecond}`);
  if (toGen < fromGen) throw new Error(`computeFramePlan: toGen (${toGen}) must be >= fromGen (${fromGen})`);

  const totalGens = toGen - fromGen;
  const durationSeconds = totalGens / gensPerSecond;
  const gensPerFrame = gensPerSecond / fps;

  if (totalGens === 0) {
    return { frameGens: [fromGen], frameCount: 1, durationSeconds: 0, gensPerFrame };
  }

  const frameCount = Math.max(2, Math.round(durationSeconds * fps) + 1);
  const frameGens: number[] = new Array(frameCount);
  for (let i = 0; i < frameCount; i++) {
    const t = i / (frameCount - 1);
    frameGens[i] = Math.round(fromGen + t * totalGens);
  }
  // Rounding can occasionally produce a local decrease at extreme
  // gens-per-frame ratios; clamp to non-decreasing so callers can rely on
  // the sequence being a valid forward replay order.
  for (let i = 1; i < frameGens.length; i++) {
    if (frameGens[i]! < frameGens[i - 1]!) frameGens[i] = frameGens[i - 1]!;
  }
  frameGens[frameGens.length - 1] = toGen;

  return { frameGens, frameCount, durationSeconds, gensPerFrame };
}
