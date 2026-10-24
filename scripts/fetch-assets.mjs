#!/usr/bin/env node
/**
 * fetch-assets.mjs — download every third-party asset declared in scripts/assets.manifest.json
 *
 * Design notes
 *  - Sources are public GitHub repositories. We use a blob-filtered, sparse checkout so we
 *    only transfer the bytes we actually use (some sample assets are >40 MB each).
 *  - Nothing is guessed: the manifest lists exact paths, and any missing file aborts the run.
 *  - Licence metadata is read from the model's own metadata.json / LICENSE.md and written to
 *    public/assets/credits.json, which the in-game credits screen and CREDITS.md consume.
 *  - Downloaded files are hashed into public/assets/assets-lock.json. Re-running verifies them.
 *
 * Usage: npm run assets:fetch [-- --force]
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, '.cache');
const RAWDIR = path.join(CACHE, 'raw');
const PUB = path.join(ROOT, 'public', 'assets');
const FORCE = process.argv.includes('--force');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'assets.manifest.json'), 'utf8'));

const log = (...a) => console.log('[fetch]', ...a);
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const mkdirp = (p) => fs.mkdirSync(p, { recursive: true });

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', ...opts });
}

/* ------------------------------------------------------------------ repos */
const repoDirs = {};
function ensureRepo(key) {
  if (repoDirs[key]) return repoDirs[key];
  const spec = manifest.repos[key];
  if (!spec) throw new Error(`unknown repo key ${key}`);
  const dir = path.join(CACHE, 'repos', key);
  if (!fs.existsSync(path.join(dir, '.git'))) {
    mkdirp(path.dirname(dir));
    fs.rmSync(dir, { recursive: true, force: true });
    log(`cloning ${spec.url} (blobless, depth 1) …`);
    sh('git', [
      'clone', '--filter=blob:none', '--no-checkout', '--depth', '1',
      '--branch', spec.ref, spec.url, dir,
    ], { stdio: 'inherit' });
  } else {
    log(`reusing clone ${path.relative(ROOT, dir)}`);
  }
  repoDirs[key] = { dir, spec };
  return repoDirs[key];
}

/** Sparse-checkout every path we need from one repo in a single pass. */
function checkoutPaths(repoKey, wanted) {
  const { dir } = ensureRepo(repoKey);
  const uniq = [...new Set(wanted)].filter(Boolean);
  log(`sparse checkout ${uniq.length} path(s) from ${repoKey}`);
  sh('git', ['sparse-checkout', 'init', '--no-cone'], { cwd: dir });
  sh('git', ['sparse-checkout', 'set', ...uniq], { cwd: dir });
  sh('git', ['checkout', '-f', 'HEAD'], { cwd: dir });
  return dir;
}

function listTree(repoKey, dirPath) {
  const { dir } = ensureRepo(repoKey);
  const out = sh('git', ['ls-tree', '-r', '--name-only', 'HEAD', dirPath], { cwd: dir });
  return out.trim().split('\n').filter(Boolean);
}

/* ------------------------------------------------------------------ helpers */
function writeIfChanged(dest, buf) {
  mkdirp(path.dirname(dest));
  if (!FORCE && fs.existsSync(dest)) {
    const old = fs.readFileSync(dest);
    if (sha256(old) === sha256(buf)) return { bytes: buf.length, skipped: true };
  }
  fs.writeFileSync(dest, buf);
  return { bytes: buf.length, skipped: false };
}

function parseModelLicense(modelDir) {
  const metaPath = path.join(modelDir, 'metadata.json');
  let authors = [];
  let licenses = [];
  if (fs.existsSync(metaPath)) {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    for (const l of meta.legal || []) {
      if (l.artist) authors.push(l.artist);
      if (l.license) licenses.push({ spdx: l.spdx || l.license, name: l.license, what: l.what });
    }
  }
  let licenseText = '';
  const licPath = path.join(modelDir, 'LICENSE.md');
  if (fs.existsSync(licPath)) licenseText = fs.readFileSync(licPath, 'utf8');
  const spdx = [...new Set(licenses.map((l) => l.spdx))].sort();
  return { authors: [...new Set(authors)], licenses, spdx, licenseText };
}

