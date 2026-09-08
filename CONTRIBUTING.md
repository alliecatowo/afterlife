# Contributing to AFTERLIFE

This is the handoff document: everything a capable developer needs to pick this repo
up cold. It assumes you've read the README's tour but haven't touched the code yet.
For the deep architectural rationale (why the world is a torus, how history windowing
works, the colour/rule determinism contracts), see [`ARCHITECTURE.md`](./ARCHITECTURE.md)
— this document is the map to get you oriented; that one is the reference.

## Running it

```sh
mise install && npm install && npm run dev
```

Node 22 is pinned via `mise.toml`. If `node`/`npm` aren't on your `PATH` after
`mise install`, prefix every command below with `mise exec --`.

| Command | Does |
| --- | --- |
| `npm run dev` | Vite dev server on `:5173` |
| `npm run build` | `tsc --noEmit`, generates the `site/**` wiki HTML, then a production build to `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm test` | Unit tests (Vitest) |
| `npm run typecheck` | `tsc --noEmit` on its own |
| `npm run e2e` | Playwright end-to-end suite (boots the real dev server, and a real production build for one project) |

Keep `typecheck`, `test` and `build` green at every commit. `npm run e2e` is slower
(a full sequential run takes a few minutes — `playwright.config.ts` runs one worker,
`fullyParallel: false`, deliberately, to avoid resource-contention flakes) and boots
real browsers; run it before a PR, not on every save.

## The test story

