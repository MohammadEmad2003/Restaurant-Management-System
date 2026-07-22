import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server proxies /api to the Node backend so there are no CORS issues.
export default defineConfig({
  plugins: [react()],
  base: './', // relative paths so the build also works inside Electron
  server: {
    port: 5173,
    // Fail loudly if 5173 is taken instead of silently rebinding to another
    // port — Electron's main.js hardcodes loadURL('http://localhost:5173'),
    // so a silent port change there would leave it pointed at nothing.
    strictPort: true,
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
