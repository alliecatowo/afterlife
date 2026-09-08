/**
 * The top instrument bar. Slim (48px), dense, always visible outside
 * presentation mode. Generation/population are written straight to DOM refs
 * from the bus — this component itself only re-renders on low-frequency
 * store changes (lens, speed, playing, muted, presentation).
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as RadixDropdown from '@radix-ui/react-dropdown-menu';
import { bus } from '@/ui/bus';
import { useAppStore } from '@/ui/store';
import { useUIState } from '@/ui/uiState';
import { getSession } from '@/ui/session';
import { subscribeReadout } from '@/ui/hooks/useSimulationReadout';
import { CONWAY_RULE_STRING } from '@/core/rule';
import { IconButton, Readout, Toggle, Divider, Tooltip, Button, Menu } from '@/ui/primitives';
import type { MenuOption } from '@/ui/primitives';
import {
  PlayIcon, PauseIcon, StepBackIcon, StepForwardIcon, ExpandIcon, CompressIcon,
  SpeakerOnIcon, SpeakerOffIcon, QuestionIcon, BranchIcon, ColumnsIcon, SlidersIcon, BookIcon,
  DrawerIcon, ClockIcon, FlaskIcon, SaveIcon, CompassIcon, WaveformIcon, MoreIcon, FilmIcon,
  LogbookIcon, ChevronIcon, RuleIcon, PaletteIcon, PeopleIcon, AsciiIcon,
} from '@/ui/icons';
import { HudMoreSheet } from './HudMoreSheet';
// Loads `@/net`/`@/ui/multiplayer` only once the user taps the "Multiplayer"
// entry below — see that module's doc and `tests/net-guard.test.ts`. This
// file must never statically import either `@/net` or `@/ui/multiplayer`.
import { requestMultiplayer } from './multiplayerLazy';
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
import { buildLensLegends, safeLensLegend, type LensLegendEntry } from '@/render/color';

const SPEED_PRESETS = [1, 4, 12, 30, 60];

/** Display order + labels for every render lens — same 8 ids `HudMoreSheet.tsx`
 *  lists for its own (already fully visible, vertically-stacked) mobile
 *  copy of this control. */
const LENS_OPTIONS: { value: RenderLens; label: string }[] = [
  { value: 'life', label: 'Life' },
  { value: 'age', label: 'Age' },
  { value: 'activity', label: 'Activity' },
  { value: 'lineage', label: 'Lineage' },
  { value: 'immigration', label: 'Immigration' },
  { value: 'quadlife', label: 'QuadLife' },
  { value: 'velocity', label: 'Velocity' },
  { value: 'neighbors', label: 'Neighbors' },
];

function lensLabel(lens: RenderLens): string {
  return LENS_OPTIONS.find((o) => o.value === lens)?.label ?? lens;
}

/** The fullest available explanation of what a lens's colours mean — the
 *  one `title` sentence if any entry has one, else the swatch labels joined
 *  (still meaningful for e.g. `life`'s single "alive" entry). Used in the
 *  lens `Menu`'s popover, which has real vertical room, unlike the old
 *  single-line HUD strip this replaces. */
function lensDescription(entries: LensLegendEntry[]): string {
  const withTitle = entries.find((e) => e.title);
  if (withTitle?.title) return withTitle.title;
  return entries.map((e) => e.label).join(' · ');
}

/** How often the throttled live region (below) may announce gen/population
 *  changes to a screen reader. `gen:changed` can fire up to 60x/sec — an
 *  `aria-live` region re-announcing at that rate would be unusable, talking
 *  over itself constantly instead of reading as an occasional status update. */
const LIVE_REGION_THROTTLE_MS = 4000;

interface MoreToolsItem {
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  pressed?: boolean;
}

/**
 * The desktop row's own overflow point — the pattern this HUD now leans on
 * for every LOW-frequency action (as opposed to the render-lens `Menu`
 * above, which exists purely because 8 options is too wide for a `Toggle`).
 * `Hud.tsx`'s trailing icon row measures with ZERO spare width at 1440px
 * (see the comments further down this file) and this session added two
 * previously-unreachable features (Rules, Multiplayer) plus a pending third
 * (Appearance, proposed by the `theming` agent) on top of an already-full
 * row. Rather than re-tuning exact breakpoints for today's count — which is
 * exactly how this HUD regressed twice before (once too wide, once too
 * narrow) — new, less-frequently-used entries land HERE by default. A
 * future agent adding another panel/action should extend `MORE_TOOLS`
 * (below, in `Hud()`) rather than claiming another fixed-width icon slot.
 */
