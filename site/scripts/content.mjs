// AFTERLIFE guide/wiki — content model + HTML layout.
//
// Plain data + template-string rendering, run by `build-pages.mjs` at build
// time (before `vite build`) to produce real static HTML files under
// `site/guide/**`. Keeping nav/header/footer in one place here is what
// guarantees every page shares the same links (and what the "no 404s"
// Playwright spec is checking against).
//
// Voice matches DESIGN.md / the app's own copy: precise, unfussy, no
// exclamation marks, no emoji.

const SITE_TITLE = 'AFTERLIFE';
const BASE = '/afterlife/';
const GUIDE = `${BASE}guide/`;
const WIKI = `${GUIDE}wiki/`;
const REPO = 'https://github.com/alliecatowo/afterlife';
const APP_URL = BASE;

export const WIKI_PAGES = [
  { slug: 'getting-started', title: 'Getting started', summary: 'The one-minute tour of the app.' },
  { slug: 'fundamentals', title: 'Life fundamentals', summary: 'The three rules, and a glossary of every term you’ll hit.' },
  { slug: 'specimens', title: 'Specimen catalogue', summary: 'All 24 verified specimens in the drawer, with their proven periods and displacements.' },
  { slug: 'features', title: 'Features', summary: 'Lenses, the history ribbon, the Time Sculpture, branching, the field guide, experiments, audio, cinematic mode.' },
  { slug: 'shortcuts', title: 'Keyboard shortcuts', summary: 'Every binding, matching the in-app sheet exactly.' },
  { slug: 'how-it-works', title: 'How it works', summary: 'The honest engineering account: the world, the history model, and why Life can’t be reverse-stepped.' },
  { slug: 'verification', title: 'Verification', summary: 'What was actually proven by running the engine — and what wasn’t.' },
];

function wikiHref(slug) {
  return slug ? `${WIKI}${slug}/` : WIKI;
}

const TOP_NAV = [
  { href: GUIDE, label: 'Guide' },
  { href: WIKI, label: 'Wiki' },
];

function svgFavicon() {
  return `${GUIDE}assets/favicon.svg`;
}

function ogImage() {
  return `${GUIDE}assets/og.png`;
}

/**
 * Full HTML document shell shared by every guide/wiki page.
 * @param {{
 *   title: string, description: string, canonicalPath: string,
 *   activeHref: string, bodyHtml: string, headExtra?: string,
 *   scripts?: string[],
 * }} opts
 */
export function renderLayout(opts) {
  const { title, description, canonicalPath, activeHref, bodyHtml, headExtra = '', scripts = [], rawTitle = false } = opts;
  const fullTitle = rawTitle || title === SITE_TITLE ? title : `${title} — ${SITE_TITLE}`;
  const canonical = `https://alliecatowo.github.io${canonicalPath}`;

  const nav = TOP_NAV.map(
    (item) =>
      `<a class="nav-link${item.href === activeHref ? ' nav-link--active' : ''}" href="${item.href}"${item.href === activeHref ? ' aria-current="page"' : ''}>${item.label}</a>`,
  ).join('\n        ');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta name="color-scheme" content="dark" />
    <title>${fullTitle}</title>
    <meta name="description" content="${description}" />
    <link rel="canonical" href="${canonical}" />
    <link rel="icon" type="image/svg+xml" href="${svgFavicon()}" />

    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="${SITE_TITLE}" />
    <meta property="og:title" content="${fullTitle}" />
    <meta property="og:description" content="${description}" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:image" content="https://alliecatowo.github.io${ogImage()}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />

    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${fullTitle}" />
    <meta name="twitter:description" content="${description}" />
    <meta name="twitter:image" content="https://alliecatowo.github.io${ogImage()}" />

    <link rel="stylesheet" href="/site/shared/site.css" />
    ${headExtra}
  </head>
  <body>
    <a class="skip-link" href="#main">Skip to content</a>
    <header class="site-header">
      <div class="site-header__inner">
        <a class="wordmark" href="${GUIDE}">
          <span class="wordmark__mark" aria-hidden="true"></span>
          <span class="display-face-tight wordmark__text">AFTERLIFE</span>
        </a>
        <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="site-nav" data-nav-toggle>
          <span class="sr-only">Menu</span>
          <span class="nav-toggle__bars" aria-hidden="true"></span>
        </button>
        <nav class="site-nav" id="site-nav" aria-label="Site">
          ${nav}
          <a class="btn btn--solid" href="${APP_URL}">Open the app</a>
        </nav>
      </div>
    </header>
    <main id="main">
${bodyHtml}
    </main>
    <footer class="site-footer">
      <div class="site-footer__inner">
        <p class="site-footer__line">Every future leaves a trace.</p>
        <nav class="site-footer__links" aria-label="Footer">
          <a href="${GUIDE}">Guide</a>
          <a href="${WIKI}">Wiki</a>
          <a href="${APP_URL}">Open the app</a>
          <a href="${REPO}">Source</a>
        </nav>
      </div>
    </footer>
    <script type="module" src="/site/shared/main.ts"></script>
    ${scripts.map((s) => `<script type="module" src="${s}"></script>`).join('\n    ')}
  </body>
</html>
`;
}

/** Sidebar + breadcrumb wrapper used by every wiki article page. */
export function renderWikiArticle({ slug, title, description, bodyHtml, prevNext = true }) {
  const idx = WIKI_PAGES.findIndex((p) => p.slug === slug);
  const page = WIKI_PAGES[idx];
  const prev = idx > 0 ? WIKI_PAGES[idx - 1] : null;
  const next = idx < WIKI_PAGES.length - 1 ? WIKI_PAGES[idx + 1] : null;

  const sidebarItems = WIKI_PAGES.map(
    (p) =>
      `<li><a class="wiki-sidebar__link${p.slug === slug ? ' wiki-sidebar__link--active' : ''}" href="${wikiHref(p.slug)}"${p.slug === slug ? ' aria-current="page"' : ''}>${p.title}</a></li>`,
  ).join('\n            ');

  const pager = prevNext
    ? `<nav class="wiki-pager" aria-label="Wiki pages">
        ${prev ? `<a class="wiki-pager__link wiki-pager__link--prev" href="${wikiHref(prev.slug)}"><span class="wiki-pager__dir">← Previous</span><span>${prev.title}</span></a>` : '<span></span>'}
        ${next ? `<a class="wiki-pager__link wiki-pager__link--next" href="${wikiHref(next.slug)}"><span class="wiki-pager__dir">Next →</span><span>${next.title}</span></a>` : '<span></span>'}
      </nav>`
    : '';

  const body = `      <div class="wiki-layout">
        <nav class="wiki-sidebar" aria-label="Wiki sections">
          <p class="wiki-sidebar__label">Wiki</p>
          <ul>
            ${sidebarItems}
          </ul>
        </nav>
        <article class="wiki-article">
          <nav class="breadcrumb" aria-label="Breadcrumb">
            <a href="${GUIDE}">Guide</a> <span aria-hidden="true">/</span> <a href="${WIKI}">Wiki</a> <span aria-hidden="true">/</span> <span aria-current="page">${page.title}</span>
          </nav>
          <h1>${title}</h1>
          <p class="wiki-article__lede">${description}</p>
${bodyHtml}
          ${pager}
        </article>
      </div>`;

  return renderLayout({
    title,
    description,
    canonicalPath: `/afterlife/guide/wiki/${slug}/`,
    activeHref: WIKI,
    bodyHtml: body,
  });
}

export const NAV = { GUIDE, WIKI, APP_URL, BASE, REPO, wikiHref };
