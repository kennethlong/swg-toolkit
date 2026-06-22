import { defineConfig } from 'vite';

// vite.preload.config.ts — Electron preload script build config
//
// PATH B (native-in-renderer, 00-03 REPLAN):
//   The preload script (sandbox:false) requires '@swg/native-core' at runtime.
//   @swg/native-core MUST be external — it is a native .node file resolved by
//   node-gyp-build at runtime from prebuilds/. Bundling it would break the
//   dlopen path (the Rollup bundler cannot include a .node binary).
//
//   The preload also imports from 'electron' (contextBridge) — also external.
//   Both must be resolved at runtime from the Electron binary's node_modules.

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        preload: 'packages/backend/src/preload.ts',
      },
      // EXTERNALS: electron (Electron built-in) + @swg/native-core (native .node addon).
      // Both are resolved at runtime; neither can be bundled by Rollup.
      external: ['electron', '@swg/native-core', 'node-gyp-build'],
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
