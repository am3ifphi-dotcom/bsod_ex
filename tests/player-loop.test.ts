// Real game-loop regression test.
//
// The player is a *kinematic* Rapier body: nothing moves it except
// `Physics.step()`. An earlier build never stepped the physics world, so the
// capsule stayed at the spawn pose, the controller kept reporting "grounded",
// and the camera sank through the floor from the very first frame.
//
// This suite runs the real Player + real Room + real physics in the same order
// the game loop uses, so that failure mode (and any future one like it) fails
// loudly instead of only showing up in a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { bootDom, FakeAssets, makePhysics, readManifest } from './helpers.ts';

bootDom();

const physics = await makePhysics();
const assets = new FakeAssets(readManifest());
const { Room } = await import('../src/game/room.ts');
const { Player } = await import('../src/game/player.ts');
const { Input } = await import('../src/core/input.ts');

const room = new Room(assets as any, physics);
room.build();

const canvas = document.getElementById('c') as any;
const input = new Input(canvas);
const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 400);
const player = new Player(physics, input, camera);

const DT = 1 / 60;

/** One frame of the game loop, in the same order as Game.update(). */
function frame(stepPhysics = true, holding: string[] = []) {
  input.keys.clear();
  for (const k of holding) input.keys.add(k);
  if (stepPhysics) physics.step(DT);
  player.update(DT);
}

function spawn() {
  player.reset(room.spawn.pos.clone().setY(0.02), room.spawn.yaw, -0.02);
  player.enabled = true;
}

test('the player stays on the bedroom floor instead of sinking', () => {
  spawn();
  const start = player.feet.y;
  for (let i = 0; i < 180; i++) frame();       // 3 s of standing still
  assert.ok(player.feet.y > -0.2, `the camera sank to y=${player.feet.y.toFixed(2)} (started ${start.toFixed(2)})`);
  assert.ok(player.grounded, 'the player should be standing on the floor');
  assert.ok(camera.position.y > 1.2, `eye height collapsed to ${camera.position.y.toFixed(2)} m`);
});

test('physics must be stepped, or the capsule never follows the camera', () => {
  // Documents the bug above: without the step, movement is reported but the
  // body (and therefore collision) stays behind.
  spawn();
  for (let i = 0; i < 60; i++) frame(false);
  const bodyY = player.bodyTranslation().y;
  assert.ok(Math.abs(bodyY - (room.spawn.pos.y + 0.02 + 0.32 + 0.55)) < 0.05,
    `the kinematic body should only move when the world is stepped (y=${bodyY.toFixed(2)})`);
});

test('walking forward moves the player and keeps them grounded', () => {
  spawn();
  const z0 = player.feet.z;
  for (let i = 0; i < 120; i++) frame(true, ['KeyW']);
  assert.ok(player.feet.z < z0 - 0.6, `W should walk the player forward (z ${z0.toFixed(2)} -> ${player.feet.z.toFixed(2)})`);
  assert.ok(player.feet.y > -0.2, 'walking must not fall through the floor');
  assert.ok(player.speed > 1, `the player should actually be moving (speed=${player.speed.toFixed(2)})`);
});

test('the desk stops the player', () => {
  spawn();
  for (let i = 0; i < 200; i++) frame(true, ['KeyW']);
  assert.ok(player.feet.z > -1.25, `the desk should block the player at z=${player.feet.z.toFixed(2)}`);
});

test('a short fall lands and settles without sinking through the floor', () => {
  spawn();
  // the room is 2.6 m tall and the capsule is 1.7 m, so max feet height is ~0.9
  player.teleport(new THREE.Vector3(0.35, 0.9, 1.0), 0, 0);
  for (let i = 0; i < 240; i++) frame();
  assert.ok(player.feet.y > -0.2 && player.feet.y < 0.3, `after landing the feet should be on the floor, y=${player.feet.y.toFixed(2)}`);
  assert.ok(player.grounded, 'the player should have landed');
});

test('the world spawn is solid ground (no falling at the arrival basin)', async () => {
  const { World } = await import('../src/game/world.ts');
  const world = new World(assets as any, physics);
  world.build();
  player.reset(world.spawn.pos.clone().setY(world.spawn.pos.y + 0.1), world.spawn.yaw, 0);
  for (let i = 0; i < 180; i++) frame();
  const ground = world.spawn.pos.y;
  assert.ok(Math.abs(player.feet.y - ground) < 0.6,
    `the player should settle on the arrival pad, y=${player.feet.y.toFixed(2)} (pad ${ground.toFixed(2)})`);
  assert.ok(player.grounded, 'the player should be grounded at the spawn');
});
