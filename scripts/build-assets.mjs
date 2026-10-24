// ---------------------------------------------------------------------------
// build-assets.mjs
//
// Converts the raw source assets in .asset-cache/ into the runtime assets in
// public/assets/.  Every step is deterministic so the pipeline can be
// re-run from scratch:
//
//   * glTF-Binary/  -> .glb   (dedupe, weld, prune, texture -> WebP@1024,
//                              meshopt (EXT_meshopt_compression) geometry)
//   * *.glb         -> *.lod1.glb  (decimated LOD for distant fragments)
//   * pmndrs *.exr  -> public/assets/hdr/*.exr (base64 decoded, verified)
//   * writes  public/assets/asset-manifest.json  (bounds / size / licence)
//
// Usage: node scripts/build-assets.mjs [--only=Sponza,SheenChair]
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { NodeIO, Logger } from '@gltf-transform/core';
import { KHRMeshQuantization, ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  dedup, weld, prune, textureCompress, meshopt, simplify, resample,
} from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CACHE = path.join(ROOT, '.asset-cache');
const GSA = path.join(CACHE, 'glTF-Sample-Assets');
const PMND = path.join(CACHE, 'pmndrs', 'package');
const OUT_MODELS = path.join(ROOT, 'public', 'assets', 'models');
const OUT_HDR = path.join(ROOT, 'public', 'assets', 'hdr');
const OUT_LIC = path.join(ROOT, 'public', 'assets', 'licences');
const OUT_MANIFEST = path.join(ROOT, 'public', 'assets', 'asset-manifest.json');

const argOnly = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7);
const only = argOnly ? new Set(argOnly.split(',')) : null;

// name -> { credits, lod: bool, tex: max texture size }
const MODEL_SPECS = {
  SheenChair:                { author: 'Khronos Group / Wayfair', lod: true,  tex: 1024 },
  DiffuseTransmissionPlant:  { author: 'Khronos Group / UX3D',     lod: true,  tex: 1024 },
  WaterBottle:               { author: 'Khronos Group',            lod: false, tex: 1024 },
  Lantern:                   { author: 'Khronos Group',            lod: true,  tex: 1024 },
  GlassVaseFlowers:          { author: 'Khronos Group',            lod: true,  tex: 1024 },
  SciFiHelmet:               { author: 'Khronos Group',            lod: true,  tex: 1024 },
  AntiqueCamera:             { author: 'Khronos Group / UX3D',     lod: true,  tex: 1024 },
  PotOfCoals:                { author: 'Khronos Group',            lod: false, tex: 1024 },
  DamagedHelmet:             { author: 'theblueturtle_',           lod: true,  tex: 1024 },
  CarConcept:                { author: 'Khronos Group / DGG',      lod: true,  tex: 1024 },
  GlassBrokenWindow:         { author: 'Khronos Group',            lod: false, tex: 1024 },
  GlamVelvetSofa:            { author: 'Khronos Group / Wayfair',  lod: true,  tex: 1024 },
  ABeautifulGame:            { author: 'Khronos Group / AGI',      lod: true,  tex: 1024 },
  ChronographWatch:          { author: 'Khronos Group',            lod: true,  tex: 1024 },
  GlassHurricaneCandleHolder:{ author: 'Khronos Group',            lod: false, tex: 1024 },
};

// HDRIs pulled from @pmndrs/assets (all CC0)
const HDRS = ['night', 'city', 'apartment', 'warehouse', 'studio', 'dawn'];

async function ensureDirs() {
  for (const d of [OUT_MODELS, OUT_HDR, OUT_LIC]) fs.mkdirSync(d, { recursive: true });
}

function boundsOf(doc) {
  const root = doc.getRoot();
  const bmin = [Infinity, Infinity, Infinity];
  const bmax = [-Infinity, -Infinity, -Infinity];
  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      if (!pos) continue;
      const m = node.getWorldMatrix();
      const v = [0, 0, 0];
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, v);
        const x = m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12];
        const y = m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13];
        const z = m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14];
        bmin[0] = Math.min(bmin[0], x); bmax[0] = Math.max(bmax[0], x);
        bmin[1] = Math.min(bmin[1], y); bmax[1] = Math.max(bmax[1], y);
        bmin[2] = Math.min(bmin[2], z); bmax[2] = Math.max(bmax[2], z);
      }
    }
  }
  if (!Number.isFinite(bmin[0])) return null;
  return { min: bmin, max: bmax, size: bmax.map((v, i) => v - bmin[i]) };
}

