import { renderLayout, NAV } from './content.mjs';

export function renderLanding() {
  const bodyHtml = `
      <section class="hero">
        <div class="hero__inner">
          <p class="eyebrow">A playable observatory for tiny universes</p>
          <h1 class="hero__title display-face">AFTERLIFE</h1>
          <p class="hero__tag">Every future leaves a trace.</p>
          <p class="hero__lede">
            It's not a simulator. It's an observatory with a time machine.
          </p>
          <div class="cta-row">
            <a class="btn btn--solid btn--lg" href="${NAV.APP_URL}">Open the app</a>
            <a class="btn btn--ghost btn--lg" href="#what-is-this">What is this, exactly?</a>
          </div>
        </div>
      </section>

      <section class="section" id="what-is-this" aria-labelledby="what-is-this-h">
        <div class="section__inner section__inner--split">
          <div class="section__text">
            <p class="eyebrow">First, the basics</p>
            <h2 id="what-is-this-h">What Conway's Game of Life is</h2>
            <p>
              Take a grid of square cells. Each one is either <strong>alive</strong> or
              <strong>dead</strong>. Pick a starting pattern — that's the only decision
              you ever make. Then the grid updates, all at once, forever, under three
              rules:
            </p>
            <ul class="rule-list">
              <li><strong>Survival.</strong> A live cell with 2 or 3 live neighbours stays alive.</li>
              <li><strong>Birth.</strong> A dead cell with exactly 3 live neighbours becomes alive.</li>
              <li><strong>Death.</strong> Every other cell is dead next generation — too lonely (fewer than 2 neighbours) or too crowded (more than 3).</li>
            </ul>
            <p>
              That's it. There is no player once it starts, no score, no opponent — you
              set a beginning and watch what the rule does with it. And what it does is
              the surprise: from these three trivial rules come <em>still lifes</em> that
              never change, <em>oscillators</em> that blink in place, <em>gliders</em>
              that walk diagonally across the grid forever, and <em>guns</em> that fire
              an endless stream of them. The rule is even <strong>Turing-complete</strong> —
              you can, in principle, build a working computer out of nothing but this
              grid. Smart, simple rule; genuinely astonishing results. That gap is the
              entire appeal of Conway's Game of Life, and it's sixty years old.
            </p>
          </div>
          <div class="section__figure">
            <canvas id="glider-diagram" class="glider-diagram" width="180" height="180" role="img" aria-label="A five-cell glider pattern crawling diagonally across a small grid under Conway's Game of Life rules, repeating its shape every four generations while moving one cell down and to the right."></canvas>
            <p class="figure-caption">A glider: five cells, repeating its own shape every 4 generations, one cell further down-right each time. This is a real simulation, not a loop of frames.</p>
          </div>
        </div>
      </section>

      <section class="section section--alt" aria-labelledby="what-adds-h">
        <div class="section__inner">
          <p class="eyebrow">Then, the difference</p>
          <h2 id="what-adds-h">What AFTERLIFE adds</h2>
          <p class="section__lede">
            Underneath, AFTERLIFE runs the exact same rule everyone above just read —
            B3/S23, standard Game of Life, no variant. Plenty of Life simulators exist
            already and most stop there: draw, press play, watch it run. AFTERLIFE asks
            a different question of the same rule — not <em>can it run fast</em>, but
            <em>what happens if you touch one cell?</em> That means treating time itself
            as something you can hold, not just a direction the simulation happens to go.
          </p>
          <div class="feature-grid">
            <article class="feature-card">
              <h3>Time is a material</h3>
              <p>
                A ribbon along the bottom holds the world's entire recorded history —
                scrub it backward and forward like an editing timeline, not a
                progress bar. Lift a stretch of it out and it becomes a
                <strong>3D Time Sculpture</strong>: the third axis is time itself, so a
                still life becomes a vertical column and a travelling glider becomes an
                inclined beam. You orbit it, slice it, and read a whole encounter from
                the side instead of replaying it.
              </p>
            </article>
            <article class="feature-card">
              <h3>Editing the past forks a branch</h3>
              <p>
                Change a cell at some earlier generation and the obvious thing would be
                to overwrite everything that happened after it. AFTERLIFE does the
                honest alternative instead: it <strong>forks</strong>. Your original
                future keeps running on its own branch; your edited future runs on a
                new one. A difference lens then shows exactly which cells diverge
                between the two, generation for generation — both outcomes stay yours,
                side by side.
              </p>
            </article>
            <article class="feature-card">
              <h3>A field guide that fills in</h3>
              <p>
                As recognisable shapes appear on the grid — a still life settling out
                of debris, an oscillator ticking in place, a glider breaking free — a
                recognition pass names them and logs the discovery, buildling a
                personal field guide of what's actually happened in your universe,
                plus three small authored experiments built on the same mechanics.
              </p>
            </article>
          </div>
        </div>
      </section>

      <section class="section" aria-labelledby="cta-h">
        <div class="section__inner section__inner--center">
          <h2 id="cta-h">See it for yourself</h2>
          <p class="section__lede">
            The best explanation of AFTERLIFE is watching it for thirty seconds.
            Something is always alive somewhere on the grid.
          </p>
          <div class="cta-row cta-row--center">
            <a class="btn btn--solid btn--lg" href="${NAV.APP_URL}">Open the app</a>
            <a class="btn btn--ghost btn--lg" href="${NAV.WIKI}">Read the wiki</a>
          </div>
        </div>
      </section>
`;

  return renderLayout({
    title: 'AFTERLIFE — a playable observatory for tiny universes',
    rawTitle: true,
    description:
      "AFTERLIFE runs Conway's Game of Life, but treats time as a material you can scrub, sculpt and fork. It's not a simulator, it's an observatory with a time machine.",
    canonicalPath: '/afterlife/guide/',
    activeHref: NAV.GUIDE,
    bodyHtml,
    scripts: ['/site/shared/glider-mount.ts'],
  });
}
