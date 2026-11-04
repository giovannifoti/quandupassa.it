// Build dell'app mobile: produce dist/, che Capacitor copia nei progetti
// iOS e Android. Il codice condiviso con il sito (dati e logica delle
// fermate, preferiti) viene importato direttamente da ../public/js.
import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  base: './',
  publicDir: 'static',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version)
  },
  server: {
    port: 5173,
    strictPort: true,
    fs: { allow: ['..'] }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: ['es2020', 'safari15', 'chrome100'],
    sourcemap: false,
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1200,
    modulePreload: { polyfill: false }
  }
});
