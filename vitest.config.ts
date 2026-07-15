import { defineConfig } from 'vitest/config';
import path from 'node:path';

// vitest.config.ts — workspace root Vitest config
// Resolves @swg/* workspace aliases so unit tests can import contracts/ types
// without needing a tsc build step first.
//
// Exclude: e2e/ (Playwright specs, not vitest)
// Pool: forks — isolates each test file in a separate Node process (safe for native-core tests)

export default defineConfig({
  test: {
    include: [
      'packages/*/test/**/*.test.ts',
      'packages/*/src/**/*.test.ts',
    ],
    exclude: [
      'e2e/**',
      'node_modules/**',
    ],
    environment: 'node',
    pool: 'forks',
    // --expose-gc: the root runner globs packages/live-inject/test/soak.test.ts (05-12
    // Task 1, LIVE-03 SC1), which hard-throws without a real global.gc rather than
    // silently skipping. Mirror the package's own vitest config so the aggregate root
    // run exercises the soak proof for real instead of failing. Harmless no-op for
    // every other test file. (Vitest 4: execArgv is a top-level `test` option.)
    execArgv: ['--expose-gc'],
    // Redirect toolkit data (studios/projects) into a per-run temp dir so tests that
    // create/open workspaces never pollute the user's real %LOCALAPPDATA%\swg-toolkit.
    setupFiles: ['./packages/renderer/test/setup-data-root.ts'],
  },
  resolve: {
    alias: {
      '@swg/contracts': path.resolve(__dirname, 'packages/contracts/src/index.ts'),
      '@swg/native-core': path.resolve(__dirname, 'packages/native-core/index.d.ts'),
      '@swg/harness': path.resolve(__dirname, 'packages/harness'),
    },
  },
});
