import './domstub';
import * as THREE from 'three';
import { World, WORLD } from '../src/game/World';
import { Room, MON, ROOM } from '../src/game/Room';
import { Player } from '../src/game/Player';
import type { Assets } from '../src/core/assets';
import type { AudioEngine } from '../src/core/audio';
import type { Input } from '../src/core/Input';

const audio = new Proxy({}, { get: () => () => ({ stop() {}, set() {} }) }) as unknown as AudioEngine;

function fakeAssets(): Assets {
  return {
    // 実テクスチャを返す: makeMaterial の clone / repeat / normalScale 経路を必ず通す
    texSet: async () => ({ albedo: new THREE.Texture(), normal: new THREE.Texture(), orm: new THREE.Texture() }),
    instance: async () => {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), new THREE.MeshStandardMaterial()));
      return g;
    },
    model: async () => new THREE.Group(),
    scaleFor: () => 1,
    makeEnvMap: () => new THREE.Texture(),
    manifest: { models: {}, textures: {}, audio: { footsteps: { files: [] } } },
  } as unknown as Assets;
}

const problems: string[] = [];
const assert = (cond: boolean, msg: string) => { if (!cond) problems.push(msg); };

async function testRoom() {
  const scene = new THREE.Scene();
  const room = new Room(scene, fakeAssets(), audio);
  await room.build();
  scene.add(room.group);
  const cam = new THREE.PerspectiveCamera(62, 16 / 9, 0.04, 200);
  for (let i = 0; i < 120; i++) room.update(1 / 60, i / 60, cam, false);
  room.showBSOD(3, 40, 0.4, 1.4);
  room.setGlitch(0.7);
  room.setSuction(0.8);
  room.setAnomaly(true);
  for (let i = 0; i < 120; i++) room.update(1 / 60, 2 + i / 60, cam, false);
  room.setSuction(0);
  room.setAnomaly(false);
  room.reset();
  room.setFlashlight(true);
  room.update(1 / 60, 5, cam, true);

  const ids = room.interactables.map((i) => i.id);
  console.log('[room] interactables:', ids.join(','));
  for (const need of ['pc', 'note', 'window', 'door', 'lamp']) assert(ids.includes(need), `room: missing interactable ${need}`);
  assert(room.collision.groundAt(0, 0, 0.5) === 0, 'room: floor height');

  const p = new Player();
  p.setPosition(0.1, 0, 1.3);
  const input = {
    isDown: (c: string) => c === 'KeyW', wasPressed: () => false, wasReleased: () => false,
    consumeLook: () => ({ yaw: 0, pitch: 0 }), clicked: false, clickDown: false,
    gameplay: true, lookEnabled: true, sensitivity: 1, invertY: false,
  } as unknown as Input;
  let minY = 99, maxY = -99;
  for (let i = 0; i < 180; i++) {
    p.update(1 / 60, input, room.collision);
    minY = Math.min(minY, p.pos.y); maxY = Math.max(maxY, p.pos.y);
  }
  assert(p.pos.z > -2.0, `room: player entered the desk (z=${p.pos.z.toFixed(2)})`);
  assert(maxY < 0.35, `room: player climbed props (y=${maxY.toFixed(2)})`);
  console.log(`[room] walk test end z=${p.pos.z.toFixed(2)} y=${p.pos.y.toFixed(2)}`);

  // 全方向に歩いても部屋の外へ出ない
  for (const yaw of [0, 1, 2, 3, 4, 5]) {
    const q = new Player();
    q.setPosition(0.1, 0, 0.6);
    q.yaw = yaw;
    for (let i = 0; i < 240; i++) q.update(1 / 60, input, room.collision);
    const inside = q.pos.x > ROOM.x0 - 0.1 && q.pos.x < ROOM.x1 + 0.1 && q.pos.z > ROOM.z0 - 0.1 && q.pos.z < ROOM.z1 + 0.1;
    assert(inside, `room: escaped at yaw ${yaw} → (${q.pos.x.toFixed(2)}, ${q.pos.z.toFixed(2)})`);
  }
  console.log('[room] collision ok');
  auditScene('room', room.group, room.interactables);
}

