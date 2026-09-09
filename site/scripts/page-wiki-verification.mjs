import { renderWikiArticle } from './content.mjs';

export function renderVerification() {
  const bodyHtml = `
          <p>
            Every claim on this page was checked by actually simulating the rule —
            with standalone, dependency-free reimplementations of the same B3/S23
            step the app itself runs — not recalled from memory. The full logs,
            generation-by-generation population tables and ASCII renders live in the
            app's repository under <code>docs/verification/</code>; this page
            summarises what they show.
          </p>

          <h2 id="engine-proof">The engine itself</h2>
          <ul>
            <li>All seven standard still lifes (block, beehive, loaf, boat, tub, ship, pond) hold their exact bitmap after a step.</li>
            <li>Four period-2 oscillators, the period-3 pulsar, and the period-15 pentadecathlon all return to their exact starting shape after their expected period.</li>
            <li>The four common spaceships translate by their known displacement every period — a glider moves (1, 1) every 4 generations.</li>
            <li>The Gosper glider gun emits a glider (a net +5 population) every 30 generations, checked over generations 120–300 on an unbounded grid.</li>
            <li>The R-pentomino, acorn and diehard, run on an unbounded grid, match the published literature exactly: the R-pentomino stabilises at generation 1103 with population 116; the acorn at generation 5206 with population 633; diehard dies out completely at generation 130.</li>
          </ul>
          <p>
            The same R-pentomino run again on the actual 256×160 torus behaves
            differently: its escaping gliders wrap around the world and re-collide
            with their own debris, so instead of freezing at population 116, it keeps
            evolving and only settles — into a period-2 cycle at population 109 — at
            generation 2189. The torus and an unbounded plane are genuinely different
            environments; only the torus is what you'll see in the app.
          </p>

          <h2 id="determinism">Determinism</h2>
          <p>
            Rewinding and replaying the same recorded history through the engine's
            <code>goto()</code>, in a scrambled, out-of-order sequence of target
            generations, produces bit-identical state every time, matching an
            independently-run reference simulation. This is what makes scrubbing the
            history ribbon trustworthy rather than approximate.
          </p>

          <h2 id="authored-scenes">The authored scenes</h2>
          <p>Each was verified by offline simulation before shipping:</p>
          <ul>
            <li>The default scene's opening encounter between two travelling gliders happens at <strong>generation 123</strong>.</li>
            <li>In <em>One Cell</em>, flipping a single cell sterilises the collision entirely — that future is dead by <strong>generation 54</strong>, while the untouched original reaches a population of <strong>221</strong>.</li>
            <li>In <em>First Contact</em>, a glider and a lightweight spaceship collide at <strong>generation 116</strong> and settle into a traffic light.</li>
            <li>In <em>Keep Something Alive</em>, the baseline activity dies at <strong>generation 85</strong>; the shipped one-edit solution keeps something moving all the way to the target generation, <strong>150</strong>.</li>
          </ul>

          <h2 id="specimens">The 24 specimens</h2>
          <p>
            Every specimen in the <a href="../specimens/">catalogue</a> was
            independently verified for its period, displacement, or (for seeds)
            stabilisation behaviour.
          </p>
          <p id="no-puffer" class="callout">
            <strong>There is deliberately no puffer.</strong> Over 2,600 candidate
            LWSS/b-heptomino arrangements were generated and searched; the 73 that
            showed sustained population growth were long-run looking for a clean,
            periodic puffer signature. None qualified — population either flattened to
            a constant value or grew irregularly without ever settling into a
            repeating pattern. Two remembered block-laying-switch-engine
            constructions were also tried and both failed the same way. Rather than
            ship an unverified "puffer," the specimen was cut entirely.
          </p>

          <h2 id="colour-and-b3s23">Colour never touches the rule</h2>
          <p>
            The 5 newer lenses (lineage, immigration, quadlife, velocity, neighbors —
            see <a href="../features/#lenses">Features</a> for what each means) add
            colour state that rides along with every cell. A dedicated test seeds that
            colour state, actively poisons it, and confirms the resulting live/dead
            bits come out byte-identical to a run with no colour reasoning applied at
            all — including a glider's exact shape and period, and two identically
            seeded engines matching bit-for-bit after 40 steps. Colour also survives
            rewind, branching and reload bit-exactly, because it's captured directly in
            history keyframes rather than replayed forward from a default (the fix for
            a real bug where colour used to be lost on reload, traced to replay
            skipping edits recorded at the generation-0 baseline).
          </p>

          <h2 id="production-build">The production build itself is checked</h2>
          <p>
            A dedicated Playwright project builds the app for real — <code>vite
            build</code>, not the dev server — and asserts against actual rendered
            canvas pixels: every lens (including the 5 multi-hue ones) produces real,
            richly differentiated, never-white colour, and switching between all 8 in
            the built bundle produces zero new console errors. This exists because of a
            real shipped bug: Tailwind v4 + Lightning CSS downlevel design tokens to
            <code>lab(...)</code> in the production build (the dev server serves
            <code>oklch(...)</code> verbatim), which broke the old regex-only colour
            parser and made it silently fall back to solid white for every lens — in
            production only, which is exactly why it shipped once before this check
            existed.
          </p>

          <h2 id="default-lens">The default lens is measurably colourful</h2>
          <p>
            The default lens changed from Life to Lineage (see
            <a href="../features/#lenses">Features</a>). This was checked, not just
            argued for by design intent: with zero interaction, the opening scene at
            generation 0 shows several genuinely distinct, significantly-represented
            hue buckets — measured at <strong>12</strong> in an actual run, using the
            same colour-bucketing method the production-build lens tests use for the
            other 7 lenses. The committed regression test asserts a robust ≥3 as its
            threshold rather than an exact count, so it doesn't become flaky as the
            opening scene's own content changes over time.
          </p>

          <h2 id="rules">Rule presets: verified, not assumed from reputation</h2>
          <p>
            Beyond Conway's own B3/S23, 10 curated Life-like rule presets ship in the
            Rules panel. Every preset's headline claim was actually run against the
            real engine and is re-checked by the app's own test suite on every commit
            — a claim that can't be reproduced there doesn't belong in the preset
            list:
          </p>
          <ul>
            <li><strong>HighLife</strong> — a seeded 5-cell pentomino produces 4 exact copies of itself by generation 5 (population 5 → 20), genuine self-replication, before the copies collide and collapse to extinction by generation 10.</li>
            <li><strong>Day &amp; Night</strong> — a solid 3×3 block becomes a stable oscillator, its population cycling 9, 9, 5, 5 indefinitely, rather than freezing (as under Conway) or dying.</li>
            <li><strong>Seeds</strong> — a single 2×2 block explodes to a population of 128 within 12 generations on a 64×64 torus.</li>
            <li><strong>Maze</strong> — a 96×96 random soup at density 0.4 locks to an exactly static 5072-cell structure by around generation 40.</li>
            <li><strong>Mazectric</strong> — the identical starting soup instead settles into a perfect period-6 population cycle, visibly thinner than Maze's frozen result.</li>
            <li><strong>Replicator</strong> — a single live cell dies, but every one of its 8 neighbours is born, turning one cell into an exact 8-cell ring after one generation — the parity mechanism behind the whole "Replicator" rule family.</li>
            <li><strong>Life without Death</strong> — seeded with 15% random noise, population never once decreases across 60 generations, checked every step.</li>
            <li><strong>2×2</strong> — a 96×96 soup at density 0.3, run 400 generations, stays bounded (roughly 1700–2200 cells) without collapsing to zero or exploding to the board's full capacity.</li>
            <li><strong>Coral</strong> — a solid 16×16 block grows briefly then freezes into an exactly static 612-cell structure; a sparse random soup instead dies back hard first, then steadily re-accretes rather than either freezing or collapsing.</li>
          </ul>
          <p id="diamoeba-cut" class="callout">
            <strong>Diamoeba was tried and dropped.</strong> It's reputed to organise a
            dense random soup into stable diamond-shaped blobs, but that behaviour is
            reportedly sensitive to a narrow initial-density band. Uniform soups were
            tried at four densities on a 128×128 torus: the two lower densities went
            fully extinct, one decayed to extinction more slowly, and the highest
            exploded to fill literally every cell on the board — no stable diamond
            blobs at any density tried. Rather than ship an unverified headline claim,
            it was left out.
          </p>
          <p>
            The generalised rule kernel (a lookup table indexed once per cell, rather
            than a hardcoded B3/S23 branch) costs essentially nothing when the active
            rule is still Conway's own: measured on a 512×512 board, 200 steps after a
            20-step warmup, the same test harness before and after generalising the
            engine measured <strong>3.2598 ms/step → 3.2856 ms/step</strong> — a 0.8%
            difference, within normal run-to-run noise. Conway's own hand-unrolled
            fast path is kept and dispatched to whenever the active rule canonicalises
            to exactly B3/S23.
          </p>

          <h2 id="theming">Every theme clears the same bar the default does</h2>
          <p>
            The app's 5 built-in themes, and any custom theme a user builds, are held
            to a programmatic check: the 8 lenses' semantic accent colours (life, age,
            activity, time, branch A/B, diff, warn) must stay at least a minimum
            distance apart in OKLab colour space, pairwise. That minimum isn't an
            arbitrary number — it's calibrated to the shipped default theme's own
            closest real pair (age vs. warn), measured at a distance of
            <strong>0.0491</strong>. A custom theme that would make two different
            concepts read as visually the same colour fails this check and can't be
            saved.
          </p>

          <h2 id="mobile-touch">Mobile touch actually commits</h2>
          <p>
            A real bug, now fixed and covered: the touch-input handler used to
            unconditionally clear the active drag mode on every single-finger release,
            which meant <strong>100% of one-finger draw/erase/select touches silently
            failed to commit</strong> on a real touch device — no error, the mark just
            never appeared. Dedicated mobile end-to-end coverage now asserts a
            single-finger draw commits on release, a plain tap with no movement also
            commits, two fingers pan/zoom without drawing, and a second finger landing
            mid-stroke ends the draw cleanly instead of corrupting it.
          </p>

          <h2 id="limitations">Known limitations</h2>
          <p>Honest gaps, not hidden ones:</p>
          <ul>
            <li>The Time Sculpture's slice colours render dark under software WebGL (SwiftShader) — the renderer used by headless/CI browsers and some sandboxes. This is an artifact of that renderer, not the colour ramp; the same math produces correct values headlessly, and a real GPU renders it correctly.</li>
            <li>Specimen recognition reliably auto-names gap-heavy shapes (the pulsar, the pentadecathlon, both glider guns) only when the shape is the sole occupant of the scanned region — their internal gaps fragment the connected-components fallback into several unnamed pieces if anything else shares the region.</li>
            <li>On narrow screens, the drawer and inspector become slide-over sheets rather than docked columns; unlike the app's dialogs, these sheets are not focus-trapped.</li>
            <li>One hairline colour token (used for the active branch row and similar decorative accents) falls below the 3:1 ratio WCAG's non-text-contrast guidance recommends — a deliberate choice for a purely decorative edge, not an oversight.</li>
            <li>Web MIDI output and system/mic audio reactivity depend on real browser and hardware support and degrade to an honest disabled state, never a silent no-op, when unavailable.</li>
            <li>A Time Sculpture turntable export was designed (orbit the existing 3D camera, reuse the PNG-export path per frame) but cut — untested against real WebGL, and inherently realtime-paced rather than a clean offline replay like the rest of export. Animated GIF export and audio export were also cut for a time over a verification gap (no reference decoder / no <code>OfflineAudioContext</code> in the unit-test environment) but have since shipped, verified against real Chromium decoders — see <a href="../features/#export">Features</a>. Exported WebM video is not silent when an audio track is supplied.</li>
            <li>Site theming (this guide/wiki) was scoped and deliberately not built — the app's 5 runtime themes are an app-only feature today.</li>
          </ul>
          <p>
            895 unit tests across 91 files, plus 126 Playwright end-to-end tests across
            27 spec files (96 desktop, 24 mobile-touch, 6 against a real production
            build), back all of the above; <code>typecheck</code> and <code>build</code>
            both run clean. A separate, more expensive Art-mode performance/
            resource-safety suite (6 specs) runs on its own schedule against its own dev
            server rather than as part of that count. One flake is currently known: a
            mobile-only touch test that scrubs, edits, compares and opens the Time
            Sculpture in one continuous journey intermittently hits a real, reproducible
            race in the history-scrub path under full-suite load, rather than a
            click-timing flake.
          </p>
`;

  return renderWikiArticle({
    slug: 'verification',
    title: 'Verification',
    description: 'What was actually proven by simulating the engine — still lifes, oscillators, spaceships, the four authored scenes, determinism, the default lens, rule presets, theming, colour/B3-S23 invariance, the production build, mobile touch, and the 24-specimen catalogue — plus the honest limitations.',
    bodyHtml,
  });
}
