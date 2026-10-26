/**
 * ワールドの組み立て（段階的に進めてローディングバーを出す）
 */
import * as THREE from 'three';
import { createMaterials } from './materials.js';
import { buildRoom } from './room.js';
import { buildFurniture } from './furniture.js';
import { Colliders } from './colliders.js';
import { DustField } from './dust.js';
import { TimeOfDay } from './lighting.js';
import { createFragments } from './interact.js';
import { applyAnisotropy } from './textures.js';

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

export async function buildWorld({ scene, renderer, onProgress = () => {} }) {
  onProgress(0.04, '板の目を描いています…');
  await nextFrame();
  const M = createMaterials();
  applyAnisotropy(renderer.capabilities.getMaxAnisotropy());

  onProgress(0.42, '教室を組み立てています…');
  await nextFrame();
  const colliders = new Colliders();
  const room = buildRoom(M, colliders);
  scene.add(room.group);

  onProgress(0.62, '机を並べています…');
  await nextFrame();
  const furn = buildFurniture(M, colliders);
  scene.add(furn.group);

  onProgress(0.76, 'ほこりを舞わせています…');
  await nextFrame();
  const dust = new DustField(850);
  scene.add(dust.points);

  onProgress(0.84, '光を入れています…');
  await nextFrame();
  const tod = new TimeOfDay(scene, renderer, room.refs, dust);

  onProgress(0.92, '思い出を隠しています…');
  await nextFrame();
  const fragments = createFragments(M, scene);

  /* ---- 影の設定 ---- */
  const blockers = [];
  scene.traverse((o) => {
    if (o.userData?.shell) blockers.push(o);
    if (o.isSprite || o.isPoints) {
      o.castShadow = false;
      o.receiveShadow = false;
      return;
    }
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const skip = mats.some(
      (m) => !m || m.isMeshBasicMaterial || m.transparent || m.blending === THREE.AdditiveBlending
    );
    o.castShadow = !skip;
    o.receiveShadow = !skip;
  });

  onProgress(1, 'できました');
  await nextFrame();

  return {
    materials: M,
    colliders,
    room,
    furniture: furn,
    hotspots: [...room.hotspots, ...furn.hotspots],
    fragments,
    refs: room.refs,
    furnRefs: furn.refs,
    dust,
    tod,
    blockers,
  };
}
