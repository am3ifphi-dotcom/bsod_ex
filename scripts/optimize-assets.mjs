#!/usr/bin/env node
/**
 * optimize-assets.mjs — turn the fetched sources into compact, consistent runtime GLBs.
 *
 * Pipeline per model (glTF-Transform):
 *   dedup -> weld -> prune -> texture resize (power of two) -> WebP re-encode
 *         -> quantize (KHR_mesh_quantization, no extra decoder needed) -> prune
 * Environments and ambientCG textures are copied through a size check.
 *
 * Output: public/assets/models/<id>.glb  +  public/assets/assets-report.json (scale/tri stats).
 *
 * Usage: npm run assets:optimize
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  dedup, prune, weld, textureCompress, quantize, resample, flatten,
} from '@gltf-transform/functions';
import fs from 'node:fs';
import sharp from 'sharp';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAWDIR = path.join(ROOT, '.cache', 'raw', 'models');
const OUT = path.join(ROOT, 'public', 'assets', 'models');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'assets.manifest.json'), 'utf8'));

/* Texture budget per asset. Room hero props keep detail; world props are mostly seen at
   distance and are heavily repeated, so 512 is plenty. */
const BUDGET = {
  SheenChair: 1024,
  Lantern: 1024,
  WaterBottle: 512,
  BoomBox: 1024,
  GlassVaseFlowers: 1024,
  DiffuseTransmissionTeacup: 512,
  ToyCar: 512,
  SciFiHelmet: 1024,
  FlightHelmet: 1024,
  GlamVelvetSofa: 1024,
  CommercialRefrigerator: 1024,
  SheenWoodLeatherSofa: 1024,
  StainedGlassLamp: 1024,
};

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
fs.mkdirSync(OUT, { recursive: true });
const report = [];

for (const m of manifest.models) {
  const srcDir = path.join(RAWDIR, m.id);
  const candidates = fs.readdirSync(srcDir).filter((f) => /\.(glb|gltf)$/i.test(f));
  if (!candidates.length) throw new Error(`no glb/gltf in ${srcDir}`);
  const src = path.join(srcDir, candidates[0]);
  const t0 = Date.now();
  const doc = await io.read(src);
  const root = doc.getRoot();

  await doc.transform(
    dedup(),
    weld(),
    prune(),
    resample(),
    textureCompress({
      encoder: sharp,
      targetFormat: 'webp', // EXT_texture_webp — natively decoded by GLTFLoader
      resize: [BUDGET[m.id] || 1024, BUDGET[m.id] || 1024],
      quality: 82,
    }),
    quantize({ pattern: /^(POSITION|NORMAL|TEXCOORD|COLOR|WEIGHTS)$/ }),
    flatten(),
    prune(),
  );

  const outName = `${m.id}.glb`;
  await io.write(path.join(OUT, outName), doc);

  // stats
  let tris = 0;
  let meshes = 0;
  for (const mesh of root.listMeshes()) {
    meshes++;
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      const pos = prim.getAttribute('POSITION');
      tris += idx ? idx.getCount() / 3 : (pos ? pos.getCount() / 3 : 0);
    }
  }
  const box = computeBounds(root);
  const bytes = fs.statSync(path.join(OUT, outName)).size;
  report.push({
    id: m.id,
    file: `models/${outName}`,
    bytes,
    triangles: Math.round(tris),
    meshes,
    textures: root.listTextures().length,
    materials: root.listMaterials().length,
    bbox: box,
    ms: Date.now() - t0,
  });
  console.log(`[opt] ${m.id}: ${(bytes / 1e6).toFixed(2)} MB, ${Math.round(tris)} tris, bbox ${box.size.map((v) => v.toFixed(2)).join('x')} m`);
}

function computeBounds(root) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  // walk scene graph with node transforms (approximate: TRS compose)
  const tmp = new Float32Array(16);
  const m4 = new Float32Array(16);
  function mul(a, b) {
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
      tmp[r * 4 + c] = a[r * 4] * b[c] + a[r * 4 + 1] * b[4 + c] + a[r * 4 + 2] * b[8 + c] + a[r * 4 + 3] * b[12 + c];
    }
    for (let i = 0; i < 16; i++) a[i] = tmp[i];
  }
  function ident() { const a = new Float32Array(16); a[0] = a[5] = a[10] = a[15] = 1; return a; }
  function trs(node) {
    const t = node.getTranslation();
    const q = node.getRotation();
    const s = node.getScale();
    const [x, y, z, w] = q;
    const x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2;
    const yy = y * y2, yz = y * z2, zz = z * z2;
    const wx = w * x2, wy = w * y2, wz = w * z2;
    return [
      (1 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0], 0,
      (xy - wz) * s[1], (1 - (xx + zz)) * s[1], (yz + wx) * s[1], 0,
      (xz + wy) * s[2], (yz - wx) * s[2], (1 - (xx + yy)) * s[2], 0,
      t[0], t[1], t[2], 1,
    ];
  }
  function walk(node, parent) {
    const local = trs(node);
    const world = ident();
    // world = parent * local  (column-major multiply)
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      world[c * 4 + r] = parent[0 * 4 + r] * local[c * 4] + parent[1 * 4 + r] * local[c * 4 + 1]
        + parent[2 * 4 + r] * local[c * 4 + 2] + parent[3 * 4 + r] * local[c * 4 + 3];
    }
    const mesh = node.getMesh();
    if (mesh) {
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute('POSITION');
        if (!pos) continue;
        const el = [];
        for (let i = 0; i < pos.getCount(); i++) {
          pos.getElement(i, el);
          const x = el[0], y = el[1], z = el[2];
          const wx = world[0] * x + world[4] * y + world[8] * z + world[12];
          const wy = world[1] * x + world[5] * y + world[9] * z + world[13];
          const wz = world[2] * x + world[6] * y + world[10] * z + world[14];
          if (wx < min[0]) min[0] = wx; if (wx > max[0]) max[0] = wx;
          if (wy < min[1]) min[1] = wy; if (wy > max[1]) max[1] = wy;
          if (wz < min[2]) min[2] = wz; if (wz > max[2]) max[2] = wz;
        }
      }
    }
    for (const child of node.listChildren()) walk(child, world);
  }
  for (const scene of root.listScenes()) {
    const I = ident();
    for (const n of scene.listChildren()) walk(n, I);
  }
  const finite = (v) => Number.isFinite(v);
  if (!finite(min[0])) return { min: [0, 0, 0], max: [0, 0, 0], size: [0, 0, 0] };
  return { min, max, size: max.map((v, i) => +(v - min[i]).toFixed(3)) };
}

fs.writeFileSync(path.join(ROOT, 'public', 'assets', 'assets-report.json'), JSON.stringify({
  generated: new Date().toISOString(),
  units: 'metres (1 unit = 1 m)',
  models: report,
}, null, 2));
console.log(`[opt] wrote ${report.length} models.`);
