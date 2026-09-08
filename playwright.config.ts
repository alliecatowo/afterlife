import { defineConfig, devices } from '@playwright/test';

/**
 * Browser verification for AFTERLIFE. Boots the real Vite dev server (the
 * shipped app, not a mock) and drives it with chromium. See `e2e/README`
 * (this file's doc comment) for the known SwiftShader/software-WebGL
 * limitation this sandbox has for the Time Sculpture's `InstancedMesh` vertex
 * colours — geometry/controls/labels are verified instead of pixel colour.
 *
 * `desktop`/`mobile` run against `npm run dev`, which serves source CSS
 * verbatim — Tailwind v4 + Lightning CSS have NOT downleveled its `oklch(...)`
 * design tokens yet at that point. That gap is exactly how BUG 1 shipped: a
 * production-only colour-resolution failure (tokens downlevel to `lab(...)`
 * in the real build; a dev-only server never exercises that path) that no
 * test ever caught. The `prod-build` project below closes it: it builds for
 * real and serves the actual `dist/` output via `npm run preview`, so
 * `e2e/prod-build.spec.ts` asserts on the bytes a real user's browser
 * actually receives.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: 'test-results',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'desktop',
      // `prod-build.spec.ts` is written specifically against the real
      // production bundle served on the `prod-build` project's own baseURL
      // (4173) — running it here too would silently point it at the DEV
      // server (5173) instead, which is exactly the gap BUG 1 fell through.
      //
      // `mobile.spec.ts` is written specifically for a touch-enabled 390px
      // viewport (its own test names say so): it calls `.tap()` throughout,
      // which Playwright refuses outside a context with `hasTouch: true`
      // (only the `mobile` project below sets that), and several of its own
      // assertions (e.g. "the HUD row never overflows horizontally") are
      // meaningless at a 1440px desktop width — this project's OWN full-icon-
      // row layout is a deliberately different, wider composition, not a
      // scaled-up version of the 390px one. This mirrors the `mobile`
      // project's own `testMatch` below (added when `mobile.spec.ts` was
      // introduced) — that change updated where the file DOES run without
      // also updating where it DOESN'T, so `desktop`'s "run everything"
      // default silently picked it up too and failed for reasons that have
      // nothing to do with this project's own viewport.
      testIgnore: /(prod-build|mobile)\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'mobile',
      testMatch: /(screenshots|mobile)\.spec\.ts/,
      use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
    },
    {
      name: 'prod-build',
      testMatch: /prod-build\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        baseURL: 'http://localhost:4173',
      },
    },
  ],
  webServer: [
    {
      command: 'npm run dev -- --port 5173 --strictPort',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      // A real production build, served the same way `npm run preview`
      // would for anyone checking a release before shipping it — no dev
      // server, no source CSS, the actual downleveled `dist/` bundle.
      // Deliberately `vite build` directly rather than the `npm run build`
      // script (which prepends a project-wide `tsc --noEmit`): this project
      // exists to verify the RUNTIME ARTIFACT — the CSS/JS Vite actually
      // emits — which is unaffected by, and shouldn't be coupled to, type
      // errors elsewhere in the repo (those are already caught by
      // `npm run typecheck`/CI on their own).
      command: 'npx vite build && npm run preview -- --port 4173 --strictPort',
      url: 'http://localhost:4173',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
