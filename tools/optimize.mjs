// Asset optimization pipeline: dedup/weld/simplify + WebP textures + meshopt geometry compression
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, simplify, textureCompress, flatten, join, resample, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import path from 'node:path';
import fs from 'node:fs';

await Promise.all([MeshoptEncoder.ready, MeshoptSimplifier.ready]);

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'sharp': sharp });

const cfg = {
  'modern_stylized_bedroom': { out: 'bedroom', tex: 1024, ratio: 0.45, error: 0.0025, flatten: false },
  'crt_computer_monitor':  { out: 'crt',     tex: 512,  ratio: 1.0,  flatten: false },
  'gaming_desktop_pc':     { out: 'pc',      tex: 512,  ratio: 0.3,  error: 0.01, flatten: true, joinAll: true },
  'office_chair':          { out: 'chair',   tex: 512,  ratio: 0.7,  error: 0.004, flatten: false },
  'data_center_server_rack': { out: 'rack',  tex: 768,  ratio: 0.7,  error: 0.004, flatten: false },
  'cray-1_supercomputer':  { out: 'cray',    tex: 768,  ratio: 0.7,  error: 0.004, flatten: false },
  'modular_cables_1m':     { out: 'cables',  tex: 512,  ratio: 0.7,  error: 0.004, flatten: false },
  'motherboard':           { out: 'mobo',    tex: 512,  ratio: 0.7,  error: 0.004, flatten: false },
};

const srcDir = 'assets/models';
const outDir = 'public/models';
fs.mkdirSync(outDir, { recursive: true });

for (const [name, c] of Object.entries(cfg)) {
  const src = path.join(srcDir, name + '.glb');
  const dst = path.join(outDir, c.out + '.glb');
  console.log('---', name, '->', c.out);
  const t0 = Date.now();
  const doc = await io.read(src);
  const before = fs.statSync(src).size;

  const fns = [dedup(), prune(), weld({ cleanup: true })];
  if (c.flatten) fns.push(flatten());
  if (c.ratio < 1) fns.push(simplify({ simplifier: MeshoptSimplifier, ratio: c.ratio, error: c.error ?? 0.005 }));
  if (c.joinAll) fns.push(join());
  fns.push(textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 78, resize: [c.tex, c.tex] }));
  fns.push(resample());
  fns.push(meshopt({ encoder: MeshoptEncoder, level: 'high' }));

  await doc.transform(...fns);
  await io.write(dst, doc);

  const after = fs.statSync(dst).size;
  console.log(`    ${(before/1e6).toFixed(1)}MB -> ${(after/1e6).toFixed(1)}MB in ${((Date.now()-t0)/1000).toFixed(1)}s`);
}
console.log('done');
