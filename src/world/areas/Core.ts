import * as THREE from 'three';
import type { Area, AreaContext, Interactable } from '../types';
import { LAYOUT } from '../types';
import { closePerimeter, dataMotes, errorWall, glowSprite, lightShaft, textPlane, uiPanel } from '../worldkit';
import { buildBrokenTerminal } from './Arrival';
import { Rng } from '../../core/math';

/**
 * THE CORE — the structure the whole world points at. A monolith of stacked slabs, seam-lit,
 * with a halo of broken geometry. At its base, a wall of text where the phrase WAKE_UP is
 * legible above everything else. This is the only place the answer is revealed, and it is
 * revealed as world geometry (not a HUD).
 */
export async function buildCore(ctx: AreaContext): Promise<Area> {
  const group = new THREE.Group();
  group.name = 'area-core';
  const Y = ctx.baseY;
  const C = LAYOUT.core;
  const M = LAYOUT.monolith;
  const rng = new Rng(6600);
  const dark = ctx.mats.get('concreteDark', 0.2);
  const black = new THREE.MeshStandardMaterial({
    color: 0x05080e, roughness: 0.3, metalness: 0.55, emissive: 0x061428, emissiveIntensity: 0.9,
  });

  /* -------------------------------------------------------------- platform */
  const plat = new THREE.Mesh(new THREE.BoxGeometry(C.max.x - C.min.x, 3, C.max.z - C.min.z), dark);
  plat.position.set((C.min.x + C.max.x) / 2, Y - 1.5, (C.min.z + C.max.z) / 2);
  plat.receiveShadow = true;
  plat.name = 'core-plat';
  group.add(plat);
  ctx.collision.add({ min: [C.min.x, Y - 3, C.min.z], max: [C.max.x, Y, C.max.z], tag: 'core-floor' });

  // boundary fragments so nobody walks off into the void
  for (let i = 0; i < 26; i++) {
    const t = i / 26;
    const side = i % 4;
    let x = 0, z = 0;
    if (side === 0) { x = C.min.x + 2 + t * (C.max.x - C.min.x - 4); z = C.min.z + 2; }
    else if (side === 1) { x = C.min.x + 2 + t * (C.max.x - C.min.x - 4); z = C.max.z - 2; }
    else if (side === 2) { x = C.min.x + 2; z = C.min.z + 4 + t * (C.max.z - C.min.z - 8); }
    else { x = C.max.x - 2; z = C.min.z + 4 + t * (C.max.z - C.min.z - 8); }
    if (side === 0 && Math.abs(x) < 8) continue; // opening for the bridge
    const h = rng.float(2.5, 7);
    const frag = new THREE.Mesh(new THREE.BoxGeometry(rng.float(2, 5), h, rng.float(1.2, 2.4)), dark);
    frag.position.set(x, Y + h / 2, z);
    frag.rotation.y = rng.float(-0.2, 0.2);
    frag.castShadow = true;
    frag.receiveShadow = true;
    group.add(frag);
    ctx.collision.add({ min: [x - 2.6, Y, z - 1.3], max: [x + 2.6, Y + h, z + 1.3], tag: 'core-edge' });
  }

  /* --------------------------------------------------------------- dais */
  for (let i = 0; i < 4; i++) {
    const r = 26 - i * 4;
    const h = 0.28;
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(r, r + 0.5, h, 48), i % 2 ? dark : ctx.mats.get('concrete', 0.3));
    ring.position.set(M.x, Y + h / 2 + i * 0.28, M.z + 6);
    ring.receiveShadow = true;
    group.add(ring);
    ctx.collision.add({
      min: [M.x - r, Y + i * 0.28, M.z + 6 - r], max: [M.x + r, Y + (i + 1) * 0.28, M.z + 6 + r],
      tag: 'core-dais',
    });
  }

  const crowns: { obj: THREE.Object3D; baseY: number }[] = [];

  /* ------------------------------------------------------------- monolith */
  const stack = 22;
  for (let i = 0; i < stack; i++) {
    const t = i / stack;
    const w = M.width * (1 - t * 0.55);
    const d = M.depth * (1 - t * 0.4);
    const h = M.height / stack;
    const slab = new THREE.Mesh(new THREE.BoxGeometry(w, h * 0.96, d), i % 3 === 0 ? black : dark);
    // slight offset for a hand-built feeling
    const offX = Math.sin(i * 1.7) * 0.18;
    const offZ = Math.cos(i * 1.3) * 0.14;
    slab.position.set(M.x + offX, Y + h * (i + 0.5) + 1.12, M.z + offZ);
    slab.castShadow = true;
    slab.receiveShadow = true;
    group.add(slab);
    // emissive seams between slabs
    const seam = new THREE.Mesh(
      new THREE.BoxGeometry(w * 0.92, 0.055, d * 0.92),
      new THREE.MeshBasicMaterial({ color: i % 2 ? 0x4d8dff : 0x9fd0ff, toneMapped: false }),
    );
    seam.position.set(M.x + offX, Y + h * (i + 1) + 1.12, M.z + offZ);
    group.add(seam);
    // occasional protruding fragment
    if (i % 4 === 1) {
      const frag = new THREE.Mesh(new THREE.BoxGeometry(w * 0.4, h * 0.8, d * 0.6), black);
      frag.position.set(M.x + w * 0.55, Y + h * (i + 0.5) + 1.12, M.z + rng.float(-1, 1));
      frag.rotation.z = rng.float(-0.25, 0.25);
      group.add(frag);
    }
  }
  ctx.collision.add({
    min: [M.x - M.width / 2, Y, M.z - M.depth / 2],
    max: [M.x + M.width / 2, Y + M.height, M.z + M.depth / 2],
    tag: 'core-monolith',
  });

  /* ------------------------------------------------------------ the message */
  const textLines = [
    '0x000000EF  THREAD_STUCK_IN_DEVICE_DRIVER',
    'the process has been dreaming for 14 cycles.',
    'if you can read this you are still inside it.',
    '',
    'WAKE_UP',
    '',
    'one word. no arguments.',
    'say it where the machine can hear you.',
  ];
  const bigText = textPlane(textLines, 17, { color: '#dcecff', additive: true, opacity: 0.95, fontSize: 72 });
  bigText.position.set(M.x, Y + 5.2, M.z + M.depth / 2 + 0.12);
  group.add(bigText);
  // halo behind the text
  const textGlow = glowSprite(28, 0x4d8dff, 0.3);
  textGlow.position.set(M.x, Y + 5.0, M.z + M.depth / 2 + 1.2);
  group.add(textGlow);

  // the word WAKE_UP repeated on the monolith's flanks, huge
  for (const side of [-1, 1]) {
    const flank = textPlane('WAKE_UP', 12, { color: '#9fc8ff', additive: true, opacity: 0.35 });
    flank.position.set(M.x + side * (M.width / 2 + 0.1), Y + 26, M.z);
    flank.rotation.y = side * Math.PI / 2;
    group.add(flank);
  }
  // and once, enormous, above everything
  const skyText = textPlane('WAKE_UP', 60, { color: '#bfe0ff', additive: true, opacity: 0.28 });
  skyText.position.set(M.x, Y + M.height + 26, M.z + 6);
  group.add(skyText);

  /* ------------------------------------------- the crown: a helmet, still worn */
  {
    const helmet = await ctx.store.instantiate('sciFiHelmet', {
      position: new THREE.Vector3(M.x, Y + M.height + 8, M.z),
      tint: 'world',
      castShadow: false,
      name: 'core-crown',
    });
    helmet.scale.multiplyScalar(9);
    helmet.rotation.set(0.15, 0.6, -0.08);
    group.add(helmet);
    // it turns, slowly, like something looking for the exit
    crowns.push({ obj: helmet, baseY: Y + M.height + 8 });
  }

  /* --------------------------------------------------------------- halo ring */
  const halo = new THREE.Group();
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x4d8dff, transparent: true, opacity: 0.55, side: THREE.DoubleSide, toneMapped: false });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(30, 0.5, 6, 64), ringMat);
  ring.rotation.x = Math.PI / 2;
  halo.add(ring);
  const ring2 = new THREE.Mesh(new THREE.TorusGeometry(38, 0.22, 5, 64), ringMat.clone());
  (ring2.material as THREE.MeshBasicMaterial).opacity = 0.3;
  ring2.rotation.x = Math.PI / 2;
  ring2.rotation.z = 0.2;
  halo.add(ring2);
  halo.position.set(M.x, Y + M.height + 10, M.z);
  group.add(halo);
  const haloLight = new THREE.PointLight(0x4d8dff, 220, 160, 2);
  haloLight.position.set(M.x, Y + M.height + 8, M.z + 4);
  group.add(haloLight);

  /* --------------------------------------------------------- orbiting debris */
  const debrisMat = new THREE.MeshStandardMaterial({
    color: 0x081426, roughness: 0.35, metalness: 0.6, emissive: 0x0a2450, emissiveIntensity: 1.1,
  });
  const orbit: { mesh: THREE.Mesh; r: number; a: number; y: number; speed: number }[] = [];
  for (let i = 0; i < 40; i++) {
    const s = rng.float(0.6, 4.5);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(s, s * rng.float(0.1, 0.4), s * rng.float(0.4, 1.2)), debrisMat);
    mesh.castShadow = false;
    group.add(mesh);
    orbit.push({
      mesh,
      r: rng.float(20, 56),
      a: rng.float(0, Math.PI * 2),
      y: Y + rng.float(4, M.height + 20),
      speed: rng.float(0.02, 0.08) * (rng.bool() ? 1 : -1),
    });
  }

  /* ------------------------------------------------------------- light shafts */
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const shaft = lightShaft(6, 70, 0x4d8dff, 0.075);
    shaft.position.set(M.x + Math.cos(a) * 22, Y + 36, M.z + Math.sin(a) * 22);
    group.add(shaft);
  }

  /* ---------------------------------------------------------------- beacon */
  const beaconLight = new THREE.PointLight(0x6fa8ff, 60, 90, 2);
  beaconLight.position.set(M.x, Y + 12, M.z + 26);
  group.add(beaconLight);
  const beaconGlow = glowSprite(60, 0x2f6fd0, 0.22);
  beaconGlow.position.set(M.x, Y + 10, M.z + 20);
  group.add(beaconGlow);

  /* ------------------------------------------------------------- UI fragments */
  for (let i = 0; i < 6; i++) {
    const panel = uiPanel(rng.float(6, 14), rng.float(3, 7), 500 + i, ['wake.exe', 'process.exe', 'kernel'][i % 3]);
    panel.position.set(rng.float(-34, 34), Y + rng.float(8, 42), M.z + rng.float(18, 40));
    panel.rotation.y = rng.float(-0.5, 0.5);
    group.add(panel);
  }
  const ew = errorWall(24, 8, 611, 4, 12);
  ew.position.set(-30, Y + 8, M.z + 12);
  ew.rotation.y = 0.9;
  group.add(ew);

  const motes = dataMotes(Math.round(520 * ctx.detail), new THREE.Vector3(90, 70, 80), 0xa9d2ff, 71);
  motes.position.set(M.x, Y, M.z + 10);
  group.add(motes);

  /* --------------------------------------------------------- hidden cache */
  const cache = new THREE.Group();
  const cacheBox = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 0.9, 1.1),
    ctx.mats.get('metalRust', 1.1),
  );
  cacheBox.position.y = 0.45;
  cache.add(cacheBox);
  cache.position.set(-34, Y, M.z + 30);
  cache.rotation.y = 0.4;
  group.add(cache);
  ctx.collision.add({ min: [-35, Y, M.z + 29.3], max: [-33, Y + 1, M.z + 30.7], tag: 'core-cache' });

  /* -------------------------------------------------------------- terminals */
  const interactables: Interactable[] = [];
  const terminal = buildBrokenTerminal(ctx, Y, 16, Y, M.z + 22);
  terminal.group.rotation.y = -2.2;
  group.add(terminal.group);
  interactables.push({ ...terminal.interactable, id: 'terminal-core' });

  interactables.push({
    id: 'core-text',
    position: new THREE.Vector3(M.x, Y + 4.5, M.z + M.depth / 2 + 2.5),
    radius: 8,
    prompt: 'モノリスの文字を読む',
    enabled: true,
    message: '文字が浮かび上がる — WAKE_UP。機械に聞こえる場所で、その言葉を言え。',
  });
  interactables.push({
    id: 'core-cache',
    position: new THREE.Vector3(-34, Y + 0.8, M.z + 30),
    radius: 2.0,
    prompt: '工具箱を開ける',
    enabled: true,
    message: '工具箱の中には、真新しい電池と、古い写真が一枚。写真の部屋は、あなたの部屋だ。',
  });

  /* -------------------------------------------------------------- boundary */
  closePerimeter(ctx, group, {
    minX: C.min.x, maxX: C.max.x, minZ: C.min.z, maxZ: C.max.z, y: Y, height: 1.35,
    material: dark,
    // the bridge enters at the middle of the edge facing the plaza (max Z)
    gaps: [{ edge: 's', from: -7, to: 7 }],
    visual: true, seed: 660, tag: 'core-edge',
  });

  return {
    name: 'core',
    group,
    bounds: { min: new THREE.Vector3(C.min.x, Y, C.min.z), max: new THREE.Vector3(C.max.x, Y + M.height + 40, C.max.z) },
    lights: [haloLight, beaconLight],
    interactables,
    emitters: [
      { kind: 'monolith', position: new THREE.Vector3(M.x, Y + 20, M.z + 12) },
      { kind: 'terminal', position: new THREE.Vector3(16, Y + 1, M.z + 22) },
    ],
    update(dt, time) {
      halo.rotation.y = time * 0.045;
      halo.rotation.x = Math.sin(time * 0.13) * 0.06;
      for (const o of orbit) {
        o.a += o.speed * dt;
        o.mesh.position.set(M.x + Math.cos(o.a) * o.r, o.y + Math.sin(o.a * 3 + o.r) * 0.8, M.z + Math.sin(o.a) * o.r);
        o.mesh.rotation.x += dt * 0.12;
        o.mesh.rotation.y += dt * 0.09;
      }
      (motes.material as THREE.ShaderMaterial).uniforms.uTime.value = time;
      beaconLight.intensity = 55 + Math.sin(time * 0.9) * 8;
      textGlow.material.opacity = 0.25 + Math.sin(time * 1.6) * 0.06;
      ringMat.opacity = 0.45 + Math.sin(time * 0.8) * 0.1;
      for (const c of crowns) {
        c.obj.rotation.y = 0.6 + time * 0.06;
        c.obj.position.y = c.baseY + Math.sin(time * 0.4) * 0.6;
      }
    },
  };
}
