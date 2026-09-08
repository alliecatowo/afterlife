/**
 * The top instrument bar. Slim (48px), dense, always visible outside
 * presentation mode. Generation/population are written straight to DOM refs
 * from the bus — this component itself only re-renders on low-frequency
 * store changes (lens, speed, playing, muted, presentation).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { bus } from '@/ui/bus';
import { useAppStore } from '@/ui/store';
import { useUIState } from '@/ui/uiState';
import { getSession } from '@/ui/session';
import { subscribeReadout } from '@/ui/hooks/useSimulationReadout';
import { IconButton, Readout, Toggle, Divider, Tooltip, Legend } from '@/ui/primitives';
import {
  PlayIcon, PauseIcon, StepBackIcon, StepForwardIcon, EyeIcon, ExpandIcon, CompressIcon,
  SpeakerOnIcon, SpeakerOffIcon, QuestionIcon, BranchIcon, ColumnsIcon, SlidersIcon, BookIcon,
  DrawerIcon, ClockIcon, FlaskIcon, SaveIcon, CompassIcon, WaveformIcon, MoreIcon, FilmIcon,
  LogbookIcon,
} from '@/ui/icons';
import { HudMoreSheet } from './HudMoreSheet';
// The guided tour lives in `@/ui/tutorial/**` (a separate agent's territory) —
// this HUD only needs its "About" affordance, which doubles as the tour's
// replay entry point (see `AboutDialog`'s own "Take the guided tour" button).
// Logged in INTEGRATION-NOTES.md.
import { useTourStore } from '@/ui/tutorial/tourStore';
// The achievements logbook: originally a self-mounted floating tab (a
// concurrent mobile-layout pass owned this file at the time — see
// INTEGRATION-NOTES.md), relocated here now that ownership boundaries are
// gone. `initAchievements()` wires the bus listeners that earn entries
// (idempotent); `AchievementsPanel` is the dialog itself, controlled by
// `useUIState.logbookOpen` so the HUD button and the 'l' shortcut agree.
import { initAchievements } from '@/ui/achievements';
import type { RenderLens } from '@/core/types';
// Legend content for every lens (including the 5 colour lenses) now lives with
// the render agent's colour math, keyed by the same `RenderLens` ids — see
// `src/render/color.ts`'s doc and INTEGRATION-NOTES.md "colourful lenses".
// Recomputed per the live `paletteMode` (see `SettingsPanel`'s CVD toggle) so
// the quadlife/immigration swatches shown here always match what's actually
// on screen.
import { buildLensLegends, safeLensLegend } from '@/render/color';

const SPEED_PRESETS = [1, 4, 12, 30, 60];

/** How often the throttled live region (below) may announce gen/population
 *  changes to a screen reader. `gen:changed` can fire up to 60x/sec — an
 *  `aria-live` region re-announcing at that rate would be unusable, talking
 *  over itself constantly instead of reading as an occasional status update. */
const LIVE_REGION_THROTTLE_MS = 4000;

