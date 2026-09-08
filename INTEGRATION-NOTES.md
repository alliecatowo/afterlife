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
