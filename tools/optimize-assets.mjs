/**
 * BSOD:EX — asset optimiser
 * ---------------------------------------------------------------------------
 * - PBR textures: 1024px colour / 1024px normals / 512px masks, WebP
 * - glTF props: texture resize + WebP, weld, dedup, prune, reorder
 * - HDRIs / font copied as-is (already small CC0 derivatives)
 * - writes public/assets/manifest.json (used by the in-game credits screen)
 *
 *   npm run assets:optimize
 */
import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, textureCompress, resample } from '@gltf-transform/functions';

const ROOT = path.resolve(import.meta.dirname, '..');
const RAW = path.join(ROOT, '.asset-cache', 'raw');
const OUT = path.join(ROOT, 'public', 'assets');

const TEXTURE_TARGET = {
  color: { width: 1024, quality: 84, srgb: true },
  normal: { width: 1024, quality: 88, srgb: false },
  rough: { width: 512, quality: 80, srgb: false },
  metal: { width: 512, quality: 80, srgb: false },
  ao: { width: 512, quality: 80, srgb: false },
};

async function optimizeTextures(log) {
  const dir = path.join(OUT, 'textures');
  await fs.mkdir(dir, { recursive: true });
  const count = {};
  const files = await fs.readdir(path.join(RAW, 'textures'));
  for (const file of files) {
    const base = file.replace(/\.(jpg|jpeg|png)$/i, '');
    const type = base.split('_').pop();
    const target = TEXTURE_TARGET[type];
    if (!target) {
      log(`  ? unknown texture map type: ${file}`);
      continue;
    }
    const outFile = path.join(dir, `${base}.webp`);
    await sharp(path.join(RAW, 'textures', file))
      .resize({ width: target.width, height: target.width, fit: 'cover' })
      .webp({ quality: target.quality, effort: 5 })
      .toFile(outFile);
    count[type] = (count[type] || 0) + 1;
  }
  return count;
}

async function optimizeModels(log) {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const outDir = path.join(OUT, 'models');
  await fs.mkdir(outDir, { recursive: true });
  const files = (await fs.readdir(path.join(RAW, 'models'))).filter((f) => f.endsWith('.glb'));
  const report = [];
  for (const file of files) {
    const id = file.replace(/\.glb$/, '');
    const doc = await io.read(path.join(RAW, 'models', file));
    await doc.transform(
      resample(),
      dedup(),
      weld(),
      prune(),
      textureCompress({
        encoder: sharp,
        targetFormat: 'webp',
        resize: [1024, 1024],
        quality: 84,
      }),
      prune(),
    );
    const outFile = path.join(outDir, file);
    await io.write(outFile, doc);
    const a = (await fs.stat(path.join(RAW, 'models', file))).size;
    const b = (await fs.stat(outFile)).size;
    report.push({ id, before: a, after: b });
    log(`  ${id.padEnd(14)} ${(a / 1e6).toFixed(2)} MB -> ${(b / 1e6).toFixed(2)} MB`);
  }
  return report;
}

async function copyExtras(log) {
  const hdriOut = path.join(OUT, 'hdri');
  await fs.mkdir(hdriOut, { recursive: true });
  for (const f of await fs.readdir(path.join(RAW, 'hdri'))) {
    await fs.copyFile(path.join(RAW, 'hdri', f), path.join(hdriOut, f));
  }
  const fontOut = path.join(OUT, 'fonts');
  await fs.mkdir(fontOut, { recursive: true });
  for (const f of await fs.readdir(path.join(RAW, 'fonts'))) {
    await fs.copyFile(path.join(RAW, 'fonts', f), path.join(fontOut, f));
  }
  const licOut = path.join(OUT, 'licenses');
  await fs.mkdir(licOut, { recursive: true });
  for (const f of await fs.readdir(path.join(RAW, 'licenses'))) {
    await fs.copyFile(path.join(RAW, 'licenses', f), path.join(licOut, f));
  }
}

async function main() {
  const log = (s) => console.log(s);
  if (!fss.existsSync(RAW)) {
    console.error('missing .asset-cache/raw — run `npm run assets:fetch` first');
    process.exit(1);
  }
  await fs.mkdir(OUT, { recursive: true });

  log('textures:');
  const tex = await optimizeTextures(log);
  log(`  ${JSON.stringify(tex)}`);

  log('models:');
  const models = await optimizeModels(log);

  log('hdri / font / licences:');
  await copyExtras(log);

  const rawManifest = JSON.parse(await fs.readFile(path.join(RAW, 'raw-manifest.json'), 'utf8'));
  const manifest = {
    ...rawManifest,
    optimized: new Date().toISOString(),
    models: rawManifest.models.map((m) => {
      const key = m.id.replace(/\.glb$/, '');
      const r = models.find((x) => x.id === key);
      return { ...m, bytes: r?.after };
    }),
    audio: [{ id: 'all-sound', credit: 'Original procedural synthesis (Web Audio API), made for this project' }],
    engine: [
      { id: 'three', credit: 'three.js r186 — MIT License' },
      { id: 'vite', credit: 'Vite — MIT License' },
    ],
  };
  await fs.writeFile(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  log('\npublic/assets/manifest.json written.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
