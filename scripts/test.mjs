#!/usr/bin/env node
/** TS のロジックテストを esbuild でバンドルして node:test で実行する */
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

fs.mkdirSync('.test-out', { recursive: true });
const entries = fs.readdirSync('tests').filter((f) => f.endsWith('.test.ts'));
await build({
  entryPoints: entries.map((f) => `tests/${f}`),
  outdir: '.test-out',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  external: ['three'],
  sourcemap: false,
  logLevel: 'warning',
  outExtension: { '.js': '.mjs' },
});
const files = fs.readdirSync('.test-out').filter((f) => f.endsWith('.mjs')).map((f) => `.test-out/${f}`);
const r = spawnSync('node', ['--test', ...files], { stdio: 'inherit' });
process.exit(r.status ?? 1);
