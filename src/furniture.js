/**
 * 家具・小物 — 机、椅子、教卓、ピアノ、ストーブ、本棚、掃除用具入れ…
 */
import * as THREE from 'three';
import { ROOM as R, box, cyl, labelMaterial } from './materials.js';
import { rng } from './textures.js';

const rawPlane = (w, h, mat) => new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
const m3 = (geo, mat, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
};

/* ---- 共有ジオメトリ（描画コストとメモリ削減） ---- */
const G = {
  deskTop: new THREE.BoxGeometry(0.62, 0.028, 0.44),
  deskShelf: new THREE.BoxGeometry(0.54, 0.016, 0.34),
  deskLeg: new THREE.CylinderGeometry(0.017, 0.017, 0.692, 8),
  deskRailSide: new THREE.BoxGeometry(0.028, 0.028, 0.37),
  deskRailFront: new THREE.BoxGeometry(0.55, 0.028, 0.028),
  deskFoot: new THREE.CylinderGeometry(0.021, 0.021, 0.03, 8),
  deskHook: new THREE.TorusGeometry(0.032, 0.006, 6, 14),
  chairSeat: new THREE.BoxGeometry(0.34, 0.026, 0.32),
  chairBack: new THREE.BoxGeometry(0.34, 0.2, 0.022),
  chairLeg: new THREE.CylinderGeometry(0.014, 0.014, 0.41, 8),
  chairBackLeg: new THREE.CylinderGeometry(0.014, 0.014, 0.68, 8),
  chairRail: new THREE.BoxGeometry(0.026, 0.022, 0.3),
  chairFoot: new THREE.CylinderGeometry(0.018, 0.018, 0.024, 8),
  book: new THREE.BoxGeometry(0.15, 0.022, 0.21),
  notebook: new THREE.BoxGeometry(0.18, 0.008, 0.25),
  pencil: new THREE.CylinderGeometry(0.005, 0.005, 0.17, 6),
};

/* ==================================================================
   机と椅子
   ================================================================== */
function makeDesk(M, variant = 0) {
  const g = new THREE.Group();
  const topMat = M.deskTops[variant % M.deskTops.length];
  const top = m3(G.deskTop, [M.deskWood, M.deskWood, topMat, M.deskWood, M.deskWood, M.deskWood], 0, 0.706, 0);
  top.name = 'desktop';
  g.add(top);
  g.add(m3(G.deskShelf, M.deskWoodLight, 0, 0.5, 0));
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      g.add(m3(G.deskLeg, M.steelDark, sx * 0.275, 0.346, sz * 0.185));
      g.add(m3(G.deskFoot, M.rubber, sx * 0.275, 0.015, sz * 0.185));
    }
  for (const sx of [-1, 1]) g.add(m3(G.deskRailSide, M.steelDark, sx * 0.275, 0.5, 0));
  for (const sz of [-1, 1]) g.add(m3(G.deskRailFront, M.steelDark, 0, 0.5, sz * 0.185));
  const hook = m3(G.deskHook, M.steel, 0.325, 0.62, 0);
  hook.rotation.y = Math.PI / 2;
  g.add(hook);
  return g;
}

function makeChair(M, knocked = false) {
  const g = new THREE.Group();
  g.add(m3(G.chairSeat, M.deskWoodLight, 0, 0.42, 0));
  const back = m3(G.chairBack, M.deskWoodLight, 0, 0.6, 0.155);
  back.rotation.x = -0.14;
  g.add(back);
  for (const sx of [-1, 1]) {
    g.add(m3(G.chairLeg, M.steelDark, sx * 0.145, 0.205, -0.13));
    const bl = m3(G.chairBackLeg, M.steelDark, sx * 0.145, 0.34, 0.14);
    bl.rotation.x = -0.12;
    g.add(bl);
    g.add(m3(G.chairFoot, M.rubber, sx * 0.145, 0.012, -0.13));
    g.add(m3(G.chairFoot, M.rubber, sx * 0.145, 0.012, 0.155));
    g.add(m3(G.chairRail, M.steelDark, sx * 0.145, 0.18, 0));
  }
  if (knocked) {
    g.rotation.z = Math.PI / 2 - 0.18;
    g.rotation.y = 0.7;
    g.position.y = 0.162; // 倒したときに脚が床に沈まない高さ
  }
  return g;
}

/* ==================================================================
   ピアノ
   ================================================================== */
function makePiano(M) {
  const g = new THREE.Group();
  const W = 1.52;
  const H = 1.16;
  const D = 0.56;
  g.add(box(W, H, D, M.pianoWood, 0, H / 2 + 0.08, 0));
  g.add(box(W + 0.04, 0.045, D + 0.04, M.pianoWood, 0, H + 0.1, 0));
  // 前板・鍵盤ぶた
  g.add(box(W - 0.08, 0.4, 0.05, M.pianoWood, 0, H - 0.12, D / 2 - 0.02));
  g.add(box(W - 0.04, 0.05, 0.3, M.pianoWood, 0, 0.84, D / 2 + 0.06));
  // 鍵盤棚
  g.add(box(W - 0.02, 0.05, 0.32, M.pianoWood, 0, 0.74, D / 2 + 0.08));
  const keys = rawPlane(1.34, 0.214, M.keyboard);
  keys.rotation.x = -Math.PI / 2;
  keys.position.set(0, 0.772, D / 2 + 0.09);
  keys.name = 'keys';
  g.add(keys);
  // 譜面台と楽譜
  const stand = box(1.0, 0.3, 0.02, M.pianoWood, 0, 0.98, D / 2 - 0.1);
  stand.rotation.x = -0.3;
  g.add(stand);
  const sheet = rawPlane(0.34, 0.26, M.paperWhite);
  sheet.position.set(-0.05, 1.035, D / 2 - 0.05);
  sheet.rotation.set(-1.27, 0, 0.04);
  g.add(sheet);
  // 脚・ペダル
  for (const sx of [-1, 1]) {
    g.add(box(0.09, 0.1, D - 0.06, M.pianoWood, sx * (W / 2 - 0.08), 0.05, 0));
    g.add(box(0.07, 0.62, 0.07, M.pianoWood, sx * (W / 2 - 0.08), 0.4, D / 2 - 0.12));
  }
  g.add(box(0.42, 0.05, 0.1, M.pianoWood, 0, 0.13, D / 2 - 0.16));
  for (const px of [-0.07, 0, 0.07]) g.add(box(0.03, 0.012, 0.07, M.brass, px, 0.115, D / 2 - 0.13));
  // 椅子
  const bench = new THREE.Group();
  bench.position.set(0.05, 0, D / 2 + 0.62);
  bench.add(box(0.72, 0.055, 0.3, M.pianoWood, 0, 0.5, 0));
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const leg = cyl(0.026, 0.03, 0.5, 8, M.pianoWood, sx * 0.3, 0.25, sz * 0.11);
      leg.rotation.x = sz * 0.05;
      bench.add(leg);
    }
  bench.add(box(0.62, 0.03, 0.03, M.pianoWood, 0, 0.16, 0));
  g.add(bench);
  return g;
}

