import { defineConfig } from 'vite';

// vite.main.config.ts — Electron main-process + utility-worker build config
//
// SINGLE SOURCE OF TRUTH FOR THE UTILITY WORKER PATH (review fix HIGH-4a / Codex):
// Both named rollup inputs resolve under packages/backend/src/. Plan 03 creates the
// source files at THESE EXACT PATHS. If these paths diverge, Rollup looks for a
// nonexistent file and the worker never loads. Do NOT change to bare 'src/*'.
//
// Plan 03 creates: packages/backend/src/main.ts, packages/backend/src/utility-worker.ts
// Plan 03's utilityProcess.fork() consumes the emitted utility-worker.js at runtime.

export default defineConfig({
  build: {
    rollupOptions: {
      // EXTERNALS: never bundle the native addon, Electron itself, or the prebuild loader.
      // These must resolve at runtime from node_modules (or prebuilds/) in both dev and
      // packaged mode. Bundling them would break the .node dlopen path and the ASAR unpack.
      external: [
        '@swg/native-core',
        'electron',
        'node-gyp-build',
      ],
      // NAMED INPUTS: emit both the main process entry and the utility worker as separate
      // files. Forge uses these names for the output filenames (.vite/build/{name}.js).
      // Plan 03 owns these source files; we register the paths here as the contract.
      input: {
        main: 'packages/backend/src/main.ts',
        // utility-worker: Plan 03 creates packages/backend/src/utility-worker.ts
        // Plan 03's utilityProcess.fork() finds it at the emitted .vite/build/utility-worker.js
        'utility-worker': 'packages/backend/src/utility-worker.ts',
      },
    },
  },
  resolve: {
    // Resolve @swg/* aliases so imports in main.ts / utility-worker.ts work
    alias: {
      '@swg/contracts': new URL('./packages/contracts/src/index.ts', import.meta.url).pathname,
    },
  },
});
