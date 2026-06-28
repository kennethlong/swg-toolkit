import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.tsx', 'src/**/*.test.ts', 'test/**/*.test.ts'],
    setupFiles: ['./test/setup-data-root.ts'],
    globals: true,
  },
});
