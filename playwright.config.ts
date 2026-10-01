import { defineConfig } from '@playwright/test';

/**
 * End-to-end checks against the dev server with the real built data (data/build, gitignored), so
 * they run locally after the pipeline. They use the installed Chrome (no browser download).
 * WebGL runs in software in headless Chrome, so timeouts are generous.
 */
const PORT = 5191;

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: 'chrome',
    viewport: { width: 1366, height: 820 },
    // Software WebGL for Cesium in headless mode.
    launchOptions: {
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    },
  },
  webServer: {
    command: 'npm run dev -w @copernico/web',
    url: `http://localhost:${PORT}`,
    env: { PORT: String(PORT) },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
