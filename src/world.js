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
import { buildGLBWorld } from './glbworld.js';

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

export async function buildWorld({ scene, renderer, onProgress = () => {} }) {
  onProgress(0.04, '板の目を描いています…');
  await nextFrame();
  const M = createMaterials();
  applyAnisotropy(renderer.capabilities.getMaxAnisotropy());

  /* ---- 本物の教室（public/models/classroom.glb）があればそちらを使う ---- */
  let glbBuffer = null;
  try {
    const res = await fetch('./models/classroom.glb');
    if (res.ok) {
      const total = Number(res.headers.get('content-length')) || 0;
      if (res.body && total > 1e6) {
        // 37MBあるので、ストリームで読みながら進捗を出す
        const reader = res.body.getReader();
        const chunks = [];
        let got = 0;
        let shown = -1;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          got += value.length;
          const pct = Math.floor((got / total) * 100);
          if (pct !== shown) {
            shown = pct;
            onProgress(0.02 + 0.18 * (got / total), `教室をよみこみ中… ${Math.round(got / 1e6)} / ${Math.round(total / 1e6)} MB`);
            await nextFrame();
          }
        }
        const all = new Uint8Array(got);
        let off = 0;
        for (const c of chunks) {
          all.set(c, off);
          off += c.length;
        }
        glbBuffer = all.buffer;
      } else {
        glbBuffer = await res.arrayBuffer();
      }
    }
  } catch {
    glbBuffer = null;
  }
  if (glbBuffer) {
    onProgress(0.2, '本物の教室をほどいています…');
    await nextFrame();
    const w = await buildGLBWorld({
      scene,
      renderer,
      buffer: glbBuffer,
      M,
      onProgress: (p, t) => onProgress(0.2 + p * 0.8, t),
    });
    scene.traverse((o) => {
      if (o.isSprite || o.isPoints) {
        o.castShadow = false;
        o.receiveShadow = false;
      }
    });
    return w;
  }

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
