import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FirstPersonController } from '../src/player/FirstPersonController.ts';
import { tunnelHandoff } from '../src/utils/TunnelHandoff.ts';

(globalThis as any).window = { innerWidth: 1600, innerHeight: 900 };
const duration = 7.2, overlap = 1.6, advance = 0.86;
assert.deepEqual(tunnelHandoff(0, duration, overlap, advance), { progress: 0, arrivalTime: 0 });
assert.deepEqual(tunnelHandoff(duration, duration, overlap, advance), { progress: 1, arrivalTime: advance });
let previous = 0;
for (let i = 0; i <= 160; i++) {
  const { progress } = tunnelHandoff(duration - overlap + overlap * i / 160, duration, overlap, advance);
  assert.ok(progress >= previous && progress <= 1);
  previous = progress;
}
const portal = new THREE.Vector3(0, 46, 86);
const group = new THREE.Group();
group.position.copy(portal);
group.lookAt(0, 22, -6);
const spawn = new THREE.Vector3(0, 4, 20);
const core = new THREE.Vector3(0, 4, -56);
const a = new THREE.PerspectiveCamera(), b = new THREE.PerspectiveCamera();
const playerA = new FirstPersonController(a), playerB = new FirstPersonController(b);
playerA.updateGlitchArrivalCutscene(0, tunnelHandoff(duration, duration, overlap, advance).arrivalTime, spawn, core, portal, group.quaternion);
playerB.updateGlitchArrivalCutscene(0, advance, spawn, core, portal, group.quaternion);
assert.ok(a.position.distanceTo(b.position) < 1e-8);
assert.ok(a.quaternion.angleTo(b.quaternion) < 1e-7);
assert.equal(a.fov, b.fov);
console.log('Tunnel handoff mask and camera continuity: passed');
