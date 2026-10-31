import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  testIgnore: process.env.BROWSER_MEDIA_TEST ? [] : ['**/media.spec.ts'],
  workers: 1,
  fullyParallel: false,
  updateSnapshots: 'none',
  timeout: 45000,
  expect: { timeout: 10000, toHaveScreenshot: { threshold: 0, maxDiffPixels: 0, animations: 'disabled' } },
  snapshotPathTemplate: '{testDir}/snapshots/{platform}/{arg}{ext}',
  outputDir: process.env.BROWSER_OUTPUT_DIR || 'test-results/browser',
  reporter: [['list'], ['html', { outputFolder: process.env.BROWSER_MEDIA_TEST ? 'test-results/media-report' : 'test-results/report', open: 'never' }]],
  use: {
    browserName: 'chromium',
    baseURL: process.env.BROWSER_BASE_URL || 'http://127.0.0.1:4244',
    httpCredentials: { username: 'admin', password: 'browser-regression-admin' },
    viewport: { width: 1440, height: 1080 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: { args: ['--disable-lcd-text'] },
  },
  webServer: {
    command: 'node tests/browser/server.mjs',
    url: 'http://127.0.0.1:4240/test/health',
    reuseExistingServer: false,
    timeout: 30000,
  },
});
