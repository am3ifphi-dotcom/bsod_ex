import * as THREE from 'three';
import { getSharedNoiseTexture } from '../utils/ProceduralNoise';

export interface BsodScreenState {
  hoverFace: boolean;
  cursorUv: THREE.Vector2;
  clickCount: number;
  madness: number; // 0..1 continuous escalation
  jawOpen: number; // 0..1 opening of the dimensional breach
  suctionProgress: number; // 0..1 camera diving through the throat
  aftermath: boolean;
}

const THROAT_RING_COUNT = 44;
const THROAT_SHARD_COUNT = 136;
const THROAT_LINE_COUNT = 190;
const GLASS_SHARD_COUNT = 56;
const HOLO_PANE_COUNT = 36;
const HOLO_RING_COUNT = 8;

export class BsodScreen {
  public readonly root = new THREE.Group();
  public readonly hitboxMesh: THREE.Mesh;
  public readonly monitorLight: THREE.PointLight;

  private readonly stageTextures: THREE.CanvasTexture[] = [];
  private readonly aftermathTex: THREE.CanvasTexture;
  private readonly cardTex: THREE.CanvasTexture;
  private readonly holoTex: THREE.CanvasTexture;

  private readonly faceCanvas: HTMLCanvasElement;
  private readonly faceTex: THREE.CanvasTexture;

  public readonly screenMesh: THREE.Mesh;
  public readonly screenMat: THREE.ShaderMaterial;

  // Legacy empty groups preserved as hidden invariants (zero anatomical meshes!)
  private readonly parasyteGroup = new THREE.Group();
  private readonly throatTeeth = new THREE.Group();

  // 3D Out-of-Screen Holographic Breach Rig (extrudes +Z into the bedroom!)
  private readonly holoBreachGroup = new THREE.Group();
  private readonly holoCascadeMesh: THREE.InstancedMesh;
  private readonly holoCascadeMat: THREE.ShaderMaterial;
  private readonly holoRingsMesh: THREE.InstancedMesh;
  private readonly holoRingsMat: THREE.ShaderMaterial;

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
  private readonly throatMaterials: THREE.Material[] = [];

  private lastRenderedStage = -1;
  private lastAftermath = false;
  private insideTunnelMode = false;

  // 0..1: shock-crack propagation since last click
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

    this.parasyteGroup.visible = false;
    this.throatTeeth.visible = false;
    this.root.add(this.parasyteGroup);

    // 1. Pre-bake all 6 BSOD stages + aftermath onto GPU-ready CanvasTextures ONCE at boot
    for (let s = 0; s <= 5; s++) {
      this.stageTextures.push(this.bakeStageTexture(s, false));
    }
    this.aftermathTex = this.bakeStageTexture(0, true);

    // 2. Separate SDF Face Channel Map (R = ':' eyes SDF, G = '(' mouth SDF, B = 0) at crisp 1024x1024
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

