import { defineConfig } from 'vitest/config';

// convex-test runs the Convex functions in-process against an in-memory
// database. The edge-runtime environment provides the web-standard globals
// (crypto, fetch, etc.) the functions and the protocol package rely on.
export default defineConfig({
  test: {
    environment: 'edge-runtime',
    server: { deps: { inline: ['convex-test'] } },
    include: ['convex/**/*.test.ts'],
  },
});
