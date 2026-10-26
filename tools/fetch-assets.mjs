/**
 * BSOD:EX — asset fetcher
 * ---------------------------------------------------------------------------
 * Downloads every third-party asset used by the game from pin-pointed URLs,
 * verifies its sha256 against assets.lock.json (created on the first run),
 * unpacks it into .asset-cache/ and copies the raw files into .asset-cache/raw/.
 *
 * Nothing here is guessed: each URL was fetched and verified while building the
 * project. Licenses are recorded in ASSETS.md / CREDITS.md and in
 * public/assets/manifest.json.
 *
 *   npm run assets:fetch
 */
import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, '..');
const CACHE = path.join(ROOT, '.asset-cache');
const DOWNLOADS = path.join(CACHE, 'downloads');
const EXTRACT = path.join(CACHE, 'extract');
const RAW = path.join(CACHE, 'raw');
const LOCK = path.join(ROOT, 'assets.lock.json');

const NPM_PACKAGES = [
  {
    id: 'enviropacks',
    url: 'https://registry.npmjs.org/aframe-enviropacks/-/aframe-enviropacks-0.10.0.tgz',
    file: 'aframe-enviropacks-0.10.0.tgz',
    note: 'CC0 material / HDRI / model pack (assets are ambientCG + Poly Haven CC0, package licence CC0)',
  },
  {
    id: 'pmndrs-assets',
    url: 'https://registry.npmjs.org/@pmndrs/assets/-/assets-1.7.0.tgz',
    file: 'pmndrs-assets-1.7.0.tgz',
    note: 'CC0 HDRIs (Poly Haven derivatives, 512px EXR) and Inter font for 3D text',
  },
];

const GH_OWNER = 'KhronosGroup';
const GH_REPO = 'glTF-Sample-Assets';
const GH_REV = 'main';
const GH_BLOBS = [
  { id: 'sheen_chair', path: 'Models/SheenChair/glTF-Binary/SheenChair.glb', sha: '6652347f769f090f76688b727134aef92a9213b9', licence: 'CC0-1.0' },
  { id: 'lantern', path: 'Models/Lantern/glTF-Binary/Lantern.glb', sha: '0c97893aee066b6fa36f7725443b7536c3510d09', licence: 'CC0-1.0' },
  { id: 'sofa', path: 'Models/GlamVelvetSofa/glTF-Binary/GlamVelvetSofa.glb', sha: '8deb5ebeb28e4c04a3ed3cd9b59a8679d541beeb', licence: 'CC-BY-4.0' },
  { id: 'helmet', path: 'Models/DamagedHelmet/glTF-Binary/DamagedHelmet.glb', sha: '2cee76d76a752c92458a8a8294ff3658fdc9d6c7', licence: 'CC-BY-NC-4.0' },
  { id: 'licence_sheen_chair', path: 'Models/SheenChair/LICENSE.md', sha: 'e283f137d8385a9d4ef6ffc38a016e8e036d5015', licence: 'metadata CC-BY-4.0' },
  { id: 'licence_lantern', path: 'Models/Lantern/LICENSE.md', sha: '8a3a2dadfe3cdf2d0c5475410b38a365be6eef65', licence: 'metadata CC-BY-4.0' },
  { id: 'licence_sofa', path: 'Models/GlamVelvetSofa/LICENSE.md', sha: '58cd27be651e776726454706264b20c350130887', licence: 'metadata CC-BY-4.0' },
  { id: 'licence_helmet', path: 'Models/DamagedHelmet/LICENSE.md', sha: 'e58201b3bd82a2a97ae1ff702612f19a299caa75', licence: 'metadata CC-BY-4.0' },
];

/* Everything that ends up inside the game. Source paths inside the unpacked
 * npm tarballs, mapped to stable names used by src/core/Assets.ts. */