**Unit tests (Vitest, jsdom):** 837 tests across 83 files as of this writing (`npm
test` prints the real count — always trust that over any number in a doc, including
this one). Pure logic (`src/core/**`, `src/render/color.ts`'s ramps, `src/audio/**`
except `audio.ts`/`capture.ts`, `src/net/protocol.ts`, `src/ui/theme/**`'s validator)
is tested directly with no mocks. Impure/stateful modules (`session.ts`, `audio.ts`,
`room.ts`) are tested through their public interface.

**End-to-end (Playwright, chromium):** three projects, defined in
`playwright.config.ts`:

- **`desktop`** (1440×900) — everything under `e2e/` except `prod-build.spec.ts` and
  the touch-specific `mobile.spec.ts`.
- **`mobile`** (390×844, `hasTouch: true`) — `mobile.spec.ts` and the mobile slice of
  `screenshots.spec.ts`. Real `.tap()` gestures; several assertions (no horizontal HUD
  overflow, the "More controls" sheet) only make sense at this width.
- **`prod-build`** — runs `prod-build.spec.ts` against a real `vite build` served by
  `vite preview`, on its own port (4173), not the dev server.

**Why `prod-build` exists, specifically:** a real bug shipped once because every other
test only ever exercised the dev server. Tailwind v4 + Lightning CSS downlevel the
app's `oklch(...)` design tokens to `lab(...)` in a production build — the dev server
serves `oklch(...)` verbatim, so that transformation never happened in front of any
test. The old colour parser only understood `oklch(...)` syntax, so in production
*only*, it silently fell back to solid white for every render lens. Nothing caught it
because nothing ever looked at the actual production artifact. `prod-build.spec.ts`
now builds for real and asserts on actual canvas pixels from the real `dist/` output.
**If you're testing something that depends on what Vite's build pipeline actually
emits (CSS custom property resolution, chunk splitting, anything downleveled), it
belongs in this project, not `desktop`.**

The one currently-known flake: `mobile.spec.ts`'s heartbeat-journey test
(scrub → edit → compare → sculpt by touch) intermittently fails the "dragging the
ribbon to its start must move generation backward" assertion under full-suite load.
It's a real, reproducible race between a scrub's chunked replay and something reading
`engine.gen` mid-flight — not a click-timing flake — and is `session.ts`/`interact`
territory (see "known rough edges" below).

## The module map

```
src/
  core/       Engine, history/branching, RNG, rule model, the fixed-timestep loop.
              Pure TS — no DOM, no React.
  render/     Canvas2D world renderer, camera math, lens coloring, and Acid Art
              (glyph atlas, modulation field, LFO automation).
  interact/   Pointer/keyboard/touch input → bus intents; global shortcut guard.
  ui/         App shell, bus, low-frequency app state, session (the live engine/
              history/renderer wiring), theming, tutorial, achievements, cinematic
              mode, multiplayer UI, and every panel/dialog/primitive.
  sculpture/  The R3F Time Sculpture — lazy-loaded, its own bundle chunk.
  content/    Curated scenes, the specimen corpus, pattern recognition, experiments,
              the rule preset library, the tour script, achievement definitions.
  audio/      WebAudio soundscape, MIDI output, mic/system-audio reactivity.
  net/        Opt-in lockstep multiplayer protocol/room/transports — pure logic,
              no DOM. Never imported eagerly (see "the lazy-import boundary" below).
  export/     Offline deterministic video/PNG-sequence export.
  persist/    localStorage save format, RLE import/export.
  styles/     Design tokens (`@theme`), base styles, motion.
site/
  scripts/    The guide/wiki's own static-site generator (plain data + template
              strings, no framework, no dependency on `src/**`).
  shared/     Landing page's live glider diagram, shared CSS.
  guide/      Generated static HTML (checked in; regenerated by `npm run build`).
```

Full detail, including every subdirectory and the DOM anchor contract
(`#world-canvas`, `#timeline`, etc.), is in [`ARCHITECTURE.md`](./ARCHITECTURE.md) §3–4.

**Convention:** import a module's public entry file (`@/core/engine`,
`@/render/renderer`, `@/content` barrel, `@/persist/store`, `@/net` …) rather than
reaching into its internals, unless you're already inside that module.

## The performance rule: React never re-renders per generation

The simulation runs on a fixed-timestep imperative loop (`src/core/loop.ts`) that
steps the engine and paints straight to a 2D canvas. React owns only the chrome. It
must never re-render when the generation advances. There are exactly three sanctioned
bridges between the simulation and React, in order of preference:

1. **Event bus → DOM refs.** Subscribe to `gen:changed` and write `el.textContent`
   directly. Zero renders. Use for counters, coordinates, FPS.
2. **`useSimulationReadout()`** (`src/ui/hooks/useSimulationReadout.ts`) — a
   `useSyncExternalStore` view coalesced to ≤10 Hz. Use only when React genuinely must
   render the value.
3. **Zustand** (`src/ui/store.ts`) — low-frequency app state only (mode, lens, tool,
   selection, playback flags). Written at most a few times per second, in response to
   user action.

If you find yourself calling `setState` (React or Zustand) inside the simulation loop,
a pointer-move handler, or a per-generation bus handler, that's a bug — accumulate and
commit at a boundary instead. R3F follows the same discipline in the Time Sculpture:
`useFrame` mutates transforms directly, it does not `setState` per frame.

## The lazy-import boundary

Two feature areas are large, optional, and must cost solo/offline users nothing:

- **`@/net` / `@/ui/multiplayer`** — the app shell (`App.tsx`, `Hud.tsx`,
  `HudMoreSheet.tsx`) never statically imports either. The one sanctioned seam is
  `src/ui/hud/multiplayerLazy.tsx`, whose `requestMultiplayer()` does a real dynamic
  `import('@/ui/multiplayer')`, called only from an explicit HUD click.
  `tests/net-guard.test.tsx` proves this three ways: no static import anywhere in the
  shell, the lazy loader itself has no static import, and merely importing `@/net`
  constructs zero `Transport`s / `BroadcastChannel`s — mounting
  `<MultiplayerLazyHost/>` (which `App.tsx` does unconditionally) renders nothing and
  touches nothing until `requestMultiplayer()` is actually called.
- **The Time Sculpture** (`src/sculpture/**`) — its own lazy-loaded bundle chunk,
  mounted only when a selection is lifted into 3D.

If you add another large optional feature, follow the same pattern: a small
always-mounted host component with a real dynamic `import()` behind an explicit user
action, plus a guard test in the same style as `net-guard.test.tsx`.

## The determinism contract

A world's identity is: **a seed (or curated starting cells) + a sparse,
generation-stamped edit log + a rule string.** Given the same three things, replay is
bit-exact, no matter how many times or in what order you scrub to a generation.

- **Edits are absolute**, not relative (`alive: true|false`, never "toggle") — this is
  what makes out-of-order replay idempotent.
- **Colour rides along but is never causal.** `hue`/`species` are cosmetic per-cell
  buffers computed *after* the B3/S23 (or configured rule's) decision — never before,
  never read by it. A dedicated test poisons colour state and confirms the resulting
  live/dead bits are byte-identical to a run with no colour reasoning at all. Colour
  still has to survive rewind/branch/reload bit-exactly, which is why it's snapshotted
  into keyframes alongside the cell bits rather than recomputed on restore.
  This is exactly why colour counts as part of "world identity" for anything that
  needs to reproduce a world exactly (export, multiplayer's desync hash target, etc.)
  even though it can't affect what that world *does*.
- **The rule is part of world identity, and changing it is a fresh-world operation,
  never a mid-history edit.** `Session.setRule()` stops playback, sets the new rule,
  then clears the engine and resets history — in that order, so there is never a
  moment where old-rule bits exist under a new rule. This isn't a missing feature; a
  snapshot or a recorded edit has no way to record *which rule produced it*, so
  replaying old history under a newly-changed rule would silently reinterpret it. A
  multiplayer room's spec includes the rule string precisely so two peers running
  different rules refuse to connect rather than silently computing different futures
  from the same edits.

## Conventions

- **`@/*` resolves to `src/*`.** TypeScript `strict`, ES2022.
- **Toroidal world, always.** Any `(x, y)` integer is legal; wrap with `wrap(v, n)`
  from `@/core/engine`, never clamp.
- **No component hardcodes a colour, radius, or duration** — token or nothing (see
  [`DESIGN.md`](./DESIGN.md)). If a value doesn't exist as a token, that's a real
  conversation, not something to work around locally.
- **A module's own doc comment is load-bearing.** Several modules (`src/net/protocol.ts`,
  `src/render/glyphAtlas.ts`, `src/audio/dynamics.ts`, `src/ui/tutorial/CoachMark.tsx`)
  carry a long header explaining a non-obvious design decision or a bug that was fixed
  once and shouldn't be reintroduced. Read the header before changing the file.
- **`INTEGRATION-NOTES.md`** is the historical build log from this app's original
  multi-agent construction, now reorganised into a still-relevant summary at the top
  and a chronological historical record below it. Worth skimming for *why* a module
  looks the way it does; not a place to file new work.

## Known rough edges / good first tasks

Honest gaps, drawn from `INTEGRATION-NOTES.md` and the current source, not hidden:

- **Two cut media-export features have a documented resurrection path, but need a
  real verification environment to finish:**
  - **Animated GIF export.** A complete median-cut quantiser + GIF-flavoured LZW
    encoder + GIF89a container writer were built and typechecked, then deleted rather
    than shipped, because the only verification available was a self-authored
    round-trip decoder — there was no real third-party GIF reference decoder in that
    environment to confirm produced files actually open correctly. If you have a way
    to verify against a real decoder (or a browser that can load the output as an
    `<img>`), this is straightforward to resurrect — see the `media-export` entry in
    `INTEGRATION-NOTES.md`'s historical section for exactly what was built.
  - **Audio export** (both a deterministic offline render and muxed WebM+audio).
    `SoundscapeBrain`/`SynthGraph` (`src/audio/**`) are pure/explicit-time and were
    confirmed (by reading `synth.ts` fully) to work against an `OfflineAudioContext`
    via a safe structural cast — this would make offline audio export genuinely
    deterministic, fed from the same `replay.ts` cursor video export already uses. Cut
    because `OfflineAudioContext` isn't available in jsdom/Vitest, so it couldn't be
    exercised before shipping. **Currently, exported WebM video is silent.** Needs a
    real-browser test harness to verify, then wiring into `src/export/**`. If you pick
    this up: do not fall back to a realtime tap of the live soundscape without saying
    so — that would be a real, not deterministic, capture, a materially different and
    weaker guarantee.
  - **Time Sculpture turntable export** — designed (orbit the existing
    `TimeSculpture.orbit()` camera, reuse `exportPng()` per frame) but cut for the same
    reason: untested against real WebGL, and it's an inherently realtime-paced capture.
- **Site theming was never built.** The app has 5 runtime themes
  (`src/ui/theme/**`); `site/**` (this landing page/wiki) does not. If picked up: don't
  import `src/ui/theme/**` directly — the site deliberately has zero dependency on
  `src/**` — duplicate the 5 themes' token maps into a small `site/shared/theme.ts`
  instead, reading/writing the same `afterlife:v1:theme` localStorage key, with a
  parity test asserting the two copies match so they can't silently drift.
- **`ArtPanel`'s custom-palette colour input is a native `<input type="color">`**
  (hex only) — an existing `oklch()`/`lab()` palette stop shows as a grey fallback
  swatch until re-picked. Cosmetic; the underlying stop value is untouched until the
  user actually changes it.
- **The mobile heartbeat-journey e2e flake** (see "the test story" above) — a real,
  reproducible race in the scrub/replay path, `session.ts`/`interact`/`history.ts`
  territory.
- **`Hud.tsx`'s `lg`-and-up icon row has essentially zero spare width** (it's been
  measured at exactly 1440px against a 1440px viewport more than once in this app's
  history). Adding a new *dedicated* top-level icon is a real layout decision that
  needs re-measuring, not a mechanical add — extend the `MoreToolsMenu`'s `MORE_TOOLS`
  array instead unless you have a specific reason a feature deserves a dedicated slot.
- **The Immigration/QuadLife colourblind-safe (Okabe-Ito) palette is hardcoded**,
  not derived from `tokens.css` — the one deliberate exception, since nothing in the
  existing token palette has itself been verified colourblind-safe.
- **The achievements logbook trigger can overlap the cinematic overlay's bottom bar
  by a few px at very narrow widths** — cosmetic, both remain independently readable.
- **The Time Sculpture's slice colours render dark under software WebGL
  (SwiftShader)** — the renderer headless/CI browsers and some sandboxes use. This is
  an artifact of that renderer, not the colour ramp; a real GPU renders it correctly.
- **`--color-line-strong` falls below WCAG's 3:1 non-text-contrast guidance** — a
  deliberate choice for a purely decorative hairline, not an oversight, and not
  covered by an automated check.
- **On narrow screens, the drawer/inspector become slide-over sheets that aren't
  focus-trapped**, unlike the app's Radix-based dialogs.

None of these are "the app is broken" — they're honestly-scoped cuts and known
limitations in an app that otherwise verifies its own claims. Picking one up, verifying
it properly, and either shipping or re-documenting the gap is exactly the kind of
contribution this codebase rewards.
