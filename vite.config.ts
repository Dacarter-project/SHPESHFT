import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [svelte()],
  build: {
    target: 'es2022',
    sourcemap: true
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts']
  }
});
