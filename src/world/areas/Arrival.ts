import * as THREE from 'three';
import type { Area, AreaContext, Interactable } from '../types';
import { LAYOUT } from '../types';
import {
  closePerimeter, dataMotes, errorWall, glowSprite, lightShaft, setShadow, textPlane, uiPanel, wireCube,
} from '../worldkit';
import { debrisField } from '../Geo';
import { Rng } from '../../core/math';

/**
 * ARRIVAL — a fractured plateau of dead concrete and crystallised memory. The player is spat out
 * here after being eaten. The only landmark is the Core, visible dead ahead through the fog.
 */
export async function buildArrival(ctx: AreaContext): Promise<Area> {
  const group = new THREE.Group();
  group.name = 'area-arrival';
  const Y = ctx.baseY;
  const rng = new Rng(2001);
  const concrete = ctx.mats.get('concreteDark', 0.32);
  const ice = ctx.mats.get('ice', 1.1, { color: 0x9fbfe0, roughness: 0.55, metalness: 0.05 });

  const A = LAYOUT.arrival;
  const x0 = A.center.x - A.half.x, x1 = A.center.x + A.half.x;
  const z0 = A.center.z - A.half.z, z1 = A.center.z + A.half.z;

  /* ------------------------------------------------------------- ground */
  const ground = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 2.4, z1 - z0), concrete);
  ground.position.set((x0 + x1) / 2, Y - 1.2, (z0 + z1) / 2);
  ground.receiveShadow = true;
  group.add(ground);
  ctx.collision.add({ min: [x0, Y - 2.4, z0], max: [x1, Y, z1], tag: 'arrival-floor' });

  // crystal patches growing out of the concrete
  for (let i = 0; i < 26; i++) {
    const patch = new THREE.Mesh(new THREE.CircleGeometry(rng.float(1.2, 4.2), 6), ice);
    patch.rotation.x = -Math.PI / 2;
    patch.rotation.z = rng.float(0, Math.PI);
    patch.position.set(rng.float(x0 + 3, x1 - 3), Y + 0.02, rng.float(z0 + 3, z1 - 3));
    patch.receiveShadow = true;
    group.add(patch);
  }

  /* --------------------------------------------------- landing crater */
  const craterRing = new THREE.Mesh(
    new THREE.RingGeometry(2.2, 3.4, 32),
    new THREE.MeshBasicMaterial({ color: 0x3f79d8, transparent: true, opacity: 0.45, side: THREE.DoubleSide, toneMapped: false }),
  );
  craterRing.rotation.x = -Math.PI / 2;
  craterRing.position.set(0, Y + 0.04, LAYOUT.start.z);
  group.add(craterRing);
  const craterGlow = glowSprite(7, 0x4a86e8, 0.35);
  craterGlow.position.set(0, Y + 0.6, LAYOUT.start.z);
  group.add(craterGlow);

  /* ------------------------------------------------ perimeter fragments */
  const barrierMat = ctx.mats.get('concrete', 0.5);
  const barrierH = rng.float(1.4, 2.2);
  const addBarrierRun = (ax: number, az: number, bx: number, bz: number, segments: number) => {
    for (let i = 0; i < segments; i++) {
      const t = (i + 0.5) / segments;
      const x = ax + (bx - ax) * t;
      const z = az + (bz - az) * t;
      const w = Math.abs(bx - ax) / segments * 0.96;
      const d = Math.abs(bz - az) / segments * 0.96;
      const h = barrierH * rng.float(0.5, 1.2);
      const block = new THREE.Mesh(
        new THREE.BoxGeometry(Math.max(0.8, w), h, Math.max(0.8, d)),
        barrierMat,
      );
      block.position.set(x + rng.float(-0.2, 0.2), Y + h / 2, z + rng.float(-0.2, 0.2));
      block.rotation.y = rng.float(-0.08, 0.08);
      block.castShadow = true;
      block.receiveShadow = true;
      group.add(block);
      ctx.collision.add({
        min: [block.position.x - Math.max(0.5, w / 2), Y, block.position.z - Math.max(0.5, d / 2)],
        max: [block.position.x + Math.max(0.5, w / 2), Y + h, block.position.z + Math.max(0.5, d / 2)],
        tag: 'arrival-barrier',
      });
    }
  };
  // north edge split around the exit path, south edge, east & west edges
  addBarrierRun(x0, z0, -LAYOUT.path.halfWidth, z0, 6);
  addBarrierRun(LAYOUT.path.halfWidth, z0, x1, z0, 6);
  addBarrierRun(x0, z1, x1, z1, 8);
  addBarrierRun(x0, z0, x0, z1, 6);
  addBarrierRun(x1, z0, x1, z1, 6);

  // continuous collision on the boundary (the rubble above is decorative; this guarantees
  // that no amount of dashing can leave the plateau)
  closePerimeter(ctx, group, {
    minX: x0, maxX: x1, minZ: z0, maxZ: z1, y: Y, height: 1.5,
    gaps: [{ edge: 'n', from: -LAYOUT.path.halfWidth, to: LAYOUT.path.halfWidth }],
    visual: false, tag: 'arrival-edge', seed: 7,
  });

  /* ------------------------------------------------------------ shards */
  const shardMat = new THREE.MeshStandardMaterial({
    color: 0x0b1830, roughness: 0.35, metalness: 0.4,
    emissive: 0x0a1e3c, emissiveIntensity: 0.8,
  });
  const floating: THREE.Mesh[] = [];
  for (let i = 0; i < 34; i++) {
    const s = rng.float(0.4, 3.6);
    const shard = new THREE.Mesh(new THREE.BoxGeometry(s, s * rng.float(0.08, 0.35), s * rng.float(0.3, 1.4)), shardMat);
    const angle = rng.float(0, Math.PI * 2);
    const radius = rng.float(8, 46);
    shard.position.set(
      Math.cos(angle) * radius,
      Y + rng.float(1.4, 22),
      A.center.z + Math.sin(angle) * radius * 0.8,
    );
    shard.rotation.set(rng.float(0, 3), rng.float(0, 3), rng.float(0, 3));
    shard.castShadow = false;
    group.add(shard);
    floating.push(shard);
  }
  // ground debris
  const debris = debrisField({
    count: Math.round(70 * ctx.detail), radius: 26, height: 0.4, material: shardMat, seed: 41,
    sizeRange: [0.14, 0.9],
  });
  debris.position.set(0, Y + 0.1, A.center.z);
  group.add(debris);

  /* ------------------------------------------------------------- the gate */
  // A broken arch marking where the player was "spat out", behind the landing point.
  const archMat = ctx.mats.get('concrete', 0.4);
  for (const s of [-1, 1]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(2.4, 11, 2.0), archMat);
    pillar.position.set(s * 5.2, Y + 5.5, LAYOUT.start.z + 12);
    pillar.rotation.z = s * 0.06;
    pillar.castShadow = true;
    pillar.receiveShadow = true;
    group.add(pillar);
    ctx.collision.add({ min: [s * 5.2 - 1.2, Y, LAYOUT.start.z + 11], max: [s * 5.2 + 1.2, Y + 11, LAYOUT.start.z + 13], tag: 'arrival-arch' });
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(13.4, 1.6, 2.2), archMat);
  lintel.position.set(0, Y + 11.2, LAYOUT.start.z + 12);
  lintel.rotation.z = 0.03;
  group.add(lintel);
  const gateGlow = new THREE.Mesh(
    new THREE.PlaneGeometry(8.4, 9.6),
    new THREE.MeshBasicMaterial({
      color: 0x3f86ff, transparent: true, opacity: 0.16, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    }),
  );
  gateGlow.position.set(0, Y + 5.6, LAYOUT.start.z + 11);
  group.add(gateGlow);
  const gateText = textPlane(['MEMORY RESTORE', 'FAILED', '0x000000EF'], 7.2, { color: '#cfe4ff', additive: true, opacity: 0.85 });
  gateText.position.set(0, Y + 12.6, LAYOUT.start.z + 11.9);
  group.add(gateText);
  const gateLight = new THREE.PointLight(0x3f86ff, 14, 26, 2);
  gateLight.position.set(0, Y + 6, LAYOUT.start.z + 10);
  group.add(gateLight);

  /* ----------------------------------------------------- floating UI panes */
  const panelSpots: [number, number, number, number][] = [
    [-14, 7, 102, -0.3], [16, 10, 96, 0.5], [-19, 15, 84, 0.15],
    [13, 17, 78, -0.6], [0, 24, 108, 0.1], [-9, 20, 112, 0.4],
  ];
  for (let i = 0; i < panelSpots.length; i++) {
    const [px, py, pz, ry] = panelSpots[i];
    const panel = uiPanel(rng.float(4, 9), rng.float(2.6, 5.4), 10 + i, ['memory.scan', 'SIGNAL_LOST.dll', 'room.sav', 'UNKNOWN'][i % 4]);
    panel.position.set(px, Y + py, pz);
    panel.rotation.y = ry;
    panel.rotation.x = rng.float(-0.06, 0.06);
    group.add(panel);
  }

  /* ------------------------------------------------------------ lighting */
  const ambientRim = new THREE.PointLight(0x2f5fa8, 40, 70, 2);
  ambientRim.position.set(0, Y + 18, A.center.z + 6);
  group.add(ambientRim);

  for (const [x, z] of [[-12, 74], [12, 74], [-10, 100], [14, 104]] as const) {
    const shaft = lightShaft(5.5, 30, 0x5f9fff, 0.1);
    shaft.position.set(x, Y + 15, z);
    group.add(shaft);
    const s = glowSprite(20, 0x2a5fae, 0.16);
    s.position.set(x, Y + 24, z);
    group.add(s);
  }

  // data motes + distance haze
  const motes = dataMotes(Math.round(320 * ctx.detail), new THREE.Vector3(60, 34, 54), 0x8fc4ff, 7);
  motes.position.set(0, Y, A.center.z);
  group.add(motes);

  /* --------------------------------------------------------- hint terminal */
  const interactables: Interactable[] = [];
  const terminal = buildBrokenTerminal(ctx, Y, -9, Y, 88);
  group.add(terminal.group);
  ctx.collision.add({ min: [-10.4, Y, 87.2], max: [-7.6, Y + 1.3, 88.8], tag: 'terminal' });
  interactables.push(terminal.interactable);

  const consoleHint = textPlane(['[ INPUT STREAM READY ]', 'press  C  to interface'], 6.4, {
    color: '#dff0ff', additive: true, opacity: 0.9,
  });
  consoleHint.position.set(-9, Y + 2.6, 87.6);
  group.add(consoleHint);

  /* ------------------------------------------------- exploration landmark */
  const beacon = new THREE.Group();
  const beaconPole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, 6.2, 8), ctx.mats.get('metalRust', 1.2));
  beaconPole.position.y = 3.1;
  beacon.add(beaconPole);
  const beaconCore = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.55, 1),
    new THREE.MeshBasicMaterial({ color: 0x9fd0ff, toneMapped: false }),
  );
  beaconCore.position.y = 6.6;
  beacon.add(beaconCore);
  beacon.add(glowSprite(6, 0x6fb0ff, 0.5));
  beacon.position.set(18, Y, 84);
  group.add(beacon);
  ctx.collision.add({ min: [17.7, Y, 83.7], max: [18.3, Y + 6.4, 84.3], tag: 'beacon' });
  const beaconLight = new THREE.PointLight(0x9fd0ff, 9, 18, 2);
  beaconLight.position.set(18, Y + 6.6, 84);
  group.add(beaconLight);

  /* ------------------------------------------------------------- animation */
  const baseShardPos = floating.map((s) => s.position.clone());
  const baseShardRot = floating.map((s) => s.rotation.clone());
  const halo = craterRing;

  return {
    name: 'arrival',
    group,
    bounds: {
      min: new THREE.Vector3(x0, Y - 3, z0),
      max: new THREE.Vector3(x1, Y + 40, z1),
    },
    lights: [gateLight, ambientRim, beaconLight],
    interactables,
    emitters: [
      { kind: 'terminal', position: new THREE.Vector3(-9, Y + 1, 88) },
      { kind: 'monolith', position: new THREE.Vector3(0, Y + 40, -100) },
    ],
    update(dt, time) {
      for (let i = 0; i < floating.length; i++) {
        const s = floating[i];
        const base = baseShardPos[i];
        s.position.y = base.y + Math.sin(time * 0.4 + i) * 0.5;
        s.rotation.x = baseShardRot[i].x + time * 0.02 * (i % 3 === 0 ? 1 : 0.3);
        s.rotation.y = baseShardRot[i].y + time * 0.015;
      }
      halo.scale.setScalar(1 + Math.sin(time * 0.6) * 0.03);
      (motes.material as THREE.ShaderMaterial).uniforms.uTime.value = time;
      gateGlow.material.opacity = 0.12 + Math.sin(time * 1.7) * 0.05;
      (beaconCore as THREE.Mesh).rotation.y = time * 0.6;
      (beaconCore as THREE.Mesh).rotation.x = time * 0.2;
      setShadow(beacon, false);
      void dt;
    },
  };
}

