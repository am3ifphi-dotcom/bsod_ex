// The BSOD world: a single continuous map made of five connected zones.
//
//   local space:  monument at (0, 0, 0)
//     A wasteland / arrival   z  +60 .. +130
//     B collapsed atrium      x  -70 .. -30, z +10 .. +60
//     C consumed city         x  +24 .. +78, z -20 .. +40
//     D deep layer (trench)   y  -9,      around z -6 .. -24
//     E core plaza + monument x ~0, z ~0
//
// The group is offset by WORLD_OFFSET so the bedroom (at the origin) and the
// world never share colliders.  All geometry is authored in metres.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { AssetLoader, bsodify } from '../core/assets';
import { Physics } from '../core/physics';
import { concrete, metal, sand, fabric } from '../core/textures';
import { debrisFrag, debrisVert, skyFrag, skyVert, withGlitch } from '../core/shaders';
import { RNG, clamp, fbm, makeCanvas, canvasTexture, smoothstep, textTexture } from '../core/utils';

export const WORLD_OFFSET = new THREE.Vector3(0, 0, -1200);

const ARRIVAL = new THREE.Vector3(0, 0, 92);
const ATRIUM = new THREE.Vector3(-50, 0, 34);
const CITY = new THREE.Vector3(48, 0, 10);
const DEEP = new THREE.Vector3(30, -9.2, -26);

/** terrain height in local (world-group) space */
export function terrainHeight(x: number, z: number): number {
  let h = fbm(x * 0.011, z * 0.011, 4) * 7.5;
  h += fbm(x * 0.05 + 13, z * 0.05 - 7, 3) * 1.1;

  // flat pads under the built zones (walkable, no surprises)
  const pads: [number, number, number, number][] = [
    [ARRIVAL.x, ARRIVAL.z, 16, 24],
    [ATRIUM.x, ATRIUM.z, 20, 24],
    [CITY.x, CITY.z, 26, 22],
    [0, 0, 22, 28],
  ];
  for (const [px, pz, r, blend] of pads) {
    const d = Math.hypot(x - px, z - pz);
    const w = 1 - smoothstep(r, r + blend, d);
    h = h * (1 - w);
  }

  // the deep layer: a sunken trench north-east of the core
  const td = Math.max(Math.abs(x - DEEP.x) - 14, Math.abs(z - DEEP.z) - 8, 0);
  const trench = 1 - smoothstep(0, 7, td);
  h = h * (1 - trench) + (DEEP.y - 0.15) * trench;

  // Cut the two stair wells through the terrain slope around the trench.
  // Without this the flights would be buried under the trench bank (the bank
  // is steeper than the character's max climb angle, so the player would hit
  // an invisible wall halfway up).
  const cuts: [number, number, number, number, number, number, number][] = [
    // x0, z0, x1, z1, half width, surface y at start, surface y at end
    [19.5, DEEP.z, 4.1, DEEP.z, 2.4, DEEP.y - 0.45, 0.32 - 0.45],
    [DEEP.x + 6, -16.6, DEEP.x + 6, -32.9, 2.4, -0.45, DEEP.y - 9.52 - 0.45],
  ];
  for (const [x0, z0, x1, z1, hw, y0, y1] of cuts) {
    const dx = x1 - x0, dz = z1 - z0;
    const len2 = dx * dx + dz * dz;
    const t = clamp(((x - x0) * dx + (z - z0) * dz) / len2, 0, 1);
    const dist = Math.hypot(x - (x0 + dx * t), z - (z0 + dz * t));
    const w = 1 - smoothstep(hw, hw + 2.5, dist);
    if (w > 0) h = h * (1 - w) + Math.min(h, y0 + (y1 - y0) * t) * w;
  }

  // one winding ramp out of the arrival basin
  const rampZ = smoothstep(56, 74, z);
  h += rampZ * 0.6;
  return h;
}

interface Relic {
  lod: THREE.LOD;
  base: THREE.Vector3;
  phase: number;
  spin: THREE.Vector3;
  bob: number;
}

export class World {
  group = new THREE.Group();
  interactables: {
    id: string; label: string; position: THREE.Vector3; radius: number; onUse: () => void;
  }[] = [];
  wakeUpRead = false;
  private assets: AssetLoader;
  private physics: Physics;
  private rng = new RNG(31337);
  private relics: Relic[] = [];
  private glitchUniforms = { uTime: { value: 0 }, uGlitch: { value: 0 } };
  private debrisMats: { mat: THREE.ShaderMaterial; mesh: THREE.Mesh }[] = [];
  private moon!: THREE.DirectionalLight;
  private monumentGlow!: THREE.PointLight;
  private emberPoints: THREE.Points | null = null;
  private wakeText: THREE.Mesh | null = null;
  private beacon!: THREE.Mesh;
  private shards: THREE.InstancedMesh | null = null;
  private cityLights: THREE.PointLight[] = [];
  private time = 0;
  private built = false;
  private introBeam!: THREE.Mesh;
  private monTexts: THREE.Mesh[] = [];

  constructor(assets: AssetLoader, physics: Physics) {
    this.assets = assets;
    this.physics = physics;
    this.group.name = 'world';
    this.group.position.copy(WORLD_OFFSET);
  }

  // ------------------------------------------------------------------ build
  build() {
    if (this.built) return;
    this.built = true;
    this.buildSky();
    this.buildTerrain();
    this.buildWasteland();
    this.buildAtrium();
    this.buildCity();
    this.buildDeep();
    this.buildCore();
    this.buildDistant();
    this.buildLights();
    this.buildAmbientDebris();
    this.buildInteractables();
  }

  private mat(set: { map: THREE.Texture; normalMap: THREE.Texture; roughnessMap: THREE.Texture }, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) {
    return new THREE.MeshStandardMaterial({
      map: set.map, normalMap: set.normalMap, roughnessMap: set.roughnessMap,
      roughness: 0.95, metalness: 0.1, envMapIntensity: 0.5, ...opts,
    });
  }

  private concreteMat = new THREE.MeshStandardMaterial();
  private concreteDarkMat = new THREE.MeshStandardMaterial();
  private metalMat = new THREE.MeshStandardMaterial();

