# AFTERLIFE

**Every future leaves a trace.**

AFTERLIFE is a playable observatory for tiny universes. Underneath, it is Conway's
Game of Life — B3/S23, the rule everyone already knows — but the surface is built
around a different question than most implementations ask. Not "can it run fast,"
but: what happens if you touch one cell? Where did this shape come from, and where
is it going? What did the world look like ten thousand generations ago, and what
would it look like now if you'd drawn one extra cell back then?

So the whole app is organized around time as a substance you can handle. A ribbon
along the bottom holds the world's entire recorded history, scrubbable in both
directions. Lift a stretch of that history out of the timeline and it becomes a
Time Sculpture — a physical, orbitable stack of every generation in the range,
each slice a real recorded frame rather than a re-simulation. Change a cell at any
point in the past and the future forks: the world you had and the world you made
now run side by side, comparable cell for cell.

Live at **<https://alliecatowo.github.io/afterlife/>**. The guide and wiki — a
longer walkthrough, a specimen catalogue, and the full verification record —
are at **<https://alliecatowo.github.io/afterlife/guide/>**.

## Running it locally

```sh
mise install && npm install && npm run dev
```

Node 22 is pinned via `mise.toml`. If `node`/`npm` aren't on your `PATH` after that,
prefix any command below with `mise exec --`.

| Command | Does |
| --- | --- |
| `npm run dev` | Vite dev server on `:5173` |
| `npm run build` | `tsc --noEmit`, then a production build to `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm test` | Unit tests (Vitest) |
| `npm run typecheck` | `tsc --noEmit` on its own |
| `npm run e2e` | Playwright end-to-end suite (boots the real dev server) |

## The one-minute tour

Open it and watch. Something is always alive somewhere on the grid — a glider
drifting, a gun firing, a cluster of oscillators ticking in place. Follow one with
the pan tool. Two travellers are converging from opposite corners; give it a
minute and they collide, the wreckage blooming into a small chaotic reaction
before it settles into blinkers and blocks. That's an encounter, and the Field
Guide is quietly logging it as it happens.

Now scrub backward on the timeline ribbon, back past the moment of contact, and
draw or erase a single cell near one of the travellers. Let it play again from
there. It's a different future — sometimes subtly, sometimes completely: the same
collision that used to ignite a debris field can instead go stone dead by
generation 54, one flipped cell being the entire difference between a bustling
wreck and an empty grid. Branch here instead of overwriting, and both futures are
still yours, playable side by side.

Finally, select the stretch of history that mattered and lift it into the Time
Sculpture — a 3D stack of every one of those generations, one slice per frame,
that you can orbit and slide a plane through to read the whole story of a
collision or a chase from the side.