export function Hud() {
  const genRef = useRef<HTMLSpanElement>(null);
  const popRef = useRef<HTMLSpanElement>(null);
  const liveRegionRef = useRef<HTMLDivElement>(null);

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
  const setMoreOpen = useUIState((s) => s.setMoreOpen);
  const setAboutOpen = useTourStore((s) => s.setAboutOpen);
  const logbookOpen = useUIState((s) => s.logbookOpen);
  const setLogbookOpen = useUIState((s) => s.setLogbookOpen);
  const paletteMode = useUIState((s) => s.paletteMode);
  const lensLegend = useMemo(() => buildLensLegends(paletteMode), [paletteMode]);

  useEffect(() => { initAchievements(); }, []);

  useEffect(() => subscribeReadout((r) => {
    if (genRef.current) genRef.current.textContent = String(r.gen);
    if (popRef.current) popRef.current.textContent = String(r.population);
  }), []);

  // A polite, THROTTLED live region — a screen-reader-only companion to the
  // visual gen/pop readouts above, which are plain DOM-ref writes with no
  // `aria-live` of their own and so are otherwise silent to assistive tech
  // until explicitly navigated to. Values are sampled on every `gen:changed`
  // (cheap — a ref write, no render) but only pushed into the live region,
  // and only when they actually changed, on a slow timer: announcing at
  // simulation speed (up to 60/sec) would be unusable noise, not a status
  // update. Runs regardless of the "pop" readout's own responsive visibility
  // (see below) — the announcement doesn't depend on what's on screen.
  useEffect(() => {
    let sample = { gen: 0, population: 0 };
    const unsubscribe = subscribeReadout((r) => { sample = r; });
    let announced = { gen: -1, population: -1 };
    const announce = () => {
      if (sample.gen === announced.gen && sample.population === announced.population) return;
      announced = sample;
      if (liveRegionRef.current) {
        liveRegionRef.current.textContent =
          `Generation ${sample.gen.toLocaleString()}. Population ${sample.population.toLocaleString()} living cells.`;
      }
    };
    const id = window.setInterval(announce, LIVE_REGION_THROTTLE_MS);
    return () => { unsubscribe(); window.clearInterval(id); };
  }, []);

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

  // Screen-reader-only, throttled (see the effect above) — present in every
  // branch below, including presentation mode, since that's when the visual
  // readouts are at their sparsest.
  const liveRegion = (
    <div ref={liveRegionRef} className="sr-only" role="status" aria-live="polite" aria-atomic="true" />
  );

  if (presentation) {
    return (
      <div className="flex h-full items-center justify-between px-4">
        {liveRegion}
        {/* The app's one, persistent `<h1>` — always in the DOM (both HUD
            variants), unlike `TitlePlate`'s big display heading, which is a
            transient restatement demoted to a `<p>` for exactly this reason:
            a heading that vanishes/hides after the title fades would leave
            the page with no level-one heading at all. */}
        <h1 className="display-face-tight text-sm text-ivory-100">AFTERLIFE</h1>
        <div className="flex items-center gap-3">
          <Readout label="gen" value={<span ref={genRef}>0</span>} digits={6} />
          <IconButton label="Exit presentation" icon={<CompressIcon />} onClick={() => { setPresentation(false); bus.emit('presentation:toggle', { on: false }); }} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full items-center gap-1.5 overflow-x-auto px-2 pt-[env(safe-area-inset-top)] sm:gap-3 sm:px-3">
      {liveRegion}
      {/* Visually hidden (but still in the a11y tree — the app's one
          persistent h1, see the module doc) below 400px: on the narrowest
          phones this wordmark alone was ~110px, the single biggest line
          item standing between a 390px viewport and the "More controls"
          button fitting on screen at all. Screen-reader users are unaffected
          either way; sighted phone users still get it back at 400px+, and
          desktop is untouched. */}
      <h1 className="display-face-tight sr-only shrink-0 text-sm text-ivory-100 min-[400px]:not-sr-only">AFTERLIFE</h1>
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
        {/* Step back/forward hidden below `sm`: precise single-generation
            stepping is a power-user affordance already covered on a phone by
            the timeline ribbon's own drag/keyboard scrubbing (see
            `Timeline.tsx`), and at 390px these two buttons were the
            difference between the "More controls" button fitting on screen
            and not. Nothing is lost above `sm` (640px), where there's room. */}
        <div className="hidden shrink-0 items-center gap-1 sm:flex">
          <Tooltip content="Step back one generation">
            <IconButton label="Step back" icon={<StepBackIcon />} disabled={playing} onClick={() => step(-1)} />
          </Tooltip>
          <Tooltip content="Step forward one generation">
            <IconButton label="Step forward" icon={<StepForwardIcon />} disabled={playing} onClick={() => step(1)} />
          </Tooltip>
        </div>
        {/* Hidden below `sm`: on a 390px phone this badge was the single
            widest item ahead of the gen/pop readouts, and pushed itself
            (and everything after it) past the viewport edge with no visible
            scroll affordance — the "PAUSED"/"RUNNING" text read as clipped
            mid-word. The play/pause STATE itself stays fully legible without
            colour on mobile too: the IconButton above already swaps icon
            shape (▶/❚❚) and its own `pressed` treatment (solid fill +
            stronger border), so nothing is lost, just the redundant label. */}
        <span
          className="ml-1 hidden rounded-xs px-1.5 py-0.5 text-micro uppercase tracking-[0.18em] sm:inline"
          style={{ color: playing ? 'var(--color-accent-life)' : 'var(--color-ivory-300)' }}
        >
          {playing ? '● running' : '❚❚ paused'}
        </span>
        {!everToggled && (
          <span className="hidden text-micro italic text-ivory-300 sm:inline">— pause time anytime</span>
        )}
      </div>

      <Divider orientation="vertical" className="h-6" />
      <Readout label="gen" value={<span ref={genRef} data-testid="hud-gen">0</span>} digits={6} />
      {/* Hidden below `sm`: with the play-state badge already gone (see
          above), "pop" was still the next-widest item forcing the row past a
          390px viewport — its own text got clipped at the edge. Population
          isn't lost to screen-reader users on a phone either: the throttled
          live region below announces gen AND population regardless of which
          HUD readouts are visually present. A wrapper (not a `className` on
          `Readout` itself) toggles `display`, so it never fights the
          component's own hardcoded `flex` utility. */}
      <div className="hidden sm:block">
        <Readout label="pop" value={<span ref={popRef} data-testid="hud-pop">0</span>} digits={6} accent="life" />
      </div>

      {/* Speed AND lens both move to the mobile HUD's "More" sheet
          (`HudMoreSheet`) below `lg` — see that file's doc comment for why:
          this row simply has no room for either below roughly 1024px, and
          the old `md:flex`/`lg:flex` split still overflowed at in-between
          widths (a small tablet got speed but not lens, and BOTH still
          overflowed the row before either kicked in — see
          INTEGRATION-NOTES.md). One breakpoint, one home for each control. */}
      <Divider orientation="vertical" className="hidden h-6 lg:block" />
      <div className="hidden shrink-0 items-center gap-2 lg:flex">
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
        {/* The legend moved from an always-inline `<Legend>` block to this
            hover/focus tooltip: with 8 lenses (up from 3), rendering every
            lens's full legend inline pushed the HUD row's real content well
            past a 1440px viewport with no visible scroll affordance — the
            exact "control exists but isn't reachable" class of bug the
            mobile agent already found and fixed for narrow widths (see
            INTEGRATION-NOTES.md), recurring on ordinary desktop widths once
            the lens set grew. Nothing about what a colour MEANS is lost —
            it's a hover/focus away, and `HudMoreSheet.tsx`'s mobile/tablet
            copy still shows it inline (that sheet has vertical room to
            spare). */}
        <Tooltip content={<Legend items={safeLensLegend(lensLegend, lens)} />} side="bottom">
          <IconButton label={`Lens legend (${lens})`} icon={<EyeIcon />} />
        </Tooltip>
        {/* Growing from 3 to 8 lenses made the Toggle itself ~400px wider —
            enough on its own to push the icon row (mute/presentation/
            cinematic/about/logbook/shortcuts) off a 1440px viewport with no
            visible affordance (confirmed: e2e/mobile.spec.ts's HUD-overflow
            assertion, meant for 390px, caught this same overflow when it
            accidentally also ran at 1440px under the `desktop` project — see
            INTEGRATION-NOTES.md). Capping this wrapper's own width and
            letting IT scroll internally (rather than letting the whole HUD
            row overflow) keeps every other control's position stable and
            confines "there's more here" to one small, visibly-clipped
            control — a real scroll cue, not a silent one. All 8 options stay
            one Tab/click away either way; nothing becomes unreachable. */}
        <div className="max-w-[210px] overflow-x-auto">
          <Toggle
            aria-label="Render lens"
            options={[
              { value: 'life', label: 'Life' },
              { value: 'age', label: 'Age' },
              { value: 'activity', label: 'Activity' },
              { value: 'lineage', label: 'Lineage' },
              { value: 'immigration', label: 'Immigration' },
              { value: 'quadlife', label: 'QuadLife' },
              { value: 'velocity', label: 'Velocity' },
              { value: 'neighbors', label: 'Neighbors' },
            ]}
            value={lens}
            onChange={(v) => { const l = v as RenderLens; setLens(l); bus.emit('lens:changed', { lens: l }); }}
          />
        </div>
      </div>

      <div className="flex-1" />

      {/* Mobile/tablet (<lg): a single "More" button opens `HudMoreSheet`
          with lens, speed, the Time Sculpture entry, every right-panel tab,
          mute, presentation mode, and about/shortcuts — the full desktop
          icon row below never renders at these widths (it measured ~993px
          of unhidden content against a 390px viewport before this fix,
          which meant everything from Time Sculpture onward was reachable
          only by discovering an unlabelled horizontal scroll on the HUD
          strip; lens and speed were flatly unreachable, hidden by
          `lg:flex`/`md:flex` with no substitute anywhere). */}
      <div className="lg:hidden">
        <Tooltip content="More controls">
          <IconButton label="More controls" icon={<MoreIcon />} pressed={false} onClick={() => setMoreOpen(true)} />
        </Tooltip>
      </div>

      <div className="hidden shrink-0 items-center gap-1 lg:flex">
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
        <Tooltip content="Experiments">
          <IconButton label="Experiments" icon={<FlaskIcon />} pressed={rightPanel === 'experiments'} onClick={() => toggleRightPanel('experiments')} />
        </Tooltip>
        <Tooltip content="Save & export">
          <IconButton label="Save & export" icon={<SaveIcon />} pressed={rightPanel === 'save'} onClick={() => toggleRightPanel('save')} />
        </Tooltip>
        <Tooltip content="Instrument">
          <IconButton label="Instrument" icon={<WaveformIcon />} pressed={rightPanel === 'audio'} onClick={() => toggleRightPanel('audio')} />
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
        {/* Per INTEGRATION-NOTES.md's `cinematic` entry: the feature was
            fully built (auto-pan, interest scoring, its own DOM-root
            overlay) but only reachable via the 'C' keyboard shortcut —
            undiscoverable without this button. `Session.cinematic` is the
            cinematic agent's own public API; no other file of theirs is
            touched here. */}
        <Tooltip content="Cinematic mode — full-screen, auto-pan, hands-off">
          <IconButton
            label="Cinematic mode"
            icon={<FilmIcon />}
            onClick={() => getSession()?.cinematic.enter()}
          />
        </Tooltip>
        <Tooltip content="What is this?">
          <IconButton label="About AFTERLIFE" icon={<CompassIcon />} onClick={() => setAboutOpen(true)} />
        </Tooltip>
        <Tooltip content="Logbook — a naturalist's record of what you've witnessed (l)">
          <IconButton label="Logbook" icon={<LogbookIcon />} pressed={logbookOpen} onClick={() => setLogbookOpen(true)} />
        </Tooltip>
        <Tooltip content="Keyboard shortcuts (?)">
          <IconButton label="Keyboard shortcuts" icon={<QuestionIcon />} onClick={() => setShortcutsOpen(true)} />
        </Tooltip>
      </div>
      <HudMoreSheet />
    </div>
  );
}