  // ---------------------------------------------------------------- sky
  private buildSky() {
    const geo = new THREE.SphereGeometry(900, 40, 24);
    const mat = new THREE.ShaderMaterial({
      vertexShader: skyVert,
      fragmentShader: skyFrag,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTime: this.glitchUniforms.uTime,
        uGlitch: this.glitchUniforms.uGlitch,
        uTop: { value: new THREE.Color(0x01030c) },
        uMid: { value: new THREE.Color(0x061a44) },
        uHorizon: { value: new THREE.Color(0x0d3f8a) },
        uGlow: { value: new THREE.Color(0x4a86ff) },
      },
    });
    const dome = new THREE.Mesh(geo, mat);
    dome.name = 'sky';
    dome.frustumCulled = false;
    this.group.add(dome);
  }

  // ------------------------------------------------------------ terrain
  private buildTerrain() {
    const size = 300;
    const seg = 190;
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = terrainHeight(x, z);
      pos.setY(i, h);
      // blue-shifted albedo variation
      const n = fbm(x * 0.03, z * 0.03, 3);
      c.setHSL(0.6 + n * 0.02, 0.4, 0.16 + n * 0.05 + clamp(h * 0.01, -0.03, 0.05));
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const sandSet = sand();
    const mat = new THREE.MeshStandardMaterial({
      map: sandSet.map, normalMap: sandSet.normalMap, roughnessMap: sandSet.roughnessMap,
      vertexColors: true, roughness: 0.92, metalness: 0.05, envMapIntensity: 0.45,
    });
    // glowing memory-grid etched into the ground
    const uniforms = this.glitchUniforms;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = uniforms.uTime;
      shader.uniforms.uGlitch = uniforms.uGlitch;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          varying vec3 vWorldPosT;
          varying vec2 vUvT;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vUvT = uv;
          vWorldPosT = (modelMatrix * vec4(position, 1.0)).xyz;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 vWorldPosT;
          varying vec2 vUvT;
          uniform float uTime;
          uniform float uGlitch;
          float gridLine(vec2 p, float scale, float w) {
            vec2 g = abs(fract(p * scale - 0.5) - 0.5) / fwidth(p * scale);
            float l = min(g.x, g.y);
            return 1.0 - min(l, 1.0);
          }`)
        .replace('#include <dithering_fragment>', `#include <dithering_fragment>
          {
            float g1 = gridLine(vWorldPosT.xz, 0.25, 1.0);
            float g2 = gridLine(vWorldPosT.xz, 0.05, 1.0);
            float d = length(vWorldPosT.xz);
            float fade = smoothstep(120.0, 8.0, d);
            gl_FragColor.rgb += vec3(0.05, 0.22, 0.75) * (g1 * 0.10 + g2 * 0.045) * fade;
            gl_FragColor.rgb += vec3(0.3, 0.55, 1.0) * uGlitch * 0.06 *
              step(0.97, fract(sin(floor(uTime * 6.0) + vUvT.y * 400.0) * 43758.5453));
          }`);
    };
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'terrain';
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.terrainMesh = mesh;

    // collision: coarser grid, exact same height function
    const cseg = 240;
    const cgeo = new THREE.PlaneGeometry(size, size, cseg, cseg);
    cgeo.rotateX(-Math.PI / 2);
    const cpos = cgeo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < cpos.count; i++) {
      cpos.setY(i, terrainHeight(cpos.getX(i), cpos.getZ(i)));
    }
    const m = new THREE.Matrix4().makeTranslation(WORLD_OFFSET.x, WORLD_OFFSET.y, WORLD_OFFSET.z);
    this.physics.addTrimeshStatic(cgeo, m);
    cgeo.dispose();
  }
  terrainMesh!: THREE.Mesh;

  // ------------------------------------------------------------ helpers
  private slab(w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material,
    rotY = 0, collide = true, rounded = 0.02) {
    const geo = rounded > 0 ? new RoundedBoxGeometry(w, h, d, 1, Math.min(rounded, Math.min(w, h, d) * 0.3)) : new THREE.BoxGeometry(w, h, d);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.rotation.y = rotY;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    if (collide) {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotY, 0));
      this.physics.addBoxStatic(
        new THREE.Vector3(x + WORLD_OFFSET.x, y + WORLD_OFFSET.y, z + WORLD_OFFSET.z),
        new THREE.Vector3(w / 2, h / 2, d / 2), q,
      );
    }
    return mesh;
  }

  /**
   * Visual stair + a smooth invisible ramp collider.
   * Rapier's character controller reliably walks slopes, but stepping up a
   * long flight of discrete boxes can snag on the risers, so the collision
   * surface is a single inclined cuboid (a standard level-design trick).
   * The 1 unit = 1 metre scale keeps the slope well inside the 52° limit.
   */
  private stairs(x: number, y: number, z: number, steps: number, rise: number, run: number,
    dir: 'x+' | 'x-' | 'z+' | 'z-', width: number, mat: THREE.Material, descend = false) {
    const totalRun = steps * run;
    const totalRise = steps * rise;
    const dirX = dir === 'x+' ? 1 : dir === 'x-' ? -1 : 0;
    const dirZ = dir === 'z+' ? 1 : dir === 'z-' ? -1 : 0;
    for (let i = 0; i < steps; i++) {
      let sx = x, sz = z;
      if (dir === 'x+') sx = x + run * (i + 0.5);
      if (dir === 'x-') sx = x - run * (i + 0.5);
      if (dir === 'z+') sz = z + run * (i + 0.5);
      if (dir === 'z-') sz = z - run * (i + 0.5);
      const w = dir.startsWith('x') ? run : width;
      const d = dir.startsWith('z') ? run : width;
      const top = descend ? y - rise * (i + 1) : y + rise * (i + 1);
      const h = Math.max(rise, descend ? y - top : top - y);
      this.slab(w, h, d, sx, top - h / 2, sz, mat, 0, false, 0.008);
    }
    // ---- collision ramp
    const angle = Math.atan2(totalRise, totalRun) * (descend ? -1 : 1);
    const rotX = dir === 'z-' ? angle : -angle;   // tilt about X for z travel
    const rotZ = dir === 'x+' ? angle : -angle;   // tilt about Z for x travel
    const len = Math.hypot(totalRun, totalRise);
    const cx = x + dirX * totalRun / 2;
    const cz = z + dirZ * totalRun / 2;
    const cy = y + (descend ? -totalRise / 2 : totalRise / 2);
    const half = new THREE.Vector3(
      dir.startsWith('x') ? len / 2 : width / 2,
      0.18,
      dir.startsWith('z') ? len / 2 : width / 2,
    );
    const e = new THREE.Euler(
      dir.startsWith('z') ? rotX : 0,
      0,
      dir.startsWith('x') ? rotZ : 0,
      'XYZ',
    );
    const q = new THREE.Quaternion().setFromEuler(e);
    this.physics.addBoxStatic(
      new THREE.Vector3(cx + WORLD_OFFSET.x, cy + WORLD_OFFSET.y, cz + WORLD_OFFSET.z),
      half, q,
    );
  }

  /** Railing between two points; pass `y2` to make it follow a stair. */
  private railing(x1: number, z1: number, x2: number, z2: number, y: number, h = 1.05,
    mat?: THREE.Material, y2 = y) {
    const m = mat ?? this.metalMat;
    const dx = x2 - x1, dz = z2 - z1;
    const len = Math.hypot(dx, dz);
    const angle = Math.atan2(dx, dz);
    const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2;
    const dy = y2 - y;
    const pitch = Math.atan2(dy, len);
    const len3 = Math.hypot(len, dy);
    const g = new THREE.Group();
    g.position.set(cx, y + dy / 2, cz);
    g.rotation.y = angle;
    this.group.add(g);
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, len3), m);
    top.position.y = h;
    top.rotation.x = -pitch;
    top.castShadow = true;
    g.add(top);
    const mid = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, len3), m);
    mid.position.y = h * 0.55;
    mid.rotation.x = -pitch;
    g.add(mid);
    const posts = Math.max(2, Math.round(len / 1.6));
    for (let i = 0; i <= posts; i++) {
      const t = i / posts;
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.045, h, 0.045), m);
      post.position.set(x1 + dx * t, y + dy * t + h / 2, z1 + dz * t);
      post.castShadow = true;
      this.group.add(post);
    }
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, angle, 0))
      .multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-pitch, 0, 0)));
    this.physics.addBoxStatic(
      new THREE.Vector3(cx + WORLD_OFFSET.x, y + dy / 2 + h / 2 + WORLD_OFFSET.y, cz + WORLD_OFFSET.z),
      new THREE.Vector3(0.07, h / 2, len3 / 2), q,
    );
  }

  private textPanel(text: string, w: number, h: number, size: number, color = '#eaf4ff',
    bg = 'rgba(0,0,0,0)', glow = 'rgba(80,150,255,0.9)') {
    const tw = 1024, th = Math.round(1024 * (h / w));
    const fit = Math.min(size, (tw * 0.92) / Math.max(6, text.length) * 1.75, th * 0.55);
    const tex = textTexture(text, { w: tw, h: th, size: Math.round(fit), color, bg, glow, padding: fit * 0.25 });
    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, opacity: 0.95, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
    });
    return new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  }

  private uiWindow(title: string, body: string, w = 3.2, h = 1.5) {
    const { c, ctx } = makeCanvas(512, 240);
    ctx.fillStyle = 'rgba(4, 18, 46, 0.82)';
    ctx.fillRect(0, 0, 512, 240);
    ctx.strokeStyle = 'rgba(150, 195, 255, 0.75)';
    ctx.lineWidth = 3;
    ctx.strokeRect(2, 2, 508, 236);
    ctx.fillStyle = 'rgba(30, 90, 190, 0.85)';
    ctx.fillRect(4, 4, 504, 30);
    ctx.fillStyle = '#e8f1ff';
    ctx.font = '600 17px ui-monospace, monospace';
    ctx.fillText(title, 14, 24);
    ctx.font = '400 15px ui-monospace, monospace';
    ctx.fillStyle = '#a8c6ff';
    body.split('\n').forEach((l, i) => ctx.fillText(l, 16, 66 + i * 26));
    // scanline
    for (let y = 0; y < 240; y += 3) {
      ctx.fillStyle = 'rgba(60,120,220,0.12)';
      ctx.fillRect(0, y, 512, 1);
    }
    const tex = canvasTexture(c, { srgb: true });
    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, opacity: 0.9, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
    });
    return new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  }

  // ---------------------------------------------------------- relics (LOD)
  private relic(name: string, pos: THREE.Vector3, targetHeight: number, opts: {
    rotY?: number; wire?: boolean; emissive?: number; spin?: THREE.Vector3; bob?: number; dist?: [number, number];
  } = {}) {
    if (!this.assets.has(name)) return null;
    const lod = new THREE.LOD();
    const hi = this.assets.clone(name);
    AssetLoader.fit(hi, targetHeight, 'y');
    bsodify(hi, { wire: opts.wire ?? true, tint: 0x2f6de0, emissive: 0x0a2258 });
    hi.rotation.y = opts.rotY ?? 0;
    lod.addLevel(hi, 0);
    const loSrc = this.assets.lodTwin(name);
    if (loSrc) {
      const lo = loSrc.clone(true);
      AssetLoader.fit(lo, targetHeight, 'y');
      lo.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const sm = m.material as THREE.MeshStandardMaterial;
        m.material = new THREE.MeshStandardMaterial({
          color: new THREE.Color(0x1f4fae), emissive: new THREE.Color(0x071a44),
          roughness: 0.7, metalness: 0.3,
        });
        void sm;
      });
      lo.rotation.y = opts.rotY ?? 0;
      lod.addLevel(lo, opts.dist?.[1] ?? 55);
    }
    lod.position.copy(pos);
    this.group.add(lod);
    const r: Relic = {
      lod, base: pos.clone(), phase: this.rng.range(0, Math.PI * 2),
      spin: opts.spin ?? new THREE.Vector3(0, 0.1, 0),
      bob: opts.bob ?? 0.35,
    };
    this.relics.push(r);
    return lod;
  }

  // ------------------------------------------------------------ wasteland
  private buildWasteland() {
    this.concreteMat = this.mat(concrete());
    this.concreteDarkMat = this.mat(concrete(true));
    this.metalMat = new THREE.MeshStandardMaterial({ color: 0x3a4460, roughness: 0.42, metalness: 0.85, envMapIntensity: 0.8 });

    // arrival platform: a broken slab the player lands on
    this.slab(6.2, 0.35, 6.2, ARRIVAL.x, -0.1, ARRIVAL.z, this.concreteMat, 0.03, true, 0.06);
    this.slab(2.4, 0.3, 3.4, ARRIVAL.x + 3.4, -0.25, ARRIVAL.z - 2.6, this.concreteMat, 0.22, true, 0.05);

    // path markers: leaning monoliths that point toward the core
    const rng = this.rng;
    for (let i = 0; i < 7; i++) {
      const t = i / 6;
      const z = 74 - t * 34;
      const x = -6 - t * 12 + Math.sin(i * 2.3) * 3;
      const h = rng.range(3.5, 7.5);
      const lean = rng.range(-0.12, 0.12);
      const m = this.slab(1.1, h, 1.6, x, h / 2 - 1.2, z, this.concreteDarkMat, rng.range(0, 3), true, 0.05);
      m.rotation.z = lean;
      // glowing seam
      const seam = new THREE.Mesh(
        new THREE.PlaneGeometry(0.06, h * 0.8),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 0.6, 1.6), toneMapped: false, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      seam.position.set(x + 0.57, h / 2 - 1.2, z);
      this.group.add(seam);
    }

    // giant chess pieces (CC-BY 4.0) — memory of a game you don't remember
    const chess = this.relic('ABeautifulGame', new THREE.Vector3(-26, 1.2, 64), 5.0, {
      rotY: 0.6, wire: true, dist: [0, 70], spin: new THREE.Vector3(0, 0.02, 0), bob: 0.15,
    });
    if (chess) chess.scale.setScalar(3.0);

    // floating sofa: furniture drifting out of a room that no longer exists
    this.relic('GlamVelvetSofa', new THREE.Vector3(19, 6.5, 76), 2.2, {
      rotY: -0.9, spin: new THREE.Vector3(0.02, 0.12, 0.05), bob: 0.6, dist: [0, 60],
    });

    // relic trio ahead of the player (landmarks that pull you forward)
    this.relic('AntiqueCamera', new THREE.Vector3(-9, 12.5, 52), 9, { rotY: 0.8, spin: new THREE.Vector3(0, 0.06, 0.03), bob: 1.1 });
    this.relic('SciFiHelmet', new THREE.Vector3(12, 16, 38), 6, { rotY: -0.5, spin: new THREE.Vector3(0, -0.08, 0.02), bob: 1.4 });
    this.relic('AntiqueCamera', new THREE.Vector3(34, 9, -6), 6.5, { rotY: 2.1, spin: new THREE.Vector3(0.02, 0.05, 0), bob: 0.8 });

    // a broken archway marking the edge of the wasteland
    const archMat = this.concreteDarkMat;
    this.slab(1.2, 9, 1.2, -12, 3.6, 78, archMat, 0, true, 0.05);
    this.slab(1.2, 7.5, 1.2, -2.5, 2.8, 78, archMat, 0, true, 0.05);
    this.slab(11.5, 1.1, 1.4, -7.2, 8.9, 78, archMat, 0, true, 0.05);

    // holographic error windows drifting in the air (console hint: no answer)
    const hints: [string, string, THREE.Vector3, number][] = [
      ['SYSTEM32', 'recovery console detached.\nrun: <unknown>', new THREE.Vector3(-14, 3.4, 70), 0.4],
      ['MEMORY.DMP', 'writing... 41%\nuser session not found', new THREE.Vector3(15, 4.2, 64), -0.7],
      ['DEVICE', 'no keyboard attached.\n[ C ] ...?', new THREE.Vector3(6, 6.5, 30), 2.4],
    ];
    for (const [title, body, pos, rot] of hints) {
      const w = this.uiWindow(title, body);
      w.position.copy(pos);
      w.rotation.y = rot;
      this.group.add(w);
      this.floatingUI.push({ mesh: w, base: pos.clone(), phase: this.rng.range(0, 6) });
    }
  }
  floatingUI: { mesh: THREE.Mesh; base: THREE.Vector3; phase: number }[] = [];

  // --------------------------------------------------------------- atrium
  private buildAtrium() {
    const A = ATRIUM;
    const cm = this.concreteMat;
    const dm = this.concreteDarkMat;
    // four levels of a collapsed building, each floor split around a void
    const levels = [0.0, 4.3, 8.6, 12.9];
    const W = 30, D = 26;
    for (let li = 0; li < levels.length; li++) {
      const y = levels[li];
      // ring of slabs around a 10 x 9 void
      const voidW = 10, voidD = 9;
      const outerW = W / 2, outerD = D / 2;
      const sideW = (outerW - voidW / 2);
      const sideD = voidD / 2;
      // north/south strips
      const southZ = A.z - (sideD + (outerD - sideD) / 2);
      const northZ = A.z + (sideD + (outerD - sideD) / 2);
      const stripD = outerD - sideD;
      this.slab(W, 0.4, stripD, A.x, y, southZ, cm, 0, true, 0.03);
      this.slab(W, 0.4, stripD, A.x, y, northZ, cm, 0, true, 0.03);
      // east/west strips
      this.slab(sideW, 0.4, voidD, A.x - (voidW / 2 + sideW / 2), y, A.z, cm, 0, true, 0.03);
      this.slab(sideW, 0.4, voidD, A.x + (voidW / 2 + sideW / 2), y, A.z, cm, 0, true, 0.03);
      // columns at the corners of the void
      if (li < levels.length - 1) {
        for (const [cx, cz] of [[-voidW / 2 - 0.6, -voidD / 2 - 0.6], [voidW / 2 + 0.6, -voidD / 2 - 0.6],
          [-voidW / 2 - 0.6, voidD / 2 + 0.6], [voidW / 2 + 0.6, voidD / 2 + 0.6]] as const) {
          this.slab(1.1, 4.3, 1.1, A.x + cx, y + 2.15, A.z + cz, dm, 0, true, 0.04);
        }
      }
      // railings around the void (skip the level-0 edges where stairs arrive)
      if (li > 0) {
        this.railing(A.x - voidW / 2, A.z + voidD / 2, A.x + voidW / 2, A.z + voidD / 2, y + 0.2);
        this.railing(A.x - voidW / 2, A.z - voidD / 2, A.x - voidW / 2, A.z + voidD / 2, y + 0.2);
        this.railing(A.x + voidW / 2, A.z - voidD / 2, A.x + voidW / 2, A.z + voidD / 2, y + 0.2);
      }
      // outer walls with holes
      if (li < levels.length - 1) {
        this.slab(W, 4.0, 0.5, A.x, y + 2.2, A.z - D / 2, dm, 0, true, 0.03);
        this.slab(9, 4.0, 0.5, A.x - 10.5, y + 2.2, A.z + D / 2, dm, 0, true, 0.03);
        this.slab(9, 4.0, 0.5, A.x + 10.5, y + 2.2, A.z + D / 2, dm, 0, true, 0.03);
        this.slab(0.5, 4.0, 9, A.x - W / 2, y + 2.2, A.z - 8.5, dm, 0, true, 0.03);
        this.slab(0.5, 4.0, 9, A.x - W / 2, y + 2.2, A.z + 8.5, dm, 0, true, 0.03);
        this.slab(0.5, 4.0, 9, A.x + W / 2, y + 2.2, A.z - 8.5, dm, 0, true, 0.03);
        this.slab(0.5, 4.0, 9, A.x + W / 2, y + 2.2, A.z + 8.5, dm, 0, true, 0.03);
      }
    }

    // entry stairway from the wasteland side (south), up to level 1
    // (built outside the footprint so it never climbs into the level-1 slab)
    this.stairs(A.x, 0.2, A.z + D / 2 + 7.5, 13, 0.34, 0.56, 'z-', 2.8, this.concreteMat);
    this.railing(A.x - 1.45, A.z + D / 2 + 7.6, A.x - 1.45, A.z + D / 2 + 0.3, 0.2, 0.95, undefined, 4.62);
    this.railing(A.x + 1.45, A.z + D / 2 + 7.6, A.x + 1.45, A.z + D / 2 + 0.3, 0.2, 0.95, undefined, 4.62);
    // stair flights between levels inside, hugging the void
    // Between levels: an exterior fire-escape on the west face. Climbing an
    // interior flight would immediately hit the floor above (the capsule needs
    // head clearance the slab cannot give), so the flights hug the facade and
    // step in through the 8 m opening in the west wall.
    const fx = A.x - 18.5;   // stair centre, 3 m outside the facade
    const bx = A.x - 16.5;   // landing platform centre, against the facade
    for (const [ly, top] of [[4.3, 4.5], [8.6, 8.8], [12.9, 13.1]] as const) {
      this.slab(2.9, 0.4, 9.0, bx, ly, A.z, this.concreteDarkMat, 0, true, 0.03);   // balcony
      this.railing(bx - 1.2, A.z - 4.4, bx - 1.2, A.z + 4.4, top, 0.9);
      void top;
    }
    this.stairs(fx, 4.5, A.z - 4.0, 13, 0.33, 0.6, 'z+', 3.0, this.concreteDarkMat);
    this.stairs(fx, 8.8, A.z - 4.0, 13, 0.33, 0.6, 'z+', 3.0, this.concreteDarkMat);
    // exit bridge from level 3 toward the city (east)
    this.slab(9.5, 0.36, 2.6, A.x + 19, 12.9, A.z - 9, this.concreteMat, 0, true, 0.03);
    this.railing(A.x + 14.5, A.z - 10.2, A.x + 23.5, A.z - 10.2, 12.9);
    this.railing(A.x + 14.5, A.z - 7.8, A.x + 23.5, A.z - 7.8, 12.9);
    // descending stair on the far side of the bridge, all the way to ground
    this.stairs(A.x + 24, 12.9, A.z - 9, 38, 0.34, 0.62, 'x+', 2.6, this.concreteDarkMat, true);
    this.railing(A.x + 24, A.z - 10.2, A.x + 47.6, A.z - 10.2, 12.9, 0.9, undefined, 0);
    this.railing(A.x + 24, A.z - 7.8, A.x + 47.6, A.z - 7.8, 12.9, 0.9, undefined, 0);
    this.slab(3.2, 0.4, 3.2, A.x + 49.2, 0.0, A.z - 9, this.concreteMat, 0, true, 0.03);

    // roof beams, broken
    for (let i = 0; i < 5; i++) {
      const m = this.slab(0.6, 0.6, 26, A.x - 12 + i * 5.5, 16.6, A.z, this.metalMat, 0, true, 0.03);
      m.rotation.z = this.rng.range(-0.05, 0.05);
      if (i === 2) m.visible = false;
    }

    // relics suspended in the atrium void: faces of the machine
    this.relic('DamagedHelmet', new THREE.Vector3(A.x, 10.5, A.z), 5.2, { rotY: 0.4, spin: new THREE.Vector3(0, 0.07, 0), bob: 1.0, dist: [0, 60] });
    this.relic('SciFiHelmet', new THREE.Vector3(A.x, 2.2, A.z), 3.4, { rotY: -1.2, spin: new THREE.Vector3(0, -0.1, 0), bob: 0.5, dist: [0, 45] });

    // light shafts falling through the broken roof
    for (const [x, z] of [[A.x - 6, A.z - 4], [A.x + 7, A.z + 5]] as const) {
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.6, 4.2, 17, 18, 1, true),
        new THREE.MeshBasicMaterial({
          color: 0x6fa8ff, transparent: true, opacity: 0.06, side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
        }),
      );
      beam.position.set(x, 8.2, z);
      this.group.add(beam);
    }

    // side alcove inside the atrium's ground floor: a small reward room, open
    // to the void. (At ground level on purpose: a sunken room would need a hole
    // cut through the terrain collider, and an unreachable room is worse.)
    const ax = A.x - 10, az = A.z + 6;
    this.slab(4.6, 0.3, 4.6, ax, 0.1, az, this.concreteDarkMat, 0, true, 0.03);
    this.slab(0.3, 3.4, 4.6, ax - 2.2, 1.95, az, this.concreteDarkMat);
    this.slab(4.6, 3.4, 0.3, ax, 1.95, az - 2.3, this.concreteDarkMat);
    this.slab(4.6, 3.4, 0.3, ax, 1.95, az + 2.3, this.concreteDarkMat);
    const alcove = this.uiWindow('SAVE.SYS', 'one room was spared.\nit is not yours.\n\n[ the console remembers C ]', 2.6, 1.3);
    alcove.position.set(ax - 2.0, 1.75, az);
    alcove.rotation.y = Math.PI / 2;
    this.group.add(alcove);
    const alcoveLight = new THREE.PointLight(0x66a4ff, 3.2, 9, 2);
    alcoveLight.position.set(ax - 0.6, 2.35, az);
    this.group.add(alcoveLight);
  }

  // ----------------------------------------------------------------- city
  private buildCity() {
    const C = CITY;
    const rs = new RNG(881);
    // street surface
    const streetMat = new THREE.MeshStandardMaterial({
      color: 0x0f1524, roughness: 0.55, metalness: 0.15, envMapIntensity: 0.7,
    });
    this.slab(52, 0.3, 26, C.x, 0.02, C.z, streetMat, 0, true, 0.01);
    // sidewalk curbs
    this.slab(52, 0.32, 1.2, C.x, 0.2, C.z - 12.4, this.concreteDarkMat, 0, true, 0.02);
    this.slab(52, 0.32, 1.2, C.x, 0.2, C.z + 12.4, this.concreteDarkMat, 0, true, 0.02);

    // buildings on both sides
    const windowTex = this.buildingWindows();
    const facadeMat = new THREE.MeshStandardMaterial({
      map: windowTex, emissiveMap: windowTex, emissive: new THREE.Color(0x3a72d8), emissiveIntensity: 0.9,
      roughness: 0.62, metalness: 0.25, envMapIntensity: 0.6,
    });
    for (let i = 0; i < 7; i++) {
      const h1 = rs.range(14, 34);
      const h2 = rs.range(12, 30);
      const x = C.x - 24 + i * 8;
      this.slab(7.5, h1, 9, x, h1 / 2, C.z - 17.5, facadeMat, 0, true, 0.04);
      this.slab(7.5, h2, 9, x, h2 / 2, C.z + 17.5, facadeMat, 0, true, 0.04);
      // rooftop blocks
      this.slab(3, rs.range(1, 3), 3, x + rs.range(-1.5, 1.5), h1 + 1.2, C.z - 17.5, this.concreteDarkMat, 0, false, 0.02);
    }
    // collapsed wreckage across the street
    const wreckMat = this.concreteDarkMat;
    for (let i = 0; i < 14; i++) {
      const x = C.x - 18 + rs.range(0, 36);
      const z = C.z - 8 + rs.range(0, 16);
      const b = this.slab(rs.range(1, 4), rs.range(0.4, 1.4), rs.range(1, 4), x, rs.range(0.2, 1.2), z,
        wreckMat, rs.range(0, 3), true, 0.03);
      b.rotation.z = rs.range(-0.25, 0.25);
    }

    // wrecked car (CC-BY 4.0), pushed against a curb
    const car = this.relic('CarConcept', new THREE.Vector3(C.x - 6, 0.15, C.z + 4.5), 1.5, {
      rotY: 1.15, wire: true, dist: [0, 65], spin: new THREE.Vector3(0, 0, 0), bob: 0,
    });
    if (car) {
      car.rotation.z = 0.06;
    }

    // shattered window panes floating like a swarm
    if (this.assets.has('GlassBrokenWindow')) {
      const shardGroup = new THREE.Group();
      for (let i = 0; i < 16; i++) {
        const s = this.assets.clone('GlassBrokenWindow');
        AssetLoader.fit(s, rs.range(0.8, 2.6), 'max');
        s.position.set(C.x - 14 + rs.range(0, 30), rs.range(2, 12), C.z - 10 + rs.range(0, 20));
        s.rotation.set(rs.range(0, 3), rs.range(0, 3), rs.range(0, 3));
        s.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          m.material = new THREE.MeshPhysicalMaterial({
            color: 0x9fd0ff, transparent: true, opacity: 0.35, roughness: 0.08,
            metalness: 0.1, transmission: 0.35, thickness: 0.2, side: THREE.DoubleSide,
          });
        });
        shardGroup.add(s);
      }
      shardGroup.name = 'glass-swarm';
      this.group.add(shardGroup);
      this.glassSwarm = shardGroup;
    }

    // street lamps (emissive heads, only two real lights)
    for (let i = 0; i < 5; i++) {
      const x = C.x - 20 + i * 10;
      const z = C.z - 10.5;
      const pole = this.slab(0.16, 7, 0.16, x, 3.5, z, this.metalMat, 0, true, 0.02);
      void pole;
      const head = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 0.16, 0.9),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(1.4, 1.7, 2.2), toneMapped: false }),
      );
      head.position.set(x, 7.0, z + 0.4);
      this.group.add(head);
      if (i === 1 || i === 3) {
        const l = new THREE.PointLight(0x9fc8ff, 6, 22, 2);
        l.position.set(x, 6.8, z + 0.4);
        this.group.add(l);
        this.cityLights.push(l);
      }
    }

    // UI fragments eating the buildings
    const uiSpecs: [string, string, THREE.Vector3, number][] = [
      ['CRITICAL_PROCESS_DIED', 'a building was open here.\nnow there is only the dialog.', new THREE.Vector3(C.x - 12, 6.5, C.z + 8), 0.2],
      ['EXPLORER.EXE', 'C:\\rooms\\yours\\\n   400 files  (deleted)', new THREE.Vector3(C.x + 8, 4.2, C.z - 6), -1.1],
      ['?', 'press C to open the recovery console\n> _', new THREE.Vector3(C.x + 2, 2.6, C.z + 9), 0.6],
    ];
    for (const [t, b, p, r] of uiSpecs) {
      const w = this.uiWindow(t, b, 4.2, 1.9);
      w.position.copy(p);
      w.rotation.y = r;
      this.group.add(w);
      this.floatingUI.push({ mesh: w, base: p.clone(), phase: rs.range(0, 6) });
    }

    // giant vertical error text carved into the street
    const streetText = this.textPanel('IRQL_NOT_LESS_OR_EQUAL', 40, 5, 120, 'rgba(190,220,255,0.9)', 'rgba(0,0,0,0)', 'rgba(60,140,255,0.9)');
    streetText.rotation.x = -Math.PI / 2;
    streetText.position.set(C.x, 0.2, C.z - 5);
    this.group.add(streetText);
  }
  glassSwarm: THREE.Group | null = null;

  private buildingWindows() {
    const key = 'bwin';
    const cached = this.texCache.get(key);
    if (cached) return cached;
    const W = 512, H = 512;
    const { c, ctx } = makeCanvas(W, H);
    ctx.fillStyle = '#0a1220';
    ctx.fillRect(0, 0, W, H);
    const rng = new RNG(9001);
    const cols = 8, rows = 16;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const px = 10 + x * (W / cols), py = 6 + y * (H / rows);
        const w = W / cols - 16, h = H / rows - 12;
        const lit = rng.next() < 0.22;
        ctx.fillStyle = lit
          ? `rgba(${120 + rng.range(0, 80)},${170 + rng.range(0, 60)},255,${rng.range(0.25, 0.8)})`
          : `rgba(10,20,40,${rng.range(0.4, 0.9)})`;
        ctx.fillRect(px, py, w, h);
        ctx.strokeStyle = 'rgba(90,140,220,0.25)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(px, py, w, h);
      }
    }
    const tex = canvasTexture(c, { repeat: [1, 1] });
    this.texCache.set(key, tex);
    return tex;
  }
  private texCache = new Map<string, THREE.Texture>();

  // ----------------------------------------------------------------- deep
  private buildDeep() {
    const D = DEEP;
    const rs = new RNG(515);
    const floorY = D.y;
    const trenchMat = this.concreteDarkMat;
    const cableMat = new THREE.MeshStandardMaterial({ color: 0x0a0e18, roughness: 0.65, metalness: 0.25 });

    // walkable trench floor
    this.slab(28, 0.5, 16, D.x, floorY - 0.1, D.z, trenchMat, 0, true, 0.03);

    // descend from the city (north edge) into the trench
    this.stairs(D.x + 6, 0.0, D.z + 9, 28, 0.34, 0.55, 'z-', 3.0, this.concreteMat, true);
    // climb back out on the west end, toward the core
    this.stairs(D.x - 10.5, floorY, D.z, 28, 0.34, 0.55, 'x-', 3.0, this.concreteMat, false);
    this.railing(D.x - 10.5, D.z - 1.65, D.x - 25.7, D.z - 1.65, floorY, 0.9, undefined, floorY + 9.39);
    this.railing(D.x - 10.5, D.z + 1.65, D.x - 25.7, D.z + 1.65, floorY, 0.9, undefined, floorY + 9.39);

    // trench walls, with openings where the two stairs arrive
    this.slab(30, 11, 1.4, D.x, floorY + 4.6, D.z - 8.6, trenchMat, 0, true, 0.03);
    this.slab(16, 11, 1.4, D.x - 7, floorY + 4.6, D.z + 8.6, trenchMat, 0, true, 0.03);
    this.slab(8, 11, 1.4, D.x + 11, floorY + 4.6, D.z + 8.6, trenchMat, 0, true, 0.03);
    this.slab(1.4, 11, 6, D.x - 15, floorY + 4.6, D.z - 6, trenchMat, 0, true, 0.03);
    this.slab(1.4, 11, 6, D.x - 15, floorY + 4.6, D.z + 6, trenchMat, 0, true, 0.03);

    // cable bundles sagging along the trench
    for (let i = 0; i < 7; i++) {
      const pts: THREE.Vector3[] = [];
      const off = -6 + i * 2.1;
      for (let t = 0; t <= 10; t++) {
        const x = D.x - 13 + t * 2.7;
        const z = D.z + off + Math.sin(t * 0.8 + i) * 1.1;
        const y = floorY + 4.6 + Math.sin(t * 1.3 + i * 2) * 1.5 + 0.6;
        pts.push(new THREE.Vector3(x, y, z));
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 44, 0.05 + rs.range(0, 0.07), 6, false), cableMat);
      this.group.add(tube);
    }
    // cable boxes on the trench floor
    for (let i = 0; i < 10; i++) {
      const b = this.slab(1.4, 0.5, 0.9, D.x - 12 + rs.range(0, 24), floorY + 0.25, D.z + rs.range(-6, 6),
        new THREE.MeshStandardMaterial({ color: 0x121a2a, roughness: 0.8, metalness: 0.3 }), rs.range(0, 3), true, 0.02);
      b.rotation.z = rs.range(-0.1, 0.1);
    }

    // hanging lanterns (CC0) with warm light
    for (let i = 0; i < 3; i++) {
      const x = D.x - 8 + i * 9;
      const y = floorY + 4.4;
      this.relic('Lantern', new THREE.Vector3(x, y, D.z - 4 + i * 4), 2.4, {
        wire: false, spin: new THREE.Vector3(0, 0.05, 0), bob: 0.1, dist: [0, 40],
      });
      const l = new THREE.PointLight(0xffa868, 3.6, 13, 2);
      l.position.set(x, y + 0.4, D.z - 4 + i * 4);
      this.group.add(l);
      const glow = new THREE.Mesh(
        new THREE.SphereGeometry(0.2, 10, 8),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(1.7, 0.95, 0.45), toneMapped: false }),
      );
      glow.position.copy(l.position);
      this.group.add(glow);
    }

    // embers: Pot of Coals (CC-BY 4.0)
    this.relic('PotOfCoals', new THREE.Vector3(D.x + 10, floorY + 0.05, D.z + 4), 0.55, {
      wire: false, spin: new THREE.Vector3(0, 0.02, 0), bob: 0.015, dist: [0, 30],
    });

    // block-noise monoliths (glitch-deformed geometry)
    const blockMat = new THREE.MeshStandardMaterial({
      color: 0x1a2a4a, roughness: 0.35, metalness: 0.5, emissive: 0x0a1c40,
    });
    withGlitch(blockMat, this.glitchUniforms);
    for (let i = 0; i < 16; i++) {
      const x = D.x - 13 + rs.range(0, 26);
      const z = D.z - 6 + rs.range(0, 12);
      const h = rs.range(1.2, 6.0);
      const b = this.slab(0.8 + rs.range(0, 1.6), h, 0.8 + rs.range(0, 1.6), x, floorY + h / 2, z, blockMat, rs.range(0, 3), true, 0.02);
      b.rotation.z = rs.range(-0.16, 0.16);
    }

    // hidden side alcove with a console fragment (C is hinted, never solved)
    const ax = D.x + 12, az = D.z - 5.5;
    this.slab(6, 0.35, 5, ax, floorY + 0.15, az, trenchMat, 0, true, 0.02);
    this.slab(0.4, 4.2, 5, ax + 3, floorY + 2.2, az, trenchMat);
    this.slab(6, 4.2, 0.4, ax, floorY + 2.2, az - 2.5, trenchMat);
    this.slab(6, 4.2, 0.4, ax, floorY + 2.2, az + 2.5, trenchMat);
    this.slab(6, 0.4, 5, ax, floorY + 4.3, az, trenchMat);
    const hidden = this.uiWindow('0x000000EA', 'this room was not deleted.\nit was only forgotten.\n\n[ C ] ...you know how to open it.', 2.8, 1.4);
    hidden.position.set(ax + 2.9, floorY + 2.2, az);
    hidden.rotation.y = -Math.PI / 2;
    this.group.add(hidden);
    const hl = new THREE.PointLight(0x7fb4ff, 2.6, 11, 2);
    hl.position.set(ax + 1.6, floorY + 2.4, az);
    this.group.add(hl);

    // ember particles
    const count = 260;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = D.x + 10 + rs.range(-3, 3);
      pos[i * 3 + 1] = floorY + rs.range(0, 5);
      pos[i * 3 + 2] = D.z + 4 + rs.range(-3, 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.emberPoints = new THREE.Points(g, new THREE.PointsMaterial({
      color: 0xffb066, size: 0.05, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.emberPoints.frustumCulled = false;
    this.group.add(this.emberPoints);
  }

  // ----------------------------------------------------------------- core
  private buildCore() {
    // plaza
    const plazaMat = new THREE.MeshStandardMaterial({
      color: 0x101a30, roughness: 0.35, metalness: 0.6, envMapIntensity: 1.1,
    });
    const plaza = new THREE.Mesh(new THREE.CylinderGeometry(22, 23, 0.6, 64), plazaMat);
    plaza.position.set(0, 0.1, 0);
    plaza.receiveShadow = true;
    this.group.add(plaza);
    this.physics.addBoxStatic(
      new THREE.Vector3(WORLD_OFFSET.x, WORLD_OFFSET.y + 0.1, WORLD_OFFSET.z),
      new THREE.Vector3(21, 0.3, 21),
    );
    // approach steps (radial, on the north / trench side)
    for (let i = 0; i < 4; i++) {
      const r = 22 + i * 1.1;
      const step = new THREE.Mesh(new THREE.CylinderGeometry(r, r + 0.15, 0.2, 64, 1, false, -0.75, 1.5), plazaMat);
      step.position.set(0, -0.02 + i * 0.055, 0);
      step.receiveShadow = true;
      this.group.add(step);
    }
    // concentric glowing rings
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(6 + i * 6, 6.15 + i * 6, 96),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 0.5, 1.4), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.42;
      this.group.add(ring);
    }

    // monument: stacked slabs tapering upward
    const cm = this.concreteDarkMat;
    const tiers = 9;
    let y = 0.4;
    for (let i = 0; i < tiers; i++) {
      const w = 13 - i * 1.05;
      const h = i < 7 ? 5.2 : 7.0;
      this.slab(w, h, w, 0, y + h / 2, 0, cm, i * 0.16, true, 0.06);
      // glowing rim
      const rim = new THREE.Mesh(
        new THREE.BoxGeometry(w * 1.01, 0.07, w * 1.01),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 0.55, 1.5), toneMapped: false }),
      );
      rim.position.set(0, y + h - 0.06, 0);
      rim.rotation.y = i * 0.16;
      this.group.add(rim);
      y += h;
    }
    // external stair up the west flank, ending on a lookout platform
    const stairTop = 0.4 + 28 * 0.34;                    // 9.92 m
    this.stairs(-9.8, 0.4, 13.4, 28, 0.34, 0.6, 'z-', 2.8, this.concreteMat);
    this.slab(4.2, 0.35, 4.2, -9.8, stairTop, -4.6, this.concreteMat, 0, true, 0.03);
    this.railing(-11.9, -4.6, -11.9, 3.0, stairTop, 1.05);
    this.railing(-7.7, -6.7, -7.7, -2.5, stairTop, 1.05);
    this.railing(-11.9, -6.7, -7.7, -6.7, stairTop, 1.05);

    // WAKE_UP: the secret, readable from the ground and the platform
    const wakeTex = textTexture('WAKE_UP', {
      w: 2048, h: 512, size: 300, color: '#ffffff', bg: 'rgba(0,0,0,0)',
      glow: 'rgba(90,160,255,0.95)', align: 'center', padding: 90,
      font: '700 300px ui-monospace, Consolas, monospace',
    });
    const wakeMat = new THREE.MeshBasicMaterial({
      map: wakeTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      toneMapped: false, side: THREE.DoubleSide, color: new THREE.Color(1.4, 1.5, 1.7),
    });
    for (let face = 0; face < 4; face++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(18, 4.5), wakeMat);
      const ang = (face / 4) * Math.PI * 2 + 0.16 * 2;
      m.position.set(Math.sin(ang) * 5.62, 13.0, Math.cos(ang) * 5.62);
      m.rotation.y = ang;
      this.group.add(m);
      this.monTexts.push(m);
      if (face === 0) this.wakeText = m;
    }
    // smaller second line: quiet instruction, no answer
    const subTex = textTexture('// recovery console available — press C\n// one of these commands ends the session', {
      w: 2048, h: 256, size: 62, color: '#bcd8ff', bg: 'rgba(0,0,0,0)', align: 'center',
      font: '400 62px ui-monospace, monospace', padding: 40,
    });
    const subMat = new THREE.MeshBasicMaterial({
      map: subTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide,
    });
    for (let face = 0; face < 4; face++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(13, 1.6), subMat);
      const ang = (face / 4) * Math.PI * 2 + 0.16 * 2;
      m.position.set(Math.sin(ang) * 6.06, 9.9, Math.cos(ang) * 6.06);
      m.rotation.y = ang;
      this.group.add(m);
    }

    // beacon into the sky
    const beaconMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.35, 0.7, 1.8), transparent: true, opacity: 0.16,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    });
    this.beacon = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 3.2, 220, 20, 1, true), beaconMat);
    this.beacon.position.set(0, 150, 0);
    this.group.add(this.beacon);

    // rotating debris ring around the monument
    const ringCount = 90;
    const ringGeo = new THREE.IcosahedronGeometry(0.5, 0);
    const ringMat = new THREE.MeshStandardMaterial({
      color: 0x2b5aa8, emissive: 0x123a80, roughness: 0.4, metalness: 0.6, flatShading: true,
    });
    const ring = new THREE.InstancedMesh(ringGeo, ringMat, ringCount);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const rng = new RNG(77);
    for (let i = 0; i < ringCount; i++) {
      const a = (i / ringCount) * Math.PI * 2;
      const r = 24 + rng.range(-3, 5);
      q.setFromEuler(new THREE.Euler(rng.range(0, 6), rng.range(0, 6), rng.range(0, 6)));
      m4.compose(
        new THREE.Vector3(Math.cos(a) * r, 22 + rng.range(-6, 10), Math.sin(a) * r),
        q, new THREE.Vector3(...([rng.range(0.4, 2.4), rng.range(0.4, 1.6), rng.range(0.4, 2.2)] as [number, number, number])),
      );
      ring.setMatrixAt(i, m4);
    }
    this.group.add(ring);
    this.shards = ring;

    // approach steps up to the plaza
    for (let i = 0; i < 4; i++) {
      const r = 26 + i * 1.4;
      const step = new THREE.Mesh(new THREE.CylinderGeometry(r, r + 0.2, 0.22, 64, 1, false, -0.9, 1.8), plazaMat);
      step.position.set(0, -0.05 + i * 0.08, 0);
      this.group.add(step);
    }
  }

  // ------------------------------------------------------------- distant
  private buildDistant() {
    // far silhouettes for real atmospheric perspective (not a background image)
    const rng = new RNG(4242);
    const mat = new THREE.MeshStandardMaterial({ color: 0x081326, roughness: 1, metalness: 0 });
    for (let i = 0; i < 46; i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(120, 260);
      const h = rng.range(18, 90);
      const w = rng.range(8, 26);
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), mat);
      m.position.set(Math.cos(a) * r, h / 2 - 4, Math.sin(a) * r);
      m.rotation.y = rng.range(0, 3);
      m.castShadow = false;
      m.receiveShadow = false;
      this.group.add(m);
    }
    // distant floating monoliths facing the core
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + 0.3;
      const r = rng.range(70, 150);
      const h = rng.range(10, 40);
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(rng.range(3, 10), h, rng.range(3, 10)),
        new THREE.MeshStandardMaterial({ color: 0x0b1a36, emissive: 0x08163a, roughness: 0.8 }),
      );
      m.position.set(Math.cos(a) * r, h / 2 + rng.range(0, 22), Math.sin(a) * r);
      m.rotation.z = rng.range(-0.6, 0.6);
      this.group.add(m);
    }
  }

  // -------------------------------------------------------------- lights
  private buildLights() {
    const hemi = new THREE.HemisphereLight(0x3a64b8, 0x02040a, 0.55);
    this.group.add(hemi);

    this.moon = new THREE.DirectionalLight(0xa8c8ff, 1.15);
    this.moon.position.set(-40, 70, 40);
    this.moon.castShadow = true;
    this.moon.shadow.mapSize.set(2048, 2048);
    const sc = this.moon.shadow.camera;
    sc.near = 1; sc.far = 220; sc.left = -55; sc.right = 55; sc.top = 55; sc.bottom = -55;
    this.moon.shadow.bias = -0.0006;
    this.moon.shadow.normalBias = 0.06;
    this.group.add(this.moon);
    this.group.add(this.moon.target);

    // monument glow (the world's heart)
    this.monumentGlow = new THREE.PointLight(0x5b9bff, 26, 130, 1.6);
    this.monumentGlow.position.set(0, 18, 0);
    this.group.add(this.monumentGlow);

    // arrival fill so the player can see where they landed
    const arrivalLight = new THREE.PointLight(0x3f74d8, 7, 40, 2);
    arrivalLight.position.set(ARRIVAL.x, 7, ARRIVAL.z - 4);
    this.group.add(arrivalLight);

    // atrium ambient shaft light
    const atriumLight = new THREE.PointLight(0x7fb0ff, 12, 60, 2);
    atriumLight.position.set(ATRIUM.x, 8, ATRIUM.z);
    this.group.add(atriumLight);

    // deep layer: cold cyan under-glow
    const deepLight = new THREE.PointLight(0x2f8fd8, 8, 42, 2);
    deepLight.position.set(DEEP.x - 4, -5, DEEP.z);
    this.group.add(deepLight);
  }

  // ------------------------------------------------- ambient instanced debris
  private buildAmbientDebris() {
    const rng = new RNG(20250601);
    const batches: { geo: THREE.BufferGeometry; count: number; a: THREE.Color; b: THREE.Color }[] = [
      { geo: new THREE.TetrahedronGeometry(0.45, 0), count: 380, a: new THREE.Color(0x1a3a72), b: new THREE.Color(0x8fc4ff) },
      { geo: new THREE.BoxGeometry(1.2, 0.06, 0.8), count: 220, a: new THREE.Color(0x11305e), b: new THREE.Color(0xa8d4ff) },
      { geo: new THREE.IcosahedronGeometry(0.7, 0), count: 160, a: new THREE.Color(0x0d2246), b: new THREE.Color(0x6fb2ff) },
    ];
    for (const batch of batches) {
      const base = new THREE.InstancedBufferGeometry();
      const src = batch.geo.toNonIndexed();
      base.copy(src as any);
      base.instanceCount = batch.count;
      const offsets = new Float32Array(batch.count * 3);
      const axes = new Float32Array(batch.count * 3);
      const phases = new Float32Array(batch.count);
      const speeds = new Float32Array(batch.count);
      const scales = new Float32Array(batch.count);
      const kinds = new Float32Array(batch.count);
      for (let i = 0; i < batch.count; i++) {
        // distribute in a wide ring around the core, avoiding the walkable core
        const a = rng.range(0, Math.PI * 2);
        const r = 14 + Math.pow(rng.next(), 0.6) * 130;
        offsets[i * 3] = Math.cos(a) * r;
        offsets[i * 3 + 1] = rng.range(1.5, 45);
        offsets[i * 3 + 2] = Math.sin(a) * r;
        const ax = new THREE.Vector3(rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)).normalize();
        axes[i * 3] = ax.x; axes[i * 3 + 1] = ax.y; axes[i * 3 + 2] = ax.z;
        phases[i] = rng.range(0, Math.PI * 2);
        speeds[i] = rng.range(0.1, 0.45);
        scales[i] = rng.range(0.35, 2.4);
        kinds[i] = rng.next();
      }
      base.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets, 3));
      base.setAttribute('aAxis', new THREE.InstancedBufferAttribute(axes, 3));
      base.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
      base.setAttribute('aSpeed', new THREE.InstancedBufferAttribute(speeds, 1));
      base.setAttribute('aScale', new THREE.InstancedBufferAttribute(scales, 1));
      base.setAttribute('aKind', new THREE.InstancedBufferAttribute(kinds, 1));

      const mat = new THREE.ShaderMaterial({
        vertexShader: debrisVert,
        fragmentShader: debrisFrag,
        uniforms: {
          uTime: this.glitchUniforms.uTime,
          uGlitch: this.glitchUniforms.uGlitch,
          uColorA: { value: batch.a },
          uColorB: { value: batch.b },
        },
        transparent: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(base, mat);
      mesh.frustumCulled = false;
      mesh.name = 'debris';
      this.group.add(mesh);
      this.debrisMats.push({ mat, mesh });
    }
  }

  // -------------------------------------------------------- interactables
  private buildInteractables() {
    // WAKE_UP discovery zone in front of the monument
    this.interactables.push({
      id: 'wakeup', label: '刻まれた文字を読む', position: new THREE.Vector3(0, 2, 14), radius: 11,
      onUse: () => { },
    });
    void this.interactables;
  }

  /** the player start pose in world space */
  get spawn() {
    return {
      pos: new THREE.Vector3(ARRIVAL.x, 0.4, ARRIVAL.z).add(WORLD_OFFSET),
      yaw: 0.0, // yaw 0 faces -Z, i.e. straight at the monument
    };
  }

  /** where the "reading the secret" trigger sits, in world space */
  get wakeUpPoint() { return new THREE.Vector3(0, 2, 11).add(WORLD_OFFSET); }

  /** the monument's centre in world space (used to place the spatial hum) */
  get monumentPosition() { return new THREE.Vector3(0, 14, 0).add(WORLD_OFFSET); }

  /** Surface type for footsteps at a world-space position. */
  surfaceAt(p: THREE.Vector3): 'sand' | 'concrete' | 'metal' {
    const l = p.clone().sub(WORLD_OFFSET);
    if (l.y < -6) return 'metal';
    if (Math.hypot(l.x - CITY.x, l.z - CITY.z) < 28) return 'concrete';
    if (Math.hypot(l.x - ATRIUM.x, l.z - ATRIUM.z) < 22) return 'concrete';
    if (Math.hypot(l.x, l.z) < 26) return 'concrete';
    return 'sand';
  }

  update(dt: number, playerPos: THREE.Vector3, glitch: number) {
    this.time += dt;
    this.glitchUniforms.uTime.value = this.time;
    this.glitchUniforms.uGlitch.value = glitch;

    // relics drift + spin
    for (const r of this.relics) {
      r.phase += dt;
      r.lod.position.y = r.base.y + Math.sin(r.phase * 0.6) * r.bob;
      r.lod.rotation.y += r.spin.y * dt;
      r.lod.rotation.x += r.spin.x * dt;
      r.lod.rotation.z += r.spin.z * dt;
      // LOD selection is handled by the renderer (autoUpdate) each frame
    }
    for (const f of this.floatingUI) {
      f.mesh.position.y = f.base.y + Math.sin(this.time * 0.5 + f.phase) * 0.22;
      f.mesh.position.x = f.base.x + Math.sin(this.time * 0.31 + f.phase) * 0.16;
      (f.mesh.material as THREE.MeshBasicMaterial).opacity = 0.6 + Math.sin(this.time * 2 + f.phase) * 0.12;
    }
    if (this.glassSwarm) {
      this.glassSwarm.rotation.y += dt * 0.04;
      this.glassSwarm.position.y = Math.sin(this.time * 0.3) * 0.3;
    }
    if (this.emberPoints) {
      const pos = this.emberPoints.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        pos.setY(i, pos.getY(i) + dt * (0.25 + (i % 5) * 0.05));
        if (pos.getY(i) > terrainHeight(DEEP.x, DEEP.z) + 7) {
          pos.setY(i, terrainHeight(DEEP.x, DEEP.z) + 0.2);
        }
      }
      pos.needsUpdate = true;
    }
    if (this.monumentGlow) {
      this.monumentGlow.intensity = 24 + Math.sin(this.time * 0.9) * 3 + glitch * 10;
    }
    if (this.beacon) {
      (this.beacon.material as THREE.MeshBasicMaterial).opacity = 0.12 + Math.sin(this.time * 0.5) * 0.03 + glitch * 0.05;
    }
    // shadows follow the player so the shadow map stays tight
    if (this.moon) {
      this.moon.position.copy(playerPos).add(new THREE.Vector3(-40, 70, 40).sub(WORLD_OFFSET));
      this.moon.target.position.copy(playerPos).sub(WORLD_OFFSET);
      this.moon.target.updateMatrixWorld();
    }
    // wake_up text pulse, stronger once discovered
    const pulse = this.wakeUpRead ? 1.25 : 1.0;
    for (const m of this.monTexts) {
      (m.material as THREE.MeshBasicMaterial).color.setRGB(1.3 * pulse, 1.4 * pulse, 1.6 * pulse);
    }
  }

  /** Radius the collapse sequence uses to know it can spawn debris. */
  terrainAt(worldPos: THREE.Vector3) {
    const l = worldPos.clone().sub(WORLD_OFFSET);
    return terrainHeight(l.x, l.z);
  }
}
