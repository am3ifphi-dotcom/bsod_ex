import { installDom } from './dom-shim.ts';
installDom();
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Physics } from '../src/core/physics.ts';

const physics = new Physics();
await physics.init();
// isolated staircase: 20 steps, rise r, run 0.7
const rise = Number(process.argv[2] ?? 0.42);
for (let i = 0; i < 20; i++) {
  const h = rise * (i + 1);
  physics.addBoxStatic(new THREE.Vector3(i * 0.7, h / 2, 0), new THREE.Vector3(0.35, h / 2, 1.4));
}
physics.addBoxStatic(new THREE.Vector3(8, -1, 0), new THREE.Vector3(40, 1, 40)); // floor
const body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 1, 0));
const col = physics.world.createCollider(RAPIER.ColliderDesc.capsule(0.55, 0.32), body);
const cc = physics.ensureCharacter();
const pos = new THREE.Vector3(-1.2, 0.87, 0);
body.setTranslation({ x: pos.x, y: pos.y, z: pos.z }, true);
let vy = 0, grounded = false;
const log: string[] = [];
for (let i = 0; i < 1200; i++) {
  vy -= 21 / 60;
  const delta = { x: 4.3 / 60, y: grounded ? -0.05 : vy / 60, z: 0 };
  cc.computeColliderMovement(col, delta, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS);
  const mv = cc.computedMovement();
  grounded = cc.computedGrounded();
  if (grounded) vy = 0;
  pos.x += mv.x; pos.y += mv.y; pos.z += mv.z;
  body.setNextKinematicTranslation({ x: pos.x, y: pos.y, z: pos.z });
  physics.step(1 / 60);
  if (i % 20 === 0) log.push(`t=${(i/60).toFixed(2)} x=${pos.x.toFixed(2)} y=${(pos.y-0.87).toFixed(2)} g=${grounded}`);
}
console.log(`rise=${rise}  final feet y=${(pos.y-0.87).toFixed(2)} x=${pos.x.toFixed(2)}`);
console.log(log.join('\n'));