function triCount(doc) {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      const pos = prim.getAttribute('POSITION');
      n += Math.floor((idx ? idx.getCount() : (pos ? pos.getCount() : 0)) / 3);
    }
  }
  return n;
}

// glTF Transform logs every transform at INFO; only surface warnings/errors.
const logger = new Logger(Logger.Verbosity.WARN);

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    'meshopt.encoder': MeshoptEncoder,
  });

async function convertModel(name, spec, lodRatio) {
  const srcGlb = path.join(GSA, 'Models', name, 'glTF-Binary', `${name}.glb`);
  const srcGltf = path.join(GSA, 'Models', name, 'glTF', `${name}.gltf`);
  const src = fs.existsSync(srcGlb) ? srcGlb : srcGltf;
  if (!fs.existsSync(src)) throw new Error(`missing source ${srcGlb} / ${srcGltf}`);
  const doc = await io.read(src);
  doc.setLogger(logger);

  // 1. tidy up
  await doc.transform(dedup(), weld(), resample(), prune());

  // 2. textures -> WebP, power-of-two-ish and <= spec.tex
  await doc.transform(textureCompress({
    encoder: sharp,
    targetFormat: 'webp',
    quality: 82,
    resize: [spec.tex, spec.tex],
  }));

  // 3. optional decimation for the distant LOD.  Some assets (e.g. a single
  //    dense mesh) barely decimate; shipping a "LOD" that is the same size
  //    would only waste memory, so skip it and let the runtime fall back.
  if (lodRatio != null) {
    const before = triCount(doc);
    await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: lodRatio, error: 0.02 }));
    await doc.transform(weld(), prune());
    const after = triCount(doc);
    if (after > before * 0.8) {
      console.log(`   ${name}: decimation only reached ${before} -> ${after} tris, skipping LOD`);
      return null;
    }
  }

  // 4. geometry compression (EXT_meshopt_compression + KHR_mesh_quantization)
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'high' }));

  const outName = lodRatio != null ? `${name}.lod1.glb` : `${name}.glb`;
  const out = path.join(OUT_MODELS, outName);
  const bytes = await io.writeBinary(doc);
  fs.writeFileSync(out, Buffer.from(bytes));

  const info = {
    name,
    file: `assets/models/${outName}`,
    bytes: bytes.byteLength,
    tris: triCount(doc),
    bounds: boundsOf(doc),
    licence: readLicence(name),
    author: spec.author,
    lod: lodRatio != null,
  };
  console.log(`   ${outName.padEnd(30)} ${(bytes.byteLength / 1048576).toFixed(2)}MB  ${info.tris} tris`);
  return info;
}

function readLicence(name) {
  const f = path.join(GSA, 'Models', name, 'LICENSE.md');
  if (!fs.existsSync(f)) return 'UNKNOWN';
  const txt = fs.readFileSync(f, 'utf8');
  const ids = [...txt.matchAll(/SPDX license identifier: "([^"]+)"/g)].map((m) => m[1]);
  const uniq = [...new Set(ids)];
  return uniq.join(' / ') || 'UNKNOWN';
}

function writeLicenceCopies() {
  for (const name of Object.keys(MODEL_SPECS)) {
    const f = path.join(GSA, 'Models', name, 'LICENSE.md');
    if (fs.existsSync(f)) fs.copyFileSync(f, path.join(OUT_LIC, `${name}.LICENSE.md`));
  }
  const pl = path.join(PMND, 'LICENSE');
  if (fs.existsSync(pl)) fs.copyFileSync(pl, path.join(OUT_LIC, 'pmndrs-assets.LICENSE.txt'));
}

