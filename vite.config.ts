import { defineConfig } from 'vitest/config';

export default defineConfig({
  // relative asset paths, so the build also works under the GitHub Pages subpath
  base: './',
  // the lazily loaded 3D chunk is mostly three.js, about 530 kB minified
  build: { chunkSizeWarningLimit: 700 },
  test: {
    coverage: {
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
    },
  },
});
