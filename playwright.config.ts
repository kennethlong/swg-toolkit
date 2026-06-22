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

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
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
});