First run also gets a guided tour that spotlights the real UI and waits for
you to actually do each step (or does it for you, if you'd rather watch) —
replay it any time from **?**.

## What it's built from

**The living world.** A 256x160 toroidal grid, standard B3/S23, drawn on a plain
2D canvas so the simulation loop never has to fight React for frame time. Draw,
erase, pan, zoom, select and stamp specimens onto it.

**Colour, honestly.** Eight lenses recolor the same cells without ever
touching the rule underneath. The default lens is **`lineage`**, not `life`:
a newborn's hue is the circular mean of its exactly-three parents', so colour
encodes ancestry — colliding populations visibly interbreed at their border
instead of one colour overwriting the other — and the opening scene shows
several genuinely distinct family-line hues at generation 0 instead of a flat
green field (`life` is a single fixed hue by design, which read as "not
seeing colour" on a first, zero-configuration visit). `age`/`activity` are
real multi-hue spectral ramps; `immigration` and `quadlife` are the classic
2- and 4-colour Life variants (majority-of-3 birth colour, a 3-way tie takes
the unused colour) running the exact same B3/S23 underneath; `velocity` reads
local directional bias; `neighbors` is a spectral ramp over live-neighbour
count. A test poisons colour state and confirms the resulting bits never
change, and colour reproduces exactly through deterministic replay. A
colourblind-safe (Okabe-Ito) palette is a toggle in Settings. `life` remains
fully available. Switch lenses with **1**–**8**.

**Acid Art.** Beyond the honest lenses, an opt-in Art mode (**A**, or the HUD)
redraws the same live cells as JetBrains Mono glyphs from a cached offscreen
atlas — never `fillText` per cell per frame — chosen by real per-cell state
(age, activity, lineage, density, and more). A modulation field (procedural
noise/gradients/plasma, or a real image/video/webcam source) can additionally
warp glyph choice, hue, brightness or jitter, purely as decoration layered on
top — nothing here can ever change which cells are alive. Deterministic LFOs
(pure functions of absolute time, so they're replay-safe) can drive hue
rotation, palette cycling, glyph-set switching, field motion, trail length or
brightness. Custom palettes and trails are supported, plus four presets and a
"Randomise" button. Disabled by default; the shipped look is unchanged until
you opt in.

**Themes.** Five shipped themes — **Observatory** (the unchanged default),
**Ivory Plate** (a light, paper-plate theme), **High Contrast**, **Phosphor**
(amber CRT), and **Cyanotype** — applied at runtime by writing the 21 design
tokens straight onto `documentElement`, so the world canvas re-themes itself
automatically alongside the chrome, with no rebuild. A validator enforces a
minimum OKLab distance between the 8 semantic accents, calibrated to
Observatory's own worst real pair (age vs. warn, measured at 0.0491) — every
theme, including a custom one you build and export/import, must be at least
that distinguishable. Reachable from Settings or the HUD's "More tools" menu.
The `site/**` guide/wiki does **not** theme itself yet — that was scoped and
deliberately not built.

**Rules.** Beyond Conway's own B3/S23, 10 verified Life-like presets are
available from the Rules panel: HighLife, Day & Night, Seeds, Maze,
Mazectric, Replicator, Life without Death, 2×2, and Coral, plus any custom
B/S rulestring. Every preset's headline claim was actually run against the
engine, not asserted (see `src/content/rules.ts`); Diamoeba was tried and
dropped after its usual "self-organising diamond blobs" claim failed to
reproduce at any density tested. A generic lookup-table kernel drives every
rule, with Conway's own hand-unrolled fast path kept and dispatched to
whenever the active rule canonicalises to exactly B3/S23 — changing the rule
costs essentially nothing at the default rule (measured: 3.2598 → 3.2856
ms/step at 512², a +0.8% difference within run-to-run noise). **Changing the
rule always starts a fresh world** — it stops playback, clears the board and
resets history, never edits mid-history, because a recorded edit or keyframe
has no way to say which rule produced it. RLE import now simulates whatever
supported Life-like rule a pattern file specifies, and names the family
plainly if it asks for one that isn't supported, rather than silently
re-running it under B3/S23.

**Multiplayer.** An opt-in, account-free, deterministic-lockstep layer:
edits are stamped to land 12 generations into the future (about a second at
the default speed) and applied identically, in the same
`(targetGen, peerId, seq)` order, by every peer, including the one who drew
them — nobody is authoritative, everybody computes the same thing from the
same inputs. A room's spec includes the rule string, so two peers on
different rules refuse to connect instead of silently diverging; the
simulation stalls rather than guessing when an input might still be
outstanding; every 64 generations peers exchange an FNV-1a hash of their own
world and loudly report any mismatch, with a manual resync. Today,
`BroadcastChannelTransport` genuinely works with **no server and no
account** — open two tabs and they really do play together — and
`WebSocketTransport` is a real client ready for an optional relay once one
exists (see [`docs/MULTIPLAYER.md`](./docs/MULTIPLAYER.md)). None of this
loads for solo play: `@/net`/`@/ui/multiplayer` sit behind a lazy `import()`
reached only from an explicit "Multiplayer" click, which
`tests/net-guard.test.tsx` proves by static analysis and by mounting the
lazy host and confirming it constructs nothing until asked.

**Video export.** An offline, deterministic replay (an independent engine,
stepped forward and re-fed the same recorded edits — never the live
engine/history/camera) can be exported as WebM or a zipped PNG sequence,
bounded and cancellable, matching whatever lens/theme/Art config you're
actually looking at. **Audio export, animated GIF, and a Time Sculpture
turntable export were all cut**, deliberately, rather than shipped
half-verified — see [`CONTRIBUTING.md`](./CONTRIBUTING.md)'s "known rough
edges" for exactly what was built and what it would take to finish each one.
Exported video is currently silent.

**Time as a physical thing.** The history ribbon isn't a scrollbar bolted onto a
simulation — it's the actual record. Scrubbing calls `goto(gen)`, which restores
the nearest keyframe and deterministically replays forward, so what you see at
generation 4,000 is the real generation 4,000, edits and all. The Time Sculpture
takes a slice of that record and extrudes it into a navigable 3D stack in its own
lazily-loaded view.

**Branching "what if."** Editing at a past generation normally overwrites
everything after it — the obvious, honest default. Branching instead forks: the
original future keeps playing untouched on its own branch, your edited future
plays on a new one, and a compare view diffs them cell-for-cell. Up to 8 branches
are kept at once; if a ninth is needed, the least-recently-used one is evicted —
unless it's been renamed or is the one you're standing on, which are never
auto-evicted.

**The Field Guide and experiments.** A recognition pass identifies known
specimens (still lifes, oscillators, spaceships, guns) as they appear and logs
them as discoveries you can follow, rename, and jump back to. Three authored
experiments — One Cell, First Contact, Keep Something Alive — are small,
scored puzzles built on the same mechanics: change something, watch what
happens, get an honest verdict instead of a badge. A 14-entry achievements
logbook (HUD icon, or **L**) records what you've actually witnessed — real
bus events only, never a timer standing in for "the user did it" — in a
naturalist's-log voice.

**An instrument, not just a picture.** A WebAudio soundscape turns
population, births, deaths and activity into scheduled, pitched notes: 5
timbres (pluck, bell, bow, breath, perc, alongside the original mallet/glass/
pad/accent set), 4 presets (Observatory — the original default — Glass, Deep,
Chime), slow harmonic drift driven by a dual-EMA population tracker gated to
at most one change per 60 seconds, and opt-in generative percussion. The
sustained drone is driven by two measured, decaying dynamics — a churn-RATE
EMA and a population-centroid drift-speed EMA, each fed only by real
per-bucket measurements — so it falls to genuine silence within a few seconds
whenever the world is paused, static, or extinct, and the `AudioContext`
itself auto-suspends after 4 seconds of that silence so a quiet tab costs no
CPU. (Gating on a rate rather than a raw per-bucket count was the fix for an
earlier version where the drone's parameters felt inert — a faster tempo used
to cancel its own effect on the count it was gating against.) Notes can also
drive a real synth or DAW over **Web MIDI** (port/channel selection,
guaranteed note-offs, an all-notes-off panic), and the soundscape can react to
system or microphone audio (`getDisplayMedia`/`getUserMedia`) — structurally
limited to presentation and tempo, since it only ever touches playback speed
and existing audio settings, never `@/core`.

**Cinematic mode.** `C` hands the camera to an auto-pan choreographer that
scores regions by real activity, density and confirmed travellers, holds on
what it finds, lingers on the aftermath when a tracked traveller dies, and
pulls back periodically. Any real input pauses it without exiting; `Esc`
exits.

## Keyboard shortcuts

Everything below is also in-app under **?**.

| Keys | Does |
| --- | --- |
| `Space` | Play / pause |
| `.` | Step forward one generation |
| `[` / `]` | Speed down / up |
| `←` / `→` (timeline focused) | Move one generation |
| `Shift + ←` / `Shift + →` (timeline focused) | Jump one keyframe interval (64 gens) |
| `Home` / `End` (timeline focused) | Jump to window start / present |
| `← ↑ → ↓` | Pan the camera |
| `+` / `-` | Zoom in / out |
| Scroll / pinch | Zoom at pointer |
| `D` / `E` / `P` / `S` | Draw / erase / pan / select tool |
| `G` | Toggle grid |
| `R` | Rotate the stamp (or the selection's contents, if one is active) |
| `F` | Flip the stamp (or the selection's contents, if one is active) |
| `Z` | Undo last edit |
| `1`–`8` | Render lens — life / age / activity / lineage / immigration / quadlife / velocity / neighbors |
| `V` | Presentation mode |
| `C` | Cinematic mode — auto-pan, full-screen, hands-off (any input pauses it; `Esc` exits) |
| `A` | Toggle Acid Art mode — ASCII/glyph rendering, the modulation field, colour automation |
| `?` | This sheet |
| `Esc` | Close dialog / panel / presentation, or cancel the current selection / armed stamp |
| Compass icon | What is this? — a short explanation, and the tour |
| `L` | Logbook — a naturalist's record of what you've witnessed |
| Replay tour | Walks through every feature again, from the button below |

Transcribed verbatim from `src/ui/dialogs/ShortcutsDialog.tsx`'s `GROUPS` (grouped
there as Transport / Timeline / World / View / Help) — keep this table in sync with
that file if it changes.

## What was verified

Every claim below was checked by actually running the engine, not asserted from
memory. The raw evidence — scripts, generation-by-generation population tables,
ASCII renders — lives in [`docs/verification/`](./docs/verification/); a readable
walkthrough is in [`docs/VERIFICATION-SUMMARY.md`](./docs/VERIFICATION-SUMMARY.md).

- **The engine itself**, on an unbounded reference grid: known still lifes and
  oscillators (periods 2, 3 and 15) hold their period exactly; spaceship
  displacements match the literature; the Gosper glider gun emits one glider
  every 30 generations indefinitely; the R-pentomino stabilizes at generation
  1103 with population 116, the acorn at generation 5206 with population 633,
  and diehard dies completely at generation 130 — all exact matches to the
  published values. **The shipped world is a 256x160 torus, not an unbounded
  plane** — long-running patterns like the R-pentomino wrap around the edges and
  re-interact with their own debris, so on the torus it does *not* freeze at
  116; it keeps evolving and only settles into a period-2 cycle (population 109)
  at generation 2189. Treat the unbounded-grid figures as a spec conformance
  check, not a claim about what you'll see in the app.
- **Determinism.** Rewinding and replaying the same recorded history through
  `goto()` in a scrambled, out-of-order sequence of target generations produces
  bit-identical state every time, matching an independently-run reference
  simulation.
- **The four authored scenes**, each verified by offline simulation before being
  shipped: the opening encounter between two travelling gliders happens at
  **generation 123**; in *One Cell*, flipping cell (128,89) sterilizes the
  collision entirely — that future is dead by **generation 54** while the
  untouched original reaches a population of **221**; in *First Contact*, a
  glider and a lightweight spaceship collide at **generation 116** and settle
  into a traffic light; in *Keep Something Alive*, the baseline activity dies at
  **generation 85**, and the shipped solution — one edit, at (129,60), against a
  budget of 3 — keeps something moving all the way to the target generation,
  150.
- **24 specimens** in the drawer, each independently verified for period,
  displacement or (for seeds) stabilization behavior. **There is deliberately no
  puffer**: over 2,600 candidate arrangements were searched and none produced a
  clean, verifiable periodic puffer, so none shipped rather than shipping one on
  a guess.
- **Colour never touches the rule.** A test seeds hue/species colour state,
  actively poisons it, and confirms the resulting live/dead bits are
  byte-identical to a run with no colour reasoning applied at all — B3/S23
  cannot see colour. Colour itself (hue, species) is captured in history
  keyframes alongside the bits and reproduces exactly through rewind,
  branching and reload — the fix for a real bug where a reload used to lose
  colour, traced to replay skipping edits recorded at the generation-0
  baseline.
- **Mobile touch actually commits.** `#endPinch()` used to unconditionally
  clear the active drag mode on every single-finger release, which meant
  100% of one-finger draw/erase/select touches silently failed to commit on
  a real touch device. Fixed, and covered by the `mobile` Playwright project.
- **The production build itself is checked**, not just the dev server: a
  `prod-build` Playwright project builds for real and asserts actual canvas
  pixels are non-white/non-grey and that every lens — including the five
  multi-hue ones — produces genuinely differentiated colour, not a silent
  fallback. This is the regression test for a real shipped bug: Tailwind v4 +
  Lightning CSS downlevel design tokens to `lab(...)` in production (the dev
  server serves `oklch(...)` verbatim), which broke the old regex-only colour
  parser and silently fell back to solid white for every lens — in
  production only, which is exactly why it shipped once before this check
  existed. See [`docs/VERIFICATION-SUMMARY.md`](./docs/VERIFICATION-SUMMARY.md)
  §7 for detail.
- **A CPU-pinning render loop was fixed**, measured with Chrome's CDP
  performance metrics on the dev server: idle-paused went from 60 draws/sec
  at 11.7% main-thread CPU to ~0.3 draws/sec at 2.7%; playing at 12
  generations/sec went from 60.7 draws/sec (always 60fps, regardless of sim
  speed) at 15.0% CPU to 11.7 draws/sec (tracking the actual generation
  rate) at 6.5% CPU.
- **The default-lens change is measured, not assumed.** With zero interaction,
  the opening scene at generation 0 shows several genuinely distinct,
  significantly-represented hue buckets under `lineage` (measured at 12
  buckets in practice, using the same bucketing method the production-build
  colour tests use for the other 7 lenses; the committed regression test
  asserts a robust ≥3 as its threshold) — not the single flat hue `life`
  would show at the same moment.
- **The generalised-rule kernel costs essentially nothing at Conway's own
  rule.** Measured on a 512×512 board, 200 steps after a 20-step warmup,
  same harness before/after: **3.2598 ms/step → 3.2856 ms/step (+0.8%,
  within run-to-run noise)** — the hand-unrolled Conway fast path is
  untouched code, dispatched to whenever the active rule canonicalises to
  exactly B3/S23.
- **Every rule preset's headline claim was actually run**, not asserted: HighLife
  producing 4 exact self-replicated copies of a seed pentomino by generation 5,
  Day & Night's 3×3 block cycling 9/9/5/5 indefinitely, Seeds exploding a 2×2
  block to population 128 within 12 generations, Maze locking a random soup to
  an exact static population, Mazectric instead cycling it with period 6,
  Replicator turning a single cell into an exact 8-cell ring after one step,
  Life without Death never once losing population across 60 generations, 2×2
  staying bounded without collapsing or exploding, and Coral both freezing a
  dense seed and slowly re-accreting a sparse one. Diamoeba was tried at four
  densities on a 128×128 torus and dropped — no stable diamond blobs formed at
  any of them — rather than shipped on an unverified claim.
- **Every theme clears the same distinguishability bar the shipped default
  does.** A validator computes the OKLab distance between every pair of the 8
  semantic accents in a theme; the floor (0.045) is calibrated to
  Observatory's own closest real pair (age vs. warn, measured at 0.0491), so
  a custom theme can't silently collide two accents that are supposed to mean
  different things.
- **Multiplayer determinism is proven with two real browser tabs**, not
  mocked: `e2e/multiplayer.spec.ts` drives an actual `BroadcastChannel` room
  end to end and asserts both tabs converge to the identical world and the
  identical FNV-1a hash. `tests/net-lockstep.test.ts` separately proves the
  same set of edits, delivered to two independent engines in *different*
  arrival orders, produce bit-identical worlds. `tests/net-guard.test.tsx`
  proves solo play imports zero of this code and constructs zero transports
  unless a user explicitly asks for multiplayer.
- **837 unit tests** across 83 files, plus **115 Playwright end-to-end tests**
  (87 desktop at 1440x900, 22 mobile at 390x844 touch-enabled, 6 `prod-build`
  against a real production build served with `vite preview`); `typecheck`
  and `build` both run clean. One flake is currently known and documented,
  not hidden: the mobile heartbeat-journey test (scrub → edit → compare →
  sculpt by touch) intermittently fails a ribbon-scrub-direction assertion
  under full-suite load — see `CONTRIBUTING.md`'s "known rough edges."
  Production bundle, measured from a real build: the initial JS needed to
  open the app (the `app` + `primitives` chunks together) is 632 kB (199 kB
  gzipped combined); the lazily-loaded Time Sculpture chunk is 1.02 MB
  (285 kB gzipped) and the lazily-loaded multiplayer chunk is 21 kB (7 kB
  gzipped) — neither loads until you open that feature.

## Known limitations

- The Time Sculpture's slice colors render dark under software WebGL
  (SwiftShader), which is what headless/CI browsers and some sandboxes use.
  This is an environment artifact of that renderer, not a bug in the color
  ramp — the same ramp math was replicated headlessly and produces the correct
  values; a real GPU renders it correctly.
- Specimen recognition reliably auto-names gap-heavy shapes (the pulsar, the
  pentadecathlon, both glider guns) only when the shape is the sole occupant of
  the scanned region. Their internal gaps make the connected-components
  fallback fragment them into several unnamed pieces if anything else shares
  the region — a known limit of gap-based segmentation, not a false positive.
- On narrow screens, the drawer and inspector become slide-over sheets rather
  than docked columns; unlike the app's Radix-based dialogs, these sheets are
  not focus-trapped.
- The `--color-line-strong` hairline (used for the active branch row, focused
  timeline states, and similar accents) falls below the 3:1 ratio WCAG's
  non-text-contrast guidance recommends. This is a deliberate choice for a
  purely decorative edge, not an oversight, and isn't covered by an automated
  check.
- End-to-end specs under `e2e/` sit outside `tsconfig.json`'s `include` by
  design — they run under Playwright's own TypeScript handling, not the app's
  `tsc --noEmit` project.
- **Web MIDI output** and **system/mic audio reactivity** depend on browser
  support (`navigator.requestMIDIAccess`, `getDisplayMedia`/`getUserMedia`)
  and, for MIDI, real or virtual hardware — both degrade to an honest
  disabled/unsupported state rather than a silent no-op when unavailable.
  Audio reactivity only ever adjusts presentation (density, drone filter
  range) and playback speed; it has no code path into `@/core` and cannot
  affect simulation state.
- **The `site/**` guide/wiki does not theme itself** — the app's 5 runtime
  themes are an `src/**`-only feature. Scoped, not started; see
  `CONTRIBUTING.md` for the suggested approach if you pick it up.
- **Exported video is silent** — audio export was designed (and partially
  built against a safe structural cast to `OfflineAudioContext`) but cut
  unverified, since `OfflineAudioContext` isn't exercisable in this project's
  unit-test environment. Animated GIF export and a Time Sculpture turntable
  export were built/designed and cut for the same reason: verified confidence
  ran out before the feature did. See `CONTRIBUTING.md`'s "known rough edges"
  for exactly what exists to resurrect each one.
- **Art mode's custom palette colour input is hex-only** (a native
  `<input type="color">`); an existing `oklch()`/`lab()` stop shows a grey
  fallback swatch until re-picked. Cosmetic — the underlying value is
  untouched until changed.

The authored scenes and specimen set were arrived at by simulation search, not
hand-tuning by eye — see [`docs/verification/`](./docs/verification/) for the
scripts and full logs behind every number above.

## More

- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — the handoff document: how to run
  and test the app, the module map, the performance/determinism contracts,
  and an honest list of known rough edges and good first tasks.
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — module map, the React/simulation
  performance boundary, the toroidal world model, history windowing, the
  atomic-edit rule, and the newer `net`/`export`/`theme`/Art modules.
- [`DESIGN.md`](./DESIGN.md) — the visual and interaction design system.
- [`docs/VERIFICATION-SUMMARY.md`](./docs/VERIFICATION-SUMMARY.md) — a guided
  read of the verification evidence.
- [`docs/MULTIPLAYER.md`](./docs/MULTIPLAYER.md) — the full multiplayer
  design: the lockstep model, latency buffer, stall policy, desync
  detection/recovery, and the optional-hosting path.
- [`INTEGRATION-NOTES.md`](./INTEGRATION-NOTES.md) — the build's own history:
  a still-relevant summary up top, and the full chronological log below it.
- **[The guide and wiki](https://alliecatowo.github.io/afterlife/guide/)** —
  a longer, illustrated walkthrough plus an 8-page wiki: getting started,
  Life fundamentals, the specimen catalogue, features (lenses, Acid Art,
  themes, rules, multiplayer, export, audio, cinematic mode, the tour,
  achievements), shortcuts, how it works, and verification. Built from
  `site/**`, deployed alongside the app.
