# Integration Notes (APPEND-ONLY)

Frozen files (`package.json`, `tsconfig.json`, `vite.config.ts`, `mise.toml`,
`index.html`, `src/core/types.ts`, `src/ui/bus.ts`, `src/ui/store.ts`,
`src/ui/hooks/useSimulationReadout.ts`, `src/styles/tokens.css`, `src/styles/base.css`,
`ARCHITECTURE.md`, `DESIGN.md`) may not be edited by implementation agents.

Need something changed in one? **Append** an entry at the bottom of this file. Never edit
or delete another agent's entry. Format:

```
## <date> — <agent> — <file>
**Need:** what you need and why.
**Proposed:** the exact change (type signature, token name, event name, dependency).
**Blocking?** yes/no — can you proceed with a local workaround meanwhile?
**Resolution:** (architect fills this in)
```

---

## 2026-09-06 — architect — scaffolding complete
**Need:** n/a — baseline record.
**Proposed:** Contracts landed: `core/types.ts`, `core/engine.ts`, `core/history.ts`,
`core/loop.ts`, `core/rng.ts` (implemented + tested), `render/renderer.ts`,
`render/camera.ts`, `interact/input.ts`, `ui/bus.ts`, `ui/store.ts`,
`ui/hooks/useSimulationReadout.ts`, `ui/App.tsx`, `ui/primitives/index.ts`,
`sculpture/sculpture.ts`, `audio/audio.ts`, `persist/store.ts`, `content/patterns.ts`.
Stubs throw `not implemented`; typecheck, test and build are green.
**Blocking?** no.
**Resolution:** n/a.

## 2026-09-06 — ci-deploy — .github/** (CI + Pages)
**Need:** n/a — informational record for the team.
**Proposed:** Added `.github/workflows/ci.yml` (typecheck/test/build on push+PR to main)
and `.github/workflows/deploy.yml` (build with `npm run build -- --base=/afterlife/`,
deploy to GitHub Pages via configure-pages/upload-pages-artifact/deploy-pages).
Verified locally: `vite build --base=/afterlife/` correctly emits
`/afterlife/assets/...` URLs in `dist/index.html` — **no vite.config.ts change is
needed**, the CLI flag is respected as-is. Also added `.nojekyll` in the deploy
workflow, issue templates, PR template, and dependabot.yml (weekly, grouped).
Enabled Pages via API with `build_type=workflow`; site will be at
https://alliecatowo.github.io/afterlife/ once main is green.
**Blocking?** no.
**Resolution:** n/a.

## 2026-09-06 — render — src/ui/bus.ts (AppEvents)
**Need:** ARCHITECTURE.md's interaction spec asks `src/interact/input.ts` to "maintain an
edit-gesture undo stack ... and emit undo requests on the bus" for the `z` key. There is no
`edit:undo`/`history:undo` entry in `AppEvents`, and `bus.emit` is generically typed over
`keyof AppEvents`, so emitting an ad-hoc key would fail typecheck.
**Proposed:** Add something like `'history:undo': void` to `AppEvents` in `src/ui/bus.ts`,
emitted by whichever module ends up owning the `z` shortcut.
**Blocking?** no — interim workaround implemented: `InputController` (owned by render) now
exposes `undo(): EditOp | null` and `canUndo`, mirroring the existing `commit()` contract.
It maintains its own bounded (64-entry) undo stack of INVERSE `EditOp`s, captured from each
cell's prior value at first-touch of a gesture (requires the new optional
`InputOptions.engine?: LifeEngine` — a render-owned interface addition, not a core change).
Pressing `z` currently no-ops in `input.ts`; the caller that owns `TimelineStore` should call
`input.undo()` on `z` and hand the result to `history.record(currentGen, [inverseOp])`,
exactly like `commit()`. If the bus event above lands, swapping to it is a small localized
change in `input.ts`'s keydown handler.
**Resolution:** n/a.

## 2026-09-06 — core — src/core/engine.ts, src/core/history.ts, src/core/loop.ts
**Need:** n/a — informational record. `engine.ts`, `history.ts`, `loop.ts` are stubs I own,
not frozen files, so I filled them in and made two small non-breaking additions to the
`TimelineStore` interface beyond what the original stub declared. Flagging both here since
other agents (render/interact for the loop wiring, sculpture for `sliceStack`) will consume
these.
**Proposed (already implemented, not a request):**
1. `TimelineStore.advance(gen: Generation): void` — **whoever wires up `SimLoop` must call
   `history.advance(engine.gen)` once per generation right after `engine.step()` during
   normal playback.** This is what keeps `history.maxGen`/`windowStart` current and
   populates keyframes every 64 gens for fast seeking. Without it, `goto()`/`branchFrom()`
   still work correctly (they always fall back to replaying from the gen-0 keyframe), just
   slower, and the UI's `maxGen` readout would go stale during pure playback. `loop.ts`
   itself stays engine/history-agnostic (its `step` callback is opaque, supplied by the
   caller) — this is a wiring responsibility in whatever module constructs the loop.
2. `TimelineStore.sliceStack(rect, fromGen, toGen, maxSlices = 256)` — added an optional
   4th parameter (existing 3-arg call sites are unaffected) plus a new readonly
   `TimelineStore.lastSliceStride: number` reporting the stride actually used for the most
   recent `sliceStack()` call, per ARCHITECTURE's "report the stride actually used"
   requirement for the Time Sculpture.
3. `TimelineStore.goto(gen, signal?, onProgress?)` — added an optional 3rd parameter,
   `onProgress(done, total)`, called at each ~64-generation chunk boundary during a long
   seek, for a progress affordance.
`engine.ts` also exports `transformPattern(pattern, transform): StampPattern` (pure,
side-effect-free) — `stamp()` uses it internally, and render/UI should use the exact same
function for the placement ghost so it never drifts from where a stamp actually lands.
Measured perf: 512×512 world, ~1.7ms/step average (Node/V8, no rendering) — well inside the
33ms budget for 30 gens/sec.
**Blocking?** no.
**Resolution:** n/a.

## 2026-09-07 — integration — resolution pass

All entries above are resolved. Specifically, for **render**'s `history:undo` request: added
`'history:undo': void` to `AppEvents` in `bus.ts` as proposed; `@/interact/input.ts`'s `z`
handler now emits it instead of no-op'ing, and `@/ui/session.ts` owns the subscription
(`input.undo()` + `history.record()`), replacing the interim raw `window` listener. For
**core**'s `history.advance()` note: `session.ts`'s `step()` calls it immediately after
`engine.step()`, verified by `e2e/timeline.spec.ts`'s scrub-determinism test.

## 2026-09-07 — tutorial — guided tour (`src/ui/tutorial/**`, `src/content/tour.ts`)
**Need:** n/a — informational record. Built the first-run guided tour + "What is this?"
entry point per the brief. Owned/new: `src/content/tour.ts` (script + target specs),
`src/ui/tutorial/{tourStore,behaviors,targeting,layout,CoachMark,TourOverlay,AboutDialog}`.
Also touched `src/ui/App.tsx` (mounted `TourOverlay`/`AboutDialog`, wired auto-start to
`titleDismissed`) — all within my stated ownership.

Beyond that ownership, made three small, additive edits outside it, each isolated to one
new import + one new element, because the brief explicitly requires the replay control to
live "near the shortcuts/help affordance" and be "listed in the shortcuts sheet", plus a
HUD-reachable "About" entry:
- `src/ui/icons.tsx`: added `CompassIcon` (used by the About button).
- `src/ui/hud/Hud.tsx`: added one `Tooltip`+`IconButton` ("About AFTERLIFE", opens
  `AboutDialog`) next to the existing shortcuts (`?`) button. Landed cleanly alongside the
  audio agent's concurrent `WaveformIcon` addition to the same file — no conflict.
- `src/ui/dialogs/ShortcutsDialog.tsx`: added a "Help" row group and a `Dialog` `footer`
  button ("Replay the guided tour") that calls `useTourStore.getState().start(true)`.

If the `ui`/`content` agents want these three touches done differently (a dedicated Help
menu, different icon, different copy), they're small and easy to move — say so here and
I'll follow.

One a11y fix worth flagging for anyone else adding a floating/portaled overlay: axe's
`region` rule ("all page content must be contained by a landmark") flagged the coach
mark's card because it mounts as a fixed-position sibling near the document root, outside
`<header>`/`<main>`/`<footer>`. Fixed by giving `CoachMark`'s outer wrapper
`role="complementary" aria-label="Guided tour"`. `Toast`/`ShortcutsDialog` don't hit this
today (empty `#toast-layer` mount point, and Radix's dialog content has its own
`role="dialog"` landmark), but the same fix applies if a future overlay does.
**Blocking?** no.
**Resolution:** n/a.

