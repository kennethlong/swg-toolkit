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
    // emptyOutDir: false (04.4-09 Task 1 fix) — forge's VitePlugin always forces this to false
    // ("prevent multiple builds from interfering with each other" — see @electron-forge/
    // plugin-vite's getBuildConfig) when it drives the build. CI's lean job now invokes this
    // config standalone via `vite build -c vite.preload.config.ts`, bypassing that injection —
    // without an explicit false here, Vite's default emptyOutDir:true wipes `.vite/build/`
    // (including main.js, written by the prior build step) before writing preload.js.
    emptyOutDir: false,
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
