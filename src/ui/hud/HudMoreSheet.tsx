/**
 * The mobile HUD's overflow sheet — everything that doesn't fit a 390px
 * toolbar row: the render lens (a headline feature that was previously
 * `lg:flex`-only and therefore completely unreachable below 1024px), speed,
 * the Time Sculpture entry, every right-panel tab, mute, presentation mode,
 * and the about/shortcuts entry points. `Hud.tsx` renders the same controls
 * inline at `lg` and up; this sheet is the `lg:hidden` substitute, not a
 * second, divergent implementation of any of them — every action here calls
 * the exact same bus emit / store setter the desktop control does.
 */
import type { ReactNode } from 'react';
import { bus } from '@/ui/bus';
import { useAppStore } from '@/ui/store';
import { useUIState, type RightPanelId } from '@/ui/uiState';
import { getSession } from '@/ui/session';
import { useTourStore } from '@/ui/tutorial/tourStore';
import { Sheet, Toggle, Legend, IconButton } from '@/ui/primitives';
import {
  EyeIcon, BranchIcon, ColumnsIcon, SlidersIcon, BookIcon, FlaskIcon, SaveIcon, WaveformIcon,
  ClockIcon, SpeakerOnIcon, SpeakerOffIcon, ExpandIcon, CompassIcon, QuestionIcon, FilmIcon,
} from '@/ui/icons';
import type { RenderLens } from '@/core/types';

const SPEED_PRESETS = [1, 4, 12, 30, 60];

const LENS_LEGEND: Record<RenderLens, { swatch: string; label: string }[]> = {
  life: [{ swatch: 'var(--color-accent-life)', label: 'alive' }],
  age: [
    { swatch: 'linear-gradient(90deg, color-mix(in oklch, var(--color-accent-age) 25%, transparent), var(--color-accent-age))', label: 'young → long-lived' },
  ],
  activity: [
    { swatch: 'linear-gradient(90deg, transparent, var(--color-accent-activity))', label: 'quiet → recently changed' },
  ],
};

const PANEL_ROWS: { id: Exclude<RightPanelId, null>; label: string; icon: ReactNode }[] = [
  { id: 'branches', label: 'Branches', icon: <BranchIcon /> },
  { id: 'compare', label: 'Compare', icon: <ColumnsIcon /> },
  { id: 'guide', label: 'Field guide', icon: <BookIcon /> },
  { id: 'experiments', label: 'Experiments', icon: <FlaskIcon /> },
  { id: 'save', label: 'Save & export', icon: <SaveIcon /> },
  { id: 'audio', label: 'Instrument', icon: <WaveformIcon /> },
  { id: 'settings', label: 'Settings', icon: <SlidersIcon /> },
];

function SheetSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="border-b border-line py-3 first:pt-1 last:border-b-0">
      <div className="mb-2 text-micro uppercase tracking-[0.18em] text-ivory-300">{label}</div>
      {children}
    </div>
  );
}

