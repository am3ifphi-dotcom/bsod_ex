# CREDITS

BSOD_EX uses the following third-party assets. Many thanks to their creators.

## 3D models

### Room & props (this repository / Google Drive assets)
- `modern_stylized_bedroom.glb` — stylized bedroom scene (Sketchfab community asset, used as provided)
- `crt_computer_monitor.glb` — "CRT Computer Monitor" (Sketchfab community asset)
- `gaming_desktop_pc.glb` — "Gaming Desktop PC" (Sketchfab community asset)
- `office_chair.glb` — "Office Chair" (Sketchfab community asset)
- `motherboard.glb` — motherboard (Sketchfab community asset)
- `data_center_server_rack.glb` — "Data Center Server Rack" (Sketchfab community asset)
- `cray-1_supercomputer.glb` — Cray-1 supercomputer (Sketchfab community asset)
- `modular_cables_1m.glb` — modular cables (Sketchfab community asset)
- `alarm_clock_01_1k.blend.zip`, `desk_lamp_arm_01_1k.blend.zip`, `rough_concrete_1k.blend.zip`
  — texture/material reference packs (CC0-style asset packs, e.g. ambientCG-style distribution)

All GLBs are re-exported at runtime-friendly sizes with `@gltf-transform` (meshopt compression + WebP textures).
Attribution for individual Sketchfab files follows the licenses under which they were originally uploaded
(most are CC-BY / CC0); see the original model pages for exact terms.

## Audio (SE / BGM)

### tgstation sound pack — https://github.com/tgstation/tgstation
Game audio (ambience loops, machine/UI beeps, terminal sounds, horror stingers, portal/teleport FX,
glass & impact FX, wind, rumble, footsteps, music stingers) sampled from the /tg/station sound library.
/tg/station assets are licensed **CC BY-SA 3.0** unless otherwise noted in
`sound/attributions.txt`. Files used (renamed for this project) include ambience/engineering,
ambience/space, ambience/earth_rumble, effects (portal, glass, sparks, hallucinations, bodyfall,
explosion, dimensional_rend, clockcult), machines (beep, terminal, buzz, chime), items (click),
music (heretic/VoidsEmbrace, bloodcult, creepalert, malf), and footsteps.

### Kenney UI Audio — https://github.com/Calinou/kenney-ui-audio (mirroring https://kenney.nl)
UI click / hover / switch sounds (`ui_click.wav`, `ui_click2.wav`, `ui_hover.wav`, `ui_switch.wav`).
**CC0 1.0** — Copyright © 2020 Kenney.

## Software

- three.js — https://github.com/mrdoob/three.js (MIT), vendored under `web/vendor/three`
- @gltf-transform — https://gltf-transform.dev (MIT), used offline for asset optimization

## Original work

All code in `web/js/`, the BSOD face-morph rendering, the world design, cinematics, and the
console fiction are original work for this project.
