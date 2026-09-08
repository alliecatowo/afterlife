/**
 * Settings & quality: audio, motion, grid, and the honest constants that
 * govern how much history is retained. Nothing here is decorative — every
 * control is wired to a real bus event or store field.
 */
import { useAppStore } from '@/ui/store';
import { useUIState } from '@/ui/uiState';
import { bus } from '@/ui/bus';
import { getSession } from '@/ui/session';
import { useReducedMotion } from '@/ui/hooks/useReducedMotion';
import { Field, Slider, Divider, Readout, Toggle } from '@/ui/primitives';
import { HISTORY_WINDOW, KEYFRAME_INTERVAL } from '@/core/history';
import type { PaletteMode } from '@/render/color';

export function SettingsPanel() {
  const muted = useAppStore((s) => s.muted);
  const setMuted = useAppStore((s) => s.setMuted);
  const volume = useAppStore((s) => s.volume);
  const setVolume = useAppStore((s) => s.setVolume);
  const showGrid = useAppStore((s) => s.showGrid);
  const setShowGrid = useAppStore((s) => s.setShowGrid);
  const paletteMode = useUIState((s) => s.paletteMode);
  const setPaletteMode = useUIState((s) => s.setPaletteMode);
  const reducedMotion = useReducedMotion();

  return (
    <div className="flex flex-col gap-4">
      <Field label="Sound">
        <label className="flex items-center gap-2 text-xs text-ivory-200 max-[480px]:min-h-11">
          <input
            type="checkbox"
            checked={!muted}
            onChange={(e) => { setMuted(!e.target.checked); bus.emit('audio:toggle', { muted: !e.target.checked }); }}
            className="h-3.5 w-3.5 shrink-0 accent-[var(--color-ivory-100)] max-[480px]:h-5 max-[480px]:w-5"
          />
          Enable the soundscape
        </label>
        <Slider
          label="Volume"
          value={Math.round(volume * 100)}
          min={0}
          max={100}
          disabled={muted}
          onChange={(v) => setVolume(v / 100)}
          onCommit={(v) => bus.emit('audio:volume', { volume: v / 100 })}
          format={(v) => `${v}%`}
        />
      </Field>

      <Divider />

      <Field label="World grid">
        <label className="flex items-center gap-2 text-xs text-ivory-200 max-[480px]:min-h-11">
          <input
            type="checkbox"
            checked={showGrid}
            onChange={(e) => setShowGrid(e.target.checked)}
            className="h-3.5 w-3.5 shrink-0 accent-[var(--color-ivory-100)] max-[480px]:h-5 max-[480px]:w-5"
          />
          Show cell grid lines
        </label>
      </Field>

      <Divider />

      <Field
        label="Colour palette"
        description="Affects the discrete species lenses (Immigration, QuadLife). Okabe-Ito is tuned for colour-vision deficiency."
      >
        <Toggle
          aria-label="Colour palette"
          options={[
            { value: 'default', label: 'Default' },
            { value: 'cvd', label: 'Colourblind-safe' },
          ]}
          value={paletteMode}
          onChange={(v) => {
            const mode = v as PaletteMode;
            setPaletteMode(mode);
            getSession()?.renderer.setPalette(mode);
          }}
        />
      </Field>

      <Divider />

      <Field label="Motion" description="Controlled by your operating system's reduce-motion setting.">
        <p className="text-xs text-ivory-200">
          {reducedMotion ? 'Reduced — panel and toast transitions are instant.' : 'Full — panels and toasts animate.'}
        </p>
      </Field>

      <Divider />

      <Field label="Retained history" description="How far back the timeline can scrub.">
        <div className="flex gap-4">
          <Readout label="window" value={HISTORY_WINDOW} unit="gens" digits={5} />
          <Readout label="keyframe" value={KEYFRAME_INTERVAL} unit="gens" digits={3} />
        </div>
      </Field>
    </div>
  );
}
