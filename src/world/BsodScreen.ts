import * as THREE from 'three';
import { getSharedNoiseTexture } from '../utils/ProceduralNoise';

/**
 * BSOD_EX — "SIGNAL DEATH" monitor staging.
 *
 * The monitor is a *signal*, not a mouth. Clicking the ':(' face does not open a
 * biological maw — it fails the display's own integrity:
 *
 *   click 1  DESYNC      — the face desynchronises: chromatic ghosts, stuttering rows
 *   click 2  MACROLOSS   — 8x8 macroblocks drop out to hex-grid voids, bands shear
 *   click 3  GLYPH LEAK  — the face escapes its ink well; a ghost copy drifts, data rain
 *   click 4  FRACUTURE   — a jagged data-crack fractures the panel; the far side glows in
 *   click 5  RIFT OPEN   — the crack widens into a glowing aperture; the panel caves in
 *   click 6  INGEST      — the aperture becomes the camera's path: a river of corrupted
 *                          signal (hex columns, tear bands, receding window frames) that
 *                          runs straight into the Glitch World sky.
 *
 * Everything is GPU-driven: stage textures are pre-baked at boot, the face is an analytic
 * SDF channel map, and the whole escalation is a handful of uniforms.
 */

export interface BsodScreenState {
  hoverFace: boolean;
  cursorUv: THREE.Vector2;
  clickCount: number;
  madness: number; // 0..1 continuous escalation
  jawOpen: number; // 0..1 -> here: how far the RIFT aperture has opened
  suctionProgress: number; // 0..1 camera diving through the aperture
  aftermath: boolean;
}

const TUBE_Z_SPAN = 116.0;
const RING_COUNT = 40;
const LINE_COUNT = 180;
const CARD_SHARD_COUNT = 128;
const GLASS_SHARD_COUNT = 64;

