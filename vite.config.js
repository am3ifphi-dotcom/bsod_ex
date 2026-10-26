import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    // プレビュー用ホスト（*.e2b.app など）からのアクセスを許可
    allowedHosts: true,
    cors: true,
    proxy: {
      // ブラウザから直接 api.sketchfab.com を叩けない環境向けのフォールバック経路
      '/api/sketchfab': {
        target: 'https://api.sketchfab.com',
        changeOrigin: true,
        timeout: 8000,
        rewrite: (path) => path.replace(/^\/api\/sketchfab/, '/v3'),
      },
    },
  },
  build: {
    target: 'es2020',
    cssCodeSplit: false,
    chunkSizeWarningLimit: 900,
  },
});