function MoreToolsMenu({ items }: { items: MoreToolsItem[] }) {
  return (
    <RadixDropdown.Root>
      <RadixDropdown.Trigger asChild>
        {/* A plain `IconButton` (already a real, ref-forwarding `<button>`),
            NOT wrapped in our `Tooltip` primitive — see the render-lens
            `Menu` trigger's comment above for why that would silently break
            the click (`asChild` clones props onto whatever single element
            `trigger` renders, and `Tooltip` isn't that element). Its own
            `title` attribute (set by `IconButton` itself) is enough of a
            hover hint. */}
        <IconButton label="More tools" icon={<MoreIcon />} />
      </RadixDropdown.Trigger>
      <RadixDropdown.Portal>
        <RadixDropdown.Content
          align="end"
          sideOffset={6}
          aria-label="More tools"
          className={
            'z-[var(--z-overlay)] min-w-56 rounded-sm border border-line bg-surface-raised p-1 ' +
            'shadow-[var(--shadow-float)] focus:outline-none ' +
            'data-[state=open]:animate-[overlay-in_var(--duration-fast)_var(--ease-entrance)] ' +
            'data-[state=closed]:animate-[overlay-out_var(--duration-fast)_var(--ease-exit)]'
          }
        >
          {items.map((item) => (
            <RadixDropdown.Item
              key={item.label}
              onSelect={item.onSelect}
              className={
                'flex cursor-pointer items-center gap-2.5 rounded-sm px-2.5 py-1.5 text-sm text-ivory-200 ' +
                'outline-none transition-colors duration-[var(--duration-instant)] ' +
                'data-[highlighted]:bg-ink-700 data-[highlighted]:text-ivory-100 max-[480px]:min-h-11'
              }
            >
              {item.icon}
              {item.label}
              {item.pressed ? (
                <span className="ml-auto text-micro uppercase tracking-[0.14em] text-ivory-300">open</span>
              ) : null}
            </RadixDropdown.Item>
          ))}
        </RadixDropdown.Content>
      </RadixDropdown.Portal>
    </RadixDropdown.Root>
  );
}

