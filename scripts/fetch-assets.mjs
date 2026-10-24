#!/usr/bin/env node
/**
 * fetch-assets.mjs — 外部アセット取得・配置スクリプト
 *
 * 取得元(すべて実際にアクセス確認済み):
 *   1. KhronosGroup/glTF-Sample-Assets   (github.com)  … 高品質3Dモデル(glTF-Binary / glTF)
 *   2. BabylonJS/Assets                  (github.com)  … PBRテクスチャ・HDR環境マップ・扇風機モデル
 *   3. mrdoob/three.js                   (github.com)  … PBRテクスチャ3点組・夜間HDRI
 *
 * すべて sparse clone (--filter=blob:none) で必要なファイルのみ取得します。
 * 注意: glTF-Sample-Assets 内の VirtualCity(3DRT: glTFツールテスト専用ライセンス)と
 * Duck(SCEA Shared Source)、PlaysetLightTest(CC-BY-NC-SA / IKEA)は、
 * 改変・再配布・流用条件が本作品に合わないため不採用(取得対象から除外済み)。
 * 実行方法:  node scripts/fetch-assets.mjs        (または npm run fetch-assets)
 * 冪等です。再実行で欠損ファイルのみ補完します。
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, '.asset-cache');
const OUT = path.join(ROOT, 'public', 'assets');

/** sparse-checkout に指定するパス一覧 */
const REPOS = [
  {
    name: 'glTF-Sample-Assets',
    url: 'https://github.com/KhronosGroup/glTF-Sample-Assets.git',
    ref: 'main',
    paths: [
      // --- ルーム用プロップ (glTF-Binary: 単一glb) ---
      'Models/AntiqueCamera/glTF-Binary',
      'Models/Lantern/glTF-Binary',
      'Models/WaterBottle/glTF-Binary',
      'Models/BoomBox/glTF-Binary',
      'Models/ChronographWatch/glTF-Binary',
      'Models/GlassVaseFlowers/glTF-Binary',
      'Models/GlassHurricaneCandleHolder/glTF-Binary',
      'Models/ChairDamaskPurplegold/glTF-Binary',
      'Models/GlamVelvetSofa/glTF-Binary',
      'Models/ScatteringSkull/glTF-Binary',
      'Models/SunglassesKhronos/glTF-Binary',
      'Models/MaterialsVariantsShoe/glTF-Binary',
      'Models/IridescenceLamp/glTF-Binary',
      'Models/ToyCar/glTF-Binary',
      'Models/SheenChair/glTF-Binary',
      'Models/DamagedHelmet/glTF-Binary',
      // --- 異世界用 ---
      'Models/Sponza/glTF',                       // 崩壊建築エリア
      'Models/TrafficCone/glTF-Binary',
      'Models/CommercialRefrigerator/glTF-Binary',
      'Models/FlightHelmet/glTF',                 // ヒーロープロップ(非圧縮)
      // --- ライセンス表記 ---
      'Models/AntiqueCamera/LICENSE.md',
      'Models/Lantern/LICENSE.md',
      'Models/WaterBottle/LICENSE.md',
      'Models/BoomBox/LICENSE.md',
      'Models/ChronographWatch/LICENSE.md',
      'Models/GlassVaseFlowers/LICENSE.md',
      'Models/GlassHurricaneCandleHolder/LICENSE.md',
      'Models/ChairDamaskPurplegold/LICENSE.md',
      'Models/GlamVelvetSofa/LICENSE.md',
      'Models/ScatteringSkull/LICENSE.md',
      'Models/SunglassesKhronos/LICENSE.md',
      'Models/MaterialsVariantsShoe/LICENSE.md',
      'Models/IridescenceLamp/LICENSE.md',
      'Models/ToyCar/LICENSE.md',
      'Models/SheenChair/LICENSE.md',
      'Models/DamagedHelmet/LICENSE.md',
      'Models/Sponza/LICENSE.md',
      'Models/TrafficCone/LICENSE.md',
      'Models/CommercialRefrigerator/LICENSE.md',
      'Models/FlightHelmet/LICENSE.md',
    ],
  },
  {
    name: 'BabylonJS-Assets',
    url: 'https://github.com/BabylonJS/Assets.git',
    ref: 'master',
    paths: [
      'meshes/vintageDeskFan',                    // アニメーション付き扇風機(PBR)
      'ibl/room.hdr',                             // 屋内IBL
      'ibl/night.hdr',                            // 夜IBL
      'ibl/country.hdr',                          // 野外IBL
      'textures/rockyGround_basecolor.png',       // 岩地PBRセット
      'textures/rockyGround_metalRough.png',
      'textures/rockyGround_normal.png',
      'textures/dirt.jpg',
      'textures/sand.jpg',
      'textures/rock.png',
      'textures/rockn.png',
      'textures/woodAlbedo.png',
      'LICENSE',
    ],
  },
  {
    name: 'three.js',
    url: 'https://github.com/mrdoob/three.js.git',
    ref: 'dev',
    paths: [
      'examples/textures/hardwood2_diffuse.jpg',  // 木製床PBRセット
      'examples/textures/hardwood2_bump.jpg',
      'examples/textures/hardwood2_roughness.jpg',
      'examples/textures/brick_diffuse.jpg',      // レンガPBRセット
      'examples/textures/brick_bump.jpg',
      'examples/textures/brick_roughness.jpg',
      'examples/textures/equirectangular/moonless_golf_1k.hdr', // 夜間HDRI (Poly Haven CC0)
    ],
  },
];