async function testWorld() {
  const scene = new THREE.Scene();
  const world = new World(scene, fakeAssets(), audio);
  await world.build();
  await new Promise((r) => setTimeout(r, 30));
  scene.add(world.group);
  const cam = new THREE.PerspectiveCamera(62, 16 / 9, 0.05, 900);
  for (let i = 0; i < 60; i++) world.update(1 / 60, i / 60, cam);

  console.log('[world] interactables:', world.interactables.map((i) => i.id).join(','));
  const ids = world.interactables.map((i) => i.id);
  assert(ids.includes('wake_text'), 'world: missing WAKE_UP text interactable');
  assert(ids.includes('kiosk'), 'world: missing kiosk interactable');

  const c = world.collision;
  const p = new Player();
  const samples: string[] = [];
  const key: [string, number, number][] = [
    ['arrival', WORLD.arrival.x, WORLD.arrival.z],
    ['arch', WORLD.architecture.x + 7, WORLD.architecture.z + 4],
    ['west', WORLD.cityWest.x, WORLD.cityWest.z],
    ['east', WORLD.cityEast.x, WORLD.cityEast.z],
    ['deep', WORLD.deep.x, WORLD.deep.z],
    ['monolith', WORLD.monolith.x, WORLD.monolith.z + 8],
  ];
  for (const [name, x, z] of key) {
    const g = c.groundAt(x, z, 40, 99);
    samples.push(`${name}=${Number.isFinite(g) ? g.toFixed(2) : 'void'}`);
    assert(Number.isFinite(g), `world: no ground at ${name} (${x}, ${z})`);
  }
  console.log('[world] ground:', samples.join('  '));

  // 到着地点 → 建築物の外周 → 中心構造物 の誘導路を実際に歩く
  const walkTo = (waypoints: [number, number][], label: string, start?: [number, number, number]) => {
    let stuckAt = '';
    p.setPosition(start ? start[0] : waypoints[0][0], start ? start[1] : 0.3, start ? start[2] : waypoints[0][1]);
    for (let w = 1; w < waypoints.length; w++) {
      const target = waypoints[w];
      let last = 1e9; let stuck = 0;
      for (let i = 0; i < 60 * 60; i++) {
        const dx = target[0] - p.pos.x, dz = target[1] - p.pos.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 3.5) break;
        p.yaw = Math.atan2(-dx, -dz);
        p.update(1 / 30, {
          isDown: (kc: string) => kc === 'KeyW' || (dist > 30 && kc === 'ShiftLeft'),
          wasPressed: () => false, wasReleased: () => false,
          consumeLook: () => ({ yaw: 0, pitch: 0 }), clicked: false, clickDown: false,
          gameplay: true, lookEnabled: true, sensitivity: 1, invertY: false,
        } as unknown as Input, c);
        if (dist > last - 0.03) stuck++; else { stuck = 0; last = dist; }
        if (stuck > 120) { stuckAt = `stuck at (${p.pos.x.toFixed(1)}, ${p.pos.y.toFixed(1)}, ${p.pos.z.toFixed(1)}) → ${target}`; break; }
      }
      const rest = Math.hypot(target[0] - p.pos.x, target[1] - p.pos.z);
      if (rest > 4.5) { problems.push(`world: ${label} failed at waypoint ${w} (${target}) remaining ${rest.toFixed(1)}m ${stuckAt}`); break; }
    }
    console.log(`[world] walked ${label} → (${p.pos.x.toFixed(1)}, ${p.pos.y.toFixed(2)}, ${p.pos.z.toFixed(1)})`);
    return p.pos.clone();
  };

  const end = walkTo([
    [WORLD.arrival.x, WORLD.arrival.z],
    [0, 66],
    [0, 46],
    [7, 37],
    [7, 14],
    [7, 6],
    [1, 6],
    [0, -8],
    [0, -20],
    [0, -44],
    [0, -64],
    [0, -78],
    [WORLD.monolith.x, WORLD.monolith.z + 4],
    [WORLD.monolith.x, WORLD.monolith.z - 2],
  ], 'arrival→monolith');
  assert(Math.abs(end.y - 0.4) < 0.25, `world: chamber floor height (y=${end.y.toFixed(2)})`);
  assert(Math.hypot(end.x - WORLD.monolith.x, end.z - (WORLD.monolith.z - 2)) < 4, 'world: reached the chamber');

  // 2F バルコニー → 橋 → 都市東
  const cityEnd = walkTo([[14, 20], [36, 20]], 'bridge→city', [14, 4.25, 20]);
  assert(cityEnd.y > 3.9 && cityEnd.y < 4.6, `world: bridge height (y=${cityEnd.y.toFixed(2)})`);
  assert(cityEnd.x > 32, `world: crossed the bridge (x=${cityEnd.x.toFixed(1)})`);

  // 深層への二段階段 (実際に降りきれるか)
  p.setPosition(-0.3, 0.05, 28.6);
  const press = (yaw: number, frames: number) => {
    for (let i = 0; i < frames; i++) {
      p.yaw = yaw;
      p.update(1 / 30, {
        isDown: (kc: string) => kc === 'KeyW', wasPressed: () => false, wasReleased: () => false,
        consumeLook: () => ({ yaw: 0, pitch: 0 }), clicked: false, clickDown: false,
        gameplay: true, lookEnabled: true, sensitivity: 1, invertY: false,
      } as unknown as Input, c);
    }
    console.log(`[world] deep step y=${p.pos.y.toFixed(2)} z=${p.pos.z.toFixed(1)} x=${p.pos.x.toFixed(2)}`);
  };
  press(0, 260);                 // 北へ (1 段目)
  press(Math.PI / 2, 110);       // 西へ (踊り場)
  press(Math.PI, 300);           // 南へ (2 段目)
  assert(p.pos.y < -11.4, `world: reached the deep floor (y=${p.pos.y.toFixed(2)})`);

  // 階段: 1F から 2F バルコニーへ
  const stairSamples: string[] = [];
  for (let i = 0; i <= 20; i += 5) {
    const z = WORLD.architecture.z + 11 + i * 0.45;
    const g = c.groundAt(6.5, z, 0.3 + i * 0.21, 0.55);
    stairSamples.push(`${g.toFixed(2)}`);
  }
  console.log('[world] stair heights:', stairSamples.join(' → '));
  assert(parseFloat(stairSamples[stairSamples.length - 1]) > 3.5, 'world: stairs do not reach the 2F balcony');

  // 深層: 建築 1F の穴から降りられるか
  const deepG = c.groundAt(WORLD.deep.x, WORLD.deep.z, -11, 2.5);
  assert(Math.abs(deepG + 12) < 0.2, `world: deep floor (got ${deepG})`);

  // マップ外へ落ちないか: 端まで走る
  p.setPosition(0, 0.3, 104);
  let fell = false;
  let outOfBounds = false;
  for (let i = 0; i < 60 * 60; i++) {
    p.update(1 / 30, {
      isDown: (kc: string) => kc === 'KeyW' || kc === 'ShiftLeft',
      wasPressed: () => false, wasReleased: () => false,
      consumeLook: () => ({ yaw: 0, pitch: 0 }), clicked: false, clickDown: false,
      gameplay: true, lookEnabled: true, sensitivity: 1, invertY: false,
    } as unknown as Input, c);
    if (p.pos.y < -70) { fell = true; break; }
    if (Math.abs(p.pos.x) > 160 || Math.abs(p.pos.z) > 160) { outOfBounds = true; break; }
  }
  assert(!fell, `world: fell out of the map at (${p.pos.x.toFixed(1)}, ${p.pos.y.toFixed(1)}, ${p.pos.z.toFixed(1)})`);
  assert(!outOfBounds, `world: escaped the boundary at (${p.pos.x.toFixed(1)}, ${p.pos.z.toFixed(1)})`);
  console.log('[world] edge traversal ok');

  world.setGlitch(0.8);
  world.setSecretRevealed();
  world.reset();
  world.setSecretRevealed();
  for (let i = 0; i < 60; i++) world.update(1 / 60, 10 + i / 60, cam);
  console.log('[world] ok');
  auditScene('world', world.group, world.interactables);
}

