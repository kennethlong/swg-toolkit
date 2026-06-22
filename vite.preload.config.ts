import { defineConfig } from 'vite';

// vite.preload.config.ts — Electron preload script build config
//
// The preload script is a bridge between the sandboxed renderer and the main process.
// It runs in a Node context but is loaded by the renderer window. Only 'electron'
// is external (it must resolve from the Electron binary, not be bundled).
//
// Plan 03 creates: packages/backend/src/preload.ts

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        preload: 'packages/backend/src/preload.ts',
      },
      external: ['electron'],
      output: {
        // Forge expects a single preload JS file; emit to .vite/build/preload.js
        entryFileNames: '[name].js',
        dir: '.vite/build',
      },
    },
  },
  resolve: {
    alias: {
      '@swg/contracts': new URL('./packages/contracts/src/index.ts', import.meta.url).pathname,
    },
  },
});
