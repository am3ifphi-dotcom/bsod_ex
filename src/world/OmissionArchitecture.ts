import * as THREE from 'three';

/**
 * ============================================================================
 *  OMISSION ARCHITECTURE
 * ============================================================================
 *
 *  "もっととんでもない造形残り方" taken literally: buildings whose *existence*
 *  was cancelled halfway through rendering. Not broken, not exploded — the
 *  draw call simply stopped. Below the cut they are solid obsidian; above it
 *  they survive as wire, then as points, then as nothing. Luminous fibres hang
 *  from the flat cut plane like severed traces on a motherboard.
 *
 *  Around them: an omission field (12% of the geometry is simply absent this
 *  frame, leaving only an outline), strata of stop-screen pages with their
 *  right-hand 20% missing, data veins that terminate in a particle waterfall,
 *  and a storm of glyph fragments that REPLACES the old explanatory signboards.
 *  Information is no longer posted on a placard. It drifts through the air.
 *
 *  Everything here is GPU-instanced: ~12 draw calls, zero per-frame CPU matrix
 *  work, no per-frame allocations.
 * ============================================================================
 */

// Shared GLSL helpers, inlined into the shaders below by the validator and at
// runtime via template interpolation. Kept out of the /* glsl */ marker so the
// shader linter treats it as a fragment, not a standalone shader unit.
const HASH = `
  float hash11(float p) {
    p = fract(p * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
  }
`;

function rand(seed: number): number {
  const v = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return v - Math.floor(v);
}

/** Shared instanced quad/box helper: keeps the builders readable. */
function instancedFrom(base: THREE.BufferGeometry, count: number): THREE.InstancedBufferGeometry {
  const g = new THREE.InstancedBufferGeometry();
  g.index = base.index;
  g.attributes.position = base.attributes.position;
  g.attributes.normal = base.attributes.normal;
  g.attributes.uv = base.attributes.uv;
  g.instanceCount = count;
  return g;
}

export class OmissionArchitecture {
  public readonly group = new THREE.Group();
  private readonly materials: THREE.ShaderMaterial[] = [];
  private glyphTex!: THREE.CanvasTexture;
  private pageTex!: THREE.CanvasTexture;
  private built = false;
  private playerPos = new THREE.Vector3();

  constructor() {
    this.group.name = 'OmissionArchitecture';
  }

  public setWarmupVisibility(active: boolean): void {
    this.group.visible = true;
    // Warm-up only forces every shader program to compile; visibility is not
    // actually toggled off afterwards (this geometry is always present).
    if (active) this.update(0, 0, this.playerPos);
  }

  public update(elapsed: number, anomaly: number, playerPos: THREE.Vector3): void {
    if (!this.built) return;
    this.playerPos.copy(playerPos);
    for (const m of this.materials) {
      m.uniforms.uTime.value = elapsed;
      m.uniforms.uAnomaly.value = anomaly;
      if (m.uniforms.uPlayerPos) m.uniforms.uPlayerPos.value.copy(playerPos);
    }
  }

  public getAllTextures(): THREE.Texture[] {
    return [this.glyphTex, this.pageTex].filter(Boolean) as THREE.Texture[];
  }

  private register(mat: THREE.ShaderMaterial): THREE.ShaderMaterial {
    this.materials.push(mat);
    return mat;
  }

  // --------------------------------------------------------------------------
  //  ENTRY POINT
  // --------------------------------------------------------------------------
  public build(terrainHeight: (x: number, z: number) => number): void {
    if (this.built) return;
    this.built = true;

    this.glyphTex = this.makeGlyphAtlas();
    this.pageTex = this.makePageTexture();

    this.buildSeveredCathedrals(terrainHeight);
    this.buildOmissionField(terrainHeight);
    this.buildPageStrata();
    this.buildDataVeins();
    this.buildGlyphStorm(terrainHeight);
  }

