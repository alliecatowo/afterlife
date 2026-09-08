# Verification summary

Everything in this document was produced by actually simulating the rules — with
`docs/verification/life.mjs` (a standalone, dependency-free reimplementation of
the same B3/S23 step used in `src/core/engine.ts`) and `docs/verification/sparse.mjs`
(a sparse/unbounded-grid variant, for the literature comparisons where a fixed
torus would distort the result) — not recalled from memory or asserted on faith.
The full logs, generation-by-generation population tables and ASCII renders are
in [`docs/verification/VERIFICATION.md`](./verification/VERIFICATION.md); the raw
scene data the app actually loads is in
[`docs/verification/scenes.json`](./verification/scenes.json). This page is a
guide to reading them, plus what each number means for what you'll actually see
in the app.

## The world these numbers describe

Every authored scene runs on the shipped world: **256x160 cells, B3/S23, toroidal
wrap** (the edges connect — a glider that exits the right side re-enters on the
left). Playback speed for these scenes is 12 generations/second, so "generation
240" is about 20 seconds in.

## 0. Engine proof (`VERIFICATION.md` §0)

Before trusting any authored scene, the engine itself was checked against known
Game of Life facts:

- All seven standard still lifes (block, beehive, loaf, boat, tub, ship, pond)
  are stable — period 1, population unchanged after a step.
- Four period-2 oscillators (blinker, toad, beacon, clock), the period-3 pulsar,
  and the period-15 pentadecathlon all return to their exact starting bitmap
  after their expected period.
- The four common spaceships (glider, LWSS, MWSS, HWSS) translate by their
  known displacement per period (e.g. the glider moves (1,1) every 4
  generations).
- The Gosper glider gun emits a glider (a net +5 population) every 30
  generations, checked over generations 120–300 on an unbounded grid.
- The R-pentomino, acorn and diehard were run on `sparse.mjs`'s unbounded grid
  and reproduced the literature **exactly**: R-pentomino stabilizes at
  generation 1103 with population 116; acorn at generation 5206 with population
  633; diehard dies out completely at generation 130.
- The same R-pentomino was then run again on the actual 256x160 torus, and it
  behaves differently — its escaping gliders wrap around the world and
  re-collide with their own debris field. On the torus, population is 121 at
  generation 100, climbs to 174 by 500, and it doesn't settle until generation
  2189, into a period-2 cycle at population 109 — never reaching the "116 and
  frozen" state the unbounded grid produces. This is the concrete reason the
  README calls out the torus/unbounded distinction: the two grids are not
  interchangeable, and only the torus behavior is what a player will ever see.

## 1. Opening (`VERIFICATION.md` §1) — the default scene

