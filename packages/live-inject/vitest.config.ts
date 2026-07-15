import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Local vitest config for @swg/live-inject.
// Resolved from the package directory; aliases mirror the workspace root config.

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    pool: 'forks',
    // --expose-gc: soak.test.ts (05-12 Task 1, LIVE-03 SC1) needs a real,
    // forced, synchronous global.gc() to prove the command-slot channel's
    // Napi::Reference GC guard survives repeated collection pressure without
    // dangling the native view pointer — incidental GC timing is not a
    // sufficient proof. Harmless no-op for every other test file in this
    // package.
    // Note: Vitest 4 removed `test.poolOptions` entirely — `execArgv` is a
    // top-level `test` option that applies to whichever worker pool is
    // active (forks here), not nested under `poolOptions.forks`.
    execArgv: ['--expose-gc'],
  },
  resolve: {
    alias: {
      '@swg/contracts': path.resolve(__dirname, '../../packages/contracts/src/index.ts'),
    },
  },
});
