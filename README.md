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

Live at **<https://alliecatowo.github.io/afterlife/>**.

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

## What it's built from

**The living world.** A 256x160 toroidal grid, standard B3/S23, drawn on a plain
2D canvas so the simulation loop never has to fight React for frame time. Draw,
erase, pan, zoom, select and stamp specimens onto it; three lenses (life, age,
activity) recolor the same cells to answer different questions about what's
happening.

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
happens, get an honest verdict instead of a badge.

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
| `1` / `2` / `3` | Life / age / activity lens |
| `V` | Presentation mode |
| `?` | Keyboard shortcuts sheet |
| `Esc` | Close dialog / panel / presentation, or cancel the current selection / armed stamp |

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
- 220 unit tests across 26 files, plus 38 Playwright end-to-end tests (desktop
  at 1440x900, mobile at 390x844); `typecheck` and `build` both run clean.

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

The authored scenes and specimen set were arrived at by simulation search, not
hand-tuning by eye — see [`docs/verification/`](./docs/verification/) for the
scripts and full logs behind every number above.

## More

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — module map, the React/simulation
  performance boundary, the toroidal world model, history windowing, and the
  atomic-edit rule.
- [`DESIGN.md`](./DESIGN.md) — the visual and interaction design system.
- [`docs/VERIFICATION-SUMMARY.md`](./docs/VERIFICATION-SUMMARY.md) — a guided
  read of the verification evidence.
