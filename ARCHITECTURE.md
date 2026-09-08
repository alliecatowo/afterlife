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
| Core | `src/core/**` | core | Engine, history/branching, RNG, the fixed-timestep loop. Pure TS — no DOM, no React. |
| Render | `src/render/**` | render | Canvas2D world renderer, camera math, lens coloring (`color.ts` — all 8 `ColorLens` palettes, ramps, and CSS-colour resolution). |
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
| Styles | `src/styles/**` | ui | `tokens.css` (the `@theme` design tokens), `base.css`, `motion.css`. |
| Site | `site/**` | site | The static guide/wiki, generated at build time — see §10. Not part of the `src/` app; served as its own static tree under `/guide/**`. |

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
              read by the B3/S23 step decision) · rng.ts · loop.ts (fixed-timestep driver)
  render/     renderer.ts (Canvas2D) · camera.ts · color.ts (all `ColorLens` palettes/ramps,
              CSS-colour resolution via a 1x1 canvas round-trip, the CVD Okabe-Ito palette)
  interact/   input.ts (pointer/keyboard/touch → bus intents) · globalShortcutGuard.ts
  ui/         App.tsx (shell + DOM anchors) · bus.ts · store.ts · session.ts (live Session,
              also exposed as window.__AFTERLIFE__ in dev; wires cinematic mode) · uiState.ts
              · discoveries.ts · experiments.ts · icons.tsx · TitlePlate.tsx · WorldHint.tsx
              · WorldStateOverlay.tsx · SceneAnnotation.tsx
    hud/          Hud.tsx (top status/transport bar, the 8-lens legend) · HudMoreSheet.tsx
                  (sub-`lg` bottom sheet exposing lens/speed controls otherwise `display:none`)
    drawer/       Drawer.tsx (#drawer-left: tools, patterns, lenses)
    panels/       PanelRight.tsx + BranchesPanel/ComparePanel/ExperimentsPanel/
                  FieldGuidePanel/PersistPanel/SettingsPanel/AudioPanel (#panel-right)
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

**Actually measured, this pass:** `typecheck` clean; `npm test` — 516 passed, 0 failed,
across 49 files (6.78s); `npm run build` succeeds and produces (real, measured sizes) an
app chunk of 533 kB / 169 kB gzipped and a lazily-loaded Sculpture chunk of 996 kB / 277 kB
gzipped; `npm run e2e` — 94 specs (68 desktop + 20 mobile + 6 prod-build), 93 passed in a
full sequential run with one `tour.spec.ts` flake under full-suite resource contention
(confirmed to pass in 1.7s when re-run in isolation — see
[`docs/VERIFICATION-SUMMARY.md`](./docs/VERIFICATION-SUMMARY.md) §9 for detail).

---

## 11. The site build: `site/**`, the multi-page build, and `postbuild`

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
