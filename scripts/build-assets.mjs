#!/usr/bin/env node
/**
 * build-assets.mjs
 * ------------------------------------------------------------------
 * 取得済みの外部アセット(assets-src/)を、ゲームが読み込む最適化済み形式へ変換する。
 *
 *  入力 : assets-src/khronos/Models/<name>/glTF-Binary/<name>.glb  (Khronos glTF Sample Assets)
 *         assets-src/fps/textures/<Material>/*.jpg        (ambientCG 2K PBR / CC0)
 *         assets-src/fps/sfx/footsteps/*.ogg              (Fantozzi's Footsteps / CC0)
 *
 *  出力 : public/assets/models/<key>.glb   … テクスチャ 1024px WebP + 頂点量子化
 *         public/assets/tex/<key>/(albedo|normal|orm).webp
 *         public/assets/audio/<name>.ogg
 *         public/assets/manifest.json     … 各アセットの実測バウンディングボックス・三角形数
 *
 * 変換はすべてローカルで完結し、実行時は一切外部通信しない。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  dedup, prune, weld, quantize, resample, textureCompress, getGLPrimitiveCount,
} from '@gltf-transform/functions';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'assets-src');
const OUT = path.join(ROOT, 'public', 'assets');

const MODELS = {
  sofa: 'SheenWoodLeatherSofa/glTF-Binary/SheenWoodLeatherSofa.glb',
  chair: 'SheenChair/glTF-Binary/SheenChair.glb',
  lantern: 'Lantern/glTF-Binary/Lantern.glb',
  bottle: 'WaterBottle/glTF-Binary/WaterBottle.glb',
  plant: 'DiffuseTransmissionPlant/glTF-Binary/DiffuseTransmissionPlant.glb',
  vase: 'GlassVaseFlowers/glTF-Binary/GlassVaseFlowers.glb',
  toycar: 'ToyCar/glTF-Binary/ToyCar.glb',
  coals: 'PotOfCoals/glTF-Binary/PotOfCoals.glb',
  helmet_scifi: 'SciFiHelmet/glTF/SciFiHelmet.gltf',
  helmet_flight: 'FlightHelmet/glTF/FlightHelmet.gltf',
};

// ambientCG (CC0) 2K sets -> ゲーム内マテリアル名
const TEXTURES = {
  floor_wood: 'Wood092',
  desk_wood: 'Wood094',
  wood_planks: 'Wood095',
  wall_plaster: 'Plaster001',
  wall_plaster_old: 'Plaster002',
  ceiling_plaster: 'Plaster007',
  concrete: 'Concrete048',
  brick: 'Bricks102',
  metal: 'Metal063',
  asphalt: 'Asphalt031',
  rock: 'Rock058',
  ground: 'Ground054',
};

const TEX_SIZE = 1024;

async function ensure(dir) { await fs.mkdir(dir, { recursive: true }); }

async function fileExists(p) { try { await fs.access(p); return true; } catch { return false; } }

/* ------------------------------------------------------------------ *
 * 1. PBR テクスチャ: 2K JPG -> 1K WebP + ORM パック
 * ------------------------------------------------------------------ */
async function findMap(dir, kind) {
  const files = await fs.readdir(dir).catch(() => []);
  const hit = files.find((f) => f.includes(`_${kind}.jpg`) || f.includes(`_${kind}.png`));
  return hit ? path.join(dir, hit) : null;
}

async function rawGray(p) {
  if (!p) return null;
  const { data } = await sharp(p).resize(TEX_SIZE, TEX_SIZE, { fit: 'fill' })
    .greyscale().raw().toBuffer({ resolveWithObject: true });
  return data;
}

async function packORM(aoPath, roughPath, metalPath) {
  const [ao, rough, metal] = await Promise.all([
    rawGray(aoPath), rawGray(roughPath), rawGray(metalPath),
  ]);
  const n = TEX_SIZE * TEX_SIZE;
  const out = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) {
    out[i * 4 + 0] = ao ? ao[i] : 255;
    out[i * 4 + 1] = rough ? rough[i] : 200;
    out[i * 4 + 2] = metal ? metal[i] : 0;
    out[i * 4 + 3] = 255;
  }
  return sharp(out, { raw: { width: TEX_SIZE, height: TEX_SIZE, channels: 4 } })
    .webp({ quality: 86, effort: 5 }).toBuffer();
}

