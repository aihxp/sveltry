import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  // Tailwind v4 plugin must come before SvelteKit.
  plugins: [tailwindcss(), sveltekit()],
  server: {
    fs: {
      // Allow importing the generated Convex API from the sibling backend workspace.
      allow: ['..', '../..'],
    },
  },
});
