import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      'grimdall-core': resolve(process.cwd(), 'packages/core/src/index.ts'),
      'grimdall-node': resolve(process.cwd(), 'packages/node/src/index.ts'),
    },
  },
  test: {
    include: ['packages/**/*.test.ts'],
    environment: 'node',
  },
});
