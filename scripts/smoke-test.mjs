/**
 * smoke-test.mjs — ブラウザなしで検証できるロジックのテスト
 * 実行: npx tsx scripts/smoke-test.mjs
 * (実行環境にGPU/ブラウザがないため、映像・音・入力の実機確認はREADME記載の手順で行ってください)
 */
import * as THREE from 'three';
import { execCommand, bootLines, resetConsoleState } from '../src/game/console.ts';
import { SettingsStore, qualityParams } from '../src/core/settings.ts';
import { CollisionWorld, CharacterController } from '../src/core/collision.ts';
import { clamp, lerp, saccade, fbm2, mulberry32, wastelandHeightTest } from './test-utils.mjs';

let passed = 0;
let failed = 0;
function ok(cond, name) {
  if (cond) {
    passed++;
    console.log(`  ok: ${name}`);
  } else {
    failed++;
    console.error(`  NG: ${name}`);
  }
}

console.log('--- console commands ---');
resetConsoleState();
{
  resetConsoleState();
  const r = execCommand('');
  ok(!r.wakeUp && r.lines.some((l) => l.text.includes('ERR 0x000C')), '空Enterはエラー応答');
}
{
  for (const cmd of ['WAKE_UP', 'wake_up', 'Wake_Up', 'wakeup', 'wake-up', 'WAKE_up']) {
    resetConsoleState();
    const r = execCommand(cmd);
    ok(r.wakeUp === true, `「${cmd}」で崩壊イベント開始(大文字小文字不問)`);
  }
}
{
  resetConsoleState();
  const r = execCommand('help');
  ok(!r.wakeUp && r.lines.length > 3, 'help は断片一覧(コマンド正解は示さない)');
  ok(!r.lines.some((l) => l.text.toLowerCase().includes('wake_up') && l.cls === 'sys'), 'help に wake_up の直接指示なし');
}
{
  resetConsoleState();
  const r = execCommand('WAKE'); // 途中
  ok(!r.wakeUp, 'wake(不完全)では始まらない');
}
{
  resetConsoleState();
  const r = execCommand('exit');
  ok(!r.wakeUp, 'exit では始まらない');
}
{
  resetConsoleState();
  const r = execCommand('some_unknown_xyz');
  ok(!r.wakeUp && r.lines.some((l) => l.text.includes('ERR 0x00FF')), '未知コマンドはエラーコード応答');
}
{
  resetConsoleState();
  const r = execCommand('  wake_up  '); // 前後空白
  ok(r.wakeUp === true, '前後空白の wake_up も有効');
}
{
  resetConsoleState();
  const r = execCommand('cls');
  ok(r.clear === true, 'cls でクリア');
}
{
  // 連打(フラッド検出)
  resetConsoleState();
  let flood = false;
  for (let i = 0; i < 12; i++) {
    const r = execCommand('status');
    if (r.lines.some((l) => l.text.includes('FLOOD'))) flood = true;
  }
  ok(flood, '連打すると FLOOD DETECTED');
}

console.log('--- boot lines ---');
{
  const b = bootLines();
  ok(b.length >= 3 && b.every((l) => l.text.length > 0), '起動行が生成される');
}

console.log('--- settings ---');
{
  // localStorage を持たない環境でも動く
  const store = new SettingsStore();
  ok(store.data.sensitivity >= 0.2 && store.data.sensitivity <= 3.0, '感度 0.2〜3.0');
  ok(['low', 'medium', 'high', 'ultra'].includes(store.data.quality), '画質プリセット');
  store.set('sensitivity', 2.5);
  ok(store.data.sensitivity === 2.5, '感度変更が即反映(データ)');
  for (const q of ['low', 'medium', 'high', 'ultra']) {
    const p = qualityParams(q);
    ok(p.shadowMapSize > 0 && p.pixelRatioCap > 0, `quality ${q} のパラメータ`);
  }
}

console.log('--- collision ---');
{
  const world = new CollisionWorld();
  // 床
  world.addBoxCentered(0, -0.5, 0, 20, 1, 20);
  // 壁
  world.addBoxCentered(0, 1.5, -5, 20, 3, 1, false);
  // 段差(ステップ)
  world.addBoxCentered(3, 0.15, 2, 2, 0.3, 2);
  const c = new CharacterController(world);
  c.teleport(0, 0, 0);
  // 前進 → 壁で停止
  for (let i = 0; i < 200; i++) {
    c.update(new THREE.Vector3(0, 0, -1), 3, 1 / 60);
  }
  ok(c.position.z > -4.6 && c.position.z < -3.5, `壁に抜けることなく停止 (z=${c.position.z.toFixed(2)})`);
  // 段差は登れる
  c.teleport(1.2, 0.3, 2);
  let maxSteps = 0;
  for (let i = 0; i < 120; i++) {
    c.update(new THREE.Vector3(1, 0, 0), 3, 1 / 60);
    maxSteps = Math.max(maxSteps, c.position.y);
  }
  ok(maxSteps > 0.25, `段差をステップアップ (y=${maxSteps.toFixed(2)})`);
  // ダッシュ速度でも壁抜けしない
  c.teleport(0, 0.3, -2);
  for (let i = 0; i < 60; i++) {
    c.update(new THREE.Vector3(0, 0, -1), 12, 1 / 60); // ダッシュ相当
  }
  ok(c.position.z > -4.6, `ダッシュでも壁抜けしない (z=${c.position.z.toFixed(2)})`);
  // 重力で落下し、床で止まる
  c.teleport(0, 3, 0);
  for (let i = 0; i < 200; i++) {
    c.update(new THREE.Vector3(0, 0, 0), 0, 1 / 60);
  }
  ok(Math.abs(c.position.y) < 0.02, `落下して床で停止 (y=${c.position.y.toFixed(3)})`);
}

console.log('--- utils ---');
{
  ok(clamp(5, 0, 1) === 1 && lerp(0, 10, 0.5) === 5, 'clamp/lerp');
  const s0 = saccade(0);
  const s1 = saccade(1);
  ok(s0 === 0 && s1 > 0.8 && s1 <= 1, `saccade easing (${s1.toFixed(2)})`);
  ok(Math.abs(fbm2(0.5, 0.5, 4)) <= 1, 'fbm2 範囲');
  const rnd = mulberry32(42);
  const v1 = rnd();
  const rnd2 = mulberry32(42);
  ok(rnd2() === v1, '決定論的乱数');
}

console.log('--- wasteland height (map design) ---');
{
  const { wastelandHeight } = await import('../src/world/voidWorld.ts');
  const h0 = wastelandHeight(0, -6);
  const h1 = wastelandHeight(50, -50);
  ok(Math.abs(h0) < 1.2, `着地点がほぼ平坦 (${h0.toFixed(2)})`);
  ok(Number.isFinite(h1), `高度関数が有限 (${h1.toFixed(2)})`);
  ok(Math.abs(wastelandHeight(0, -130)) < 2.0, '中央通路が比較的平坦');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