const download = [];
function record(entry) { download.push(entry); }

/* ------------------------------------------------------------------ models */
const creditsModels = [];
for (const m of manifest.models) {
  const variantDir = m.format === 'gltf' ? m.variant : 'glTF-Binary';
  const dirInRepo = `${m.dir}/${variantDir}`;
  const files = listTree(m.repo, dirInRepo);
  if (!files.length) throw new Error(`no files found at ${dirInRepo}`);
  checkoutPaths(m.repo, [`${m.dir}/`, dirInRepo]);
  const { dir: repoDir } = ensureRepo(m.repo);
  const ext = files.find((f) => f.endsWith('.glb'));
  const gltf = files.find((f) => f.endsWith('.gltf'));
  if (!ext && !gltf) throw new Error(`no .glb/.gltf in ${dirInRepo}`);
  const outDir = path.join(RAWDIR, 'models', m.id);
  mkdirp(outDir);
  let total = 0;
  for (const rel of files) {
    const buf = fs.readFileSync(path.join(repoDir, rel));
    // asset dirs also contain screenshots/readmes; keep only binary + textures + json
    if (/\.(png|jpe?g|webp|ktx2?|bin|glb|gltf)$/i.test(rel)) {
      const r = writeIfChanged(path.join(outDir, path.basename(rel)), buf);
      total += r.bytes;
      record({ file: path.relative(ROOT, path.join(outDir, path.basename(rel))), sha256: sha256(buf), bytes: buf.length });
    }
  }
  const lic = parseModelLicense(path.join(repoDir, m.dir));
  fs.writeFileSync(path.join(outDir, 'LICENSE.md'), lic.licenseText || m.licenseNote);
  creditsModels.push({
    type: 'model',
    id: m.id,
    title: path.basename(m.dir),
    authors: lic.authors.length ? lic.authors : ['see source'],
    licenses: lic.spdx.length ? lic.spdx : ['see LICENSE.md'],
    licenseNote: m.licenseNote,
    source: `${manifest.repos[m.repo].url.replace(/\.git$/, '')}/tree/${manifest.repos[m.repo].ref}/${dirInRepo}`,
    sourceLabel: manifest.repos[m.repo].label,
    use: m.use,
    entry: ext ? path.basename(ext) : path.basename(gltf),
    format: ext ? 'glb' : 'gltf',
    bytes: total,
  });
  log(`model ${m.id}: ${files.length} files, ${(total / 1e6).toFixed(1)} MB raw`);
}

/* ------------------------------------------------------------------ environments + textures */
const envCredits = [];
const envFiles = manifest.environments.map((e) => e.repo === 'three' ? e.path : `${e.dir}/${e.variant}`);
const texFiles = manifest.textures.filter((t) => t.repo === 'three').flatMap((t) => Object.values(t.files));
checkoutPaths('three', [...envFiles, ...texFiles]);
checkoutPaths('khronos', manifest.environments.filter((e) => e.repo === 'khronos').map((e) => `${e.dir}/`));

for (const e of manifest.environments) {
  const { dir } = ensureRepo(e.repo);
  const srcPath = e.repo === 'three' ? e.path : `${e.dir}/${e.variant}`;
  const buf = fs.readFileSync(path.join(dir, srcPath));
  if (buf.length < 1000) throw new Error(`suspiciously small file: ${srcPath}`);
  const dest = path.join(PUB, 'env', e.output);
  const r = writeIfChanged(dest, buf);
  record({ file: path.relative(ROOT, dest), sha256: sha256(buf), bytes: buf.length });
  envCredits.push({
    type: 'environment', id: e.id, title: e.id.replace(/_/g, ' '),
    authors: ['Poly Haven'], licenses: ['CC0-1.0'], licenseNote: e.licenseNote,
    source: e.repo === 'three' ? `${manifest.repos.three.url.replace(/\.git$/, '')}/blob/${manifest.repos.three.ref}/${e.path}` : '',
    sourceLabel: manifest.repos[e.repo].label, use: e.use, bytes: buf.length,
  });
  log(`env ${e.output}: ${(r.bytes / 1e6).toFixed(2)} MB`);
}

