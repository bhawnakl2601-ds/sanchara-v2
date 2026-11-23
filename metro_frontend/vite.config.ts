import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  // The metro site is served by the Flask server at  http://localhost:5000/metro/  so every file URL must start with /metro/
  base: '/metro/',
  build: {
    // Put the finished website where Flask looks for it:  <project>/frontend/metro/
    outDir: '../frontend/metro',
    emptyOutDir: true,
    chunkSizeWarningLimit: 700,
    rollupOptions: { output: { manualChunks: { three: ['three'], motion: ['framer-motion'] } } },
  },
  // Only used by  npm run dev  (live-editing mode, http://localhost:5173).
  // The BMTC pages and BOTH APIs live on the Flask server (port 5000), so Vite forwards every
  // non-metro address there. Result: the whole site (front page, BMTC, metro) works on 5173 too.
  server: {
    open: '/',
    proxy: {
      '/metro-api': 'http://127.0.0.1:5000',                                   // metro API
      '^/(bmtc|api|assets|css|js|travel-guide)(/|$)': 'http://127.0.0.1:5000', // BMTC pages, BMTC API, shared images/css/js
      '^/$': 'http://127.0.0.1:5000',                                          // SANCHARA front page
    },
  },
});