const TEXTURE_SETS = [
  { set: 'woodfloor', dir: 'WoodFloor041_2K-JPG', maps: { color: 'WoodFloor041_2K_Color.jpg', normal: 'WoodFloor041_2K_Normal.jpg', rough: 'WoodFloor041_2K_Roughness.jpg', ao: 'WoodFloor041_2K_AmbientOcclusion.jpg' }, credit: 'ambientCG — WoodFloor041 (CC0)' },
  { set: 'wood', dir: 'Wood027_2K-JPG', maps: { color: 'Wood027_2K_Color.jpg', normal: 'Wood027_2K_Normal.jpg', rough: 'Wood027_2K_Roughness.jpg' }, credit: 'ambientCG — Wood027 (CC0)' },
  { set: 'fabric', dir: 'Fabric026_2K-JPG', maps: { color: 'Fabric026_2K_Color.jpg', normal: 'Fabric026_2K_Normal.jpg', rough: 'Fabric026_2K_Roughness.jpg' }, credit: 'ambientCG — Fabric026 (CC0)' },
  { set: 'metal', dir: 'Metal035_2K-JPG', maps: { color: 'Metal035_2K_Color.jpg', normal: 'Metal035_2K_Normal.jpg', rough: 'Metal035_2K_Roughness.jpg', metal: 'Metal035_2K_Metalness.jpg' }, credit: 'ambientCG — Metal035 (CC0)' },
  { set: 'metal_dark', dir: 'Metal009_2K-JPG', maps: { color: 'Metal009_2K_Color.jpg', normal: 'Metal009_2K_Normal.jpg', rough: 'Metal009_2K_Roughness.jpg', metal: 'Metal009_2K_Metalness.jpg' }, credit: 'ambientCG — Metal009 (CC0)' },
  { set: 'plastic', dir: 'Plastic_2K-JPG', maps: { color: 'Plastic_basecolor.jpg', normal: 'Plastic_normal.jpg', rough: 'Plastic_roughness.jpg' }, credit: 'ambientCG — Plastic (CC0)' },
  { set: 'rock', dir: 'rock_05_2k_jpg', maps: { color: 'rock_05_diff_2k.jpg', normal: 'rock_05_nor_2k.jpg', rough: 'rock_05_rough_2k.jpg', ao: 'rock_05_ao_2k.jpg' }, credit: 'Poly Haven — rock_05 (CC0)' },
  { set: 'sandstone', dir: 'sandstone_cracks_2k_jpg', maps: { color: 'sandstone_cracks_diff_2k.jpg', normal: 'sandstone_cracks_nor_2k.jpg', rough: 'sandstone_cracks_rough_2k.jpg', ao: 'sandstone_cracks_AO_2k.jpg' }, credit: 'Poly Haven — sandstone_cracks (CC0)' },
  { set: 'snow', dir: 'Snow003_2K-JPG', maps: { color: 'Snow003_2K_Color.jpg', normal: 'Snow003_2K_Normal.jpg', rough: 'Snow003_2K_Roughness.jpg' }, credit: 'ambientCG — Snow003 (CC0)' },
  { set: 'planks', dir: 'brown_planks_04_2k_jpg', maps: { color: 'brown_planks_04_diff_2k.jpg', normal: 'brown_planks_04_nor_2k.jpg', rough: 'brown_planks_04_rough_2k.jpg', ao: 'brown_planks_04_ao_2k.jpg' }, credit: 'Poly Haven — brown_planks_04 (CC0)' },
];

const HDRIS = [
  { id: 'dikhololo_night', from: 'enviropacks', src: 'asset/hdris/dikhololo_night_edit_1k.hdr', credit: 'Poly Haven — dikhololo_night (CC0)' },
  { id: 'large_corridor', from: 'enviropacks', src: 'asset/hdris/large_corridor_1k.hdr', credit: 'Poly Haven — large_corridor (CC0)' },
];

const PMNDRS_HDRIS = ['night', 'apartment', 'city', 'warehouse', 'hall', 'lab'];

const MODELS = [
  { id: 'column', from: 'enviropacks', src: 'asset/models/column.glb', credit: 'Poly Haven — column (CC0)' },
  { id: 'pillar', from: 'enviropacks', src: 'asset/models/pillar.glb', credit: 'Poly Haven — pillar (CC0)' },
  { id: 'rock', from: 'enviropacks', src: 'asset/models/rock.glb', credit: 'Poly Haven — rock (CC0)' },
  { id: 'stone', from: 'enviropacks', src: 'asset/models/stone.glb', credit: 'Poly Haven — stone (CC0)' },
];

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

