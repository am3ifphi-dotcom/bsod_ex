# CREDITS — BSOD // EX

この作品は、外部の 3D 素材・HDRI・テクスチャを **改変して** 使用しています。
すべての素材について、ライセンス・作者・出典を 1 点ずつ確認し、改変・再配布・公開が明確に許可されているものだけを使っています。
ライセンスが不明瞭な素材は使用していません。

The same list is available in-game: **Esc → アセット クレジット**.
It is generated from `public/assets/credits.json` (the single source of truth) by
`npm run credits`; `npm run assets:verify` fails the build if an asset is missing from it.

---

## Attribution that is legally required (CC-BY)

- **GlamVelvetSofa** — Eric Chadwick — CC-BY-4.0 — <https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/GlamVelvetSofa/glTF-Binary>
  - used as: Abandoned lounge in the corrupted street area.
  - modified: re-materialised into the BSOD palette, re-lit, fractured / scattered / re-scaled (see below)
- **CommercialRefrigerator** — Eric Chadwick, Sean Thomas — CC-BY-4.0 — <https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/CommercialRefrigerator/glTF-Binary>
  - used as: Shop front in the corrupted street area.
  - modified: re-materialised into the BSOD palette, re-lit, fractured / scattered / re-scaled (see below)
- **SheenWoodLeatherSofa** — Eric Chadwick, Fran Calvente — CC-BY-4.0 / CC0-1.0 — <https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/SheenWoodLeatherSofa/glTF-Binary>
  - used as: Second lounge, hidden side-room.
  - modified: re-materialised into the BSOD palette, re-lit, fractured / scattered / re-scaled (see below)
- **StainedGlassLamp** — Eric Chadwick — CC-BY-4.0 — <https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/StainedGlassLamp/glTF>
  - used as: Bedroom floor lamp — the only warm light in the room.
  - modified: re-materialised into the BSOD palette, re-lit, fractured / scattered / re-scaled (see below)

CC-BY-4.0 requires that the creator is named, a link to the license is given, and that
modifications are indicated. Modifications performed by this project:

- every model is converted to glTF 2.0 (GLB), de-duplicated, pruned, and its textures
  re-encoded to WebP at reduced resolution (`scripts/optimize-assets.mjs`);
- models are re-scaled to metres, re-pivoted to stand on y = 0, and re-materialised with the
  project's BSOD palette (blue-tinted PBR, emissive seams, scanline / block-noise overlays);
- in the glitch world the assets are cut apart, floated, rotated, flipped, buried or used as
  architectural fragments; the bedroom uses them as ordinary furniture.

License texts: CC0-1.0 <https://creativecommons.org/publicdomain/zero/1.0/>,
CC-BY-4.0 <https://creativecommons.org/licenses/by/4.0/>.

---

## 3D models

| asset | author(s) | license | source | notes |
|---|---|---|---|---|
| SheenChair | Eric Chadwick | CC0-1.0 | [Khronos glTF Sample Assets](<https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/SheenChair/glTF>) | CC0-1.0. Model + textures by Eric Chadwick / Wayfair, LLC. |
| Lantern | sbtron, Frank Galligan | CC0-1.0 | [Khronos glTF Sample Assets](<https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Lantern/glTF-Binary>) | CC0-1.0. Model + textures by Microsoft. |
| WaterBottle | Microsoft | CC0-1.0 | [Khronos glTF Sample Assets](<https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/WaterBottle/glTF-Binary>) | CC0-1.0. Model + textures by Microsoft. |
| BoomBox | Microsoft | CC0-1.0 | [Khronos glTF Sample Assets](<https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/BoomBox/glTF-Binary>) | CC0-1.0. Model + textures by Microsoft. |
| GlassVaseFlowers | Eric Chadwick, Rico Cilliers | CC0-1.0 | [Khronos glTF Sample Assets](<https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/GlassVaseFlowers/glTF-Binary>) | CC0-1.0. Model + textures by Microsoft. |
| DiffuseTransmissionTeacup | Polyhaven.com, and Eric Chadwick | CC0-1.0 | [Khronos glTF Sample Assets](<https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/DiffuseTransmissionTeacup/glTF-Binary>) | CC0-1.0. Model + textures by Khronos Group. |
| ToyCar | Guido Odendahl, Eric Chadwick | CC0-1.0 | [Khronos glTF Sample Assets](<https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/ToyCar/glTF-Binary>) | CC0-1.0. Model + textures by Khronos Group. |
| SciFiHelmet | Michael Pavlovic, Norbert Nopper | CC0-1.0 | [Khronos glTF Sample Assets](<https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/SciFiHelmet/glTF>) | CC0-1.0. Model + textures by Microsoft. |
| FlightHelmet | Gary Hsu | CC0-1.0 | [Khronos glTF Sample Assets](<https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/FlightHelmet/glTF>) | CC0-1.0. Model + textures by Microsoft. |
| GlamVelvetSofa | Eric Chadwick | CC-BY-4.0 | [Khronos glTF Sample Assets](<https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/GlamVelvetSofa/glTF-Binary>) | CC-BY-4.0. Model + textures by Eric Chadwick / Wayfair, LLC. |
| CommercialRefrigerator | Eric Chadwick, Sean Thomas | CC-BY-4.0 | [Khronos glTF Sample Assets](<https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/CommercialRefrigerator/glTF-Binary>) | CC-BY-4.0. Model + textures by Paweł Pęksa / Szymon Szymczyk. |
| SheenWoodLeatherSofa | Eric Chadwick, Fran Calvente | CC-BY-4.0 / CC0-1.0 | [Khronos glTF Sample Assets](<https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/SheenWoodLeatherSofa/glTF-Binary>) | CC0-1.0 (model) + CC-BY-4.0 (documentation). Model by Eric Chadwick / Wayfair, LLC. |
| StainedGlassLamp | Eric Chadwick | CC-BY-4.0 | [Khronos glTF Sample Assets](<https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/StainedGlassLamp/glTF>) | CC-BY-4.0. Model + textures by Eric Chadwick. |

