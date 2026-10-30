import * as THREE from 'three';

// --- minimal canvas/DOM stubs so the world builders can run headless
const ctxStub: any = new Proxy(
  {},
  {
    get(_t, prop) {
      if (prop === 'measureText') return () => ({ width: 120 });
      if (prop === 'canvas') return { width: 1024, height: 512 };
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

const w: any = new GlitchWorld();
console.log('constructed GlitchWorld, group children =', w.group.children.length);

const tex = new THREE.Texture();
w.buildSkyAndLighting();
w.buildTerrain(tex, tex);
w.buildKernelMegacityAndSkyRift();
w.buildCathedralCausewayAndLeviathan();
w.buildCentralSanctuary(new THREE.Object3D(), new THREE.Object3D(), new THREE.Object3D());
w.buildWorldLandmarks(new THREE.Object3D(), new THREE.Object3D(), new THREE.Object3D(), new THREE.Object3D());
w.buildFloatingAtmosphere();
w.buildAtmosphericDepth();
w.buildCausewayDetailAndMonoliths();
w.buildHostEffigyAndPhantoms();
w.buildCollapseAndAbyss(tex, tex);
console.log('all builders OK, group children =', w.group.children.length);

// exercise the update loop, including anomaly bursts and collapse
const pos = new THREE.Vector3(0, 5, 20);
let pulses = 0;
w.onAnomalyPulse = () => pulses++;
for (let i = 0; i < 900; i++) w.update(1 / 60, i / 60, pos, null);
for (let i = 0; i < 600; i++) w.update(1 / 60, 15 + i / 60, pos, i / 60);
console.log('update loop OK — anomaly pulses seen:', pulses, '| traffic instances:', w.trafficMesh.count);

// sanity: every mesh/instanced mesh has finite matrices AND non-degenerate geometry (>0 vertices/triangles)
let bad = 0;
let degenGeos = 0;
w.group.traverse((o: any) => {
  if (o.isMesh || o.isInstancedMesh) {
    const posAttr = o.geometry?.attributes?.position;
    const triCount = o.geometry?.index ? o.geometry.index.count / 3 : (posAttr ? posAttr.count / 3 : 0);
    if (!posAttr || posAttr.count < 3 || triCount < 1) {
      degenGeos++;
      console.error('Degenerate geometry on mesh:', o.name || o.uuid, 'tris=', triCount);
    }
    if (o.material?.isShaderMaterial) {
      const mat = o.material;
      const src = `${mat.vertexShader}\n${mat.fragmentShader}`;
      const re = /uniform\s+(float|int|vec2|vec3)\s+(\w+)\s*;/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        const [, glslType, uName] = m;
        if (!(uName in mat.uniforms)) continue;
        const val = mat.uniforms[uName].value;
        if ((glslType === 'float' || glslType === 'int') && (typeof val !== 'number' || !Number.isFinite(val))) {
          throw new Error(`Uniform mismatch on ${uName}: expected ${glslType}, got ${String(val)}`);
        }
      }
    }
  }
  if (o.isInstancedMesh) {
    const a = o.instanceMatrix.array as Float32Array;
    for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) bad++;
  }
});
if (bad > 0 || degenGeos > 0) {
  throw new Error(`World sanity check failed: badMatrix=${bad}, degenGeos=${degenGeos}`);
}

// Verify seamless forward tunnel-to-3D-world flight continuity (zero backward flip, zero pitch/velocity/FOV kink!)
const { FirstPersonController } = await import('../src/player/FirstPersonController.ts');
const cam = new THREE.PerspectiveCamera(64, 16 / 9, 0.05, 1600);
const ctrl = new FirstPersonController(cam);
const spawn = new THREE.Vector3(0, w.getTerrainHeight(0, 20), 20);

// 1) Verify exact coaxial screen-center tunnel alignment + scaled local-Z bounds across SUCTION_CUTSCENE -> GLITCH_ARRIVAL!
const monPos = new THREE.Vector3(-1.12, 1.08, -0.45);
const monQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI * 0.5);
const monFwd = new THREE.Vector3(0, 0, 1).applyQuaternion(monQuat).normalize();
// Simulate actual BedroomScene monitor scale (~0.348, 0.365, 0.348) so we catch any local/world Z mismatch!
const bsodRoot = new THREE.Object3D();
bsodRoot.position.copy(monPos);
bsodRoot.quaternion.copy(monQuat);
bsodRoot.scale.set(0.348, 0.365, 0.348);
bsodRoot.updateMatrixWorld(true);

