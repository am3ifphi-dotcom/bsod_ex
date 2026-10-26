import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import type { Assets } from '../core/assets';
import { PhysicsWorld } from '../core/physics';
import type { Interactable } from './room';
import { clamp, fbm, lerp, mergeStatic, mulberry32, smoothstep } from '../core/util';

const FOG_COLOR = 0x050a18;

/* ------------------------------------------------------------------ terrain */
const FLAT_ZONES = [
  { x: 0, z: 255, ex: 78, ez: 72, h: 0.6 },
  { x: -90, z: 128, ex: 38, ez: 36, h: 0.35 },
  { x: 95, z: 110, ex: 48, ez: 46, h: 0.25 },
  { x: 40, z: -18, ex: 30, ez: 40, h: 0.2 },
  { x: 0, z: -18, ex: 44, ez: 44, h: 0.1 },
];

const PATH_POINTS: [number, number][] = [
  [0, 300], [0, 250], [0, 200], [0, 165], [0, 140],
  [-35, 135], [-90, 128], [-90, 96], [-55, 60], [-28, 30], [0, 10],
  [0, 140], [45, 140], [95, 110], [60, 90], [40, 60], [30, 35], [20, 20], [0, 10],
];

function distToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
  t = clamp(t);
  const x = ax + t * dx;
  const z = az + t * dz;
  return Math.hypot(px - x, pz - z);
}

/** Shared height field. Deterministic; also used for collision and prop placement. */
export function terrainHeight(x: number, z: number) {
  const dunes = fbm(x * 0.011, z * 0.011, 4) * 2.9 + fbm(x * 0.035 + 10, z * 0.035, 2) * 0.6;
  let h = dunes + 0.2;
  // flatten around landmarks
  for (const zone of FLAT_ZONES) {
    const dx = Math.abs(x - zone.x) / zone.ex;
    const dz = Math.abs(z - zone.z) / zone.ez;
    const d = Math.max(dx, dz);
    const w = 1 - smoothstep((d - 0.55) / 0.45);
    h = lerp(h, zone.h, w * 0.96);
  }
  // carve gentle roads between the areas
  let pathW = 0;
  for (let i = 0; i < PATH_POINTS.length - 1; i++) {
    const [ax, az] = PATH_POINTS[i];
    const [bx, bz] = PATH_POINTS[i + 1];
    const d = distToSegment(x, z, ax, az, bx, bz);
    if (d < 22) pathW = Math.max(pathW, 1 - smoothstep((d - 3.5) / 18));
  }
  h = lerp(h, 0.35, pathW * 0.85);
  return h;
}

const SPAWN = new THREE.Vector3(0, 0, 250);

export class World {
  group = new THREE.Group();
  ambientGroup = new THREE.Group();
  dynamicGroup = new THREE.Group();
  assets: Assets;
  physics: PhysicsWorld;
  interactables: Interactable[] = [];
  spawn = SPAWN.clone();
  zones: { name: string; center: THREE.Vector3; radius: number; group: THREE.Group }[] = [];
  lights: THREE.Light[] = [];
  private animated: { obj: THREE.Object3D; kind: string; seed: number; base: THREE.Vector3 }[] = [];
  private shards!: THREE.InstancedMesh;
  private shardData: { p: THREE.Vector3; s: number; r: THREE.Vector3; seed: number }[] = [];
  private rainMeshes: THREE.InstancedMesh[] = [];
  private dataStream?: THREE.LineSegments;
  private time = 0;
  private rnd = mulberry32(0xb50d);
  private mats: Record<string, THREE.Material> = {};
  private uTime = { value: 0 };
  private glowUniforms: { value: number }[] = [];
  public monolithSeen = false;
  public consoleHintSeen = false;
  public monolith = new THREE.Vector3(0, 0, -18);
  private lodGroups: THREE.LOD[] = [];

  constructor(assets: Assets) {
    this.assets = assets;
    this.physics = new PhysicsWorld();
    this.physics.groundHeight = terrainHeight;
    this.physics.bounds = { minX: -330, maxX: 330, minZ: -330, maxZ: 340 };
    this.group.name = 'world';
    this.group.add(this.ambientGroup);
    this.group.add(this.dynamicGroup);
  }