/* ==================================================================
   ストーブ
   ================================================================== */
function makeStove(M) {
  const g = new THREE.Group();
  g.add(cyl(0.2, 0.23, 0.06, 16, M.iron, 0, 0.03, 0));
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    g.add(box(0.04, 0.14, 0.04, M.iron, Math.cos(a) * 0.17, 0.12, Math.sin(a) * 0.17));
  }
  const body = cyl(0.21, 0.22, 0.46, 18, M.iron, 0, 0.42, 0);
  g.add(body);
  for (const y of [0.28, 0.52]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.215, 0.012, 6, 20), M.iron);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = y;
    g.add(ring);
  }
  g.add(cyl(0.245, 0.245, 0.03, 18, M.iron, 0, 0.665, 0));
  const ring2 = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.014, 6, 18), M.iron);
  ring2.rotation.x = Math.PI / 2;
  ring2.position.y = 0.685;
  g.add(ring2);
  // 焚き口
  const door = cyl(0.09, 0.09, 0.02, 16, M.iron, 0, 0.36, 0.215);
  door.rotation.x = Math.PI / 2;
  g.add(door);
  g.add(box(0.06, 0.016, 0.02, M.steel, 0, 0.36, 0.235));
  // 煙突
  const pipe = cyl(0.052, 0.052, R.H - 0.7, 12, M.iron, 0, 0.7 + (R.H - 0.7) / 2, 0);
  g.add(pipe);
  g.add(cyl(0.075, 0.075, 0.05, 12, M.iron, 0, R.H - 0.03, 0));
  // ヤカン
  const kettle = new THREE.Group();
  kettle.position.set(0.02, 0.69, -0.02);
  kettle.add(cyl(0.085, 0.1, 0.15, 16, M.galva, 0, 0.075, 0));
  kettle.add(cyl(0.055, 0.085, 0.03, 16, M.galva, 0, 0.16, 0));
  const spout = cyl(0.017, 0.03, 0.14, 10, M.galva, 0.11, 0.13, 0);
  spout.rotation.z = -0.85;
  kettle.add(spout);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.008, 6, 16, Math.PI), M.steelDark);
  handle.position.y = 0.17;
  handle.rotation.z = 0;
  kettle.add(handle);
  g.add(kettle);
  return g;
}

/* ==================================================================
   本棚
   ================================================================== */
function makeShelf(M, rnd) {
  const g = new THREE.Group();
  const W = 2.3;
  const H = 1.78;
  const D = 0.34;
  g.add(box(0.03, H, D, M.trim, -W / 2 + 0.015, H / 2, 0));
  g.add(box(0.03, H, D, M.trim, W / 2 - 0.015, H / 2, 0));
  g.add(box(W, H, 0.02, M.trim, 0, H / 2, D / 2 - 0.01)); // 背板（壁側）
  g.add(box(W, 0.03, D, M.trim, 0, H - 0.015, 0));
  const shelfYs = [0.02, 0.44, 0.86, 1.28];
  for (const y of shelfYs) g.add(box(W - 0.05, 0.028, D - 0.02, M.trim, 0, y, 0));

  // 本の列
  const putBooks = (y, x0, x1) => {
    let x = x0;
    while (x < x1 - 0.06) {
      const thick = rnd() < 0.15;
      const bw = thick ? 0.085 + rnd() * 0.05 : 0.022 + rnd() * 0.03;
      const bh = thick ? 0.24 + rnd() * 0.05 : 0.185 + rnd() * 0.08;
      const bd = thick ? 0.2 + rnd() * 0.04 : 0.15 + rnd() * 0.05;
      const mat = thick
        ? M.binders[(rnd() * M.binders.length) | 0]
        : M.bookColors[(rnd() * M.bookColors.length) | 0];
      const b = box(
        bw, bh, bd,
        [M.bookPages, M.bookPages, M.bookPages, M.bookPages, mat, mat],
        x + bw / 2, y + bh / 2 + 0.014, 0.02,
      );
      if (!thick && rnd() < 0.12) b.rotation.z = 0.16 + rnd() * 0.2;
      g.add(b);
      x += bw + 0.006;
    }
  };
  putBooks(0.44, -W / 2 + 0.06, 0.24);
  putBooks(0.86, -W / 2 + 0.06, -0.32);
  putBooks(1.28, -0.16, W / 2 - 0.08);

  // 段ボール箱
  const c1 = box(0.36, 0.28, 0.3, M.cardboard, 0.62, 0.59, 0);
  g.add(c1);
  g.add(box(0.36, 0.02, 0.06, M.paperStack, 0.62, 0.73, 0));
  const tag = rawPlane(0.16, 0.07, labelMaterial('学級文庫', { w: 340, h: 150, bg: '#f0e8d2', fg: '#4a3a22', font: 'gothic', size: 0.4, border: null }));
  tag.position.set(0.62, 0.6, -0.152);
  tag.rotation.y = Math.PI;
  g.add(tag);

  // 地球儀
  const globe = new THREE.Group();
  globe.position.set(-0.72, 1.31, 0);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.115, 24, 18), M.globe);
  ball.position.y = 0.14;
  ball.rotation.z = 0.41;
  globe.add(ball);
  const arc = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.006, 6, 24, Math.PI), M.brass);
  arc.position.y = 0.14;
  arc.rotation.z = 0.41;
  globe.add(arc);
  globe.add(cyl(0.012, 0.012, 0.1, 8, M.brass, 0, 0.05, 0));
  globe.add(cyl(0.075, 0.09, 0.03, 12, M.trimDark, 0, 0.015, 0));
  g.add(globe);

  // ラジオ
  const radio = new THREE.Group();
  radio.position.set(0.1, 0.88, 0.02);
  radio.add(box(0.3, 0.15, 0.14, M.trimDark, 0, 0.075, 0));
  radio.add(box(0.18, 0.1, 0.012, M.darkInside, -0.05, 0.075, -0.072));
  radio.add(cyl(0.026, 0.026, 0.014, 12, M.brass, 0.1, 0.09, -0.075).rotateX(Math.PI / 2));
  radio.add(cyl(0.018, 0.018, 0.012, 12, M.plasticWhite, 0.1, 0.045, -0.075).rotateX(Math.PI / 2));
  g.add(radio);

  // ノートの山
  for (let i = 0; i < 5; i++) {
    const nb = m3(G.notebook, i % 2 ? M.paperStack : M.vinylBlue, -0.55 + (rnd() - 0.5) * 0.03, 0.03 + i * 0.009, 0.02);
    nb.rotation.y = (rnd() - 0.5) * 0.22;
    g.add(nb);
  }
  // 置き忘れられた上履き
  const shoe = box(0.1, 0.06, 0.22, M.paperWhite, 0.9, 0.06, 0.05);
  shoe.rotation.y = 0.4;
  g.add(shoe);

  return { group: g, globeBall: ball };
}