export function Hud() {
  const genRef = useRef<HTMLSpanElement>(null);
  const popRef = useRef<HTMLSpanElement>(null);
  const ruleRef = useRef<HTMLSpanElement>(null);
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
    // `Session.setRule()` (the Rules panel's fresh-world operation) always
    // ends by calling the same `emitGen()` that fires this readout on every
    // ordinary step — see `RulesPanel.tsx`'s doc and INTEGRATION-NOTES.md's
    // "rules" entry — so this stays honest without a dedicated bus event.
    if (ruleRef.current) ruleRef.current.textContent = getSession()?.engine.rule ?? CONWAY_RULE_STRING;
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
        {/* Shown only in the 640-1023px tablet band (`sm:inline`), and
            explicitly hidden again from `lg` (1024px) up (`lg:hidden`), NOT
            left to show all the way to arbitrarily wide desktops: measuring
            the real, un-eyeballed content width of the full `lg` row —
            drawer toggle, transport, gen/pop, speed, the lens control,
            Time Sculpture, every right-panel tab, mute/presentation/
            cinematic/about/logbook/shortcuts — comes to ~1493px, already
            past a 1440px viewport with zero slack. This ~116px decorative,
            self-dismissing (`everToggled`) hint was exactly the difference
            between "Keyboard shortcuts" landing on-screen and landing
            41px past the right edge with no visible affordance — the same
            "control exists but isn't reachable" bug this whole fix targets,
            just caused by a different control than the lens picker. It's a
            pure onboarding nicety with a full keyboard-accessible synonym
            (the Space-to-pause hint already lives in the Play/Pause
            button's own tooltip), so losing it exactly where the dense
            desktop row has no spare width to give is the right trade, not a
            regression — see `e2e/hud-desktop.spec.ts` for the width
            assertion this satisfies. */}
        {!everToggled && (
          <span className="hidden text-micro italic text-ivory-300 sm:inline lg:hidden">— pause time anytime</span>
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

      {/* The active simulation rule (`RulesPanel.tsx`'s own doc — switching
          rules is a fresh-world operation, and every curated scene/specimen
          forces Conway back). `lg`-only, like speed/lens below: at the row's
          already-measured zero-slack width (see further down) this is the
          least essential of the three readouts for a narrower desktop/tablet
          window, and the mobile "More" sheet has no width constraint to
          begin with (it doesn't show this readout at all — a returning user
          on a phone can still see the active rule inside the Rules panel
          itself, which the sheet's "Panels" section reaches). */}
      <div className="hidden shrink-0 lg:block">
        <Readout
          label="rule"
          value={<span ref={ruleRef} data-testid="hud-rule">{CONWAY_RULE_STRING}</span>}
          digits={6}
        />
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
      <div className="hidden shrink-0 lg:flex">
        {/* A `Menu` (Radix DropdownMenu), not a `Toggle` group: at 8 options
            a `Toggle` is ~560px wide with every lens's legend inline —
            wider than fits on a 1440px viewport alongside the rest of the
            HUD (`--size-hud`'s "slim perimeter" rule, DESIGN.md §6). A prior
            attempt capped the `Toggle` at 210px and let it scroll
            internally, which kept Settings/Mute/About/Shortcuts on-screen
            but made 4 of the 8 lenses (Immigration/QuadLife/Velocity/
            Neighbors) reachable only via an undiscoverable horizontal
            scroll — no scrollbar, chevron, or gradient hinted they existed.
            The trigger below occupies exactly ONE control's width
            regardless of how many lenses exist; the popover holds all 8,
            each with its own colour chip and full "what this means" text —
            genuinely keyboard-operable (arrow keys, type-ahead) and
            touch-tappable, not a hover-only tooltip the way the legend used
            to be. See `e2e/hud-desktop.spec.ts` for the regression test:
            every lens option must be independently visible-and-clickable at
            1440x900, and the trailing icon row must stay in-viewport. */}
        <Menu<RenderLens>
          aria-label="Render lens options"
          value={lens}
          onChange={(l) => { setLens(l); bus.emit('lens:changed', { lens: l }); }}
          options={LENS_OPTIONS.map(
            (o): MenuOption<RenderLens> => ({
              value: o.value,
              label: o.label,
              swatch: safeLensLegend(lensLegend, o.value)[0]?.swatch,
              description: lensDescription(safeLensLegend(lensLegend, o.value)),
            }),
          )}
          trigger={
            // A plain `title` (native browser hover hint), NOT our `Tooltip`
            // primitive: `Menu`'s `RadixDropdown.Trigger asChild` clones its
            // click/`aria-*`/ref props onto whatever single element `trigger`
            // renders as — that must land on this real `<button>` (via
            // `Button`'s `forwardRef`) for the popover to open at all.
            // Wrapping it in `Tooltip` first would have those props cloned
            // onto the `Tooltip` component instead (a plain function
            // component that doesn't forward them), silently breaking the
            // click. The Menu's own popover — reachable by keyboard/touch,
            // not hover-only — is the real legend; this is just a bonus
            // glance for a mouse user who pauses over the trigger.
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 pl-2"
              aria-label={`Render lens: ${lensLabel(lens)}. Open to change.`}
              title={lensDescription(safeLensLegend(lensLegend, lens))}
            >
              <span
                aria-hidden="true"
                className="h-2.5 w-2.5 shrink-0 rounded-xs border border-line-strong"
                style={{ background: safeLensLegend(lensLegend, lens)[0]?.swatch }}
              />
              <span className="w-[70px] truncate text-left">{lensLabel(lens)}</span>
              <ChevronIcon direction="down" width={10} height={10} />
            </Button>
          }
        />
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
        <Tooltip content="What is this?">
          <IconButton label="About AFTERLIFE" icon={<CompassIcon />} onClick={() => setAboutOpen(true)} />
        </Tooltip>
        <Tooltip content="Logbook — a naturalist's record of what you've witnessed (l)">
          <IconButton label="Logbook" icon={<LogbookIcon />} pressed={logbookOpen} onClick={() => setLogbookOpen(true)} />
        </Tooltip>
        <Tooltip content="Keyboard shortcuts (?)">
          <IconButton label="Keyboard shortcuts" icon={<QuestionIcon />} onClick={() => setShortcutsOpen(true)} />
        </Tooltip>
        {/* The overflow point (see `MoreToolsMenu`'s own doc above): Rules
            and Multiplayer are new this pass; Cinematic mode moved in from a
            dedicated icon it used to occupy (freeing width for the "rule"
            readout and this trigger itself) — it remains just as reachable,
            still also on the 'c' key per `ShortcutsDialog`. Appearance
            (`ThemePanel`) lives here too rather than claiming its own
            10th icon slot, per the `theming` agent's own proposed diff in
            INTEGRATION-NOTES.md, which flagged the row's zero spare width. */}
        <MoreToolsMenu
          items={[
            {
              label: 'Rules',
              icon: <RuleIcon />,
              pressed: rightPanel === 'rules',
              onSelect: () => toggleRightPanel('rules'),
            },
            {
              label: 'Appearance',
              icon: <PaletteIcon />,
              pressed: rightPanel === 'theme',
              onSelect: () => toggleRightPanel('theme'),
            },
            {
              label: 'Acid Art',
              icon: <AsciiIcon />,
              pressed: rightPanel === 'art',
              onSelect: () => toggleRightPanel('art'),
            },
            {
              label: 'Cinematic mode — full-screen, auto-pan, hands-off',
              icon: <FilmIcon />,
              onSelect: () => getSession()?.cinematic.enter(),
            },
            {
              label: 'Multiplayer — play this world with someone else',
              icon: <PeopleIcon />,
              onSelect: () => requestMultiplayer(),
            },
          ]}
        />
      </div>
      <HudMoreSheet />
    </div>
  );
}