  // ------------------------------------------------------------------ helpers
  private makeMats() {
    const a = this.assets;
    this.mats.ground = a.material('snow', { repeat: [64, 64], color: 0x3d5c96, roughness: 0.82, normalScale: 1.1, emissive: 0x040c1e, emissiveIntensity: 0.4, glitch: 1 });
    this.mats.groundDark = a.material('rock', { repeat: [22, 22], color: 0x233a61, roughness: 0.9, normalScale: 1.4, emissive: 0x03081a, emissiveIntensity: 0.6 });
    this.mats.ruin = a.material('sandstone', { repeat: [2.5, 2.5], color: 0x8ba4d0, roughness: 0.72, normalScale: 1.2, emissive: 0x060f26, emissiveIntensity: 0.55 });
    this.mats.ruinDark = a.material('planks', { repeat: [2, 2], color: 0x44587a, roughness: 0.85, normalScale: 1.1, emissive: 0x050c1e, emissiveIntensity: 0.4 });
    this.mats.city = a.material('metal_dark', { repeat: [2, 3], color: 0x172136, roughness: 0.62, metalness: 0.55, normalScale: 0.9, emissive: 0x020714, emissiveIntensity: 0.6 });
    this.mats.cityWall = a.material('metal', { repeat: [3, 3], color: 0x26344f, roughness: 0.68, metalness: 0.4, normalScale: 0.8 });
    this.mats.deep = a.material('metal_dark', { repeat: [4, 4], color: 0x2a3d5c, roughness: 0.5, metalness: 0.6, emissive: 0x040b1c, emissiveIntensity: 0.5, glitch: 1 });
    this.mats.monolith = a.material('sandstone', { repeat: [3, 6], color: 0x33456e, roughness: 0.45, metalness: 0.3, normalScale: 1.5, emissive: 0x0a1c44, emissiveIntensity: 1.1 });
    this.mats.rail = a.plain(0x33496f, { roughness: 0.5, metalness: 0.7 });
    this.mats.black = a.plain(0x03050a, { roughness: 1, metalness: 0 });
    this.mats.emissiveBlue = a.plain(0x0a1734, { emissive: 0x2f6bff, emissiveIntensity: 2.4, roughness: 0.4 });
    this.mats.emissiveWhite = a.plain(0x101826, { emissive: 0xdce8ff, emissiveIntensity: 2.2, roughness: 0.4 });
    this.mats.shard = a.plain(0x0e1a34, { emissive: 0x2f63e0, emissiveIntensity: 0.75, roughness: 0.28, metalness: 0.45 });
    this.mats.error = new THREE.MeshBasicMaterial({ color: 0xa9c8ff, toneMapped: false, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false });
    this.mats.ghost = new THREE.MeshBasicMaterial({ color: 0x5f8fff, toneMapped: false, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
    this.mats.letter = new THREE.MeshStandardMaterial({ color: 0xdde9ff, emissive: 0x9dc0ff, emissiveIntensity: 1.8, roughness: 0.35, metalness: 0.1 });
  }

  private box(
    parent: THREE.Object3D,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    collide = true,
    ry = 0,
    rounded = 0,
  ) {
    const geo = rounded ? new RoundedBoxGeometry(sx, sy, sz, 2, rounded) : new THREE.BoxGeometry(sx, sy, sz);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.rotation.y = ry;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    parent.add(mesh);
    if (collide) this.physics.addBox(x, y, z, sx, sy, sz);
    return mesh;
  }

  private groundY(x: number, z: number) {
    return terrainHeight(x, z);
  }

  // -------------------------------------------------------------------- build
  build() {
    this.makeMats();
    this.buildSky();
    this.buildTerrain();
    this.buildArrival();
    this.buildRuin();
    this.buildCity();
    this.buildDeep();
    this.buildCenter();
    this.buildDistant();
    this.buildShards();
    this.buildErrorRain();
    this.buildDataStreams();
    this.buildLights();
    this.buildLore();
    // batch every static mesh that shares a material (huge draw-call win, no
    // visual change); animated objects, UI fragments and transparent surfaces stay
    // as individual draws.
    if (!/nomerge=1/.test(location.search)) {
      const skip = new Set<THREE.Object3D>(this.animated.map((a) => a.obj));
      mergeStatic(this.group, skip, 3);
    }
    return this;
  }

  private buildSky() {
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { uTime: this.uTime },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vDir;
        uniform float uTime;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
        void main() {
          float y = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
          vec3 low = vec3(0.012, 0.028, 0.065);
          vec3 high = vec3(0.012, 0.035, 0.10);
          vec3 col = mix(low, high, pow(y, 1.4));
          // distant grid / memory ceiling
          vec2 g = vDir.xz / max(abs(vDir.y) + 0.25, 0.25);
          vec2 grid = abs(fract(g * 0.35 + uTime * 0.002) - 0.5);
          float line = smoothstep(0.49, 0.5, max(grid.x, grid.y));
          col += vec3(0.05, 0.11, 0.26) * line * 0.25 * smoothstep(0.4, 0.9, y);
          // stars
          vec2 sp = floor(vDir.xz * 220.0 + vDir.y * 80.0);
          float s = hash(sp);
          float star = step(0.9975, s) * smoothstep(0.2, 0.6, y);
          col += vec3(0.7, 0.85, 1.0) * star * 0.6;
          // horizon glow
          col += vec3(0.05, 0.12, 0.3) * pow(1.0 - y, 6.0);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(520, 40, 24), mat);
    sky.frustumCulled = false;
    this.ambientGroup.add(sky);
  }

  private buildTerrain() {
    const size = 660;
    const seg = 190;
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const h = terrainHeight(x, z);
      pos.setY(i, h);
      const shade = 0.45 + clamp(h * 0.16, -0.2, 0.28) + (fbm(x * 0.08, z * 0.08, 2) * 0.15);
      colors[i * 3] = 0.32 * shade;
      colors[i * 3 + 1] = 0.5 * shade;
      colors[i * 3 + 2] = 0.95 * shade;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mat = this.mats.ground as THREE.MeshStandardMaterial;
    mat.vertexColors = true;
    mat.needsUpdate = true;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.name = 'terrain';
    this.group.add(mesh);

    // ground detail: scattered rocks (hero models + instanced pebbles)
    for (let i = 0; i < 7; i++) {
      const model = this.assets.models.rock;
      if (!model) break;
      const rock = model.clone(true);
      const x = -150 + this.rnd() * 300;
      const z = -80 + this.rnd() * 340;
      if (Math.hypot(x, z - 250) < 30) continue;
      const s = 0.7 + this.rnd() * 2.2;
      rock.scale.setScalar(s);
      rock.position.set(x, terrainHeight(x, z) - 0.2, z);
      rock.rotation.set(0, this.rnd() * Math.PI, 0);
      rock.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial;
          if (m?.isMeshStandardMaterial) {
            m.color.setHex(0x38507a);
            m.emissive = new THREE.Color(0x020818);
            m.emissiveIntensity = 0.5;
          }
          o.receiveShadow = true;
        }
      });
      this.group.add(rock);
    }
    const pebbleGeo = new THREE.IcosahedronGeometry(0.5, 0);
    const pebbles = new THREE.InstancedMesh(pebbleGeo, this.mats.groundDark, 160);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < 160; i++) {
      const x = -260 + this.rnd() * 520;
      const z = -180 + this.rnd() * 500;
      const s = 0.3 + this.rnd() * 1.3;
      m4.compose(
        new THREE.Vector3(x, terrainHeight(x, z) + s * 0.1, z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(this.rnd(), this.rnd() * 6, this.rnd())),
        new THREE.Vector3(s, s * 0.7, s),
      );
      pebbles.setMatrixAt(i, m4);
    }
    pebbles.receiveShadow = true;
    pebbles.instanceMatrix.needsUpdate = true;
    this.group.add(pebbles);
  }

  // ------------------------------------------------------------------ arrival
  private buildArrival() {
    const g = new THREE.Group();
    g.name = 'arrival';
    const y0 = 0.6;
    // a broken road made of floating concrete slabs leading in
    for (let i = 0; i < 9; i++) {
      const z = 290 - i * 5.5;
      const x = Math.sin(i * 1.7) * 1.6;
      const slab = this.box(g, this.mats.ruinDark, x, y0 + 0.06 + Math.sin(i * 0.9) * 0.1, z, 4.4 - (i % 3) * 0.5, 0.22, 3.2, false, Math.sin(i) * 0.12, 0.03);
      slab.rotation.z = Math.sin(i * 2.3) * 0.03;
    }
    // tall "error monoliths" near the spawn (visual anchors, no text)
    for (let i = 0; i < 5; i++) {
      const x = (i % 2 === 0 ? -1 : 1) * (16 + this.rnd() * 34);
      const z = 230 + this.rnd() * 55;
      const h = 7 + this.rnd() * 13;
      this.box(g, this.mats.ruin, x, h / 2 - 0.5, z, 1.4 + this.rnd() * 2.5, h, 1.2 + this.rnd() * 2.0, true, this.rnd() * 0.8);
    }
    // arrival arch: fragments of a gate
    const arch = new THREE.Group();
    for (const s of [-1, 1]) {
      this.box(arch, this.mats.ruin, s * 5.4, 2.2, 236, 1.1, 4.4, 1.1, true, 0.05);
    }
    this.box(arch, this.mats.ruin, 0, 4.8, 236, 12.2, 0.8, 1.1, false, 0, 0.02);
    g.add(arch);

    // half-buried obelisk shards poking out of the ground
    for (let i = 0; i < 12; i++) {
      const x = -60 + this.rnd() * 120;
      const z = 170 + this.rnd() * 110;
      if (Math.hypot(x, z - 250) < 14) continue;
      const h = 1.5 + this.rnd() * 7;
      const sh = this.box(g, this.mats.ruinDark, x, this.groundY(x, z) + h * 0.25, z, 0.5 + this.rnd() * 1.2, h, 0.4 + this.rnd() * 0.9, true, this.rnd() * 3);
      sh.rotation.z = (this.rnd() - 0.5) * 0.8;
    }

    // a broken UI panel — subtle hint that C opens a console (no command revealed)
    this.addUiFragment(g, new THREE.Vector3(3.6, 1.65, 246), 2.6, 1.5, [
      'RECOVERY CONSOLE',
      'STATUS: OFFLINE',
      '[ C ] CONNECT',
    ], 0.9, true);

    // small pools of blue light on the ground
    const p1 = new THREE.PointLight(0x2f6bff, 6, 18, 2);
    p1.position.set(0, 2.2, 238);
    g.add(p1);
    this.group.add(g);
    this.zones.push({ name: 'arrival', center: new THREE.Vector3(0, 0, 250), radius: 90, group: g });
  }

  // --------------------------------------------------------------------- ruin
  private buildRuin() {
    const g = new THREE.Group();
    g.name = 'ruin';
    const cx = -90;
    const cz = 128;
    const baseY = 0.35;
    // raised floor platform
    this.box(g, this.mats.ruin, cx, baseY - 0.1, cz, 46, 0.3, 44, true);
    // perimeter broken walls — the south wall has a 4.4 m doorway
    for (const [dx, dz, sx, sz] of [[0, -22, 46, 0.8], [-23, 0, 0.8, 44], [23, 0, 0.8, 44]]) {
      const h = 6 + this.rnd() * 4;
      this.box(g, this.mats.ruin, cx + dx, baseY + h / 2, cz + dz, sx, h, sz, true);
      // broken top chunks
      for (let i = 0; i < 3; i++) {
        this.box(g, this.mats.ruinDark, cx + dx + (this.rnd() - 0.5) * sx, baseY + h + this.rnd() * 1.5, cz + dz + (this.rnd() - 0.5) * sz, 1.4, 1.2, 1.4, false, this.rnd());
      }
    }
    {
      const h = 8.2;
      const doorW = 4.4;
      const side = (46 - doorW) / 2;
      for (const sgn of [-1, 1]) {
        this.box(g, this.mats.ruin, cx + sgn * (doorW / 2 + side / 2), baseY + h / 2, cz + 22, side, h, 0.8, true);
      }
      // lintel over the doorway
      this.box(g, this.mats.ruin, cx, baseY + h + 0.55, cz + 22, doorW + 1.6, 1.1, 1.0, false, 0, 0.02);
      // broken chunks on top
      for (let i = 0; i < 4; i++) {
        this.box(g, this.mats.ruinDark, cx - 20 + i * 12 + this.rnd() * 3, baseY + h + 1.2 + this.rnd(), cz + 22, 1.6, 1.1, 1.2, false, this.rnd());
      }
    }
    // doorway gap in the front wall (cut by adding pillars either side; wall is solid, so add a portal)
    // colonnade (hero CC0 column models + procedural columns)
    for (let i = 0; i < 6; i++) {
      const z = cz - 16 + i * 6.4;
      for (const side of [-1, 1]) {
        const x = cx + side * 13;
        const model = this.assets.models.column;
        if (model && i % 2 === 0) {
          const col = model.clone(true);
          col.updateMatrixWorld(true);
          const bb0 = new THREE.Box3().setFromObject(col);
          const scale = 3.6 / Math.max(bb0.getSize(new THREE.Vector3()).y, 0.001);
          col.scale.setScalar(scale);
          const bb = new THREE.Box3().setFromObject(col);
          col.position.set(x, baseY - bb.min.y, z);
          col.traverse((o) => {
            if ((o as THREE.Mesh).isMesh) {
              const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial;
              if (m?.isMeshStandardMaterial) {
                m.color.setHex(0x6c85b8);
                m.emissive = new THREE.Color(0x030a1c);
                m.emissiveIntensity = 0.6;
              }
              o.castShadow = false;
              o.receiveShadow = true;
            }
          });
          g.add(col);
          this.physics.addBox(x, baseY + 1.6, z, 1.4, 3.2, 1.4);
        } else {
          this.box(g, this.mats.ruin, x, baseY + 1.8, z, 1.05, 3.6, 1.05, true, 0, 0.04);
          this.box(g, this.mats.ruin, x, baseY + 3.7, z, 1.4, 0.26, 1.4, false);
        }
      }
    }
    // arches over the colonnade
    for (let i = 0; i < 5; i++) {
      const z = cz - 13 + i * 6.4;
      const shape = new THREE.Shape();
      shape.moveTo(-13, 4.0);
      shape.lineTo(13, 4.0);
      shape.lineTo(13, 5.0);
      shape.lineTo(1.6, 5.0);
      shape.absarc(0, 5.0, 1.6, Math.PI, 0, true);
      shape.lineTo(-13, 5.0);
      shape.lineTo(-13, 4.0);
      const geo = new THREE.ExtrudeGeometry(shape, { depth: 1.2, bevelEnabled: false });
      geo.rotateY(0);
      const arch = new THREE.Mesh(geo, this.mats.ruin);
      arch.position.set(cx, baseY, z);
      arch.receiveShadow = true;
      g.add(arch);
      this.physics.addBox(cx, baseY + 5.4, z, 26, 1.7, 1.2);
    }
    // open central skylight + broken beams
    for (let i = 0; i < 7; i++) {
      const x = cx - 16 + this.rnd() * 32;
      const z = cz - 16 + this.rnd() * 32;
      const beam = this.box(g, this.mats.ruinDark, x, baseY + 7 + this.rnd() * 2, z, 0.4, 0.4, 8 + this.rnd() * 6, false, this.rnd() * 3);
      beam.rotation.z = (this.rnd() - 0.5) * 0.4;
    }
    // mezzanine ring at 5.6m, accessible by stairs
    const mezY = baseY + 5.6;
    const mezTop = mezY + 0.2;
    this.box(g, this.mats.ruin, cx, mezY, cz - 20, 45.2, 0.4, 4.5, true);
    this.box(g, this.mats.ruin, cx, mezY, cz + 20, 45.2, 0.4, 4.5, true);
    this.box(g, this.mats.ruin, cx - 20.5, mezY, cz, 4.2, 0.4, 36, true);
    this.box(g, this.mats.ruin, cx + 20.5, mezY, cz, 4.2, 0.4, 36, true);
    // railings
    this.railLine(g, cx, mezY - 0.1, cz - 18, 40, 0.08, 1.15);
    this.railLine(g, cx, mezY - 0.1, cz + 18, 40, 0.08, 1.15);
    this.railLine(g, cx + 18.4, mezY - 0.1, cz, 0.08, 36, 1.15);
    // inner railing of the west strip, split around the stair landing at z = cz + 2
    this.railLine(g, cx - 18.4, mezY - 0.1, cz - 8.5, 0.08, 19, 1.15);
    this.railLine(g, cx - 18.4, mezY - 0.1, cz + 11, 0.08, 14, 1.15);
    // stairs up to the west mezzanine: bottom at z = cz+11, top landing at z = cz+2
    this.buildStairs(g, cx - 17.6, cz + 6.05, 3.2, 20, mezTop, 9.0, this.mats.ruin, 'z', baseY);
    // the stair top step overlaps the west strip, so the landing needs no extra slab
    // outer railing along the flight (open side toward the atrium)
    this.railLine(g, cx - 15.95, mezY - 0.1, cz + 6.05, 0.08, 9.6, 1.15);
    // top-step guard so the flight does not spill into the atrium
    this.railLine(g, cx - 17.6, mezY - 0.1, cz + 1.35, 3.2, 0.08, 1.15);
    // landing light so the route up reads from the atrium floor
    const stairLight = new THREE.PointLight(0x8fb4ff, 12, 14, 2);
    stairLight.position.set(cx - 20, mezTop + 1.4, cz + 9);
    g.add(stairLight);
    this.lights.push(stairLight);
    // floating broken slabs above the atrium
    for (let i = 0; i < 9; i++) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(2 + this.rnd() * 4, 0.3, 2 + this.rnd() * 4), this.mats.ruin);
      s.position.set(cx - 16 + this.rnd() * 32, mezY + 3 + this.rnd() * 8, cz - 16 + this.rnd() * 32);
      s.rotation.set(this.rnd() * 0.5, this.rnd() * 3, this.rnd() * 0.5);
      g.add(s);
      this.animated.push({ obj: s, kind: 'float', seed: this.rnd() * 10, base: s.position.clone() });
    }
    // error UI covering a wall
    this.addUiFragment(g, new THREE.Vector3(cx - 22.5, baseY + 3.2, cz + 4), 6.5, 3.8, [
      'CRITICAL_PROCESS_DIED',
      '0x000000EF',
      'MEMORY AT 0x7FF6 IS UNREADABLE',
      ':( ',
    ], 1.0, false, true);
    // skylight shaft from the broken roof
    const sky = new THREE.SpotLight(0xbcd4ff, 40, 30, 0.62, 0.85, 1.4);
    sky.position.set(cx + 2, baseY + 16, cz + 4);
    sky.target.position.set(cx + 2, baseY, cz + 4);
    g.add(sky, sky.target);
    this.lights.push(sky);
    this.lightShaft(g, new THREE.Vector3(cx + 2, baseY, cz + 4), 5.5, 15, 0x9fc0ff, 0.075);
    // floor light strips guiding to the mezzanine
    for (let i = 0; i < 6; i++) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 2.4), this.mats.emissiveBlue);
      strip.position.set(cx - 17.5, baseY + 0.22 + i * 0.9, cz + 12 - i * 0.1);
      strip.rotation.y = Math.PI / 2;
      g.add(strip);
    }
    // lore podium
    this.addLoreStone(g, new THREE.Vector3(cx + 4, baseY, cz + 2), 'lore_ruin', '崩れた記憶', [
      'ここは、消された部屋の残骸だ。',
      '柱はまだ形を保っている。誰かが必死に思い出そうとしているみたいに。',
    ]);
    // light shafts between columns
    for (let i = 0; i < 4; i++) {
      const x = cx + (i < 2 ? -1 : 1) * 9;
      const z = cz - 9 + (i % 2) * 18;
      this.lightShaft(g, new THREE.Vector3(x, baseY, z), 2.6, 11, 0x3a72ff, 0.055);
      const l = new THREE.PointLight(0x6f9dff, 26, 34, 1.8);
      l.position.set(x, baseY + 2.4, z);
      g.add(l);
      this.lights.push(l);
    }
    this.group.add(g);
    this.zones.push({ name: 'ruin', center: new THREE.Vector3(cx, 0, cz), radius: 55, group: g });
  }

  private railLine(g: THREE.Object3D, x: number, y: number, z: number, sx: number, sz: number, h = 1.05) {
    // top rail + posts; collision as a thin wall
    const alongX = sx > sz;
    const len = alongX ? sx : sz;
    this.box(g, this.mats.rail, x, y + h, z, alongX ? len : 0.06, 0.06, alongX ? 0.06 : len, false);
    this.physics.addBox(x, y + h / 2, z, alongX ? len : 0.14, h, alongX ? 0.14 : len);
    const count = Math.max(2, Math.round(len / 2.5));
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0.5 : i / (count - 1);
      const px = x + (alongX ? (t - 0.5) * len : 0);
      const pz = z + (alongX ? 0 : (t - 0.5) * len);
      this.box(g, this.mats.rail, px, y + h / 2, pz, 0.05, h, 0.05, false);
    }
  }

  private buildStairs(
    g: THREE.Object3D,
    x: number,
    z: number,
    width: number,
    steps: number,
    topY: number,
    length: number,
    mat: THREE.Material,
    axis: 'z' | 'x' = 'z',
    bottomY = 0,
  ) {
    const stepH = (topY - bottomY) / steps;
    const stepD = length / steps;
    for (let i = 0; i < steps; i++) {
      // solid stepped mass: each step's top face is exactly at bottomY + stepH * (i + 1)
      const top = bottomY + stepH * (i + 1);
      const mid = (bottomY + top) / 2;
      const h = top - bottomY;
      if (axis === 'z') {
        this.box(g, mat, x, mid, z + length / 2 - stepD * (i + 0.5), width, h, stepD, true);
      } else {
        this.box(g, mat, x + length / 2 - stepD * (i + 0.5), mid, z, stepD, h, width, true);
      }
    }
  }

  // --------------------------------------------------------------------- city
  private buildCity() {
    const g = new THREE.Group();
    g.name = 'city';
    const cx = 95;
    const cz = 110;
    const baseY = 0.25;
    // asphalt street grid
    this.box(g, this.mats.deep, cx, baseY - 0.12, cz, 76, 0.24, 76, true);
    // sidewalks
    for (const off of [-22, 0, 22]) {
      this.box(g, this.mats.ruinDark, cx + off, baseY + 0.06, cz, 3.0, 0.12, 76, false);
      this.box(g, this.mats.ruinDark, cx, baseY + 0.06, cz + off, 76, 0.12, 3.0, false);
    }
    // buildings
    const rnd = mulberry32(4242);
    const buildingSpots: [number, number, number, number, number][] = [];
    for (let ix = -1; ix <= 1; ix++) {
      for (let iz = -1; iz <= 1; iz++) {
        if ((ix === 0 && iz === 0) || (ix === 1 && iz === 1) || (ix === 1 && iz === 0) || (ix === 0 && iz === 1)) continue;
        for (let k = 0; k < 2; k++) {
          const bx = cx + ix * 22 + (k === 0 ? -7 : 7) + (rnd() - 0.5) * 3;
          const bz = cz + iz * 22 + (rnd() - 0.5) * 8;
          const w = 10 + rnd() * 6;
          const d = 9 + rnd() * 6;
          const h = 9 + rnd() * 22;
          buildingSpots.push([bx, bz, w, d, h]);
          const b = this.box(g, this.mats.city, bx, baseY + h / 2, bz, w, h, d, true, (rnd() - 0.5) * 0.06);
          // broken top
          if (rnd() > 0.4) {
            this.box(g, this.mats.cityWall, bx + (rnd() - 0.5) * w * 0.6, baseY + h + 0.8, bz + (rnd() - 0.5) * d * 0.6, w * 0.5, 1.6, d * 0.5, false, rnd());
          }
          // window strips (emissive)
          const floors = Math.floor(h / 3.2);
          for (let f = 0; f < floors; f++) {
            for (let s = 0; s < 2; s++) {
              if (rnd() > 0.5) continue;
              const win = new THREE.Mesh(
                new THREE.PlaneGeometry(w * 0.6, 0.22),
                rnd() > 0.5 ? this.mats.emissiveBlue : this.mats.emissiveWhite,
              );
              win.position.set(bx + (s === 0 ? 0 : (rnd() - 0.5) * w * 0.5), baseY + 1.6 + f * 3.2, bz + d / 2 + 0.02);
              g.add(win);
            }
          }
          // UI fragments crawling on the face
          if (rnd() > 0.55) {
            this.addUiFragment(g, new THREE.Vector3(bx, baseY + 3 + rnd() * (h * 0.5), bz + d / 2 + 0.1), 3.2, 1.8, [
              'ERR_NO_ROOM_LEFT',
              '0xC000009A',
              'MEMORY LEAK',
            ], 0.55, false);
          }
        }
      }
    }
    // enterable interior in one building (west side)
    const ix = cx + 22;
    const iz = cz + 22;
    // exterior shell (4 walls), with a 3m doorway on the south face
    this.box(g, this.mats.cityWall, ix, baseY + 3.2, iz + 8, 16, 6.4, 0.6, false);
    this.box(g, this.mats.cityWall, ix - 6.5, baseY + 3.2, iz, 3, 6.4, 16, false);
    this.box(g, this.mats.cityWall, ix + 6.5, baseY + 3.2, iz, 3, 6.4, 16, false);
    this.box(g, this.mats.cityWall, ix - 6.5, baseY + 3.2, iz - 8, 3, 6.4, 0.6, false);
    this.box(g, this.mats.cityWall, ix + 6.5, baseY + 3.2, iz - 8, 3, 6.4, 0.6, false);
    this.box(g, this.mats.cityWall, ix, baseY + 5.9, iz - 8, 10, 1.4, 0.6, false);
    this.physics.addBox(ix, baseY + 3.2, iz + 8, 16, 6.4, 0.7);
    this.physics.addBox(ix - 6.7, baseY + 3.2, iz, 2.6, 6.4, 16);
    this.physics.addBox(ix + 6.7, baseY + 3.2, iz, 2.6, 6.4, 16);
    this.physics.addBox(ix - 5, baseY + 3.2, iz - 8, 6, 6.4, 0.7);
    this.physics.addBox(ix + 5, baseY + 3.2, iz - 8, 6, 6.4, 0.7);
    this.physics.addBox(ix, baseY + 5.9, iz - 8, 10, 1.4, 0.7);
    // interior floor, ceiling, props
    this.box(g, this.mats.deep, ix, baseY + 0.05, iz, 12, 0.1, 15, true);
    this.box(g, this.mats.deep, ix, baseY + 6.2, iz, 15, 0.2, 15, false);
    for (let i = 0; i < 6; i++) {
      const dx = ix - 4 + (i % 3) * 4;
      const dz = iz - 4 + Math.floor(i / 3) * 6;
      const desk = this.box(g, this.mats.ruinDark, dx, baseY + 0.38, dz, 2.6, 0.08, 1.1, true);
      desk.receiveShadow = true;
      if (i % 2 === 0) {
        const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.6), this.mats.error);
        screen.position.set(dx, baseY + 0.9, dz - 0.6);
        g.add(screen);
      }
    }
    this.addUiFragment(g, new THREE.Vector3(ix, baseY + 2.6, iz + 7.7), 4.6, 2.4, [
      'THIS IS A BACKUP OF A ROOM',
      'DO NOT OVERWRITE',
    ], 0.5, false, true);
    this.addLoreStone(g, new THREE.Vector3(ix - 2.5, baseY, iz + 1), 'lore_city', '上書きされた街', [
      '街並みは、見たことのある景色を継ぎ接ぎしたものだ。',
      '窓の灯りはひとつも本物じゃない。',
    ]);
    const inside = new THREE.PointLight(0x6f9dff, 20, 22, 1.8);
    inside.position.set(ix, baseY + 3.0, iz + 2);
    g.add(inside);
    this.lights.push(inside);
    const inside2 = new THREE.PointLight(0xff5f7a, 8, 14, 2);
    inside2.position.set(ix - 3, baseY + 1.2, iz - 4);
    g.add(inside2);
    this.lights.push(inside2);

    // rooftop of the enterable building: external stair on the east face, a short
    // bridge over the roof wall, then a walkable deck with railings
    const roofY = 6.7;
    const stairX = ix + 10;      // 127 — outside the east wall
    const stairZ = iz + 6.5;     // 138.5 — flight runs north, top lands at iz + 2
    this.buildStairs(g, stairX, stairZ, 3.2, 20, roofY, 9, this.mats.ruin, 'z', baseY);
    this.box(g, this.mats.ruin, stairX, roofY - 0.17, iz + 0.6, 3.4, 0.34, 2.4, true);
    this.box(g, this.mats.ruin, (stairX + ix) / 2, roofY - 0.17, iz + 0.6, 8.5, 0.34, 3.0, true);
    this.box(g, this.mats.ruin, ix, roofY - 0.17, iz, 16, 0.34, 17, true);
    this.railLine(g, ix, roofY + 0.55, iz + 8.6, 16, 0.08, 1.05);
    this.railLine(g, ix, roofY + 0.55, iz - 8.6, 16, 0.08, 1.05);
    this.railLine(g, ix - 8, roofY + 0.55, iz, 0.08, 17, 1.05);
    // east edge, split where the bridge arrives
    this.railLine(g, ix + 8, roofY + 0.55, iz - 5.5, 0.08, 6, 1.05);
    this.railLine(g, ix + 8, roofY + 0.55, iz + 6, 0.08, 5, 1.05);
    this.railLine(g, stairX + 1.65, roofY + 0.55, stairZ, 0.08, 9.4, 1.05);
    // bridge guards (north side), so the walk from the stair bends onto the roof
    this.railLine(g, (stairX + ix) / 2 + 2.6, roofY + 0.55, iz - 0.85, 8.2, 0.08, 1.05);
    this.railLine(g, stairX + 1.85, roofY + 0.55, iz + 0.6, 0.08, 2.4, 1.05);
    this.addLoreStone(g, new THREE.Vector3(ix - 4, roofY + 0.2, iz - 5), 'lore_vista', '見晴らし', [
      '街の向こうに、白い光の柱が見える。',
      'あそこへ行けば、何かがわかる気がする。',
    ]);

    // street lights
    for (let i = 0; i < 4; i++) {
      const x = cx - 26 + i * 17;
      const z = cz + (i % 2 === 0 ? -12 : 12);
      this.physics.addBox(x, baseY + 2.2, z, 0.2, 4.4, 0.2);
      this.box(g, this.mats.rail, x, baseY + 4.2, z, 0.12, 8.4, 0.12, false);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 10), this.mats.emissiveWhite);
      lamp.position.set(x, baseY + 8.3, z);
      g.add(lamp);
      this.lightShaft(g, new THREE.Vector3(x, baseY, z), 1.2, 8.4, 0x88aaff, 0.05);
    }
    this.group.add(g);
    this.zones.push({ name: 'city', center: new THREE.Vector3(cx, 0, cz), radius: 60, group: g });
  }

  // --------------------------------------------------------------------- deep
  private buildDeep() {
    const g = new THREE.Group();
    g.name = 'deep';
    const cx = 40;
    const cz = -22;
    const baseY = 0.2;
    // enclosed corridor: floor, walls, ceiling (interior)
    this.box(g, this.mats.deep, cx, baseY - 0.15, cz, 26, 0.3, 52, true);
    this.box(g, this.mats.deep, cx, baseY + 4.2, cz, 26, 0.3, 52, false);
    this.box(g, this.mats.deep, cx - 13, baseY + 2.1, cz, 0.6, 4.2, 52, true);
    this.box(g, this.mats.deep, cx + 13, baseY + 2.1, cz, 0.6, 4.2, 52, true);
    this.box(g, this.mats.deep, cx, baseY + 2.1, cz - 26, 26, 4.2, 0.6, true);
    // south wall with a 6 m doorway (visual + collision identical)
    for (const sgn of [-1, 1]) {
      this.box(g, this.mats.deep, cx + sgn * 8, baseY + 2.1, cz + 26, 10, 4.2, 0.6, true);
    }
    this.box(g, this.mats.deep, cx, baseY + 4.05, cz + 26, 6.4, 0.5, 0.6, true);
    // interior partition walls creating a small maze
    const rnd = mulberry32(777);
    for (let i = 0; i < 5; i++) {
      const px = cx - 9 + rnd() * 18;
      const pz = cz - 20 + i * 9;
      const w = 6 + rnd() * 8;
      const side = i % 2 === 0 ? 1 : -1;
      this.box(g, this.mats.deep, px + side * w * 0.5, baseY + 1.9, pz, w, 3.8, 0.5, true);
    }
    // server racks with LED strips
    for (let i = 0; i < 9; i++) {
      const x = cx - 9.5 + (i % 2) * 18;
      const z = cz - 20 + Math.floor(i / 2) * 9;
      const rack = this.box(g, this.mats.city, x, baseY + 1.0, z, 1.5, 2.0, 2.4, true);
      rack.name = 'rack';
      for (let k = 0; k < 7; k++) {
        const led = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.03, 0.03), k % 3 === 0 ? this.mats.emissiveWhite : this.mats.emissiveBlue);
        led.position.set(x, baseY + 0.4 + k * 0.22, z + 1.22);
        g.add(led);
      }
    }
    // exposed wiring
    for (let i = 0; i < 7; i++) {
      const pts: THREE.Vector3[] = [];
      const x0 = cx - 11 + rnd() * 22;
      for (let k = 0; k < 5; k++) {
        pts.push(new THREE.Vector3(x0 + Math.sin(k * 2 + i) * 1.5, baseY + 3.4 - k * 0.6, cz - 22 + k * 9));
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 32, 0.035, 6, false), this.assets.plain(0x0a0f1c, { roughness: 0.55, metalness: 0.4 }));
      g.add(tube);
    }
    // block-noise panels
    for (let i = 0; i < 6; i++) {
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(3.5, 2.6), new THREE.MeshBasicMaterial({ color: 0x2a4c8f, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide }));
      panel.position.set(cx - 11 + (i % 2) * 22, baseY + 2.0, cz - 16 + Math.floor(i / 2) * 12);
      panel.rotation.y = i % 2 === 0 ? Math.PI / 2 : -Math.PI / 2;
      g.add(panel);
      this.glowUniforms.push({ value: 0 });
    }
    // chilled fill + red emergency glow
    for (let i = 0; i < 4; i++) {
      const fill = new THREE.PointLight(0x6f9dff, 16, 18, 1.8);
      fill.position.set(cx, baseY + 3.4, cz - 18 + i * 11);
      g.add(fill);
      this.lights.push(fill);
    }
    for (let i = 0; i < 3; i++) {
      const l = new THREE.PointLight(0xff3b55, 14, 14, 1.8);
      l.position.set(cx - 6 + i * 6, baseY + 3.2, cz - 8 + i * 8);
      g.add(l);
      this.lights.push(l);
      this.lightShaft(g, new THREE.Vector3(cx - 6 + i * 6, baseY, cz - 8 + i * 8), 0.9, 3.2, 0xff3b55, 0.03);
    }
    // entrance frame glow so the bunker reads from outside
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 4.4, 0.3), this.mats.emissiveBlue);
      post.position.set(cx + side * 3.4, baseY + 2.2, cz + 26.3);
      g.add(post);
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.25, 0.3), this.mats.emissiveWhite);
    lintel.position.set(cx, baseY + 4.35, cz + 26.3);
    g.add(lintel);
    this.addLoreStone(g, new THREE.Vector3(cx, baseY, cz + 16), 'lore_deep', '配線の底', [
      'ここは部屋の裏側だ。ケーブルが全部、この場所から伸びている。',
      '誰かが「眠らないで」と書いた跡がある。',
    ]);
    this.addUiFragment(g, new THREE.Vector3(cx, baseY + 2.4, cz + 25.6), 5.5, 2.6, [
      'DEEP MEMORY LAYER',
      'CONSOLE REQUIRED',
      'PRESS [C]',
      'W_KE_P',
    ], 0.7, true, true);
    this.group.add(g);
    this.zones.push({ name: 'deep', center: new THREE.Vector3(cx, 0, cz), radius: 40, group: g });
  }

  // ------------------------------------------------------------------- center
  private buildCenter() {
    const g = new THREE.Group();
    g.name = 'center';
    const cx = 0;
    const cz = -18;
    const baseY = 0.15;
    // plaza
    const plazaGeo = new THREE.CylinderGeometry(38, 40, 0.5, 64, 1);
    const plaza = new THREE.Mesh(plazaGeo, this.mats.ruin);
    plaza.position.set(cx, baseY - 0.25, cz);
    plaza.receiveShadow = true;
    g.add(plaza);
    this.physics.addBox(cx, baseY - 0.25, cz, 76, 0.5, 76);
    // concentric rings
    for (let i = 1; i <= 3; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(i * 8, 0.16, 6, 96), this.mats.emissiveBlue);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(cx, baseY + 0.03, cz);
      g.add(ring);
    }
    // broken steps up to the monolith dais
    this.box(g, this.mats.ruin, cx, baseY + 0.25, cz + 9, 24, 0.5, 3, true);
    this.box(g, this.mats.ruin, cx, baseY + 0.55, cz + 6, 20, 0.5, 3, true);
    this.box(g, this.mats.ruin, cx, baseY + 0.85, cz + 3, 16, 0.5, 3, true);
    // dais
    this.box(g, this.mats.ruin, cx, baseY + 1.1, cz, 14, 0.6, 14, true);

    // monolith obelisk: tapered shaft + broken crown
    const base = new THREE.Mesh(new THREE.CylinderGeometry(5.6, 7.4, 2.4, 4, 1), this.mats.monolith);
    base.position.set(cx, baseY + 2.3, cz);
    base.rotation.y = Math.PI / 4;
    base.receiveShadow = true;
    g.add(base);
    const obeliskGeo = new THREE.CylinderGeometry(2.2, 5.0, 52, 4, 1);
    const obelisk = new THREE.Mesh(obeliskGeo, this.mats.monolith);
    obelisk.position.set(cx, baseY + 29, cz);
    obelisk.rotation.y = Math.PI / 4;
    g.add(obelisk);
    this.physics.addBox(cx, baseY + 12, cz, 9, 24, 9);
    // corner rim light strips (make the silhouette read at distance)
    for (const corner of [-1, 1]) {
      const rim = new THREE.Mesh(new THREE.BoxGeometry(0.12, 48, 0.12), this.mats.emissiveBlue);
      rim.position.set(cx + corner * 2.5, baseY + 30, cz - 2.4);
      rim.rotation.z = corner * 0.02;
      g.add(rim);
    }
    // glowing seam up the front face
    for (let i = 0; i < 14; i++) {
      const seam = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.4, 0.1), this.mats.emissiveWhite);
      const t = i / 14;
      const y = baseY + 5 + t * 48;
      const w = lerp(5.0, 2.2, t) * 0.5;
      seam.position.set(cx + (this.rnd() - 0.5) * 0.4, y, cz + w + 0.05);
      seam.rotation.z = (this.rnd() - 0.5) * 0.2;
      g.add(seam);
    }
    // beacon: a tall additive column readable from the whole map
    const beaconMat = new THREE.MeshBasicMaterial({
      color: 0x7fb0ff,
      transparent: true,
      opacity: 0.12,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    const beacon = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 5.5, 190, 24, 1, true), beaconMat);
    beacon.position.set(cx, baseY + 95, cz);
    g.add(beacon);
    this.animated.push({ obj: beacon, kind: 'beacon', seed: 0, base: beacon.position.clone() });
    const baseRing = new THREE.Mesh(new THREE.TorusGeometry(8.2, 0.12, 6, 96), this.mats.emissiveWhite);
    baseRing.rotation.x = Math.PI / 2;
    baseRing.position.set(cx, baseY + 1.45, cz);
    g.add(baseRing);
    // WAKE_UP — the world's secret, readable from the plaza
    this.buildWakeText(g, new THREE.Vector3(cx, baseY + 9.2, cz + 4.15));

    // giant broken ring around the monolith
    const ringGroup = new THREE.Group();
    for (let seg = 0; seg < 26; seg++) {
      const a = (seg / 26) * Math.PI * 2;
      if (seg % 7 === 3) continue;
      const radius = 20;
      const geo = new THREE.TorusGeometry(radius, 0.9, 8, 10, (Math.PI * 2) / 26 - 0.04);
      const mesh = new THREE.Mesh(geo, this.mats.ruin);
      mesh.rotation.z = a;
      mesh.rotation.x = 0.22;
      ringGroup.add(mesh);
    }
    ringGroup.position.set(cx, baseY + 20, cz);
    ringGroup.rotation.x = 0.24;
    g.add(ringGroup);
    this.animated.push({ obj: ringGroup, kind: 'rotateRing', seed: 0, base: ringGroup.position.clone() });
    // orbiting slabs
    for (let i = 0; i < 10; i++) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(2 + this.rnd() * 4, 0.25, 1 + this.rnd() * 3), this.mats.ruinDark);
      const a = this.rnd() * Math.PI * 2;
      const r = 14 + this.rnd() * 12;
      s.position.set(cx + Math.cos(a) * r, baseY + 6 + this.rnd() * 24, cz + Math.sin(a) * r);
      s.rotation.set(this.rnd(), this.rnd() * 3, this.rnd());
      g.add(s);
      this.animated.push({ obj: s, kind: 'orbit', seed: a, base: s.position.clone() });
    }
    // beams of light from the dais
    this.lightShaft(g, new THREE.Vector3(cx, baseY, cz), 8, 60, 0x7fb0ff, 0.09);
    this.lightShaft(g, new THREE.Vector3(cx - 8, baseY, cz + 7), 3, 30, 0x2f6bff, 0.06);
    this.lightShaft(g, new THREE.Vector3(cx + 8, baseY, cz + 7), 3, 30, 0x2f6bff, 0.06);
    const l1 = new THREE.PointLight(0x8fb8ff, 22, 64, 2);
    l1.position.set(cx, baseY + 12, cz + 5);
    g.add(l1);
    const l2 = new THREE.PointLight(0x2f6bff, 14, 40, 2);
    l2.position.set(cx, baseY + 1.5, cz + 10);
    g.add(l2);

    // approach pylons
    for (let i = 0; i < 6; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const z = cz + 22 + Math.floor(i / 2) * 8;
      this.box(g, this.mats.ruin, side * (9 + Math.floor(i / 2) * 1.5), baseY + 2.2, z, 1.2, 4.4, 1.2, true, 0.2);
      const em = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.08, 0.9), this.mats.emissiveBlue);
      em.position.set(side * (9 + Math.floor(i / 2) * 1.5), baseY + 4.45, z);
      g.add(em);
    }
    // broken floor text fragments (the world's memory)
    this.addGroundText(g, new THREE.Vector3(cx - 9, baseY + 0.03, cz + 26), 'WAKE_UP', 0.6);
    this.addGroundText(g, new THREE.Vector3(cx + 12, baseY + 0.03, cz + 20), '0x000000EF', 0.5);
    this.addLoreStone(g, new THREE.Vector3(cx + 6.5, baseY + 1.2, cz + 1.5), 'lore_center', '白い柱', [
      '柱には、傷のような文字が刻まれている。',
      '「WAKE_UP」——眠りから覚めろ、と読める。',
    ]);
    this.addUiFragment(g, new THREE.Vector3(cx - 16.5, baseY + 2.0, cz + 18), 4.2, 2.2, [
      'CONSOLE',
      'TYPE THE WORD',
      'TO WAKE',
    ], 0.35, false, true);

    this.group.add(g);
    this.zones.push({ name: 'center', center: new THREE.Vector3(cx, 0, cz), radius: 60, group: g });
  }

  private buildWakeText(parent: THREE.Object3D, pos: THREE.Vector3) {
    const font = this.assets.font;
    if (!font) return;
    const geo = new TextGeometry('WAKE_UP', {
      font,
      size: 4.6,
      depth: 0.45,
      curveSegments: 4,
      bevelEnabled: true,
      bevelThickness: 0.08,
      bevelSize: 0.05,
      bevelSegments: 2,
    });
    geo.computeBoundingBox();
    const bb = geo.boundingBox!;
    geo.translate(-(bb.max.x + bb.min.x) / 2, -(bb.max.y + bb.min.y) / 2, 0);
    const mesh = new THREE.Mesh(geo, this.mats.letter);
    mesh.position.copy(pos);
    mesh.castShadow = false;
    parent.add(mesh);
    this.animated.push({ obj: mesh, kind: 'pulseText', seed: 0, base: mesh.position.clone() });
    // glow plane behind
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(24, 8),
      new THREE.MeshBasicMaterial({ color: 0x7fb0ff, transparent: true, opacity: 0.08, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    );
    glow.position.copy(pos).add(new THREE.Vector3(0, 0, -0.25));
    parent.add(glow);
    // letter illumination: a small spot aimed at the text
    const spot = new THREE.SpotLight(0xcfe2ff, 18, 26, 0.5, 0.7, 1.5);
    spot.position.copy(pos).add(new THREE.Vector3(0, 2, 5));
    spot.target.position.copy(pos);
    parent.add(spot, spot.target);
    this.lights.push(spot);
  }

  private addGroundText(parent: THREE.Object3D, pos: THREE.Vector3, text: string, opacity: number) {
    const c = document.createElement('canvas');
    c.width = 1024;
    c.height = 256;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, 1024, 256);
    ctx.fillStyle = '#dbe8ff';
    ctx.font = '700 150px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 512, 128);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(9, 2.25),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity, depthWrite: false, toneMapped: false }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.copy(pos);
    parent.add(mesh);
  }

  // ------------------------------------------------------------------- distant
  private buildDistant() {
    const g = new THREE.Group();
    g.name = 'distant';
    const rnd = mulberry32(31415);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + 0.2;
      const r = 250 + rnd() * 130;
      const h = 40 + rnd() * 150;
      const w = 12 + rnd() * 34;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const lod = new THREE.LOD();
      const hi = new THREE.Group();
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, w * 0.7), this.mats.city);
      b.position.y = h / 2;
      hi.add(b);
      // emissive edge strips
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.4, h * 0.9, 0.4), this.mats.emissiveBlue);
      strip.position.set(-w / 2 + 0.4, h * 0.5, w * 0.35);
      hi.add(strip);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(w * 0.7, 2, w * 0.4), this.mats.emissiveWhite);
      cap.position.y = h + 1;
      hi.add(cap);
      const lo = new THREE.Mesh(new THREE.BoxGeometry(w, h, w * 0.7), this.mats.city);
      lo.position.y = h / 2;
      lod.addLevel(hi, 0);
      lod.addLevel(lo, 230);
      lod.position.set(x, 0, z);
      lod.rotation.y = rnd() * 2;
      g.add(lod);
      this.lodGroups.push(lod);
    }
    // far monolithic rings
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(80 + i * 40, 1.4, 8, 64), this.mats.ruin);
      ring.position.set(-180 + i * 170, 90 + i * 30, -330);
      ring.rotation.set(0.4 + i * 0.2, i * 0.6, 0.3);
      g.add(ring);
    }
    this.group.add(g);
  }

  // ------------------------------------------------------------------- shards
  private buildShards() {
    const geo = new THREE.TetrahedronGeometry(0.5, 0);
    const count = 300;
    this.shards = new THREE.InstancedMesh(geo, this.mats.shard, count);
    this.shards.frustumCulled = true;
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < count; i++) {
      // favour the arrival area and the center
      const region = this.rnd();
      let x, z;
      if (region < 0.5) {
        x = -50 + this.rnd() * 100;
        z = 120 + this.rnd() * 170;
      } else if (region < 0.8) {
        const a = this.rnd() * Math.PI * 2;
        const r = 30 + this.rnd() * 120;
        x = Math.cos(a) * r;
        z = -18 + Math.sin(a) * r;
      } else {
        x = -160 + this.rnd() * 320;
        z = -160 + this.rnd() * 320;
      }
      const y = this.groundY(x, z) + 2 + this.rnd() * 28;
      const s = 0.22 + this.rnd() * 1.5;
      const p = new THREE.Vector3(x, y, z);
      const rot = new THREE.Vector3(this.rnd() * 6, this.rnd() * 6, this.rnd() * 6);
      this.shardData.push({ p, s, r: rot, seed: this.rnd() * 10 });
      m4.compose(p, new THREE.Quaternion().setFromEuler(new THREE.Euler(rot.x, rot.y, rot.z)), new THREE.Vector3(s, s, s));
      this.shards.setMatrixAt(i, m4);
    }
    this.shards.instanceMatrix.needsUpdate = true;
    this.group.add(this.shards);
  }

  private buildErrorRain() {
    // vertical planes with error text, seen at a distance like corrupted buffers
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 512;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, 256, 512);
    ctx.fillStyle = 'rgba(160,200,255,0.09)';
    ctx.fillRect(0, 0, 256, 512);
    ctx.fillStyle = 'rgba(210,230,255,0.85)';
    ctx.font = '16px monospace';
    const lines = ['0x000000EF', 'CRITICAL', 'PROCESS', 'DIED', 'MEMORY', '0x7FF6', 'UNREADABLE', 'RETRY?', ':(', '!!', '0xC000009A'];
    for (let i = 0; i < 26; i++) {
      ctx.globalAlpha = 0.15 + Math.random() * 0.7;
      ctx.fillText(lines[Math.floor(Math.random() * lines.length)], Math.random() * 180, 20 + Math.random() * 480);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.32, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide });
    const geo = new THREE.PlaneGeometry(2.4, 4.8);
    const count = 60;
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < count; i++) {
      const x = -140 + this.rnd() * 280;
      const z = -80 + this.rnd() * 320;
      const y = this.groundY(x, z) + 3 + this.rnd() * 20;
      m4.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, this.rnd() * 6, 0)), new THREE.Vector3(1, 1, 1));
      mesh.setMatrixAt(i, m4);
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.rainMeshes.push(mesh);
    this.group.add(mesh);
  }

  private buildDataStreams() {
    const pts: number[] = [];
    for (let i = 0; i < 90; i++) {
      const a = this.rnd() * Math.PI * 2;
      const r = 22 + this.rnd() * 30;
      const x = Math.cos(a) * r;
      const z = -18 + Math.sin(a) * r;
      const y = 0.2 + this.rnd() * 26;
      pts.push(x, y, z, x + (this.rnd() - 0.5) * 0.4, y + 1 + this.rnd() * 3, z + (this.rnd() - 0.5) * 0.4);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const mat = new THREE.LineBasicMaterial({ color: 0x8fc0ff, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, toneMapped: false });
    this.dataStream = new THREE.LineSegments(geo, mat);
    this.group.add(this.dataStream);
  }

  private buildLights() {
    const hemi = new THREE.HemisphereLight(0x2d4d94, 0x03060e, 1.05);
    this.ambientGroup.add(hemi);
    const moon = new THREE.DirectionalLight(0x93b2ff, 1.6);
    moon.position.set(-80, 100, 120);
    this.ambientGroup.add(moon);
    const fill = new THREE.PointLight(0x5a7fff, 4.0, 60, 2);
    fill.position.set(0, 30, 40);
    this.ambientGroup.add(fill);
    this.lights.push(hemi, moon, fill);
  }

  private buildLore() {
    // Interactables are added by the lore stones; the console hint is in the UI fragments.
  }

  private addLoreStone(parent: THREE.Object3D, pos: THREE.Vector3, id: string, label: string, lines: string[]) {
    const stone = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.85, 1.6, 6), this.mats.ruin);
    stone.position.copy(pos).add(new THREE.Vector3(0, 0.8, 0));
    stone.receiveShadow = true;
    parent.add(stone);
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.18), this.mats.emissiveBlue);
    glow.position.copy(pos).add(new THREE.Vector3(0, 1.28, 0.66));
    parent.add(glow);
    this.interactables.push({
      id,
      label,
      position: stone.position.clone(),
      radius: 2.4,
      enabled: () => true,
      use: () => {},
    });
    this.loreLines[id] = lines;
    this.loreLabel[id] = label;
  }

  loreLines: Record<string, string[]> = {};
  loreLabel: Record<string, string> = {};

  private addUiFragment(
    parent: THREE.Object3D,
    pos: THREE.Vector3,
    w: number,
    h: number,
    lines: string[],
    opacity: number,
    hint = false,
    faceWall = false,
  ) {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 320;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, 512, 320);
    ctx.fillStyle = 'rgba(4,10,26,0.82)';
    ctx.fillRect(0, 0, 512, 320);
    ctx.strokeStyle = 'rgba(120,170,255,0.65)';
    ctx.lineWidth = 2;
    ctx.strokeRect(8, 8, 496, 304);
    ctx.fillStyle = 'rgba(120,170,255,0.75)';
    ctx.font = '700 20px ui-monospace, monospace';
    ctx.fillText('// SYSTEM_FRAGMENT', 28, 48);
    ctx.fillStyle = 'rgba(220,235,255,0.92)';
    ctx.font = '700 34px ui-monospace, monospace';
    lines.forEach((l, i) => {
      ctx.globalAlpha = i === lines.length - 1 && l.includes('WAKE') ? 0.35 : 1;
      ctx.fillText(l, 28, 100 + i * 44);
    });
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(120,170,255,0.10)';
    for (let y = 0; y < 320; y += 4) ctx.fillRect(0, y, 512, 1);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity, toneMapped: false, depthWrite: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    mesh.position.copy(pos);
    if (faceWall) mesh.rotation.y = Math.PI;
    parent.add(mesh);
    if (hint) {
      const self = this;
      this.interactables.push({
        id: 'console_hint',
        label: '破損したパネルを調べる',
        position: pos.clone(),
        radius: 3.0,
        enabled: () => true,
        use: () => {
          self.consoleHintSeen = true;
        },
      });
    }
    // faint backing sheet so it reads as a physical panel
    const back = new THREE.Mesh(new THREE.PlaneGeometry(w * 1.06, h * 1.12), this.mats.ghost);
    back.position.copy(pos).add(new THREE.Vector3(0, 0, faceWall ? -0.02 : 0.02));
    if (faceWall) back.rotation.y = Math.PI;
    parent.add(back);
    // register a hint interaction
  }

  private lightShaft(parent: THREE.Object3D, base: THREE.Vector3, radius: number, height: number, color: number, opacity: number) {
    const geo = new THREE.ConeGeometry(radius, height, 18, 1, true);
    geo.translate(0, height / 2, 0);
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
      fog: true,
    });
    const cone = new THREE.Mesh(geo, mat);
    cone.position.copy(base);
    cone.rotation.z = 0.02;
    parent.add(cone);
  }

  // ------------------------------------------------------------------- update
  update(dt: number, time: number, camera: THREE.PerspectiveCamera) {
    const cameraPos = camera.position;
    this.time = time;
    this.uTime.value = time;

    // animated hero objects
    for (const a of this.animated) {
      if (a.kind === 'float') {
        a.obj.position.y = a.base.y + Math.sin(time * 0.42 + a.seed) * 0.3;
        a.obj.rotation.y += dt * 0.02;
      } else if (a.kind === 'orbit') {
        const ang = a.seed + time * 0.02;
        const r = Math.hypot(a.base.x, a.base.z) || 1;
        a.obj.position.x = Math.cos(ang) * r;
        a.obj.position.z = -18 + Math.sin(ang) * r;
        a.obj.rotation.y += dt * 0.08;
      } else if (a.kind === 'beacon') {
        const m = a.obj as THREE.Mesh;
        const mat = m.material as THREE.MeshBasicMaterial;
        mat.opacity = 0.09 + Math.sin(time * 0.45) * 0.035;
      } else if (a.kind === 'rotateRing') {
        a.obj.rotation.z += dt * 0.012;
      } else if (a.kind === 'pulseText') {
        const m = a.obj as THREE.Mesh;
        const mat = m.material as THREE.MeshStandardMaterial;
        mat.emissiveIntensity = 1.6 + Math.sin(time * 0.9) * 0.35;
      }
    }

    // shards drift
    if (this.shards) {
      const m4 = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const s = new THREE.Vector3();
      for (let i = 0; i < this.shardData.length; i++) {
        const d = this.shardData[i];
        const y = d.p.y + Math.sin(time * 0.18 + d.seed) * 0.8;
        const x = d.p.x + Math.sin(time * 0.07 + d.seed * 2) * 0.4;
        q.setFromEuler(new THREE.Euler(d.r.x + time * 0.05, d.r.y + time * 0.03, d.r.z));
        s.setScalar(d.s);
        m4.compose(new THREE.Vector3(x, y, d.p.z), q, s);
        this.shards.setMatrixAt(i, m4);
      }
      this.shards.instanceMatrix.needsUpdate = true;
    }
    // error rain faces the camera around Y
    for (const m of this.rainMeshes) {
      m.rotation.y = Math.atan2(cameraPos.x, cameraPos.z) * 0.02;
    }
    if (this.dataStream) {
      (this.dataStream.material as THREE.LineBasicMaterial).opacity = 0.24 + Math.sin(time * 0.8) * 0.08;
    }
    // distance culling (simple streaming): hide zones well beyond the fog
    for (const z of this.zones) {
      const d = Math.hypot(cameraPos.x - z.center.x, cameraPos.z - z.center.z);
      z.group.visible = d < 340;
    }
    for (const lod of this.lodGroups) lod.update(camera);
  }

  /** nearest interactable in front of the player (distance + facing cone) */
  findInteractable(cameraPos: THREE.Vector3, forward: THREE.Vector3, maxDist = 3.2) {
    let best: Interactable | null = null;
    let bestScore = Infinity;
    for (const it of this.interactables) {
      if (!it.enabled()) continue;
      const d = it.position.distanceTo(cameraPos);
      if (d > Math.min(it.radius, maxDist)) continue;
      const dir = it.position.clone().sub(cameraPos).normalize();
      const dot = dir.dot(forward);
      if (dot < 0.35) continue;
      const score = d - dot;
      if (score < bestScore) {
        best = it;
        bestScore = score;
      }
    }
    return best;
  }

  setEnv(scene: THREE.Scene, assets: Assets) {
    scene.environment = assets.env('night') ?? assets.env('city') ?? null;
    scene.environmentIntensity = 1.0;
    scene.fog = new THREE.FogExp2(FOG_COLOR, 0.0032);
  }

  clearDynamic() {
    for (const child of [...this.dynamicGroup.children]) {
      this.dynamicGroup.remove(child);
      child.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.geometry?.dispose?.();
          const mat = m.material as THREE.Material | THREE.Material[];
          if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
          else mat?.dispose?.();
        }
      });
    }
  }

  dispose() {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry?.dispose?.();
      }
    });
    this.group.removeFromParent();
  }
}
