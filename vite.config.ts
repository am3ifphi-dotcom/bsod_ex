import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    // Arena / 社内プロキシ等、任意のホスト名プレビューで動くようにする
    allowedHosts: true,
    cors: true,
  },
  preview: { host: '0.0.0.0', port: 4173, strictPort: true, allowedHosts: true },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1600,
    assetsInlineLimit: 0,
  },
});
