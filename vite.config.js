import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  clearScreen: false,
  build: {
    outDir: 'dist',
    target: 'es2021',
    chunkSizeWarningLimit: 2000,
  },
});
