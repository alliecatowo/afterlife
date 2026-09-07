/**
 * The top instrument bar. Slim (48px), dense, always visible outside
 * presentation mode. Generation/population are written straight to DOM refs
 * from the bus — this component itself only re-renders on low-frequency
 * store changes (lens, speed, playing, muted, presentation).
 */
import { useEffect, useRef, useState } from 'react';
import { bus } from '@/ui/bus';
import { useAppStore } from '@/ui/store';
import { useUIState } from '@/ui/uiState';
import { getSession } from '@/ui/session';
import { subscribeReadout } from '@/ui/hooks/useSimulationReadout';
import { IconButton, Readout, Toggle, Divider, Tooltip, Legend } from '@/ui/primitives';
import {
  PlayIcon, PauseIcon, StepBackIcon, StepForwardIcon, EyeIcon, ExpandIcon, CompressIcon,
  SpeakerOnIcon, SpeakerOffIcon, QuestionIcon, BranchIcon, ColumnsIcon, SlidersIcon, BookIcon,
  DrawerIcon, ClockIcon,
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

export function Hud() {
  const genRef = useRef<HTMLSpanElement>(null);
  const popRef = useRef<HTMLSpanElement>(null);

  const playing = useAppStore((s) => s.playing);
  const speed = useAppStore((s) => s.speed);
  const setSpeed = useAppStore((s) => s.setSpeed);
  const lens = useAppStore((s) => s.lens);
  const setLens = useAppStore((s) => s.setLens);
  const muted = useAppStore((s) => s.muted);
  const setMuted = useAppStore((s) => s.setMuted);
  const presentation = useAppStore((s) => s.presentation);
  const setPresentation = useAppStore((s) => s.setPresentation);
  const drawerOpen = useAppStore((s) => s.drawerOpen);
  const setDrawerOpen = useAppStore((s) => s.setDrawerOpen);
  const sculptureOpen = useAppStore((s) => s.sculptureOpen);
  const selection = useAppStore((s) => s.selection);

  const rightPanel = useUIState((s) => s.rightPanel);
  const toggleRightPanel = useUIState((s) => s.toggleRightPanel);
  const setShortcutsOpen = useUIState((s) => s.setShortcutsOpen);

  useEffect(() => subscribeReadout((r) => {
    if (genRef.current) genRef.current.textContent = String(r.gen);
    if (popRef.current) popRef.current.textContent = String(r.population);
  }), []);

  // A quiet, one-time invitation near the transport controls: "pause time".
  // Dismissed permanently the first time playback is actually toggled.
  const [everToggled, setEverToggled] = useState(false);

  const togglePlay = () => {
    // Emit the intent only — `session.ts` is the single source of truth that
    // flips `store.playing` in response, whether triggered from here, from
    // `input.ts`'s Space handler, or anywhere else.
    setEverToggled(true);
    bus.emit(playing ? 'playback:pause' : 'playback:play', undefined);
  };

  const step = (by: number) => {
    if (playing) return;
    bus.emit('playback:step', { by });
  };

  if (presentation) {
    return (
      <div className="flex h-full items-center justify-between px-4">
        <span className="display-face-tight text-sm text-ivory-100">AFTERLIFE</span>
        <div className="flex items-center gap-3">
          <Readout label="gen" value={<span ref={genRef}>0</span>} digits={6} />
          <IconButton label="Exit presentation" icon={<CompressIcon />} onClick={() => { setPresentation(false); bus.emit('presentation:toggle', { on: false }); }} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full items-center gap-3 overflow-x-auto px-3">
      <span className="display-face-tight shrink-0 text-sm text-ivory-100">AFTERLIFE</span>
      <Tooltip content={drawerOpen ? 'Close drawer' : 'Open drawer'}>
        <IconButton
          label={drawerOpen ? 'Close drawer' : 'Open drawer'}
          icon={<DrawerIcon />}
          pressed={drawerOpen}
          onClick={() => setDrawerOpen(!drawerOpen)}
        />
      </Tooltip>
      <Divider orientation="vertical" className="h-6" />

      <div className="flex shrink-0 items-center gap-1">
        <Tooltip content={playing ? 'Pause (Space)' : 'Play (Space)'}>
          <IconButton
            label={playing ? 'Pause' : 'Play'}
            icon={playing ? <PauseIcon /> : <PlayIcon />}
            variant={playing ? 'solid' : 'ghost'}
            pressed={playing}
            onClick={togglePlay}
          />
        </Tooltip>
        <Tooltip content="Step back one generation">
          <IconButton label="Step back" icon={<StepBackIcon />} disabled={playing} onClick={() => step(-1)} />
        </Tooltip>
        <Tooltip content="Step forward one generation">
          <IconButton label="Step forward" icon={<StepForwardIcon />} disabled={playing} onClick={() => step(1)} />
        </Tooltip>
        <span
          className="ml-1 rounded-xs px-1.5 py-0.5 text-micro uppercase tracking-[0.18em]"
          style={{ color: playing ? 'var(--color-accent-life)' : 'var(--color-ivory-300)' }}
        >
          {playing ? '● running' : '❚❚ paused'}
        </span>
        {!everToggled && (
          <span className="hidden text-micro italic text-ivory-300 sm:inline">— pause time anytime</span>
        )}
      </div>

      <Divider orientation="vertical" className="h-6" />
      <Readout label="gen" value={<span ref={genRef}>0</span>} digits={6} />
      <Readout label="pop" value={<span ref={popRef}>0</span>} digits={6} accent="life" />

      <Divider orientation="vertical" className="hidden h-6 md:block" />
      <div className="hidden shrink-0 items-center gap-2 md:flex">
        <span className="text-micro uppercase tracking-[0.18em] text-ivory-300">speed</span>
        <Toggle
          aria-label="Playback speed"
          options={SPEED_PRESETS.map((v) => ({ value: String(v), label: String(v) }))}
          value={String(speed)}
          onChange={(v) => { const n = Number(v); setSpeed(n); bus.emit('playback:speed', { speed: n }); }}
        />
      </div>

      <Divider orientation="vertical" className="hidden h-6 lg:block" />
      <div className="hidden shrink-0 items-center gap-2 lg:flex">
        <EyeIcon className="text-ivory-300" />
        <Toggle
          aria-label="Render lens"
          options={[
            { value: 'life', label: 'Life' },
            { value: 'age', label: 'Age' },
            { value: 'activity', label: 'Activity' },
          ]}
          value={lens}
          onChange={(v) => { const l = v as RenderLens; setLens(l); bus.emit('lens:changed', { lens: l }); }}
        />
        <Legend items={LENS_LEGEND[lens]} className="ml-1" />
      </div>

      <div className="flex-1" />

      <div className="flex shrink-0 items-center gap-1">
        <Tooltip content={sculptureOpen ? 'Return to the living plane' : selection ? 'Open the Time Sculpture for this selection' : 'Select a region on the world to sculpt its history'}>
          <IconButton
            label={sculptureOpen ? 'Close time sculpture' : 'Open time sculpture'}
            icon={<ClockIcon />}
            pressed={sculptureOpen}
            disabled={!sculptureOpen && !selection}
            onClick={() => {
              const session = getSession();
              if (!session) return;
              if (sculptureOpen) session.closeSculpture();
              else session.openSculpture();
            }}
          />
        </Tooltip>
        <Divider orientation="vertical" className="h-6" />
        <Tooltip content="Branches">
          <IconButton label="Branches" icon={<BranchIcon />} pressed={rightPanel === 'branches'} onClick={() => toggleRightPanel('branches')} />
        </Tooltip>
        <Tooltip content="Compare">
          <IconButton label="Compare" icon={<ColumnsIcon />} pressed={rightPanel === 'compare'} onClick={() => toggleRightPanel('compare')} />
        </Tooltip>
        <Tooltip content="Field guide">
          <IconButton label="Field guide" icon={<BookIcon />} pressed={rightPanel === 'guide'} onClick={() => toggleRightPanel('guide')} />
        </Tooltip>
        <Tooltip content="Settings">
          <IconButton label="Settings" icon={<SlidersIcon />} pressed={rightPanel === 'settings'} onClick={() => toggleRightPanel('settings')} />
        </Tooltip>
        <Divider orientation="vertical" className="h-6" />
        <Tooltip content={muted ? 'Unmute' : 'Mute'}>
          <IconButton
            label={muted ? 'Unmute' : 'Mute'}
            icon={muted ? <SpeakerOffIcon /> : <SpeakerOnIcon />}
            onClick={() => { setMuted(!muted); bus.emit('audio:toggle', { muted: !muted }); }}
          />
        </Tooltip>
        <Tooltip content="Presentation mode">
          <IconButton
            label="Presentation mode"
            icon={<ExpandIcon />}
            onClick={() => { setPresentation(true); bus.emit('presentation:toggle', { on: true }); }}
          />
        </Tooltip>
        <Tooltip content="Keyboard shortcuts (?)">
          <IconButton label="Keyboard shortcuts" icon={<QuestionIcon />} onClick={() => setShortcutsOpen(true)} />
        </Tooltip>
      </div>
    </div>
  );
}
