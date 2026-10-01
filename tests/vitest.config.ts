import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'cross-cutting',
    environment: 'node',
    include: ['**/*.test.ts'],
    exclude: ['e2e/**'],
    setupFiles: ['./setup/no-network.ts'],
  },
});
