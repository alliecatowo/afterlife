import { renderWikiArticle } from './content.mjs';
import { SPECIMENS, CATEGORY_LABELS, CATEGORY_ORDER } from './specimens-data.mjs';

function renderSection(category) {
  const items = SPECIMENS.filter((s) => s.category === category);
  const rows = items
    .map(
      (s) => `
              <li class="specimen-card" id="${s.name}">
                <h3>${s.name}</h3>
                <p class="specimen-card__dims tabular">${s.w}×${s.h} · population ${s.pop}</p>
                <p>${s.explanation}</p>
                <p class="specimen-card__fact">${s.fact}</p>
              </li>`,
    )
    .join('');

  return `
          <h2 id="${category}">${CATEGORY_LABELS[category]}</h2>
          <ul class="specimen-grid">${rows}
          </ul>`;
}

export function renderSpecimens() {
  const sections = CATEGORY_ORDER.map(renderSection).join('\n');

  const bodyHtml = `
          <p>
            The drawer ships 24 specimens across five categories. Every period,
            displacement or stabilisation figure below was confirmed by simulating the
            real pattern — see <a href="../verification/">Verification</a> for how.
            Dimensions are the pattern's own bounding box; population is its starting
            cell count.
          </p>
          <p id="no-puffer" class="callout">
            <strong>There is deliberately no puffer.</strong> A <a href="../fundamentals/#puffer">puffer</a>
            leaves a trail of debris as it moves. Over 2,600 candidate arrangements
            were searched and long-run looking for one with a clean, repeating
            signature — none qualified, so none shipped rather than shipping one on a
            guess. Full detail in <a href="../verification/#no-puffer">Verification</a>.
          </p>
${sections}
`;

  return renderWikiArticle({
    slug: 'specimens',
    title: 'Specimen catalogue',
    description: 'All 24 verified specimens in the drawer — 7 still lifes, 6 oscillators, 4 spaceships, 2 emitters and 5 seeds — with their proven periods, displacements and stabilisation behaviour.',
    bodyHtml,
  });
}
