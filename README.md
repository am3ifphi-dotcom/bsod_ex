# BSOD // EX

A first-person short horror / glitch experience that runs in the browser.
You sit down at your PC at 03:47. The screen blue-screens. The blue screen has a face.
You click it. It clicks back.

- **Length:** 15–25 minutes for a first playthrough (movement, exploration and the console included)
- **Built with:** TypeScript + three.js (WebGL2), Vite, Web Audio. No game engine.
- **Audio:** entirely synthesised at runtime — no sound files.
- **Assets:** CC0 / CC-BY-4.0 only, one by one verified — see [CREDITS.md](CREDITS.md) and **Esc → アセット クレジット** in-game.

> **Photosensitivity warning.** The experience contains flashing, screen tearing and rapid
> luminance changes. It is rate-limited (no more than 3 flashes per second anywhere), the
> warning is shown before anything starts, and **設定 → グリッチ演出の強度 → 0%** removes the
> flashing entirely while keeping the story intact.

---

## Quick start

Requirements: **Node 18+** (tested on Node 22) and a **WebGL2** browser (Chrome / Edge / Firefox /
Safari 16+). The assets are already in the repository, so no download step is needed.

```bash
npm install
npm run dev          # http://localhost:5173
```

Production build:

```bash
npm run build        # tsc --noEmit && vite build  ->  dist/
npm run preview      # serve dist/ on http://localhost:4173
```

Everything is static: `dist/` can be served by any file server (relative `base`, no server code).

### Other scripts

| script | what it does |
|---|---|
| `npm run typecheck` | strict TypeScript, zero errors |
| `npm test` | 62 headless tests (jsdom + node) |
| `npm run assets:fetch` | re-download every third-party asset from its public repository, verify the licence metadata, rebuild `public/assets/credits.json` |
| `npm run assets:optimize` | glTF-Transform: dedupe, prune, weld, WebP textures → 13 GLBs |
| `npm run textures` | regenerate the 13 procedural PBR texture sets (`scripts/gen-textures.mjs`) |
| `npm run assets:verify` | check every asset, texture, licence entry and file on disk (fails on anything unlicensed or missing) |
| `npm run credits` | regenerate `CREDITS.md` from `public/assets/credits.json` |
| `npm run assets:all` | all of the above, in order |

---

## Controls

| input | action |
|---|---|
| **WASD** / arrows | walk |
| **Shift** | dash (≈2× walk speed: 8.1 m/s vs 4.05 m/s) |
| **Mouse** | look (if the browser refuses Pointer Lock — e.g. inside an embedded preview frame — the game falls back to lock-free mouse look automatically) |
| **E** or **left click** | interact (only when the reticle is hot and a prompt is shown) |
| **F** | flashlight (glitch world only) |
| **C** | in-world console (the glitch world only) |
| **Enter** | run the console command |
| **Esc** | pause menu / close console / close credits |
| **F3** | performance overlay (average fps, 1% low, frame ms, draw calls, triangles, resolution scale) |
| **F9** | dev-only phase jump (room → world → collapse); compiled out of production builds |

The pause menu has resume, restart, quit-to-title, asset credits and live settings:
mouse sensitivity **0.2–3.0** (applied on the next mouse event, no confirm needed), volume,
glitch intensity, camera shake / head bob, FOV 60–95, quality preset (low / medium / high),
and the F3 overlay toggle. Settings persist in `localStorage` (`bsod-ex.settings.v1`).

---

## What happens (spoiler-light)

1. **The bedroom.** A small night room, the monitor is the only light, a fan, a clock at 03:47,
   a car passing far away. Walk to the desk and look at the monitor: the camera tilts and the
   depth of field pulls focus onto the screen (the world outside it goes soft), and the machine
   blue-screens.
2. **The blue screen.** Click the emoticon. Six stages: the text starts to tear, the "screen"
   becomes a physical surface, the room's light and perspective bend, the emoticon opens into a
   face, and the camera is pulled *through* it. It is one continuous move — no cut, no fade.
3. **The other world.** Five areas joined without loading screens: a fractured arrival plateau,
   a plaza with bridges, a ruined atrium, an eroded street and a cable-filled deep layer, with a
   monolith at the centre. Distance fog, real far geometry and a LOD skyline — no skybox image.
   Landmarks and light do the guiding; nothing tells you where to go.