/* ==================================================================
   掃除用具入れ
   ================================================================== */
function makeLocker(M, rnd) {
  const g = new THREE.Group();
  const W = 1.2;
  const H = 1.95;
  const D = 0.38;
  g.add(box(W, H, 0.02, M.wainscot, 0, H / 2, D / 2 - 0.01)); // 背板（壁側）
  g.add(box(0.03, H, D, M.wainscot, -W / 2 + 0.015, H / 2, 0));
  g.add(box(0.03, H, D, M.wainscot, W / 2 - 0.015, H / 2, 0));
  g.add(box(W, 0.03, D, M.wainscot, 0, H - 0.015, 0));
  g.add(box(W - 0.05, 0.03, D - 0.04, M.trim, 0, 0.045, 0));
  // 中は暗い
  g.add(box(W - 0.06, H - 0.08, 0.02, M.darkInside, 0, H / 2, D / 2 - 0.03));
  // 吊り棒
  g.add(cyl(0.014, 0.014, W - 0.08, 8, M.steel, 0, H - 0.16, 0).rotateZ(Math.PI / 2));

  // ほうき・モップ（中に吊るす）
  const broom = (x, len, headMat, headH) => {
    const b = new THREE.Group();
    b.position.set(x, H - 0.16, -0.04);
    b.add(cyl(0.013, 0.013, len, 8, M.trim, 0, -len / 2, 0));
    b.add(cyl(0.055, 0.085, headH, 12, headMat, 0, -len - headH / 2 + 0.06, 0));
    b.rotation.z = (rnd() - 0.5) * 0.08;
    return b;
  };
  g.add(broom(-0.34, 1.16, M.straw, 0.24));
  g.add(broom(-0.12, 1.22, M.rag, 0.2));
  g.add(broom(0.12, 1.1, M.straw, 0.22));
  // ちりとり
  const pan = new THREE.Group();
  pan.position.set(0.36, 0.42, -0.02);
  pan.add(box(0.2, 0.02, 0.22, M.plasticRed, 0, 0, 0));
  pan.add(box(0.2, 0.09, 0.02, M.plasticRed, 0, 0.045, -0.1));
  pan.add(cyl(0.012, 0.012, 0.5, 8, M.steel, 0, 0.26, -0.09));
  g.add(pan);

  // 扉（右側があいている）
  const doorL = new THREE.Group();
  doorL.position.set(-W / 2 + 0.03, 0, -D / 2);
  doorL.add(box(W / 2 - 0.03, H - 0.06, 0.022, M.wainscot, (W / 2 - 0.03) / 2, H / 2, 0));
  doorL.add(box(0.02, 0.12, 0.03, M.steel, W / 2 - 0.1, 1.05, -0.02));
  g.add(doorL);
  const doorR = new THREE.Group();
  doorR.position.set(W / 2 - 0.03, 0, -D / 2);
  const panel = box(W / 2 - 0.03, H - 0.06, 0.022, M.wainscot, -(W / 2 - 0.03) / 2, H / 2, 0);
  doorR.add(panel);
  doorR.add(box(0.02, 0.12, 0.03, M.steel, -(W / 2 - 0.1), 1.05, -0.02));
  doorR.rotation.y = -1.15;
  g.add(doorR);

  // バケツ（外）
  const bucket = (x, z, withWater) => {
    const b = new THREE.Group();
    b.position.set(x, 0, z);
    b.add(cyl(0.135, 0.11, 0.26, 16, M.galva, 0, 0.13, 0));
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.135, 0.008, 6, 18), M.galva);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.26;
    b.add(rim);
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.006, 6, 18, Math.PI), M.steel);
    handle.position.y = 0.26;
    handle.rotation.x = Math.PI / 2;
    handle.rotation.z = 0.4;
    b.add(handle);
    if (withWater) {
      const w = new THREE.Mesh(new THREE.CircleGeometry(0.128, 18), M.water);
      w.rotation.x = -Math.PI / 2;
      w.position.y = 0.2;
      b.add(w);
    }
    return b;
  };
  g.add(bucket(-0.3, 0.04, true));
  g.add(bucket(0.04, 0.07, false));
  // ぞうきん
  for (let i = 0; i < 3; i++) {
    const rag = box(0.16, 0.012, 0.13, M.rag, -0.29 + i * 0.055, 0.27 + i * 0.013, 0.045);
    rag.rotation.y = (rnd() - 0.5) * 0.7;
    g.add(rag);
  }
  return g;
}

