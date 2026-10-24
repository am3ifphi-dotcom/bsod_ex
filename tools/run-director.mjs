import { build } from 'esbuild';
await build({ entryPoints: ['tools/director-smoke.ts'], outfile: '.test-out/director.mjs', bundle: true, platform: 'node', format: 'esm', external: ['three'], logLevel: 'warning' });
