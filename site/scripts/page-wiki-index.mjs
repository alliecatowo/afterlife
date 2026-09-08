import { renderLayout, WIKI_PAGES, NAV } from './content.mjs';

export function renderWikiIndex() {
  const cards = WIKI_PAGES.map(
    (p) => `
        <li class="wiki-index-card">
          <a href="${NAV.wikiHref(p.slug)}">
            <h3>${p.title}</h3>
            <p>${p.summary}</p>
          </a>
        </li>`,
  ).join('');

  const bodyHtml = `
      <section class="section">
        <div class="section__inner">
          <nav class="breadcrumb" aria-label="Breadcrumb">
            <a href="${NAV.GUIDE}">Guide</a> <span aria-hidden="true">/</span> <span aria-current="page">Wiki</span>
          </nav>
          <p class="eyebrow">Documentation</p>
          <h1>The AFTERLIFE wiki</h1>
          <p class="section__lede">
            Everything below is written for someone who has never heard of Conway's
            Game of Life. Start at the top if that's you; jump straight to a section
            if you already know what you're looking for.
          </p>
          <ol class="wiki-index-list">
            ${cards}
          </ol>
        </div>
      </section>
`;

  return renderLayout({
    title: 'Wiki',
    description: 'Documentation for AFTERLIFE: getting started, Life fundamentals, the specimen catalogue, features, keyboard shortcuts, how it works, and verification.',
    canonicalPath: '/afterlife/guide/wiki/',
    activeHref: NAV.WIKI,
    bodyHtml,
  });
}
