#!/usr/bin/env node
// Generates the credit data used by the in-game menu (assets/credits.json) and
// the human-readable CREDITS.md at the repository root.
//
// The table below is the single source of truth for attribution. It is
// cross-checked against:
//   * public/assets/asset-manifest.json  (what was actually built into the game)
//   * public/assets/licences/<Model>.LICENSE.md (the upstream licence text)
//
// Run with: npm run credits
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(root, 'public/assets/asset-manifest.json');
const licenceDir = path.join(root, 'public/assets/licences');

const SOURCE = 'https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models';

// name in the manifest -> attribution. `licence` mirrors the upstream LICENSE.md
// shipped in public/assets/licences/.
const MODELS = {
  ABeautifulGame: {
    name: 'A Beautiful Game', author: 'Khronos Group / AGI', licence: 'CC-BY-4.0',
    use: 'giant chess pieces floating in the wasteland',
  },
  AntiqueCamera: {
    name: 'Antique Camera', author: 'Khronos Group / UX3D', licence: 'CC0-1.0',
    use: 'floating relic over the arrival basin and the atrium',
  },
  CarConcept: {
    name: 'Car Concept', author: 'Khronos Group / DGG', licence: 'CC-BY-4.0',
    use: 'wrecked car in the invaded city',
  },
  ChronographWatch: {
    name: 'Chronograph Watch', author: 'Khronos Group', licence: 'CC-BY-4.0',
    use: 'watch lying on the bedroom desk',
  },
  DamagedHelmet: {
    name: 'Damaged Helmet', author: 'theblueturtle_', licence: 'CC-BY-4.0',
    use: 'large relic hanging in the collapsed atrium',
  },
  DiffuseTransmissionPlant: {
    name: 'Diffuse Transmission Plant', author: 'Khronos Group / UX3D', licence: 'CC-BY-4.0',
    use: 'potted plant in the bedroom and the atrium',
  },
  GlassBrokenWindow: {
    name: 'Glass Broken Window', author: 'Khronos Group', licence: 'CC-BY-4.0',
    use: 'shattered panes embedded in the city ruins',
  },
  GlassHurricaneCandleHolder: {
    name: 'Glass Hurricane Candle Holder', author: 'Khronos Group', licence: 'CC-BY-4.0',
    use: 'candle holder on the bedroom shelf',
  },
  GlassVaseFlowers: {
    name: 'Glass Vase with Flowers', author: 'Khronos Group', licence: 'CC0-1.0',
    use: 'vase on the bedroom shelf',
  },
  GlamVelvetSofa: {
    name: 'Glam Velvet Sofa', author: 'Khronos Group / Wayfair', licence: 'CC-BY-4.0',
    use: 'sofa tumbling slowly above the wasteland',
  },
  Lantern: {
    name: 'Lantern', author: 'Khronos Group / Microsoft', licence: 'CC0-1.0',
    use: 'hanging lanterns in the deep cable layer',
  },
  PotOfCoals: {
    name: 'Pot of Coals', author: 'Khronos Group', licence: 'CC-BY-4.0',
    use: 'embers burning on the deep layer floor',
  },
  SciFiHelmet: {
    name: 'Sci-Fi Helmet', author: 'Khronos Group', licence: 'CC0-1.0',
    use: 'floating relic over the wasteland and inside the atrium',
  },
  SheenChair: {
    name: 'Sheen Chair', author: 'Khronos Group / Wayfair', licence: 'CC0-1.0',
    use: 'desk chair in the bedroom',
  },
  WaterBottle: {
    name: 'Water Bottle', author: 'Khronos Group', licence: 'CC0-1.0',
    use: 'bottle on the bedroom desk',
  },
};

const SOFTWARE = [
  { name: 'three.js r170', author: 'three.js authors', licence: 'MIT', url: 'https://threejs.org/' },
  { name: 'Rapier 3D (rapier3d-compat 0.14)', author: 'Dimforge', licence: 'Apache-2.0', url: 'https://rapier.rs/' },
  { name: 'three-mesh-bvh', author: 'Garrett Johnson', licence: 'MIT', url: 'https://github.com/gkjohnson/three-mesh-bvh' },
  { name: 'Vite', author: 'Evan You & contributors', licence: 'MIT', url: 'https://vitejs.dev/' },
  { name: 'TypeScript', author: 'Microsoft', licence: 'Apache-2.0', url: 'https://www.typescriptlang.org/' },
  { name: 'meshoptimizer', author: 'Arseny Kapoulkine', licence: 'MIT', url: 'https://github.com/zeux/meshoptimizer' },
  { name: 'glTF Transform', author: 'Don McCurdy', licence: 'MIT', url: 'https://gltf-transform.dev/' },
  { name: 'sharp', author: 'Lovell Fuller', licence: 'Apache-2.0', url: 'https://sharp.pixelplumbing.com/' },
];

const ENVIRONMENTS = [
  {
    name: 'night / city / apartment / warehouse / studio / dawn HDRIs (downsampled to 512x256 EXR)',
    author: '@pmndrs/assets (CC0)', licence: 'CC0-1.0', url: 'https://github.com/pmndrs/assets',
  },
];

const AUDIO = [
  {
    name: 'All sound effects, ambience and the drone score',
    author: 'synthesised at runtime by this project with the Web Audio API',
    licence: 'original work (CC0)', url: '',
  },
];

const TEXTURES = [
  {
    name: 'Every PBR material (wood, plaster, concrete, sand, fabric, metal, rug, skyline, noise)',
    author: 'procedurally generated at runtime by this project',
    licence: 'original work (CC0)', url: '',
  },
];

