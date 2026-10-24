/**
 * 異世界(BSODグリッチ世界) — 複合大マップ
 * ①到着エリア(青い荒野) → ②崩壊建築(Sponza+立体通路) → ③都市の残骸 → ④深層 → ⑤中心構造物
 * すべてシームレスに連結(ロード画面なし)
 */
import * as THREE from 'three';
import { textures } from './textures';
import { applyGlitch, makeWireframeOverlayMaterial } from '../fx/glitch';
import type { CollisionWorld, TerrainSampler } from '../core/collision';
import type { QualityParams } from '../core/settings';
import { fbm2, mulberry32, clamp, lerp, randomHex, randomGlitchString, makeCanvas, canvasTexture } from '../core/utils';
import { buildRuins } from './ruins';
import { buildCity } from './city';
import { buildDepths } from './depths';

export const VOID_Y = -600; // 異世界の基準高度(ワールド座標)

export type TickFn = (dt: number, time: number) => void;

export interface VoidContext {
  group: THREE.Group;
  collision: CollisionWorld;
  quality: QualityParams;
  tickables: TickFn[];
  /** 中心構造物のビーコン位置(ワールド) */
  beacon: THREE.Vector3;
  /** WAKE_UP 碑の注視点(ワールド) */
  wakeUpLook: THREE.Vector3;
  /** 崩壊イベント開始位置(ワールド・足元) */
  collapseAnchor: THREE.Vector3;
}

/** 荒野の高度関数(メッシュと衝突で共有) */
export function wastelandHeight(x: number, z: number): number {
  const base = fbm2(x * 0.012, z * 0.012, 4) * 4.2;
  const ridges = Math.abs(fbm2(x * 0.03 + 7, z * 0.03 - 3, 3)) * 2.2;
  let h = base + ridges - 1.2;
  // 建築エリアは完全に平坦化(めり込み・段差の防止)
  const zone = (cx: number, cz: number, r: number): number => clamp(1 - Math.hypot(x - cx, z - cz) / r, 0, 1);
  const flatten = Math.max(
    zone(0, -6, 30) ** 2,        // 到着地点
    zone(34, -220, 34) ** 2,     // 崩壊建築
    zone(140, -245, 42) ** 2,    // 都市
    zone(-150, -230, 30) ** 2,   // 深層
    zone(0, -420, 40) ** 2,      // 中心構造物
    (clamp(1 - Math.abs(x) / 26, 0, 1) * clamp(1 - Math.abs(z + 130) / 130, 0, 1)) ** 2, // 導線の道
  );
  h = lerp(h, 0, flatten);
  return h;
}

class WastelandTerrain implements TerrainSampler {
  heightAt(x: number, z: number): number | null {
    // マップ矩形内のみ
    if (x < -300 || x > 300 || z < -560 || z > 120) return null;
    return wastelandHeight(x, z) + VOID_Y;
  }
}