  // --------------------------------------------------------------------------
  //  1. SEVERED CATHEDRALS — existence cancelled at y = 54m
  // --------------------------------------------------------------------------
  private buildSeveredCathedrals(terrainHeight: (x: number, z: number) => number): void {
    const sites = [
      { x: -37, z: -6, radius: 9.5, phase: 0.0 },
      { x: 35, z: -43, radius: 7.4, phase: 1.7 },
      { x: -27, z: -62, radius: 5.8, phase: 3.1 },
    ];
    const LEVELS = 46;
    const RIBS = 8;
    const BEAMS = 4;
    const perSite = LEVELS * (RIBS + BEAMS);
    const total = perSite * sites.length;

    const geo = instancedFrom(new THREE.BoxGeometry(1, 1, 1), total);
    const aOffset = new Float32Array(total * 3);
    const aScale = new Float32Array(total * 3);
    const aLevel = new Float32Array(total);
    const aSeed = new Float32Array(total);

    let n = 0;
    for (const site of sites) {
      const baseY = terrainHeight(site.x, site.z) - 1.5;
      for (let lv = 0; lv < LEVELS; lv++) {
        const t = lv / (LEVELS - 1);
        const y = baseY + lv * 3.55;
        const r = site.radius * (1.0 - t * 0.28);
        // The whole storey shears sideways a little more as it approaches the cut.
        const shear = Math.max(0, t - 0.30) * Math.sin(lv * 1.31 + site.phase) * 2.1;

        for (let k = 0; k < RIBS; k++) {
          const a = (k / RIBS) * Math.PI * 2 + site.phase;
          aOffset[n * 3 + 0] = site.x + Math.cos(a) * r + shear;
          aOffset[n * 3 + 1] = y;
          aOffset[n * 3 + 2] = site.z + Math.sin(a) * r + shear * 0.4;
          aScale[n * 3 + 0] = 1.15;
          aScale[n * 3 + 1] = 3.5;
          aScale[n * 3 + 2] = 1.15;
          aLevel[n] = t;
          aSeed[n] = rand(n * 1.37 + site.phase);
          n++;
        }
        for (let k = 0; k < BEAMS; k++) {
          const a = (k / BEAMS) * Math.PI * 2 + site.phase + Math.PI / 4;
          const bx = site.x + Math.cos(a) * r * 0.72 + shear;
          const bz = site.z + Math.sin(a) * r * 0.72 + shear * 0.4;
          aOffset[n * 3 + 0] = bx;
          aOffset[n * 3 + 1] = y + 1.75;
          aOffset[n * 3 + 2] = bz;
          const horizontal = k % 2 === 0;
          aScale[n * 3 + 0] = horizontal ? r * 1.5 : 0.42;
          aScale[n * 3 + 1] = 0.42;
          aScale[n * 3 + 2] = horizontal ? 0.42 : r * 1.5;
          aLevel[n] = t;
          aSeed[n] = rand(n * 2.11 + site.phase);
          n++;
        }
      }
    }
    geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(aOffset, 3));
    geo.setAttribute('aScale', new THREE.InstancedBufferAttribute(aScale, 3));
    geo.setAttribute('aLevel', new THREE.InstancedBufferAttribute(aLevel, 1));
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(aSeed, 1));

    const mat = this.register(new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uAnomaly: { value: 0 },
        uCut: { value: 0.335 },
      },
      vertexShader: /* glsl */ `
        attribute vec3 aOffset;
        attribute vec3 aScale;
        attribute float aLevel;
        attribute float aSeed;
        varying vec2 vUv;
        varying vec3 vLocal;
        varying float vAbove;
        varying float vSeed;
        uniform float uTime;
        uniform float uAnomaly;
        uniform float uCut;
        ${HASH}
        void main() {
          vUv = uv;
          vLocal = position;
          vSeed = aSeed;
          float above = aLevel - uCut;
          vAbove = above;

          // SOLID -> WIRE -> POINTS -> NOTHING. The defining silhouette of this world.
          float wire = smoothstep(0.0, 0.045, above) * (1.0 - smoothstep(0.095, 0.15, above));
          float dust = smoothstep(0.13, 0.19, above) * (1.0 - smoothstep(0.23, 0.30, above));
          float gone = smoothstep(0.27, 0.34, above);
          float shrink = 1.0 - wire * 0.80 - dust * 0.955 - gone * 0.998;
          vec3 p = position;
          p.xz *= shrink;

          // Above the cut, whole storeys slip a few centimetres out of register.
          float slip = step(0.0, above) * above;
          p.x += sin(floor(aLevel * 92.0) * 12.9 + uTime * 0.8 + aSeed * 8.0) * slip * 1.6;
          p.z += cos(floor(aLevel * 71.0) * 7.7 + uTime * 0.6) * slip * 1.1;

          // Anomaly surges make the unfinished portion twitch harder.
          p.x += hash11(aSeed + floor(uTime * 3.0)) * uAnomaly * above * 0.9;

          vec3 world = p * aScale + aOffset;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(world, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vLocal;
        varying float vAbove;
        varying float vSeed;
        uniform float uTime;
        uniform float uAnomaly;
        ${HASH}
        void main() {
          float e = 1.0 - smoothstep(0.0, 0.085, min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y)));

          float solid = 1.0 - smoothstep(-0.01, 0.05, vAbove);
          float wire = smoothstep(0.0, 0.05, vAbove) * (1.0 - smoothstep(0.10, 0.16, vAbove));
          float dust = smoothstep(0.14, 0.20, vAbove) * (1.0 - smoothstep(0.24, 0.31, vAbove));

          vec3 obsidian = vec3(0.006, 0.030, 0.095);
          vec3 neon = vec3(0.24, 0.76, 1.0);
          float scan = 0.5 + 0.5 * sin(vLocal.y * 46.0 - uTime * 2.4);

          vec3 col = obsidian * (0.5 + solid * 0.8);
          col += neon * e * (0.22 + solid * 0.55 + wire * 1.5);
          col += neon * scan * 0.045 * solid;
          col += vec3(0.55, 0.92, 1.0) * dust * 0.9;

          // The flat cut plane burns with a thin white-blue seam.
          col += vec3(0.62, 0.92, 1.0) * exp(-abs(vAbove) * 105.0) * 1.5;

          // Omission: a storey occasionally loses its FACES but keeps its outline.
          float omit = step(0.90 - uAnomaly * 0.16, hash11(vSeed + floor(uTime * 1.7)));
          if (omit > 0.5 && e < 0.35) discard;
          col += vec3(0.30, 0.72, 1.0) * omit * e * 0.8;

          gl_FragColor = vec4(col, 1.0);
        }
      `,
    }));

    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'SeveredCathedrals';
    mesh.frustumCulled = false;
    this.group.add(mesh);

    // ---- flat luminous cut planes + hanging severed traces -------------------
    const cutMat = this.register(new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uAnomaly: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        uniform float uTime;
        uniform float uAnomaly;
        ${HASH}
        void main() {
          vec2 p = vUv * 2.0 - 1.0;
          float r = length(p);
          if (r > 1.0) discard;
          float rings = pow(0.5 + 0.5 * sin(r * 88.0 - uTime * 1.6), 8.0);
          float raster = 0.5 + 0.5 * sin(vUv.y * 420.0);
          float spokes = pow(max(0.0, sin(atan(p.y, p.x) * 16.0 + uTime * 0.4)), 14.0);
          float a = (0.10 + rings * 0.42 + spokes * 0.18) * (1.0 - smoothstep(0.86, 1.0, r));
          a *= 0.75 + 0.25 * raster + uAnomaly * 0.3;
          gl_FragColor = vec4(vec3(0.32, 0.80, 1.0) * (0.7 + rings), a);
        }
      `,
    }));

    const FIBERS = 384;
    const fiberGeo = instancedFrom(new THREE.PlaneGeometry(1, 1), FIBERS);
    const fOff = new Float32Array(FIBERS * 3);
    const fLen = new Float32Array(FIBERS);
    const fSeed = new Float32Array(FIBERS);
    for (let i = 0; i < FIBERS; i++) {
      const site = sites[i % sites.length];
      const a = rand(i * 3.7) * Math.PI * 2;
      const r = Math.sqrt(rand(i * 5.3)) * site.radius * 0.92;
      const cutY = terrainHeight(site.x, site.z) - 1.5 + 0.335 * (LEVELS - 1) * 3.55;
      fOff[i * 3 + 0] = site.x + Math.cos(a) * r;
      fOff[i * 3 + 1] = cutY;
      fOff[i * 3 + 2] = site.z + Math.sin(a) * r;
      fLen[i] = 4 + rand(i * 7.1) * 26;
      fSeed[i] = rand(i * 9.13);
    }
    fiberGeo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(fOff, 3));
    fiberGeo.setAttribute('aLen', new THREE.InstancedBufferAttribute(fLen, 1));
    fiberGeo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(fSeed, 1));

    const fiberMat = this.register(new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uAnomaly: { value: 0 } },
      vertexShader: /* glsl */ `
        attribute vec3 aOffset;
        attribute float aLen;
        attribute float aSeed;
        varying vec2 vUv;
        varying float vSeed;
        uniform float uTime;
        uniform float uAnomaly;
        ${HASH}
        void main() {
          vUv = uv;
          vSeed = aSeed;
          // Camera-facing ribbon hanging straight down from the cut plane.
          vec4 mv = modelViewMatrix * vec4(aOffset, 1.0);
          float sway = sin(uTime * 0.7 + aSeed * 21.0) * (0.2 + uAnomaly * 0.5);
          mv.x += position.x * 0.055 + sway * (0.5 - uv.y);
          mv.y += (uv.y - 1.0) * aLen;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        varying float vSeed;
        uniform float uTime;
        uniform float uAnomaly;
        ${HASH}
        void main() {
          float edge = 1.0 - smoothstep(0.0, 0.5, abs(vUv.x - 0.5) * 2.0);
          float pulse = pow(0.5 + 0.5 * sin(vUv.y * 32.0 - uTime * 3.0 + vSeed * 30.0), 5.0);
          float fade = smoothstep(0.0, 0.22, vUv.y);
          float omit = step(0.94 - uAnomaly * 0.2, hash11(vSeed + floor(uTime * 2.2)));
          float a = edge * (0.10 + pulse * 0.55) * fade * (1.0 - omit);
          gl_FragColor = vec4(vec3(0.30, 0.78, 1.0) * (0.6 + pulse), a);
        }
      `,
    }));

    for (const site of sites) {
      const disc = new THREE.Mesh(new THREE.CircleGeometry(site.radius * 1.06, 48), cutMat);
      disc.rotation.x = -Math.PI * 0.5;
      disc.position.set(
        site.x,
        terrainHeight(site.x, site.z) - 1.5 + 0.335 * (LEVELS - 1) * 3.55,
        site.z
      );
      this.group.add(disc);
    }
    const fibers = new THREE.Mesh(fiberGeo, fiberMat);
    fibers.name = 'SeveredTraces';
    fibers.frustumCulled = false;
    this.group.add(fibers);
  }

  // --------------------------------------------------------------------------
  //  2. OMISSION FIELD — 12% of the geometry is absent this frame
  // --------------------------------------------------------------------------
  private buildOmissionField(terrainHeight: (x: number, z: number) => number): void {
    const COUNT = 340;
    const geo = instancedFrom(new THREE.BoxGeometry(1, 1, 1), COUNT);
    const aOffset = new Float32Array(COUNT * 3);
    const aScale = new Float32Array(COUNT * 3);
    const aSeed = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) {
      const x = (rand(i * 1.11) - 0.5) * 116;
      const z = -76 + rand(i * 2.27) * 118;
      const y = 3 + rand(i * 3.31) * 74 + terrainHeight(x, z) * 0.15;
      aOffset[i * 3 + 0] = x;
      aOffset[i * 3 + 1] = y;
      aOffset[i * 3 + 2] = z;
      // Every shard is a *truncated* massing: thin in one axis, cut flat.
      const big = 2 + rand(i * 4.19) * 11;
      aScale[i * 3 + 0] = big;
      aScale[i * 3 + 1] = 0.4 + rand(i * 5.23) * 9;
      aScale[i * 3 + 2] = 0.5 + rand(i * 6.17) * 3.2;
      aSeed[i] = rand(i * 7.71);
    }
    geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(aOffset, 3));
    geo.setAttribute('aScale', new THREE.InstancedBufferAttribute(aScale, 3));
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(aSeed, 1));

    const mat = this.register(new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: { uTime: { value: 0 }, uAnomaly: { value: 0 } },
      vertexShader: /* glsl */ `
        attribute vec3 aOffset;
        attribute vec3 aScale;
        attribute float aSeed;
        varying vec2 vUv;
        varying float vSeed;
        varying vec3 vLocal;
        uniform float uTime;
        uniform float uAnomaly;
        ${HASH}
        void main() {
          vUv = uv;
          vSeed = aSeed;
          vLocal = position;
          // Slice shear: horizontal bands of the shard slip by a whole pixel row.
          float band = floor((position.y + 0.5) * 7.0);
          float slip = (hash11(band * 3.1 + aSeed * 17.0 + floor(uTime * 1.3)) - 0.5);
          vec3 p = position;
          p.x += slip * (0.12 + uAnomaly * 0.55);
          vec3 world = p * aScale + aOffset;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(world, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        varying float vSeed;
        varying vec3 vLocal;
        uniform float uTime;
        uniform float uAnomaly;
        ${HASH}
        void main() {
          float e = 1.0 - smoothstep(0.0, 0.10, min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y)));
          // Presence is decided per-frame, per-instance. When omitted, only the
          // outline survives — the geometry is *remembered*, not destroyed.
          float omit = step(0.88 - uAnomaly * 0.24, hash11(vSeed + floor(uTime * 2.0)));
          if (omit > 0.5 && e < 0.35) discard;
          float scan = 0.5 + 0.5 * sin(vLocal.y * 90.0 - uTime * 5.0);
          vec3 col = vec3(0.004, 0.026, 0.085) * (1.0 - omit);
          col += vec3(0.20, 0.70, 1.0) * e * (0.45 + omit * 1.35);
          col += vec3(0.10, 0.42, 0.86) * scan * 0.09;
          gl_FragColor = vec4(col, 0.55 + e * 0.45);
        }
      `,
    }));

    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'OmissionField';
    mesh.frustumCulled = false;
    this.group.add(mesh);
  }

  // --------------------------------------------------------------------------
  //  3. PAGE STRATA — stacked stop-screen pages with the right 20% missing
  // --------------------------------------------------------------------------
  private buildPageStrata(): void {
    const COUNT = 116;
    const geo = instancedFrom(new THREE.PlaneGeometry(1, 1), COUNT);
    const aOffset = new Float32Array(COUNT * 3);
    const aScale = new Float32Array(COUNT * 2);
    const aSeed = new Float32Array(COUNT);
    const aTilt = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) {
      const layer = i / COUNT;
      aOffset[i * 3 + 0] = (rand(i * 1.7) - 0.5) * 30 + Math.sin(i * 0.7) * 4;
      aOffset[i * 3 + 1] = 30 + layer * 78 + rand(i * 2.9) * 3;
      aOffset[i * 3 + 2] = -62 + rand(i * 3.3) * 88;
      aScale[i * 2 + 0] = 26 + rand(i * 4.1) * 24;
      aScale[i * 2 + 1] = 15 + rand(i * 5.7) * 12;
      aSeed[i] = rand(i * 6.13);
      aTilt[i] = (rand(i * 7.9) - 0.5) * 0.5;
    }
    geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(aOffset, 3));
    geo.setAttribute('aScale', new THREE.InstancedBufferAttribute(aScale, 2));
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(aSeed, 1));
    geo.setAttribute('aTilt', new THREE.InstancedBufferAttribute(aTilt, 1));

    const mat = this.register(new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uAnomaly: { value: 0 },
        uMap: { value: this.pageTex },
      },
      vertexShader: /* glsl */ `
        attribute vec3 aOffset;
        attribute vec2 aScale;
        attribute float aSeed;
        attribute float aTilt;
        varying vec2 vUv;
        varying float vSeed;
        uniform float uTime;
        uniform float uAnomaly;
        ${HASH}
        void main() {
          vUv = uv;
          vSeed = aSeed;
          vec3 p = position * vec3(aScale.x, aScale.y, 1.0);
          float c = cos(aTilt), s = sin(aTilt);
          p = vec3(p.x * c - p.y * s, p.x * s + p.y * c, p.z);
          p.z += sin(uTime * 0.35 + aSeed * 12.0) * 1.6;
          p.x += (hash11(aSeed + floor(uTime * 1.1)) - 0.5) * uAnomaly * 3.0;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p + aOffset, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        varying float vSeed;
        uniform float uTime;
        uniform float uAnomaly;
        uniform sampler2D uMap;
        ${HASH}
        void main() {
          // Every page is missing its right-hand fifth. The missing edge is a
          // torn raster boundary, never a clean crop.
          float tear = 0.76 + 0.05 * sin(vUv.y * 34.0 + vSeed * 20.0)
                           + 0.025 * sin(vUv.y * 190.0 + uTime * 1.2);
          if (vUv.x > tear) discard;
          float tornEdge = smoothstep(tear - 0.045, tear, vUv.x);

          // Each page reads a slightly different 1/8 strip of the same document:
          // one character is always different from the page below it.
          float strip = floor(vSeed * 8.0) / 8.0;
          float flip = step(0.965, hash11(vSeed + floor(uTime * 0.6)));
          strip = fract(strip + flip * 0.125);
          vec2 uv = vec2(strip + vUv.x * 0.125, vUv.y);
          vec4 page = texture2D(uMap, uv);

          float raster = 0.5 + 0.5 * sin(vUv.y * 620.0 - uTime * 1.4);
          float omit = step(0.93 - uAnomaly * 0.18, hash11(vSeed + floor(uTime * 2.4)));
          float a = (page.a * 0.30 + page.r * 0.10) * (0.55 + raster * 0.45) * (1.0 - omit);
          a += tornEdge * 0.22;
          vec3 col = page.rgb * vec3(0.36, 0.74, 1.0) + vec3(0.16, 0.52, 1.0) * tornEdge;
          gl_FragColor = vec4(col, a);
        }
      `,
    }));

    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'MemoryPageStrata';
    mesh.frustumCulled = false;
    this.group.add(mesh);
  }

  // --------------------------------------------------------------------------
  //  4. DATA VEINS — light conduits that terminate in a particle waterfall
  // --------------------------------------------------------------------------
  private buildDataVeins(): void {
    const veinMat = this.register(new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uAnomaly: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        uniform float uTime;
        void main() {
          vUv = uv;
          vec3 p = position;
          p.y += sin(uTime * 0.6 + uv.x * 12.0) * 0.35;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        uniform float uTime;
        uniform float uAnomaly;
        ${HASH}
        void main() {
          // Packets of light run along the conduit.
          float packet = pow(0.5 + 0.5 * sin(vUv.x * 62.0 - uTime * 7.0), 12.0);
          float carrier = 0.10 + packet * 0.85;
          // The last 18% simply stops existing.
          float end = smoothstep(0.80, 0.86, vUv.x);
          float omit = step(0.90 - uAnomaly * 0.2, hash11(floor(vUv.x * 90.0) + floor(uTime * 2.1)));
          if (end > 0.5 || omit > 0.5) discard;
          float rim = 1.0 - smoothstep(0.0, 0.42, abs(vUv.y - 0.5) * 2.0);
          gl_FragColor = vec4(vec3(0.24, 0.74, 1.0) * carrier + vec3(0.05, 0.20, 0.55) * rim, carrier * 0.72);
        }
      `,
    }));

    const ends: THREE.Vector3[] = [];
    for (let v = 0; v < 4; v++) {
      const pts: THREE.Vector3[] = [];
      const z0 = -60 + v * 30;
      for (let i = 0; i <= 12; i++) {
        const t = i / 12;
        pts.push(new THREE.Vector3(
          -48 + t * 96,
          46 + Math.sin(t * Math.PI * 2 + v) * 12 + v * 3,
          z0 + Math.sin(t * Math.PI * 2.4 + v * 1.7) * 14
        ));
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 96, 0.30 + v * 0.07, 6, false), veinMat);
      tube.name = `DataVein${v}`;
      this.group.add(tube);
      ends.push(pts[11].clone());
    }

    // Particle waterfall at each severed vein end.
    const P = 420;
    const positions = new Float32Array(P * 3);
    const seeds = new Float32Array(P);
    for (let i = 0; i < P; i++) {
      const end = ends[i % ends.length];
      positions[i * 3 + 0] = end.x + (rand(i * 1.3) - 0.5) * 3.2;
      positions[i * 3 + 1] = end.y;
      positions[i * 3 + 2] = end.z + (rand(i * 2.7) - 0.5) * 3.2;
      seeds[i] = rand(i * 3.9);
    }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    pg.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    const pmat = this.register(new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uAnomaly: { value: 0 } },
      vertexShader: /* glsl */ `
        attribute float aSeed;
        varying float vSeed;
        uniform float uTime;
        void main() {
          vSeed = aSeed;
          vec3 p = position;
          float fall = fract(aSeed + uTime * (0.06 + aSeed * 0.09));
          p.y -= fall * 66.0;
          p.x += sin(fall * 9.0 + aSeed * 30.0) * 1.4;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = (1.5 + aSeed * 3.0) * (34.0 / max(1.0, -mv.z));
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vSeed;
        uniform float uTime;
        uniform float uAnomaly;
        ${HASH}
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float a = smoothstep(0.5, 0.0, length(d));
          float blink = step(0.22 + uAnomaly * 0.2, hash11(vSeed + floor(uTime * 5.0)));
          gl_FragColor = vec4(vec3(0.34, 0.82, 1.0), a * blink * 0.72);
        }
      `,
    }));
    const points = new THREE.Points(pg, pmat);
    points.name = 'VeinTerminusParticles';
    points.frustumCulled = false;
    this.group.add(points);
  }

  // --------------------------------------------------------------------------
  //  5. GLYPH STORM — replaces the explanatory signboards entirely
  // --------------------------------------------------------------------------
  private buildGlyphStorm(terrainHeight: (x: number, z: number) => number): void {
    const COUNT = 700;
    const geo = instancedFrom(new THREE.PlaneGeometry(1, 1), COUNT);
    const aOffset = new Float32Array(COUNT * 3);
    const aScale = new Float32Array(COUNT * 2);
    const aSeed = new Float32Array(COUNT);
    const aGlyph = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) {
      // Concentrated along the causeway, at eye height, so it reads as ambient
      // information rather than a billboard you have to walk up to.
      const nearCauseway = rand(i * 1.19) < 0.68;
      const x = nearCauseway ? (rand(i * 2.31) - 0.5) * 22 : (rand(i * 2.31) - 0.5) * 100;
      const z = -70 + rand(i * 3.17) * 108;
      const y = terrainHeight(x, z) + 1.0 + rand(i * 4.07) * 17;
      aOffset[i * 3 + 0] = x;
      aOffset[i * 3 + 1] = y;
      aOffset[i * 3 + 2] = z;
      const s = 0.7 + rand(i * 5.11) * 2.3;
      aScale[i * 2 + 0] = s * 2.6;
      aScale[i * 2 + 1] = s * 0.72;
      aSeed[i] = rand(i * 6.23);
      aGlyph[i] = Math.floor(rand(i * 7.31) * 8);
    }
    geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(aOffset, 3));
    geo.setAttribute('aScale', new THREE.InstancedBufferAttribute(aScale, 2));
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(aSeed, 1));
    geo.setAttribute('aGlyph', new THREE.InstancedBufferAttribute(aGlyph, 1));

    const mat = this.register(new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uAnomaly: { value: 0 },
        uMap: { value: this.glyphTex },
        uPlayerPos: { value: new THREE.Vector3() },
      },
      vertexShader: /* glsl */ `
        attribute vec3 aOffset;
        attribute vec2 aScale;
        attribute float aSeed;
        attribute float aGlyph;
        varying vec2 vUv;
        varying float vGlyph;
        varying float vSeed;
        uniform float uTime;
        uniform float uAnomaly;
        uniform vec3 uPlayerPos;
        ${HASH}
        void main() {
          vUv = uv;
          vSeed = aSeed;
          // One glyph in eight is rewritten every ~1.6s. Never all of them —
          // but glyphs near the player are noticeably more likely to change,
          // as if the document notices it is being read.
          float near = 1.0 - smoothstep(2.0, 14.0, distance(aOffset, uPlayerPos));
          float rewrite = step(0.965 - near * 0.22, hash11(aSeed + floor(uTime * 0.62)));
          vGlyph = mod(aGlyph + rewrite, 8.0);

          vec3 p = aOffset;
          p.y += sin(uTime * 0.5 + aSeed * 25.0) * 0.35;
          // Camera-facing billboard in view space.
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          mv.xy += position.xy * aScale;
          mv.x += (hash11(aSeed + floor(uTime * 3.0)) - 0.5) * uAnomaly * 0.8;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        varying float vGlyph;
        varying float vSeed;
        uniform float uTime;
        uniform float uAnomaly;
        uniform sampler2D uMap;
        ${HASH}
        void main() {
          vec2 uv = vec2((vGlyph + vUv.x) / 8.0, vUv.y);
          vec4 g = texture2D(uMap, uv);
          float raster = 0.5 + 0.5 * sin(vUv.y * 90.0 - uTime * 3.0);
          float omit = step(0.90 - uAnomaly * 0.2, hash11(vSeed + floor(uTime * 2.0)));
          float a = g.a * (0.35 + raster * 0.35) * (1.0 - omit);
          if (a < 0.01) discard;
          gl_FragColor = vec4(g.rgb * vec3(0.42, 0.82, 1.0), a);
        }
      `,
    }));

    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'GlyphStorm';
    mesh.frustumCulled = false;
    this.group.add(mesh);
  }

  // --------------------------------------------------------------------------
  //  Canvas atlases
  // --------------------------------------------------------------------------
  private makeGlyphAtlas(): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 1024;
    c.height = 128;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, 1024, 128);
    const glyphs = [':(', '0x', '99%', 'WAKE', 'ERR', '02:47', ':)', '///'];
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    for (let i = 0; i < 8; i++) {
      const cx = i * 128 + 64;
      ctx.font = i === 0 || i === 6
        ? '300 92px "Segoe UI", sans-serif'
        : '600 34px Consolas, monospace';
      ctx.fillStyle = '#bfe8ff';
      ctx.fillText(glyphs[i], cx, 64);
      // A one-pixel "dropped bit" under each glyph: the signal is not clean.
      ctx.fillStyle = 'rgba(120, 200, 255, 0.35)';
      ctx.fillRect(cx - 46, 104 + (i % 3) * 5, 92, 1);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    return tex;
  }

  private makePageTexture(): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 1024;
    c.height = 512;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, 1024, 512);
    ctx.fillStyle = 'rgba(150, 215, 255, 0.22)';
    ctx.font = '300 220px "Segoe UI", sans-serif';
    ctx.fillText(':(', 24, 250);
    ctx.font = '600 30px Consolas, monospace';
    const lines = [
      'MEMORY_0247.DMP  /  WRITE_COUNT 6',
      'STOP 0x000000F4  /  CRITICAL_PROCESS_DIED',
      '99% COMPLETE  /  HOST_SESSION 02:47',
      'WAKE_UP [RING0 / NOT GATED]',
      '1 HANDLE STILL OPEN',
    ];
    lines.forEach((t, i) => ctx.fillText(t, 300, 96 + i * 54));
    ctx.fillStyle = 'rgba(130, 205, 255, 0.16)';
    for (let y = 320; y < 500; y += 13) ctx.fillRect(24, y, 970 - (y % 5) * 33, 1);
    ctx.strokeStyle = 'rgba(170, 225, 255, 0.30)';
    ctx.lineWidth = 3;
    ctx.strokeRect(3, 3, 1018, 506);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    return tex;
  }
}
