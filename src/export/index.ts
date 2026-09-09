/**
 * Public entry points for video/frame export. Each returns an
 * `ExportHandle`: a `promise` that resolves to the finished `Blob` (plus a
 * suggested filename and any honest budget-reduction notes) and a `cancel()`
 * that genuinely stops the in-flight work (the underlying `AbortSignal`
 * threads through the replay cursor, the frame source, and the encoder).
 *
 * Reads the CURRENT live lens/grid/art-mode state (`@/ui/store`,
 * `@/render/artStore`) at the moment the export starts — never a fixed
 * assumption — so the export shows whatever the user is actually looking
 * at, including whichever theme is active (theme colours resolve from
 * global CSS custom properties, picked up automatically by the hidden
 * export canvas with no extra wiring needed here).
 */
import { getSession, WORLD_SPEC } from '@/ui/session';
import { useAppStore } from '@/ui/store';
import { useArtStore } from '@/render/artStore';
import { readAudioSettings } from '@/audio/settingsStore';
import type { Rect } from '@/core/types';
import { computeFramePlan } from './pacing';
import {
  capDimensions, capFramePlan, MAX_DIMENSION, MAX_GIF_DIMENSION, MAX_GIF_FRAMES,
  MAX_PNG_SEQUENCE_FRAMES, MAX_VIDEO_FRAMES,
} from './limits';
import { createWorldFrameSource } from './worldFrameSource';
import { recordWebm } from './webmRecorder';
import { encodePngZip } from './pngZipExport';
import { encodeGifExport } from './gifExport';
import { renderOfflineAudio } from './audio/offlineRender';
import { encodeWav } from './wav';
import { buildAnnotationText, buildExportFilename } from './filename';
import { isAbortError } from './errors';
import type { ExportHandle, ProgressCallback } from './types';

export interface ExportRequest {
  fromGen: number;
  toGen: number;
  /** World region to frame. Defaults to the whole world. */
  rect?: Rect;
  width: number;
  height: number;
  fps: number;
  /** Simulated generations advanced per second of output — see `pacing.ts`. */
  gensPerSecond: number;
  annotate: boolean;
  /** WebM only: mux a deterministic offline audio render (current audio
   *  settings, same generation range) into the clip's audio track. See
   *  `@/export/audio/offlineRender.ts` / `webmRecorder.ts`'s doc for the
   *  determinism-vs-muxing distinction. Ignored by GIF/PNG-sequence export. */
  includeAudio?: boolean;
  onProgress?: ProgressCallback;
}

export interface AudioExportRequest {
  fromGen: number;
  toGen: number;
  /** Simulated generations advanced per second of output — same semantic as
   *  the video pipeline. */
  gensPerSecond: number;
  onProgress?: ProgressCallback;
}

export interface AudioExportResult {
  blob: Blob;
  filename: string;
  reductionNotes: string[];
  durationSeconds: number;
}

export interface ExportResult {
  blob: Blob;
  filename: string;
  /** Honest, human-readable notes about any budget-driven reduction applied
   *  (generation range clamped, frames stride-sampled, resolution scaled
   *  down) — empty when the request was fully honoured as asked. */
  reductionNotes: string[];
}

function currentRenderState(): { lens: ReturnType<typeof useAppStore.getState>['lens']; showGrid: boolean; artConfig: ReturnType<typeof useArtStore.getState>['config'] | null } {
  const app = useAppStore.getState();
  const art = useArtStore.getState().config;
  return { lens: app.lens, showGrid: app.showGrid, artConfig: art.enabled ? art : null };
}

interface PreparedPlan {
  fromGen: number;
  toGen: number;
  width: number;
  height: number;
  frameGens: number[];
  notes: string[];
}

