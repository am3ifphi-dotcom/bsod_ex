import * as THREE from 'three';
import type { CollisionWorld } from '../core/Collision';
import type { AreaContext, Area, Interactable } from './types';
import { LAYOUT, WORLD_Y } from './types';
import type { AssetStore } from '../assets/Assets';
import { updateCorruptionUniforms } from '../assets/Assets';
import type { MaterialLibrary } from '../assets/Materials';
import { buildArrival } from './areas/Arrival';
import { buildPlaza } from './areas/Plaza';
import { buildAtrium } from './areas/Atrium';
import { buildStreet } from './areas/Street';
import { buildDeep } from './areas/Deep';
import { buildCore } from './areas/Core';
import { glowSprite, lightShaft, textPlane } from './worldkit';
import { cable } from './Geo';
import { Rng, clamp01 } from '../core/math';
import { buildTunnel, type Tunnel } from './Tunnel';

export interface WorldResult {
  group: THREE.Group;
  areas: Area[];
  interactables: Interactable[];
  keyLight: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  tunnel: Tunnel;
  update(dt: number, time: number, playerPos: THREE.Vector3): void;
  setGlitch(amount: number): void;
  onApproachCore(cb: () => void): void;
  /** removes a disc of the core platform floor and returns the spawn point for debris */
  breakFloor(center: THREE.Vector3): THREE.Vector3[];
  reset(): void;
}

