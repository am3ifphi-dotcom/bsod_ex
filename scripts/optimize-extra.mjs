import fs from 'node:fs';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  dedup,
  flatten,
  join,
  palette,
  prune,
  simplify,
  textureCompress,
  weld,
} from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

const bedroomSrc = fs.existsSync('/tmp/bsod_raw/modern_stylized_bedroom.glb')
  ? '/tmp/bsod_raw/modern_stylized_bedroom.glb'
  : 'google_drive/modern_stylized_bedroom.glb';

function stripTangents(doc) {
  for (const m of doc.getRoot().listMeshes()) {
    for (const p of m.listPrimitives()) {
      const tan = p.getAttribute('TANGENT');
      if (tan) p.setAttribute('TANGENT', null);
    }
  }
}

// 1. Optimize bedroom.glb aggressively while keeping clean visuals & named Wall material
{
  const doc = await io.read(bedroomSrc);
  stripTangents(doc);
  await doc.transform(
    dedup(),
    weld(),
    simplify({
      simplifier: MeshoptSimplifier,
      ratio: 0.2,
      error: 0.12,
      lockBorder: false,
    }),
    textureCompress({
      encoder: sharp,
      targetFormat: 'webp',
      resize: [512, 512],
      quality: 78,
    }),
    prune(),
    dedup()
  );
  await io.write('public/models/bedroom.glb', doc);
}

// 2. Optimize gaming_pc.glb: collapse 685 meshes down to ~15 while keeping BSOD_SCREEN_MAT isolated!
{
  const doc = await io.read('gaming_desktop_pc.glb');
  stripTangents(doc);
  for (const node of doc.getRoot().listNodes()) {
    const nm = node.getName() || '';
    if (nm.includes('MY SCREEN')) {
      const mesh = node.getMesh();
      if (mesh) {
        mesh.setName('BSOD_SCREEN_MESH');
        for (const prim of mesh.listPrimitives()) {
          const screenMat = doc.createMaterial('BSOD_SCREEN_MAT');
          screenMat.setBaseColorFactor([0.0, 0.47, 0.84, 1.0]);
          screenMat.setEmissiveFactor([0.01, 0.47, 0.84]);
          screenMat.setAlphaMode('MASK'); // distinct alphaMode so join/palette never merges screen with bezel!
          prim.setMaterial(screenMat);
        }
      }
    }
  }
  await doc.transform(
    dedup(),
    weld(),
    palette({ min: 2, keepAttributes: false }),
    flatten(),
    join({ keepNamed: false }),
    simplify({
      simplifier: MeshoptSimplifier,
      ratio: 0.35,
      error: 0.08,
      lockBorder: false,
    }),
    textureCompress({
      encoder: sharp,
      targetFormat: 'webp',
      resize: [512, 512],
      quality: 80,
    }),
    prune(),
    dedup()
  );
  await io.write('public/models/gaming_pc.glb', doc);
}

for (const f of fs.readdirSync('public/models')) {
  const p = `public/models/${f}`;
  const doc = await io.read(p);
  let tris = 0;
  for (const m of doc.getRoot().listMeshes()) {
    for (const pr of m.listPrimitives()) {
      const idx = pr.getIndices();
      const pos = pr.getAttribute('POSITION');
      tris += idx ? idx.getCount() / 3 : pos ? pos.getCount() / 3 : 0;
    }
  }
  const mats = doc.getRoot().listMaterials().map((m) => m.getName());
  console.log(
    `${f.padEnd(18)} | ${(fs.statSync(p).size / 1024 / 1024).toFixed(2)} MB | Meshes: ${String(
      doc.getRoot().listMeshes().length
    ).padStart(2)} | Mats: ${String(mats.length).padStart(2)} | Tris: ${Math.round(tris)}`
  );
}
