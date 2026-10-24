// Asset integrity: the built manifest must match what is on disk, every
// shipped model must have an upstream licence file and an entry in the credit
// table, and LOD twins must actually be lighter than the base mesh.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, readCredits, readManifest } from './helpers.ts';

const manifest = readManifest();
const credits = readCredits();

const shipped = manifest.models.filter((m) => !m.error);

test('every manifest model file exists at its recorded size', () => {
  for (const m of shipped) {
    const f = path.join(ROOT, 'public', m.file);
    assert.ok(fs.existsSync(f), `missing ${m.file}`);
    const { size } = fs.statSync(f);
    assert.equal(size, m.bytes, `${m.file} is ${size} bytes, manifest says ${m.bytes}`);
  }
});

test('no model failed to build', () => {
  const broken = manifest.models.filter((m) => m.error);
  assert.deepEqual(broken, [], `asset build errors: ${JSON.stringify(broken)}`);
});

test('every shipped model has its upstream licence text', () => {
  for (const name of new Set(shipped.map((m) => m.name))) {
    const f = path.join(ROOT, 'public/assets/licences', `${name}.LICENSE.md`);
    assert.ok(fs.existsSync(f), `missing licence for ${name}`);
    const txt = fs.readFileSync(f, 'utf8');
    assert.ok(txt.length > 50, `${name} licence file looks empty`);
  }
});

test('every shipped model is credited, with a licence and a link', () => {
  const credited = new Map(credits.models.map((m) => [m.name, m]));
  for (const name of new Set(shipped.map((m) => m.name))) {
    const hit = [...credited.values()].find((c) => c.url.endsWith(`/${name}`));
    assert.ok(hit, `${name} is shipped but not credited`);
    assert.match(hit.licence, /CC0|CC-BY/, `${name} has no CC licence recorded`);
    assert.match(hit.author, /\S/, `${name} has no author`);
  }
});

test('credits do not advertise assets that are not shipped', () => {
  const shippedUrls = new Set(shipped.map((m) => `https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/${m.name}`));
  for (const c of credits.models) {
    assert.ok(shippedUrls.has(c.url), `credits list ${c.name}, which is not in the build`);
  }
});

test('LOD twins are meaningfully lighter than their base mesh', () => {
  const lods = shipped.filter((m) => m.lod);
  assert.ok(lods.length >= 8, `expected several LOD'ed models, found ${lods.length}`);
  for (const lod of lods) {
    const base = shipped.find((m) => m.name === lod.name && !m.lod);
    assert.ok(base, `LOD ${lod.name} has no base mesh`);
    assert.ok(lod.tris < base.tris * 0.8,
      `${lod.name} LOD is ${lod.tris} tris vs ${base.tris} base — not a real LOD`);
  }
});

test('model bounds are finite and plausible', () => {
  // Source assets are not authored in metres (the Lantern, for instance, ships
  // ~25 m across); the game normalises every instance at load time with
  // AssetLoader.fit(), so this only guards against broken/empty geometry.
  for (const m of shipped) {
    if (!m.bounds) continue;
    const [x, y, z] = m.bounds.size;
    const biggest = Math.max(x, y, z);
    assert.ok(Number.isFinite(biggest) && biggest > 0.0001, `${m.name} has degenerate bounds`);
    assert.ok(biggest < 60, `${m.name} is ${biggest.toFixed(1)} units across — bounds look wrong`);
    assert.ok(m.tris > 0, `${m.name} has no triangles`);
  }
});

test('runtime asset budget stays reasonable', () => {
  const total = manifest.models.reduce((s, m) => s + (m.bytes || 0), 0)
    + manifest.hdr.reduce((s, m) => s + m.bytes, 0);
  assert.ok(total < 40 * 1024 * 1024, `runtime assets are ${(total / 1048576).toFixed(1)} MB`);
  assert.ok(manifest.hdr.length >= 4, 'expected the HDRI set');
});

test('HDRIs are real EXR files with documented size', () => {
  for (const h of manifest.hdr) {
    const f = path.join(ROOT, 'public', h.file);
    assert.ok(fs.existsSync(f), `missing ${h.file}`);
    const head = fs.readFileSync(f).subarray(0, 4);
    assert.deepEqual([...head], [0x76, 0x2f, 0x31, 0x01], `${h.file} is not an EXR`);
    assert.equal(fs.statSync(f).size, h.bytes);
  }
});

test('software credits carry a licence and a link', () => {
  assert.ok(credits.software.length >= 5);
  for (const s of credits.software) {
    assert.ok(s.name && s.author && s.licence && s.url, `incomplete credit: ${JSON.stringify(s)}`);
  }
});
