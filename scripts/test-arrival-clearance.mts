import assert from 'node:assert/strict';
import * as THREE from 'three';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
const gradient = { addColorStop() {} };
const ctx: any = new Proxy({}, { get(_t, p) { if (p === 'createRadialGradient' || p === 'createLinearGradient') return () => gradient; return () => {}; }, set() { return true; } });
(globalThis as any).document = { createElement: () => ({ width: 512, height: 512, getContext: () => ctx, style: {} }) };
(globalThis as any).window = { innerWidth: 1600, innerHeight: 900, devicePixelRatio: 1, addEventListener() {} };
(globalThis as any).self = globalThis;
const { GlitchWorld, ARRIVAL_MONITOR } = await import('../src/world/GlitchWorld.ts');
const { FirstPersonController } = await import('../src/player/FirstPersonController.ts');
const world: any = new GlitchWorld();
world.spawnPosition.y = world.getTerrainHeight(0, 20);
world.buildKernelMegacityAndSkyRift();
const structures = world.group.getObjectByName('CitadelStructures') as THREE.InstancedMesh;
assert.ok(structures);
structures.geometry.computeBoundingBox();
const matrix = new THREE.Matrix4();
const bounds: THREE.Box3[] = [];
for (let i = 0; i < structures.count; i++) {
  structures.getMatrixAt(i, matrix);
  bounds.push(structures.geometry.boundingBox!.clone().applyMatrix4(matrix).expandByScalar(0.5));
}
// Check the actual monitor GLB bounds, not just its placement point.
const asset = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read('public/models/crt_monitor.glb');
const placement = new THREE.Object3D();
placement.position.set(ARRIVAL_MONITOR.x, world.getTerrainHeight(ARRIVAL_MONITOR.x, ARRIVAL_MONITOR.z) + ARRIVAL_MONITOR.heightOffset, ARRIVAL_MONITOR.z);
placement.rotation.set(...ARRIVAL_MONITOR.rotation);
placement.scale.setScalar(ARRIVAL_MONITOR.scale);
placement.updateMatrix();
for (const node of asset.getRoot().listNodes()) {
  const mesh = node.getMesh();
  if (!mesh) continue;
  const transform = placement.matrix.clone().multiply(new THREE.Matrix4().fromArray(node.getWorldMatrix()));
  for (const primitive of mesh.listPrimitives()) {
    const pos = primitive.getAttribute('POSITION');
    if (!pos) continue;
    const min = pos.getMin([]), max = pos.getMax([]);
    bounds.push(new THREE.Box3(new THREE.Vector3().fromArray(min), new THREE.Vector3().fromArray(max)).applyMatrix4(transform).expandByScalar(0.5));
  }
}
const camera = new THREE.PerspectiveCamera();
const player = new FirstPersonController(camera);
for (let t = 0; t <= 4.3; t += 1 / 120) {
  player.updateGlitchArrivalCutscene(1 / 120, t, world.spawnPosition, world.corePosition, world.skyPortalPos, world.skyPortalQuat);
  for (let i = 0; i < bounds.length; i++) {
    assert.ok(!bounds[i].containsPoint(camera.position), `arrival camera intersects structure ${i} at ${t.toFixed(2)}: ${camera.position.toArray()}`);
  }
}
console.log('Arrival path clears citadel and actual CRT geometry (120 Hz samples, 0.5m margin).');