/** Deterministic PRNG so every pre-baked stage is identical on every boot. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HEX = '0123456789ABCDEF';

export class BsodScreen {
  public readonly root = new THREE.Group();
  public readonly hitboxMesh: THREE.Mesh;
  public readonly monitorLight: THREE.PointLight;

  public readonly screenMesh: THREE.Mesh;
  public readonly screenMat: THREE.ShaderMaterial;

  private readonly stageTextures: THREE.CanvasTexture[] = [];
  private readonly aftermathTex: THREE.CanvasTexture;
  private readonly cardTex: THREE.CanvasTexture;

  private readonly faceCanvas: HTMLCanvasElement;
  private readonly faceTex: THREE.CanvasTexture;

  private readonly throatGroup = new THREE.Group();
  private readonly throatBackCap: THREE.Mesh;
  private readonly throatTubeMat: THREE.ShaderMaterial;
  private readonly throatRings: THREE.InstancedMesh;
  private readonly throatRingMat: THREE.ShaderMaterial;
  private readonly throatLines: THREE.InstancedMesh;
  private readonly throatLineMat: THREE.ShaderMaterial;
  private readonly throatShards: THREE.InstancedMesh;
  private readonly throatShardMat: THREE.ShaderMaterial;
  private readonly throatMaterials: THREE.Material[] = [];

  // Shattered LCD panel fragments — each shard carries a window of the BSOD image itself.
  private readonly glassShards: THREE.InstancedMesh;
  private readonly glassShardMat: THREE.ShaderMaterial;

  private readonly stencilMaskMesh: THREE.Mesh;

  private lastRenderedStage = -1;
  private lastAftermath = false;
  private insideTunnelMode = false;

  // 0..1: crack shockwave since last click
  private crackRun = 0;
  private readonly impactUv = new THREE.Vector2(0.144, 0.742);

  // Measured ink bounds of ':' and '(' glyphs in 1:1 faceCanvas [0..1] UV space (all strictly finite!)
  private readonly parenC = new THREE.Vector2(0.609, 0.459);
  private readonly parenSize = new THREE.Vector2(0.145, 0.574);
  private readonly colonC = new THREE.Vector2(0.374, 0.424);
  private readonly colonSize = new THREE.Vector2(0.068, 0.320);
  // Half separation between the two ':' dot centres in faceCanvas UV
  public colonDotOff = 0.127;
  // Mean ink X of '(' at bottom / middle / top in faceCanvas UV
  private readonly spine = new THREE.Vector3(0.572, 0.646, 0.572);

  // Screen quad local dimensions matching BSOD_SCREEN_NODE (-0.95283..+0.95283, -0.5..+0.5)
  public static readonly LOCAL_W = 1.90566;
  public static readonly LOCAL_H = 1.0;

  constructor() {
    const noiseTex = getSharedNoiseTexture();

    // 1. Pre-bake all 6 BSOD stages + aftermath onto GPU-ready CanvasTextures ONCE at boot.
    for (let s = 0; s <= 5; s++) {
      this.stageTextures.push(this.bakeStageTexture(s, false));
    }
    this.aftermathTex = this.bakeStageTexture(0, true);

    // 2. SDF Face Channel Map (R = ':' eyes SDF, G = '(' mouth SDF) at crisp 1024x1024.
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

    // 4. Stencil Aperture Mask (keeps the data-river tunnel readable through the panel hole).
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

    // 5. Signal-River Throat: the corrupted signal you fall through (100% GPU-driven!).
    this.root.add(this.throatGroup);
    this.throatGroup.visible = false;

    // Open-fronted tube + far portal cap starting cleanly at z = -0.02 so it never clips the camera.
    const tubeGeo = new THREE.CylinderGeometry(1.42, 5.6, TUBE_Z_SPAN, 24, 20, true);
    tubeGeo.rotateX(Math.PI * 0.5);
    tubeGeo.translate(0, 0, -TUBE_Z_SPAN * 0.5 - 0.02);
    const endDisc = new THREE.CircleGeometry(5.6, 24);
    endDisc.rotateY(Math.PI); // BackSide makes +Z visible when rotated PI!
    endDisc.translate(0, 0, -TUBE_Z_SPAN - 0.02);

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
        void main() {
          vUv = uv;
          vTubePos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
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

        void main() {
          float depthFactor = clamp(-vTubePos.z / 116.0, 0.0, 1.0);
          float angle = atan(vTubePos.y, (abs(vTubePos.x) < 1e-5 ? 1e-5 : vTubePos.x));

          // ---- Corrupted signal river: columns of scrolling hex/BSOD glyph cells
          float colAng = angle * 15.9;               // ~100 columns around the tube
          float cellZ = vTubePos.z * 0.55 + uScrollPhase * 1.15;
          vec2 cell = vec2(colAng, cellZ);
          float cellRnd = hash21(cell);
          float cellFrame = floor(uTime * 10.0);
          float flicker = hash21(cell + vec2(cellFrame, cellFrame * 1.7));

          // Most cells are dim telemetry; a minority light up as data glyphs.
          float glyphGate = step(0.86, cellRnd);
          float glyphOn = step(flicker, 0.72 + 0.2 * uSuction) * glyphGate;
          // A glyph = bright cell with 3 dark horizontal notches (reads as a hex/kanji block)
          vec2 f = fract(cell * vec2(1.0, 1.35));
          float notch = step(0.78, f.y) * step(0.15, f.x) + step(0.45, f.y) * (1.0 - step(0.85, f.y)) * step(0.2, f.x) * (1.0 - step(0.62, f.x));
          float glyph = glyphOn * (1.0 - notch * 0.85);

          vec3 deep = vec3(0.004, 0.065, 0.28);
          vec3 mid = vec3(0.008, 0.14, 0.48);
          vec3 col = mix(deep, mid, smoothstep(0.55, 0.94, depthFactor));

          // Faint base grid (the signal's structure)
          float gx = smoothstep(0.06, 0.0, min(fract(colAng), 1.0 - fract(colAng)));
          float gz = smoothstep(0.05, 0.0, min(fract(cellZ), 1.0 - fract(cellZ)));
          col += vec3(0.02, 0.09, 0.22) * (gx + gz) * 0.55;

          // Lit data cells
          col += vec3(0.16, 0.52, 1.0) * glyph * (0.55 + 0.45 * depthFactor);
          col += vec3(0.55, 0.85, 1.0) * glyph * notch * 0.5;

          // ---- Horizontal TEAR BANDS: whole z-bands flash & RGB-split
          float band = floor(vTubePos.z * 0.35 + uScrollPhase * 0.2);
          float bandRnd = hash11(band * 12.9898 + floor(uTime * 4.0) * 78.233);
          float tear = step(0.985 - 0.02 * uSuction, bandRnd);
          col += vec3(0.0, 0.75, 1.0) * tear * (0.25 + 0.35 * flicker);
          col.r += tear * 0.30 * step(0.5, hash11(band * 3.7));
          col.b += tear * 0.30 * (1.0 - step(0.5, hash11(band * 3.7)));

          // ---- Occasional colossal ':(' glyphs tumbling through the river
          float faceGate = step(0.9965, hash21(vec2(floor(colAng), floor(cellZ * 0.5))));
          vec2 fp = fract(vec2(colAng, cellZ * 0.5)) * 2.0 - 1.0;
          float colonA = exp(-dot(fp - vec2(-0.42, 0.22), fp - vec2(-0.42, 0.22)) * 42.0);
          float colonB = exp(-dot(fp - vec2(-0.42, -0.22), fp - vec2(-0.42, -0.22)) * 42.0);
          float arc = exp(-pow((length(fp - vec2(0.34, 0.0)) - 0.62) * 7.0, 2.0)) * step(0.0, fp.x);
          float faceGlyph = faceGate * (colonA + colonB + arc) * (0.5 + 0.5 * flicker);
          col += vec3(0.75, 0.95, 1.0) * faceGlyph * 0.9;

          // Depth fog toward the far portal
          col = mix(col, deep * 0.55, smoothstep(0.72, 0.985, depthFactor));

          // === FAR-END PORTAL VISTA (matches Glitch World exit conduit palette 1:1 for a 0-cut handoff!) ===
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

    // 5b. Receding Rectangular BSOD Window-Frame Ribs — the classic "frames receding into depth" motif.
    const frameGeo = new THREE.RingGeometry(0.93, 1.0, 4, 1);
    frameGeo.rotateZ(Math.PI * 0.25);
    const ringIdxAttr = new Float32Array(RING_COUNT);
    for (let i = 0; i < RING_COUNT; i++) ringIdxAttr[i] = i / RING_COUNT;
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
        uniform float uSuction;
        uniform float uInside;
        varying float vFrac;
        varying float vPulse;
        void main() {
          float zSpan = 116.0;
          // Frames stream past the camera; the front bound stays behind the panel while outside.
          float maxZ = mix(-0.42, 2.0, uInside);
          float z = -zSpan + mod(aFrac * zSpan + uScrollPhase * (0.9 + fract(aFrac * 7.31) * 0.4), zSpan + maxZ);
          float depthT = clamp(-z / zSpan, 0.0, 1.0);
          float scale = mix(1.42, 5.6, depthT) * 1.06;
          vec3 p = position * scale + vec3(0.0, 0.0, z);
          // Glitch shear: some frames jump sideways for a frame
          float jump = step(0.985, fract(aFrac * 91.7 + floor(uTime * 6.0) * 0.37)) * sin(uTime * 40.0 + aFrac * 20.0) * 0.5;
          p.x += jump * scale * 0.25;
          vFrac = depthT;
          vPulse = 0.5 + 0.5 * sin(uTime * 2.4 + aFrac * 26.0);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vFrac;
        varying float vPulse;
        uniform float uSuction;
        void main() {
          vec3 cyan = vec3(0.30, 0.78, 1.0);
          vec3 white = vec3(0.92, 0.98, 1.0);
          vec3 col = mix(cyan, white, vPulse * 0.6);
          float a = (0.10 + 0.30 * vPulse) * (1.0 - smoothstep(0.86, 1.0, vFrac)) * (0.55 + 0.65 * uSuction);
          gl_FragColor = vec4(col, a);
        }
      `,
    });
    this.throatRings = new THREE.InstancedMesh(frameGeo, this.throatRingMat, RING_COUNT);
    this.throatRings.renderOrder = 4;
    this.throatRings.frustumCulled = false;
    this.throatGroup.add(this.throatRings);
    this.throatMaterials.push(this.throatRingMat);

    // 5c. Tumbling BSOD card fragments (memory pages) drifting down the river.
    const cardCanvas = document.createElement('canvas');
    cardCanvas.width = 256;
    cardCanvas.height = 128;
    const cctx = cardCanvas.getContext('2d')!;
    cctx.fillStyle = 'rgba(0, 84, 168, 0.92)';
    cctx.fillRect(0, 0, 256, 128);
    cctx.strokeStyle = 'rgba(150, 216, 255, 0.9)';
    cctx.lineWidth = 4;
    cctx.strokeRect(4, 4, 248, 120);
    cctx.fillStyle = '#ffffff';
    cctx.font = '22px Consolas, monospace';
    cctx.fillText(':(  0x000000F4', 18, 44);
    cctx.fillStyle = 'rgba(210, 240, 255, 0.75)';
    for (let r = 0; r < 3; r++) {
      cctx.fillRect(18, 62 + r * 18, 120 + ((r * 53) % 90), 8);
    }
    const cardTex = new THREE.CanvasTexture(cardCanvas);
    cardTex.colorSpace = THREE.SRGBColorSpace;
    cardTex.minFilter = THREE.LinearFilter;
    cardTex.magFilter = THREE.LinearFilter;
    cardTex.generateMipmaps = false;
    this.cardTex = cardTex;

    const shardGeo = new THREE.PlaneGeometry(0.55, 0.28);
    const cSeed = new Float32Array(CARD_SHARD_COUNT * 4);
    for (let i = 0; i < CARD_SHARD_COUNT; i++) {
      cSeed[i * 4 + 0] = (i / CARD_SHARD_COUNT) * Math.PI * 2 + Math.random() * 0.6;
      cSeed[i * 4 + 1] = 0.28 + Math.random() * 1.9;
      cSeed[i * 4 + 2] = Math.random();
      cSeed[i * 4 + 3] = 0.55 + Math.random() * 1.35;
    }
    shardGeo.setAttribute('aSeed4', new THREE.InstancedBufferAttribute(cSeed, 4));

    this.throatShardMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
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
          gl_FragColor = vec4(c.rgb, c.a * 0.86 * vFade);
        }
      `,
    });
    this.throatShards = new THREE.InstancedMesh(shardGeo, this.throatShardMat, CARD_SHARD_COUNT);
    this.throatShards.renderOrder = 4;
    this.throatShards.frustumCulled = false;
    this.throatGroup.add(this.throatShards);
    this.throatMaterials.push(this.throatShardMat);

    // 5d. Hyperspace Data-Stream Speed Lines (one additive draw call).
    const lineGeo = new THREE.BoxGeometry(0.02, 0.02, 1.0);
    const lSeed = new Float32Array(LINE_COUNT * 4);
    for (let i = 0; i < LINE_COUNT; i++) {
      lSeed[i * 4 + 0] = (i / LINE_COUNT) * Math.PI * 2 + Math.random() * 0.25;
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
          vec3 col = mix(vec3(0.18, 0.68, 1.0), vec3(0.92, 0.98, 1.0), vBright);
          gl_FragColor = vec4(col, 0.85 * vBright);
        }
      `,
    });
    this.throatLines = new THREE.InstancedMesh(lineGeo, this.throatLineMat, LINE_COUNT);
    this.throatLines.renderOrder = 5;
    this.throatLines.frustumCulled = false;
    this.throatGroup.add(this.throatLines);
    this.throatMaterials.push(this.throatLineMat);

    // 6. Shattered LCD Panel Fragments — each shard is a window of the BSOD image itself.
    //    They burst off the panel the instant the rift goes critical and fade as you dive.
    const glassGeo = new THREE.PlaneGeometry(1, 1);
    const gSeed = new Float32Array(GLASS_SHARD_COUNT * 4);
    for (let i = 0; i < GLASS_SHARD_COUNT; i++) {
      // a: burst angle, b: speed, c: uv window x, d: uv window y (shard keeps a piece of the screen!)
      gSeed[i * 4 + 0] = (i / GLASS_SHARD_COUNT) * Math.PI * 2 + Math.random() * 0.4;
      gSeed[i * 4 + 1] = 0.6 + Math.random() * 1.7;
      gSeed[i * 4 + 2] = 0.08 + Math.random() * 0.78;
      gSeed[i * 4 + 3] = 0.12 + Math.random() * 0.7;
    }
    glassGeo.setAttribute('aSeed4', new THREE.InstancedBufferAttribute(gSeed, 4));

    this.glassShardMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: true,
      side: THREE.DoubleSide,
      uniforms: {
        uBodyTex: { value: this.stageTextures[5] },
        uTime: { value: 0 },
        uSuction: { value: 0 },
      },
      vertexShader: /* glsl */ `
        attribute vec4 aSeed4;
        uniform float uTime;
        uniform float uSuction;
        varying vec2 vUv;
        varying float vGone;
        void main() {
          // Shards are visible only while the suction event plays (uSuction 0..1).
          float life = smoothstep(0.02, 0.09, uSuction) * (1.0 - smoothstep(0.42, 0.75, uSuction));
          vGone = life;
          vUv = uv;
          // Radial burst from the panel centre, outward (+z, toward the player) with spin & drag.
          float t = uSuction;
          float ang = aSeed4.x + sin(t * 3.0 + aSeed4.w * 6.0) * 0.35;
          float speed = aSeed4.y * (2.2 + aSeed4.w * 1.6);
          float r = speed * (t * 1.35 + t * t * 2.6);
          float sz = r * (0.55 + 0.45 * fract(aSeed4.w * 5.1));
          float s = (0.10 + aSeed4.w * 0.16) * (0.6 + t * 0.8);
          float spin = t * (2.0 + aSeed4.w * 3.0) + aSeed4.x * 3.0;
          float cs = cos(spin), sn = sin(spin);
          vec2 p2 = vec2(position.x * cs - position.y * sn, position.x * sn + position.y * cs) * s;
          vec3 world = vec3(cos(ang) * r, sin(ang) * r * 0.82, sz + t * 2.2);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(world.x + p2.x, world.y + p2.y, world.z, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        varying float vGone;
        uniform sampler2D uBodyTex;
        uniform float uTime;
        void main() {
          if (vGone < 0.01) discard;
          // Each shard samples its own window of the BSOD (window encoded in aSeed — approximated via vUv warp)
          vec3 img = texture2D(uBodyTex, vUv * 0.8 + vec2(0.1, 0.1)).rgb;
          vec3 col = img * (0.9 + 0.25 * sin(uTime * 30.0 + vUv.x * 40.0));
          // Bright cracked edge
          float edge = smoothstep(0.42, 0.5, max(abs(vUv.x - 0.5), abs(vUv.y - 0.5)));
          col += vec3(0.55, 0.85, 1.0) * edge * 0.85;
          gl_FragColor = vec4(col, vGone);
        }
      `,
    });
    this.glassShards = new THREE.InstancedMesh(glassGeo, this.glassShardMat, GLASS_SHARD_COUNT);
    this.glassShards.renderOrder = 8;
    this.glassShards.visible = false;
    this.glassShards.frustumCulled = false;
    this.root.add(this.glassShards);

    // 7. The Panel — 112x64 tessellated BSOD LCD surface (SIGNAL DEATH shader).
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
        varying vec3 vWorldPos;
        varying vec3 vWorldNormal;
        varying float vRift;
        varying float vShear;
        uniform float uTime;
        uniform float uMadness;
        uniform float uJawOpen;
        uniform float uSuction;
        uniform float uClickPulse;
        uniform vec2 uImpactUv;

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

        void main() {
          vUv = uv;
          vec3 p = position;
          float aspect = 1.90566;

          // Rift centre: the face position (drifts to panel centre as the signal fails)
          vec2 riftC = mix(vec2(0.144, 0.742), vec2(0.48, 0.48), smoothstep(0.14, 0.88, uMadness));
          vec2 dc = (uv - riftC) * vec2(aspect, 1.0);
          float d = length(dc);

          // Pixelated jagged aperture around the face
          float jag = (hash21(floor(uv * vec2(96.0, 54.0))) - 0.5) * 0.14;
          float riftR = 0.085 + uJawOpen * 0.58 + jag;
          float inRift = (1.0 - smoothstep(riftR - 0.03, riftR + 0.03, d)) * smoothstep(0.02, 0.14, uJawOpen);
          vRift = inRift;

          // --- VHS band shear: corrupted rows jump sideways
          float band = floor(uv.y * 16.0);
          float tick = floor(uTime * (6.0 + uMadness * 10.0));
          float bandRnd = hash21(vec2(band, tick));
          float shearAmp = uMadness * 0.020 + uClickPulse * 0.028;
          float bandGate = step(0.86 - uMadness * 0.30, bandRnd);
          vShear = bandGate * (bandRnd - 0.5) * 2.0 * shearAmp;
          p.x += vShear;

          // --- The rift: halves part, and the panel caves toward the far-side light
          p.x += sign(uv.x - riftC.x) * inRift * uJawOpen * 0.05;
          p.z -= inRift * uJawOpen * 0.30;

          // --- Suction: the whole panel warps into the portal as you dive
          float pull = uSuction * exp(-pow(d / 0.62, 2.0));
          p.z -= pull * 0.55;
          p.x *= 1.0 - pull * 0.22;

          // --- Click ripple (LCD pressure wave from the cursor)
          vec2 ic = (uv - uImpactUv) * vec2(aspect, 1.0);
          float icd = length(ic);
          float ring = (1.0 - uClickPulse) * 0.7;
          float wave = exp(-pow((icd - ring) * 9.0, 2.0)) * uClickPulse;
          p.z += wave * 0.018;

          vWorldPos = (modelMatrix * vec4(p, 1.0)).xyz;
          vWorldNormal = normalize(mat3(modelMatrix) * vec3(0.0, 0.0, 1.0));
          gl_Position = projectionMatrix * viewMatrix * vec4(vWorldPos, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vWorldPos;
        varying vec3 vWorldNormal;
        varying float vRift;
        varying float vShear;
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

        float faceInkAt(vec2 puv) {
          if (puv.x < 0.015 || puv.x > 0.985 || puv.y < 0.015 || puv.y > 0.985) return 0.0;
          vec4 f = texture2D(uFaceTex, puv);
          float val = max(f.r, f.g);
          return smoothstep(0.508, 0.492, val);
        }

        void main() {
          vec2 uv = vUv;
          float aspect = 1.90566;
          vec2 riftC = mix(vec2(0.144, 0.742), vec2(0.48, 0.48), smoothstep(0.14, 0.88, uMadness));
          vec2 dc = (uv - riftC) * vec2(aspect, 1.0);
          float d = length(dc);

          // ============================================================ 1. THE HOLE
          // As the dive starts, the panel opens into the river. Jagged edge, full coverage
          // before the camera crosses the plane.
          float holeOpen = smoothstep(0.02, 0.14, uSuction);
          if (uAftermath < 0.5 && holeOpen > 0.004) {
            float jag = (hash21(floor(uv * vec2(96.0, 54.0))) - 0.5) * 0.14;
            float holeR = 0.085 + uJawOpen * 0.58 + jag + holeOpen * 1.30;
            if (d < holeR) discard;
          }

          // ============================================================ 2. BODY SIGNAL
          vec2 bodyUv = clamp(uv + vec2(vShear, 0.0), 0.001, 0.999);
          float chr = uMadness * 0.0035 + uClickPulse * 0.008 + vRift * 0.004;
          vec3 panel;
          panel.r = texture2D(uBodyTex, clamp(bodyUv + vec2(chr, 0.0), 0.001, 0.999)).r;
          panel.g = texture2D(uBodyTex, bodyUv).g;
          panel.b = texture2D(uBodyTex, clamp(bodyUv - vec2(chr, 0.0), 0.001, 0.999)).b;
          vec3 col = panel;

          if (uAftermath >= 0.5) {
            // Aftermath: quiet, dark, scarred. The panel is done performing.
            vec2 px = uv * vec2(1920.0, 1080.0);
            float scan = 0.985 + 0.015 * sin(px.y * 3.14159);
            col *= scan;
            vec2 vigUv = uv * (1.0 - uv.yx);
            float vig = pow(clamp(vigUv.x * vigUv.y * 18.0, 0.0, 1.0), 0.16);
            col *= mix(0.74, 0.99, vig);
            gl_FragColor = vec4(clamp(col, 0.0, 2.0), 1.0);
            return;
          }

          // ============================================================ 3. PIXEL-SORT STREAKS
          float row = floor(uv.y * 48.0);
          float frame = floor(uTime * 12.0);
          float rowFault = step(1.0 - uMadness * 0.55 - uClickPulse * 0.30, hash21(vec2(row, frame)));
          vec2 streakDir = vec2(hash21(vec2(row, frame + 3.0)) > 0.5 ? 1.0 : -1.0, 0.0);
          vec3 smear = vec3(0.0);
          float wSum = 0.0;
          for (int k = 0; k < 5; k++) {
            float w = pow(0.72, float(k));
            smear += texture2D(uBodyTex, clamp(bodyUv + streakDir * (float(k) + 1.0) * 0.011, 0.001, 0.999)).rgb * w;
            wSum += w;
          }
          col = mix(col, smear / wSum, rowFault * (0.40 + 0.45 * uMadness));

          // ============================================================ 4. MACROBLOCK LOSS
          vec2 block = floor(uv * vec2(32.0, 16.0));
          float bFrame = floor(uTime * 5.0);
          float bRnd = hash21(block + vec2(bFrame, bFrame * 2.3));
          float dead = step(1.0 - uMadness * 0.60 - uClickPulse * 0.22, bRnd) * step(0.03, uMadness + uClickPulse);
          vec2 bp = fract(uv * vec2(32.0, 16.0));
          float hexline = step(0.88, bp.x) + step(0.88, bp.y);
          float hexcell = step(0.78, hash21(floor(bp * 6.0) + block * 3.1));
          vec3 deadCol = vec3(0.002, 0.014, 0.05)
                       + vec3(0.10, 0.34, 0.70) * hexline * 0.30
                       + vec3(0.20, 0.60, 1.00) * hexcell * 0.16;
          col = mix(col, deadCol, dead);

          // ============================================================ 5. DATA RAIN (falling glyph columns)
          float colIdx = floor(uv.x * 40.0);
          float rainGate = step(1.0 - uMadness * 0.34, hash11(colIdx * 7.77)) * step(0.22, uMadness);
          float rainSpeed = 2.0 + hash11(colIdx * 3.3) * 3.0;
          float rc = uv.y * 26.0 + uTime * rainSpeed;
          float cellHead = fract(rc);
          float cellRnd = hash21(vec2(colIdx, floor(rc)));
          float rain = rainGate * step(0.62, cellRnd) * (0.30 + 0.70 * cellHead);
          col += vec3(0.14, 0.52, 1.0) * rain * 0.55;

          // ============================================================ 6. THE FACE (live SDF signal face)
          // From stage 1 the baked face is masked out and the face is rendered live:
          // drifting ghost copies, tracking colon dots, and finally the rift.
          float liveFace = smoothstep(0.03, 0.12, uMadness);
          vec2 faceC = riftC;
          float faceScale = max(mix(0.35, 0.84, smoothstep(0.12, 0.90, uMadness)), 0.08);
          vec2 fLocal = (uv - faceC) * vec2(aspect, 1.0) / faceScale;

          // Mask the static baked face under the live one
          float bakedMask = exp(-pow(length(fLocal) * 1.30, 2.0));
          col = mix(col, vec3(0.0, 0.4706, 0.8392) * 0.40, bakedMask * liveFace * 0.9);

          // The face escapes its ink well: slow drift + click tremor
          float ft = floor(uTime * 24.0);
          vec2 tremor = vec2(hash21(vec2(ft, 1.7)) - 0.5, hash21(vec2(ft, 9.3)) - 0.5) * 0.02 * uClickPulse;
          vec2 drift = vec2(
            sin(uTime * 0.90) * 0.5 + sin(uTime * 0.53 + 1.7) * 0.5,
            cos(uTime * 0.77 + 0.4) * 0.4 + cos(uTime * 0.41 + 2.1) * 0.3
          ) * uMadness * 0.05 + tremor;

          // Colon dots track the cursor slightly (it notices you)
          vec2 cursorPull = clamp((uCursorUv - faceC) * vec2(aspect, 1.0), vec2(-0.30, -0.30), vec2(0.30, 0.30)) * 0.045 * (uHover * 0.5 + uMadness);

          float sep = uMadness * 0.030 + uClickPulse * 0.055;
          vec2 puvMain = vec2(0.5) + fLocal + drift;
          vec2 puvCy = vec2(0.5) + fLocal + drift + vec2(sep, 0.0);
          vec2 puvMg = vec2(0.5) + fLocal + drift - vec2(sep, 0.0);
          // Ghost copy: an echo at a fixed offset that grows with madness
          float ghostW = smoothstep(0.20, 0.55, uMadness);
          vec2 puvGhost = vec2(0.5) + fLocal + vec2((hash11(colIdx) - 0.5) * 0.16 * uMadness, -0.10 * uMadness) + vec2(0.0, -0.02);

          float inkMain = faceInkAt(puvMain);
          float inkCy = faceInkAt(puvCy) * smoothstep(0.06, 0.30, uMadness + uClickPulse);
          float inkMg = faceInkAt(puvMg) * smoothstep(0.06, 0.30, uMadness + uClickPulse);
          float inkGhost = faceInkAt(puvGhost) * ghostW;

          // The face is white signal; ghosts are cyan/magenta; the echo is dim blue
          col = mix(col, vec3(0.10, 0.85, 1.0), inkGhost * 0.55);
          col = mix(col, vec3(0.85, 0.25, 0.45), inkMg * 0.62);
          col = mix(col, vec3(0.30, 0.95, 1.0), inkCy * 0.62);
          col = mix(col, vec3(1.0), inkMain);

          // Hover glow: a soft halo around the face while the cursor is on it
          float halo = exp(-pow(length(fLocal) * 1.15, 2.0)) * uHover * 0.35;
          col += vec3(0.20, 0.65, 1.0) * halo;

          // ============================================================ 7. THE RIFT (data-crack -> glowing aperture)
          if (uJawOpen > 0.004) {
            float riftEdge = smoothstep(0.10, 0.0, abs(d - (0.085 + uJawOpen * 0.58)));
            // Jagged crack core (sharp while the aperture is small, pixelated rim while wide)
            float crackCore = smoothstep(0.05, 0.0, d - (0.085 + uJawOpen * 0.58) * 0.82);
            float jagPulse = 0.75 + 0.25 * sin(uTime * 26.0 + d * 40.0);

            // Dark void + blinding far-side light
            float voidDepth = smoothstep((0.085 + uJawOpen * 0.58) + 0.06, 0.0, d);
            col = mix(col, vec3(0.001, 0.008, 0.03), voidDepth * 0.92);
            vec3 riftLight = mix(vec3(0.25, 0.72, 1.0), vec3(0.92, 0.99, 1.0), uJawOpen);
            float coreGlow = crackCore * jagPulse * (0.5 + 1.3 * uJawOpen);
            col += riftLight * coreGlow;
            col += riftLight * riftEdge * (0.35 + 0.75 * uJawOpen) * 0.8;

            // Data streaks falling INTO the aperture (pixels being swallowed)
            float ang = atan(dc.y, (abs(dc.x) < 1e-5 ? 1e-5 : dc.x));
            float fall = fract(uTime * (1.5 + uJawOpen * 2.0) + ang * 0.16);
            float streak = pow(fall, 3.0) * smoothstep(0.55, 0.10, d) * (1.0 - smoothstep(0.02, 0.12, d));
            col += vec3(0.45, 0.85, 1.0) * streak * uJawOpen * 0.8;

            // Click shockwave ring across the panel
            vec2 icd2 = (uv - uImpactUv) * vec2(aspect, 1.0);
            float icd2l = length(icd2);
            float shockR = (1.0 - uCrackRun) * 1.1;
            float shock = exp(-pow((icd2l - shockR) * 14.0, 2.0)) * uCrackRun * (1.0 - uCrackRun) * 4.0;
            col += vec3(0.5, 0.85, 1.0) * shock * 0.5;
          }

          // Rift-adjacent stress: the panel darkens & shifts hue toward the aperture
          col = mix(col, col * vec3(0.72, 0.86, 1.18), vRift * 0.8);

          // ============================================================ 8. GLASS, SCANLINES, VIGNETTE
          float glassSheen = pow(max(0.0, 1.0 - length((uv - vec2(0.74, 0.68)) * vec2(1.2, 1.0))), 3.0) * 0.030;
          col += vec3(0.45, 0.65, 0.95) * glassSheen * (1.0 - uMadness * 0.6);

          // IPS off-axis contrast shift
          vec3 viewDirW = normalize(cameraPosition - vWorldPos);
          float ndvScreen = clamp(abs(dot(normalize(vWorldNormal), viewDirW)), 0.0, 1.0);
          float offAxis = smoothstep(0.68, 0.18, ndvScreen);
          if (offAxis > 0.01) {
            col = col * mix(1.0, 0.86, offAxis) + vec3(0.05, 0.16, 0.34) * offAxis * 0.28;
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

    // 8. Cerulean Monitor PointLight illuminating the desk, keyboard, chair, and bedroom!
    this.monitorLight = new THREE.PointLight(0x1b8cff, 2.35, 6.5, 1.6);
    this.monitorLight.position.set(0, 0.04, 0.26);
    this.root.add(this.monitorLight);
  }

  private renderFaceChannelTexture(): void {
    const ctx = this.faceCanvas.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const W = 1024;
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
    // R = ':' SDF (0.5 = glyph edge), G = '(' SDF, B = 0 (strict invariant!), A = 255
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

      // Exact Segoe UI Semilight '(' circular-arc spine
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
        }
      }
    }
    if (rx1 > rx0 && ry1 > ry0) {
      this.colonC.set((rx0 + rx1) * 0.5 / size, (ry0 + ry1) * 0.5 / size);
      this.colonSize.set(Math.max(1e-3, (rx1 - rx0) / size), Math.max(1e-3, (ry1 - ry0) / size));
    }
    if (gx1 > gx0 && gy1 > gy0) {
      this.parenC.set((gx0 + gx1) * 0.5 / size, (gy0 + gy1) * 0.5 / size);
      this.parenSize.set(Math.max(1e-3, (gx1 - gx0) / size), Math.max(1e-3, (gy1 - gy0) / size));
    }
    // Half-separation between the two ':' dot centres (canvas uv, y-down)
    const dotTopY = 458.0;
    const dotBotY = 722.0;
    this.colonDotOff = (dotBotY - dotTopY) * 0.5 / size;
  }

  /** Returns all pre-baked textures so WebGLRenderer can upload them upfront during loading! */
  public getAllTextures(): THREE.Texture[] {
    return [...this.stageTextures, this.aftermathTex, this.faceTex, this.cardTex];
  }

  /** Enables all sub-groups for 1 offscreen warmup frame so every VAO & shader compiles at boot! */
  public setWarmupVisibility(active: boolean): void {
    this.throatGroup.visible = active;
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
    // NEVER set mat.needsUpdate here or Three.js synchronously recompiles shaders mid-cutscene!
    for (const mat of this.throatMaterials) {
      mat.stencilWrite = !inside;
    }
    this.throatTubeMat.depthFunc = inside ? THREE.LessEqualDepth : THREE.AlwaysDepth;
    this.throatRingMat.uniforms.uInside.value = inside ? 1.0 : 0.0;
    this.throatLineMat.uniforms.uInside.value = inside ? 1.0 : 0.0;
    this.stencilMaskMesh.visible = !inside && this.throatGroup.visible;
  }

  /** Start a crack shockwave from the click point. */
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

    // Glass shard burst: live only while the rift goes critical and the dive starts.
    const showGlass = !state.aftermath && state.suctionProgress > 0.02 && state.suctionProgress < 0.8;
    this.glassShards.visible = showGlass;
    if (showGlass) {
      const gu = this.glassShardMat.uniforms;
      gu.uTime.value = elapsed;
      gu.uSuction.value = state.suctionProgress;
    }

    const showThroat = !state.aftermath && state.suctionProgress > 0.03;
    this.throatGroup.visible = showThroat;
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
    }
  }

  /**
   * Pre-bakes one BSOD stage onto a 2048x1074 canvas. Stage 0 is a pristine Windows 11
   * Japanese BSOD; stages 1-5 degrade the *signal* (deterministic per stage):
   * ghost duplication, hex bleed, band shear, macroblock voids, glyph rain, data-crack,
   * and finally the dark rift aperture with its bright rim.
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

    const rng = mulberry32(0x0247 + stage * 0x9e37);

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

    // ---- Base: authentic Windows 11 Japanese BSOD
    const baseBlue = stage >= 5 ? '#005bb5' : stage >= 4 ? '#0069c8' : '#0078d7';
    ctx.fillStyle = baseBlue;
    ctx.fillRect(0, 0, W, H);

    const leftX = 232;
    const fontStack = '"Segoe UI", "Yu Gothic UI", "Meiryo", sans-serif';

    const lines = [
      ['問題が発生したため、PC を再起動する必要があります。', 492],
      [stage >= 3 ? 'エラー情報を収集しています。表示バッファを切り離しています。' : 'エラー情報を収集しています。自動的に再起動します。', 558],
      [stage >= 5 ? '転送 99% — 中断できません' : stage >= 4 ? '転送 99%（応答なし）' : '99% 完了', 668],
    ] as Array<[string, number]>;

    ctx.textBaseline = 'alphabetic';
    ctx.font = `300 47px ${fontStack}`;

    // Ghost duplication pass first (stage 1+): cyan/red offset copies = signal desync
    if (stage >= 1) {
      const ghostAmp = 2.5 + stage * 2.0;
      ctx.fillStyle = 'rgba(0, 230, 255, 0.30)';
      for (const [text, y] of lines) ctx.fillText(text, leftX - ghostAmp, y + 1);
      ctx.fillStyle = 'rgba(255, 60, 120, 0.30)';
      for (const [text, y] of lines) ctx.fillText(text, leftX + ghostAmp, y - 1);
    }
    ctx.fillStyle = '#ffffff';
    for (const [text, y] of lines) ctx.fillText(text, leftX, y);

    // Hex-bleed rows: a few lines of the page are replaced by raw telemetry (stage 1+)
    if (stage >= 1) {
      ctx.save();
      ctx.font = '24px Consolas, monospace';
      const bleedCount = stage * 3 + 2;
      for (let b = 0; b < bleedCount; b++) {
        const by = 120 + Math.floor(rng() * 8) * 118 + 40;
        let hexline = '';
        for (let hx = 0; hx < 66; hx++) hexline += HEX[Math.floor(rng() * 16)];
        ctx.fillStyle = `rgba(190, 230, 255, ${0.16 + stage * 0.05})`;
        ctx.fillText(hexline, leftX + Math.floor(rng() * 30), by);
      }
      ctx.restore();
    }

    // Band shear: whole horizontal bands of the page shift sideways (stage 2+)
    if (stage >= 2) {
      ctx.save();
      const bands = 1 + Math.floor(stage / 2);
      for (let b = 0; b < bands; b++) {
        const by = Math.floor(rng() * 0.85 * H);
        const bh = 18 + Math.floor(rng() * 40);
        const dx = (Math.floor(rng() * 40) - 20) * (1 + stage * 0.4);
        ctx.fillStyle = baseBlue;
        ctx.fillRect(0, by, W, bh);
        // Re-draw a slice of hex/telemetry into the shifted band
        ctx.fillStyle = `rgba(210, 240, 255, ${0.25 + stage * 0.06})`;
        ctx.font = '20px Consolas, monospace';
        let hexline = '';
        for (let hx = 0; hx < 120; hx++) hexline += HEX[Math.floor(rng() * 16)];
        ctx.fillText(hexline, dx + leftX * 0.2, by + bh * 0.7);
      }
      ctx.restore();
    }

    // Macroblock voids: 8x8 macroblocks drop to hex-grid darkness (stage 2+)
    if (stage >= 2) {
      const bw = 64;
      const bh = 34;
      const voidCount = stage * 5 + 4;
      for (let v = 0; v < voidCount; v++) {
        const vx = Math.floor(rng() * (W / bw)) * bw;
        const vy = Math.floor(rng() * (H / bh)) * bh;
        ctx.fillStyle = 'rgba(1, 8, 24, 0.94)';
        ctx.fillRect(vx, vy, bw, bh);
        ctx.strokeStyle = 'rgba(40, 110, 200, 0.35)';
        ctx.lineWidth = 1;
        ctx.strokeRect(vx + 0.5, vy + 0.5, bw - 1, bh - 1);
        ctx.fillStyle = 'rgba(90, 170, 255, 0.30)';
        for (let c = 0; c < 6; c++) {
          ctx.fillRect(vx + 4 + Math.floor(rng() * (bw - 10)), vy + 4 + Math.floor(rng() * (bh - 10)), 5, 3);
        }
      }
    }

    // Data rain: falling glyph columns (stage 3+)
    if (stage >= 3) {
      ctx.save();
      const cols = 10 + stage * 6;
      for (let c = 0; c < cols; c++) {
        const cx = Math.floor(rng() * W);
        const headY = Math.floor(rng() * H);
        const len = 60 + Math.floor(rng() * 160);
        for (let gy = 0; gy < len; gy += 16) {
          const a = 0.05 + 0.30 * (1 - gy / len);
          ctx.fillStyle = `rgba(120, 200, 255, ${a})`;
          const ch = HEX[Math.floor(rng() * 16)];
          ctx.font = '15px Consolas, monospace';
          ctx.fillText(ch, cx, headY + gy);
        }
      }
      ctx.restore();
    }

    // The face's ink well goes dark (stage 3+): the live SDF face takes over from here.
    // (The shader masks this region; baking it dark keeps mip levels consistent.)
    if (stage >= 3) {
      const faceCx = 0.144 * W;
      const faceCy = (1 - 0.742) * H;
      const grd = ctx.createRadialGradient(faceCx, faceCy, 10, faceCx, faceCy, 300);
      grd.addColorStop(0, 'rgba(2, 20, 52, 0.95)');
      grd.addColorStop(1, 'rgba(2, 20, 52, 0)');
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(faceCx, faceCy, 300, 0, Math.PI * 2);
      ctx.fill();
    }

    // Data-crack: jagged fracture from the impact point toward the face (stage 4+)
    if (stage >= 4) {
      const ix = 0.144 * W;
      const iy = (1 - 0.742) * H;
      const fx = 0.48 * W;
      const fy = (1 - 0.48) * H;
      const segs = 26;
      ctx.save();
      for (let pass = 0; pass < 2; pass++) {
        ctx.beginPath();
        for (let s = 0; s <= segs; s++) {
          const t = s / segs;
          const jx = (rng() - 0.5) * 46 * (1 - Math.abs(t - 0.5) * 1.4);
          const jy = (rng() - 0.5) * 46 * (1 - Math.abs(t - 0.5) * 1.4);
          const px = ix + (fx - ix) * t + jx;
          const py = iy + (fy - iy) * t + jy;
          if (s === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        if (pass === 0) {
          ctx.strokeStyle = 'rgba(0, 4, 14, 0.98)';
          ctx.lineWidth = 14 + stage * 6;
          ctx.stroke();
        } else {
          ctx.strokeStyle = 'rgba(150, 220, 255, 0.85)';
          ctx.lineWidth = 3;
          ctx.stroke();
        }
      }
      // Branch fractures
      for (let b = 0; b < 7; b++) {
        const t = rng();
        const bx = ix + (fx - ix) * t + (rng() - 0.5) * 40;
        const by = iy + (fy - iy) * t + (rng() - 0.5) * 40;
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(bx + (rng() - 0.5) * 220, by + (rng() - 0.5) * 160);
        ctx.strokeStyle = 'rgba(0, 4, 14, 0.9)';
        ctx.lineWidth = 5 + rng() * 7;
        ctx.stroke();
      }
      ctx.restore();
    }

    // The RIFT: dark jagged aperture at panel centre with a blazing rim (stage 5)
    if (stage >= 5) {
      const fx = 0.48 * W;
      const fy = (1 - 0.48) * H;
      const R = 330;
      ctx.save();
      ctx.beginPath();
      const pts = 64;
      for (let p = 0; p <= pts; p++) {
        const a = (p / pts) * Math.PI * 2;
        const r = R * (0.82 + 0.34 * (rng() - 0.5));
        const px = fx + Math.cos(a) * r * 1.15;
        const py = fy + Math.sin(a) * r * 0.92;
        if (p === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = 'rgba(0, 5, 18, 0.99)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(160, 225, 255, 0.95)';
      ctx.lineWidth = 5;
      ctx.stroke();
      // Inner glow ring
      const g = ctx.createRadialGradient(fx, fy, R * 0.55, fx, fy, R * 1.25);
      g.addColorStop(0, 'rgba(120, 200, 255, 0)');
      g.addColorStop(0.72, 'rgba(120, 200, 255, 0.28)');
      g.addColorStop(1, 'rgba(120, 200, 255, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(fx, fy, R * 1.3, 0, Math.PI * 2);
      ctx.fill();
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
        : '表示バッファの転送先アドレス: dump://0x0078d7/display — 切断は許可されていません',
      infoX,
      qrY + 38
    );

    ctx.font = `300 22px ${fontStack}`;
    ctx.fillText(
      stage < 2
        ? 'サポート担当者に連絡する場合は、次の情報を伝えてください:'
        : '停止コードは次の値にバインドされました:',
      infoX,
      qrY + 108
    );

    const stopCodes = [
      'CRITICAL_PROCESS_DIED',
      'CRITICAL_PROCESS_DIED',
      'DISPLAY_GLYPH_DESYNC',
      'MACROBLOCK_MEMORY_LOST',
      'GHOST_GLYPH_ESCAPED',
      'RIFT_COMMITTED',
    ];
    ctx.fillText(`停止コード: ${stopCodes[Math.min(stage, stopCodes.length - 1)]}`, infoX, qrY + 148);

    return finalizeTex();
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
            cell - 0.5,
            cell - 0.5
          );
        }
      }
    }
  }
}
