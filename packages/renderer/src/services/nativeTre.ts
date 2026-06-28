/**
 * packages/renderer/src/services/nativeTre.ts
 * Single Path B require() seam for the native TRE addon (@swg/native-core).
 *
 * Why a dedicated module instead of importing @swg/native-core directly:
 *
 *   Production (Electron renderer, nodeIntegration:true):
 *     A bare `require('@swg/native-core')` is left UNTOUCHED by Vite, so the addon
 *     resolves through Electron's real Node at runtime. A top-level ESM `import` from
 *     '@swg/native-core' instead makes Vite pre-bundle the addon's index.js into the
 *     browser module graph and run its node-gyp-build loader at renderer startup in a
 *     shimmed context (`os.platform is not a function`) — which blanks the whole window.
 *
 *   Tests (vitest, node env):
 *     vitest externalizes native .node addons, so `require('@swg/native-core')` bypasses
 *     the vi.mock registry. Consumers import the native API from THIS local ESM module,
 *     which vitest transforms and can intercept: `vi.mock('../services/nativeTre', …)`.
 *
 * Every renderer call site that needs the addon uses `require('@swg/native-core')`
 * (TreVfsBrowser, packPatch, StatusBar, …); this module centralizes that one require
 * for the shared TRE-mount path so the seam is mockable without loading the binary.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
export const nativeCore = require('@swg/native-core') as {
  mountSearchableAsync: (paths: string[], priorities: number[]) => Promise<string>;
  getMountArchives: (handle: string) => Array<{
    path: string;
    version: string;
    enumerateOnly: boolean;
    entryCount: number;
    priority: number;
    archiveIndex: number;
  }>;
  getMountEntriesColumnar: (handle: string) => ArrayBuffer;
};
