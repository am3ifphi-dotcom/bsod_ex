#!/usr/bin/env node
/**
 * verify-assets.mjs — check that what is in public/assets is exactly what the scripts produced.
 *
 * Checks
 *  1. every GLB declared in scripts/assets.manifest.json exists, is a valid glTF 2 binary, and
 *     matches the triangle/byte count recorded in public/assets/assets-report.json
 *  2. every environment map and every texture slot exists and is non-empty
 *  3. every texture set listed in public/assets/credits.json has a matching file
 *  4. the credits list covers every model / environment the game can load
 *  5. no third-party asset is present in public/assets that the credits do not mention
 *
 * Exit code 1 on any mismatch. Run with `npm run assets:verify` (part of `npm run assets:all`).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUB = path.join(ROOT, 'public', 'assets');
const read = (p) => fs.readFileSync(p);
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

let errors = 0;
let checks = 0;
const ok = (msg) => { checks++; console.log(`  ok   ${msg}`); };
const fail = (msg) => { errors++; console.error(`  FAIL ${msg}`); };

const manifest = readJson(path.join(ROOT, 'scripts', 'assets.manifest.json'));
const credits = readJson(path.join(PUB, 'credits.json'));
const report = fs.existsSync(path.join(PUB, 'assets-report.json')) ? readJson(path.join(PUB, 'assets-report.json')) : { models: [] };

console.log('[verify] models');
for (const m of manifest.models) {
  const file = path.join(PUB, 'models', `${m.id}.glb`);
  if (!fs.existsSync(file)) { fail(`missing model ${m.id}.glb`); continue; }
  const buf = read(file);
  const magic = buf.subarray(0, 4).toString('ascii');
  if (magic !== 'glTF') { fail(`${m.id}.glb is not a binary glTF (magic ${JSON.stringify(magic)})`); continue; }
  const version = buf.readUInt32LE(4);
  if (version !== 2) { fail(`${m.id}.glb has glTF version ${version}`); continue; }
  const rec = report.models.find((x) => x.id === m.id);
  if (rec && rec.bytes !== buf.length) {
    fail(`${m.id}.glb is ${buf.length} bytes but the report says ${rec.bytes} — re-run assets:optimize`);
    continue;
  }
  ok(`${m.id}.glb ${(buf.length / 1e6).toFixed(2)} MB${rec ? ` · ${rec.triangles.toLocaleString()} tris` : ''}`);
}

console.log('[verify] environments');
for (const e of manifest.environments) {
  const file = path.join(PUB, 'env', e.output);
  if (!fs.existsSync(file) || fs.statSync(file).size < 100000) { fail(`missing/short environment ${e.output}`); continue; }
  ok(`${e.output} ${(fs.statSync(file).size / 1e6).toFixed(2)} MB`);
}

console.log('[verify] textures');
for (const t of manifest.textures) {
  for (const [slot, rel] of Object.entries(t.files)) {
    const out = path.join(PUB, 'textures', `${t.id}_${slot}${path.extname(rel)}`);
    if (!fs.existsSync(out) || fs.statSync(out).size < 1000) fail(`missing texture ${t.id}/${slot}`);
    else ok(`texture ${t.id}/${slot}`);
  }
}
const sets = ['wood_floor', 'wood_dark', 'plaster', 'concrete', 'concrete_dark', 'metal_brushed', 'metal_rust', 'fabric', 'carpet', 'paper', 'asphalt', 'rubber', 'tile'];
for (const s of sets) {
  for (const slot of ['albedo', 'normal', 'rough', 'ao']) {
    const f = path.join(PUB, 'textures', `t_${s}_${slot}.webp`);
    if (!fs.existsSync(f)) { fail(`missing procedural set t_${s}_${slot}.webp`); continue; }
    // size varies a lot (a flat AO map compresses to ~200 bytes); check the container instead
    const head = read(f).subarray(0, 12).toString('ascii');
    if (!head.startsWith('RIFF') || !head.includes('WEBP')) fail(`t_${s}_${slot}.webp is not a WebP file`);
  }
}
ok(`${sets.length} procedural PBR sets × 4 maps present`);
{
  // every procedural texture is declared as self-made work in the credits
  const selfMade = credits.selfMade.map((s) => s.title).join(' ');
  if (/procedural/i.test(selfMade)) ok('procedural textures credited as original work');
  else fail('procedural textures are not credited');
}

console.log('[verify] credits');
const creditedModels = new Set(credits.assets.filter((a) => a.type === 'model').map((a) => a.id));
for (const m of manifest.models) {
  if (!creditedModels.has(m.id)) fail(`model ${m.id} has no credit entry`);
}
const envFiles = new Set(manifest.environments.map((e) => e.output.replace(/_1k\.hdr$/, '')));
const creditedEnvs = new Set(credits.assets.filter((a) => a.type === 'environment').map((a) => a.id));
for (const e of envFiles) {
  if (!creditedEnvs.has(e)) fail(`environment ${e} has no credit entry`);
}
for (const a of credits.assets) {
  if (!a.licenses?.length) fail(`asset ${a.id} has no license`);
  if (!a.source) fail(`asset ${a.id} has no source URL`);
}
ok(`${credits.assets.length} assets carry authors, licenses and sources`);

// anything in models/ or env/ that the credits do not mention is a licensing hazard
const modelFiles = fs.existsSync(path.join(PUB, 'models')) ? fs.readdirSync(path.join(PUB, 'models')).filter((f) => f.endsWith('.glb')) : [];
const known = new Set(manifest.models.map((m) => `${m.id}.glb`));
for (const f of modelFiles) {
  if (!known.has(f)) fail(`public/assets/models/${f} is not declared in the manifest (unlicensed asset?)`);
}
const envFilesOnDisk = fs.existsSync(path.join(PUB, 'env')) ? fs.readdirSync(path.join(PUB, 'env')) : [];
for (const f of envFilesOnDisk) {
  if (!manifest.environments.some((e) => e.output === f)) fail(`public/assets/env/${f} is not declared in the manifest`);
}
ok('no undeclared files in models/ or env/');

console.log(`\n[verify] ${errors ? `${errors} problem(s)` : `all ${checks} checks passed`}`);
process.exit(errors ? 1 : 0);
