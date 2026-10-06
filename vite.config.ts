import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'client',
  plugins: [react()],
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
    port: 5173,
    // Anchored so it doesn't also catch the client's own /api.ts module.
    proxy: { '^/api/': 'http://localhost:3001' },
  },
});