4. **The console.** A broken terminal in the world opens it. The commands are fictional and the
   answers are in-fiction (`cat wake.log`, `scan`, `whoami`, …). One command ends the world.
5. **The collapse.** Input stops. The eye moves first, the head follows, the body leans last:
   look around, look down, follow the cracks. The floor gives way, debris falls with you, the
   fall is integrated (not animated), the bedroom comes up underneath, and you land on your feet
   with the momentum you left the world with. Control comes back.
6. **The return.** 03:47. The room is subtly wrong: a hairline crack in the plaster, four shards
   of the other world still hanging over the keyboard, the chair turned, a poster that now says
   the word. **Esc → 最初からやり直す** resets *everything* for a clean replay.

---

## Assets

All third-party assets are listed in `public/assets/credits.json`, which is the single source of
truth for the fetch script, the in-game credit screen and `CREDITS.md`. `npm run assets:verify`
fails if a file on disk is not in the credits, or a credit points at a missing file.

| what | source | license | count | size |
|---|---|---|---|---|
| models | Khronos glTF Sample Assets | CC0-1.0 (9) / CC-BY-4.0 (4) | 13 GLB | 26.2 MB |
| HDRIs | Poly Haven (mirrored in three.js) | CC0-1.0 | 2 | 3.1 MB |
| textures | ambientCG Ice002 (via three.js) | CC0-1.0 | 4 maps | 0.9 MB |
| PBR sets | generated by `scripts/gen-textures.mjs` | CC0-1.0 (original work) | 13 × 4 | 6.8 MB |
| audio | synthesised by `src/audio/AudioEngine.ts` | CC0-1.0 (original work) | — | 0 |

13 models, **615,793 triangles** in the source GLBs before instancing/LOD. The heaviest are
decimated where it matters (see `scripts/optimize-assets.mjs`); the rest are instanced
(`makeInstanced`) or merged (`mergeTransformed`) at build time.

**Conversion / optimisation pipeline** (all reproducible):

1. `fetch-assets.mjs` — sparse, blob-filtered clone of each source repo (only the exact paths in
   `scripts/assets.manifest.json` are transferred), reads each model's own `metadata.json` /
   `LICENSE.md` for authorship and licence, writes `public/assets/credits.json` and hashes every
   file into `assets-lock.json`.
2. `optimize-assets.mjs` — glTF-Transform: dedupe, prune, weld, join, texture resize and WebP
   encoding (`sharp`), output GLB. Records per-model triangles/bytes/bbox in `assets-report.json`.
3. `gen-textures.mjs` — generates the seamless PBR sets (albedo / normal / roughness / AO) that
   the level geometry is built from, so the world is not made of untextured primitives.
4. Everything is **1 unit = 1 metre, Y up, forward = −Z**, with model-specific scale/offset
   values measured from the converted GLBs (`assets-report.json`), not guessed.

The BSOD re-materialisation is deliberate: in the other world the models are re-tinted into the
palette (`world`, `world-dark`, `world-emissive`), lit only by the world's blue rig, and cut
apart / floated / flipped / buried so they read as fragments of the machine's memory. In the
bedroom they are ordinary furniture.

---

## Technical notes

### Rendering

`WebGLRenderer` (WebGL2, `powerPreference: high-performance`, `outputColorSpace: sRGB`,
`toneMapping: ACESFilmic`, HDR render targets) with a composer:

```
RenderPass  →  DofPass  →  GTAOPass (high preset)  →  UnrealBloom  →  BsodPass  →  OutputPass
                        ↳ depth-of-field uses the scene depth texture
```

- **PBR** everywhere (`MeshStandardMaterial` + generated normal/roughness/AO maps), one PMREM
  environment built from a real HDRI, plus a reflection probe captured in-world.
- **Depth of field** is a real pass (not a vignette): the intro tilt focuses on the monitor and
  walks the focal range while the room softens.
- **GTAO** (ground-truth ambient occlusion) on the high preset; SSAO-style darkening is baked
  into the AO maps on lower presets.