The parallel-build phase is over. A single integration agent then had full write access to
every file (including everything listed as frozen above) to wire the modules together, add
`src/ui/session.ts`'s scene loading / discoveries / experiments / persistence / compare-view
rendering, fix a real bug in the history ribbon (scrubbing backward left the scrubber unable
to drag forward again — it was deriving its ceiling from the session-observed `historyRing`
instead of the authoritative `TimelineStore.maxGen`), fix `sculpture/tokens.ts`'s CSS-oklch
→ `THREE.Color` resolution (modern Chromium echoes `oklch(...)` back verbatim from both
`getComputedStyle` and a canvas 2D context's `fillStyle` getter; only rasterising via
`getImageData` reliably normalises it), and add the `e2e/` Playwright suite. See
`ARCHITECTURE.md` §3 for the (now historical) file-ownership table.
**Blocking?** no.
**Resolution:** done.

## 2026-09-07 — audio — instrument panel, MIDI output, audio-reactivity
**Need:** n/a — informational record. Extended `src/audio/**` (scale modes, tunable
tempo/density/drone/decay, MIDI output, system/mic capture) per a follow-up request to make
the soundscape a "real instrument." Since `src/ui/App.tsx`/`src/ui/session.ts` are other
agents' territory and the right-panel registration pattern lives in ordinary (non-frozen,
non-listed) `src/ui/` files, I made small ADDITIVE edits to three shared files instead of
routing through them:
- `src/ui/uiState.ts`: added `'audio'` to the `RightPanelId` union.
- `src/ui/panels/PanelRight.tsx`: imports the new `AudioPanel`, adds it to `TITLES` and the
  render switch under `rightPanel === 'audio'`.
- `src/ui/hud/Hud.tsx`: added a `WaveformIcon` HUD button ("Instrument") next to Settings,
  toggling `rightPanel === 'audio'`.
- `src/ui/icons.tsx`: added `WaveformIcon` (new export only, nothing existing touched).

New persisted key: `afterlife:v1:audio-settings` (via `src/audio/settingsStore.ts`, reusing
`STORAGE_PREFIX` from `@/persist/store` but NOT the `PersistStore` interface itself — that's
shaped around `ExperimentDoc`, not arbitrary settings). No changes to `@/persist/**`,
`@/ui/bus.ts`, `@/ui/store.ts`, or any frozen file. `@/audio/audio.ts`'s `createSoundscape()`
now also reads `useAppStore`'s existing `speed`/`setSpeed` (an ordinary, already-public
action) for the optional audio-reactive tempo nudge — no new coupling to `@/core/**`.
**Blocking?** no.
**Resolution:** n/a.

## 2026-09-07 — cinematic — auto-pan full-screen mode (`src/ui/cinematic/**`, `src/render/camera.ts`)

**Need:** a HUD entry point next to the presentation-mode button, and one new icon for it.
I was explicitly told (by the task brief coordinating this work alongside a concurrent
mobile-layout agent who owns `src/ui/App.tsx`/`src/ui/hud/Hud.tsx`/`src/ui/panels/**`/
`src/styles/**`) NOT to edit those files myself, and to write the exact change here instead.

**Proposed** (small, additive, mirrors the `audio`/`tutorial` agents' own HUD additions above):
- `src/ui/icons.tsx`: add a `FilmIcon` (or reuse any existing icon that reads as "cinematic" —
  I did not want to guess the house style for a new glyph while that file may be mid-edit).
- `src/ui/hud/Hud.tsx`: right next to the existing "Presentation mode" `IconButton` (search for
  `ExpandIcon`/`'Presentation mode'`), add:
  ```tsx
  <Tooltip content="Cinematic mode — full-screen, auto-pan, hands-off">
    <IconButton
      label="Cinematic mode"
      icon={<FilmIcon />}
      onClick={() => getSession()?.cinematic.enter()}
    />
  </Tooltip>
  ```
  `getSession()` is already imported in `Hud.tsx`. `Session.cinematic` (added to
  `src/ui/session.ts`, which I do own) exposes `{ enter(), exit(), toggle(), isActive() }`.

**What already works without that edit, so this is a nice-to-have, not a blocker:**
Cinematic mode is fully functional today via the **'C' keyboard shortcut** (documented in
`ShortcutsDialog.tsx`, which I did additively edit — it's not in the mobile agent's owned
list) and via `window.__AFTERLIFE__.cinematic` in dev/e2e. It reuses the EXISTING
`presentation` app-state flag + `presentation:toggle` bus event for chrome-hiding (calling
their already-public setter/emit — no edits to the frozen `@/ui/store.ts`/`@/ui/bus.ts`),
layers a best-effort Fullscreen API request on top, and mounts its own minimal fading
HUD-replacement (`CinematicOverlay`) via a **self-created DOM root appended to
`document.body`** — entirely outside the `App.tsx` React tree — specifically so it needed no
integration point there either. See `src/ui/cinematic/index.ts`'s doc comment for the full
design (interest scoring off real engine state, camera choreography, hand-back-control on any
input, `prefers-reduced-motion` handling).

Also touched (both within my stated ownership): `src/render/camera.ts` — `follow()` gained an
optional second `targetScale` argument (backward-compatible; the one existing caller,
`session.ts`'s scene-beat camera ease, is unaffected) so a cinematic camera move can ease a
pan and a zoom change together instead of cutting scale instantly; and `prefersReducedMotion()`
is now exported (was a private helper) for reuse by the cinematic director.

**Blocking?** no.
**Resolution:** n/a.

## 2026-09-07 — guide — marketing landing page + wiki/docs (`site/**`, new)

**Need:** n/a — informational record, plus one exact diff for whoever owns `src/ui` to
apply (I was told not to touch `src/**` myself).

**What shipped:** a new marketing/explainer landing page and an 8-page wiki, built as a
plain HTML+TS (no React) multi-page Vite site under `site/**`, served at `/afterlife/guide/`
alongside the app at `/afterlife/` (unchanged). Reuses `src/styles/tokens.css` read-only
(imported into `site/shared/site.css`, never edited) for full visual consistency — same
palette, type scale, Fraunces/Inter/JetBrains Mono, radius, motion. Content (fundamentals,
the 24-specimen catalogue, keyboard shortcuts, verification numbers) is transcribed from
`src/content/specimens.ts`, `src/ui/dialogs/ShortcutsDialog.tsx` and
`docs/VERIFICATION-SUMMARY.md` — nothing invented. `site/scripts/build-pages.mjs` generates
the actual HTML files from templates (run automatically as part of `npm run build`, before
`vite build`); `site/scripts/postbuild-flatten.mjs` runs as npm's `postbuild` lifecycle
script afterward to relocate Vite's mirrored `dist/site/guide/**` output up to `dist/guide/**`
(chosen as an npm lifecycle hook specifically so it does NOT swallow a forwarded
`--base=/afterlife/` flag the way appending it directly to the `build` script would).
New Playwright spec: `e2e/guide.spec.ts` (guide/wiki pages load, nav links resolve, app root
still loads). Verified: `npm run build -- --base=/afterlife/`'s `vite build` step (independent
of the pre-existing, unrelated `tsc --noEmit` failure in `src/audio/midi.ts` — not mine, not
touched) + postbuild flatten together correctly emit `dist/guide/**`, and a real
`vite preview --base=/afterlife/` serves both `/afterlife/` (app, untouched bundle/URLs) and
`/afterlife/guide/**` correctly; `e2e/prod-build.spec.ts` still passes unmodified.

**Frozen files I touched, per this task's explicit instructions (overriding the general
frozen-file rule above for these two files only):**
- `vite.config.ts` — added `rollupOptions.input` entries for the 9 guide/wiki HTML pages
  (the app's own `index.html` entry is unchanged, same output), and a dev-only Vite plugin
  (`guideDevAliasPlugin`) that rewrites `/afterlife/*` → `/*` and `/guide/*` →
  `/site/guide/*` in `vite dev` only (`apply: 'serve'`) so the guide's absolute hrefs resolve
  identically in dev and in the deployed build. No change to `build.target`,
  `build.sourcemap`, `resolve.alias`, or `server.port`.
- `index.html` — added one `<link rel="icon">` pointing at the guide's new favicon. No other
  line touched.
- `package.json` (not in the frozen list, but flagging anyway) — added `postbuild` and
  `build:site-pages` scripts; `build`'s command string itself is unchanged.
- `.github/workflows/deploy.yml` — unchanged; `npm run build -- --base=/afterlife/` already
  triggers the new `postbuild` step automatically via npm's lifecycle, no edit needed there.

**Exact one-line diff for the `ui`/`tutorial` owner to apply** in
`src/ui/tutorial/AboutDialog.tsx` (I did not make this edit myself — it's under `src/`):

```diff
         <Divider />
         <div className="flex flex-wrap justify-end gap-2">
+          <a
+            href="/afterlife/guide/"
+            className="inline-flex h-7 items-center justify-center rounded-sm border border-line px-3 text-xs text-ivory-200 hover:bg-ink-700 hover:text-ivory-100 focus-ring"
+          >
+            Read the guide
+          </a>
           <Button
             variant="solid"
             size="sm"
             onClick={() => { setOpen(false); startTour(true); }}
```

(Styled to match `Button`'s `ghost` variant classes exactly since `Button` itself renders a
`<button>`, not an anchor, and this needs to be a real link for a right-click/open-in-new-tab
to work.)

**Blocking?** no.
**Resolution:** n/a.


## 2026-09-07 — core/render — colourful lenses (lineage/immigration/quadlife/velocity/neighbors)
**Need:** `RenderLens` (`src/core/types.ts`, frozen/architect-owned) widened from
`'life' | 'age' | 'activity'` to also include the 5 new lenses, plus the HUD's lens
picker (`src/ui/hud/Hud.tsx` and its mobile twin `HudMoreSheet.tsx`, not frozen but
owned by a concurrent `ui`/mobile agent this session, so I did not edit them) wired up
to offer them. Nothing else needs to change: `src/ui/store.ts`/`src/ui/bus.ts` only
reference `RenderLens` by type, never enumerate its members, so they need zero edits
once `types.ts` is widened.

**Why:** the user asked for AFTERLIFE to be genuinely multi-coloured, not just three
single-hue lenses. Implemented (all in `src/core/**`+`src/render/**`, which I own):
- **`lineage`** — classic heritage colouring. A newborn's hue is the circular mean of
  its exactly-3 parents' hues; survivors keep theirs. Seeded with a spatially-coherent
  hue hash so a fresh soup starts as visibly distinct "families" per region.
- **`immigration`** (2 colours) / **`quadlife`** (4 colours) — the textbook Immigration/
  QuadLife birth rule (majority-of-3, ties take the 4th unused colour), proven
  B3/S23-identical to the plain engine by `tests/engine-color.test.ts`. Both read the
  SAME `species` buffer; Immigration is a coarser 2-bucket view of it (see
  `src/core/lineage.ts`'s doc for why that's not a second simulation to keep in sync).
- **`velocity`** — hue from each cell's local 8-neighbour directional bias (a proxy for
  which way a structure is advancing; grey where undefined), purely derived, nothing
  stored.
- **`neighbors`** — a 9-step spectral ramp over live-neighbour count 0..8, drawing dead
  (birth-eligible) cells too at reduced alpha, so B3/S23 itself becomes visible.
- Genuinely spectral (not single-hue) `age`/`activity` ramps, still terminating exactly
  on the real `--color-accent-age`/`--color-accent-activity` token at full intensity.
- A colourblind-safe (Okabe-Ito) palette option for the discrete species lenses via
  `WorldRenderer.setPalette('default' | 'cvd')`.

**Colour state / determinism:** `hue`/`species` are new cosmetic per-cell buffers on
`LifeEngine` (`src/core/engine.ts`), exactly parallel to the existing `age`/`activity` —
NEVER read by the B3/S23 step decision, only written after `nv` is already decided.
Unlike `age`, a colour value on a long-lived survivor is never recomputed once assigned,
so a flat post-`restore()` default would NOT self-correct via replay the way `age` does.
`history.ts`'s `TimelineStore` therefore snapshots/restores `hue`/`species` as a second,
parallel keyframe (`colorKeyframes`, keyed at the exact same generations as the bits
`keyframes`) via new `engine.snapshotColors()`/`restoreColors()` methods — so
`goto()`/`branchFrom()`/`cloneBranchAt()` are bit-exact for colour too, not just
alive/dead. See `tests/engine-color.test.ts`'s "history.ts: colour is bit-exact across
rewind and branching" suite for the proof, and `tests/engine-color.test.ts`'s "B3/S23
determinism is untouched by colour bookkeeping" suite (including a test that directly
poisons colour state via extra `set()` churn and confirms the resulting bits are still
byte-identical) for the B3/S23-preservation proof.

