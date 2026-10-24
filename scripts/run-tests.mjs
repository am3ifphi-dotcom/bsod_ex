#!/usr/bin/env node
// Test runner: bundles every tests/*.test.ts with esbuild and runs them with
// node's built-in test runner.
//
// Why bundle first: the sources use extensionless ESM imports (`from
// '../core/utils'`), which `node --experimental-strip-types` cannot resolve.
// esbuild rewrites them and lets the suite import the exact same modules the
// game ships.
//
//   npm test              # all suites
//   npm test -- nav       # only files whose name contains "nav"
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testsDir = path.join(root, 'tests');
const outDir = path.join(root, '.arena-test', 'tests');

const filter = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const files = fs.readdirSync(testsDir)
  .filter((f) => f.endsWith('.test.ts'))
  .filter((f) => !filter.length || filter.some((p) => f.includes(p)))
  .sort();

if (!files.length) {
  console.error(`no test files matched ${filter.join(', ') || '(all)'}`);
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });
const bundles = [];
for (const f of files) {
  const out = path.join(outDir, f.replace(/\.ts$/, '.mjs'));
  await build({
    entryPoints: [path.join(testsDir, f)],
    outfile: out,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    packages: 'external',
    logLevel: 'error',
  });
  bundles.push(out);
  console.log(`bundled tests/${f}`);
}

try {
  execFileSync(process.execPath, ['--test', ...bundles], { stdio: 'inherit', cwd: root });
} catch {
  process.exit(1);
}
