/**
 * 教室の躯体 — 床 / 壁 / 窓 / 黒板 / ドア / 廊下 / 照明器具
 *
 * 座標系： x ∈ [-4.5, 4.5]（窓側が +x） / z ∈ [-4, 4]（黒板側が -z） / y ∈ [0, 3]
 */
import * as THREE from 'three';
import { ROOM as R, box, cyl, plane, labelMaterial } from './materials.js';

const rawPlane = (w, h, mat) => new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);

export const SILL_Y = 1.0;
export const HEAD_Y = 2.45;
export const WIN_SPANS = [
  { z0: -3.4, z1: -2.0 },
  { z0: -1.6, z1: -0.2 },
  { z0: 0.2, z1: 1.6 },
  { z0: 2.0, z1: 3.4 },
];
export const DOOR = { z0: 1.85, z1: 2.95, h: 2.02, open: 0.86 };
const CD = 1.15; // 廊下の奥行き

export function buildRoom(M, colliders) {
  const group = new THREE.Group();
  const hotspots = [];
  const refs = {
    lamps: [],
    lampLights: [],
    backdropMesh: null,
    backdropMats: { day: M.backdrop.day, dusk: M.backdrop.dusk, night: M.backdrop.night },
    shaftGroup: new THREE.Group(),
    corridorLight: null,
    corridorWindow: null,
    fan: null,
    clockHands: null,
    windows: [],
    switchGroup: null,
  };
  refs.shaftGroup.renderOrder = 3;
  refs.shaftGroup.name = 'shafts';
  group.add(refs.shaftGroup);

  /* ============ 床・天井 ============ */
  const floor = plane(R.W, R.D, M.floor, 2);
  floor.rotation.x = -Math.PI / 2;
  floor.name = 'floor';
  floor.userData.shell = true;
  group.add(floor);

  const ceiling = plane(R.W, R.D, M.ceiling, 2.4);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = R.H;
  ceiling.userData.shell = true;
  group.add(ceiling);

  /* ============ 壁 ============ */
  const wallAt = (w, h, mat, tile, pos, rotY) => {
    const m = plane(w, h, mat, tile);
    m.position.copy(pos);
    m.rotation.y = rotY;
    m.userData.shell = true; // 視線判定で「壁ごし」を弾くために使う
    group.add(m);
    return m;
  };

  wallAt(R.W, R.H, M.wall, 2.4, new THREE.Vector3(0, R.H / 2, R.Z0), 0);
  wallAt(R.W, R.WAIN_H, M.wainscot, 1.5, new THREE.Vector3(0, R.WAIN_H / 2, R.Z0 + 0.014), 0);
  wallAt(R.W, R.H, M.wall, 2.4, new THREE.Vector3(0, R.H / 2, R.Z1), Math.PI);
  wallAt(R.W, R.WAIN_H, M.wainscot, 1.5, new THREE.Vector3(0, R.WAIN_H / 2, R.Z1 - 0.014), Math.PI);

  // 左壁（廊下側）— ドア開口をあけて3分割
  const leftSegs = [
    { z0: R.Z0, z1: DOOR.z0, y0: 0, y1: R.H },
    { z0: DOOR.z1, z1: R.Z1, y0: 0, y1: R.H },
    { z0: DOOR.z0, z1: DOOR.z1, y0: DOOR.h + 0.42, y1: R.H },
  ];
  for (const s of leftSegs) {
    const w = s.z1 - s.z0;
    const h = s.y1 - s.y0;
    wallAt(w, h, M.wall, 2.4, new THREE.Vector3(R.X0, s.y0 + h / 2, (s.z0 + s.z1) / 2), Math.PI / 2);
    if (s.y0 < R.WAIN_H) {
      const wh = Math.min(R.WAIN_H, s.y1) - s.y0;
      wallAt(
        w,
        wh,
        M.wainscot,
        1.5,
        new THREE.Vector3(R.X0 + 0.014, s.y0 + wh / 2, (s.z0 + s.z1) / 2),
        Math.PI / 2
      );
    }
  }

  // 右壁（窓側）— 腰板 / 窓の間 / 上部
  wallAt(R.D, SILL_Y, M.wainscot, 1.5, new THREE.Vector3(R.X1, SILL_Y / 2, 0), -Math.PI / 2);
  wallAt(R.D, R.H - HEAD_Y, M.wall, 2.4, new THREE.Vector3(R.X1, (R.H + HEAD_Y) / 2, 0), -Math.PI / 2);
  let prev = R.Z0;
  const piers = [];
  for (const s of WIN_SPANS) {
    piers.push([prev, s.z0]);
    prev = s.z1;
  }
  piers.push([prev, R.Z1]);
  for (const [a, b] of piers) {
    const w = b - a;
    if (w <= 0.02) continue;
    wallAt(w, HEAD_Y - SILL_Y, M.wall, 2.4, new THREE.Vector3(R.X1, (HEAD_Y + SILL_Y) / 2, (a + b) / 2), -Math.PI / 2);
  }

  // 幅木
  const skirt = (len, x, z) => group.add(box(len, 0.1, 0.035, M.trimDark, x, 0.05, z));
  skirt(R.W, 0, R.Z0 + 0.02);
  skirt(R.W, 0, R.Z1 - 0.02);
  const skirtZ = (len, x, z) => group.add(box(0.035, 0.1, len, M.trimDark, x, 0.05, z));
  skirtZ(R.D, R.X0 + 0.02, 0);
  skirtZ(R.D, R.X1 - 0.02, 0);

  /* ============ 窓 ============ */
  for (let i = 0; i < WIN_SPANS.length; i++) {
    const s = WIN_SPANS[i];
    const span = s.z1 - s.z0;
    const cz = (s.z0 + s.z1) / 2;
    const g = new THREE.Group();
    g.position.set(R.X1, 0, cz);
    g.rotation.y = -Math.PI / 2; // ローカル +x = 窓の幅方向, +z = 室内
    const H = HEAD_Y - SILL_Y;
    const mid = SILL_Y + H / 2;
    const curtains = [];

    // 窓台（室内へ12cmせり出す）
    g.add(box(span + 0.12, 0.045, 0.42, M.trim, 0, SILL_Y - 0.022, -0.01));
    // 額縁
    g.add(box(span, 0.05, 0.18, M.trim, 0, HEAD_Y + 0.025, -0.09));
    g.add(box(0.05, H, 0.18, M.trim, span / 2 + 0.025, mid, -0.09));
    g.add(box(0.05, H, 0.18, M.trim, -span / 2 - 0.025, mid, -0.09));

    // 引き違い障子（2枚、前後にずれる）
    const fw = M.windowFrame;
    const sash = (xOff, zOff) => {
      const sg = new THREE.Group();
      const w = span / 2 - 0.02;
      const h = H - 0.08;
      sg.position.set(xOff, mid, zOff);
      sg.add(box(w, 0.04, 0.038, fw, 0, h / 2 - 0.02, 0));
      sg.add(box(w, 0.04, 0.038, fw, 0, -h / 2 + 0.02, 0));
      sg.add(box(0.04, h, 0.038, fw, -w / 2 + 0.02, 0, 0));
      sg.add(box(0.04, h, 0.038, fw, w / 2 - 0.02, 0, 0));
      sg.add(box(0.022, h - 0.08, 0.022, fw, 0, 0, 0));
      sg.add(box(w - 0.08, 0.022, 0.022, fw, 0, h * 0.11, 0));
      sg.add(rawPlane(w - 0.05, h - 0.05, M.glass));
      g.add(sg);
      return sg;
    };
    sash(-span / 4, -0.05);
    sash(span / 4, -0.115);
    // クレセント錠
    g.add(box(0.06, 0.1, 0.045, M.steelDark, 0.005, mid + 0.06, -0.02));

    // カーテンレールとカーテン
    const rod = cyl(0.012, 0.012, span + 0.7, 8, M.steel, 0, HEAD_Y + 0.19, 0.14);
    rod.rotation.z = Math.PI / 2;
    g.add(rod);
    for (const side of [-1, 1]) {
      const cg = new THREE.PlaneGeometry(0.7, 2.0, 16, 4);
      const pos = cg.attributes.position;
      for (let v = 0; v < pos.count; v++) {
        const x = pos.getX(v);
        pos.setZ(v, Math.sin(x * 16) * 0.05 + Math.cos(x * 8) * 0.022);
      }
      cg.computeVertexNormals();
      const curtain = new THREE.Mesh(cg, M.curtain);
      curtain.position.set(side * (span / 2 - 0.05), HEAD_Y - 0.81, 0.16);
      curtain.rotation.z = side * -0.01;
      g.add(curtain);
      curtains.push(curtain);
      // カーテンフック
      for (let k = 0; k < 3; k++) {
        g.add(box(0.012, 0.05, 0.012, M.plasticWhite, side * (span / 2 - 0.28 + k * 0.18), HEAD_Y + 0.14, 0.15));
      }
    }

    group.add(g);
    refs.windows.push({ group: g, cz, span, index: i, curtains });
  }

  /* ============ 外の景色 ============ */
  const bd = rawPlane(48, 28, M.backdrop.day);
  bd.name = 'backdrop';
  bd.rotation.y = -Math.PI / 2;
  bd.position.set(R.X1 + 17, 5.5, 0);
  group.add(bd);
  refs.backdropMesh = bd;

  const outside = plane(120, 120, M.groundOutside, 30);
  outside.name = 'outside';
  outside.rotation.x = -Math.PI / 2;
  outside.position.set(R.X1 + 24, -3.75, 0);
  group.add(outside);

  /* ============ 黒板 ============ */
  const board = new THREE.Group();
  board.position.set(0, 0, R.Z0 + 0.03);
  const BW = 5.2;
  const BH = 1.42;
  const BY = 1.58;
  board.add(box(BW, BH, 0.05, M.boardFrame, 0, BY, 0));
  const surface = rawPlane(BW - 0.16, BH - 0.16, M.chalkboard);
  surface.position.set(0, BY, 0.029);
  surface.name = 'blackboard';
  board.add(surface);
  board.add(box(BW, 0.05, 0.075, M.boardFrame, 0, BY + BH / 2 - 0.02, 0.014));
  board.add(box(BW, 0.05, 0.075, M.boardFrame, 0, BY - BH / 2 + 0.02, 0.014));
  board.add(box(0.05, BH, 0.075, M.boardFrame, -BW / 2 + 0.02, BY, 0.014));
  board.add(box(0.05, BH, 0.075, M.boardFrame, BW / 2 - 0.02, BY, 0.014));
  // チョーク受け
  const tray = box(BW + 0.06, 0.05, 0.17, M.boardFrame, 0, BY - BH / 2 - 0.055, 0.075);
  board.add(tray);
  board.add(box(BW + 0.06, 0.04, 0.02, M.boardFrame, 0, BY - BH / 2 - 0.02, 0.155));
  const trayY = BY - BH / 2 - 0.02;
  // チョーク
  const chalks = [
    { x: -1.5, m: M.chalkWhite, len: 0.075, rz: 0.05 },
    { x: -1.37, m: M.chalkYellow, len: 0.05, rz: -0.3 },
    { x: -1.26, m: M.chalkRed, len: 0.068, rz: 0.12 },
    { x: 1.66, m: M.chalkWhite, len: 0.032, rz: 0.5 },
    { x: 1.55, m: M.chalkWhite, len: 0.055, rz: -0.1 },
  ];
  for (const c of chalks) {
    const ch = cyl(0.011, 0.011, c.len, 10, c.m, c.x, trayY + 0.011, 0.07);
    ch.rotation.z = Math.PI / 2;
    ch.rotation.y = c.rz;
    board.add(ch);
  }
  // 黒板消し
  const eraser = new THREE.Group();
  eraser.position.set(0.92, trayY, 0.06);
  eraser.rotation.y = 0.32;
  eraser.add(box(0.17, 0.038, 0.062, M.eraser, 0, 0.02, 0));
  eraser.add(box(0.17, 0.024, 0.068, M.eraserFelt, 0, -0.008, 0));
  board.add(eraser);
  // チョーク箱
  const chalkBox = box(0.22, 0.05, 0.1, M.deskWood, -1.95, trayY + 0.005, 0.06);
  board.add(chalkBox);
  group.add(board);

  /* ============ 札・ポスター ============ */
  const plate = (text, w, h, pos, rotY = 0, opts = {}) => {
    const g = new THREE.Group();
    g.position.copy(pos);
    g.rotation.y = rotY;
    g.add(box(w + 0.035, h + 0.035, 0.02, M.trimDark, 0, 0, 0));
    const face = rawPlane(w, h, labelMaterial(text, opts));
    face.position.z = 0.012;
    g.add(face);
    group.add(g);
    return g;
  };
  plate('五年二組', 0.66, 0.2, new THREE.Vector3(-3.5, 2.44, R.Z0 + 0.028), 0, {
    bg: '#f3ecd6',
    fg: '#2f2a1c',
  });
  plate('そうじ用具', 0.36, 0.12, new THREE.Vector3(3.55, 2.06, R.Z1 - 0.028), Math.PI, {
    bg: '#e9e0c6',
    fg: '#4a3a22',
    font: 'gothic',
    size: 0.44,
  });
  plate('五年二組', 0.3, 0.11, new THREE.Vector3(R.X0 + 0.028, 1.55, DOOR.z1 + 0.24), Math.PI / 2, {
    w: 340, h: 125,
    bg: '#ddd2b4',
    fg: '#3b3222',
    font: 'gothic',
    size: 0.36,
  });

  const poster = (mat, w, h, pos, rotY, rz = 0) => {
    const p = rawPlane(w, h, mat);
    p.position.copy(pos);
    p.rotation.y = rotY;
    p.rotation.z = rz;
    group.add(p);
    return p;
  };
  const sched = poster(M.schedule, 0.56, 0.72, new THREE.Vector3(3.45, 1.74, R.Z0 + 0.024), 0, -0.012);
  sched.name = 'schedule';
  poster(M.slogan, 0.46, 0.62, new THREE.Vector3(-3.5, 1.74, R.Z0 + 0.024), 0, 0.02);
  poster(M.slogan2, 0.46, 0.62, new THREE.Vector3(4.05, 1.74, R.Z0 + 0.024), 0, -0.025);
  poster(M.drawing1, 0.5, 0.39, new THREE.Vector3(R.X0 + 0.024, 1.78, -1.2), Math.PI / 2, 0.03);
  poster(M.drawing2, 0.44, 0.34, new THREE.Vector3(R.X0 + 0.024, 1.72, -0.5), Math.PI / 2, -0.05);

  /* ============ 時計（黒板の上・4時32分で止まっている） ============ */
  const clock = new THREE.Group();
  clock.position.set(0, 2.6, R.Z0 + 0.05);
  const cbody = cyl(0.185, 0.185, 0.055, 28, M.plasticWhite, 0, 0, 0);
  cbody.rotation.x = Math.PI / 2;
  clock.add(cbody);
  const cback = cyl(0.19, 0.19, 0.022, 28, M.trimDark, 0, 0, -0.03);
  cback.rotation.x = Math.PI / 2;
  clock.add(cback);
  const cface = new THREE.Mesh(new THREE.CircleGeometry(0.168, 36), M.clockFace);
  cface.position.z = 0.029;
  clock.add(cface);
  const cglass = new THREE.Mesh(new THREE.CircleGeometry(0.174, 36), M.glass);
  cglass.position.z = 0.037;
  clock.add(cglass);
  const hourPivot = new THREE.Group();
  const minPivot = new THREE.Group();
  hourPivot.add(box(0.019, 0.105, 0.006, M.clockHand, 0, 0.047, 0));
  minPivot.add(box(0.013, 0.152, 0.006, M.clockHand, 0, 0.07, 0.005));
  const hands = new THREE.Group();
  hands.position.z = 0.032;
  hands.add(hourPivot, minPivot);
  const pin = cyl(0.013, 0.013, 0.016, 10, M.clockHand, 0, 0, 0.004);
  pin.rotation.x = Math.PI / 2;
  hands.add(pin);
  clock.add(hands);
  group.add(clock);
  const minute = 32 / 60;
  minPivot.rotation.z = -minute * Math.PI * 2;
  hourPivot.rotation.z = -((4 + minute) / 12) * Math.PI * 2;
  refs.clockHands = { hourPivot, minPivot, clock };

  /* ============ 蛍光灯 ============ */
  const lampPos = [
    [-2.15, -1.75],
    [2.15, -1.75],
    [-2.15, 1.75],
    [2.15, 1.75],
  ];
  for (const [lx, lz] of lampPos) {
    const g = new THREE.Group();
    g.position.set(lx, R.H - 0.1, lz);
    g.add(box(1.34, 0.1, 0.28, M.lampHousing, 0, 0.05, 0));
    for (const dz of [-0.065, 0.065]) {
      const tube = cyl(0.026, 0.026, 1.22, 10, M.lampOn, 0, -0.014, dz);
      tube.rotation.z = Math.PI / 2;
      g.add(tube);
    }
    group.add(g);
    const pl = new THREE.PointLight(0xffeecb, 0, 8, 2);
    pl.position.set(lx, R.H - 0.26, lz);
    group.add(pl);
    refs.lampLights.push(pl);
  }
  refs.lamps.push(M.lampOn);

  /* ============ 扇風機（左壁） ============ */
  const fan = new THREE.Group();
  fan.position.set(R.X0 + 0.1, 2.18, -2.45);
  fan.add(box(0.14, 0.12, 0.12, M.steelDark, -0.03, -0.16, 0));
  fan.add(box(0.07, 0.3, 0.07, M.steelDark, 0.04, -0.03, 0));
  const motor = cyl(0.078, 0.088, 0.17, 16, M.plasticWhite, 0.13, 0.04, 0);
  motor.rotation.z = Math.PI / 2;
  fan.add(motor);
  fan.add(box(0.05, 0.06, 0.09, M.steelDark, 0.06, -0.02, 0));
  const blades = new THREE.Group();
  blades.position.set(0.21, 0.04, 0);
  for (let i = 0; i < 4; i++) {
    const holder = new THREE.Group();
    holder.rotation.x = (i / 4) * Math.PI * 2;
    const b = box(0.014, 0.17, 0.08, M.plasticWhite, 0, 0.095, 0);
    b.rotation.y = 0.55;
    holder.add(b);
    blades.add(holder);
  }
  const hub = cyl(0.032, 0.032, 0.05, 12, M.steel, 0, 0, 0);
  hub.rotation.z = Math.PI / 2;
  blades.add(hub);
  fan.add(blades);
  const guard = new THREE.Group();
  guard.position.set(0.27, 0.04, 0);
  for (const rr of [0.07, 0.13, 0.19, 0.225]) {
    const t = new THREE.Mesh(new THREE.TorusGeometry(rr, 0.0045, 6, 28), M.steel);
    t.rotation.y = Math.PI / 2;
    guard.add(t);
  }
  for (let i = 0; i < 10; i++) {
    const holder = new THREE.Group();
    holder.rotation.x = (i / 10) * Math.PI * 2;
    holder.add(cyl(0.004, 0.004, 0.225, 5, M.steel, 0, 0.112, 0));
    guard.add(holder);
  }
  const cap = cyl(0.026, 0.026, 0.04, 10, M.steelDark, 0.01, 0, 0);
  cap.rotation.z = Math.PI / 2;
  guard.add(cap);
  fan.add(guard);
  group.add(fan);
  refs.fan = { blades, on: false, speed: 0 };

  /* ============ スイッチ（ドア横） ============ */
  const sw = new THREE.Group();
  sw.position.set(R.X0 + 0.02, 1.2, DOOR.z0 - 0.4);
  sw.rotation.y = Math.PI / 2;
  sw.add(box(0.13, 0.19, 0.016, M.plasticWhite, 0, 0, 0));
  sw.add(box(0.085, 0.05, 0.016, M.plasticWhite, 0, 0.042, 0.01));
  sw.add(box(0.085, 0.05, 0.016, M.plasticWhite, 0, -0.042, 0.01));
  group.add(sw);
  refs.switchGroup = sw;

  /* ============ ドアと廊下 ============ */
  const dz = (DOOR.z0 + DOOR.z1) / 2;
  const dw = DOOR.z1 - DOOR.z0;
  group.add(box(0.2, DOOR.h + 0.46, 0.065, M.trim, R.X0 - 0.09, (DOOR.h + 0.46) / 2, DOOR.z0 - 0.033));
  group.add(box(0.2, DOOR.h + 0.46, 0.065, M.trim, R.X0 - 0.09, (DOOR.h + 0.46) / 2, DOOR.z1 + 0.033));

  // 欄間
  const transom = rawPlane(dw - 0.08, 0.32, M.glassFrosted);
  transom.rotation.y = Math.PI / 2;
  transom.position.set(R.X0 - 0.09, DOOR.h + 0.24, dz);
  group.add(transom);
  group.add(box(0.19, 0.05, dw + 0.02, M.trim, R.X0 - 0.09, DOOR.h + 0.055, dz));
  group.add(box(0.19, 0.05, dw + 0.02, M.trim, R.X0 - 0.09, DOOR.h + 0.43, dz));
  for (let i = 1; i < 4; i++) {
    group.add(box(0.06, 0.32, 0.024, M.trim, R.X0 - 0.09, DOOR.h + 0.24, DOOR.z0 + (dw / 4) * i));
  }

  // 引き戸
  const doorG = new THREE.Group();
  const doorCz = dz - DOOR.open;
  doorG.position.set(R.X0 + 0.06, 0, doorCz);
  const dwt = 0.036;
  const dwid = dw - 0.02;
  doorG.add(box(dwt, 1.36, dwid, M.trim, 0, 0.68, 0));
  doorG.add(box(dwt, 0.24, dwid, M.trim, 0, DOOR.h - 0.12, 0));
  doorG.add(box(dwt, 0.44, 0.09, M.trim, 0, 1.58, -dwid / 2 + 0.045));
  doorG.add(box(dwt, 0.44, 0.09, M.trim, 0, 1.58, dwid / 2 - 0.045));
  const dGlass = rawPlane(dwid - 0.2, 0.38, M.glassFrosted);
  dGlass.rotation.y = Math.PI / 2;
  dGlass.position.set(dwt / 2 + 0.003, 1.58, 0);
  doorG.add(dGlass);
  const dGlass2 = dGlass.clone();
  dGlass2.position.x = -dwt / 2 - 0.003;
  dGlass2.rotation.y = -Math.PI / 2;
  doorG.add(dGlass2);
  doorG.add(box(0.028, 0.22, 0.036, M.steel, 0.034, 1.06, -dwid / 2 + 0.15));
  doorG.add(box(0.02, 0.17, 0.022, M.steelDark, -0.034, 1.06, -dwid / 2 + 0.15));
  group.add(doorG);
  group.add(box(0.11, 0.035, dw + 1.7, M.trimDark, R.X0 + 0.06, DOOR.h + 0.03, dz - 0.75));
  group.add(box(0.13, 0.02, dw + 1.7, M.trimDark, R.X0 + 0.06, 0.012, dz - 0.75));

  // 廊下のへこみ
  const corr = new THREE.Group();
  const corrMat = new THREE.MeshStandardMaterial({ color: 0xa89e86, roughness: 0.95 });
  const corrWain = new THREE.MeshStandardMaterial({ color: 0x5b6a50, roughness: 0.72 });
  const cFloor = plane(CD, dw, M.floor, 2);
  cFloor.rotation.x = -Math.PI / 2;
  cFloor.position.set(R.X0 - CD / 2, 0.004, dz);
  corr.add(cFloor);
  const cCeil = plane(CD, dw, M.ceiling, 2);
  cCeil.rotation.x = Math.PI / 2;
  cCeil.position.set(R.X0 - CD / 2, 2.4, dz);
  corr.add(cCeil);
  const cBack = plane(dw, 2.4, corrMat, 2);
  cBack.rotation.y = Math.PI / 2;
  cBack.position.set(R.X0 - CD, 1.2, dz);
  corr.add(cBack);
  const cBackW = plane(dw, 1.0, corrWain, 1.5);
  cBackW.rotation.y = Math.PI / 2;
  cBackW.position.set(R.X0 - CD + 0.006, 0.5, dz);
  corr.add(cBackW);
  for (const s of [-1, 1]) {
    const side = plane(CD, 2.4, corrMat, 2);
    side.rotation.y = s > 0 ? Math.PI : 0;
    side.position.set(R.X0 - CD / 2, 1.2, dz + s * (dw / 2));
    corr.add(side);
    const sideW = plane(CD, 1.0, corrWain, 1.5);
    sideW.rotation.y = s > 0 ? Math.PI : 0;
    sideW.position.set(R.X0 - CD / 2, 0.5, dz + s * (dw / 2 - 0.006));
    corr.add(sideW);
  }
  // 突き当たりの窓（外光）
  const cw = rawPlane(0.7, 0.9, new THREE.MeshBasicMaterial({ color: 0xd3e2e8 }));
  cw.rotation.y = Math.PI / 2;
  cw.position.set(R.X0 - CD + 0.012, 1.45, dz - 0.1);
  corr.add(cw);
  refs.corridorWindow = cw;
  corr.add(box(0.035, 0.94, 0.035, M.trimDark, R.X0 - CD + 0.02, 1.45, dz - 0.1 - 0.36));
  corr.add(box(0.035, 0.94, 0.035, M.trimDark, R.X0 - CD + 0.02, 1.45, dz - 0.1 + 0.36));
  corr.add(box(0.035, 0.035, 0.75, M.trimDark, R.X0 - CD + 0.02, 1.92, dz - 0.1));
  corr.add(box(0.035, 0.035, 0.75, M.trimDark, R.X0 - CD + 0.02, 0.98, dz - 0.1));
  // 下足箱
  const shoe = box(0.34, 1.15, dw - 0.34, M.trim, R.X0 - CD + 0.18, 0.575, dz + 0.05);
  corr.add(shoe);
  for (let i = 0; i < 3; i++) {
    corr.add(box(0.33, 0.02, dw - 0.36, M.trimDark, R.X0 - CD + 0.18, 0.3 + i * 0.3, dz + 0.05));
  }
  const cl = new THREE.PointLight(0xffe3b4, 0.6, 5, 2);
  cl.position.set(R.X0 - 0.45, 2.0, dz);
  corr.add(cl);
  refs.corridorLight = cl;
  group.add(corr);

  /* ============ コライダー ============ */
  colliders.addBox(R.X0, R.Z0 - 0.12, R.X1, R.Z0, 'front-wall');
  colliders.addBox(-2.63, R.Z0 + 0.02, 2.63, R.Z0 + 0.22, 'board-tray');
  colliders.addBox(R.X0, R.Z1, R.X1, R.Z1 + 0.12, 'back-wall');
  colliders.addBox(R.X1, R.Z0, R.X1 + 0.12, R.Z1, 'window-wall');
  colliders.addBox(R.X0 - 0.12, R.Z0, R.X0, DOOR.z0 - 0.03, 'left-wall-a');
  colliders.addBox(R.X0 - 0.12, DOOR.z1 + 0.03, R.X0, R.Z1, 'left-wall-b');
  colliders.addBox(R.X0 + 0.02, doorCz - dwid / 2, R.X0 + 0.12, doorCz + dwid / 2, 'door');
  colliders.addBox(R.X0 - CD - 0.12, DOOR.z0 - 0.03, R.X0, DOOR.z0 - 0.02, 'corr-a');
  colliders.addBox(R.X0 - CD - 0.12, DOOR.z1 + 0.02, R.X0, DOOR.z1 + 0.03, 'corr-b');
  colliders.addBox(R.X0 - CD - 0.12, DOOR.z0 - 0.03, R.X0 - CD, DOOR.z1 + 0.03, 'corr-end');
  colliders.addBox(R.X0 - CD + 0.01, dz + 0.05 - (dw - 0.34) / 2, R.X0 - CD + 0.35, dz + 0.05 + (dw - 0.34) / 2, 'shoecase');

  /* ============ ホットスポット ============ */
  hotspots.push(
    {
      id: 'blackboard',
      name: '黒板',
      tag: 'きおく',
      title: '黒板',
      body:
        'わり算の途中と、日直の字。\n右下角には、消しかけの落書きがうっすら残っている。\nチョークの粉のにおいが、まだする気がする。',
      extra: '「１４４ ÷ １２ ＝ １２」…あってる。',
      meshes: [surface, tray, eraser, chalkBox],
      anchor: new THREE.Vector3(0, 1.7, R.Z0 + 0.4),
      reach: 3.0,
    },
    {
      id: 'clock',
      name: '時計',
      tag: 'きおく',
      title: '時計',
      body: '針は 4時32分 で止まっている。\n秒針は、もうずいぶん動いていない。',
      extra: 'ちょうど、帰り会の時間だ。',
      meshes: [clock],
      anchor: new THREE.Vector3(0, 2.6, R.Z0 + 0.45),
      reach: 3.6,
    },
    {
      id: 'schedule',
      name: '時間割',
      tag: 'きおく',
      title: '時間割',
      body: '端がまるくなった時間割表。\n金曜の5時間目が「学活」なのが、ちょっとうれしい。',
      extra: '体育の日に限って、忘れものをする。',
      meshes: [sched],
      anchor: new THREE.Vector3(3.45, 1.74, R.Z0 + 0.45),
      reach: 2.4,
    },
    {
      id: 'fan',
      name: '扇風機',
      tag: 'うごかす',
      title: '壁の扇風機',
      body:
        '首ふりは壊れて、ずっと同じ方向を向いたまま。\nひねると、ぶうん、と唸って回りだす。',
      extra: 'もう一度おすと、止まる。',
      meshes: [fan],
      anchor: new THREE.Vector3(R.X0 + 0.45, 2.18, -2.45),
      reach: 2.8,
      action: 'fan',
    },
    {
      id: 'window',
      name: '窓',
      tag: 'そと',
      title: '窓',
      body:
        'アルミサッシの引き違い窓。\nガラスは少しゆがんで、校庭がゆらゆら見える。\n夏はここから、セミの声がいっぺんに入ってくる。',
      extra: '窓際は、夏は暑くて冬は寒い特等席。',
      meshes: refs.windows.map((w) => w.group),
      anchor: new THREE.Vector3(R.X1 - 0.6, 1.6, 0.9),
      reach: 2.6,
    },
    {
      id: 'door',
      name: '廊下のドア',
      tag: 'きおく',
      title: '引き戸',
      body:
        '半分あいたままの引き戸。\n廊下はうす暗くて、どこにも続いていない。\n誰かが走ってくる足音が、聞こえそうなだけ。',
      extra: '閉める人は、もういない。',
      meshes: [doorG],
      anchor: new THREE.Vector3(R.X0 + 0.4, 1.2, doorCz + 0.7),
      reach: 2.4,
    },
    {
      id: 'corridor',
      name: '廊下',
      tag: 'きおく',
      title: '廊下のつきあたり',
      body:
        '下足箱と、小さな窓。\n窓の向こうは白っぽくて、よく見えない。\nぞうきんのにおいがする。',
      extra: 'ここから先には、行けない。',
      meshes: [corr],
      anchor: new THREE.Vector3(R.X0 - 0.6, 1.4, dz),
      reach: 2.6,
    }
  );

  return { group, hotspots, refs };
}

