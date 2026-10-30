import { defineConfig } from 'vite';

export default defineConfig({
  base: '/sprays/',
  build: { sourcemap: true },
  worker: { format: 'es' },
});