/* ==================================================================
   教卓
   ================================================================== */
function makeTeachersDesk(M, rnd) {
  const g = new THREE.Group();
  const W = 1.4;
  const D = 0.72;
  g.add(box(W, 0.042, D, M.deskWoodLight, 0, 0.715, 0));
  g.add(box(W - 0.06, 0.4, 0.025, M.deskWood, 0, 0.48, -D / 2 + 0.06));
  for (const sx of [-1, 1]) {
    const dr = new THREE.Group();
    dr.position.set(sx * (W / 2 - 0.24), 0, 0);
    dr.add(box(0.44, 0.66, D - 0.08, M.deskWood, 0, 0.34, 0));
    for (let i = 0; i < 3; i++) {
      dr.add(box(0.4, 0.19, 0.02, M.deskWoodLight, 0, 0.13 + i * 0.21, D / 2 - 0.05));
      dr.add(box(0.11, 0.022, 0.022, M.brass, 0, 0.13 + i * 0.21, D / 2 - 0.03));
    }
    g.add(dr);
  }
  g.add(box(0.4, 0.03, 0.5, M.deskWood, 0, 0.12, 0));

  // 出席簿
  const book = new THREE.Group();
  book.position.set(-0.24, 0.736, 0.02);
  book.rotation.y = 0.16;
  book.add(box(0.27, 0.022, 0.2, M.leatherDark, 0, 0.011, 0));
  book.add(box(0.255, 0.018, 0.19, M.paperStack, 0.004, 0.028, 0));
  const cover = rawPlane(0.24, 0.17, labelMaterial('出席簿', { w: 340, h: 240, bg: '#f2ead2', fg: '#4a3a22', font: 'gothic', size: 0.34, border: '#8a6a44' }));
  cover.rotation.x = -Math.PI / 2;
  cover.position.set(0.004, 0.0385, 0);
  book.add(cover);
  g.add(book);

  // 赤ペン・はんこ
  const pen = cyl(0.008, 0.008, 0.14, 8, M.plasticRed, 0.1, 0.745, 0.16);
  pen.rotation.z = Math.PI / 2;
  pen.rotation.y = 0.3;
  g.add(pen);
  g.add(cyl(0.05, 0.05, 0.028, 12, M.plasticRed, 0.28, 0.748, 0.1).rotateX(0));
  g.add(cyl(0.016, 0.016, 0.06, 8, M.trimDark, 0.28, 0.78, 0.1));
  // 印刷物の山
  for (let i = 0; i < 6; i++) {
    const p = box(0.21, 0.004, 0.29, M.paperStack, 0.5 - i * 0.004, 0.738 + i * 0.0045, -0.14);
    p.rotation.y = (rnd() - 0.5) * 0.16;
    g.add(p);
  }
  // 湯のみ
  const cup = new THREE.Group();
  cup.position.set(-0.55, 0.736, 0.18);
  cup.add(cyl(0.036, 0.032, 0.085, 14, M.ceramic, 0, 0.042, 0));
  const tea = new THREE.Mesh(new THREE.CircleGeometry(0.032, 14), new THREE.MeshStandardMaterial({ color: 0x8a5a24, roughness: 0.2 }));
  tea.rotation.x = -Math.PI / 2;
  tea.position.y = 0.076;
  cup.add(tea);
  g.add(cup);
  // チョーク箱
  g.add(box(0.19, 0.045, 0.09, M.cardboard, 0.02, 0.759, -0.24));
  for (let i = 0; i < 4; i++) {
    const ch = cyl(0.01, 0.01, 0.07, 8, i % 2 ? M.chalkWhite : M.chalkYellow, -0.04 + i * 0.028, 0.79, -0.24);
    ch.rotation.z = Math.PI / 2;
    g.add(ch);
  }
  return g;
}

/* ==================================================================
   金魚鉢
   ================================================================== */
function makeGoldfishBowl(M) {
  const g = new THREE.Group();
  const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.125, 22, 16), M.glass);
  bowl.position.y = 0.1;
  bowl.scale.y = 0.86;
  g.add(bowl);
  const water = new THREE.Mesh(
    new THREE.SphereGeometry(0.114, 20, 14, 0, Math.PI * 2, Math.PI * 0.42, Math.PI * 0.58),
    M.water
  );
  water.position.y = 0.1;
  water.scale.y = 0.86;
  g.add(water);
  const surface = new THREE.Mesh(new THREE.CircleGeometry(0.11, 20), M.water);
  surface.rotation.x = -Math.PI / 2;
  surface.position.y = 0.1 + 0.114 * Math.cos(Math.PI * 0.42) * 0.86;
  g.add(surface);
  // 砂利
  const rnd = rng(5);
  for (let i = 0; i < 22; i++) {
    const a = rnd() * Math.PI * 2;
    const r = rnd() * 0.09;
    g.add(m3(new THREE.SphereGeometry(0.008 + rnd() * 0.008, 6, 5), M.soil, Math.cos(a) * r, 0.02 + rnd() * 0.012, Math.sin(a) * r));
  }
  // 水草
  for (let i = 0; i < 3; i++) {
    const a = rnd() * Math.PI * 2;
    const leaf = cyl(0.006, 0.014, 0.1 + rnd() * 0.06, 6, M.leaf, Math.cos(a) * 0.05, 0.07, Math.sin(a) * 0.05);
    leaf.rotation.z = (rnd() - 0.5) * 0.5;
    g.add(leaf);
  }
  // 金魚
  const fish = new THREE.Group();
  fish.position.set(0, 0.09, 0);
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.024, 10, 8), M.goldfish);
  body.scale.set(1.5, 0.9, 0.8);
  fish.add(body);
  const tail = box(0.004, 0.03, 0.028, M.goldfish, -0.038, 0.002, 0);
  tail.rotation.y = 0.3;
  fish.add(tail);
  g.add(fish);
  // 餌の缶
  g.add(cyl(0.028, 0.028, 0.05, 10, M.plasticRed, 0.16, 0.025, 0.02));
  return { group: g, fish };
}

