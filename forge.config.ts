import type { ForgeConfig } from '@electron-forge/shared-types';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { VitePlugin } from '@electron-forge/plugin-vite';

const config: ForgeConfig = {
  packagerConfig: {
    // asar: true is REQUIRED so that @electron-forge/plugin-auto-unpack-natives
    // can unpack .node files outside the ASAR archive (see RESEARCH.md Pitfall 2:
    // without AutoUnpackNativesPlugin + asar, dlopen fails on the packed .node file).
    asar: true,
  },
  rebuildConfig: {},
  makers: [],
  plugins: [
    // AutoUnpackNativesPlugin MUST be listed BEFORE VitePlugin.
    // It scans the packaged app for all native .node modules and unpacks them
    // to app.asar.unpacked/ so dlopen can resolve them at runtime.
    // Without this, the addon loaded in the utility process throws MODULE_NOT_FOUND
    // in the packaged build. (RESEARCH.md Pitfall 2 / review fix HIGH / T-00-02)
    new AutoUnpackNativesPlugin({}),
    new VitePlugin({
      // A single concurrent Vite build per process entry point.
      // Forge orchestrates: main build first, then renderer.
      build: [
        {
          entry: 'packages/backend/src/main.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'packages/backend/src/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
  ],
};

export default config;
