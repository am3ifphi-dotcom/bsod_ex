import * as THREE from 'three';
import { getSharedNoiseTexture } from '../utils/ProceduralNoise';

/**
 * ============================================================================
 *  BSOD SCREEN — "THE SCREEN DOES NOT BREAK"
 * ============================================================================
 *
 *  Design premise (complete rewrite, not a polish pass):
 *
 *  The old screen tried to scare you by *adding* things — a 3D jaw, teeth,
 *  eyeballs, a throat, LiDAR readouts of a monster behind the chair, dialog
 *  boxes that literally explained which cranial nerve was being unmounted.
 *  Every one of those is a confession that the image itself wasn't working.
 *
 *  This one does the opposite. For almost the entire act the panel is a
 *  *perfect, unmoving, authentic* Windows stop screen. Nothing glitches.
 *  Nothing opens. Nothing grows teeth. The horror is that a machine that is
 *  defined by being frozen starts quietly disagreeing with you, one glyph at
 *  a time, and you cannot prove when it happened.
 *
 *  Six stages, five of which are visually almost identical:
 *    0  authentic stop screen
 *    1  identical  (the pause that makes you doubt stage 0)
 *    2  one word changes:  「PC を」→「あなたを」
 *    3  one glyph changes:  :(  →  :)   (same font, same pixel position)
 *    4  the stop code changes + a reflection of your room appears in the glass
 *    5  the panel goes black; only a phosphor after-image remains
 *
 *  The devouring is no longer an anatomical mouth. It is an infinite stack of
 *  identical stop-screen *pages* receding into the display buffer — a data
 *  conduit that shares its palette with GlitchWorld's arrival sleeve, so the
 *  handoff reads as one continuous place rather than a monster's gullet.
 * ============================================================================
 */

export interface BsodScreenState {
  hoverFace: boolean;
  cursorUv: THREE.Vector2;
  clickCount: number;   // authored stage index 0..5 (timeline-driven, NOT a click counter)
  madness: number;      // 0..1 ambient wrongness (kept subtle on purpose)
  jawOpen: number;      // legacy channel: now drives the page-stack aperture
  suctionProgress: number;
  aftermath: boolean;
}

const PAGE_COUNT = 220;

/** Deterministic QR-ish matrix. No random() so every bake is byte-identical. */
function qrCellOn(r: number, c: number, modules: number): boolean {
  const finder = (fr: number, fc: number): boolean => {
    const dr = r - fr;
    const dc = c - fc;
    if (dr < 0 || dr > 6 || dc < 0 || dc > 6) return false;
    if (dr === 0 || dr === 6 || dc === 0 || dc === 6) return true;
    return dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
  };
  if (r < 8 && c < 8) return finder(0, 0);
  if (r < 8 && c >= modules - 8) return finder(0, modules - 7);
  if (r >= modules - 8 && c < 8) return finder(modules - 7, 0);
  if (r === 6 || c === 6) return (r + c) % 2 === 0;
  const h = Math.sin((r * 37 + c * 91 + 19) * 12.9898) * 43758.5453;
  return h - Math.floor(h) > 0.47;
}

export class BsodScreen {
  public static readonly LOCAL_W = 1.90566;
  public static readonly LOCAL_H = 1.0;

  public readonly root = new THREE.Group();
  public readonly hitboxMesh: THREE.Mesh;
  public readonly monitorLight: THREE.PointLight;
  public readonly screenMesh: THREE.Mesh;
  public readonly screenMat: THREE.ShaderMaterial;