let maxTunnelRadialLocal = 0;
let minTunnelLocalZ = 0;
for (let step = 0; step <= 144; step++) {
  const t = (step / 144) * 7.20;
  const { insideTunnel } = ctrl.updateSuctionCutscene(t, 7.20, monPos, monQuat);
  const localCam = bsodRoot.worldToLocal(cam.position.clone());
  if (insideTunnel) {
    const radial = Math.hypot(localCam.x, localCam.y);
    maxTunnelRadialLocal = Math.max(maxTunnelRadialLocal, radial);
    minTunnelLocalZ = Math.min(minTunnelLocalZ, localCam.z);
    if (radial > 0.85) {
      throw new Error(`Tunnel camera drifted off-axis at t=${t.toFixed(2)}: localXY=(${localCam.x.toFixed(2)}, ${localCam.y.toFixed(2)})`);
    }
    if (localCam.z < -108.0) {
      throw new Error(`Tunnel camera flew past scaled tunnel cap (-116) at t=${t.toFixed(2)}: localZ=${localCam.z.toFixed(2)}`);
    }
  }
}

ctrl.updateSuctionCutscene(7.20, 7.20, monPos, monQuat);
const suctionEndLocal = bsodRoot.worldToLocal(cam.position.clone());
const suctionEndDir = new THREE.Vector3();
cam.getWorldDirection(suctionEndDir);
const suctionAxisDot = suctionEndDir.dot(monFwd.clone().negate());
const suctionEndFov = cam.fov;

ctrl.updateGlitchArrivalCutscene(1 / 60, 0.0, spawn, w.corePosition, w.skyPortalPos, w.skyPortalQuat);
const portalFwd = new THREE.Vector3(0, 0, 1).applyQuaternion(w.skyPortalQuat).normalize();
const arrivalStartDir = new THREE.Vector3();
cam.getWorldDirection(arrivalStartDir);
const arrivalAxisDot = arrivalStartDir.dot(portalFwd);
const arrivalStartFov = cam.fov;
const fovDiffDeg = Math.abs(suctionEndFov - arrivalStartFov);

console.log(
  `tunnel coaxial match: localEnd=(${suctionEndLocal.x.toFixed(3)}, ${suctionEndLocal.y.toFixed(3)}, ${suctionEndLocal.z.toFixed(2)}) | maxRadial=${maxTunnelRadialLocal.toFixed(3)} | suctionDot=${suctionAxisDot.toFixed(5)} | arrivalDot=${arrivalAxisDot.toFixed(5)} | fovDiff=${fovDiffDeg.toFixed(4)} deg`
);
if (
  Math.hypot(suctionEndLocal.x, suctionEndLocal.y) > 0.005 ||
  suctionAxisDot < 0.9999 ||
  arrivalAxisDot < 0.9999 ||
  fovDiffDeg > 0.05
) {
  throw new Error(
    `Tunnel coaxial handoff mismatch: localEnd=(${suctionEndLocal.x}, ${suctionEndLocal.y}, ${suctionEndLocal.z}), suctionDot=${suctionAxisDot}, arrivalDot=${arrivalAxisDot}, fovDiff=${fovDiffDeg}`
  );
}

// 2) Verify C1 velocity + quaternion + FOV continuity right across the mouth exit at t = 1.12s!
const exitT = 1.12;
const dtEps = 0.001;
ctrl.updateGlitchArrivalCutscene(dtEps, exitT - dtEps * 2, spawn, w.corePosition, w.skyPortalPos, w.skyPortalQuat);
const pBefore2 = cam.position.clone();
ctrl.updateGlitchArrivalCutscene(dtEps, exitT - dtEps, spawn, w.corePosition, w.skyPortalPos, w.skyPortalQuat);
const pBefore1 = cam.position.clone();
const qBefore = cam.quaternion.clone();
const fovBefore = cam.fov;
const velIn = pBefore1.clone().sub(pBefore2).divideScalar(dtEps);

ctrl.updateGlitchArrivalCutscene(dtEps, exitT + dtEps, spawn, w.corePosition, w.skyPortalPos, w.skyPortalQuat);
const pAfter1 = cam.position.clone();
const qAfter = cam.quaternion.clone();
const fovAfter = cam.fov;
ctrl.updateGlitchArrivalCutscene(dtEps, exitT + dtEps * 2, spawn, w.corePosition, w.skyPortalPos, w.skyPortalQuat);
const pAfter2 = cam.position.clone();
const velOut = pAfter2.clone().sub(pAfter1).divideScalar(dtEps);

const velJump = velOut.distanceTo(velIn);
const angJumpDeg = THREE.MathUtils.radToDeg(qBefore.angleTo(qAfter));
const exitFovJump = Math.abs(fovAfter - fovBefore);
console.log(
  `aperture exit C1 check (t=1.12s): velJump=${velJump.toFixed(4)} m/s | angJump=${angJumpDeg.toFixed(4)} deg | fovJump=${exitFovJump.toFixed(4)} deg`
);
if (velJump > 0.25 || angJumpDeg > 0.08 || exitFovJump > 0.05) {
  throw new Error(`Discontinuity at tunnel exit mouth: velJump=${velJump}, angJump=${angJumpDeg}, fovJump=${exitFovJump}`);
}

