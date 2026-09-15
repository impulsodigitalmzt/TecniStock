import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { spawnSync } from 'child_process';

function fotosProductosPlugin(): Plugin {
  const sync = () => {
    spawnSync(process.execPath, [path.resolve(__dirname, '../scripts/copiar-fotos-productos.mjs'), '--soft'], {
      cwd: path.resolve(__dirname, '..'),
      stdio: 'ignore',
    });
  };
  return {
    name: 'sync-product-photos',
    buildStart() {
      sync();
    },
    configureServer() {
      sync();
    },
  };
}

export default defineConfig({
  plugins: [fotosProductosPlugin(), react()],
  base: '/',
  build: {
    outDir: path.resolve(__dirname, '../dist/client'),
    emptyOutDir: true,
    // No usar el nombre "assets": en Windows Wrangler trata public/assets
    // como un archivo de 128 TiB y aborta `wrangler dev`.
    assetsDir: 'static',
    target: 'es2020',
    sourcemap: false,
    cssCodeSplit: true,
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
      '/webhook': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
      '/api/v1/ws': {
        target: 'ws://localhost:8787',
        ws: true,
      },
    },
  },
});