function preparePlan(req: ExportRequest, maxFrames: number, maxDimension: number): PreparedPlan {
  const session = getSession();
  if (!session) throw new Error('export: no active session');
  const notes: string[] = [];

  let fromGen = req.fromGen;
  let toGen = req.toGen;
  const windowStart = session.history.windowStart;
  const maxGen = session.history.maxGen;
  if (fromGen < windowStart || toGen > maxGen) {
    const clampedFrom = Math.max(fromGen, windowStart);
    const clampedTo = Math.min(toGen, maxGen);
    notes.push(
      `Requested generations [${fromGen}, ${toGen}] reach outside the retained history window `
      + `[${windowStart}, ${maxGen}] — clamped to what's actually still available.`,
    );
    fromGen = clampedFrom;
    toGen = clampedTo;
  }

  const dimCap = capDimensions(req.width, req.height, maxDimension);
  if (dimCap.note) notes.push(dimCap.note);

  const plan = computeFramePlan({ fromGen, toGen, fps: req.fps, gensPerSecond: req.gensPerSecond });
  const frameCap = capFramePlan(plan, maxFrames);
  if (frameCap.note) notes.push(frameCap.note);

  return { fromGen, toGen, width: dimCap.value.width, height: dimCap.value.height, frameGens: frameCap.value.frameGens, notes };
}

async function buildWorldSource(req: ExportRequest, plan: PreparedPlan, signal: AbortSignal) {
  const session = getSession();
  if (!session) throw new Error('export: no active session');
  const rect: Rect = req.rect ?? { x: 0, y: 0, w: WORLD_SPEC.width, h: WORLD_SPEC.height };
  const { lens, showGrid, artConfig } = currentRenderState();
  return createWorldFrameSource({
    history: session.history,
    rect,
    width: plan.width,
    height: plan.height,
    frameGens: plan.frameGens,
    lens,
    showGrid,
    artConfig,
    annotate: req.annotate ? { rule: session.engine.rule, fromGen: plan.fromGen, toGen: plan.toGen, seed: 0 } : undefined,
    signal,
  });
}

/** Offline deterministic WebM export: replays recorded history frame-by-
 *  frame (never a realtime screen capture), encodes via `MediaRecorder`.
 *  Optionally mux in a deterministic offline audio render matching the same
 *  generation range and the user's current audio settings (`req.includeAudio`). */
export function exportWorldWebm(req: ExportRequest): ExportHandle<ExportResult> {
  const controller = new AbortController();
  const promise = (async (): Promise<ExportResult> => {
    const plan = preparePlan(req, MAX_VIDEO_FRAMES, MAX_DIMENSION);
    const source = await buildWorldSource(req, plan, controller.signal);
    const notes = [...plan.notes];

    let audioBuffer: AudioBuffer | undefined;
    if (req.includeAudio) {
      const session = getSession();
      if (session) {
        try {
          const audio = await renderOfflineAudio({
            history: session.history,
            fromGen: plan.fromGen,
            toGen: plan.toGen,
            gensPerSecond: req.gensPerSecond,
            settings: readAudioSettings(),
            signal: controller.signal,
          });
          audioBuffer = audio.buffer;
          notes.push(...audio.reductionNotes);
        } catch (err) {
          if (isAbortError(err)) throw err;
          notes.push(`Could not render audio for this clip (${(err as Error)?.message ?? 'unknown error'}) — exported silent.`);
        }
      }
    }

    const blob = await recordWebm(source, {
      fps: req.fps, onProgress: req.onProgress, signal: controller.signal, audioBuffer,
    });
    return {
      blob,
      filename: buildExportFilename({ kind: 'world', fromGen: plan.fromGen, toGen: plan.toGen, ext: 'webm' }),
      reductionNotes: notes,
    };
  })();
  return { promise, cancel: () => controller.abort() };
}

/** Offline deterministic zipped PNG sequence export. */
export function exportWorldPngZip(req: ExportRequest): ExportHandle<ExportResult> {
  const controller = new AbortController();
  const promise = (async (): Promise<ExportResult> => {
    const plan = preparePlan(req, MAX_PNG_SEQUENCE_FRAMES, MAX_DIMENSION);
    const source = await buildWorldSource(req, plan, controller.signal);
    const blob = await encodePngZip(source, { onProgress: req.onProgress, signal: controller.signal, baseName: 'afterlife' });
    return {
      blob,
      filename: buildExportFilename({ kind: 'world-frames', fromGen: plan.fromGen, toGen: plan.toGen, ext: 'zip' }),
      reductionNotes: plan.notes,
    };
  })();
  return { promise, cancel: () => controller.abort() };
}

