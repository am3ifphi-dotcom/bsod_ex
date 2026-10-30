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
const THROAT_TOOTH_COUNT = 112;
const RIM_TOOTH_COUNT = 52;
const JAW_FLAP_COUNT = 4;
const SINEW_COUNT = 32;
const PARASYTE_EYE_COUNT = 11;
const GLASS_SHARD_COUNT = 48;

function buildParasyteMandibleGeometry(): THREE.BufferGeometry {
  // Sculpted 3D curved Parasyte flesh-and-LCD mandible petal:
  // u in [-1..+1] (angular span across one quadrant lobe), v in [0..1] (0 = inner gumline rim, 1 = torn outer skin base)
  const uSegs = 12;
  const vSegs = 8;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let iv = 0; iv <= vSegs; iv++) {
    const v = iv / vSegs; // 0 = biting lip rim, 1 = outer cheek root
    // Narrower rounded tip near the biting lip, broader muscular base where it tears out of the LCD
    const halfSpan = 0.72 * Math.sin((0.20 + 0.76 * v) * Math.PI * 0.62) + 0.14 * (1.0 - v);
    // Volumetric fleshy thickness ridge along the curved petal
    const archCamber = Math.sin(v * Math.PI) * 0.048;
    for (let iu = 0; iu <= uSegs; iu++) {
      const u = (iu / uSegs) * 2.0 - 1.0; // -1..+1
      const edgeTaper = Math.cos(u * Math.PI * 0.48);
      const x = u * halfSpan;
      const y = v;
      const z = archCamber * edgeTaper + (1.0 - v) * 0.018 * edgeTaper;
      positions.push(x, y, z);
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
      indices.push(a, b, c, b, d, c);
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
  // Sculpted 3D Parasyte tooth (寄生獣): a broad, heavy dentin blade with a bulging bony shoulder,
  // a flared fleshy cervical root and a hooked, razor crown. The old profile tapered so hard that
  // the deep esophageal rows read as thin needles — these are deliberately thick and blade-like.
  const rings = 7;
  const segs = 10;
  const profile: Array<[number, number, number, number]> = [
    // [y (0..1), rx (mesial-distal width), rz (labial-lingual thickness), hookZ (anatomical curve)]
    [0.0, 0.086, 0.070, 0.0],
    [0.12, 0.094, 0.080, 0.002],
    [0.30, 0.100, 0.076, 0.008],
    [0.52, 0.092, 0.058, 0.020],
    [0.72, 0.070, 0.040, 0.036],
    [0.88, 0.040, 0.022, 0.054],
    [1.0, 0.006, 0.005, 0.070],
  ];
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let r = 0; r < rings; r++) {
    const [ty, rx, rz, hz] = profile[r];
    for (let s = 0; s <= segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      positions.push(Math.cos(a) * rx, ty * 0.30, Math.sin(a) * rz + hz);
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

    // 2. Separate Face Channel Map (R = ':' eyes, G = '(' mouth stroke)
    this.faceCanvas = document.createElement('canvas');
    this.faceCanvas.width = 768;
    this.faceCanvas.height = 768;
    this.renderFaceChannelTexture();
    this.faceTex = new THREE.CanvasTexture(this.faceCanvas);
    this.faceTex.minFilter = THREE.LinearFilter;
    this.faceTex.magFilter = THREE.LinearFilter;
    this.faceTex.generateMipmaps = false;

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
          float straighten = 1.0 - smoothstep(0.50, 0.92, uSuction);
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
        uniform float uMadness;
        uniform float uSuction;
        uniform sampler2D uNoiseTex;

        void main() {
          float depthFactor = clamp(-vTubePos.z / 115.0, 0.0, 1.0);
          float speed = 6.0 + uSuction * 42.0;
          float zScroll = vTubePos.z * 0.62 + uTime * speed;

          float safeTx = (abs(vTubePos.x) < 1e-5 && abs(vTubePos.y) < 1e-5) ? 1e-5 : vTubePos.x;
          float angle = atan(vTubePos.y, safeTx);
          vec4 nSample = texture2D(uNoiseTex, vec2(angle * 0.3183, vTubePos.z * 0.025 + uTime * 0.18));

          vec2 cell = vec2(angle * 6.366, zScroll);
          vec2 f = fract(cell);
          float line = smoothstep(0.075, 0.0, min(f.x, 1.0 - f.x)) + smoothstep(0.06, 0.0, min(f.y, 1.0 - f.y));
          float helixA = pow(max(0.0, sin(angle * 6.0 + vTubePos.z * 0.22 + uTime * (4.2 + uSuction * 13.0))), 8.0);
          float helixB = pow(max(0.0, cos(angle * 10.0 - vTubePos.z * 0.16 + uTime * (3.2 + uSuction * 9.5))), 10.0);
          float shockRing = smoothstep(0.92, 1.0, fract(vTubePos.z * 0.09 + uTime * (2.0 + uSuction * 5.0)));

          vec3 darkGullet = vec3(0.016, 0.005, 0.028);
          // Match GlitchWorld's opaque Sky-Maw sleeve palette in the deep zone (depthFactor > 0.46) for a 0-cut transition!
          vec3 sleeveDeep = vec3(0.004, 0.065, 0.28);
          vec3 sleeveMid = vec3(0.006, 0.12, 0.44);

          float ribFold = pow(0.5 + 0.5 * sin(vTubePos.z * 1.45 - uTime * 5.5 + nSample.r * 2.4), 3.0);
          float horrorZone = smoothstep(0.54, 0.04, depthFactor);
          float sleeveZone = smoothstep(0.38, 0.72, depthFactor);

          // Near half: wet crimson Parasyte esophagus -> Deep half: morphs smoothly into GlitchWorld's cerulean vortex sleeve!
          vec3 sleeveBase = mix(sleeveDeep, sleeveMid, smoothstep(0.55, 0.92, depthFactor));
          vec3 col = mix(darkGullet, sleeveBase, sleeveZone);
          col += vec3(0.42, 0.015, 0.06) * ribFold * horrorZone;
          col += vec3(0.76, 0.05, 0.14) * pow(nSample.a, 2.8) * horrorZone * 0.92;

          // Glaring watching slit-eyes embedded in the fleshy gullet walls (near half)
          vec2 eyeGrid = fract(vec2(angle * 2.546 + 0.25, -vTubePos.z * 0.14) + vec2(0.0, sin(angle * 3.0) * 0.2));
          vec2 eyeD = (eyeGrid - 0.5) * vec2(1.0, 2.2);
          float wallEye = smoothstep(0.28, 0.10, length(eyeD)) * step(0.62, nSample.g) * horrorZone;
          float wallPupil = smoothstep(0.06, 0.015, abs(eyeD.x)) * smoothstep(0.14, 0.04, abs(eyeD.y));
          col = mix(col, vec3(0.92, 0.88, 0.84), wallEye * 0.78);
          col = mix(col, vec3(0.04, 0.0, 0.02), wallEye * wallPupil);

          col += vec3(0.28, 0.76, 1.0) * line * mix(0.06, 0.46, sleeveZone);
          col += vec3(0.32, 0.84, 1.0) * (helixA * 0.55 + helixB * 0.45) * mix(0.08, 0.88, sleeveZone);
          col += vec3(0.70, 0.94, 1.0) * shockRing * mix(0.10, 0.72, sleeveZone);

          // === SEAMLESS DEAD-CENTER FAR-END PORTAL VISTA (MATCHING GLITCH WORLD SKY-MAW OPENING 1:1) ===
          float portalMask = smoothstep(0.88, 0.995, depthFactor);
          vec2 radialP = vTubePos.xy / 5.6;
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
          // The far end is a smooth, soft-edged organic aperture (no teeth, no serrated rim):
          // the silhouette feathers into the throat tone so the hand-off to GlitchWorld's sleeve
          // cannot read as a hard cut.
          float rimR = length(radialP);
          float softRim = smoothstep(0.74, 1.0, rimR);
          gwSky = mix(gwSky, vec3(0.010, 0.045, 0.150), softRim * 0.55);
          gwSky += vec3(0.35, 0.72, 1.0) * exp(-abs(rimR - 0.72) * 15.0) * 0.20;

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
        uMadness: { value: 0 },
        uSuction: { value: 0 },
        uInside: { value: 0 },
      },
      vertexShader: /* glsl */ `
        attribute float aFrac;
        uniform float uTime;
        uniform float uMadness;
        uniform float uSuction;
        varying float vDepthT;
        varying float vNearClip;
        void main() {
          float zSpan = 112.0;
          float speed = 5.5 + uMadness * 9.0 + uSuction * 40.0;
          float z = -mod(aFrac * zSpan - uTime * speed, zSpan) - 0.45;
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
        uSuction: { value: 0 },
      },
      vertexShader: /* glsl */ `
        attribute vec4 aSeed4;
        uniform float uTime;
        uniform float uSuction;
        varying vec2 vUv;
        varying float vFade;
        void main() {
          vUv = uv;
          float zSpan = 110.0;
          float spd = (8.0 + aSeed4.w * 10.0) + uSuction * 36.0;
          float z = -zSpan + mod(aSeed4.z * zSpan + uTime * spd, zSpan - 0.35);
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
        uSuction: { value: 0 },
        uInside: { value: 0 },
      },
      vertexShader: /* glsl */ `
        attribute vec4 aSeed4;
        uniform float uTime;
        uniform float uSuction;
        uniform float uInside;
        varying float vBright;
        void main() {
          float zSpan = 112.0;
          float spd = (20.0 + aSeed4.w * 24.0) * (1.0 + uSuction * 3.4);
          // Clamp front bound to -0.45 while outside monitor so lines never poke through solid screen glass!
          float maxZ = mix(-0.45, 2.0, uInside);
          float z = -zSpan + mod(aSeed4.z * zSpan + uTime * spd, zSpan + maxZ);
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
    const teethPerRing = 28;
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

          // Hidden during INSPECT_PC (uSuction == 0) so the mouth itself ONLY has its clean single row of teeth!
          float insideVis = smoothstep(0.05, 0.22, uSuction);
          float ringZ = -14.0 - ringIdx * 8.5;
          float clampWave = sin(-ringZ * 0.35 - uTime * 7.0) * 0.16;
          // Roots sit exactly on the flaring throat wall (radius 1.42 at z=0 -> 5.6 at z=-116)
          // so the broad Parasyte blades grow out of the flesh instead of floating behind it.
          float wallR = 1.42 + (-ringZ / 116.0) * 4.18;
          float rad = max(1.35, wallR - 0.05 + clampWave + sin(uTime * 16.0 + phase) * 0.05);

          vec2 radialDir = vec2(cos(ang), sin(ang));
          vec2 tangentDir = vec2(-radialDir.y, radialDir.x);

          // Thick, uneven, blade-like fangs (寄生獣): wide root, heavy body, hooked crown.
          float fat = 0.82 + lenScale * 0.42;
          float h = 1.42 * lenScale * insideVis;
          float w = 2.05 * fat * insideVis;
          vec3 inwardAxis = normalize(vec3(-radialDir, -0.58));
          vec3 sideAxis = vec3(tangentDir, 0.0);
          vec3 depthAxis = normalize(cross(inwardAxis, sideAxis));

          vec3 rootPos = vec3(radialDir * rad, ringZ);
          vec3 worldLocal = rootPos
                          + sideAxis * (position.x * w)
                          + inwardAxis * (position.y * h)
                          + depthAxis * (position.z * w);
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

          vec3 gumRoot = vec3(0.16, 0.012, 0.045);
          vec3 boneMid = vec3(0.86, 0.83, 0.76);
          vec3 razorTip = vec3(0.97, 0.96, 0.93);
          vec3 col = mix(gumRoot, boneMid, smoothstep(0.0, 0.34, vTip));
          col = mix(col, razorTip, smoothstep(0.34, 0.92, vTip));
          col *= diff * (1.0 - vRing * 0.12);
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

    // 6. Subdivided 44x26 BSOD LCD Surface Shader (100% NaN-safe, Multi-Stage Metamorphosis!)
    const screenGeo = new THREE.PlaneGeometry(BsodScreen.LOCAL_W, BsodScreen.LOCAL_H, 44, 26);
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

        float hash21v(vec2 p) {
          vec3 p3 = fract(vec3(p.xyx) * 0.1031);
          p3 += dot(p3, p3.yzx + 33.33);
          return fract((p3.x + p3.y) * p3.z);
        }

        // Gaping abyssal maw: tears progressively wider & holds WIDE OPEN waiting to suck you in (ZERO pakupaku chomping!)
        vec4 evalParasyteChewV(float t, float madness, float jawOpen, float suction, float clickPulse) {
          float openT = clamp(jawOpen, 0.0, 1.0);
          float baseOpen = pow(openT, 0.68);
          float inhaleBreath = sin(t * 1.25) * 0.026 * openT;
          float clickTear = clickPulse * 0.065 * smoothstep(0.08, 0.32, madness);
          float swallowUnhinge = smoothstep(0.10, 0.45, suction) * 0.38;
          float effOpen = clamp(baseOpen + inhaleBreath + clickTear + swallowUnhinge, 0.0, 1.34);
          return vec4(effOpen, 0.0, 0.0, 0.0);
        }

        void main() {
          vUv = uv;
          vec3 p = position;

          vec2 mawCenter = mix(vec2(0.144, 0.742), vec2(0.48, 0.48), smoothstep(0.14, 0.88, uMadness));
          float faceScaleV = max(mix(0.35, 0.84, smoothstep(0.12, 0.90, uMadness)), 0.08);
          vec4 chewV = evalParasyteChewV(uTime, uMadness, uJawOpen, uSuction, uClickPulse);
          float openN = chewV.x;
          float biteV = chewV.y;

          float fastTickV = floor(uTime * 42.0);
          vec2 spasmV = vec2(hash21v(vec2(fastTickV, 1.7)) - 0.5, hash21v(vec2(fastTickV, 9.3)) - 0.5)
                      * (0.002 * uHover + 0.020 * pow(uMadness, 1.4) + 0.015 * uClickPulse);
          vec2 fLocV = (uv - mawCenter + spasmV) * vec2(1.90566, 1.0) / faceScaleV;

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
          // Opposite jaw halves shear sideways against each other as they chew!
          vec2 jawShearV = vec2(chewV.z * sign(fLocV.y - parenLocV.y + 1e-4), chewV.w * sign(fLocV.x - mouthCxV + 1e-4));
          vec2 mdV = (fLocV - jawShearV) - vec2(mouthCxV, parenLocV.y);

          float crackGateV = 1.0 - smoothstep(0.04, 0.20, openN);
          float crackGrownV = smoothstep(1.0 - uCrackRun, 1.02, abs(tvV));
          float openNcV = openN * mix(1.0, crackGrownV, crackGateV);
          float safeMdXV = (abs(mdV.x) < 1e-5 && abs(mdV.y) < 1e-5) ? 1e-5 : mdV.x;
          float polarAngV = atan(mdV.y, safeMdXV);
          float mawLobeV = 1.0 + 0.16 * pow(0.5 + 0.5 * cos(polarAngV * 4.0 - 0.35), 2.0) * clamp(openN, 0.0, 1.1)
                         + 0.04 * sin(polarAngV * 3.0 - uTime * 2.2) * clamp(openN, 0.0, 1.1);
          float lipProfV = pow(max(0.0, 1.0 - pow(min(abs(tvRawV), 1.0), 2.2)), 0.60);
          float slitGapeV = max(mix(0.0001, 0.24, pow(max(openNcV, 0.0), 1.15)) * lipProfV, 1e-4);
          float slitDistV = abs(mdV.x) / slitGapeV + max(0.0, abs(tvRawV) - 1.0) * 6.0;
          float circRadXV = max(mix(0.04, 0.43, pow(max(openNcV, 0.0), 0.85)), 1e-4);
          float circDistV = length(vec2(mdV.x / circRadXV, mdV.y / halfLenV)) / mawLobeV;
          float nDist = mix(slitDistV, circDistV, smoothstep(0.06, 0.30, openNcV));

          float tearOpenV = smoothstep(0.06, 0.30, openNcV);
          float caveAmt = smoothstep(1.36, 0.50, nDist) * openNcV * tearOpenV;
          // 4-petal Parasyte flesh lobes peel forward (+Z) when gaping wide & lunge forward when biting!
          float lobeCurl = 0.72 + 0.58 * pow(0.5 + 0.5 * cos(polarAngV * 4.0 - 0.35), 2.0);
          float lipBulge = exp(-pow((nDist - 1.05) * 3.2, 2.0)) * (openNcV * 0.125 + biteV * 0.085) * lobeCurl;
          float lunge = exp(-nDist * nDist * 1.3) * (uClickPulse * 0.22 + biteV * 0.09) * step(0.24, uMadness);
          float clickWave = sin(nDist * 12.0 - (1.0 - uClickPulse) * 14.0) * exp(-nDist * 1.8) * uClickPulse * 0.016;
          p.z += lunge + lipBulge + clickWave - caveAmt * 0.42;

          float jitter = sin(uTime * 67.0 + uv.y * 40.0) * (uMadness * 0.0028 + uClickPulse * 0.007);
          p.x += jitter * (1.0 - smoothstep(0.0, 0.06, min(uv.x, 1.0 - uv.x)));

          vCaveDepth = caveAmt;
          vLocalPos = p;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        varying float vCaveDepth;
        varying vec3 vLocalPos;
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
          float inhaleBreath = sin(t * 1.25) * 0.026 * openT;
          float clickTear = clickPulse * 0.065 * smoothstep(0.08, 0.32, madness);
          float swallowUnhinge = smoothstep(0.10, 0.45, suction) * 0.38;
          float effOpen = clamp(baseOpen + inhaleBreath + clickTear + swallowUnhinge, 0.0, 1.34);
          return vec4(effOpen, 0.0, 0.0, 0.0);
        }

        void main() {
          vec2 uv = vUv;

          // ---------------------------------------------------------------- 1. FACE & PARASYTE MAW GEOMETRY
          vec2 faceCenter = faceCenterOf(uMadness);
          float faceScale = faceScaleOf(uMadness);

          vec2 parenLocal = uParenC - vec2(0.5);
          vec2 colonLocal = uColonC - vec2(0.5);
          float parenHalfH = max(uParenSize.y * 0.5, 0.05);
          float eyeR = max(uColonSize.x * 0.5, 0.02);
          float eyeOff = abs(uColonDotOff);

          vec4 chew = evalParasyteChew(uTime, uMadness, uJawOpen, uSuction, uClickPulse);
          float openN = chew.x;

          float fastTick = floor(uTime * 42.0);
          vec2 spasm = vec2(hash21(vec2(fastTick, 1.7)) - 0.5, hash21(vec2(fastTick, 9.3)) - 0.5)
                     * (0.0018 * uHover + 0.020 * pow(uMadness, 1.4) + 0.015 * uClickPulse);
          float rotSpasm = (hash11(fastTick * 3.1) - 0.5) * 0.065 * pow(uMadness, 1.45);

          vec2 aspectDelta = (uv - faceCenter + spasm) * vec2(1.90566, 1.0);
          vec2 fLocal = (rot2(rotSpasm) * aspectDelta) / faceScale;

          float halfLen = max(mix(parenHalfH, 0.43, pow(clamp(openN, 0.0, 1.2), 0.78)), 1e-4);
          float tvRaw = (fLocal.y - parenLocal.y) / halfLen;
          float tv0 = clamp(tvRaw, -1.0, 1.0);

          vec3 spineF = uSpine - vec3(0.5);
          float spineHere = 0.5 * tv0 * (tv0 - 1.0) * spineF.x
                          + (1.0 - tv0 * tv0) * spineF.y
                          + 0.5 * tv0 * (tv0 + 1.0) * spineF.z;
          float mouthCx = mix(spineHere, 0.0, pow(clamp(openN, 0.0, 1.0), 0.9));
          vec2 jawShear = vec2(chew.z * sign(fLocal.y - parenLocal.y + 1e-4), chew.w * sign(fLocal.x - mouthCx + 1e-4));
          vec2 md = (fLocal - jawShear) - vec2(mouthCx, parenLocal.y);
          float safeMdX = (abs(md.x) < 1e-5 && abs(md.y) < 1e-5) ? 1e-5 : md.x;
          float polarAng = atan(md.y, safeMdX);
          float ang01 = polarAng * 0.15915494 + 0.5;

          float lipProf = pow(max(0.0, 1.0 - pow(min(abs(tvRaw), 1.0), 2.2)), 0.60);
          float crackGate = 1.0 - smoothstep(0.04, 0.20, openN);
          float crackGrown = smoothstep(1.0 - uCrackRun, 1.02, abs(tv0));
          float openNc = openN * mix(1.0, crackGrown, crackGate);

          float slitGape = max(mix(0.0001, 0.24, pow(max(openNc, 0.0), 1.15)) * lipProf, 1e-4);
          float slitDist = abs(md.x) / slitGape + max(0.0, abs(tvRaw) - 1.0) * 6.0;
          float circRadX = max(mix(0.04, 0.43, pow(max(openNc, 0.0), 0.85)), 1e-4);
          float mawWobble = 1.0 + 0.16 * pow(0.5 + 0.5 * cos(polarAng * 4.0 - 0.35), 2.0) * clamp(openN, 0.0, 1.1)
                          + 0.04 * sin(polarAng * 3.0 - uTime * 2.2) * clamp(openN, 0.0, 1.1);
          float circleDist = length(vec2(md.x / circRadX, md.y / halfLen)) / mawWobble;
          float mDist = mix(slitDist, circleDist, smoothstep(0.06, 0.30, openNc));

          float mEdge = exp(-pow((mDist - 1.02) * 26.0, 2.0));
          float mStress = smoothstep(2.1, 1.0, mDist);
          float mInner = smoothstep(1.05, 0.90, mDist);
          float mWet = exp(-pow((mDist - 1.06) * 16.0, 2.0));

          // Clean 4-lobed fleshy mouth opening — NO 2D painted teeth here so the single 3D tooth row is 100% crisp!
          float tearOpen = smoothstep(0.06, 0.30, openNc);
          if (uAftermath < 0.5 && tearOpen > 0.01 && mDist < 0.985) discard;

          // ---------------------------------------------------------------- 2. MULTI-STAGE LCD DISTORTION & GRAVITATIONAL VORTEX
          vec4 noiseA = texture2D(uNoiseTex, uv * vec2(3.2, 1.8) + vec2(0.0, uTime * 0.04));
          vec4 noiseB = texture2D(uNoiseTex, uv * vec2(7.5, 4.2) - vec2(uTime * 0.03, 0.0));

          vec2 impDelta = (uv - uImpactUv) * vec2(1.90566, 1.0);
          float impDist = length(impDelta);
          float ringRadius = (1.0 - uClickPulse) * 0.68;
          float impWave = exp(-pow((impDist - ringRadius) * 12.0, 2.0)) * uClickPulse;
          vec2 impDir = impDist > 1e-4 ? impDelta / impDist : vec2(0.0, 1.0);

          float tearAmt = uMadness * 0.045 + uClickPulse * 0.050;
          float band = floor(uv.y * (26.0 + uMadness * 38.0));
          float tick = floor(uTime * (13.0 + uMadness * 26.0));
          float bandRnd = hash21(vec2(band, tick));
          float bandShift = step(0.87 - uMadness * 0.32, bandRnd) * (bandRnd - 0.5) * 2.0 * (tearAmt * 0.44);

          float meltMask = smoothstep(0.16, 0.88, uMadness);
          float meltStream = pow(noiseA.b, 2.2) * meltMask * (0.045 + 0.14 * uMadness * (0.5 + 0.5 * sin(uTime * 1.7 + uv.x * 18.0)));

          vec2 bodyUv = uv + vec2(bandShift, meltStream) + impDir * impWave * 0.016;

          float vortexHalo = exp(-pow(length(md) * 2.55, 2.0)) * smoothstep(0.02, 0.45, openN + uMadness * 0.35);
          if (vortexHalo > 0.002) {
            vec2 dirLocal = normalize(md + vec2(1e-5, 0.0));
            vec2 swirlLocal = rot2(0.58 * openN) * dirLocal;
            vec2 dirUv = normalize((rot2(-rotSpasm) * swirlLocal) * faceScale * vec2(1.0 / 1.90566, 1.0) + vec2(1e-6, 0.0));
            bodyUv -= dirUv * (0.062 * vortexHalo * (0.45 + openN) + 0.032 * mEdge * openN);
          }
          bodyUv = clamp(bodyUv, 0.001, 0.999);

          float chr = uMadness * 0.0065 + uClickPulse * 0.011 + mStress * openN * 0.010 + impWave * 0.014;
          vec3 panel;
          panel.r = texture2D(uBodyTex, clamp(bodyUv + vec2(chr, 0.0), 0.001, 0.999)).r;
          panel.g = texture2D(uBodyTex, bodyUv).g;
          panel.b = texture2D(uBodyTex, clamp(bodyUv - vec2(chr, 0.0), 0.001, 0.999)).b;

          if (uMadness > 0.38 && uAftermath < 0.5) {
            float recAmt = smoothstep(0.38, 0.92, uMadness);
            vec2 recUv1 = clamp((bodyUv - faceCenter) * 1.48 + faceCenter, 0.002, 0.998);
            vec2 recUv2 = clamp((bodyUv - faceCenter) * 2.25 + faceCenter, 0.002, 0.998);
            vec3 recCol = texture2D(uBodyTex, recUv1).rgb * 0.65 + texture2D(uBodyTex, recUv2).rgb * 0.35;
            float peelHole = smoothstep(0.58, 0.82, noiseA.r + uMadness * 0.32) * recAmt * 0.42;
            panel = mix(panel, recCol * vec3(0.45, 0.78, 1.15), peelHole);
          }

          vec3 col = mix(vec3(0.0, 0.4706, 0.8392), panel, clamp(length(panel) * 1.6, 0.0, 1.0));

          if (uAftermath < 0.5) {
            // ---------------------------------------------------------------- 3. SPIDERWEB GLASS CRACKS & NEWTON BRUISE
            vec3 newton = 0.5 + 0.5 * cos(6.28318 * (impDist * 7.5 - uTime * 2.0 + vec3(0.0, 0.33, 0.67)));
            col = mix(col, col * (0.55 + 0.75 * newton), impWave * 0.55);

            float bruiseAmt = smoothstep(0.02, 0.16, uMadness + 0.35 * uHover);
            float bruise = exp(-pow(length((fLocal - parenLocal) * vec2(1.4, 1.1)) * 2.4, 2.0));
            col *= 1.0 - bruise * bruiseAmt * (0.18 + 0.34 * uMadness);

            if (uMadness > 0.22 && uMadness < 0.68) {
              float phantomFlick = step(0.91, sin(uTime * 19.0) * cos(uTime * 7.3));
              vec2 silP = (uv - vec2(0.66, 0.46)) * vec2(1.9, 1.0);
              float headD = smoothstep(0.085, 0.035, length(silP - vec2(0.0, 0.14)));
              float torsoD = smoothstep(0.19, 0.07, length((silP + vec2(0.0, 0.12)) * vec2(0.75, 1.0)));
              float sil = clamp(headD + torsoD, 0.0, 1.0) * phantomFlick;
              col *= 1.0 - sil * 0.38;
              float rEyes = smoothstep(0.011, 0.003, length(silP - vec2(-0.024, 0.148)))
                          + smoothstep(0.011, 0.003, length(silP - vec2(0.024, 0.148)));
              col += vec3(0.75, 0.92, 1.0) * rEyes * phantomFlick * 0.55;
            }

            if (uMadness > 0.04) {
              // High-contrast DARK shattered-LCD spiderweb fractures (dead black liquid-crystal leak — NEVER bright bloom wash!)
              vec2 crackDelta = (uv - faceCenter) * vec2(1.90566, 1.0);
              float crackDist = length(crackDelta);
              float safeCx = (abs(crackDelta.x) < 1e-5 && abs(crackDelta.y) < 1e-5) ? 1e-5 : crackDelta.x;
              float crackAng = atan(crackDelta.y, safeCx);
              float crackReach = 0.16 + pow(uMadness, 0.78) * 1.18;
              float webMask = smoothstep(crackReach, crackReach * 0.08, crackDist) * smoothstep(0.03, 0.16, uMadness);

              // Jagged angular primary & secondary spiderweb branches + concentric stress rings
              float jagA = (noiseB.r - 0.5) * 0.42 + (noiseA.g - 0.5) * 0.18;
              float spoke11 = abs(fract((crackAng * 0.1591549 + 0.5) * 11.0 + jagA) - 0.5);
              float spoke23 = abs(fract((crackAng * 0.1591549 + 0.5) * 23.0 - jagA * 1.4) - 0.5);
              float ringWeb = abs(fract(crackDist * 7.5 + noiseB.g * 0.85 + sin(crackAng * 5.0) * 0.18) - 0.5);

              float mainCrack = smoothstep(0.022, 0.004, spoke11) * webMask;
              float branchCrack = smoothstep(0.016, 0.003, spoke23) * step(0.38, noiseA.r) * webMask * smoothstep(0.14, 0.45, uMadness);
              float ringCrack = smoothstep(0.018, 0.003, ringWeb) * step(0.44, noiseB.b) * webMask * smoothstep(0.18, 0.55, uMadness);

              // Extra impact spiderweb around last clicked point!
              float impSafeX = (abs(impDelta.x) < 1e-5 && abs(impDelta.y) < 1e-5) ? 1e-5 : impDelta.x;
              float impAng = atan(impDelta.y, impSafeX);
              float impSpoke = smoothstep(0.024, 0.004, abs(fract((impAng * 0.1591549 + 0.5) * 9.0 + noiseB.r * 0.35) - 0.5))
                             * smoothstep(0.36, 0.02, impDist) * smoothstep(0.04, 0.18, uMadness);

              float crackCore = clamp(max(max(mainCrack, branchCrack), max(ringCrack, impSpoke)), 0.0, 1.0);
              float crackBruise = clamp((smoothstep(0.065, 0.010, spoke11) * 0.65 + smoothstep(0.055, 0.008, ringWeb) * 0.45) * webMask, 0.0, 1.0);

              // Darken liquid-crystal bruise halo around the fracture, then carve PITCH-BLACK dead-pixel fracture lines!
              col *= 1.0 - crackBruise * (0.34 + 0.24 * uMadness);
              // Subtle dead RGB subpixel leak along the fracture margin (kept dark so bloom NEVER blurs it!)
              float subpxLeak = clamp(crackBruise - crackCore, 0.0, 1.0);
              col = mix(col, vec3(0.18, 0.01, 0.09), subpxLeak * 0.45);
              col = mix(col, vec3(0.002, 0.004, 0.012), crackCore * 0.96);
              // Hair-thin dark-glass bevel glint strictly BELOW bloom threshold (max +0.14)!
              float bevelEdge = smoothstep(0.030, 0.020, spoke11) * (1.0 - mainCrack) * webMask;
              col += vec3(0.12, 0.20, 0.28) * bevelEdge;
            }

            // ---------------------------------------------------------------- 4. THE ':(' FACE MUTATION (PSYCHOTIC TYPOGRAPHY DELIRIUM!)
            // Stage-0 subliminal betrayal: while staring (>2.4s), ':(' briefly twitches into a mocking ':)'!
            float idleTick = floor(uTime * 11.0);
            float stage0Betrayal = step(2.4, uTime) * (1.0 - step(0.06, uMadness))
                                 * step(0.955 - 0.025 * uHover, hash11(idleTick * 17.31));

            // Stages 1-2 manic rictus contortion: violently flips between ':(' and an over-stretched ':)' grin!
            float manicTick = floor(uTime * (15.0 + uMadness * 28.0));
            float manicSmile = smoothstep(0.05, 0.13, uMadness) * (1.0 - smoothstep(0.36, 0.56, uMadness))
                             * step(0.36 - uClickPulse * 0.30, hash11(manicTick * 5.77));
            float smileFlip = clamp(max(stage0Betrayal, manicSmile), 0.0, 1.0);

            // Subtle uncanny pupil tracking on hover + madness, mapped cleanly in fLocal [-0.5..+0.5]
            vec2 cursorPullF = clamp((uCursorUv - faceCenter) * vec2(1.90566, 1.0), vec2(-0.45), vec2(0.45))
                             * (0.048 * uHover + 0.095 * uMadness + 0.035 * stage0Betrayal);
            vec2 eyeUv = vec2(0.5) + (fLocal - cursorPullF);
            // Asymmetric eye distortion: upper ':' dot stretches into a manic vertical slit while lower dot bloats!
            float upperHalf = step(colonLocal.y, fLocal.y);
            float eyeWarpY = mix(0.84, 1.34, upperHalf * smoothstep(0.06, 0.34, uMadness));
            eyeUv.y = colonLocal.y + 0.5 + (eyeUv.y - (colonLocal.y + 0.5)) / max(eyeWarpY, 0.25);
            eyeUv += vec2(sin(uTime * 91.0) * 0.016 * uMadness, cos(uTime * 79.0) * 0.016 * uMadness);

            float eyeMorph = smoothstep(0.14, 0.55, uMadness);
            vec2 eyeALocal = mix(colonLocal + vec2(0.0, eyeOff), vec2(0.24, parenLocal.y + halfLen + 0.075), eyeMorph);
            vec2 eyeBLocal = mix(colonLocal - vec2(0.0, eyeOff), vec2(-0.24, parenLocal.y + halfLen + 0.075), eyeMorph);
            float eyeRFinal = max(mix(eyeR, 0.095, eyeMorph), 1e-3);

            vec2 eyeAUv = faceCenter + (rot2(-rotSpasm) * eyeALocal) * faceScale * vec2(1.0 / 1.90566, 1.0);
            vec2 eyeBUv = faceCenter + (rot2(-rotSpasm) * eyeBLocal) * faceScale * vec2(1.0 / 1.90566, 1.0);

            // Keep raw glyph ink alive longer & flickering maniacally instead of vanishing cleanly at 0.22!
            float glyphStrobe = 0.55 + 0.45 * step(0.32, hash11(manicTick * 9.13));
            float glyphFade = mix(1.0, glyphStrobe, smoothstep(0.14, 0.28, uMadness))
                            * (1.0 - smoothstep(0.28, 0.52, uMadness));
            float eyes = 0.0;
            if (eyeUv.x > 0.01 && eyeUv.x < 0.99 && eyeUv.y > 0.01 && eyeUv.y < 0.99) {
              eyes = texture2D(uFaceTex, eyeUv).r * glyphFade;
            }
            float dA = length((fLocal - eyeALocal - cursorPullF * 0.9) * vec2(1.0, 0.86));
            float dB = length((fLocal - eyeBLocal - cursorPullF * 0.9) * vec2(1.18, 1.0));
            float discA = smoothstep(eyeRFinal * 1.12, eyeRFinal * 0.84, dA);
            float discB = smoothstep(eyeRFinal * 0.94, eyeRFinal * 0.72, dB);
            vec2 cA = fLocal - eyeALocal - cursorPullF * 0.9 + vec2(eyeRFinal * 0.34, eyeRFinal * 0.40);
            vec2 cB = fLocal - eyeBLocal - cursorPullF * 0.9 + vec2(eyeRFinal * 0.34, eyeRFinal * 0.40);
            float hlDenom = max(eyeRFinal * eyeRFinal * 0.30, 1e-5);
            float hlA = exp(-min(dot(cA, cA) / hlDenom, 20.0));
            float hlB = exp(-min(dot(cB, cB) / hlDenom, 20.0));
            // Fade flat 2D eye disc once the real 3D bulging Parasyte eyeballs emerge!
            float flatEyeFade = 1.0 - smoothstep(0.20, 0.34, uMadness);
            float disc = max(discA, discB) * eyeMorph * flatEyeFade;
            eyes = max(eyes, disc);
            col += vec3(0.58, 0.76, 0.98) * (hlA * discA + hlB * discB) * eyeMorph * flatEyeFade * 0.42;

            float horrorEyeAmt = clamp(smoothstep(0.04, 0.30, uMadness) + stage0Betrayal * 0.65, 0.0, 1.0);
            vec2 sockA = (fLocal - eyeALocal) * vec2(1.0, 1.30);
            vec2 sockB = (fLocal - eyeBLocal) * vec2(1.0, 1.30);
            float sockRad = max(eyeRFinal * 2.15, 1e-3);
            float socket = max(
              exp(-min(pow(length(sockA) / sockRad, 2.0), 20.0)),
              exp(-min(pow(length(sockB) / sockRad, 2.0), 20.0))
            );
            col = mix(col, vec3(0.04, 0.006, 0.028), clamp(socket * horrorEyeAmt * (0.45 + 0.45 * uMadness), 0.0, 0.92));

            float pupilHole = 0.0;
            float darkTears = 0.0;
            if (horrorEyeAmt > 0.01) {
              vec2 pShift = cursorPullF * 1.45;
              float minEyeDist = min(
                length((fLocal - eyeALocal - pShift) * vec2(1.35, 0.85)),
                length((fLocal - eyeBLocal - pShift) * vec2(1.0, 1.30))
              );
              pupilHole = smoothstep(eyeRFinal * 0.65, eyeRFinal * 0.22, minEyeDist) * horrorEyeAmt;

              float tearBandA = exp(-pow((uv.x - eyeAUv.x) * 38.0, 2.0));
              float tearBandB = exp(-pow((uv.x - eyeBUv.x) * 38.0, 2.0));
              float eyeTop = max(eyeAUv.y, eyeBUv.y);
              float belowEyes = smoothstep(eyeTop + 0.02, eyeTop - 0.54 * horrorEyeAmt, uv.y)
                              * step(uv.y, eyeTop + 0.04);
              darkTears = (tearBandA + tearBandB) * belowEyes * (0.42 + 0.58 * noiseA.b) * smoothstep(0.05, 0.30, uMadness);
            }

            float splitDist = pow(uMadness, 1.55) * 0.18 + uJawOpen * 0.42;
            float jawTremor = sin(uTime * 89.0) * 0.020 * uMadness;
            float jawFade = 1.0 - smoothstep(0.08, 0.38, openN);

            // Rictus mouth UV: flips '(' -> ')' on smileFlip AND stretches into a crooked ear-to-ear grin!
            float rictusStretchY = 1.0 + smoothstep(0.06, 0.34, uMadness) * (0.28 + 0.24 * smileFlip);
            float rictusCant = (fLocal.y - parenLocal.y) * 0.24 * smoothstep(0.08, 0.35, uMadness) * (smileFlip * 2.0 - 1.0);
            float mouthLocalX = mix(fLocal.x, parenLocal.x * 2.0 - fLocal.x, smileFlip) + rictusCant;
            float mouthLocalY = parenLocal.y + (fLocal.y - parenLocal.y) / rictusStretchY;

            vec2 jawUvA = vec2(0.5) + vec2(mouthLocalX, mouthLocalY) + vec2(splitDist + jawTremor, 0.0);
            float mouthA = 0.0;
            if (jawUvA.x > 0.01 && jawUvA.x < 0.99 && jawUvA.y > 0.01 && jawUvA.y < 0.99) {
              mouthA = texture2D(uFaceTex, jawUvA).g;
            }

            // Secondary opposing parenthesis forms an uncanny (: :) double-mandible brace before tearing open!
            float mirrorWeight = smoothstep(0.16, 0.44, uMadness) * jawFade;
            vec2 mirroredLocal = vec2(parenLocal.x * 2.0 - fLocal.x, mouthLocalY);
            vec2 jawUvB = vec2(0.5) + mirroredLocal + vec2(splitDist - jawTremor, 0.0);
            float mouthB = 0.0;
            if (mirrorWeight > 0.01 && jawUvB.x > 0.01 && jawUvB.x < 0.99 && jawUvB.y > 0.01 && jawUvB.y < 0.99) {
              mouthB = texture2D(uFaceTex, jawUvB).g * mirrorWeight;
            }

            // PSYCHOTIC MULTI-FACE DELIRIUM ECHOES: offset tilted ':)' & ':(' ghosts vibrating out of phase!
            float deliriumWhite = 0.0;
            float deliriumBlood = 0.0;
            if (uMadness > 0.07) {
              float delStrength = smoothstep(0.07, 0.28, uMadness) * (1.0 - smoothstep(0.58, 0.88, uMadness));
              float delBurst = 0.45 + 0.55 * step(0.38 - uClickPulse * 0.35, hash11(manicTick * 13.37));
              vec2 gOff1 = vec2(0.11 * sin(uTime * 37.0 + 0.5), 0.08 * cos(uTime * 29.0)) * (0.45 + uMadness);
              vec2 gOff2 = vec2(-0.14 * cos(uTime * 43.0), -0.09 * sin(uTime * 31.0 + 1.2)) * (0.45 + uMadness);
              vec2 gOff3 = vec2(0.22 * (hash11(manicTick * 2.3) - 0.5), 0.16 * (hash11(manicTick * 7.9) - 0.5)) * uMadness;

              vec2 gLoc1 = rot2(0.18 * sin(uTime * 23.0)) * (fLocal + gOff1) * 0.86;
              vec2 gUv1 = vec2(0.5) + vec2(parenLocal.x * 2.0 - gLoc1.x, gLoc1.y); // Always grinning ':)'!
              if (gUv1.x > 0.01 && gUv1.x < 0.99 && gUv1.y > 0.01 && gUv1.y < 0.99) {
                vec2 s1 = texture2D(uFaceTex, gUv1).rg;
                deliriumWhite = max(deliriumWhite, max(s1.r, s1.g) * 0.58 * delStrength * delBurst);
              }

              vec2 gLoc2 = rot2(-0.24 * cos(uTime * 19.0)) * (fLocal + gOff2) * 1.18;
              vec2 gUv2 = vec2(0.5) + vec2(parenLocal.x * 2.0 - gLoc2.x, gLoc2.y);
              if (gUv2.x > 0.01 && gUv2.x < 0.99 && gUv2.y > 0.01 && gUv2.y < 0.99) {
                vec2 s2 = texture2D(uFaceTex, gUv2).rg;
                deliriumBlood = max(deliriumBlood, max(s2.r, s2.g) * 0.65 * delStrength);
              }

              vec2 gUv3 = vec2(0.5) + (fLocal + gOff3) * 0.72;
              if (gUv3.x > 0.01 && gUv3.x < 0.99 && gUv3.y > 0.01 && gUv3.y < 0.99) {
                vec2 s3 = texture2D(uFaceTex, gUv3).rg;
                deliriumWhite = max(deliriumWhite, (s3.r + s3.g * 0.7) * 0.42 * delStrength * uClickPulse * 1.6);
              }
            }

            float faceInk = clamp(eyes + max(mouthA, mouthB) * jawFade + deliriumWhite, 0.0, 1.0);
            col = mix(col, vec3(0.06, 0.0, 0.015), clamp(darkTears * 0.90, 0.0, 0.88));
            // Dark arterial shadow-grin echo burned into the LCD subpixels!
            col = mix(col, vec3(0.18, 0.005, 0.035), clamp(deliriumBlood, 0.0, 0.78));
            col = mix(col, vec3(1.0), faceInk);

            float pinprick = smoothstep(eyeRFinal * 0.25, eyeRFinal * 0.08, min(
              length(fLocal - eyeALocal - cursorPullF * 1.45),
              length(fLocal - eyeBLocal - cursorPullF * 1.45)
            )) * horrorEyeAmt;
            col = mix(col, vec3(0.015, 0.0, 0.008), clamp(pupilHole * eyes * 1.28, 0.0, 1.0));
            col += vec3(1.0, 0.08, 0.16) * pinprick * eyes;
            col.r += faceInk * uMadness * 0.42 * step(0.42, sin(uTime * 59.0));

            // ---------------------------------------------------------------- 5. SINGLE-ROW PARASYTE FLESH GUMLINE & VASCULAR SUB-LCD HORROR
            if (openN > 0.004) {
              col *= mix(1.0, 0.56, mStress * 0.72);

              // Wet dark-crimson anatomical Parasyte gum collar around mDist ~ 0.98..1.24 where the single 3D tooth row roots!
              float gumBand = smoothstep(1.26, 1.01, mDist) * smoothstep(0.94, 1.01, mDist) * tearOpen;
              float gumSocket = 0.5 + 0.5 * cos(ang01 * 52.0 * 6.2831853);
              vec3 gumCol = mix(vec3(0.20, 0.008, 0.032), vec3(0.05, 0.004, 0.018), gumSocket * 0.72);
              col = mix(col, gumCol, clamp(gumBand * 0.95, 0.0, 0.96));
              col = mix(col, vec3(0.012, 0.002, 0.008), clamp(mInner * 0.92 * tearOpen, 0.0, 1.0));

              // Dark torn-LCD lip fissure + subtle wet saliva specular (not washed-out white!)
              float hairline = mEdge * mix(0.85, 0.38, tearOpen);
              col = mix(col, vec3(0.01, 0.02, 0.05), clamp(hairline * 0.75, 0.0, 0.85));
              col += vec3(0.32, 0.48, 0.62) * mWet * 0.24 * tearOpen;

              if (uMadness > 0.22) {
                // Pulsing sub-LCD organic arterial vascular network spreading from the splitting maw!
                vec2 vUvWarp = uv * vec2(6.5, 3.8) + vec2(noiseA.r, noiseA.g) * 0.45;
                float vein1 = pow(1.0 - abs(sin(vUvWarp.x * 6.2 + sin(vUvWarp.y * 5.4 + uTime * 2.2))), 14.0);
                float vein2 = pow(1.0 - abs(cos(vUvWarp.y * 8.5 - cos(vUvWarp.x * 7.1 - uTime * 1.8))), 16.0);
                float veinReach = smoothstep(1.65 - uMadness * 0.85, 0.35, length((uv - faceCenter) * vec2(1.6, 1.0)));
                float veinPulse = 0.65 + 0.35 * sin(uTime * 9.5 - length(md) * 8.0);
                vec3 veinCol = mix(vec3(0.36, 0.008, 0.05), vec3(0.01, 0.02, 0.06), step(0.55, noiseB.r));
                col = mix(col, veinCol, clamp((vein1 + vein2 * 0.75) * veinReach * smoothstep(0.20, 0.85, uMadness) * veinPulse * 0.72, 0.0, 0.85));
              }

              // Unhinged subliminal X-ray negative micro-spasms during high madness & clicks!
              float psychoTick = hash11(floor(uTime * 24.0) * 7.13);
              float invGate = step(0.94 - uClickPulse * 0.26, psychoTick) * smoothstep(0.52, 0.90, uMadness);
              if (invGate > 0.5) {
                float lum = dot(col, vec3(0.299, 0.587, 0.114));
                vec3 neg = mix(vec3(0.92, 0.95, 0.98), vec3(0.45, 0.015, 0.09), step(0.48, lum));
                col = mix(col, neg, 0.68);
              }
            }
          } else {
            float scar = smoothstep(0.004, 0.0, abs((uv.y - 0.52) + (uv.x - 0.48) * 0.62 + sin(uv.x * 26.0) * 0.012))
                       * smoothstep(0.32, 0.05, length(uv - vec2(0.48, 0.52)));
            // Subtle living phantom iris glint breathing faintly behind the aftermath ':)' watermark!
            vec2 ghostEyeA = uv - (vec2(0.148, 0.685) + (uCursorUv - 0.5) * 0.012);
            vec2 ghostEyeB = uv - (vec2(0.148, 0.618) + (uCursorUv - 0.5) * 0.012);
            float ghostGlint = (exp(-length(ghostEyeA * vec2(1.9, 1.0)) * 95.0) + exp(-length(ghostEyeB * vec2(1.9, 1.0)) * 95.0))
                             * (0.35 + 0.65 * pow(0.5 + 0.5 * sin(uTime * 1.4), 4.0));
            col += vec3(0.45, 0.80, 1.0) * scar * 0.42 + vec3(0.95, 0.18, 0.32) * ghostGlint * 0.48;
          }

          float glassSheen = pow(max(0.0, 1.0 - length((uv - vec2(0.74, 0.68)) * vec2(1.2, 1.0))), 3.0) * 0.035;
          col += vec3(0.45, 0.65, 0.95) * glassSheen * (1.0 - uMadness * 0.6);

          vec2 px = uv * vec2(1920.0, 1080.0);
          float subpx = 0.968 + 0.032 * sin(px.x * 3.14159);
          float scan = 0.982 + 0.018 * sin(px.y * 3.14159);
          col *= subpx * scan;

          vec2 vigUv = uv * (1.0 - uv.yx);
          float vig = pow(clamp(vigUv.x * vigUv.y * 18.0, 0.0, 1.0), 0.16);
          col *= mix(0.76, 0.99, vig);
          col *= 1.0 - clamp(vCaveDepth * 0.45, 0.0, 0.35);

          gl_FragColor = vec4(clamp(col, 0.0, 4.0), 1.0);
        }
      `,
    });

    this.screenMesh = new THREE.Mesh(screenGeo, this.screenMat);
    this.screenMesh.renderOrder = 5;
    this.root.add(this.screenMesh);

    // 6a. TRUE 3D PARASYTE-STYLE SINGLE-ROW CHEWING JAW RIG (Protruding +Z out of the LCD glass!)
    //     52 single-row sculpted 3D teeth + 32 stretched wet saliva strands + 9 bulging 3D saccadic eyeballs!
    this.parasyteGroup.visible = false;
    this.root.add(this.parasyteGroup);

    const rimToothGeo = buildParasyteToothGeometry();
    const rimSeed = new Float32Array(RIM_TOOTH_COUNT * 4);
    for (let i = 0; i < RIM_TOOTH_COUNT; i++) {
      // ONE single clean anatomical dental arch around the 4 split jaw-lobes (ZERO multi-layer concentric tiers!)
      const jitterAng = (((i * 0.75487766) % 1) - 0.5) * (0.22 / RIM_TOOTH_COUNT) * Math.PI * 2;
      rimSeed[i * 4 + 0] = (i / RIM_TOOTH_COUNT) * Math.PI * 2 + jitterAng;
      rimSeed[i * 4 + 1] = 0.0;
      rimSeed[i * 4 + 2] = (i * 0.61803398875) % 1; // <0.42 = chunky human incisor/molar, >=0.42 = Parasyte fang!
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
        varying float vTier;
        varying float vMorph;
        varying vec3 vNrm;
        varying vec3 vViewPos;

        vec4 evalParasyteChewT(float t, float madness, float jawOpen, float suction, float clickPulse) {
          float openT = clamp(jawOpen, 0.0, 1.0);
          float baseOpen = pow(openT, 0.68);
          float inhaleBreath = sin(t * 1.25) * 0.026 * openT;
          float clickTear = clickPulse * 0.065 * smoothstep(0.08, 0.32, madness);
          float swallowUnhinge = smoothstep(0.10, 0.45, suction) * 0.38;
          float effOpen = clamp(baseOpen + inhaleBreath + clickTear + swallowUnhinge, 0.0, 1.34);
          return vec4(effOpen, 0.0, 0.0, 0.0);
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
          float circRadX = max(mix(0.04, 0.43, pow(max(openNc, 0.0), 0.85)), 1e-4);
          float mawLobe = 1.0 + 0.16 * pow(0.5 + 0.5 * cos(ang * 4.0 - 0.35), 2.0) * clamp(openN, 0.0, 1.1)
                        + 0.02 * sin(ang * 3.0 - uTime * 1.4) * clamp(openN, 0.0, 1.1);

          // Single clean gumline root framing the wide-open waiting abyss!
          vec2 mdRoot = vec2(dir2.x * circRadX, dir2.y * halfLen) * mawLobe * 1.025;
          vec2 fRoot = vec2(mouthCx, parenLoc.y) + mdRoot;

          vec2 posXY = (mawCenter - 0.5) * vec2(1.90566, 1.0) + fRoot * faceScale;
          float lobeCurl = 0.72 + 0.58 * pow(0.5 + 0.5 * cos(ang * 4.0 - 0.35), 2.0);
          float lipZ = (openNc * 0.125) * lobeCurl + uClickPulse * step(0.24, uMadness) * 0.12;
          vec3 rootPos = vec3(posXY, lipZ + 0.012 * smoothstep(0.04, 0.25, openNc));

          float isIncisor = 1.0 - step(0.42, morph);
          float grow = smoothstep(0.03, 0.22, clamp(uJawOpen * 1.35 + uMadness * 0.25, 0.0, 1.0));
          // Broad Parasyte dental arch: heavy roots, long hooked blades, naturally uneven per tooth.
          float wScale = mix(0.88, 1.32, isIncisor) * faceScale * (0.58 + 0.42 * grow) * step(0.015, grow);
          float hScale = mix(0.88 + morph * 0.52, 0.66 + morph * 0.34, isIncisor) * faceScale * grow;

          // Held WIDE OPEN in a menacing predatory ring waiting to pull you down its throat (ZERO pakupaku closing!):
          float microTwitch = sin(uTime * 19.0 + phase * 6.283) * 0.010 * uMadness;
          float inwardAmt = 0.44 + microTwitch;
          float forwardZ = 0.80;
          float cant = (morph - 0.5) * 0.20;
          vec2 tang2 = vec2(-dir2.y, dir2.x);
          vec3 toothAxis = normalize(vec3(-dir2 * inwardAmt + tang2 * cant, forwardZ));
          vec3 sideAxis = normalize(vec3(tang2, -cant * 0.2));
          vec3 hookAxis = normalize(cross(sideAxis, toothAxis));

          vec3 localPos = rootPos
                        + sideAxis * (position.x * wScale)
                        + toothAxis * (position.y * hScale)
                        + hookAxis * (position.z * wScale);
          vec3 localNorm = normalize(
            sideAxis * normal.x + toothAxis * normal.y + hookAxis * normal.z
          );

          vec4 mv = modelViewMatrix * vec4(localPos, 1.0);
          vViewPos = -mv.xyz;
          vNrm = normalize(normalMatrix * localNorm);
          vCrown = uv.y;
          vTier = 0.0;
          vMorph = morph;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vCrown;
        varying float vTier;
        varying float vMorph;
        varying vec3 vNrm;
        varying vec3 vViewPos;

        void main() {
          vec3 N = normalize(vNrm);
          vec3 V = normalize(vViewPos);
          // Key room/screen bounce + cold cyan throat backlight + wet saliva speculars!
          vec3 Lkey = normalize(vec3(0.32, 0.58, 0.75));
          vec3 Lrim = normalize(vec3(-0.35, -0.25, -0.90));
          vec3 H = normalize(Lkey + V);
          vec3 H2 = normalize(normalize(vec3(-0.4, 0.35, 0.85)) + V);

          float diff = 0.24 + 0.76 * max(dot(N, Lkey), 0.0);
          float backGlow = max(dot(N, Lrim), 0.0);
          float wetSpec = pow(max(dot(N, H), 0.0), 64.0) * 1.45 + pow(max(dot(N, H2), 0.0), 32.0) * 0.55;
          float fresnel = pow(1.0 - abs(dot(N, V)), 2.6);

          // Arterial gum socket -> organic yellowish-bone dentin -> gleaming razor enamel
          vec3 gumFlesh = vec3(0.22, 0.014, 0.048);
          vec3 boneDentin = mix(vec3(0.84, 0.80, 0.71), vec3(0.76, 0.85, 0.94), vMorph * 0.45);
          vec3 tipEnamel = vec3(0.97, 0.97, 0.95);
          vec3 albedo = mix(gumFlesh, boneDentin, smoothstep(0.02, 0.28, vCrown));
          albedo = mix(albedo, tipEnamel, smoothstep(0.35, 0.88, vCrown));

          float tierDim = 1.0 - vTier * 0.20;
          vec3 col = albedo * diff * tierDim;
          // Wet crimson-saliva sheen near gumline + cold BSOD cyan edge transmission
          col += vec3(0.95, 0.98, 1.0) * wetSpec * (0.65 + 0.35 * vCrown);
          col += vec3(0.24, 0.78, 1.0) * (fresnel * 0.52 + backGlow * 0.28);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.rimTeethMesh = new THREE.InstancedMesh(rimToothGeo, this.rimToothMat, RIM_TOOTH_COUNT);
    this.rimTeethMesh.renderOrder = 6;
    this.rimTeethMesh.frustumCulled = false;
    this.parasyteGroup.add(this.rimTeethMesh);

    // 6a-2. 32 Stretched Wet 3D Sinew & Saliva Strands bridging across the splitting Parasyte jaws!
    const sinewGeo = new THREE.CylinderGeometry(0.0055, 0.0055, 1.0, 5, 8);
    const sinSeed = new Float32Array(SINEW_COUNT * 4);
    for (let i = 0; i < SINEW_COUNT; i++) {
      // Connect upper/diagonal jaw lobes across to opposite jaw lobes!
      const baseA = ((i / SINEW_COUNT) * Math.PI * 2) % (Math.PI * 2);
      const span = Math.PI * (0.58 + ((i * 0.618034) % 1) * 0.84);
      sinSeed[i * 4 + 0] = baseA;
      sinSeed[i * 4 + 1] = baseA + span;
      sinSeed[i * 4 + 2] = (i * 0.381966) % 1;
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
        uParenC: { value: this.parenC.clone() },
        uParenSize: { value: this.parenSize.clone() },
      },
      vertexShader: /* glsl */ `
        attribute vec4 aSinew4;
        uniform float uTime;
        uniform float uMadness;
        uniform float uJawOpen;
        uniform float uSuction;
        uniform float uClickPulse;
        uniform vec2 uParenC;
        uniform vec2 uParenSize;
        varying float vAlong;
        varying vec3 vNrm;
        varying vec3 vViewPos;
        varying float vAlpha;

        vec4 evalParasyteChewS(float t, float madness, float jawOpen, float suction, float clickPulse) {
          float openT = clamp(jawOpen, 0.0, 1.0);
          float baseOpen = pow(openT, 0.68);
          float inhaleBreath = sin(t * 1.25) * 0.026 * openT;
          float clickTear = clickPulse * 0.065 * smoothstep(0.08, 0.32, madness);
          float swallowUnhinge = smoothstep(0.10, 0.45, suction) * 0.38;
          float effOpen = clamp(baseOpen + inhaleBreath + clickTear + swallowUnhinge, 0.0, 1.34);
          return vec4(effOpen, 0.0, 0.0, 0.0);
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
          float circRadX = max(mix(0.04, 0.43, pow(clamp(openN, 0.0, 1.2), 0.85)), 1e-4);

          float lobeA = 1.0 + 0.16 * pow(0.5 + 0.5 * cos(angA * 4.0 - 0.35), 2.0) * clamp(openN, 0.0, 1.1);
          float lobeB = 1.0 + 0.16 * pow(0.5 + 0.5 * cos(angB * 4.0 - 0.35), 2.0) * clamp(openN, 0.0, 1.1);
          vec2 dirA = vec2(cos(angA), sin(angA));
          vec2 dirB = vec2(cos(angB), sin(angB));
          vec2 shearA = vec2(chew.z * sign(dirA.y + 1e-4), chew.w * sign(dirA.x + 1e-4));
          vec2 shearB = vec2(chew.z * sign(dirB.y + 1e-4), chew.w * sign(dirB.x + 1e-4));
          vec2 fA = vec2(0.0, parenLoc.y) + vec2(dirA.x * circRadX, dirA.y * halfLen) * lobeA * 0.96 + shearA;
          vec2 fB = vec2(0.0, parenLoc.y) + vec2(dirB.x * circRadX, dirB.y * halfLen) * lobeB * 0.96 + shearB;

          vec3 pA = vec3((mawCenter - 0.5) * vec2(1.90566, 1.0) + fA * faceScale, openN * 0.08 + 0.02);
          vec3 pB = vec3((mawCenter - 0.5) * vec2(1.90566, 1.0) + fB * faceScale, openN * 0.08 + 0.01);

          float sAlong = clamp(position.y + 0.5, 0.0, 1.0);
          vAlong = sAlong;
          // Strands snap & whip outward as player plunges into the throat (uSuction > 0.12)!
          float intact = 1.0 - smoothstep(0.08 + snapSeed * 0.18, 0.22 + snapSeed * 0.22, uSuction);
          float vis = smoothstep(0.12, 0.34, openN) * intact;
          vAlpha = vis;

          vec3 chord = pB - pA;
          float chordLen = max(length(chord), 1e-4);
          vec3 axisY = chord / chordLen;
          vec3 axisX = normalize(cross(axisY, vec3(0.0, 0.0, 1.0)));
          vec3 axisZ = normalize(cross(axisX, axisY));

          float midPinch = mix(0.24, 1.45, pow(abs(sAlong - 0.5) * 2.0, 2.0));
          float bead = 1.0 + 0.38 * pow(0.5 + 0.5 * sin(sAlong * 22.0 - uTime * 6.5 + sagSeed * 12.0), 3.0);
          float radScale = midPinch * bead * vis * (0.65 + 0.65 * sagSeed);

          float arch = sin(sAlong * 3.14159) * ((sagSeed - 0.5) * 0.14 * openN);
          float vib = sin(sAlong * 9.42 + uTime * 46.0 + snapSeed * 20.0) * 0.005 * uMadness * sin(sAlong * 3.14159);

          vec3 centerLine = mix(pA, pB, sAlong) + axisX * vib + vec3(0.0, -abs(arch) * 0.45, arch);
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
          vec3 N = normalize(vNrm);
          vec3 V = normalize(vViewPos);
          vec3 H = normalize(normalize(vec3(0.25, 0.55, 0.80)) + V);
          float spec = pow(max(dot(N, H), 0.0), 52.0);
          float fres = pow(1.0 - abs(dot(N, V)), 2.0);
          vec3 strandCol = mix(vec3(0.28, 0.02, 0.07), vec3(0.52, 0.84, 1.0), smoothstep(0.08, 0.5, abs(vAlong - 0.5) * 2.0));
          strandCol += vec3(0.95, 0.99, 1.0) * (spec * 1.4 + fres * 0.45);
          gl_FragColor = vec4(strandCol, clamp(vAlpha * (0.58 + spec * 0.42), 0.0, 0.95));
        }
      `,
    });
    this.sinewMesh = new THREE.InstancedMesh(sinewGeo, this.sinewMat, SINEW_COUNT);
    this.sinewMesh.renderOrder = 6;
    this.sinewMesh.frustumCulled = false;
    this.parasyteGroup.add(this.sinewMesh);

    // 6a-2b. 4 Sculpted 3D Parasyte Splitting Flesh-and-LCD Mandible Flaps (peeling outward in +Z & snapping on chew!)
    const flapGeo = buildParasyteMandibleGeometry();
    const flapSeed = new Float32Array(JAW_FLAP_COUNT * 4);
    for (let i = 0; i < JAW_FLAP_COUNT; i++) {
      // Aligned 1:1 with the 4 anatomical lobes of cos(ang * 4.0 - 0.35)!
      const lobeAng = 0.0875 + (i / JAW_FLAP_COUNT) * Math.PI * 2;
      flapSeed[i * 4 + 0] = lobeAng;
      flapSeed[i * 4 + 1] = i;
      flapSeed[i * 4 + 2] = 0.92 + ((i * 0.618) % 1) * 0.18;
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
        uParenC: { value: this.parenC.clone() },
        uParenSize: { value: this.parenSize.clone() },
      },
      vertexShader: /* glsl */ `
        attribute vec4 aFlap4;
        uniform float uTime;
        uniform float uMadness;
        uniform float uJawOpen;
        uniform float uSuction;
        uniform float uClickPulse;
        uniform vec2 uParenC;
        uniform vec2 uParenSize;
        varying vec2 vFlapUv;
        varying vec3 vNrm;
        varying vec3 vViewPos;
        varying float vFlapId;

        vec4 evalParasyteChewF(float t, float madness, float jawOpen, float suction, float clickPulse) {
          float openT = clamp(jawOpen, 0.0, 1.0);
          float baseOpen = pow(openT, 0.68);
          float inhaleBreath = sin(t * 1.25) * 0.026 * openT;
          float clickTear = clickPulse * 0.065 * smoothstep(0.08, 0.32, madness);
          float swallowUnhinge = smoothstep(0.10, 0.45, suction) * 0.38;
          float effOpen = clamp(baseOpen + inhaleBreath + clickTear + swallowUnhinge, 0.0, 1.34);
          return vec4(effOpen, 0.0, 0.0, 0.0);
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
          float bite = chew.y;

          float emerge = smoothstep(0.08, 0.26, openN);
          vec2 parenLoc = uParenC - vec2(0.5);
          float halfLen = max(mix(max(uParenSize.y * 0.5, 0.05), 0.43, pow(clamp(openN, 0.0, 1.2), 0.78)), 1e-4);
          float circRadX = max(mix(0.04, 0.43, pow(clamp(openN, 0.0, 1.2), 0.85)), 1e-4);

          // position.x spans angular quadrant width; position.y (0=lip rim .. 1=outer torn base)
          float spanAng = centerAng + position.x * 0.70;
          vec2 dir = vec2(cos(spanAng), sin(spanAng));
          float v = clamp(position.y, 0.0, 1.0);
          float tipAmt = 1.0 - v; // 1 at biting gumline rim, 0 at outer LCD skin root

          float mawLobe = 1.0 + 0.16 * pow(0.5 + 0.5 * cos(spanAng * 4.0 - 0.35), 2.0) * clamp(openN, 0.0, 1.1);
          // Outer root stays anchored at ~1.48x radius on the LCD; inner lip curls outward when gaping & snaps inward on bite!
          float rimRadMul = mix(1.03, 0.78, bite * 0.85);
          float rootRadMul = 1.48;
          float radMul = mix(rimRadMul, rootRadMul, pow(v, 0.82)) * mawLobe * asym;

          vec2 jawShear = vec2(chew.z * sign(dir.y + 1e-4), chew.w * sign(dir.x + 1e-4)) * (0.35 + 0.65 * tipAmt);
          vec2 fPos = vec2(0.0, parenLoc.y) + vec2(dir.x * circRadX, dir.y * halfLen) * radMul + jawShear;
          vec2 worldXY = (mawCenter - 0.5) * vec2(1.90566, 1.0) + fPos * faceScale * emerge
                       + (1.0 - emerge) * ((mawCenter - 0.5) * vec2(1.90566, 1.0));

          // Sculpted +Z protrusion: peels up to +0.28 local units out of the monitor!
          float flapProtrude = (0.19 * clamp(openN, 0.0, 1.25) + 0.11 * bite + uClickPulse * 0.12)
                             * pow(tipAmt, 1.15) * emerge * asym;
          float worldZ = 0.004 * emerge + flapProtrude + position.z * faceScale * emerge;

          // Approximate surface normal for wet muscular 3D lighting
          vec3 outwardN = normalize(vec3(dir * (0.45 + 0.55 * bite) * tipAmt, 0.65 + 0.35 * v));
          vec3 finalNorm = normalize(mix(outwardN, normal, 0.25));

          vec4 mv = modelViewMatrix * vec4(worldXY, worldZ, 1.0);
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
        uniform float uTime;
        uniform float uMadness;

        void main() {
          vec3 N = normalize(gl_FrontFacing ? vNrm : -vNrm);
          vec3 V = normalize(vViewPos);
          vec3 L = normalize(vec3(0.28, 0.56, 0.78));
          vec3 H = normalize(L + V);
          float diff = 0.30 + 0.70 * max(dot(N, L), 0.0);
          float spec = pow(max(dot(N, H), 0.0), 58.0);
          float rim = pow(1.0 - abs(dot(N, V)), 2.4);

          float tipAmt = 1.0 - vFlapUv.y;
          // Striated Parasyte muscle fibers radiating toward the biting lip
          float striations = 0.5 + 0.5 * sin((vFlapUv.x - 0.5) * 46.0 + sin(vFlapUv.y * 18.0 + vFlapId) * 1.4);
          vec3 wetMeat = mix(vec3(0.16, 0.006, 0.028), vec3(0.46, 0.022, 0.075), striations * 0.75 + tipAmt * 0.25);
          // Outer peeled skin retains torn #0078d7 Windows BSOD glass crust near v -> 1.0!
          vec3 tornLcdSkin = mix(vec3(0.0, 0.34, 0.68), vec3(0.01, 0.02, 0.06), step(0.76, sin(vFlapUv.x * 62.0) * cos(vFlapUv.y * 44.0)));
          float skinBlend = smoothstep(0.32, 0.86, vFlapUv.y) * (gl_FrontFacing ? 1.0 : 0.0);

          vec3 col = mix(wetMeat, tornLcdSkin, skinBlend);
          // Nerve-cyan bioluminescent capillary pulse along the inner meat!
          float nervePulse = pow(max(0.0, sin((vFlapUv.x - 0.5) * 18.0 + vFlapId * 2.1)), 12.0)
                           * (0.5 + 0.5 * sin(uTime * 8.5 - vFlapUv.y * 9.0)) * (1.0 - skinBlend);
          col += vec3(0.08, 0.52, 0.95) * nervePulse * 0.38 * uMadness;
          col = col * diff + vec3(0.92, 0.97, 1.0) * spec * (1.25 - skinBlend * 0.45) + vec3(0.20, 0.62, 1.0) * rim * 0.28;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.jawFlapsMesh = new THREE.InstancedMesh(flapGeo, this.jawFlapMat, JAW_FLAP_COUNT);
    this.jawFlapsMesh.renderOrder = 5;
    this.jawFlapsMesh.frustumCulled = false;
    this.parasyteGroup.add(this.jawFlapsMesh);

    // 6a-3. 11 Asymmetric Jaw-Mounted 3D Bloodshot Parasyte Eyeballs (riding the gaping 3D flesh-mandibles!)
    const eyeSphereGeo = new THREE.SphereGeometry(1.0, 18, 14);
    eyeSphereGeo.rotateX(Math.PI * 0.5); // +Z pole is now cornea/pupil center!
    // [fLocalOffX, fLocalOffY, baseRadius, madnessAppearThreshold] — stark Parasyte size & cluster asymmetry!
    const eyeLayout: Array<[number, number, number, number]> = [
      [0.23, 0.42, 0.068, 0.14],   // Primary mutated ':' eye R (narrow manic)
      [-0.25, 0.44, 0.104, 0.14],  // Primary mutated ':' eye L (monstrously swollen asymmetric primary eye!)
      [0.44, 0.25, 0.062, 0.24],   // NE mandible cluster — large eye
      [0.53, 0.13, 0.033, 0.30],   // NE mandible cluster — frantic tiny satellite eye!
      [-0.47, 0.17, 0.066, 0.28],  // NW mandible eye
      [0.39, -0.33, 0.056, 0.38],  // SE lower-jaw eye
      [-0.37, -0.39, 0.048, 0.42], // SW lower-jaw eye
      [-0.49, -0.27, 0.031, 0.48], // SW tiny cluster twin eye
      [0.05, 0.53, 0.042, 0.52],   // Dorsal crown eye
      [-0.56, -0.04, 0.038, 0.60], // Far-left cheek eye
      [0.55, -0.10, 0.045, 0.64],  // Far-right cheek eye
    ];
    const eyeAttr = new Float32Array(PARASYTE_EYE_COUNT * 4);
    const eyeSeedAttr = new Float32Array(PARASYTE_EYE_COUNT);
    for (let i = 0; i < PARASYTE_EYE_COUNT; i++) {
      const [ex, ey, er, eth] = eyeLayout[i];
      eyeAttr[i * 4 + 0] = ex;
      eyeAttr[i * 4 + 1] = ey;
      eyeAttr[i * 4 + 2] = er;
      eyeAttr[i * 4 + 3] = eth;
      eyeSeedAttr[i] = i * 1.73205;
    }
    eyeSphereGeo.setAttribute('aEye4', new THREE.InstancedBufferAttribute(eyeAttr, 4));
    eyeSphereGeo.setAttribute('aEyeId', new THREE.InstancedBufferAttribute(eyeSeedAttr, 1));

    this.parasyteEyeMat = new THREE.ShaderMaterial({
      depthTest: true,
      depthWrite: true,
      uniforms: {
        uTime: { value: 0 },
        uMadness: { value: 0 },
        uJawOpen: { value: 0 },
        uSuction: { value: 0 },
        uClickPulse: { value: 0 },
        uHover: { value: 0 },
        uCursorUv: { value: new THREE.Vector2(0.5, 0.5) },
      },
      vertexShader: /* glsl */ `
        attribute vec4 aEye4;
        attribute float aEyeId;
        uniform float uTime;
        uniform float uMadness;
        uniform float uJawOpen;
        uniform float uSuction;
        uniform float uClickPulse;
        uniform float uHover;
        uniform vec2 uCursorUv;
        varying vec3 vSpherePos;
        varying vec3 vNrm;
        varying vec3 vViewPos;
        varying float vEyeId;

        float hash1(float n) { return fract(sin(n) * 43758.5453); }

        vec4 evalParasyteChewE(float t, float madness, float jawOpen, float suction, float clickPulse) {
          float openT = clamp(jawOpen, 0.0, 1.0);
          float baseOpen = pow(openT, 0.68);
          float inhaleBreath = sin(t * 1.25) * 0.026 * openT;
          float clickTear = clickPulse * 0.065 * smoothstep(0.08, 0.32, madness);
          float swallowUnhinge = smoothstep(0.10, 0.45, suction) * 0.38;
          float effOpen = clamp(baseOpen + inhaleBreath + clickTear + swallowUnhinge, 0.0, 1.34);
          return vec4(effOpen, 0.0, 0.0, 0.0);
        }

        void main() {
          vSpherePos = position;
          vEyeId = aEyeId;
          vec2 mawCenter = mix(vec2(0.144, 0.742), vec2(0.48, 0.48), smoothstep(0.14, 0.88, uMadness));
          float faceScale = max(mix(0.35, 0.84, smoothstep(0.12, 0.90, uMadness)), 0.08);
          vec4 chew = evalParasyteChewE(uTime, uMadness, uJawOpen, uSuction, uClickPulse);
          float openN = chew.x;
          float bite = chew.y;

          float emerge = smoothstep(aEye4.w, aEye4.w + 0.14, uMadness);
          float rad = aEye4.z * faceScale * emerge * (1.0 + 0.08 * sin(uTime * 19.0 + aEyeId * 3.1) * uMadness);

          // Couple eyeballs directly to the moving 3D Parasyte jaw-mandibles (radial gape + grinding shear + +Z flap curl)!
          vec2 baseEye = aEye4.xy;
          vec2 jawShear = vec2(chew.z * sign(baseEye.y + 1e-4), chew.w * sign(baseEye.x + 1e-4)) * 0.85;
          float jawExpand = 1.0 + (clamp(openN, 0.0, 1.2) * 0.16 - bite * 0.11) * smoothstep(0.20, 0.55, uMadness);
          vec2 fEye = baseEye * jawExpand + jawShear;

          vec2 eyeScreenUv = mawCenter + fEye * faceScale * vec2(1.0 / 1.90566, 1.0);
          vec2 centerXY = (mawCenter - 0.5) * vec2(1.90566, 1.0) + fEye * faceScale;
          float flapLiftZ = (0.11 * clamp(openN, 0.0, 1.2) + 0.06 * bite) * emerge;
          float bulgeZ = flapLiftZ + rad * 0.52 + uClickPulse * 0.09 * emerge;

          // Saccadic 3D eyeball rotation: erratic asynchronous spasms that SNAP dead-on to uCursorUv!
          vec2 toCursor = clamp((uCursorUv - eyeScreenUv) * vec2(1.9, 1.0) * 1.65, vec2(-0.72), vec2(0.72));
          float sacTick = floor(uTime * (7.5 + mod(aEyeId, 5.0) * 2.8));
          vec2 saccade = vec2(hash1(sacTick + aEyeId * 11.3) - 0.5, hash1(sacTick * 1.7 + aEyeId * 5.9) - 0.5)
                       * 0.58 * (1.0 - clamp(uClickPulse * 1.5 + uHover * 0.65, 0.0, 1.0));
          vec2 aim = clamp(toCursor + saccade, vec2(-0.78), vec2(0.78));

          float yaw = aim.x;
          float pitch = -aim.y;
          float cy = cos(yaw), sy = sin(yaw);
          float cp = cos(pitch), sp = sin(pitch);

          // Pitch around X, then Yaw around Y
          vec3 p1 = vec3(position.x, position.y * cp - position.z * sp, position.y * sp + position.z * cp);
          vec3 pRot = vec3(p1.x * cy + p1.z * sy, p1.y, -p1.x * sy + p1.z * cy);
          vec3 n1 = vec3(normal.x, normal.y * cp - normal.z * sp, normal.y * sp + normal.z * cp);
          vec3 nRot = vec3(n1.x * cy + n1.z * sy, n1.y, -n1.x * sy + n1.z * cy);

          vec3 worldLocal = vec3(centerXY, bulgeZ) + pRot * rad;
          vec4 mv = modelViewMatrix * vec4(worldLocal, 1.0);
          vViewPos = -mv.xyz;
          vNrm = normalize(normalMatrix * nRot);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vSpherePos;
        varying vec3 vNrm;
        varying vec3 vViewPos;
        varying float vEyeId;
        uniform float uTime;
        uniform float uMadness;
        uniform float uClickPulse;

        void main() {
          vec3 N = normalize(vNrm);
          vec3 V = normalize(vViewPos);
          vec2 p = vSpherePos.xy;
          float r = length(p);
          float safeX = (abs(p.x) < 1e-5 && abs(p.y) < 1e-5) ? 1e-5 : p.x;
          float ang = atan(p.y, safeX);

          // Sickly organic sclera threaded with branching bloodshot crimson capillaries
          float vein1 = pow(max(0.0, 1.0 - abs(sin(ang * 9.0 + sin(r * 14.0 + vEyeId) * 1.9))), 14.0);
          float vein2 = pow(max(0.0, 1.0 - abs(cos(ang * 17.0 - cos(r * 19.0) * 1.5))), 18.0);
          float scleraRim = smoothstep(0.45, 0.98, r);
          vec3 sclera = mix(vec3(0.95, 0.91, 0.88), vec3(0.32, 0.02, 0.06), scleraRim * 0.72);
          sclera = mix(sclera, vec3(0.76, 0.03, 0.09), clamp((vein1 + vein2 * 0.7) * smoothstep(0.36, 0.85, r), 0.0, 0.88));

          // Feverish electric-cyan & arterial-amber iris fibers + dark limbal ring
          float irisR = 0.44;
          float inIris = smoothstep(irisR + 0.025, irisR - 0.025, r) * step(0.0, vSpherePos.z);
          float fibers = 0.5 + 0.5 * sin(ang * 34.0 + sin(r * 26.0) * 2.2);
          vec3 irisCol = mix(vec3(0.02, 0.44, 0.92), vec3(0.95, 0.22, 0.30), step(0.55, fract(vEyeId * 0.37)) * 0.65);
          irisCol = mix(irisCol * 0.35, irisCol * 1.45 + vec3(0.25, 0.45, 0.55), fibers);
          float limbus = smoothstep(irisR, irisR - 0.07, r);
          irisCol *= 0.25 + 0.75 * limbus;

          // Manic constricted pinprick pupil trembling at high frequency!
          float pupilR = mix(0.21, 0.085, clamp(uMadness * 0.85 + uClickPulse * 0.35, 0.0, 1.0))
                       + sin(uTime * 62.0 + vEyeId * 5.0) * 0.008 * uMadness;
          float inPupil = smoothstep(pupilR + 0.018, pupilR - 0.015, r) * step(0.0, vSpherePos.z);

          vec3 col = mix(sclera, irisCol, inIris);
          col = mix(col, vec3(0.01, 0.0, 0.008), inPupil);
          // Tiny manic red retinal reflex inside the constricted pupil
          col += vec3(1.0, 0.10, 0.18) * smoothstep(pupilR * 0.45, 0.0, r) * inPupil * uMadness * 0.85;

          // 3D Blinn-Phong lighting + razor-sharp wet corneal specular highlight!
          vec3 L = normalize(vec3(0.28, 0.52, 0.81));
          vec3 H = normalize(L + V);
          float diff = 0.35 + 0.65 * max(dot(N, L), 0.0);
          float corneaSpec = pow(max(dot(N, H), 0.0), 96.0) * 2.1 + pow(max(dot(N, H), 0.0), 18.0) * 0.25;
          col = col * diff + vec3(0.96, 0.99, 1.0) * corneaSpec;

          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.parasyteEyesMesh = new THREE.InstancedMesh(eyeSphereGeo, this.parasyteEyeMat, PARASYTE_EYE_COUNT);
    this.parasyteEyesMesh.renderOrder = 6;
    this.parasyteEyesMesh.frustumCulled = false;
    this.parasyteGroup.add(this.parasyteEyesMesh);

    // 6b. 100% GPU-Animated Razor-Thin 3D Shattered LCD Glass Shards floating out of the screen (0 CPU loops!)
    const glassGeo = new THREE.CylinderGeometry(0.088, 0.088, 0.005, 3, 1);
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
          float mBlend = smoothstep(0.12, 0.88, uMadness);
          float uvCx = mix(0.178, 0.48, mBlend);
          float uvCy = mix(0.705, 0.52, mBlend);
          float faceScale = mix(0.255, 0.92, smoothstep(0.10, 0.92, uMadness));
          float rotFrac = smoothstep(0.22, 0.78, uMadness);
          float mouthX = (uvCx - 0.5) * 1.90566 + (1.0 - rotFrac) * 0.08 * faceScale;
          float mouthY = (uvCy - 0.5) * 1.0 - rotFrac * 0.10 * faceScale;

          float ang = aGlassSeed.x * 6.2831853 + sin(uTime * 0.45 + idx) * 0.15;
          float ringR = (0.14 + uJawOpen * (0.32 + seed * 0.48)) * faceScale;
          float driftOut = uJawOpen * (0.08 + seed * 0.72) + uClickPulse * 0.12 - uSuction * 3.2;

          float sc = smoothstep(0.01, 0.22, uJawOpen) * (0.45 + seed * 1.25);
          vec3 lp = vec3(position.x * sc * (0.65 + mod(idx, 3.0) * 0.4), position.y * sc * (1.1 + mod(idx, 2.0) * 0.55), position.z);

          // 3D zero-G spin
          float a1 = uTime * (0.7 + seed * 1.4) + idx;
          float a2 = uTime * (0.9 - seed * 1.2) + idx * 2.1;
          float c1 = cos(a1), s1 = sin(a1), c2 = cos(a2), s2 = sin(a2);
          vec3 p1 = vec3(lp.x, lp.y * c1 - lp.z * s1, lp.y * s1 + lp.z * c1);
          vec3 p2 = vec3(p1.x * c2 + p1.z * s2, p1.y, -p1.x * s2 + p1.z * c2);
          vec3 n1 = vec3(normal.x, normal.y * c1 - normal.z * s1, normal.y * s1 + normal.z * c1);
          vec3 n2 = vec3(n1.x * c2 + n1.z * s2, n1.y, -n1.x * s2 + n1.z * c2);

          vec3 center = vec3(
            mouthX + cos(ang) * ringR * 1.15,
            mouthY + sin(ang) * ringR * 0.95 + sin(uTime * 1.6 + idx * 1.7) * 0.025,
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
          float spec = pow(max(dot(reflect(-V, N), normalize(vec3(0.3, 0.6, 0.8))), 0.0), 32.0);
          vec3 col = mix(vec3(0.02, 0.34, 0.80), vec3(0.90, 0.98, 1.0), fresnel * 0.85 + spec);
          gl_FragColor = vec4(col, clamp(0.38 + fresnel * 0.56 + spec * 0.42, 0.0, 0.95));
        }
      `,
    });
    this.glassShards = new THREE.InstancedMesh(glassGeo, this.glassShardMat, GLASS_SHARD_COUNT);
    this.glassShards.renderOrder = 6;
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
    // 768px texture over the same 1024px authoring space (0.75) for crisper glyph edges.
    ctx.setTransform(0.75, 0, 0, 0.75, 0, 0);
    const W = 1024;
    ctx.clearRect(0, 0, W, W);
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, W, W);

    ctx.globalCompositeOperation = 'lighter';
    ctx.textBaseline = 'middle';
    ctx.font = '300 660px "Segoe UI", "Yu Gothic UI", system-ui, sans-serif';

    const fullWidth = ctx.measureText(':(').width;
    const colonWidth = ctx.measureText(':').width;
    const startX = (W - fullWidth) * 0.5;
    const centerY = W * 0.52;

    // Red channel = ':' (Eyes)
    ctx.fillStyle = 'rgb(255, 0, 0)';
    ctx.fillText(':', startX, centerY);

    // Green channel = '(' (Mouth parenthesis)
    ctx.fillStyle = 'rgb(0, 255, 0)';
    ctx.fillText('(', startX + colonWidth, centerY);

    ctx.globalCompositeOperation = 'source-over';
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
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        if (px[i] > 70) {
          if (x < rx0) rx0 = x;
          if (x > rx1) rx1 = x;
          if (y < ry0) ry0 = y;
          if (y > ry1) ry1 = y;
        }
        if (px[i + 1] > 70) {
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
          if (px[i] <= 70) continue;
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
        // Positive half-separation in UV space (botC > topC in canvas Y)
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
    canvas.width = 1536;
    canvas.height = 806;
    const ctx = canvas.getContext('2d')!;
    // Same 2048x1074 authoring space, but baked at 1536px wide so the BSOD text stays crisp
    // when the monitor fills a large part of a 1080p/1440p frame.
    ctx.setTransform(0.75, 0, 0, 0.75, 0, 0);
    const W = 2048;
    const H = 1074;

    const finalizeTex = (): THREE.CanvasTexture => {
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = false;
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

    // Authentic Windows 10/11 Cerulean Blue (#0078D7), bruising colder & deeper at late stages
    ctx.fillStyle = stage >= 5 ? '#00336e' : stage >= 4 ? '#00498f' : '#0078d7';
    ctx.fillRect(0, 0, W, H);

    const leftX = 232;
    const fontStack = '"Segoe UI", "Yu Gothic UI", "Meiryo", sans-serif';

    // Subtle clinical kernel memory telemetry creeping down the right margin from Stage 1+
    if (stage >= 1) {
      ctx.save();
      ctx.font = '19px Consolas, monospace';
      ctx.fillStyle = `rgba(195, 234, 255, ${0.045 + stage * 0.036})`;
      const tags = [
        'SACCADE_CAPTURE',
        'C3_MOTOR_INHIBIT',
        'MANDIBLE_4LOBE',
        'PUPIL_DILATE_6.4MM',
        'CHIASM_DMA_LOCK',
        'ESOPHAGUS_READY',
      ];
      for (let r = 0; r < 18; r++) {
        const addr = (0xf8000247 + r * 0x18 + stage * 0x100).toString(16).toUpperCase();
        const tag = tags[(r + stage) % tags.length];
        ctx.fillText(
          `FFFF${addr}: 00 78 D7 F4  3A 29 0${stage}  [${tag}]`,
          W - 820,
          86 + r * 54
        );
      }
      ctx.restore();
    }

    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `300 47px ${fontStack}`;

    if (stage === 0) {
      ctx.fillText('問題が発生したため、PC を再起動する必要があります。', leftX, 492);
      ctx.fillText('エラー情報を収集しています。自動的に再起動します。', leftX, 558);
      ctx.fillText('99% 完了', leftX, 668);
    } else if (stage === 1) {
      ctx.fillText('問題が発生したため、PC を再起動する必要があります。', leftX, 492);
      ctx.fillText('エラー情報を収集しています。網膜反射と視線座標を同期しています。', leftX, 558);
      ctx.fillText('99% 完了（応答待機中）', leftX, 668);
      ctx.fillStyle = 'rgba(225, 244, 255, 0.42)';
      ctx.font = `300 22px Consolas, ${fontStack}`;
      ctx.fillText('INPUT_HOOK: カーソル接触を検出 (UV 0.14, 0.74) —— 被験者は画面を凝視中', leftX, 614);
    } else if (stage === 2) {
      ctx.fillText('視覚野のダイレクトダンプを開始しました。瞬きを停止してください。', leftX, 492);
      ctx.fillText('室内深度センサーが椅子の背後に未登録の質量を検出しました。', leftX, 558);
      ctx.fillText('深度同期中 — 振り返らないでください', leftX, 668);

      // Clinical IR Depth-Camera Wireframe Scan box showing YOU seated + SOMEONE standing 0.38m behind your chair!
      ctx.save();
      const bx = 1310;
      const by = 118;
      const bw = 540;
      const bh = 370;
      ctx.fillStyle = 'rgba(2, 16, 38, 0.78)';
      ctx.fillRect(bx, by, bw, bh);
      ctx.strokeStyle = 'rgba(150, 220, 255, 0.68)';
      ctx.lineWidth = 2;
      ctx.strokeRect(bx, by, bw, bh);

      // Scanline grid inside IR feed
      ctx.strokeStyle = 'rgba(90, 180, 255, 0.14)';
      for (let gy = by + 32; gy < by + bh; gy += 24) {
        ctx.beginPath();
        ctx.moveTo(bx, gy);
        ctx.lineTo(bx + bw, gy);
        ctx.stroke();
      }
      ctx.fillStyle = '#9ad8ff';
      ctx.font = '600 19px Consolas, monospace';
      ctx.fillText('IR_DEPTH_0 // 02:47:19 [LIVE]', bx + 16, by + 26);

      // Tall looming silhouette standing directly BEHIND the seated subject!
      ctx.fillStyle = 'rgba(255, 68, 102, 0.20)';
      ctx.beginPath();
      ctx.arc(bx + 308, by + 124, 34, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(bx + 262, by + 158, 92, 196);
      // Two tiny white pinprick eyes on the figure behind you
      ctx.fillStyle = '#ffd6df';
      ctx.fillRect(bx + 294, by + 120, 5, 5);
      ctx.fillRect(bx + 318, by + 120, 5, 5);

      // Wireframe contour of seated player in foreground
      ctx.strokeStyle = 'rgba(180, 238, 255, 0.86)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(bx + 232, by + 206, 28, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeRect(bx + 190, by + 238, 84, 114);

      // Distance callout vector from neck to looming figure
      ctx.strokeStyle = '#ff6b88';
      ctx.beginPath();
      ctx.moveTo(bx + 262, by + 204);
      ctx.lineTo(bx + 304, by + 152);
      ctx.stroke();
      ctx.fillStyle = '#ff859d';
      ctx.font = '600 18px Consolas, "Yu Gothic UI", monospace';
      ctx.fillText('HOST_SEATED : 0.58m (132 BPM)', bx + 18, by + 318);
      ctx.fillText('UNKNOWN_OBJ : 0.38m [椅子の真後ろ]', bx + 18, by + 346);
      ctx.restore();
    } else if (stage === 3) {
      ctx.fillText('脊髄運動路 (C3-C5) をアンマウントしました。離席要求は拒否されました。', leftX, 492);
      ctx.fillText('ガラス面の内側で下顎外殻が4裂開しています。凝視を継続してください。', leftX, 558);
      ctx.fillText('運動権委譲: 完了', leftX, 668);

      // Cascading corrupted Windows Kernel Exception Dialog Boxes!
      ctx.save();
      for (let d = 0; d < 3; d++) {
        const dx = 1170 + d * 42;
        const dy = 116 + d * 54;
        const dw = 610;
        const dh = 232;
        ctx.fillStyle = 'rgba(6, 18, 40, 0.90)';
        ctx.fillRect(dx + 8, dy + 8, dw, dh);
        ctx.fillStyle = '#e9f2fb';
        ctx.fillRect(dx, dy, dw, dh);
        ctx.fillStyle = d === 2 ? '#8c0d29' : '#004e98';
        ctx.fillRect(dx, dy, dw, 40);
        ctx.fillStyle = '#ffffff';
        ctx.font = `600 20px Consolas, ${fontStack}`;
        ctx.fillText('wininit.exe - 運動神経の強制切断 (0xC0000247)', dx + 16, dy + 27);

        ctx.fillStyle = '#0e1726';
        ctx.font = `400 21px ${fontStack}`;
        ctx.fillText('指および頸椎の制御権を SMILE_ENTITY.SYS へ移行します。', dx + 24, dy + 88);
        ctx.fillText('あなたが今クリックしているのは自分の意志ですか？', dx + 24, dy + 124);

        // Two identical inescapable buttons: [ 委譲する ]  [ 委譲する ]
        for (let b = 0; b < 2; b++) {
          const bx = dx + 260 + b * 162;
          const by = dy + 164;
          ctx.strokeStyle = '#004e98';
          ctx.lineWidth = 2;
          ctx.strokeRect(bx, by, 144, 42);
          ctx.fillStyle = '#0e1726';
          ctx.font = `600 20px ${fontStack}`;
          ctx.fillText('委譲する(Y)', bx + 18, by + 28);
        }
      }
      ctx.restore();
    } else {
      // Stage 4 & 5: Cold Clinical Host Sensory Unmount Autopsy + Ghostly Vertical ':)' Columns!
      ctx.save();
      ctx.font = '300 28px Consolas, monospace';
      for (let colIdx = 0; colIdx < 16; colIdx++) {
        ctx.fillStyle = colIdx % 4 === 0 ? 'rgba(255, 90, 122, 0.20)' : 'rgba(185, 228, 255, 0.10)';
        for (let r = 0; r < 14; r++) {
          ctx.fillText((colIdx + r) % 3 === 0 ? ':)' : ':(', 86 + colIdx * 122, 64 + r * 74);
        }
      }

      // Clinical black diagnostic overlay frame on right side (avoids clogging center mouth at (0.48, 0.48)!)
      const px = 1180;
      const py = 128;
      const pw = 690;
      const ph = 430;
      ctx.fillStyle = 'rgba(4, 10, 24, 0.86)';
      ctx.fillRect(px, py, pw, ph);
      ctx.strokeStyle = 'rgba(255, 92, 124, 0.72)';
      ctx.lineWidth = 2.5;
      ctx.strokeRect(px, py, pw, ph);

      ctx.fillStyle = '#ff6b88';
      ctx.font = `700 24px Consolas, ${fontStack}`;
      ctx.fillText(
        stage >= 5
          ? 'OPTIC_CHIASM_BREACH // 意識領域の嚥下を実行中'
          : 'HOST_SENSORY_TABLE // 生体デバイス切り離し状況',
        px + 24,
        py + 44
      );

      const rows = [
        ['BLINK_REFLEX (瞬き反射)', 'UNMOUNTED'],
        ['VOCAL_CORD_MOTOR (声帯)', 'UNMOUNTED'],
        ['CERVICAL_SPINE (頸椎回旋)', 'LOCKED_0DEG'],
        ['MANDIBLE_RIG (下顎4裂開)', stage >= 5 ? 'SWALLOWING' : 'GAPING_OPEN'],
        ['CONSCIOUSNESS_DEST', 'RING0://0x0078D7'],
      ];
      ctx.font = `400 22px Consolas, ${fontStack}`;
      rows.forEach(([k, v], idx) => {
        const ry = py + 106 + idx * 60;
        ctx.fillStyle = 'rgba(214, 236, 255, 0.88)';
        ctx.fillText(k, px + 24, ry);
        ctx.fillStyle = idx >= 3 ? '#ff6b88' : '#8ad4ff';
        ctx.fillText(`[ ${v} ]`, px + 418, ry);
      });
      ctx.restore();
    }

    // Authentic QR Code + Support / Stop Code section at bottom
    const qrY = 738;
    const qrSize = 178;
    this.drawQrCode(ctx, leftX, qrY, qrSize, stage);

    const infoX = leftX + qrSize + 38;
    ctx.fillStyle = '#ffffff';
    ctx.font = `300 25px ${fontStack}`;
    ctx.fillText(
      stage < 3
        ? 'この問題と可能な解決方法の詳細については、https://www.windows.com/stopcode を参照してください'
        : '視覚野ダンプの転送先アドレス: dump://0x0078d7/optic_chiasm — 切断は許可されていません',
      infoX,
      qrY + 38
    );

    ctx.font = `300 22px ${fontStack}`;
    ctx.fillText(
      stage < 2
        ? 'サポート担当者に連絡する場合は、次の情報を伝えてください:'
        : '生体テレメトリは次の停止コードへバインドされました:',
      infoX,
      qrY + 108
    );

    const stopCodes = [
      'CRITICAL_PROCESS_DIED',
      'OPTIC_NERVE_PAGE_FAULT',
      'UNREGISTERED_OBSERVER_BEHIND_HOST',
      'MOTOR_CORTEX_UNMOUNTED',
      'PARASYTE_MANDIBLE_BREACH',
      'CONSCIOUSNESS_SWALLOW_COMMIT',
    ];
    const code = stopCodes[Math.min(stage, stopCodes.length - 1)];
    ctx.fillText(`停止コード: ${code}`, infoX, qrY + 148);

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

  public update(dt: number, elapsed: number, state: BsodScreenState, clickPulse: number): void {
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
    const showParasyte = !state.aftermath && (state.madness > 0.12 || state.jawOpen > 0.01) && state.suctionProgress < 0.48;
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

      const snu = this.sinewMat.uniforms;
      snu.uTime.value = elapsed;
      snu.uMadness.value = state.madness;
      snu.uJawOpen.value = state.jawOpen;
      snu.uSuction.value = state.suctionProgress;
      snu.uClickPulse.value = clickPulse;

      const eyu = this.parasyteEyeMat.uniforms;
      eyu.uTime.value = elapsed;
      eyu.uMadness.value = state.madness;
      eyu.uJawOpen.value = state.jawOpen;
      eyu.uSuction.value = state.suctionProgress;
      eyu.uClickPulse.value = clickPulse;
      eyu.uHover.value = u.uHover.value;
      eyu.uCursorUv.value.copy(state.cursorUv);
    }

    const showThroat = !state.aftermath && state.jawOpen > 0.01;
    this.throatGroup.visible = showThroat;
    this.glassShards.visible = showThroat && state.suctionProgress < 0.72;
    if (!this.insideTunnelMode) {
      this.stencilMaskMesh.visible = showThroat;
    }

    if (showThroat) {
      this.throatTubeMat.uniforms.uTime.value = elapsed;
      this.throatTubeMat.uniforms.uMadness.value = state.madness;
      this.throatTubeMat.uniforms.uSuction.value = state.suctionProgress;

      this.throatRingMat.uniforms.uTime.value = elapsed;
      this.throatRingMat.uniforms.uMadness.value = state.madness;
      this.throatRingMat.uniforms.uSuction.value = state.suctionProgress;

      this.throatShardMat.uniforms.uTime.value = elapsed;
      this.throatShardMat.uniforms.uSuction.value = state.suctionProgress;

      this.throatLineMat.uniforms.uTime.value = elapsed;
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
