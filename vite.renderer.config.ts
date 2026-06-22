import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

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
    rollupOptions: {
      // EXTERNALS: @swg/native-core is a native .node addon — resolved by node-gyp-build
      // at runtime; Rollup cannot bundle it. node-gyp-build itself is also external.
      external: ['@swg/native-core', 'node-gyp-build'],
    },
  },
});
