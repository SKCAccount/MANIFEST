import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Booting a WASM Postgres per suite is the expensive part; a generous
    // timeout keeps CI from flaking on a cold start.
    testTimeout: 60_000,
    hookTimeout: 120_000,
    pool: 'forks',
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
