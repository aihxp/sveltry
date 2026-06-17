import { readFileSync } from 'node:fs';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

// Expose the package version to the app (the Help menu shows it), read at build
// time so it tracks package.json and never drifts.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  // Tailwind v4 plugin must come before SvelteKit.
  plugins: [tailwindcss(), sveltekit()],
  server: {
    fs: {
      // Allow importing the generated Convex API from the sibling backend workspace.
      allow: ['..', '../..'],
    },
  },
});
