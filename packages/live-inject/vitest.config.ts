import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Local vitest config for @swg/live-inject.
// Resolved from the package directory; aliases mirror the workspace root config.

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    pool: 'forks',
  },
  resolve: {
    alias: {
      '@swg/contracts': path.resolve(__dirname, '../../packages/contracts/src/index.ts'),
    },
  },
});
