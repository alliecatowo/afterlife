import { renderWikiArticle } from './content.mjs';

const GLOSSARY = [
  ['soup', 'A starting arrangement with no particular design — cells placed at random or by hand with no plan for what they’ll become. Most soups die out or settle into a scattering of still lifes and oscillators.'],
  ['still life', 'A pattern that does not change at all from one generation to the next — every live cell has exactly 2 or 3 live neighbours, and every dead neighbour has anything other than exactly 3. The block, beehive and boat are the smallest examples.'],
  ['oscillator', 'A pattern that returns to its exact starting shape after a fixed number of generations, then repeats forever. See <a href="#period">period</a>.'],
  ['period', 'How many generations an oscillator (or spaceship) takes to return to its original shape (in a spaceship’s case, the same shape in a new position). A blinker has period 2; the pentadecathlon has period 15.'],
  ['spaceship', 'A pattern that reproduces its own shape, translated to a new position, after a fixed period — it travels indefinitely. The glider is the smallest; LWSS/MWSS/HWSS are the classic orthogonal ships.'],
  ['glider', 'The smallest known spaceship: 5 cells, period 4, moving one cell diagonally every period. See it animated on the <a href="../../">guide’s landing page</a>.'],
  ['gun', 'A pattern that periodically emits a spaceship (usually a glider) without being consumed itself, growing the population forever. The Gosper glider gun — the first gun ever discovered — fires one glider every 30 generations.'],
  ['puffer', 'A pattern that moves like a spaceship while leaving a trail of stable or periodic debris behind it, like exhaust. AFTERLIFE deliberately ships none: see <a href="../verification/#no-puffer">why, in Verification</a>.'],
  ['methuselah', 'A small, unremarkable-looking pattern that takes an unusually long time to stabilise, often after growing much larger first. The R-pentomino (5 cells, 1103 generations) and acorn (7 cells, 5206 generations) are the catalogue’s two extreme examples.'],
  ['stabilisation', 'The point after which a pattern’s population and behaviour settle into either a fixed still life, a repeating oscillation, or total extinction — it stops doing anything new.'],
  ['toroidal / torus', 'The shape of AFTERLIFE’s world: the grid’s edges wrap around, top to bottom and left to right, like the surface of a doughnut. A glider that exits the right edge re-enters on the left. See <a href="../how-it-works/#the-world">How it works</a>.'],
];

export function renderFundamentals() {
  const glossaryHtml = GLOSSARY.map(
    ([term, def]) => `
            <div class="glossary-row" id="${term.replace(/[^a-z]+/g, '-')}">
              <dt>${term}</dt>
              <dd>${def}</dd>
            </div>`,
  ).join('');

  const bodyHtml = `
          <h2>The rules</h2>
          <p>
            Conway's Game of Life runs on a grid of cells, each alive or dead. Every
            generation, every cell updates at once, according to how many of its 8
            neighbours (including diagonals) are alive right now:
          </p>
          <ul class="rule-list">
            <li><strong>2 or 3 live neighbours, and the cell is alive:</strong> it survives.</li>
            <li><strong>Exactly 3 live neighbours, and the cell is dead:</strong> it's born.</li>
            <li><strong>Anything else:</strong> the cell is dead next generation (too few neighbours to sustain it, or too many).</li>
          </ul>
          <p>
            This ruleset has a name — <strong>B3/S23</strong> ("birth on 3, survival on 2
            or 3") — and it's the one every implementation calling itself "Conway's
            Game of Life" uses, AFTERLIFE included. There is no player once a starting
            pattern is set; the rule is entirely deterministic, so the same start
            always produces the same future. See it running on a real glider on the
            <a href="../../">guide's landing page</a>.
          </p>

          <h2>Glossary</h2>
          <p>Terms you'll hit throughout the app and this wiki, in the order a newcomer tends to meet them.</p>
          <dl class="glossary">
            ${glossaryHtml}
          </dl>
`;

  return renderWikiArticle({
    slug: 'fundamentals',
    title: 'Life fundamentals',
    description: 'The three rules of Conway\'s Game of Life, and a glossary of every term a newcomer will hit: still life, oscillator, period, spaceship, glider, gun, puffer, soup, stabilisation.',
    bodyHtml,
  });
}
