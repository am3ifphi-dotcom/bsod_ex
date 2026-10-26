import { defineConfig } from 'vite';

// プレビュー用のプロキシ越し（https://{port}-{sandbox}.e2b.app）でも動くように
// 全ホストを許可し、0.0.0.0 で待ち受ける。
export default defineConfig({
  base: './',
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: true,
    hmr: {
      // プロキシ経由でも WebSocket が同じオリジンに繋がるようにする
      protocol: 'ws',
      host: undefined,
      clientPort: undefined,
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: true,
  },
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1200,
  },
});
