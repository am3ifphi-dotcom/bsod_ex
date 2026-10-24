import * as THREE from 'three';
import type { Area, AreaContext, Interactable } from '../types';
import { LAYOUT } from '../types';
import { dataMotes, errorWall, glowSprite, lightShaft, setShadow, textPlane } from '../worldkit';
import { buildBrokenTerminal } from './Arrival';
import { cable, railing } from '../Geo';
import { Rng } from '../../core/math';

/**
 * THE ATRIUM — the memory of a collapsed civic building rebuilt inside the machine.
 * Three storeys around an open void: ground hall, an L-shaped first-floor gallery and a small
 * roof terrace on the west wall. Every walkable edge is railed and collides; every stair is a
 * real ramp so movement never snags on the steps.
 */
export async function buildAtrium(ctx: AreaContext): Promise<Area> {
  const group = new THREE.Group();
  group.name = 'area-atrium';
  const Y = ctx.baseY;
  const rng = new Rng(5200);
  const A = LAYOUT.atrium;
  const wallMat = ctx.mats.get('concrete', 0.22, { color: 0x8fa2b8 });
  const floorMat = ctx.mats.get('concreteDark', 0.4);
  const trimMat = ctx.mats.get('metalRust', 0.9, { color: 0x6b7f96 });

  const L2 = Y + 4.5;
  const stairAX0 = -70, stairAX1 = -62;
  const L3 = Y + 9;
  const H = 24;

  /* ----------------------------------------------------------- ground slab */
  const ground = new THREE.Mesh(new THREE.BoxGeometry(A.max.x - A.min.x, 2, A.max.z - A.min.z), floorMat);
  ground.position.set((A.min.x + A.max.x) / 2, Y - 1, (A.min.z + A.max.z) / 2);
  ground.receiveShadow = true;
  group.add(ground);
  ctx.collision.add({ min: [A.min.x, Y - 2, A.min.z], max: [A.max.x, Y, A.max.z], tag: 'atrium-floor' });

  /* ----------------------------------------------------------------- walls */
  const wall = (x: number, z: number, w: number, d: number, h: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
    m.position.set(x, Y + h / 2, z);
    m.receiveShadow = true;
    m.castShadow = true;
    group.add(m);
    ctx.collision.add({ min: [x - w / 2, Y, z - d / 2], max: [x + w / 2, Y + h, z + d / 2], tag: 'atrium-wall' });
    return m;
  };
  wall((A.min.x + A.max.x) / 2, A.min.z - 0.5, A.max.x - A.min.x + 2, 1, H); // north
  wall((A.min.x + A.max.x) / 2, A.max.z + 0.5, A.max.x - A.min.x + 2, 1, H); // south
  wall(A.min.x - 0.5, (A.min.z + A.max.z) / 2, 1, A.max.z - A.min.z + 2, H); // west
  // east wall with the entrance opening (z 30..42)
  wall(A.max.x + 0.5, 18, 1, 24, H);
  wall(A.max.x + 0.5, 54, 1, 24, H);
  // lintel above the entrance: it must leave a walkable opening (2.8 m) underneath
  {
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(1, 2.2, 12), wallMat);
    lintel.position.set(A.max.x + 0.5, Y + 3.9, 36);
    lintel.castShadow = true;
    group.add(lintel);
    ctx.collision.add({ min: [A.max.x, Y + 2.8, 30], max: [A.max.x + 1, Y + 5.0, 42], tag: 'atrium-wall' });
  }

  // roof with a large skylight opening above the void
  const roofY = Y + H;
  const roofPanel = (x0: number, x1: number, z0: number, z1: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.5, z1 - z0), floorMat);
    m.position.set((x0 + x1) / 2, roofY + 0.25, (z0 + z1) / 2);
    m.receiveShadow = true;
    group.add(m);
  };
  roofPanel(A.min.x, A.max.x, A.min.z, 20);
  roofPanel(A.min.x, A.max.x, 54, A.max.z);
  roofPanel(A.min.x, -88, 20, 54);
  roofPanel(-56, A.max.x, 20, 54);

  /* --------------------------------------------------------------- L2 floor */
  const gallery = (x0: number, x1: number, z0: number, z1: number, y: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.4, z1 - z0), floorMat);
    m.position.set((x0 + x1) / 2, y - 0.2, (z0 + z1) / 2);
    m.receiveShadow = true;
    m.castShadow = true;
    group.add(m);
    ctx.collision.add({ min: [x0, y - 0.4, z0], max: [x1, y, z1], tag: 'atrium-gallery' });
    return m;
  };
  gallery(A.min.x, A.max.x, A.min.z, 20, L2);
  gallery(A.min.x, -92, A.min.z, 26, L3);

  /* ----------------------------------------------------------- guard rails */
  const railMat = ctx.mats.get('metalRust', 1.4, { color: 0x53657a });
  const addRail = (x0: number, z0: number, x1: number, z1: number, y: number, height = 1.1) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (len < 0.2) return;
    const midX = (x0 + x1) / 2, midZ = (z0 + z1) / 2;
    const horizontal = Math.abs(x1 - x0) > Math.abs(z1 - z0);
    const g = railing([
      new THREE.Vector3(x0, y, z0),
      new THREE.Vector3(x1, y, z1),
    ], height, railMat);
    group.add(g);
    const thick = 0.16;
    ctx.collision.add({
      min: [horizontal ? Math.min(x0, x1) : midX - thick, y, horizontal ? midZ - thick : Math.min(z0, z1)],
      max: [horizontal ? Math.max(x0, x1) : midX + thick, y + height, horizontal ? midZ + thick : Math.max(z0, z1)],
      tag: 'atrium-rail',
    });
  };
  // L2 north gallery inner edge (gap for stair A at x -70..-62)
  addRail(A.min.x, 20, -70, 20, L2);
  addRail(-62, 20, A.max.x, 20, L2);
  // L3 terrace edges (gap for stair B at z 8..14)
  addRail(-92, 20, -92, 26, L3);
  addRail(-92, 6, -92, 8, L3);
  addRail(-104, 26, -92, 26, L3);
  // stair A side rails + collision follow the slope
  for (let i = 0; i < 6; i++) {
    const z0 = 32 - i * 2;
    const z1 = z0 - 2;
    for (const rx of [stairAX0 - 0.15, stairAX1 + 0.15]) {
      const h = Y + 4.5 * ((32 - (z0 + z1) / 2) / 12);
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.05, 6), railMat);
      bar.position.set(rx, h + 1.0, (z0 + z1) / 2);
      bar.rotation.x = Math.PI / 2;
      bar.rotation.z = Math.atan2(4.5, 12);
      group.add(bar);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.0, 6), railMat);
      post.position.set(rx, h + 0.5, z0);
      group.add(post);
      ctx.collision.add({
        min: [rx - 0.15, h, z1], max: [rx + 0.15, h + 1.05, z0], tag: 'atrium-stairrail',
      });
    }
  }

  /* ------------------------------------------------------------- stair A */
  const stairAMat = ctx.mats.get('concrete', 0.5);
  const stairASteps = 18;
  const stairARun = 12 / stairASteps;
  for (let i = 0; i < stairASteps; i++) {
    const h = 4.5 * ((i + 1) / stairASteps);
    const step = new THREE.Mesh(new THREE.BoxGeometry(stairAX1 - stairAX0, h, stairARun + 0.02), stairAMat);
    step.position.set((stairAX0 + stairAX1) / 2, Y + h / 2, 32 - stairARun * (i + 0.5));
    step.receiveShadow = true;
    step.castShadow = true;
    group.add(step);
  }
  ctx.collision.add({
    min: [stairAX0, Y, 20], max: [stairAX1, L2, 32],
    ramp: { axis: 2, yLow: L2, yHigh: Y, walkable: true }, tag: 'atrium-stair-a',
  });

  /* ------------------------------------------------------------- stair B */
  const stairBSteps = 12;
  const stairBRun = 8 / stairBSteps;
  for (let i = 0; i < stairBSteps; i++) {
    const h = 4.5 * ((i + 1) / stairBSteps);
    const step = new THREE.Mesh(new THREE.BoxGeometry(stairBRun + 0.02, h, 6), stairAMat);
    step.position.set(-84 - stairBRun * (i + 0.5), L2 + h / 2, 11);
    step.receiveShadow = true;
    group.add(step);
  }
  ctx.collision.add({
    min: [-92, L2, 8], max: [-84, L3, 14],
    ramp: { axis: 0, yLow: L3, yHigh: L2, walkable: true }, tag: 'atrium-stair-b',
  });

  /* ---------------------------------------------------------------- support columns */
  const colMat = ctx.mats.get('concrete', 0.3);
  for (const [cx, cz] of [[-88, 20], [-56, 20], [-88, 54], [-56, 54], [-104 + 4, 36], [-44, 36]] as const) {
    const col = new THREE.Mesh(new THREE.BoxGeometry(1.4, H, 1.4), colMat);
    col.position.set(cx, Y + H / 2, cz);
    col.castShadow = true;
    col.receiveShadow = true;
    group.add(col);
    ctx.collision.add({ min: [cx - 0.7, Y, cz - 0.7], max: [cx + 0.7, Y + H, cz + 0.7], tag: 'atrium-column' });
  }

  /* ------------------------------------------------------------- skylight */
  const shaft = lightShaft(13, H + 6, 0x7fb4ff, 0.13);
  shaft.position.set(-72, Y + H / 2 + 1, 37);
  group.add(shaft);
  const skylight = new THREE.SpotLight(0xa9ccff, 2.6, 40, 0.6, 0.8, 1.2);
  skylight.position.set(-72, roofY + 6, 37);
  skylight.target.position.set(-72, Y, 37);
  skylight.castShadow = true;
  skylight.shadow.mapSize.set(1024, 1024);
  skylight.shadow.camera.near = 2;
  skylight.shadow.camera.far = 34;
  skylight.shadow.bias = -0.0012;
  group.add(skylight, skylight.target);

  /* ------------------------------------------------------------ error walls */
  const westWallText = errorWall(30, 12, 91, 5, 14);
  westWallText.position.set(A.min.x + 0.6, Y + 9, 36);
  westWallText.rotation.y = Math.PI / 2;
  group.add(westWallText);
  const bigText = textPlane(['SYSTEM INTEGRITY', '4 7 %'], 22, { color: '#dbeaff', additive: true, opacity: 0.5 });
  bigText.position.set(A.min.x + 0.7, Y + 17, 36);
  bigText.rotation.y = Math.PI / 2;
  group.add(bigText);

  /* ------------------------------------------------------------- hanging debris */
  const beamMat = ctx.mats.get('concrete', 0.5);
  for (let i = 0; i < 9; i++) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(rng.float(0.4, 1.2), rng.float(2, 7), rng.float(0.4, 1.2)), beamMat);
    beam.position.set(rng.float(-100, -44), Y + H - rng.float(1, 7), rng.float(10, 60));
    beam.rotation.set(rng.float(-0.3, 0.3), rng.float(0, 3), rng.float(-0.25, 0.25));
    beam.castShadow = true;
    group.add(beam);
  }
  for (let i = 0; i < 6; i++) {
    const cx = rng.float(-100, -44);
    const cz = rng.float(8, 62);
    group.add(cable([
      new THREE.Vector3(cx, roofY - 0.2, cz),
      new THREE.Vector3(cx + rng.float(-1, 1), Y + H * 0.6, cz + rng.float(-1, 1)),
      new THREE.Vector3(cx + rng.float(-2, 2), Y + rng.float(2, 7), cz + rng.float(-2, 2)),
    ], 0.02, ctx.mats.solid({ color: 0x11151b, roughness: 0.8 }), 24));
  }

  /* ------------------------------------------------------------- furniture */
  const sofa = await ctx.store.instantiate('glamSofa', {
    position: new THREE.Vector3(-96, L2, 40), rotationY: 0.4, tint: 'world',
  });
  group.add(sofa);
  const sofa2 = await ctx.store.instantiate('leatherSofa', {
    position: new THREE.Vector3(-48.5, Y, 56), rotationY: -1.3, tint: 'world-dark',
  });
  group.add(sofa2);
  ctx.collision.add({ min: [-49.5, Y, 54.6], max: [-47.5, Y + 1.1, 57.4], tag: 'atrium-sofa' });
  const fridge = await ctx.store.instantiate('fridge', {
    position: new THREE.Vector3(-48, Y, 14), rotationY: Math.PI / 2, tint: 'world',
  });
  group.add(fridge);
  const chair = await ctx.store.instantiate('sheenChair', {
    position: new THREE.Vector3(-60, L2, 24), rotationY: 2.4, tint: 'world',
  });
  group.add(chair);

  // the helmet on a plinth, lit like a museum piece
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.5, 1.2, 12), ctx.mats.get('concreteDark', 0.6));
  plinth.position.set(-72, Y + 0.6, 37);
  plinth.castShadow = true;
  plinth.receiveShadow = true;
  group.add(plinth);
  ctx.collision.add({ min: [-73.5, Y, 35.5], max: [-70.5, Y + 1.2, 38.5], tag: 'atrium-plinth' });
  const helmet = await ctx.store.instantiate('flightHelmet', {
    position: new THREE.Vector3(-72, Y + 1.2, 37), rotationY: 0.6, scale: 1.35, tint: 'world',
    tweak: (m) => { m.emissiveIntensity = 0.35; },
  });
  group.add(helmet);
  const helmLight = new THREE.PointLight(0x9fc8ff, 9, 10, 2);
  helmLight.position.set(-72, Y + 3.2, 37);
  group.add(helmLight);
  const helmGlow = glowSprite(5, 0x6fa8ff, 0.28);
  helmGlow.position.set(-72, Y + 2.1, 37);
  group.add(helmGlow);

  // lamps
  const lampLights: THREE.PointLight[] = [];
  for (const [lx, ly, lz] of [[-60, L2 + 2.6, 34], [-84, L2 + 2.6, 48], [-98, L3 + 2.2, 16]] as const) {
    const light = new THREE.PointLight(0x86b8ff, 10, 16, 2);
    light.position.set(lx, ly, lz);
    group.add(light);
    lampLights.push(light);
    const spr = glowSprite(3.2, 0x7fb4ff, 0.3);
    spr.position.set(lx, ly, lz);
    group.add(spr);
  }

  const motes = dataMotes(Math.round(260 * ctx.detail), new THREE.Vector3(56, 22, 52), 0x9cc8ff, 31);
  motes.position.set(-72, Y, 36);
  group.add(motes);

  /* --------------------------------------------------------- interactables */
  const interactables: Interactable[] = [];
  const terminal = buildBrokenTerminal(ctx, L2, -46, L2, 24);
  terminal.group.rotation.y = -1.9;
  group.add(terminal.group);
  interactables.push({ ...terminal.interactable, id: 'terminal-atrium' });

  // museum plaque for the helmet — lore, no answer
  const plaqueTex = ctx.mats.textTexture('atrium-plaque', (c, s) => {
    c.fillStyle = '#07101d';
    c.fillRect(0, 0, s, s);
    c.strokeStyle = 'rgba(160,205,255,0.55)';
    c.strokeRect(12, 12, s - 24, s - 24);
    c.fillStyle = '#d8e9ff';
    c.textAlign = 'center';
    c.font = `600 ${s * 0.05}px "Courier New", monospace`;
    ['EXHIBIT 00', '', 'a pilot who never', 'came back.', '', 'we kept the helmet.', '', 'it still hears', 'the engine.'].forEach((l, i) => {
      c.fillText(l, s / 2, s * 0.14 + i * s * 0.09);
    });
  }, 512);
  const plaque = new THREE.Mesh(
    new THREE.BoxGeometry(1.8, 1.1, 0.08),
    new THREE.MeshStandardMaterial({ map: plaqueTex, roughness: 0.5, emissive: 0x1b3355, emissiveIntensity: 0.5 }),
  );
  plaque.position.set(-72, Y + 0.85, 39.2);
  plaque.rotation.y = Math.PI;
  group.add(plaque);
  interactables.push({
    id: 'atrium-plaque',
    position: new THREE.Vector3(-72, Y + 1.2, 38.8),
    radius: 2.4,
    prompt: '展示物を調べる',
    enabled: true,
    message: 'EXHIBIT 00 — 帰らなかったパイロットのヘルメット。まだエンジンの音が聞こえる、と書かれている。',
  });

  // L3 look-out text
  const lookText = textPlane(['i can see', 'the bottom of it'], 8, { color: '#bcd8ff', additive: true, opacity: 0.65 });
  lookText.position.set(-98, L3 + 2.2, 25.4);
  lookText.rotation.y = 0;
  group.add(lookText);

  const railPoints = [
    new THREE.Vector3(-88, Y, 54), new THREE.Vector3(-56, Y, 54),
  ];
  void railPoints;
  setShadow(group, true, true);

  return {
    name: 'atrium',
    group,
    bounds: { min: new THREE.Vector3(A.min.x, Y, A.min.z), max: new THREE.Vector3(A.max.x, Y + H, A.max.z) },
    lights: [skylight, helmLight, ...lampLights],
    interactables,
    emitters: [
      { kind: 'terminal', position: new THREE.Vector3(-46, L2 + 1, 24) },
      { kind: 'monolith', position: new THREE.Vector3(-72, Y + 8, 37) },
    ],
    update(dt, time) {
      (motes.material as THREE.ShaderMaterial).uniforms.uTime.value = time;
      skylight.intensity = 2.4 + Math.sin(time * 0.7) * 0.25;
      helmGlow.material.opacity = 0.22 + Math.sin(time * 1.3) * 0.07;
      (helmet.rotation as THREE.Euler).y = 0.6 + Math.sin(time * 0.2) * 0.15;
      void dt;
    },
  };
}
