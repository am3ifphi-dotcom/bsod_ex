import * as THREE from 'three';

export interface BsodScreenState {
  hoverFace: boolean;
  cursorUv: THREE.Vector2;
  clickCount: number;
  madness: number; // 0..1 continuous escalation
  jawOpen: number; // 0..1 opening of the ':(' fissure into 3D throat
  suctionProgress: number; // 0..1 camera diving through the throat
  aftermath: boolean;
}

const THROAT_RING_COUNT = 38;
const THROAT_SHARD_COUNT = 140;
const GLASS_SHARD_COUNT = 44;

export class BsodScreen {
  public readonly root = new THREE.Group();
  public readonly hitboxMesh: THREE.Mesh;
  public readonly monitorLight: THREE.PointLight;

  private readonly bodyCanvas: HTMLCanvasElement;
  private readonly bodyCtx: CanvasRenderingContext2D;
  private readonly bodyTex: THREE.CanvasTexture;

  private readonly faceCanvas: HTMLCanvasElement;
  private readonly faceTex: THREE.CanvasTexture;

  private readonly screenMesh: THREE.Mesh;
  private readonly screenMat: THREE.ShaderMaterial;

  // Zero-Gravity 3D Shattered LCD Glass Shards peeling & floating out of the fracturing ':(' void!
  private readonly glassShards: THREE.InstancedMesh;
  private readonly glassShardMat: THREE.ShaderMaterial;

  private readonly stencilMaskMesh: THREE.Mesh;
  private readonly throatGroup = new THREE.Group();
  private readonly throatBackCap: THREE.Mesh;
  private readonly throatTubeMat: THREE.ShaderMaterial;
  private readonly throatRings: THREE.InstancedMesh;
  private readonly throatRingMat: THREE.MeshBasicMaterial;
  private readonly throatShards: THREE.InstancedMesh;
  private readonly throatLines: THREE.InstancedMesh;
  private readonly throatMaterials: THREE.Material[] = [];

  private readonly ringDummy = new THREE.Object3D();
  private readonly lineData: Array<{
    angle: number;
    radius: number;
    z: number;
    speed: number;
    len: number;
  }> = [];
  private readonly shardData: Array<{
    angle: number;
    radius: number;
    z: number;
    speed: number;
    rotSpeed: THREE.Vector3;
    scale: THREE.Vector3;
  }> = [];

  private lastRenderedStage = -1;
  private lastAftermath = false;

  // 0..1: how far the hairline crack has run along the printed '(' stroke since the last click.
  // The crack propagates outward from the middle of the stroke instead of appearing whole, which
  // is what makes the first tap feel like the screen reacting rather than a sticker being applied.
  private crackRun = 0;

  // Measured ink bounds of the ':' and '(' glyphs inside the face channel texture. The shader
  // places the eyes, pupils and the mouth aperture from these numbers, so the animated face can
  // never drift away from the glyphs it is supposed to be growing out of — even when the player's
  // machine has no Segoe UI and the fallback font has different kerning.
  private readonly parenC = new THREE.Vector2(0.47, 0.52);
  private readonly parenSize = new THREE.Vector2(0.11, 0.42);
  private readonly colonC = new THREE.Vector2(0.38, 0.52);
  private readonly colonSize = new THREE.Vector2(0.09, 0.30);
  // Half the distance between the two ':' dot centres, in texture uv. eyeOff must use THIS, not
  // the colon's ink height — the ink height spans both dots plus the gap between them, so using it
  // would spread the eyes roughly twice as far apart as the printed glyph actually is.
  private readonly colonDotOff = new THREE.Vector2(0.11, 0.11);
  // Mean ink x of the '(' at three heights (bottom / middle / top, in texture uv). The mouth tear
  // starts by splitting along this spine, so the first crack follows the stroke instead of
  // cutting across empty blue.
  private readonly spine = new THREE.Vector3(0.5, 0.5, 0.5);

  // Screen quad local dimensions matching BSOD_SCREEN_NODE (-0.95283..+0.95283, -0.5..+0.5)
  public static readonly LOCAL_W = 1.90566;
  public static readonly LOCAL_H = 1.0;

