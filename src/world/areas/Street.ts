import * as THREE from 'three';
import type { Area, AreaContext, Interactable } from '../types';
import { LAYOUT } from '../types';
import { closePerimeter, dataRain, errorWall, glowSprite, lightShaft, textPlane, uiPanel } from '../worldkit';
import { setShadow } from '../worldkit';
import { Rng } from '../../core/math';

/**
 * THE CORRUPTED STREET — a city block eaten and rebuilt out of interface. Shop fronts are
 * refrigerators, the residents left their sofas behind, and every wall leaks error text.
 * A stairwell at the east end drops into the Deep Layer.
 */
export async function buildStreet(ctx: AreaContext): Promise<Area> {
  const group = new THREE.Group();
  group.name = 'area-street';
  const Y = ctx.baseY;
  const rng = new Rng(7300);
  const S = LAYOUT.street;
  const asphalt = ctx.mats.get('asphalt', 0.22);
  const kerbMat = ctx.mats.get('concrete', 0.7);
  const concrete = ctx.mats.get('concreteDark', 0.35);

  const roadZ0 = 26, roadZ1 = 46;
  const hole = { x0: 52, x1: 62, z0: 30, z1: 38, floorY: Y - 6 };

  /* ---------------------------------------------------------------- road */
  const roadPanels: [number, number, number, number][] = [
    [S.min.x, hole.x0, roadZ0, roadZ1],
    [hole.x1, S.max.x, roadZ0, roadZ1],
    [hole.x0, hole.x1, roadZ0, hole.z0],
    [hole.x0, hole.x1, hole.z1, roadZ1],
  ];
  for (const [x0, x1, z0, z1] of roadPanels) {
    if (x1 - x0 < 0.01 || z1 - z0 < 0.01) continue;
    const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 2, z1 - z0), asphalt);
    m.position.set((x0 + x1) / 2, Y - 1, (z0 + z1) / 2);
    m.receiveShadow = true;
    group.add(m);
    ctx.collision.add({ min: [x0, Y - 2, z0], max: [x1, Y, z1], tag: 'street-road' });
  }
  // sidewalks
  for (const [z0, z1] of [[S.min.z, roadZ0], [roadZ1, S.max.z]] as const) {
    const walk = new THREE.Mesh(new THREE.BoxGeometry(S.max.x - S.min.x, 2.3, z1 - z0), kerbMat);
    walk.position.set((S.min.x + S.max.x) / 2, Y - 1.0, (z0 + z1) / 2);
    walk.receiveShadow = true;
    group.add(walk);
    ctx.collision.add({ min: [S.min.x, Y - 2, z0], max: [S.max.x, Y + 0.15, z1], tag: 'street-sidewalk' });
  }
  // road markings
  for (let x = S.min.x + 2; x < S.max.x; x += 8) {
    const dash = new THREE.Mesh(
      new THREE.PlaneGeometry(4, 0.16),
      new THREE.MeshBasicMaterial({ color: 0x9fb8d8, transparent: true, opacity: 0.35, toneMapped: false }),
    );
    dash.rotation.x = -Math.PI / 2;
    dash.position.set(x, Y + 0.012, 36);
    group.add(dash);
  }
  // stairwell down to the deep layer
  const stairSteps = 12;
  const stairRun = (hole.x1 - hole.x0) / stairSteps;
  const stairMat = ctx.mats.get('concreteDark', 0.55);
  for (let i = 0; i < stairSteps; i++) {
    const h = 6 * ((i + 1) / stairSteps);
    const step = new THREE.Mesh(new THREE.BoxGeometry(stairRun + 0.02, h, hole.z1 - hole.z0), stairMat);
    step.position.set(hole.x0 + stairRun * (i + 0.5), hole.floorY + h / 2, (hole.z0 + hole.z1) / 2);
    step.receiveShadow = true;
    group.add(step);
  }
  ctx.collision.add({
    min: [hole.x0, hole.floorY, hole.z0], max: [hole.x1, Y, hole.z1],
    ramp: { axis: 0, yLow: hole.floorY, yHigh: Y, walkable: true }, tag: 'street-stairs',
  });
  // The stair shaft is lined to just below the road, then railed at road level, so it reads as
  // a service stair instead of a hole punched through the street.
  for (const z of [hole.z0, hole.z1]) {
    const wallMesh = new THREE.Mesh(new THREE.BoxGeometry(hole.x1 - hole.x0, 6, 0.3), concrete);
    wallMesh.position.set((hole.x0 + hole.x1) / 2, hole.floorY + 3.0, z);
    group.add(wallMesh);
    ctx.collision.add({ min: [hole.x0, hole.floorY, z - 0.15], max: [hole.x1, Y, z + 0.15], tag: 'street-stairwall' });
    const rail = new THREE.Mesh(new THREE.BoxGeometry(hole.x1 - hole.x0 + 0.6, 0.12, 0.14), ctx.mats.get('metalRust', 1.4));
    rail.position.set((hole.x0 + hole.x1) / 2, Y + 1.05, z);
    group.add(rail);
    ctx.collision.add({ min: [hole.x0 - 0.3, Y, z - 0.12], max: [hole.x1 + 0.3, Y + 1.1, z + 0.12], tag: 'street-stairrail' });
    for (const px of [hole.x0, (hole.x0 + hole.x1) / 2, hole.x1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.05, 0.09), ctx.mats.get('metalRust', 1.4));
      post.position.set(px, Y + 0.52, z);
      group.add(post);
    }
  }
  // the road edge at the bottom of the stairs stays open: that is the way into the sublevel
  closePerimeter(ctx, group, {
    minX: S.min.x, maxX: S.max.x, minZ: S.min.z, maxZ: S.max.z, y: Y, height: 1.3,
    material: ctx.mats.get('concrete', 0.6, { color: 0x2b3541 }),
    gaps: [{ edge: 'w', from: 30, to: 42 }],
    visual: true, seed: 77, tag: 'street-edge',
  });
  // an end-of-street barricade so the avenue terminates instead of fading into the void
  const barricade = new THREE.Mesh(new THREE.BoxGeometry(1.2, 3.2, 20), concrete);
  barricade.position.set(S.max.x - 1.2, Y + 1.6, 36);
  barricade.castShadow = true;
  group.add(barricade);
  ctx.collision.add({ min: [S.max.x - 1.8, Y, 24], max: [S.max.x, Y + 3.2, 48], tag: 'street-end' });
  const stairGlow = new THREE.PointLight(0x2f6fd0, 8, 12, 2);
  stairGlow.position.set((hole.x0 + hole.x1) / 2, hole.floorY + 1.6, (hole.z0 + hole.z1) / 2);
  group.add(stairGlow);
  const downSign = textPlane(['↓ SUBLEVEL 0', 'DO NOT RETURN'], 3.6, { color: '#d6eaff', additive: true });
  downSign.position.set(hole.x1 + 1.0, Y + 2.0, (hole.z0 + hole.z1) / 2);
  downSign.rotation.y = -0.5;
  group.add(downSign);

  /* ------------------------------------------------------------- puddles */
  const puddleMat = new THREE.MeshStandardMaterial({
    color: 0x050d18, roughness: 0.06, metalness: 0.35,
    envMapIntensity: 2.2, transparent: true, opacity: 0.88,
  });
  for (let i = 0; i < 10; i++) {
    const p = new THREE.Mesh(new THREE.CircleGeometry(rng.float(1.2, 4.5), 12), puddleMat);
    p.rotation.x = -Math.PI / 2;
    p.position.set(rng.float(S.min.x + 4, S.max.x - 4), Y + 0.014, rng.float(roadZ0 + 2, roadZ1 - 2));
    p.scale.set(1, rng.float(0.4, 1), 1);
    group.add(p);
  }

  /* ------------------------------------------------------------ facades */
  const windowMats = [0, 1, 2].map((i) => new THREE.MeshStandardMaterial({
    color: 0x0a1524,
    roughness: 0.35,
    metalness: 0.4,
    emissive: 0x2a4f86,
    emissiveIntensity: 0.55,
    map: ctx.mats.textTexture(`windows-${i}`, (c, s) => {
      c.fillStyle = '#070d16';
      c.fillRect(0, 0, s, s);
      const r = new Rng(300 + i * 17);
      const cols = 12, rows = 18;
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const on = r.bool(0.16);
          c.fillStyle = on
            ? (r.bool(0.6) ? 'rgba(255,205,150,0.85)' : 'rgba(150,205,255,0.8)')
            : 'rgba(8,16,30,0.95)';
          const w = s / cols, h = s / rows;
          c.fillRect(x * w + w * 0.18, y * h + h * 0.2, w * 0.62, h * 0.5);
        }
      }
      // decay streaks
      for (let k = 0; k < 30; k++) {
        c.fillStyle = `rgba(90,130,190,${r.float(0.02, 0.09)})`;
        c.fillRect(r.float(0, s), 0, r.float(1, 6), s);
      }
    }, 512),
  }));

  const buildFacade = (x: number, zCenter: number, depth: number, height: number, facing: 1 | -1, seed: number) => {
    const w = rng.float(8, 13);
    const win = windowMats[seed % 3];
    const concreteSide = concrete;
    const mats: THREE.Material[] = [
      concreteSide, concreteSide, concreteSide, concreteSide,
      facing === 1 ? win : concreteSide,
      facing === 1 ? concreteSide : win,
    ];
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, height, depth), mats);
    body.position.set(x, Y + height / 2, zCenter);
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);
    ctx.collision.add({
      min: [x - w / 2, Y, zCenter - depth / 2],
      max: [x + w / 2, Y + height, zCenter + depth / 2],
      tag: 'street-building',
    });
    // roof clutter
    if (rng.bool(0.7)) {
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 2.2, 10), ctx.mats.get('metalRust', 0.9));
      tank.position.set(x + rng.float(-3, 3), Y + height + 1.1, zCenter + rng.float(-2, 2));
      tank.castShadow = true;
      group.add(tank);
    }
    const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, rng.float(3, 7), 6), ctx.mats.get('metalBrushed', 1.2));
    antenna.position.set(x + rng.float(-4, 4), Y + height + 2.5, zCenter);
    group.add(antenna);
    return body;
  };
  // north row (street-facing +z) and south row (street-facing -z)
  let seed = 1;
  for (let x = S.min.x + 6; x < S.max.x - 4; x += rng.float(11, 15)) {
    buildFacade(x, S.min.z + 8, 16, rng.float(14, 42), 1, seed++);
  }
  for (let x = S.min.x + 10; x < S.max.x - 4; x += rng.float(12, 16)) {
    buildFacade(x, S.max.z - 8, 16, rng.float(12, 34), -1, seed++);
  }

  /* ---------------------------------------------------------- shop fronts */
  const shopFridges = [] as THREE.Object3D[];
  for (const [fx, fz, ry] of [[58, 25.2, Math.PI], [88, 46.8, 0]] as const) {
    const fr = await ctx.store.instantiate('fridge', {
      position: new THREE.Vector3(fx, Y + 0.15, fz), rotationY: ry, tint: 'world',
    });
    group.add(fr);
    shopFridges.push(fr);
    ctx.collision.add({ min: [fx - 0.5, Y, fz - 0.5], max: [fx + 0.5, Y + 2.2, fz + 0.5], tag: 'street-fridge' });
    const glow = glowSprite(4.5, 0x5b95e8, 0.4);
    glow.position.set(fx, Y + 1.3, fz + (fz < 36 ? 0.8 : -0.8));
    group.add(glow);
  }
  const sofa = await ctx.store.instantiate('glamSofa', {
    position: new THREE.Vector3(70, Y + 0.15, 26.9), rotationY: 0.1, tint: 'world',
  });
  group.add(sofa);
  ctx.collision.add({ min: [68.8, Y, 26.1], max: [71.2, Y + 1.1, 27.7], tag: 'street-sofa' });
  const sofa2 = await ctx.store.instantiate('leatherSofa', {
    position: new THREE.Vector3(96, Y + 0.15, 46.9), rotationY: Math.PI - 0.2, tint: 'world-dark',
  });
  group.add(sofa2);
  const chair = await ctx.store.instantiate('sheenChair', {
    position: new THREE.Vector3(79, Y + 0.15, 45.2), rotationY: 3.6, tint: 'world',
  });
  group.add(chair);

  /* -------------------------------------------------------------- lanterns */
  const lamps: THREE.PointLight[] = [];
  for (const lx of [54, 72, 92, 112]) {
    const lan = await ctx.store.instantiate('streetLantern', {
      position: new THREE.Vector3(lx, Y + 0.15, 25.0), rotationY: 0.1, tint: 'world',
    });
    group.add(lan);
    ctx.collision.add({ min: [lx - 0.3, Y, 24.7], max: [lx + 0.3, Y + 3.2, 25.3], tag: 'street-lantern' });
    const light = new THREE.PointLight(0x9fc8ff, 18, 22, 2);
    light.position.set(lx, Y + 3.0, 25.0);
    group.add(light);
    lamps.push(light);
    const spr = glowSprite(4, 0x8fc0ff, 0.4);
    spr.position.set(lx, Y + 3.0, 25.0);
    group.add(spr);
  }

  /* ----------------------------------------------------------------- cars */
  const carGroup = new THREE.Group();
  const carBodyMat = new THREE.MeshStandardMaterial({ color: 0x16202e, roughness: 0.32, metalness: 0.65, emissive: 0x081726, emissiveIntensity: 0.7 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x060c14, roughness: 0.1, metalness: 0.5 });
  const tyreMat = new THREE.MeshStandardMaterial({ color: 0x05070a, roughness: 0.9 });
  const buildCar = (x: number, z: number, ry: number, tilt = 0) => {
    const car = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.9, 1.8), carBodyMat);
    body.position.y = 0.62;
    car.add(body);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.75, 1.6), glassMat);
    cabin.position.set(-0.2, 1.3, 0);
    car.add(cabin);
    for (const wx of [-1.35, 1.35]) for (const wz of [-0.86, 0.86]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.24, 12), tyreMat);
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(wx, 0.36, wz);
      car.add(wheel);
    }
    const tail = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.16), new THREE.MeshBasicMaterial({ color: 0x8f2a2a, toneMapped: false }));
    tail.position.set(-2.11, 0.75, 0);
    tail.rotation.y = -Math.PI / 2;
    car.add(tail);
    car.position.set(x, Y + 0.02, z);
    car.rotation.y = ry;
    car.rotation.z = tilt;
    setShadow(car, true, true);
    carGroup.add(car);
    ctx.collision.add({ min: [x - 2.2, Y, z - 1.1], max: [x + 2.2, Y + 1.7, z + 1.1], tag: 'street-car' });
  };
  buildCar(66, 32.5, 0.12, 0.02);
  buildCar(84, 40.5, Math.PI - 0.06, -0.01);
  buildCar(105, 30.2, 0.4, 0.05);
  group.add(carGroup);

  /* -------------------------------------------------------------- billboard */
  const billboardTex = ctx.mats.textTexture('billboard', (c, s) => {
    c.fillStyle = '#04101f';
    c.fillRect(0, 0, s, s);
    c.fillStyle = '#dbeaff';
    c.font = `700 ${s * 0.11}px "Courier New", monospace`;
    c.textAlign = 'center';
    c.fillText('LOADING', s / 2, s * 0.34);
    c.font = `700 ${s * 0.2}px "Courier New", monospace`;
    c.fillStyle = '#7fc0ff';
    c.fillText('47%', s / 2, s * 0.58);
    c.strokeStyle = 'rgba(150,205,255,0.7)';
    c.lineWidth = s * 0.012;
    c.strokeRect(s * 0.16, s * 0.66, s * 0.68, s * 0.1);
    c.fillStyle = 'rgba(150,205,255,0.8)';
    c.fillRect(s * 0.16, s * 0.66, s * 0.68 * 0.47, s * 0.1);
    c.font = `400 ${s * 0.032}px "Courier New", monospace`;
    c.fillStyle = 'rgba(200,225,255,0.6)';
    c.fillText('PLEASE DO NOT CLOSE THIS WINDOW', s / 2, s * 0.86);
  }, 1024);
  const billboard = new THREE.Mesh(
    new THREE.PlaneGeometry(18, 10),
    new THREE.MeshBasicMaterial({ map: billboardTex, toneMapped: false, color: 0xbfe0ff }),
  );
  billboard.position.set(76, Y + 13, 47.7);
  billboard.rotation.y = Math.PI;
  group.add(billboard);
  const bbLight = new THREE.PointLight(0x5b9bf0, 70, 46, 2);
  bbLight.position.set(76, Y + 12, 44);
  group.add(bbLight);
  const bbGlow = glowSprite(30, 0x2f6fd0, 0.25);
  bbGlow.position.set(76, Y + 12, 46);
  group.add(bbGlow);

  /* ---------------------------------------------------------- error walls */
  for (let i = 0; i < 5; i++) {
    const ew = errorWall(rng.float(8, 16), rng.float(4, 8), 120 + i, 4, 8);
    ew.position.set(rng.float(S.min.x + 10, S.max.x - 10), Y + rng.float(3, 9), i < 3 ? 24.2 : 47.8);
    ew.rotation.y = i < 3 ? 0 : Math.PI;
    group.add(ew);
  }
  for (let i = 0; i < 4; i++) {
    const panel = uiPanel(rng.float(4, 8), rng.float(2.4, 4.4), 160 + i, ['driver.sys', 'please_wait', 'MEMORY.DMP'][i % 3]);
    panel.position.set(rng.float(S.min.x + 8, S.max.x - 8), Y + rng.float(4, 12), rng.float(28, 44));
    panel.rotation.y = rng.float(-0.6, 0.6);
    panel.rotation.z = rng.float(-0.06, 0.06);
    group.add(panel);
  }

  /* ------------------------------------------------------------- bus stop */
  const shelter = new THREE.Group();
  const shelterGlass = new THREE.MeshPhysicalMaterial({
    color: 0x7fa6d0, roughness: 0.12, metalness: 0, transparent: true, opacity: 0.22, transmission: 0.4,
  });
  const back = new THREE.Mesh(new THREE.BoxGeometry(5.4, 2.4, 0.08), shelterGlass);
  back.position.set(0, 1.2, -0.9);
  shelter.add(back);
  for (const s of [-1, 1]) {
    const side = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.4, 1.8), shelterGlass);
    side.position.set(s * 2.7, 1.2, 0);
    shelter.add(side);
  }
  const roof = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.1, 2.0), ctx.mats.get('metalBrushed', 1.4, { color: 0x6b7f96 }));
  roof.position.set(0, 2.45, 0);
  shelter.add(roof);
  const bench = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.1, 0.5), ctx.mats.get('woodDark', 1.4));
  bench.position.set(0, 0.5, -0.5);
  shelter.add(bench);
  const ad = new THREE.Mesh(
    new THREE.PlaneGeometry(1.5, 2.1),
    new THREE.MeshBasicMaterial({ map: ctx.mats.textTexture('busad', (c, s) => {
      c.fillStyle = '#0b1b2e';
      c.fillRect(0, 0, s, s);
      c.fillStyle = '#dbeaff';
      c.font = `700 ${s * 0.07}px "Courier New", monospace`;
      c.textAlign = 'center';
      ['YOU ARE', 'ALREADY', 'HOME', '', '(do not trust', ' the window)'].forEach((l, i) => {
        c.fillText(l, s / 2, s * 0.22 + i * s * 0.12);
      });
    }, 512), toneMapped: false }),
  );
  ad.position.set(2.2, 1.25, -0.86);
  shelter.add(ad);
  shelter.position.set(100, Y + 0.15, 25.4);
  shelter.rotation.y = Math.PI;
  group.add(shelter);
  ctx.collision.add({ min: [97.2, Y, 24.4], max: [102.8, Y + 2.6, 25.6], tag: 'street-shelter' });
  const shelterLight = new THREE.PointLight(0x86b8ff, 8, 10, 2);
  shelterLight.position.set(100, Y + 2.4, 25.0);
  group.add(shelterLight);

  // the shelter terminal is the console hint in this area
  const busConsole = textPlane(['[C] CONSOLE', 'STILL CONNECTED'], 2.6, { color: '#d6eaff', additive: true });
  busConsole.position.set(100, Y + 1.75, 24.9);
  group.add(busConsole);

  /* --------------------------------------------------------------- rain */
  const rain = dataRain(Math.round(900 * ctx.detail), new THREE.Vector3(80, 30, 26), 13);
  rain.position.set(82, Y, 36);
  group.add(rain);
  const motes = dataRain(Math.round(160 * ctx.detail), new THREE.Vector3(80, 16, 26), 29);
  motes.position.set(82, Y, 36);
  group.add(motes);

  for (const [sx, sz] of [[62, 34], [90, 38], [114, 30]] as const) {
    const shaft = lightShaft(5, 26, 0x6fa8ff, 0.1);
    shaft.position.set(sx, Y + 12, sz);
    group.add(shaft);
  }

  /* --------------------------------------------------------- interactables */
  const interactables: Interactable[] = [];
  interactables.push({
    id: 'street-sofa',
    position: new THREE.Vector3(70, Y + 0.6, 27.0),
    radius: 2.4,
    prompt: 'ソファを調べる',
    enabled: true,
    message: '柔らかい。まだ人の体温みたいな温かさが残っている。誰もいないのに。',
  });
  interactables.push({
    id: 'street-ad',
    position: new THREE.Vector3(100, Y + 1.4, 25.0),
    radius: 2.2,
    prompt: '広告を読む',
    enabled: true,
    message: '「あなたはもう家にいる」「窓を信じるな」— 文字がじわじわ滲んでいる。',
  });

  void shopFridges;

  return {
    name: 'street',
    group,
    bounds: { min: new THREE.Vector3(S.min.x, Y, S.min.z), max: new THREE.Vector3(S.max.x, Y + 44, S.max.z) },
    lights: [bbLight, shelterLight, stairGlow, ...lamps],
    interactables,
    emitters: [
      { kind: 'lamp', position: new THREE.Vector3(54, Y + 3, 26.8) },
      { kind: 'terminal', position: new THREE.Vector3(100, Y + 1.4, 25.0) },
    ],
    update(dt, time) {
      (rain.material as THREE.ShaderMaterial).uniforms.uTime.value = time;
      (motes.material as THREE.ShaderMaterial).uniforms.uTime.value = time * 0.4;
      bbLight.intensity = 60 + Math.sin(time * 1.4) * 8;
      bbGlow.material.opacity = 0.2 + Math.sin(time * 1.4) * 0.05;
      void dt;
    },
  };
}
