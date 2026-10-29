import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  dedup,
  flatten,
  join,
  palette,
  prune,
  resample,
  simplify,
  textureCompress,
  weld,
} from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

/**
 * Remove normal, metallicRoughness, and occlusion textures so Lambertian/stylized shading
 * uses 1/3 the VRAM and merges cleanly into far fewer draw calls.
 */
function stripHeavyPbrMaps(doc, keepNames = new Set()) {
  for (const mat of doc.getRoot().listMaterials()) {
    if (keepNames.has(mat.getName())) continue;
    mat.setNormalTexture(null);
    mat.setMetallicRoughnessTexture(null);
    mat.setOcclusionTexture(null);
  }
}

// 1. Optimize Bedroom: strip extra MacBook PC, iphone clutter, and 5 duplicate 34k-tri decor meshes!
{
  console.log('Optimizing bedroom.glb...');
  const doc = await io.read('/tmp/bsod_raw/modern_stylized_bedroom.glb');

  for (const node of doc.getRoot().listNodes()) {
    const name = node.getName() || '';
    // Remove extra MacBook laptop PC completely ("余分なpcある") + nightstand phone + 80k-tri AirCleaner + 6x34k-tri tiny trinkets!
    if (
      name.startsWith('MacBook') ||
      name.startsWith('iphone') ||
      name.startsWith('AirCleaner') ||
      name.startsWith('decor_Cor_M07')
    ) {
      node.dispose();
    }
  }

  // Ensure 'Walls' material keeps a unique dummy emissive factor so join/palette preserves its name for our custom enclosure walls
  for (const mat of doc.getRoot().listMaterials()) {
    if (mat.getName() === 'Walls') {
      mat.setEmissiveFactor([0.001, 0.001, 0.002]);
    }
  }

  stripHeavyPbrMaps(doc);

  await doc.transform(
    dedup(),
    flatten(),
    weld(),
    simplify({ simplifier: MeshoptSimplifier, ratio: 0.16, error: 0.45 }),
    palette({ min: 2 }),
    join({ keepNamed: false }),
    prune(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [512, 512], quality: 75 })
  );

  await io.write('public/models/bedroom.glb', doc);
}

// 2. Optimize Gaming Desktop PC: preserve BSOD_SCREEN_NODE exact transform & UVs, merge & decimate rest!
{
  console.log('Optimizing gaming_pc.glb...');
  const doc = await io.read('gaming_desktop_pc.glb');

  // Create tiny 4x4 dummy texture so BSOD_SCREEN_MAT cannot be merged with any other material
  const dummyPng = await sharp({
    create: { width: 4, height: 4, channels: 4, background: { r: 0, g: 120, b: 215, alpha: 1 } },
  })
    .png()
    .toBuffer();
  const dummyTex = doc.createTexture('bsod_dummy').setImage(dummyPng).setMimeType('image/png');

  for (const node of doc.getRoot().listNodes()) {
    const name = node.getName() || '';
    if (name.includes('MY SCREEN')) {
      node.setName('BSOD_SCREEN_NODE');
      const mesh = node.getMesh();
      if (mesh) {
        for (const prim of mesh.listPrimitives()) {
          const screenMat = doc
            .createMaterial('BSOD_SCREEN_MAT')
            .setBaseColorTexture(dummyTex)
            .setRoughnessFactor(0.4);
          prim.setMaterial(screenMat);
        }
      }
    }
  }

  stripHeavyPbrMaps(doc, new Set(['BSOD_SCREEN_MAT']));

  await doc.transform(
    dedup(),
    flatten(),
    weld(),
    // BSOD_SCREEN_NODE only has 2 triangles so ratio: 0.32 keeps all 4 verts 100% untouched!
    simplify({ simplifier: MeshoptSimplifier, ratio: 0.32, error: 0.35 }),
    palette({ min: 2 }),
    join({ keepNamed: false }),
    prune(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [256, 256], quality: 74 })
  );

  // Re-verify BSOD_SCREEN_NODE name on whichever node holds BSOD_SCREEN_MAT
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMaterial()?.getName() === 'BSOD_SCREEN_MAT') {
        node.setName('BSOD_SCREEN_NODE');
      }
    }
  }

  await io.write('public/models/gaming_pc.glb', doc);
}

// 3. Optimize remaining 6 props aggressively for ultra-fast GPU rendering
const otherAssets = [
  { src: 'cray-1_supercomputer.glb', dst: 'public/models/cray1.glb', ratio: 0.38, err: 0.35, tex: 512, keepGlass: false },
  { src: 'data_center_server_rack.glb', dst: 'public/models/server_rack.glb', ratio: 0.25, err: 0.40, tex: 256, keepGlass: false },
  { src: 'crt_computer_monitor.glb', dst: 'public/models/crt_monitor.glb', ratio: 0.45, err: 0.35, tex: 256, keepGlass: true },
  { src: 'office_chair.glb', dst: 'public/models/office_chair.glb', ratio: 0.32, err: 0.40, tex: 256, keepGlass: false },
  { src: 'motherboard.glb', dst: 'public/models/motherboard.glb', ratio: 0.35, err: 0.40, tex: 256, keepGlass: false },
  { src: 'modular_cables_1m.glb', dst: 'public/models/cables.glb', ratio: 0.32, err: 0.40, tex: 256, keepGlass: false },
];

for (const item of otherAssets) {
  console.log(`Optimizing ${item.dst}...`);
  const doc = await io.read(item.src);
  if (item.keepGlass) {
    for (const m of doc.getRoot().listMaterials()) {
      if (m.getName().includes('glass')) {
        m.setEmissiveFactor([0.01, 0.02, 0.05]);
      }
    }
  }
  stripHeavyPbrMaps(doc);
  await doc.transform(
    dedup(),
    resample(),
    flatten(),
    weld(),
    simplify({ simplifier: MeshoptSimplifier, ratio: item.ratio, error: item.err }),
    palette({ min: 2 }),
    join({ keepNamed: false }),
    prune(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [item.tex, item.tex], quality: 76 })
  );
  await io.write(item.dst, doc);
}

console.log('ALL LEAN ASSETS BUILT SUCCESSFULLY!');
