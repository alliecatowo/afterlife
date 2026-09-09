# AFTERLIFE — Architecture

*A playable observatory for tiny universes. Every future leaves a trace.*

AFTERLIFE was originally built by seven agents working the tree in parallel, coordinated
only by a file-ownership table and the shared contracts in `src/core/types.ts`, then
merged by a single integration pass. The app is finished; this document now describes
the architecture that resulted, for anyone extending or auditing it.

---

## 1. Stack

| Concern | Choice |
| --- | --- |
| Build | Vite 8 + `@vitejs/plugin-react` |
| Language | TypeScript 5.9, `strict`, ES2022, `moduleResolution: bundler`, alias `@/*` → `src/*` |
| UI | React 19 |
| Styling | Tailwind CSS v4, CSS-first config. Our tokens are the design language; the default palette is not used |
| Accessible behaviour | Radix UI primitives, **unstyled**, painted with our tokens. **No shadcn/ui.** |
| App state | Zustand (`src/ui/store.ts`) |
| High-frequency signals | Typed event bus (`src/ui/bus.ts`) |
| 3D | `@react-three/fiber` + `@react-three/drei` (three.js underneath) |
| Motion | `motion`, always gated on `prefers-reduced-motion` |
| Type | Self-hosted `@fontsource-variable/{fraunces,inter,jetbrains-mono}` — no runtime network |
| Test | Vitest (jsdom) + Playwright (chromium) for browser verification |
| Toolchain | mise pins Node 22. Run everything as `mise exec -- npm …` |

---

## 2. **THE PERFORMANCE RULE: React never re-renders per generation**

The simulation runs on a fixed-timestep imperative loop (`src/core/loop.ts`) that steps the
engine and paints straight to a 2D canvas. **React owns only the chrome** — panels,
timeline UI, drawer, dialogs. It must not re-render when the generation advances.

Three sanctioned bridges, in order of preference:

1. **Event bus → DOM refs.** Subscribe to `gen:changed` and write `el.textContent`
   directly. Zero renders. Use this for counters, coordinates, FPS.
2. **`useSimulationReadout()`** (`src/ui/hooks/useSimulationReadout.ts`) — a
   `useSyncExternalStore` view coalesced to **≤ 10 Hz**. Use only when React genuinely must
   render the value (e.g. it drives conditional layout).
3. **Zustand** (`src/ui/store.ts`) — low-frequency app state only: mode, lens, tool,
   selection rect, branch list, playback flags, panel visibility. Written at most a few
   times per second, in response to user action.

> **Any agent that calls `setState` (React or Zustand) inside the simulation loop, a
> pointer-move handler, or a per-generation bus handler has introduced a bug.**
> Accumulate and commit at a boundary instead.

R3F follows the same discipline: the sculpture animates inside `useFrame`, mutating
object3D transforms and instanced matrices. It does not `setState` per frame.

---

## 3. Who owns what, today

The app was originally built by seven agents working the tree in parallel behind a
file-ownership table, then merged by a single integration pass (see
`INTEGRATION-NOTES.md` for that handoff's resolved gaps — it's a historical record now,
not an open queue). That phase is finished. There is no ownership boundary left to
respect; anyone touching this tree today has full write access to all of it. What's
below is a map of the current module boundaries and who originally wrote each one, kept
because it's still useful context for a module's internal conventions.

