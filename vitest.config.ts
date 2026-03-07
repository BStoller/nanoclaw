import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'skills-engine/**/*.test.ts'],
    testTimeout: 20000,
    hookTimeout: 20000,
    maxWorkers: 2,
  },
});
