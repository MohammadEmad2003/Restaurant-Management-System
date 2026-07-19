import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server proxies /api to the Node backend so there are no CORS issues.
export default defineConfig({
  plugins: [react()],
  base: './', // relative paths so the build also works inside Electron
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
    },
  },
  build: { outDir: 'dist' },
});