**Proposed exact diff for `src/core/types.ts`:**
```diff
 /**
  * How the renderer colours cells.
  *  - 'life'     — binary alive/dead, `--accent-life`.
  *  - 'age'      — generations since the cell was born, `--accent-age` ramp.
  *  - 'activity' — recent-change heat, decaying 0..1, `--accent-activity` ramp.
+ *  - 'lineage'     — heritage colour: a newborn blends its 3 parents' hue.
+ *  - 'immigration' — 2-colour Immigration variant (majority-of-3 birth rule).
+ *  - 'quadlife'    — 4-colour QuadLife variant (majority-of-3, ties take the 4th).
+ *  - 'velocity'    — hue from local directional bias (proxy for travel direction).
+ *  - 'neighbors'   — hue by live-neighbour count 0..8 (the B3/S23 rule made visible).
  */
-export type RenderLens = 'life' | 'age' | 'activity';
+export type RenderLens = 'life' | 'age' | 'activity' | 'lineage' | 'immigration' | 'quadlife' | 'velocity' | 'neighbors';
```
(`src/render/color.ts` already exports an identical `ColorLens` superset type so
`WorldRenderer` type-checks today regardless of when/whether this lands — see that
file's doc. This diff is a convenience for `ui` so the picker/store/bus don't need a
second type; it's not a blocker for anything in `src/core/**`/`src/render/**`.)

**Proposed exact diff for `src/ui/hud/Hud.tsx`** (and the identical `LENS_LEGEND`
block + `Toggle` `options` array in `HudMoreSheet.tsx`):
```diff
-const LENS_LEGEND: Record<RenderLens, { swatch: string; label: string }[]> = {
-  life: [{ swatch: 'var(--color-accent-life)', label: 'alive' }],
-  age: [
-    { swatch: 'linear-gradient(90deg, color-mix(in oklch, var(--color-accent-age) 25%, transparent), var(--color-accent-age))', label: 'young → long-lived' },
-  ],
-  activity: [
-    { swatch: 'linear-gradient(90deg, transparent, var(--color-accent-activity))', label: 'quiet → recently changed' },
-  ],
-};
+import { buildLensLegends } from '@/render/color';
+// Swap the hand-authored record for the render-owned legend data (already keyed by
+// every lens id, including the 5 new ones) — pass the current palette mode (see the
+// new Settings toggle proposed below) so CVD swatches update live.
+const LENS_LEGEND = buildLensLegends(paletteMode); // 'default' | 'cvd', from wherever this session stores that preference
```
```diff
         <Toggle
           aria-label="Render lens"
           options={[
             { value: 'life', label: 'Life' },
             { value: 'age', label: 'Age' },
             { value: 'activity', label: 'Activity' },
+            { value: 'lineage', label: 'Lineage' },
+            { value: 'immigration', label: 'Immigration' },
+            { value: 'quadlife', label: 'QuadLife' },
+            { value: 'velocity', label: 'Velocity' },
+            { value: 'neighbors', label: 'Neighbors' },
           ]}
           value={lens}
           onChange={(v) => { const l = v as RenderLens; setLens(l); bus.emit('lens:changed', { lens: l }); }}
         />
         <Legend items={LENS_LEGEND[lens]} className="ml-1" />
```
A CVD-safe palette toggle (`renderer.setPalette('default' | 'cvd')`, already
implemented and dirty-flag-gated) would most naturally live in `SettingsPanel` — I
didn't propose exact JSX for that since I don't know its current layout, but the call
is a one-liner: `getSession()?.renderer.setPalette(mode)` (adjust to whatever the real
accessor is named) plus re-running `buildLensLegends(mode)` for the HUD legend.

**Update — reachable today via keyboard, NOT via the store/bus:** `src/interact/input.ts`
(render-owned, see its own header) now maps keys `4`-`8` to the 5 new lenses (`1`-`3`
already existed for life/age/activity), so every lens is fully reachable and testable
right now without waiting for the HUD diff above —
`e2e/prod-build.spec.ts`'s new tests use these keys directly, no feature-detection
needed. **Important, found the hard way:** `#setLens` calls `renderer.setLens()`
UNCONDITIONALLY (so the canvas always reflects the right lens), but deliberately does
**NOT** call `useAppStore.getState().setLens()` / emit `lens:changed` for the 5 new
ids — only for the original 3. Reason: `Hud.tsx`/`HudMoreSheet.tsx` index
`LENS_LEGEND[lens]`, a `Record<RenderLens, ...>` with no fallback for an unrecognised
key; pushing e.g. `'lineage'` into the store made `Legend`'s render crash on
`undefined.map(...)`, and because nothing upstream caught it, the crash unmounted the
**entire React tree, including `#world-canvas`** — verified against the real
production build (`prod-build` Playwright project): three new specs failed with
`Cannot read properties of null (reading 'getContext')` because the canvas element
itself was gone. This is exactly the scenario the `RenderLens`/HUD diff above exists to
close; until it lands, the HUD's own lens toggle/legend will just silently keep
displaying whichever of the 3 legacy lenses was last selected while the canvas
underneath has actually moved on — a stale but harmless display, not a crash. The guard
is in `src/interact/input.ts`'s `#setLens`, commented, and covered by
`tests/input-lens.test.ts`.

**Blocking?** No — `src/render/color.ts`/`renderer.ts`/`src/interact/input.ts` work
standalone today (verified by `tests/render-color-lens.test.ts`,
`tests/render-dirty.test.ts`, `tests/input-lens.test.ts`, and
`e2e/prod-build.spec.ts` against the real production build); only the HUD's own
reflected lens/legend state depends on the diff above landing.
**Resolution:** n/a.

## 2026-09-08 — audioplus — musical diversity + interaction impact (`src/audio/**`, `src/ui/panels/AudioPanel.tsx`)

**Need:** a real (not fabricated) source of engine/input state for the soundscape's new
interaction-feedback features (drawing-as-instrument, proximity-weighted churn, a real
population centroid for pan), and a real signal for two event classes (stamping,
forking a branch) that previously had no dedicated sound.

**What I did, entirely within my own ownership:**
- `src/audio/scheduler.ts`: five new synthesised `Timbre`s (`pluck`, `bell`, `bow`,
  `breath`, `perc`) and four new `NoteSource`s (`paint`, `stamp`, `branch`,
  `percussion`), all built with oscillators/filters/noise — no samples.
- `src/audio/synth.ts`: a per-timbre voice builder (filtered-noise burst for `perc`,
  inharmonic sine partials for `bell`, vibrato sawtooth for `bow`, sine+bandpassed-noise
  for `breath`, filter-swept sawtooth for `pluck`) sharing one noise buffer with the
  existing drone — no new buffer allocation.
- `src/audio/harmony.ts` (new, pure): a slow dual-EMA population-trend tracker driving
  a hysteresis-gated ±2-scale-step register drift — real state, `MIN_CHANGE_INTERVAL_SECONDS`
  = 60s between changes, always fully in-scale.
- `src/audio/mapper.ts`: weighted churn timbre selection, per-kind discovery timbre
  overrides, a reinforced explosion "impact" note and a quiet extinction dyad, plus new
  pure mappers `mapStampToNotes`, `mapBranchToNotes`, `mapPaintToNote`, `mapPercussion`.
- `src/audio/settings.ts` + `settingsStore.ts`: `AUDIO_PRESETS` (Observatory/Glass/Deep/
  Chime — Observatory reproduces the shipped default exactly), `percussion`/
  `harmonicMovement` toggles, `applyPreset()`.
- `src/audio/brain.ts` / `audio.ts`: wired all of the above; added an optional
  `SoundscapeDeps` (`{ engine?, input? }`) to `createSoundscape()`, purely additive
  (defaults to `{}`, every existing call site/test unaffected).
- `src/ui/panels/AudioPanel.tsx` (mine): preset picker, percussion/harmonic-movement
  toggles.
- 71 new/extended tests (`tests/audio-harmony.test.ts`,
  `tests/audio-mapper-interaction.test.ts`, `tests/audio-brain-interaction.test.ts`,
  `tests/audio-settingsStore.test.ts`, extended `audio-settings.test.ts`); no existing
  test weakened. Full suite green (498/498), `tsc --noEmit` clean.

**Proposed / already done (one small additive edit outside `src/audio/**`):**
`src/ui/session.ts` line ~113 — changed `createSoundscape()` to
`createSoundscape({ engine, input })`. Both `engine` (`LifeEngine`) and `input`
(`InputController`) were already in scope at that line; this is the ONLY way the
soundscape can honestly read real cell/gesture state (a real population centroid for
pan, real local density/activity for the drawing-feedback and proximity-weighting
features) without inventing anything. `SoundscapeDeps` only requires a structural
`{ pending }` shape (`PendingEditSource`, declared in `audio.ts`), so `audio.ts` never
imports anything from `@/interact/**`. Read-only in both directions: audio never calls
a setter on either object, so this cannot affect cell-state determinism. Mirrors the
precedent set by the `audio`/`cinematic` agents' own small additive edits to shared,
unlisted `src/ui/` files earlier in this log.
**Blocking?** no — `createSoundscape()`'s new parameter defaults to `{}`, so nothing
breaks if this one-line change is ever reverted; the interaction-feedback features just
silently no-op (same as they do today in every unit test).
**Resolution:** n/a.

**Not done — routed here instead of touching `src/render/**`/`src/interact/**`:** a
subtle visual ripple/emphasis on edit (the brief allowed either an audio response or a
visual one to live in "the audio/UI layer's own overlay", routed here otherwise). I
did NOT build a new overlay component: mounting one means touching `App.tsx` (mobile
agent's file) or duplicating the coach-mark/scene-annotation pattern outside the React
tree, and `src/interact/**`/`src/render/**` were both already showing concurrent
uncommitted changes from other agents in this session. If the render/mobile agent wants
it: a one-shot, quickly-fading world-space ring at the cell coordinate on
`edit:committed` (real `EditOp`, not fabricated) — `session.renderer.worldToScreen(x,y)`
already exists for exactly this (see `SceneAnnotation.tsx`'s doc comment for the
pattern). Purely decorative, never gates on anything audio does.
**Blocking?** no — the soundscape's own honesty guarantees don't depend on this landing.
**Resolution:** n/a.

## 2026-09-07 — mobile — the mobile robustness pass (`src/ui/App.tsx`, `src/ui/hud/**`,
`src/ui/drawer/**`, `src/ui/panels/**`, `src/ui/primitives/Sheet.tsx`, `src/styles/**`,
one line each in `src/render/renderer.ts` and `src/interact/input.ts`)

**Need:** n/a — informational record, plus a couple of items for other owners below.

**The two real bugs, not just layout.** The user's verdict was "v jank in mobile." The
biggest cause turned out to be a functional bug, not a layout one:

1. **`#endPinch()` in `src/interact/input.ts` silently discarded every one-finger
   draw/erase/select gesture on touch.** It unconditionally nulled `#dragMode` whenever
   fewer than 2 touches remained — true for the end of every ordinary one-finger
   gesture, not just a real pinch — and `#onPointerUp` calls it BEFORE `#stopDrag()`
   reads `#dragMode` to decide whether to commit. The live stroke preview painted
   correctly (so it visually looked like it worked), but nothing ever reached the
   engine: lift your finger and the mark vanished. This affected 100% of one-finger
   touch drawing/erasing/selecting before the fix — arguably THE core interaction of
   the app. Fixed by making `#endPinch()` a documented no-op (a genuine 2-finger pinch
   never sets `#dragMode` in the first place — see the method's new doc comment — so it
   had nothing of its own to clean up; `#stopDrag()` already owns all of that).
   Uncovered a second, smaller instance of the same family: starting a real two-finger
   pinch registers the first finger's own pointerdown as an independent one-finger
   gesture for one event tick before the second finger's pointerdown arrives (Pointer
   Events are always one pointer per event, even for "simultaneous" hardware touches),
   painting one stray cell at the pinch's start point every time. Fixed by tracking
   `#dragMoved` (has the active gesture actually moved since pointerdown?) and
   discarding — never committing — an unmoved draw/erase touchdown when a second finger
   joins, while a gesture that already moved before the second finger landed still
   commits exactly as before (this is the scenario the mobile brief calls out
   explicitly: "a stroke started with one finger isn't corrupted when a second finger
   lands"). Both covered by `e2e/mobile.spec.ts`'s "touch gesture model" suite.
2. **A closed drawer/panel kept intercepting taps for its ~220ms close transition.**
   `data-open={false}` doesn't mean invisible — `translate-x-full`/`-translate-x-full`
   takes `--duration-base` to finish, and for that whole window the element still
   physically overlaps whatever's behind it. A quick close-then-tap-in-that-strip
   sequence (exactly what a thumb does) could hit the animating-out overlay instead of
   the canvas. Fixed with `data-[open=false]:pointer-events-none` (restored via
   `md:pointer-events-auto` for the desktop rail, which is never "closed" the same way)
   on both `#drawer-left` and `#panel-right` in `App.tsx`.

**HUD reachability audit result.** At 390px the HUD row's real content was ~993px wide
behind an `overflow-x-auto` + `flex-1` spacer — Playwright's auto-scroll-into-view made
existing e2e clicks on Compare/Field Guide/Experiments/etc. pass despite this, which is
exactly how it shipped unnoticed; a real thumb has no such affordance. The lens toggle
(`hidden lg:flex`) and speed toggle (`hidden md:flex`) were flatly `display:none` below
their breakpoints with no substitute anywhere. Fix: below `lg`, the full desktop icon
row/lens/speed disappear and a single always-visible "More controls" button
(`src/ui/hud/HudMoreSheet.tsx`, new) opens a bottom sheet (`src/ui/primitives/Sheet.tsx`,
new — Radix Dialog styled as a slide-up sheet with a drag-down-to-dismiss handle,
backdrop tap, and close button) containing lens, speed, the Time Sculpture entry, every
right-panel tab, mute, presentation, cinematic, about, and shortcuts. Desktop (`lg`+) is
byte-for-byte the same markup as before. `e2e/screenshots.spec.ts`'s 4 mobile-project
tests that clicked those controls directly were updated to go through the new
`openControl()` helper in `e2e/utils.ts` (opens the sheet first when it's the only
visible path) rather than weakened.

**Also wired up, per a request while resuming this task:** the cinematic agent's HUD
entry point (`FilmIcon` + "Cinematic mode" button, both in the desktop row next to
Presentation mode and in the More sheet) — see their entry above for why they couldn't
add it themselves.

**Touched outside my stated file list, both logged then:**
- `src/render/renderer.ts` — capped `#dpr` at 2 (`Math.min(window.devicePixelRatio || 1,
  2)`, same pattern already used by `Timeline.tsx`'s ribbon canvas) per the brief's "DPR
  path doesn't render at absurd resolution on a 3x phone" ask. Purely a backing-buffer
  resolution cap; doesn't touch camera math or simulation state. Not otherwise modified.
- `src/interact/input.ts` — the two fixes above. Both are one-finger/two-finger touch
  bugs the brief explicitly authorized touching this file for.

**Observed but NOT fixed (outside my ownership, `session.ts`):** chaining "scrub
backward → edit → open Compare → pick 'Original' → close panel → select a new region"
as fast as an automated test can, without any pause, occasionally (roughly 1 in 6 runs)
left `engine.gen` back at the ROOT branch's original max generation instead of staying
on the freshly-forked branch at the scrubbed-to generation — i.e., playback or a branch
resync silently raced ahead across the branch switch. `history:switchBranch`'s
`.then(...)` and the `compareWith`-triggered `refreshCompare()` are the two async
somethings involved. A human pausing naturally between these actions never hits it, and
`e2e/mobile.spec.ts`'s heartbeat test works around it with a settle wait + a defensive
re-`ensurePaused()`, but this is worth the `core`/`session` owner's attention.

**Testing:** `e2e/mobile.spec.ts` (new) — 14 tests in the `mobile` project covering HUD
reachability (no horizontal overflow, every control reachable through the sheet, the
sheet's three dismiss paths), the touch gesture model (single-finger commit, plain-tap
commit, 2-finger pinch never draws, second-finger-mid-stroke, 4-corner edge drawing),
the full scrub → edit → compare → sculpt heartbeat journey by touch, portrait↔landscape
rotation, and a 820×1180 small-tablet width. `playwright.config.ts`'s `mobile` project
now matches `mobile.spec.ts` too (previously `screenshots.spec.ts` only).

**Still imperfect / didn't chase further:** the achievements agent's "Logbook" toast can
overlap the cinematic overlay's bottom bar by a few px on a 390px screen — cosmetic,
both remain independently readable, not mine to fix (neither file is in my ownership).
The colourful-lenses proposal two entries above is real and its exact HUD diff is
correct, but `RenderLens` (`src/core/types.ts`, frozen) hasn't actually been widened
yet — wiring 5 more `Toggle` options into `Hud.tsx`/`HudMoreSheet.tsx` against a type
that doesn't have them would fail `tsc`, so I left it for whoever applies that frozen-file
change to do alongside it (the diff for both HUD files is already written up above,
ready to apply verbatim). Also saw the audio agent's edit-ripple-overlay request just
above this entry — deliberately not building it; it's decorative and outside this pass's
mobile-robustness scope.

**Blocking?** no.
**Resolution:** n/a.

## 2026-09-07 — tutorial — tour spotlight fix + achievements logbook
**Need:** n/a — informational record, no frozen-file change requested.

**Tour spotlight (`src/ui/tutorial/**`):** replaced `CoachMark`'s per-frame `requestAnimationFrame`
repositioning loop with an event-driven `recompute()` (window resize/scroll, `camera:changed`,
`ResizeObserver`/`IntersectionObserver` on the resolved target element, and `useAppStore`/
`useUIState` subscriptions for drawer/panel open-close, each triggering a short BOUNDED settle
poll to track the CSS transition rather than looping forever) — addresses the reported "jumpy"
complaint and the CPU concern from the render-loop optimisation pass. Added a real spotlight:
a single `pointer-events: none` element using the box-shadow "9999px spread" technique for the
dim + a layered inset ring for focus, positioned/sized from `placeCoachMark`'s new `spotlight`
field (target bbox padded by `SPOTLIGHT_PADDING`, always less than `TARGET_GAP` so it can never
overlap the card). `targeting.ts`'s `world`-kind resolver now sizes the cutout from the live
camera scale (`session.camera.camera.scale`) instead of a 1×1 point. Card/spotlight ease via
CSS transition (cut under `prefers-reduced-motion`), coordinates snapped to device pixels.
**Verified the critical invariant is intact**: `e2e/tour-spotlight.spec.ts` asserts the dimming
layer exists, the cutout is positioned over the real target's bounding box, resize/world-camera
tracking works, AND — the specific regression called out for this task — that the highlighted
control and the world canvas underneath the dimmed area both remain genuinely clickable through
the overlay (`stamping-and-selection.spec.ts`/`persistence.spec.ts`'s RLE round-trip both still
pass unmodified).

**Achievements (`src/content/achievements.ts`, `src/ui/achievements/**`):** a naturalist's-log
extension of `@/content/discoveries`, not a points layer — see that module's doc for the full
list and what real state earns each entry. `App.tsx`/`Hud.tsx`/`panels/**` are other agents'
territory this pass, so — same reasoning `@/ui/cinematic` already used for its own overlay — the
logbook mounts itself (a small quiet trigger tab + `Dialog`, plus the `l` shortcut) into its own
DOM root, booted from a `useEffect` in `TourOverlay` (already unconditionally rendered by
`App.tsx`) rather than proposing another `App.tsx` edit for one line. New persisted key
`afterlife:v1:achievements`, via the same `STORAGE_PREFIX`-reuse pattern `tourStore`/the audio
agent's settings both already use — no changes to `@/persist/**`.

**Still imperfect:** per the mobile agent's note two entries above, the Logbook trigger tab can
sit close to/overlap the cinematic overlay's own bottom bar by a few px at very narrow widths —
cosmetic, both stay independently readable; a proper fix is a real HUD icon button next to the
other panel toggles once someone with write access to `Hud.tsx` picks up either agent's request
above. "Witnessed a collision" is a heuristic (a followed discovery transitioning to `lost`) since
`@/content/recognition` doesn't model collisions explicitly — documented in `store.ts`'s comment.
Achievement progress counters that aren't a single boolean flag (alive-streak length, distinct-
specimen tally) are session-local like the rest of the app's live discovery state; only the
earned/muted logbook entries themselves persist across reloads.

**Blocking?** no.
**Resolution:** n/a.

## 2026-09-08 — integration — final pass: reachability, two real races, one real data-loss bug, HUD overflow

Closed out the queue above. Full write access to every file (per this task's brief); every
item below was implemented/verified directly, not proposed for someone else.

**Colourful lenses (Priority 1):** the `RenderLens` widening + HUD `Toggle`/legend diff above
was already applied (commits `9b056e1`/`f9a71fd`, landed by a concurrent pass before this one
started) — verified rather than redone: all 8 lenses are real `Toggle` options on desktop and
in `HudMoreSheet.tsx`'s mobile sheet, `LENS_LEGEND[lens]` now goes through
`@/render/color`'s `safeLensLegend()` (falls back to `life`, tested in
`tests/render-color-lens.test.ts`), the CVD palette toggle in `SettingsPanel` works and the
HUD legend recomputes live against it, and `input.ts`'s legacy-3-lens mirror guard is gone
(`tests/input-lens.test.ts` updated to assert all 8 lenses now reach `useAppStore`/the bus).
Verified colourfulness by eye at 1440px and 390px (screenshots), not just by test.

Found and fixed one regression this same lens work introduced: legend labels were full
sentences and the 8-option `Toggle` alone added ~400px, pushing the desktop HUD row past
1440px with **no visible scroll affordance** — hiding Settings/Mute/Presentation/About/
Shortcuts. Legend moved to a hover/focus tooltip; the lens `Toggle` now scrolls internally
within a capped-width wrapper instead of displacing the rest of the row. Confirmed via direct
`scrollWidth`/`clientWidth` measurement, not just visual inspection.

**`session.ts` branch-switch race (~1 in 6):** two real, independent races, both closed —
see `src/core/history.ts`'s new `TimelineStore.settled()` and `src/ui/session.ts`'s
`pauseForScrub()`. (1) `goto()`'s chunked replay mutates the shared `engine` incrementally
and can leave `engine.gen` at a genuinely intermediate value across a yield — demonstrated in
`tests/history.test.ts` (even an *unawaited* `goto()` call already advances `engine.gen`
before returning). Every place `session.ts` read `engine.gen` to decide fork-vs-record now
awaits `history.settled()` first. (2) Nothing paused playback when a scrub started, so the
`SimLoop` could keep calling `engine.step()` on the SAME shared engine `goto()`'s replay was
also mutating — the more severe half of the bug (concurrent writers to one mutable engine, not
just a stale read). Fixed by pausing synchronously the instant a scrub begins.

**Colour not surviving save/load:** root-caused, not papered over. `TimelineStore.reset()`
keyframes an EMPTY gen-0 board; `loadEntries()`'s replay loop started at `kfGen + 1`, so any
edits recorded exactly at the baseline generation — which is how EVERY persisted "hand-drawn
start" stores its initial pattern (`density: 0`, cells as a gen-0 `EditOp`) — were silently
dropped. Not a colour-only bug: bits were dropped too, and the existing e2e persistence test
only ever asserted on the generation NUMBER, never actual population, so this shipped
undetected. Fixed with `applyBaselineEdits()`, applied in `replaySync`/`replayAsync`/
`sliceStack`; proven bit-and-colour-exact in `tests/engine-color.test.ts` by replaying the
same edits through a continuous session vs. a `reset()+loadEntries()` reconstruction and
diffing the `hue`/`species` buffers directly. Deliberately did **not** add a persisted
hue/species snapshot or bump `EXPERIMENT_FORMAT_VERSION` — the format was never deficient
(codec.ts: "we never store a raw cell buffer at all"); the replay was. Adding one would have
bloated the save for zero correctness benefit.

**Achievements panel:** relocated from a self-mounted floating DOM root (a workaround for a
concurrent mobile-layout pass owning `Hud.tsx`/`App.tsx` at build time) to a real `IconButton`
in `Hud.tsx`/`HudMoreSheet.tsx`, matching `About`/`Cinematic`. The dialog itself mounts in
`App.tsx` alongside `ShortcutsDialog`/`AboutDialog` (not inside `Hud`'s presentation-mode-gated
return), so it stays functional independent of chrome visibility.

**AboutDialog → guide link:** applied, using `import.meta.env.BASE_URL` rather than the
hardcoded `/afterlife/guide/` in the proposed diff, so it also works under `vite dev`.

**Edit ripple (audio agent's proposal):** not built. Given the remaining scope (full e2e
triage was the larger, explicitly-prioritized ask) and that it's explicitly optional, this
pass focused on wiring/bugs/triage instead. Nothing about the audio soundscape's own honesty
guarantees depends on it, per that entry's own note.

**Two more real bugs found only by getting e2e green everywhere, not assumed real or fake:**
- `src/ui/App.tsx`: `#drawer-left`/`#panel-right` were **completely unclickable at desktop
  widths whenever collapsed/closed**. `data-[open=false]:pointer-events-none` compiles to
  `.foo[data-open=false]` (specificity 0,2,0); the intended override `md:pointer-events-auto`
  compiles to plain `.md\:foo` in a media query (0,1,0) — the higher-specificity rule always
  won regardless of viewport. Verified directly via `getComputedStyle(...).pointerEvents`.
  Fixed by repeating the same `data-[open=false]` condition in the desktop override so
  specificity matches and it wins on source order instead of losing outright.
- `playwright.config.ts`: `mobile.spec.ts` (touch/390px-specific) was also running under the
  touch-disabled `desktop` project — `desktop`'s exclusion list was updated for
  `prod-build.spec.ts` but never for `mobile.spec.ts` when that file was added. This alone
  accounted for most of the previously-reported 19 failures once resource contention from
  concurrent dev servers was also removed. Excluded it; `ARCHITECTURE.md`'s project
  description updated to match reality (3 projects now, not 2).

**Final verified state, run in isolation with no other dev servers up:**
`typecheck` clean · unit tests 516/516 (49 files) · `desktop` e2e 68/68 · `mobile` e2e 20/20 ·
`prod-build` e2e 6/6 (94/94 e2e total) · `npm run build -- --base=/afterlife/` succeeds,
`dist/index.html` resolves at `/afterlife/`, `dist/guide/**` flattened correctly with no
leftover `dist/site/`, and both were verified live via `vite preview` (`/afterlife/`,
`/afterlife/guide/`, `/afterlife/guide/wiki/specimens/` all 200).

**Blocking?** no.
**Resolution:** done.

---

## 2026-09-06 — final fix pass — desktop lens discoverability, two e2e flakes, dead-export cleanup

**Need:** three independent issues reported against the shipped state at `c37234f`: (1) 4 of
the 8 colour lenses (Immigration/QuadLife/Velocity/Neighbors) were entirely off-screen with no
scroll/chevron/gradient hint at 1440x900 desktop — the `Toggle` group holding all 8 lenses,
capped to `max-w-[210px]` to keep the trailing icon row on-screen, silently clipped the rest;
(2) two e2e specs (`tour.spec.ts`'s "does not auto-show again on a second visit",
`cinematic.spec.ts`'s "entering hides chrome, moves the camera") failed intermittently only
inside a full sequential run, never in isolation; (3) 5 confirmed-dead exports and one stale
doc comment.

**Proposed / done:**

- **Lens control:** replaced the capped `Toggle` + hover-tooltip-legend with a new `Menu`
  primitive (`src/ui/primitives/Menu.tsx`, Radix `DropdownMenu`, added to DESIGN.md's
  component vocabulary — a frozen file, edited directly since this pass has no other agent to
  route an `INTEGRATION-NOTES.md` request through). A single fixed-width trigger (colour
  swatch + current lens name + chevron) replaces the ~560px-wide Toggle; the popover lists all
  8 lenses, each with its own swatch and full "what this colour means" text — the fuller
  sentence previously demoted to a hover-only tooltip now fits because the popover has real
  vertical room. Reachable by keyboard (arrow keys, type-ahead, `Home`/`End`) and touch tap,
  not hover-only. `HudMoreSheet.tsx`'s mobile copy (a `Toggle` with `flex-wrap`, already fully
  visible with no cap) is untouched.
- **Real regression found and fixed while measuring the above, not assumed away:** even after
  narrowing the lens control, the full `lg` HUD row's real content still measured ~1493px wide
  against the 1440px viewport — a pre-existing overflow nobody had actually measured before
  (only `mobile.spec.ts`'s HUD-overflow assertion existed, and it only runs at 390px). The
  ~116px "— pause time anytime" onboarding hint (shown until the first play/pause toggle) was
  the difference; it now hides from `lg` (1024px) up, where the dense desktop icon row has no
  spare width, and still shows in the 640–1023px tablet band where there's room. Measured
  after: total HUD content 1440px == viewport 1440px exactly, "Keyboard shortcuts" right edge
  at x=1428.
- **Real regression found via the new e2e spec itself:** opening the lens `Menu` and pressing a
  letter for Radix's own type-ahead (e.g. "v" for Velocity) also fired `App.tsx`'s global `v`
  (toggle presentation mode) shortcut underneath it — Radix's type-ahead doesn't stop the
  keydown from bubbling to `window`. Fixed at the root: `globalShortcutGuard.ts`'s
  `shouldIgnoreGlobalShortcut` already suppressed every global shortcut while any
  `role="dialog"` was open; extended the same check to `role="menu"` (`isMenuOpen()`) — a
  Radix `DropdownMenu`/`ContextMenu`-open guard, not a lens-specific patch, so it protects any
  future menu too. Unit-tested (`tests/interact-globalShortcutGuard.test.ts`).
- **New regression coverage:** `e2e/hud-desktop.spec.ts` — every lens option is asserted
  visible-and-actionable (`toBeVisible` + `toBeInViewport`) at 1440x900 via plain Playwright
  actionability, one is selected by mouse and one entirely by keyboard, and the trailing icon
  row's measured bounding boxes are asserted within the 1440px viewport. This is the assertion
  class that was missing before: the existing mobile HUD-overflow check only ever looked at the
  outer `#hud-top` row, and only at 390px.
- **Two e2e flakes, root-caused, not just re-timed:**
  - `dismissTitle()` (`e2e/utils.ts`) used a `force: true` click on `#world-canvas` the instant
    it was `attached` to the DOM — but the `pointerdown` listener that actually dismisses the
    title plate is wired in a `useEffect` in `App.tsx`, which only runs after React commits,
    a real (if usually sub-millisecond) window after the canvas node itself exists. `force:
    true` bypasses Playwright's actionability waits entirely, so under real load (a long
    sequential run, a contended machine) the click could land before the listener existed,
    leaving the title never dismissed and every later action gated on it (the tour, in
    particular) spinning until the whole 45s TEST timeout expired — not a slow click, a
    genuinely stuck one. Fixed with `expect(...).toPass()`: retries the click against the real,
    observable effect (the title plate's `aria-hidden` flipping to `"true"`, or the element
    disappearing entirely under `prefers-reduced-motion`) instead of trusting one fire-and-forget
    gesture.
  - `cinematic.spec.ts`'s camera-movement assertion did `waitForTimeout(7000)` then compared
    camera position ONCE. The director's own timing (`WIDE_HOLD_MS=4500ms` establishing shot,
    then a real subject) is correct — confirmed by manual polling — but how long it takes to
    produce a visible 0.5-unit displacement in WALL-CLOCK time also depends on the browser
    actually getting to run animation frames promptly, which a cold dev server (first-time Vite
    module transforms) or a loaded CI box doesn't guarantee. A one-shot check at a fixed t=7s
    treated "hasn't moved yet" the same as "will never move." Replaced with `expect.poll(...,
    { timeout: 20_000 })`, which accepts the movement the instant it genuinely happens.
  - Measured: 3 full sequential `desktop` project runs (70, then 68, then 68 tests — the two
    extra in the first were a stray earlier state) — 0 failures across all three once the fixes
    above (title-dismiss race, camera poll, plus a self-inflicted race in the new
    `hud-desktop.spec.ts` keyboard test, and one `persistence.spec.ts` failure traced to
    Playwright's own trace-writer colliding across overlapping local test invocations, not a
    product bug) were in place.