/** シーングラフの健全性: NaN 変換・空ジオメトリ・ライト欠如・未接続インタラクトを検出 */
function auditScene(name: string, root: THREE.Object3D, interactables: readonly { id: string; label?: unknown; point: THREE.Vector3; radius: number; onUse?: () => void }[]) {
  let meshes = 0, lights = 0, instanced = 0, tris = 0;
  const bad: string[] = [];
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    const p = o.position, q = o.quaternion, sc = o.scale;
    if (![p.x, p.y, p.z, q.x, q.y, q.z, q.w, sc.x, sc.y, sc.z].every(Number.isFinite)) bad.push(`non-finite transform: ${o.name || o.type}`);
    if (o instanceof THREE.Light) {
      lights++;
      if (!Number.isFinite(o.intensity) || o.intensity < 0) bad.push(`bad light intensity: ${o.name || o.type}`);
    }
    if (o instanceof THREE.Mesh || o instanceof THREE.InstancedMesh) {
      meshes++;
      if (o instanceof THREE.InstancedMesh) instanced++;
      const geo = o.geometry;
      if (!geo) { bad.push(`mesh without geometry: ${o.name || o.type}`); return; }
      const pos = geo.getAttribute('position');
      if (!pos || pos.count === 0) bad.push(`empty geometry: ${o.name || o.type}`);
      if (pos) {
        const arr = pos.array as ArrayLike<number>;
        let nan = false;
        for (let i = 0; i < Math.min(arr.length, 600); i++) if (!Number.isFinite(arr[i])) { nan = true; break; }
        if (nan) bad.push(`NaN vertex: ${o.name || o.type}`);
        tris += (geo.index ? geo.index.count : pos.count) / 3;
      }
      if (!o.material) bad.push(`mesh without material: ${o.name || o.type}`);
      if (o instanceof THREE.InstancedMesh && o.count === 0) bad.push(`instanced mesh with 0 instances: ${o.name || o.type}`);
    }
  });
  for (const it of interactables) {
    if (!it.id) bad.push('interactable without id');
    if (!Number.isFinite(it.point.x) || !Number.isFinite(it.point.z)) bad.push(`interactable ${it.id}: non-finite point`);
    if (!(it.radius > 0)) bad.push(`interactable ${it.id}: radius ${it.radius}`);
    if (typeof it.label !== 'string' && typeof it.label !== 'function') bad.push(`interactable ${it.id}: no label`);
    if (typeof it.onUse !== 'function') bad.push(`interactable ${it.id}: no handler`);
  }
  console.log(`[${name}] audit: ${meshes} meshes (${instanced} instanced), ${lights} lights, ${(tris / 1000).toFixed(0)}k tris`);
  for (const b of bad.slice(0, 8)) problems.push(`${name}: ${b}`);
}

