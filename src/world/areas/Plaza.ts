import * as THREE from 'three';
import type { Area, AreaContext, Interactable } from '../types';
import { LAYOUT } from '../types';
import { closePerimeter, dataMotes, glowSprite, lightShaft, textPlane, uiPanel } from '../worldkit';
import { buildBrokenTerminal } from './Arrival';
import { Rng } from '../../core/math';

/**
 * THE PLAZA — the hub. Four ways out: back to the arrival wastes, the collapsed atrium (west),
 * the corrupted street (east) and the long bridge to the Core (south). In the middle: a heap of
 * dead monitors still showing the same blue screen.
 */
export async function buildPlaza(ctx: AreaContext): Promise<Area> {
  const group = new THREE.Group();
  group.name = 'area-plaza';
  const Y = ctx.baseY;
  const rng = new Rng(3100);
  const P = LAYOUT.plaza;
  const concrete = ctx.mats.get('concrete', 0.28);
  const dark = ctx.mats.get('concreteDark', 0.4);

  // Stairwell down to the deep layer. A proper staircase (not a pit) so nobody falls by accident.
  const hole = { x0: 12.5, x1: 22.5, z0: 27.6, z1: 31.6, floorY: Y - 6 };

  /* -------------------------------------------------------- floor w/ stairwell */
  const panels: [number, number, number, number][] = [
    [P.min.x, P.max.x, P.min.z, hole.z0],
    [P.min.x, P.max.x, hole.z1, P.max.z],
    [P.min.x, hole.x0, hole.z0, hole.z1],
    [hole.x1, P.max.x, hole.z0, hole.z1],
  ];
  for (const [x0, x1, z0, z1] of panels) {
    if (x1 - x0 < 0.01 || z1 - z0 < 0.01) continue;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 2.2, z1 - z0), concrete);
    mesh.position.set((x0 + x1) / 2, Y - 1.1, (z0 + z1) / 2);
    mesh.receiveShadow = true;
    group.add(mesh);
    ctx.collision.add({ min: [x0, Y - 2.2, z0], max: [x1, Y, z1], tag: 'plaza-floor' });
  }
  // stairwell walls + steps
  const stepMat = ctx.mats.get('concreteDark', 0.6);
  const stairSteps = 12;
  const stairRun = (hole.x1 - hole.x0) / stairSteps;
  for (let i = 0; i < stairSteps; i++) {
    const h = 6 * ((i + 1) / stairSteps);
    const step = new THREE.Mesh(new THREE.BoxGeometry(stairRun + 0.02, h, hole.z1 - hole.z0), stepMat);
    step.position.set(hole.x1 - stairRun * (i + 0.5), hole.floorY + h / 2, (hole.z0 + hole.z1) / 2);
    step.receiveShadow = true;
    group.add(step);
  }
  ctx.collision.add({
    min: [hole.x0, hole.floorY, hole.z0], max: [hole.x1, Y, hole.z1],
    ramp: { axis: 0, yLow: hole.floorY, yHigh: Y, walkable: true }, tag: 'plaza-stairs',
  });
  for (const z of [hole.z0, hole.z1]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(hole.x1 - hole.x0, 7, 0.3), concrete);
    wall.position.set((hole.x0 + hole.x1) / 2, hole.floorY + 3.2, z);
    group.add(wall);
    ctx.collision.add({ min: [hole.x0, hole.floorY, z - 0.15], max: [hole.x1, Y + 1, z + 0.15], tag: 'plaza-stairwall' });
  }
  const stairLight = new THREE.PointLight(0x2f6fd0, 10, 13, 2);
  stairLight.position.set((hole.x0 + hole.x1) / 2, hole.floorY + 1.8, (hole.z0 + hole.z1) / 2);
  group.add(stairLight);
  const stairSign = textPlane(['SUBLEVEL  0', 'DO NOT FALL'], 3.2, { color: '#cfe4ff', additive: true });
  stairSign.position.set(hole.x1 + 1.2, Y + 1.9, (hole.z0 + hole.z1) / 2);
  stairSign.rotation.y = -0.35;
  group.add(stairSign);

  /* ------------------------------------------------------------- kerbs */
  for (const [x, z, w, d] of [
    [0, P.min.z + 0.4, 52, 0.8],
    [-24, 36, 1.2, 40],
    [24, 36, 1.2, 40],
  ] as const) {
    const kerb = new THREE.Mesh(new THREE.BoxGeometry(w, 0.24, d), dark);
    kerb.position.set(x, Y + 0.12, z);
    kerb.receiveShadow = true;
    group.add(kerb);
  }
  // inlaid glowing seams in the pavement
  for (let i = 0; i < 7; i++) {
    const seamMesh = new THREE.Mesh(
      new THREE.BoxGeometry(48, 0.02, 0.06),
      new THREE.MeshBasicMaterial({ color: 0x2c6fd8, toneMapped: false, transparent: true, opacity: 0.8 }),
    );
    seamMesh.position.set(0, Y + 0.02, 20 + i * 5);
    group.add(seamMesh);
  }

  /* -------------------------------------------------------- monitor heap */
  const heap = new THREE.Group();
  const crtMat = ctx.mats.solid({ color: 0x11151c, roughness: 0.7, metalness: 0.15 });
  const screenMat = new THREE.MeshBasicMaterial({ color: 0x1a5fd0, toneMapped: false });
  const screenMat2 = new THREE.MeshBasicMaterial({ color: 0x0a4ea2, toneMapped: false });
  const heapSpots = [
    [0, 0, 0, 0.4], [1.3, 0, 0.6, -0.7], [-1.2, 0, 0.7, 1.2], [0.3, 1.05, 0.2, 2.1],
    [-0.4, 1.05, -0.9, -1.4], [1.1, 2.0, -0.1, 0.2],
  ] as const;
  heapSpots.forEach(([hx, hy, hz, ry], i) => {
    const caseMesh = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.95, 1.0), crtMat);
    caseMesh.position.set(hx, hy + 0.48, hz);
    caseMesh.rotation.y = ry;
    caseMesh.castShadow = true;
    heap.add(caseMesh);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.92, 0.66), i % 2 ? screenMat : screenMat2);
    face.position.set(hx, hy + 0.5, hz);
    face.rotation.y = ry;
    face.translateZ(0.51);
    heap.add(face);
    const spr = glowSprite(2.6, 0x3f7fe0, 0.35);
    spr.position.set(hx, hy + 0.5, hz + 0.4);
    heap.add(spr);
  });
  heap.position.set(-3, Y, 34);
  group.add(heap);
  ctx.collision.add({ min: [-5.6, Y, 32.6], max: [-0.2, Y + 3.0, 35.8], tag: 'plaza-heap' });
  const heapLight = new THREE.PointLight(0x3f7fe0, 22, 22, 2);
  heapLight.position.set(-3, Y + 2.2, 34);
  group.add(heapLight);

  /* --------------------------------------------------------- broken columns */
  const columnMat = ctx.mats.get('concrete', 0.35);
  for (let i = 0; i < 8; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const h = rng.float(3.5, 11);
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.72, h, 10, 1, true), columnMat);
    col.position.set(side * rng.float(16, 23), Y + h / 2, rng.float(20, 52));
    col.rotation.z = rng.float(-0.05, 0.05);
    col.castShadow = true;
    col.receiveShadow = true;
    group.add(col);
    ctx.collision.add({
      min: [col.position.x - 0.72, Y, col.position.z - 0.72],
      max: [col.position.x + 0.72, Y + h, col.position.z + 0.72],
      tag: 'plaza-column',
    });
  }

  /* ------------------------------------------------------------- floating UI */
  for (let i = 0; i < 7; i++) {
    const panel = uiPanel(rng.float(5, 12), rng.float(3, 6), 40 + i, ['kernel', 'memory', 'wake.exe', 'watchdog'][i % 4]);
    panel.position.set(rng.float(-18, 18), Y + rng.float(7, 22), rng.float(20, 50));
    panel.rotation.y = rng.float(-0.8, 0.8);
    group.add(panel);
  }

  /* ---------------------------------------------------------------- lamps */
  const lamps: THREE.PointLight[] = [];
  for (const [lx, lz] of [[-14, 24], [14, 24], [-14, 48], [14, 48]] as const) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.11, 5.6, 8), ctx.mats.get('metalRust', 1.4));
    pole.position.set(lx, Y + 2.8, lz);
    pole.castShadow = true;
    group.add(pole);
    const head = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.22, 0.5),
      new THREE.MeshBasicMaterial({ color: 0xa8d2ff, toneMapped: false }),
    );
    head.position.set(lx, Y + 5.6, lz);
    group.add(head);
    const light = new THREE.PointLight(0x9cc4ff, 16, 22, 2);
    light.position.set(lx, Y + 5.4, lz);
    group.add(light);
    lamps.push(light);
    const spr = glowSprite(4.5, 0x7fb4ff, 0.35);
    spr.position.copy(light.position);
    group.add(spr);
    ctx.collision.add({ min: [lx - 0.12, Y, lz - 0.12], max: [lx + 0.12, Y + 5.6, lz + 0.12], tag: 'plaza-lamp' });
  }

  /* ---------------------------------------------------------------- shafts */
  for (const [sx, sz] of [[-8, 42], [10, 44]] as const) {
    const shaft = lightShaft(6, 34, 0x5f9fff, 0.09);
    shaft.position.set(sx, Y + 17, sz);
    group.add(shaft);
  }

  const motes = dataMotes(Math.round(200 * ctx.detail), new THREE.Vector3(52, 26, 40), 0x8fc4ff, 21);
  motes.position.set(0, Y, 36);
  group.add(motes);

  /* ---------------------------------------------------------- interactables */
  const interactables: Interactable[] = [];
  const terminal = buildBrokenTerminal(ctx, Y, -19.5, Y, 45);
  terminal.group.rotation.y = -0.9;
  group.add(terminal.group);
  ctx.collision.add({ min: [-20.9, Y, 44.2], max: [-18.1, Y + 1.3, 45.8], tag: 'terminal' });
  interactables.push({ ...terminal.interactable, id: 'terminal-plaza' });

  const plaque = new THREE.Mesh(
    new THREE.BoxGeometry(2.6, 1.4, 0.12),
    new THREE.MeshStandardMaterial({
      map: ctx.mats.textTexture('plaza-plaque', (c, s) => {
        c.fillStyle = '#0a1220';
        c.fillRect(0, 0, s, s);
        c.strokeStyle = 'rgba(150,200,255,0.7)';
        c.lineWidth = 3;
        c.strokeRect(10, 10, s - 20, s - 20);
        c.fillStyle = '#cfe4ff';
        c.font = `600 ${s * 0.055}px "Courier New", monospace`;
        c.textAlign = 'center';
        ['SECTOR 0 — RECLAIMED', '', 'ALL EXITS ARE REAL', 'EXCEPT ONE', '', 'process: 47%'].forEach((l, i) => {
          c.fillText(l, s / 2, s * 0.24 + i * s * 0.11);
        });
      }, 512),
      roughness: 0.6,
      emissive: 0x1a3b6a,
      emissiveIntensity: 0.6,
    }),
  );
  plaque.position.set(4.5, Y + 1.6, 51.5);
  plaque.rotation.y = -0.2;
  group.add(plaque);
  const plaqueStand = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.6, 0.2), ctx.mats.get('metalRust', 1.5));
  plaqueStand.position.set(4.5, Y + 0.8, 51.6);
  group.add(plaqueStand);

  /* ------------------------------------------------------------- boundary */
  closePerimeter(ctx, group, {
    minX: P.min.x, maxX: P.max.x, minZ: P.min.z, maxZ: P.max.z, y: Y, height: 1.25,
    material: ctx.mats.get('concreteDark', 0.5, { color: 0x27333f }),
    gaps: [
      { edge: 'n', from: -7, to: 7 },     // bridge to the core
      { edge: 's', from: -7, to: 7 },     // path to arrival
      { edge: 'w', from: 30, to: 42 },    // bridge to the atrium
      { edge: 'e', from: 30, to: 42 },    // bridge to the street
    ],
    visual: true, seed: 31, tag: 'plaza-edge',
  });

  return {
    name: 'plaza',
    group,
    bounds: {
      min: new THREE.Vector3(P.min.x, Y - 8, P.min.z),
      max: new THREE.Vector3(P.max.x, Y + 30, P.max.z),
    },
    lights: [heapLight, stairLight, ...lamps],
    interactables,
    emitters: [{ kind: 'terminal', position: new THREE.Vector3(-19.5, Y + 1, 45) }],
    update(dt, time) {
      (motes.material as THREE.ShaderMaterial).uniforms.uTime.value = time;
      heap.children.forEach((c) => {
        if ((c as THREE.Sprite).isSprite) {
          const m = (c as THREE.Sprite).material as THREE.SpriteMaterial;
          m.opacity = 0.25 + Math.sin(time * 3 + c.position.x) * 0.08;
        }
      });
      void dt;
    },
  };
}