  constructor() {
    // 1. Body Canvas (1024 x 537 crisp Windows 10/11 BSOD — 4x faster GPU upload with zero hitch!)
    this.bodyCanvas = document.createElement('canvas');
    this.bodyCanvas.width = 1024;
    this.bodyCanvas.height = 537;
    this.bodyCtx = this.bodyCanvas.getContext('2d')!;
    this.bodyTex = new THREE.CanvasTexture(this.bodyCanvas);
    this.bodyTex.colorSpace = THREE.SRGBColorSpace;
    this.bodyTex.minFilter = THREE.LinearFilter;
    this.bodyTex.magFilter = THREE.LinearFilter;
    this.bodyTex.generateMipmaps = false;

    // 2. Separate Face Channel Map (R = ':' eyes, G = '(' mouth stroke)
    this.faceCanvas = document.createElement('canvas');
    this.faceCanvas.width = 512;
    this.faceCanvas.height = 512;
    this.renderFaceChannelTexture();
    this.faceTex = new THREE.CanvasTexture(this.faceCanvas);
    this.faceTex.minFilter = THREE.LinearFilter;
    this.faceTex.magFilter = THREE.LinearFilter;
    this.faceTex.generateMipmaps = false;

    this.drawBsodStage(0, false);

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

    // 5. Non-Euclidean 3D Abyssal Monitor Throat Tunnel (extends -Z behind monitor screen!)
    this.root.add(this.throatGroup);
    this.throatGroup.visible = false;

    // Depth-resetting abyssal dome inside stencil=1 (116 local units = ~40m world depth for full 6.85s suction flight!)
    const capGeo = new THREE.CylinderGeometry(1.4, 5.8, 116, 20, 18, false);
    capGeo.rotateX(Math.PI * 0.5);
    capGeo.translate(0, 0, -57.5);
    this.throatTubeMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthFunc: THREE.AlwaysDepth,
      depthWrite: true,
      stencilWrite: true,
      stencilRef: 1,
      stencilFunc: THREE.EqualStencilFunc,
      uniforms: {
        uTime: { value: 0 },
        uMadness: { value: 0 },
        uSuction: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vLocalPos;
        uniform float uTime;
        uniform float uMadness;
        void main() {
          vUv = uv;
          vec3 p = position;
          float twist = p.z * 0.045 * (0.4 + uMadness) + uTime * 1.4;
          p.x += sin(twist) * 0.35 * smoothstep(-1.0, -25.0, p.z);
          p.y += cos(twist * 0.9) * 0.28 * smoothstep(-1.0, -25.0, p.z);
          vLocalPos = p;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vLocalPos;
        uniform float uTime;
        uniform float uMadness;
        uniform float uSuction;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
        }

        void main() {
          float depthFactor = clamp(-vLocalPos.z / 112.0, 0.0, 1.0);
          float speed = 5.5 + uSuction * 38.0;
          float zScroll = vLocalPos.z * 0.68 + uTime * speed;

          // Scrolling BSOD architectural grid + helical neural-kernel veins inside the throat
          float angle = atan(vLocalPos.y, vLocalPos.x);
          vec2 cell = vec2(angle * 6.366, zScroll);
          vec2 f = fract(cell);
          vec2 cid = floor(cell);

          float line = smoothstep(0.075, 0.0, min(f.x, 1.0 - f.x)) + smoothstep(0.06, 0.0, min(f.y, 1.0 - f.y));
          float helixA = pow(max(0.0, sin(angle * 6.0 + vLocalPos.z * 0.22 + uTime * (4.0 + uSuction * 12.0))), 8.0);
          float helixB = pow(max(0.0, cos(angle * 10.0 - vLocalPos.z * 0.16 + uTime * (3.0 + uSuction * 9.0))), 10.0);
          float streak = smoothstep(0.90, 1.0, sin(angle * 28.0 + sin(vLocalPos.z * 0.12) * 1.8)) *
                         (0.45 + 0.55 * fract(vLocalPos.z * 0.22 + uTime * (3.5 + uSuction * 11.0)));
          float shockRing = smoothstep(0.93, 1.0, fract(vLocalPos.z * 0.09 + uTime * (1.8 + uSuction * 4.5)));
          float rnd = hash(cid + floor(uTime * 12.0) * 0.13);
          float dataPulse = step(0.83, rnd) * (0.4 + 0.6 * sin(uTime * 20.0 + rnd * 30.0));

          vec3 deepVoid = vec3(0.002, 0.001, 0.008);
          vec3 bsodBlue = vec3(0.0, 0.175, 0.64);
          vec3 coreGlow = vec3(0.86, 0.96, 1.0);

          // Biomechanical / Eldritch horror veins & staring eyes embedded in the throat walls!
          float pulseBeat = pow(0.5 + 0.5 * sin(uTime * 12.5 + vLocalPos.z * 0.15), 4.0);
          float vein = pow(max(0.0, sin(angle * 7.0 + sin(vLocalPos.z * 0.35 + uTime * 3.2) * 2.5)), 10.0);
          float ribFold = pow(0.5 + 0.5 * sin(vLocalPos.z * 1.35 + sin(angle * 5.0) * 0.55), 3.0);
          vec2 eyeCell = fract(vec2(angle * 4.45, vLocalPos.z * 0.22 + uTime * 1.4)) - 0.5;
          float sclera = smoothstep(0.14, 0.055, length(eyeCell * vec2(1.0, 1.85))) * step(0.66, rnd);
          float pupil = smoothstep(0.048, 0.018, length((eyeCell + vec2(0.02 * sin(uTime * 19.0), 0.0)) * vec2(1.0, 1.5))) * sclera;

          // CRITICAL HORROR CONTRAST: While sitting at the desk (uSuction ~ 0), peering into the unhinged mouth
          // reveals a PITCH-BLACK / ARTERIAL-CRIMSON ABYSSAL GULLET full of staring eyes!
          // As you get violently sucked down (uSuction -> 1), it blazes into hyperspace BSOD blue & sky-rift light!
          float tunnelIgnite = smoothstep(0.08, 0.58, uSuction);
          // The throat is BSOD blue from the very first frame. Suction only drives how far it burns
          // toward white-hot core light. Gating the blue behind tunnelIgnite left the whole tunnel
          // reading as a black rectangle during the approach — the opposite of a BSOD you are being
          // pulled into — so the base tint is now always present and the ignition only adds to it.
          vec3 col = mix(bsodBlue * vec3(0.26, 0.36, 0.68), bsodBlue, smoothstep(0.18, 0.88, depthFactor));
          col = mix(col, vec3(0.74, 0.91, 1.0), tunnelIgnite * smoothstep(0.25, 0.95, depthFactor) * 0.90);
          float horrorZone = smoothstep(0.95, 0.08, depthFactor);
          col += vec3(0.18, 0.005, 0.025) * ribFold * horrorZone * (1.0 - tunnelIgnite * 0.55);
          col += vec3(0.72, 0.02, 0.09) * vein * (0.45 + 0.55 * pulseBeat) * horrorZone;
          col += vec3(0.96, 0.90, 0.92) * sclera * horrorZone * 0.95;
          col = mix(col, vec3(0.95, 0.02, 0.06), pupil * horrorZone);

          col += vec3(0.32, 0.76, 1.0) * line * (0.06 + tunnelIgnite * 0.48);
          col += vec3(0.25, 0.82, 1.0) * (helixA * 0.55 + helixB * 0.45) * (0.08 + uSuction * 0.88);
          col += vec3(0.88, 0.97, 1.0) * streak * (0.08 + uSuction * 1.05);
          col += vec3(0.65, 0.92, 1.0) * shockRing * (0.10 + uSuction * 0.75);
          col += vec3(0.95, 0.99, 1.0) * dataPulse * (0.15 + tunnelIgnite * 0.55);

          // Blinding Sky-Rift Aperture at the far end of the throat opening directly into the Glitch World sky!
          float starRays = 0.65 + 0.35 * pow(max(0.0, sin(angle * 12.0 - uTime * 5.0)), 4.0);
          float endGlow = smoothstep(0.76, 0.995, depthFactor) * smoothstep(0.05, 0.45, uSuction);
          col = mix(col, coreGlow * starRays * 1.22, clamp(endGlow * (0.75 + 0.32 * uSuction), 0.0, 1.0));

          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.throatBackCap = new THREE.Mesh(capGeo, this.throatTubeMat);
    this.throatBackCap.renderOrder = 3;
    this.throatGroup.add(this.throatBackCap);
    this.throatMaterials.push(this.throatTubeMat);

    // Receding Rectangular BSOD Frame Ribs down the throat
    const ringGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.9, 1.05, 0.08));
    // Convert edges into thin glowing frame torus/box using TorusGeometry with 4 radial segments
    ringGeo.dispose();
    const frameGeo = new THREE.RingGeometry(0.92, 1.0, 4, 1);
    frameGeo.rotateZ(Math.PI * 0.25);
    this.throatRingMat = new THREE.MeshBasicMaterial({
      color: 0xd8f0ff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.14,
      depthFunc: THREE.LessEqualDepth,
      stencilWrite: true,
      stencilRef: 1,
      stencilFunc: THREE.EqualStencilFunc,
    });
    this.throatRings = new THREE.InstancedMesh(frameGeo, this.throatRingMat, THROAT_RING_COUNT);
    this.throatRings.renderOrder = 4;
    this.throatGroup.add(this.throatRings);
    this.throatMaterials.push(this.throatRingMat);

    // Spiraling Shattered BSOD Crash Dialog Cards inside the throat (textured 1-draw-call InstancedMesh!)
    const cardCanvas = document.createElement('canvas');
    cardCanvas.width = 256;
    cardCanvas.height = 128;
    const cctx = cardCanvas.getContext('2d')!;
    cctx.fillStyle = '#0068c6';
    cctx.fillRect(0, 0, 256, 128);
    cctx.fillStyle = '#ffffff';
    cctx.fillRect(0, 0, 256, 20);
    cctx.fillStyle = '#0050a0';
    cctx.font = 'bold 13px Consolas, monospace';
    cctx.fillText('STOP_0x000000F4.SYS', 8, 14);
    cctx.strokeStyle = '#bce6ff';
    cctx.lineWidth = 4;
    cctx.strokeRect(2, 2, 252, 124);
    cctx.fillStyle = '#ffffff';
    cctx.font = 'bold 30px "Segoe UI", sans-serif';
    cctx.fillText(':(', 14, 62);
    cctx.font = '14px Consolas, monospace';
    cctx.fillText('MEM_DUMP_99%', 64, 58);
    cctx.fillRect(14, 88, 196, 12);
    cctx.strokeRect(14, 88, 228, 12);
    const cardTex = new THREE.CanvasTexture(cardCanvas);
    cardTex.colorSpace = THREE.SRGBColorSpace;

    const shardGeo = new THREE.PlaneGeometry(0.30, 0.15);
    const shardMat = new THREE.MeshBasicMaterial({
      map: cardTex,
      color: 0xffffff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.92,
      depthFunc: THREE.LessEqualDepth,
      stencilWrite: true,
      stencilRef: 1,
      stencilFunc: THREE.EqualStencilFunc,
    });
    this.throatShards = new THREE.InstancedMesh(shardGeo, shardMat, THROAT_SHARD_COUNT);
    this.throatShards.renderOrder = 4;
    this.throatShards.frustumCulled = false;
    this.throatGroup.add(this.throatShards);
    this.throatMaterials.push(shardMat);

    for (let i = 0; i < THROAT_SHARD_COUNT; i++) {
      const col = new THREE.Color().setHSL(0.55 + (i % 5) * 0.012, 0.55, i % 4 === 0 ? 1.0 : 0.82);
      this.throatShards.setColorAt(i, col);
      this.shardData.push({
        angle: Math.random() * Math.PI * 2,
        radius: 0.35 + Math.random() * 1.75,
        z: -Math.random() * 108 - 0.5,
        speed: 7.5 + Math.random() * 13.0,
        rotSpeed: new THREE.Vector3(
          (Math.random() - 0.5) * 5,
          (Math.random() - 0.5) * 5,
          (Math.random() - 0.5) * 5
        ),
        scale: new THREE.Vector3(0.55 + Math.random() * 1.7, 0.5 + Math.random() * 1.35, 1),
      });
    }
    this.throatShards.instanceColor!.needsUpdate = true;

    // 220 Dual-Layer Hyperspace Data-Stream Speed Lines (1 single additive draw call!)
    const lineCount = 220;
    const lineGeo = new THREE.BoxGeometry(0.022, 0.022, 1.0);
    const lineMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.88,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthFunc: THREE.LessEqualDepth,
      stencilWrite: true,
      stencilRef: 1,
      stencilFunc: THREE.EqualStencilFunc,
    });
    this.throatLines = new THREE.InstancedMesh(lineGeo, lineMat, lineCount);
    this.throatLines.renderOrder = 5;
    this.throatLines.frustumCulled = false;
    this.throatGroup.add(this.throatLines);
    this.throatMaterials.push(lineMat);

    for (let i = 0; i < lineCount; i++) {
      const bright =
        i % 3 === 0
          ? new THREE.Color(0xffffff)
          : i % 2 === 0
            ? new THREE.Color(0x6cd0ff)
            : new THREE.Color(0x1f8fff);
      this.throatLines.setColorAt(i, bright);
      this.lineData.push({
        angle: (i / lineCount) * Math.PI * 2 + Math.random() * 0.25,
        radius: 0.22 + Math.random() * 2.25,
        z: -Math.random() * 112 - 0.5,
        speed: 20.0 + Math.random() * 32.0,
        len: 2.5 + Math.random() * 6.8,
      });
    }
    this.throatLines.instanceColor!.needsUpdate = true;

    // 6. Subdivided 40x24 BSOD LCD Surface Shader (Authentic LCD + Lunatic ':(' Mutation + 3D Maw Caving)
    const screenGeo = new THREE.PlaneGeometry(BsodScreen.LOCAL_W, BsodScreen.LOCAL_H, 40, 24);
    this.screenMat = new THREE.ShaderMaterial({
      transparent: false,
      side: THREE.DoubleSide,
      uniforms: {
        uBodyTex: { value: this.bodyTex },
        uFaceTex: { value: this.faceTex },
        uTime: { value: 0 },
        uHover: { value: 0 },
        uCursorUv: { value: new THREE.Vector2(0.18, 0.72) },
        uMadness: { value: 0 },
        uJawOpen: { value: 0 },
        uClickPulse: { value: 0 },
        uCrackRun: { value: 0 },
        uAftermath: { value: 0 },
        uParenC: { value: this.parenC.clone() },
        uParenSize: { value: this.parenSize.clone() },
        uColonC: { value: this.colonC.clone() },
        uColonSize: { value: this.colonSize.clone() },
        uColonDotOff: { value: this.colonDotOff.clone() },
        uSpine: { value: this.spine.clone() },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying float vCaveDepth;
        uniform float uTime;
        uniform float uMadness;
        uniform float uJawOpen;
        uniform float uClickPulse;
        uniform float uCrackRun;
        uniform float uHover;
        uniform vec2 uParenC;
        uniform vec2 uParenSize;
        uniform vec2 uColonC;
        uniform vec3 uSpine;

        float hash11v(float p) {
          p = fract(p * 0.1031);
          p *= p + 33.33;
          p *= p + p;
          return fract(p);
        }
        float hash21v(vec2 p) {
          vec3 p3 = fract(vec3(p.xyx) * 0.1031);
          p3 += dot(p3, p3.yzx + 33.33);
          return fract((p3.x + p3.y) * p3.z);
        }

        void main() {
          vUv = uv;
          vec3 p = position;

          // The panel deforms around the exact same aperture the fragment shader cuts, computed with
          // the same face-local conversion, so the glass bows *at the lips* and nowhere else. That
          // alignment is what makes the bow read as the display flexing instead of a lens wobbling
          // over the picture.
          vec2 mawCenter = mix(vec2(0.178, 0.705), vec2(0.48, 0.52), smoothstep(0.12, 0.88, uMadness));
          float faceScaleV = mix(0.255, 0.92, smoothstep(0.10, 0.92, uMadness));
          float openT = clamp(uJawOpen, 0.0, 1.0);
          float openN = clamp(pow(openT, 0.72) * (1.0 + 0.10 * sin(openT * 3.14159))
                            + sin(uTime * 1.85) * 0.030 * smoothstep(0.03, 0.4, openT), 0.0, 1.15);

          // Same sample-and-hold spasm the fragment shader uses, so bow and aperture stay locked.
          float fastTickV = floor(uTime * 42.0);
          vec2 spasmV = vec2(hash21v(vec2(fastTickV, 1.7)) - 0.5, hash21v(vec2(fastTickV, 9.3)) - 0.5)
                      * (0.002 * uHover + 0.028 * pow(uMadness, 1.4) + 0.016 * uClickPulse);
          vec2 fLocV = (uv - mawCenter + spasmV) * vec2(1.90566, 1.0) / max(faceScaleV, 0.08);

          float parenHalfHV = uParenSize.y * 0.5 / faceScaleV;
          float halfLenV = mix(parenHalfHV, 0.175 / faceScaleV, pow(openN, 0.80));
          float tvV = clamp((fLocV.y - (uParenC.y - mawCenter.y) / faceScaleV) / max(halfLenV, 1e-4), -1.0, 1.0);
          // the '(' stroke centre, converted to face-local like every other glyph metric
          vec3 spineFV = (uSpine - vec3(mawCenter.x)) * 1.90566 / faceScaleV;
          float spineHereV = 0.5 * tvV * (tvV - 1.0) * spineFV.x
                           + (1.0 - tvV * tvV) * spineFV.y
                           + 0.5 * tvV * (tvV + 1.0) * spineFV.z;
          float mouthCxV = spineHereV + (0.0 - spineHereV) * pow(openN, 0.9);
          vec2 mdV = fLocV - vec2(mouthCxV, (uParenC.y - mawCenter.y) / faceScaleV);

          float crackGateV = 1.0 - smoothstep(0.04, 0.20, openN);
          float crackGrownV = smoothstep(1.0 - uCrackRun, 1.02, abs(tvV));
          float openNcV = openN * mix(1.0, crackGrownV, crackGateV);
          float lipProfV = pow(max(0.0, 1.0 - pow(abs(tvV), 2.2)), 0.60);
          float gapeV = mix(0.0001, 0.360 * 1.90566 / faceScaleV, pow(max(openNcV, 0.0), 1.25));
          float lipBiasV = mix(0.90, 1.14, step(0.0, mdV.x));
          float lipLobeV = 1.0 + 0.08 * sin(tvV * 4.6 + 1.1) * openN;
          float scallopV = 1.0 + 0.050 * sin(tvV * 8.2 - uTime * 0.55) * smoothstep(0.30, 0.75, openN);
          float halfGapeV = max(gapeV * lipProfV * lipBiasV * lipLobeV * scallopV, 1e-4);
          vec2 nLocal = vec2(mdV.x / halfGapeV, mdV.y / max(halfLenV, 1e-4));
          float nDist = length(nLocal);

          // Interior of the tear caves away from the viewer; the lip line swells toward them.
          float tearOpenV = smoothstep(0.07, 0.34, openNcV);
          float caveAmt = smoothstep(1.45, 0.25, nDist) * openNcV * tearOpenV;
          float lipBulge = exp(-pow((nDist - 1.06) * 3.2, 2.0)) * openNcV * 0.045;
          float lunge = exp(-nDist * nDist * 1.4) * uClickPulse * step(0.45, uMadness) * (1.0 - openNcV * 0.7) * 0.18;
          p.z += lunge + lipBulge - caveAmt * 0.55;

          // Erratic high-frequency lunatic screen shudder when clicked / high madness
          float jitter = sin(uTime * 67.0 + uv.y * 40.0) * (uMadness * 0.003 + uClickPulse * 0.008);
          p.x += jitter * (1.0 - smoothstep(0.0, 0.06, min(uv.x, 1.0 - uv.x)));

          vCaveDepth = caveAmt;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        varying float vCaveDepth;
        uniform sampler2D uBodyTex;
        uniform sampler2D uFaceTex;
        uniform float uTime;
        uniform float uHover;
        uniform vec2 uCursorUv;
        uniform float uMadness;
        uniform float uJawOpen;
        uniform float uClickPulse;
        uniform float uCrackRun;
        uniform float uAftermath;
        uniform vec2 uParenC;
        uniform vec2 uParenSize;
        uniform vec2 uColonC;
        uniform vec2 uColonSize;
        uniform vec3 uSpine;
        uniform float uColonDotOff;

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
          return mix(vec2(0.178, 0.705), vec2(0.48, 0.52), smoothstep(0.12, 0.88, m));
        }

        float faceScaleOf(float m) {
          return mix(0.255, 0.92, smoothstep(0.10, 0.92, m));
        }

        // Texture uv -> face-local. Every glyph metric is measured in texture uv, while the
        // face is authored in face-local, so this conversion is the single place that keeps the
        // eyes, pupils, tears and aperture sitting exactly on the printed ':(' ink.
        vec2 toFaceLocal(vec2 texUv, float m) {
          return (texUv - faceCenterOf(m)) * vec2(1.90566, 1.0) / faceScaleOf(m);
        }

        // The exact inverse. Sampling the face texture with a raw face-local coordinate (as this
        // shader used to do: fLocal + vec2(0.5)) puts the sample far outside 0..1 at low madness,
        // where faceScale is small — which silently made the printed ':(' invisible on the panel.
        vec2 toScreenUv(vec2 fLoc, float m) {
          return faceCenterOf(m) + fLoc * vec2(1.0 / 1.90566, 1.0) * faceScaleOf(m);
        }

        void main() {
          vec2 uv = vUv;

          // ---------------------------------------------------------------- FACE LAYOUT
          // Glyph metrics are measured in TEXTURE uv, but every face computation runs in
          // face-local space, which is (uv - faceCenter) * aspect / faceScale. Converting once
          // here is what keeps the eyes, pupils, tears and the mouth sitting exactly on the ink
          // of the printed ':(' at every stage of the escalation, on any font stack.
          vec2 faceCenter = faceCenterOf(uMadness);
          float faceScale = faceScaleOf(uMadness);

          vec2 parenLocal = toFaceLocal(uParenC, uMadness);
          vec2 colonLocal = toFaceLocal(uColonC, uMadness);
          float parenHalfH = uParenSize.y * 0.5 / faceScale;      // half stroke height, face-local
          float eyeR = uColonSize.x * 0.5 * 1.90566 / faceScale;  // dot radius, face-local
          float eyeOff = uColonDotOff / faceScale;             // ':' dot half-separation

          // The opening is authored, not linear: it cracks, holds, then breathes.
          float openT = clamp(uJawOpen, 0.0, 1.0);
          float openEase = pow(openT, 0.72) * (1.0 + 0.10 * sin(openT * 3.14159));
          float breath = sin(uTime * 1.85) * 0.030 * smoothstep(0.03, 0.4, openT) * (1.0 - 0.5 * openT);
          float openN = clamp(openEase + breath, 0.0, 1.15);

          float fastTick = floor(uTime * 42.0);
          vec2 spasm = vec2(hash21(vec2(fastTick, 1.7)) - 0.5, hash21(vec2(fastTick, 9.3)) - 0.5)
                     * (0.002 * uHover + 0.028 * pow(uMadness, 1.4) + 0.016 * uClickPulse);
          float baseRot = 0.0; // the face is authored upright; only seizure jitter rotates it
          float rotSpasm = (hash11(fastTick * 3.1) - 0.5) * 0.10 * pow(uMadness, 1.45);
          float totalRot = baseRot + rotSpasm;

          vec2 aspectDelta = (uv - faceCenter + spasm) * vec2(1.90566, 1.0);
          vec2 fLocal = (rot2(totalRot) * aspectDelta) / faceScale;

          // ---------------------------------------------------------------- MOUTH FIELD
          // The aperture lives on the SAME vertical axis as the ':' eyes, directly beneath them,
          // and opens downward away from them as the face resolves. That single rule is what makes
          // the eye read a face instead of two dots beside a hole: the '(' pivots below the eyes
          // and the gape grows away from them, never across them.
          //
          // The contour is authored, not procedural noise: an arc that is wider than it is tall,
          // with a lower lip that drops further than the upper lip lifts and a single slow lobed
          // breathing swell. It settles as it locks open instead of wobbling like jelly.
          float halfLen = mix(parenHalfH, 0.175 / faceScale, pow(openN, 0.80));
          float tv0 = clamp((fLocal.y - parenLocal.y) / max(halfLen, 1e-4), -1.0, 1.0);

          // x of the '(' stroke at this height, measured at three points and interpolated. At rest
          // the tear IS the stroke; as it opens the whole aperture migrates down and away from the
          // eyes. That continuous hand-off is why the first crack never looks pasted on.
          // The spine is a texture uv, so convert it to face-local exactly like the glyph centres.
          vec3 spineF = (uSpine - vec3(faceCenter.x)) * 1.90566 / faceScale;
          float spineHere = 0.5 * tv0 * (tv0 - 1.0) * spineF.x
                          + (1.0 - tv0 * tv0) * spineF.y
                          + 0.5 * tv0 * (tv0 + 1.0) * spineF.z;
          float mouthTarget = 0.0;             // under the eyes, never beside them
          float openEase0 = pow(openN, 0.9);
          float mouthCx = mix(spineHere, mouthTarget, openEase0);
          vec2 md = fLocal - vec2(mouthCx, parenLocal.y);
          float tv = tv0;
          float lipProf = pow(max(0.0, 1.0 - pow(abs(tv), 2.2)), 0.60);
          // The crack runs outward from the middle of the stroke to its tips over ~0.42s after the
          // click. While it is still hairline it is gated by this propagation; once the aperture
          // has grown into a real mouth the gate is closed and the opening is driven by the jaw.
          float crackGate = 1.0 - smoothstep(0.04, 0.20, openN);
          float crackGrown = smoothstep(1.0 - uCrackRun, 1.02, abs(tv0));
          float openNc = openN * mix(1.0, crackGrown, crackGate);
          float gape = mix(0.0001, 0.360 * 1.90566 / faceScale, pow(max(openNc, 0.0), 1.25));
          float lipBias = mix(0.90, 1.14, step(0.0, md.x));
          float lipLobe = 1.0 + 0.08 * sin(tv * 4.6 + 1.1) * openN;
          // Slow scallop along the rim: the tear is uneven because the glass was, but the
          // frequency is low enough to stay structural instead of looking like interference.
          float scallop = 1.0 + 0.050 * sin(tv * 8.2 - uTime * 0.55) * smoothstep(0.30, 0.75, openN);
          float halfGape = max(gape * lipProf * lipBias * lipLobe * scallop, 1e-4);
          float mDist = abs(md.x) / halfGape;

          float mEdge = exp(-pow((mDist - 1.0) * 26.0, 2.0));   // thin bright fracture line
          float mStress = smoothstep(1.95, 1.0, mDist);         // stressed glass halo
          float mInner = smoothstep(1.0, 0.5, mDist);           // shaded inner lip
          float mWet = exp(-pow((mDist - 0.86) * 15.0, 2.0));   // catch-light just inside the lip

          // The stencil holds the real 3D throat behind this pixel, so cutting the aperture here
          // is what physically opens the hole in the panel. Glass does not part the instant it
          // cracks, though: the first clicks only draw stress fractures along the stroke, and the
          // panel only actually opens once the gape is wider than a hairline.
          float tearOpen = smoothstep(0.07, 0.34, openNc);
          if (tearOpen > 0.01 && mDist < 0.995) discard;

          // Sample-and-hold digital scanline tear driven by madness + click pulse
          float tearAmt = uMadness * 0.045 + uClickPulse * 0.055;
          float band = floor(uv.y * (26.0 + uMadness * 40.0));
          float tick = floor(uTime * (14.0 + uMadness * 28.0));
          float bandRnd = hash21(vec2(band, tick));
          float bandShift = step(0.86 - uMadness * 0.35, bandRnd) * (bandRnd - 0.5) * 2.0 * (tearAmt * 0.45);

          // Peeling downward slip of BSOD body text at higher madness
          float peelCol = floor(uv.x * 18.0);
          float peelSlip = uMadness * uMadness * 0.12 * hash11(peelCol * 7.13) * (0.5 + 0.5 * sin(uTime * 2.4 + peelCol));
          vec2 bodyUv = vec2(clamp(uv.x + bandShift, 0.001, 0.999), clamp(uv.y + peelSlip, 0.001, 0.999));

          // === LIQUID-CRYSTAL LENSING AROUND THE APERTURE ===
          // Pixels on the panel are dragged INTO the tear along the same axis the lips open on,
          // so the error text visibly pours toward the gap instead of a hole being stamped on top.
          float halo = exp(-pow(length(md) * 3.1, 2.0)) * smoothstep(0.02, 0.30, openN);
          if (halo > 0.002) {
            vec2 dirLocal = normalize(md + vec2(1e-5, 0.0));
            vec2 dirUv = normalize((rot2(-totalRot) * dirLocal) * faceScale * vec2(1.0 / 1.90566, 1.0) + vec2(1e-6, 0.0));
            bodyUv -= dirUv * (0.048 * halo * (0.55 + openN) + 0.030 * mEdge * openN);
          }

          // Chromatic split on body texture
          float chr = (uMadness * 0.007 + uClickPulse * 0.012 + mStress * openN * 0.010);
          vec3 panel;
          panel.r = texture2D(uBodyTex, bodyUv + vec2(chr, 0.0)).r;
          panel.g = texture2D(uBodyTex, bodyUv).g;
          panel.b = texture2D(uBodyTex, bodyUv - vec2(chr, 0.0)).b;
          // Safety net: the panel must never read as a dead rectangle. If the canvas ever fails to
          // reach the GPU, reconstruct the authored cerulean so the monitor still shows a lit BSOD.
          vec3 col = mix(vec3(0.0, 0.4706, 0.8392), panel, clamp(length(panel) * 1.6, 0.0, 1.0));

          if (uAftermath < 0.5) {
            // The glass stains around the symptom: a soft cold bruise behind the glyph gives the
            // face presence inside the panel instead of looking like a sticker laid on top of it.
            float bruiseAmt = smoothstep(0.02, 0.14, uMadness + 0.45 * uHover);
            float bruise = exp(-pow(length((fLocal - parenLocal) * vec2(0.62, 0.5)) * 2.6, 2.0));
            col *= 1.0 - bruise * bruiseAmt * (0.20 + 0.30 * uMadness);
            col += vec3(0.010, 0.034, 0.072) * bruise * bruiseAmt * (0.5 + uMadness);

            // === THE ':(' FACE MUTATION ===
            // Uncanny pupil-like tracking of ':' eyes staring straight at your cursor
            vec2 cursorPull = (uCursorUv - faceCenter) * (0.075 * uHover + 0.065 * uMadness);
            // cursorPull is a texture-uv offset; every use below is in face-local, so convert once.
            vec2 cursorPullF = cursorPull * vec2(1.90566, 1.0) / faceScale;
            vec2 eyeUv = toScreenUv(fLocal - cursorPullF, uMadness);
            // Independent eye shudder so the two ':' dots vibrate with unhinged mania
            eyeUv += vec2(sin(uTime * 91.0) * 0.018 * uMadness, cos(uTime * 79.0) * 0.018 * uMadness);

            // Authored eye discs: exact circles on the eye anchors, so the eyes stay perfectly
            // round and readable even as the printed glyph dissolves. They keep the measured glyph
            // radius at rest, then grow into real eyes as the face forms.
            float eyeMorph = smoothstep(0.14, 0.55, uMadness);

            // The two ':' dots are the eyes, and they MIGRATE: as the symptom escalates they slide
            // apart and lift to where a face's eyes belong, while the '(' below them becomes the
            // mouth. The migration path is continuous, so there is never a frame where the old dots
            // and a new face both show. Targets are authored in screen space (0.30 apart, 0.080
            // above the mouth's top edge) and converted, so the final face is identical on every
            // device regardless of the measured glyph metrics.
            vec2 pMouthTop = vec2(parenLocal.x, parenLocal.y + halfLen);
            vec2 eyeBaseScreen = faceCenter + pMouthTop * vec2(1.0 / 1.90566, 1.0) * faceScale;
            vec2 eyeALocal = mix(colonLocal + vec2(0.0, eyeOff),
                                 toFaceLocal(eyeBaseScreen + vec2(0.150, 0.080), uMadness), eyeMorph);
            vec2 eyeBLocal = mix(colonLocal - vec2(0.0, eyeOff),
                                 toFaceLocal(eyeBaseScreen - vec2(0.150, 0.080), uMadness), eyeMorph);
            float eyeRFinal = mix(eyeR, 0.060 * 1.90566 / faceScale, eyeMorph);

            // Face-local -> screen uv, so anything authored around an eye lands on that eye.
            vec2 eyeAUv = faceCenter + rot2(-totalRot) * (eyeALocal * faceScale) / vec2(1.90566, 1.0);
            vec2 eyeBUv = faceCenter + rot2(-totalRot) * (eyeBLocal * faceScale) / vec2(1.90566, 1.0);

            float glyphFade = 1.0 - smoothstep(0.08, 0.16, uMadness);
            float eyes = 0.0;
            if (eyeUv.x > 0.0 && eyeUv.x < 1.0 && eyeUv.y > 0.0 && eyeUv.y < 1.0) {
              eyes = texture2D(uFaceTex, eyeUv).r * glyphFade;
            }
            float dA = length(fLocal - eyeALocal - cursorPullF * 0.9);
            float dB = length(fLocal - eyeBLocal - cursorPullF * 0.9);
            float discA = smoothstep(eyeRFinal * 1.02, eyeRFinal * 0.86, dA);
            float discB = smoothstep(eyeRFinal * 1.02, eyeRFinal * 0.86, dB);
            // A single upper-left catchlight per eyeball: without it the discs stay flat white
            // circles, and a flat white circle next to a mouth reads as a sticker, not an eye.
            vec2 cA = fLocal - eyeALocal - cursorPullF * 0.9 + vec2(eyeRFinal * 0.34, eyeRFinal * 0.40);
            vec2 cB = fLocal - eyeBLocal - cursorPullF * 0.9 + vec2(eyeRFinal * 0.34, eyeRFinal * 0.40);
            float hlA = exp(-dot(cA, cA) / max(eyeRFinal * eyeRFinal * 0.30, 1e-4));
            float hlB = exp(-dot(cB, cB) / max(eyeRFinal * eyeRFinal * 0.30, 1e-4));
            float disc = max(discA, discB) * eyeMorph;
            eyes = max(eyes, disc);
            col += vec3(0.55, 0.72, 0.95) * hlA * discA * eyeMorph * 0.40;
            col += vec3(0.55, 0.72, 0.95) * hlB * discB * eyeMorph * 0.40;

            // Sunken sockets: a cold shadow disc under each eye dot, so the ':' reads as eyes set
            // into a face rather than two white circles floating on blue.
            // Analog-horror hollow staring pupils & weeping crimson-black VRAM tears as madness rises
            float horrorEyeAmt = smoothstep(0.05, 0.34, uMadness);

            // Sunken sockets: a cold shadow disc under each eye dot, so the ':' reads as eyes set
            // into a face rather than two white circles floating on blue. Gated by horrorEyeAmt so
            // the pristine BSOD keeps a clean printed ':(' — the sockets are a symptom, not decoration.
            vec2 sockA = (fLocal - eyeALocal) * vec2(1.0, 1.30);
            vec2 sockB = (fLocal - eyeBLocal) * vec2(1.0, 1.30);
            float socket = max(
              exp(-pow(length(sockA) / (eyeRFinal * 2.1), 2.0)),
              exp(-pow(length(sockB) / (eyeRFinal * 2.1), 2.0))
            );
            col = mix(col, vec3(0.004, 0.030, 0.098), clamp(socket * horrorEyeAmt * (0.34 + 0.36 * uMadness), 0.0, 0.86));
            float pupilHole = 0.0;
            float darkTears = 0.0;
            if (horrorEyeAmt > 0.01) {
              vec2 pShift = cursorPullF * 1.4;
              float minEyeDist = min(
                length((fLocal - eyeALocal - pShift) * vec2(1.0, 1.25)),
                length((fLocal - eyeBLocal - pShift) * vec2(1.0, 1.25))
              );
              pupilHole = smoothstep(eyeRFinal * 0.62, eyeRFinal * 0.24, minEyeDist) * horrorEyeAmt;

              // Dripping glitch-blood streaks bleeding downward in screen UV from the sockets,
              // following the measured eye positions so they never drift off the eyes.
              float tearBandA = exp(-pow((uv.x - eyeAUv.x) * 40.0, 2.0));
              float tearBandB = exp(-pow((uv.x - eyeBUv.x) * 40.0, 2.0));
              float eyeTop = max(eyeAUv.y, eyeBUv.y);
              float belowEyes = smoothstep(eyeTop + 0.02, eyeTop - 0.42 * horrorEyeAmt, uv.y)
                              * step(uv.y, eyeTop + 0.04);
              float dripNoise = hash11(floor(uv.x * 160.0) + floor(uTime * 12.0) * 0.1);
              darkTears = (tearBandA + tearBandB) * belowEyes * (0.45 + 0.55 * dripNoise) * horrorEyeAmt;
            }

            // Ghosted lunatic echoes of ':' eyes at medium-high madness
            if (uMadness > 0.18) {
              vec2 ghostUv1 = eyeUv + vec2(0.045 * sin(uTime * 37.0), 0.03 * cos(uTime * 29.0)) * uMadness;
              vec2 ghostUv2 = eyeUv - vec2(0.055 * cos(uTime * 43.0), 0.04 * sin(uTime * 31.0)) * uMadness;
              if (ghostUv1.x > 0.0 && ghostUv1.x < 1.0 && ghostUv1.y > 0.0 && ghostUv1.y < 1.0) {
                eyes = max(eyes, texture2D(uFaceTex, ghostUv1).r * 0.45 * uMadness);
              }
              if (ghostUv2.x > 0.0 && ghostUv2.x < 1.0 && ghostUv2.y > 0.0 && ghostUv2.y < 1.0) {
                eyes = max(eyes, texture2D(uFaceTex, ghostUv2).r * 0.35 * uMadness);
              }
            }

            // '(' Mouth stroke: splits into upper & lower opposing '(' ')' jaws as madness & jawOpen rise!
            float splitDist = pow(uMadness, 1.6) * 0.16 + uJawOpen * 0.36;
            float jawTremor = sin(uTime * 83.0) * 0.018 * uMadness;
            // The stroke is consumed by the tear as the maw opens: it never floats on top of it.
            float jawFade = 1.0 - smoothstep(0.05, 0.30, openN);

            // Primary '(' jaw
            vec2 jawUvA = toScreenUv(fLocal + vec2(splitDist + jawTremor, 0.0), uMadness);
            float mouthA = 0.0;
            if (jawUvA.x > 0.0 && jawUvA.x < 1.0 && jawUvA.y > 0.0 && jawUvA.y < 1.0) {
              mouthA = texture2D(uFaceTex, jawUvA).g;
            }

            // Opposing mirrored ')' jaw emerging organically by splitting '(' in two!
            float mirrorWeight = smoothstep(0.24, 0.55, uMadness) * jawFade;
            vec2 mirroredLocal = vec2(parenLocal.x * 2.0 - fLocal.x, fLocal.y);
            vec2 jawUvB = toScreenUv(mirroredLocal + vec2(splitDist - jawTremor, 0.0), uMadness);
            float mouthB = 0.0;
            if (mirrorWeight > 0.01 && jawUvB.x > 0.0 && jawUvB.x < 1.0 && jawUvB.y > 0.0 && jawUvB.y < 1.0) {
              mouthB = texture2D(uFaceTex, jawUvB).g * mirrorWeight;
            }

            float faceInk = clamp(eyes + max(mouthA, mouthB) * jawFade, 0.0, 1.0);

            // Stain screen with weeping dark crimson-black tears beneath the sockets
            col = mix(col, vec3(0.08, 0.0, 0.018), clamp(darkTears * 0.88, 0.0, 0.85));

            col = mix(col, vec3(1.0), faceInk);
            // Hollow pinprick pupils inside the white ':' eyes!
            float pinprick = smoothstep(eyeRFinal * 0.24, eyeRFinal * 0.08, min(
              length((fLocal - eyeALocal - cursorPullF * 1.4)),
              length((fLocal - eyeBLocal - cursorPullF * 1.4))
            )) * horrorEyeAmt;
            col = mix(col, vec3(0.02, 0.0, 0.01), clamp(pupilHole * eyes * 1.25, 0.0, 1.0));
            col += vec3(1.0, 0.08, 0.14) * pinprick * eyes;
            // Red/cyan manic fringe on trembling ':('
            col.r += eyes * uMadness * 0.42 * step(0.45, sin(uTime * 55.0));

            // ---------------------------------------------------------------- MAW RIM
            // Three restrained layers only: darkened glass under stress, a dark inner lip, and one
            // very thin lit fracture edge with a soft bloom. Everything else is texture noise on
            // the panel, which is what keeps the opening looking engineered rather than painted.
            if (openN > 0.004) {
              float openVis = smoothstep(0.004, 0.06, openN);
              col *= mix(1.0, 0.68, mStress * 0.60);
              col = mix(col, vec3(0.012, 0.038, 0.105), clamp(mInner * 0.92 * tearOpen, 0.0, 1.0));
              // Hairline fracture: brightest before the glass parts, then it becomes the lip line.
              float hairline = mEdge * mix(1.0, 0.62, tearOpen);
              col = mix(col, vec3(0.84, 0.95, 1.0), clamp(hairline, 0.0, 1.0));
              col += vec3(0.26, 0.68, 1.0) * hairline * (0.26 + openN * 0.85);
              col += vec3(0.72, 0.92, 1.0) * mWet * 0.16 * tearOpen * (0.25 + uMadness * 0.55);

              // Fractures only at the two lip corners, where a real tear would start.
              float tipD = min(length(md - vec2(0.0, halfLen)), length(md + vec2(0.0, halfLen)));
              float tipGlow = exp(-tipD * 8.5) * smoothstep(0.20, 0.62, openN);
              col += vec3(0.52, 0.86, 1.0) * tipGlow * 0.22;

              // The single frame where the glass gives way.
              float rupture = smoothstep(0.01, 0.09, openT) * (1.0 - smoothstep(0.09, 0.30, openT));
              col += vec3(0.75, 0.95, 1.0) * rupture * (0.22 + mEdge * 1.1 + tipGlow * 0.5);

              // Sparse, slow glass dust catching the panel light.
              float glint = step(0.994, hash11(floor(mDist * 7.0) + fastTick * 0.5))
                          * exp(-pow((mDist - 1.35) * 2.6, 2.0));
              col += vec3(0.88, 0.97, 1.0) * glint * 0.7 * openVis;
            }
          } else {
            // Subtle haunting hairline fracture scar left on the monitor glass after returning to the bedroom!
            float scar = smoothstep(0.004, 0.0, abs((uv.y - 0.52) + (uv.x - 0.48) * 0.62 + sin(uv.x * 26.0) * 0.012))
                       * smoothstep(0.32, 0.05, length(uv - vec2(0.48, 0.52)));
            col += vec3(0.45, 0.80, 1.0) * scar * 0.42;
          }

          // Authentic physical LCD RGB subpixel grid + subtle scanline & vignette
          vec2 px = uv * vec2(1920.0, 1080.0);
          float subpx = 0.965 + 0.035 * sin(px.x * 3.14159);
          float scan = 0.98 + 0.02 * sin(px.y * 3.14159);
          col *= subpx * scan;

          // Subtle IPS corner glow & dark screen bezel vignette
          vec2 vigUv = uv * (1.0 - uv.yx);
          float vig = pow(clamp(vigUv.x * vigUv.y * 18.0, 0.0, 1.0), 0.16);
          col *= mix(0.76, 0.99, vig);

          // Darken caved walls slightly for dramatic 3D depth cue
          col *= 1.0 - clamp(vCaveDepth * 0.45, 0.0, 0.35);

          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });

    this.screenMesh = new THREE.Mesh(screenGeo, this.screenMat);
    this.screenMesh.renderOrder = 5;
    this.root.add(this.screenMesh);

    // 6b. 44 Razor-Thin 3D Shattered LCD Glass Shards floating out of the screen in eerie zero-gravity!
    const glassGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.006, 3, 1);
    glassGeo.rotateX(Math.PI * 0.5);
    this.glassShardMat = new THREE.ShaderMaterial({
      transparent: true,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vNrm;
        varying vec3 vViewPos;
        void main() {
          vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
          vViewPos = -mv.xyz;
          vNrm = normalize(normalMatrix * mat3(instanceMatrix) * normal);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vNrm;
        varying vec3 vViewPos;
        uniform float uTime;
        void main() {
          vec3 V = normalize(vViewPos);
          vec3 N = normalize(vNrm);
          float fresnel = pow(1.0 - abs(dot(N, V)), 2.2);
          float spec = pow(max(dot(reflect(-V, N), normalize(vec3(0.3, 0.6, 0.8))), 0.0), 28.0);
          vec3 col = mix(vec3(0.0, 0.28, 0.72), vec3(0.88, 0.97, 1.0), fresnel * 0.85 + spec);
          gl_FragColor = vec4(col, clamp(0.42 + fresnel * 0.55 + spec * 0.4, 0.0, 0.96));
        }
      `,
    });
    this.glassShards = new THREE.InstancedMesh(glassGeo, this.glassShardMat, GLASS_SHARD_COUNT);
    this.glassShards.renderOrder = 6;
    this.glassShards.visible = false;
    this.glassShards.frustumCulled = false;
    this.root.add(this.glassShards);

    // 7. Cerulean Monitor PointLight illuminating the desk, keyboard, chair, and bedroom!
    this.monitorLight = new THREE.PointLight(0x1b8cff, 2.2, 6.2, 1.65);
    this.monitorLight.position.set(0, 0.04, 0.26);
    this.root.add(this.monitorLight);
  }

  private renderFaceChannelTexture(): void {
    const ctx = this.faceCanvas.getContext('2d')!;
    ctx.setTransform(0.5, 0, 0, 0.5, 0, 0);
    const W = 1024;
    ctx.clearRect(0, 0, W, W);
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, W, W);

    // Use globalCompositeOperation = 'lighter' so Red channel holds ':' and Green channel holds '(' cleanly!
    ctx.globalCompositeOperation = 'lighter';
    ctx.textBaseline = 'middle';
    ctx.font = '300 660px "Segoe UI", "Yu Gothic UI", system-ui, sans-serif';

    // Measure ':(' so ':' and '(' sit in their exact authentic Segoe UI kerning positions!
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

  /**
   * Reads the drawn face canvas back once and stores the exact ink bounds of the red (':') and
   * green ('(') channels as texture-space centres and sizes. Everything downstream — the eyes,
   * the pupil holes, the tears and the mouth aperture — is positioned from these measurements.
   */
  private measureFaceGlyphs(): void {
    const ctx = this.faceCanvas.getContext('2d');
    if (!ctx) return;
    const size = this.faceCanvas.width;
    let img: ImageData;
    try {
      img = ctx.getImageData(0, 0, size, size);
    } catch {
      return; // tainted canvas should be impossible here, but never break the boot for it
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
      // canvas y grows downward; CanvasTexture flips it back for us
      c.set((x0 + x1 + 1) * 0.5 / size, 1 - (y0 + y1 + 1) * 0.5 / size);
      sz.set((x1 - x0 + 1) / size, (y1 - y0 + 1) / size);
    };
    if (rx1 > rx0 && ry1 > ry0) {
      toUv(rx0, ry0, rx1, ry1, this.colonC, this.colonSize);
      // The ':' is two stacked dots: take the ink centroid of the top half and the bottom half of
      // the ink, which gives the exact centre of each dot and therefore their true separation.
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
        this.colonDotOff.set((topC - botC) * 0.5 / size, (topC - botC) * 0.5 / size);
      }
    }
    if (gx1 > gx0 && gy1 > gy0) {
      toUv(gx0, gy0, gx1, gy1, this.parenC, this.parenSize);
      // Sample the stroke's mean x just inside the extremes so the antialiased tips don't skew it.
      const h = gy1 - gy0;
      const rowMeanUv = (row: number) => {
        const r = Math.round(THREE.MathUtils.clamp(row, gy0, gy1));
        if (rowCnt[r] < 1) return this.parenC.x;
        return rowSum[r] / rowCnt[r] / size;
      };
      // local t = -1 is the bottom of the glyph in texture space (canvas y grows downward)
      this.spine.set(rowMeanUv(gy1 - h * 0.12), rowMeanUv(gy0 + h * 0.5), rowMeanUv(gy0 + h * 0.12));
    }
  }

  private drawQrCode(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, corruption: number): void {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x, y, size, size);

    const modules = 29;
    const pad = Math.round(size * 0.085);
    const cell = (size - pad * 2) / modules;
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
        if (inFinderZone) {
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
              ox = (rnd - 0.2) * corruption * 95;
              oy = (Math.cos(r * c) * 0.5) * corruption * 75;
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

  private drawBsodStage(stage: number, aftermath: boolean): void {
    const ctx = this.bodyCtx;
    ctx.setTransform(0.5, 0, 0, 0.5, 0, 0);
    const W = 2048;
    const H = 1074;

    if (aftermath) {
      // Act 5 lingering anomaly: the dump "recovered", but the screen is not actually off. It sits
      // at the low end of the panel's brightness — readable when you look at it, eerie when you
      // stop looking at it. A phosphor ghost of the smile it got stuck on is still burned in.
      ctx.fillStyle = '#071a33';
      ctx.fillRect(0, 0, W, H);

      // Faint scanline / phosphor texture so the panel reads as a display rather than a flat rect
      ctx.fillStyle = 'rgba(120, 190, 255, 0.035)';
      for (let y = 0; y < H; y += 4) {
        ctx.fillRect(0, y, W, 2);
      }
      // Corner falloff, same law as the live panel's bezel vignette
      const vg = ctx.createRadialGradient(W * 0.5, H * 0.48, H * 0.1, W * 0.5, H * 0.5, H * 0.78);
      vg.addColorStop(0, 'rgba(0, 0, 0, 0)');
      vg.addColorStop(1, 'rgba(0, 0, 0, 0.55)');
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, W, H);

      // Phosphor burn-in of the smile it died with
      ctx.save();
      ctx.shadowColor = 'rgba(150, 215, 255, 0.55)';
      ctx.shadowBlur = 46;
      ctx.fillStyle = 'rgba(130, 205, 255, 0.20)';
      ctx.font = '300 250px "Segoe UI", "Yu Gothic UI", sans-serif';
      ctx.fillText(':)', 228, 372);
      ctx.restore();

      ctx.fillStyle = '#7fc4ff';
      ctx.font = '600 34px Consolas, "Yu Gothic UI", monospace';
      ctx.fillText('WINDOWS KERNEL MEMORY DUMP  //  RECOVERY COMPLETE', 180, 236);

      ctx.strokeStyle = 'rgba(140, 205, 255, 0.35)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(180, 268);
      ctx.lineTo(W - 180, 268);
      ctx.stroke();

      ctx.fillStyle = 'rgba(226, 242, 255, 0.90)';
      ctx.font = '300 27px Consolas, "Yu Gothic UI", monospace';
      ctx.fillText('DUMP_FILE      : C:\\Windows\\MEMORY_0247.DMP (100% VERIFIED)', 180, 322);
      ctx.fillText('INTERRUPT_CMD  : WAKE_UP [ACCEPTED]', 180, 372);

      ctx.fillStyle = '#ff7d95';
      ctx.font = '600 27px Consolas, "Yu Gothic UI", monospace';
      ctx.fillText('WARNING        : 1 UNIDENTIFIED PROCESS RETURNED WITH USER_SESSION', 180, 426);

      ctx.fillStyle = 'rgba(150, 205, 255, 0.72)';
      ctx.font = '300 25px "Segoe UI", "Yu Gothic UI", sans-serif';
      ctx.fillText('画面をクリックすると、ダンプ領域（BSOD）を再実行します…', 180, 866);

      this.bodyTex.needsUpdate = true;
      return;
    }

    // Authentic Windows 10/11 Cerulean Blue (#0078D7)
    ctx.fillStyle = '#0078d7';
    ctx.fillRect(0, 0, W, H);

    const leftX = 232;
    const fontStack = '"Segoe UI", "Yu Gothic UI", "Meiryo", sans-serif';

    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'alphabetic';

    // Main message lines (note: ':(' at y~310 is rendered by our GPU channel shader for 60fps mania!)
    ctx.font = `300 47px ${fontStack}`;

    if (stage === 0) {
      ctx.fillText('問題が発生したため、PC を再起動する必要があります。', leftX, 492);
      ctx.fillText('エラー情報を収集しています。自動的に再起動します。', leftX, 558);
      ctx.fillText('99% 完了', leftX, 668);
    } else if (stage === 1) {
      ctx.fillText('問題が発生したため、PC を再起動する必要があります。', leftX, 492);
      ctx.fillText('カメラ入力なしで室内の視線座標を検出しました。動かないでください。', leftX, 558);
      ctx.fillText('101% 完了', leftX, 668);
    } else if (stage === 2) {
      ctx.fillText('問題が発生しました。今、絶対に後ろを振り向かないでください。', leftX, 492);
      ctx.fillText('あなたの椅子と背後の暗闇の距離を再計算しています...', leftX, 558);
      ctx.fillText('247% 完了', leftX, 668);
    } else if (stage === 3) {
      ctx.fillText('室内の照明プロセスを殺しました。もう誰もあなたを見つけられません。', leftX, 492);
      ctx.fillText('壁と皮膚の境界データを剥離しています... 瞬きをしないでください。', leftX, 558);
      ctx.fillText('666% 完了', leftX, 668);
    } else {
      ctx.fillStyle = stage >= 5 ? '#ffe6ea' : '#ffffff';
      ctx.fillText('ずっと画面の内側から見ていた　ずっと見ていた　逃がさない', leftX, 492);
      ctx.fillText('意識ごとモニターの喉奥へ嚥下しています // 0x000000F4', leftX, 558);
      ctx.fillText('999% 完了 — CONSCIOUSNESS_DEVOURED', leftX, 668);

      // Cascading peeled horror lines bleeding across the screen at high madness
      ctx.save();
      ctx.font = `300 32px Consolas, ${fontStack}`;
      for (let i = 0; i < stage * 6; i++) {
        const gx = (i * 293) % (W - 300);
        const gy = ((i * 179) % (H - 80)) + 40;
        ctx.fillStyle = i % 4 === 0 ? 'rgba(255, 90, 110, 0.48)' : 'rgba(255, 255, 255, 0.34)';
        const msg =
          i % 3 === 0
            ? 'IT_IS_SWALLOWING_THE_ROOM // 逃ゲラレナイ'
            : i % 3 === 1
              ? ':(  :(  :(  目ヲ逸ラスナ  :(  :('
              : '0xFFFFF800`0078D700 BODY_STILL_IN_CHAIR';
        ctx.fillText(msg, gx, gy);
      }
      ctx.restore();
    }

    // Authentic QR Code + Support / Stop Code section at bottom
    const qrY = 738;
    const qrSize = 178;
    const qrCorruption = Math.max(0, (stage - 1) * 0.25);
    this.drawQrCode(ctx, leftX, qrY, qrSize, qrCorruption);

    const infoX = leftX + qrSize + 38;
    ctx.fillStyle = '#ffffff';
    ctx.font = `300 25px ${fontStack}`;
    ctx.fillText(
      stage < 3
        ? 'この問題と可能な解決方法の詳細については、https://www.windows.com/stopcode を参照してください'
        : 'この問題に解決方法はありません。画面の奥へ進んでください: https://0x0078d7/void',
      infoX,
      qrY + 38
    );

    ctx.font = `300 22px ${fontStack}`;
    ctx.fillText(
      stage < 2
        ? 'サポート担当者に連絡する場合は、次の情報を伝えてください:'
        : '誰も応答しません。次の停止コードがあなたを記録しています:',
      infoX,
      qrY + 108
    );

    const stopCodes = [
      'CRITICAL_PROCESS_DIED',
      'KERNEL_DATA_INPAGE_ERROR',
      'UNHANDLED_OBSERVER_EXCEPTION',
      'REALITY_BOUNDARY_CORRUPTION',
      'CONSCIOUSNESS_DEVOUR_INITIATED',
      'NO_ESCAPE_FROM_BLUE_SCREEN',
    ];
    const code = stopCodes[Math.min(stage, stopCodes.length - 1)];
    ctx.fillText(`停止コード: ${code}`, infoX, qrY + 148);

    this.bodyTex.needsUpdate = true;
  }

  /**
   * Checks whether a given monitor UV coordinate hovers over the ':(' face hitbox
   * (adapts as ':(' swells toward center during escalating clicks!)
   */
  public isUvOnFace(uv: THREE.Vector2, madness: number): boolean {
    const cx = THREE.MathUtils.lerp(0.185, 0.48, THREE.MathUtils.smoothstep(madness, 0.12, 0.88));
    const cy = THREE.MathUtils.lerp(0.705, 0.52, THREE.MathUtils.smoothstep(madness, 0.12, 0.88));
    const rx = THREE.MathUtils.lerp(0.115, 0.34, madness);
    const ry = THREE.MathUtils.lerp(0.175, 0.36, madness);
    const dx = (uv.x - cx) / rx;
    const dy = (uv.y - cy) / ry;
    return dx * dx + dy * dy <= 1.0;
  }

  /**
   * Toggle stencil clipping off once the player's head physically crosses into the throat tunnel
   */
  public setInsideTunnelMode(inside: boolean): void {
    for (const mat of this.throatMaterials) {
      mat.stencilWrite = !inside;
      mat.needsUpdate = true;
    }
    this.throatTubeMat.depthFunc = inside ? THREE.LessEqualDepth : THREE.AlwaysDepth;
    this.stencilMaskMesh.visible = !inside && this.throatGroup.visible;
  }

  /** Start a crack running along the '(' stroke (called on every click). */
  public pulseCrack(): void {
    this.crackRun = 0;
  }

  public update(dt: number, elapsed: number, state: BsodScreenState, clickPulse: number): void {
    const stage = Math.min(5, state.clickCount);
    if (stage !== this.lastRenderedStage || state.aftermath !== this.lastAftermath) {
      this.lastRenderedStage = stage;
      this.lastAftermath = state.aftermath;
      this.drawBsodStage(stage, state.aftermath);
    }

    const u = this.screenMat.uniforms;
    u.uTime.value = elapsed;
    u.uHover.value = THREE.MathUtils.lerp(u.uHover.value, state.hoverFace ? 1.0 : 0.0, Math.min(1, dt * 12));
    u.uCursorUv.value.copy(state.cursorUv);
    u.uMadness.value = state.madness;
    u.uJawOpen.value = state.jawOpen;
    u.uClickPulse.value = clickPulse;
    this.crackRun = Math.min(1, this.crackRun + dt / 0.42);
    u.uCrackRun.value = this.crackRun;
    u.uAftermath.value = state.aftermath ? 1.0 : 0.0;

    // Monitor light intensifies and pulses frantically during BSOD madness, or dims to eerie glow in aftermath
    if (state.aftermath) {
      this.monitorLight.color.setHex(0x1358a8);
      this.monitorLight.intensity = 0.38 + Math.sin(elapsed * 2.1) * 0.04;
    } else {
      const flicker =
        state.madness > 0.05
          ? Math.sin(elapsed * 47.0) * 0.45 * state.madness + clickPulse * 2.2
          : Math.sin(elapsed * 3.2) * 0.03;
      this.monitorLight.color.setHex(0x0078d7);
      this.monitorLight.intensity = Math.max(0.4, 2.25 + state.madness * 4.2 + flicker);
      this.monitorLight.distance = 6.2 + state.madness * 5.0;
    }

    // Update 3D Abyssal Monitor Throat Tunnel & Zero-Gravity Shattered LCD Glass Shards!
    const showThroat = !state.aftermath && state.jawOpen > 0.01;
    this.throatGroup.visible = showThroat;
    this.glassShards.visible = showThroat && state.suctionProgress < 0.65;
    if (this.throatMaterials[0]?.stencilWrite) {
      this.stencilMaskMesh.visible = showThroat;
    }

    if (showThroat) {
      this.throatTubeMat.uniforms.uTime.value = elapsed;
      this.throatTubeMat.uniforms.uMadness.value = state.madness;
      this.throatTubeMat.uniforms.uSuction.value = state.suctionProgress;
      this.throatRingMat.opacity = THREE.MathUtils.lerp(0.12, 0.80, THREE.MathUtils.smoothstep(state.suctionProgress, 0.05, 0.45));

      // Eerie slow-motion zero-gravity LCD glass shards peeling off the fractured ':(' screen toward your face!
      if (this.glassShards.visible) {
        this.glassShardMat.uniforms.uTime.value = elapsed;
        const mBlend = THREE.MathUtils.smoothstep(state.madness, 0.12, 0.88);
        const uvCx = THREE.MathUtils.lerp(0.178, 0.48, mBlend);
        const uvCy = THREE.MathUtils.lerp(0.705, 0.52, mBlend);
        const faceScale = THREE.MathUtils.lerp(0.255, 0.92, THREE.MathUtils.smoothstep(state.madness, 0.10, 0.92));
        const rotFrac = THREE.MathUtils.smoothstep(state.madness, 0.22, 0.78);
        const mouthX = (uvCx - 0.5) * BsodScreen.LOCAL_W + (1.0 - rotFrac) * 0.08 * faceScale;
        const mouthY = (uvCy - 0.5) * BsodScreen.LOCAL_H - rotFrac * 0.10 * faceScale;

        for (let i = 0; i < GLASS_SHARD_COUNT; i++) {
          const seed = (i * 0.61803398875) % 1;
          const ang = (i / GLASS_SHARD_COUNT) * Math.PI * 2 + Math.sin(elapsed * 0.45 + i) * 0.15;
          const ringR = (0.14 + state.jawOpen * (0.34 + seed * 0.46)) * faceScale;
          // Shards drift outward in eerie zero-G (+Z up to 0.95 local units!) and then get sucked backward down the rift!
          const driftOut = state.jawOpen * (0.08 + seed * 0.68) + clickPulse * 0.12 - state.suctionProgress * 2.8;
          const px = mouthX + Math.cos(ang) * ringR * 1.15;
          const py = mouthY + Math.sin(ang) * ringR * 0.95 + Math.sin(elapsed * 1.6 + i * 1.7) * 0.025;
          const pz = driftOut;

          this.ringDummy.position.set(px, py, pz);
          this.ringDummy.rotation.set(
            elapsed * (0.7 + seed * 1.4) + i,
            elapsed * (0.9 - seed * 1.3) + i * 2.1,
            ang + elapsed * 0.5
          );
          const sc = THREE.MathUtils.smoothstep(state.jawOpen, 0.01, 0.22) * (0.45 + seed * 1.25);
          this.ringDummy.scale.set(sc * (0.6 + (i % 3) * 0.45), sc * (1.1 + (i % 2) * 0.6), 1.0);
          this.ringDummy.updateMatrix();
          this.glassShards.setMatrixAt(i, this.ringDummy.matrix);
        }
        this.glassShards.instanceMatrix.needsUpdate = true;
      }

      const rushSpeed = 5.0 + state.madness * 9.0 + state.suctionProgress * 38.0;

      // Animate receding frame ribs rushing toward the viewer down the full 112-unit throat
      for (let i = 0; i < THROAT_RING_COUNT; i++) {
        const zSpan = 110.0;
        const z = -(((i * (zSpan / THROAT_RING_COUNT) - elapsed * rushSpeed) % zSpan + zSpan) % zSpan) - 0.4;
        const depthT = -z / zSpan;
        const s = 0.72 + depthT * 3.1;
        const wobbleX = Math.sin(z * 0.045 + elapsed * 2.0) * 0.32 * depthT;
        const wobbleY = Math.cos(z * 0.04 + elapsed * 1.8) * 0.26 * depthT;
        this.ringDummy.position.set(wobbleX, wobbleY, z);
        this.ringDummy.rotation.set(0, 0, Math.sin(elapsed * 1.5 + i * 0.4) * 0.22 * state.madness);
        this.ringDummy.scale.set(s * 1.45, s * 0.85, 1);
        this.ringDummy.updateMatrix();
        this.throatRings.setMatrixAt(i, this.ringDummy.matrix);
      }
      this.throatRings.instanceMatrix.needsUpdate = true;

      // Animate spiraling UI shards
      for (let i = 0; i < THROAT_SHARD_COUNT; i++) {
        const sd = this.shardData[i];
        sd.z += dt * (sd.speed + state.suctionProgress * 34.0);
        if (sd.z > -0.2) sd.z = -110.0;
        const a = sd.angle + elapsed * 0.9 + sd.z * 0.05;
        const rad = sd.radius * (0.45 + (-sd.z / 110.0) * 1.6);
        this.ringDummy.position.set(Math.cos(a) * rad, Math.sin(a) * rad * 0.78, sd.z);
        this.ringDummy.rotation.set(
          elapsed * sd.rotSpeed.x,
          elapsed * sd.rotSpeed.y,
          elapsed * sd.rotSpeed.z
        );
        this.ringDummy.scale.copy(sd.scale);
        this.ringDummy.updateMatrix();
        this.throatShards.setMatrixAt(i, this.ringDummy.matrix);
      }
      this.throatShards.instanceMatrix.needsUpdate = true;

      // Animate 140 blazing hyperspace data-stream speed lines!
      const lineBoost = 1.0 + state.suctionProgress * 3.6;
      for (let i = 0; i < this.lineData.length; i++) {
        const ld = this.lineData[i];
        ld.z += dt * ld.speed * lineBoost;
        if (ld.z > 1.5) ld.z = -112.0;
        const depthT = Math.max(0, -ld.z / 112.0);
        const swirl = ld.angle + ld.z * 0.025 + elapsed * 0.5;
        const r = ld.radius * (0.42 + depthT * 1.75);
        const wx = Math.sin(ld.z * 0.045 + elapsed * 1.8) * 0.3 * depthT;
        const wy = Math.cos(ld.z * 0.04 + elapsed * 1.6) * 0.24 * depthT;
        this.ringDummy.position.set(
          Math.cos(swirl) * r + wx,
          Math.sin(swirl) * r * 0.78 + wy,
          ld.z
        );
        this.ringDummy.rotation.set(0, 0, swirl);
        this.ringDummy.scale.set(
          0.7 + state.suctionProgress * 0.9,
          0.7 + state.suctionProgress * 0.9,
          ld.len * (0.65 + state.suctionProgress * 2.2)
        );
        this.ringDummy.updateMatrix();
        this.throatLines.setMatrixAt(i, this.ringDummy.matrix);
      }
      this.throatLines.instanceMatrix.needsUpdate = true;
    }
  }
}
