/**
 * GLB 教室ワールド（public/models/classroom.glb）
 * -------------------------------------------------------------
 * モデル: Ryoshi "alternative classroom" — https://github.com/grep-many/ryoshi (MIT)
 *
 * 描画は GLTFLoader、論理（当たり判定/照合/配置）は src/glb-collide.js の
 * 占有解析から作る。48万三角形に毎フレームレイキャストを撃たないよう、
 * ホットスポットとブロッカーは「見えないボックス」を照合ターゲットにする。
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Colliders } from './colliders.js';
import { DustField } from './dust.js';
import { TimeOfDay } from './lighting.js';
import { createFragments } from './interact.js';
import { analyzeGLB, makeTransform, gridRects } from './glb-collide.js';
import { GLB_HOTSPOT_DEFS, GLB_FRAGMENT_DEFS, GLB_SPAWN } from './glb-content.js';
import { plane, labelMaterial } from './materials.js';

const rawPlane = (w, h, mat) => new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

/** Buffer / Uint8Array でも GLTFLoader が要求する ArrayBuffer に正規化する */
function toArrayBuffer(buf) {
  if (buf instanceof ArrayBuffer) return buf;
  if (ArrayBuffer.isView(buf)) return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  throw new Error('GLB は ArrayBuffer / Uint8Array で渡してください');
}

function parseGLTF(buffer) {
  return new Promise((resolve, reject) => {
    new GLTFLoader().parse(toArrayBuffer(buffer), '', resolve, reject);
  });
}

/** 見えない照合用ボックス */
function proxyBox(box6, tag) {
  const [x0, y0, z0, x1, y1, z1] = box6;
  const g = new THREE.BoxGeometry(Math.max(0.02, x1 - x0), Math.max(0.02, y1 - y0), Math.max(0.02, z1 - z0));
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial());
  m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  m.visible = false;
  m.userData.box6 = box6;
  m.name = `proxy:${tag}`;
  m.updateMatrixWorld(true);
  return m;
}