- **Volumetric-looking light**: additive light shafts, height haze, layered fog, and distance
  fog tuned per area; the far city is **real geometry** (instanced boxes at 170–520 m) with a
  distance LOD, never a skybox image.
- **Glitch is not only post-processing.** The BSOD pass (tear, chroma, scanline, grain,
  inversion, radial blur) is the last 20%: geometry is displaced in vertex stages (world
  corruption shader), UVs are block-snapped per material, emissive seams pulse out of sync, and
  lighting flickers at object level. The post pass is the polish on top.
- **Flash safety**: `Renderer.applyFlashSafety()` clamps luminance spikes and the shader's flash
  term to a maximum of 3 events per second, before tone mapping.

### World and collision

- Five areas (`src/world/areas/`) built once into one `Group`, joined by real decks with rails:
  arrival → plaza → (atrium | street → deep) → core. No loading screens; a player can walk the
  whole map continuously.
- Collision is a hashed AABB world (`src/core/Collision.ts`) with sub-stepped horizontal
  resolution (no tunnelling at dash speed), `supportAt` for floors and stairs, step-up, and
  per-solid tags for scripted removal (the floor that breaks).
- Every area is sealed with `closePerimeter()`, which emits **one continuous collision box per
  wall run** (0.42 m thick) minus the doors, so a dashing player cannot slip between slabs. The
  map integrity test flood-fills the real collision world with the real controller capsule
  (r 0.33, h 1.74, step 0.55, 0.4 m cells) and asserts: no step into nothing, no cell outside the
  footprint, and reachability of the monolith front, the atrium, the street and the deep layer.

### Audio

One `AudioEngine` (Web Audio) with a mastering chain (compressor → limiter → master gain), six
buses and three convolution spaces (room / world / void) built from synthesised impulse
responses. Room tone, fan, clock, distant traffic, footsteps per surface (wood, carpet,
concrete, metal, ice, tile, asphalt, rubble), impacts, cracks, debris, wind, heartbeat, breath
and every glitch burst are generated from oscillators and noise — no samples. HRTF emitters sit
on the world's lamps, monolith and terminals and fade in/out with the player's sector. Loudness
is managed at the bus level and ducked under cutscenes, so nothing clips or jumps.

### State machine and input

`src/game/Game.ts` owns `boot | title | room | zoom | bsod | swallow | tunnel | world | collapse |
landing | return | error`. Cutscenes are promises; input is blocked at the source
(`Input.block()`), pointer lock is released and re-acquired deliberately, and the console takes
focus with IME composition guarded (`isComposing`, `keyCode 229`, `compositionstart/end`) so
Japanese input never fires a game action or submits a half-composed command. Key repeat is
ignored for one-shot actions, `Esc` closes the console instead of pausing, and the forced
cutscenes can never leave the player locked out: `playLanding()` re-enables control in its `end`
callback, and every failure path goes to an explicit error phase with a readable crash screen.

---

## Performance

### What is in place for the 60 fps target (1080p, RTX 3050 / GTX 1660 / M1 class)

- one shader program per material family, materials cached and shared;
- instancing for repeated props, merged geometry for static clusters, decimated GLBs;
- **real LOD**: area groups and their lights are toggled by distance, `setDetailed()` streams
  heavy props only when the player is close, the far city is a separate instanced LOD;
- distance fog tuned to hide the streaming boundary;
- dynamic resolution scale driven by frame time (with a floor), and quality presets that
  change shadow map size, AO, resolution and detail density;
- shadow budget: one shadow-casting directional light for the world, a 512² shadow map for the
  flashlight, and shadows disabled entirely on the low preset;
- post stack runs at the render resolution, with the AO pass only on `high`;
- a single renderer and a single scene for the entire game (no per-area render targets, no
  texture streaming stalls), so the transitions have nothing to load.

### Measured numbers

| metric | value | how |
|---|---|---|
| production bundle | **353 kB gzip** (1,166 kB raw JS + 3.6 kB CSS) | `npm run build` |
| build time | 3.6 s, 52 modules | `npm run build` |
| shipped assets | 36 MB, 13 GLB + 56 textures + 2 HDRIs | `du -sh public/assets` |
| source triangles | 615,793 before instancing | `assets-report.json` |

