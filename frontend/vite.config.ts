import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { spawnSync } from 'child_process';
import fs from 'fs';

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
    configureServer(server) {
      sync();
      const origen = path.resolve(__dirname, '../public/productos');
      const copiado = path.resolve(__dirname, 'public/static/productos');
      const tipos: Record<string, string> = {
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
        webp: 'image/webp',
        avif: 'image/avif',
      };
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0];
        if (!url.startsWith('/static/productos/') && !url.startsWith('/productos/')) {
          next();
          return;
        }
        const pedido = decodeURIComponent(url.split('/').pop() ?? '');
        const match = pedido.match(/^(.*)\.([a-z0-9]+)$/i);
        if (!match) {
          next();
          return;
        }
        const base = match[1];
        const exts = [match[2].toLowerCase(), 'jpg', 'jpeg', 'png', 'webp', 'avif'];
        for (const ext of [...new Set(exts)]) {
          for (const dir of [origen, copiado]) {
            const full = path.join(dir, `${base}.${ext}`);
            if (!fs.existsSync(full)) continue;
            res.setHeader('Content-Type', tipos[ext] || 'application/octet-stream');
            res.setHeader('Cache-Control', 'public, max-age=120');
            fs.createReadStream(full).pipe(res);
            return;
          }
        }
        next();
      });
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
