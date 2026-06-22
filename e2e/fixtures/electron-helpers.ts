import path from 'node:path';
import { _electron as electron, test as base, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';

// Resolve the Electron binary path explicitly.
// Using executablePath is more reliable than args[0] (the app dir) in fixture context
// because it avoids Playwright needing to auto-detect the electron binary from node_modules.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ELECTRON_BINARY = require('electron') as string;
const REPO_ROOT = path.resolve(__dirname, '../..');

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
    //
    // PATH B adaptation: the compiled .vite/build/main.js loads http://localhost:5173
    // (the Vite renderer dev server). playwright.config.ts webServer config starts
    // that server before the tests run.
    //
    // --disable-gpu: prevents GPU-related crashes in CI / headless environments.
    // --no-sandbox: required on some Linux CI environments.
    // Use executablePath + args[0] = app directory.
    // The app directory is the repo root where package.json#main points to
    // .vite/build/main.js. Electron loads that entry when given the app dir.
    // executablePath makes the binary path explicit (avoids auto-detection issues).
    const app = await electron.launch({
      executablePath: ELECTRON_BINARY,
      args: [
        REPO_ROOT,
        '--disable-gpu',
      ],
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