/* ==================================================================
   朝顔の植木鉢
   ================================================================== */
function makePlanter(M, rnd) {
  const g = new THREE.Group();
  g.add(cyl(0.085, 0.065, 0.12, 14, M.terracotta, 0, 0.06, 0));
  g.add(cyl(0.09, 0.09, 0.02, 14, M.terracotta, 0, 0.12, 0));
  const soil = new THREE.Mesh(new THREE.CircleGeometry(0.078, 14), M.soil);
  soil.rotation.x = -Math.PI / 2;
  soil.position.y = 0.125;
  g.add(soil);
  // つると葉
  for (let i = 0; i < 7; i++) {
    const a = rnd() * Math.PI * 2;
    const len = 0.12 + rnd() * 0.2;
    const stem = cyl(0.004, 0.005, len, 5, M.leaf, Math.cos(a) * 0.03, 0.13 + len / 2, Math.sin(a) * 0.03);
    stem.rotation.z = Math.cos(a) * 0.4;
    stem.rotation.x = -Math.sin(a) * 0.4;
    g.add(stem);
    for (let k = 0; k < 3; k++) {
      const t = 0.3 + k * 0.3;
      const lf = new THREE.Mesh(new THREE.SphereGeometry(0.026 + rnd() * 0.014, 7, 5), M.leaf);
      lf.scale.set(1, 0.25, 0.8);
      lf.position.set(Math.cos(a) * (0.03 + t * 0.06), 0.13 + len * t, Math.sin(a) * (0.03 + t * 0.06));
      g.add(lf);
    }
    if (rnd() < 0.6) {
      const fl = new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.03, 8, 1, true), M.flower);
      fl.position.set(Math.cos(a) * 0.06, 0.13 + len * 0.92, Math.sin(a) * 0.06);
      fl.rotation.x = Math.PI * 0.62;
      g.add(fl);
    }
  }
  // 支柱と札
  g.add(cyl(0.005, 0.005, 0.42, 6, M.straw, 0.02, 0.32, -0.02));
  const tag = rawPlane(0.07, 0.035, labelMaterial('あさがお', { w: 320, h: 160, bg: '#f4ecd6', fg: '#5a4a2a', font: 'gothic', size: 0.5, border: null }));
  tag.position.set(-0.05, 0.18, 0.07);
  tag.rotation.y = 0.3;
  g.add(tag);
  return g;
}

/* ==================================================================
   ランドセル
   ================================================================== */
function makeRandoseru(M) {
  const g = new THREE.Group();
  g.add(box(0.24, 0.3, 0.15, M.leather, 0, 0, 0));
  g.add(box(0.25, 0.1, 0.17, M.leatherDark, 0, 0.16, 0.005));
  const flap = box(0.245, 0.02, 0.2, M.leatherDark, 0, 0.13, 0.06);
  flap.rotation.x = -0.42;
  g.add(flap);
  g.add(box(0.04, 0.03, 0.014, M.brass, 0, 0.06, 0.082));
  for (const sx of [-1, 1]) {
    g.add(box(0.03, 0.34, 0.012, M.leatherDark, sx * 0.08, -0.02, -0.082));
  }
  g.add(box(0.2, 0.03, 0.012, M.leatherDark, 0, -0.16, -0.08));
  return g;
}

/* ==================================================================
   牛乳箱と給食
   ================================================================== */
function makeMilkCrate(M, rnd) {
  const g = new THREE.Group();
  g.add(box(0.44, 0.19, 0.34, M.trim, 0, 0.095, 0));
  g.add(box(0.4, 0.02, 0.3, M.darkInside, 0, 0.18, 0));
  for (let i = 0; i < 10; i++) {
    const x = -0.15 + (i % 5) * 0.075;
    const z = -0.08 + Math.floor(i / 5) * 0.16;
    g.add(cyl(0.027, 0.027, 0.135, 10, M.milkBottle, x, 0.25, z));
    g.add(cyl(0.021, 0.021, 0.008, 10, M.milkCap, x, 0.32, z));
  }
  // パンの箱
  const bread = box(0.34, 0.14, 0.26, M.cardboard, 0.5, 0.07, 0.06);
  bread.rotation.y = 0.3;
  g.add(bread);
  for (let i = 0; i < 4; i++) {
    const b = box(0.11, 0.06, 0.1, M.paperStack, 0.42 + (i % 2) * 0.16, 0.17 + Math.floor(i / 2) * 0.065, 0.02 + (i % 2) * 0.09);
    b.rotation.y = rnd() * 0.6;
    g.add(b);
  }
  return g;
}

/* ==================================================================
   掲示板
   ================================================================== */
