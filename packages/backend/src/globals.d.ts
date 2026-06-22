/**
 * Electron Forge Vite plugin injects these magic constants at build time.
 * They are replaced by the Vite `define` config in vite.base.config.js.
 *
 * MAIN_WINDOW_VITE_DEV_SERVER_URL — the dev server URL (http://localhost:XXXX)
 * MAIN_WINDOW_VITE_NAME — the renderer window name (used for the packaged file path)
 *
 * Source: @electron-forge/plugin-vite/forge-vite-env.d.ts
 */

/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />
