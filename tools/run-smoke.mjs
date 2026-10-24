import { build } from 'esbuild';
await build({
  entryPoints: ['tools/smoke.ts'],
  outfile: '.test-out/smoke.mjs',
  bundle: true, platform: 'node', format: 'esm', target: 'node20',
  external: ['three'],
  logLevel: 'warning',
});
