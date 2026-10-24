import * as THREE from 'three';
import type { Area, AreaContext, Interactable } from '../types';
import { LAYOUT } from '../types';
import { errorWall, glowSprite, textPlane, uiPanel } from '../worldkit';
import { buildBrokenTerminal } from './Arrival';
import { cable } from '../Geo';
import { Rng } from '../../core/math';

/**
 * THE DEEP LAYER — under the street, a service level where the simulation keeps its own guts:
 * exposed cabling, server racks, block noise and a single warm lamp somebody left on.
 * This is where the flashlight (F) matters.
 */
export async function buildDeep(ctx: AreaContext): Promise<Area> {
  const group = new THREE.Group();
  group.name = 'area-deep';
  const Y = ctx.baseY - 6;
  const rng = new Rng(9100);
  const D = LAYOUT.deep;
  const wallMat = ctx.mats.get('concreteDark', 0.3);
  const floorMat = ctx.mats.get('tile', 0.6, { color: 0x6f8298 });

  const x0 = D.min.x, x1 = D.max.x, z0 = D.min.z, z1 = D.max.z;
  const ceilY = Y + 4;

  /* ---------------------------------------------------------------- floor */
  const floor = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 1.4, z1 - z0), floorMat);
  floor.position.set((x0 + x1) / 2, Y - 0.7, (z0 + z1) / 2);
  floor.receiveShadow = true;
  group.add(floor);
  ctx.collision.add({ min: [x0, Y - 1.4, z0], max: [x1, Y, z1], tag: 'deep-floor' });

  /* ---------------------------------------------------------------- walls */
  const wall = (x: number, z: number, w: number, d: number, h = 4) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
    m.position.set(x, Y + h / 2, z);
    m.receiveShadow = true;
    group.add(m);
    ctx.collision.add({ min: [x - w / 2, Y, z - d / 2], max: [x + w / 2, Y + h, z + d / 2], tag: 'deep-wall' });
  };
  wall((x0 + x1) / 2, z0 - 0.4, x1 - x0 + 1.6, 0.8);
  wall((x0 + x1) / 2, z1 + 0.4, x1 - x0 + 1.6, 0.8);
  wall(x0 - 0.4, (z0 + z1) / 2, 0.8, z1 - z0 + 1.6);
  wall(x1 + 0.4, (z0 + z1) / 2, 0.8, z1 - z0 + 1.6);

  /* --------------------------------------------------------------- ceiling
     Two shafts are cut out of the slab: one under the plaza stairs (x 12.5..22.5, z 27.6..31.6)
     and one under the street stairs (x 52..62, z 30..38 — outside this chamber, see below). */
  // Ceiling panels arranged around the two stair shafts.
  const ceilPanels: [number, number, number, number][] = [
    [x0, x1, z0, 27.6],
    [x0, 12.5, 27.6, 30],
    [22.5, x1, 27.6, 30],
    [x0, 12.5, 30, 31.6],
    [22.5, 52, 30, 31.6],
    [62, x1, 30, 31.6],
    [x0, 52, 31.6, 38],
    [62, x1, 31.6, 38],
    [x0, x1, 38, z1],
  ];
  for (const [a, b, c, d] of ceilPanels) {
    if (b - a < 0.05 || d - c < 0.05) continue;
    const m = new THREE.Mesh(new THREE.BoxGeometry(b - a, 0.6, d - c), wallMat);
    m.position.set((a + b) / 2, ceilY + 0.3, (c + d) / 2);
    m.receiveShadow = true;
    group.add(m);
    ctx.collision.add({ min: [a, ceilY, c], max: [b, ceilY + 0.6, d], tag: 'deep-ceiling' });
  }


  /* --------------------------------------------------- stairwell linings
     Both stair shafts (plaza 12.5..22.5 × 27.6..31.6 and street 52..62 × 30..38) drop into
     this chamber. Their side walls live in Plaza.ts / Street.ts; here we only frame the ceiling
     holes so the openings read as built, not as missing geometry. */
  for (const [sx, sz, w, d] of [
    [12.3, 29.6, 0.4, 4.6], [22.7, 29.6, 0.4, 4.6],
    [51.7, 34, 0.4, 8.4], [62.3, 34, 0.4, 8.4],
  ] as const) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.5, d), wallMat);
    m.position.set(sx, ceilY + 0.25, sz);
    group.add(m);
  }

  /* -------------------------------------------------------------- cabling */
  const cableMat = ctx.mats.solid({ color: 0x0a0d12, roughness: 0.85 });
  for (let i = 0; i < 16; i++) {
    const zz = z0 + 3 + i * ((z1 - z0 - 6) / 15);
    group.add(cable([
      new THREE.Vector3(x0 + 0.2, Y + 3.2, zz),
      new THREE.Vector3(x0 + 0.5, Y + 2.4, zz + rng.float(-0.6, 0.6)),
      new THREE.Vector3(x0 + 0.9, Y + 1.2, zz + rng.float(-1, 1)),
      new THREE.Vector3(x0 + 2.2, Y + 0.4, zz + rng.float(-1.5, 1.5)),
    ], rng.float(0.02, 0.05), cableMat, 28));
  }
  for (let i = 0; i < 10; i++) {
    const xx = x0 + 4 + i * ((x1 - x0 - 8) / 9);
    group.add(cable([
      new THREE.Vector3(xx, ceilY - 0.1, z1 - 0.4),
      new THREE.Vector3(xx + rng.float(-1, 1), Y + 2.6, z1 - 1.4),
      new THREE.Vector3(xx + rng.float(-2, 2), Y + rng.float(1.2, 2.2), z1 - 2.4),
    ], 0.03, cableMat, 22));
  }
  // bundles along the ceiling
  for (let i = 0; i < 6; i++) {
    const zz = z0 + 4 + i * 5;
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, x1 - x0 - 4, 8), ctx.mats.get('metalRust', 1.2));
    pipe.rotation.z = Math.PI / 2;
    pipe.position.set((x0 + x1) / 2, ceilY - 0.3 - i * 0.02, zz);
    group.add(pipe);
  }

  /* ------------------------------------------------------------ server racks */
  const rackMat = ctx.mats.get('metalBrushed', 1.1, { color: 0x40536b });
  const ledMats = [0x4d8dff, 0x9fd0ff, 0x2f6fd0].map((c) => new THREE.MeshBasicMaterial({ color: c, toneMapped: false }));
  for (let i = 0; i < 7; i++) {
    const rack = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.3, 0.8), rackMat);
    body.position.y = 1.15;
    rack.add(body);
    for (let row = 0; row < 14; row++) {
      for (let k = 0; k < 4; k++) {
        if (rng.bool(0.45)) continue;
        const led = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.02), ledMats[k % 3]);
        led.position.set(-0.36 + k * 0.22, 0.35 + row * 0.14, 0.405);
        rack.add(led);
      }
    }
    const gl = glowSprite(2.4, 0x4d8dff, 0.22);
    gl.position.set(0, 1.2, 0.55);
    rack.add(gl);
    rack.position.set(x0 + 3 + (i % 4) * 8, Y, z1 - 3.2 - Math.floor(i / 4) * 4);
    rack.rotation.y = Math.PI;
    group.add(rack);
    ctx.collision.add({ min: [rack.position.x - 0.6, Y, rack.position.z - 0.5], max: [rack.position.x + 0.6, Y + 2.4, rack.position.z + 0.5], tag: 'deep-rack' });
  }

  /* --------------------------------------------------------------- panels */
  for (let i = 0; i < 4; i++) {
    const ew = errorWall(rng.float(6, 12), rng.float(2.4, 4), 300 + i, 3, 8);
    ew.position.set(rng.float(x0 + 8, x1 - 8), Y + rng.float(2.4, 3.6), i < 2 ? z0 + 0.1 : z1 - 0.1);
    ew.rotation.y = i < 2 ? 0 : Math.PI;
    group.add(ew);
  }
  const bigUi = uiPanel(6, 3.4, 77, 'wake.exe');
  bigUi.position.set((x0 + x1) / 2, Y + 3.0, z0 + 0.2);
  group.add(bigUi);

  /* ---------------------------------------------------------------- lamps */
  const lamps: THREE.PointLight[] = [];
  for (const [lx, lz] of [[x0 + 8, z0 + 6], [x0 + 26, z0 + 6], [x0 + 44, z0 + 6]] as const) {
    const cage = new THREE.Mesh(
      new THREE.CylinderGeometry(0.24, 0.24, 0.4, 8, 1, true),
      ctx.mats.solid({ color: 0x3b4a5c, metalness: 0.8, roughness: 0.4, transparent: true, opacity: 0.7 }),
    );
    cage.position.set(lx, ceilY - 0.7, lz);
    group.add(cage);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshBasicMaterial({ color: 0xcfe6ff, toneMapped: false }));
    bulb.position.set(lx, ceilY - 0.7, lz);
    group.add(bulb);
    const light = new THREE.PointLight(0x86b8ff, 8, 14, 2);
    light.position.set(lx, ceilY - 0.8, lz);
    group.add(light);
    lamps.push(light);
    const spr = glowSprite(2.6, 0x7fb4ff, 0.35);
    spr.position.copy(light.position);
    group.add(spr);
  }

  /* -------------------------------------------------------------- hideout */
  // a warm lamp somebody left burning, and a wall of handwriting
  const hideX = x0 + 6, hideZ = z1 - 5;
  const deskMat = ctx.mats.get('woodDark', 1.4);
  const desk = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.08, 0.9), deskMat);
  desk.position.set(hideX, Y + 0.76, hideZ);
  desk.castShadow = true;
  desk.receiveShadow = true;
  group.add(desk);
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.76, 0.8), deskMat);
    leg.position.set(hideX + s * 1.1, Y + 0.38, hideZ);
    group.add(leg);
  }
  ctx.collision.add({ min: [hideX - 1.2, Y, hideZ - 0.45], max: [hideX + 1.2, Y + 0.8, hideZ + 0.45], tag: 'deep-desk' });
  const chair = await ctx.store.instantiate('sheenChair', {
    position: new THREE.Vector3(hideX, Y, hideZ - 1.2), rotationY: Math.PI, tint: 'world-dark',
  });
  group.add(chair);
  const warmLamp = new THREE.PointLight(0xffb066, 4.5, 9, 2);
  warmLamp.position.set(hideX + 0.6, Y + 1.15, hideZ + 0.2);
  group.add(warmLamp);
  const lampBulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.08, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xffc98a, toneMapped: false }),
  );
  lampBulb.position.copy(warmLamp.position);
  group.add(lampBulb);
  const mug = await ctx.store.instantiate('teacup', {
    position: new THREE.Vector3(hideX - 0.4, Y + 0.8, hideZ + 0.1), rotationY: 1.2, tint: 'world',
  });
  group.add(mug);

  const wallText = ctx.mats.textTexture('deep-wall', (c, s) => {
    c.fillStyle = '#0a0f17';
    c.fillRect(0, 0, s, s);
    c.fillStyle = 'rgba(220,235,255,0.85)';
    c.font = `italic ${s * 0.045}px "Courier New", monospace`;
    const lines = [
      'i woke up 14 times.',
      'the room was the same.',
      'the clock was the same.',
      '',
      'the only thing that changes',
      'is the window.',
      '',
      'i think i am the thing',
      'on the other side of it.',
      '',
      '— K.',
    ];
    lines.forEach((l, i) => c.fillText(l, s * 0.1, s * 0.16 + i * s * 0.07));
    c.fillStyle = 'rgba(255,180,100,0.16)';
    c.fillRect(0, 0, s, s);
  }, 512);
  const wallPanel = new THREE.Mesh(
    new THREE.PlaneGeometry(3.2, 3.2),
    new THREE.MeshStandardMaterial({ map: wallText, roughness: 0.9, emissive: 0x241a10, emissiveIntensity: 0.6 }),
  );
  wallPanel.position.set(hideX + 3.4, Y + 2.0, z1 - 0.15);
  wallPanel.rotation.y = Math.PI;
  group.add(wallPanel);

  /* -------------------------------------------------------- interactables */
  const interactables: Interactable[] = [];
  const terminal = buildBrokenTerminal(ctx, Y, hideX - 2.6, Y, hideZ + 0.4);
  terminal.group.rotation.y = 1.1;
  group.add(terminal.group);
  interactables.push({ ...terminal.interactable, id: 'terminal-deep' });
  interactables.push({
    id: 'deep-desk',
    position: new THREE.Vector3(hideX, Y + 1, hideZ + 0.2),
    radius: 2.0,
    prompt: '机の上のノートを読む',
    enabled: true,
    message: '「WAKE」という単語だけが、何度も何度も繰り返し書かれている。ページの端に小さく「_を忘れるな」とある。',
  });
  interactables.push({
    id: 'deep-wall',
    position: new THREE.Vector3(hideX + 3.4, Y + 1.6, z1 - 0.4),
    radius: 2.4,
    prompt: '壁の落書きを読む',
    enabled: true,
    message: '「目が覚めたのは14回。部屋は同じ。変わるのは窓だけ。」— K.',
  });

  return {
    name: 'deep',
    group,
    bounds: { min: new THREE.Vector3(x0, Y, z0), max: new THREE.Vector3(x1, Y + 4, z1) },
    lights: [...lamps, warmLamp],
    interactables,
    emitters: [
      { kind: 'terminal', position: new THREE.Vector3(hideX - 2.6, Y + 1, hideZ + 0.4) },
      { kind: 'lamp', position: new THREE.Vector3(hideX, Y + 1.2, hideZ) },
    ],
    update(dt, time) {
      // one failing fluorescent tube
      const flick = Math.sin(time * 23.0) > 0.86 ? 0.25 : 1;
      if (lamps[1]) lamps[1].intensity = 8 * flick;
      warmLamp.intensity = 4.2 + Math.sin(time * 2.4) * 0.35;
      void dt;
    },
  };
}
