import { defineConfig, type Plugin } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { builtinModules, createRequire } from 'node:module';

const nodeRequire = createRequire(import.meta.url);

// ── Path B: node builtins reach the renderer via runtime require(), not bundling ──
//
// The renderer runs with nodeIntegration:true (Path B). Node builtins (fs, path,
// child_process, crypto, util, …) must resolve to the renderer's runtime require()
// — the SAME mechanism @swg/native-core uses (see external list below). Vite/Rollup
// otherwise replaces a bare `import … from 'fs'` with a __vite-browser-external stub
// that THROWS on first property access, crashing the app at module load.
//
// This plugin intercepts builtin specifiers (enforce:'pre', ahead of Vite's own
// externalizer) and emits a tiny virtual module that requires the real builtin at
// runtime and re-exports its members statically (default + named), so both
// `import fs from 'fs'` and `import { execFile } from 'child_process'` work.
function electronRendererBuiltins(): Plugin {
  const names = new Set<string>();
  for (const m of builtinModules) {
    names.add(m);
    names.add('node:' + m);
  }
  const PREFIX = '\0builtin:';
  return {
    name: 'electron-renderer-builtins',
    enforce: 'pre',
    resolveId(id) {
      return names.has(id) ? PREFIX + id : null;
    },
    load(id) {
      if (!id.startsWith(PREFIX)) return null;
      const bare = id.slice(PREFIX.length).replace(/^node:/, '');
      let exportKeys: string[] = [];
      try {
        const mod = nodeRequire(bare) as Record<string, unknown>;
        if (mod && typeof mod === 'object') {
          // Valid JS identifiers only; `default` is provided separately below.
          exportKeys = Object.keys(mod).filter(
            (k) => k !== 'default' && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k),
          );
        }
      } catch {
        /* builtin with no enumerable members — default export still works */
      }
      const named = exportKeys
        .map((k) => `export const ${k} = _m[${JSON.stringify(k)}];`)
        .join('\n');
      // nodeIntegration injects require both lexically and (usually) on globalThis.
      // Prefer globalThis.require (Vite never transforms a member expression); fall
      // back to the bare `require` the existing panels use (proven to resolve here).
      return [
        'const _r = (typeof globalThis !== "undefined" && globalThis.require) ? globalThis.require : require;',
        `const _m = _r(${JSON.stringify(bare)});`,
        'export default _m;',
        named,
      ].join('\n');
    },
  };
}

// vite.renderer.config.ts — Electron renderer process (Path B, native-in-renderer)
//
// PATH B (native-in-renderer, 00-03 REPLAN):
//   The renderer is NOT sandboxed (sandbox:false + nodeIntegration:true, fallback posture).
//   The renderer main world can require('@swg/native-core') directly — no preload bridge.
//   @swg/native-core MUST be external to prevent Vite/Rollup from trying to bundle the
//   native .node binary (which would break dlopen at runtime).
//
//   For Plan 00-04 (React shell), this config stays intact — the React app will also
//   have access to @swg/native-core via require() in the renderer context.
//
// Root is packages/renderer so that Vite resolves index.html from there.
// Plan 04 replaces the minimal proof entry (index.html + src/main.tsx) with the React shell.

export default defineConfig({
  // Renderer root is the packages/renderer directory where index.html lives.
  // Forge's Vite plugin serves this as the main window content.
  root: 'packages/renderer',
  plugins: [
    // Must precede tailwind/others so it claims builtin ids before Vite externalizes them.
    electronRendererBuiltins(),
    // Tailwind v4: no PostCSS config needed; uses the @tailwindcss/vite plugin directly.
    // CSS entry must contain `@import "tailwindcss";` (Plan 04 creates index.css).
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@swg/contracts': new URL('./packages/contracts/src/index.ts', import.meta.url).pathname,
    },
  },
  build: {
    // Explicit outDir: put the renderer build at the PACKAGE ROOT's .vite/renderer/main_window/
    // (not inside packages/renderer/.vite/). This matches what Electron Forge expects for the
    // packaged build: app.getAppPath() + '/.vite/renderer/main_window/index.html'.
    // Without this, Vite defaults to <root>/.vite/renderer/main_window/ which is
    // packages/renderer/.vite/... — not included in the packaged ASAR.
    outDir: '../../.vite/renderer/main_window',
    emptyOutDir: true,
    rollupOptions: {
      // EXTERNALS: @swg/native-core is a native .node addon — resolved by node-gyp-build
      // at runtime; Rollup cannot bundle it. node-gyp-build itself is also external.
      external: ['@swg/native-core', 'node-gyp-build'],
    },
  },
});
