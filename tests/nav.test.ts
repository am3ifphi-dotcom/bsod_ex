// Walkability suite: drives the real Rapier character controller across the
// real level colliders (bedroom, wasteland, atrium stairs, deep trench, core
// stairs) and asserts every intended route is traversable and every boundary
// blocks. Two of these cases once failed because of real level bugs (floating
// stair treads, and a flight buried under the terrain bank of the trench).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { bootDom, FakeAssets, makePhysics, readManifest } from './helpers.ts';

bootDom();

const physics = await makePhysics();
const assets = new FakeAssets(readManifest());
const { World, WORLD_OFFSET, terrainHeight } = await import('../src/game/world.ts');
const { Room } = await import('../src/game/room.ts');

const room = new Room(assets as any, physics);
room.build();
const world = new World(assets as any, physics);
world.build();

const O = WORLD_OFFSET;
const W = (x: number, y: number, z: number) => new THREE.Vector3(x + O.x, y + O.y, z + O.z);

const body = physics.world.createRigidBody(
  RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 2, 0),
);
const col = physics.world.createCollider(RAPIER.ColliderDesc.capsule(0.55, 0.32), body);
const cc = physics.ensureCharacter();

const CAPSULE_HALF = 0.55 + 0.32; // capsule half height + radius

interface WalkOpts {
  start: THREE.Vector3;   // feet position
  target: THREE.Vector3;  // feet position to reach
  frames?: number;
  debug?: boolean;
}

/** Walk straight at a target using the game's own character controller. */
function walk(o: WalkOpts) {
  const frames = o.frames ?? 900;
  const pos = new THREE.Vector3(o.start.x, o.start.y + CAPSULE_HALF, o.start.z);
  body.setTranslation({ x: pos.x, y: pos.y, z: pos.z }, true);
  let vy = 0;
  let grounded = false;
  let stuck = 0;
  let prevDist = Infinity;
  for (let i = 0; i < frames; i++) {
    const to = new THREE.Vector3(o.target.x - pos.x, 0, o.target.z - pos.z);
    const dist = to.length();
    to.normalize();
    const speed = 4.3 / 60;
    vy -= 21 / 60;
    const delta = { x: to.x * speed, y: grounded ? -0.05 : vy / 60, z: to.z * speed };
    cc.computeColliderMovement(col, delta, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS);
    const mv = cc.computedMovement();
    grounded = cc.computedGrounded();
    pos.x += mv.x; pos.y += mv.y; pos.z += mv.z;
    body.setNextKinematicTranslation({ x: pos.x, y: pos.y, z: pos.z });
    physics.step(1 / 60);
    if (dist < prevDist - 0.001) { prevDist = dist; stuck = 0; } else stuck++;
    if (grounded) vy = 0;
    if (o.debug && i % 60 === 0) {
      console.log(`   [dbg] t=${(i / 60).toFixed(1)} x=${(pos.x - O.x).toFixed(2)} ` +
        `y=${(pos.y - CAPSULE_HALF).toFixed(2)} z=${(pos.z - O.z).toFixed(2)} dist=${dist.toFixed(2)}`);
    }
    if (dist < 0.5) break;
    if (stuck > 240) break;
  }
  return { pos, grounded, stuck, feetY: pos.y - CAPSULE_HALF };
}

const feet = (r: { feetY: number }) => `feetY=${r.feetY.toFixed(2)}`;
const where = (r: { pos: THREE.Vector3 }) =>
  `at (${(r.pos.x - O.x).toFixed(1)}, ${(r.pos.z - O.z).toFixed(1)})`;

test('bedroom: walk to the desk', () => {
  const r = walk({ start: new THREE.Vector3(0.35, 0, 1.25), target: new THREE.Vector3(0.35, 0, -1.4), frames: 260 });
  assert.ok(Math.abs(r.feetY) < 0.25, `the player should stay on the floor, ${feet(r)}`);
});

test('bedroom: the desk blocks the player', () => {
  const r = walk({ start: new THREE.Vector3(0.35, 0, 1.25), target: new THREE.Vector3(0.35, 0, -1.4), frames: 260 });
  assert.ok(r.feetY > -0.1 && r.pos.z > -1.15, `the desk should stop the player, z=${r.pos.z.toFixed(2)}`);
});

test('bedroom: the wall blocks the player', () => {
  const r = walk({ start: new THREE.Vector3(0.35, 0, 1.25), target: new THREE.Vector3(1.9, 0, 1.25), frames: 200 });
  assert.ok(r.pos.x < 2.3, `the east wall should stop the player, x=${r.pos.x.toFixed(2)}`);
});

