import { defineConfig } from 'vite';

// vite.main.config.ts — Electron main-process build config
//
// PATH B (native-in-renderer, 00-03 REPLAN):
//   The utility-worker entry has been REMOVED. The utility process is no longer
//   on the data path — the native addon is loaded directly in the renderer's
//   process cluster via the preload script (sandbox:false). There is no
//   utilityProcess.fork() call in main.ts.
//
// The @swg/native-core external remains so that the preload script (which is
// built by vite.preload.config.ts) can require() it at runtime without it being
// bundled into the preload bundle (which would break the dlopen path).

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
      // NAMED INPUTS: only main.ts. The utility-worker entry is removed (Path B — no utility
      // process on the data path). Plan 04 will add the React renderer entry via vite.renderer.
      input: {
        main: 'packages/backend/src/main.ts',
      },
    },
  },
  resolve: {
    // Resolve @swg/* aliases so imports in main.ts work
    alias: {
      '@swg/contracts': new URL('./packages/contracts/src/index.ts', import.meta.url).pathname,
    },
  },
});