const NOTES = [
  'Every 3D model is a Khronos glTF Sample Asset, fetched by scripts/fetch-assets.sh and re-materialised, re-scaled (1 unit = 1 m) and optimised by scripts/build-assets.mjs.',
  'Upstream licence files for all shipped models are kept in public/assets/licences/ and are copied verbatim rather than summarised.',
  'No asset with unknown or non-redistributable terms is used; no model in the manifest is missing an attribution (checked by tests/assets.test.ts).',
  'HDRIs are CC0 environment maps authored by the pmndrs/assets project; they are used for lighting and reflections only.',
];

// ---------------------------------------------------------------------------
function fail(msg) {
  console.error(`gen-credits: ${msg}`);
  process.exit(1);
}

if (!fs.existsSync(manifestPath)) fail(`missing ${path.relative(root, manifestPath)} — run npm run assets:build first`);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

const shipped = [...new Set(manifest.models.filter((m) => !m.error).map((m) => m.name))];
const unknown = shipped.filter((n) => !MODELS[n]);
if (unknown.length) fail(`no attribution for: ${unknown.join(', ')}`);

const missingLicence = shipped.filter(
  (n) => !fs.existsSync(path.join(licenceDir, `${n}.LICENSE.md`)),
);
if (missingLicence.length) fail(`no upstream licence file for: ${missingLicence.join(', ')}`);

const models = shipped.map((n) => {
  const m = MODELS[n];
  return {
    name: m.name,
    author: m.author,
    licence: m.licence,
    url: `${SOURCE}/${n}`,
    use: m.use,
  };
}).sort((a, b) => a.name.localeCompare(b.name));

const credits = {
  title: 'BSOD_EX',
  subtitle: 'short first-person horror / glitch experience',
  software: SOFTWARE,
  models,
  environments: ENVIRONMENTS,
  audio: AUDIO,
  textures: TEXTURES,
  notes: NOTES,
};

const creditsJson = path.join(root, 'assets/credits.json');
fs.mkdirSync(path.dirname(creditsJson), { recursive: true });
fs.writeFileSync(creditsJson, `${JSON.stringify(credits, null, 2)}\n`);

// ------------------------------------------------------------------ CREDITS.md
const rows = models
  .map((m) => `| ${m.name} | ${m.author} | ${m.licence} | ${m.use} | [source](${m.url}) |`)
  .join('\n');

const md = `# Credits — BSOD_EX

\`assets/credits.json\` is generated by \`npm run credits\` from the table in
\`scripts/gen-credits.mjs\`, cross-checked against \`public/assets/asset-manifest.json\`.
The in-game Esc → Credits panel renders the same data, so this file and the game
cannot drift apart. Regenerate it whenever the asset set changes.

## 3D models

All models come from the [Khronos glTF Sample Assets](${SOURCE}) repository.
Each was downloaded with \`scripts/fetch-assets.sh\`, re-scaled to 1 unit = 1 m,
re-materialised for the BSOD look and (where marked) simplified to a second LOD
by \`scripts/build-assets.mjs\`. The upstream licence text for every model is
shipped verbatim in \`public/assets/licences/\`.

| Model | Author | Licence | Use in game | Source |
| --- | --- | --- | --- | --- |
${rows}

Licences used here are CC0-1.0 and CC-BY-4.0. CC-BY requires attribution, which
this file, the in-game credits panel and \`public/assets/licences/\` provide.

### Not shipped

These were evaluated during production but are not part of the build and are
not redistributed:
- **Chair Damask Purplegold** (Khronos) — superseded by Sheen Chair.
- **Sponza**, **Virtual City**, and any Khronos model without a per-model
  licence file — deliberately excluded.

## Environments / HDRIs

${ENVIRONMENTS.map((e) => `- ${e.name} — ${e.author}, ${e.licence} (${e.url})`).join('\n')}

The six EXRs in \`public/assets/hdr/\` are derived from the CC0 EXR environment
maps published by \`@pmndrs/assets\` and downsampled by
\`scripts/build-assets.mjs\`. Full terms: \`public/assets/licences/pmndrs-assets.LICENSE.txt\`.

## Audio

${AUDIO.map((a) => `- ${a.name} — ${a.author}, ${a.licence}`).join('\n')}

No third-party samples are used: every footstep, servo, crack, drone and sting is
generated with oscillators, noise buffers and filters at runtime. That keeps the
build free of unclear sample licences and lets the mix duck automatically.

## Textures

${TEXTURES.map((t) => `- ${t.name} — ${t.author}, ${t.licence}`).join('\n')}

No image textures are downloaded. Everything is drawn into canvases at load time
(albedo, roughness, normal-ish detail), so the repository ships code rather than
megabytes of bitmaps.

## Software

| Library | Author | Licence |
| --- | --- | --- |
${SOFTWARE.map((s) => `| [${s.name}](${s.url}) | ${s.author} | ${s.licence} |`).join('\n')}

Build-only tools (glTF Transform, sharp, meshoptimizer, esbuild, jsdom,
@napi-rs/canvas) are not part of the runtime bundle.

## Notes

${NOTES.map((n) => `- ${n}`).join('\n')}
`;

fs.writeFileSync(path.join(root, 'CREDITS.md'), md);

console.log(`credits: ${models.length} models, ${SOFTWARE.length} libraries`);
console.log(`  wrote assets/credits.json`);
console.log(`  wrote CREDITS.md`);
