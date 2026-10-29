import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  dedup,
  flatten,
  join,
  palette,
  prune,
  quantize,
  simplify,
  textureCompress,
  weld,
} from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

await MeshoptSimplifier.ready;

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
fs.mkdirSync('public/models', { recursive: true });
fs.mkdirSync('public/textures', { recursive: true });

const bedroomSrc = fs.existsSync('/tmp/bsod_raw/modern_stylized_bedroom.glb')
  ? '/tmp/bsod_raw/modern_stylized_bedroom.glb'
  : 'google_drive/modern_stylized_bedroom.glb';

async function optimizeGlb({
  input,
  output,
  maxTexSize = 512,
  simplifyRatio = 0.35,
  simplifyError = 0.01,
  doJoin = true,
  doPalette = false,
  doQuantize = false,
  protectScreen = false,
}) {
  console.log(`\nProcessing ${input} -> ${output}...`);
  const doc = await io.read(input);

  if (protectScreen) {
    for (const node of doc.getRoot().listNodes()) {
      const nm = node.getName() || '';
      if (nm.includes('MY SCREEN')) {
        node.setName('BSOD_SCREEN_NODE');
        const mesh = node.getMesh();
        if (mesh) {
          mesh.setName('BSOD_SCREEN_MESH');
          for (const prim of mesh.listPrimitives()) {
            const screenMat = doc.createMaterial('BSOD_SCREEN_MAT');
            screenMat.setBaseColorFactor([0.0, 0.47, 0.84, 1.0]);
            // Give it a 1x1 dummy texture or distinct alphaMode so palette() never merges it
            screenMat.setEmissiveFactor([0.0, 0.47, 0.84]);
            prim.setMaterial(screenMat);
          }
        }
      }
    }
  }

  const transforms = [
    dedup(),
    weld(),
    ...(doPalette ? [palette({ min: 3, keepAttributes: true })] : []),
    ...(doJoin ? [flatten(), join({ keepNamed: protectScreen })] : []),
    simplify({
      simplifier: MeshoptSimplifier,
      ratio: simplifyRatio,
      error: simplifyError,
      lockBorder: false,
    }),
    textureCompress({
      encoder: sharp,
      targetFormat: 'webp',
      resize: [maxTexSize, maxTexSize],
      quality: 80,
    }),
    ...(doQuantize ? [quantize()] : []),
    prune(),
    dedup(),
  ];

  await doc.transform(...transforms);

  await io.write(output, doc);
  const inMB = (fs.statSync(input).size / 1024 / 1024).toFixed(2);
  const outMB = (fs.statSync(output).size / 1024 / 1024).toFixed(2);
  const meshes = doc.getRoot().listMeshes().length;
  const mats = doc.getRoot().listMaterials().length;
  let tris = 0;
  for (const m of doc.getRoot().listMeshes()) {
    for (const p of m.listPrimitives()) {
      const idx = p.getIndices();
      const pos = p.getAttribute('POSITION');
      tris += idx ? idx.getCount() / 3 : pos ? pos.getCount() / 3 : 0;
    }
  }
  console.log(`  Done: ${inMB}MB -> ${outMB}MB | Meshes: ${meshes} | Mats: ${mats} | Tris: ${Math.round(tris)}`);
}

await optimizeGlb({
  input: bedroomSrc,
  output: 'public/models/bedroom.glb',
  maxTexSize: 512,
  simplifyRatio: 0.22,
  simplifyError: 0.015,
  doJoin: false,
  doPalette: false,
});

await optimizeGlb({
  input: 'gaming_desktop_pc.glb',
  output: 'public/models/gaming_pc.glb',
  maxTexSize: 512,
  simplifyRatio: 0.38,
  simplifyError: 0.01,
  doJoin: true,
  doPalette: false,
  protectScreen: true,
});

await optimizeGlb({
  input: 'office_chair.glb',
  output: 'public/models/office_chair.glb',
  maxTexSize: 512,
  simplifyRatio: 0.4,
  simplifyError: 0.01,
  doJoin: true,
});

await optimizeGlb({
  input: 'crt_computer_monitor.glb',
  output: 'public/models/crt_monitor.glb',
  maxTexSize: 512,
  simplifyRatio: 0.65,
  simplifyError: 0.005,
  doJoin: true,
});

await optimizeGlb({
  input: 'cray-1_supercomputer.glb',
  output: 'public/models/cray1.glb',
  maxTexSize: 512,
  simplifyRatio: 0.65,
  simplifyError: 0.005,
  doJoin: true,
});

await optimizeGlb({
  input: 'data_center_server_rack.glb',
  output: 'public/models/server_rack.glb',
  maxTexSize: 512,
  simplifyRatio: 0.4,
  simplifyError: 0.01,
  doJoin: true,
});

await optimizeGlb({
  input: 'motherboard.glb',
  output: 'public/models/motherboard.glb',
  maxTexSize: 512,
  simplifyRatio: 0.45,
  simplifyError: 0.01,
  doJoin: true,
});

await optimizeGlb({
  input: 'modular_cables_1m.glb',
  output: 'public/models/cables.glb',
  maxTexSize: 512,
  simplifyRatio: 0.45,
  simplifyError: 0.01,
  doJoin: true,
});