**Average fps and 1% low were NOT measured on this machine.** The build environment has no
GPU, no WebGL and no browser (Chromium/Playwright downloads are blocked), so there is nothing to
render a frame on. Rather than invent numbers, here is exactly how to get them:

1. run `npm run dev`, open the experience, press **F3**;
2. play for ~3 minutes covering the room, the swallow, the tunnel, each world area, the collapse
   and the landing (the transitions are the worst case — the tunnel is the heaviest scene);
3. the overlay reports **average fps**, **1% low**, frame ms, draw calls, triangles and the
   current dynamic resolution scale. Put those numbers in the table above.

What *is* verified without a GPU: the render path compiles (all shaders are parsed by
`@shaderfrog/glsl-parser` in `tests/shaders.test.ts`), the world and the bedroom build without
throwing (`tests/world.test.ts`, `tests/room.test.ts`), the collision world is walkable
end-to-end and escape-proof, and the production bundle builds clean.

---

## Verification status

| check | result |
|---|---|
| `npx tsc --noEmit` | 0 errors (strict) |
| `npx vitest run` | **62 / 62 passing** in 9 files |
| `npx vite build` | clean, 353 kB gzip |
| `node scripts/verify-assets.mjs` | 23 / 23 checks (licences, files, hashes) |
| map integrity (real controller flood fill) | 123k states reached, 0 escapes, 0 cells outside the map, all four landmarks reachable |
| shaders parse as GLSL | BSOD pass, DOF pass, world corruption — yes |
| rendered frames / screenshots | **not possible here — no WebGL** |

### Known limits and unverified things (honest list)

- **No browser was available during development**, so the game has never been *seen* running.
  Type-checking, 56 tests, a headless build of the bedroom and the whole world, and the asset
  pipeline all pass, but visual composition, lighting balance and the feel of the camera moves
  are unverified polish. Treat the first playthrough as a review pass.
- **fps / 1% low are unmeasured** (see above).
- The bedroom and the world are separate coordinate spaces (the world floats at y = 120); the
  fall blends them by moving the camera down through the world and revealing the room
  underneath. It is continuous, but the "hole" you fall through is the broken core platform, not
  a portal seen from the bedroom side.
- Some assets are still heavier than ideal (`CommercialRefrigerator` 208k tris, `ToyCar` 109k,
  `FlightHelmet` 95k). They are placed once each and shadow-culled, but decimating them further
  is the first lever if a weaker GPU dips.
- The console supports a fixed command vocabulary; it never states the answer, and unknown input
  always gets an in-fiction error.
- Mobile is not a target. The layout and the settings assume a desktop mouse.
- In an embedded frame without pointer-lock permission the game falls back to lock-free mouse
  look (the cursor stays visible over the viewport); a native window gets real pointer lock.

---

## Repository map

```
index.html                 DOM shell (title, HUD, BSOD overlay, console, menu, credits)
src/main.ts                boot, frame loop, crash screen
src/game/Game.ts           phase machine, interaction, console/menu glue, replays
src/game/Cinematics.ts     zoom, swallow, tunnel, collapse, landing (no fades anywhere)
src/core/                  Renderer (post stack) · Player · Collision · Input · Settings · math
src/world/                 Room · World · Tunnel · worldkit helpers · areas/{Arrival,Plaza,Atrium,Street,Deep,Core}
src/assets/                MODELS + AssetStore (GLB/HDR/texture) · MaterialLibrary
src/audio/AudioEngine.ts   Web Audio: buses, spaces, ambience, footsteps, glitch, HRTF emitters
src/narrative/Console.ts   the in-world console and its fiction
src/ui/                    Ui.ts (all overlays) + style.css
scripts/                   fetch / optimize / verify / textures / credits
public/assets/             models, env, textures, credits.json, assets-lock.json, assets-report.json
tests/                     9 files, 62 tests (collision, input, settings, console, cinematics, ui, shaders, world, room)
```

## Credits

Third-party models, HDRIs and textures, their authors, licences, sources, the exact use of each
asset and the modifications applied: **[CREDITS.md](CREDITS.md)** — also in-game under
**Esc → アセット クレジット**. All audio, all textures generated by `scripts/gen-textures.mjs`,
and all level geometry, shaders, UI and code are original work from this project.