let prevPos: THREE.Vector3 | null = null;
let maxStepJump = 0;
for (let step = 0; step <= 300; step++) {
  const t = (step / 300) * 5.95;
  ctrl.updateGlitchArrivalCutscene(1 / 60, t, spawn, w.corePosition, w.skyPortalPos, w.skyPortalQuat);
  const lookDir = new THREE.Vector3();
  cam.getWorldDirection(lookDir);
  if (lookDir.z > -0.25) {
    throw new Error(`Camera flipped backward during tunnel->world arrival at t=${t.toFixed(2)}: lookDir.z=${lookDir.z.toFixed(3)}`);
  }
  if (prevPos && t > 0.05 && t < 4.28) {
    if (cam.position.z > prevPos.z + 1e-4 || cam.position.y > prevPos.y + 1e-4) {
      throw new Error(`Hermite flight overshot/reversed at t=${t.toFixed(2)}!`);
    }
    maxStepJump = Math.max(maxStepJump, cam.position.distanceTo(prevPos));
  }
  prevPos = cam.position.clone();
}

// 3) Verify toothless tunnel exit, jumpable wing terraces, view-dependent world shaders, and player jump physics!
const anyW = w as any;
if (anyW.skyFangs || anyW.skyFangMat) {
  throw new Error('Tunnel exit teeth (skyFangs / skyFangMat) MUST be completely removed!');
}
if (!anyW.skyApertureVeil || !anyW.skySleeveMesh) {
  throw new Error('Flared toothless skySleeveMesh + skyApertureVeil seam-dissolve veil must exist!');
}
if (!anyW.monolithMat?.uniforms?.uCamForward || !anyW.phantomMat?.uniforms?.uCamForward || !anyW.errorCascadeMat?.uniforms?.uCamForward) {
  throw new Error('View-dependent uCamForward uniforms missing on 3D world shaders!');
}
// Verify player jumping in FirstPersonController + jumpable Wing Pavilion terraces!
ctrl.position.copy(spawn);
ctrl.velocity.set(0, 0, 0);
ctrl.isGrounded = true;
let jumped = false;
let landed = false;
ctrl.onJump = () => { jumped = true; };
ctrl.onLand = () => { landed = true; };
ctrl.onKeyDown('Space');
let maxJumpY = ctrl.position.y;
for (let f = 0; f < 90; f++) {
  ctrl.updateFreeRoam(
    1 / 60,
    5.5,
    (x, z) => w.getFloorHeight(x, z, ctrl.position.y),
    (p) => w.resolvePlayerBounds(p),
    true,
    { jumpSpeed: 6.35, gravity: 15.2 }
  );
  maxJumpY = Math.max(maxJumpY, ctrl.position.y);
}
ctrl.onKeyUp('Space');
if (!jumped || !landed || maxJumpY - spawn.y < 1.15) {
  throw new Error(`Jump physics check failed: jumped=${jumped}, landed=${landed}, gain=${(maxJumpY - spawn.y).toFixed(2)}`);
}
// Verify elevated jump terrace at East Pavilion observation deck (18.9, -8.2)
const eastStepGround = w.getTerrainHeight(18.9, -8.2);
const eastStepTop = w.getFloorHeight(18.9, -8.2, eastStepGround + 2.5);
if (eastStepTop <= eastStepGround + 1.8) {
  throw new Error(`East Pavilion jump terrace missing: ground=${eastStepGround}, stepTop=${eastStepTop}`);
}

// 4) Verify ZERO tedious fetch-quest seals & seamless proximity WAKE_UP convergence at Central Cray-1 Sanctuary!
if (anyW.neuralSeals || typeof anyW.severSeal === 'function') {
  throw new Error('3-item Neural Seal collection system must be completely removed!');
}
if (anyW.phantomMesh?.count !== 8) {
  throw new Error(`Expected 8 peripheral Glitch Apparitions, got ${anyW.phantomMesh?.count}`);
}
if (w.coreSecretRevealed) {
  throw new Error('Expected initial coreSecretRevealed=false before approaching Sanctuary!');
}
// Approaching Central Cray-1 Sanctuary directly reveals WAKE_UP without any tedious collection chores!
w.update(1 / 60, 2.0, new THREE.Vector3(0, 4.4, -48), null);
if (!w.coreSecretRevealed) {
  throw new Error('Approaching Central Sanctuary must seamlessly align & reveal WAKE_UP!');
}
w.resetCollapse();
if (w.coreSecretRevealed) {
  throw new Error('resetCollapse() failed to reset coreSecretRevealed!');
}
console.log('Zero-tedium Sanctuary WAKE_UP convergence & 8 peripheral Glitch Apparitions verified OK!');
console.log('non-finite instance matrix values:', bad, '| degenerate geometries:', degenGeos, '| max arrival step (m):', maxStepJump.toFixed(3));
console.log('SMOKE TEST PASSED');