export function HudMoreSheet() {
  const moreOpen = useUIState((s) => s.moreOpen);
  const setMoreOpen = useUIState((s) => s.setMoreOpen);
  const toggleRightPanel = useUIState((s) => s.toggleRightPanel);
  const setShortcutsOpen = useUIState((s) => s.setShortcutsOpen);
  const setAboutOpen = useTourStore((s) => s.setAboutOpen);

  const speed = useAppStore((s) => s.speed);
  const setSpeed = useAppStore((s) => s.setSpeed);
  const lens = useAppStore((s) => s.lens);
  const setLens = useAppStore((s) => s.setLens);
  const muted = useAppStore((s) => s.muted);
  const setMuted = useAppStore((s) => s.setMuted);
  const sculptureOpen = useAppStore((s) => s.sculptureOpen);
  const selection = useAppStore((s) => s.selection);

  const openPanel = (id: Exclude<RightPanelId, null>) => {
    toggleRightPanel(id);
    setMoreOpen(false);
  };

  return (
    <Sheet open={moreOpen} onOpenChange={setMoreOpen} title="More controls">
      <SheetSection label="Render lens">
        <div className="flex items-center gap-2">
          <EyeIcon className="shrink-0 text-ivory-300" />
          <Toggle
            aria-label="Render lens"
            className="flex-wrap"
            options={[
              { value: 'life', label: 'Life' },
              { value: 'age', label: 'Age' },
              { value: 'activity', label: 'Activity' },
            ]}
            value={lens}
            onChange={(v) => { const l = v as RenderLens; setLens(l); bus.emit('lens:changed', { lens: l }); }}
          />
        </div>
        <Legend items={LENS_LEGEND[lens]} className="mt-2" />
      </SheetSection>

      <SheetSection label="Speed">
        <Toggle
          aria-label="Playback speed"
          className="flex-wrap"
          options={SPEED_PRESETS.map((v) => ({ value: String(v), label: String(v) }))}
          value={String(speed)}
          onChange={(v) => { const n = Number(v); setSpeed(n); bus.emit('playback:speed', { speed: n }); }}
        />
      </SheetSection>

      <SheetSection label="Time sculpture">
        <button
          type="button"
          disabled={!sculptureOpen && !selection}
          onClick={() => {
            const session = getSession();
            if (!session) return;
            if (sculptureOpen) session.closeSculpture();
            else session.openSculpture();
            setMoreOpen(false);
          }}
          className={
            'flex min-h-11 w-full items-center gap-3 rounded-sm border px-3 text-left text-sm ' +
            'transition-colors duration-[var(--duration-instant)] focus-visible:focus-ring outline-none ' +
            (sculptureOpen
              ? 'border-line-strong bg-ink-700 text-ivory-100'
              : 'border-line text-ivory-200 hover:bg-ink-800 disabled:cursor-not-allowed disabled:text-ink-500 disabled:hover:bg-transparent')
          }
        >
          <ClockIcon />
          {/* Same wording as the desktop icon's `aria-label` (`Hud.tsx`) —
              one control, reachable two ways, not two different-sounding
              ones — so a test or a returning user recognises it either way. */}
          {sculptureOpen ? 'Close time sculpture' : selection ? 'Open time sculpture' : 'Select a region first'}
        </button>
      </SheetSection>

      <SheetSection label="Panels">
        <div className="flex flex-col gap-1.5">
          {PANEL_ROWS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => openPanel(p.id)}
              className="flex min-h-11 w-full items-center gap-3 rounded-sm border border-line px-3 text-left text-sm text-ivory-200 transition-colors duration-[var(--duration-instant)] hover:bg-ink-800 focus-visible:focus-ring outline-none"
            >
              {p.icon}
              {p.label}
            </button>
          ))}
        </div>
      </SheetSection>

      <SheetSection label="More">
        <div className="flex flex-wrap gap-2">
          <IconButton
            label={muted ? 'Unmute' : 'Mute'}
            icon={muted ? <SpeakerOffIcon /> : <SpeakerOnIcon />}
            variant="ghost"
            onClick={() => { setMuted(!muted); bus.emit('audio:toggle', { muted: !muted }); }}
          />
          <IconButton
            label="Presentation mode"
            icon={<ExpandIcon />}
            variant="ghost"
            onClick={() => {
              useAppStore.getState().setPresentation(true);
              bus.emit('presentation:toggle', { on: true });
              setMoreOpen(false);
            }}
          />
          <IconButton
            label="Cinematic mode"
            icon={<FilmIcon />}
            variant="ghost"
            onClick={() => { getSession()?.cinematic.enter(); setMoreOpen(false); }}
          />
          <IconButton
            label="About AFTERLIFE"
            icon={<CompassIcon />}
            variant="ghost"
            onClick={() => { setAboutOpen(true); setMoreOpen(false); }}
          />
          <IconButton
            label="Keyboard shortcuts"
            icon={<QuestionIcon />}
            variant="ghost"
            onClick={() => { setShortcutsOpen(true); setMoreOpen(false); }}
          />
        </div>
      </SheetSection>
    </Sheet>
  );
}
