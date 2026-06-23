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
  },
  resolve: {
    alias: {
      '@swg/contracts': path.resolve(__dirname, 'packages/contracts/src/index.ts'),
      '@swg/native-core': path.resolve(__dirname, 'packages/native-core/index.d.ts'),
      '@swg/harness': path.resolve(__dirname, 'packages/harness'),
    },
  },
});
