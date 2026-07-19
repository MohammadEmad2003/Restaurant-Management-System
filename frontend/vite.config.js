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
  build: {
    outDir: 'dist',
    // Split large shared vendors into their own long-cached chunks so they are
    // downloaded once and not duplicated across the lazy-loaded route chunks.
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-charts': ['recharts'],
          'vendor-i18n': ['i18next', 'react-i18next'],
        },
      },
    },
  },
});
