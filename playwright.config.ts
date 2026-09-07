import { defineConfig, devices } from '@playwright/test';

/**
 * Browser verification for AFTERLIFE. Boots the real Vite dev server (the
 * shipped app, not a mock) and drives it with chromium. See `e2e/README`
 * (this file's doc comment) for the known SwiftShader/software-WebGL
 * limitation this sandbox has for the Time Sculpture's `InstancedMesh` vertex
 * colours — geometry/controls/labels are verified instead of pixel colour.
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
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    {
      name: 'mobile',
      testMatch: /screenshots\.spec\.ts/,
      use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
    },
  ],
  webServer: {
    command: 'npm run dev -- --port 5173 --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
