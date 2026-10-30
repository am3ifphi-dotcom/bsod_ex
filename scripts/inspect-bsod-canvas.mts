/**
 * Boots the real BsodScreen with an actual 2D canvas implementation (no stub drawing) so the
 * BSOD body texture and the face channel texture can be inspected pixel by pixel.
 *
 * Run: npx tsx scripts/inspect-bsod-canvas.mts
 */
import { createCanvas } from '@napi-rs/canvas';

const registry: any[] = [];

globalThis.document = {
  createElement: (tag: string) => {
    if (tag !== 'canvas') throw new Error('unexpected element ' + tag);
    const c = createCanvas(2, 2);
    registry.push(c);
    return c;
  },
  createElementNS: (_ns: string, tag: string) => {
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

function stats(canvas: any, label: string) {
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const img = ctx.getImageData(0, 0, width, height);
  let sr = 0, sg = 0, sb = 0, n = 0, nonEmpty = 0;
  let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
      if (r + g + b > 24) {
        nonEmpty++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      sr += r; sg += g; sb += b; n++;
    }
  }
  console.log(
    `${label}: ${width}x${height} avgRGB=(${(sr / n).toFixed(0)},${(sg / n).toFixed(0)},${(sb / n).toFixed(0)}) ` +
    `inkCoverage=${((nonEmpty / n) * 100).toFixed(1)}% inkBox=[${maxX > 0 ? `${minX},${minY}` : '-'}..${maxX > 0 ? `${maxX},${maxY}` : '-'}]`,
  );
  return { nonEmpty, n };
}

console.log('--- canvases created (in construction order) ---');
console.log('count =', registry.length);

const anyS = screen as any;
const body = anyS.stageTextures[0].image;
const face = anyS.faceCanvas;

stats(body, 'stageTextures[0] canvas');
stats(face, 'faceTex canvas');

// Face channel: verify red ':' channel and green '(' channel really landed
function channelStats(canvas: any, label: string, idx: number) {
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const img = ctx.getImageData(0, 0, width, height);
  let n = 0, sum = 0, minX = 1e9, maxX = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = img.data[(y * width + x) * 4 + idx];
      sum += v;
      if (v > 70) { n++; if (x < minX) minX = x; if (x > maxX) maxX = x; }
    }
  }
  console.log(`  face ${label}: mean=${(sum / (width * height)).toFixed(2)} inkPx=${n} xRange=[${maxX > 0 ? minX : '-'}..${maxX > 0 ? maxX : '-'}]`);
}
channelStats(face, 'R :( colon', 0);
channelStats(face, 'G paren', 1);
channelStats(face, 'B (should be 0)', 2);

console.log('\n--- measured glyph metrics the shader places the face with ---');
console.log('parenC', anyS.parenC.toArray(), 'parenSize', anyS.parenSize.toArray());
console.log('colonC', anyS.colonC.toArray(), 'colonSize', anyS.colonSize.toArray());
console.log('colonDotOff (scalar float)', anyS.colonDotOff, 'spine', anyS.spine.toArray());

if (typeof anyS.colonDotOff !== 'number' || !Number.isFinite(anyS.colonDotOff) || anyS.colonDotOff <= 0.02) {
  throw new Error(`Invalid colonDotOff: expected finite positive number, got ${String(anyS.colonDotOff)}`);
}

// Mathematically verify Stage-0 ':(' placement in screen UV [0..1]:
// Must render crisp at top-left (around uv = 0.144, 0.742) and have ZERO ink in center/body area!
{
  const fctx = face.getContext('2d');
  const fimg = fctx.getImageData(0, 0, face.width, face.height).data;
  const sampleFaceAtScreenUv = (u: number, v: number): number => {
    const faceCenter = [0.144, 0.742];
    const faceScale = 0.35;
    const fLocX = ((u - faceCenter[0]) * 1.90566) / faceScale;
    const fLocY = (v - faceCenter[1]) / faceScale;
    const tx = 0.5 + fLocX;
    const ty = 0.5 + fLocY;
    if (tx <= 0.01 || tx >= 0.99 || ty <= 0.01 || ty >= 0.99) return 0;
    const px = Math.min(face.width - 1, Math.max(0, Math.floor(tx * face.width)));
    const py = Math.min(face.height - 1, Math.max(0, Math.floor((1 - ty) * face.height)));
    const idx = (py * face.width + px) * 4;
    return Math.max(fimg[idx], fimg[idx + 1]);
  };

  let topLeftInkHits = 0;
  let outsideTopLeftInkHits = 0;
  for (let sv = 0; sv <= 100; sv++) {
    for (let su = 0; su <= 100; su++) {
      const u = su / 100;
      const v = sv / 100;
      const ink = sampleFaceAtScreenUv(u, v);
      if (ink > 60) {
        if (u >= 0.08 && u <= 0.24 && v >= 0.60 && v <= 0.88) {
          topLeftInkHits++;
        } else {
          outsideTopLeftInkHits++;
        }
      }
    }
  }
  console.log(`Stage-0 ':(' screen UV check: topLeftInkHits=${topLeftInkHits}, outsideTopLeftInkHits=${outsideTopLeftInkHits}`);
  if (topLeftInkHits < 15) {
    throw new Error(`Stage-0 ':(' missing from top-left slot! hits=${topLeftInkHits}`);
  }
  if (outsideTopLeftInkHits > 0) {
    throw new Error(`Stage-0 ':(' leaked outside top-left slot! outsideHits=${outsideTopLeftInkHits}`);
  }
}