function convertHdri(name) {
  const js = path.join(PMND, 'hdri', `${name}.exr.js`);
  if (!fs.existsSync(js)) throw new Error(`missing hdri ${js}`);
  const txt = fs.readFileSync(js, 'utf8');
  const i = txt.indexOf('base64,');
  const j = txt.lastIndexOf("'");
  const b64 = txt.slice(i + 7, j);
  const buf = Buffer.from(b64, 'base64');
  // --- validate / parse the OpenEXR header ------------------------------
  if (buf.readUInt32LE(0) !== 0x01312f76) throw new Error(`${name}: not an EXR`);
  const header = {};
  let p = 8; // magic(4) + version(4)
  const cstr = (o) => {
    let e = o;
    while (buf[e] !== 0) e++;
    return { str: buf.subarray(o, e).toString("ascii"), next: e + 1 };
  };
  for (;;) {
    if (buf[p] === 0) break;              // end of header
    const nm = cstr(p);
    const ty = cstr(nm.next);
    const size = buf.readInt32LE(ty.next);
    const dataOff = ty.next + 4;
    header[nm.str] = { type: ty.str, size, off: dataOff };
    p = dataOff + size;
  }
  if (header.channels?.type !== 'chlist' || header.compression?.type !== 'compression'
      || header.dataWindow?.type !== 'box2i') {
    throw new Error(`${name}: unexpected EXR header ${Object.keys(header).join(',')}`);
  }
  const dw = header.dataWindow.off;
  const x0 = buf.readInt32LE(dw), y0 = buf.readInt32LE(dw + 4);
  const x1 = buf.readInt32LE(dw + 8), y1 = buf.readInt32LE(dw + 12);
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  if (w <= 0 || h <= 0 || w > 8192 || h > 8192) throw new Error(`${name}: bad size ${w}x${h}`);
  const comp = buf.readUInt8(header.compression.off); // 0 none,1 RLE,2/3 zips,4/5 piz
  if (comp === 3 || comp === 5) {
    // EXRLoader in three.js supports PIZ; accept it but warn.
    console.warn(`   ! ${name}: PIZ compression (three's EXRLoader handles it)`);
  }
  fs.writeFileSync(path.join(OUT_HDR, `${name}.exr`), buf);
  const rec = { name, file: `assets/hdr/${name}.exr`, bytes: buf.length, width: w, height: h };
  console.log(`   ${name}.exr${' '.repeat(24 - name.length)}${(buf.length / 1024).toFixed(0)}KB  ${w}x${h}`);
  return rec;
}

async function main() {
  await ensureDirs();
  console.log('>> verifying toolchain');
  await MeshoptEncoder.ready;
  await MeshoptSimplifier.ready;

  const manifest = { generated: new Date().toISOString(), models: [], hdr: [] };

  console.log('>> HDRIs (CC0, @pmndrs/assets)');
  for (const h of HDRS) {
    if (only && !only.has(h)) continue;
    manifest.hdr.push(convertHdri(h));
  }

  console.log('>> models (Khronos glTF Sample Assets)');
  for (const [name, spec] of Object.entries(MODEL_SPECS)) {
    if (only && !only.has(name)) continue;
    try {
      const hi = await convertModel(name, spec, null);
      if (hi) manifest.models.push(hi);
      if (spec.lod) {
        const lod = await convertModel(name, spec, 0.12);
        if (lod) manifest.models.push(lod);
      }
    } catch (err) {
      console.error(`!! ${name}: ${err.message}`);
      manifest.models.push({ name, error: String(err.message) });
    }
  }

  writeLicenceCopies();

  const prior = fs.existsSync(OUT_MANIFEST)
    ? JSON.parse(fs.readFileSync(OUT_MANIFEST, 'utf8'))
    : { models: [], hdr: [] };
  if (only) {
    // merge when doing a partial rebuild
    const keepModels = prior.models.filter((m) => !manifest.models.some((n) => n.name === m.name));
    const keepHdr = prior.hdr.filter((m) => !manifest.hdr.some((n) => n.name === m.name));
    manifest.models = [...keepModels, ...manifest.models];
    manifest.hdr = [...keepHdr, ...manifest.hdr];
  }
  fs.writeFileSync(OUT_MANIFEST, JSON.stringify(manifest, null, 2));

  const total = manifest.models.reduce((s, m) => s + (m.bytes || 0), 0)
              + manifest.hdr.reduce((s, m) => s + (m.bytes || 0), 0);
  console.log(`>> wrote ${OUT_MANIFEST}  (${(total / 1048576).toFixed(1)} MB of runtime assets)`);
  const errors = manifest.models.filter((m) => m.error);
  if (errors.length) {
    console.error('!! failed:', errors.map((e) => e.name).join(', '));
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
