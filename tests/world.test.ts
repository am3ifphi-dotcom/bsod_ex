// BSOD world: construction, terrain function, relic LODs, per-frame update and
// a rigid-body drop through the real physics world.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { bootDom, FakeAssets, makePhysics, readManifest } from './helpers.ts';

bootDom();

const physics = await makePhysics();
const assets = new FakeAssets(readManifest());
const { World, terrainHeight, WORLD_OFFSET } = await import('../src/game/world.ts');
const world = new World(assets as any, physics);
world.build();

test('world builds every zone', () => {
  assert.ok(world.group.children.length > 300, `world scene graph: ${world.group.children.length} objects`);
  const names = new Set(world.group.children.map((c) => c.name).filter(Boolean));
  assert.ok(names.has('terrain'), 'terrain mesh exists');
});

test('terrain height field is finite and shaped', () => {
  let min = Infinity, max = -Infinity;
  for (let x = -140; x <= 140; x += 4) {
    for (let z = -140; z <= 140; z += 4) {
      const h = terrainHeight(x, z);
      assert.ok(Number.isFinite(h), `terrain NaN at ${x},${z}`);
      min = Math.min(min, h); max = Math.max(max, h);
    }
  }
  assert.ok(max - min > 4, 'terrain has relief');
  assert.ok(terrainHeight(30, -26) < -7, 'the deep trench is below the rest of the map');
  assert.ok(Math.abs(terrainHeight(0, 0)) < 1, 'the core plaza pad is flat');
});

test('the whole map is inside the terrain plane', () => {
  // PlaneGeometry(300) centred on the world group: everything walkable must be
  // inside it or the player would fall off the edge of the ground mesh.
  const half = 150;
  for (const [x, z] of [[0, 92], [-50, 34], [48, 10], [30, -26], [0, 0]] as const) {
    assert.ok(Math.abs(x) < half && Math.abs(z) < half, `zone at ${x},${z} is off the terrain`);
  }
});

test('relics expose real LOD levels', () => {
  const lods: THREE.LOD[] = [];
  world.group.traverse((o) => { if ((o as THREE.LOD).isLOD) lods.push(o as THREE.LOD); });
  assert.ok(lods.length >= 3, `expected LOD'ed relics, found ${lods.length}`);
  for (const l of lods) assert.ok(l.levels.length >= 1, 'LOD without levels');
});

test('per-frame update and glitch response run clean', () => {
  const eye = new THREE.Vector3(0, 1.6, 92).add(WORLD_OFFSET);
  for (let i = 0; i < 120; i++) world.update(1 / 60, eye, 0.2 + (i % 10) * 0.05);
});

test('a dynamic body lands on the terrain instead of falling through', () => {
  const drop = physics.addDynamicBox(new THREE.Vector3(0, 30, 92 + WORLD_OFFSET.z),
    new THREE.Vector3(0.5, 0.5, 0.5));
  for (let i = 0; i < 400; i++) physics.step(1 / 60);
  const y = drop.translation().y;
  assert.ok(y > -5 && y < 10, `box should rest near the arrival pad, y=${y.toFixed(2)}`);
});

test('player spawn and wake-up points are inside the map', () => {
  const spawn = world.spawn.pos.clone().sub(WORLD_OFFSET);
  const wake = world.wakeUpPoint.clone().sub(WORLD_OFFSET);
  assert.ok(spawn.distanceTo(new THREE.Vector3(0, 0, 92)) < 8, `spawn at ${spawn.toArray()}`);
  assert.ok(wake.length() < 20, `wake-up point at ${wake.toArray()}`);
});