/** A dead public terminal: its UI is the in-world hint that the C console exists. */
export function buildBrokenTerminal(ctx: AreaContext, Y: number, x: number, _y: number, z: number): {
  group: THREE.Group;
  interactable: Interactable;
} {
  const group = new THREE.Group();
  const bodyMat = ctx.mats.get('metalBrushed', 1.2, { color: 0x5d6f86 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.15, 0.7), bodyMat);
  body.position.y = 0.575;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(0.92, 0.56),
    new THREE.MeshBasicMaterial({
      map: uiPanelTexture('> input stream open\n> awaiting operator\n\n[C] interface', 0),
      transparent: true, toneMapped: false,
    }),
  );
  screen.position.set(0, 1.02, 0.36);
  screen.rotation.x = -0.32;
  group.add(screen);
  const glow = glowSprite(2.2, 0x5b95e8, 0.4);
  glow.position.set(0, 1.0, 0.45);
  group.add(glow);
  const legL = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.5, 8), bodyMat);
  legL.position.set(-0.36, 0.25, 0);
  group.add(legL);
  const legR = legL.clone();
  legR.position.x = 0.36;
  group.add(legR);
  group.position.set(x, Y, z);
  group.rotation.y = 0.6;

  const interactable: Interactable = {
    id: `terminal-${x}-${z}`,
    position: new THREE.Vector3(x, Y + 1, z),
    radius: 2.2,
    prompt: '壊れた端末に触れる',
    enabled: true,
    message: 'INPUT STREAM … 端末はまだ生きている。C キーでコンソールを開けそうだ。',
    onInteract: undefined,
  };
  return { group, interactable };
}