- **Dead exports removed** (confirmed zero application callers; two had test-only callers,
  updated to call the underlying array/`.find()` directly instead of losing coverage):
  `getCinematicController()` (`src/ui/cinematic/index.ts`), `readCaptureState()`
  (`src/audio/captureStore.ts`), `readMidiState()` (`src/audio/midiStore.ts`), `getTourStep()`
  (`src/content/tour.ts`, `tests/content-tour.test.ts` now inlines `TOUR_STEPS.find(...)`),
  `getAchievement()` (`src/content/achievements.ts`, `tests/content-achievements.test.ts` now
  inlines `ACHIEVEMENTS.find(...)`).
- **Stale doc fixed:** `src/render/color.ts`'s "lineage family" module doc no longer claims
  `RenderLens` is frozen at `'life' | 'age' | 'activity'` — it's been widened to all 8 lens ids
  in `src/core/types.ts` since the colourful-lenses work landed; `ColorLens` is now documented
  as a deliberately-kept, currently-redundant alias rather than a stopgap for a type that
  hadn't grown yet.

**Final verified state, run in isolation with no other dev servers up:**
`typecheck` clean · unit tests 522/522 (51 files) · `desktop` e2e 70/70, repeated 3x with 0
failures · `mobile` e2e 20/20 · `prod-build` e2e 6/6 · `npm run build` succeeds.