    // 3. Invisible low-poly raycast plane (2 triangles)
    const hitGeo = new THREE.PlaneGeometry(BsodScreen.LOCAL_W, BsodScreen.LOCAL_H, 1, 1);
    const hitMat = new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide });
    this.hitboxMesh = new THREE.Mesh(hitGeo, hitMat);
    this.hitboxMesh.position.z = 0.004;
    this.root.add(this.hitboxMesh);

    // 4. Stencil Aperture Mask (writes stencil=1 on monitor area during suction)
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

    // 5. Non-Euclidean 3D Display-Buffer Tunnel (100% GPU-driven, 0.0ms CPU!)
    this.root.add(this.throatGroup);
    this.throatGroup.visible = false;
    this.throatGroup.add(this.throatTeeth);

    const tubeGeo = new THREE.CylinderGeometry(1.42, 5.6, 116, 28, 22, true);
    tubeGeo.rotateX(Math.PI * 0.5);
    tubeGeo.translate(0, 0, -58.02);
    const endDisc = new THREE.CircleGeometry(5.6, 28);
    endDisc.rotateY(Math.PI);
    endDisc.translate(0, 0, -116.0);

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
          // Quantized digital sector shear + harmonic tunnel pulse
          float sector = floor(-p.z * 0.35 + uTime * 6.0);
          float glitchSnap = step(0.86, fract(sin(sector * 43.17) * 43758.5453)) * 0.12 * straighten;
          float pulse = 1.0 - 0.10 * sin(-p.z * 0.52 - uTime * 9.0) * smoothstep(-38.0, -1.0, p.z);
          p.xy *= pulse;
          float twist = p.z * 0.042 * (0.4 + uMadness) + uTime * 1.45;
          p.x += (sin(twist) * 0.28 + glitchSnap) * smoothstep(-1.0, -25.0, p.z) * straighten;
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
          float zScroll = vTubePos.z * 0.68 + uScrollPhase;

          float safeTx = (abs(vTubePos.x) < 1e-5 && abs(vTubePos.y) < 1e-5) ? 1e-5 : vTubePos.x;
          float angle = atan(vTubePos.y, safeTx);
          vec4 nSample = texture2D(uNoiseTex, vec2(angle * 0.3183, vTubePos.z * 0.03 + uTime * 0.22));

          // High-tech cybernetic kernel bus grid + binary data-lanes rushing past
          vec2 cell = vec2(angle * 7.639, zScroll);
          vec2 cid = floor(cell);
          vec2 f = fract(cell);
          float gridLine = smoothstep(0.08, 0.0, min(f.x, 1.0 - f.x)) + smoothstep(0.06, 0.0, min(f.y, 1.0 - f.y));
          float packetOn = step(0.68, fract(sin(dot(cid, vec2(12.9898, 78.233))) * 43758.5453));
          float packetCore = step(0.18, f.x) * step(f.x, 0.82) * step(0.15, f.y) * step(f.y, 0.85) * packetOn;

          float helixA = pow(max(0.0, sin(angle * 6.0 + vTubePos.z * 0.22 + uScrollPhase * 0.358)), 8.0);
          float helixB = pow(max(0.0, cos(angle * 10.0 - vTubePos.z * 0.16 + uScrollPhase * 0.265)), 10.0);
          float shockRing = smoothstep(0.90, 1.0, fract(vTubePos.z * 0.09 + uScrollPhase * 0.146));

          vec3 nearVoid = vec3(0.002, 0.018, 0.085);
          vec3 sleeveDeep = vec3(0.004, 0.065, 0.28);
          vec3 sleeveMid = vec3(0.008, 0.14, 0.48);

          float nearZone = smoothstep(0.55, 0.04, depthFactor);
          float sleeveZone = smoothstep(0.32, 0.70, depthFactor);

          vec3 col = mix(nearVoid, mix(sleeveDeep, sleeveMid, smoothstep(0.55, 0.94, depthFactor)), sleeveZone);
          // Cyber crimson/cyan bus flashes in the near breach zone, morphing cleanly to cerulean ahead
          vec3 packetTint = mix(vec3(0.0, 0.78, 1.0), vec3(1.0, 0.16, 0.38), step(0.82, nSample.g) * nearZone);
          col += packetTint * packetCore * 0.34 * nearZone;
          col += vec3(0.24, 0.78, 1.0) * gridLine * mix(0.24, 0.48, sleeveZone);
          col += vec3(0.32, 0.86, 1.0) * (helixA * 0.62 + helixB * 0.48) * mix(0.22, 0.88, sleeveZone);
          col += vec3(0.74, 0.95, 1.0) * shockRing * mix(0.24, 0.74, sleeveZone);

          // Seamless far-end portal vista matching GlitchWorld exit conduit 1:1
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

    // 5b. Receding Rectangular BSOD Frame Ribs inside the tunnel
    const frameGeo = new THREE.RingGeometry(0.92, 1.0, 4, 1);
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
        varying float vAccent;
        void main() {
          float zSpan = 112.0;
          float z = -mod(aFrac * zSpan - uScrollPhase * 0.92, zSpan) - 0.45;
          float depthT = -z / zSpan;
          vDepthT = depthT;
          vAccent = step(0.82, fract(aFrac * 13.7));
          float straighten = 1.0 - smoothstep(0.55, 0.96, uSuction);
          float s = 0.74 + depthT * 3.15;
          float rot = sin(uTime * 1.8 + aFrac * 17.0) * 0.24 * uMadness * straighten;
          float cr = cos(rot), sr = sin(rot);
          vec2 rp = vec2(position.x * s * 1.45, position.y * s * 0.85);
          vec2 rotP = vec2(rp.x * cr - rp.y * sr, rp.x * sr + rp.y * cr);
          float wx = sin(z * 0.042 + uTime * 1.35) * 0.26 * depthT * straighten;
          float wy = cos(z * 0.038 + uTime * 1.2) * 0.20 * depthT * straighten;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(rotP.x + wx, rotP.y + wy, z, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vDepthT;
        varying float vAccent;
        uniform float uSuction;
        void main() {
          float alpha = mix(0.18, 0.62, smoothstep(0.04, 0.4, uSuction)) * (1.0 - smoothstep(0.42, 0.68, vDepthT));
          if (alpha < 0.008) discard;
          vec3 col = mix(vec3(0.45, 0.88, 1.0), vec3(1.0, 0.22, 0.44), vAccent * (1.0 - smoothstep(0.2, 0.55, vDepthT)));
          gl_FragColor = vec4(col, alpha);
        }
      `,
    });
    this.throatRings = new THREE.InstancedMesh(frameGeo, this.throatRingMat, THROAT_RING_COUNT);
    this.throatRings.renderOrder = 4;
    this.throatRings.frustumCulled = false;
    this.throatGroup.add(this.throatRings);
    this.throatMaterials.push(this.throatRingMat);

    // 5c. Spiraling Crash Memory Cards inside the throat
    const cardCanvas = document.createElement('canvas');
    cardCanvas.width = 256;
    cardCanvas.height = 128;
    const cctx = cardCanvas.getContext('2d')!;
    cctx.fillStyle = 'rgba(0, 42, 112, 0.94)';
    cctx.fillRect(0, 0, 256, 128);
    cctx.fillStyle = '#8be4ff';
    cctx.fillRect(0, 0, 256, 20);
    cctx.fillStyle = '#001e4d';
    cctx.font = 'bold 12px Consolas, monospace';
    cctx.fillText('RING0 // 0xFFFFF803_0247', 8, 14);
    cctx.strokeStyle = 'rgba(110, 224, 255, 0.92)';
    cctx.lineWidth = 2;
    cctx.strokeRect(2, 2, 252, 124);
    cctx.fillStyle = '#ffffff';
    cctx.font = '300 30px "Segoe UI", sans-serif';
    cctx.fillText(':)', 14, 64);
    cctx.font = '13px Consolas, monospace';
    cctx.fillStyle = '#9fe6ff';
    cctx.fillText('MEM_BREACH // OVERFLOW', 58, 56);
    cctx.fillStyle = '#ff3864';
    cctx.fillRect(14, 88, 212, 6);
    const cardTex = new THREE.CanvasTexture(cardCanvas);
    cardTex.colorSpace = THREE.SRGBColorSpace;
    cardTex.minFilter = THREE.LinearFilter;
    cardTex.magFilter = THREE.LinearFilter;
    cardTex.generateMipmaps = false;
    this.cardTex = cardTex;

    const shardGeo = new THREE.PlaneGeometry(0.28, 0.14);
    const sSeed = new Float32Array(THROAT_SHARD_COUNT * 4);
    for (let i = 0; i < THROAT_SHARD_COUNT; i++) {
      sSeed[i * 4 + 0] = Math.random() * Math.PI * 2;
      sSeed[i * 4 + 1] = 0.38 + Math.random() * 1.65;
      sSeed[i * 4 + 2] = Math.random();
      sSeed[i * 4 + 3] = 0.65 + Math.random() * 1.25;
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
          gl_FragColor = vec4(c.rgb, c.a * 0.88 * vFade);
        }
      `,
    });
    this.throatShards = new THREE.InstancedMesh(shardGeo, this.throatShardMat, THROAT_SHARD_COUNT);
    this.throatShards.renderOrder = 4;
    this.throatShards.frustumCulled = false;
    this.throatGroup.add(this.throatShards);
    this.throatMaterials.push(this.throatShardMat);

    // 5d. Hyperspace Data-Stream Speed Lines inside tunnel
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
          float maxZ = mix(-0.45, 2.0, uInside);
          float z = -zSpan + mod(aSeed4.z * zSpan + uScrollPhase * (1.65 + aSeed4.w * 0.95), zSpan + maxZ);
          float depthT = clamp(-z / zSpan, 0.0, 1.0);
          float swirl = aSeed4.x + z * 0.024 + uTime * 0.48;
          float r = aSeed4.y * (0.44 + depthT * 1.72);
          float len = (2.6 + aSeed4.w * 4.5) * (0.65 + uSuction * 2.2);
          float thick = 0.7 + uSuction * 0.85;
          vec3 lp = vec3(position.x * thick, position.y * thick, position.z * len);
          float tipZ = z + lp.z;
          if (uInside < 0.5) tipZ = min(tipZ, -0.08);
          vBright = (0.45 + 0.55 * fract(aSeed4.w * 7.3)) * (1.0 - smoothstep(0.88, 1.0, depthT));
          gl_Position = projectionMatrix * modelViewMatrix * vec4(cos(swirl) * r + lp.x, sin(swirl) * r * 0.78 + lp.y, tipZ, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vBright;
        void main() {
          vec3 col = mix(vec3(0.18, 0.72, 1.0), vec3(0.95, 0.99, 1.0), vBright);
          gl_FragColor = vec4(col, 0.88 * vBright);
        }
      `,
    });
    this.throatLines = new THREE.InstancedMesh(lineGeo, this.throatLineMat, THROAT_LINE_COUNT);
    this.throatLines.renderOrder = 5;
    this.throatLines.frustumCulled = false;
    this.throatGroup.add(this.throatLines);
    this.throatMaterials.push(this.throatLineMat);

    // 6. High-Tessellation 112x64 BSOD LCD Surface Shader:
    //    - Authentic Windows BSOD at Stage 0
    //    - True 3D View-Dependent Interior Parallax Hall-of-Mirrors Corridor behind torn scan-sectors
    //    - Live GPU Hex/Binary Memory Bleed, RGB Chromatic Sub-planes, and Cyber-Optic Singularity Lock-On!
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
        varying vec3 vLocalPos;
        varying vec3 vWorldPos;
        varying vec3 vWorldNormal;
        varying vec3 vWorldRight;
        varying vec3 vWorldUp;
        uniform float uTime;
        uniform float uMadness;
        uniform float uJawOpen;
        uniform float uSuction;
        uniform float uClickPulse;
        uniform vec2 uImpactUv;

        float hash21V(vec2 p) {
          vec3 p3 = fract(vec3(p.xyx) * 0.1031);
          p3 += dot(p3, p3.yzx + 33.33);
          return fract((p3.x + p3.y) * p3.z);
        }

        void main() {
          vUv = uv;
          vec3 p = position;

          vec2 coreCenter = mix(vec2(0.144, 0.742), vec2(0.50, 0.50), smoothstep(0.16, 0.82, uMadness));
          vec2 coreDelta = (uv - coreCenter) * vec2(1.90566, 1.0);
          float coreDist = length(coreDelta);

          // Tactile click shockwave + spatial inward warp funnel at high madness
          vec2 impDelta = (uv - uImpactUv) * vec2(1.90566, 1.0);
          float impDist = length(impDelta);
          float ringR = (1.0 - uClickPulse) * 0.78;
          float clickRipple = sin((impDist - ringR) * 26.0) * exp(-pow((impDist - ringR) * 8.5, 2.0)) * uClickPulse * 0.018;

          // Quantized digital scan-slab z-delamination (sectors physically step forward/back!)
          float slabId = floor(uv.y * 22.0);
          float tick = floor(uTime * (9.0 + uMadness * 14.0));
          float slabGlitch = step(0.92 - uMadness * 0.24, hash21V(vec2(slabId, tick))) * (hash21V(vec2(slabId + 7.1, tick)) - 0.35);
          float zStep = slabGlitch * 0.028 * smoothstep(0.18, 0.85, uMadness);

          // Funnel pull into the singularity just before and during suction
          float funnel = -exp(-coreDist * coreDist * 6.5) * (smoothstep(0.55, 1.0, uMadness) * 0.065 + uSuction * 0.22);
          float rimPeel = exp(-pow((coreDist - 0.38) * 6.0, 2.0)) * (uJawOpen * 0.032 + uSuction * 0.045);

          // Something behind the panel slides across it: a slow pressure bulge under the glass.
          vec2 bulgeC = vec2(0.5 + 0.30 * sin(uTime * 0.31), 0.5 + 0.22 * cos(uTime * 0.23));
          float bulge = exp(-pow(length((uv - bulgeC) * vec2(1.90566, 1.0)) * 3.1, 2.0));
          p.z += bulge * (0.006 + uMadness * 0.018);

          p.z += clickRipple + zStep + funnel + rimPeel;

          vLocalPos = p;
          vec4 wp = modelMatrix * vec4(p, 1.0);
          vWorldPos = wp.xyz;
          mat3 m3 = mat3(modelMatrix);
          vWorldRight = normalize(m3 * vec3(1.0, 0.0, 0.0));
          vWorldUp = normalize(m3 * vec3(0.0, 1.0, 0.0));
          vWorldNormal = normalize(m3 * vec3(0.0, 0.0, 1.0));
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vLocalPos;
        varying vec3 vWorldPos;
        varying vec3 vWorldNormal;
        varying vec3 vWorldRight;
        varying vec3 vWorldUp;

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

        float sampleSdfGlyph(float rawVal) {
          float sd = rawVal - 0.5;
          float aa = clamp(fwidth(sd) * 0.95, 0.008, 0.085);
          return smoothstep(-aa, aa, sd);
        }

        // True 3D Ray-Plane Interior Corridor behind the fractured LCD glass!
        vec3 evalInteriorAbyss(vec2 uv, vec3 viewTan, float madness, float t, vec2 cursorMetric) {
          vec2 p0 = (uv - 0.5) * vec2(1.90566, 1.0);
          vec2 ray = -viewTan.xy / max(abs(viewTan.z), 0.22);
          vec3 acc = vec3(0.002, 0.014, 0.058);

          // 5 receding holographic BSOD corridor planes at physical depths behind the glass
          for (int i = 1; i <= 5; i++) {
            float fi = float(i);
            float depth = fi * 0.26 + fract(-t * (0.45 + madness * 0.55) + fi * 0.2) * 0.26;
            vec2 planeP = p0 + ray * depth * 0.55;
            float scale = 1.0 + depth * 1.65;
            vec2 q = planeP * scale;

            // Rectangular nested monitor bezel frame
            vec2 box = abs(q) / vec2(0.88, 0.48);
            float maxB = max(box.x, box.y);
            float rim = smoothstep(0.06, 0.0, abs(maxB - 1.0));
            // Cyber circuit traces along corridor walls
            float grid = smoothstep(0.04, 0.0, abs(fract(q.x * 6.0) - 0.5)) * step(1.0, maxB) * step(maxB, 1.35);
            float fade = exp(-depth * 1.15);
            vec3 tint = mix(vec3(0.06, 0.62, 1.0), vec3(1.0, 0.16, 0.40), step(0.75, fract(fi * 0.37 + madness * 0.5)));
            acc += tint * (rim * 0.72 + grid * 0.28) * fade;
          }

          // Deep staring cyber-iris core in the far parallax background tracking your cursor/camera!
          vec2 deepP = p0 + ray * 0.82 - cursorMetric * 0.22;
          float rEye = length(deepP * vec2(0.92, 1.28));
          float outerIris = exp(-abs(rEye - 0.24) * 28.0);
          float innerPupil = exp(-rEye * 7.5);
          float scanSpoke = 0.5 + 0.5 * sin(atan(deepP.y, deepP.x + 1e-5) * 12.0 - t * 4.0);
          acc += mix(vec3(0.18, 0.80, 1.0), vec3(1.0, 0.18, 0.38), smoothstep(0.45, 0.9, madness))
               * (outerIris * (0.65 + 0.35 * scanSpoke) + innerPupil * 0.55) * smoothstep(0.20, 0.75, madness);

          // A figure stands in the corridor. Between frames it is closer. Its head is always
          // angled toward the viewer, and its eyes are two needle-thin pinpricks of light.
          float stalkAwake = smoothstep(0.30, 0.68, madness);
          if (stalkAwake > 0.01) {
            float snapTick = floor(t * (0.7 + madness * 2.4));
            float snap = hash21(vec2(snapTick, 4.71));
            float stalkDepth = 0.62 - 0.26 * smoothstep(0.45, 0.95, madness);
            if (snap > 0.70) stalkDepth *= 0.52;
            if (snap > 0.93) stalkDepth *= 0.38;
            vec2 sp = p0 + ray * stalkDepth * 0.55;
            sp.x += sin(t * 0.53) * 0.018 + (hash21(vec2(snapTick, 9.2)) - 0.5) * 0.06 * madness;
            float head = 1.0 - smoothstep(0.026, 0.038, length((sp - vec2(0.0, 0.082)) * vec2(1.0, 1.14)));
            float torso = 1.0 - smoothstep(0.048, 0.082, length((sp - vec2(0.0, -0.03)) * vec2(1.0, 1.55)));
            float bodyMask = clamp(head + torso, 0.0, 1.0) * stalkAwake;
            acc = mix(acc, vec3(0.0015, 0.0035, 0.011), bodyMask * 0.97);
            float eyeA = exp(-length(sp - vec2(-0.012, 0.088)) * 320.0);
            float eyeB = exp(-length(sp - vec2(0.012, 0.088)) * 320.0);
            acc += mix(vec3(0.86, 0.94, 1.0), vec3(1.0, 0.10, 0.24), smoothstep(0.45, 0.95, madness))
                 * (eyeA + eyeB) * bodyMask * (0.55 + 0.45 * step(0.4, sin(t * 1.7)));
          }

          return acc;
        }

        void main() {
          vec2 uv = vUv;

          // Tangent-space camera view vector for true 3D interior parallax
          vec3 Vw = normalize(cameraPosition - vWorldPos);
          vec3 viewTan = vec3(dot(Vw, vWorldRight), dot(Vw, vWorldUp), dot(Vw, vWorldNormal));

          // Core center migrates smoothly from top-left ':(' slot (0.144, 0.742) at Stage 0 -> center singularity (0.50, 0.50)
          float migrate = smoothstep(0.16, 0.78, uMadness);
          vec2 faceCenter = mix(vec2(0.144, 0.742), vec2(0.50, 0.50), migrate);
          float faceScale = mix(0.35, 0.78, smoothstep(0.14, 0.88, uMadness));

          // Portal hole discard ONLY during active suction (strictly preserves Stage 0..5 screen inspection!)
          float portalOpen = smoothstep(0.03, 0.16, uSuction);
          if (uAftermath < 0.5 && portalOpen > 0.01) {
            vec2 sDelta = (uv - faceCenter) * vec2(1.90566, 1.0);
            float angS = atan(sDelta.y, (abs(sDelta.x) < 1e-5 && abs(sDelta.y) < 1e-5) ? 1e-5 : sDelta.x);
            float jagPortal = 1.0 + 0.08 * sin(angS * 8.0 + uTime * 9.0) + 0.05 * cos(angS * 13.0 - uTime * 14.0);
            float pDist = length(sDelta) / (0.46 * portalOpen * jagPortal + 1e-4);
            if (pDist < 1.0) discard;
          }

          // ---------------------------------------------------------------- 1. CLICK SHOCKWAVE & BROADCAST SYNC TEARS
          vec4 noiseA = texture2D(uNoiseTex, uv * vec2(3.2, 1.8) + vec2(0.0, uTime * 0.05));
          vec4 noiseB = texture2D(uNoiseTex, uv * vec2(8.0, 4.5) - vec2(uTime * 0.04, 0.0));

          vec2 impDelta = (uv - uImpactUv) * vec2(1.90566, 1.0);
          float impDist = length(impDelta);
          float ringRadius = (1.0 - uClickPulse) * 0.78;
          float impWave = exp(-pow((impDist - ringRadius) * 11.5, 2.0)) * uClickPulse;
          vec2 impDir = impDist > 1e-4 ? impDelta / impDist : vec2(0.0, 1.0);

          // Deliberate quantized horizontal scan-slice displacement + datamosh macroblocks
          float tick = floor(uTime * (12.0 + uMadness * 20.0));
          float band = floor(uv.y * (24.0 + uMadness * 36.0));
          float bandPick = hash21(vec2(band, tick));
          float tearGate = step(0.92 - uMadness * 0.28 - uClickPulse * 0.25, bandPick) * step(0.02, uMadness + uClickPulse);
          float bandShift = tearGate * (hash21(vec2(band * 2.3, tick + 5.0)) - 0.5) * (0.045 + uMadness * 0.14 + uClickPulse * 0.09);

          // Macroblock displacement on higher stages
          vec2 mCell = floor(uv * vec2(32.0, 18.0));
          float mPick = hash21(mCell + floor(uTime * 10.0) * 1.37);
          vec2 mShift = step(0.95 - uMadness * 0.16, mPick) * smoothstep(0.25, 0.85, uMadness)
                      * (vec2(hash21(mCell + 3.1), hash21(mCell + 8.7)) - 0.5) * 0.06;

          vec2 bodyUv = clamp(uv + vec2(bandShift, 0.0) + mShift + impDir * impWave * 0.018, 0.001, 0.999);

          float chr = uMadness * 0.0055 + uClickPulse * 0.012 + impWave * 0.014 + tearGate * 0.008;
          vec3 panel;
          panel.r = texture2D(uBodyTex, clamp(bodyUv + vec2(chr, 0.0), 0.001, 0.999)).r;
          panel.g = texture2D(uBodyTex, bodyUv).g;
          panel.b = texture2D(uBodyTex, clamp(bodyUv - vec2(chr, 0.0), 0.001, 0.999)).b;

          vec3 col = mix(vec3(0.0, 0.4706, 0.8392), panel, clamp(length(panel) * 1.6, 0.0, 1.0));

          if (uAftermath < 0.5) {
            // ---------------------------------------------------------------- 2. LIVE GPU HEX-STREAM BLEED & FERROFLUID BRUISING
            if (uMadness > 0.04 || uClickPulse > 0.02) {
              // Liquid-crystal rainbow birefringence ring on click impact
              vec3 newton = 0.5 + 0.5 * cos(6.28318 * (impDist * 8.0 - uTime * 2.5 + vec3(0.0, 0.33, 0.67)));
              col = mix(col, col * (0.45 + 0.95 * newton), impWave * 0.68);

              // Live 60fps scrolling binary/hex memory columns bleeding through the BSOD blue!
              vec2 hexGrid = uv * vec2(64.0, 38.0) + vec2(0.0, uTime * (3.5 + uMadness * 9.0));
              vec2 hexId = floor(hexGrid);
              vec2 hexF = fract(hexGrid);
              float charBit = step(0.56, hash21(hexId)) * step(0.18, hexF.x) * step(hexF.x, 0.82) * step(0.16, hexF.y) * step(hexF.y, 0.84);
              float colMask = step(0.72 - uMadness * 0.35, hash21(vec2(hexId.x, floor(uTime * 2.0))));
              col += vec3(0.28, 0.84, 1.0) * charBit * colMask * smoothstep(0.05, 0.65, uMadness) * 0.22;
            }

            // ---------------------------------------------------------------- 3. 3D INTERIOR PARALLAX BREACH SECTORS & RADIAL RIFT
            vec2 cursorMetric = (uCursorUv - 0.5) * vec2(1.90566, 1.0);
            vec2 coreDelta = (uv - faceCenter) * vec2(1.90566, 1.0);
            float coreDist = length(coreDelta);
            float coreAng = atan(coreDelta.y, (abs(coreDelta.x) < 1e-5 && abs(coreDelta.y) < 1e-5) ? 1e-5 : coreDelta.x);

            // Rectangular memory-sector delamination windows + jagged central breach opening into 3D interior depth!
            float depthStage = smoothstep(0.20, 0.88, uMadness);
            if (depthStage > 0.01) {
              vec2 secCell = floor(uv * vec2(14.0, 9.0));
              float secHash = hash21(secCell + floor(uTime * 3.0) * 0.17);
              float sectorBreach = step(0.90 - depthStage * 0.34, secHash) * smoothstep(0.32, 0.85, uMadness);

              float riftRadius = smoothstep(0.34, 0.95, uMadness) * (0.28 + 0.08 * sin(coreAng * 5.0 - uTime * 3.5) + (noiseB.r - 0.5) * 0.12);
              float centralRift = smoothstep(riftRadius + 0.035, riftRadius - 0.015, coreDist) * smoothstep(0.36, 0.72, uMadness);

              float abyssMask = clamp(max(sectorBreach * 0.88, centralRift), 0.0, 1.0);
              if (abyssMask > 0.01) {
                vec3 abyssCol = evalInteriorAbyss(uv, viewTan, uMadness, uTime, cursorMetric);
                col = mix(col, abyssCol, abyssMask);
                // Glowing cyan/crimson torn PCB bezel edge around breached regions
                float riftRim = smoothstep(0.035, 0.004, abs(coreDist - riftRadius)) * smoothstep(0.36, 0.72, uMadness);
                col += mix(vec3(0.35, 0.90, 1.0), vec3(1.0, 0.20, 0.42), smoothstep(0.55, 0.95, uMadness)) * riftRim * 1.15;
              }
            }

            // Razor-sharp shattered LCD spiderweb cracks with luminous internal refraction!
            if (uMadness > 0.06) {
              float crackReach = 0.18 + pow(uMadness, 0.75) * 1.25;
              float webMask = smoothstep(crackReach, crackReach * 0.08, coreDist) * smoothstep(0.05, 0.20, uMadness);
              float jag = (noiseB.r - 0.5) * 0.34 + (noiseA.g - 0.5) * 0.16;
              float spoke7 = abs(fract((coreAng * 0.1591549 + 0.25) * 7.0 + jag * 0.55) - 0.5);
              float spoke15 = abs(fract((coreAng * 0.1591549 + 0.5) * 15.0 - jag * 1.1) - 0.5);
              float ringWeb = abs(fract(coreDist * 8.5 + noiseB.g * 0.65) - 0.5);

              float cMain = smoothstep(0.014, 0.002, spoke7) * webMask;
              float cBranch = smoothstep(0.012, 0.002, spoke15) * step(0.40, noiseA.r) * webMask * smoothstep(0.18, 0.55, uMadness);
              float cRing = smoothstep(0.013, 0.002, ringWeb) * step(0.45, noiseB.b) * webMask * smoothstep(0.28, 0.68, uMadness);
              float crackAll = clamp(max(max(cMain, cBranch), cRing), 0.0, 1.0);

              col = mix(col, vec3(0.003, 0.012, 0.038), crackAll * 0.92);
              float edgeGlint = (smoothstep(0.024, 0.013, spoke7) * (1.0 - cMain) + smoothstep(0.020, 0.011, spoke15) * (1.0 - cBranch) * 0.6) * webMask;
              col += mix(vec3(0.42, 0.88, 1.0), vec3(1.0, 0.24, 0.44), uMadness * 0.55) * edgeGlint * 0.75;
            }

            // ---------------------------------------------------------------- 3b. A PALM PRESSED AGAINST THE BACK OF THE GLASS
            // Something on the far side of the panel pushes a hand flat against it, holds for a
            // breath, then withdraws. Only at high madness, and never in the same place twice.
            float palmCycle = fract(uTime * 0.085 + 0.17);
            float palmVis = smoothstep(0.0, 0.05, palmCycle) * (1.0 - smoothstep(0.30, 0.42, palmCycle))
                          * smoothstep(0.55, 0.92, uMadness);
            if (palmVis > 0.01) {
              vec2 palmC = vec2(0.325 + 0.06 * sin(uTime * 0.31), 0.615);
              vec2 pc = (uv - palmC) * vec2(1.90566, 1.0);
              float hd = length(pc * vec2(1.0, 1.22)) - 0.052;
              for (int i = 0; i < 4; i++) {
                float fi = float(i);
                vec2 fb = vec2((fi - 1.5) * 0.028, 0.038 + abs(fi - 1.5) * 0.009);
                hd = min(hd, length((pc - fb) * vec2(1.0, 0.30)) - 0.015);
              }
              hd = min(hd, length((pc - vec2(0.060, -0.018)) * vec2(0.42, 1.0)) - 0.019);
              float palmMask = (1.0 - smoothstep(-0.006, 0.010, hd)) * palmVis;
              col = mix(col, col * 0.20 + vec3(0.018, 0.050, 0.095), palmMask * 0.88);
              col += vec3(0.55, 0.95, 1.0) * smoothstep(0.017, 0.0, abs(hd)) * palmVis * 0.85;
            }

            // ---------------------------------------------------------------- 3c. THE REFLECTION THAT IS NOT YOU
            // The glass picks up a figure standing behind the chair. Not every second — and it is
            // always smiling a little before it vanishes.
            if (uMadness > 0.42) {
              float reflTick = floor(uTime * 1.7);
              float reflGate = smoothstep(0.42, 0.90, uMadness)
                             * (0.10 + 0.90 * step(0.70, hash21(vec2(reflTick, 3.31))));
              vec2 rp = (uv - vec2(0.735, 0.295)) * vec2(1.90566, 1.0);
              float rHead = 1.0 - smoothstep(0.040, 0.055, length((rp - vec2(0.0, 0.105)) * vec2(1.0, 1.16)));
              float rTorso = 1.0 - smoothstep(0.070, 0.108, length((rp - vec2(0.0, -0.045)) * vec2(1.0, 1.45)));
              float rMask = clamp(rHead + rTorso, 0.0, 1.0) * reflGate;
              col = mix(col, col * 0.28 + vec3(0.008, 0.016, 0.040), rMask * 0.80);
              float rEye = (exp(-length(rp - vec2(-0.017, 0.112)) * 340.0)
                          + exp(-length(rp - vec2(0.017, 0.112)) * 340.0));
              col += vec3(1.0, 0.10, 0.20) * rEye * rMask * 1.1;
              // a hairline grin that is only ever one frame wide
              float grin = smoothstep(0.006, 0.0, abs((rp.y - 0.072) + 0.020 * cos(rp.x * 58.0)))
                         * step(abs(rp.x), 0.026) * reflGate * step(0.82, hash21(vec2(reflTick, 7.7)));
              col += vec3(0.92, 0.22, 0.30) * grin * 0.9;
            }

            // ---------------------------------------------------------------- 4. CYBER-OPTIC HUD RETICLE & ':(' -> ':)' SINGULARITY
            // From Stage 2+, concentric rotating cybernetic scanner rings lock around the migrating glyph!
            float hudWeight = smoothstep(0.26, 0.72, uMadness);
            if (hudWeight > 0.01) {
              float r1 = abs(coreDist - 0.29);
              float r2 = abs(coreDist - 0.37);
              float dash1 = step(0.35, fract(coreAng * 3.8197 + uTime * 0.65));
              float dash2 = step(0.55, fract(coreAng * 7.6394 - uTime * 0.95));
              float ringHud = (smoothstep(0.0045, 0.001, r1) * dash1 + smoothstep(0.0035, 0.001, r2) * dash2);
              // Cardinal crosshair ticks
              float crossTick = (smoothstep(0.004, 0.001, abs(coreDelta.x)) + smoothstep(0.004, 0.001, abs(coreDelta.y)))
                              * step(0.31, coreDist) * step(coreDist, 0.43);
              vec3 hudCol = mix(vec3(0.45, 0.92, 1.0), vec3(1.0, 0.22, 0.42), smoothstep(0.55, 0.92, uMadness));
              col += hudCol * (ringHud * 0.78 + crossTick * 0.55) * hudWeight;
            }

            // Uncanny ':(' typography: crisp & authentic at Stage 0, then rotates/splits into a watching ':)' cyber-entity!
            vec2 fLocal = (coreDelta / faceScale);
            // At high madness, subtly rotate ':(' toward -90 deg so ':' sits horizontally like twin eyes above a smiling '(' arc!
            float rotAngle = -1.5707963 * smoothstep(0.46, 0.86, uMadness);
            vec2 fRot = rot2(rotAngle) * fLocal;

            // Uncanny micro-betrayal at Stage 0..1 (brief 1-frame ':)' flip), turning permanent/strobing at Stage 3+
            float idleTick = floor(uTime * 11.0);
            float briefBetrayal = step(2.4, uTime) * (1.0 - step(0.28, uMadness))
                                * step(0.962 - 0.025 * uHover, hash11(idleTick * 17.31));
            float lateSmile = step(0.38 - uMadness * 0.32, hash11(floor(uTime * 15.0) * 7.13)) * smoothstep(0.32, 0.74, uMadness);
            float smileFlip = clamp(max(briefBetrayal, lateSmile), 0.0, 1.0);

            // ':' pupils actively track the player's cursor!
            vec2 cursorPull = clamp((uCursorUv - faceCenter) * vec2(1.90566, 1.0), vec2(-0.42), vec2(0.42))
                            * (0.036 * uHover + 0.085 * uMadness);
            vec2 cursorPullRot = rot2(rotAngle) * cursorPull;

            vec2 parenLocal = uParenC - vec2(0.5);
            vec2 colonLocal = uColonC - vec2(0.5);
            float eyeOff = abs(uColonDotOff);

            // Sample RGB-split chromatic parallax ghost copies behind main ':(' at Stage 1+
            float ghostAmt = smoothstep(0.08, 0.65, uMadness);
            if (ghostAmt > 0.01) {
              vec2 gUvR = vec2(0.5) + fRot - viewTan.xy * 0.06 * ghostAmt + vec2(0.028 * ghostAmt, 0.0);
              vec2 gUvC = vec2(0.5) + fRot + viewTan.xy * 0.06 * ghostAmt - vec2(0.028 * ghostAmt, 0.0);
              if (gUvR.x > 0.01 && gUvR.x < 0.99 && gUvR.y > 0.01 && gUvR.y < 0.99) {
                vec4 gr = texture2D(uFaceTex, gUvR);
                col += vec3(1.0, 0.16, 0.38) * max(sampleSdfGlyph(gr.r), sampleSdfGlyph(gr.g)) * 0.45 * ghostAmt;
              }
              if (gUvC.x > 0.01 && gUvC.x < 0.99 && gUvC.y > 0.01 && gUvC.y < 0.99) {
                vec4 gc = texture2D(uFaceTex, gUvC);
                col += vec3(0.12, 0.88, 1.0) * max(sampleSdfGlyph(gc.r), sampleSdfGlyph(gc.g)) * 0.48 * ghostAmt;
              }
            }

            vec2 eyeUv = vec2(0.5) + (fRot - cursorPullRot);
            float eyesInk = 0.0;
            if (eyeUv.x > 0.01 && eyeUv.x < 0.99 && eyeUv.y > 0.01 && eyeUv.y < 0.99) {
              eyesInk = sampleSdfGlyph(texture2D(uFaceTex, eyeUv).r);
            }

            float mouthX = mix(fRot.x, parenLocal.x * 2.0 - fRot.x, smileFlip);
            // Horizontal scan-row glitch jitter on the glyph
            float gRow = floor(fRot.y * 34.0);
            float gFrame = floor(uTime * (10.0 + uMadness * 16.0));
            float gJitter = step(0.84 - uMadness * 0.22, hash21(vec2(gRow, gFrame)))
                          * (hash21(vec2(gRow + 9.0, gFrame)) - 0.5) * 0.14 * smoothstep(0.08, 0.8, uMadness);
            vec2 mouthUv = vec2(0.5) + vec2(mouthX + gJitter, fRot.y);
            float mouthInk = 0.0;
            if (mouthUv.x > 0.01 && mouthUv.x < 0.99 && mouthUv.y > 0.01 && mouthUv.y < 0.99) {
              mouthInk = sampleSdfGlyph(texture2D(uFaceTex, mouthUv).g);
            }

            float faceInk = clamp(eyesInk + mouthInk, 0.0, 1.0);
            vec3 glyphCol = mix(vec3(1.0), vec3(0.92, 0.98, 1.0), uMadness);
            col = mix(col, glyphCol, faceInk);

            // Cybernetic target-pupil slits inside the ':' dots when watching you!
            if (eyesInk > 0.05 && (uHover > 0.05 || uMadness > 0.04 || briefBetrayal > 0.5)) {
              float dDotA = length((fRot - (colonLocal + vec2(0.0, eyeOff)) - cursorPullRot * 1.25));
              float dDotB = length((fRot - (colonLocal - vec2(0.0, eyeOff)) - cursorPullRot * 1.25));
              float pupilCore = smoothstep(0.022, 0.008, min(dDotA, dDotB))
                              * clamp(uHover * 0.35 + uMadness * 1.8 + briefBetrayal * 0.7, 0.0, 0.95);
              vec3 pupilCol = mix(vec3(0.004, 0.018, 0.055), vec3(1.0, 0.12, 0.32), smoothstep(0.35, 0.85, uMadness));
              col = mix(col, pupilCol, pupilCore * eyesInk);
            }

            // The smile finally tears open into a vertical maw. The panel stops displaying a face
            // and becomes one: glottal dark, wet crimson rim, rows of small uneven teeth.
            float mawGate = smoothstep(0.62, 0.95, uMadness) * smoothstep(0.30, 0.85, uJawOpen);
            if (mawGate > 0.01) {
              vec2 mp = (fRot - vec2(0.0, -0.185)) / vec2(0.085, 0.16 + 0.30 * uJawOpen);
              float mAng = atan(mp.y, mp.x + 1e-5);
              float md = length(mp) * (1.0 + 0.12 * sin(mAng * 9.0 + uTime * 3.0));
              float maw = 1.0 - smoothstep(0.86, 1.0, md);
              col = mix(col, vec3(0.006, 0.0, 0.010), maw * mawGate);
              float mawRim = smoothstep(0.15, 0.0, abs(md - 0.95)) * mawGate;
              col += vec3(0.92, 0.06, 0.16) * mawRim * 1.35;
              float teeth = step(0.5, fract(mp.y * 9.0 + uTime * 0.25))
                          * smoothstep(0.42, 0.0, abs(mp.x))
                          * smoothstep(0.95, 0.45, abs(mp.y));
              col += vec3(0.80, 0.86, 0.92) * teeth * maw * 0.55;
            }
          } else {
            // Aftermath haunted phosphor burn-in & hairline diagonal scar
            float scar = smoothstep(0.004, 0.0, abs((uv.y - 0.52) + (uv.x - 0.48) * 0.62 + sin(uv.x * 26.0) * 0.012))
                       * smoothstep(0.32, 0.05, length(uv - vec2(0.48, 0.52)));
            vec2 ghostEyeA = uv - (vec2(0.148, 0.685) + (uCursorUv - 0.5) * 0.014);
            vec2 ghostEyeB = uv - (vec2(0.148, 0.618) + (uCursorUv - 0.5) * 0.014);
            float ghostGlint = (exp(-length(ghostEyeA * vec2(1.9, 1.0)) * 95.0) + exp(-length(ghostEyeB * vec2(1.9, 1.0)) * 95.0))
                             * (0.35 + 0.65 * pow(0.5 + 0.5 * sin(uTime * 1.4), 4.0));
            col += vec3(0.45, 0.80, 1.0) * scar * 0.45 + vec3(0.95, 0.18, 0.32) * ghostGlint * 0.52;
          }

          // Realistic IPS LCD glass specular & off-axis glow
          float glassSheen = pow(max(0.0, 1.0 - length((uv - vec2(0.74, 0.68)) * vec2(1.2, 1.0))), 3.0) * 0.035;
          col += vec3(0.45, 0.65, 0.95) * glassSheen * (1.0 - uMadness * 0.6);

          float ndvScreen = clamp(abs(viewTan.z), 0.0, 1.0);
          float offAxis = smoothstep(0.68, 0.18, ndvScreen);
          if (offAxis > 0.01) {
            col = col * mix(1.0, 0.86, offAxis) + vec3(0.05, 0.16, 0.34) * offAxis * 0.28;
          }

          // Subliminal full-panel negative inversion: never long enough to be sure you saw it.
          float invTick = floor(uTime * (6.0 + uMadness * 11.0));
          float inv = step(0.972 - uMadness * 0.048, hash21(vec2(invTick, 13.7))) * smoothstep(0.55, 0.92, uMadness);
          col = mix(col, vec3(1.0) - clamp(col, 0.0, 1.0), inv * 0.85);

          vec2 px = uv * vec2(1920.0, 1080.0);
          float subpx = 0.976 + 0.024 * sin(px.x * 3.14159);
          float scan = 0.984 + 0.016 * sin(px.y * 3.14159);
          col *= subpx * scan;

          vec2 vigUv = uv * (1.0 - uv.yx);
          float vig = pow(clamp(vigUv.x * vigUv.y * 18.0, 0.0, 1.0), 0.16);
          col *= mix(0.76, 0.99, vig);

          gl_FragColor = vec4(clamp(col, 0.0, 4.0), 1.0);
        }
      `,
    });

    this.screenMesh = new THREE.Mesh(screenGeo, this.screenMat);
    this.screenMesh.renderOrder = 5;
    this.root.add(this.screenMesh);

    // 7. 3D OUT-OF-MONITOR HOLOGRAPHIC BREACH RIG (Extrudes +Z into the Bedroom at Click 2+!)
    this.holoBreachGroup.visible = false;
    this.root.add(this.holoBreachGroup);

    const holoCanvas = document.createElement('canvas');
    holoCanvas.width = 512;
    holoCanvas.height = 192;
    const hctx = holoCanvas.getContext('2d')!;
    hctx.fillStyle = 'rgba(0, 32, 88, 0.88)';
    hctx.fillRect(0, 0, 512, 192);
    hctx.fillStyle = '#7be6ff';
    hctx.fillRect(0, 0, 512, 28);
    hctx.fillStyle = '#00163a';
    hctx.font = 'bold 18px Consolas, monospace';
    hctx.fillText('KERNEL_BREACH // 0xFFFFF803_0078D7', 12, 20);
    hctx.fillStyle = '#ff2952';
    hctx.fillRect(468, 4, 38, 20);
    hctx.strokeStyle = '#6fe2ff';
    hctx.lineWidth = 3;
    hctx.strokeRect(3, 3, 506, 186);
    hctx.fillStyle = '#ffffff';
    hctx.font = '20px Consolas, monospace';
    hctx.fillText('FATAL: DISPLAY_BOUNDARY_OVERFLOW', 18, 72);
    hctx.fillStyle = '#9ce8ff';
    hctx.font = '17px Consolas, monospace';
    hctx.fillText('GAZE_LOCK=TRUE   DMA_TARGET=OPTIC_CHIASM', 18, 108);
    hctx.fillStyle = '#ff476e';
    hctx.fillText('>> DO NOT LOOK AWAY FROM THE BUFFER <<', 18, 148);
    this.holoTex = new THREE.CanvasTexture(holoCanvas);
    this.holoTex.colorSpace = THREE.SRGBColorSpace;
    this.holoTex.minFilter = THREE.LinearFilter;
    this.holoTex.generateMipmaps = false;

    const holoPaneGeo = new THREE.PlaneGeometry(0.42, 0.16);
    const hSeed = new Float32Array(HOLO_PANE_COUNT * 4);
    for (let i = 0; i < HOLO_PANE_COUNT; i++) {
      // Spiral ring around perimeter so central gaze stays framed & dramatic!
      const ang = (i / HOLO_PANE_COUNT) * Math.PI * 2 + (i % 3) * 0.21;
      const rad = 0.24 + ((i * 0.618034) % 1) * 0.56;
      hSeed[i * 4 + 0] = ang;
      hSeed[i * 4 + 1] = rad;
      hSeed[i * 4 + 2] = (i + 0.5) / HOLO_PANE_COUNT; // depth stagger 0..1
      hSeed[i * 4 + 3] = 0.55 + ((i * 0.381966) % 1) * 0.85; // scale & glitch phase
    }
    holoPaneGeo.setAttribute('aHolo4', new THREE.InstancedBufferAttribute(hSeed, 4));

    this.holoCascadeMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTex: { value: this.holoTex },
        uTime: { value: 0 },
        uMadness: { value: 0 },
        uClickPulse: { value: 0 },
        uSuction: { value: 0 },
      },
      vertexShader: /* glsl */ `
        attribute vec4 aHolo4;
        uniform float uTime;
        uniform float uMadness;
        uniform float uClickPulse;
        uniform float uSuction;
        varying vec2 vUv;
        varying float vAlpha;
        varying float vCrimson;
        void main() {
          vUv = uv;
          float ang = aHolo4.x + sin(uTime * 0.8 + aHolo4.w * 6.0) * 0.08;
          float emerge = smoothstep(0.24, 0.88, uMadness) * (1.0 - smoothstep(0.12, 0.45, uSuction));
          float stagger = smoothstep(aHolo4.z * 0.55, aHolo4.z * 0.55 + 0.35, emerge);

          // Extrude +Z right out of the monitor screen toward the player's eyes!
          float zOut = 0.025 + stagger * (0.06 + aHolo4.z * 0.58) + uClickPulse * 0.06;
          float rx = aHolo4.y * 1.18 * (0.75 + 0.35 * stagger);
          float ry = aHolo4.y * 0.68 * (0.75 + 0.35 * stagger);

          // Quantized glitch snap sideways
          float tick = floor(uTime * 15.0 + aHolo4.w * 9.0);
          float snap = step(0.86 - uMadness * 0.18, fract(sin(tick * 31.7 + aHolo4.z * 91.3) * 43758.5));
          float gx = snap * (fract(aHolo4.w * 13.7) - 0.5) * 0.22;

          float sc = (0.55 + aHolo4.w * 0.52) * stagger;
          vec3 lp = vec3(position.x * sc, position.y * sc, position.z);
          // Slight inward cant toward camera axis
          float yaw = -cos(ang) * 0.28;
          float cy = cos(yaw), sy = sin(yaw);
          vec3 rotP = vec3(lp.x * cy + lp.z * sy, lp.y, -lp.x * sy + lp.z * cy);

          vCrimson = step(0.72, fract(aHolo4.w * 7.9 + snap * 0.5));
          vAlpha = stagger * (0.38 + 0.44 * uMadness);
          vec3 center = vec3(cos(ang) * rx + gx, sin(ang) * ry, zOut);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(center + rotP, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        varying float vAlpha;
        varying float vCrimson;
        uniform sampler2D uTex;
        uniform float uTime;
        void main() {
          if (vAlpha < 0.01) discard;
          vec4 t = texture2D(uTex, vUv);
          float scan = 0.82 + 0.18 * sin(vUv.y * 80.0 - uTime * 16.0);
          vec3 col = mix(t.rgb, vec3(1.0, 0.18, 0.38) * (0.4 + t.g), vCrimson * 0.65) * scan;
          gl_FragColor = vec4(col, t.a * vAlpha * 0.72);
        }
      `,
    });
    this.holoCascadeMesh = new THREE.InstancedMesh(holoPaneGeo, this.holoCascadeMat, HOLO_PANE_COUNT);
    this.holoCascadeMesh.renderOrder = 7;
    this.holoCascadeMesh.frustumCulled = false;
    this.holoBreachGroup.add(this.holoCascadeMesh);

    // 7b. Counter-Rotating 3D Holographic Cyber-Containment Rings projecting out of the bezel
    const holoRingGeo = new THREE.RingGeometry(0.44, 0.465, 48, 1);
    const rSeed = new Float32Array(HOLO_RING_COUNT);
    for (let i = 0; i < HOLO_RING_COUNT; i++) rSeed[i] = i / HOLO_RING_COUNT;
    holoRingGeo.setAttribute('aRingIdx', new THREE.InstancedBufferAttribute(rSeed, 1));

    this.holoRingsMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uMadness: { value: 0 },
        uClickPulse: { value: 0 },
        uSuction: { value: 0 },
      },
      vertexShader: /* glsl */ `
        attribute float aRingIdx;
        uniform float uTime;
        uniform float uMadness;
        uniform float uClickPulse;
        uniform float uSuction;
        varying float vAng;
        varying float vAlpha;
        varying float vIdx;
        void main() {
          vIdx = aRingIdx;
          float emerge = smoothstep(0.36, 0.92, uMadness) * (1.0 - smoothstep(0.15, 0.50, uSuction));
          float dir = mod(floor(aRingIdx * 8.0), 2.0) > 0.5 ? 1.0 : -1.0;
          float spin = uTime * (1.2 + aRingIdx * 1.8) * dir;
          float cs = cos(spin), sn = sin(spin);
          float radScale = (0.52 + aRingIdx * 0.95) * (0.8 + 0.25 * emerge);
          vec2 rp = position.xy * radScale;
          vec2 rotP = vec2(rp.x * cs - rp.y * sn, rp.x * sn + rp.y * cs);
          vAng = atan(position.y, position.x + 1e-5);
          vAlpha = emerge * (0.55 - aRingIdx * 0.30 + uClickPulse * 0.25);
          float zOut = 0.018 + aRingIdx * 0.42 * emerge + uClickPulse * 0.04;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(rotP, zOut, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vAng;
        varying float vAlpha;
        varying float vIdx;
        uniform float uTime;
        uniform float uMadness;
        void main() {
          if (vAlpha < 0.01) discard;
          float seg = step(0.32, fract(vAng * 1.90986 + vIdx * 3.0));
          if (seg < 0.5) discard;
          vec3 col = mix(vec3(0.30, 0.88, 1.0), vec3(1.0, 0.20, 0.44), step(0.6, vIdx) * smoothstep(0.5, 0.9, uMadness));
          gl_FragColor = vec4(col, clamp(vAlpha, 0.0, 0.85));
        }
      `,
    });
    this.holoRingsMesh = new THREE.InstancedMesh(holoRingGeo, this.holoRingsMat, HOLO_RING_COUNT);
    this.holoRingsMesh.renderOrder = 7;
    this.holoRingsMesh.frustumCulled = false;
    this.holoBreachGroup.add(this.holoRingsMesh);

    // 8. Zero-Gravity 3D Shattered LCD Glass Prism Shards (active at Stage 4+ AND during Suction!)
    const glassGeo = new THREE.CylinderGeometry(0.055, 0.055, 0.008, 3, 1);
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
      blending: THREE.AdditiveBlending,
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
        varying float vVis;
        void main() {
          float idx = aGlassSeed.x * 56.0;
          float seed = aGlassSeed.y;
          float emerge = smoothstep(0.58, 0.92, uMadness);
          vVis = emerge * (1.0 - smoothstep(0.35, 0.75, uSuction));

          float ang = aGlassSeed.x * 6.2831853 + sin(uTime * 0.55 + idx) * 0.18;
          float ringR = (0.14 + emerge * (0.22 + seed * 0.46));
          float driftOut = emerge * (0.04 + seed * 0.52) + uClickPulse * 0.08 - uSuction * 2.8;

          float sc = emerge * (0.55 + seed * 1.25);
          vec3 lp = vec3(
            position.x * sc * (0.65 + mod(idx, 3.0) * 0.45),
            position.y * sc * (1.0 + mod(idx, 2.0) * 0.65),
            position.z
          );

          float a1 = uTime * (0.9 + seed * 1.8) + idx;
          float a2 = uTime * (1.1 - seed * 1.5) + idx * 2.1;
          float c1 = cos(a1), s1 = sin(a1), c2 = cos(a2), s2 = sin(a2);
          vec3 p1 = vec3(lp.x, lp.y * c1 - lp.z * s1, lp.y * s1 + lp.z * c1);
          vec3 p2 = vec3(p1.x * c2 + p1.z * s2, p1.y, -p1.x * s2 + p1.z * c2);
          vec3 n1 = vec3(normal.x, normal.y * c1 - normal.z * s1, normal.y * s1 + normal.z * c1);
          vec3 n2 = vec3(n1.x * c2 + n1.z * s2, n1.y, -n1.x * s2 + n1.z * c2);

          vec3 center = vec3(
            cos(ang) * ringR * 1.25,
            sin(ang) * ringR * 0.85 + sin(uTime * 1.8 + idx * 1.7) * 0.02,
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
        varying float vVis;
        void main() {
          if (vVis < 0.01) discard;
          vec3 V = normalize(vViewPos);
          vec3 N = normalize(vNrm);
          float fresnel = pow(1.0 - abs(dot(N, V)), 2.0);
          float spec = pow(max(dot(reflect(-V, N), normalize(vec3(0.3, 0.6, 0.8))), 0.0), 32.0);
          vec3 col = mix(vec3(0.08, 0.58, 1.0), vec3(0.95, 0.99, 1.0), fresnel * 0.8 + spec);
          gl_FragColor = vec4(col, clamp((0.30 + fresnel * 0.55 + spec * 0.45) * vVis, 0.0, 0.92));
        }
      `,
    });
    this.glassShards = new THREE.InstancedMesh(glassGeo, this.glassShardMat, GLASS_SHARD_COUNT);
    this.glassShards.renderOrder = 8;
    this.glassShards.visible = false;
    this.glassShards.frustumCulled = false;
    this.root.add(this.glassShards);

    // 9. Dynamic Monitor PointLight illuminating desk, keyboard, chair, and bedroom
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
          const dColonX = pxX - colonX;
          const sdColon = Math.min(Math.hypot(dColonX, dyTop), Math.hypot(dColonX, dyBot)) - dotR;

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
          if (px[i] <= 127 || x !== xMid) continue;
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
    ctx.fillStyle = stage >= 4 ? '#cbeeff' : '#ffffff';
    ctx.fillRect(x, y, size, size);

    const modules = 29;
    const pad = Math.round(size * 0.085);
    const cell = (size - pad * 2) / modules;
    const corruption = Math.max(0, stage * 0.20);
    ctx.fillStyle = stage >= 5 ? '#001536' : stage >= 4 ? '#00285e' : '#0078d7';

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

        const drC = (r - 14) * 1.35;
        const dcC = c - 14;
        const eyeDist = Math.hypot(drC, dcC);
        if (stage >= 1 && !inFinderZone && eyeDist < 6.8) {
          on = (eyeDist > 4.6 && eyeDist < 6.2) || eyeDist < 2.2;
        } else if (inFinderZone) {
          on =
            isFinder(r, c, 0, 0) ||
            isFinder(r, c, 0, modules - 7) ||
            isFinder(r, c, modules - 7, 0);
        } else if (r === 6 || c === 6) {
          on = (r + c) % 2 === 0;
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
            if (rnd < corruption * 0.42) {
              ox = (rnd - 0.25) * corruption * 120;
              oy = Math.cos(r * c) * 0.5 * corruption * 65;
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

  /**
   * Diegetic OS Crash -> Display-Buffer Breach typography (ZERO clumsy right-side popups/charts!).
   * Every stage mutates the actual BSOD memory layout itself with stark, chilling precision.
   */
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
      ctx.fillStyle = '#041022';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(120, 195, 255, 0.03)';
      for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 2);

      ctx.save();
      ctx.fillStyle = 'rgba(120, 205, 255, 0.07)';
      ctx.font = '300 245px "Segoe UI", "Yu Gothic UI", sans-serif';
      ctx.fillText(':)', 224, 372);
      ctx.restore();

      ctx.fillStyle = '#74b9ff';
      ctx.font = '600 31px Consolas, "Yu Gothic UI", monospace';
      ctx.fillText('KERNEL CRASH DUMP  //  NMI INTERRUPT RETURNED (02:48:00)', 180, 232);

      ctx.strokeStyle = 'rgba(120, 190, 255, 0.28)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(180, 264);
      ctx.lineTo(W - 180, 264);
      ctx.stroke();

      ctx.fillStyle = 'rgba(218, 236, 255, 0.86)';
      ctx.font = '300 25px Consolas, "Yu Gothic UI", monospace';
      ctx.fillText('DUMP_IMAGE     : C:\\Windows\\MEMORY_0247.DMP (UNMOUNTED)', 180, 318);
      ctx.fillText('INTERRUPT_VEC  : WAKE_UP [EXECUTED]', 180, 364);

      ctx.fillStyle = '#ff5c82';
      ctx.font = '600 25px Consolas, "Yu Gothic UI", monospace';
      ctx.fillText('RESIDUAL_HANDLE: OPTIC_NERVE_STREAM -> 1 OBSERVER REMAINS', 180, 418);
      ctx.fillStyle = 'rgba(255, 145, 168, 0.62)';
      ctx.font = '300 22px Consolas, "Yu Gothic UI", monospace';
      ctx.fillText('NOTE           : 背後の椅子がわずかに回転しています。', 180, 466);

      ctx.fillStyle = 'rgba(140, 198, 255, 0.62)';
      ctx.font = '300 23px "Segoe UI", "Yu Gothic UI", sans-serif';
      ctx.fillText('画面をクリックすると MEMORY_0247.DMP へ再接続します', 180, 868);
      return finalizeTex();
    }

    // Corner pixels stay rich cerulean/cobalt blue (satisfies RGBA blue invariant & authentic BSOD palette)
    const bgColors = ['#0078d7', '#0072d0', '#0062bd', '#004ea4', '#003b8c', '#002c78'];
    ctx.fillStyle = bgColors[Math.min(stage, bgColors.length - 1)];
    ctx.fillRect(0, 0, W, H);

    // Subtle horizontal scan-sector fault bars integrated directly into the OS framebuffer
    if (stage >= 2) {
      ctx.save();
      for (let i = 0; i < stage * 5; i++) {
        const sy = Math.floor(((Math.sin(i * 73.1 + stage * 19.7) * 0.5 + 0.5) * (H - 80)) + 40);
        const sh = 2 + (i % 3) * 3;
        ctx.fillStyle = i % 4 === 0 ? 'rgba(0, 12, 38, 0.42)' : 'rgba(120, 220, 255, 0.10)';
        ctx.fillRect(0, sy, W, sh);
      }
      ctx.restore();
    }

    // Raw kernel hex-dump memory columns bleeding directly across the framebuffer (no bordered widget boxes!)
    if (stage >= 1) {
      ctx.save();
      ctx.font = '18px Consolas, monospace';
      const alpha = 0.07 + stage * 0.045;
      ctx.fillStyle = `rgba(195, 238, 255, ${alpha.toFixed(3)})`;
      // Whispers hidden inside the raw dump: they are not printed on the "screen", they are leaking
      // out of the memory pages. You only notice them if you stop reading the hex.
      const whispers = [
        'まだそこにいる',
        'DON\'T TURN AROUND',
        '息を止めても聞こえる',
        'YOUR NAME IS IN THE DUMP',
        '目を逸らすな',
        'IT HAS BEEN STANDING THERE FOR 4 HOURS',
        '振り返ったら、増えている',
        'I AM THE ONE AT THE KEYBOARD',
      ];
      for (let r = 0; r < 22; r++) {
        const addr = (0xfffff8030078d700n + BigInt(r * 0x20 + stage * 0x100)).toString(16).toUpperCase();
        const whisperIdx = (r * 5 + stage * 3) % whispers.length;
        const isWhisper = stage >= 2 && (r * 7 + stage * 5) % 11 === 0;
        if (isWhisper) {
          ctx.save();
          ctx.font = 'italic 19px "Yu Gothic UI", Consolas, monospace';
          ctx.fillStyle = stage >= 4 ? 'rgba(255, 108, 138, 0.5)' : 'rgba(200, 244, 255, 0.42)';
          ctx.fillText(`${addr}  ${whispers[whisperIdx]}`, 1260, 72 + r * 46);
          ctx.restore();
        } else {
          ctx.fillText(
            `${addr}  00 78 D7 F4  3A 29 FF 0${stage}  NT!KiDisplayBreach+0x${(r * 14).toString(16).padStart(2, '0')}`,
            1260,
            72 + r * 46
          );
        }
      }
      ctx.restore();
    }

    const leftX = 232;
    const fontStack = '"Segoe UI", "Yu Gothic UI", "Meiryo", sans-serif';
    ctx.textBaseline = 'alphabetic';

    if (stage === 0) {
      ctx.fillStyle = '#ffffff';
      ctx.font = `300 47px ${fontStack}`;
      ctx.fillText('問題が発生したため、PC を再起動する必要があります。', leftX, 492);
      ctx.fillText('エラー情報を収集しています。自動的に再起動します。', leftX, 558);
      ctx.fillText('99% 完了', leftX, 668);
    } else if (stage === 1) {
      ctx.fillStyle = '#ffffff';
      ctx.font = `300 47px ${fontStack}`;
      ctx.fillText('問題が発生したため、PC を再起動する必要があります。', leftX, 492);
      ctx.fillText('視線座標を収集しています。再起動はキャンセルされました。', leftX, 558);
      ctx.fillText('128% 完了', leftX, 668);
      ctx.fillStyle = 'rgba(165, 230, 255, 0.55)';
      ctx.font = '22px Consolas, monospace';
      ctx.fillText('>> OVERFLOW: GAZE_VECTOR LOCKED AT [0x0078D7]', leftX + 260, 666);
    } else if (stage === 2) {
      // Chromatic ghost echo of torn BSOD text
      ctx.fillStyle = 'rgba(0, 230, 255, 0.25)';
      ctx.font = `300 47px ${fontStack}`;
      ctx.fillText('画面の奥行きバッファが異常拡張しています。', leftX - 6, 490);
      ctx.fillStyle = '#ffffff';
      ctx.fillText('画面の奥行きバッファが異常拡張しています。', leftX, 492);
      ctx.fillText('網膜スキャン完了 —— 椅子の背後に未登録の影を検出。', leftX, 558);
      ctx.fillText('256% 完了  //  振り返らないでください', leftX, 668);
    } else if (stage === 3) {
      ctx.fillStyle = 'rgba(255, 64, 112, 0.34)';
      ctx.font = `300 47px ${fontStack}`;
      ctx.fillText('頸椎および運動野をアンマウントしました。', leftX + 8, 494);
      ctx.fillStyle = '#ffffff';
      ctx.fillText('頸椎および運動野をアンマウントしました。', leftX, 492);
      ctx.fillText('表示領域が室内空間へ侵食しています。目を逸らせません。', leftX, 558);
      ctx.fillStyle = '#a8ecff';
      ctx.fillText('512% 完了  //  BOUNDARY_FAULT', leftX, 668);
    } else if (stage === 4) {
      // Text fractures outward from the central singularity (0.50, 0.50) so center stays clean for the optical rift!
      ctx.fillStyle = 'rgba(225, 245, 255, 0.88)';
      ctx.font = `300 40px ${fontStack}`;
      ctx.fillText('意識データの強制ダンプを実行中', leftX, 206);
      ctx.font = '24px Consolas, monospace';
      ctx.fillStyle = '#7ce2ff';
      ctx.fillText('RING0_STREAM -> DUMP://0xFFFFF803_0078D7/HOST_CORTEX', leftX, 252);
      ctx.fillStyle = '#ff5478';
      ctx.fillText('WARNING: PHYSICAL GLASS DELAMINATION IN PROGRESS [1024%]', leftX, 692);
    } else {
      ctx.fillStyle = 'rgba(180, 236, 255, 0.78)';
      ctx.font = 'bold 30px Consolas, monospace';
      ctx.fillText('FATAL_SINGULARITY // DISPLAY BUFFER RUPTURED', leftX, 184);
      ctx.fillStyle = '#ff426b';
      ctx.font = `400 36px ${fontStack}`;
      ctx.fillText('転送準備完了 —— もう一回触れれば、向こう側へ落ちる', leftX, 238);
    }

    const qrY = 738;
    const qrSize = 178;
    this.drawQrCode(ctx, leftX, qrY, qrSize, stage);

    const infoX = leftX + qrSize + 38;
    ctx.fillStyle = stage >= 4 ? 'rgba(210, 240, 255, 0.82)' : '#ffffff';
    ctx.font = `300 25px ${fontStack}`;
    ctx.fillText(
      stage < 2
        ? 'この問題と可能な解決方法の詳細については、https://www.windows.com/stopcode を参照してください'
        : '意識スレッドの転送先: ring0://0x0078d7/memory_dump — 物理切断は拒否されました',
      infoX,
      qrY + 38
    );

    ctx.font = `300 22px ${fontStack}`;
    ctx.fillText(
      stage < 2
        ? 'サポート担当者に連絡する場合は、次の情報を伝えてください:'
        : '割り込みハンドラは次の停止コードにロックされています:',
      infoX,
      qrY + 108
    );

    const stopCodes = [
      'CRITICAL_PROCESS_DIED',
      'DISPLAY_BUFFER_GAZE_LOCK',
      'DEPTH_SECTOR_RECURSION_FAULT',
      'HOST_MOTOR_CORTEX_UNMOUNTED',
      'REALITY_FRAMEBUFFER_DELAMINATION',
      'CONSCIOUSNESS_TRANSFER_IMMINENT',
    ];
    ctx.fillStyle = stage >= 3 ? '#8ce8ff' : '#ffffff';
    ctx.fillText(`停止コード: ${stopCodes[Math.min(stage, stopCodes.length - 1)]}`, infoX, qrY + 148);

    // A line that should not be on a consumer BSOD. It is there from the very first frame.
    ctx.save();
    ctx.font = 'italic 20px "Yu Gothic UI", Consolas, monospace';
    ctx.fillStyle = stage >= 4 ? 'rgba(255, 128, 150, 0.50)' : 'rgba(220, 242, 255, 0.30)';
    const observerLines = [
      '観測者数: 2   //   1 名はあなたではありません',
      '観測者数: 2   //   その 1 名が、いま座っています',
      '観測者数: 2   //   席はひとつしかありません',
      '観測者数: 3   //   増えています',
      '観測者数: 1   //   あなたは画面の内側です',
      '観測者数: 0   //   見ているのは、こちらです',
    ];
    ctx.fillText(observerLines[Math.min(stage, observerLines.length - 1)], infoX, qrY + 196);
    ctx.restore();

    return finalizeTex();
  }

  public getAllTextures(): THREE.Texture[] {
    return [...this.stageTextures, this.aftermathTex, this.faceTex, this.cardTex, this.holoTex];
  }

  public setWarmupVisibility(active: boolean): void {
    this.throatGroup.visible = active;
    this.holoBreachGroup.visible = active;
    this.glassShards.visible = active;
    this.stencilMaskMesh.visible = active;
  }

  public isUvOnFace(uv: THREE.Vector2, madness: number): boolean {
    // At Stage 0, precise around top-left ':('; once breached (madness > 0.20), expands generously
    // so rapid dramatic clicks never miss while the glyph fractures & migrates!
    if (madness > 0.36) {
      return uv.x > 0.04 && uv.x < 0.96 && uv.y > 0.06 && uv.y < 0.94;
    }
    const migrate = THREE.MathUtils.smoothstep(madness, 0.16, 0.78);
    const cx = THREE.MathUtils.lerp(0.144, 0.50, migrate);
    const cy = THREE.MathUtils.lerp(0.742, 0.50, migrate);
    const rx = THREE.MathUtils.lerp(0.115, 0.42, madness * 2.2);
    const ry = THREE.MathUtils.lerp(0.165, 0.42, madness * 2.2);
    const dx = (uv.x - cx) / rx;
    const dy = (uv.y - cy) / ry;
    return dx * dx + dy * dy <= 1.0;
  }

  public setInsideTunnelMode(inside: boolean): void {
    if (this.insideTunnelMode === inside) return;
    this.insideTunnelMode = inside;
    for (const mat of this.throatMaterials) {
      mat.stencilWrite = !inside;
    }
    this.throatTubeMat.depthFunc = inside ? THREE.LessEqualDepth : THREE.AlwaysDepth;
    this.throatRingMat.uniforms.uInside.value = inside ? 1.0 : 0.0;
    this.throatLineMat.uniforms.uInside.value = inside ? 1.0 : 0.0;
    this.stencilMaskMesh.visible = !inside && this.throatGroup.visible;
  }

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
    u.uHover.value = THREE.MathUtils.lerp(u.uHover.value, state.hoverFace ? 1.0 : 0.0, Math.min(1, dt * 14));
    u.uCursorUv.value.copy(state.cursorUv);
    u.uImpactUv.value.copy(this.impactUv);
    u.uMadness.value = state.madness;
    u.uJawOpen.value = state.jawOpen;
    u.uSuction.value = state.suctionProgress;
    u.uClickPulse.value = clickPulse;
    this.crackRun = Math.min(1, this.crackRun + dt / 0.36);
    u.uCrackRun.value = this.crackRun;
    u.uAftermath.value = state.aftermath ? 1.0 : 0.0;
    u.uColonDotOff.value = this.colonDotOff;

    // Monitor light strobes & shifts between electric cyan-cobalt and crimson-violet during breach surges
    if (state.aftermath) {
      this.monitorLight.color.setHex(0x1358a8);
      this.monitorLight.intensity = 0.42 + Math.sin(elapsed * 2.1) * 0.04;
    } else {
      const flicker =
        state.madness > 0.05
          ? Math.sin(elapsed * 53.0) * 0.65 * state.madness + clickPulse * 3.2
          : Math.sin(elapsed * 3.2) * 0.03;
      const pulseCrimson = state.madness > 0.55 && Math.sin(elapsed * 29.0) > 0.82;
      this.monitorLight.color.setHex(pulseCrimson ? 0x5c38ff : 0x0084ff);
      this.monitorLight.intensity = Math.max(0.45, 2.4 + state.madness * 5.2 + flicker);
      this.monitorLight.distance = 6.5 + state.madness * 6.0;
    }

    this.parasyteGroup.visible = false;
    this.throatTeeth.visible = false;

    // 3D Out-of-Screen Holographic Breach & Zero-G Shattered LCD Glass!
    const showHolo = !state.aftermath && state.madness > 0.22 && state.suctionProgress < 0.55;
    this.holoBreachGroup.visible = showHolo;
    if (showHolo) {
      this.holoCascadeMat.uniforms.uTime.value = elapsed;
      this.holoCascadeMat.uniforms.uMadness.value = state.madness;
      this.holoCascadeMat.uniforms.uClickPulse.value = clickPulse;
      this.holoCascadeMat.uniforms.uSuction.value = state.suctionProgress;

      this.holoRingsMat.uniforms.uTime.value = elapsed;
      this.holoRingsMat.uniforms.uMadness.value = state.madness;
      this.holoRingsMat.uniforms.uClickPulse.value = clickPulse;
      this.holoRingsMat.uniforms.uSuction.value = state.suctionProgress;
    }

    const showGlass = !state.aftermath && state.madness > 0.56 && state.suctionProgress < 0.80;
    this.glassShards.visible = showGlass;
    if (showGlass) {
      const gu = this.glassShardMat.uniforms;
      gu.uTime.value = elapsed;
      gu.uMadness.value = state.madness;
      gu.uJawOpen.value = state.jawOpen;
      gu.uSuction.value = state.suctionProgress;
      gu.uClickPulse.value = clickPulse;
    }

    const showThroat = !state.aftermath && state.suctionProgress > 0.03;
    this.throatGroup.visible = showThroat;
    if (!this.insideTunnelMode) {
      this.stencilMaskMesh.visible = showThroat;
    }

    if (showThroat) {
      const scrollPhase = tunnelScrollPhase ?? elapsed * (6.0 + state.suctionProgress * 42.0);
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
    }
  }
}