async function testMaterials() {
  const { makeMaterial, solid, emissive } = await import('../src/core/materials');
  const assets = fakeAssets();
  const m = await makeMaterial(assets, 'floor_wood', { repeat: [2, 3], glitch: 0.5, normalScale: 0.7, pole: 0.4 });
  assert(m.isMeshStandardMaterial, 'material: not a MeshStandardMaterial');
  assert(!!m.map && !!m.normalMap && !!m.aoMap, 'material: texture maps missing');
  assert(m.normalScale.x === 0.7 && m.normalScale.y === 0.7, `material: normalScale ${m.normalScale.x}`);
  assert(m.map!.repeat.x === 2 && m.map!.repeat.y === 3, 'material: repeat not applied');
  assert(!!m.onBeforeCompile, 'material: glitch patch missing');
  // パッチは実シェーダー文字列に対して行われるので、差し替え対象が存在するか確認
  const shader = {
    vertexShader: '#include <common>\nvoid main(){ #include <begin_vertex> }',
    fragmentShader: '#include <common>\nvoid main(){ #include <emissivemap_fragment> }',
    uniforms: {} as Record<string, { value: unknown }>,
  };
  m.onBeforeCompile!(shader as never, null as never);
  assert(shader.vertexShader.includes('vGlitchWPos'), 'material: vertex glitch not injected');
  assert(shader.fragmentShader.includes('uCorrupt'), 'material: fragment glitch not injected');
  assert(!!shader.uniforms.uGlitch, 'material: glitch uniforms missing');
  solid(0x335577);
  emissive(0x9fd0ff, 3);
  console.log('[materials] ok');
}

