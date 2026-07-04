import { defineConfig } from 'vite';
import { builtinModules } from 'node:module';

// NODE_BUILTINS (04.4-09 Task 1 fix): forge's own main config always adds every builtin
// module name (bare AND 'node:'-prefixed) to rollupOptions.external — see
// @electron-forge/plugin-vite's vite.base.config.js `builtins` constant. Without this,
// Vite's `resolve.conditions: ['node']` alone does NOT stop Rollup from falling back to its
// browser-externalization stub for a static `import path from 'node:path'` (main.ts,
// windowState.ts) — that stub is an empty `{}` object, which crashed the app at runtime with
// `TypeError: s.join is not a function` (verified locally via a direct `electron.exe .`
// launch) before any window was created. Marking these truly `external` makes Rollup emit a
// real `require('node:path')` in the CJS output instead.
const NODE_BUILTINS = [...builtinModules, ...builtinModules.map((m) => `node:${m}`)];

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
  // Explicit define (04.4-09 Task 1): electron-forge's VitePlugin normally injects
  // MAIN_WINDOW_VITE_DEV_SERVER_URL / MAIN_WINDOW_VITE_NAME as build-time globals (see
  // packages/backend/src/globals.d.ts + @electron-forge/plugin-vite's getBuildDefine()).
  // A standalone `vite build -c vite.main.config.ts` (this CI step) never runs that
  // injection, so main.ts's references to these two identifiers are left UNRESOLVED in
  // the bundle — under Node/Electron's strict-mode CJS load this throws a ReferenceError
  // inside app.whenReady().then(...), crashing before the window is ever created (this
  // was verified locally: e2e/01-boot.spec.ts's firstWindow() timed out until this fix).
  // Values here match the production/packaged path (no dev server; app:// protocol
  // handler serves .vite/renderer/main_window/, matching forge.config.ts's renderer name
  // and vite.renderer.config.ts's outDir) — exactly what CI's non-packaged E2E specs need.
  define: {
    MAIN_WINDOW_VITE_DEV_SERVER_URL: 'undefined',
    MAIN_WINDOW_VITE_NAME: JSON.stringify('main_window'),
    // 04.4-13 fix: without this, Vite's default client-build `define` replaces the bare
    // `process.env` token with a build-time-empty object literal (verified locally — the
    // built main.js contained `var D={}` standing in for every `process.env.X` read,
    // including main.ts's own `SWG_TEST_MODE` gate, making it permanently false regardless
    // of the real launch-time environment). This is a NODE-target build (main.ts is the
    // Electron main process) — `process.env` there IS the real Node global and must not be
    // statically replaced. Explicitly defining the two-token sequence as itself is the
    // standard Vite workaround to suppress the client-build process.env stub.
    'process.env': 'process.env',
  },
  build: {
    // Explicit outDir/format (04.4-09 Task 1): normally electron-forge's VitePlugin injects
    // `outDir: '.vite/build'` + CJS `build.lib` settings at package/start time (see
    // ViteConfigGenerator + config/vite.main.config.js in @electron-forge/plugin-vite). CI's
    // lean job now invokes `vite build -c vite.main.config.ts` DIRECTLY (bypassing forge) so
    // Playwright specs can run against a fresh bundle without the slow `electron-forge package`.
    // Without an explicit outDir/format here, a standalone `vite build` falls back to Vite's
    // default `dist/assets/main-<hash>.js` as an ES module — neither the path
    // `package.json#main` (`.vite/build/main.js`) nor plain `require()` (main.js is loaded as
    // CJS, no `"type": "module"` in package.json) can consume that. Mirrors the same explicit
    // `output.dir`/`entryFileNames` fix already applied in vite.preload.config.ts.
    outDir: '.vite/build',
    emptyOutDir: false,
    rollupOptions: {
      // EXTERNALS: never bundle the native addon, Electron itself, or the prebuild loader.
      // These must resolve at runtime from node_modules (or prebuilds/) in both dev and
      // packaged mode. Bundling them would break the .node dlopen path and the ASAR unpack.
      external: [
        '@swg/native-core',
        'electron',
        'node-gyp-build',
        ...NODE_BUILTINS,
      ],
      // NAMED INPUTS: only main.ts. The utility-worker entry is removed (Path B — no utility
      // process on the data path). Plan 04 will add the React renderer entry via vite.renderer.
      input: {
        main: 'packages/backend/src/main.ts',
      },
      output: {
        format: 'cjs',
        entryFileNames: '[name].js',
      },
    },
  },
  resolve: {
    // Resolve @swg/* aliases so imports in main.ts work
    alias: {
      '@swg/contracts': new URL('./packages/contracts/src/index.ts', import.meta.url).pathname,
    },
    // conditions/mainFields (04.4-09 Task 1 fix): forge's own main config always sets these
    // (see config/vite.main.config.js in @electron-forge/plugin-vite) to tell Vite this is a
    // NODE build, not a browser build. Without `conditions: ['node']`, Vite's resolver treats
    // static `import path from 'node:path'` (main.ts, windowState.ts) as a BROWSER import and
    // replaces it with an empty `{}` stub (the same "externalized for browser compatibility"
    // warning seen during the build) instead of a real CJS `require('node:path')` — this
    // crashed the app at runtime (`TypeError: s.join is not a function`, verified locally via
    // a direct `electron.exe .` launch) before any window was created.
    conditions: ['node'],
    mainFields: ['module', 'jsnext:main', 'jsnext'],
  },
});
