/**
 * Boots the real BsodScreen with an actual 2D canvas implementation (no stubs)
 * and verifies the *dramaturgy* of the new act, pixel by pixel:
 *
 *   - stages 0 and 1 are byte-identical (the deliberate pause)
 *   - stage 2 changes ONE word, stage 3 changes ONE glyph, stage 4 changes
 *     ONE stop code + a reflection — all within a tiny ink budget
 *   - stage 5 is a blackout (the panel simply switches off)
 *   - there is no anatomical geometry anywhere in the scene graph
 *   - the page conduit appears only during the transfer, never during inspection
 *   - uniform types are valid and setInsideTunnelMode never recompiles shaders
 *
 * Run: npm run test:canvas
 */
import { createCanvas } from '@napi-rs/canvas';
import * as THREE from 'three';

const registry: any[] = [];

globalThis.document = {
  createElement: (tag: string) => {
    if (tag !== 'canvas') throw new Error('unexpected element ' + tag);
    const c = createCanvas(2, 2);
    registry.push(c);
    return c;
  },
  createElementNS: (_ns: string, _tag: string) => {
    const c = createCanvas(2, 2);
    registry.push(c);
    return c;
  },
  addEventListener() {},
  body: { appendChild() {}, style: {} },
  documentElement: { style: {} },
  hidden: false,
} as any;

globalThis.window = {
  innerWidth: 1280,
  innerHeight: 720,
  devicePixelRatio: 1,
  addEventListener() {},
  removeEventListener() {},
} as any;

globalThis.self = globalThis as any;

const { BsodScreen } = await import('../src/world/BsodScreen.ts');
const screen = new BsodScreen();
const anyS = screen as any;

const stageCanvases: any[] = anyS.stageTextures.map((t: THREE.CanvasTexture) => t.image);
const aftermathCanvas: any = anyS.aftermathTex.image;

function pixels(canvas: any): Uint8ClampedArray {
  return canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
}

function diff(a: Uint8ClampedArray, b: Uint8ClampedArray, step = 1): { changed: number; total: number; meanLumA: number; meanLumB: number } {
  const w = stageCanvases[0].width;
  const h = stageCanvases[0].height;
  let changed = 0, total = 0, la = 0, lb = 0;
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const i = (y * w + x) * 4;
      total++;
      const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
      if (d > 12) changed++;
      la += (a[i] + a[i + 1] + a[i + 2]) / 3;
      lb += (b[i] + b[i + 1] + b[i + 2]) / 3;
    }
  }
  return { changed, total, meanLumA: la / total, meanLumB: lb / total };
}

const px = stageCanvases.map(pixels);
console.log('--- BSOD stage ink budget (the whole point of the rewrite) ---');

// 1. Authentic cerulean.
const corner = [...px[0].slice(0, 4)];
console.log('stage 0 corner RGBA =', corner);
if (corner[2] < 150 || corner[3] < 250 || corner[0] > 20) {
  throw new Error(`Stage 0 is not an authentic #0078D7 stop screen: ${corner.join(',')}`);
}

// 2. Stages 0 and 1 must be IDENTICAL. This is the beat that makes you doubt stage 0.
const identical = diff(px[0], px[1]);
console.log(`stage 0 -> 1 : ${identical.changed}/${identical.total} changed pixels`);
if (identical.changed !== 0) {
  throw new Error(`Stage 1 must be byte-identical to stage 0 (got ${identical.changed} changed pixels)`);
}

// 3. Each subsequent stage may only change a handful of glyphs.
const budgets = [0.012, 0.012, 0.045]; // stage 2, 3, 4 as a fraction of sampled pixels
for (let s = 2; s <= 4; s++) {
  const d = diff(px[s - 1], px[s], 2);
  const frac = d.changed / d.total;
  console.log(`stage ${s - 1} -> ${s} : ${(frac * 100).toFixed(2)}% of sampled pixels changed`);
  if (frac > budgets[s - 2]) {
    throw new Error(`Stage ${s} changed too much of the panel (${(frac * 100).toFixed(2)}%). The screen must barely move.`);
  }
}

// 4. Stage 5 is a blackout, not a monster.
const blackout = diff(px[0], px[5], 4);
console.log(`stage 5 mean luminance: ${blackout.meanLumB.toFixed(1)} vs stage 0 ${blackout.meanLumA.toFixed(1)}`);
if (blackout.meanLumB > blackout.meanLumA * 0.08) {
  throw new Error('Stage 5 must be a near-black panel, not another decorated image.');
}
const aftermathLum = diff(px[0], pixels(aftermathCanvas), 4).meanLumB;
if (aftermathLum > blackout.meanLumA * 0.18) {
  throw new Error('The aftermath panel should stay dark.');
}