/**
 * カスタム GLSL の構文検査。ブラウザ (実 GPU) がない環境では唯一のシェーダー検証手段。
 * three の #include は展開できないので、注入チャンクは自前の最小コンテキストに差し込んで解析する。
 */
async function testShaders() {
  const { DofShader, FinalShader } = await import('../src/core/postfx');
  const { GLITCH_VERTEX, GLITCH_FRAGMENT } = await import('../src/core/materials');
  const { parse } = await import('@shaderfrog/glsl-parser');
  const strip = (src: string) => src.replace(/^\s*#include\s*<[^>]+>\s*$/gm, '');
  const check = (name: string, src: string) => {
    try { parse(strip(src)); } catch (e) {
      problems.push(`shader ${name}: ${String(e).split('\n')[0]}`);
    }
  };
  check('dof.vert', DofShader.vertexShader);
  check('dof.frag', DofShader.fragmentShader);
  check('final.vert', FinalShader.vertexShader);
  check('final.frag', FinalShader.fragmentShader);

  const vertCtx = `
    attribute vec3 position; attribute vec3 normal;
    uniform mat4 modelMatrix; uniform float uTime; uniform float uGlitch;
    uniform float uCorrupt; uniform vec3 uPlayer; varying vec3 vGlitchWPos;
    void main(){ vec3 transformed = vec3(position);
      ${strip(GLITCH_VERTEX)}
      gl_Position = vec4(transformed, 1.0); }`;
  const fragCtx = `
    precision highp float;
    uniform float uTime; uniform float uCorrupt; varying vec3 vGlitchWPos;
    void main(){ vec3 totalEmissiveRadiance = vec3(0.0);
      ${strip(GLITCH_FRAGMENT)}
      gl_FragColor = vec4(totalEmissiveRadiance, 1.0); }`;
  check('glitch.vert', vertCtx);
  check('glitch.frag', fragCtx);

  // 最終パスの uniform 名が GLSL 側と JS 側で一致しているか
  for (const [name, shader] of [['dof', DofShader], ['final', FinalShader]] as const) {
    const declared = new Set(Array.from(shader.fragmentShader.matchAll(/uniform\s+\w+\s+([\w,\s]+);/g))
      .flatMap((m) => m[1].split(',').map((v) => v.trim())).filter(Boolean));
    for (const u of declared) {
      if (u === 'sampler2D' || u === 'float' || u === 'vec2' || u === 'vec3') continue;
      if (!(u in (shader.uniforms as Record<string, unknown>))) problems.push(`shader ${name}: uniform ${u} missing in JS`);
    }
  }
  console.log('[shaders] glsl syntax ok');
}

(async () => {
  await testShaders();
  await testMaterials();
  await testRoom();
  await testWorld();
  if (problems.length) {
    console.error('\nSMOKE FAIL\n' + problems.map((p) => ' - ' + p).join('\n'));
    process.exit(1);
  }
  console.log('\nSMOKE OK');
})();
