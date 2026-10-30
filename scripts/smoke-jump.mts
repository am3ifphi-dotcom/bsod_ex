/**
 * Headless sanity check for the new first-person jump / gravity model.
 *
 * Run: npx tsx scripts/smoke-jump.mts
 */
import * as THREE from 'three';

(globalThis as any).window = { innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1, addEventListener: () => {} };
(globalThis as any).document = { createElement: () => ({}), addEventListener: () => {} };
(globalThis as any).self = globalThis;

const { FirstPersonController } = await import('../src/player/FirstPersonController.ts');

const camera = new THREE.PerspectiveCamera(64, 16 / 9, 0.05, 1600);
const player = new FirstPersonController(camera);

let jumps = 0;
let lands: number[] = [];
player.onJump = () => { jumps++; };
player.onLand = (impact: number) => { lands.push(impact); };

const dt = 1 / 60;
const ground = () => 0;
const noClip = () => {};

// --- 1. standing still, no input: the player must stay glued to the ground -----------------
for (let i = 0; i < 120; i++) player.updateFreeRoam(dt, 3, ground, noClip, true);
const restY = player.position.y;
if (Math.abs(restY) > 1e-6) throw new Error(`player drifted off the ground: y=${restY}`);

// --- 2. jump --------------------------------------------------------------------------------
player.onKeyDown('Space');
let apex = -Infinity;
for (let i = 0; i < 180; i++) {
  player.updateFreeRoam(dt, 3, ground, noClip, true);
  apex = Math.max(apex, player.position.y);
}
if (jumps !== 1) throw new Error(`expected exactly one jump, got ${jumps}`);
if (apex < 0.45) throw new Error(`jump apex too low: ${apex}`);
if (apex > 1.6) throw new Error(`jump apex too high: ${apex}`);
if (lands.length !== 1) throw new Error(`expected one landing, got ${lands.length}`);
if (Math.abs(player.position.y) > 1e-6) throw new Error(`player did not land: y=${player.position.y}`);
if (lands[0] <= 0 || lands[0] > 1) throw new Error(`bad landing impact: ${lands[0]}`);

// --- 3. a second jump must be impossible while still airborne --------------------------------
player.onKeyDown('Space');
for (let i = 0; i < 10; i++) player.updateFreeRoam(dt, 3, ground, noClip, true);
if (jumps !== 2) throw new Error(`mid-air jump was allowed (jumps=${jumps})`);

// --- 4. landing back on the ground -------------------------------------------------------------
for (let i = 0; i < 180; i++) player.updateFreeRoam(dt, 3, ground, noClip, true);
if (Math.abs(player.position.y) > 1e-6) throw new Error(`player did not settle: y=${player.position.y}`);

// --- 5. walking off a ledge produces a real fall ------------------------------------------------
let groundY = 0;
player.updateFreeRoam(dt, 3, () => groundY, noClip, true);
groundY = -6; // the floor drops away
let fell = false;
for (let i = 0; i < 240; i++) {
  player.updateFreeRoam(dt, 3, () => groundY, noClip, true);
  if (player.position.y < -1) fell = true;
}
if (!fell) throw new Error('walking off a ledge did not trigger a fall');

console.log(
  `JUMP OK — apex=${apex.toFixed(2)}m landingImpact=${lands[0].toFixed(2)} falls=${fell} jumps=${jumps}`
);
console.log('SMOKE TEST PASSED');