Generation 0 has 250 cells: a Gosper gun in the top-left firing steadily, a
32-object garden of still lifes/oscillators in the top-right (verified
non-interacting — its state at generation 0 is bit-identical to generation 30,
the LCM of its objects' periods 1/2/3/15), and two gliders launched from
opposite ends of an empty southern band.

**The encounter** the README's tour describes happens at **generation 123**
(~10.3s at 12 gen/s), first diverging at cell (123,94). The two gliders
annihilate as ships and bloom into a chaotic reaction that, by around generation
1200, settles into 5 blinkers, 6 blocks and 2 ponds (population 55). The
verification log also confirms the gun's gliders never reach the garden and no
live cell ever touches the wrap boundary through generation 300 — the three
elements of the scene stay independent until the one collision that's the point
of the scene.

## 2. One Cell (`VERIFICATION.md` §2)

Base state: 11 cells. The experiment: flip **(128,89)** from dead to alive.

That one flip is the entire difference between two outcomes:

- **Untouched:** by generation 200, a 221-cell debris field of 13 objects,
  having already ejected 3 gliders.
- **Flipped:** total extinction — **zero live cells anywhere on the torus** —
  from **generation 54** onward.

The divergence is not immediate (the two runs are identical through generation
40; the first visible difference appears at generation 43) which is itself part
of the point — a single cell can sit dormant for dozens of generations before it
changes everything.

## 3. First Contact (`VERIFICATION.md` §3)

A glider and a lightweight spaceship approach each other across 90 cells of open
space, staying visibly separate for 115 generations (the scene requires at least
40), then collide at **generation 116**, producing a "traffic light" — four
period-2 blinkers arranged in a 9x9 box, confirmed stable through generation
400.

A second, independent intervention is also verified in this section: toggling a
single cell, (188,74), above the spaceship before it ever gets close destroys the
spaceship outright (population falls from 15 to 5 within 20 generations), so the
collision never happens and the surviving glider just crosses the field alone.

## 4. Keep Something Alive (`VERIFICATION.md` §4)

Base state: 65 cells, target generation **150**, edit budget **3**. "Activity" is
defined as the count of cells inside a fixed measurement rect that changed state
in the last 8 generations.

Left alone, the scene's activity drops to 0 at **generation 85** and stays dead.
The shipped solution — a single edit, **(129,60) dead → alive**, well inside the
budget of 3 — completes a 4-cell stub into a genuine glider. That glider is still
flying at generation 150, keeping activity at a steady 15 per 8-generation window
for the rest of the run (never zero). Three alternate single/multi-edit
solutions were also verified (completing a blinker, pruning part of the soup,
and building a fresh blinker in empty space) — the shipped one was chosen for
being the smallest and clearest illustration of "one cell changes the outcome,"
consistent with the rest of the app.

## 5. Specimen drawer (`VERIFICATION.md` §5)

All 24 specimens shown in the app — 7 still lifes, 6 oscillators, 4 spaceships,
2 emitters (Gosper and Simkin glider guns) and 5 seed patterns (R-pentomino,
acorn, diehard, B-heptomino, pi-heptomino) — were verified individually for
their claimed period, displacement, or (for seeds) stabilization generation and
population on an unbounded grid.

**There is no puffer**, and that omission was deliberate: 2,640 LWSS+LWSS+
b-heptomino arrangements were generated and the 73 that showed sustained growth
were long-run to check for a clean, periodic puffer signature. None qualified —
population either flattened to a constant value or grew irregularly without
settling into a repeating pattern. Two remembered block-laying-switch-engine
constructions were also tried from memory and both failed the same way. Rather
than ship an unverified "puffer," the specimen was cut.

## 6. Colour: proven cosmetic, proven bit-exact

Everything below was checked against the actual engine (`tests/engine-color.test.ts`),
not inferred from reading `src/core/lineage.ts`'s doc comments.

- **Colour cannot influence B3/S23.** The test seeds `hue`/`species` colour
  state, actively poisons it, and confirms the resulting live/dead bits are
  byte-identical to a run with no colour reasoning applied at all — including
  a standard glider's exact 5-cell shape and (1,1)-per-4-generations
  displacement, and two identically-seeded 64x64 engines producing
  bitwise-identical state (and identical population) after 40 steps each.
- **Colour reproduces exactly through rewind, branching and reload.** Unlike
  `age`, a long-lived survivor's colour is never recomputed after its birth,
  so it has to be captured in history keyframes directly rather than
  replayed forward from a default — `history.ts` now does this. The bug this
  fixes: colour (and the bits computed by replaying it) used to not survive
  a page reload at all. Root cause: replay was skipping edits recorded at
  the generation-0 baseline, so a fresh `goto()` from a restored keyframe
  silently dropped gen-0 colour edits. Fixed by no longer treating
  generation 0 as a no-op replay target.
- **Lineage inheritance is genuine circular-mean math**, not a nearest-parent
  pick or a simple average that would wrap incorrectly across the 0°/360°
  seam — verified directly against `circularMean3`.
- **Immigration and QuadLife are one simulation, not two.** Both lenses read
  the same `species` buffer; `immigration` is a coarser 2-bucket view
  ({1,2}→A, {3,4}→B) of the identical 4-colour data `quadlife` shows at full
  resolution, so there is no second birth-rule code path that could drift
  out of sync with B3/S23.

## 7. What the production build itself proves

A dedicated `prod-build` Playwright project (`e2e/prod-build.spec.ts`) builds
the app for real via `vite build` (not the dev server) and serves it with
`vite preview`, then asserts against actual rendered canvas pixels:

- Cells render a real, chromatic colour under every lens — never white,
  never grey. This is the regression test for a real shipped bug: Tailwind
  v4 + Lightning CSS downlevel `oklch(...)` design tokens to `lab(...)` in
  the production build (confirmed: the built CSS contains zero `oklch(`
  occurrences), which broke the old regex-only token parser and made it
  silently fall back to hardcoded white for every lens, in production only
  — dev was never affected, which is exactly why it shipped once.
- `life`/`age`/`activity` are genuinely, richly differentiated colours from
  each other.
- `lineage`/`quadlife`/`velocity`/`neighbors` are genuinely multi-hued — a
  real hue sweep, not one hue rendered at different lightnesses.
- `immigration` renders exactly two clearly separated populations, not two
  shades of one hue.
- Switching between all 8 lenses in the real production bundle produces zero
  new console errors.

## 8. Mobile touch: the commit path was silently broken, now fixed and covered

`src/interact/input.ts`'s `#endPinch()` used to unconditionally clear
`#dragMode` on every single-finger touch release — including plain one-finger
draw/erase/select gestures that never went through a pinch at all — because
`#stopDrag()` (the method that actually decides whether to commit an edit)
reads `#dragMode` to make that decision. The practical effect: **100% of
one-finger draw/erase/select touches silently failed to commit** on a real
touch device, with no error, no visual sign anything was wrong beyond the
mark just not appearing. Fixed, and now covered by dedicated assertions in
the `mobile` Playwright project (390x844, touch-enabled): a single-finger
draw commits on release, a plain tap with no movement also commits, two
fingers pan/zoom without drawing, and a second finger landing mid-stroke
ends the draw cleanly instead of corrupting it.

## 9. Full suite, as actually run

`typecheck` (`tsc --noEmit`): clean. Unit tests: **837 passed, 0 failed**,
across 83 files (`vitest run`). Production build (`vite build`): succeeds;
real measured bundle sizes (Vite/rolldown's automatic chunk splitting, not
one monolithic "app" chunk) are `app` at 287.5 kB (89.9 kB gzipped) plus
`primitives` at 344.3 kB (109.4 kB gzipped) — together the initial JS needed
to open the app, 632 kB / 199 kB gzipped combined — and two lazily-loaded
chunks that cost nothing until opened: the Time Sculpture at 1.02 MB (284.9
kB gzipped) and multiplayer at 21.0 kB (7.1 kB gzipped).

End-to-end (`playwright test`, 115 specs: 87 `desktop` + 22 `mobile` + 6
`prod-build`): the one currently-known flake is in `mobile.spec.ts`'s
heartbeat-journey test (scrub → edit → compare → sculpt by touch), which
intermittently fails a "dragging the ribbon backward must move the
generation backward" assertion under full-suite load. Unlike the
click-timing flake this section used to describe (now fixed — see
`INTEGRATION-NOTES.md`'s historical log for the `dismissTitle()`/camera-poll
fixes), this one is a real, reproducible race between a scrub's chunked
replay and something reading `engine.gen` mid-flight, in
`session.ts`/`interact`/`history.ts` territory — tracked, not silently
tolerated. Everything else passes in a full sequential run.

## 10. Newer claims: the default lens, rule presets, and theming

Verified the same way as everything above — by actually running the engine
or the validator, not asserted:

- **Default lens.** With zero interaction, the opening scene at generation 0
  shows several genuinely distinct, significantly-represented hue buckets
  under the new default lens (`lineage`) — measured at 12 in an actual run,
  using the same bucketing method `prod-build.spec.ts` uses for the other 7
  lenses (`e2e/default-lens.spec.ts`; the committed assertion is a robust ≥3
  threshold, not an exact count).
- **Rule presets.** Every one of the 10 curated Life-like presets'
  headline claims (HighLife's self-replication, Day & Night's period-2
  block oscillation, Seeds' explosive growth, Maze/Mazectric's contrasting
  fates from an identical soup, Replicator's one-cell-to-ring parity,
  Life without Death's monotonic growth, 2×2's bounded churn, Coral's
  freeze-then-reaccrete behaviour) was actually run against the real engine
  and is re-checked by `tests/content-rules.test.ts` on every commit.
  Diamoeba was tried at four densities on a 128×128 torus and dropped after
  none produced its claimed stable diamond blobs.
- **The generalised rule kernel's cost.** Measured on a 512×512 board, 200
  steps after a 20-step warmup, same harness before/after generalising the
  engine beyond hardcoded B3/S23: **3.2598 ms/step → 3.2856 ms/step** (+0.8%,
  within run-to-run noise) — Conway's own hand-unrolled fast path is
  untouched and still dispatched to whenever the active rule is B3/S23.
- **Theming.** `src/ui/theme/validate.ts`'s accent-distance check is
  calibrated to the shipped default theme's own closest real pair (age vs.
  warn), measured at an OKLab distance of 0.0491 — every theme, built-in or
  custom, must clear at least 0.045. Measured directly (computing
  `accentDistances()` for all 5 shipped themes): Observatory's own worst pair
  is exactly the calibration value, 0.0491; the 4 newer themes clear the
  floor by a wider margin, with their own worst pairs ranging from 0.0711
  (Ivory Plate) to 0.0956 (High Contrast) — comfortably above the 0.045
  floor, confirmed by `tests/theme-validate.test.ts`.

## Reading the raw files yourself

- `docs/verification/life.mjs` / `sparse.mjs` — the standalone simulators used
  to produce every number above. Run with plain Node, no build step.
- `docs/verification/scenes.json` — the exact cell coordinates, world size and
  camera framing for each authored scene, in the same format the app's own
  `src/content/scenes.ts` encodes by hand.
- `docs/verification/VERIFICATION.md` — the full log: every command's output,
  full ASCII renders of each scene at multiple generations, and the population
  tables the summaries above are drawn from.
- `tests/engine-color.test.ts` — the colour/B3-S23 invariance and
  replay-bit-exactness tests behind §6, run against the real `src/core/engine.ts`
  and `src/core/history.ts`, not a standalone reimplementation.
- `e2e/prod-build.spec.ts` and `e2e/mobile.spec.ts` — the real-browser
  assertions behind §7 and §8, run against an actual built/served app.