export async function buildWorld(opts: {
  store: AssetStore;
  mats: MaterialLibrary;
  collision: CollisionWorld;
  detail: number;
}): Promise<WorldResult> {
  const group = new THREE.Group();
  group.name = 'glitch-world';
  group.position.y = 0;
  const ctx: AreaContext = {
    collision: opts.collision,
    mats: opts.mats,
    store: opts.store,
    baseY: WORLD_Y,
    detail: opts.detail,
  };
  const rng = new Rng(424242);

  const areas: Area[] = [];
  areas.push(await buildArrival(ctx));
  areas.push(await buildPlaza(ctx));
  areas.push(await buildAtrium(ctx));
  areas.push(await buildStreet(ctx));
  areas.push(await buildDeep(ctx));
  areas.push(await buildCore(ctx));
  for (const a of areas) group.add(a.group);

  /* ---------------------------------------------------------------- bridges */
  const bridgeMat = opts.mats.get('concreteDark', 0.3);
  const railMat = opts.mats.solid({ color: 0x1c2634, metalness: 0.75, roughness: 0.45 });

  const buildBridge = (x0: number, x1: number, z0: number, z1: number, width: number, axis: 'x' | 'z') => {
    const alongX = axis === 'x';
    const len = alongX ? x1 - x0 : z1 - z0;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const w = alongX ? len : width;
    const d = alongX ? width : len;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(w, 0.7, d), bridgeMat);
    deck.position.set(cx, WORLD_Y - 0.35, cz);
    deck.receiveShadow = true;
    deck.castShadow = true;
    group.add(deck);
    opts.collision.add({ min: [cx - w / 2, WORLD_Y - 0.7, cz - d / 2], max: [cx + w / 2, WORLD_Y, cz + d / 2], tag: 'bridge' });

    // railings (solid to collision: no accidental falls)
    const half = width / 2;
    for (const s of [-1, 1]) {
      const railLen = len;
      const rw = alongX ? railLen : 0.18;
      const rd = alongX ? 0.18 : railLen;
      const rx = alongX ? cx : cx + s * (half - 0.09);
      const rz = alongX ? cz + s * (half - 0.09) : cz;
      const rail = new THREE.Mesh(new THREE.BoxGeometry(rw, 1.05, rd), railMat);
      rail.position.set(rx, WORLD_Y + 0.52, rz);
      group.add(rail);
      opts.collision.add({
        min: [rx - rw / 2, WORLD_Y + 0.2, rz - rd / 2],
        max: [rx + rw / 2, WORLD_Y + 1.15, rz + rd / 2],
        tag: 'bridge-rail',
      });
      // posts
      const count = Math.max(2, Math.floor(railLen / 6));
      for (let i = 0; i <= count; i++) {
        const t = i / count;
        const px = alongX ? x0 + t * len : rx;
        const pz = alongX ? rz : z0 + t * len;
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.15, 0.22), railMat);
        post.position.set(px, WORLD_Y + 0.57, pz);
        group.add(post);
      }
    }
    // pylon arches for a bit of silhouette
    const pylons = Math.max(2, Math.floor(len / 16));
    for (let i = 1; i < pylons; i++) {
      const t = i / pylons;
      const px = alongX ? x0 + t * len : cx;
      const pz = alongX ? cz : z0 + t * len;
      for (const s of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.5, 9, 0.5), bridgeMat);
        leg.position.set(px + (alongX ? 0 : s * (half + 1.2)), WORLD_Y - 4.5, pz + (alongX ? s * (half + 1.2) : 0));
        group.add(leg);
        const brace = new THREE.Mesh(new THREE.BoxGeometry(alongX ? 0.25 : half * 2 + 2.4, 0.3, alongX ? half * 2 + 2.4 : 0.25), railMat);
        brace.position.set(px, WORLD_Y + 0.2, pz);
        group.add(brace);
      }
      // hanging lamp under the arch
      const lamp = glowSprite(4, 0x6fa8ff, 0.35);
      lamp.position.set(px, WORLD_Y + 2.4, pz);
      group.add(lamp);
    }
    return { cx, cz };
  };

  // arrival <-> plaza
  // arrival <-> plaza: the path runs north from the plateau to the plaza's north edge
  buildBridge(-LAYOUT.path.halfWidth, LAYOUT.path.halfWidth,
    LAYOUT.plaza.max.z, LAYOUT.arrival.center.z - LAYOUT.arrival.half.z, LAYOUT.path.halfWidth * 2, 'z');
  // plaza <-> atrium
  const ab = LAYOUT.atriumBridge;
  // corridor to the atrium: a narrow bridge along x
  {
    const deck = new THREE.Mesh(new THREE.BoxGeometry(ab.x1 - ab.x0, 0.7, ab.halfWidth * 2), bridgeMat);
    deck.position.set((ab.x0 + ab.x1) / 2, WORLD_Y - 0.35, ab.z);
    group.add(deck);
    opts.collision.add({ min: [ab.x0, WORLD_Y - 0.7, ab.z - ab.halfWidth], max: [ab.x1, WORLD_Y, ab.z + ab.halfWidth], tag: 'bridge' });
    for (const s of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(ab.x1 - ab.x0, 1.05, 0.18), railMat);
      rail.position.set((ab.x0 + ab.x1) / 2, WORLD_Y + 0.52, ab.z + s * (ab.halfWidth - 0.09));
      group.add(rail);
      opts.collision.add({ min: [ab.x0, WORLD_Y + 0.2, ab.z + s * ab.halfWidth - 0.12], max: [ab.x1, WORLD_Y + 1.15, ab.z + s * ab.halfWidth + 0.12], tag: 'bridge-rail' });
    }
  }
  // plaza <-> street
  {
    const sb = LAYOUT.streetBridge;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(sb.x1 - sb.x0, 0.7, sb.halfWidth * 2), bridgeMat);
    deck.position.set((sb.x0 + sb.x1) / 2, WORLD_Y - 0.35, sb.z);
    group.add(deck);
    opts.collision.add({ min: [sb.x0, WORLD_Y - 0.7, sb.z - sb.halfWidth], max: [sb.x1, WORLD_Y, sb.z + sb.halfWidth], tag: 'bridge' });
    for (const s of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(sb.x1 - sb.x0, 1.05, 0.18), railMat);
      rail.position.set((sb.x0 + sb.x1) / 2, WORLD_Y + 0.52, sb.z + s * (sb.halfWidth - 0.09));
      group.add(rail);
      opts.collision.add({ min: [sb.x0, WORLD_Y + 0.2, sb.z + s * sb.halfWidth - 0.12], max: [sb.x1, WORLD_Y + 1.15, sb.z + s * sb.halfWidth + 0.12], tag: 'bridge-rail' });
    }
  }
  // plaza <-> core: the long bridge
  {
    const cb = LAYOUT.coreBridge;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(cb.halfWidth * 2, 0.8, cb.z1 - cb.z0), bridgeMat);
    deck.position.set(0, WORLD_Y - 0.4, (cb.z0 + cb.z1) / 2);
    deck.receiveShadow = true;
    deck.castShadow = true;
    group.add(deck);
    opts.collision.add({ min: [-cb.halfWidth, WORLD_Y - 0.8, cb.z0], max: [cb.halfWidth, WORLD_Y, cb.z1], tag: 'core-bridge' });
    for (const s of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.1, cb.z1 - cb.z0), railMat);
      rail.position.set(s * (cb.halfWidth - 0.1), WORLD_Y + 0.55, (cb.z0 + cb.z1) / 2);
      group.add(rail);
      opts.collision.add({
        min: [s * (cb.halfWidth - 0.2), WORLD_Y + 0.2, cb.z0],
        max: [s * (cb.halfWidth + 0.02), WORLD_Y + 1.2, cb.z1],
        tag: 'bridge-rail',
      });
    }
    // pylons + hanging lamps along the long bridge make the walk feel vast
    for (let z = cb.z1 - 8; z > cb.z0; z -= 14) {
      for (const s of [-1, 1]) {
        const tower = new THREE.Mesh(new THREE.BoxGeometry(1.4, 14, 1.4), bridgeMat);
        tower.position.set(s * (cb.halfWidth + 1.6), WORLD_Y - 6, z);
        tower.castShadow = true;
        group.add(tower);
        const beam = new THREE.Mesh(new THREE.BoxGeometry(cb.halfWidth * 2 + 4.4, 0.5, 0.7), railMat);
        beam.position.set(0, WORLD_Y + 6.2, z);
        group.add(beam);
      }
      const hang = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 4, 4), railMat);
      hang.position.set(0, WORLD_Y + 4.0, z);
      group.add(hang);
      const lamp = glowSprite(5, 0x6fa8ff, 0.4);
      lamp.position.set(0, WORLD_Y + 2.0, z);
      group.add(lamp);
    }
    // guide text along the floor
    for (let z = cb.z1 - 20; z > cb.z0 + 10; z -= 26) {
      const t = textPlane(['THIS WAY', 'BACK'], 2.6, { color: '#8fb8e8', additive: true, opacity: 0.35 });
      t.rotation.x = -Math.PI / 2;
      t.rotation.z = Math.PI / 2;
      t.position.set(0, WORLD_Y + 0.02, z);
      group.add(t);
    }
  }

  /* ------------------------------------------------ world-scale light rig */
  const hemi = new THREE.HemisphereLight(0x1b3a66, 0x02040a, 0.65);
  group.add(hemi);
  const keyLight = new THREE.DirectionalLight(0x9fc0ff, 1.35);
  keyLight.position.set(60, WORLD_Y + 90, 40);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  keyLight.shadow.camera.left = -70;
  keyLight.shadow.camera.right = 70;
  keyLight.shadow.camera.top = 70;
  keyLight.shadow.camera.bottom = -70;
  keyLight.shadow.camera.near = 10;
  keyLight.shadow.camera.far = 260;
  keyLight.shadow.bias = -0.0006;
  keyLight.shadow.normalBias = 0.06;
  group.add(keyLight);
  group.add(keyLight.target);

  // a faint counter-light from below so silhouettes read
  const fill = new THREE.DirectionalLight(0x1a3f7a, 0.4);
  fill.position.set(-40, WORLD_Y - 30, -60);
  group.add(fill);

  /* ------------------------------------------------------- distant skyline */
  const skyline = buildSkyline(opts.mats);
  group.add(skyline);

  /* ---------------------------------------------------------- ground clouds */
  const haze = buildHaze();
  group.add(haze);

  /* --------------------------------------------------------------- tunnel */
  const tunnel = buildTunnel(opts.mats, opts.detail);

  /* ------------------------------------------------------------- interact */
  const interactables: Interactable[] = [];
  for (const a of areas) interactables.push(...a.interactables);

  /* ------------------------------------------------------------- runtime */
  let glitch = 0;
  const detailed = new Map<Area, boolean>();
  const coreCallbacks: (() => void)[] = [];
  let coreNotified = false;
  const shadowTarget = new THREE.Vector3();
  const areaLights = new Map<Area, boolean>();

  for (const a of areas) {
    for (const l of a.lights) {
      l.userData.baseIntensity = l.intensity;
    }
  }

  /* ----------------------------------------------------- floor destruction */
  let pit: THREE.Group | null = null;
  const buildPit = (center: THREE.Vector3): THREE.Group => {
    const g = new THREE.Group();
    g.position.set(center.x, center.y + 0.02, center.z);
    // the hole itself: a black disc that reads as an abyss from every angle
    const holeTex = (() => {
      const c = document.createElement('canvas');
      c.width = c.height = 512;
      const x = c.getContext('2d')!;
      x.fillStyle = '#000';
      x.beginPath();
      const n = 30;
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * Math.PI * 2;
        const r = 214 + Math.sin(i * 5.3) * 22 + Math.sin(i * 2.1) * 14;
        const px = 256 + Math.cos(a) * r;
        const py = 256 + Math.sin(a) * r;
        if (i === 0) x.moveTo(px, py); else x.lineTo(px, py);
      }
      x.closePath();
      x.fill();
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    const disc = new THREE.Mesh(
      new THREE.PlaneGeometry(19, 19),
      new THREE.MeshBasicMaterial({ map: holeTex, transparent: true, depthWrite: false, toneMapped: false, color: 0x01030a }),
    );
    disc.rotation.x = -Math.PI / 2;
    disc.renderOrder = -1;
    g.add(disc);
    // a dark shaft under the hole, so falling reads as depth rather than clipping
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(8.4, 4.2, 80, 28, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x02040a, side: THREE.BackSide, toneMapped: false }),
    );
    shaft.position.y = -40;
    g.add(shaft);
    // jagged rim shards, lit from inside
    const rimMat = new THREE.MeshStandardMaterial({
      color: 0x0a1220, roughness: 0.45, metalness: 0.5, emissive: 0x1c4f9c, emissiveIntensity: 0.55,
    });
    const rng3 = new Rng(1337);
    for (let i = 0; i < 34; i++) {
      const a = (i / 34) * Math.PI * 2;
      const r = 8.4 + rng3.float(-0.5, 0.9);
      const shard = new THREE.Mesh(new THREE.BoxGeometry(rng3.float(1.2, 3.4), rng3.float(0.2, 0.8), rng3.float(1.2, 3.2)), rimMat);
      shard.position.set(Math.cos(a) * r, rng3.float(-0.35, 0.1), Math.sin(a) * r);
      shard.rotation.set(rng3.float(-0.25, 0.25), -a, rng3.float(-0.3, 0.3));
      g.add(shard);
    }
    const glow = new THREE.PointLight(0x5a9dff, 60, 40, 2);
    glow.position.y = -2;
    g.add(glow);
    return g;
  };

  const breakFloor = (center: THREE.Vector3): THREE.Vector3[] => {
    // carve whatever the player is standing on (visual + collision) in a 15 m disc
    opts.collision.disableFloorNear(center.x, center.y, center.z, 7.5);
    opts.collision.removeTagNear('core-floor', center.x, center.z, 7.5);
    opts.collision.removeTagNear('core-dais', center.x, center.z, 7.5);
    const plat = group.getObjectByName('core-plat');
    if (plat) plat.visible = false;
    if (!pit) {
      pit = buildPit(center);
      group.add(pit);
    }
    const spawns: THREE.Vector3[] = [];
    const rng2 = new Rng(99);
    for (let i = 0; i < 26; i++) {
      const a = rng2.float(0, Math.PI * 2);
      const r = rng2.float(0, 8);
      spawns.push(new THREE.Vector3(center.x + Math.cos(a) * r, center.y + rng2.float(0.1, 0.5), center.z + Math.sin(a) * r));
    }
    return spawns;
  };

  const update = (dt: number, time: number, playerPos: THREE.Vector3) => {
    updateCorruptionUniforms(time, 0.1 + glitch * 0.9);
    for (const a of areas) {
      const active = a.bounds.min.distanceTo(playerPos) < 220 || a.bounds.max.distanceTo(playerPos) < 220;
      if (a.group.visible !== active) a.group.visible = active;
      if (active && areaLights.get(a) !== true) {
        for (const l of a.lights) l.visible = true;
        areaLights.set(a, true);
      } else if (!active && areaLights.get(a) !== false) {
        for (const l of a.lights) l.visible = false;
        areaLights.set(a, false);
      }
      if (active) a.update?.(dt, time, playerPos);
      // detail streaming: heavy small props only when close
      const close = a.bounds.min.distanceTo(playerPos) < 90 || a.bounds.max.distanceTo(playerPos) < 90;
      if (detailed.get(a) !== close) {
        detailed.set(a, close);
        a.setDetailed?.(close);
      }
    }
    // shadow camera follows the player, snapped to texels to avoid shimmering
    const texel = 140 / 2048;
    shadowTarget.set(
      Math.round(playerPos.x / texel) * texel,
      WORLD_Y,
      Math.round(playerPos.z / texel) * texel,
    );
    keyLight.position.set(shadowTarget.x + 60, WORLD_Y + 90, shadowTarget.z + 40);
    keyLight.target.position.copy(shadowTarget);
    keyLight.target.updateMatrixWorld();

    haze.rotation.y = time * 0.004;
    (haze.children[haze.children.length - 1] as THREE.Points).rotation.y = time * 0.02;

    // the core reveals itself when the player gets close
    if (!coreNotified) {
      const d = Math.hypot(playerPos.x - LAYOUT.monolith.x, playerPos.z - (LAYOUT.monolith.z + 20));
      if (d < 42) {
        coreNotified = true;
        for (const cb of coreCallbacks) cb();
      }
    }
    void rng;
  };

  const reset = () => {
    glitch = 0;
    coreNotified = false;
    for (const a of areas) {
      a.group.visible = true;
      areaLights.set(a, true);
      for (const l of a.lights) l.visible = true;
      a.setDetailed?.(false);
    }
    if (pit) {
      pit.parent?.remove(pit);
      pit.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose();
      });
      pit = null;
    }
    const plat = group.getObjectByName('core-plat');
    if (plat) plat.visible = true;
    opts.collision.restoreAll();
  };

  return {
    group,
    areas,
    interactables,
    keyLight,
    hemi,
    tunnel,
    update,
    setGlitch: (v: number) => { glitch = clamp01(v); },
    onApproachCore: (cb: () => void) => coreCallbacks.push(cb),
    breakFloor,
    reset,
  };
}