function makeBulletin(M, rnd) {
  const g = new THREE.Group();
  const W = 2.5;
  const H = 1.1;
  g.add(box(W + 0.06, H + 0.06, 0.03, M.trim, 0, 0, -0.012));
  g.add(box(W, H, 0.03, M.cork, 0, 0, 0));
  const papers = [
    { mat: M.drawing1, w: 0.4, h: 0.31, x: -0.82, y: 0.2, rz: -0.05 },
    { mat: M.drawing2, w: 0.36, h: 0.28, x: -0.34, y: -0.22, rz: 0.07 },
    { mat: M.schedule, w: 0.3, h: 0.38, x: 0.16, y: 0.16, rz: 0.02 },
    { mat: M.slogan, w: 0.32, h: 0.42, x: 0.62, y: -0.2, rz: -0.08 },
    { mat: M.drawing1, w: 0.3, h: 0.23, x: 1.02, y: 0.24, rz: 0.1 },
  ];
  for (const p of papers) {
    const pp = rawPlane(p.w, p.h, p.mat);
    pp.position.set(p.x, p.y, 0.018);
    pp.rotation.z = p.rz;
    g.add(pp);
    // 画びょう
    const pin = new THREE.Mesh(new THREE.SphereGeometry(0.011, 8, 6), rnd() < 0.5 ? M.plasticRed : M.plasticBlue);
    pin.position.set(p.x, p.y + p.h / 2 - 0.02, 0.026);
    g.add(pin);
  }
  // 短冊
  const strip = rawPlane(0.9, 0.14, labelMaterial('なかよく　げんきに', { w: 1100, h: 170, bg: '#f6efd9', fg: '#7a4a2a', font: 'mincho', size: 0.42, border: null }));
  strip.position.set(-0.55, -0.42, 0.02);
  strip.rotation.z = -0.02;
  g.add(strip);
  return g;
}

/* ==================================================================
   ゴミ箱・紙飛行機・その他
   ================================================================== */
function makeTrash(M) {
  const g = new THREE.Group();
  g.add(box(0.3, 0.36, 0.3, M.plasticBlue, 0, 0.18, 0));
  g.add(box(0.32, 0.03, 0.32, M.plasticBlue, 0, 0.37, 0));
  g.add(box(0.26, 0.02, 0.26, M.paperWhite, 0, 0.35, 0));
  const rnd = rng(9);
  for (let i = 0; i < 4; i++) {
    const p = new THREE.Mesh(new THREE.IcosahedronGeometry(0.045 + rnd() * 0.03, 0), M.paperStack);
    p.position.set((rnd() - 0.5) * 0.16, 0.37 + rnd() * 0.05, (rnd() - 0.5) * 0.16);
    p.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
    g.add(p);
  }
  return g;
}

function makePaperPlane(M) {
  const g = new THREE.Group();
  for (const s of [-1, 1]) {
    const wing = box(0.17, 0.003, 0.075, M.paperWhite, 0, 0.004, s * 0.036);
    wing.rotation.x = s * 0.3;
    g.add(wing);
  }
  g.add(box(0.17, 0.022, 0.006, M.paperWhite, 0, 0.012, 0));
  return g;
}

/* ==================================================================
   メイン
   ================================================================== */
export const DESK_COLS = [-2.6, -1.3, 0, 1.3, 2.6];
export const DESK_ROWS = [-2.25, -1.2, -0.15, 0.9, 1.95];

