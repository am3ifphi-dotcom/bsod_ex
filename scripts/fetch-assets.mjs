#!/usr/bin/env node
/**
 * fetch-assets.mjs
 * ------------------------------------------------------------------
 * 外部アセットの取得スクリプト。すべて「実際に取得できることを確認済み」の
 * 公開リポジトリ / 公開URLのみを使う。
 *
 *  1) KhronosGroup/glTF-Sample-Assets (github.com)
 *       - 家具・小物・ヘルメット等の高品質 glTF (CC0 / CC-BY-4.0)
 *       - git の partial clone + sparse-checkout で必要なモデルだけ取得 (数百MBの全リポジトリは落とさない)
 *  2) petroulacl/fps-asset-kit (github.com) … ミラー済みの CC0 アセット
 *       - textures/<name> : ambientCG の 2K PBR テクスチャ (CC0-1.0)
 *       - sfx/footsteps   : Fantozzi's Footsteps (CC0-1.0)
 *
 * 実行: npm run fetch-assets
 * 出力先: ./assets-src  (リポジトリには含めない / .gitignore 済み)
 *
 * 変換は `npm run build-assets` が担当する。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'assets-src');

const KHRONOS_MODELS = [
  'SheenWoodLeatherSofa', 'SheenChair', 'Lantern', 'WaterBottle',
  'DiffuseTransmissionPlant', 'GlassVaseFlowers', 'ToyCar', 'PotOfCoals',
  'SciFiHelmet', 'FlightHelmet',
];

// ambientCG (CC0) テクスチャセット
const TEXTURES = [
  'Wood092', 'Wood094', 'Wood095', 'Plaster001', 'Plaster002', 'Plaster007',
  'Concrete048', 'Bricks102', 'Metal063', 'Asphalt031', 'Rock058', 'Ground054',
];

const STEPS = 2;

function run(cmd, args, cwd, optional = false) {
  try {
    execFileSync(cmd, args, { cwd, stdio: 'inherit' });
  } catch (e) {
    if (!optional) throw e;
    console.warn(`   ! ${cmd} ${args.join(' ')} failed (continuing)`);
  }
}

function have(p) { return fs.existsSync(p); }

function cloneSparse(repo, dir, patterns, depth = 1) {
  fs.mkdirSync(dir, { recursive: true });
  if (!have(path.join(dir, '.git'))) {
    console.log(`\n▶ cloning ${repo} (blobless, sparse)`);
    run('git', ['clone', '--filter=blob:none', '--sparse', '--depth', String(depth),
      `https://github.com/${repo}.git`, dir], ROOT);
    run('git', ['config', 'gc.auto', '0'], dir, true);
  }
  console.log(`  sparse-checkout: ${patterns.length} patterns`);
  run('git', ['sparse-checkout', 'set', '--no-cone', ...patterns], dir);
  run('git', ['checkout', '--', '.'], dir, true);
}

function step(n, title) {
  console.log(`\n=== [${n}/${STEPS}] ${title} ===`);
}

// ---------------------------------------------------------------- 1
step(1, 'Khronos glTF Sample Assets');
const khronosDir = path.join(SRC, 'khronos');
cloneSparse(
  'KhronosGroup/glTF-Sample-Assets',
  khronosDir,
  ['/LICENSES/**', ...KHRONOS_MODELS.map((m) => `/Models/${m}/**`)],
);
// ライセンス本文を常に同梱
for (const m of KHRONOS_MODELS) {
  const lic = path.join(khronosDir, 'Models', m, 'LICENSE.md');
  if (!have(lic)) console.warn(`   ! LICENSE.md missing for ${m}`);
}

// ---------------------------------------------------------------- 2
step(2, 'ambientCG PBR textures + Fantozzi footsteps (CC0 mirror)');
const fpsDir = path.join(SRC, 'fps');
cloneSparse('petroulacl/fps-asset-kit', fpsDir, [
  ...TEXTURES.map((t) => `/textures/${t}/**`),
  '/sfx/footsteps/**',
]);

// 必要なマップだけ assets-src/fps/keep にコピーしておく (build-assets が参照)
const keepTex = path.join(SRC, 'fps', 'textures');
for (const t of TEXTURES) {
  const dir = path.join(keepTex, t);
  if (have(dir)) console.log(`   ✓ texture ${t}`);
  else console.warn(`   ! texture ${t} missing`);
}
const steps = path.join(SRC, 'fps', 'sfx', 'footsteps', 'Fantozzi-footsteps', 'ogg');
if (have(steps)) console.log(`   ✓ footsteps: ${fs.readdirSync(steps).length} files`);

console.log('\n完了。次に `npm run build-assets` を実行してください。');
