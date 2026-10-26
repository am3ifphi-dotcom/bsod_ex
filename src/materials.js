/**
 * マテリアル集 — 教室で使う素材をここで一括生成して共有する
 */
import * as THREE from 'three';
import {
  woodMaterialTextures,
  plasterTextures,
  paintedTextures,
  chalkboardTextures,
  scheduleTexture,
  drawingTexture,
  sloganTexture,
  clockFaceTexture,
  backdropTexture,
  metalTextures,
  ceilingTextures,
  deskTopTextures,
  glowSpriteTexture,
  labelTexture,
  clothTextures,
  keyboardTexture,
  globeTexture,
  cardboardTexture,
  bookSpineOne,
} from './textures.js';

const std = (o) => new THREE.MeshStandardMaterial(o);

export function createMaterials() {
  const M = {};

  /* ---- 床：使い込まれた板の間 ---- */
  const floor = woodMaterialTextures({
    size: 1024,
    planks: 8,
    base: [0x9a, 0x72, 0x45],
    variance: 24,
    grainStrength: 0.55,
    knots: 6,
    scuffs: 34,
    seamDark: 0.45,
    seed: 101,
  });
  M.floor = std({
    map: floor.map,
    normalMap: floor.normalMap,
    roughnessMap: floor.roughnessMap,
    normalScale: new THREE.Vector2(0.75, 0.75),
    roughness: 0.72,
    metalness: 0.02,
    color: 0xd8c3a0,
  });

  /* ---- 天井 ---- */
  const ceil = ceilingTextures({ size: 512, seed: 111 });
  M.ceiling = std({
    map: ceil.map,
    normalMap: ceil.normalMap,
    color: 0xd9d3c2,
    roughness: 0.94,
    metalness: 0,
  });

  /* ---- 壁：上半分はモルタル、下半分はペンキの腰板 ---- */
  const wall = plasterTextures({ size: 768, base: '#e8dec3', seed: 7 });
  M.wall = std({
    map: wall.map,
    normalMap: wall.normalMap,
    color: 0xe4d9bd,
    roughness: 0.95,
    metalness: 0,
  });

  const wain = paintedTextures({ size: 512, base: '#6d7f5e', seed: 11 });
  M.wainscot = std({
    map: wain.map,
    normalMap: wain.normalMap,
    color: 0x93a184,
    roughness: 0.62,
    metalness: 0.02,
  });

  const trim = paintedTextures({ size: 512, base: '#7b5c3a', seed: 19, chips: true });
  M.trim = std({
    map: trim.map,
    color: 0x9c7a52,
    roughness: 0.58,
    metalness: 0.03,
  });
  M.trimDark = std({ color: 0x5b4229, roughness: 0.6, metalness: 0.04 });

  /* ---- 黒板 ---- */
  const cb = chalkboardTextures({ size: 2048, aspect: 4, seed: 21 });
  M.chalkboard = std({
    map: cb.map,
    normalMap: cb.normalMap,
    normalScale: new THREE.Vector2(0.35, 0.35),
    color: 0xffffff,
    roughness: 0.82,
    metalness: 0.02,
  });
  M.chalkboardSide = std({ color: 0x20322a, roughness: 0.86 });
  M.boardFrame = std({ color: 0x6d5231, roughness: 0.55, metalness: 0.05 });

  /* ---- 金属 ---- */
  const metal = metalTextures({ size: 256, seed: 101 });
  M.steel = std({
    color: 0x8d8f8c,
    roughnessMap: metal.roughnessMap,
    roughness: 0.45,
    metalness: 0.85,
  });
  M.steelDark = std({ color: 0x4b5150, roughness: 0.52, metalness: 0.7 });
  M.chrome = std({ color: 0xd8dcd8, roughness: 0.18, metalness: 1 });
  M.windowFrame = std({
    map: paintedTextures({ size: 256, base: '#5c6b63', seed: 23, chips: true }).map,
    color: 0x79897f,
    roughness: 0.5,
    metalness: 0.35,
  });

  /* ---- ガラス ---- */
  M.glass = new THREE.MeshPhysicalMaterial({
    color: 0xdfeaf0,
    transparent: true,
    opacity: 0.16,
    roughness: 0.06,
    metalness: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
    envMapIntensity: 1.2,
  });
  M.glassFrosted = new THREE.MeshPhysicalMaterial({
    color: 0xe8eef0,
    transparent: true,
    opacity: 0.55,
    roughness: 0.7,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  /* ---- 机の天板（落書きのバリエーション） ---- */
  M.deskTops = [];
  for (let i = 0; i < 4; i++) {
    const d = deskTopTextures({ size: 620, seed: 121 + i * 37, graffiti: i !== 3 });
    M.deskTops.push(
      std({
        map: d.map,
        normalMap: d.normalMap,
        roughnessMap: d.roughnessMap,
        normalScale: new THREE.Vector2(0.7, 0.7),
        color: 0xd9bb90,
        roughness: 0.68,
        metalness: 0.02,
      })
    );
  }
  M.deskWood = std({ color: 0x8a6539, roughness: 0.6, metalness: 0.03 });
  M.deskWoodLight = std({ color: 0xb08b57, roughness: 0.62, metalness: 0.03 });

  /* ---- 紙もの ---- */
  M.schedule = std({ map: scheduleTexture({ size: 640, seed: 33 }).map, roughness: 0.92 });
  M.drawing1 = std({ map: drawingTexture({ size: 600, seed: 45, title: 'うんどうかい' }).map, roughness: 0.93 });
  M.drawing2 = std({
    map: drawingTexture({ size: 600, seed: 48, title: 'なつの　うみ', seed2: 1 }).map,
    roughness: 0.93,
  });
  M.slogan = std({
    map: sloganTexture({ size: 540, seed: 55, title: '手をあらおう' }).map,
    roughness: 0.92,
  });
  M.slogan2 = std({
    map: sloganTexture({
      size: 540,
      seed: 58,
      title: 'めあて',
      body: ['なかよく　する', 'じかんを　まもる', 'そうじを　がんばる'],
      accent: '#a05a45',
    }).map,
    roughness: 0.92,
  });
  // 背表紙の色パレット（薄い本用）と、厚い本用のテクスチャ
  const bookHues = [0x8c4a3c, 0x3f5f7a, 0x5f7a44, 0xa07a34, 0x6a4a7a, 0x2f6a63, 0x9a5a2a, 0x4a4a6a, 0x7a3f4f, 0x3f6a5a];
  M.bookColors = bookHues.map((c, i) => std({ color: c, roughness: 0.72 + (i % 3) * 0.08 }));
  M.bookPages = std({ color: 0xd6c9a4, roughness: 0.96 });
  const binderDefs = [
    { color: '#7a4a3a', title: '昆虫記' },
    { color: '#3d5a78', title: '日本地図' },
    { color: '#5c7346', title: '図　鑑' },
    { color: '#8a6a2e', title: 'ことわざ' },
    { color: '#6b4674', title: '詩　集' },
  ];
  M.binders = binderDefs.map((d, i) =>
    std({ map: bookSpineOne({ color: d.color, title: d.title, seed: 61 + i * 13 }).map, roughness: 0.74 })
  );
  M.paper = std({ color: 0xe8dcc0, roughness: 0.95 });
  M.paperWhite = std({ color: 0xf2eee0, roughness: 0.94 });
  M.cork = std({
    map: paintedTextures({ size: 512, base: '#a98a5c', seed: 81, chips: false }).map,
    color: 0xc3a274,
    roughness: 0.98,
  });

  /* ---- 時計 ---- */
  M.clockFace = std({ map: clockFaceTexture({ size: 512, seed: 77 }).map, roughness: 0.7 });
  M.clockHand = std({ color: 0x2b2620, roughness: 0.6 });

  /* ---- 布・ビニール ---- */
  const cloth = clothTextures({ size: 512, base: '#e9dfc4', folds: 7, seed: 151 });
  M.curtain = std({
    map: cloth.map,
    normalMap: cloth.normalMap,
    normalScale: new THREE.Vector2(0.6, 0.6),
    color: 0xf0e6cd,
    roughness: 0.97,
    side: THREE.DoubleSide,
  });
  M.rag = std({ color: 0xcfc6ab, roughness: 1, side: THREE.DoubleSide });
  M.vinyl = std({ color: 0x8a3f34, roughness: 0.44, metalness: 0.02 });
  M.vinylBlue = std({ color: 0x3c5570, roughness: 0.46 });
  M.cloth = std({ color: 0xb9ae92, roughness: 0.98 });

  /* ---- プラスチック・その他 ---- */
  M.plasticWhite = std({ color: 0xdcd8cc, roughness: 0.42, metalness: 0.02 });
  M.plasticRed = std({ color: 0xa8402f, roughness: 0.5 });
  M.plasticBlue = std({ color: 0x3d6387, roughness: 0.5 });
  M.rubber = std({ color: 0x2a2724, roughness: 0.92 });
  M.chalkWhite = std({ color: 0xf2f0e4, roughness: 0.9 });
  M.chalkYellow = std({ color: 0xe8cf86, roughness: 0.9 });
  M.chalkRed = std({ color: 0xc46a5a, roughness: 0.9 });
  M.eraser = std({ color: 0x6b5a3f, roughness: 0.95 });
  M.eraserFelt = std({ color: 0xb9b09a, roughness: 1 });
  M.ironBlack = std({ color: 0x2f2b26, roughness: 0.62, metalness: 0.55 });
  M.ceramic = std({ color: 0xe6e2d4, roughness: 0.24, metalness: 0.02 });
  M.water = new THREE.MeshPhysicalMaterial({
    color: 0x8fc0c8,
    transparent: true,
    opacity: 0.42,
    roughness: 0.06,
    metalness: 0,
  });
  M.goldfish = std({ color: 0xe8763a, roughness: 0.4, emissive: 0x2a0e02, emissiveIntensity: 0.4 });
  M.globeOcean = std({ color: 0x3f6f96, roughness: 0.4 });
  M.globeLand = std({ color: 0x9aa86a, roughness: 0.55 });
  M.paintBlack = std({ color: 0x14110e, roughness: 0.7 });
  M.lampOn = std({
    color: 0xffffff,
    emissive: 0xfff4dc,
    emissiveIntensity: 0,
    roughness: 0.3,
  });
  M.lampHousing = std({ color: 0xcfcabd, roughness: 0.6, metalness: 0.2 });

  /* ---- 外の景色 ---- */
  M.backdrop = {
    day: new THREE.MeshBasicMaterial({ map: backdropTexture('day', { size: 1600, seed: 91 }).map, fog: false }),
    dusk: new THREE.MeshBasicMaterial({ map: backdropTexture('dusk', { size: 1600, seed: 91 }).map, fog: false }),
    night: new THREE.MeshBasicMaterial({ map: backdropTexture('night', { size: 1600, seed: 91 }).map, fog: false }),
  };
  M.groundOutside = std({ color: 0x8f8a68, roughness: 1 });


  /* ---- 家具・小物 ---- */
  const pianoWoodT = woodMaterialTextures({
    size: 512,
    planks: 1,
    base: [0x4a, 0x2c, 0x1c],
    variance: 12,
    grainStrength: 0.6,
    knots: 1,
    scuffs: 10,
    seamDark: 0,
    seed: 201,
  });
  M.pianoWood = std({
    map: pianoWoodT.map,
    normalMap: pianoWoodT.normalMap,
    normalScale: new THREE.Vector2(0.4, 0.4),
    color: 0x8d6a52,
    roughness: 0.3,
    metalness: 0.06,
  });
  M.keyboard = std({ map: keyboardTexture({ size: 1024, seed: 161 }).map, roughness: 0.34, metalness: 0.02 });
  M.globe = std({ map: globeTexture({ size: 512, seed: 171 }).map, roughness: 0.36, metalness: 0.04 });
  M.cardboard = std({ map: cardboardTexture({ size: 256, seed: 181 }).map, color: 0xd8bd92, roughness: 0.95 });
  M.leather = std({ color: 0x6b2f24, roughness: 0.42, metalness: 0.03 });
  M.leatherDark = std({ color: 0x4a2019, roughness: 0.5 });
  M.straw = std({ color: 0xc2a05a, roughness: 1 });
  M.galva = std({ color: 0xa9abad, roughness: 0.36, metalness: 0.82 });
  M.iron = std({ color: 0x262220, roughness: 0.72, metalness: 0.34 });
  M.brass = std({ color: 0xc6a04c, roughness: 0.3, metalness: 0.92 });
  M.paperStack = std({ color: 0xe9e2cd, roughness: 0.95 });
  M.milkBottle = std({ color: 0xf2f0e4, roughness: 0.22, metalness: 0.02 });
  M.milkCap = std({ color: 0xd9a441, roughness: 0.6 });
  M.soil = std({ color: 0x4a3826, roughness: 1 });
  M.leaf = std({ color: 0x4f7a3a, roughness: 0.85, side: THREE.DoubleSide });
  M.flower = std({ color: 0x9163c6, roughness: 0.7, emissive: 0x1c0c2c, emissiveIntensity: 0.25 });
  M.terracotta = std({ color: 0xa8643f, roughness: 0.8 });
  M.fragment = std({
    color: 0xffe2a8,
    emissive: 0xffab3d,
    emissiveIntensity: 2.4,
    roughness: 0.18,
    metalness: 0.1,
  });
  M.darkInside = std({ color: 0x2a231c, roughness: 0.95 });

  /* ---- 発光スプライト ---- */
  M.glow = glowSpriteTexture({ size: 256, color: '#ffd98a' });
  M.glowSoft = glowSpriteTexture({ size: 256, color: '#fff0c8' });

  return M;
}

/** 使い回しの箱メッシュ */
export function box(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

/** 使い回しの円柱 */
export function cyl(rt, rb, h, seg, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.position.set(x, y, z);
  return m;
}

export const ROOM = {
  W: 9, // x: -4.5 .. 4.5
  D: 8, // z: -4 .. 4
  H: 3, // y: 0 .. 3
  X0: -4.5,
  X1: 4.5,
  Z0: -4,
  Z1: 4,
  WALL_T: 0.18,
  WAIN_H: 1.0,
};


/* ================= 共通ヘルパ ================= */

/** ジオメトリのUVをタイリング用にスケール（マテリアルのrepeatは1のまま共有できる） */
export function scaleUV(geom, su, sv) {
  const uv = geom.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  uv.needsUpdate = true;
  return geom;
}

/** 大きさに対してUVを自動調整した平面 */
export function plane(w, h, mat, tile = 2) {
  const g = new THREE.PlaneGeometry(w, h, 1, 1);
  scaleUV(g, w / tile, h / tile);
  return new THREE.Mesh(g, mat);
}

/** 札・プレート用マテリアル */
export function labelMaterial(text, opts = {}) {
  const t = labelTexture({ text, ...opts });
  return std({ map: t.map, roughness: 0.85, metalness: 0.02, ...opts.mat });
}
