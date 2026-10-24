#!/usr/bin/env node
/**
 * BSOD_EX — Poly Haven (CC0) texture fetcher.
 *
 * Asset IDs are *resolved live* against the public Poly Haven API
 * (https://api.polyhaven.com/assets?t=textures) — no download URL is guessed:
 * for each wanted asset we query https://api.polyhaven.com/files/<id> and use
 * the 1k JPG URLs returned by the API (Diffuse / nor_gl / Rough / AO).
 * If a preferred ID no longer exists, the first asset in the same category
 * whose ID contains a fallback keyword is used instead, and reported.
 *
 * Verified by hand on 2026-10-24: api.polyhaven.com/files/wood_floor_deck and
 * assets?t=textures&c=floor (ids: aerial_asphalt_01, asphalt_02, ... exist).
 *
 * Textures land in public/textures/polyhaven/<id>/ and are picked up by the
 * game automatically (they override the shipped GitHub textures / procedural
 * fallbacks — see src/textures.js EXTERNAL_MAP). License: CC0 (Poly Haven).
 *
 * Usage: npm run fetch:polyhaven
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const OUT = path.join(process.cwd(), 'public', 'textures', 'polyhaven');
const WANTED = [ // preferred id -> fallback keyword search (in asset id)
  { id: 'wood_floor_deck', anyOf: ['wood_floor', 'planks'] },
  { id: 'asphalt_02',      anyOf: ['asphalt'] },
  { id: 'concrete_floor_wet_001', anyOf: ['concrete_floor', 'concrete'] },
  { id: 'fabric_pattern_07', anyOf: ['fabric'] },
  { id: 'metal_plate',     anyOf: ['metal'] },
  { id: 'marble_01',       anyOf: ['marble'] },
];
const MAPS = [ ['Diffuse', 'diff'], ['nor_gl', 'nor'], ['Rough', 'rough'], ['AO', 'ao'] ];

async function main() {
  console.log('Querying Poly Haven asset list…');
  const list = await (await fetch('https://api.polyhaven.com/assets?t=textures')).json();
  const ids = Object.keys(list);
  for (const w of WANTED) {
    let id = ids.includes(w.id) ? w.id : ids.find(i => w.anyOf.some(k => i.includes(k)));
    if (!id) { console.warn(`  !! no match for ${w.id}, skipped`); continue; }
    if (id !== w.id) console.log(`  (${w.id} not found → using ${id})`);
    const files = await (await fetch(`https://api.polyhaven.com/files/${id}`)).json();
    const dir = path.join(OUT, w.id); await mkdir(dir, { recursive: true });
    for (const [apiKey, short] of MAPS) {
      const f = files?.[apiKey]?.['1k']?.['jpg'];
      if (!f?.url) continue;
      const dest = path.join(dir, `${short}.jpg`);
      if (existsSync(dest)) { console.log(`  = ${w.id}/${short}.jpg (cached)`); continue; }
      const buf = Buffer.from(await (await fetch(f.url)).arrayBuffer());
      await writeFile(dest, buf);
      console.log(`  -> textures/polyhaven/${w.id}/${short}.jpg  (${(buf.length/1024).toFixed(0)} KiB)  [${id} via API]`);
    }
  }
  console.log('DONE (CC0 — Poly Haven). Restart the game to use the upgraded textures.');
}
main().catch(e => { console.error('Fetch failed:', e.message, '\nGame still runs with shipped/procedural textures.'); process.exit(1); });