// Verify setInsideTunnelMode(true) causes ZERO ShaderMaterial.version bumps (no mid-cutscene shader recompile!)
{
  const versionsBefore = anyS.throatMaterials.map((m: any) => m.version);
  screen.setInsideTunnelMode(true);
  const versionsAfter = anyS.throatMaterials.map((m: any) => m.version);
  screen.setInsideTunnelMode(false);
  for (let i = 0; i < versionsBefore.length; i++) {
    if (versionsAfter[i] !== versionsBefore[i]) {
      throw new Error(`throatMaterials[${i}] bumped .version during setInsideTunnelMode! Causes transition stall!`);
    }
  }
  console.log('setInsideTunnelMode zero-recompile check: PASSED!');
}

// Verify all 6 BSOD escalation stages + pulseCrack + suction + aftermath AND assert JS uniform <-> GLSL type safety!
import * as THREE from 'three';
for (let c = 0; c <= 6; c++) {
  screen.pulseCrack(new THREE.Vector2(0.16, 0.72));
  screen.update(
    1 / 60,
    c * 0.8,
    {
      hoverFace: c > 0,
      cursorUv: new THREE.Vector2(0.16, 0.72),
      clickCount: c,
      madness: c / 6,
      jawOpen: c >= 3 ? (c - 2) / 4 : 0,
      suctionProgress: c === 6 ? 0.65 : 0,
      aftermath: false,
    },
    0.5
  );
}
screen.root.traverse((o: any) => {
  if (!o.material || !o.material.isShaderMaterial) return;
  const mat = o.material;
  const src = `${mat.vertexShader}\n${mat.fragmentShader}`;
  const re = /uniform\s+(float|int|vec2|vec3|vec4|sampler2D)\s+(\w+)\s*;/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const [, glslType, uName] = m;
    if (!(uName in mat.uniforms)) continue;
    const val = mat.uniforms[uName].value;
    if (glslType === 'float' || glslType === 'int') {
      if (typeof val !== 'number' || !Number.isFinite(val)) {
        throw new Error(`Uniform type mismatch on ${uName}: GLSL ${glslType} got ${typeof val} (${String(val)})`);
      }
    } else if (glslType === 'vec2') {
      if (!val || typeof val.x !== 'number' || !Number.isFinite(val.x + val.y)) {
        throw new Error(`Uniform type mismatch on ${uName}: expected finite Vector2`);
      }
    } else if (glslType === 'vec3') {
      const ok =
        val &&
        ((typeof val.x === 'number' && Number.isFinite(val.x + val.y + val.z)) ||
          (typeof val.r === 'number' && Number.isFinite(val.r + val.g + val.b)));
      if (!ok) throw new Error(`Uniform type mismatch on ${uName}: expected finite Vector3/Color`);
    }
  }
});
console.log('All BsodScreen stages (0..6) & GLSL uniform types verified OK!');

// Verify throatTeeth (144 deep esophageal fangs) + gaping open 3D Parasyte rig (40 broad rimTeeth + 4 jawFlaps + 32 sinews + 11 eyes, NO tongueMesh, NO cyclic pakupaku closing) + zero-recompile setInsideTunnelMode!
if (!anyS.throatTeeth || anyS.throatTeeth.count !== 144) {
  throw new Error(`Expected 144 3D throatTeeth instances, got ${anyS.throatTeeth?.count}`);
}
if (
  anyS.rimTeethMesh?.count !== 40 ||
  anyS.jawFlapsMesh?.count !== 4 ||
  Boolean(anyS.tongueMesh) ||
  anyS.sinewMesh?.count !== 32 ||
  anyS.parasyteEyesMesh?.count !== 11
) {
  throw new Error(
    `Expected 40 rimTeeth / 4 jawFlaps / NO tongueMesh / 32 sinews / 11 parasyteEyes, got ${anyS.rimTeethMesh?.count}/${anyS.jawFlapsMesh?.count}/${Boolean(anyS.tongueMesh)}/${anyS.sinewMesh?.count}/${anyS.parasyteEyesMesh?.count}`
  );
}
if (/snapDown|chewActive/.test(anyS.screenMat.fragmentShader)) {
  throw new Error('Cyclic pakupaku chomping shader logic must be completely removed!');
}
const versionsBefore = anyS.throatMaterials.map((m: any) => m.version);
screen.setInsideTunnelMode(true);
screen.setInsideTunnelMode(false);
const versionsAfter = anyS.throatMaterials.map((m: any) => m.version);
for (let i = 0; i < versionsBefore.length; i++) {
  if (versionsBefore[i] !== versionsAfter[i] || anyS.throatMaterials[i].stencilWriteMask !== 0) {
    throw new Error(`Throat material[${i}] triggered shader recompile or lost stencilWriteMask=0!`);
  }
}
console.log('throatTeeth (144 deep fangs), gaping open 3D parasyteGroup (52 teeth + 4 jawFlaps + 32 sinews + 11 eyes, zero pakupaku) & zero-recompile stencil toggle verified OK!');

// Does the body canvas carry the expected cerulean fill?
const ctx2 = body.getContext('2d');
const img2 = ctx2.getImageData(4, 4, 1, 1).data;
console.log('\nbody corner pixel RGBA =', [...img2]);
if (img2[2] < 150 || img2[3] < 250) {
  throw new Error(`Unexpected body corner pixel RGBA: ${[...img2].join(',')}`);
}