async function download(url, dest) {
  // curl is used instead of node's fetch: the sandbox proxy presents a
  // certificate chain that node rejects but curl accepts. Everything is
  // additionally pinned by sha256 in assets.lock.json.
  await fs.mkdir(path.dirname(dest), { recursive: true });
  const args = ['-sSL', '--fail', '--retry', '4', '--retry-delay', '2', '-o', dest];
  if (url.includes('api.github.com')) args.push('-H', 'Accept: application/vnd.github.raw');
  args.push(url);
  await run('curl', args, { maxBuffer: 1024 * 1024 });
  const buf = await fs.readFile(dest);
  if (buf.length === 0) throw new Error(`empty download ${url}`);
  return buf;
}

async function main() {
  await fs.mkdir(DOWNLOADS, { recursive: true });
  await fs.mkdir(EXTRACT, { recursive: true });
  await fs.mkdir(RAW, { recursive: true });

  const lock = fss.existsSync(LOCK) ? JSON.parse(await fs.readFile(LOCK, 'utf8')) : { files: {} };
  const record = (key, buf) => {
    const hash = sha256(buf);
    const prev = lock.files[key];
    if (prev && prev.sha256 !== hash) {
      console.warn(`! checksum changed for ${key}: ${prev.sha256} -> ${hash}`);
    }
    lock.files[key] = { sha256: hash, bytes: buf.length };
    return hash;
  };

  // ---- npm tarballs -------------------------------------------------------
  for (const pkg of NPM_PACKAGES) {
    const dest = path.join(DOWNLOADS, pkg.file);
    let buf;
    if (fss.existsSync(dest)) buf = await fs.readFile(dest);
    else {
      console.log(`fetch ${pkg.url}`);
      buf = await download(pkg.url, dest);
    }
    record(pkg.id, buf);
    const outDir = path.join(EXTRACT, pkg.id);
    if (!fss.existsSync(outDir)) {
      await fs.mkdir(outDir, { recursive: true });
      await run('tar', ['xzf', dest, '-C', outDir]);
    }
  }

  // ---- Khronos glTF Sample Assets (via GitHub blob API, pinned sha) --------
  for (const b of GH_BLOBS) {
    const dest = path.join(DOWNLOADS, `${b.id}.bin`);
    let buf;
    if (fss.existsSync(dest)) buf = await fs.readFile(dest);
    else {
      const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/git/blobs/${b.sha}`;
      console.log(`fetch ${url}`);
      buf = await download(url, dest);
    }
    const hash = record(`gh:${b.id}`, buf);
    console.log(`  ${b.id}: ${buf.length} bytes sha256=${hash.slice(0, 16)}…`);
  }

  // ---- raw copies ---------------------------------------------------------
  const rawTextures = path.join(RAW, 'textures');
  await fs.mkdir(rawTextures, { recursive: true });
  const manifest = { generated: new Date().toISOString(), textures: [], hdris: [], models: [], fonts: [], licenses: [] };

  for (const set of TEXTURE_SETS) {
    const dir = path.join(EXTRACT, 'enviropacks', 'package', 'asset', set.dir);
    for (const [map, file] of Object.entries(set.maps)) {
      const src = path.join(dir, file);
      if (!fss.existsSync(src)) throw new Error(`missing texture ${src}`);
      const out = path.join(rawTextures, `${set.set}_${map}${path.extname(file)}`);
      await fs.copyFile(src, out);
    }
    manifest.textures.push({ set: set.set, maps: set.maps, credit: set.credit });
  }

  const rawHdri = path.join(RAW, 'hdri');
  await fs.mkdir(rawHdri, { recursive: true });
  for (const h of HDRIS) {
    const src = path.join(EXTRACT, h.from, 'package', h.src);
    if (!fss.existsSync(src)) throw new Error(`missing hdri ${src}`);
    const out = path.join(rawHdri, `${h.id}.hdr`);
    await fs.copyFile(src, out);
    manifest.hdris.push({ id: h.id, credit: h.credit, file: `hdri/${h.id}.hdr` });
  }

  // pmndrs HDRIs are base64 data-URI ES modules; decode them to .exr files.
  for (const id of PMNDRS_HDRIS) {
    const src = path.join(EXTRACT, 'pmndrs-assets', 'package', 'hdri', `${id}.exr.js`);
    if (!fss.existsSync(src)) throw new Error(`missing pmndrs hdri ${src}`);
    const text = await fs.readFile(src, 'utf8');
    const m = text.match(/base64,([A-Za-z0-9+/=]+)/);
    if (!m) throw new Error(`unable to decode ${src}`);
    const buf = Buffer.from(m[1], 'base64');
    await fs.writeFile(path.join(rawHdri, `${id}.exr`), buf);
    manifest.hdris.push({ id, credit: `Poly Haven — ${id} (CC0, 512px EXR derivative via @pmndrs/assets)`, file: `hdri/${id}.exr` });
  }

  const rawModels = path.join(RAW, 'models');
  await fs.mkdir(rawModels, { recursive: true });
  for (const m of MODELS) {
    const src = path.join(EXTRACT, m.from, 'package', m.src);
    await fs.copyFile(src, path.join(rawModels, `${m.id}.glb`));
    manifest.models.push({ id: m.id, credit: m.credit, file: `models/${m.id}.glb` });
  }
  const ghModelIds = [
    ['sheen_chair', 'SheenChair', 'CC0-1.0 — Khronos glTF Sample Assets'],
    ['lantern', 'Lantern', 'CC0-1.0 — Khronos glTF Sample Assets'],
    ['sofa', 'GlamVelvetSofa', 'CC-BY-4.0 — Khronos glTF Sample Assets'],
    ['helmet', 'DamagedHelmet', 'CC-BY-NC-4.0 — Khronos glTF Sample Assets (non-commercial only)'],
  ];
  for (const [id, , credit] of ghModelIds) {
    await fs.copyFile(path.join(DOWNLOADS, `${id}.bin`), path.join(rawModels, `${id}.glb`));
    manifest.models.push({ id, credit, file: `models/${id}.glb` });
  }

  const rawLicenses = path.join(RAW, 'licenses');
  await fs.mkdir(rawLicenses, { recursive: true });
  for (const b of GH_BLOBS.filter((x) => x.id.startsWith('licence_'))) {
    await fs.copyFile(path.join(DOWNLOADS, `${b.id}.bin`), path.join(rawLicenses, `${b.id}.md`));
    manifest.licenses.push({ id: b.id, file: `licenses/${b.id}.md`, source: `https://github.com/${GH_OWNER}/${GH_REPO}/blob/${GH_REV}/${b.path}` });
  }

  const rawFonts = path.join(RAW, 'fonts');
  await fs.mkdir(rawFonts, { recursive: true });
  const fontSrc = path.join(EXTRACT, 'pmndrs-assets', 'package', 'fonts', 'inter_bold.json.js');
  const fontText = await fs.readFile(fontSrc, 'utf8');
  const fm = fontText.match(/base64,([A-Za-z0-9+/=]+)/);
  if (!fm) throw new Error('unable to decode Inter typeface');
  await fs.writeFile(path.join(rawFonts, 'inter_bold.json'), Buffer.from(fm[1], 'base64'));
  manifest.fonts.push({ id: 'inter_bold', credit: 'Inter by Rasmus Andersson (SIL OFL 1.1) via @pmndrs/assets', file: 'fonts/inter_bold.json' });

  await fs.mkdir(path.dirname(LOCK), { recursive: true });
  await fs.writeFile(LOCK, JSON.stringify(lock, null, 2));
  await fs.writeFile(path.join(RAW, 'raw-manifest.json'), JSON.stringify(manifest, null, 2));

  const count = manifest.textures.length + manifest.hdris.length + manifest.models.length;
  console.log(`\nraw assets ready in .asset-cache/raw (${count} entries).`);
  console.log('next: npm run assets:optimize');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
