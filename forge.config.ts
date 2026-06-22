import type { ForgeConfig } from '@electron-forge/shared-types';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { VitePlugin } from '@electron-forge/plugin-vite';

const config: ForgeConfig = {
  packagerConfig: {
    // asar: true is REQUIRED so that @electron-forge/plugin-auto-unpack-natives
    // can unpack .node files outside the ASAR archive (see RESEARCH.md Pitfall 2:
    // without AutoUnpackNativesPlugin + asar, dlopen fails on the packed .node file).
    asar: true,
    // derefSymlinks: resolve pnpm workspace symlinks during packaging.
    derefSymlinks: true,
    // extraResource: copy @swg/native-core to resources/native-core/ alongside the ASAR.
    // The Forge Vite plugin only packs .vite/ (Vite outputs) into the ASAR; it does NOT
    // include node_modules/. For native addons that are externalized (not bundleable), we
    // copy the package to resources/ and reference it from the renderer via app.getPath('exe').
    //
    // @electron-forge/plugin-auto-unpack-natives only unpacks .node files that are IN the
    // ASAR. Since @swg/native-core is not in the ASAR, we use extraResource instead.
    // The renderer's require('@swg/native-core') is patched via the preload to resolve
    // from the resources/native-core/ path (see preload.ts). This is the standard pattern
    // for external native addons with Forge+Vite (Pitfall 2 variant).
    extraResource: ['packages/native-core'],
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
