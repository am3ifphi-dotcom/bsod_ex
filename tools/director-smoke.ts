import './domstub';
import * as THREE from 'three';
import { World } from '../src/game/World';
import { Room } from '../src/game/Room';
import { Director } from '../src/game/Director';
import { Player } from '../src/game/Player';
import { Input } from '../src/core/Input';
import type { Assets } from '../src/core/assets';
import type { AudioEngine } from '../src/core/audio';
import { CollisionWorld } from '../src/core/collision';

/* 何にでもなれる Proxy (UI / post / audio のスタブ) */
function magic(): any {
  const fn = function () { return magic(); };
  return new Proxy(fn, {
    get(t, k) {
      if (k === 'then') return undefined;
      if (k === Symbol.toPrimitive) return () => 0;
      if (k === 'settings') return { quality: 'high', sensitivity: 1, master: 0.8, ambience: 0.9, sfx: 1, shake: 1, invertY: false, glitch: 1, dynamicRes: false };
      if (k === 'renderPass' || k === 'gtao' || k === 'uniforms') return t[k] ?? (t[k] = magic());
      if (k === 'phase') return t.phase ?? 'boot';
      return t[k] ?? (t[k] = magic());
    },
    set(t, k, v) { t[k] = v; return true; },
    apply() { return magic(); },
  });
}

const fakeAssets = {
  texSet: async () => ({ albedo: null, normal: null, orm: null }),
  instance: async () => new THREE.Group(),
  model: async () => new THREE.Group(),
  scaleFor: () => 1,
  makeEnvMap: () => new THREE.Texture(),
  manifest: { models: {}, textures: {}, audio: { footsteps: { files: [] } } },
} as unknown as Assets;

const problems: string[] = [];
const sceneRoom = new THREE.Scene();
const sceneWorld = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.04, 900);
const room = new Room(sceneRoom, fakeAssets, magic());
const world = new World(sceneWorld, fakeAssets, magic());
const player = new Player();
const input = new Input(document.createElement('canvas') as unknown as HTMLElement);
const ui = magic();
const post = magic();
const audio = magic();

(async () => {
  await room.build();
  sceneRoom.add(room.group);
  await world.build();
  sceneWorld.add(world.group);

  const director = new Director({
    renderer: magic(), sceneRoom, sceneWorld, camera, assets: fakeAssets, audio,
    ui, post, input, player, room, world,
  } as never);

  const step = (seconds: number, dt = 1 / 60) => {
    const n = Math.round(seconds / dt);
    for (let i = 0; i < n; i++) {
      try { director.update(dt); } catch (e) { problems.push(`update threw in phase ${director.phase}: ${(e as Error).message}\n${(e as Error).stack}`); throw e; }
    }
  };
  const phaseLog: string[] = [];
  const watch = (label: string) => phaseLog.push(`${label}: ${director.phase}`);

  await director.startRoom(true);
  watch('start');
  step(2);
  director.usePC();
  watch('usePC');
  step(3.2);
  watch('after leanin');
  if (director.phase !== 'screen') problems.push(`expected screen, got ${director.phase}`);

  for (let i = 0; i < 12; i++) (director as unknown as { advanceBSOD: () => void }).advanceBSOD();
  watch('after 12 clicks');
  step(0.2);
  watch('finale starts');
  step(9);
  watch('after drop');
  if (director.phase !== 'void') problems.push(`expected void after the portal, got ${director.phase}`);
  const playerY = player.pos.y;
  console.log('[director] landed at', player.pos.x.toFixed(1), player.pos.y.toFixed(2), player.pos.z.toFixed(1));
  if (Math.abs(playerY) > 6) problems.push(`landed far off the ground (y=${playerY.toFixed(1)})`);
  if (Math.hypot(player.pos.x, player.pos.z - 104) > 20) problems.push(`landed far from arrival (${player.pos.x.toFixed(0)}, ${player.pos.z.toFixed(0)})`);

  step(2);
  director.startCollapse();
  watch('collapse');
  step(14);
  watch('after collapse');
  if (director.phase !== 'room') problems.push(`expected room after landing, got ${director.phase}`);
  if (!(room as unknown as { anomaly: boolean }).anomaly) problems.push('upstairs room is not in the anomalous state');
  step(2);

  // リプレイ
  director.restart();
  watch('restart');
  step(1);
  if (director.phase !== 'room') problems.push(`expected room after restart, got ${director.phase}`);
  if ((room as unknown as { anomaly: boolean }).anomaly) problems.push('room anomaly not reset');
  if ((world as unknown as { revealed: boolean }).revealed) problems.push('world secret not reset');
  if (player.pos.z < 0) problems.push('player not back at the room start position');

  // デバッグジャンプ
  for (const j of ['screen', 'void', 'monolith', 'collapse', 'return', 'room'] as const) {
    try {
      director.jump(j);
      step(1.5);
      console.log(`[director] jump ${j} → ${director.phase}`);
    } catch (e) { problems.push(`jump ${j} threw: ${(e as Error).message}`); }
  }

  console.log('[director] phases:', phaseLog.join(' | '));
  if (problems.length) {
    console.error('\nDIRECTOR FAIL\n' + problems.map((p) => ' - ' + p).join('\n'));
    process.exit(1);
  }
  console.log('\nDIRECTOR OK');
})();
