/**
 * Named export presets + the manual-control fallback. Pure data plus one
 * merge helper — no DOM.
 */

export type ExportFormat = 'webm' | 'png-zip';

export interface ExportSettings {
  width: number;
  height: number;
  fps: number;
  /** Simulated generations advanced per second of output — see `pacing.ts`. */
  gensPerSecond: number;
  format: ExportFormat;
  annotate: boolean;
}

export interface ExportPreset {
  id: string;
  label: string;
  description: string;
  settings: ExportSettings;
}

export const EXPORT_PRESETS: readonly ExportPreset[] = [
  {
    id: 'social',
    label: 'Share on social',
    description: '720p WebM at 24fps — a good size/quality balance for feeds.',
    settings: { width: 1280, height: 720, fps: 24, gensPerSecond: 30, format: 'webm', annotate: true },
  },
  {
    id: 'high-quality',
    label: 'High quality',
    description: '1080p WebM at 30fps, slower simulated pacing for a more legible clip.',
    settings: { width: 1920, height: 1080, fps: 30, gensPerSecond: 20, format: 'webm', annotate: true },
  },
  {
    id: 'frame-sequence',
    label: 'PNG sequence (zip)',
    description: 'One PNG per frame, zipped — for bringing a clip into real editing software.',
    settings: { width: 960, height: 600, fps: 12, gensPerSecond: 24, format: 'png-zip', annotate: false },
  },
];

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = EXPORT_PRESETS[0]!.settings;

export function applyPreset(id: string, current: ExportSettings): ExportSettings {
  const preset = EXPORT_PRESETS.find((p) => p.id === id);
  return preset ? { ...current, ...preset.settings } : current;
}
