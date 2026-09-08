/**
 * Export budget policy. Pure, headlessly-testable — no DOM. Mirrors
 * `@/sculpture/budget.ts`'s shape: never silently truncate the user's
 * request, always report an honest, specific reduction note when a request
 * exceeds what this build supports.
 */
import type { FramePlan } from './pacing';

/** Hard cap on frames in a single WebM/turntable export. At 30fps that's 2 minutes. */
export const MAX_VIDEO_FRAMES = 3600;
/** Hard cap on frames in a GIF — GIFs get large fast; keep exports shareable. */
export const MAX_GIF_FRAMES = 400;
/** Hard cap on frames in a zipped PNG sequence. */
export const MAX_PNG_SEQUENCE_FRAMES = 900;
/** Hard cap on either output dimension, in device pixels. */
export const MAX_DIMENSION = 2560;
/** Hard cap on GIF dimension — quantised+LZW frames get expensive fast. */
export const MAX_GIF_DIMENSION = 960;
/** Hard cap on rendered audio duration (seconds) for a deterministic offline render. */
export const MAX_AUDIO_SECONDS = 300;

export interface LimitResult<T> {
  value: T;
  reduced: boolean;
  note?: string;
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] ?? s[v] ?? s[0]!;
}

/**
 * Stride-sample a frame plan down to at most `maxFrames`, anchored on both
 * ends (first and last frame are always kept, exactly like the sculpture's
 * present-anchored stride policy) — never a silent truncation of the tail.
 */
export function capFramePlan(plan: FramePlan, maxFrames: number): LimitResult<FramePlan> {
  if (plan.frameCount <= maxFrames) return { value: plan, reduced: false };

  const stride = Math.ceil(plan.frameCount / maxFrames);
  const kept: number[] = [];
  for (let i = 0; i < plan.frameGens.length; i += stride) kept.push(plan.frameGens[i]!);
  const last = plan.frameGens[plan.frameGens.length - 1]!;
  if (kept[kept.length - 1] !== last) kept.push(last);

  const value: FramePlan = {
    frameGens: kept,
    frameCount: kept.length,
    durationSeconds: plan.durationSeconds,
    gensPerFrame: plan.gensPerFrame * stride,
  };
  return {
    value,
    reduced: true,
    note: `Requested ${plan.frameCount} frames exceeds the ${maxFrames}-frame cap for this format — `
      + `showing every ${stride}${ordinal(stride)} frame instead (${kept.length} frames kept).`,
  };
}

/** Scale `width`/`height` down proportionally to fit within `maxDimension` on each side. */
export function capDimensions(width: number, height: number, maxDimension: number): LimitResult<{ width: number; height: number }> {
  const longest = Math.max(width, height);
  if (longest <= maxDimension) return { value: { width, height }, reduced: false };
  const scale = maxDimension / longest;
  const value = { width: Math.max(2, Math.round(width * scale)), height: Math.max(2, Math.round(height * scale)) };
  return {
    value,
    reduced: true,
    note: `Requested ${width}x${height} exceeds this format's ${maxDimension}px cap — scaled down to ${value.width}x${value.height}.`,
  };
}

export function capAudioDuration(durationSeconds: number, maxSeconds = MAX_AUDIO_SECONDS): LimitResult<number> {
  if (durationSeconds <= maxSeconds) return { value: durationSeconds, reduced: false };
  return {
    value: maxSeconds,
    reduced: true,
    note: `Requested ${durationSeconds.toFixed(1)}s of audio exceeds the ${maxSeconds}s offline-render cap — truncated to ${maxSeconds}s.`,
  };
}
