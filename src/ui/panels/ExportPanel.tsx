/**
 * Video / animation export dialog. Opened from `PersistPanel`'s "Images"
 * section (which already covers the still PNG exports) — this covers moving
 * output: an offline, deterministic replay of recorded history, encoded to
 * WebM via `MediaRecorder`, or a zipped PNG sequence for real editing
 * software. See `@/export/**` for the pipeline this drives; nothing here
 * touches the live renderer/camera/engine the user is looking at.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { getSession } from '@/ui/session';
import { bus } from '@/ui/bus';
import { Button, Dialog, Field, Slider } from '@/ui/primitives';
import {
  DEFAULT_EXPORT_SETTINGS, EXPORT_PRESETS, applyPreset,
  computeFramePlan, estimatePngZipBytes, estimateWebmBytes, formatBytes, formatDuration,
  exportWorldPngZip, exportWorldWebm, isAbortError, pickSupportedMimeType, WEBM_MIME_CANDIDATES,
  type ExportHandle, type ExportSettings,
} from '@/export';

export interface ExportPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function download(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const webmSupported = typeof MediaRecorder !== 'undefined'
  && pickSupportedMimeType(WEBM_MIME_CANDIDATES, (t) => MediaRecorder.isTypeSupported(t)) !== null;

export function ExportPanel({ open, onOpenChange }: ExportPanelProps) {
  const session = getSession();
  const windowStart = session?.history.windowStart ?? 0;
  const maxGen = session?.history.maxGen ?? 0;

  const [fromGen, setFromGen] = useState(windowStart);
  const [toGen, setToGen] = useState(maxGen);
  const [settings, setSettings] = useState<ExportSettings>(DEFAULT_EXPORT_SETTINGS);
  const [presetId, setPresetId] = useState(EXPORT_PRESETS[0]!.id);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const handleRef = useRef<ExportHandle<unknown> | null>(null);

  // Re-snapshot the available range each time the dialog opens — it's a
  // point-in-time export target, not a live-tracking one.
  useEffect(() => {
    if (!open || !session) return;
    setFromGen(session.history.windowStart);
    setToGen(session.history.maxGen);
  }, [open, session]);

  const plan = useMemo(() => {
    try {
      return computeFramePlan({ fromGen, toGen, fps: settings.fps, gensPerSecond: settings.gensPerSecond });
    } catch {
      return null;
    }
  }, [fromGen, toGen, settings.fps, settings.gensPerSecond]);

  const estimateText = useMemo(() => {
    if (!plan) return null;
    const bytes = settings.format === 'webm'
      ? estimateWebmBytes(settings.width, settings.height, settings.fps, plan.durationSeconds)
      : estimatePngZipBytes(settings.width, settings.height, plan.frameCount);
    return `~${formatBytes(bytes)} · ${formatDuration(plan.durationSeconds)} · ${plan.frameCount} frames`;
  }, [plan, settings]);

  const applyPresetId = (id: string): void => {
    setPresetId(id);
    setSettings((s) => applyPreset(id, s));
  };

  const cancel = (): void => {
    handleRef.current?.cancel();
  };

  const start = (): void => {
    if (!session || busy) return;
    setBusy(true);
    setProgress({ done: 0, total: 1 });

    const req = {
      fromGen,
      toGen,
      width: settings.width,
      height: settings.height,
      fps: settings.fps,
      gensPerSecond: settings.gensPerSecond,
      annotate: settings.annotate,
      onProgress: (p: { done: number; total: number }) => setProgress(p),
    };

    const handle = settings.format === 'webm' ? exportWorldWebm(req) : exportWorldPngZip(req);
    handleRef.current = handle as ExportHandle<unknown>;

    handle.promise.then(
      (result) => {
        download(result.filename, result.blob);
        if (result.reductionNotes.length > 0) {
          bus.emit('toast', { message: result.reductionNotes[0]!, tone: 'info' });
        } else {
          bus.emit('toast', { message: `Exported ${result.filename}.`, tone: 'success' });
        }
        setBusy(false);
        setProgress(null);
        handleRef.current = null;
      },
      (err: unknown) => {
        setBusy(false);
        setProgress(null);
        handleRef.current = null;
        if (isAbortError(err)) {
          bus.emit('toast', { message: 'Export cancelled.', tone: 'info' });
          return;
        }
        bus.emit('toast', { message: `Export failed: ${(err as Error)?.message ?? 'unknown error'}`, tone: 'warn' });
      },
    );
  };

  // Cancel any in-flight export if the dialog is closed mid-run — never
  // leave a `MediaRecorder`/replay cursor running unattended in the background.
  useEffect(() => {
    if (!open) handleRef.current?.cancel();
  }, [open]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => { if (!next) handleRef.current?.cancel(); onOpenChange(next); }}
      title="Export video"
      description="An offline, deterministic replay of recorded history — exact framerate, no dropped frames, reproducible from the same generation range."
      width={440}
      footer={
        busy ? (
          <Button size="sm" variant="ghost" onClick={cancel}>Cancel</Button>
        ) : (
          <>
            <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
            <Button size="sm" onClick={start} disabled={!session || (settings.format === 'webm' && !webmSupported)}>
              Export
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-1.5">
          {EXPORT_PRESETS.map((preset) => (
            <Button
              key={preset.id}
              size="sm"
              variant={presetId === preset.id ? 'solid' : 'ghost'}
              onClick={() => applyPresetId(preset.id)}
            >
              {preset.label}
            </Button>
          ))}
        </div>
        <p className="text-xs text-ivory-300">
          {EXPORT_PRESETS.find((p) => p.id === presetId)?.description}
        </p>

        <Field label="Generation range">
          <div className="flex items-center gap-2 text-xs text-ivory-100">
            <input
              type="number"
              value={fromGen}
              min={windowStart}
              max={toGen}
              onChange={(e) => setFromGen(Math.max(windowStart, Math.min(toGen, Number(e.target.value))))}
              className="w-24 rounded-xs border border-line-strong bg-ink-900 px-2 py-1 tabular outline-none focus-visible:focus-ring"
            />
            <span>to</span>
            <input
              type="number"
              value={toGen}
              min={fromGen}
              max={maxGen}
              onChange={(e) => setToGen(Math.max(fromGen, Math.min(maxGen, Number(e.target.value))))}
              className="w-24 rounded-xs border border-line-strong bg-ink-900 px-2 py-1 tabular outline-none focus-visible:focus-ring"
            />
            <span className="text-ivory-300">of [{windowStart}, {maxGen}] retained</span>
          </div>
        </Field>

        <Slider
          label="Width"
          value={settings.width}
          min={160}
          max={1920}
          step={20}
          format={(v) => `${v}px`}
          onChange={(width) => setSettings((s) => ({ ...s, width }))}
        />
        <Slider
          label="Height"
          value={settings.height}
          min={120}
          max={1080}
          step={20}
          format={(v) => `${v}px`}
          onChange={(height) => setSettings((s) => ({ ...s, height }))}
        />
        <Slider
          label="Frames per second"
          value={settings.fps}
          min={6}
          max={60}
          format={(v) => `${v} fps`}
          onChange={(fps) => setSettings((s) => ({ ...s, fps }))}
        />
        <Slider
          label="Simulated speed"
          value={settings.gensPerSecond}
          min={1}
          max={120}
          format={(v) => `${v} gens/sec`}
          onChange={(gensPerSecond) => setSettings((s) => ({ ...s, gensPerSecond }))}
        />

        <Field label="Annotation">
          <label className="flex items-center gap-2 text-xs text-ivory-200 max-[480px]:min-h-11">
            <input
              type="checkbox"
              checked={settings.annotate}
              onChange={(e) => setSettings((s) => ({ ...s, annotate: e.target.checked }))}
              className="h-3.5 w-3.5 shrink-0 accent-[var(--color-ivory-100)] max-[480px]:h-5 max-[480px]:w-5"
            />
            Burn in rule &amp; generation range
          </label>
        </Field>

        <div className="flex items-center justify-between rounded-sm border border-line px-3 py-2">
          <span className="text-xs text-ivory-300">{settings.format === 'webm' ? 'WebM video' : 'PNG sequence (zip)'}</span>
          <span className="tabular text-xs text-ivory-100">{estimateText ?? '—'}</span>
        </div>

        {settings.format === 'webm' && !webmSupported && (
          <p className="text-xs text-accent-warn">
            This browser has no supported WebM video encoder — try the PNG sequence preset instead, or a recent Chrome/Edge/Firefox.
          </p>
        )}

        {progress && (
          <div className="flex flex-col gap-1">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-600">
              <div
                className="h-full bg-ivory-200 transition-[width]"
                style={{ width: `${progress.total > 0 ? Math.min(100, (progress.done / progress.total) * 100) : 0}%` }}
              />
            </div>
            <span className="tabular text-micro text-ivory-300">{progress.done} / {progress.total}</span>
          </div>
        )}
      </div>
    </Dialog>
  );
}
