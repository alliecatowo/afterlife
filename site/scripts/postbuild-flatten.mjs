#!/usr/bin/env node
// Vite's multi-page build mirrors each HTML entry's source path under
// `dist/` (so `site/guide/index.html` lands at `dist/site/guide/index.html`)
// — but the deployed URL we want is `/afterlife/guide/`, not
// `/afterlife/site/guide/`. This step runs after `vite build` and:
//   1. moves everything under `dist/site/guide/**` up to `dist/guide/**`
//   2. removes the now-empty `dist/site/`
//   3. copies the static `site/guide/assets/**` (favicon, OG image — not
//      referenced by any import, so Vite's build never touches them) into
//      `dist/guide/assets/**`
import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIST = join(ROOT, 'dist');
const DIST_SITE_GUIDE = join(DIST, 'site', 'guide');
const DIST_GUIDE = join(DIST, 'guide');
const SRC_ASSETS = join(ROOT, 'site', 'guide', 'assets');
const DIST_ASSETS = join(DIST_GUIDE, 'assets');

function moveGuideOutput() {
  if (!existsSync(DIST_SITE_GUIDE)) {
    throw new Error(`Expected build output at ${DIST_SITE_GUIDE} — did the vite build run first?`);
  }
  mkdirSync(DIST_GUIDE, { recursive: true });
  for (const entry of readdirSync(DIST_SITE_GUIDE)) {
    renameSync(join(DIST_SITE_GUIDE, entry), join(DIST_GUIDE, entry));
  }
  // Remove the now-empty `dist/site/` tree entirely.
  rmSync(join(DIST, 'site'), { recursive: true, force: true });
}

function copyStaticAssets() {
  if (!existsSync(SRC_ASSETS)) return;
  cpSync(SRC_ASSETS, DIST_ASSETS, { recursive: true });
}

moveGuideOutput();
copyStaticAssets();
console.log('flattened dist/site/guide -> dist/guide, copied static assets');
