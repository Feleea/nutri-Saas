import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    setupFiles: ['tests/setup.ts'],
    fileParallelism: false, // testes de banco compartilham o mesmo schema
    testTimeout: 20000,
  },
});