export function buildFurniture(M, colliders) {
  const group = new THREE.Group();
  const hotspots = [];
  const refs = {};
  const rnd = rng(2024);

  /* ---- 机と椅子 ---- */
  const GRAFFITI = { col: 3, row: 4 }; // 落書きの机（うしろから2列目・右から2番目）
  const desks = [];
  let n = 0;
  for (let c = 0; c < DESK_COLS.length; c++) {
    for (let r = 0; r < DESK_ROWS.length; r++) {
      const x = DESK_COLS[c];
      const z = DESK_ROWS[r];
      const d = makeDesk(M, (c * 3 + r * 5) % 4);
      d.position.set(x, 0, z);
      d.rotation.y = (rnd() - 0.5) * 0.05;
      group.add(d);
      desks.push({ obj: d, x, z, c, r });

      const ch = makeChair(M);
      const pull = rnd();
      ch.position.set(x + (rnd() - 0.5) * 0.08, 0, z + 0.36 + pull * 0.1);
      ch.rotation.y = (rnd() - 0.5) * 0.42 + (pull > 0.88 ? 0.8 : 0);
      group.add(ch);

      // 机と椅子はまとめて1箱にする（間の狭い隙間で押し合いが起きないように）
      const chairBack = Math.max(ch.position.z + 0.17, z + 0.5);
      colliders.addBox(x - 0.31, z - 0.23, x + 0.31, chairBack, 'desk');

      // 机の上の忘れもの
      if (rnd() < 0.42) {
        const nb = m3(G.notebook, rnd() < 0.5 ? M.paperStack : M.vinylBlue, x + (rnd() - 0.5) * 0.2, 0.728, z + (rnd() - 0.5) * 0.1);
        nb.rotation.y = rnd() * 3;
        group.add(nb);
      }
      if (rnd() < 0.3) {
        const pc = m3(G.pencil, M.trimDark, x + (rnd() - 0.5) * 0.34, 0.726, z + (rnd() - 0.5) * 0.2);
        pc.rotation.z = Math.PI / 2;
        pc.rotation.y = rnd() * 3;
        group.add(pc);
      }
      if (rnd() < 0.22) {
        const bk = m3(G.book, rnd() < 0.5 ? M.vinyl : M.vinylBlue, x + (rnd() - 0.5) * 0.12, 0.53, z + (rnd() - 0.5) * 0.06);
        bk.rotation.y = rnd() * 3;
        group.add(bk);
      }
      n++;
    }
  }

  // 落書きの机（特別扱い）
  const gDesk = desks.find((d) => d.c === GRAFFITI.col && d.r === GRAFFITI.row);
  gDesk.obj.children[0].material = [M.deskWood, M.deskWood, M.deskTops[0], M.deskWood, M.deskWood, M.deskWood];
  // その机の椅子はたおれている
  const fallen = makeChair(M, true);
  fallen.position.set(gDesk.x + 0.42, 0.162, gDesk.z + 0.6);
  group.add(fallen);

  // ランドセル（フックにかけっぱなし）
  const rando = makeRandoseru(M);
  rando.position.set(DESK_COLS[1] + 0.36, 0.46, DESK_ROWS[2]);
  rando.rotation.set(0.1, -0.3, 0.16);
  group.add(rando);

  // 牛乳びんとパン（ひとつの机の上）
  const milkDesk = desks.find((d) => d.c === 0 && d.r === 1);
  const bottle = new THREE.Group();
  bottle.position.set(milkDesk.x - 0.14, 0.72, milkDesk.z + 0.05);
  bottle.add(cyl(0.028, 0.028, 0.14, 12, M.milkBottle, 0, 0.07, 0));
  bottle.add(cyl(0.021, 0.021, 0.01, 12, M.milkCap, 0, 0.145, 0));
  group.add(bottle);
  const bread = box(0.12, 0.07, 0.11, M.paperStack, milkDesk.x + 0.12, 0.755, milkDesk.z - 0.02);
  bread.rotation.y = 0.4;
  group.add(bread);

  /* ---- 教卓 ---- */
  const tDesk = makeTeachersDesk(M, rnd);
  tDesk.position.set(-2.3, 0, -3.3);
  group.add(tDesk);
  colliders.addBox(-3.04, -3.66, -1.56, -2.94, 'teachers-desk');
  const tChair = makeChair(M);
  tChair.position.set(-2.32, 0, -3.44);
  tChair.rotation.y = Math.PI + 0.18;
  group.add(tChair);

  /* ---- ピアノ ---- */
  const piano = makePiano(M);
  piano.position.set(3.2, 0, -3.55);
  group.add(piano);
  colliders.addBox(2.4, -3.86, 4.02, -2.42, 'piano');

  /* ---- ストーブ ---- */
  const stove = makeStove(M);
  stove.position.set(-4.22, 0, 0.55);
  group.add(stove);
  colliders.addBox(-4.46, 0.3, -3.98, 0.8, 'stove');
  const coalBox = box(0.32, 0.26, 0.3, M.trim, -4.24, 0.13, 1.05);
  coalBox.rotation.y = 0.14;
  group.add(coalBox);
  colliders.addBox(-4.45, 0.88, -4.05, 1.24, 'coalbox');

  /* ---- 本棚 ---- */
  const shelf = makeShelf(M, rnd);
  shelf.group.position.set(-2.9, 0, 3.85);
  group.add(shelf.group);
  colliders.addBox(-4.08, 3.66, -1.72, 4.0, 'shelf');
  refs.globe = shelf.globeBall;

  /* ---- 掃除用具入れ ---- */
  const locker = makeLocker(M, rnd);
  locker.position.set(3.55, 0, 3.84);
  group.add(locker);
  colliders.addBox(2.92, 3.63, 4.18, 4.0, 'locker');
  colliders.addBox(3.74, 3.26, 3.98, 3.98, 'locker-door');

  /* ---- 掲示板（後壁） ---- */
  const bulletin = makeBulletin(M, rnd);
  bulletin.position.set(0.15, 1.98, R.Z1 - 0.03);
  bulletin.rotation.y = Math.PI;
  group.add(bulletin);

  /* ---- 牛乳箱 ---- */
  const milk = makeMilkCrate(M, rnd);
  milk.position.set(1.5, 0, -3.45);
  milk.rotation.y = -0.35;
  group.add(milk);
  colliders.addBox(1.1, -3.72, 2.1, -3.18, 'milk');

  /* ---- ゴミ箱 ---- */
  const trash = makeTrash(M);
  trash.position.set(-4.15, 0, 1.6);
  trash.rotation.y = 0.3;
  group.add(trash);
  colliders.addBox(-4.36, 1.4, -3.94, 1.8, 'trash');

  /* ---- 窓辺の小物 ---- */
  const bowl = makeGoldfishBowl(M);
  bowl.group.position.set(R.X1 - 0.105, 1.0, 0.9);
  group.add(bowl.group);
  refs.goldfish = bowl.fish;

  const planter = makePlanter(M, rnd);
  planter.position.set(R.X1 - 0.105, 1.0, -0.95);
  group.add(planter);

  // 窓辺の本の山
  for (let i = 0; i < 4; i++) {
    const b = box(0.18 - i * 0.01, 0.03, 0.15, i % 2 ? M.vinyl : M.vinylBlue, R.X1 - 0.095, 1.015 + i * 0.031, 2.75);
    b.rotation.y = (rnd() - 0.5) * 0.5;
    group.add(b);
  }

  /* ---- 床の忘れもの ---- */
  const paperPlane = makePaperPlane(M);
  paperPlane.position.set(0.55, 0, 3.05);
  paperPlane.rotation.y = 2.1;
  group.add(paperPlane);

  const eraserFloor = box(0.16, 0.05, 0.06, M.eraser, -0.7, 0.025, 2.9);
  eraserFloor.rotation.y = 0.8;
  group.add(eraserFloor);

  const hat = new THREE.Group();
  hat.position.set(-3.5, 0.034, 2.9);
  hat.add(cyl(0.13, 0.13, 0.1, 16, M.paperWhite, 0, 0.05, 0));
  hat.add(cyl(0.19, 0.19, 0.014, 16, M.paperWhite, 0, 0.008, 0));
  hat.add(cyl(0.131, 0.131, 0.022, 16, M.plasticRed, 0, 0.02, 0));
  hat.rotation.z = 0.16;
  group.add(hat);

  /* ---- ホットスポット ---- */
  hotspots.push(
    {
      id: 'graffiti-desk',
      name: '落書きの机',
      tag: 'きおく',
      title: '落書きの机',
      body:
        'つめたい天板に、彫刻刀で掘ったあと。\n「たけし ＋ みちこ」と、へたな顔。\n何年たっても、消えない種類の字がある。',
      extra: 'となりの椅子は、たおれたまま。',
      meshes: [gDesk.obj, fallen],
      anchor: new THREE.Vector3(gDesk.x, 0.8, gDesk.z),
      reach: 1.9,
    },
    {
      id: 'teachers-desk',
      name: '教卓',
      tag: 'きおく',
      title: '教卓',
      body:
        '出席簿はひらきっぱなしで、赤ペンが転がっている。\n湯のみのお茶は、もう冷たい。\n引き出しには、はんことプリントの山。',
      extra: '出席簿のページは、6月のまま。',
      meshes: [tDesk],
      anchor: new THREE.Vector3(-2.3, 0.85, -3.3),
      reach: 2.0,
    },
    {
      id: 'piano',
      name: 'ピアノ',
      tag: 'うごかす',
      title: 'ピアノ',
      body:
        'ふたの開いたアップライトピアノ。\n鍵盤は少し黄ばんで、中央付近がへこんでいる。\nおすと、ちゃんと音が出る。',
      extra: '※ 音が出ます',
      meshes: [piano],
      anchor: new THREE.Vector3(3.2, 0.95, -3.2),
      reach: 2.2,
      action: 'piano',
    },
    {
      id: 'stove',
      name: 'ストーブ',
      tag: 'きおく',
      title: 'ダルマストーブ',
      body:
        '冬の教室のまんなか。ヤカンが、いつも乗っていた。\n上の板にのせた給食のパンが、いちばんうまく焼ける。\n今は冷たくて、鉄のにおいだけが残っている。',
      extra: '煙突は、まっすぐ天井までのびている。',
      meshes: [stove, coalBox],
      anchor: new THREE.Vector3(-4.22, 0.7, 0.55),
      reach: 2.0,
    },
    {
      id: 'shelf',
      name: '学級文庫',
      tag: 'きおく',
      title: '学級文庫',
      body:
        '図鑑と、背表紙がやけた物語と、だれかの忘れもの。\n地球儀はまだ回せる。ラジオは、もう鳴らない。\n段ボールには「図書」と書いてある。',
      extra: '貸出カードは、昭和の日付で止まっている。',
      meshes: [shelf.group],
      anchor: new THREE.Vector3(-2.9, 1.2, 3.6),
      reach: 2.2,
      action: 'globe',
    },
    {
      id: 'locker',
      name: '掃除用具入れ',
      tag: 'きおく',
      title: '掃除用具入れ',
      body:
        'ほうき、ちりとり、バケツ、ぞうきん。\n扉は片方はずれて、半開きになっている。\n掃除の時間の、水とほこりのにおい。',
      extra: 'バケツの水は、まだ濁っていない。',
      meshes: [locker],
      anchor: new THREE.Vector3(3.55, 1.2, 3.55),
      reach: 2.2,
    },
    {
      id: 'bulletin',
      name: '掲示板',
      tag: 'きおく',
      title: '掲示板',
      body:
        '運動会の絵、海の色をまちがえた絵、時間割のコピー。\n画びょうの穴だけが、たくさん残っている。\n「なかよく　げんきに」',
      extra: '名前は、どれも薄くなっている。',
      meshes: [bulletin],
      anchor: new THREE.Vector3(0.15, 1.98, 3.6),
      reach: 2.4,
    },
    {
      id: 'milk',
      name: '給食',
      tag: 'きおく',
      title: '牛乳箱とパン',
      body:
        'びん牛乳は10本、パンは4つ。\n当番のエプロンは、もう誰も着ていない。\n「いただきます」の声を待つ箱。',
      extra: 'びんのフタは、金色。',
      meshes: [milk],
      anchor: new THREE.Vector3(1.5, 0.4, -3.45),
      reach: 2.0,
    },
    {
      id: 'goldfish',
      name: '金魚鉢',
      tag: 'いきもの',
      title: '金魚鉢',
      body:
        '窓辺の金魚鉢。金魚は、まだおよいでいる。\nえさの缶は空で、水草は少し伸びすぎ。\nだれが世話をしていたんだっけ。',
      extra: '水の当番は、今日も来ない。',
      meshes: [bowl.group],
      anchor: new THREE.Vector3(R.X1 - 0.25, 1.15, 0.9),
      reach: 2.0,
    },
    {
      id: 'planter',
      name: '朝顔',
      tag: 'いきもの',
      title: '朝顔の鉢',
      body: '夏に植えた朝顔は、つるが支柱をこえて伸びている。\n花は二つ、さいている。',
      extra: '札には「あさがお」と書いてある。',
      meshes: [planter],
      anchor: new THREE.Vector3(R.X1 - 0.25, 1.2, -0.95),
      reach: 2.0,
    },
    {
      id: 'randoseru',
      name: 'ランドセル',
      tag: 'わすれもの',
      title: '忘れもののランドセル',
      body:
        '机のフックに、かけっぱなしのランドセル。\nふたには brass の金具、側面には名前の紙。\nこれを持って帰った子は、いない。',
      extra: '中には、教科書が全部はいっている。',
      meshes: [rando],
      anchor: new THREE.Vector3(DESK_COLS[1] + 0.36, 0.5, DESK_ROWS[2]),
      reach: 1.9,
    },
    {
      id: 'trash',
      name: 'ゴミ箱',
      tag: 'きおく',
      title: 'ゴミ箱',
      body: 'まるめた紙が、いくつも乗っている。\n中には、何も入っていない。',
      extra: '掃除当番は、ちゃんとやっていたらしい。',
      meshes: [trash],
      anchor: new THREE.Vector3(-4.15, 0.4, 1.6),
      reach: 1.9,
    },
    {
      id: 'paper-plane',
      name: '紙飛行機',
      tag: 'わすれもの',
      title: '紙飛行機',
      body: 'うしろの通路に落ちた紙飛行機。\nよく飛ぶ折りかたで、羽がしっかりしている。\nだれが、どこへ向けて投げたんだろう。',
      extra: '床には、黒板消しも落ちている。',
      meshes: [paperPlane, eraserFloor],
      anchor: new THREE.Vector3(0.55, 0.1, 3.05),
      reach: 1.8,
    }
  );

  refs.desks = desks;
  refs.count = n;
  return { group, hotspots, refs };
}