/* ==================================================================
   光の柱（窓から差し込む太陽 / 月）
   ================================================================== */
export function buildLightShafts(windows, dir, intensity, colorHex) {
  const g = new THREE.Group();
  if (intensity <= 0.002 || dir.y >= -0.03) return g;
  const floorY = 0.05;
  const color = new THREE.Color(colorHex);

  for (const w of windows) {
    const hw = w.span / 2 - 0.05;
    const y0 = SILL_Y + 0.06;
    const y1 = HEAD_Y - 0.06;
    const x0 = R.X1 - 0.14;
    const corners = [
      [x0, y0, w.cz - hw],
      [x0, y0, w.cz + hw],
      [x0, y1, w.cz + hw],
      [x0, y1, w.cz - hw],
    ];
    const ends = corners.map(([x, y, z]) => {
      let t = (floorY - y) / dir.y;
      if (dir.x < 0) t = Math.min(t, (R.X0 + 0.2 - x) / dir.x);
      if (dir.z > 0) t = Math.min(t, (R.Z1 - 0.25 - z) / dir.z);
      else if (dir.z < 0) t = Math.min(t, (R.Z0 + 0.25 - z) / dir.z);
      t = Math.max(0, t);
      return [x + dir.x * t, y + dir.y * t, z + dir.z * t];
    });

    const verts = [];
    const colors = [];
    const aNear = 0.15 * intensity;
    const aFar = 0.055 * intensity;
    const push = (p, a) => {
      verts.push(p[0], p[1], p[2]);
      colors.push(color.r, color.g, color.b, a);
    };
    const quad = (a, b, c, d, aa, ab) => {
      push(a, aa);
      push(b, aa);
      push(c, ab);
      push(a, aa);
      push(c, ab);
      push(d, ab);
    };
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      quad(corners[i], corners[j], ends[j], ends[i], aNear, aFar);
    }
    quad(ends[0], ends[1], ends[2], ends[3], aFar * 1.6, aFar * 1.6);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        fog: false,
      })
    );
    mesh.renderOrder = 4;
    g.add(mesh);
  }
  return g;
}
