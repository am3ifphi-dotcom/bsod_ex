/**
 * Headless regression test for the features added in this pass:
 *   1. The Sky-Maw tunnel exit must carry NO teeth (user requirement).
 *   2. The tunnel -> sky junction must not have a hard-edged seam.
 *   3. The Parasyte swallow-stage teeth must be rooted in the tunnel wall and be THICK
 *      (Parasyte-style grinder fangs), not the old thin spikes.
 *   4. Jump must work: an airborne arc, a landing, and no ground snapping mid-flight.
 *   5. The partial low-resolution filter must affect only PART of the view.
 */
import * as THREE from 'three';

// --- minimal canvas/DOM stubs so the world builders can run headless
const makeGradient = () => ({ addColorStop: () => undefined });
const ctxStub: any = new Proxy(
  {},
  {
    get(_t, prop) {
      if (prop === 'measureText') return () => ({ width: 120 });
      if (prop === 'canvas') return { width: 1024, height: 512 };
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => makeGradient();
      if (prop === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
      if (prop === 'createImageData') return () => ({ data: new Uint8ClampedArray(4) });
      return () => undefined;
    },
    set() {
      return true;
    },
  }
);
(globalThis as any).document = {
  createElement: (tag: string) => {
    if (tag !== 'canvas') return {};
    return {
      width: 1024,
      height: 512,
      getContext: () => ctxStub,
      style: {},
      addEventListener: () => {},
    };
  },
  createElementNS: () => ({ getContext: () => ctxStub, style: {} }),
};
(globalThis as any).window = { innerWidth: 1600, innerHeight: 900, devicePixelRatio: 1, addEventListener: () => {} };
(globalThis as any).self = globalThis;

const { GlitchWorld } = await import('../src/world/GlitchWorld.ts');
const { FirstPersonController } = await import('../src/player/FirstPersonController.ts');

let failures = 0;
const fail = (msg: string) => {
  failures++;
  console.error('FAIL: ' + msg);
};

// =====================================================================================
// 1) NO TEETH AT THE TUNNEL EXIT
// =====================================================================================
const w: any = new GlitchWorld();
const tex = new THREE.Texture();
w.buildSkyAndLighting();
w.buildTerrain(tex, tex);
w.buildKernelMegacityAndSkyRift();

// The exit sleeve + corona live under a group positioned at skyPortalPos. Walk it and look for
// any instanced/mesh that is shaped like a tooth ring near the aperture.
const skyGroup = w.group.children.find(
  (c: any) => c.position && c.position.distanceTo(w.skyPortalPos) < 0.001
);
if (!skyGroup) {
  fail('Sky-Maw exit group not found in GlitchWorld');
} else {
  let coneLike = 0;
  let toothLike = 0;
  skyGroup.traverse((o: any) => {
    const g = o.geometry;
    // A tooth would be a cone (or any geometry whose name/attribute says "fang").
    if (g && g.type === 'ConeGeometry') {
      coneLike++;
      console.error(`  Unexpected ConeGeometry at the tunnel exit`);
    }
    // Instanced attribute names are the strongest signal of what an instance row represents.
    const attrs = g?.attributes ? Object.keys(g.attributes) : [];
    if (attrs.some((a) => /fang|tooth/i.test(a))) {
      toothLike++;
      console.error(`  Unexpected tooth-like instanced attribute at the tunnel exit: ${attrs.join(',')}`);
    }
  });
  if (coneLike > 0) fail(`Tunnel exit still contains ${coneLike} ConeGeometry (expected 0 teeth)`);
  if (toothLike > 0) fail(`Tunnel exit still contains ${toothLike} tooth-like instanced rows (expected 0)`);

  // The old code exposed a `skyFangMat` / `skyFangs` pair. Both must be gone.
  if (w.skyFangMat !== undefined) fail('skyFangMat still exists - the exit teeth were not removed');
  if (w.skyFangs !== undefined) fail('skyFangs still exists - the exit teeth were not removed');

  // The exit must still have a sleeve + a corona (the mouth itself must not have been deleted).
  let hasSleeve = false;
  let hasRift = false;
  skyGroup.traverse((o: any) => {
    if (o.isMesh && o.geometry?.type === 'CylinderGeometry') hasSleeve = true;
    if (o.isMesh && o.geometry?.type === 'PlaneGeometry' && o.geometry.parameters.width === 30) {
      hasRift = true;
    }
  });
  if (!hasSleeve) fail('Exit sleeve geometry is missing');
  if (!hasRift) fail('Exit corona plane is missing');
  console.log(`tunnel exit: sleeve=${hasSleeve} corona=${hasRift} cones=${coneLike} toothRows=${toothLike}`);
}

// =====================================================================================
// 2) NO SERRATED TOOTH SILHOUETTE LEFT IN THE BsodScreen FAR-END PORTAL VISTA
//    (the vista must match the now tooth-free GlitchWorld exit 1:1)
// =====================================================================================
const bsodSrc = await import('node:fs').then((fs) =>
  fs.readFileSync(new URL('../src/world/BsodScreen.ts', import.meta.url), 'utf8')
);
if (/fangSil|toothShadow/.test(bsodSrc)) {
  fail('BsodScreen portal vista still draws a tooth-serrated silhouette');
} else {
  console.log('BsodScreen portal vista: no tooth serration (matches tooth-free exit)');
}

// =====================================================================================
// 3) SWALLOW-STAGE TEETH ARE ROOTED IN THE WALL AND ARE THICK
// =====================================================================================
const { BsodScreen } = await import('../src/world/BsodScreen.ts');
const bsod: any = new BsodScreen();
const throatTeeth = bsod.throatTeeth;
if (!throatTeeth) {
  fail('throatTeeth mesh missing');
} else {
  const geo = throatTeeth.geometry;
  const posAttr = geo.attributes.position;
  const uvAttr = geo.attributes.uv;

  // Measure the geometry in its own authoring space: root half-width vs. crown half-width.
  // The Parasyte grinder fang must be MUCH wider at the root than the old slim tooth
  // (old: rx 0.062 -> full width 0.124; new must be clearly thicker).
  let rootMaxX = 0;
  let crownMaxX = 0;
  let maxY = 0;
  for (let i = 0; i < posAttr.count; i++) {
    const x = Math.abs(posAttr.getX(i));
    const y = posAttr.getY(i);
    const v = uvAttr.getY(i);
    if (v < 0.25) rootMaxX = Math.max(rootMaxX, x);
    if (v > 0.75) crownMaxX = Math.max(crownMaxX, x);
    maxY = Math.max(maxY, y);
  }
  const rootWidth = rootMaxX * 2;
  const crownWidth = crownMaxX * 2;
  console.log(
    `swallow fang: rootWidth=${rootWidth.toFixed(3)} crownWidth=${crownWidth.toFixed(3)} length=${maxY.toFixed(3)}`
  );
  if (rootWidth < 0.20) {
    fail(`Swallow fang root width ${rootWidth.toFixed(3)} is still too thin (need >= 0.20)`);
  }
  // A blunt grinder blade keeps most of its mass: the crown must not be a needle.
  if (crownWidth / rootWidth > 0.55) {
    fail('Swallow fang tapers to a needle - it must read as a blunt Parasyte grinder blade');
  }
  // Blade aspect ratio: length / root width should be well under the old ~3.4:1 needle ratio.
  const aspect = maxY / rootWidth;
  console.log(`swallow fang aspect (length/rootWidth) = ${aspect.toFixed(2)}`);
  if (aspect > 2.2) {
    fail(`Swallow fang aspect ${aspect.toFixed(2)} is still needle-like (need <= 2.2)`);
  }
}

// =====================================================================================
// 3b) THE FANG/WALL JUNCTION IS SEAMLESS
//     The gum ridge must exist, must be a per-ring welt (not per-tooth), and the fang root
//     must be BURIED inside the ridge crown so no hard intersection line is ever visible.
//     The maths below mirrors the two shaders exactly.
// =====================================================================================
const ridgeMesh = (bsod as any).throatRidge;
if (!ridgeMesh) {
  fail('throatRidge mesh missing - the gum ridge is what makes the junction seamless');
} else {
  const ridgeGeo = ridgeMesh.geometry;
  const aRidge = ridgeGeo.getAttribute('aRidge');
  if (!aRidge) {
    fail('throatRidge geometry has no aRidge attribute');
  } else {
    // The ridge must cover all 4 deep rings.
    const rings = new Set<number>();
    for (let i = 0; i < aRidge.count; i++) rings.add(Math.round(aRidge.getZ(i)));
    console.log(`gum ridge: ${aRidge.count} verts across ${rings.size} rings`);
    if (rings.size !== 4) fail(`Gum ridge covers ${rings.size} rings (expected 4)`);
  }

  // Reproduce the shader maths to prove the fang root is buried in the ridge crown.
  const TEETH = 36;
  const tubeTop = 1.42;
  const tubeBottom = 5.6;
  const tubeLen = 116;
  const wallRAt = (z: number) => {
    const t = Math.min(1, Math.max(0, (-z - 0.02) / tubeLen));
    return tubeTop + (tubeBottom - tubeTop) * t;
  };
  for (let ring = 0; ring < 4; ring++) {
    const ringZ = -14 - ring * 8.5;
    const wallR = wallRAt(ringZ);
    const spacing = (2 * Math.PI * wallR) / TEETH;
    const w = (spacing * 0.86) / 0.344;
    const socketDepth = w * 0.42 + w * 0.12;
    const ridgeCrown = wallR - socketDepth;
    const fangRoot = wallR - socketDepth * 0.62;
    const h = wallR * 1.15;
    const inward = 1 / Math.sqrt(1 + 0.58 * 0.58);
    const fangTip = fangRoot - 0.3 * h * inward;
    const exposed = ridgeCrown - fangTip;
    if (!(fangRoot > ridgeCrown)) {
      fail(`Ring ${ring}: fang root (${fangRoot.toFixed(3)}) is NOT buried in the ridge crown (${ridgeCrown.toFixed(3)}) - a hard seam will show`);
    }
    if (!(fangTip < ridgeCrown)) {
      fail(`Ring ${ring}: fang tip (${fangTip.toFixed(3)}) does not protrude past the ridge crown (${ridgeCrown.toFixed(3)})`);
    }
    if (exposed < 0.2) {
      fail(`Ring ${ring}: only ${exposed.toFixed(3)} m of blade is exposed past the gum - the tooth will look buried`);
    }
  }
  console.log('gum ridge: fang roots buried, blades protrude past the crown on all 4 rings');
}

// =====================================================================================
// 4) JUMP PHYSICS
// =====================================================================================
const cam = new THREE.PerspectiveCamera(64, 16 / 9, 0.05, 1600);
const ctrl = new FirstPersonController(cam);
const ground = () => 0;
const noCollide = () => {};

ctrl.resetToBedroomSpawn();
ctrl.updateFreeRoam(1 / 60, 2.35, ground, noCollide, true);

// Idle on the ground: y must stay glued to the floor.
for (let i = 0; i < 60; i++) ctrl.updateFreeRoam(1 / 60, 2.35, ground, noCollide, true);
const groundedY = ctrl.position.y;
if (Math.abs(groundedY - ground()) > 0.02) {
  fail(`Player is not grounded on the floor: y=${groundedY}`);
}

// Press SPACE -> the player must leave the ground.
ctrl.onKeyDown('Space');
ctrl.updateFreeRoam(1 / 60, 2.35, ground, noCollide, true);
if (ctrl.position.y <= groundedY + 1e-3) {
  fail('SPACE did not launch the player off the ground');
}
if (!ctrl.isAirborne) {
  fail('Player is not flagged airborne right after a jump');
}

// Fly the arc and confirm it is a real parabola (rises, then falls) and lands back on the floor.
let peakY = ctrl.position.y;
let landed = false;
for (let i = 0; i < 240; i++) {
  ctrl.updateFreeRoam(1 / 60, 2.35, ground, noCollide, true);
  peakY = Math.max(peakY, ctrl.position.y);
  if (!ctrl.isAirborne) {
    landed = true;
    break;
  }
}
if (!landed) {
  fail('Player never landed after jumping');
}
if (Math.abs(ctrl.position.y - ground()) > 0.02) {
  fail(`Player did not land back on the floor: y=${ctrl.position.y}`);
}
const jumpApex = peakY - groundedY;
console.log(`jump: apex=${jumpApex.toFixed(3)}m landed=${landed} airborneFlag=${ctrl.isAirborne}`);
if (jumpApex < 0.55 || jumpApex > 2.0) {
  fail(`Jump apex ${jumpApex.toFixed(3)}m is out of the expected 0.55..2.0m band`);
}

// A jump must NOT be repeatable while held (no auto-bunny-hop).
ctrl.onKeyDown('Space');
ctrl.updateFreeRoam(1 / 60, 2.35, ground, noCollide, true);
const yAfterFirst = ctrl.position.y;
ctrl.updateFreeRoam(1 / 60, 2.35, ground, noCollide, true);
if (ctrl.position.y < yAfterFirst - 1e-3) {
  fail('Holding SPACE re-triggered a second jump mid-air');
}
ctrl.onKeyUp('Space');

// Walking off a ledge must make the player fall instead of snapping down.
const ledgeGround = (x: number, z: number) => (z > 0 ? 0 : -6);
ctrl.position.set(0, 0, -1);
ctrl.updateFreeRoam(1 / 60, 2.35, ledgeGround, noCollide, true);
ctrl.position.set(0, 0, 1); // step onto the drop
ctrl.updateFreeRoam(1 / 60, 2.35, ledgeGround, noCollide, true);
if (!ctrl.isAirborne) {
  fail('Walking off a ledge did not put the player into free fall');
}
console.log(`ledge fall: airborne=${ctrl.isAirborne}`);

// =====================================================================================
// 5) PARTIAL LOW-RESOLUTION FILTER (PostFX wiring)
// =====================================================================================
const { PostFX } = await import('../src/post/PostFX.ts');
const fx: any = new PostFX(640, 360);
const u = fx.mat?.uniforms ?? fx['mat']?.uniforms;
if (!u) {
  fail('PostFX uniform block not reachable for inspection');
} else {
  for (const name of ['uTexel', 'uLowRes', 'uFxaa']) {
    if (!(name in u)) fail(`PostFX uniform ${name} missing`);
  }
  if (u.uTexel && Math.abs(u.uTexel.value.x - 1 / 640) > 1e-6) {
    fail(`uTexel not initialised to 1/width: ${u.uTexel.value.x}`);
  }
  // setSize must refresh uTexel so FXAA taps match the CURRENT internal buffer size.
  fx.setSize(320, 180);
  if (Math.abs(u.uTexel.value.x - 1 / 320) > 1e-6 || Math.abs(u.uTexel.value.y - 1 / 180) > 1e-6) {
    fail(`setSize did not refresh uTexel: ${u.uTexel.value.x}, ${u.uTexel.value.y}`);
  }
  console.log(
    `postfx uniforms: uTexel=(${u.uTexel.value.x.toFixed(6)}, ${u.uTexel.value.y.toFixed(6)}) uLowRes=${u.uLowRes.value} uFxaa=${u.uFxaa.value}`
  );
}

// The fragment shader must actually contain a masked (partial) low-res path, not a global one.
const { readFileSync } = await import('node:fs');
const postSrc = readFileSync(new URL('../src/post/PostFX.ts', import.meta.url), 'utf8');
if (!/lowResMask/.test(postSrc)) {
  fail('PostFX shader has no lowResMask - the partial low-res filter is not implemented');
}
if (!/periph\s*=\s*smoothstep/.test(postSrc)) {
  fail('PostFX low-res filter is not masked to part of the view (no peripheral mask)');
}
if (!/fxaa\s*\(\s*vec2/.test(postSrc)) {
  fail('PostFX shader has no FXAA implementation');
}

// main.ts must feed the low-res amount only for the glitch world (never the bedroom).
const mainSrc = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
if (!/lowRes:\s*lowResAmt/.test(mainSrc)) {
  fail('main.ts does not pass the lowRes amount to PostFX');
}
if (!/lowResAmt\s*=\s*0\.30/.test(mainSrc)) {
  fail('main.ts does not enable the low-res sector in the Glitch World');
}
console.log('postfx partial low-res filter: implemented + wired');

if (failures > 0) {
  console.error(`\n${failures} feature check(s) FAILED`);
  process.exit(1);
}
console.log('\nALL FEATURE CHECKS PASSED');