let uiCache: Map<string, THREE.CanvasTexture> | null = null;
export function uiPanelTexture(text: string, seed: number): THREE.CanvasTexture {
  if (!uiCache) uiCache = new Map();
  const key = `${text}|${seed}`;
  const hit = uiCache.get(key);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 320;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'rgba(4,14,30,0.9)';
  ctx.fillRect(0, 0, 512, 320);
  ctx.strokeStyle = 'rgba(140,195,255,0.7)';
  ctx.strokeRect(3, 3, 506, 314);
  ctx.fillStyle = 'rgba(40,90,160,0.6)';
  ctx.fillRect(3, 3, 506, 26);
  ctx.fillStyle = '#cfe6ff';
  ctx.font = '16px "Courier New", monospace';
  ctx.fillText('client.exe', 14, 22);
  const rng = new Rng(seed + 7);
  ctx.font = '20px "Courier New", monospace';
  text.split('\n').forEach((line, i) => {
    ctx.fillStyle = `rgba(210,235,255,${0.55 + rng.float(0, 0.4)})`;
    ctx.fillText(line, 24, 74 + i * 28);
  });
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = 'rgba(120,180,255,0.18)';
    ctx.fillRect(rng.float(0, 460), rng.float(40, 300), rng.float(20, 120), rng.float(1, 5));
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  uiCache.set(key, tex);
  return tex;
}

/** Unused export kept for the atrium's damaged signage. */
export function errorPanel(width: number, height: number, seed: number): THREE.Group {
  return errorWall(width, height, seed, 4, 8);
}
