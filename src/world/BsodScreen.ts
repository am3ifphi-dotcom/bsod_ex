import * as THREE from 'three';
import { getSharedNoiseTexture } from '../utils/ProceduralNoise';

export interface BsodScreenState {
  hoverFace: boolean;
  cursorUv: THREE.Vector2;
  clickCount: number;
  madness: number; // 0..1 continuous escalation
  jawOpen: number; // 0..1 opening of the ':(' fissure into 3D throat
  suctionProgress: number; // 0..1 camera diving through the throat
  aftermath: boolean;
}

const THROAT_RING_COUNT = 40;
const THROAT_SHARD_COUNT = 128;
const THROAT_LINE_COUNT = 180;
const THROAT_TOOTH_COUNT = 144;
const RIM_TOOTH_COUNT = 52;
const JAW_FLAP_COUNT = 4;
const SINEW_COUNT = 32;
const PARASYTE_EYE_COUNT = 11;
const GLASS_SHARD_COUNT = 48;

function buildParasyteMandibleGeometry(): THREE.BufferGeometry {
  // High-resolution sculpted 3D Parasyte (寄生獣) quadrant jaw-and-gum mesh:
  // u in [-1..+1] (full quadrant angular span), v in [0..1]:
  //   v = 0.00..0.22: inner wet pharynx wall wrapping deep -Z into the throat tunnel
  //   v = 0.22..0.44: swollen 3D alveolar gum arch (歯槽堤) with tooth-root sockets
  //   v = 0.44..1.00: sculpted muscular cheek/brow/chin lobe tucking cleanly behind torn LCD glass
  const uSegs = 44;
  const vSegs = 30;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let iv = 0; iv <= vSegs; iv++) {
    const v = iv / vSegs;
    for (let iu = 0; iu <= uSegs; iu++) {
      const u = (iu / uSegs) * 2.0 - 1.0;
      positions.push(u, v, 0.0);
      uvs.push(iu / uSegs, v);
    }
  }
  const stride = uSegs + 1;
  for (let iv = 0; iv < vSegs; iv++) {
    for (let iu = 0; iu < uSegs; iu++) {
      const a = iv * stride + iu;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      // Counter-clockwise winding in (+v radial outward, +u CCW tangent) -> +Z front-facing!
      indices.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function buildParasyteToothGeometry(): THREE.BufferGeometry {
  // High-detail sculpted Parasyte (寄生獣) anatomical hybrid tooth with closed biting edge:
  // Cervical root neck (buried in 3D gum socket) -> bulging enamel equator -> developmental lobes -> closed incisal/cusp ridge!
  const rings = 13;
  const segs = 20;
  const profile: Array<[number, number, number, number]> = [
    // [ty (0..1), rx (mesial-distal half-width), rz (labio-lingual half-depth), hookZ]
    [0.00, 0.096, 0.082, -0.010],
    [0.10, 0.106, 0.088, -0.005],
    [0.22, 0.118, 0.094,  0.000],
    [0.34, 0.116, 0.088,  0.005],
    [0.46, 0.112, 0.080,  0.011],
    [0.58, 0.106, 0.070,  0.018],
    [0.69, 0.099, 0.058,  0.025],
    [0.79, 0.091, 0.045,  0.031],
    [0.87, 0.082, 0.032,  0.036],
    [0.93, 0.071, 0.021,  0.040],
    [0.97, 0.058, 0.012,  0.042],
    [0.99, 0.042, 0.005,  0.043],
    [1.00, 0.000, 0.000,  0.0435],
  ];
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let r = 0; r < rings; r++) {
    const [ty, rx, rz, hz] = profile[r];
    for (let s = 0; s <= segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const superX = Math.sign(ca) * Math.pow(Math.abs(ca), 0.62);
      const superZ = Math.sign(sa) * Math.pow(Math.abs(sa), 0.72);
      // Anatomical labial developmental mamelon grooves + palatal/lingual concavity
      const labialGroove = 1.0 - 0.055 * Math.cos(ca * Math.PI * 2.0) * Math.max(0, sa) * Math.sin(ty * Math.PI);
      const lingualScoop = sa < 0 ? -0.018 * Math.sin(Math.min(1, ty * 1.15) * Math.PI) * (1.0 - ca * ca) : 0.0;
      positions.push(
        superX * rx * labialGroove,
        ty * 0.30,
        superZ * rz + hz + lingualScoop * (1.0 - Math.pow(ty, 4.0))
      );
      uvs.push(s / segs, ty);
    }
  }
  const stride = segs + 1;
  for (let r = 0; r < rings - 1; r++) {
    for (let s = 0; s < segs; s++) {
      const a = r * stride + s;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function buildParasyteSocketedEyeGeometry(): THREE.BufferGeometry {
  // Compound 1-draw-call geometry combining:
  //   Part A (uv.y in 0.00..0.45): 28x20 high-res spherical eyeball (+Z = cornea pole)
  //   Part B (uv.y in 0.55..1.00): 28x12 sculpted 3D fleshy orbital socket & split eyelids hugging the eyeball!
  const ball = new THREE.SphereGeometry(1.0, 28, 20);
  ball.rotateX(Math.PI * 0.5);

  const lidSegs = 28;
  const lidRings = 12;
  const lidPos: number[] = [];
  const lidUv: number[] = [];
  const lidIdx: number[] = [];

  for (let ir = 0; ir <= lidRings; ir++) {
    const tau = ir / lidRings; // 0 = inner wet palpebral rim hugging sclera, 1 = deep muscular base in jaw flesh
    for (let is = 0; is <= lidSegs; is++) {
      const u = is / lidSegs;
      const theta = u * Math.PI * 2;
      const ct = Math.cos(theta);
      const st = Math.sin(theta);

      // Almond-shaped Parasyte palpebral fissure: pinched canthi at ±X, arched muscular tarsal folds at ±Y
      const canthusStretchX = 1.16 - 0.10 * tau;
      const apertureCompressY = 0.72 + 0.28 * tau;
      // Cross-section wraps tightly around the unit sphere (r^2 + z^2 > 1.03 across middle so zero z-fighting!)
      let rRing: number;
      let zRing: number;
      if (tau < 0.14) {
        // Thick rolled mucocutaneous eyelid margin curling inward onto the wet sclera
        const k = tau / 0.14;
        rRing = THREE.MathUtils.lerp(0.76, 0.88, k);
        zRing = THREE.MathUtils.lerp(0.64, 0.69, k);
      } else {
        const k = (tau - 0.14) / 0.86;
        rRing = THREE.MathUtils.lerp(0.88, 1.62, Math.pow(k, 0.88));
        zRing = THREE.MathUtils.lerp(0.69, -0.46, Math.pow(k, 1.08)) + Math.sin(k * Math.PI) * 0.14;
      }

      const browCrease = (st > 0 ? 0.08 : 0.04) * Math.sin(tau * Math.PI) * Math.pow(Math.abs(st), 1.5);
      const x = ct * rRing * canthusStretchX;
      const y = st * rRing * apertureCompressY;
      const z = zRing + browCrease;
      lidPos.push(x, y, z);
      lidUv.push(u, 0.55 + tau * 0.45);
    }
  }
  const lidStride = lidSegs + 1;
  for (let ir = 0; ir < lidRings; ir++) {
    for (let is = 0; is < lidSegs; is++) {
      const a = ir * lidStride + is;
      const b = a + 1;
      const c = a + lidStride;
      const d = c + 1;
      lidIdx.push(a, c, b, b, c, d);
    }
  }
  const lidGeo = new THREE.BufferGeometry();
  lidGeo.setAttribute('position', new THREE.Float32BufferAttribute(lidPos, 3));
  lidGeo.setAttribute('uv', new THREE.Float32BufferAttribute(lidUv, 2));
  lidGeo.setIndex(lidIdx);
  lidGeo.computeVertexNormals();

  const bPos = ball.attributes.position.array as Float32Array;
  const bNrm = ball.attributes.normal.array as Float32Array;
  const bUv = ball.attributes.uv.array as Float32Array;
  const bIdx = ball.index!.array;

  const lPos = lidGeo.attributes.position.array as Float32Array;
  const lNrm = lidGeo.attributes.normal.array as Float32Array;
  const lUv = lidGeo.attributes.uv.array as Float32Array;
  const lIdx = lidGeo.index!.array;

  const mergedPos = new Float32Array(bPos.length + lPos.length);
  mergedPos.set(bPos, 0);
  mergedPos.set(lPos, bPos.length);

  const mergedNrm = new Float32Array(bNrm.length + lNrm.length);
  mergedNrm.set(bNrm, 0);
  mergedNrm.set(lNrm, bNrm.length);

  const mergedUv = new Float32Array(bUv.length + lUv.length);
  for (let i = 0; i < bUv.length; i += 2) {
    mergedUv[i] = bUv[i];
    mergedUv[i + 1] = bUv[i + 1] * 0.45;
  }
  mergedUv.set(lUv, bUv.length);

  const vertOffset = bPos.length / 3;
  const mergedIdx = new Uint16Array(bIdx.length + lIdx.length);
  mergedIdx.set(bIdx, 0);
  for (let i = 0; i < lIdx.length; i++) {
    mergedIdx[bIdx.length + i] = lIdx[i] + vertOffset;
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(mergedPos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(mergedNrm, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(mergedUv, 2));
  out.setIndex(new THREE.BufferAttribute(mergedIdx, 1));
  ball.dispose();
  lidGeo.dispose();
  return out;
}

export class BsodScreen {
  public readonly root = new THREE.Group();
  public readonly hitboxMesh: THREE.Mesh;
  public readonly monitorLight: THREE.PointLight;

  private readonly stageTextures: THREE.CanvasTexture[] = [];
  private readonly aftermathTex: THREE.CanvasTexture;
  private readonly cardTex: THREE.CanvasTexture;

  private readonly faceCanvas: HTMLCanvasElement;
  private readonly faceTex: THREE.CanvasTexture;

  public readonly screenMesh: THREE.Mesh;
  public readonly screenMat: THREE.ShaderMaterial;

  // 100% GPU-animated Zero-Gravity 3D Shattered LCD Glass Shards
  private readonly glassShards: THREE.InstancedMesh;
  private readonly glassShardMat: THREE.ShaderMaterial;

  private readonly stencilMaskMesh: THREE.Mesh;
  private readonly throatGroup = new THREE.Group();
  private readonly throatBackCap: THREE.Mesh;
  private readonly throatTubeMat: THREE.ShaderMaterial;
  private readonly throatRings: THREE.InstancedMesh;
  private readonly throatRingMat: THREE.ShaderMaterial;
  private readonly throatShards: THREE.InstancedMesh;
  private readonly throatShardMat: THREE.ShaderMaterial;
  private readonly throatLines: THREE.InstancedMesh;
  private readonly throatLineMat: THREE.ShaderMaterial;
  private readonly throatTeeth: THREE.InstancedMesh;
  private readonly throatToothMat: THREE.ShaderMaterial;
  private readonly throatMaterials: THREE.Material[] = [];

  // True 3D Parasyte-style Biomechanical Jaw Rig (protruding +Z out of the LCD glass!)
  private readonly parasyteGroup = new THREE.Group();
  private readonly jawFlapsMesh: THREE.InstancedMesh;
  private readonly jawFlapMat: THREE.ShaderMaterial;
  private readonly rimTeethMesh: THREE.InstancedMesh;
  private readonly rimToothMat: THREE.ShaderMaterial;
  private readonly sinewMesh: THREE.InstancedMesh;
  private readonly sinewMat: THREE.ShaderMaterial;
  private readonly parasyteEyesMesh: THREE.InstancedMesh;
  private readonly parasyteEyeMat: THREE.ShaderMaterial;

  private lastRenderedStage = -1;
  private lastAftermath = false;
  private insideTunnelMode = false;

  // 0..1: hairline crack propagation along '(' stroke since last click
  private crackRun = 0;
  private readonly impactUv = new THREE.Vector2(0.144, 0.742);

  // Measured ink bounds of ':' and '(' glyphs in 1:1 faceCanvas [0..1] UV space (all strictly finite!)
  private readonly parenC = new THREE.Vector2(0.609, 0.459);
  private readonly parenSize = new THREE.Vector2(0.145, 0.574);
  private readonly colonC = new THREE.Vector2(0.374, 0.424);
  private readonly colonSize = new THREE.Vector2(0.068, 0.320);
  // Half separation between the two ':' dot centres in faceCanvas UV (MUST be a finite scalar float!)
  public colonDotOff = 0.127;
  // Mean ink X of '(' at bottom / middle / top in faceCanvas UV
  private readonly spine = new THREE.Vector3(0.572, 0.646, 0.572);

  // Screen quad local dimensions matching BSOD_SCREEN_NODE (-0.95283..+0.95283, -0.5..+0.5)
  public static readonly LOCAL_W = 1.90566;
  public static readonly LOCAL_H = 1.0;

  constructor() {
    const noiseTex = getSharedNoiseTexture();

    // 1. Pre-bake all 6 BSOD stages + aftermath onto separate GPU-ready CanvasTextures ONCE at boot
    //    so clicking ':(' during gameplay costs 0.00ms CPU canvas work and 0.00ms gl.texImage2D upload!
    for (let s = 0; s <= 5; s++) {
      this.stageTextures.push(this.bakeStageTexture(s, false));
    }
    this.aftermathTex = this.bakeStageTexture(0, true);

    // 2. Separate SDF Face Channel Map (R = ':' eyes SDF, G = '(' mouth SDF) at crisp mipmapped 1024x1024
    this.faceCanvas = document.createElement('canvas');
    this.faceCanvas.width = 1024;
    this.faceCanvas.height = 1024;
    this.renderFaceChannelTexture();
    this.faceTex = new THREE.CanvasTexture(this.faceCanvas);
    this.faceTex.minFilter = THREE.LinearMipmapLinearFilter;
    this.faceTex.magFilter = THREE.LinearFilter;
    this.faceTex.anisotropy = 8;
    this.faceTex.generateMipmaps = true;
    this.faceTex.needsUpdate = true;

    // 3. Invisible low-poly raycast plane (2 triangles = 0.001ms raycast!)
    const hitGeo = new THREE.PlaneGeometry(BsodScreen.LOCAL_W, BsodScreen.LOCAL_H, 1, 1);
    const hitMat = new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide });
    this.hitboxMesh = new THREE.Mesh(hitGeo, hitMat);
    this.hitboxMesh.position.z = 0.004;
    this.root.add(this.hitboxMesh);

    // 4. Stencil Aperture Mask (writes stencil=1 on monitor area when jawOpen > 0)
    const maskGeo = new THREE.PlaneGeometry(BsodScreen.LOCAL_W * 0.992, BsodScreen.LOCAL_H * 0.992, 1, 1);
    const maskMat = new THREE.MeshBasicMaterial({
      colorWrite: false,
      depthWrite: false,
      stencilWrite: true,
      stencilRef: 1,
      stencilFunc: THREE.AlwaysStencilFunc,
      stencilZPass: THREE.ReplaceStencilOp,
    });
    this.stencilMaskMesh = new THREE.Mesh(maskGeo, maskMat);
    this.stencilMaskMesh.renderOrder = 2;
    this.stencilMaskMesh.visible = false;
    this.root.add(this.stencilMaskMesh);

    // 5. Non-Euclidean 3D Abyssal Monitor Throat Tunnel (100% GPU-driven, 0.0ms CPU!)
    this.root.add(this.throatGroup);
    this.throatGroup.visible = false;

    // Open-fronted tube + back dome starting cleanly at z = -0.02 so front cap never clips camera!
    const tubeGeo = new THREE.CylinderGeometry(1.42, 5.6, 116, 24, 20, true);
    tubeGeo.rotateX(Math.PI * 0.5);
    tubeGeo.translate(0, 0, -58.02);
    // Add far portal cap disc at z = -116.02 facing +Z (so with BackSide we flip normal to -Z)
    const endDisc = new THREE.CircleGeometry(5.6, 24);
    endDisc.rotateY(Math.PI); // BackSide makes +Z visible when rotated PI!
    endDisc.translate(0, 0, -116.0);
    // Keep tubeGeo + endDisc as a single merged tunnel mesh
    const tPos = tubeGeo.attributes.position.array as Float32Array;
    const tUv = tubeGeo.attributes.uv.array as Float32Array;
    const tIdx = tubeGeo.index!.array;
    const dPos = endDisc.attributes.position.array as Float32Array;
    const dUv = endDisc.attributes.uv.array as Float32Array;
    const dIdx = endDisc.index!.array;

    const mergedPos = new Float32Array(tPos.length + dPos.length);
    mergedPos.set(tPos, 0);
    mergedPos.set(dPos, tPos.length);
    const mergedUv = new Float32Array(tUv.length + dUv.length);
    mergedUv.set(tUv, 0);
    mergedUv.set(dUv, tUv.length);
    const vOffset = tPos.length / 3;
    const mergedIdx = new Uint16Array(tIdx.length + dIdx.length);
    mergedIdx.set(tIdx, 0);
    for (let i = 0; i < dIdx.length; i++) mergedIdx[tIdx.length + i] = dIdx[i] + vOffset;

    const capGeo = new THREE.BufferGeometry();
    capGeo.setAttribute('position', new THREE.BufferAttribute(mergedPos, 3));
    capGeo.setAttribute('uv', new THREE.BufferAttribute(mergedUv, 2));
    capGeo.setIndex(new THREE.BufferAttribute(mergedIdx, 1));
    tubeGeo.dispose();
    endDisc.dispose();

    this.throatTubeMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthFunc: THREE.AlwaysDepth,
      depthWrite: true,
      stencilWrite: true,
      stencilWriteMask: 0,
      stencilRef: 1,
      stencilFunc: THREE.EqualStencilFunc,
      uniforms: {
        uTime: { value: 0 },
        uScrollPhase: { value: 0 },
        uMadness: { value: 0 },
        uSuction: { value: 0 },
        uNoiseTex: { value: noiseTex },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vTubePos;
        uniform float uTime;
        uniform float uMadness;
        uniform float uSuction;
        void main() {
          vUv = uv;
          vec3 p = position;
          vTubePos = position;
          float straighten = 1.0 - smoothstep(0.46, 0.88, uSuction);
          // Peristaltic swallowing contraction squeezing down the near gullet!
          float peristalsis = 1.0 - 0.14 * sin(-p.z * 0.48 - uTime * 7.5) * smoothstep(-36.0, -1.0, p.z);
          p.xy *= peristalsis;
          float twist = p.z * 0.042 * (0.4 + uMadness) + uTime * 1.35;
          p.x += sin(twist) * 0.28 * smoothstep(-1.0, -25.0, p.z) * straighten;
          p.y += cos(twist * 0.9) * 0.22 * smoothstep(-1.0, -25.0, p.z) * straighten;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vTubePos;
        uniform float uTime;
        uniform float uScrollPhase;
        uniform float uMadness;
        uniform float uSuction;
        uniform sampler2D uNoiseTex;

        void main() {
          float depthFactor = clamp(-vTubePos.z / 115.0, 0.0, 1.0);
          float zScroll = vTubePos.z * 0.62 + uScrollPhase;

          float safeTx = (abs(vTubePos.x) < 1e-5 && abs(vTubePos.y) < 1e-5) ? 1e-5 : vTubePos.x;
          float angle = atan(vTubePos.y, safeTx);
          vec4 nSample = texture2D(uNoiseTex, vec2(angle * 0.3183, vTubePos.z * 0.025 + uTime * 0.18));

          vec2 cell = vec2(angle * 6.366, zScroll);
          vec2 f = fract(cell);
          float line = smoothstep(0.075, 0.0, min(f.x, 1.0 - f.x)) + smoothstep(0.06, 0.0, min(f.y, 1.0 - f.y));
          float helixA = pow(max(0.0, sin(angle * 6.0 + vTubePos.z * 0.22 + uScrollPhase * 0.358)), 8.0);
          float helixB = pow(max(0.0, cos(angle * 10.0 - vTubePos.z * 0.16 + uScrollPhase * 0.265)), 10.0);
          float shockRing = smoothstep(0.92, 1.0, fract(vTubePos.z * 0.09 + uScrollPhase * 0.146));

          vec3 darkGullet = vec3(0.002, 0.025, 0.095);
          // Match GlitchWorld's spatial exit conduit palette 1:1 in the deep zone for a 0-cut transition!
          vec3 sleeveDeep = vec3(0.004, 0.065, 0.28);
          vec3 sleeveMid = vec3(0.008, 0.14, 0.48);

          float ribFold = pow(0.5 + 0.5 * sin(vTubePos.z * 1.45 - uTime * 5.5 + nSample.r * 2.4), 3.0);
          float horrorZone = smoothstep(0.50, 0.04, depthFactor);
          float sleeveZone = smoothstep(0.36, 0.70, depthFactor);

          // Near half: wet crimson Parasyte esophagus -> Deep half: morphs smoothly into GlitchWorld's cerulean conduit!
          vec3 sleeveBase = mix(sleeveDeep, sleeveMid, smoothstep(0.55, 0.94, depthFactor));
          vec3 col = mix(darkGullet, sleeveBase, sleeveZone);
          col += vec3(0.015, 0.16, 0.44) * ribFold * horrorZone;
          col += vec3(0.06, 0.38, 0.8) * pow(nSample.a, 2.8) * horrorZone * 0.5;

          col += vec3(0.28, 0.76, 1.0) * line * mix(0.06, 0.46, sleeveZone);
          col += vec3(0.32, 0.84, 1.0) * (helixA * 0.55 + helixB * 0.45) * mix(0.08, 0.88, sleeveZone);
          col += vec3(0.70, 0.94, 1.0) * shockRing * mix(0.10, 0.72, sleeveZone);

          // === SEAMLESS TOOTHLESS FAR-END PORTAL VISTA (MATCHING GLITCH WORLD EXIT CONDUIT 1:1) ===
          float portalMask = smoothstep(0.90, 0.992, depthFactor);
          vec2 radialP = vTubePos.xy / 5.6;
          float rimR = length(radialP);
          float skyY = clamp(radialP.y * 0.55 + 0.18, -0.35, 1.0);
          vec3 gwHorizon = vec3(0.012, 0.24, 0.76);
          vec3 gwZenith = vec3(0.002, 0.014, 0.064);
          vec3 gwAbyss = vec3(0.004, 0.032, 0.11);
          vec3 gwSky = mix(gwAbyss, gwHorizon, smoothstep(-0.32, 0.06, skyY));
          gwSky = mix(gwSky, gwZenith, smoothstep(0.06, 0.68, skyY));
          vec2 eyeRel = (radialP - vec2(0.0, 0.24)) * vec2(0.85, 1.15);
          float eyeDist = length(eyeRel);
          float eyeCorona = exp(-eyeDist * 3.2) * 0.65 + exp(-abs(eyeDist - 0.21) * 19.0) * 0.95;
          gwSky += vec3(0.58, 0.90, 1.0) * eyeCorona * (0.45 + 0.55 * uSuction);
          // Smooth luminous spatial-rift feather into the conduit wall (ZERO teeth at tunnel exit!)
          float riftGlow = exp(-pow((rimR - 0.88) * 6.0, 2.0));
          gwSky += vec3(0.28, 0.78, 1.0) * riftGlow * 0.42;
          gwSky = mix(gwSky, col, smoothstep(0.78, 1.02, rimR));

          col = mix(col, gwSky, portalMask);

          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.throatBackCap = new THREE.Mesh(capGeo, this.throatTubeMat);
    this.throatBackCap.renderOrder = 3;
    this.throatGroup.add(this.throatBackCap);
    this.throatMaterials.push(this.throatTubeMat);

    // 5b. 100% GPU-Animated Receding Rectangular BSOD Frame Ribs (1 draw call, 0 CPU loops!)
    const frameGeo = new THREE.RingGeometry(0.93, 1.0, 4, 1);
    frameGeo.rotateZ(Math.PI * 0.25);
    const ringIdxAttr = new Float32Array(THROAT_RING_COUNT);
    for (let i = 0; i < THROAT_RING_COUNT; i++) ringIdxAttr[i] = i / THROAT_RING_COUNT;
    frameGeo.setAttribute('aFrac', new THREE.InstancedBufferAttribute(ringIdxAttr, 1));

    this.throatRingMat = new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
      depthFunc: THREE.LessEqualDepth,
      blending: THREE.AdditiveBlending,
      stencilWrite: true,
      stencilWriteMask: 0,
      stencilRef: 1,
      stencilFunc: THREE.EqualStencilFunc,
      uniforms: {
        uTime: { value: 0 },
        uScrollPhase: { value: 0 },
        uMadness: { value: 0 },
        uSuction: { value: 0 },
        uInside: { value: 0 },
      },
      vertexShader: /* glsl */ `
        attribute float aFrac;
        uniform float uTime;
        uniform float uScrollPhase;
        uniform float uMadness;
        uniform float uSuction;
        varying float vDepthT;
        varying float vNearClip;
        void main() {
          float zSpan = 112.0;
          float z = -mod(aFrac * zSpan - uScrollPhase * 0.92, zSpan) - 0.45;
          float depthT = -z / zSpan;
          vDepthT = depthT;
          vNearClip = 1.0;
          float straighten = 1.0 - smoothstep(0.55, 0.96, uSuction);
          float s = 0.74 + depthT * 3.15;
          float rot = sin(uTime * 1.5 + aFrac * 15.0) * 0.20 * uMadness * straighten;
          float cr = cos(rot), sr = sin(rot);
          vec2 rp = vec2(position.x * s * 1.45, position.y * s * 0.85);
          vec2 rotP = vec2(rp.x * cr - rp.y * sr, rp.x * sr + rp.y * cr);
          float wx = sin(z * 0.042 + uTime * 1.35) * 0.26 * depthT * straighten;
          float wy = cos(z * 0.038 + uTime * 1.2) * 0.20 * depthT * straighten;
          vec3 finalP = vec3(rotP.x + wx, rotP.y + wy, z);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(finalP, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vDepthT;
        uniform float uSuction;
        void main() {
          float alpha = mix(0.14, 0.55, smoothstep(0.04, 0.4, uSuction)) * (1.0 - smoothstep(0.42, 0.66, vDepthT));
          if (alpha < 0.008) discard;
          gl_FragColor = vec4(0.68, 0.91, 1.0, alpha);
        }
      `,
    });
    this.throatRings = new THREE.InstancedMesh(frameGeo, this.throatRingMat, THROAT_RING_COUNT);
    this.throatRings.renderOrder = 4;
    this.throatRings.frustumCulled = false;
    this.throatGroup.add(this.throatRings);
    this.throatMaterials.push(this.throatRingMat);

    // 5c. 100% GPU-Animated Spiraling Crash Memory Cards inside the throat (0 CPU loops!)
    const cardCanvas = document.createElement('canvas');
    cardCanvas.width = 256;
    cardCanvas.height = 128;
    const cctx = cardCanvas.getContext('2d')!;
    cctx.fillStyle = 'rgba(0, 56, 128, 0.92)';
    cctx.fillRect(0, 0, 256, 128);
    cctx.fillStyle = '#cbeaff';
    cctx.fillRect(0, 0, 256, 18);
    cctx.fillStyle = '#002b66';
    cctx.font = 'bold 12px Consolas, monospace';
    cctx.fillText('0x000000F4 // DUMP_FRAME', 8, 13);
    cctx.strokeStyle = 'rgba(135, 212, 255, 0.85)';
    cctx.lineWidth = 2;
    cctx.strokeRect(2, 2, 252, 124);
    cctx.fillStyle = '#ffffff';
    cctx.font = '300 28px "Segoe UI", sans-serif';
    cctx.fillText(':(', 14, 60);
    cctx.font = '13px Consolas, monospace';
    cctx.fillStyle = '#9fd8ff';
    cctx.fillText('PAGE_FAULT_NONPAGED', 62, 56);
    cctx.fillRect(14, 88, 188, 6);
    const cardTex = new THREE.CanvasTexture(cardCanvas);
    cardTex.colorSpace = THREE.SRGBColorSpace;
    cardTex.minFilter = THREE.LinearFilter;
    cardTex.magFilter = THREE.LinearFilter;
    cardTex.generateMipmaps = false;
    this.cardTex = cardTex;

    const shardGeo = new THREE.PlaneGeometry(0.28, 0.14);
    const sSeed = new Float32Array(THROAT_SHARD_COUNT * 4);
    for (let i = 0; i < THROAT_SHARD_COUNT; i++) {
      sSeed[i * 4 + 0] = Math.random() * Math.PI * 2; // angle
      sSeed[i * 4 + 1] = 0.38 + Math.random() * 1.65; // radius
      sSeed[i * 4 + 2] = Math.random(); // z offset 0..1
      sSeed[i * 4 + 3] = 0.65 + Math.random() * 1.25; // scale & speed seed
    }
    shardGeo.setAttribute('aSeed4', new THREE.InstancedBufferAttribute(sSeed, 4));

    this.throatShardMat = new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
      depthFunc: THREE.LessEqualDepth,
      stencilWrite: true,
      stencilWriteMask: 0,
      stencilRef: 1,
      stencilFunc: THREE.EqualStencilFunc,
      uniforms: {
        uCardTex: { value: cardTex },
        uTime: { value: 0 },
        uScrollPhase: { value: 0 },
        uSuction: { value: 0 },
      },
      vertexShader: /* glsl */ `
        attribute vec4 aSeed4;
        uniform float uTime;
        uniform float uScrollPhase;
        uniform float uSuction;
        varying vec2 vUv;
        varying float vFade;
        void main() {
          vUv = uv;
          float zSpan = 110.0;
          float z = -zSpan + mod(aSeed4.z * zSpan + uScrollPhase * (0.72 + aSeed4.w * 0.26), zSpan - 0.35);
          float depthT = clamp(-z / zSpan, 0.0, 1.0);
          vFade = (1.0 - smoothstep(0.46, 0.65, depthT)) * smoothstep(-0.2, -1.2, z);

          float a = aSeed4.x + uTime * 0.85 + z * 0.045;
          float rad = aSeed4.y * (0.48 + depthT * 1.55);
          // Tumble in local plane
          float spin = uTime * (1.5 + aSeed4.w * 2.2) + aSeed4.x;
          float cs = cos(spin), sn = sin(spin);
          vec3 lp = position * (0.6 + aSeed4.w * 0.75);
          vec3 rotP = vec3(lp.x * cs - lp.y * sn, lp.x * sn + lp.y * cs, lp.z);
          rotP.z += sin(spin * 0.7) * lp.x * 0.6;

          vec3 center = vec3(cos(a) * rad, sin(a) * rad * 0.78, z);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(center + rotP, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        varying float vFade;
        uniform sampler2D uCardTex;
        void main() {
          vec4 c = texture2D(uCardTex, vUv);
          gl_FragColor = vec4(c.rgb, c.a * 0.86 * vFade);
        }
      `,
    });
    this.throatShards = new THREE.InstancedMesh(shardGeo, this.throatShardMat, THROAT_SHARD_COUNT);
    this.throatShards.renderOrder = 4;
    this.throatShards.frustumCulled = false;
    this.throatGroup.add(this.throatShards);
    this.throatMaterials.push(this.throatShardMat);

    // 5d. 100% GPU-Animated Hyperspace Data-Stream Speed Lines (1 additive draw call, 0 CPU loops!)
    const lineGeo = new THREE.BoxGeometry(0.02, 0.02, 1.0);
    const lSeed = new Float32Array(THROAT_LINE_COUNT * 4);
    for (let i = 0; i < THROAT_LINE_COUNT; i++) {
      lSeed[i * 4 + 0] = (i / THROAT_LINE_COUNT) * Math.PI * 2 + Math.random() * 0.25;
      lSeed[i * 4 + 1] = 0.25 + Math.random() * 2.15;
      lSeed[i * 4 + 2] = Math.random();
      lSeed[i * 4 + 3] = 0.6 + Math.random() * 1.4;
    }
    lineGeo.setAttribute('aSeed4', new THREE.InstancedBufferAttribute(lSeed, 4));

    this.throatLineMat = new THREE.ShaderMaterial({
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthFunc: THREE.LessEqualDepth,
      stencilWrite: true,
      stencilWriteMask: 0,
      stencilRef: 1,
      stencilFunc: THREE.EqualStencilFunc,
      uniforms: {
        uTime: { value: 0 },
        uScrollPhase: { value: 0 },
        uSuction: { value: 0 },
        uInside: { value: 0 },
      },
      vertexShader: /* glsl */ `
        attribute vec4 aSeed4;
        uniform float uTime;
        uniform float uScrollPhase;
        uniform float uSuction;
        uniform float uInside;
        varying float vBright;
        void main() {
          float zSpan = 112.0;
          // Clamp front bound to -0.45 while outside monitor so lines never poke through solid screen glass!
          float maxZ = mix(-0.45, 2.0, uInside);
          float z = -zSpan + mod(aSeed4.z * zSpan + uScrollPhase * (1.65 + aSeed4.w * 0.95), zSpan + maxZ);
          float depthT = clamp(-z / zSpan, 0.0, 1.0);
          float swirl = aSeed4.x + z * 0.024 + uTime * 0.48;
          float r = aSeed4.y * (0.44 + depthT * 1.72);
          float len = (2.6 + aSeed4.w * 4.5) * (0.65 + uSuction * 2.2);
          float thick = 0.7 + uSuction * 0.85;
          vec3 lp = vec3(position.x * thick, position.y * thick, position.z * len);
          // Prevent front tip of box from crossing z = -0.08 when outside tunnel
          float tipZ = z + lp.z;
          if (uInside < 0.5) tipZ = min(tipZ, -0.08);
          vBright = (0.45 + 0.55 * fract(aSeed4.w * 7.3)) * (1.0 - smoothstep(0.88, 1.0, depthT));
          gl_Position = projectionMatrix * modelViewMatrix * vec4(cos(swirl) * r + lp.x, sin(swirl) * r * 0.78 + lp.y, tipZ, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vBright;
        void main() {
          vec3 col = mix(vec3(0.18, 0.68, 1.0), vec3(0.92, 0.98, 1.0), vBright);
          gl_FragColor = vec4(col, 0.85 * vBright);
        }
      `,
    });
    this.throatLines = new THREE.InstancedMesh(lineGeo, this.throatLineMat, THROAT_LINE_COUNT);
    this.throatLines.renderOrder = 5;
    this.throatLines.frustumCulled = false;
    this.throatGroup.add(this.throatLines);
    this.throatMaterials.push(this.throatLineMat);

    // 5e. Deep Esophageal Swallowing Ribs (only emerge deep inside the tunnel during SUCTION so mouth stays 100% single-row!)
    const fangGeo = buildParasyteToothGeometry();
    const tSeed = new Float32Array(THROAT_TOOTH_COUNT * 4);
    const teethPerRing = 36;
    for (let i = 0; i < THROAT_TOOTH_COUNT; i++) {
      const ringIdx = Math.floor(i / teethPerRing); // 0..3 deep esophageal rings
      const slot = i % teethPerRing;
      const stagger = (ringIdx % 2) * 0.5;
      tSeed[i * 4 + 0] = ringIdx;
      tSeed[i * 4 + 1] = ((slot + stagger) / teethPerRing) * Math.PI * 2;
      tSeed[i * 4 + 2] = 0.85 + ((i * 0.6180339887) % 1) * 0.65;
      tSeed[i * 4 + 3] = (i * 2.3999632) % (Math.PI * 2);
    }
    fangGeo.setAttribute('aTooth4', new THREE.InstancedBufferAttribute(tSeed, 4));

    this.throatToothMat = new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      depthWrite: true,
      depthFunc: THREE.LessEqualDepth,
      stencilWrite: true,
      stencilWriteMask: 0,
      stencilRef: 1,
      stencilFunc: THREE.EqualStencilFunc,
      uniforms: {
        uTime: { value: 0 },
        uMadness: { value: 0 },
        uJawOpen: { value: 0 },
        uSuction: { value: 0 },
        uClickPulse: { value: 0 },
      },
      vertexShader: /* glsl */ `
        attribute vec4 aTooth4;
        uniform float uTime;
        uniform float uMadness;
        uniform float uJawOpen;
        uniform float uSuction;
        uniform float uClickPulse;
        varying float vTip;
        varying vec3 vNrm;
        varying vec3 vViewPos;
        varying float vRing;
        void main() {
          float ringIdx = aTooth4.x;
          float ang = aTooth4.y;
          float lenScale = aTooth4.z;
          float phase = aTooth4.w;

          // Hidden during INSPECT_PC (uSuction == 0); strictly confined to near fleshy gullet (-9.5 .. -30.5) when swallowed!
          float insideVis = smoothstep(0.04, 0.18, uSuction);
          float ringZ = -9.5 - ringIdx * 7.0;
          float clampWave = sin(-ringZ * 0.35 - uTime * 8.0) * 0.22;
          float rad = max(1.38, 2.22 + ringIdx * 0.24 + clampWave + sin(uTime * 16.0 + phase) * 0.05);

          vec2 radialDir = vec2(cos(ang), sin(ang));
          vec2 tangentDir = vec2(-radialDir.y, radialDir.x);

          // Thick, heavy Parasyte (寄生獣) pharyngeal incisors, molars & wide carnassial blades — shoulder-to-shoulder!
          float crownY = uv.y;
          float isCarnassial = step(0.66, fract(phase * 0.3183));
          float isMolar = (1.0 - isCarnassial) * step(0.52, lenScale - 0.85);
          float h = mix(1.75, 2.35, isCarnassial) * (0.85 + 0.25 * lenScale) * insideVis;
          float w = mix(3.35, 2.85, isCarnassial) * insideVis;
          float dThick = mix(2.85, 2.35, isCarnassial) * insideVis;

          vec3 shapedP = position;
          if (isCarnassial > 0.5) {
            // Broad triangular bone-shearing blade (thick base, beveled wide cutting tip — never skinny!)
            shapedP.x *= mix(1.08, 0.38, pow(crownY, 1.7));
            shapedP.z *= mix(1.05, 0.32, crownY);
          } else if (isMolar > 0.5) {
            // Heavy crushing molar block with twin occlusal cusps
            shapedP.x *= mix(1.06, 0.96, crownY);
            shapedP.z *= mix(1.10, 0.88, crownY);
            shapedP.y += smoothstep(0.75, 1.0, crownY) * abs(position.x) * 0.26;
          } else {
            // Broad human-hybrid spade incisor with wide chisel biting edge
            shapedP.x *= mix(1.04, 0.90, pow(crownY, 1.3));
            shapedP.z *= mix(1.0, 0.34, pow(crownY, 1.35));
          }

          vec3 inwardAxis = normalize(vec3(-radialDir, -0.44));
          vec3 sideAxis = vec3(tangentDir, 0.0);
          vec3 depthAxis = normalize(cross(inwardAxis, sideAxis));

          vec3 rootPos = vec3(radialDir * rad, ringZ);
          vec3 worldLocal = rootPos
                          + sideAxis * (shapedP.x * w)
                          + inwardAxis * (shapedP.y * h)
                          + depthAxis * (shapedP.z * dThick);
          vec3 localNorm = normalize(
            sideAxis * normal.x + inwardAxis * normal.y + depthAxis * normal.z
          );

          vec4 mv = modelViewMatrix * vec4(worldLocal, 1.0);
          vViewPos = -mv.xyz;
          vNrm = normalize(normalMatrix * localNorm);
          vTip = uv.y;
          vRing = ringIdx;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vTip;
        varying vec3 vNrm;
        varying vec3 vViewPos;
        varying float vRing;
        void main() {
          vec3 N = normalize(vNrm);
          vec3 V = normalize(vViewPos);
          vec3 L1 = normalize(vec3(0.25, 0.55, 0.80));
          vec3 H1 = normalize(L1 + V);
          float diff = 0.28 + 0.72 * max(dot(N, L1), 0.0);
          float spec = pow(max(dot(N, H1), 0.0), 48.0);
          float rim = pow(1.0 - abs(dot(N, V)), 2.5);

          vec3 gumRoot = vec3(0.28, 0.016, 0.058);
          vec3 gumCollar = vec3(0.56, 0.09, 0.16);
          vec3 boneMid = vec3(0.89, 0.85, 0.77);
          vec3 razorTip = vec3(0.98, 0.97, 0.94);
          vec3 col = mix(gumRoot, gumCollar, smoothstep(0.0, 0.14, vTip));
          col = mix(col, boneMid, smoothstep(0.14, 0.34, vTip));
          col = mix(col, razorTip, smoothstep(0.38, 0.92, vTip));
          col *= diff * (1.0 - vRing * 0.10);
          col += vec3(0.95, 0.98, 1.0) * spec * 1.15;
          col += vec3(0.22, 0.72, 1.0) * rim * 0.48;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.throatTeeth = new THREE.InstancedMesh(fangGeo, this.throatToothMat, THROAT_TOOTH_COUNT);
    this.throatTeeth.renderOrder = 4;
    this.throatTeeth.frustumCulled = false;
    this.throatGroup.add(this.throatTeeth);
    this.throatMaterials.push(this.throatToothMat);

    // 6. High-Tessellation 112x64 BSOD LCD Surface Shader (SDF Razor-Sharp ':(' + Sub-LCD 3D Visage Relief!)
    const screenGeo = new THREE.PlaneGeometry(BsodScreen.LOCAL_W, BsodScreen.LOCAL_H, 112, 64);
    this.screenMat = new THREE.ShaderMaterial({
      transparent: false,
      side: THREE.DoubleSide,
      uniforms: {
        uBodyTex: { value: this.stageTextures[0] },
        uFaceTex: { value: this.faceTex },
        uNoiseTex: { value: noiseTex },
        uTime: { value: 0 },
        uHover: { value: 0 },
        uCursorUv: { value: new THREE.Vector2(0.144, 0.742) },
        uImpactUv: { value: this.impactUv.clone() },
        uMadness: { value: 0 },
        uJawOpen: { value: 0 },
        uSuction: { value: 0 },
        uClickPulse: { value: 0 },
        uCrackRun: { value: 0 },
        uAftermath: { value: 0 },
        uParenC: { value: this.parenC.clone() },
        uParenSize: { value: this.parenSize.clone() },
        uColonC: { value: this.colonC.clone() },
        uColonSize: { value: this.colonSize.clone() },
        uColonDotOff: { value: this.colonDotOff },
        uSpine: { value: this.spine.clone() },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying float vCaveDepth;
        varying vec3 vLocalPos;
        varying vec3 vWorldPos;
        varying vec3 vWorldNormal;
        uniform float uTime;
        uniform float uMadness;
        uniform float uJawOpen;
        uniform float uSuction;
        uniform float uClickPulse;
        uniform float uCrackRun;
        uniform float uHover;
        uniform vec2 uParenC;
        uniform vec2 uParenSize;
        uniform vec2 uColonC;
        uniform vec3 uSpine;

        vec4 evalParasyteChewV(float t, float madness, float jawOpen, float suction, float clickPulse) {
          float openT = clamp(jawOpen, 0.0, 1.0);
          float baseOpen = pow(openT, 0.68);
          // A living jaw: slow inhalation interrupted by sharp, irregular involuntary bites.
          // This exact equation is shared by the screen, gums, teeth, eyes and sinews.
          float alive = smoothstep(0.17, 0.62, madness) * (1.0 - smoothstep(0.10, 0.48, suction));
          float inhaleBreath = sin(t * 2.0) * 0.055 * openT;
          float spasm = pow(max(0.0, sin(t * 3.7 + sin(t * 1.13) * 1.8)), 10.0);
          float bite = spasm * 0.18 * alive * openT;
          float clickTear = clickPulse * 0.095 * smoothstep(0.08, 0.32, madness);
          float swallowUnhinge = smoothstep(0.10, 0.45, suction) * 0.38;
          float effOpen = clamp(baseOpen + inhaleBreath - bite + clickTear + swallowUnhinge, 0.0, 1.34);
          return vec4(effOpen, 0.0, 0.0, 0.0);
        }

        // Unified 4-Quadrant Parasyte Split-Head Rim:
        // Muscular jaw arches at Right (0), Upper Maxilla (pi/2), Left (pi), Lower Chin (3pi/2);
        // Deep diagonal split commissures at +-pi/4 and +-3pi/4!
        float evalMawLobeV(float ang, float openN) {
          float k = clamp(openN, 0.0, 1.25);
          float cornerFlare = pow(0.5 - 0.5 * cos(ang * 4.0), 1.55);
          float archVertical = 0.07 * pow(abs(sin(ang)), 1.4);
          // Neighbouring lobes strain in different directions instead of pulsing as a perfect ring.
          float twitch = sin(ang * 3.0 + uTime * 4.3) * 0.045
                       + sin(ang * 5.0 - uTime * 7.1) * 0.025;
          return 1.0 + (0.14 * cornerFlare + archVertical + twitch * uMadness) * k;
        }

        void main() {
          vUv = uv;
          vec3 p = position;

          vec2 mawCenter = mix(vec2(0.144, 0.742), vec2(0.48, 0.48), smoothstep(0.14, 0.88, uMadness));
          float faceScaleV = max(mix(0.35, 0.84, smoothstep(0.12, 0.90, uMadness)), 0.08);
          vec4 chewV = evalParasyteChewV(uTime, uMadness, uJawOpen, uSuction, uClickPulse);
          float openN = chewV.x;

          vec2 fLocV = (uv - mawCenter) * vec2(1.90566, 1.0) / faceScaleV;

          vec2 parenLocV = uParenC - vec2(0.5);
          float parenHalfHV = max(uParenSize.y * 0.5, 0.05);
          float halfLenV = max(mix(parenHalfHV, 0.43, pow(clamp(openN, 0.0, 1.2), 0.78)), 1e-4);
          float tvRawV = (fLocV.y - parenLocV.y) / halfLenV;
          float tvV = clamp(tvRawV, -1.0, 1.0);
          vec3 spineFV = uSpine - vec3(0.5);
          float spineHereV = 0.5 * tvV * (tvV - 1.0) * spineFV.x
                           + (1.0 - tvV * tvV) * spineFV.y
                           + 0.5 * tvV * (tvV + 1.0) * spineFV.z;
          float mouthCxV = spineHereV * (1.0 - pow(clamp(openN, 0.0, 1.0), 0.9));
          vec2 mdV = fLocV - vec2(mouthCxV, parenLocV.y);

          float crackGateV = 1.0 - smoothstep(0.04, 0.20, openN);
          float crackGrownV = smoothstep(1.0 - uCrackRun, 1.02, abs(tvV));
          float openNcV = openN * mix(1.0, crackGrownV, crackGateV);
          float safeMdXV = (abs(mdV.x) < 1e-5 && abs(mdV.y) < 1e-5) ? 1e-5 : mdV.x;
          float polarAngV = atan(mdV.y, safeMdXV);
          float mawLobeV = evalMawLobeV(polarAngV, openNcV);
          float lipProfV = pow(max(0.0, 1.0 - pow(min(abs(tvRawV), 1.0), 2.2)), 0.60);
          float slitGapeV = max(mix(0.0001, 0.24, pow(max(openNcV, 0.0), 1.15)) * lipProfV, 1e-4);
          float slitDistV = abs(mdV.x) / slitGapeV + max(0.0, abs(tvRawV) - 1.0) * 6.0;
          float circRadXV = max(mix(0.04, 0.43, pow(max(openNcV, 0.0), 0.85)), 1e-4);
          float circDistV = length(vec2(mdV.x / circRadXV, mdV.y / halfLenV)) / mawLobeV;
          float nDist = mix(slitDistV, circDistV, smoothstep(0.06, 0.30, openNcV));

          float tearOpenV = smoothstep(0.06, 0.30, openNcV);
          // Outward-peeling shattered LCD glass collar around mDist = 1.03..1.36 so 3D jaw flesh tucks cleanly behind it!
          float glassCollar = exp(-pow((nDist - 1.10) * 4.2, 2.0)) * (0.042 * openNcV + 0.018 * uClickPulse) * tearOpenV;
          // Subtle sub-LCD cranial/visage dome bulge pressing outward from behind the panel at Stages 1-3
          float subFaceDome = 0.0; // No anatomical relief beneath the display.
          float clickWave = sin(nDist * 11.0 - (1.0 - uClickPulse) * 13.0) * exp(-nDist * 1.9) * uClickPulse * 0.012;
          p.z += glassCollar + subFaceDome + clickWave;

          vCaveDepth = smoothstep(1.38, 1.00, nDist) * tearOpenV;
          vLocalPos = p;
          vec4 wpScreen = modelMatrix * vec4(p, 1.0);
          vWorldPos = wpScreen.xyz;
          vWorldNormal = normalize(mat3(modelMatrix) * vec3(0.0, 0.0, 1.0));
          gl_Position = projectionMatrix * viewMatrix * wpScreen;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        varying float vCaveDepth;
        varying vec3 vLocalPos;
        varying vec3 vWorldPos;
        varying vec3 vWorldNormal;
        uniform sampler2D uBodyTex;
        uniform sampler2D uFaceTex;
        uniform sampler2D uNoiseTex;
        uniform float uTime;
        uniform float uHover;
        uniform vec2 uCursorUv;
        uniform vec2 uImpactUv;
        uniform float uMadness;
        uniform float uJawOpen;
        uniform float uSuction;
        uniform float uClickPulse;
        uniform float uCrackRun;
        uniform float uAftermath;
        uniform vec2 uParenC;
        uniform vec2 uParenSize;
        uniform vec2 uColonC;
        uniform vec2 uColonSize;
        uniform float uColonDotOff;
        uniform vec3 uSpine;

        float hash11(float p) {
          p = fract(p * 0.1031);
          p *= p + 33.33;
          p *= p + p;
          return fract(p);
        }

        float hash21(vec2 p) {
          vec3 p3 = fract(vec3(p.xyx) * 0.1031);
          p3 += dot(p3, p3.yzx + 33.33);
          return fract((p3.x + p3.y) * p3.z);
        }

        mat2 rot2(float a) {
          float c = cos(a), s = sin(a);
          return mat2(c, -s, s, c);
        }

        vec2 faceCenterOf(float m) {
          return mix(vec2(0.144, 0.742), vec2(0.48, 0.48), smoothstep(0.14, 0.88, m));
        }

        float faceScaleOf(float m) {
          return max(mix(0.35, 0.84, smoothstep(0.12, 0.90, m)), 0.08);
        }

        vec4 evalParasyteChew(float t, float madness, float jawOpen, float suction, float clickPulse) {
          float openT = clamp(jawOpen, 0.0, 1.0);
          float baseOpen = pow(openT, 0.68);
          // A living jaw: slow inhalation interrupted by sharp, irregular involuntary bites.
          // This exact equation is shared by the screen, gums, teeth, eyes and sinews.
          float alive = smoothstep(0.17, 0.62, madness) * (1.0 - smoothstep(0.10, 0.48, suction));
          float inhaleBreath = sin(t * 2.0) * 0.055 * openT;
          float spasm = pow(max(0.0, sin(t * 3.7 + sin(t * 1.13) * 1.8)), 10.0);
          float bite = spasm * 0.18 * alive * openT;
          float clickTear = clickPulse * 0.095 * smoothstep(0.08, 0.32, madness);
          float swallowUnhinge = smoothstep(0.10, 0.45, suction) * 0.38;
          float effOpen = clamp(baseOpen + inhaleBreath - bite + clickTear + swallowUnhinge, 0.0, 1.34);
          return vec4(effOpen, 0.0, 0.0, 0.0);
        }

        float evalMawLobe(float ang, float openN) {
          float k = clamp(openN, 0.0, 1.25);
          float cornerFlare = pow(0.5 - 0.5 * cos(ang * 4.0), 1.55);
          float archVertical = 0.07 * pow(abs(sin(ang)), 1.4);
          // Neighbouring lobes strain in different directions instead of pulsing as a perfect ring.
          float twitch = sin(ang * 3.0 + uTime * 4.3) * 0.045
                       + sin(ang * 5.0 - uTime * 7.1) * 0.025;
          return 1.0 + (0.14 * cornerFlare + archVertical + twitch * uMadness) * k;
        }

        // Analytic fwidth() anti-aliased SDF sampler for 8K vector-crisp ':(' typography at any zoom!
        float sampleSdfGlyph(float rawVal) {
          float sd = rawVal - 0.5;
          float aa = clamp(fwidth(sd) * 0.95, 0.008, 0.085);
          return smoothstep(-aa, aa, sd);
        }

        // Sculpted 3D Sub-LCD Parasyte Visage Heightfield pressing against the inside of the liquid crystal panel!
        float evalSubLcdVisage(vec2 fPos, vec2 eyeA, vec2 eyeB, vec2 mouthCenter, float madness, float openN) {
          vec2 hp = fPos - vec2(0.0, 0.04);
          float skullDome = exp(-dot(hp * vec2(1.15, 0.92), hp * vec2(1.15, 0.92)) * 3.1) * 0.55;

          vec2 browA = (fPos - (eyeA + vec2(0.0, 0.085))) * vec2(2.6, 7.5);
          vec2 browB = (fPos - (eyeB + vec2(0.0, 0.095))) * vec2(2.3, 7.0);
          float brows = (exp(-dot(browA, browA)) + exp(-dot(browB, browB)) * 1.15) * 0.42;

          float sockA = exp(-dot((fPos - eyeA) * 5.6, (fPos - eyeA) * 5.6)) * 0.58;
          float sockB = exp(-dot((fPos - eyeB) * 4.6, (fPos - eyeB) * 4.6)) * 0.65;

          vec2 cheekR = (fPos - vec2(0.34, 0.08)) * vec2(3.4, 2.4);
          vec2 cheekL = (fPos - vec2(-0.34, 0.08)) * vec2(3.4, 2.4);
          float cheeks = (exp(-dot(cheekR, cheekR)) + exp(-dot(cheekL, cheekL))) * 0.44;

          vec2 mp = fPos - mouthCenter;
          float rM = length(mp);
          float angM = atan(mp.y, (abs(mp.x) < 1e-5 && abs(mp.y) < 1e-5) ? 1e-5 : mp.x);
          float splitGroove = pow(max(0.0, -cos(angM * 4.0)), 6.0) * exp(-rM * 1.8) * smoothstep(0.08, 0.45, madness) * 0.48;

          float lipTension = exp(-pow((rM - (0.16 + openN * 0.28)) * 5.5, 2.0)) * 0.36;

          return (skullDome + brows + cheeks + lipTension - sockA - sockB - splitGroove);
        }

        void main() {
          vec2 uv = vUv;

          // ---------------------------------------------------------------- 1. UNIFIED FACE & PARASYTE MAW COORDINATES
          vec2 faceCenter = faceCenterOf(uMadness);
          float faceScale = faceScaleOf(uMadness);

          vec2 parenLocal = uParenC - vec2(0.5);
          vec2 colonLocal = uColonC - vec2(0.5);
          float parenHalfH = max(uParenSize.y * 0.5, 0.05);
          float eyeOff = abs(uColonDotOff);

          vec4 chew = evalParasyteChew(uTime, uMadness, uJawOpen, uSuction, uClickPulse);
          float openN = chew.x;

          float fastTick = floor(uTime * 36.0);
          vec2 clickTremor = vec2(hash21(vec2(fastTick, 1.7)) - 0.5, hash21(vec2(fastTick, 9.3)) - 0.5)
                           * (0.010 * uClickPulse);

          vec2 aspectDelta = (uv - faceCenter + clickTremor) * vec2(1.90566, 1.0);
          vec2 fLocal = aspectDelta / faceScale;

          float halfLen = max(mix(parenHalfH, 0.43, pow(clamp(openN, 0.0, 1.2), 0.78)), 1e-4);
          float tvRaw = (fLocal.y - parenLocal.y) / halfLen;
          float tv0 = clamp(tvRaw, -1.0, 1.0);

          vec3 spineF = uSpine - vec3(0.5);
          float spineHere = 0.5 * tv0 * (tv0 - 1.0) * spineF.x
                          + (1.0 - tv0 * tv0) * spineF.y
                          + 0.5 * tv0 * (tv0 + 1.0) * spineF.z;
          float mouthCx = mix(spineHere, 0.0, pow(clamp(openN, 0.0, 1.0), 0.9));
          vec2 md = fLocal - vec2(mouthCx, parenLocal.y);
          float safeMdX = (abs(md.x) < 1e-5 && abs(md.y) < 1e-5) ? 1e-5 : md.x;
          float polarAng = atan(md.y, safeMdX);

          float lipProf = pow(max(0.0, 1.0 - pow(min(abs(tvRaw), 1.0), 2.2)), 0.60);
          float crackGate = 1.0 - smoothstep(0.04, 0.20, openN);
          float crackGrown = smoothstep(1.0 - uCrackRun, 1.02, abs(tv0));
          float openNc = openN * mix(1.0, crackGrown, crackGate);

          float slitGape = max(mix(0.0001, 0.24, pow(max(openNc, 0.0), 1.15)) * lipProf, 1e-4);
          float slitDist = abs(md.x) / slitGape + max(0.0, abs(tvRaw) - 1.0) * 6.0;
          float circRadX = max(mix(0.04, 0.43, pow(max(openNc, 0.0), 0.85)), 1e-4);
          float mawWobble = evalMawLobe(polarAng, openNc);
          float circleDist = length(vec2(md.x / circRadX, md.y / halfLen)) / mawWobble;
          float mDist = mix(slitDist, circleDist, smoothstep(0.06, 0.30, openNc));

          float mEdge = exp(-pow((mDist - 1.04) * 28.0, 2.0));
          float mStress = smoothstep(2.0, 1.0, mDist);

          // Discard cleanly inside mDist < 1.03 so the 3D sculpted Parasyte jaws & gum-socketed teeth emerge from behind!
          float tearOpen = smoothstep(0.06, 0.26, openNc);
          float portalOpen = smoothstep(0.03, 0.16, uSuction);
          if (uAftermath < 0.5 && portalOpen > 0.01 && mDist < portalOpen * 1.03) discard;

          // ---------------------------------------------------------------- 2. LCD PANEL & TACTILE IMPACT REFRACTION
          vec4 noiseA = texture2D(uNoiseTex, uv * vec2(3.2, 1.8) + vec2(0.0, uTime * 0.04));
          vec4 noiseB = texture2D(uNoiseTex, uv * vec2(7.5, 4.2) - vec2(uTime * 0.03, 0.0));

          vec2 impDelta = (uv - uImpactUv) * vec2(1.90566, 1.0);
          float impDist = length(impDelta);
          float ringRadius = (1.0 - uClickPulse) * 0.68;
          float impWave = exp(-pow((impDist - ringRadius) * 12.0, 2.0)) * uClickPulse;
          vec2 impDir = impDist > 1e-4 ? impDelta / impDist : vec2(0.0, 1.0);

          float tearAmt = uMadness * 0.028 + uClickPulse * 0.040;
          float band = floor(uv.y * (30.0 + uMadness * 34.0));
          float tick = floor(uTime * (12.0 + uMadness * 22.0));
          float bandRnd = hash21(vec2(band, tick));
          float bandShift = step(0.90 - uMadness * 0.24, bandRnd) * (bandRnd - 0.5) * 2.0 * (tearAmt * 0.38);

          vec2 bodyUv = uv + vec2(bandShift, 0.0) + impDir * impWave * 0.014;

          float vortexHalo = exp(-pow(length(md) * 2.4, 2.0)) * smoothstep(0.04, 0.50, openN);
          if (vortexHalo > 0.002) {
            vec2 dirLocal = normalize(md + vec2(1e-5, 0.0));
            vec2 swirlLocal = rot2(0.36 * openN) * dirLocal;
            vec2 dirUv = normalize(swirlLocal * faceScale * vec2(1.0 / 1.90566, 1.0) + vec2(1e-6, 0.0));
            bodyUv -= dirUv * (0.048 * vortexHalo * openN + 0.024 * mEdge * openN);
          }
          bodyUv = clamp(bodyUv, 0.001, 0.999);

          float chr = uMadness * 0.0038 + uClickPulse * 0.009 + mStress * openN * 0.007 + impWave * 0.011;
          vec3 panel;
          panel.r = texture2D(uBodyTex, clamp(bodyUv + vec2(chr, 0.0), 0.001, 0.999)).r;
          panel.g = texture2D(uBodyTex, bodyUv).g;
          panel.b = texture2D(uBodyTex, clamp(bodyUv - vec2(chr, 0.0), 0.001, 0.999)).b;

          vec3 col = mix(vec3(0.0, 0.4706, 0.8392), panel, clamp(length(panel) * 1.6, 0.0, 1.0));

          if (uAftermath < 0.5) {
            // ---------------------------------------------------------------- 3. SUB-LCD 3D VISAGE RELIEF & SHATTERED GLASS
            vec3 newton = 0.5 + 0.5 * cos(6.28318 * (impDist * 7.5 - uTime * 2.0 + vec3(0.0, 0.33, 0.67)));
            col = mix(col, col * (0.58 + 0.68 * newton), impWave * 0.52);

            float eyeMorph = smoothstep(0.12, 0.46, uMadness);
            vec2 eyeALocal = mix(colonLocal + vec2(0.0, eyeOff), vec2(0.22, parenLocal.y + halfLen * 0.88 + 0.09), eyeMorph);
            vec2 eyeBLocal = mix(colonLocal - vec2(0.0, eyeOff), vec2(-0.24, parenLocal.y + halfLen * 0.88 + 0.11), eyeMorph);

            // The face is made of screen signal, not anatomy: displaced scan rows,
            // duplicated glyphs and a rectangular digital void beneath the glyph.
            float digitalFace = smoothstep(0.10, 0.45, uMadness);
            vec2 blockCoord = floor(fLocal * vec2(26.0, 22.0));
            float blockNoise = hash21(blockCoord + floor(uTime * 8.0));
            float voidShape = 1.0 - smoothstep(0.82, 1.08, mDist + (blockNoise - 0.5) * 0.14);
            col = mix(col, vec3(0.002, 0.015, 0.065), voidShape * digitalFace * 0.84);
            float signalBand = step(0.94 - uMadness * 0.08, blockNoise) * digitalFace;
            col += vec3(0.08, 0.35, 0.8) * signalBand * 0.3;

            if (uMadness > 0.04) {
              // Razor-sharp shattered-LCD glass fractures radiating from the splitting face
              vec2 crackDelta = (uv - faceCenter) * vec2(1.90566, 1.0);
              float crackDist = length(crackDelta);
              float safeCx = (abs(crackDelta.x) < 1e-5 && abs(crackDelta.y) < 1e-5) ? 1e-5 : crackDelta.x;
              float crackAng = atan(crackDelta.y, safeCx);
              float crackReach = 0.16 + pow(uMadness, 0.80) * 1.10;
              float webMask = smoothstep(crackReach, crackReach * 0.10, crackDist) * smoothstep(0.03, 0.16, uMadness);

              float jagA = (noiseB.r - 0.5) * 0.36 + (noiseA.g - 0.5) * 0.16;
              float spoke4 = abs(fract((crackAng * 0.1591549 + 0.375) * 4.0 + jagA * 0.45) - 0.5);
              float spoke13 = abs(fract((crackAng * 0.1591549 + 0.5) * 13.0 - jagA * 1.1) - 0.5);
              float ringWeb = abs(fract(crackDist * 7.2 + noiseB.g * 0.75 + sin(crackAng * 4.0) * 0.16) - 0.5);

              float mainCrack = smoothstep(0.015, 0.0025, spoke4) * webMask;
              float branchCrack = smoothstep(0.013, 0.0025, spoke13) * step(0.42, noiseA.r) * webMask * smoothstep(0.10, 0.42, uMadness);
              float ringCrack = smoothstep(0.014, 0.0025, ringWeb) * step(0.48, noiseB.b) * webMask * smoothstep(0.18, 0.55, uMadness);

              float crackCore = clamp(max(max(mainCrack, branchCrack), ringCrack), 0.0, 1.0);
              float crackBruise = clamp((smoothstep(0.048, 0.006, spoke4) * 0.62 + smoothstep(0.040, 0.006, spoke13) * 0.35) * webMask, 0.0, 1.0);

              col *= 1.0 - crackBruise * (0.30 + 0.22 * uMadness);
              col = mix(col, vec3(0.002, 0.005, 0.016), crackCore * 0.96);
              float bevelEdge = smoothstep(0.022, 0.014, spoke4) * (1.0 - mainCrack) * webMask;
              col += vec3(0.16, 0.28, 0.42) * bevelEdge;
            }

            // ---------------------------------------------------------------- 4. ULTRA-CRISP SDF ':(' TYPOGRAPHY -> BIOMECHANICAL SPLIT
            // No idle jump-scare: the initial glyph remains a perfectly still, recognisable
            // BSOD mark. The player must create the fault before the signal deforms.
            float stage0Betrayal = 0.0;
            float stage1Rictus = 0.0;
            float smileFlip = 0.0;

            vec2 cursorPullF = clamp((uCursorUv - faceCenter) * vec2(1.90566, 1.0), vec2(-0.42), vec2(0.42))
                             * (0.032 * uHover + 0.055 * uMadness);
            vec2 eyeUv = vec2(0.5) + (fLocal - cursorPullF);

            float glyphEyeFade = 1.0;
            float eyesInk = 0.0;
            if (glyphEyeFade > 0.005 && eyeUv.x > 0.01 && eyeUv.x < 0.99 && eyeUv.y > 0.01 && eyeUv.y < 0.99) {
              eyesInk = sampleSdfGlyph(texture2D(uFaceTex, eyeUv).r) * glyphEyeFade;
            }

            float jawFade = 1.0;
            float splitSpread = pow(uMadness, 1.35) * 0.11 + openN * 0.24;
            float mouthLocalX = mix(fLocal.x, parenLocal.x * 2.0 - fLocal.x, smileFlip);
            float mouthLocalY = parenLocal.y + (fLocal.y - parenLocal.y) / (1.0 + smoothstep(0.06, 0.32, uMadness) * 0.18);

            float mouthInk = 0.0;
            if (jawFade > 0.005) {
              vec2 jawUvA = vec2(0.5) + vec2(mouthLocalX + splitSpread, mouthLocalY);
              if (jawUvA.x > 0.01 && jawUvA.x < 0.99 && jawUvA.y > 0.01 && jawUvA.y < 0.99) {
                mouthInk = sampleSdfGlyph(texture2D(uFaceTex, jawUvA).g);
              }
              float braceWeight = smoothstep(0.10, 0.24, uMadness);
              if (braceWeight > 0.01) {
                vec2 jawUvB = vec2(0.5) + vec2((parenLocal.x * 2.0 - fLocal.x) - splitSpread, mouthLocalY);
                if (jawUvB.x > 0.01 && jawUvB.x < 0.99 && jawUvB.y > 0.01 && jawUvB.y < 0.99) {
                  mouthInk = max(mouthInk, sampleSdfGlyph(texture2D(uFaceTex, jawUvB).g) * braceWeight);
                }
              }
              mouthInk *= jawFade;
            }

            // Horizontal packet loss and offset copies make the original typography
            // appear to desynchronise and watch the pointer, without becoming an animal.
            float row = floor(fLocal.y * 30.0);
            float frame = floor(uTime * (7.0 + uMadness * 8.0));
            float rowFault = step(0.70, hash21(vec2(row, frame))) * digitalFace;
            vec2 echoUv = vec2(0.5) + fLocal + vec2((hash21(vec2(row + 4.0, frame)) - 0.5) * 0.16 * uMadness, 0.0);
            float echoInk = 0.0;
            if (echoUv.x > 0.01 && echoUv.x < 0.99 && echoUv.y > 0.01 && echoUv.y < 0.99) {
              vec4 echo = texture2D(uFaceTex, echoUv);
              echoInk = max(sampleSdfGlyph(echo.r), sampleSdfGlyph(echo.g)) * rowFault;
            }
            float faceInk = clamp(eyesInk + mouthInk, 0.0, 1.0);
            col = mix(col, vec3(0.10, 0.85, 1.0), echoInk * 0.65);
            col = mix(col, vec3(1.0), faceInk);

            if (eyesInk > 0.05 && (uHover > 0.05 || uMadness > 0.02 || stage0Betrayal > 0.5)) {
              float dDotA = length((fLocal - (colonLocal + vec2(0.0, eyeOff)) - cursorPullF * 1.35) * vec2(1.45, 0.90));
              float dDotB = length((fLocal - (colonLocal - vec2(0.0, eyeOff)) - cursorPullF * 1.35) * vec2(1.45, 0.90));
              float slitIris = step(min(dDotA, dDotB), 0.014)
                             * clamp(uHover * 0.28 + uMadness * 2.0 + stage0Betrayal * 0.6, 0.0, 0.8);
              col = mix(col, vec3(0.005, 0.02, 0.06), slitIris * eyesInk);
            }

            // ---------------------------------------------------------------- 5. TORN-LCD COLLAR BEVEL AROUND THE 3D JAW BREACH
            if (openN > 0.004) {
              float collarShadow = smoothstep(1.42, 1.03, mDist) * tearOpen;
              col *= mix(1.0, 0.42, collarShadow * 0.82);

              float jaggedGlassRim = exp(-pow((mDist - 1.055 + (noiseB.r - 0.5) * 0.035) * 34.0, 2.0)) * tearOpen;
              col = mix(col, vec3(0.004, 0.012, 0.032), clamp(mEdge * 0.88, 0.0, 0.92));
              col += vec3(0.55, 0.86, 1.0) * jaggedGlassRim * 0.58;
            }
          } else {
            float scar = smoothstep(0.004, 0.0, abs((uv.y - 0.52) + (uv.x - 0.48) * 0.62 + sin(uv.x * 26.0) * 0.012))
                       * smoothstep(0.32, 0.05, length(uv - vec2(0.48, 0.52)));
            vec2 ghostEyeA = uv - (vec2(0.148, 0.685) + (uCursorUv - 0.5) * 0.012);
            vec2 ghostEyeB = uv - (vec2(0.148, 0.618) + (uCursorUv - 0.5) * 0.012);
            float ghostGlint = (exp(-length(ghostEyeA * vec2(1.9, 1.0)) * 95.0) + exp(-length(ghostEyeB * vec2(1.9, 1.0)) * 95.0))
                             * (0.35 + 0.65 * pow(0.5 + 0.5 * sin(uTime * 1.4), 4.0));
            col += vec3(0.45, 0.80, 1.0) * scar * 0.42 + vec3(0.95, 0.18, 0.32) * ghostGlint * 0.48;
          }

          float glassSheen = pow(max(0.0, 1.0 - length((uv - vec2(0.74, 0.68)) * vec2(1.2, 1.0))), 3.0) * 0.035;
          col += vec3(0.45, 0.65, 0.95) * glassSheen * (1.0 - uMadness * 0.6);

          // Realistic IPS LCD off-axis polarizer contrast shift (clean optical glass behavior — zero crude ghost face!)
          vec3 viewDirW = normalize(cameraPosition - vWorldPos);
          float ndvScreen = clamp(abs(dot(normalize(vWorldNormal), viewDirW)), 0.0, 1.0);
          float offAxis = smoothstep(0.68, 0.18, ndvScreen);
          if (offAxis > 0.01) {
            vec3 ipsGlow = vec3(0.05, 0.16, 0.34) * offAxis;
            col = col * mix(1.0, 0.86, offAxis) + ipsGlow * 0.28;
          }

          vec2 px = uv * vec2(1920.0, 1080.0);
          float subpx = 0.976 + 0.024 * sin(px.x * 3.14159);
          float scan = 0.986 + 0.014 * sin(px.y * 3.14159);
          col *= subpx * scan;

          vec2 vigUv = uv * (1.0 - uv.yx);
          float vig = pow(clamp(vigUv.x * vigUv.y * 18.0, 0.0, 1.0), 0.16);
          col *= mix(0.78, 0.99, vig);

          gl_FragColor = vec4(clamp(col, 0.0, 4.0), 1.0);
        }
      `,
    });

    this.screenMesh = new THREE.Mesh(screenGeo, this.screenMat);
    this.screenMesh.renderOrder = 5;
    this.root.add(this.screenMesh);

    // 6a. TRUE 3D PARASYTE-STYLE SCULPTED JAW, SOCKETED DENTITION & ORBITAL EYE RIG
    this.parasyteGroup.visible = false;
    this.root.add(this.parasyteGroup);

    const rimToothGeo = buildParasyteToothGeometry();
    const rimSeed = new Float32Array(RIM_TOOTH_COUNT * 4);
    for (let i = 0; i < RIM_TOOTH_COUNT; i++) {
      // Each of the 52 teeth is seated in its own anatomical alveolar gum socket around the 4 jaw lobes!
      const jitterAng = (((i * 0.75487766) % 1) - 0.5) * (0.14 / RIM_TOOTH_COUNT) * Math.PI * 2;
      rimSeed[i * 4 + 0] = ((i + 0.5) / RIM_TOOTH_COUNT) * Math.PI * 2 + jitterAng;
      rimSeed[i * 4 + 1] = i / RIM_TOOTH_COUNT;
      rimSeed[i * 4 + 2] = (i * 0.61803398875) % 1;
      rimSeed[i * 4 + 3] = (i * 2.39996323) % 1;
    }
    rimToothGeo.setAttribute('aRimTooth4', new THREE.InstancedBufferAttribute(rimSeed, 4));

    this.rimToothMat = new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      depthTest: true,
      depthWrite: true,
      uniforms: {
        uTime: { value: 0 },
        uMadness: { value: 0 },
        uJawOpen: { value: 0 },
        uSuction: { value: 0 },
        uClickPulse: { value: 0 },
        uCrackRun: { value: 0 },
        uParenC: { value: this.parenC.clone() },
        uParenSize: { value: this.parenSize.clone() },
        uSpine: { value: this.spine.clone() },
      },
      vertexShader: /* glsl */ `
        attribute vec4 aRimTooth4;
        uniform float uTime;
        uniform float uMadness;
        uniform float uJawOpen;
        uniform float uSuction;
        uniform float uClickPulse;
        uniform float uCrackRun;
        uniform vec2 uParenC;
        uniform vec2 uParenSize;
        uniform vec3 uSpine;
        varying float vCrown;
        varying float vSideU;
        varying float vMorph;
        varying vec3 vNrm;
        varying vec3 vViewPos;

        vec4 evalParasyteChewT(float t, float madness, float jawOpen, float suction, float clickPulse) {
          float openT = clamp(jawOpen, 0.0, 1.0);
          float baseOpen = pow(openT, 0.68);
          // A living jaw: slow inhalation interrupted by sharp, irregular involuntary bites.
          // This exact equation is shared by the screen, gums, teeth, eyes and sinews.
          float alive = smoothstep(0.17, 0.62, madness) * (1.0 - smoothstep(0.10, 0.48, suction));
          float inhaleBreath = sin(t * 2.0) * 0.055 * openT;
          float spasm = pow(max(0.0, sin(t * 3.7 + sin(t * 1.13) * 1.8)), 10.0);
          float bite = spasm * 0.18 * alive * openT;
          float clickTear = clickPulse * 0.095 * smoothstep(0.08, 0.32, madness);
          float swallowUnhinge = smoothstep(0.10, 0.45, suction) * 0.38;
          float effOpen = clamp(baseOpen + inhaleBreath - bite + clickTear + swallowUnhinge, 0.0, 1.34);
          return vec4(effOpen, 0.0, 0.0, 0.0);
        }

        float evalMawLobeT(float ang, float openN) {
          float k = clamp(openN, 0.0, 1.25);
          float cornerFlare = pow(0.5 - 0.5 * cos(ang * 4.0), 1.55);
          float archVertical = 0.07 * pow(abs(sin(ang)), 1.4);
          // Neighbouring lobes strain in different directions instead of pulsing as a perfect ring.
          float twitch = sin(ang * 3.0 + uTime * 4.3) * 0.045
                       + sin(ang * 5.0 - uTime * 7.1) * 0.025;
          return 1.0 + (0.14 * cornerFlare + archVertical + twitch * uMadness) * k;
        }

        void main() {
          float ang = aRimTooth4.x;
          float morph = aRimTooth4.z;
          float phase = aRimTooth4.w;

          vec2 mawCenter = mix(vec2(0.144, 0.742), vec2(0.48, 0.48), smoothstep(0.14, 0.88, uMadness));
          float faceScale = max(mix(0.35, 0.84, smoothstep(0.12, 0.90, uMadness)), 0.08);
          vec4 chew = evalParasyteChewT(uTime, uMadness, uJawOpen, uSuction, uClickPulse);
          float openN = chew.x;

          vec2 parenLoc = uParenC - vec2(0.5);
          float parenHalfH = max(uParenSize.y * 0.5, 0.05);
          float halfLen = max(mix(parenHalfH, 0.43, pow(clamp(openN, 0.0, 1.2), 0.78)), 1e-4);
          vec2 dir2 = vec2(cos(ang), sin(ang));
          float tv = clamp(dir2.y, -1.0, 1.0);
          vec3 spineF = uSpine - vec3(0.5);
          float spineHere = 0.5 * tv * (tv - 1.0) * spineF.x
                          + (1.0 - tv * tv) * spineF.y
                          + 0.5 * tv * (tv + 1.0) * spineF.z;
          float mouthCx = spineHere * (1.0 - pow(clamp(openN, 0.0, 1.0), 0.9));

          float crackGate = 1.0 - smoothstep(0.04, 0.20, openN);
          float crackGrown = smoothstep(1.0 - uCrackRun, 1.02, abs(tv));
          float openNc = openN * mix(1.0, crackGrown, crackGate);
          float emerge = smoothstep(0.06, 0.24, openNc);
          float circRadX = max(mix(0.04, 0.43, pow(max(openNc, 0.0), 0.85)), 1e-4);
          float mawLobe = evalMawLobeT(ang, openNc);

          // Seated directly inside the v = 0.34 alveolar gum crest of jawFlapsMesh (radFactor = 0.955)!
          vec2 mdRoot = vec2(dir2.x * circRadX, dir2.y * halfLen) * (mawLobe * 0.955);
          vec2 fRoot = vec2(mouthCx, parenLoc.y) + mdRoot;
          vec2 posXY = (mawCenter - 0.5) * vec2(1.90566, 1.0) + fRoot * faceScale;

          float lobeArch = 0.52 + 0.48 * (0.5 + 0.5 * cos(ang * 4.0));
          float gumCrestZ = (0.158 * clamp(openNc, 0.0, 1.25) + uClickPulse * 0.032) * lobeArch * emerge;
          vec3 rootPos = vec3(posXY, gumCrestZ - 0.014 * emerge);

          // Parasyte (寄生獣) anatomical dental arch differentiation:
          // - Split-jaw commissures (cos(4*ang) < 0): thick, wide bone-shearing carnassial blades!
          // - Upper/lower central arches (|sin(ang)| > 0.74): iconic thick human-hybrid flat spade incisors!
          // - Lateral mandible arches: heavy crushing bicuspid/molar crowns!
          float splitCorner = pow(0.5 - 0.5 * cos(ang * 4.0), 2.0);
          float isCarnassial = step(0.56, splitCorner);
          float isCentralIncisor = (1.0 - isCarnassial) * step(0.74, abs(dir2.y));
          float isMolar = (1.0 - isCarnassial) * (1.0 - isCentralIncisor);
          float grow = emerge * smoothstep(0.02, 0.20, clamp(uJawOpen * 1.4 + uMadness * 0.22, 0.0, 1.0));

          float crownY = uv.y;
          vec3 shapedPos = position;
          if (isCarnassial > 0.5) {
            // Thick, wide Parasyte shearing fang at the 4 jaw-split corners (broad root & mid-blade, never thin!)
            shapedPos.x *= mix(1.10, 0.38, pow(crownY, 1.70));
            shapedPos.z *= mix(1.12, 0.32, crownY);
          } else if (isMolar > 0.5) {
            // Heavy lateral molar with broad labio-lingual bulk & bicuspid occlusal saddle
            shapedPos.x *= mix(1.08, 0.96, crownY);
            shapedPos.z *= mix(1.16, 0.88, crownY);
            shapedPos.y += smoothstep(0.68, 1.0, crownY) * abs(sin(uv.x * 6.28318)) * 0.012;
          } else {
            // Iconic Parasyte oversized human-hybrid spade incisor — thick root & broad chisel edge!
            shapedPos.x *= mix(1.06, 0.94, pow(crownY, 1.35));
            shapedPos.z *= mix(1.06, 0.34, pow(crownY, 1.25));
          }

          float wScale = mix(mix(1.32, 1.40, isMolar), 1.28, isCarnassial) * faceScale * (0.62 + 0.38 * grow) * step(0.01, grow);
          float dScale = mix(mix(1.22, 1.38, isMolar), 1.26, isCarnassial) * faceScale * (0.62 + 0.38 * grow) * step(0.01, grow);
          float hScale = mix(mix(0.56 + morph * 0.10, 0.48 + morph * 0.08, isMolar), 0.78 + morph * 0.20, isCarnassial) * faceScale * grow;

          float microTremor = sin(uTime * 17.0 + phase * 6.283) * 0.008 * uMadness;
          float inwardAmt = 0.50 + microTremor;
          float forwardZ = 0.76;
          float cant = (morph - 0.5) * 0.08;
          vec2 tang2 = vec2(-dir2.y, dir2.x);
          vec3 toothAxis = normalize(vec3(-dir2 * inwardAmt + tang2 * cant, forwardZ));
          vec3 sideAxis = normalize(vec3(tang2, -cant * 0.2));
          vec3 hookAxis = normalize(cross(sideAxis, toothAxis));

          vec3 localPos = rootPos
                        + sideAxis * (shapedPos.x * wScale)
                        + toothAxis * (shapedPos.y * hScale)
                        + hookAxis * (shapedPos.z * dScale);
          vec3 localNorm = normalize(
            sideAxis * normal.x + toothAxis * normal.y + hookAxis * normal.z
          );

          vec4 mv = modelViewMatrix * vec4(localPos, 1.0);
          vViewPos = -mv.xyz;
          vNrm = normalize(normalMatrix * localNorm);
          vCrown = uv.y;
          vSideU = uv.x;
          vMorph = morph;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vCrown;
        varying float vSideU;
        varying float vMorph;
        varying vec3 vNrm;
        varying vec3 vViewPos;

        void main() {
          vec3 N = normalize(gl_FrontFacing ? vNrm : -vNrm);
          vec3 V = normalize(vViewPos);
          vec3 Lkey = normalize(vec3(0.28, 0.58, 0.76));
          vec3 Lfill = normalize(vec3(-0.48, -0.22, 0.85));
          vec3 Lrim = normalize(vec3(0.0, 0.15, -0.98));
          vec3 H = normalize(Lkey + V);
          vec3 H2 = normalize(Lfill + V);

          // Subsurface enamel/dentin wrap diffuse + interproximal & gingival sulcus ambient occlusion!
          float ndl = dot(N, Lkey);
          float wrapDiff = clamp((ndl + 0.35) / 1.35, 0.0, 1.0);
          float fillDiff = max(dot(N, Lfill), 0.0) * 0.26;
          float backScatter = pow(max(dot(-N, Lrim), 0.0), 1.6) * smoothstep(0.35, 0.98, vCrown);

          // Interproximal contact shadow at mesial/distal edges of the tooth crown
          float interprox = abs(sin(vSideU * 6.2831853));
          float aoSulcus = smoothstep(0.0, 0.22, vCrown);
          float aoInterprox = mix(0.62, 1.0, 1.0 - pow(interprox, 3.0) * (1.0 - smoothstep(0.15, 0.78, vCrown)));
          float ao = (0.38 + 0.62 * aoSulcus) * aoInterprox;

          // Subtle vertical perikymata/enamel developmental flutes
          float enamelFlutes = 0.97 + 0.03 * sin(vSideU * 62.8318);

          // Inflamed gingival sulcus -> organic warm root cementum/dentin -> translucent pearlescent incisal enamel!
          vec3 sulcusDark = vec3(0.16, 0.008, 0.028);
          vec3 cervicalGingiva = vec3(0.48, 0.08, 0.14);
          vec3 warmDentin = mix(vec3(0.84, 0.78, 0.66), vec3(0.88, 0.84, 0.76), vMorph * 0.5);
          vec3 crownEnamel = vec3(0.95, 0.95, 0.93) * enamelFlutes;
          vec3 incisalTranslucent = vec3(0.82, 0.90, 0.98);

          vec3 albedo = mix(sulcusDark, cervicalGingiva, smoothstep(0.0, 0.10, vCrown));
          albedo = mix(albedo, warmDentin, smoothstep(0.09, 0.28, vCrown));
          albedo = mix(albedo, crownEnamel, smoothstep(0.28, 0.72, vCrown));
          albedo = mix(albedo, incisalTranslucent, smoothstep(0.80, 1.0, vCrown) * 0.45);

          float wetSpec = pow(max(dot(N, H), 0.0), 88.0) * 1.55 + pow(max(dot(N, H2), 0.0), 36.0) * 0.42;
          float fresnel = pow(1.0 - abs(dot(N, V)), 3.2);

          vec3 col = albedo * (0.18 + 0.82 * wrapDiff + fillDiff) * ao;
          col += vec3(0.96, 0.99, 1.0) * wetSpec * (0.55 + 0.45 * vCrown);
          col += vec3(0.32, 0.78, 1.0) * (fresnel * 0.34 + backScatter * 0.32);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.rimTeethMesh = new THREE.InstancedMesh(rimToothGeo, this.rimToothMat, RIM_TOOTH_COUNT);
    this.rimTeethMesh.renderOrder = 7;
    this.rimTeethMesh.frustumCulled = false;
    this.parasyteGroup.add(this.rimTeethMesh);

    // 6a-2. 32 Wet Mucosa & Saliva Strands stretched across the 4 diagonal jaw-split commissures!
    const sinewGeo = new THREE.CylinderGeometry(0.0046, 0.0046, 1.0, 6, 14);
    const sinSeed = new Float32Array(SINEW_COUNT * 4);
    for (let i = 0; i < SINEW_COUNT; i++) {
      // Cluster strands across the 4 diagonal Parasyte split clefts (+-pi/4, +-3pi/4) so they stretch between adjacent jaw lobes!
      const cleftIdx = i % 4;
      const cleftCenter = (cleftIdx + 0.5) * Math.PI * 0.5;
      const rank = Math.floor(i / 4) / Math.max(1, SINEW_COUNT / 4 - 1);
      const halfSpan = 0.14 + rank * 0.42 + (((i * 0.618034) % 1) - 0.5) * 0.06;
      sinSeed[i * 4 + 0] = cleftCenter - halfSpan;
      sinSeed[i * 4 + 1] = cleftCenter + halfSpan;
      sinSeed[i * 4 + 2] = 0.25 + rank * 0.65;
      sinSeed[i * 4 + 3] = (i * 0.754877) % 1;
    }
    sinewGeo.setAttribute('aSinew4', new THREE.InstancedBufferAttribute(sinSeed, 4));

    this.sinewMat = new THREE.ShaderMaterial({
      transparent: true,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uMadness: { value: 0 },
        uJawOpen: { value: 0 },
        uSuction: { value: 0 },
        uClickPulse: { value: 0 },
        uCrackRun: { value: 0 },
        uParenC: { value: this.parenC.clone() },
        uParenSize: { value: this.parenSize.clone() },
        uSpine: { value: this.spine.clone() },
      },
      vertexShader: /* glsl */ `
        attribute vec4 aSinew4;
        uniform float uTime;
        uniform float uMadness;
        uniform float uJawOpen;
        uniform float uSuction;
        uniform float uClickPulse;
        uniform float uCrackRun;
        uniform vec2 uParenC;
        uniform vec2 uParenSize;
        uniform vec3 uSpine;
        varying float vAlong;
        varying vec3 vNrm;
        varying vec3 vViewPos;
        varying float vAlpha;

        vec4 evalParasyteChewS(float t, float madness, float jawOpen, float suction, float clickPulse) {
          float openT = clamp(jawOpen, 0.0, 1.0);
          float baseOpen = pow(openT, 0.68);
          // A living jaw: slow inhalation interrupted by sharp, irregular involuntary bites.
          // This exact equation is shared by the screen, gums, teeth, eyes and sinews.
          float alive = smoothstep(0.17, 0.62, madness) * (1.0 - smoothstep(0.10, 0.48, suction));
          float inhaleBreath = sin(t * 2.0) * 0.055 * openT;
          float spasm = pow(max(0.0, sin(t * 3.7 + sin(t * 1.13) * 1.8)), 10.0);
          float bite = spasm * 0.18 * alive * openT;
          float clickTear = clickPulse * 0.095 * smoothstep(0.08, 0.32, madness);
          float swallowUnhinge = smoothstep(0.10, 0.45, suction) * 0.38;
          float effOpen = clamp(baseOpen + inhaleBreath - bite + clickTear + swallowUnhinge, 0.0, 1.34);
          return vec4(effOpen, 0.0, 0.0, 0.0);
        }

        float evalMawLobeS(float ang, float openN) {
          float k = clamp(openN, 0.0, 1.25);
          float cornerFlare = pow(0.5 - 0.5 * cos(ang * 4.0), 1.55);
          float archVertical = 0.07 * pow(abs(sin(ang)), 1.4);
          // Neighbouring lobes strain in different directions instead of pulsing as a perfect ring.
          float twitch = sin(ang * 3.0 + uTime * 4.3) * 0.045
                       + sin(ang * 5.0 - uTime * 7.1) * 0.025;
          return 1.0 + (0.14 * cornerFlare + archVertical + twitch * uMadness) * k;
        }

        vec3 anchorOnJaw(float ang, float radialMul, float openN, vec2 mawCenter, float faceScale, vec2 parenLoc, float halfLen) {
          vec2 dir = vec2(cos(ang), sin(ang));
          float tv = clamp(dir.y, -1.0, 1.0);
          vec3 spineF = uSpine - vec3(0.5);
          float spineHere = 0.5 * tv * (tv - 1.0) * spineF.x
                          + (1.0 - tv * tv) * spineF.y
                          + 0.5 * tv * (tv + 1.0) * spineF.z;
          float mouthCx = spineHere * (1.0 - pow(clamp(openN, 0.0, 1.0), 0.9));
          float crackGate = 1.0 - smoothstep(0.04, 0.20, openN);
          float crackGrown = smoothstep(1.0 - uCrackRun, 1.02, abs(tv));
          float openNc = openN * mix(1.0, crackGrown, crackGate);
          float emerge = smoothstep(0.06, 0.24, openNc);
          float circRadX = max(mix(0.04, 0.43, pow(max(openNc, 0.0), 0.85)), 1e-4);
          float lobe = evalMawLobeS(ang, openNc);
          vec2 fPos = vec2(mouthCx, parenLoc.y) + vec2(dir.x * circRadX, dir.y * halfLen) * (lobe * radialMul);
          vec2 xy = (mawCenter - 0.5) * vec2(1.90566, 1.0) + fPos * faceScale;
          float lobeArch = 0.52 + 0.48 * (0.5 + 0.5 * cos(ang * 4.0));
          float z = (0.145 * clamp(openNc, 0.0, 1.25)) * lobeArch * emerge;
          return vec3(xy, z);
        }

        void main() {
          float angA = aSinew4.x;
          float angB = aSinew4.y;
          float sagSeed = aSinew4.z;
          float snapSeed = aSinew4.w;

          vec2 mawCenter = mix(vec2(0.144, 0.742), vec2(0.48, 0.48), smoothstep(0.14, 0.88, uMadness));
          float faceScale = max(mix(0.35, 0.84, smoothstep(0.12, 0.90, uMadness)), 0.08);
          vec4 chew = evalParasyteChewS(uTime, uMadness, uJawOpen, uSuction, uClickPulse);
          float openN = chew.x;
          vec2 parenLoc = uParenC - vec2(0.5);
          float halfLen = max(mix(max(uParenSize.y * 0.5, 0.05), 0.43, pow(clamp(openN, 0.0, 1.2), 0.78)), 1e-4);

          float radMul = mix(0.92, 1.02, sagSeed);
          vec3 pA = anchorOnJaw(angA, radMul, openN, mawCenter, faceScale, parenLoc, halfLen);
          vec3 pB = anchorOnJaw(angB, radMul, openN, mawCenter, faceScale, parenLoc, halfLen);

          float sAlong = clamp(position.y + 0.5, 0.0, 1.0);
          vAlong = sAlong;
          float intact = 1.0 - smoothstep(0.08 + snapSeed * 0.18, 0.22 + snapSeed * 0.22, uSuction);
          float vis = smoothstep(0.12, 0.32, openN) * intact;
          vAlpha = vis;

          vec3 chord = pB - pA;
          float chordLen = max(length(chord), 1e-4);
          vec3 axisY = chord / chordLen;
          vec3 axisX = normalize(cross(axisY, vec3(0.0, 0.0, 1.0)) + vec3(1e-5, 0.0, 0.0));
          vec3 axisZ = normalize(cross(axisX, axisY));

          // Surface-tension meniscus flare at attachment roots + glistening saliva droplets along middle!
          float midPinch = mix(0.22, 1.65, pow(abs(sAlong - 0.5) * 2.0, 2.2));
          float droplet = 1.0 + 0.55 * pow(0.5 + 0.5 * sin(sAlong * 25.0 - uTime * 4.5 + snapSeed * 15.0), 4.0) * sin(sAlong * 3.14159);
          float radScale = midPinch * droplet * vis * (0.55 + 0.55 * sagSeed);

          float catenarySag = sin(sAlong * 3.14159) * (0.018 + 0.032 * sagSeed) * clamp(openN, 0.0, 1.2);
          float tremor = sin(sAlong * 6.283 + uTime * 34.0 + snapSeed * 20.0) * 0.0025 * uMadness * sin(sAlong * 3.14159);

          vec3 centerLine = mix(pA, pB, sAlong) + axisX * tremor + vec3(0.0, -catenarySag, -catenarySag * 0.45);
          vec3 finalPos = centerLine + (axisX * position.x + axisZ * position.z) * radScale;
          vec3 finalNorm = normalize(axisX * normal.x + axisY * normal.y + axisZ * normal.z);

          vec4 mv = modelViewMatrix * vec4(finalPos, 1.0);
          vViewPos = -mv.xyz;
          vNrm = normalize(normalMatrix * finalNorm);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vAlong;
        varying vec3 vNrm;
        varying vec3 vViewPos;
        varying float vAlpha;
        void main() {
          if (vAlpha < 0.02) discard;
          vec3 N = normalize(gl_FrontFacing ? vNrm : -vNrm);
          vec3 V = normalize(vViewPos);
          vec3 H = normalize(normalize(vec3(0.28, 0.58, 0.78)) + V);
          float spec = pow(max(dot(N, H), 0.0), 72.0);
          float fres = pow(1.0 - abs(dot(N, V)), 2.2);
          float centerSpan = sin(vAlong * 3.14159);
          vec3 rootMucosa = vec3(0.34, 0.03, 0.08);
          vec3 clearSaliva = vec3(0.45, 0.78, 0.98);
          vec3 strandCol = mix(rootMucosa, clearSaliva, smoothstep(0.15, 0.85, centerSpan));
          strandCol += vec3(0.96, 0.99, 1.0) * (spec * 1.65 + fres * 0.42);
          gl_FragColor = vec4(strandCol, clamp(vAlpha * (0.42 + (1.0 - centerSpan) * 0.32 + spec * 0.48), 0.0, 0.92));
        }
      `,
    });
    this.sinewMesh = new THREE.InstancedMesh(sinewGeo, this.sinewMat, SINEW_COUNT);
    this.sinewMesh.renderOrder = 8;
    this.sinewMesh.frustumCulled = false;
    this.parasyteGroup.add(this.sinewMesh);

    // 6a-2b. 4 Sculpted 3D Parasyte Splitting Jaw Quadrants (Right, Upper Maxilla, Left, Lower Chin)
    // Continuous anatomical cross-section: deep -Z pharynx -> +Z 52-socket gum crest -> striated cheek muscle -> sub-LCD margin!
    const flapGeo = buildParasyteMandibleGeometry();
    const flapSeed = new Float32Array(JAW_FLAP_COUNT * 4);
    for (let i = 0; i < JAW_FLAP_COUNT; i++) {
      // Exact 4 cardinal jaw quadrants: 0 (Right), pi/2 (Upper), pi (Left), 3pi/2 (Lower), splitting along +-pi/4 & +-3pi/4!
      const lobeAng = i * Math.PI * 0.5;
      flapSeed[i * 4 + 0] = lobeAng;
      flapSeed[i * 4 + 1] = i;
      flapSeed[i * 4 + 2] = i === 1 ? 1.03 : i === 3 ? 1.05 : 0.99;
      flapSeed[i * 4 + 3] = i * 1.5707963;
    }
    flapGeo.setAttribute('aFlap4', new THREE.InstancedBufferAttribute(flapSeed, 4));

    this.jawFlapMat = new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      depthTest: true,
      depthWrite: true,
      uniforms: {
        uTime: { value: 0 },
        uMadness: { value: 0 },
        uJawOpen: { value: 0 },
        uSuction: { value: 0 },
        uClickPulse: { value: 0 },
        uCrackRun: { value: 0 },
        uParenC: { value: this.parenC.clone() },
        uParenSize: { value: this.parenSize.clone() },
        uSpine: { value: this.spine.clone() },
      },
      vertexShader: /* glsl */ `
        attribute vec4 aFlap4;
        uniform float uTime;
        uniform float uMadness;
        uniform float uJawOpen;
        uniform float uSuction;
        uniform float uClickPulse;
        uniform float uCrackRun;
        uniform vec2 uParenC;
        uniform vec2 uParenSize;
        uniform vec3 uSpine;
        varying vec2 vFlapUv;
        varying vec3 vNrm;
        varying vec3 vViewPos;
        varying float vFlapId;
        varying float vSpanAng;

        vec4 evalParasyteChewF(float t, float madness, float jawOpen, float suction, float clickPulse) {
          float openT = clamp(jawOpen, 0.0, 1.0);
          float baseOpen = pow(openT, 0.68);
          // A living jaw: slow inhalation interrupted by sharp, irregular involuntary bites.
          // This exact equation is shared by the screen, gums, teeth, eyes and sinews.
          float alive = smoothstep(0.17, 0.62, madness) * (1.0 - smoothstep(0.10, 0.48, suction));
          float inhaleBreath = sin(t * 2.0) * 0.055 * openT;
          float spasm = pow(max(0.0, sin(t * 3.7 + sin(t * 1.13) * 1.8)), 10.0);
          float bite = spasm * 0.18 * alive * openT;
          float clickTear = clickPulse * 0.095 * smoothstep(0.08, 0.32, madness);
          float swallowUnhinge = smoothstep(0.10, 0.45, suction) * 0.38;
          float effOpen = clamp(baseOpen + inhaleBreath - bite + clickTear + swallowUnhinge, 0.0, 1.34);
          return vec4(effOpen, 0.0, 0.0, 0.0);
        }

        float evalMawLobeF(float ang, float openN) {
          float k = clamp(openN, 0.0, 1.25);
          float cornerFlare = pow(0.5 - 0.5 * cos(ang * 4.0), 1.55);
          float archVertical = 0.07 * pow(abs(sin(ang)), 1.4);
          // Neighbouring lobes strain in different directions instead of pulsing as a perfect ring.
          float twitch = sin(ang * 3.0 + uTime * 4.3) * 0.045
                       + sin(ang * 5.0 - uTime * 7.1) * 0.025;
          return 1.0 + (0.14 * cornerFlare + archVertical + twitch * uMadness) * k;
        }

        vec3 evalJawPoint(
          float uCoord,
          float vCoord,
          float centerAng,
          float asym,
          float openN,
          vec2 mawCenter,
          float faceScale,
          vec2 parenLoc,
          float halfLen
        ) {
          float spanAng = centerAng + uCoord * 1.62;
          vec2 dir = vec2(cos(spanAng), sin(spanAng));
          float tv = clamp(dir.y, -1.0, 1.0);
          vec3 spineF = uSpine - vec3(0.5);
          float spineHere = 0.5 * tv * (tv - 1.0) * spineF.x
                          + (1.0 - tv * tv) * spineF.y
                          + 0.5 * tv * (tv + 1.0) * spineF.z;
          float mouthCx = spineHere * (1.0 - pow(clamp(openN, 0.0, 1.0), 0.9));

          float crackGate = 1.0 - smoothstep(0.04, 0.20, openN);
          float crackGrown = smoothstep(1.0 - uCrackRun, 1.02, abs(tv));
          float openNc = openN * mix(1.0, crackGrown, crackGate);
          float emerge = smoothstep(0.06, 0.24, openNc);
          float circRadX = max(mix(0.04, 0.43, pow(max(openNc, 0.0), 0.85)), 1e-4);
          float mawLobe = evalMawLobeF(spanAng, openNc);

          // Continuous 3-zone anatomical cross-section along v in [0..1]:
          // v = 0.00 -> deep inner pharynx wall (rad = 0.72, z = -0.26) plunging seamlessly into the throat tunnel
          // v = 0.34 -> swollen 52-socket alveolar gum crest (rad = 0.96, z = +0.165) where rimTeethMesh roots embed
          // v = 0.58 -> muscular Parasyte cheek/brow/chin ridge (rad = 1.06, z = +0.105)
          // v = 1.00 -> sub-LCD attachment margin (rad = 1.38, z = -0.036) cleanly occluded behind screenMesh!
          float radInner = mix(0.72, 0.96, smoothstep(0.0, 0.34, vCoord));
          float radOuter = mix(radInner, 1.38, pow(smoothstep(0.34, 1.0, vCoord), 0.92));
          float radMul = radOuter * mawLobe * asym;

          // 52 sculpted alveolar tooth sockets & gingival papillae along the v = 0.34 gum crest!
          float gumBand = exp(-pow((vCoord - 0.34) * 9.5, 2.0));
          float papilla = cos(spanAng * 52.0);
          radMul += papilla * 0.012 * gumBand * emerge;

          // Deep V-cleft commissure crease where adjacent jaw flaps meet at +-pi/4 & +-3pi/4
          float cleftCrease = smoothstep(0.34, 0.50, abs(uCoord));
          float lobeArch = (0.52 + 0.48 * (0.5 + 0.5 * cos(spanAng * 4.0))) * (1.0 - 0.42 * cleftCrease);

          float pharynxZ = -0.26 * pow(1.0 - smoothstep(0.0, 0.30, vCoord), 1.45) * emerge;
          float gumCrestZ = (0.165 * clamp(openNc, 0.0, 1.25) + uClickPulse * 0.035) * lobeArch
                          * exp(-pow((vCoord - 0.35) * 3.8, 2.0)) * emerge;
          float muscleRidgeZ = (0.105 * clamp(openNc, 0.0, 1.25)) * lobeArch
                             * exp(-pow((vCoord - 0.62) * 3.2, 2.0)) * emerge;
          float muscleStriation = sin(uCoord * 34.0) * 0.0045 * faceScale * smoothstep(0.22, 0.55, vCoord) * (1.0 - smoothstep(0.75, 1.0, vCoord)) * emerge;
          float papillaZ = papilla * 0.008 * faceScale * gumBand * emerge;
          float outerTuckZ = -0.038 * smoothstep(0.72, 1.0, vCoord);
          float cleftTuckZ = -0.045 * cleftCrease * smoothstep(0.15, 0.85, vCoord) * emerge;

          vec2 fPos = vec2(mouthCx, parenLoc.y) + vec2(dir.x * circRadX, dir.y * halfLen) * radMul;
          vec2 worldXY = (mawCenter - 0.5) * vec2(1.90566, 1.0) + fPos * faceScale * emerge
                       + (1.0 - emerge) * ((mawCenter - 0.5) * vec2(1.90566, 1.0));
          float worldZ = pharynxZ + gumCrestZ + muscleRidgeZ + muscleStriation + papillaZ + outerTuckZ + cleftTuckZ;
          return vec3(worldXY, worldZ);
        }

        void main() {
          vFlapUv = uv;
          vFlapId = aFlap4.y;
          float centerAng = aFlap4.x;
          float asym = aFlap4.z;

          vec2 mawCenter = mix(vec2(0.144, 0.742), vec2(0.48, 0.48), smoothstep(0.14, 0.88, uMadness));
          float faceScale = max(mix(0.35, 0.84, smoothstep(0.12, 0.90, uMadness)), 0.08);
          vec4 chew = evalParasyteChewF(uTime, uMadness, uJawOpen, uSuction, uClickPulse);
          float openN = chew.x;

          vec2 parenLoc = uParenC - vec2(0.5);
          float halfLen = max(mix(max(uParenSize.y * 0.5, 0.05), 0.43, pow(clamp(openN, 0.0, 1.2), 0.78)), 1e-4);

          float uC = position.x;
          float vC = clamp(position.y, 0.0, 1.0);
          vSpanAng = centerAng + uC * 1.62;

          vec3 p0 = evalJawPoint(uC, vC, centerAng, asym, openN, mawCenter, faceScale, parenLoc, halfLen);
          float du = 0.016;
          float dv = 0.016;
          vec3 pU = evalJawPoint(uC + du, vC, centerAng, asym, openN, mawCenter, faceScale, parenLoc, halfLen) - p0;
          vec3 pV = evalJawPoint(uC, min(1.0, vC + dv), centerAng, asym, openN, mawCenter, faceScale, parenLoc, halfLen)
                  - evalJawPoint(uC, max(0.0, vC - dv), centerAng, asym, openN, mawCenter, faceScale, parenLoc, halfLen);

          // Exact analytical surface normal: +v (radial outward) x +u (CCW tangent) = +Z outward toward viewer!
          vec3 surfN = cross(pV, pU);
          float nLen = length(surfN);
          vec3 finalNorm = nLen > 1e-7 ? surfN / nLen : vec3(0.0, 0.0, 1.0);

          vec4 mv = modelViewMatrix * vec4(p0, 1.0);
          vViewPos = -mv.xyz;
          vNrm = normalize(normalMatrix * finalNorm);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vFlapUv;
        varying vec3 vNrm;
        varying vec3 vViewPos;
        varying float vFlapId;
        varying float vSpanAng;
        uniform float uTime;
        uniform float uMadness;

        void main() {
          vec3 N = normalize(gl_FrontFacing ? vNrm : -vNrm);
          vec3 V = normalize(vViewPos);
          vec3 Lkey = normalize(vec3(0.28, 0.56, 0.78));
          vec3 Lfill = normalize(vec3(-0.42, -0.30, 0.86));
          vec3 H = normalize(Lkey + V);
          vec3 H2 = normalize(Lfill + V);

          // Organic subsurface-scattered wrap lighting across wet gum & muscle bundles
          float ndl = dot(N, Lkey);
          float wrapDiff = clamp((ndl + 0.42) / 1.42, 0.0, 1.0);
          float sssBand = pow(clamp(1.0 - abs(ndl), 0.0, 1.0), 2.2) * 0.28;
          float spec = pow(max(dot(N, H), 0.0), 76.0) * 1.35 + pow(max(dot(N, H2), 0.0), 28.0) * 0.35;
          float rim = pow(1.0 - abs(dot(N, V)), 2.8);

          float v = vFlapUv.y;
          // 1) Deep inner pharynx mucosa (v = 0..0.28) — dark wet abyss matching throatTubeMat
          vec3 pharynxMeat = vec3(0.055, 0.004, 0.016);

          // 2) Swollen 52-socket alveolar gingiva (v = 0.26..0.44) — warm vascular coral-crimson gum tissue
          float socketWave = 0.5 + 0.5 * cos(vSpanAng * 52.0);
          vec3 socketSulcus = vec3(0.22, 0.018, 0.048);
          vec3 swollenGum = vec3(0.56, 0.11, 0.18);
          vec3 gingivaCol = mix(socketSulcus, swollenGum, 0.35 + 0.65 * socketWave);

          // 3) Striated orbicularis/zygomatic muscle bundles (v = 0.44..0.82)
          float fiber = 0.5 + 0.5 * sin((vFlapUv.x - 0.5) * 44.0 + sin(v * 16.0 + vFlapId) * 0.9);
          float fascia = pow(max(0.0, sin((vFlapUv.x - 0.5) * 22.0 + 0.7)), 6.0);
          vec3 muscleCol = mix(vec3(0.20, 0.012, 0.038), vec3(0.46, 0.048, 0.095), fiber * 0.78);
          muscleCol = mix(muscleCol, vec3(0.62, 0.34, 0.38), fascia * 0.28);

          // 4) Outer sub-LCD delaminated cerulean skin margin (v = 0.78..1.0)
          vec3 subLcdBruise = vec3(0.02, 0.18, 0.44);

          vec3 albedo = mix(pharynxMeat, gingivaCol, smoothstep(0.14, 0.31, v));
          albedo = mix(albedo, muscleCol, smoothstep(0.40, 0.54, v));
          albedo = mix(albedo, subLcdBruise, smoothstep(0.76, 0.94, v));

          // Deep V-cleft commissure ambient occlusion where the 4 jaws tear apart
          float cleftAo = 1.0 - 0.58 * smoothstep(0.34, 0.50, abs(vFlapUv.x - 0.5));
          float throatAo = smoothstep(0.0, 0.24, v);
          float ao = (0.22 + 0.78 * throatAo) * cleftAo;

          // Subtle cyan bio-electric optic nerve capillaries pulsing inside the torn jaw muscle
          float nerve = pow(max(0.0, 1.0 - abs(sin(vSpanAng * 9.0 + sin(v * 14.0) * 1.4))), 16.0)
                      * smoothstep(0.28, 0.52, v) * (1.0 - smoothstep(0.75, 0.95, v))
                      * (0.55 + 0.45 * sin(uTime * 6.5 - v * 8.0));

          vec3 col = albedo * (0.20 + 0.80 * wrapDiff) * ao + vec3(0.55, 0.04, 0.10) * sssBand * ao;
          col += vec3(0.10, 0.58, 1.0) * nerve * 0.32 * uMadness;
          col += vec3(0.94, 0.98, 1.0) * spec * smoothstep(0.10, 0.32, v) * (1.0 - smoothstep(0.80, 0.98, v));
          col += vec3(0.18, 0.58, 0.96) * rim * 0.20 * ao;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.jawFlapsMesh = new THREE.InstancedMesh(flapGeo, this.jawFlapMat, JAW_FLAP_COUNT);
    this.jawFlapsMesh.renderOrder = 6;
    this.jawFlapsMesh.frustumCulled = false;
    this.parasyteGroup.add(this.jawFlapsMesh);

    // 6a-3. 11 Socketed & Blinking 3D Parasyte Eyes (uv.y < 0.5 = refractive eyeball; uv.y >= 0.5 = 3D fleshy orbital eyelids!)
    const socketedEyeGeo = buildParasyteSocketedEyeGeometry();
    // [polarAngRad, jawRadialMul, baseRadius, eyeIdx + appearThreshold] — single vec4 attribute (WebGL1 <= 8 attribs safe!)
    const eyeLayout: Array<[number, number, number, number]> = [
      [1.14, 1.24, 0.068, 0.14],   // 0: Primary mutated ':' eye R (upper-right supraorbital ridge)
      [1.98, 1.26, 0.102, 0.14],   // 1: Primary mutated ':' eye L (monstrously swollen asymmetric primary eye!)
      [0.34, 1.26, 0.060, 0.24],   // 2: Right zygomatic mandible cluster — large eye
      [0.10, 1.34, 0.035, 0.30],   // 3: Right mandible cluster — frantic tiny satellite eye
      [2.84, 1.28, 0.064, 0.28],   // 4: Left zygomatic mandible eye
      [-0.52, 1.26, 0.055, 0.38],  // 5: Lower-right jaw eye
      [-2.54, 1.28, 0.048, 0.42],  // 6: Lower-left jaw eye
      [-2.86, 1.36, 0.032, 0.48],  // 7: Lower-left tiny satellite twin eye
      [1.56, 1.34, 0.044, 0.52],   // 8: Dorsal frontal-brow crown eye
      [3.12, 1.32, 0.040, 0.58],   // 9: Far-left lateral cheek eye
      [-1.54, 1.30, 0.046, 0.62],  // 10: Mental chin-lobe eye
    ];
    const eyeAttr = new Float32Array(PARASYTE_EYE_COUNT * 4);
    for (let i = 0; i < PARASYTE_EYE_COUNT; i++) {
      const [eAng, eRadMul, er, eth] = eyeLayout[i];
      eyeAttr[i * 4 + 0] = eAng;
      eyeAttr[i * 4 + 1] = eRadMul;
      eyeAttr[i * 4 + 2] = er;
      eyeAttr[i * 4 + 3] = i + eth; // floor = eye index [0..10], fract = madness threshold!
    }
    socketedEyeGeo.setAttribute('aEye4', new THREE.InstancedBufferAttribute(eyeAttr, 4));

    this.parasyteEyeMat = new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      depthTest: true,
      depthWrite: true,
      uniforms: {
        uTime: { value: 0 },
        uMadness: { value: 0 },
        uJawOpen: { value: 0 },
        uSuction: { value: 0 },
        uClickPulse: { value: 0 },
        uCrackRun: { value: 0 },
        uHover: { value: 0 },
        uCursorUv: { value: new THREE.Vector2(0.5, 0.5) },
        uParenC: { value: this.parenC.clone() },
        uParenSize: { value: this.parenSize.clone() },
        uSpine: { value: this.spine.clone() },
      },
      vertexShader: /* glsl */ `
        attribute vec4 aEye4;
        uniform float uTime;
        uniform float uMadness;
        uniform float uJawOpen;
        uniform float uSuction;
        uniform float uClickPulse;
        uniform float uCrackRun;
        uniform float uHover;
        uniform vec2 uCursorUv;
        uniform vec2 uParenC;
        uniform vec2 uParenSize;
        uniform vec3 uSpine;
        varying vec3 vSpherePos;
        varying vec2 vPartUv;
        varying vec3 vNrm;
        varying vec3 vViewPos;
        varying float vEyeId;
        varying float vBlink;

        float hash1(float n) { return fract(sin(n) * 43758.5453); }

        vec4 evalParasyteChewE(float t, float madness, float jawOpen, float suction, float clickPulse) {
          float openT = clamp(jawOpen, 0.0, 1.0);
          float baseOpen = pow(openT, 0.68);
          // A living jaw: slow inhalation interrupted by sharp, irregular involuntary bites.
          // This exact equation is shared by the screen, gums, teeth, eyes and sinews.
          float alive = smoothstep(0.17, 0.62, madness) * (1.0 - smoothstep(0.10, 0.48, suction));
          float inhaleBreath = sin(t * 2.0) * 0.055 * openT;
          float spasm = pow(max(0.0, sin(t * 3.7 + sin(t * 1.13) * 1.8)), 10.0);
          float bite = spasm * 0.18 * alive * openT;
          float clickTear = clickPulse * 0.095 * smoothstep(0.08, 0.32, madness);
          float swallowUnhinge = smoothstep(0.10, 0.45, suction) * 0.38;
          float effOpen = clamp(baseOpen + inhaleBreath - bite + clickTear + swallowUnhinge, 0.0, 1.34);
          return vec4(effOpen, 0.0, 0.0, 0.0);
        }

        float evalMawLobeE(float ang, float openN) {
          float k = clamp(openN, 0.0, 1.25);
          float cornerFlare = pow(0.5 - 0.5 * cos(ang * 4.0), 1.55);
          float archVertical = 0.07 * pow(abs(sin(ang)), 1.4);
          // Neighbouring lobes strain in different directions instead of pulsing as a perfect ring.
          float twitch = sin(ang * 3.0 + uTime * 4.3) * 0.045
                       + sin(ang * 5.0 - uTime * 7.1) * 0.025;
          return 1.0 + (0.14 * cornerFlare + archVertical + twitch * uMadness) * k;
        }

        void main() {
          vPartUv = uv;
          float eyeId = floor(aEye4.w + 1e-4);
          float appearTh = fract(aEye4.w);
          vEyeId = eyeId;

          vec2 mawCenter = mix(vec2(0.144, 0.742), vec2(0.48, 0.48), smoothstep(0.14, 0.88, uMadness));
          float faceScale = max(mix(0.35, 0.84, smoothstep(0.12, 0.90, uMadness)), 0.08);
          vec4 chew = evalParasyteChewE(uTime, uMadness, uJawOpen, uSuction, uClickPulse);
          float openN = chew.x;

          float emerge = smoothstep(appearTh, appearTh + 0.13, uMadness);
          float rad = aEye4.z * faceScale * emerge * (1.0 + 0.09 * sin(uTime * 11.0 + eyeId * 2.7) * uMadness);

          // Anchor each orbital socket directly onto the expanding 3D Parasyte jaw lobes!
          float ang = aEye4.x;
          float radMulBase = aEye4.y;
          vec2 dir = vec2(cos(ang), sin(ang));
          vec2 parenLoc = uParenC - vec2(0.5);
          float halfLen = max(mix(max(uParenSize.y * 0.5, 0.05), 0.43, pow(clamp(openN, 0.0, 1.2), 0.78)), 1e-4);
          float tv = clamp(dir.y, -1.0, 1.0);
          vec3 spineF = uSpine - vec3(0.5);
          float spineHere = 0.5 * tv * (tv - 1.0) * spineF.x
                          + (1.0 - tv * tv) * spineF.y
                          + 0.5 * tv * (tv + 1.0) * spineF.z;
          float mouthCx = spineHere * (1.0 - pow(clamp(openN, 0.0, 1.0), 0.9));
          float crackGate = 1.0 - smoothstep(0.04, 0.20, openN);
          float crackGrown = smoothstep(1.0 - uCrackRun, 1.02, abs(tv));
          float openNc = openN * mix(1.0, crackGrown, crackGate);
          float circRadX = max(mix(0.04, 0.39, pow(max(openNc, 0.0), 0.85)), 1e-4);
          float mawLobe = evalMawLobeE(ang, openNc);

          // Smoothly transition from initial ':' eye cluster before jaw tear into full polar jaw-mounted orbit!
          vec2 fEyePolar = vec2(mouthCx, parenLoc.y) + vec2(dir.x * max(circRadX, 0.18), dir.y * max(halfLen, 0.26)) * (mawLobe * radMulBase);
          vec2 eyeScreenUv = mawCenter + fEyePolar * faceScale * vec2(1.0 / 1.90566, 1.0);
          vec2 centerXY = (mawCenter - 0.5) * vec2(1.90566, 1.0) + fEyePolar * faceScale;

          float lobeArch = 0.52 + 0.48 * (0.5 + 0.5 * cos(ang * 4.0));
          float jawSurfaceZ = (0.095 * clamp(openNc, 0.0, 1.25)) * lobeArch + 0.032 * emerge;
          float bulgeZ = jawSurfaceZ + rad * (0.62 + 0.18 * sin(uTime * 2.8 + eyeId * 1.7)) + uClickPulse * 0.055 * emerge;

          // Asynchronous wet Parasyte eyelid blink (each eye blinks on its own organic cycle!)
          float blinkPeriod = 3.1 + mod(eyeId * 0.73, 2.4);
          float blinkPhase = fract((uTime + eyeId * 1.19) / blinkPeriod);
          float blinkPulse = smoothstep(0.0, 0.035, blinkPhase) * (1.0 - smoothstep(0.035, 0.11, blinkPhase));
          float blinkAmt = clamp(blinkPulse * (1.0 - uClickPulse * 0.8), 0.0, 0.94);
          vBlink = blinkAmt;

          // Saccadic 3D eyeball rotation that snaps dead-on to the player's cursor / gaze!
          vec2 toCursor = clamp((uCursorUv - eyeScreenUv) * vec2(1.9, 1.0) * 1.55, vec2(-0.68), vec2(0.68));
          float sacTick = floor(uTime * (5.5 + mod(eyeId, 4.0) * 2.1));
          vec2 saccade = vec2(hash1(sacTick + eyeId * 11.3) - 0.5, hash1(sacTick * 1.7 + eyeId * 5.9) - 0.5)
                       * 0.42 * (1.0 - clamp(uClickPulse * 1.4 + uHover * 0.70, 0.0, 1.0));
          vec2 aim = clamp(toCursor + saccade, vec2(-0.72), vec2(0.72));

          bool isSocket = uv.y >= 0.5;
          vec3 localP = position;
          vec3 localN = normal;

          if (isSocket) {
            // 3D fleshy almond eyelids & orbital socket (uv.y in [0.55..1.00]):
            // Inner margin (sT -> 0) pinches shut vertically during blinkAmt and tracks gaze slightly!
            float sT = clamp((uv.y - 0.55) / 0.45, 0.0, 1.0);
            float innerWeight = 1.0 - smoothstep(0.0, 0.68, sT);
            localP.y *= mix(1.0, 0.06, blinkAmt * innerWeight);
            localP.z += blinkAmt * innerWeight * 0.22;
            localP.xy += aim * 0.16 * innerWeight;
            // Cant the almond palpebral fissure slightly along the jaw lobe tangent for organic anatomy
            float cantAng = sin(ang * 2.0) * 0.22;
            float cc = cos(cantAng), sc = sin(cantAng);
            localP.xy = mat2(cc, -sc, sc, cc) * localP.xy;
            localN.xy = mat2(cc, -sc, sc, cc) * localN.xy;
            vSpherePos = localP;
          } else {
            // 3D Eyeball (uv.y in [0.00..0.45]): rotates cleanly inside the stationary fleshy eyelid socket!
            float yaw = aim.x;
            float pitch = -aim.y;
            float cy = cos(yaw), sy = sin(yaw);
            float cp = cos(pitch), sp = sin(pitch);
            vec3 p1 = vec3(localP.x, localP.y * cp - localP.z * sp, localP.y * sp + localP.z * cp);
            localP = vec3(p1.x * cy + p1.z * sy, p1.y, -p1.x * sy + p1.z * cy);
            vec3 n1 = vec3(localN.x, localN.y * cp - localN.z * sp, localN.y * sp + localN.z * cp);
            localN = vec3(n1.x * cy + n1.z * sy, n1.y, -n1.x * sy + n1.z * cy);
            vSpherePos = position;
          }

          vec3 worldLocal = vec3(centerXY, bulgeZ) + localP * rad;
          vec4 mv = modelViewMatrix * vec4(worldLocal, 1.0);
          vViewPos = -mv.xyz;
          vNrm = normalize(normalMatrix * localN);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vSpherePos;
        varying vec2 vPartUv;
        varying vec3 vNrm;
        varying vec3 vViewPos;
        varying float vEyeId;
        varying float vBlink;
        uniform float uTime;
        uniform float uMadness;
        uniform float uClickPulse;

        void main() {
          vec3 N = normalize(gl_FrontFacing ? vNrm : -vNrm);
          vec3 V = normalize(vViewPos);
          vec3 L = normalize(vec3(0.28, 0.56, 0.78));
          vec3 Lfill = normalize(vec3(-0.45, -0.25, 0.85));
          vec3 H = normalize(L + V);
          vec3 H2 = normalize(Lfill + V);

          if (vPartUv.y >= 0.5) {
            // ---- 3D FLESHY ORBITAL EYELIDS & TORN-LCD SOCKET COLLAR ----
            float sT = clamp((vPartUv.y - 0.55) / 0.45, 0.0, 1.0);
            float palpebralRim = 1.0 - smoothstep(0.0, 0.28, sT);
            float wrapDiff = clamp((dot(N, L) + 0.40) / 1.40, 0.0, 1.0);
            float wetTearLine = pow(max(dot(N, H), 0.0), 82.0) * (0.45 + 1.15 * palpebralRim);

            float skinFold = 0.5 + 0.5 * sin(sT * 18.0 + cos(vPartUv.x * 6.28318 * 2.0) * 0.8);
            vec3 innerMucosa = vec3(0.52, 0.08, 0.15);
            vec3 tarsalFlesh = mix(vec3(0.22, 0.015, 0.045), vec3(0.42, 0.045, 0.095), skinFold);
            vec3 bruisedLcdMargin = vec3(0.015, 0.16, 0.40);

            vec3 lidCol = mix(innerMucosa, tarsalFlesh, smoothstep(0.05, 0.42, sT));
            lidCol = mix(lidCol, bruisedLcdMargin, smoothstep(0.68, 0.98, sT));
            float lidAo = mix(0.55, 1.0, smoothstep(0.0, 0.25, sT));
            vec3 col = lidCol * (0.22 + 0.78 * wrapDiff) * lidAo;
            col += vec3(0.95, 0.99, 1.0) * wetTearLine;
            gl_FragColor = vec4(col, 1.0);
            return;
          }

          // ---- 3D REFRACTIVE ANTERIOR-CHAMBER EYEBALL ----
          // Corneal anterior-chamber parallax: refract view vector into sunken concave iris plane!
          vec3 refractLocal = normalize(vSpherePos + vec3(0.0, 0.0, 0.18));
          vec2 p = vSpherePos.xy - V.xy * 0.055 * max(0.0, vSpherePos.z);
          float r = length(vSpherePos.xy);
          float rIris = length(p);
          float safeX = (abs(p.x) < 1e-5 && abs(p.y) < 1e-5) ? 1e-5 : p.x;
          float ang = atan(p.y, safeX);

          // Realistic wet ivory-pink sclera with fine branching episcleral capillaries & caruncle warmth
          float v1 = pow(max(0.0, 1.0 - abs(sin(ang * 8.0 + sin(r * 15.0 + vEyeId) * 1.8))), 18.0);
          float v2 = pow(max(0.0, 1.0 - abs(cos(ang * 19.0 - cos(r * 22.0 - vEyeId) * 1.4))), 22.0);
          float scleraRim = smoothstep(0.44, 0.98, r);
          vec3 sclera = mix(vec3(0.94, 0.91, 0.89), vec3(0.54, 0.16, 0.20), scleraRim * 0.68);
          sclera = mix(sclera, vec3(0.72, 0.04, 0.09), clamp((v1 + v2 * 0.65) * smoothstep(0.42, 0.92, r), 0.0, 0.82));

          // Detailed Parasyte iris: dark limbal ring + radial stroma fibers + collarette ring + caustic illumination!
          float irisR = 0.43;
          float inIris = smoothstep(irisR + 0.022, irisR - 0.022, r) * step(0.0, refractLocal.z);
          float normR = clamp(rIris / irisR, 0.0, 1.0);
          float radialFibers = 0.5 + 0.5 * sin(ang * 42.0 + sin(normR * 18.0 + vEyeId) * 1.6);
          float crypts = 0.5 + 0.5 * cos(ang * 17.0 - cos(normR * 12.0) * 2.1);
          float collarette = exp(-pow((normR - 0.46) * 7.5, 2.0));

          // Cold glacial BSOD cyan-amber heterochromia characteristic of mutated digital Parasyte eyes
          vec3 baseIris = mix(vec3(0.06, 0.46, 0.86), vec3(0.78, 0.36, 0.18), step(0.58, fract(vEyeId * 0.37)) * 0.72);
          vec3 irisCol = baseIris * (0.38 + 0.82 * radialFibers * (0.65 + 0.35 * crypts));
          irisCol += mix(vec3(0.35, 0.78, 1.0), vec3(0.95, 0.62, 0.28), collarette) * collarette * 0.42;

          // Opposite-side anterior chamber caustic brightening + dark outer limbal ring!
          float irisCaustic = max(0.0, dot(normalize(vec3(-p, 0.35)), L));
          irisCol *= (0.55 + 0.95 * irisCaustic);
          float limbus = smoothstep(1.0, 0.78, normR);
          irisCol *= (0.16 + 0.84 * limbus);

          // Constricted trembling pupil + subtle deep retinal tapetum reflex
          float pupilR = mix(0.19, 0.082, clamp(uMadness * 0.85 + uClickPulse * 0.35, 0.0, 1.0))
                       + sin(uTime * 48.0 + vEyeId * 5.0) * 0.006 * uMadness;
          float inPupil = smoothstep(pupilR + 0.015, pupilR - 0.015, rIris) * step(0.0, refractLocal.z);

          vec3 col = mix(sclera, irisCol, inIris);
          col = mix(col, vec3(0.006, 0.002, 0.008), inPupil);
          col += vec3(0.85, 0.08, 0.16) * smoothstep(pupilR * 0.55, 0.0, rIris) * inPupil * uMadness * 0.55;

          // Eyelid ambient occlusion shadow cast onto upper/lower sclera + blink darkening!
          float palpebralOpen = mix(0.56, 0.06, vBlink);
          float lidShadow = smoothstep(palpebralOpen * 1.15, palpebralOpen * 0.45, abs(vSpherePos.y));
          float diff = 0.32 + 0.68 * clamp((dot(N, L) + 0.25) / 1.25, 0.0, 1.0);
          col *= diff * (0.36 + 0.64 * lidShadow);

          // Dual razor-sharp wet corneal monitor reflections!
          float corneaSpec1 = pow(max(dot(N, H), 0.0), 140.0) * 2.35;
          float corneaSpec2 = pow(max(dot(N, H2), 0.0), 64.0) * 0.48;
          float tearSheen = pow(1.0 - abs(dot(N, V)), 3.5) * 0.22;
          col += vec3(0.96, 0.99, 1.0) * (corneaSpec1 + corneaSpec2) * lidShadow + vec3(0.35, 0.75, 1.0) * tearSheen;

          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.parasyteEyesMesh = new THREE.InstancedMesh(socketedEyeGeo, this.parasyteEyeMat, PARASYTE_EYE_COUNT);
    this.parasyteEyesMesh.renderOrder = 7;
    this.parasyteEyesMesh.frustumCulled = false;
    this.parasyteGroup.add(this.parasyteEyesMesh);

    // 6b. 100% GPU-Animated Razor-Thin 3D Shattered LCD Glass Shards floating out of the screen (0 CPU loops!)
    const glassGeo = new THREE.CylinderGeometry(0.082, 0.082, 0.0045, 3, 1);
    glassGeo.rotateX(Math.PI * 0.5);
    const gSeed = new Float32Array(GLASS_SHARD_COUNT * 2);
    for (let i = 0; i < GLASS_SHARD_COUNT; i++) {
      gSeed[i * 2 + 0] = i / GLASS_SHARD_COUNT;
      gSeed[i * 2 + 1] = (i * 0.61803398875) % 1;
    }
    glassGeo.setAttribute('aGlassSeed', new THREE.InstancedBufferAttribute(gSeed, 2));

    this.glassShardMat = new THREE.ShaderMaterial({
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uMadness: { value: 0 },
        uJawOpen: { value: 0 },
        uSuction: { value: 0 },
        uClickPulse: { value: 0 },
      },
      vertexShader: /* glsl */ `
        attribute vec2 aGlassSeed;
        uniform float uTime;
        uniform float uMadness;
        uniform float uJawOpen;
        uniform float uSuction;
        uniform float uClickPulse;
        varying vec3 vNrm;
        varying vec3 vViewPos;
        void main() {
          float idx = aGlassSeed.x * 48.0;
          float seed = aGlassSeed.y;
          vec2 mawCenter = mix(vec2(0.144, 0.742), vec2(0.48, 0.48), smoothstep(0.14, 0.88, uMadness));
          float faceScale = max(mix(0.35, 0.84, smoothstep(0.12, 0.90, uMadness)), 0.08);
          float mouthX = (mawCenter.x - 0.5) * 1.90566;
          float mouthY = (mawCenter.y - 0.5) * 1.0;

          float ang = aGlassSeed.x * 6.2831853 + sin(uTime * 0.45 + idx) * 0.15;
          float ringR = (0.16 + uJawOpen * (0.34 + seed * 0.44)) * faceScale;
          float driftOut = uJawOpen * (0.08 + seed * 0.68) + uClickPulse * 0.10 - uSuction * 3.2;

          float sc = smoothstep(0.01, 0.22, uJawOpen) * (0.42 + seed * 1.15);
          vec3 lp = vec3(position.x * sc * (0.65 + mod(idx, 3.0) * 0.4), position.y * sc * (1.1 + mod(idx, 2.0) * 0.55), position.z);

          float a1 = uTime * (0.7 + seed * 1.4) + idx;
          float a2 = uTime * (0.9 - seed * 1.2) + idx * 2.1;
          float c1 = cos(a1), s1 = sin(a1), c2 = cos(a2), s2 = sin(a2);
          vec3 p1 = vec3(lp.x, lp.y * c1 - lp.z * s1, lp.y * s1 + lp.z * c1);
          vec3 p2 = vec3(p1.x * c2 + p1.z * s2, p1.y, -p1.x * s2 + p1.z * c2);
          vec3 n1 = vec3(normal.x, normal.y * c1 - normal.z * s1, normal.y * s1 + normal.z * c1);
          vec3 n2 = vec3(n1.x * c2 + n1.z * s2, n1.y, -n1.x * s2 + n1.z * c2);

          vec3 center = vec3(
            mouthX + cos(ang) * ringR * 1.10,
            mouthY + sin(ang) * ringR * 0.96 + sin(uTime * 1.6 + idx * 1.7) * 0.022,
            driftOut
          );
          vec4 mv = modelViewMatrix * vec4(center + p2, 1.0);
          vViewPos = -mv.xyz;
          vNrm = normalize(normalMatrix * n2);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vNrm;
        varying vec3 vViewPos;
        void main() {
          vec3 V = normalize(vViewPos);
          vec3 N = normalize(vNrm);
          float fresnel = pow(1.0 - abs(dot(N, V)), 2.2);
          float spec = pow(max(dot(reflect(-V, N), normalize(vec3(0.3, 0.6, 0.8))), 0.0), 36.0);
          vec3 col = mix(vec3(0.02, 0.34, 0.80), vec3(0.90, 0.98, 1.0), fresnel * 0.85 + spec);
          gl_FragColor = vec4(col, clamp(0.36 + fresnel * 0.54 + spec * 0.42, 0.0, 0.95));
        }
      `,
    });
    this.glassShards = new THREE.InstancedMesh(glassGeo, this.glassShardMat, GLASS_SHARD_COUNT);
    this.glassShards.renderOrder = 8;
    this.glassShards.visible = false;
    this.glassShards.frustumCulled = false;
    this.root.add(this.glassShards);

    // 7. Cerulean Monitor PointLight illuminating the desk, keyboard, chair, and bedroom!
    this.monitorLight = new THREE.PointLight(0x1b8cff, 2.35, 6.5, 1.6);
    this.monitorLight.position.set(0, 0.04, 0.26);
    this.root.add(this.monitorLight);
  }

  private renderFaceChannelTexture(): void {
    const ctx = this.faceCanvas.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const W = 1024;
    ctx.clearRect(0, 0, W, W);
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, W, W);

    // Fallback draw for headless stub canvases that do not implement full ImageData buffers
    ctx.globalCompositeOperation = 'lighter';
    ctx.textBaseline = 'middle';
    ctx.font = '300 660px "Segoe UI", "Yu Gothic UI", system-ui, sans-serif';
    const fullWidth = ctx.measureText(':(').width || 360;
    const colonWidth = ctx.measureText(':').width || 140;
    const startX = (W - fullWidth) * 0.5;
    const centerY = W * 0.52;
    ctx.fillStyle = 'rgb(255, 0, 0)';
    ctx.fillText(':', startX, centerY);
    ctx.fillStyle = 'rgb(0, 255, 0)';
    ctx.fillText('(', startX + colonWidth, centerY);
    ctx.globalCompositeOperation = 'source-over';

    // Exact Analytical 2D Euclidean Signed Distance Field (SDF) for Segoe UI Light ':('
    // R = ':' SDF (0.5 = glyph edge, +-9px spread), G = '(' SDF, B = 0 (strict invariant!), A = 255
    let img: ImageData | null = null;
    try {
      img = ctx.getImageData(0, 0, W, W);
    } catch {
      img = null;
    }
    if (img && img.data.length === W * W * 4) {
      const px = img.data;
      const SPREAD = 11.0;
      const invSpread = 1.0 / SPREAD;
      const colonX = 380.0;
      const dotTopY = 458.0;
      const dotBotY = 722.0;
      const dotR = 32.0;

      // Exact Segoe UI Semilight '(' circular-arc spine passing through waist (566, 554) and terminals (684, 554 +- 268)
      const arcCy = 554.0;
      const arcCx = 931.0;
      const arcR = 365.0;
      const termX = 684.0;
      const termHalfH = 268.0;
      const maxAng = Math.asin(termHalfH / arcR);

      for (let y = 0; y < W; y++) {
        const py = y + 0.5;
        const dyTop = py - dotTopY;
        const dyBot = py - dotBotY;
        const dyArc = Math.abs(py - arcCy);
        const rowOff = y * W * 4;

        for (let x = 0; x < W; x++) {
          const pxX = x + 0.5;
          // 1) Red channel: ':' Euclidean SDF
          const dColonX = pxX - colonX;
          const sdColon =
            Math.min(Math.hypot(dColonX, dyTop), Math.hypot(dColonX, dyBot)) - dotR;

          // 2) Green channel: '(' Euclidean SDF with subtle optical terminal taper
          const dxArc = pxX - arcCx;
          let sdParen: number;
          if (dxArc < 0.0) {
            const ang = Math.atan2(dyArc, -dxArc);
            if (ang <= maxAng) {
              const tNorm = ang / maxAng;
              const halfStroke = 23.5 - 3.2 * tNorm * tNorm;
              sdParen = Math.abs(Math.hypot(dxArc, dyArc) - arcR) - halfStroke;
            } else {
              sdParen = Math.hypot(pxX - termX, dyArc - termHalfH) - 20.3;
            }
          } else {
            sdParen = Math.hypot(pxX - termX, dyArc - termHalfH) - 20.3;
          }

          const rVal = Math.max(0, Math.min(255, Math.round((0.5 - sdColon * invSpread) * 255.0)));
          const gVal = Math.max(0, Math.min(255, Math.round((0.5 - sdParen * invSpread) * 255.0)));

          const idx = rowOff + x * 4;
          px[idx] = rVal;
          px[idx + 1] = gVal;
          px[idx + 2] = 0;
          px[idx + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
    }

    this.measureFaceGlyphs();
  }

  private measureFaceGlyphs(): void {
    const ctx = this.faceCanvas.getContext('2d');
    if (!ctx) return;
    const size = this.faceCanvas.width;
    let img: ImageData;
    try {
      img = ctx.getImageData(0, 0, size, size);
    } catch {
      return;
    }
    const px = img.data;
    if (px.length !== size * size * 4) return;
    const rowSum = new Float32Array(size);
    const rowCnt = new Float32Array(size);
    let rx0 = 1e9,
      ry0 = 1e9,
      rx1 = -1,
      ry1 = -1;
    let gx0 = 1e9,
      gy0 = 1e9,
      gx1 = -1,
      gy1 = -1;
    // Measure at the exact 0.5 SDF contour (> 127)
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        if (px[i] > 127) {
          if (x < rx0) rx0 = x;
          if (x > rx1) rx1 = x;
          if (y < ry0) ry0 = y;
          if (y > ry1) ry1 = y;
        }
        if (px[i + 1] > 127) {
          if (x < gx0) gx0 = x;
          if (x > gx1) gx1 = x;
          if (y < gy0) gy0 = y;
          if (y > gy1) gy1 = y;
          rowSum[y] += x;
          rowCnt[y] += 1;
        }
      }
    }
    const toUv = (x0: number, y0: number, x1: number, y1: number, c: THREE.Vector2, sz: THREE.Vector2) => {
      c.set((x0 + x1 + 1) * 0.5 / size, 1 - (y0 + y1 + 1) * 0.5 / size);
      sz.set((x1 - x0 + 1) / size, (y1 - y0 + 1) / size);
    };
    if (rx1 > rx0 && ry1 > ry0) {
      toUv(rx0, ry0, rx1, ry1, this.colonC, this.colonSize);
      const midY = (ry0 + ry1) >> 1;
      let topSum = 0;
      let topCnt = 0;
      let botSum = 0;
      let botCnt = 0;
      const xMid = (rx0 + rx1) >> 1;
      for (let y = ry0; y <= ry1; y++) {
        for (let x = rx0; x <= rx1; x++) {
          const i = (y * size + x) * 4;
          if (px[i] <= 127) continue;
          if (x !== xMid) continue;
          if (y <= midY) {
            topSum += y;
            topCnt++;
          } else {
            botSum += y;
            botCnt++;
          }
        }
      }
      if (topCnt > 0 && botCnt > 0) {
        const topC = topSum / topCnt;
        const botC = botSum / botCnt;
        this.colonC.y = 1 - (topC + botC) * 0.5 / size;
        this.colonDotOff = Math.max(0.04, Math.abs(botC - topC) * 0.5 / size);
      }
    }
    if (gx1 > gx0 && gy1 > gy0) {
      toUv(gx0, gy0, gx1, gy1, this.parenC, this.parenSize);
      const h = gy1 - gy0;
      const rowMeanUv = (row: number) => {
        const r = Math.round(THREE.MathUtils.clamp(row, gy0, gy1));
        if (rowCnt[r] < 1) return this.parenC.x;
        return rowSum[r] / rowCnt[r] / size;
      };
      this.spine.set(rowMeanUv(gy1 - h * 0.12), rowMeanUv(gy0 + h * 0.5), rowMeanUv(gy0 + h * 0.12));
    }
  }

  private drawQrCode(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, stage: number): void {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x, y, size, size);

    const modules = 29;
    const pad = Math.round(size * 0.085);
    const cell = (size - pad * 2) / modules;
    const corruption = Math.max(0, (stage - 1) * 0.24);
    ctx.fillStyle = '#0078d7';

    const isFinder = (r: number, c: number, fr: number, fc: number): boolean => {
      const dr = r - fr;
      const dc = c - fc;
      if (dr < 0 || dr > 6 || dc < 0 || dc > 6) return false;
      if (dr === 0 || dr === 6 || dc === 0 || dc === 6) return true;
      if (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4) return true;
      return false;
    };

    for (let r = 0; r < modules; r++) {
      for (let c = 0; c < modules; c++) {
        let on = false;
        const inFinderZone =
          (r < 8 && c < 8) || (r < 8 && c >= modules - 8) || (r >= modules - 8 && c < 8);

        // From Stage 1+, the center of the QR code subtly forms an uncanny watching eye!
        const drC = (r - 14) * 1.35;
        const dcC = c - 14;
        const eyeDist = Math.hypot(drC, dcC);
        if (stage >= 1 && !inFinderZone && eyeDist < 6.4) {
          on = (eyeDist > 4.6 && eyeDist < 6.1) || eyeDist < 2.1;
        } else if (inFinderZone) {
          on =
            isFinder(r, c, 0, 0) ||
            isFinder(r, c, 0, modules - 7) ||
            isFinder(r, c, modules - 7, 0);
        } else if (r === 6 || c === 6) {
          on = (r + c) % 2 === 0;
        } else if (r >= 20 && r <= 24 && c >= 20 && c <= 24) {
          const dr = Math.abs(r - 22);
          const dc = Math.abs(c - 22);
          on = Math.max(dr, dc) === 2 || (dr === 0 && dc === 0);
        } else {
          const seed = Math.sin((r * 37 + c * 91 + 19) * 12.9898) * 43758.5453;
          on = seed - Math.floor(seed) > 0.47;
        }

        if (on) {
          let ox = 0;
          let oy = 0;
          if (corruption > 0 && !inFinderZone) {
            const h = Math.sin(r * 17.3 + c * 43.7) * 43758.5;
            const rnd = h - Math.floor(h);
            if (rnd < corruption * 0.45) {
              ox = (rnd - 0.2) * corruption * 92;
              oy = Math.cos(r * c) * 0.5 * corruption * 72;
            }
          }
          ctx.fillRect(
            x + pad + c * cell + ox,
            y + pad + r * cell + oy,
            Math.ceil(cell * 0.98),
            Math.ceil(cell * 0.98)
          );
        }
      }
    }
  }

  private bakeStageTexture(stage: number, aftermath: boolean): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 2048;
    canvas.height = 1074;
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const W = 2048;
    const H = 1074;

    const finalizeTex = (): THREE.CanvasTexture => {
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.anisotropy = 8;
      tex.generateMipmaps = true;
      tex.needsUpdate = true;
      return tex;
    };

    if (aftermath) {
      ctx.fillStyle = '#051326';
      ctx.fillRect(0, 0, W, H);

      ctx.fillStyle = 'rgba(120, 190, 255, 0.03)';
      for (let y = 0; y < H; y += 4) {
        ctx.fillRect(0, y, W, 2);
      }
      const vg = ctx.createRadialGradient(W * 0.5, H * 0.48, H * 0.1, W * 0.5, H * 0.5, H * 0.78);
      vg.addColorStop(0, 'rgba(0, 0, 0, 0)');
      vg.addColorStop(1, 'rgba(0, 0, 0, 0.68)');
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, W, H);

      // Subtle ghostly reflection of a seated silhouette + faint ':)' watermark burned into phosphor!
      ctx.save();
      ctx.fillStyle = 'rgba(130, 205, 255, 0.08)';
      ctx.font = '300 245px "Segoe UI", "Yu Gothic UI", sans-serif';
      ctx.fillText(':)', 224, 372);
      ctx.restore();

      ctx.fillStyle = '#74b9ff';
      ctx.font = '600 31px Consolas, "Yu Gothic UI", monospace';
      ctx.fillText('KERNEL CRASH DUMP  //  SESSION RESTORED (02:48:00)', 180, 232);

      ctx.strokeStyle = 'rgba(120, 190, 255, 0.28)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(180, 264);
      ctx.lineTo(W - 180, 264);
      ctx.stroke();

      ctx.fillStyle = 'rgba(218, 236, 255, 0.86)';
      ctx.font = '300 25px Consolas, "Yu Gothic UI", monospace';
      ctx.fillText('DUMP_IMAGE     : C:\\Windows\\MEMORY_0247.DMP (VERIFIED)', 180, 318);
      ctx.fillText('INTERRUPT_VEC  : WAKE_UP [RING0 UNHOOKED]', 180, 364);

      ctx.fillStyle = '#ff6b88';
      ctx.font = '600 25px Consolas, "Yu Gothic UI", monospace';
      ctx.fillText('RESIDUAL_HANDLE: OPTIC_NERVE_CACHE -> 1 HANDLE STILL OPEN', 180, 418);
      ctx.fillStyle = 'rgba(255, 145, 168, 0.58)';
      ctx.font = '300 22px Consolas, "Yu Gothic UI", monospace';
      ctx.fillText('NOTE           : 背後の椅子がわずかに回転しています。確認しないでください。', 180, 466);

      ctx.fillStyle = 'rgba(140, 198, 255, 0.62)';
      ctx.font = '300 23px "Segoe UI", "Yu Gothic UI", sans-serif';
      ctx.fillText('画面をクリックすると MEMORY_0247.DMP を再マウントします', 180, 868);

      return finalizeTex();
    }

    // The BSOD is staged as an interruption, not a busy information board.  The first
    // image is recognisably ordinary; every following image removes certainty instead
    // of piling another dialog on top of it.  The animated shader supplies the actual
    // fracture, while this texture provides the calm, readable signal underneath.
    const blue = ['#0078d7', '#0074cf', '#005ba9', '#003e7d', '#00295c', '#001a42'][Math.min(stage, 5)];
    ctx.fillStyle = blue;
    ctx.fillRect(0, 0, W, H);

    // A restrained screen-pixel weave keeps the panel physical without turning the image
    // into permanent TV snow. It only becomes visible once the signal starts failing.
    if (stage > 0) {
      ctx.fillStyle = `rgba(202, 237, 255, ${0.015 + stage * 0.009})`;
      for (let y = 8; y < H; y += 6) ctx.fillRect(0, y, W, 1);
    }

    const leftX = 224;
    const fontStack = '"Segoe UI", "Yu Gothic UI", "Meiryo", sans-serif';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#ffffff';
    ctx.font = `300 47px ${fontStack}`;

    if (stage === 0) {
      ctx.fillText('問題が発生したため、PC を再起動する必要があります。', leftX, 492);
      ctx.fillText('エラー情報を収集しています。自動的に再起動します。', leftX, 558);
      ctx.fillText('99% 完了', leftX, 670);
    } else if (stage === 1) {
      ctx.fillText('問題が発生したため、PC を再起動する必要があります。', leftX, 492);
      ctx.fillText('エラー情報を収集しています。入力デバイスを検出しました。', leftX, 558);
      ctx.fillText('99% 完了', leftX, 670);
      ctx.fillStyle = 'rgba(231,246,255,0.62)';
      ctx.font = `300 21px Consolas, ${fontStack}`;
      ctx.fillText('DISPLAY_POINTER: motion registered before host response', leftX, 622);
    } else if (stage === 2) {
      ctx.fillText('再起動の準備中に、表示メモリが応答しなくなりました。', leftX, 492);
      ctx.fillText('この画面を閉じないでください。閉じる操作は記録されます。', leftX, 558);
      ctx.fillText('同期を試行中  //  99%', leftX, 670);
    } else {
      ctx.fillText('表示システムが現在の視点を使用しています。', leftX, 492);
      ctx.fillText('復旧するには、意識をこの画面の外へ移してください。', leftX, 558);
      ctx.fillText(stage >= 4 ? 'SIGNAL LOST' : 'MEMORY DUMP IN PROGRESS', leftX, 670);
    }

    // Signal geometry appears in the empty right field. It is deliberately architectural and
    // incomplete: scan coordinates, broken rails and a missing central wedge — never a fake UI panel.
    if (stage >= 2) {
      const railX = 1350;
      const railY = 140;
      const railW = 420;
      const railH = 550;
      ctx.save();
      ctx.strokeStyle = `rgba(164, 221, 255, ${0.18 + stage * 0.07})`;
      ctx.lineWidth = 2;
      for (let i = 0; i < 7; i++) {
        const y = railY + i * 78;
        const gap = 88 + ((i * 79 + stage * 47) % 190);
        ctx.beginPath();
        ctx.moveTo(railX, y);
        ctx.lineTo(railX + gap, y);
        ctx.moveTo(railX + gap + 56 + stage * 12, y);
        ctx.lineTo(railX + railW, y);
        ctx.stroke();
      }
      ctx.strokeStyle = `rgba(255, 98, 137, ${Math.max(0, stage - 2) * 0.13})`;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(railX + railW * 0.53, railY - 20);
      ctx.lineTo(railX + railW * 0.45, railY + railH * 0.42);
      ctx.lineTo(railX + railW * 0.62, railY + railH + 28);
      ctx.stroke();
      ctx.restore();
    }

    // Tiny diagnostic labels at the far edge are a depth cue. They do not compete with the
    // message or turn the whole monitor into a wall of exposition.
    if (stage >= 1) {
      ctx.save();
      ctx.font = '18px Consolas, monospace';
      ctx.fillStyle = `rgba(205, 237, 255, ${0.12 + stage * 0.045})`;
      const tags = ['FRAME_SYNC', 'INPUT_ECHO', 'RASTER_GAP', 'VIEWPORT_LOCK', 'EXIT_VECTOR'];
      for (let row = 0; row < 7; row++) {
        const addr = (0x0078d700 + row * 0x30 + stage * 0x100).toString(16).toUpperCase();
        ctx.fillText(`0x${addr}  ${tags[(row + stage) % tags.length]}`, 1505, 790 + row * 30);
      }
      ctx.restore();
    }

    const qrY = 742;
    const qrSize = 178;
    this.drawQrCode(ctx, leftX, qrY, qrSize, stage);
    const infoX = leftX + qrSize + 38;
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.font = `300 25px ${fontStack}`;
    ctx.fillText(stage < 2 ? '詳細については、https://www.windows.com/stopcode を参照してください' : 'DISPLAY_BUFFER: ownership could not be restored', infoX, qrY + 38);
    ctx.font = `300 22px ${fontStack}`;
    ctx.fillText(stage < 2 ? 'サポート担当者に連絡する場合は、次の情報を伝えてください:' : '最後に記録された停止コード:', infoX, qrY + 108);
    const stopCodes = ['CRITICAL_PROCESS_DIED', 'INPUT_ECHO_DETECTED', 'VIEWPORT_DESYNC', 'DISPLAY_OWNER_UNKNOWN', 'NO_SIGNAL', 'CONSCIOUSNESS_TRANSFER'];
    ctx.fillText(`停止コード: ${stopCodes[Math.min(stage, stopCodes.length - 1)]}`, infoX, qrY + 148);

    return finalizeTex();
  }

  /** Returns all pre-baked textures so WebGLRenderer can upload them upfront during loading! */
  public getAllTextures(): THREE.Texture[] {
    return [...this.stageTextures, this.aftermathTex, this.faceTex, this.cardTex];
  }

  /** Enables all sub-groups for 1 offscreen warmup frame so every VAO & shader compiles at boot! */
  public setWarmupVisibility(active: boolean): void {
    this.throatGroup.visible = active;
    this.parasyteGroup.visible = active;
    this.glassShards.visible = active;
    this.stencilMaskMesh.visible = active;
  }

  public isUvOnFace(uv: THREE.Vector2, madness: number): boolean {
    const cx = THREE.MathUtils.lerp(0.144, 0.48, THREE.MathUtils.smoothstep(madness, 0.14, 0.88));
    const cy = THREE.MathUtils.lerp(0.742, 0.48, THREE.MathUtils.smoothstep(madness, 0.14, 0.88));
    const rx = THREE.MathUtils.lerp(0.095, 0.35, madness);
    const ry = THREE.MathUtils.lerp(0.145, 0.37, madness);
    const dx = (uv.x - cx) / rx;
    const dy = (uv.y - cy) / ry;
    return dx * dx + dy * dy <= 1.0;
  }

  public setInsideTunnelMode(inside: boolean): void {
    if (this.insideTunnelMode === inside) return;
    this.insideTunnelMode = inside;
    // NOTE: WebGLState reads material.stencilWrite directly per draw call — NEVER set
    // mat.needsUpdate = true here or Three.js synchronously recompiles 4 shaders mid-cutscene!
    for (const mat of this.throatMaterials) {
      mat.stencilWrite = !inside;
    }
    this.throatTubeMat.depthFunc = inside ? THREE.LessEqualDepth : THREE.AlwaysDepth;
    this.throatRingMat.uniforms.uInside.value = inside ? 1.0 : 0.0;
    this.throatLineMat.uniforms.uInside.value = inside ? 1.0 : 0.0;
    this.stencilMaskMesh.visible = !inside && this.throatGroup.visible;
  }

  /** Start a crack running along '(' and trigger LCD pressure wave from click UV. */
  public pulseCrack(uv?: THREE.Vector2): void {
    this.crackRun = 0;
    if (uv) this.impactUv.copy(uv);
  }

  public update(
    dt: number,
    elapsed: number,
    state: BsodScreenState,
    clickPulse: number,
    tunnelScrollPhase?: number
  ): void {
    const stage = Math.min(5, state.clickCount);
    const u = this.screenMat.uniforms;
    if (stage !== this.lastRenderedStage || state.aftermath !== this.lastAftermath) {
      this.lastRenderedStage = stage;
      this.lastAftermath = state.aftermath;
      u.uBodyTex.value = state.aftermath ? this.aftermathTex : this.stageTextures[stage];
    }
    u.uTime.value = elapsed;
    u.uHover.value = THREE.MathUtils.lerp(u.uHover.value, state.hoverFace ? 1.0 : 0.0, Math.min(1, dt * 12));
    u.uCursorUv.value.copy(state.cursorUv);
    u.uImpactUv.value.copy(this.impactUv);
    u.uMadness.value = state.madness;
    u.uJawOpen.value = state.jawOpen;
    u.uSuction.value = state.suctionProgress;
    u.uClickPulse.value = clickPulse;
    this.crackRun = Math.min(1, this.crackRun + dt / 0.42);
    u.uCrackRun.value = this.crackRun;
    u.uAftermath.value = state.aftermath ? 1.0 : 0.0;
    u.uColonDotOff.value = this.colonDotOff;

    // Monitor light intensifies dynamically during escalation
    if (state.aftermath) {
      this.monitorLight.color.setHex(0x1358a8);
      this.monitorLight.intensity = 0.42 + Math.sin(elapsed * 2.1) * 0.04;
    } else {
      const flicker =
        state.madness > 0.05
          ? Math.sin(elapsed * 47.0) * 0.45 * state.madness + clickPulse * 2.4
          : Math.sin(elapsed * 3.2) * 0.03;
      this.monitorLight.color.setHex(0x0078d7);
      this.monitorLight.intensity = Math.max(0.45, 2.35 + state.madness * 4.4 + flicker);
      this.monitorLight.distance = 6.5 + state.madness * 5.2;
    }

    // 100% GPU-driven 3D Parasyte rig, tunnel & glass shard uniform updates (ZERO CPU matrix loops!)
    // Legacy anatomical rig is deliberately never displayed: the face stays digital.
    const showParasyte = false;
    this.parasyteGroup.visible = showParasyte;
    if (showParasyte) {
      const rtu = this.rimToothMat.uniforms;
      rtu.uTime.value = elapsed;
      rtu.uMadness.value = state.madness;
      rtu.uJawOpen.value = state.jawOpen;
      rtu.uSuction.value = state.suctionProgress;
      rtu.uClickPulse.value = clickPulse;
      rtu.uCrackRun.value = this.crackRun;

      const jfu = this.jawFlapMat.uniforms;
      jfu.uTime.value = elapsed;
      jfu.uMadness.value = state.madness;
      jfu.uJawOpen.value = state.jawOpen;
      jfu.uSuction.value = state.suctionProgress;
      jfu.uClickPulse.value = clickPulse;
      jfu.uCrackRun.value = this.crackRun;

      const snu = this.sinewMat.uniforms;
      snu.uTime.value = elapsed;
      snu.uMadness.value = state.madness;
      snu.uJawOpen.value = state.jawOpen;
      snu.uSuction.value = state.suctionProgress;
      snu.uClickPulse.value = clickPulse;
      snu.uCrackRun.value = this.crackRun;

      const eyu = this.parasyteEyeMat.uniforms;
      eyu.uTime.value = elapsed;
      eyu.uMadness.value = state.madness;
      eyu.uJawOpen.value = state.jawOpen;
      eyu.uSuction.value = state.suctionProgress;
      eyu.uClickPulse.value = clickPulse;
      eyu.uCrackRun.value = this.crackRun;
      eyu.uHover.value = u.uHover.value;
      eyu.uCursorUv.value.copy(state.cursorUv);
    }

    const showThroat = !state.aftermath && state.suctionProgress > 0.03;
    this.throatGroup.visible = showThroat;
    this.glassShards.visible = false;
    this.throatTeeth.visible = false;
    if (!this.insideTunnelMode) {
      this.stencilMaskMesh.visible = showThroat;
    }

    if (showThroat) {
      const scrollPhase =
        tunnelScrollPhase ?? elapsed * (6.0 + state.suctionProgress * 42.0);
      this.throatTubeMat.uniforms.uTime.value = elapsed;
      this.throatTubeMat.uniforms.uScrollPhase.value = scrollPhase;
      this.throatTubeMat.uniforms.uMadness.value = state.madness;
      this.throatTubeMat.uniforms.uSuction.value = state.suctionProgress;

      this.throatRingMat.uniforms.uTime.value = elapsed;
      this.throatRingMat.uniforms.uScrollPhase.value = scrollPhase;
      this.throatRingMat.uniforms.uMadness.value = state.madness;
      this.throatRingMat.uniforms.uSuction.value = state.suctionProgress;

      this.throatShardMat.uniforms.uTime.value = elapsed;
      this.throatShardMat.uniforms.uScrollPhase.value = scrollPhase;
      this.throatShardMat.uniforms.uSuction.value = state.suctionProgress;

      this.throatLineMat.uniforms.uTime.value = elapsed;
      this.throatLineMat.uniforms.uScrollPhase.value = scrollPhase;
      this.throatLineMat.uniforms.uSuction.value = state.suctionProgress;

      this.throatToothMat.uniforms.uTime.value = elapsed;
      this.throatToothMat.uniforms.uMadness.value = state.madness;
      this.throatToothMat.uniforms.uJawOpen.value = state.jawOpen;
      this.throatToothMat.uniforms.uSuction.value = state.suctionProgress;
      this.throatToothMat.uniforms.uClickPulse.value = clickPulse;

      if (this.glassShards.visible) {
        const gu = this.glassShardMat.uniforms;
        gu.uTime.value = elapsed;
        gu.uMadness.value = state.madness;
        gu.uJawOpen.value = state.jawOpen;
        gu.uSuction.value = state.suctionProgress;
        gu.uClickPulse.value = clickPulse;
      }
    }
  }
}
