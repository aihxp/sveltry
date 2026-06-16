import { defineConfig } from 'vitest/config';

// A standalone vitest config (taking precedence over vite.config.ts) so the
// dashboard's unit tests run without the SvelteKit plugin. The current tests
// cover pure `$lib` logic (e.g. the auth-gate redirect decision); they import by
// relative path and need no Svelte/SvelteKit resolution.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