/** Offline deterministic animated GIF export — same replay/frame-source
 *  pipeline as WebM/PNG-sequence, hand-written median-cut + LZW + GIF89a
 *  encoder (`gifExport.ts`). Bounded by its own, tighter frame/dimension
 *  caps (`MAX_GIF_FRAMES`/`MAX_GIF_DIMENSION`) — GIFs get large fast. */
export function exportWorldGif(req: ExportRequest): ExportHandle<ExportResult> {
  const controller = new AbortController();
  const promise = (async (): Promise<ExportResult> => {
    const plan = preparePlan(req, MAX_GIF_FRAMES, MAX_GIF_DIMENSION);
    const source = await buildWorldSource(req, plan, controller.signal);
    const blob = await encodeGifExport(source, { fps: req.fps, onProgress: req.onProgress, signal: controller.signal });
    return {
      blob,
      filename: buildExportFilename({ kind: 'world', fromGen: plan.fromGen, toGen: plan.toGen, ext: 'gif' }),
      reductionNotes: plan.notes,
    };
  })();
  return { promise, cancel: () => controller.abort() };
}

/** Offline, deterministic audio-only export (WAV — needs no codec support).
 *  Renders the pure `SoundscapeBrain`/`SynthGraph` against an
 *  `OfflineAudioContext` for the same generation range video export would
 *  use, honouring the user's CURRENT audio settings (scale, preset, tempo,
 *  density, decay). Two exports of the same range/settings are
 *  bit-identical — see `@/export/audio/offlineRender.ts`'s doc. */
export function exportWorldAudio(req: AudioExportRequest): ExportHandle<AudioExportResult> {
  const controller = new AbortController();
  const promise = (async (): Promise<AudioExportResult> => {
    const session = getSession();
    if (!session) throw new Error('export: no active session');
    const notes: string[] = [];

    let fromGen = req.fromGen;
    let toGen = req.toGen;
    const windowStart = session.history.windowStart;
    const maxGen = session.history.maxGen;
    if (fromGen < windowStart || toGen > maxGen) {
      notes.push(
        `Requested generations [${fromGen}, ${toGen}] reach outside the retained history window `
        + `[${windowStart}, ${maxGen}] — clamped to what's actually still available.`,
      );
      fromGen = Math.max(fromGen, windowStart);
      toGen = Math.min(toGen, maxGen);
    }

    req.onProgress?.({ done: 0, total: 1 });
    const audio = await renderOfflineAudio({
      history: session.history,
      fromGen,
      toGen,
      gensPerSecond: req.gensPerSecond,
      settings: readAudioSettings(),
      signal: controller.signal,
    });
    req.onProgress?.({ done: 1, total: 1 });

    const blob = encodeWav(audio.buffer);
    return {
      blob,
      filename: buildExportFilename({ kind: 'world-audio', fromGen, toGen, ext: 'wav' }),
      reductionNotes: [...notes, ...audio.reductionNotes],
      durationSeconds: audio.durationSeconds,
    };
  })();
  return { promise, cancel: () => controller.abort() };
}

export { buildAnnotationText };
export type { ExportHandle, ProgressCallback } from './types';
export { WEBM_MIME_CANDIDATES, pickSupportedMimeType } from './webmRecorder';
export { MAX_VIDEO_FRAMES, MAX_PNG_SEQUENCE_FRAMES, MAX_DIMENSION, MAX_GIF_FRAMES, MAX_GIF_DIMENSION, MAX_AUDIO_SECONDS } from './limits';
export { EXPORT_PRESETS, DEFAULT_EXPORT_SETTINGS, applyPreset } from './presets';
export type { ExportPreset, ExportSettings, ExportFormat } from './presets';
export { computeFramePlan } from './pacing';
export { formatBytes, formatDuration, estimateWebmBytes, estimatePngZipBytes, estimateGifBytes } from './estimate';
export { ExportUnsupportedError, isAbortError } from './errors';