| Module | Path | Originally built by | Purpose |
| --- | --- | --- | --- |
| Core | `src/core/**` | core | Engine, history/branching, RNG, the Life-like rule model (`rule.ts` — any B/S rulestring, an 18-entry lookup table, Conway's own fast path kept and dispatched to via `LifeRule.isConway`), the fixed-timestep loop. Pure TS — no DOM, no React. |
| Render | `src/render/**` | render | Canvas2D world renderer, camera math, lens coloring (`color.ts` — all 8 `ColorLens` palettes, ramps, CSS-colour resolution, and `relativeLuminance()` for theme-aware ramp lightness), plus Acid Art: `glyphs.ts`/`glyphAtlas.ts` (glyph vocabulary + the cached offscreen raster atlas), `field.ts`/`mediaField.ts` (the modulation field — procedural sources and real image/video/webcam capture), `lfo.ts` (deterministic, replay-safe automation), `artConfig.ts`/`artStore.ts` (the whole Art mode config, persisted, sanitised against corrupt input). |
| Interact | `src/interact/**` | render | Pointer/keyboard input → bus intents; global shortcut guard (dialogs/typing-targets suppress app shortcuts). |
| UI shell | `src/ui/*.tsx`, `src/ui/*.ts` | ui | `App.tsx` (shell + DOM anchors), `bus.ts`, `store.ts`, `session.ts` (owns scene loading, undo, discoveries, experiments, persistence wiring, and initializing cinematic mode), `uiState.ts`, `discoveries.ts`, `experiments.ts`. |
| UI subtrees | `src/ui/{hud,drawer,panels,timeline,dialogs,hooks,primitives}/**` | ui | HUD (incl. `HudMoreSheet`, the sub-`lg` bottom sheet for lens/speed controls), drawer, right-hand panels (Branches/Compare/Experiments/FieldGuide/Persist/Settings/Audio), the timeline ribbon, the shortcuts dialog, `useSimulationReadout`/`useReducedMotion`, and the unstyled-Radix design-system primitives. |
| Tutorial | `src/ui/tutorial/**` | tutorial | The first-run guided tour: `tourStore.ts` (state, persisted "seen" flag), `TourOverlay.tsx` + `CoachMark.tsx` (the spotlight — dims the UI, cuts a live hole over the real target, tracks world coordinates through the camera for world-anchored steps), `targeting.ts` (resolves a step's target to a screen rect from public DOM ids/accessible names only), `behaviors.ts` (per-step real completion detection + "show me"), `layout.ts`, `AboutDialog.tsx` ("What is this?"). |
| Achievements | `src/ui/achievements/**` | achievements | The logbook: `store.ts` (a zustand store wired to real `@/ui/bus` events and session state — never a timer standing in for "the user did it"; persisted like `tourStore`), `AchievementsPanel.tsx` (naturalist's-log UI, reachable from a HUD icon button and `L`). Content (the 14 `AchievementDef`s) lives in `@/content/achievements`. |
| Cinematic | `src/ui/cinematic/**` | cinematic | Auto-pan presentation mode (`C`): `director.ts` (hold/pull-back/aftermath state machine, drives the existing `CameraController`), `interest.ts` + `worldSample.ts` (real activity/density/traveller scoring — no invented data), `framing.ts`, `fullscreen.ts`, `store.ts`, `CinematicOverlay.tsx`, `index.ts` (public entry, wires the `c` shortcut and hand-back-control on any real input). |
| Sculpture | `src/sculpture/**` | sculpture | The R3F Time Sculpture: scene, camera rig, instance geometry/budgeting, WebGL-support detection, PNG export, 2D fallback. Mounts into `#sculpture-canvas`, lazy-loaded as its own bundle chunk. |
| Content | `src/content/**` | content | Curated scenes (`scenes.ts`), the 24-specimen corpus (`specimens.ts`), pattern recognition (`recognition.ts`), the three authored experiments (`experiments.ts`), the Field Guide's discovery model (`discoveries.ts`), the RLE pattern library (`patterns.ts`), the tour's step content (`tour.ts`), the 14-entry achievement definitions (`achievements.ts`). Import the `@/content` barrel unless you're already inside the module. |
| Audio | `src/audio/**` | audio | WebAudio soundscape. `audio.ts` is the only impure/stateful file (owns the `AudioContext`, gesture-gated); `brain.ts`/`mapper.ts`/`scheduler.ts`/`scale.ts`/`synth.ts`/`events.ts`/`context.ts`/`harmony.ts`/`reactivity.ts` are pure and independently tested. `settings.ts`/`settingsStore.ts` hold the tweakable instrument (timbres, presets, harmonic movement, percussion); `midi.ts`/`midiStore.ts` are the Web MIDI output bridge; `capture.ts`/`captureStore.ts` are the impure system/mic capture plumbing that calls into pure `reactivity.ts`. |
| Persist | `src/persist/**` | persist | `store.ts` is the public entry point (localStorage, import/export, versioned doc format); `codec.ts`, `localStorage.ts`, `rle.ts` are internals — reach into them only from inside this module. |
| Theme | `src/ui/theme/**` | color (theming) | `themes.ts` (5 built-in `ThemeDefinition`s — `observatory` is byte-identical to `tokens.css`), `tokens.ts` (the 21-token `ThemeTokens` shape), `apply.ts` (writes tokens onto `documentElement` at runtime, no rebuild), `validate.ts` (missing-token/bad-colour/accent-collision/contrast checks), `custom.ts` (user-built themes), `store.ts`/`persistence.ts`. Does not touch `src/styles/**` — themes are pure runtime overrides layered on top. |
| Net | `src/net/**` | multiplayer | Pure protocol/room/transport logic for opt-in lockstep multiplayer — no DOM, no React, no dependency on `@/core/**`. See §12. Paired UI in `src/ui/multiplayer/**` (`ui`-adjacent). Never imported eagerly — see §15. |
| Export | `src/export/**` | media-export | Offline deterministic WebM/GIF/PNG-sequence/audio export — an independent replay, never the live engine/history/camera. See §13. |
| Styles | `src/styles/**` | ui | `tokens.css` (the `@theme` design tokens), `base.css`, `motion.css`. |
| Site | `site/**` | site | The static guide/wiki, generated at build time — see §16. Not part of the `src/` app; served as its own static tree under `/guide/**`. |

Still true and worth keeping:
- Cross-module communication is `bus` (high-frequency, per-generation signals) or
  `useAppStore`/`useUIState` (low-frequency app/UI state).
- Import a module's public entry file (`@/core/engine`, `@/render/renderer`,
  `@/content` barrel, `@/persist/store`, …) rather than reaching into its internals, unless
  you're already inside that module.
- Keep `npm run typecheck`, `npm test` and `npm run build` green at every commit.

---

## 4. Module map

```
src/
  core/       types.ts (shared vocabulary, incl. RenderLens's 8 lens ids) · engine.ts
              · history.ts (branching TimelineStore) · lineage.ts (colour-genetics: circular-
              mean hue inheritance, Immigration/QuadLife species birth rule — pure, never
              read by the B3/S23 step decision) · rule.ts (any B/S Life-like rule; an 18-entry
              lookup table; Conway's own hand-unrolled fast path, dispatched to via
              `LifeRule.isConway`) · rng.ts · loop.ts (fixed-timestep driver)
  render/     renderer.ts (Canvas2D) · camera.ts · color.ts (all `ColorLens` palettes/ramps,
              CSS-colour resolution via a 1x1 canvas round-trip, the CVD Okabe-Ito palette,
              `relativeLuminance()`) — plus Acid Art: glyphs.ts (glyph vocabulary + driver→
              character selection) · glyphAtlas.ts (the cached offscreen glyph raster —
              rasterised once per character set/device-px bucket, never per cell per frame)
              · field.ts (pure modulation-field sampling: value-noise/radial/linear/plasma)
              · mediaField.ts (impure image/video/webcam capture, explicit-gesture-gated)
              · lfo.ts (sine/triangle/saw/random-walk, each a pure function of absolute time
              — deterministic and replay-safe by construction) · artConfig.ts (the whole Art
              mode config, sanitised against corrupt/hand-edited input) · artStore.ts
              (persisted zustand store) · artMount.ts/ArtTrigger.tsx (self-mounted
              reachability, superseded by the HUD's own "Acid Art" entry but left in place)
  interact/   input.ts (pointer/keyboard/touch → bus intents) · globalShortcutGuard.ts
  ui/         App.tsx (shell + DOM anchors) · bus.ts · store.ts (default `lens: 'lineage'`) ·
              session.ts (live Session, also exposed as window.__AFTERLIFE__ in dev; wires
              cinematic mode, `setRule()`, the 3 optional multiplayer hooks) · uiState.ts
              · discoveries.ts · experiments.ts · icons.tsx · TitlePlate.tsx · WorldHint.tsx
              · WorldStateOverlay.tsx · SceneAnnotation.tsx
    hud/          Hud.tsx (top status/transport bar, the 8-lens legend, the rule readout,
                  `MoreToolsMenu` — Rules/Appearance/Acid Art/Cinematic/Multiplayer) ·
                  HudMoreSheet.tsx (sub-`lg` bottom sheet exposing lens/speed/every panel
                  otherwise `display:none`) · multiplayerLazy.tsx (the one sanctioned lazy-
                  import seam for `@/net`/`@/ui/multiplayer` — see §15)
    drawer/       Drawer.tsx (#drawer-left: tools, patterns, lenses)
    panels/       PanelRight.tsx + BranchesPanel/ComparePanel/ExperimentsPanel/
                  FieldGuidePanel/PersistPanel/SettingsPanel/AudioPanel/RulesPanel/
                  ThemePanel/ArtPanel/ExportPanel (#panel-right)
    theme/        themes.ts (5 built-in themes) · tokens.ts · apply.ts · validate.ts
                  (OKLab accent-distance + WCAG contrast checks) · custom.ts · store.ts ·
                  persistence.ts — see §14
    multiplayer/  index.tsx (`MultiplayerRoot`, mounted via `hud/multiplayerLazy.tsx`) ·
                  MultiplayerPanel.tsx · PeerGlyph.tsx · PeopleIcon.tsx · colors.ts · store.ts
    timeline/     Timeline.tsx (#timeline) · ribbon.ts · historyRing.ts
    dialogs/      ShortcutsDialog.tsx
    tutorial/     tourStore.ts · TourOverlay.tsx · CoachMark.tsx (world-anchored spotlight)
                  · targeting.ts · behaviors.ts (real completion + "show me") · layout.ts
                  · AboutDialog.tsx
    achievements/ store.ts (bus-wired logbook state) · AchievementsPanel.tsx · index.ts
    cinematic/    director.ts (hold/pull-back/aftermath state machine) · interest.ts
                  · worldSample.ts · framing.ts · fullscreen.ts · store.ts
                  · CinematicOverlay.tsx · index.ts (public entry, the `c` shortcut)
    hooks/        useSimulationReadout.ts (≤10Hz useSyncExternalStore bridge) · useReducedMotion.ts
    primitives/   Button, IconButton, Toggle, Slider, Panel, Field, Tooltip, Readout,
                  Legend, Divider, Toast, Dialog — unstyled Radix, painted with tokens
  sculpture/  SculptureApp.tsx (mounts into #sculpture-canvas, lazy chunk) · SculptureScene.tsx
              · geometry.ts · mapping.ts · budget.ts (instance-count reduction) · export.ts
              (PNG export) · webgl.ts (support detection) · tokens.ts · Fallback2D.tsx
              · SculptureLoading.tsx
  content/    scenes.ts (4 curated scenes) · specimens.ts (24-entry corpus) · recognition.ts
              (scan/classify) · experiments.ts (3 authored challenges) · discoveries.ts
              · patterns.ts (RLE library) · tour.ts (guided-tour step content) ·
              achievements.ts (14 AchievementDefs) · MiniaturePreview.tsx · index.ts (barrel)
  audio/      audio.ts (stateful entry point) · brain.ts · mapper.ts · scheduler.ts · scale.ts
              · synth.ts (9 Timbre waveforms: mallet/glass/pad/accent + pluck/bell/bow/breath/
              perc) · events.ts · context.ts · harmony.ts (dual-EMA population tracker driving
              slow harmonic drift, ≤1 change/60s) · settings.ts/settingsStore.ts (4 presets:
              observatory/glass/deep/chime) · midi.ts/midiStore.ts (Web MIDI output, guaranteed
              note-offs, panic) · reactivity.ts (pure feature extraction) · capture.ts/
              captureStore.ts (impure getDisplayMedia/getUserMedia plumbing — only ever
              touches presentation/tempo, never `@/core`) — all pure except audio.ts/capture.ts
  net/        protocol.ts (pure: RoomSpec, StampedEdit, EditLog, StallTracker, DesyncMonitor,
              FNV-1a hashBits) · room.ts (LockstepRoom — wires a Transport to protocol.ts) ·
              transport.ts (BroadcastChannelTransport, real today; WebSocketTransport, ready
              for an optional relay) · sessionBridge.ts (the only file connecting a room to a
              real Session) · index.ts — see §12. No DOM, no `@/core` dependency; UI lives in
              `ui/multiplayer/**` above.
  export/     index.ts · replay.ts (independent-engine deterministic replay) ·
              worldFrameSource.ts/hiddenCanvas.ts/frameFit.ts (a second WorldRenderer on a
              real, sized, visibility:hidden canvas) · webmRecorder.ts (MediaRecorder +
              captureStream, optional real audio muxing) · gifExport.ts/gif/ (gifWriter.ts ·
              lzw.ts · quantize.ts — hand-written animated-GIF encoder) · audio/ (plan.ts ·
              offlineRender.ts — deterministic offline `OfflineAudioContext` render) ·
              wav.ts (PCM WAV encode of the offline render) ·
              pngZipExport.ts/zip.ts/crc32.ts (hand-written STORED-entry zip) · limits.ts ·
              estimate.ts · presets.ts · pacing.ts · filename.ts/annotate.ts · errors.ts ·
              types.ts — see §13.
  persist/    store.ts (public entry point) · codec.ts · localStorage.ts · rle.ts
  styles/     tokens.css (@theme design tokens) · base.css · motion.css
site/
  scripts/    build-pages.mjs (prebuild step) · content.mjs (layout/nav shared by every page)
              · page-landing.mjs · page-wiki-*.mjs (8 wiki pages) · postbuild-flatten.mjs
              · generate-og.mjs
  shared/     main.ts · site.css · glider.ts/glider-mount.ts (the landing page's live diagram)
  guide/      generated static HTML output (checked in; regenerated by `npm run build`)
```

### DOM anchors provided by `src/ui/App.tsx`

`#world-canvas` · `#sculpture-canvas` · `#hud-top` · `#timeline` · `#drawer-left` ·
`#panel-right` · `#toast-layer` · `#compare-canvas`. These ids are a contract; the UI agent
may restyle the shell but must keep every id.

---

## 5. The boundary model: toroidal, and why

`WorldSpec.boundary` is `'torus'` and only `'torus'`. Every neighbour lookup wraps with a
floor-mod on both axes.

Rationale:
1. **No special cases.** Every cell has exactly 8 neighbours, so the step kernel is one
   uniform loop — no edge branches to get subtly wrong, and B3/S23 is exact everywhere.
2. **Conservation of interest.** A finite dead-edge grid quietly deletes gliders that reach
   the border, which silently destroys the long-running histories the Time Sculpture exists
   to display. On a torus a glider returns, and returning gliders are the good part.
3. **Bounded, comparable state.** Fixed `width * height` means a snapshot is a fixed-size
   `Uint8Array`, keyframes are cheap and uniform, and two branches are diffable
   cell-for-cell without alignment logic.
4. **Honest determinism.** No hidden infinite plane, no allocation on expansion; the same
   seed always yields the same universe.

Consequence for agents: **any (x, y) integer is legal**. Do not clamp; wrap. Use
`wrap(v, n)` from `@/core/engine`. Rects passed to `region()`/`forEachLive()` may straddle
the seam and must be handled by wrapping reads.

---

## 6. History: keyframes, replay, and the window limit

`TimelineStore` does **not** store a snapshot per generation. It stores:

- a **keyframe** `Snapshot` every `KEYFRAME_INTERVAL = 64` generations, and
- the sparse `EditOp`s recorded at each generation.

`goto(g)` restores the nearest keyframe at or before `g` and replays steps (re-applying
edits at their generations) forward. Determinism makes this bit-exact. Replay yields to the
event loop and is **cancellable** — a second `goto()` rejects the first with an
`AbortError`.

### The window limit

Only the most recent **`HISTORY_WINDOW = 4096` generations** are retained. Older keyframes
and entries are dropped and `windowStart` advances.

Why 4096: a 512×512 world is 262 kB per keyframe; 4096 gens ÷ 64 = 64 keyframes ≈ **16 MB**,
plus edits. That is the largest budget that keeps a browser tab comfortable while still
covering far more history than the sculpture can show (256 slices).

Consequences:
- The scrubber must clamp to `[windowStart, maxGen]`.
- `goto(g)` and `sliceStack(rect, from, to)` **reject with `HistoryWindowError`** when the
  target predates `windowStart`. UI must catch this and surface a `--accent-warn` toast
  ("that generation has fallen out of the retained window"), never a crash.
- `sliceStack()` returns **real recorded history** via replay. It never re-simulates from a
  fresh seed, because branch edits would be lost.

---

## 7. Edits commit atomically at a generation boundary

An `EditOp` is a batch of absolute cell sets. The rule:

> **Edits recorded for generation `g` are applied at the START of `g`, before the B3/S23
> step that produces `g + 1`. A batch applies entirely or not at all.**

In practice:
- A pointer drag accumulates cells into a single pending `EditOp` in `src/interact/input.ts`.
  Nothing is recorded until pointer-up (or until the loop reaches the next generation
  boundary while playing).
- On commit, the input layer hands the op to the timeline: `history.record(gen, [op])`, then
  emits `edit:committed`. One user gesture = one undoable, replayable unit.
- Because edits are *absolute* (`alive: true|false`, not "toggle"), replay is order-stable
  and idempotent — the reason replay reproduces history exactly.
- Recording at `gen < maxGen` **truncates that branch's future**. To keep both outcomes,
  call `branchFrom(gen, edits)` instead — that is the entire "alternate futures" feature.

---

## 8. Colour state and determinism

`RenderLens` (`src/core/types.ts`) now lists all 8 lenses: `life` / `age` /
`activity` / `lineage` / `immigration` / `quadlife` / `velocity` / `neighbors`.
**`src/ui/store.ts`'s default is `lineage`, not `life`.** `life` is, by design,
a single fixed hue (DESIGN.md: "each colour has ONE fixed meaning"), which
read as a flat monochrome first impression on a zero-configuration visit;
`lineage` is colourful (a newborn's hue is the circular mean of its 3
parents') without being decorative — colour still means something real
(ancestry), and colliding populations visibly interbreed. `life` remains
fully available (number key `1`, the HUD lens menu). `e2e/default-lens.spec.ts`
asserts the opening scene at generation 0 shows several genuinely distinct,
significantly-represented hue buckets under the new default with zero
interaction (measured at 12 in practice; the committed assertion is a robust
≥3 threshold, not an exact count).
`src/render/color.ts` additionally defines `ColorLens` as the same union — a
render-owned superset kept from before `RenderLens` itself was widened; the
two types are equal today, and `ColorLens` is deliberately left in place as
harmless redundancy rather than removed, per that module's own doc comment.

Two colour buffers ride along with the cell bits, both owned by
`engine.ts` and both **strictly cosmetic**:

- `hue` (continuous, 0–360°): a newborn's hue is the **circular mean** of its
  exactly-three parents' hues (`circularMean3` in `src/core/lineage.ts`) —
  birth in B3/S23 only ever happens with exactly 3 live neighbours, so "the
  three parents" is never ambiguous. Survivors keep their hue. Drives the
  `lineage` lens.
- `species` (discrete, 0/1–4): a newborn takes the majority species among its
  three parents, or — if all three are pairwise distinct — the one value in
  {1,2,3,4} not among them (`quadSpeciesFromParents`). `immigration` is a
  coarser 2-bucket view ({1,2}→A, {3,4}→B) of the exact same species buffer
  `quadlife` shows at full resolution: one simulation, two lenses, never two
  code paths to keep in sync.

**The invariant, proven, not just asserted:** neither buffer is ever read by
the B3/S23 step decision. `tests/engine-color.test.ts` seeds colour state,
actively poisons it, and confirms the resulting live/dead bits are
byte-identical to a run with no colour reasoning applied at all — including a
glider's exact shape/period and two identically-seeded engines' full
bitwise-equality after 40 steps.

**Colour is bit-exact across rewind/branch/reload**, exactly like the cell
bits: `history.ts` snapshots `hue`/`species` into each keyframe alongside the
`Uint8Array` of cell state, because unlike `age`, a long-lived survivor's
colour is not self-correcting from a flat post-restore default — it's never
recomputed again until that cell dies and is reborn, so it must live in the
keyframe itself. The real bug this fixed: colour (and, transitively, the
bits computed from replaying it) did not survive a page reload, traced to
replay skipping edits recorded at the generation-0 baseline — fixed by no
longer treating gen 0 as a no-op replay target.

Palettes are resolved through `resolveCssColor()` (`color.ts`), which
round-trips any CSS colour string — `oklch()` in dev, whatever Lightning CSS
downlevels tokens to in production (`lab()`, measured) — through a 1x1
offscreen canvas rather than hand-parsing a single syntax. This is also the
fix for the production white-out bug (§ VERIFICATION-SUMMARY.md): the old
regex-based `parseOklch`-only path silently fell back to hardcoded white the
moment the build pipeline's downlevel target changed syntax. A `PaletteMode`
of `'cvd'` swaps in the Okabe-Ito palette (hardcoded, not derived from
`tokens.css` — the one deliberate exception, since nothing in the existing
palette has been verified colourblind-safe) for the discrete species lenses.

---

## 9. Data conventions (repeat of `types.ts`, because it matters)

- All cell buffers are **row-major `Uint8Array`, 1 byte per cell, `1 = alive`**;
  index of (x, y) in a w-wide buffer is `y * w + x`.
- Diff buffers use `0 = same, 1 = alive only in A, 2 = alive only in B`.
- `Rect` is in world cells, `w`/`h` positive integers; normalise with `normalizeRect`.
- Generations are integers ≥ 0; generation 0 is the seeded initial state.
- Lens meanings are fixed: see §8 for what each of the 8 accents/ramps means.

---

## 10. Verification (run before every push)

```sh
mise exec -- npm run typecheck   # tsc --noEmit
mise exec -- npm test            # vitest run
mise exec -- npm run build       # tsc + vite build
mise exec -- npm run dev         # serves on :5173
mise exec -- npm run e2e         # playwright test — boots the real vite dev server
```

Playwright chromium is installed for browser verification. `playwright.config.ts` defines
three projects: `desktop` (1440x900, runs every spec under `e2e/` except `prod-build.spec.ts`
and the touch/390px-specific `mobile.spec.ts`), `mobile` (390x844, touch-enabled, runs
`screenshots.spec.ts` and `mobile.spec.ts`), and `prod-build` (1440x900, runs only
`prod-build.spec.ts` against a real production build served on its own port — see that
project's own comment in `playwright.config.ts`). Screenshot output goes to `screenshots/`,
which is gitignored — look at them after a run, don't just check the exit code. The dev
server is started automatically (`webServer` in the Playwright config) unless one is already
running on :5173, in which case it's reused.

`src/ui/session.ts` exposes a dev-only `window.__AFTERLIFE__` (the live `Session`) when
`import.meta.env.DEV` is true, dead-code-eliminated from production builds — this is what
lets `e2e/utils.ts` assert on exact engine/history state (population inside a bbox, the real
generation bypassing the throttled HUD readout, `screenToWorld`/`worldToScreen`) rather than
guessing from pixels.

**Actually measured, this pass:** `typecheck` clean; `npm test` — 895 passed, 0 failed,
across 91 files; `npm run build` succeeds. Real, measured chunk sizes from that build
(Vite/rolldown's automatic splitting): a single `app` chunk, 646.9 kB / 204.2 kB gzipped,
plus the small `jsx-runtime` (13.6 kB / 5.3 kB gzipped) and `modulepreload-polyfill`
(0.7 kB / 0.4 kB gzipped) chunks Vite/rolldown always splits out, make up the initial JS
needed to open the app (661 kB / 210 kB gzipped combined). Rolldown no longer splits a
separate `primitives` chunk out of `app` the way it once did — if that reappears, the
combined total is what matters, not the split. The lazily-loaded Time Sculpture chunk is
1.02 MB / 284.9 kB gzipped and the lazily-loaded multiplayer chunk is 21.0 kB / 7.1 kB
gzipped — neither loads until that feature is actually opened, per §15. `npm run e2e` —
126 specs across 27 files (96 desktop + 24 mobile + 6 prod-build); the separate, more
expensive Art-mode performance/resource-safety suite (`e2e/art-perf.spec.ts`, 6 specs) is
excluded from that run via the main config's `testIgnore` and lives under its own
`playwright.art-perf.config.ts` and dev-server port instead (see that config's own doc for
why — a shared workspace where other agents may run the main suite concurrently). Last
full sequential run of the main suite had one known flake, `mobile.spec.ts`'s
heartbeat-journey test (a real, reproducible race between a scrub's chunked replay and a
mid-flight read of `engine.gen` — `session.ts`/`interact`/`history.ts` territory, not a
click-timing flake like the historical `tour.spec.ts` one it replaced as "the one known
flake"). See [`docs/VERIFICATION-SUMMARY.md`](./docs/VERIFICATION-SUMMARY.md) §9 for detail.

---

## 11. Rules: pluggable Life-like rules

`src/core/rule.ts` generalises the engine beyond hardcoded B3/S23 to any outer-totalistic
B/S rule on the 8-cell Moore neighbourhood. A `LifeRule` is a canonical `B<digits>/S<digits>`
string plus an 18-entry `Uint8Array` lookup table (`table[was * 9 + n]` → next state) that
`engine.ts`'s step kernel indexes directly — no per-cell function call, no branch on rule
identity in the hot loop. Conway's own hand-unrolled fast path is kept as a separate branch
in `engine.ts`, dispatched to whenever `LifeRule.isConway` is true, which is why changing the
active rule costs essentially nothing when that rule is Conway's own: measured on a 512×512
board, 200 steps after a 20-step warmup, same harness before/after, **3.2598 ms/step → 3.2856
ms/step (+0.8%, within run-to-run noise)**.

**Deliberately not supported** (`parseRule` names what was found rather than failing
silently): Generations rules (3+ states — this engine is binary alive/dead only, and
`Snapshot` is frozen that way in `types.ts`), non-totalistic "Hensel" notation, and non-Moore
neighbourhoods (Larger-than-Life, von Neumann, hexagonal) — the step kernel is hardwired to
the 8-cell Moore neighbourhood.

`src/content/rules.ts` curates 10 presets (Conway, HighLife, Day & Night, Seeds, Maze,
Mazectric, Replicator, Life without Death, 2×2, Coral), each with a `verified` claim that was
actually run against the real engine and re-checked by `tests/content-rules.test.ts` — a
claim that can't be reproduced there doesn't belong in the file. Diamoeba was tried (four
densities on a 128×128 torus) and dropped after none produced its claimed stable diamond
blobs, rather than shipped unverified.

**Changing the rule is a fresh-world operation, never a mid-history edit.**
`Session.setRule()` (`src/ui/session.ts`) stops playback, sets the new rule, then clears the
engine and resets history — in that order. This isn't a missing feature: a recorded `EditOp`
or a keyframe has no field for "which rule produced this," so replaying old history under a
newly-changed rule would silently reinterpret it under a rule that never actually ran it. A
persisted save records its rule (falling back to Conway if absent, for saves from before this
feature existed) and restores it before replay. `src/persist/rle.ts`'s import path now
simulates whatever supported Life-like rule an `.rle` file's header specifies, and names the
rule family plainly if it asks for one outside the supported set, rather than silently
re-running an unsupported pattern under B3/S23.

## 12. Multiplayer: opt-in deterministic lockstep

`src/net/**` (pure logic, no DOM, no dependency on `@/core/**`) plus `src/ui/multiplayer/**`
(the UI). Full design and rationale in [`docs/MULTIPLAYER.md`](./docs/MULTIPLAYER.md) — this
section is the short version for orientation.

A room is a shared `RoomSpec`: world size, boundary, **the rule string** (so two peers on
different rules refuse to connect — `describeWorldMismatch` — rather than silently computing
different futures from the same edits), a seed, and a start generation. No peer is
authoritative. Every peer runs the identical `LifeEngine.step()`, fed the identical edits at
the identical generations, and therefore computes the identical result — the same determinism
guarantee that already makes `TimelineStore.goto()` bit-exact, distributed across peers
instead of across time on one machine.

- **Edits are never sent as state, only as edits, stamped into the future.** `stampEdit`
  schedules every edit — including the sender's own — `LATENCY_BUFFER_GENS` (12, ≈1s at the
  default 12 gens/sec) generations after the sender's local generation at submit time. This
  symmetry (nobody, not even the author, sees their own edit land "now") is what keeps every
  peer's recorded history identical from the next generation onward.
- **Deterministic ordering.** Two edits landing on the same generation are ordered by
  `(targetGen, peerId, seq)` (`compareStampedEdits`) — every peer computes this independently
  from the same wire data, so no server is needed to agree on a last-write-wins outcome.
- **Stall, never silently diverge.** `StallTracker.safeGen()` is the highest generation no
  known peer can still contest, given every peer's last-reported watermark; `LockstepRoom.
  canAdvanceTo()` gates `session.ts`'s `step()` on it (via the `setMultiplayerGate` hook — the
  only one of three optional, `null`-by-default hooks `session.ts` exposes for this feature).
  A stalled room freezes the world at its last safe generation and resumes automatically the
  instant the slow peer catches up — never a silent skip-ahead.
- **Desync detection.** Every `HASH_INTERVAL_GENS` (64 — the same cadence `history.ts`
  keyframes at) generations, every peer broadcasts an FNV-1a hash of its own world
  (`hashBits`); a mismatch is a loud `'desync'` event with a manual "resync from the
  authoritative log" recovery, never a silent absorb.
- **Transports.** `BroadcastChannelTransport` works today, with no server and no account —
  two same-origin tabs joining the same room code are genuinely connected by the browser's own
  `BroadcastChannel` API, which is what `e2e/multiplayer.spec.ts` drives end to end with two
  real tabs. `WebSocketTransport` is a real client, ready for an optional relay
  (`docs/MULTIPLAYER.md` §10 covers what a compliant relay must — and must not — do); with no
  URL configured it reports `'unavailable'` immediately, never a hanging spinner.

## 13. Export: offline deterministic replay

`src/export/**`. `replay.ts` builds an independent `LifeEngine` via `TimelineStore.
cloneBranchAt` (the same mechanism the compare view already uses) and steps it forward
re-applying real recorded `EditOp`s in the same apply-then-step order `history.ts`'s own
internal replay uses — it never touches the live engine, history, or camera.
`worldFrameSource.ts` drives a second `WorldRenderer` on a real, sized, `visibility:hidden`
canvas (`hiddenCanvas.ts` — a detached or `display:none` canvas reports a zero layout box,
which breaks `WorldRenderer.resize()`), reading whatever lens/theme/Art config is live at
export time. Video/frame outputs: `webmRecorder.ts` (`MediaRecorder` + `canvas.captureStream(0)`
+ manual `track.requestFrame()`, codec-detected, degrading to an honest `ExportUnsupportedError`
rather than a broken file — optionally muxes a real audio track, see below) and
`pngZipExport.ts` (a hand-written STORED-entry `zip.ts`/`crc32.ts` — PNG is already
compressed, so no second compression pass). All are cancellable via `AbortSignal` and
bounded (`limits.ts` stride-samples frame count and caps resolution, always surfacing a
human-readable reduction note rather than silently truncating).

**Shipped, verified against real Chromium decoders (not just this repo's own code):**
animated GIF export (`gifExport.ts`, `gif/` — hand-written LZW/quantizer, decoded back with
the browser's real `ImageDecoder` in `e2e/gif-export.spec.ts`) and audio export (`audio/
offlineRender.ts`'s deterministic `OfflineAudioContext` render, `wav.ts`'s PCM encode, and
`webmRecorder.ts`'s optional real audio-track muxing into the WebM — asserted against a real
`OfflineAudioContext` in `e2e/audio-export.spec.ts`). Exported WebM video is **not** silent
when an audio buffer is supplied. An earlier pass cut both, reasoning that jsdom/Vitest alone
couldn't verify them (no reference GIF decoder, no `OfflineAudioContext`); that reasoning
turned out to be avoidable — Playwright + real Chromium was available the whole time.

**Cut from this feature, deliberately, still not shipped:** a Time Sculpture turntable
export (orbit the existing `TimeSculpture.orbit()` camera, reuse the existing PNG-export
path per frame) was designed but never verified against real WebGL, and is inherently
realtime-paced (each frame needs the live scene to actually repaint) rather than a clean
offline replay like the rest of this feature. See `CONTRIBUTING.md`'s "known rough edges"
for what exists to pick it up.

## 14. Theming

`src/ui/theme/**`. Five shipped `ThemeDefinition`s (`themes.ts`): Observatory (byte-identical
to `src/styles/tokens.css` — applying it is a strict no-op against a page that never touched
theming), Ivory Plate (light), High Contrast, Phosphor, Cyanotype. `apply.ts` writes all 21
`ThemeTokens` as CSS custom properties directly onto `documentElement` at runtime — no
rebuild, and the canvas re-themes itself automatically because `src/render/color.ts` already
resolves accent colours through `getComputedStyle` (`resolveCssColor`'s 1x1-canvas
round-trip, §8's production-bug fix). `src/styles/tokens.css`/`base.css` are never edited by
this system — themes are pure runtime overrides layered on top, which is what keeps
Observatory pixel-identical to the pre-theming app.

`validate.ts` enforces two things on every theme, shipped or custom: every one of the 21
tokens present and a parseable `oklch()`, and every pair of the 8 semantic accents at least
`MIN_ACCENT_DISTANCE` (0.045) apart in OKLab space — calibrated to Observatory's own closest
real pair (age vs. warn, measured at 0.0491), so the bar is "at least as distinguishable as
the shipped default," not an arbitrary number. `custom.ts` lets a user build/export/import
their own theme, validated the same way before it can be saved. **`site/**` does not theme
itself** — scoped, deliberately not built (see `CONTRIBUTING.md`).

## 15. The lazy-import boundary

Two feature areas must cost a solo, offline user nothing — not an extra network fetch, not
extra parse/eval time, not a single byte of their initial bundle:

- **`@/net` / `@/ui/multiplayer`.** `App.tsx`, `Hud.tsx` and `HudMoreSheet.tsx` never
  statically import either. The one sanctioned seam is `src/ui/hud/multiplayerLazy.tsx`:
  `MultiplayerLazyHost` is mounted unconditionally by `App.tsx` and renders nothing until its
  `requestMultiplayer()` — called only from an explicit HUD click — does a real dynamic
  `import('@/ui/multiplayer')`. `tests/net-guard.test.tsx` proves this three independent ways:
  a real import-statement parser finds no static import of `@/net`/`@/ui/multiplayer` in the
  shell or the lazy loader itself; merely importing `@/net` (however it's reached) constructs
  zero `Transport`s; and mounting `MultiplayerLazyHost` exactly as `App.tsx` does renders an
  empty DOM and touches neither module until `requestMultiplayer()` runs.
- **The Time Sculpture** (`src/sculpture/**`) — its own bundle chunk (§10's measured 1.02 MB /
  284.9 kB gzipped), mounted only when a history range is actually lifted into 3D.

Anyone adding another large optional feature should follow the same shape: an
always-mounted, empty-until-asked host component plus a real dynamic `import()` behind an
explicit user action, with a guard test in `net-guard.test.tsx`'s style — a static source
check plus a behavioural "importing it does nothing by itself" check.

## 16. The site build: `site/**`, the multi-page build, and `postbuild`

`site/**` is a second, independent static site — the marketing landing page plus an
8-page wiki (index + 7 topics) — built alongside the app and deployed to the same
GitHub Pages origin under `/afterlife/guide/**`. It is plain data + template-string
HTML rendering (`site/scripts/content.mjs` + `page-*.mjs`), not a framework, and does
not import anything from `src/`.

The build has three stages, wired into `package.json`'s `build`/`postbuild` scripts:

1. **`node site/scripts/build-pages.mjs`** runs *before* `vite build` (as the first
   step of `npm run build`, alongside `tsc --noEmit`). It calls each `page-wiki-*.mjs`
   / `page-landing.mjs` renderer and writes real static HTML files under
   `site/guide/**` — these files are checked into git, not generated-and-discarded,
   so `vite build`'s `rollupOptions.input` (in `vite.config.ts`) can point at real
   paths that exist before Vite ever starts. `WIKI_PAGES` in `content.mjs` is the
   single source of truth for the set of wiki pages, their nav order, and their
   sidebar/pager links — adding a page means adding one entry there plus one
   `page-wiki-*.mjs` renderer, wired into `build-pages.mjs`'s `PAGES` array.
2. **`vite build`** picks up those HTML entry points as a genuine multi-page build
   (the app's own `index.html` is a separate entry) and bundles/hashes each one's
   assets normally. Vite's multi-page output mirrors each entry's *source* path
   under `dist/`, so `site/guide/index.html` lands at `dist/site/guide/index.html`
   — not yet the `/afterlife/guide/` URL the deployed site actually needs.
3. **`node site/scripts/postbuild-flatten.mjs`** (the `postbuild` npm lifecycle
   script, run automatically right after `build`) moves everything under
   `dist/site/guide/**` up to `dist/guide/**`, removes the now-empty `dist/site/`,
   and copies `site/guide/assets/**` (the favicon and OG image — static files no
   import ever references, so Vite's build never touches them) into
   `dist/guide/assets/**`. Without this step the deployed site would 404 at
   `/afterlife/guide/`, since GitHub Pages serves whatever path Vite actually wrote.

Consequence for anyone adding a wiki page: it is not enough to add a new
`page-wiki-*.mjs` file. It must be (a) registered in `content.mjs`'s `WIKI_PAGES`,
and (b) wired into `build-pages.mjs`'s `PAGES` array so it's actually written to
disk — both drive the wiki index cards, sidebar and pager links `e2e/guide.spec.ts`'s
no-404s sweep walks. A page written to disk but missing from `WIKI_PAGES` (or vice
versa) would build without error yet be either unreachable or a broken link; the
sweep only catches the latter, since it starts from real links, not the filesystem.