/** コピー先マップ: リポジトリ内パス → public/assets/ 配下 */
const COPY_MAP = [
  [/^Models\/([\w-]+)\/glTF-Binary\/([\w.-]+\.glb)$/, (m) => `models/${m[1]}.glb`],
  [/^Models\/FlightHelmet\/glTF\/(.+)$/, (m) => `models/FlightHelmet/${m[1]}`],
  [/^Models\/Sponza\/glTF\/(.+)$/, (m) => `models/Sponza/${m[1]}`],
  [/^Models\/([\w-]+)\/LICENSE\.md$/, (m) => `licenses/${m[1]}.LICENSE.md`],
  [/^meshes\/vintageDeskFan\/(.+)$/, (m) => `models/vintageDeskFan/${m[1]}`],
  [/^ibl\/(.+)$/, (m) => `env/${m[1]}`],
  [/^textures\/(.+)$/, (m) => `textures/${m[1]}`],
  [/^examples\/textures\/equirectangular\/(.+)$/, (m) => `env/${m[1]}`],
  [/^examples\/textures\/(.+)$/, (m) => `textures/${m[1]}`],
  [/^LICENSE$/, () => `licenses/BabylonJS-Assets.LICENSE`],
];

function sh(cmd, opts = {}) {
  return execSync(cmd, { stdio: 'inherit', ...opts });
}

function ensureRepo(repo) {
  const dir = path.join(CACHE, repo.name);
  if (!fs.existsSync(path.join(dir, '.git'))) {
    console.log(`\n=== clone ${repo.name} (sparse, blobless) ===`);
    fs.mkdirSync(CACHE, { recursive: true });
    sh(`git clone --depth 1 --filter=blob:none --sparse ${JSON.stringify(repo.url)} ${JSON.stringify(dir)}`);
    sh(`git -C ${JSON.stringify(dir)} checkout ${repo.ref}`);
  }
  console.log(`=== sparse-checkout ${repo.name} ===`);
  // cone-mode off: ファイル単位の指定を許可
  sh(`git -C ${JSON.stringify(dir)} sparse-checkout set --no-cone ${repo.paths.map((p) => JSON.stringify(p)).join(' ')}`);
  return dir;
}

function walk(dir, base = dir, acc = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, base, acc);
    else acc.push({ abs: p, rel: path.relative(base, p).split(path.sep).join('/') });
  }
  return acc;
}

function copyAssets(repoDir) {
  const files = walk(repoDir).filter((f) => f.rel.startsWith('Models/') || f.rel.startsWith('meshes/') || f.rel.startsWith('ibl/') || f.rel.startsWith('textures/') || f.rel.startsWith('examples/') || f.rel === 'LICENSE');
  const manifest = [];
  for (const f of files) {
    let dest = null;
    for (const [re, fn] of COPY_MAP) {
      const m = f.rel.match(re);
      if (m) {
        dest = fn(m);
        break;
      }
    }
    if (!dest) continue;
    const destAbs = path.join(OUT, dest);
    fs.mkdirSync(path.dirname(destAbs), { recursive: true });
    if (!fs.existsSync(destAbs) || fs.statSync(destAbs).size !== fs.statSync(f.abs).size) {
      fs.copyFileSync(f.abs, destAbs);
    }
    manifest.push({ path: dest, bytes: fs.statSync(destAbs).size, source: f.rel });
  }
  return manifest;
}

function main() {
  const started = Date.now();
  fs.mkdirSync(OUT, { recursive: true });
  let manifest = [];
  for (const repo of REPOS) {
    const dir = ensureRepo(repo);
    manifest = manifest.concat(copyAssets(dir));
  }
  manifest.sort((a, b) => a.path.localeCompare(b.path));
  const total = manifest.reduce((s, f) => s + f.bytes, 0);

  // 検証: 必須ファイルが存在するか
  const REQUIRED = [
    'models/AntiqueCamera.glb',
    'models/Lantern.glb',
    'models/WaterBottle.glb',
    'models/BoomBox.glb',
    'models/ChronographWatch.glb',
    'models/GlassVaseFlowers.glb',
    'models/GlassHurricaneCandleHolder.glb',
    'models/ChairDamaskPurplegold.glb',
    'models/GlamVelvetSofa.glb',
    'models/ScatteringSkull.glb',
    'models/SunglassesKhronos.glb',
    'models/MaterialsVariantsShoe.glb',
    'models/IridescenceLamp.glb',
    'models/ToyCar.glb',
    'models/SheenChair.glb',
    'models/DamagedHelmet.glb',
    'models/TrafficCone.glb',
    'models/CommercialRefrigerator.glb',
    'models/Sponza/Sponza.gltf',
    'models/FlightHelmet/FlightHelmet.gltf',
    'models/vintageDeskFan/vintageFan_animated.gltf',
    'env/room.hdr',
    'env/night.hdr',
    'env/country.hdr',
    'env/moonless_golf_1k.hdr',
    'textures/rockyGround_basecolor.png',
    'textures/rockyGround_normal.png',
    'textures/rockyGround_metalRough.png',
    'textures/hardwood2_diffuse.jpg',
    'textures/brick_diffuse.jpg',
  ];
  const missing = REQUIRED.filter((p) => !fs.existsSync(path.join(OUT, p)));
  const result = {
    fetchedAt: new Date().toISOString(),
    seconds: Math.round((Date.now() - started) / 1000),
    totalBytes: total,
    fileCount: manifest.length,
    missingRequired: missing,
    files: manifest,
  };
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(result, null, 2));
  console.log(`\n=== done: ${manifest.length} files, ${(total / 1e6).toFixed(1)} MB, ${result.seconds}s ===`);
  if (missing.length) {
    console.error('MISSING REQUIRED FILES:', missing);
    process.exit(1);
  }
  console.log('all required assets present. manifest -> public/assets/manifest.json');
}

main();