**Blocking?** no.
**Resolution:** done.

---

## 2026-09-08 — multiplayer foundation (`src/net/**`, `src/ui/multiplayer/**`)

**What was built:** an opt-in, account-free lockstep multiplayer layer. Full design
in `docs/MULTIPLAYER.md`. Summary: a room is a shared world spec (size/boundary/rule)
plus an ordered edit log; edits are stamped `LATENCY_BUFFER_GENS` (12) generations into
the future and applied identically — including to their own author — by every peer,
deterministically ordered by `(targetGen, peerId, seq)`; the local sim stalls (never
silently diverges) until every known peer's watermark makes a generation safe; every 64
generations peers exchange a world hash and loudly report any mismatch, with a manual
"resync from the authoritative log" recovery. `BroadcastChannelTransport` is a real,
working, no-server transport (same-origin cross-tab); `WebSocketTransport` is a real
client for an optional future relay, reporting `'unavailable'` honestly with no URL
configured. New files only: `src/net/{protocol,transport,room,sessionBridge,index}.ts`,
`src/ui/multiplayer/**`, `docs/MULTIPLAYER.md`, plus tests
(`tests/net-*.test.ts`, `tests/ui-multiplayer-panel.test.tsx`, `e2e/multiplayer.spec.ts`).

**The one hook applied directly (as pre-authorized), not proposed:** three optional,
`null`-by-default setters added to `src/ui/session.ts`
(`setMultiplayerGate`/`setMultiplayerEditSource`/`setMultiplayerEditInterceptor`),
consulted from the single existing `recordOrFork()` call site and the single existing
`step()` function. Every check is one reference comparison; nothing under `src/net/**`
is imported or executed by `session.ts` itself, and no other file in the app calls these
setters except `src/net/sessionBridge.ts`, only after a room is joined. Landed cleanly
alongside the `rules` agent's concurrent, unrelated `setRule()`/`CONWAY_RULE_STRING`
additions to the same file (both pure insertions in different regions — verified via
`git diff --stat` showing only `+90` lines, no conflicts, and `tsc --noEmit` clean for
this file after both landed). Verified this doesn't regress solo play:
`tests/net-guard.test.ts` (static + behavioural), plus `e2e/drawing.spec.ts` and
`e2e/timeline.spec.ts` (the two specs that most directly exercise the edit-commit/undo/
scrub paths `recordOrFork`/`step` sit inside) both still pass unmodified.