## Environments (HDRI)

| asset | author(s) | license | source | notes |
|---|---|---|---|---|
| moonless golf | Poly Haven | CC0-1.0 | [three.js repository (asset mirror)](<https://github.com/mrdoob/three.js/blob/dev/examples/textures/equirectangular/moonless_golf_1k.hdr>) | CC0-1.0. HDRI by Poly Haven (moonless golf course). |
| pedestrian overpass | Poly Haven | CC0-1.0 | [three.js repository (asset mirror)](<https://github.com/mrdoob/three.js/blob/dev/examples/textures/equirectangular/pedestrian_overpass_1k.hdr>) | CC0-1.0. HDRI by Poly Haven (pedestrian overpass). |

## Textures

| asset | author(s) | license | source | notes |
|---|---|---|---|---|
| Ice002 (ambientCG) | ambientCG (Lennart Demes) | CC0-1.0 | [ambientCG (via the three.js repository mirror)](<https://ambientcg.com/view?id=Ice002>) | CC0-1.0. Colour/normal/roughness/displacement maps, converted to glTF-ready form and repacked as WebP. |

---

## Software

- **three.js** — three.js authors — MIT — <https://github.com/mrdoob/three.js> — WebGL rendering, post-processing, glTF loading.
- **Vite** — Vite contributors — MIT — <https://github.com/vitejs/vite> — Dev server and production build.
- **TypeScript** — Microsoft — Apache-2.0 — <https://github.com/microsoft/TypeScript> — Language / type checking.
- **glTF Transform** — Don McCurdy — MIT — <https://github.com/donmccurdy/glTF-Transform> — Offline asset optimisation (dedupe, prune, WebP texture compression).
- **sharp** — Lovell Fuller and contributors — Apache-2.0 — <https://github.com/lovell/sharp> — Offline texture generation and encoding (build-time only).
- **Vitest** — Vitest contributors — MIT — <https://github.com/vitest-dev/vitest> — Automated tests (build-time only).

## Original work (this project)

- **Procedural PBR textures** — CC0-1.0 — 13 seamless material sets generated by scripts/gen-textures.mjs (wood, plaster, concrete, metal, fabric, carpet, paper, asphalt, rubber, tile …).
- **All audio** — CC0-1.0 — Synthesised at runtime with the Web Audio API in src/audio/AudioEngine.ts. No sampled recordings, no third-party sound files.
- **Level geometry, level design, shaders, UI, code** — see README — Authored for this project.

- Level geometry, level design, all shaders (including the BSOD post pass, depth-of-field pass
  and the glitch-warping vertex stages), UI, narrative text and code are original work
  authored for this project.
- The bedroom, the five glitch-world areas, the tunnel, the monolith and the collapse
  sequence were built from primitives plus the assets listed above.

## Audio

All audio is synthesised at runtime with the Web Audio API (`src/audio/AudioEngine.ts`):
room tone, fan, clock tick, distant traffic, footsteps by surface, impacts, cracks, debris,
wind, heartbeat, breath and every glitch burst. **No sampled recordings and no third-party
sound files are used** — the audio is therefore original work released as CC0-1.0.

---

_Generated by `scripts/gen-credits.mjs` on 2026-10-24 from
public/assets/credits.json. If that file changes, re-run `npm run credits`._