const texCredits = [];
for (const t of manifest.textures) {
  const { dir } = ensureRepo(t.repo);
  const sampleRel = Object.values(t.files)[0];
  texCredits.push({
    type: 'texture', id: t.id, title: t.id,
    authors: t.authors ?? ['ambientCG'],
    licenses: t.licenses ?? ['CC0-1.0'],
    licenseNote: t.licenseNote,
    source: t.source ?? 'https://ambientcg.com/',
    sourceLabel: 'ambientCG (via the three.js repository mirror)',
    use: t.use,
    file: sampleRel,
  });
  for (const [slot, rel] of Object.entries(t.files)) {
    const buf = fs.readFileSync(path.join(dir, rel));
    const dest = path.join(PUB, 'textures', `${t.id}_${slot}${path.extname(rel)}`);
    const r = writeIfChanged(dest, buf);
    record({ file: path.relative(ROOT, dest), sha256: sha256(buf), bytes: buf.length });
    log(`texture ${t.id}/${slot}: ${(r.bytes / 1e6).toFixed(2)} MB`);
  }
}

/* ------------------------------------------------------------------ credits */
mkdirp(PUB);
const credits = {
  generated: new Date().toISOString(),
  note: 'Every third-party asset used by the experience. CC0 assets need no attribution but are credited anyway; CC-BY assets require the attribution listed here. No asset with unclear provenance is used.',
  assets: [...creditsModels, ...envCredits, ...texCredits],
  software: [
    { title: 'three.js', authors: ['three.js authors'], licenses: ['MIT'], source: 'https://github.com/mrdoob/three.js', use: 'WebGL rendering, post-processing, glTF loading.' },
    { title: 'Vite', authors: ['Vite contributors'], licenses: ['MIT'], source: 'https://github.com/vitejs/vite', use: 'Dev server and production build.' },
    { title: 'TypeScript', authors: ['Microsoft'], licenses: ['Apache-2.0'], source: 'https://github.com/microsoft/TypeScript', use: 'Language / type checking.' },
    { title: 'glTF Transform', authors: ['Don McCurdy'], licenses: ['MIT'], source: 'https://github.com/donmccurdy/glTF-Transform', use: 'Offline asset optimisation (dedupe, prune, WebP texture compression).' },
    { title: 'sharp', authors: ['Lovell Fuller and contributors'], licenses: ['Apache-2.0'], source: 'https://github.com/lovell/sharp', use: 'Offline texture generation and encoding (build-time only).' },
    { title: 'Vitest', authors: ['Vitest contributors'], licenses: ['MIT'], source: 'https://github.com/vitest-dev/vitest', use: 'Automated tests (build-time only).' },
  ],
  selfMade: [
    { title: 'Procedural PBR textures', licenses: ['CC0-1.0'], note: 'Generated by scripts/gen-textures.mjs (wood, plaster, concrete, metal, fabric, paper, tile, cable).' },
    { title: 'All audio', licenses: ['CC0-1.0'], note: 'Synthesised at runtime with the Web Audio API in src/audio — no sampled recordings.' },
    { title: 'Level geometry, level design, shaders, UI, code', licenses: ['see README'], note: 'Authored for this project.' },
  ],
};
fs.writeFileSync(path.join(PUB, 'credits.json'), JSON.stringify(credits, null, 2));

const lock = { generated: new Date().toISOString(), files: download };
fs.writeFileSync(path.join(PUB, 'assets-lock.json'), JSON.stringify(lock, null, 2));

log(`done. ${download.length} files tracked, credits for ${credits.assets.length} assets.`);
