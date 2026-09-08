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
import type { Rect } from '@/core/types';
import { computeFramePlan } from './pacing';
import { capDimensions, capFramePlan, MAX_DIMENSION, MAX_PNG_SEQUENCE_FRAMES, MAX_VIDEO_FRAMES } from './limits';
import { createWorldFrameSource } from './worldFrameSource';
import { recordWebm } from './webmRecorder';
import { encodePngZip } from './pngZipExport';
import { buildAnnotationText, buildExportFilename } from './filename';
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
  onProgress?: ProgressCallback;
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
 *  frame (never a realtime screen capture), encodes via `MediaRecorder`. */
export function exportWorldWebm(req: ExportRequest): ExportHandle<ExportResult> {
  const controller = new AbortController();
  const promise = (async (): Promise<ExportResult> => {
    const plan = preparePlan(req, MAX_VIDEO_FRAMES, MAX_DIMENSION);
    const source = await buildWorldSource(req, plan, controller.signal);
    const blob = await recordWebm(source, { fps: req.fps, onProgress: req.onProgress, signal: controller.signal });
    return {
      blob,
      filename: buildExportFilename({ kind: 'world', fromGen: plan.fromGen, toGen: plan.toGen, ext: 'webm' }),
      reductionNotes: plan.notes,
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

export { buildAnnotationText };
export type { ExportHandle, ProgressCallback } from './types';
export { WEBM_MIME_CANDIDATES, pickSupportedMimeType } from './webmRecorder';
export { MAX_VIDEO_FRAMES, MAX_PNG_SEQUENCE_FRAMES, MAX_DIMENSION } from './limits';
export { EXPORT_PRESETS, DEFAULT_EXPORT_SETTINGS, applyPreset } from './presets';
export type { ExportPreset, ExportSettings, ExportFormat } from './presets';
export { computeFramePlan } from './pacing';
export { formatBytes, formatDuration, estimateWebmBytes, estimatePngZipBytes } from './estimate';
export { ExportUnsupportedError, isAbortError } from './errors';
