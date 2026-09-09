import { defineConfig, devices } from '@playwright/test';

/**
 * Dedicated Playwright config for the Art-mode performance/resource-safety
 * harness (`e2e/art-perf.spec.ts`). Owned by the `render` agent, same as
 * `src/render/**` and `e2e/art*.spec.ts`.
 *
 * SEPARATE from the main `playwright.config.ts` deliberately: this repo is a
 * shared workspace with other agents potentially running the main suite
 * against `localhost:5173`/`4173` concurrently — reusing those ports or that
 * config's `webServer` here risks starving/killing another agent's run (the
 * project's own ground rules explicitly warn against broad `pkill`s and
 * shared-port collisions). This config boots its own dev server on its own
 * port (5983) and only ever runs `art-perf.spec.ts`, so it can be started,
 * torn down, and re-run independently of whatever else is going on.
 *
 * Some of this suite's tests deliberately measure REAL wall-clock cost of a
 * historically catastrophic code path (see that file's doc for the
 * production crash report this exists to catch) — timeouts here are longer
 * than the main config's to give those measurements room without the run
 * itself becoming the next flaky timeout.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: /art-perf\.spec\.ts/,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: 'test-results-art-perf',
  use: {
    baseURL: 'http://localhost:5983',
    trace: 'retain-on-failure',
    video: 'off',
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 900 },
    launchOptions: {
      // `--expose-gc` lets the spec force a real GC (`window.gc()`) before
      // sampling heap size, so memory-growth assertions measure genuine
      // retained memory rather than not-yet-collected garbage — see
      // "Memory/resource growth" in this feature's own test brief.
      args: ['--js-flags=--expose-gc'],
    },
  },
  webServer: {
    command: 'npm run dev -- --port 5983 --strictPort',
    url: 'http://localhost:5983',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
