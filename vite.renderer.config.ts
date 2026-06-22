import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

// vite.renderer.config.ts — React renderer (sandboxed Electron renderer process)
//
// The renderer is sandboxed (no Node.js access). All native functionality is exposed
// via the contextBridge in the preload script. Do NOT add Node externals here.
//
// Root is packages/renderer so that Vite resolves index.html from there.
// Plan 04 creates the React app source under packages/renderer/src/.

export default defineConfig({
  // Renderer root is the packages/renderer directory where index.html will live (Plan 04).
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
  // No externals — renderer is sandboxed. All Node imports must go through the preload bridge.
});