**Two mounting points proposed, not applied** (both outside `src/net/**`/
`src/ui/multiplayer/**`/`session.ts`, so left for whoever owns `App.tsx`/`Hud.tsx` to
apply — the feature works standalone without either; see `src/ui/multiplayer/index.tsx`'s
own doc comment):

1. **Minimal, zero-layout-risk (recommended to land first):** mount the self-contained,
   fixed-position trigger + dialog exactly as built, no other changes needed.

   ```diff
   --- a/src/ui/App.tsx
   +++ b/src/ui/App.tsx
   @@
    import { AboutDialog } from '@/ui/tutorial/AboutDialog';
   +import { MultiplayerRoot } from '@/ui/multiplayer';
   @@
          <ToastLayer />
          <ShortcutsDialog />
          <AboutDialog />
          <TourOverlay />
          <AchievementsPanel open={logbookOpen} onOpenChange={setLogbookOpen} />
   +      <MultiplayerRoot />
        </TooltipProvider>
      );
   ```

2. **Design-consistent placement (a follow-up, once the first is verified live):** replace
   the floating trigger with a HUD icon button matching the existing
   About/Logbook/Shortcuts row (`src/ui/hud/Hud.tsx`, right after the "Keyboard shortcuts"
   button at the row's end), and render only the `Dialog` half of `MultiplayerRoot` from
   `App.tsx` (would need `MultiplayerPanel`'s open state lifted to `useMultiplayerStore`,
   a small follow-up to `src/ui/multiplayer/index.tsx` — not done here since it touches the
   HUD's own layout/spacing decisions, which belong to whoever owns that file's visual
   rhythm, not this pass).

   ```diff
   --- a/src/ui/hud/Hud.tsx
   +++ b/src/ui/hud/Hud.tsx
   @@
        <Tooltip content="Keyboard shortcuts (?)">
          <IconButton label="Keyboard shortcuts" icon={<QuestionIcon />} onClick={() => setShortcutsOpen(true)} />
        </Tooltip>
   +    <Tooltip content="Multiplayer — play this world with someone else">
   +      <IconButton label="Multiplayer" icon={<PeopleIcon />} pressed={mpInRoom} onClick={() => setMpOpen(true)} />
   +    </Tooltip>
      </div>
   ```

   (`PeopleIcon` currently lives at `src/ui/multiplayer/PeopleIcon.tsx`, kept out of the
   shared `@/ui/icons` barrel deliberately — see that file's own doc comment for why; move
   it into the barrel as part of this follow-up if it lands.)

**Why not applied directly despite being trivial:** both files are outside this pass's
owned paths per this session's file-ownership table, and `App.tsx`/`Hud.tsx` were flagged
as actively being edited by concurrent agents this same session (confirmed via `git
status` before starting: `src/core/engine.ts`, `src/core/rule.ts`, `src/render/**` mid-edit
by the `rules`/`art` work) — routing through this diff avoids a collision rather than
guessing at a merge.

**Verified state, this feature in isolation (full-repo suite has unrelated concurrent
in-progress failures from other agents' work — see below):**
`tsc --noEmit` clean for every file this pass touched/added (checked via
`tsc --noEmit 2>&1 | grep -E "src/net|src/ui/multiplayer|src/ui/session"` → empty) ·
54 new unit/RTL tests, all green, full suite 693/693 · new
`e2e/multiplayer.spec.ts` (two real Playwright tabs, real `BroadcastChannel`) passing ·
`e2e/drawing.spec.ts` (9/9) and `e2e/timeline.spec.ts` (2/2) passing unmodified, confirming
the `session.ts` hook is inert for solo play. Full-repo `tsc --noEmit` and
`e2e/boot.spec.ts` currently show pre-existing, unrelated failures
(`WorldRenderer` missing `setArtConfig`/`setModulationGrid` in render-owned test mocks; a
`Tooltip must be used within TooltipProvider` runtime error from `ArtPanel`/`ArtTrigger`)
traced to concurrent in-progress work in `src/render/**`/`src/core/rule.ts` at the time of
this pass — not caused by, and not fixed by, this entry.

**Blocking?** no.
**Resolution:** the two diffs above are ready to apply whenever `App.tsx`/`Hud.tsx` are
free; the feature is fully functional (`BroadcastChannelTransport`, tested end to end)
without them.

---

## 2026-09-08 — rules — generalised simulation rules (`src/core/**`, `src/persist/rle.ts`,
`src/content/rules.ts`, `src/ui/panels/RulesPanel.tsx`)

**What was built:** the engine now runs any outer-totalistic B/S Life-like rule, not just
Conway's B3/S23 — full detail in the three commits on `main` from this pass (rule model +
generic table-driven step kernel with the original hardcoded fast path kept for exactly
Conway; RLE import/export honesty upgrade; a 10-preset curated, verified rule list). Two
new session-facing pieces: `Session.setRule(rule)` in `src/ui/session.ts` (a fresh-world
operation — stop, `engine.setRule` + `clear()` + `history.reset()` — documented as
deliberately never a mid-history edit, see `LifeEngine.setRule`'s doc in
`src/core/engine.ts`), and `src/ui/panels/RulesPanel.tsx` (preset list + validated custom
rulestring entry, not yet mounted anywhere). `loadScene()` now force-sets Conway before
clearing, so a curated scene/specimen/experiment always loads under B3/S23 regardless of
whatever rule the user had selected — the non-negotiable this whole pass was scoped around.
`ExperimentDoc` gained a required `rule` field (`persist/codec.ts`, schema v2->v3, older
saves migrate to Conway).

