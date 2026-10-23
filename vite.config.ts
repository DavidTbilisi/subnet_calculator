import { defineConfig } from 'vitest/config';

export default defineConfig({
  // relative asset paths, so the build also works under the GitHub Pages subpath
  base: './',
  // three.js alone is about 500 kB minified
  build: { chunkSizeWarningLimit: 700 },
  test: {
    coverage: {
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
    },
  },
});