// 5. No anatomy anywhere. Not hidden — absent from the scene graph.
let anatomy = 0;
screen.root.traverse((o: any) => {
  if (o === anyS.throatTeeth || o === anyS.parasyteGroup) anatomy++;
  if (/tooth|jaw|eye|sinew|gum|gullet/i.test(o.name || '')) anatomy++;
});
console.log('anatomical objects in scene graph:', anatomy);
if (anatomy !== 0) {
  throw new Error('Anatomical meshes must not be part of the screen at all.');
}
if (anyS.parasyteGroup.children.length !== 0) {
  throw new Error('Legacy parasyte group still holds children.');
}

// 6. The gaze hitbox is a real ellipse over the ':(' in the top-left.
if (!screen.isUvOnFace(new THREE.Vector2(0.144, 0.742))) {
  throw new Error('The ":(" gaze region must be hittable at (0.144, 0.742).');
}
if (screen.isUvOnFace(new THREE.Vector2(0.5, 0.5))) {
  throw new Error('The centre of the panel must NOT count as staring at the face.');
}

// 7. setInsideTunnelMode must never bump a ShaderMaterial version.
const mats: THREE.ShaderMaterial[] = [screen.screenMat, anyS.tubeMat, anyS.pageMat];
const versionsBefore = mats.map((m) => m.version);
screen.setInsideTunnelMode(true);
screen.setInsideTunnelMode(false);
const versionsAfter = mats.map((m) => m.version);
if (versionsBefore.some((v, i) => v !== versionsAfter[i])) {
  throw new Error('setInsideTunnelMode triggered a shader recompile.');
}
console.log('setInsideTunnelMode zero-recompile check: PASSED');

// 8. Drive every stage, verify the page conduit appears ONLY during transfer,
//    and validate every declared uniform against its JS value.
const state = (stage: number, suction: number, aftermath = false) => ({
  hoverFace: stage % 2 === 1,
  cursorUv: new THREE.Vector2(0.144, 0.742),
  clickCount: stage,
  madness: stage / 8,
  jawOpen: stage >= 5 ? 1 : 0,
  suctionProgress: suction,
  aftermath,
});

for (let c = 0; c <= 5; c++) {
  if (c === 3) screen.pulseCrack(new THREE.Vector2(0.16, 0.72));
  screen.update(1 / 60, c * 0.9, state(c, 0), 0.4, c * 12);
  if (anyS.throatGroup.visible) {
    throw new Error(`Page conduit leaked into inspection stage ${c}.`);
  }
  if (anyS.parasyteGroup.visible || anyS.throatTeeth.visible) {
    throw new Error('Anatomical meshes became visible during inspection.');
  }
}
screen.update(1 / 60, 6, state(5, 0.55), 0, 90);
if (!anyS.throatGroup.visible) {
  throw new Error('The infinite page stack must open during the transfer.');
}
screen.update(1 / 60, 7, state(0, 0, true), 0, 96);
if (anyS.throatGroup.visible) {
  throw new Error('The conduit must be gone in the aftermath.');
}

screen.root.traverse((o: any) => {
  const mat = o.material;
  if (!mat || !mat.isShaderMaterial) return;
  const src = `${mat.vertexShader}\n${mat.fragmentShader}`;
  const re = /uniform\s+(float|int|vec2|vec3|vec4|sampler2D)\s+(\w+)\s*;/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const [, glslType, uName] = m;
    if (!(uName in mat.uniforms)) continue;
    const val = mat.uniforms[uName].value;
    if ((glslType === 'float' || glslType === 'int') && (typeof val !== 'number' || !Number.isFinite(val))) {
      throw new Error(`Uniform ${uName}: GLSL ${glslType} got ${typeof val} (${String(val)})`);
    }
    if (glslType === 'vec2' && (!val || !Number.isFinite(val.x + val.y))) {
      throw new Error(`Uniform ${uName}: expected a finite Vector2`);
    }
    if (glslType === 'vec3' && !(val && Number.isFinite(val.x + val.y + val.z))) {
      throw new Error(`Uniform ${uName}: expected a finite Vector3/Color`);
    }
  }
});

// 9. All pre-baked textures must be real, uploadable textures.
const textures: THREE.Texture[] = screen.getAllTextures();
if (textures.length < 8 || textures.some((t) => !t || !t.image)) {
  throw new Error('Missing pre-baked textures for GPU warm-up.');
}

console.log('\nBSOD CANVAS VERIFICATION PASSED — the screen stays authentic, then disagrees one glyph at a time.');
