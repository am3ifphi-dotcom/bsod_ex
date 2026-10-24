import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CollisionWorld } from '../src/core/collision';
import { CameraScript } from '../src/core/camera-script';
import { Player } from '../src/game/Player';
import { GameConsole } from '../src/game/Console';
import { clamp, ease, noise2, RNG } from '../src/core/util';
import type { Input } from '../src/core/Input';

/* ---------------- 入力スタブ ---------------- */
function fakeInput(keys: string[] = []): Input {
  const set = new Set(keys);
  return {
    isDown: (c: string) => set.has(c),
    wasPressed: () => false,
    wasReleased: () => false,
    consumeLook: () => ({ yaw: 0, pitch: 0 }),
    clicked: false, clickDown: false,
    gameplay: true, lookEnabled: true, sensitivity: 1, invertY: false,
  } as unknown as Input;
}

/* ---------------- コリジョン ---------------- */
test('collision: 床の高さと段差の自動ステップアップ', () => {
  const w = new CollisionWorld();
  w.addPlatform(-5, 5, -5, 5, 0);
  w.addPlatform(1, 3, -1, 1, 0.3);
  assert.equal(w.groundAt(0, 0, 0), 0);
  assert.equal(w.groundAt(2, 0, 0.1), 0.3, '0.3m の段差は登れる');
  assert.equal(w.groundAt(2, 0, -3), -Infinity, '足元より高い面は拾わない');
  assert.equal(w.groundAt(2, 0, 5), 0.3, '上空からは最も高い面を拾う (着地判定)');
});

test('collision: 壁からの押し出し', () => {
  const w = new CollisionWorld();
  w.addPlatform(-10, 10, -10, 10, 0);
  w.addBlocker(1, 2, -10, 10, 0, 3);
  const pos = new THREE.Vector3(1.1, 0, 0);
  w.resolve(pos, 0.3, 1.7);
  assert.ok(pos.x <= 1 - 0.3 + 1e-6, `押し出される (x=${pos.x})`);
});

test('collision: 内部に埋まった場合は最短の辺へ出る', () => {
  const w = new CollisionWorld();
  w.addBlocker(0, 2, 0, 2, 0, 3);
  const pos = new THREE.Vector3(0.1, 0, 1);
  w.resolve(pos, 0.3, 1.7);
  const outside = pos.x <= -0.3 + 1e-6 || pos.x >= 2.3 - 1e-6 || pos.z <= -0.3 + 1e-6 || pos.z >= 2.3 - 1e-6;
  assert.ok(outside, `外に出る (${pos.x}, ${pos.z})`);
});

/* ---------------- プレイヤー ---------------- */
test('player: 前進し、壁を突き抜けない', () => {
  const w = new CollisionWorld();
  w.addPlatform(-5, 5, -5, 5, 0);
  w.addBlocker(-5, 5, -6, -4, 0, 3); // 前方の壁
  const p = new Player();
  p.setPosition(0, 0, 0);
  p.yaw = 0; // -z が前方
  const input = fakeInput(['KeyW']);
  for (let i = 0; i < 240; i++) p.update(1 / 60, input, w);
  assert.ok(p.pos.z > -4.0 + 0.28, `壁の手前で止まる (z=${p.pos.z.toFixed(3)})`);
  assert.ok(p.pos.z < -1.0, `きちんと前進している (z=${p.pos.z.toFixed(3)})`);
});

test('player: 段差を登る', () => {
  const w = new CollisionWorld();
  w.addPlatform(-5, 5, -5, 5, 0);
  w.addPlatform(-5, 5, -3, 0, 0.25);
  const p = new Player();
  p.setPosition(0, 0, 1.2);
  const input = fakeInput(['KeyW']);
  for (let i = 0; i < 45; i++) p.update(1 / 60, input, w);
  assert.ok(p.pos.y >= 0.24, `段差の上に乗る (y=${p.pos.y.toFixed(3)})`);
});

test('player: 落下しても地面に着地し、マップ外では安全地点に戻る', () => {
  const w = new CollisionWorld();
  w.addPlatform(-2, 2, -2, 2, 0);
  const p = new Player();
  p.setPosition(0, 3, 0);
  for (let i = 0; i < 200; i++) p.update(1 / 60, fakeInput(), w);
  assert.ok(Math.abs(p.pos.y) < 0.02, `着地 (y=${p.pos.y.toFixed(3)})`);

  // 端から落ちる → 3m 以上でセーフスポットへ
  p.setPosition(0, 0, 0);
  p.update(1 / 60, fakeInput(), w);
  const safe = p.pos.clone();
  p.pos.set(20, 0, 20);
  for (let i = 0; i < 200; i++) p.update(1 / 60, fakeInput(), w);
  assert.ok(p.pos.distanceTo(safe) < 6, `安全地点へ戻る (${p.pos.x.toFixed(1)}, ${p.pos.y.toFixed(1)}, ${p.pos.z.toFixed(1)})`);
});

test('player: ダッシュでも壁を抜けない (サブステップ)', () => {
  const w = new CollisionWorld();
  w.addPlatform(-5, 5, -30, 5, 0);
  w.addBlocker(-5, 5, -12, -11.8, 0, 3);
  const p = new Player();
  p.setPosition(0, 0, 0);
  p.yaw = 0;
  const input = fakeInput(['KeyW', 'ShiftLeft']);
  for (let i = 0; i < 200; i++) p.update(1 / 30, input, w); // 30fps 相当の粗い dt
  assert.ok(p.pos.z > -11.8, `壁の手前 (z=${p.pos.z.toFixed(2)})`);
});