  /** Kept as a named, always-hidden group for tooling / warm-up compatibility. */
  public readonly parasyteGroup = new THREE.Group();
  public readonly throatTeeth = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshBasicMaterial({ visible: false })
  );

  private readonly stageTextures: THREE.CanvasTexture[] = [];
  private readonly aftermathTex: THREE.CanvasTexture;
  private readonly pageTex: THREE.CanvasTexture;
  private readonly noiseTex: THREE.Texture;

  private readonly pageGroup = new THREE.Group();
  /** Public so warm-up and smoke tooling can inspect the conduit. */
  public readonly throatGroup = this.pageGroup;
  private readonly pageMat: THREE.ShaderMaterial;
  private readonly tubeMat: THREE.ShaderMaterial;

  private lastRenderedStage = -1;
  private lastAftermath = false;
  private prevStage = 0;
  private stageMix = 1;
  private pulseOverride = 0;
  private insideTunnelMode = false;

  constructor() {
    this.noiseTex = getSharedNoiseTexture();

    // Six near-identical bakes. The point is that they are almost the SAME image.
    for (let s = 0; s <= 5; s++) this.stageTextures.push(this.bakeStageTexture(s, false));
    this.aftermathTex = this.bakeStageTexture(0, true);

    // A single stop-screen "page" used by the infinite receding stack.
    this.pageTex = this.bakePageTexture();

    // ------------------------------------------------------------------ screen
    this.screenMat = new THREE.ShaderMaterial({
      uniforms: {
        uBodyTex: { value: this.stageTextures[0] },
        uPrevTex: { value: this.stageTextures[0] },
        uMix: { value: 1 },
        uTime: { value: 0 },
        uGaze: { value: 0 },
        uCursorUv: { value: new THREE.Vector2(0.5, 0.5) },
        uPulse: { value: 0 },
        uMadness: { value: 0 },
        uSuction: { value: 0 },
        uBlackout: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        uniform sampler2D uBodyTex;
        uniform sampler2D uPrevTex;
        uniform float uMix;
        uniform float uTime;
        uniform float uGaze;
        uniform float uPulse;
        uniform float uMadness;
        uniform float uSuction;
        uniform float uBlackout;
        uniform vec2 uCursorUv;

        float hash21(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }

        void main() {
          vec2 uv = vUv;

          // ---- the panel itself ------------------------------------------------
          // A 90ms dissolve between two near-identical images. Nobody can point at
          // the frame where it changed; that is the whole trick.
          float dissolve = smoothstep(uMix - 0.16, uMix + 0.16, hash21(floor(uv * vec2(190.0, 100.0))));
          vec3 cur = texture2D(uBodyTex, uv).rgb;
          vec3 prev = texture2D(uPrevTex, uv).rgb;
          vec3 col = mix(prev, cur, dissolve);

          // Clicking "works" for 0.22s: the panel snaps back to stage 0, then the
          // machine overwrites it again. The player's agency is acknowledged and refused.
          vec3 pristine = texture2D(uPrevTex, uv).rgb;
          col = mix(col, pristine, uPulse * 0.86);

          // ---- phosphor, not special effects ----------------------------------
          float scan = 0.5 + 0.5 * sin(uv.y * 1074.0 * 3.14159);
          col *= 1.0 - scan * 0.021;
          float breathe = 0.5 + 0.5 * sin(uTime * 1.7 + uv.x * 2.0);
          col *= 1.0 + breathe * 0.006;

          // Being looked at makes the blue a fraction deeper. Almost imperceptible,
          // but the room light (driven in update()) answers it in kind.
          col *= 1.0 - uGaze * vec3(0.010, 0.020, 0.038);

          // A cursor-shaped smudge on the glass. Not a ripple, not a crack.
          vec2 d = (uv - uCursorUv) * vec2(1.9, 1.0);
          float smudge = exp(-dot(d, d) * 420.0);
          col += vec3(0.010, 0.026, 0.052) * smudge * (0.35 + uGaze * 0.65);

          // One-frame broadcast slip, only during the actual transfer. Nowhere else.
          float slipBand = step(0.994, hash21(vec2(floor(uTime * 11.0), floor(uv.y * 30.0))));
          float shear = slipBand * uSuction * 0.018;
          col = mix(col, texture2D(uBodyTex, uv + vec2(shear, 0.0)).rgb, slipBand * uSuction);

          // ---- blackout: the panel simply switches off ------------------------
          col *= 1.0 - uBlackout;
          float after = exp(-dot((uv - vec2(0.5, 0.5)) * vec2(1.9, 1.0), (uv - vec2(0.5, 0.5)) * vec2(1.9, 1.0)) * 6.0);
          col += vec3(0.008, 0.026, 0.062) * after * uBlackout * (0.6 + 0.4 * sin(uTime * 2.3));

          // Faint chromatic fringing on the glass edge only, never on the text.
          float edge = smoothstep(0.42, 0.5, abs(uv.x - 0.5));
          col.r *= 1.0 + edge * 0.012 + uMadness * 0.006;

          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });

    const screenGeo = new THREE.PlaneGeometry(BsodScreen.LOCAL_W, BsodScreen.LOCAL_H, 1, 1);
    this.screenMesh = new THREE.Mesh(screenGeo, this.screenMat);
    this.screenMesh.renderOrder = 0;
    this.root.add(this.screenMesh);

    // Invisible 2-triangle raycast plane.
    const hitGeo = new THREE.PlaneGeometry(BsodScreen.LOCAL_W, BsodScreen.LOCAL_H, 1, 1);
    this.hitboxMesh = new THREE.Mesh(
      hitGeo,
      new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide })
    );
    this.hitboxMesh.position.z = 0.004;
    this.root.add(this.hitboxMesh);

    this.monitorLight = new THREE.PointLight(0x1b8cff, 2.35, 6.5, 1.6);
    this.monitorLight.position.set(0, 0.04, 0.26);
    this.root.add(this.monitorLight);

    // ------------------------------------------- infinite stop-screen page stack
    // Not a throat. Not flesh. A conduit made of the same document, repeated,
    // each copy one row out of register with the last.
    const tubeGeo = new THREE.CylinderGeometry(1.42, 5.6, 116, 28, 24, true);
    tubeGeo.rotateX(Math.PI * 0.5);
    tubeGeo.translate(0, 0, -58.02);

    this.tubeMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: true,
      uniforms: {
        uTime: { value: 0 },
        uScrollPhase: { value: 0 },
        uSuction: { value: 0 },
        uNoiseTex: { value: this.noiseTex },
      },
      vertexShader: /* glsl */ `
        varying vec3 vPos;
        varying vec2 vUv;
        uniform float uTime;
        uniform float uSuction;
        void main() {
          vUv = uv;
          vec3 p = position;
          // Slice shear: whole horizontal bands of the conduit slip a few pixels
          // sideways, the way a display buffer loses sync one row at a time.
          float band = floor(-p.z * 1.7 + uTime * 5.0);
          float jitter = sin(band * 12.9898) * 43758.5453;
          jitter = fract(jitter) - 0.5;
          p.x += jitter * 0.34 * (0.25 + uSuction * 0.75) * smoothstep(-2.0, -16.0, p.z);
          vPos = p;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vPos;
        varying vec2 vUv;
        uniform float uTime;
        uniform float uScrollPhase;
        uniform float uSuction;
        uniform sampler2D uNoiseTex;

        void main() {
          float depth = clamp(-vPos.z / 115.0, 0.0, 1.0);
          float z = vPos.z * 0.62 + uScrollPhase;
          float safeX = (abs(vPos.x) < 1e-5 && abs(vPos.y) < 1e-5) ? 1e-5 : vPos.x;
          float ang = atan(vPos.y, safeX);
          vec4 n = texture2D(uNoiseTex, vec2(ang * 0.3183, vPos.z * 0.025 + uTime * 0.11));

          // Document rules: evenly spaced hairlines like ruled memory pages.
          vec2 cell = vec2(ang * 6.366, z);
          vec2 f = fract(cell);
          float rule = smoothstep(0.055, 0.0, min(f.y, 1.0 - f.y));
          float gutter = smoothstep(0.045, 0.0, min(f.x, 1.0 - f.x));

          // Long luminous traces = unformatted bytes still streaming past.
          float traceA = pow(max(0.0, sin(ang * 6.0 + vPos.z * 0.22 + uScrollPhase * 0.358)), 12.0);
          float traceB = pow(max(0.0, cos(ang * 10.0 - vPos.z * 0.16 + uScrollPhase * 0.265)), 14.0);
          float shock = smoothstep(0.93, 1.0, fract(vPos.z * 0.09 + uScrollPhase * 0.146));

          // Palette matches GlitchWorld's arrival sleeve exactly: no crimson,
          // no organic gradient, so the handoff is one continuous architecture.
          vec3 deep = vec3(0.004, 0.065, 0.28);
          vec3 mid = vec3(0.008, 0.14, 0.48);
          vec3 sleeve = mix(deep, mid, smoothstep(0.55, 0.94, depth));
          vec3 col = mix(vec3(0.001, 0.018, 0.070), sleeve, smoothstep(0.04, 0.52, depth));
          col += vec3(0.06, 0.38, 0.80) * pow(n.a, 2.8) * (1.0 - depth) * 0.35;

          col += vec3(0.28, 0.76, 1.0) * rule * mix(0.10, 0.50, depth);
          col += vec3(0.16, 0.50, 0.92) * gutter * 0.10;
          col += vec3(0.34, 0.86, 1.0) * (traceA * 0.55 + traceB * 0.45) * mix(0.12, 0.92, depth);
          col += vec3(0.70, 0.94, 1.0) * shock * mix(0.08, 0.68, depth);

          // Far aperture: a clean luminous rift, zero silhouette, zero teeth.
          float portal = smoothstep(0.90, 0.995, depth);
          vec2 radial = vPos.xy / 5.6;
          float r = length(radial);
          vec3 sky = mix(vec3(0.004, 0.032, 0.11), vec3(0.012, 0.24, 0.76),
                         smoothstep(-0.32, 0.06, clamp(radial.y * 0.55 + 0.18, -0.35, 1.0)));
          sky = mix(sky, vec3(0.002, 0.014, 0.064),
                    smoothstep(0.06, 0.68, clamp(radial.y * 0.55 + 0.18, -0.35, 1.0)));
          sky += vec3(0.58, 0.90, 1.0) * exp(-length((radial - vec2(0.0, 0.24)) * vec2(0.85, 1.15)) * 3.2) * 0.62;
          sky += vec3(0.28, 0.78, 1.0) * exp(-pow((r - 0.88) * 6.0, 2.0)) * 0.42;
          col = mix(col, sky, portal);

          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });

    const tubeMesh = new THREE.Mesh(tubeGeo, this.tubeMat);
    this.pageGroup.add(tubeMesh);

    // Thin luminous "page edges" flying toward the camera. One draw call, all GPU.
    this.pageMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uScrollPhase: { value: 0 },
        uSuction: { value: 0 },
        uPageTex: { value: this.pageTex },
      },
      vertexShader: /* glsl */ `
        attribute vec4 aPage; // x: lateral offset, y: vertical offset, z: depth 0..1, w: seed
        varying vec2 vUv;
        varying float vFade;
        varying float vSeed;
        uniform float uTime;
        uniform float uScrollPhase;
        uniform float uSuction;
        void main() {
          vUv = uv;
          vSeed = aPage.w;
          float travel = fract(aPage.z + uScrollPhase * 0.014 + uTime * 0.010 * uSuction);
          float z = -1.5 - travel * 112.0;
          float scale = 1.5 + travel * 4.6;
          vec3 p = position * vec3(scale, scale * 0.56, 1.0);
          p.z = z;
          p.x += aPage.x * (0.6 + travel * 3.0);
          p.y += aPage.y * (0.4 + travel * 2.0);
          // Every seventh page is one row out of register.
          p.x += step(0.86, fract(aPage.w * 7.13)) * 0.42 * sin(uTime * 3.0 + aPage.w * 41.0);
          vFade = smoothstep(0.0, 0.10, travel) * (1.0 - smoothstep(0.82, 1.0, travel));
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        varying float vFade;
        varying float vSeed;
        uniform sampler2D uPageTex;
        uniform float uSuction;
        void main() {
          vec4 page = texture2D(uPageTex, vUv);
          // Only the ruled edges and the glyph ghosts survive at this scale.
          float edge = 1.0 - smoothstep(0.0, 0.055, min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y)));
          float a = (page.a * 0.30 + edge * 0.34) * vFade * (0.32 + uSuction * 0.68);
          gl_FragColor = vec4(page.rgb * vec3(0.38, 0.76, 1.0) + vec3(0.03, 0.12, 0.30) * edge, a);
        }
      `,
    });

    const pageGeo = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1, 1, 1);
    pageGeo.index = quad.index;
    pageGeo.attributes.position = quad.attributes.position;
    pageGeo.attributes.uv = quad.attributes.uv;
    const pageData = new Float32Array(PAGE_COUNT * 4);
    for (let i = 0; i < PAGE_COUNT; i++) {
      const t = i / PAGE_COUNT;
      pageData[i * 4 + 0] = Math.sin(i * 12.9898) * 0.5;
      pageData[i * 4 + 1] = Math.cos(i * 7.717) * 0.5;
      pageData[i * 4 + 2] = t;
      pageData[i * 4 + 3] = (i * 0.6180339887) % 1;
    }
    pageGeo.setAttribute('aPage', new THREE.InstancedBufferAttribute(pageData, 4));
    pageGeo.instanceCount = PAGE_COUNT;
    const pages = new THREE.Mesh(pageGeo, this.pageMat);
    pages.frustumCulled = false;
    pages.renderOrder = 3;
    this.pageGroup.add(pages);

    this.pageGroup.visible = false;
    this.root.add(this.pageGroup);

    // The legacy anatomical rig is deliberately never added to the scene graph.
    this.parasyteGroup.visible = false;
    this.throatTeeth.visible = false;
  }

  // --------------------------------------------------------------------------
  //  Canvas bakes
  // --------------------------------------------------------------------------

  /** One authentic stop screen, parameterised by a handful of *micro* differences. */
  private bakeStageTexture(stage: number, aftermath: boolean): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 2048;
    canvas.height = 1074;
    const ctx = canvas.getContext('2d')!;
    const W = 2048;
    const H = 1074;
    const FONT = '"Segoe UI", "Yu Gothic UI", "Meiryo", sans-serif';
    const MONO = 'Consolas, "Yu Gothic UI", monospace';

    const finalize = (): THREE.CanvasTexture => {
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
      // After the fall, the machine has politely finished its work. It is off.
      ctx.fillStyle = '#040b16';
      ctx.fillRect(0, 0, W, H);
      ctx.save();
      ctx.globalAlpha = 0.045;
      ctx.fillStyle = '#8fc9ff';
      for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 1);
      ctx.restore();
      const vg = ctx.createRadialGradient(W * 0.5, H * 0.48, H * 0.08, W * 0.5, H * 0.5, H * 0.82);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(0,0,0,0.80)');
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, W, H);

      ctx.fillStyle = 'rgba(140, 205, 255, 0.10)';
      ctx.font = `300 190px ${FONT}`;
      ctx.fillText(':)', 226, 360);

      ctx.fillStyle = 'rgba(150, 205, 255, 0.42)';
      ctx.font = `300 26px ${MONO}`;
      ctx.fillText('KERNEL CRASH DUMP  //  SESSION RESTORED   02:48:00', 232, 492);
      ctx.fillText('DUMP_IMAGE  : C:\\Windows\\MEMORY_0247.DMP', 232, 546);
      ctx.fillText('INTERRUPT   : WAKE_UP', 232, 600);
      ctx.fillStyle = 'rgba(150, 205, 255, 0.22)';
      ctx.fillText('1 HANDLE STILL OPEN', 232, 654);
      return finalize();
    }

    if (stage >= 5) {
      // Stage 5 — the panel switches off. No face, no message, no explanation.
      ctx.fillStyle = '#00040c';
      ctx.fillRect(0, 0, W, H);
      ctx.save();
      ctx.globalAlpha = 0.035;
      ctx.fillStyle = '#a8d8ff';
      for (let y = 0; y < H; y += 5) ctx.fillRect(0, y, W, 1);
      ctx.restore();
      ctx.fillStyle = 'rgba(170, 220, 255, 0.055)';
      ctx.font = `300 330px ${FONT}`;
      ctx.fillText(':)', 214, 430);
      return finalize();
    }

    // ---- THE authentic image. Identical at stages 0 and 1. ------------------
    ctx.fillStyle = '#0078d7';
    ctx.fillRect(0, 0, W, H);

    const leftX = 232;

    // ':( ' — stage 3 flips exactly one glyph, in the same font, same baseline.
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `300 300px ${FONT}`;
    ctx.fillText(stage >= 3 ? ':)' : ':(', leftX, 420);

    ctx.font = `300 47px ${FONT}`;
    ctx.fillText(
      stage >= 2
        ? '問題が発生したため、あなたを再起動する必要があります。'
        : '問題が発生したため、PC を再起動する必要があります。',
      leftX,
      492
    );
    ctx.fillText('エラー情報を収集しています。自動的に再起動します。', leftX, 558);
    ctx.fillText('99% 完了', leftX, 668);

    // QR + support block, byte-identical across all stages except stage 4,
    // where one single module inverts. No eye, no corruption, no animation.
    const qrY = 738;
    const qrSize = 178;
    const modules = 29;
    const pad = Math.round(qrSize * 0.085);
    const cell = (qrSize - pad * 2) / modules;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(leftX, qrY, qrSize, qrSize);
    ctx.fillStyle = '#0078d7';
    for (let r = 0; r < modules; r++) {
      for (let c = 0; c < modules; c++) {
        let on = qrCellOn(r, c, modules);
        if (stage >= 4 && r === 14 && c === 14) on = !on;
        if (on) {
          ctx.fillRect(
            leftX + pad + c * cell,
            qrY + pad + r * cell,
            Math.ceil(cell * 0.98),
            Math.ceil(cell * 0.98)
          );
        }
      }
    }

    const infoX = leftX + qrSize + 38;
    ctx.fillStyle = '#ffffff';
    ctx.font = `300 25px ${FONT}`;
    ctx.fillText(
      'この問題と可能な解決方法の詳細については、https://www.windows.com/stopcode を参照してください',
      infoX,
      qrY + 38
    );
    ctx.font = `300 22px ${FONT}`;
    ctx.fillText('サポート担当者に連絡する場合は、次の情報を伝えてください:', infoX, qrY + 108);
    ctx.fillText(
      stage >= 4 ? '停止コード: CRITICAL_OBSERVER_DIED' : '停止コード: CRITICAL_PROCESS_DIED',
      infoX,
      qrY + 148
    );

    // Stage 4: a reflection in the glass. A chair, rotated a few degrees, and a
    // vertical softness behind it. NEVER labelled, never outlined in red.
    if (stage >= 4) {
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = 0.075;
      ctx.translate(W - 320, H - 210);
      ctx.rotate(-0.14);
      ctx.fillStyle = '#cfe9ff';
      ctx.beginPath();
      ctx.ellipse(0, -86, 54, 66, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(-58, -20, 116, 148);
      ctx.fillRect(-96, 4, 38, 20);
      ctx.fillRect(58, 4, 38, 20);
      ctx.restore();
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      const g = ctx.createLinearGradient(0, H - 640, 0, H - 60);
      g.addColorStop(0, 'rgba(190, 225, 255, 0)');
      g.addColorStop(0.42, 'rgba(190, 225, 255, 0.055)');
      g.addColorStop(1, 'rgba(190, 225, 255, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(W - 470, H - 640, 116, 580);
      ctx.restore();
    }

    return finalize();
  }

  /** Ruled page used by the conduit: ghost glyphs + hairline rules, alpha only. */
  private bakePageTexture(): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 288;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, 512, 288);
    ctx.fillStyle = 'rgba(120, 200, 255, 0.10)';
    ctx.font = '300 150px "Segoe UI", sans-serif';
    ctx.fillText(':(', 28, 176);
    ctx.fillStyle = 'rgba(150, 215, 255, 0.16)';
    ctx.font = '18px Consolas, monospace';
    ctx.fillText('0x000000F4  CRITICAL_PROCESS_DIED  99%', 210, 76);
    ctx.fillText('MEMORY_0247.DMP  /  PAGE_NOT_PRESENT', 210, 104);
    ctx.fillText('HOST_SESSION 02:47  /  RING0', 210, 132);
    ctx.fillStyle = 'rgba(140, 205, 255, 0.20)';
    for (let y = 168; y < 280; y += 14) ctx.fillRect(28, y, 456 - (y % 3) * 26, 1);
    ctx.strokeStyle = 'rgba(170, 225, 255, 0.28)';
    ctx.lineWidth = 2;
    ctx.strokeRect(2, 2, 508, 284);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    return tex;
  }

  // --------------------------------------------------------------------------
  //  Public API (unchanged surface, new meaning)
  // --------------------------------------------------------------------------

  public getAllTextures(): THREE.Texture[] {
    return [...this.stageTextures, this.aftermathTex, this.pageTex, this.noiseTex];
  }

  public setWarmupVisibility(active: boolean): void {
    this.pageGroup.visible = active;
    this.parasyteGroup.visible = false;
    this.throatTeeth.visible = false;
  }

  /** True while the cursor rests on the ':(' — i.e. while the player is staring. */
  public isUvOnFace(uv: THREE.Vector2, _madness = 0): boolean {
    const dx = (uv.x - 0.144) / 0.125;
    const dy = (uv.y - 0.742) / 0.165;
    return dx * dx + dy * dy <= 1.0;
  }

  public setInsideTunnelMode(inside: boolean): void {
    if (this.insideTunnelMode === inside) return;
    this.insideTunnelMode = inside;
    this.tubeMat.depthFunc = inside ? THREE.LessEqualDepth : THREE.AlwaysDepth;
  }

  /** A click no longer damages the screen; it briefly restores the pristine image. */
  public pulseCrack(_uv?: THREE.Vector2): void {
    this.pulseOverride = 1;
  }

  public update(
    dt: number,
    elapsed: number,
    state: BsodScreenState,
    _clickPulse: number,
    tunnelScrollPhase?: number
  ): void {
    const stage = Math.min(5, Math.max(0, Math.round(state.clickCount)));
    const u = this.screenMat.uniforms;

    if (stage !== this.lastRenderedStage || state.aftermath !== this.lastAftermath) {
      this.prevStage = this.lastRenderedStage < 0 ? stage : this.lastRenderedStage;
      this.lastRenderedStage = stage;
      this.lastAftermath = state.aftermath;
      u.uPrevTex.value = state.aftermath ? this.aftermathTex : this.stageTextures[this.prevStage];
      u.uBodyTex.value = state.aftermath ? this.aftermathTex : this.stageTextures[stage];
      this.stageMix = 0;
    }
    this.stageMix = Math.min(1, this.stageMix + dt / 0.09);
    u.uMix.value = this.stageMix;

    // Click = 0.22s of false control, then the machine overwrites you again.
    this.pulseOverride = Math.max(0, this.pulseOverride - dt / 0.22);
    u.uPulse.value = state.aftermath ? 0 : this.pulseOverride * (this.prevStage === 0 ? 0 : 1);

    u.uTime.value = elapsed;
    u.uGaze.value = THREE.MathUtils.lerp(u.uGaze.value, state.hoverFace ? 1 : 0, Math.min(1, dt * 3.2));
    u.uCursorUv.value.copy(state.cursorUv);
    u.uMadness.value = state.madness;
    u.uSuction.value = state.suctionProgress;
    u.uBlackout.value = state.aftermath
      ? 0
      : Math.max(stage >= 5 ? 1 : 0, THREE.MathUtils.smoothstep(state.jawOpen, 0.72, 1.0));

    // The room light *answers* the gaze instead of flickering like a haunted bulb.
    // Looking at the face makes the blue a few percent deeper; that's the only tell.
    if (state.aftermath) {
      this.monitorLight.color.setHex(0x123f78);
      this.monitorLight.intensity = 0.22;
      this.monitorLight.distance = 4.2;
    } else {
      const gazeDip = u.uGaze.value * 0.16;
      const blackout = 1 - u.uBlackout.value;
      this.monitorLight.color.setHex(0x1b8cff);
      this.monitorLight.intensity = Math.max(0.05, (2.35 - gazeDip + state.madness * 0.55) * blackout);
      this.monitorLight.distance = 6.5 + state.madness * 1.2;
    }

    // ---- infinite page conduit ---------------------------------------------
    const showConduit = !state.aftermath && state.suctionProgress > 0.02;
    this.pageGroup.visible = showConduit;
    this.parasyteGroup.visible = false;
    this.throatTeeth.visible = false;
    if (showConduit) {
      const scroll = tunnelScrollPhase ?? elapsed * (6 + state.suctionProgress * 42);
      this.tubeMat.uniforms.uTime.value = elapsed;
      this.tubeMat.uniforms.uScrollPhase.value = scroll;
      this.tubeMat.uniforms.uSuction.value = state.suctionProgress;
      this.pageMat.uniforms.uTime.value = elapsed;
      this.pageMat.uniforms.uScrollPhase.value = scroll;
      this.pageMat.uniforms.uSuction.value = state.suctionProgress;
    }
  }
}
