// Bedroom: construction, procedural textures, the monitor's BSOD stage
// machine and the interactive props. No WebGL needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { bootDom, FakeAssets, makePhysics, readManifest } from './helpers.ts';

bootDom();

const physics = await makePhysics();
const assets = new FakeAssets(readManifest());

const tex = await import('../src/core/textures.ts');
const { Room } = await import('../src/game/room.ts');
const { MonitorScreen, STAGE_CLICKS, MAX_STAGE } = await import('../src/game/monitor.ts');

const room = new Room(assets as any, physics);
room.build();

test('procedural textures generate maps', () => {
  for (const fn of ['woodFloor', 'plaster', 'concrete', 'sand', 'fabric', 'metal', 'rug'] as const) {
    const set = (tex as any)[fn]();
    assert.ok(set?.map, `${fn} returned no colour map`);
    assert.ok(set.map.image?.width > 0, `${fn} map has no pixels`);
  }
  assert.ok((tex as any).citySkyline(), 'city skyline texture');
});

test('room builds with wall, desk, props and interactables', () => {
  assert.ok(room.group.children.length > 50, 'room scene graph is populated');
  const ids = room.interactables.map((i) => i.id);
  assert.ok(ids.length >= 6, `expected at least 6 interactables, got ${ids.length}`);
  for (const want of ['pc', 'lamp', 'blinds', 'poster', 'clock', 'door']) {
    assert.ok(ids.includes(want), `missing interactable "${want}" (have ${ids.join(', ')})`);
  }
  for (const i of room.interactables) {
    assert.ok(i.label.length > 0 && i.radius > 0, `interactable ${i.id} has no label/radius`);
  }
  const pos = room.screenWorldPosition();
  assert.ok(Number.isFinite(pos.x) && Number.isFinite(pos.y) && Number.isFinite(pos.z));
  assert.ok(pos.y > 0.4 && pos.y < 2.0, `monitor should sit on the desk, y=${pos.y}`);
});

test('room props/toggles run without throwing', () => {
  room.update(0.016, 0.1);
  room.toggleLamp();
  room.toggleBlinds();
  room.setEpilogue(true);
  room.update(0.016, 0.1);
  room.setEpilogue(false);
  room.update(0.016, 0.1);
});

test('monitor click advances glitch stages at the scripted click counts', () => {
  const mon = new MonitorScreen();
  assert.equal(mon.canvas.width, 1024);
  assert.equal(mon.click(0.95, 0.95), -1, 'click outside the ":(" glyph must miss');
  assert.equal(mon.clicks, 0, 'a miss must not count as a click');
  const total = STAGE_CLICKS[MAX_STAGE - 1];
  for (let i = 1; i <= total + 3; i++) {
    const want = STAGE_CLICKS.filter((t) => i >= t).length;
    const got = mon.click(0.2, 0.4);
    assert.equal(got, want, `click ${i} should report stage ${want}, got ${got}`);
  }
  assert.equal(mon.stage, MAX_STAGE, 'stage should be capped at the last one');
  mon.update(0.5);
  mon.update(0.5);
});

test('physics world built colliders for the room', () => {
  let n = 0;
  physics.world.forEachCollider(() => { n++; });
  assert.ok(n > 10, `expected room colliders, found ${n}`);
});

test('room geometry stays inside a sane bounding box', () => {
  const box = new THREE.Box3().setFromObject(room.group);
  const size = box.getSize(new THREE.Vector3());
  assert.ok(size.x < 20 && size.y < 10 && size.z < 20, `room bounds too large: ${size.toArray()}`);
});