test('player: ヘッドボブ無効時は目の高さが揺れない', () => {
  const w = new CollisionWorld();
  w.addPlatform(-20, 20, -20, 20, 0);
  const p = new Player();
  p.settings.bobEnabled = false;
  p.setPosition(0, 0, 0);
  const input = fakeInput(['KeyW']);
  const ys: number[] = [];
  for (let i = 0; i < 120; i++) {
    p.update(1 / 60, input, w);
    ys.push(p.eyePosition().y);
  }
  const spread = Math.max(...ys) - Math.min(...ys);
  assert.ok(spread < 0.005, `揺れなし (${spread.toFixed(4)})`);
});

/* ---------------- カメラスクリプト ---------------- */
test('camera script: キーフレーム間を補間し、終端で停止する', () => {
  const s = new CameraScript([
    { at: 0, pos: [0, 1.6, 0], look: [0, 1.6, -5], fov: 60, focus: 4 },
    { at: 2, pos: [0, 1.6, -4], look: [0, 1, -6], fov: 40, focus: 1, ease: ease.linear },
  ]);
  const a = s.update(0);
  assert.equal(a.pos.z, 0);
  assert.equal(a.fov, 60);
  const b = s.update(1);
  assert.ok(Math.abs(b.pos.z - -2) < 1e-6, `中間 (${b.pos.z})`);
  assert.ok(Math.abs(b.focus - 2.5) < 1e-6);
  const c = s.update(3);
  assert.ok(Math.abs(c.pos.z - -4) < 1e-6, '終端でクランプ');
  assert.equal(c.finished, true);
});

/* ---------------- コンソール ---------------- */
function makeConsoleStub() {
  const lines: string[] = [];
  let wake = 0;
  let open = false;
  const ui = {
    consoleOpen: false,
    openConsole() { open = true; ui.consoleOpen = true; },
    closeConsole() { open = false; ui.consoleOpen = false; },
    printConsole(t: string) { lines.push(t); },
    clearConsole() {},
    setConsoleInputEnabled() {},
  };
  const audio = new Proxy({}, { get: () => () => {} });
  const c = new GameConsole(ui as never, audio as never, {
    inVoid: () => true,
    busy: () => false,
    onWakeUp: () => { wake++; },
  });
  return { c, lines, wakeCount: () => wake, isOpen: () => open, ui };
}

test('console: 空 Enter では崩壊しない', () => {
  const h = makeConsoleStub();
  h.c.open();
  h.c.submit('');
  h.c.submit('   ');
  assert.equal(h.wakeCount(), 0);
  assert.ok(h.lines.some((l) => l.includes('>')), '入力ログが出る');
});

test('console: 未知コマンドはエラーで応答し、崩壊しない', () => {
  const h = makeConsoleStub();
  h.c.open();
  for (const cmd of ['foo', 'shutdown', 'restore', 'sudo rm -rf /', 'WAKE', 'wake_up_']) h.c.submit(cmd);
  assert.equal(h.wakeCount(), 0);
  assert.ok(h.lines.some((l) => l.includes('ERROR') || l.includes('restore')), 'エラー応答あり');
});

test('console: WAKE_UP の表記揺れで 1 回だけ崩壊する', () => {
  for (const v of ['WAKE_UP', 'wake_up', 'Wake_Up', ' WAKE_UP ', 'wake up']) {
    const h = makeConsoleStub();
    h.c.open();
    h.c.submit(v);
    assert.equal(h.wakeCount(), 1, `${v} で崩壊`);
    h.c.submit('WAKE_UP');
    assert.equal(h.wakeCount(), 1, '二重発火しない');
  }
});

test('console: 大文字小文字を区別せず疑似コマンドが動く', () => {
  const h = makeConsoleStub();
  h.c.open();
  h.c.submit('HELP');
  h.c.submit('Status');
  h.c.submit('LS');
  h.c.submit('CAT readme.txt');
  h.c.submit('EXIT');
  assert.ok(h.lines.some((l) => l.includes('使用可能な命令')));
  assert.ok(h.lines.some((l) => l.includes('stability')));
  assert.ok(h.lines.some((l) => l.includes('boot.log')));
  assert.ok(h.lines.some((l) => l.includes('この層は記録の残骸')));
  assert.equal(h.isOpen(), false, 'exit で閉じる');
});

test('console: 異世界以外では開けない', () => {
  const ui = {
    consoleOpen: false,
    openConsole() { ui.consoleOpen = true; },
    closeConsole() { ui.consoleOpen = false; },
    printConsole() {}, clearConsole() {}, setConsoleInputEnabled() {},
  };
  const audio = new Proxy({}, { get: () => () => {} });
  const c = new GameConsole(ui as never, audio as never, { inVoid: () => false, busy: () => false, onWakeUp: () => {} });
  c.open();
  assert.equal(ui.consoleOpen, true, '開いてはいるが入力不可');
  c.close();
});

/* ---------------- ユーティリティ ---------------- */
test('util: 乱数はシード固定で再現する', () => {
  const a = new RNG(42), b = new RNG(42);
  for (let i = 0; i < 20; i++) assert.equal(a.next(), b.next());
  assert.ok(Math.abs(noise2(1.2, 3.4) - noise2(1.2, 3.4)) < 1e-12);
  assert.equal(clamp(5, 0, 1), 1);
});