export function buildVoidWorld(collision: CollisionWorld, quality: QualityParams): VoidContext {
  const group = new THREE.Group();
  group.name = 'voidWorld';
  const tickables: TickFn[] = [];
  const ctx: VoidContext = {
    group,
    collision,
    quality,
    tickables,
    beacon: new THREE.Vector3(0, VOID_Y + 42, -420),
    wakeUpLook: new THREE.Vector3(0, VOID_Y + 6, -396),
    collapseAnchor: new THREE.Vector3(0, VOID_Y, -392),
  };

  // ---------------- 空(グラデーション + 遠景グリッチ) ----------------
  const skyGeo = new THREE.SphereGeometry(900, 32, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vWorld;
      uniform float uTime;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        float h = normalize(vWorld).y * 0.5 + 0.5;
        vec3 low = vec3(0.012, 0.03, 0.10);
        vec3 mid = vec3(0.03, 0.10, 0.32);
        vec3 high = vec3(0.015, 0.045, 0.16);
        vec3 col = mix(low, mid, smoothstep(0.42, 0.58, h));
        col = mix(col, high, smoothstep(0.62, 1.0, h));
        // 遠くのグリッチ帯(ごく薄く・低周波)
        float band = smoothstep(0.5, 0.52, fract(h * 14.0 + uTime * 0.01)) * smoothstep(0.54, 0.52, fract(h * 14.0 + uTime * 0.01));
        col += vec3(0.02, 0.05, 0.16) * band * 0.4;
        float star = step(0.9985, hash(floor(normalize(vWorld).xz * 400.0)));
        col += vec3(0.4, 0.6, 1.0) * star * 0.35;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.position.y = VOID_Y;
  group.add(sky);
  tickables.push((_dt, time) => {
    skyMat.uniforms.uTime.value = time;
  });

  // ---------------- ライティング ----------------
  const hemi = new THREE.HemisphereLight(0x2c4e9e, 0x0a1228, 0.55);
  hemi.position.set(0, VOID_Y + 30, 0);
  group.add(hemi);
  const key = new THREE.DirectionalLight(0x6f9dff, 1.15);
  key.position.set(60, VOID_Y + 120, -220);
  key.target.position.set(0, VOID_Y, -220);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 20;
  key.shadow.camera.far = 500;
  key.shadow.camera.left = -160;
  key.shadow.camera.right = 160;
  key.shadow.camera.top = 160;
  key.shadow.camera.bottom = -160;
  key.shadow.bias = -0.0012;
  group.add(key, key.target);
  const fill = new THREE.DirectionalLight(0x2244aa, 0.35);
  fill.position.set(-120, VOID_Y + 60, -80);
  group.add(fill);

  // ---------------- 地形(荒野) ----------------
  const seg = quality.terrainSegments;
  const terrainGeo = new THREE.PlaneGeometry(600, 680, seg, seg);
  terrainGeo.rotateX(-Math.PI / 2);
  {
    const pos = terrainGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i) - 220; // センターを z=-220 に
      pos.setZ(i, z);
      pos.setY(i, wastelandHeight(x, z));
    }
    terrainGeo.computeVertexNormals();
  }
  const rocky = textures.rocky;
  const terrainMat = new THREE.MeshStandardMaterial({
    map: rocky.map,
    normalMap: rocky.normalMap ?? null,
    roughnessMap: rocky.roughnessMap ?? null,
    metalnessMap: rocky.metalnessMap ?? null,
    color: 0x3b62c8,
    roughness: 0.9,
    metalness: 0.22,
    envMapIntensity: 1.1,
  });
  if (terrainMat.map) {
    terrainMat.map = terrainMat.map.clone();
    (terrainMat.map as THREE.Texture).repeat.set(28, 32);
    terrainMat.map.needsUpdate = true;
  }
  const terrain = new THREE.Mesh(terrainGeo, terrainMat);
  terrain.position.y = VOID_Y;
  terrain.receiveShadow = true;
  group.add(terrain);
  collision.addTerrain(new WastelandTerrain());

  // ---------------- 浮遊する破片(インスタンス) ----------------
  const debrisCount = quality.debrisCount;
  const shardGeo = new THREE.IcosahedronGeometry(1, 0);
  const shardMat = new THREE.MeshStandardMaterial({
    color: 0x14285c,
    emissive: 0x1d3f9e,
    emissiveIntensity: 0.55,
    roughness: 0.42,
    metalness: 0.68,
  });
  applyGlitch(shardMat, { amp: 0.05, emissiveFlicker: 0.25 });
  const shards = new THREE.InstancedMesh(shardGeo, shardMat, debrisCount);
  const rng = mulberry32(20240101);
  const dummy = new THREE.Object3D();
  const shardData: { x: number; y: number; z: number; s: number; phase: number; spin: number }[] = [];
  for (let i = 0; i < debrisCount; i++) {
    const ang = rng() * Math.PI * 2;
    const rad = 12 + rng() * 260;
    const x = Math.cos(ang) * rad;
    const z = -200 + Math.sin(ang) * rad * 1.35;
    const y = wastelandHeight(x, z) + 1.2 + rng() * 14;
    const s = 0.18 + rng() * 1.6;
    shardData.push({ x, y, z, s, phase: rng() * Math.PI * 2, spin: 0.1 + rng() * 0.5 });
    dummy.position.set(x, y + VOID_Y, z);
    dummy.scale.setScalar(s);
    dummy.rotation.set(rng() * 6, rng() * 6, rng() * 6);
    dummy.updateMatrix();
    shards.setMatrixAt(i, dummy.matrix);
  }
  shards.castShadow = true;
  shards.receiveShadow = true;
  group.add(shards);
  tickables.push((dt, time) => {
    for (let i = 0; i < debrisCount; i++) {
      const d = shardData[i];
      dummy.position.set(d.x, d.y + VOID_Y + Math.sin(time * 0.32 * d.spin + d.phase) * 0.7, d.z);
      dummy.rotation.set(time * 0.05 * d.spin + d.phase, time * 0.04 * d.spin, d.phase);
      dummy.scale.setScalar(d.s);
      dummy.updateMatrix();
      shards.setMatrixAt(i, dummy.matrix);
    }
    shards.instanceMatrix.needsUpdate = true;
  });

  // ---------------- 導線: 発光パイロン ----------------
  const pylonGeo = new THREE.BoxGeometry(0.55, 3.2, 0.55);
  const pylonMat = new THREE.MeshStandardMaterial({
    color: 0x0d1c42,
    emissive: 0x2f6bff,
    emissiveIntensity: 1.6,
    roughness: 0.4,
    metalness: 0.5,
  });
  applyGlitch(pylonMat, { amp: 0.02, emissiveFlicker: 0.4 });
  const pathPoints: THREE.Vector3[] = [];
  for (let i = 0; i < 26; i++) {
    const t = i / 25;
    // 着地点 → 崩壊建築 → 中心構造物 へ続く道
    const z = lerp(-6, -380, t);
    const x = Math.sin(t * Math.PI * 2.2) * 14 * (1 - t * 0.6);
    pathPoints.push(new THREE.Vector3(x, 0, z));
  }
  const pylons = new THREE.InstancedMesh(pylonGeo, pylonMat, pathPoints.length * 2);
  let pi = 0;
  for (const p of pathPoints) {
    for (const side of [-1, 1]) {
      const h = wastelandHeight(p.x + side * 6.5, p.z);
      dummy.position.set(p.x + side * 6.5, h + VOID_Y + 1.6, p.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      pylons.setMatrixAt(pi++, dummy.matrix);
    }
  }
  group.add(pylons);

  // ---------------- エラー文字のモノリス ----------------
  const monoGeo = new THREE.BoxGeometry(1.6, 9, 0.7);
  const monoTex = textures.glyphAtlas().clone();
  monoTex.repeat.set(1, 2);
  monoTex.wrapT = THREE.RepeatWrapping;
  monoTex.needsUpdate = true;
  const monoMat = new THREE.MeshStandardMaterial({
    map: monoTex,
    emissiveMap: monoTex,
    emissive: 0x3a6fe0,
    emissiveIntensity: 1.1,
    color: 0x0e2048,
    roughness: 0.5,
    metalness: 0.4,
  });
  applyGlitch(monoMat, { amp: 0.035, emissiveFlicker: 0.35 });
  const monoliths = new THREE.InstancedMesh(monoGeo, monoMat, 18);
  const monoRng = mulberry32(777);
  for (let i = 0; i < 18; i++) {
    const ang = monoRng() * Math.PI * 2;
    const rad = 45 + monoRng() * 190;
    const x = Math.cos(ang) * rad;
    const z = -160 + Math.sin(ang) * rad;
    const h = wastelandHeight(x, z);
    dummy.position.set(x, h + VOID_Y + 4.2 + monoRng() * 2, z);
    dummy.rotation.set(0, monoRng() * Math.PI, (monoRng() - 0.5) * 0.12);
    dummy.scale.set(0.7 + monoRng() * 1.1, 0.7 + monoRng() * 1.4, 1);
    dummy.updateMatrix();
    monoliths.setMatrixAt(i, dummy.matrix);
  }
  group.add(monoliths);

  // ---------------- 遠景の都市の骨格(実3D + フォグ) ----------------
  const skylineGeo = new THREE.BoxGeometry(1, 1, 1);
  const skylineMat = new THREE.MeshStandardMaterial({
    color: 0x0c1c40,
    emissive: 0x16327c,
    emissiveIntensity: 0.6,
    roughness: 0.7,
    metalness: 0.3,
  });
  const skyline = new THREE.InstancedMesh(skylineGeo, skylineMat, 90);
  const skyRng = mulberry32(4242);
  for (let i = 0; i < 90; i++) {
    const ang = (i / 90) * Math.PI * 2 + skyRng() * 0.35;
    const rad = 300 + skyRng() * 140;
    const x = Math.cos(ang) * rad;
    const z = -200 + Math.sin(ang) * rad * 1.15;
    const w = 8 + skyRng() * 22;
    const h = 18 + skyRng() * 90;
    const d = 8 + skyRng() * 22;
    dummy.position.set(x, wastelandHeight(x, z) + VOID_Y + h / 2 - 4, z);
    dummy.rotation.set(0, skyRng() * Math.PI, 0);
    dummy.scale.set(w, h, d);
    dummy.updateMatrix();
    skyline.setMatrixAt(i, dummy.matrix);
  }
  group.add(skyline);

  // ---------------- 中心構造物 ----------------
  buildCoreStructure(ctx);

  // ---------------- 各エリア ----------------
  buildRuins(ctx);
  buildCity(ctx);
  buildDepths(ctx);

  // ---------------- グリッチ文字の雨(到着〜中核の通路) ----------------
  const glyphCount = Math.floor(quality.glyphCount * 0.5);
  const glyphTex = textures.glyphAtlas();
  const glyphGeo = new THREE.PlaneGeometry(1.1, 1.1);
  const glyphMat = new THREE.MeshBasicMaterial({
    map: glyphTex,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const glyphs = new THREE.InstancedMesh(glyphGeo, glyphMat, glyphCount);
  const glyphData: { x: number; y0: number; z: number; speed: number; s: number; phase: number }[] = [];
  const gRng = mulberry32(555);
  for (let i = 0; i < glyphCount; i++) {
    const x = (gRng() - 0.5) * 120;
    const z = -20 - gRng() * 380;
    const y0 = gRng() * 26;
    glyphData.push({ x, y0, z, speed: 0.25 + gRng() * 0.8, s: 0.35 + gRng() * 1.1, phase: gRng() * 20 });
  }
  group.add(glyphs);
  tickables.push((_dt, time) => {
    for (let i = 0; i < glyphCount; i++) {
      const g = glyphData[i];
      const y = ((g.y0 - time * g.speed + g.phase) % 26 + 26) % 26;
      dummy.position.set(g.x, VOID_Y + 1.5 + y, g.z);
      dummy.rotation.set(0, Math.sin(time * 0.1 + g.phase) * 0.4, 0);
      dummy.scale.setScalar(g.s);
      dummy.updateMatrix();
      glyphs.setMatrixAt(i, dummy.matrix);
    }
    glyphs.instanceMatrix.needsUpdate = true;
  });

  return ctx;
}

// ------------------------------------------------------------------
//  中心構造物: 遠くから見える巨大構造 + WAKE_UP
// ------------------------------------------------------------------
function buildCoreStructure(ctx: VoidContext): void {
  const { group, collision } = ctx;
  const baseY = wastelandHeight(0, -420) + VOID_Y;
  const coreGroup = new THREE.Group();
  coreGroup.position.set(0, baseY, -420);

  const metal = new THREE.MeshStandardMaterial({
    color: 0x11224e,
    emissive: 0x1b3f9e,
    emissiveIntensity: 0.5,
    roughness: 0.38,
    metalness: 0.82,
  });
  applyGlitch(metal, { amp: 0.04, emissiveFlicker: 0.3 });

  // 基壇(3段)
  for (let i = 0; i < 3; i++) {
    const r = 30 - i * 6;
    const step = new THREE.Mesh(new THREE.CylinderGeometry(r, r + 1.6, 1.6, 48), metal);
    step.position.y = 0.8 + i * 1.6;
    step.receiveShadow = true;
    step.castShadow = true;
    coreGroup.add(step);
    // 段差の衝突(円柱を矩形近似)
    collision.addBoxCentered(0, baseY + 0.8 + i * 1.6, -420, r * 2, 1.6, r * 2);
  }

  // 中央モノリス
  const mono = new THREE.Mesh(new THREE.CylinderGeometry(7, 11, 46, 8), metal);
  mono.position.y = 4.8 + 23;
  mono.castShadow = true;
  coreGroup.add(mono);
  collision.addBoxCentered(0, baseY + 20, -420, 16, 40, 16);

  // 回転するグリッチリング
  const ringMat = new THREE.MeshStandardMaterial({
    color: 0x0a1c4c,
    emissive: 0x2f6bff,
    emissiveIntensity: 1.6,
    roughness: 0.3,
    metalness: 0.7,
  });
  const rings: THREE.Mesh[] = [];
  for (let i = 0; i < 5; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(16 + i * 3.4, 0.5 + i * 0.12, 10, 64), ringMat);
    ring.position.y = 12 + i * 7.5;
    ring.rotation.x = Math.PI / 2 + (i % 2 ? 0.22 : -0.18);
    coreGroup.add(ring);
    rings.push(ring);
  }

  // 頂上のビーコン(光柱)
  const beaconMat = new THREE.MeshBasicMaterial({
    color: 0x7fb4ff,
    transparent: true,
    opacity: 0.42,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const beacon = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 4.5, 130, 12, 1, true), beaconMat);
  beacon.position.y = 46 + 65;
  coreGroup.add(beacon);
  const beaconLight = new THREE.PointLight(0x4d8dff, 380, 320, 1.6);
  beaconLight.position.y = 50;
  coreGroup.add(beaconLight);

  // 巨大な「顔」の残骸(モニターの記憶) — 二重リングの向こうに
  const faceTex = textures.bsodScreen(3, 0.35, 0.9);
  const facePlane = new THREE.Mesh(
    new THREE.PlaneGeometry(30, 17),
    new THREE.MeshBasicMaterial({ map: faceTex, transparent: true, opacity: 0.85, toneMapped: true }),
  );
  facePlane.position.set(0, 34, -8);
  facePlane.rotation.y = Math.PI;
  coreGroup.add(facePlane);

  // 入口の門と WAKE_UP 碑
  const gate = new THREE.Group();
  gate.position.set(0, 0, 22);
  const pillarGeo = new THREE.BoxGeometry(2.2, 12, 2.2);
  for (const s of [-1, 1]) {
    const p = new THREE.Mesh(pillarGeo, metal);
    p.position.set(s * 6, 6, 0);
    p.castShadow = true;
    gate.add(p);
    collision.addBoxCentered(s * 6, baseY + 6, -420 + 22, 2.2, 12, 2.2);
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(14.4, 2, 2.4), metal);
  lintel.position.y = 12;
  gate.add(lintel);

  const wakeTex = textures.wakeUpTexture();
  const wakeMat = new THREE.MeshBasicMaterial({
    map: wakeTex,
    transparent: true,
    toneMapped: true,
  });
  const wake = new THREE.Mesh(new THREE.PlaneGeometry(11, 2.75), wakeMat);
  wake.position.set(0, 8.2, -1.2);
  gate.add(wake);
  const wakeGlow = new THREE.PointLight(0x6fa0ff, 60, 40, 1.7);
  wakeGlow.position.set(0, 8, 2);
  gate.add(wakeGlow);

  // 奥(構造物の内部通路)の発光床
  const innerGlow = new THREE.Mesh(
    new THREE.PlaneGeometry(10, 26),
    new THREE.MeshBasicMaterial({ color: 0x1c44a8, transparent: true, opacity: 0.5 }),
  );
  innerGlow.rotation.x = -Math.PI / 2;
  innerGlow.position.set(0, 4.85, 6);
  gate.add(innerGlow);

  group.add(coreGroup);

  ctx.beacon.set(0, baseY + 50, -420);
  ctx.wakeUpLook.set(0, baseY + 8, -420 + 21);
  ctx.collapseAnchor.set(0, baseY + 4.85, -420 + 8);

  // 崩壊演出用: 基壇の破砕パーツ(最初は非表示)
  const fragMat = new THREE.MeshStandardMaterial({
    color: 0x0e2048,
    emissive: 0x1c44a8,
    emissiveIntensity: 0.8,
    roughness: 0.5,
    metalness: 0.6,
    transparent: true,
    opacity: 0.98,
  });
  const fragGeo = new THREE.BoxGeometry(2.6, 0.7, 2.6);
  const fragments = new THREE.InstancedMesh(fragGeo, fragMat, 42);
  fragments.visible = false;
  fragments.frustumCulled = false;
  group.add(fragments); // voidGroup は原点=ワールド座標と一致(崩壊破片はワールド座標で駆動)
  (ctx as unknown as { fragments?: THREE.InstancedMesh }).fragments = fragments;

  // ビーコン回転とリング
  ctx.tickables.push((dt, time) => {
    for (let i = 0; i < rings.length; i++) {
      rings[i].rotation.z += dt * (0.06 + i * 0.02) * (i % 2 === 0 ? 1 : -1);
      rings[i].rotation.x += dt * 0.012 * (i % 2 === 0 ? 1 : -1);
    }
    beaconMat.opacity = 0.36 + Math.sin(time * 0.8) * 0.08;
    facePlane.position.y = 34 + Math.sin(time * 0.24) * 0.8;
    // wake text の脈動
    const m = wakeMat as THREE.MeshBasicMaterial & { color: THREE.Color };
    const pulse = 0.85 + Math.sin(time * 1.1) * 0.15;
    m.color.setScalar(pulse);
  });
}

/** 中心構造物の周囲に落ちる床の破片を初期化(崩壊イベント用) */
export function primeCollapseFragments(ctx: VoidContext, playerPos: THREE.Vector3): THREE.Matrix4[] {
  const frag = (ctx as unknown as { fragments?: THREE.InstancedMesh }).fragments;
  const matrices: THREE.Matrix4[] = [];
  if (!frag) return matrices;
  frag.visible = true;
  const dummy = new THREE.Object3D();
  const rng = mulberry32(9182);
  for (let i = 0; i < frag.count; i++) {
    const ang = rng() * Math.PI * 2;
    const rad = 2 + rng() * 15;
    dummy.position.set(playerPos.x + Math.cos(ang) * rad, playerPos.y - 0.3, playerPos.z + Math.sin(ang) * rad);
    dummy.rotation.set(rng() * 0.4, rng() * Math.PI, rng() * 0.4);
    dummy.scale.setScalar(0.7 + rng() * 1.4);
    dummy.updateMatrix();
    frag.setMatrixAt(i, dummy.matrix);
    matrices.push(dummy.matrix.clone());
  }
  frag.instanceMatrix.needsUpdate = true;
  return matrices;
}

export { clamp, lerp, makeCanvas, canvasTexture, randomHex, randomGlitchString };