test('wasteland: 32 m of open ground toward the core', () => {
  const r = walk({ start: W(0, terrainHeight(0, 92), 92), target: W(0, 0, 60), frames: 1000 });
  const lz = r.pos.z - O.z;
  const th = terrainHeight(r.pos.x - O.x, r.pos.z - O.z);
  assert.ok(lz < 66, `the player got stuck at z=${lz.toFixed(1)}`);
  assert.ok(Math.abs(r.feetY - th) < 1.2, `the player should follow the terrain, ${feet(r)} vs terrain ${th.toFixed(2)}`);
});

test('atrium: the entry stair reaches level 1', () => {
  const A = new THREE.Vector3(-50, 0, 34);
  const r = walk({ start: W(A.x, 0.2, A.z + 20.9), target: W(A.x, 4.3, A.z + 3), frames: 1600 });
  assert.ok(r.feetY > 3.6, `the flight should end on the first floor, ${feet(r)} ${where(r)}`);
});

test('core: the monument stair reaches the lookout', () => {
  const r = walk({ start: W(-9.8, 0.4, 14.6), target: W(-9.8, 9.92, -4.6), frames: 2000 });
  assert.ok(r.feetY > 8.0, `the monument stair should climb to the lookout, ${feet(r)} ${where(r)}`);
});

test('deep: descend into the trench', () => {
  const D = new THREE.Vector3(30, -9.2, -26);
  const r = walk({ start: W(D.x + 6, 0, D.z + 11), target: W(D.x + 6, -9.2, D.z - 2), frames: 1600 });
  assert.ok(r.feetY < -7.5, `the descent should reach the trench floor, ${feet(r)}`);
});

test('deep: climb back out toward the core', () => {
  const D = new THREE.Vector3(30, -9.2, -26);
  const r = walk({ start: W(D.x - 10.5, -9.2, D.z), target: W(2, 0.2, D.z), frames: 2000 });
  assert.ok(r.feetY > -0.8, `the climb-out stair should reach the rim, ${feet(r)} ${where(r)}`);
});

test('core: the plaza is walkable up to the monument', () => {
  const r = walk({ start: W(0, 0.4, -14), target: W(0, 0.4, -4), frames: 800 });
  const lz = r.pos.z - O.z;
  assert.ok(lz > -7.5 && Math.abs(r.feetY) < 1.2, `plaza walk stopped at z=${lz.toFixed(2)}, ${feet(r)}`);
});

// -------------------------------------------- atrium fire escape + bridge
test('atrium: walk out through the facade onto the fire escape', () => {
  const r = walk({ start: W(-60, 4.5, 34), target: W(-67, 4.5, 34), frames: 700 });
  assert.ok(r.pos.x - O.x < -66, `the west opening should lead outside, x=${(r.pos.x - O.x).toFixed(2)}`);
  assert.ok(Math.abs(r.feetY - 4.5) < 0.35, `the balcony should match the level 1 floor, ${feet(r)}`);
});

test('atrium: the fire escape reaches level 2', () => {
  const r = walk({ start: W(-68.5, 4.5, 30.4), target: W(-68.5, 8.8, 38.2), frames: 1600 });
  assert.ok(r.feetY > 8.2, `the first flight should top out on level 2, ${feet(r)} ${where(r)}`);
});

test('atrium: the second flight reaches level 3', () => {
  const r = walk({ start: W(-68.5, 8.8, 30.4), target: W(-68.5, 13.1, 38.2), frames: 1600 });
  assert.ok(r.feetY > 12.5, `the second flight should top out on level 3, ${feet(r)} ${where(r)}`);
});

test('atrium: the bridge descent returns to the ground', () => {
  const r = walk({ start: W(-34, 13.0, 25), target: W(-4, 0.5, 25), frames: 2600 });
  assert.ok(r.feetY < 2.5, `the long descent should reach the ground, ${feet(r)} ${where(r)}`);
});

// ------------------------------------------------------------------- alcove
test('atrium: the side alcove is reachable', () => {
  const r = walk({ start: W(-54, 0.25, 40), target: W(-60, 0.25, 40), frames: 900 });
  assert.ok(r.pos.x - O.x < -57.5, `the player should walk into the alcove, x=${(r.pos.x - O.x).toFixed(2)}`);
  assert.ok(Math.abs(r.feetY - 0.25) < 0.4, `the alcove floor should be level, ${feet(r)}`);
});