/** Low-detail distant city silhouettes (real geometry, LOD-able, not a skybox). */
function buildSkyline(_mats: MaterialLibrary): THREE.Group {
  const group = new THREE.Group();
  const rng = new Rng(8080);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x060c18, roughness: 0.6, metalness: 0.3,
    emissive: 0x0a1c34, emissiveIntensity: 0.45,
  });
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const matrices: THREE.Matrix4[] = [];
  for (let i = 0; i < 260; i++) {
    const a = rng.float(0, Math.PI * 2);
    const r = rng.float(170, 520);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const h = rng.float(20, 140) * (r > 350 ? 1.4 : 1);
    const w = rng.float(10, 46);
    const d = rng.float(10, 46);
    matrices.push(new THREE.Matrix4().compose(
      new THREE.Vector3(x, WORLD_Y + h / 2 - 20, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rng.float(0, Math.PI), 0)),
      new THREE.Vector3(w, h, d),
    ));
  }
  const inst = new THREE.InstancedMesh(geo, mat, matrices.length);
  matrices.forEach((m, i) => inst.setMatrixAt(i, m));
  inst.frustumCulled = false;
  group.add(inst);

  // faint windows on the distant blocks
  const dotMat = new THREE.PointsMaterial({
    color: 0x6fa8ff, size: 2.2, sizeAttenuation: true, transparent: true, opacity: 0.35,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const dots: number[] = [];
  for (let i = 0; i < 1500; i++) {
    const a = rng.float(0, Math.PI * 2);
    const r = rng.float(180, 480);
    dots.push(Math.cos(a) * r, WORLD_Y + rng.float(10, 110), Math.sin(a) * r);
  }
  const dotGeo = new THREE.BufferGeometry();
  dotGeo.setAttribute('position', new THREE.Float32BufferAttribute(dots, 3));
  group.add(new THREE.Points(dotGeo, dotMat));
  return group;
}

/** Slow drifting fog banks under the world, plus a distant particle veil. */
function buildHaze(): THREE.Group {
  const group = new THREE.Group();
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const c = canvas.getContext('2d')!;
  const grad = c.createRadialGradient(128, 128, 4, 128, 128, 128);
  grad.addColorStop(0, 'rgba(120,170,255,0.55)');
  grad.addColorStop(0.5, 'rgba(60,110,200,0.18)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = grad;
  c.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({
    map: tex, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending,
    depthWrite: false, toneMapped: false,
  });
  const rng = new Rng(3131);
  for (let i = 0; i < 26; i++) {
    const s = new THREE.Sprite(mat);
    s.scale.setScalar(rng.float(40, 120));
    const a = rng.float(0, Math.PI * 2);
    const r = rng.float(60, 260);
    s.position.set(Math.cos(a) * r, WORLD_Y + rng.float(-25, 6), Math.sin(a) * r + 10);
    group.add(s);
  }
  const dots = new THREE.Points(
    new THREE.BufferGeometry(),
    new THREE.PointsMaterial({ color: 0x8fc4ff, size: 0.6, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  const arr: number[] = [];
  for (let i = 0; i < 2000; i++) {
    arr.push(rng.float(-300, 300), WORLD_Y + rng.float(-40, 60), rng.float(-300, 300));
  }
  dots.geometry.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
  dots.frustumCulled = false;
  group.add(dots);
  return group;
}
