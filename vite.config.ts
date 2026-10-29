import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
    cors: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
    cors: true,
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
    // The sandbox this is previewed from wipes node_modules/ and dist/ between sessions, which
    // takes the dev server down with it and leaves the preview showing a blank page. Build the
    // preview bundle into a directory that survives, so a plain static server can serve it.
    outDir: process.env.BSOD_OUTDIR || 'dist',
    emptyOutDir: true,
  },
});
