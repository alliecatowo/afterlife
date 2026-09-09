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
import { Field, Slider, Divider, Readout, Toggle, Button } from '@/ui/primitives';
import { HISTORY_WINDOW, KEYFRAME_INTERVAL } from '@/core/history';
import type { PaletteMode } from '@/render/color';
import { useThemeStore } from '@/ui/theme/store';
import { BUILTIN_THEMES } from '@/ui/theme/themes';

export function SettingsPanel() {
  const themeId = useThemeStore((s) => s.themeId);
  const setTheme = useThemeStore((s) => s.setTheme);
  const setRightPanel = useUIState((s) => s.setRightPanel);
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
      <Field label="Appearance" description="A full editor (custom themes, import/export) lives in the Appearance panel.">
        <div className="flex flex-wrap items-center gap-1.5">
          {BUILTIN_THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              title={t.name}
              aria-label={`Theme: ${t.name}`}
              aria-pressed={themeId === t.id}
              onClick={() => setTheme(t.id)}
              className={
                'h-6 w-6 shrink-0 rounded-full border transition-colors duration-[var(--duration-instant)] ' +
                'focus-visible:focus-ring outline-none ' +
                (themeId === t.id ? 'border-line-strong' : 'border-line hover:border-line-strong')
              }
              style={{ background: t.tokens['--color-ink-900'] }}
            >
              <span
                aria-hidden="true"
                className="mx-auto block h-2 w-2 rounded-full"
                style={{ background: t.tokens['--color-accent-life'] }}
              />
            </button>
          ))}
          <Button variant="ghost" size="sm" onClick={() => setRightPanel('theme')}>More appearance options</Button>
        </div>
      </Field>

      <Divider />

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

      <Field
        label="History configuration"
        description="Fixed limits, not a live readout of this session — see Export for how much is actually retained right now."
      >
        <div className="flex gap-4">
          <Readout label="max window" value={HISTORY_WINDOW} unit="gens" digits={5} />
          <Readout label="keyframe every" value={KEYFRAME_INTERVAL} unit="gens" digits={3} />
        </div>
      </Field>
    </div>
  );
}