export async function buildGLBWorld({ scene, renderer, buffer, M, onProgress = () => {} }) {
  onProgress(0.5, '教室の形を読んでいます…');
  await nextFrame();
  const a = analyzeGLB(buffer, { cell: 0.1 });
  const T = makeTransform(a);
  const k = T.k;

  onProgress(0.62, '教室を運んでいます…');
  await nextFrame();
  const gltf = await parseGLTF(buffer);
  const model = gltf.scene || gltf.scenes?.[0];

  /* ---- 変換（黒板を手前 -Z へ、床を y=0 に、中心を原点へ） ---- */
  const holder = new THREE.Group();
  holder.name = 'glb-classroom';
  holder.scale.setScalar(k);
  holder.rotation.y = T.rot;
  const g = a.grid;
  const mcx = (g.floorLo[0] + g.floorHi[0]) / 2;
  const mcz = (g.floorLo[1] + g.floorHi[1]) / 2;
  // world = R(rot) * k * (m - mc)  を満たす位置
  const c = Math.cos(T.rot), s = Math.sin(T.rot);
  const rx = (k * mcx) * c + (k * mcz) * s;
  const rz = -(k * mcx) * s + (k * mcz) * c;
  holder.position.set(-rx, -(a.floorY || 0) * k, -rz);
  scene.add(holder);
  holder.add(model);

  /* ---- マテリアル調整：ガラスは軽く、影は落とさない ---- */
  let glassCount = 0;
  model.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    let glass = false;
    for (const m of mats) {
      if (!m) continue;
      if ((m.isMeshPhysicalMaterial && m.transmission > 0.05) || (m.transparent && m.opacity < 0.6)) {
        glass = true;
        m.transmission = 0;
        m.transparent = true;
        m.opacity = Math.min(m.opacity || 0.3, 0.3);
        m.roughness = Math.max(m.roughness ?? 0.1, 0.08);
        m.depthWrite = true;
      }
      if (m.emissive && /light|lamp|032|031/i.test(m.name || '')) {
        m.emissive = new THREE.Color(0xfff2d0);
        m.emissiveIntensity = 0;
      }
      // metalness=1 のマテリアルは環境反射が無いと真っ黒になるので IBL を効かせる
      if (m.isMeshStandardMaterial || m.isMeshPhysicalMaterial) {
        m.envMapIntensity = (m.metalness ?? 0) > 0.5 ? 1.0 : 0.55;
      }
    }
    if (glass) {
      glassCount++;
      o.castShadow = false;
    } else {
      o.castShadow = true;
    }
    o.receiveShadow = true;
  });

  /* ---- 環境光（IBL）---- */
  // 44 マテリアルのうち 6 つが metalness>0.15（既定 1.0 込み）。
  // 環境マップが無いと金属が黒つぶれするため、中くらいの強さで入れておく。
  if (renderer && renderer.isWebGLRenderer) {
    try {
      const pmrem = new THREE.PMREMGenerator(renderer);
      const roomEnv = new RoomEnvironment();
      scene.environment = pmrem.fromScene(roomEnv, 0.04).texture;
      scene.environmentIntensity = 0.46;
      pmrem.dispose();
    } catch (e) {
      scene.environment = null;
    }
  }

  /* ---- 部屋の範囲 ---- */
  const bounds = T.rect(g.floorLo[0], g.floorLo[1], g.floorHi[0], g.floorHi[1]);

  /* ---- コライダー（占有グリッドの矩形分解 + 外周の壁） ---- */
  const colliders = new Colliders();
  for (const b of gridRects(a, { step: 1 })) {
    const r = T.rect(b.mx0, b.mz0, b.mx1, b.mz1);
    colliders.addBox(r.x0, r.z0, r.x1, r.z1, 'glb');
  }
  // 外周はグリッドの取りこぼしに備えて二重にふさぐ
  const WALL = 0.4;
  colliders.addBox(bounds.x0 - WALL, bounds.z0 - WALL, bounds.x1 + WALL, bounds.z0, 'glb-wall-n');
  colliders.addBox(bounds.x0 - WALL, bounds.z1, bounds.x1 + WALL, bounds.z1 + WALL, 'glb-wall-s');
  colliders.addBox(bounds.x0 - WALL, bounds.z0, bounds.x0, bounds.z1, 'glb-wall-w');
  colliders.addBox(bounds.x1, bounds.z0, bounds.x1 + WALL, bounds.z1, 'glb-wall-e');

  /* ---- 照合用プロキシ ---- */
  const proxies = new THREE.Group();
  proxies.name = 'glb-proxies';
  scene.add(proxies);
  const hotspots = GLB_HOTSPOT_DEFS.map((d) => {
    const px = proxyBox(d.box, d.id);
    proxies.add(px);
    return {
      id: d.id,
      name: d.name,
      tag: d.tag,
      title: d.title,
      body: d.body,
      extra: d.extra,
      action: d.action,
      meshes: [px],
      anchor: new THREE.Vector3(...d.anchor),
      reach: d.reach,
    };
  });
  const blockers = [];
  for (const b of colliders.items) {
    const px = proxyBox([b.x0, 0, b.z0, b.x1, 2.6, b.z1], `blk:${b.tag}`);
    proxies.add(px);
    blockers.push(px);
  }

  /* ---- 空・外の地面（窓のむこう） ---- */
  onProgress(0.74, '窓のそとを広げています…');
  await nextFrame();
  const sky = new THREE.Group();
  sky.name = 'glb-sky';
  const bd = rawPlane(48, 28, M.backdrop.day);
  bd.name = 'backdrop';
  bd.rotation.y = Math.PI / 2;
  bd.position.set(bounds.x0 - 17, 5.5, 0);
  sky.add(bd);
  const outside = plane(120, 120, M.groundOutside, 30);
  outside.name = 'outside';
  outside.rotation.x = -Math.PI / 2;
  outside.position.set(bounds.x0 - 24, -3.75, 0);
  sky.add(outside);
  // 廊下側のあかりとり（扉のそと）
  const corrWin = plane(2.2, 2.4, new THREE.MeshBasicMaterial({ color: 0xdfe8ea }), 1);
  corrWin.rotation.y = -Math.PI / 2;
  corrWin.position.set(bounds.x1 + 1.4, 1.6, -3.05);
  sky.add(corrWin);
  scene.add(sky);

  /* ---- ちり ---- */
  const dust = new DustField(700, bounds);
  scene.add(dust.points);

  /* ---- 光 ---- */
  onProgress(0.84, '光を入れています…');
  await nextFrame();
  const lampLights = [];
  for (const [lx, lz] of [[-1.7, -2.4], [1.7, -2.4], [-1.7, 2.4], [1.7, 2.4]]) {
    const pl = new THREE.PointLight(0xffeecb, 0, 9, 2);
    pl.position.set(lx, 2.62, lz);
    scene.add(pl);
    lampLights.push(pl);
  }
  const corridorLight = new THREE.PointLight(0xdfe8ea, 0, 6, 2);
  corridorLight.position.set(bounds.x1 + 0.7, 2.0, -3.05);
  scene.add(corridorLight);

  const refs = {
    lamps: [],
    lampLights,
    backdropMesh: bd,
    backdropMats: M.backdrop,
    shaftGroup: new THREE.Group(),
    corridorLight,
    corridorWindow: corrWin,
    fan: null,
    clockHands: null,
    windows: [], // 本物の影で光が落ちるので、フェイクの柱は使わない
    curtains: [],
  };
  refs.shaftGroup.name = 'shafts';
  scene.add(refs.shaftGroup);

  const tod = new TimeOfDay(scene, renderer, refs, dust);
  if (scene.environment) {
    const baseUpdate = tod.update.bind(tod);
    tod.update = (dt) => {
      baseUpdate(dt);
      const amb = ((tod.hemi?.intensity ?? 1) * 0.6 + (tod.ambient?.intensity ?? 0.5)) / 1.6;
      scene.environmentIntensity = Math.max(0.07, Math.min(0.55, 0.62 * amb));
    };
  }
  // 部屋が手続き版より広いので影カメラを広げる
  const sc = tod.sun.shadow.camera;
  sc.left = -9.5; sc.right = 9.5; sc.top = 9.5; sc.bottom = -9.5; sc.far = 60;
  sc.updateProjectionMatrix();
  tod.sun.target.position.set(0, 0.6, 0);

  /* ---- かけら ---- */
  onProgress(0.92, '思い出を隠しています…');
  await nextFrame();
  const fragments = createFragments(M, scene, GLB_FRAGMENT_DEFS);

  onProgress(1, 'できました');
  await nextFrame();

  return {
    mode: 'glb',
    materials: M,
    colliders,
    hotspots,
    fragments,
    refs,
    dust,
    tod,
    blockers,
    bounds,
    spawn: GLB_SPAWN,
    playerRadius: 0.16,
    stats: { triangles: a.triangles, unitsPerMeter: a.unitsPerMeter, boxes: colliders.count, glassCount },
  };
}

export { labelMaterial };
