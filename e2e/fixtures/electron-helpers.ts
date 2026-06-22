import path from 'node:path';
import { _electron as electron, test as base, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';

// e2e/fixtures/electron-helpers.ts
// Playwright Electron fixture for all dev-tree E2E specs (Plans 04, 05 non-packaged).
//
// This fixture launches Electron from the DEVELOPMENT app root (no package:ci required).
// It is the import point for all dev-tree specs:
//   import { test, expect } from '../fixtures/electron-helpers';
//
// The PACKAGED spec (05-packaged.spec.ts) manages its own lifecycle using PACKAGED_EXE_PATH
// from the environment — it does NOT use this fixture, because it must exercise the real
// packaged binary (the HARD gate for FND-02 non-circular resolution and runtime load).

export type ElectronFixtures = {
  /** The launched Electron application instance */
  electronApp: ElectronApplication;
  /** The first (main) BrowserWindow page */
  window: Page;
};

export const test = base.extend<ElectronFixtures>({
  electronApp: async ({}, use) => {
    // Launch Electron from the repo root. Forge's Vite plugin is responsible for
    // building main.ts; in dev this uses the Vite dev server. The fixture points
    // to the project root so Electron uses forge.config.ts to resolve the entry.
    const app = await electron.launch({
      args: [path.join(__dirname, '../../')],
    });
    await use(app);
    await app.close();
  },

  window: async ({ electronApp }, use) => {
    // Wait for the first BrowserWindow to be created and loaded.
    const win = await electronApp.firstWindow();
    // Wait for the window to be ready before tests run assertions.
    await win.waitForLoadState('domcontentloaded');
    await use(win);
  },
});

export { expect };
export type { ElectronApplication, Page };
