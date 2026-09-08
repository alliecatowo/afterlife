#!/usr/bin/env node
// Generates the static HTML entry points under `site/guide/**` from the
// content templates in this directory. Runs as a prebuild step (see
// `package.json`'s `build` script) so `vite build`'s `rollupOptions.input`
// can point at real files that exist before Vite starts.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderLanding } from './page-landing.mjs';
import { renderWikiIndex } from './page-wiki-index.mjs';
import { renderGettingStarted } from './page-wiki-getting-started.mjs';
import { renderFundamentals } from './page-wiki-fundamentals.mjs';
import { renderSpecimens } from './page-wiki-specimens.mjs';
import { renderFeatures } from './page-wiki-features.mjs';
import { renderShortcuts } from './page-wiki-shortcuts.mjs';
import { renderHowItWorks } from './page-wiki-how-it-works.mjs';
import { renderVerification } from './page-wiki-verification.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GUIDE_DIR = join(ROOT, 'site', 'guide');

const PAGES = [
  ['guide/index.html', renderLanding()],
  ['guide/wiki/index.html', renderWikiIndex()],
  ['guide/wiki/getting-started/index.html', renderGettingStarted()],
  ['guide/wiki/fundamentals/index.html', renderFundamentals()],
  ['guide/wiki/specimens/index.html', renderSpecimens()],
  ['guide/wiki/features/index.html', renderFeatures()],
  ['guide/wiki/shortcuts/index.html', renderShortcuts()],
  ['guide/wiki/how-it-works/index.html', renderHowItWorks()],
  ['guide/wiki/verification/index.html', renderVerification()],
];

for (const [relPath, html] of PAGES) {
  const outPath = join(ROOT, 'site', relPath);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, html, 'utf8');
  console.log('wrote', join('site', relPath));
}

console.log(`\n${PAGES.length} pages generated into ${GUIDE_DIR}`);
