import { defineConfig } from 'vite';

// Relative base so the build works from any GitHub Pages sub-path (/<repo>/).
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1200,
  },
  test: {
    include: ['tests/**/*.test.js'],
    environment: 'node',
  },
});
