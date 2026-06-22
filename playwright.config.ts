import { defineConfig } from '@playwright/test';

// playwright.config.ts — Playwright E2E config for Electron specs
//
// Tests live in e2e/. The electron-helpers fixture (e2e/fixtures/electron-helpers.ts)
// provides the electronApp / window fixtures for dev-tree specs (Plans 04 + non-packaged).
//
// PACKAGED SPEC (05-packaged.spec.ts):
// The packaged spec reads PACKAGED_EXE_PATH from the environment and uses it directly
// (does not use the electron-helpers fixture, which always launches from source).
// In CI, the packaged-gate job sets PACKAGED_EXE_PATH after `pnpm package:ci`.
// If PACKAGED_EXE_PATH is not set in a local run, 05-packaged.spec.ts skips.
// In CI, --forbid-only ensures a skip == fail (review fix HIGH-2 / HARD gate).
//
// DEV SERVER (webServer):
// The dev-tree specs (01-04) require the Vite renderer dev server to be running at
// http://localhost:5173. The webServer config starts it automatically before the tests run.
// Electron's compiled main.ts (via .vite/build/main.js) calls win.loadURL('http://localhost:5173')
// in dev mode; the webServer ensures that URL resolves when Playwright launches Electron.
//
// NOTE: The packaged spec (05-packaged) uses a standalone packaged binary that loads from
// file:// (not the dev server), so it does not depend on the webServer.

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report' }],
  ],
  use: {
    // Electron specs manage their own app lifecycle via the electron-helpers fixture.
    // No default browser configuration needed.
  },
  // Start the Vite renderer dev server before running dev-tree E2E specs.
  // The compiled main.ts (in .vite/build/main.js) points to http://localhost:5173.
  webServer: {
    command: 'pnpm vite --config vite.renderer.config.ts --port 5173',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