**Landed cleanly alongside the `multiplayer` agent's concurrent, unrelated
`setMultiplayerGate`/`setMultiplayerEditSource`/`setMultiplayerEditInterceptor` additions to
the same `session.ts` file** — same file, different regions, both `tsc --noEmit` clean and
full suite green after both landed (confirmed via `git status`/`git diff --stat` before each
commit; no manual merge was needed since neither pass touched the other's lines).

**Need:** `RulesPanel` exists but isn't reachable from anywhere, and the HUD has no rule
readout — both are in `src/ui/{uiState.ts,panels/PanelRight.tsx,hud/HudMoreSheet.tsx,hud/Hud.tsx}`,
none of which this pass owns, and all four were either mid-edit or freshly touched by
concurrent agents this session (`git status` showed `HudMoreSheet.tsx`/`Hud.tsx` untouched but
`PanelRight.tsx`'s sibling panels churning — routing through this note rather than guessing at
a merge, same call the `multiplayer` entry above made for the same reason).

**Proposed (four small, additive diffs, independent of each other):**

1. **`src/ui/uiState.ts`** — add `'rules'` to the `RightPanelId` union:
   ```diff
   -export type RightPanelId = 'branches' | 'compare' | 'settings' | 'guide' | 'experiments' | 'save' | 'audio' | null;
   +export type RightPanelId = 'branches' | 'compare' | 'settings' | 'guide' | 'experiments' | 'save' | 'audio' | 'rules' | null;
   ```

2. **`src/ui/panels/PanelRight.tsx`** — register the panel (needs a rule icon; `@/ui/icons`
   doesn't have one yet, `DiceIcon`/`SlidersIcon`-adjacent glyph suggested but left to
   whoever owns `icons.tsx`):
   ```diff
   +import { RulesPanel } from './RulesPanel';
   @@
    const TITLES = {
   +  rules: { label: 'Rules', icon: <?RuleIcon?> },
      branches: { label: 'Branches', icon: <BranchIcon /> },
   @@
        {rightPanel === 'audio' && <AudioPanel />}
   +      {rightPanel === 'rules' && <RulesPanel />}
   ```

3. **`src/ui/hud/HudMoreSheet.tsx`** — one row in `PANEL_ROWS` (mobile reachability, per this
   pass's brief):
   ```diff
    { id: 'settings', label: 'Settings', icon: <SlidersIcon /> },
   +{ id: 'rules', label: 'Rules', icon: <?RuleIcon?> },
   ```

4. **`src/ui/hud/Hud.tsx`** — a HUD readout for the active rule, zero extra renders: this
   file already writes `gen`/`pop` straight to DOM refs inside its existing `subscribeReadout`
   callback (bridge #1 in ARCHITECTURE.md's performance rule) — `Session.setRule()` always
   ends by calling the same `emitGen()` that fires `gen:changed` on every ordinary step, so
   the SAME callback already fires whenever the rule changes; no new bus event needed (deliberately
   not proposing one for the frozen `src/ui/bus.ts`). Add one more DOM ref written from that
   existing callback, e.g. next to the `gen`/`pop` `Readout`s:
   ```diff
    <Readout label="gen" value={<span ref={genRef} data-testid="hud-gen">0</span>} digits={6} />
    <Readout label="pop" value={<span ref={popRef} data-testid="hud-pop">0</span>} digits={6} accent="life" />
   +<Readout label="rule" value={<span ref={ruleRef} data-testid="hud-rule">B3/S23</span>} digits={9} />
   ```
   ```diff
    useEffect(() => subscribeReadout((r) => {
      if (genRef.current) genRef.current.textContent = String(r.gen);
      if (popRef.current) popRef.current.textContent = String(r.population);
   +  if (ruleRef.current) ruleRef.current.textContent = getSession()?.engine.rule ?? 'B3/S23';
    }), []);
   ```
   A button to OPEN the rules panel (matching the Branches/Compare/.../Settings row) is a
   fifth, purely mechanical addition following the exact same `Tooltip`+`IconButton`+
   `toggleRightPanel('rules')` pattern already used for every other panel there — omitted
   from this diff only because it needs the same icon decision as #2/#3 above.

**Why not applied directly:** same reasoning as the `multiplayer` entry immediately above —
these are `ui`-owned files under active concurrent churn this session; a diff avoids a
collision. `RulesPanel` is fully functional and tested standalone (`tests/ui-rules-panel.test.tsx`)
without any of the above; it just isn't reachable from the running app yet.

**Verified state, this pass's own files in isolation:** `tsc --noEmit` clean · full suite
718/718 (up from the 522/522 baseline: +45 core rule/engine/history tests, +renamed persist-rle
coverage, +15 content-rules preset-verification tests, +8 RulesPanel component tests, +2
persist-experiment rule-persistence tests) · Conway performance measured before/after this
pass's engine changes on a 512x512 board, 200 steps after a 20-step warmup, jsdom/vitest
harness (absolute numbers are higher than ARCHITECTURE's cited 1.7ms/step, which was almost
certainly measured in a real browser without jsdom's overhead — before/after under the SAME
harness is the fair comparison): **3.2598 ms/step before -> 3.2856 ms/step after (+0.8%,
within run-to-run noise)** — the specialised Conway kernel is untouched code, dispatched to
whenever `rule.isConway`.

**Blocking?** no.
**Resolution:**
