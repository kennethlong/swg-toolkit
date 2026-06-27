import { defineConfig } from 'vitest/config';

// vitest.config.ts — native-core package test config
// Runs tests in forks mode (required for .node native addons).
// Uses node environment (no browser DOM needed for native addon tests).

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    pool: 'forks',
  },
});
