import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'client',
  plugins: [react()],
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
    // Defaults suit `npm run dev`; the preview copy sets VITE_PORT / API_PORT so it can run alongside it.
    port: Number(process.env.VITE_PORT ?? 5173),
    strictPort: true,
    // Anchored so it doesn't also catch the client's own /api.ts module.
    proxy: { '^/api/': `http://localhost:${process.env.API_PORT ?? 3001}` },
  },
});
