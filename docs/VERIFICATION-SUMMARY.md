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

## Reading the raw files yourself

- `docs/verification/life.mjs` / `sparse.mjs` — the standalone simulators used
  to produce every number above. Run with plain Node, no build step.
- `docs/verification/scenes.json` — the exact cell coordinates, world size and
  camera framing for each authored scene, in the same format the app's own
  `src/content/scenes.ts` encodes by hand.
- `docs/verification/VERIFICATION.md` — the full log: every command's output,
  full ASCII renders of each scene at multiple generations, and the population
  tables the summaries above are drawn from.