async function buildTextures(manifest) {
  for (const [key, src] of Object.entries(TEXTURES)) {
    const dir = path.join(SRC, 'fps', 'textures', src);
    if (!(await fileExists(dir))) { console.warn(`[tex] skip ${key} (${src} not fetched)`); continue; }
    const outDir = path.join(OUT, 'tex', key);
    await ensure(outDir);

    const colorPath = await findMap(dir, 'Color');
    const normalPath = await findMap(dir, 'NormalGL');
    const aoPath = await findMap(dir, 'AmbientOcclusion');
    const roughPath = await findMap(dir, 'Roughness');
    const metalPath = await findMap(dir, 'Metalness');

    if (colorPath) {
      await sharp(colorPath).resize(TEX_SIZE, TEX_SIZE, { fit: 'fill' })
        .webp({ quality: 88, effort: 5 }).toFile(path.join(outDir, 'albedo.webp'));
    }
    if (normalPath) {
      await sharp(normalPath).resize(TEX_SIZE, TEX_SIZE, { fit: 'fill' })
        .webp({ quality: 92, effort: 5 }).toFile(path.join(outDir, 'normal.webp'));
    }
    await fs.writeFile(path.join(outDir, 'orm.webp'), await packORM(aoPath, roughPath, metalPath));

    const sizes = [];
    for (const f of await fs.readdir(outDir)) sizes.push((await fs.stat(path.join(outDir, f))).size);
    manifest.textures[key] = {
      source: `ambientCG/${src}`, license: 'CC0-1.0',
      url: `https://ambientcg.com/view?id=${src}`,
      bytes: sizes.reduce((a, b) => a + b, 0),
      files: ['albedo.webp', 'normal.webp', 'orm.webp'],
    };
    console.log(`[tex] ${key} <- ${src}  ${(sizes.reduce((a, b) => a + b, 0) / 1024).toFixed(0)} KB`);
  }
}

/* ------------------------------------------------------------------ *
 * 2. 3D モデル: WebP テクスチャ + 量子化 + 未使用データの除去
 * ------------------------------------------------------------------ */
async function buildModels(manifest) {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  for (const [key, rel] of Object.entries(MODELS)) {
    const src = path.join(SRC, 'khronos', 'Models', rel);
    if (!(await fileExists(src))) { console.warn(`[glb] skip ${key} (${rel} not fetched)`); continue; }
    const doc = await io.read(src);
    const scene = doc.getRoot().listScenes()[0];
    const b0 = getBounds(scene);

    const transforms = [dedup(), prune(), weld()];
    try {
      await doc.transform(...transforms, resample(), quantize());
    } catch (e) {
      console.warn(`[glb] ${key}: quantize fallback (${e.message})`);
      await doc.transform(...transforms);
    }
    await doc.transform(textureCompress({
      encoder: sharp, targetFormat: 'webp', resize: [TEX_SIZE, TEX_SIZE], quality: 82,
    }));

    const outFile = path.join(OUT, 'models', `${key}.glb`);
    await ensure(path.dirname(outFile));
    await io.write(outFile, doc);
    const stat = await fs.stat(outFile);

    let tris = 0;
    for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) tris += getGLPrimitiveCount(prim);

    const b1 = getBounds(scene);
    manifest.models[key] = {
      source: rel.split('/')[0],
      bytes: stat.size,
      triangles: tris,
      bounds: {
        min: b0.min.map((v) => +v.toFixed(3)),
        max: b0.max.map((v) => +v.toFixed(3)),
        size: [b0.max[0] - b0.min[0], b0.max[1] - b0.min[1], b0.max[2] - b0.min[2]].map((v) => +v.toFixed(3)),
      },
      // 量子化後の再測定 (スケール合わせに使用)
      boundsQ: {
        min: b1.min.map((v) => +v.toFixed(3)),
        max: b1.max.map((v) => +v.toFixed(3)),
      },
    };
    console.log(`[glb] ${key}  ${(stat.size / 1024 / 1024).toFixed(2)} MB  tris=${tris}  h=${(b0.max[1] - b0.min[1]).toFixed(2)}m`);
  }
}

/* ------------------------------------------------------------------ *
 * 3. 効果音 (CC0): ogg をそのまま配置
 * ------------------------------------------------------------------ */
async function buildAudio(manifest) {
  const src = path.join(SRC, 'fps', 'sfx', 'footsteps');
  const outDir = path.join(OUT, 'audio');
  await ensure(outDir);
  const names = [];
  for (const f of await fs.readdir(src).catch(() => [])) {
    if (!f.endsWith('.ogg')) continue;
    await fs.copyFile(path.join(src, f), path.join(outDir, f));
    names.push(f);
  }
  manifest.audio = {
    footsteps: {
      source: "Fantozzi's Footsteps (OpenGameArt, CC0)",
      url: 'https://opengameart.org/content/fantozzis-footsteps-grasssand-stone',
      license: 'CC0-1.0',
      files: names,
    },
  };
  console.log(`[audio] ${names.length} footstep wav/ogg copied`);
}

/* ------------------------------------------------------------------ */
const manifestFile = path.join(OUT, 'manifest.json');
const manifest = { generated: new Date().toISOString(), models: {}, textures: {}, audio: {} };
await ensure(OUT);
await buildModels(manifest);
await buildTextures(manifest);
await buildAudio(manifest);
await fs.writeFile(manifestFile, JSON.stringify(manifest, null, 2));
console.log('\nwrote', manifestFile);
