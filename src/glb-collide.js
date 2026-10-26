/**
 * GLB ジオメトリ解析（three.js 不使用）
 * -------------------------------------------------------------
 * ブラウザでも Node でも動く「目」。.glb のバイナリを直接読んで、
 *  - 実寸の推定（黒板の高さなどを基準に units/m を求める）
 *  - 床面の矩形（歩ける範囲）
 *  - 腰〜胸の高さの実体を 0.1m 格子で占有判定 → AABB へマージ（コライダー）
 *  - 連結成分ごとに机・棚などの塊を切り出し
 *  - マテリアル名のクラスタ（黒板・教卓・ロッカー…の位置）
 * を返す。描画は GLTFLoader に任せ、論理（当たり判定/配置）だけ 여기서作る。
 *
 * 座標系: モデル空間 → 世界空間（メートル）への変換は
 *   world2D(x,z) = ( -z * k + ox,  x * k + oz )   （rotation.y = -90° に相当）
 *   worldY(y)    = y * k
 */

/* ---------- glb バイナリの低水準読み取り ---------- */
const COMP = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

export function parseGLBHeader(buf) {
  const magic = buf.readUInt32LE ? buf.readUInt32LE(0) : new DataView(buf).getUint32(0, true);
  if (magic !== 0x46546c67) throw new Error('glTF バイナリ(.glb)ではありません');
  const rd = (o) => (buf.readUInt32LE ? buf.readUInt32LE(o) : new DataView(buf).getUint32(o, true));
  const jsonLen = rd(12);
  const bytes = buf.subarray ? buf.subarray(20, 20 + jsonLen) : buf.slice(20, 20 + jsonLen);
  const text = typeof Buffer !== 'undefined' && Buffer.isBuffer(bytes)
    ? bytes.toString('utf8')
    : new TextDecoder().decode(bytes);
  const json = JSON.parse(text);
  return { json, binStart: 20 + jsonLen + 8 };
}

function makeAccessor(json, buf, binStart) {
  const bin = buf.subarray ? buf.subarray(binStart) : buf.slice(binStart);
  const base = bin.byteOffset || 0;
  return (i) => {
    const a = json.accessors[i];
    if (!a) return null;
    const bv = json.bufferViews[a.bufferView];
    const Ctor = COMP[a.componentType];
    const off = (bv.byteOffset || 0) + (a.byteOffset || 0);
    return {
      arr: new Ctor(bin.buffer, base + off, a.count * NCOMP[a.type]),
      count: a.count,
      n: NCOMP[a.type],
      min: a.min,
      max: a.max,
      interleaved: !!bv.byteStride,
    };
  };
}

/* ---------- 行列 ---------- */
function quatToMat(q) {
  const [x, y, z, w] = q;
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 0,
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 0,
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y), 0,
    0, 0, 0, 1,
  ];
}
function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++)
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
}
const ID = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function nodeLocal(n) {
  const t = n.translation || [0, 0, 0];
  const s = n.scale || [1, 1, 1];
  const R = n.rotation ? quatToMat(n.rotation) : ID;
  const S = [s[0], 0, 0, 0, 0, s[1], 0, 0, 0, 0, s[2], 0, 0, 0, 0, 1];
  const T = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, t[0], t[1], t[2], 1];
  return mul(T, mul(R, S));
}

/* ---------- 解析本体 ---------- */
/**
 * @param {ArrayBuffer|Buffer} buf
 * @param {{cell?:number, unitsPerMeter?:number}} opts
 */
export function analyzeGLB(buf, opts = {}) {
  const { json, binStart } = parseGLBHeader(buf);
  const acc = makeAccessor(json, buf, binStart);

  // ノードのワールド行列
  const world = new Array(json.nodes.length).fill(null);
  const walk = (i, parent) => {
    world[i] = mul(parent, nodeLocal(json.nodes[i]));
    for (const c of json.nodes[i].children || []) walk(c, world[i]);
  };
  const scene = json.scenes[json.scene ?? 0];
  for (const s of scene.nodes) walk(s, ID);

  // メッシュごとのノード（1メッシュ1ノードを想定）
  const meshNode = new Map();
  json.nodes.forEach((n, i) => {
    if (n.mesh != null && !meshNode.has(n.mesh)) meshNode.set(n.mesh, i);
  });
  const M = (mi) => {
    const ni = meshNode.get(mi);
    return ni != null ? world[ni] : ID;
  };

  /* --- 1) スケールの推定 ---
     黒板（'Board' を含むマテリアル）の上下端、またはドア枠の高さから units/m を求める。 */
  const clusterRaw = new Map();
  for (let mi = 0; mi < json.meshes.length; mi++) {
    for (const p of json.meshes[mi].primitives) {
      const name = (json.materials[p.material ?? 0] || {}).name || `(mat${p.material})`;
      const a = acc(p.attributes.POSITION);
      if (!a || !a.min) continue;
      let e = clusterRaw.get(name);
      if (!e) { e = { tris: 0, lo: [1e9, 1e9, 1e9], hi: [-1e9, -1e9, -1e9] }; clusterRaw.set(name, e); }
      e.tris += (p.indices != null ? json.accessors[p.indices].count : a.count) / 3;
      const m = M(mi);
      for (let cx = 0; cx < 2; cx++)
        for (let cy = 0; cy < 2; cy++)
          for (let cz = 0; cz < 2; cz++) {
            const x = cx ? a.max[0] : a.min[0], y = cy ? a.max[1] : a.min[1], z = cz ? a.max[2] : a.min[2];
            const w = [
              m[0] * x + m[4] * y + m[8] * z + m[12],
              m[1] * x + m[5] * y + m[9] * z + m[13],
              m[2] * x + m[6] * y + m[10] * z + m[14],
            ];
            for (let i = 0; i < 3; i++) {
              e.lo[i] = Math.min(e.lo[i], w[i]);
              e.hi[i] = Math.max(e.hi[i], w[i]);
            }
          }
    }
  }
  const byName = (re) => [...clusterRaw.entries()].filter(([n]) => re.test(n)).map(([, e]) => e);

  let k = opts.unitsPerMeter || 0;
  const reason = [];
  if (!k) {
    // 黒板の書き面（Board upper / Board）は実寸で約 1.1〜1.2m
    const boards = byName(/board/i).filter((e) => e.hi[1] - e.lo[1] > 1 && e.hi[1] - e.lo[1] < 12);
    if (boards.length) {
      const b = boards.sort((a, b2) => (b2.hi[1] - b2.lo[1]) - (a.hi[1] - a.lo[1]))[0];
      k = (b.hi[1] - b.lo[1]) / 1.15;
      reason.push(`board=${(b.hi[1] - b.lo[1]).toFixed(1)}u/1.15m`);
    }
    if (!k) {
      const doors = byName(/door/i);
      if (doors.length) {
        const d = doors[0];
        k = (d.hi[1] - d.lo[1]) / 2.3;
        reason.push(`door=${(d.hi[1] - d.lo[1]).toFixed(1)}u/2.3m`);
      }
    }
    if (!k) k = 3.55;
  }

  /* --- 2) 床の矩形（モデル空間） --- */
  let floorLo = [1e9, 1e9], floorHi = [-1e9, -1e9];
  let floorSurface = 0; // 歩く面の y（モデル単位）→ ワールドの y=0 に合わせる
  {
    const floors = byName(/floor|tile|ground|carpet|mat/i).filter((e) => e.hi[1] - e.lo[1] < 0.6 * k);
    // 一番広くて低いものを床とみなす
    const cand = floors.sort((a, b) => (b.hi[0] - b.lo[0]) * (b.hi[2] - b.lo[2]) - (a.hi[0] - a.lo[0]) * (a.hi[2] - a.lo[2]))[0];
    if (cand) {
      floorLo = [cand.lo[0], cand.lo[2]];
      floorHi = [cand.hi[0], cand.hi[2]];
      floorSurface = cand.hi[1];
    }
  }
  // 床クラスタが取れなければ、y≈0 付近の実体から逆算
  if (floorLo[0] > floorHi[0]) {
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (const [, e] of clusterRaw) {
      if (e.lo[1] < 0.3 * k && e.hi[1] > -0.3 * k) {
        x0 = Math.min(x0, e.lo[0]); x1 = Math.max(x1, e.hi[0]);
        z0 = Math.min(z0, e.lo[2]); z1 = Math.max(z1, e.hi[2]);
      }
    }
    floorLo = [x0, z0]; floorHi = [x1, z1];
  }

  /* --- 3) 占有グリッド（モデル空間・三角形ラスタライズ） --- */
  const cell = (opts.cell ?? 0.1) * k; // モデル単位でのセルサイズ
  const W = Math.max(2, Math.ceil((floorHi[0] - floorLo[0]) / cell) + 1);
  const H = Math.max(2, Math.ceil((floorHi[1] - floorLo[1]) / cell) + 1);
  const obstacle = new Uint8Array(W * H);
  const floorM = new Uint8Array(W * H);
  const yBandLo = 0.32 * k, yBandHi = 1.28 * k;

  const ix = (x) => Math.floor((x - floorLo[0]) / cell);
  const iz = (z) => Math.floor((z - floorLo[1]) / cell);
  const inTri = (px, pz, ax, az, bx, bz, cx, cz) => {
    const d1 = (px - bx) * (az - bz) - (ax - bx) * (pz - bz);
    const d2 = (px - cx) * (bz - az) - (bx - cx) * (pz - az);
    const d3 = (px - ax) * (cz - bz) - (cx - ax) * (pz - bz);
    const neg = d1 < 0 || d2 < 0 || d3 < 0;
    const pos = d1 > 0 || d2 > 0 || d3 > 0;
    return !(neg && pos);
  };

  const v = new Float64Array(9);
  let triTotal = 0;
  for (let mi = 0; mi < json.meshes.length; mi++) {
    for (const p of json.meshes[mi].primitives) {
      const pos = acc(p.attributes.POSITION);
      if (!pos || pos.interleaved) continue;
      const idx = p.indices != null ? acc(p.indices) : null;
      const m = M(mi);
      const nTri = idx ? idx.count / 3 : pos.count / 3;
      triTotal += nTri;
      for (let t = 0; t < nTri; t++) {
        const i0 = idx ? idx.arr[t * 3] : t * 3;
        const i1 = idx ? idx.arr[t * 3 + 1] : t * 3 + 1;
        const i2 = idx ? idx.arr[t * 3 + 2] : t * 3 + 2;
        for (let q = 0; q < 3; q++) {
          const i = [i0, i1, i2][q];
          const x = pos.arr[i * pos.n], y = pos.arr[i * pos.n + 1], z = pos.arr[i * pos.n + 2];
          v[q * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
          v[q * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
          v[q * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
        }
        const yMin = Math.min(v[1], v[4], v[7]);
        const yMax = Math.max(v[1], v[4], v[7]);
        const band = yMin < yBandHi && yMax > yBandLo;
        const isFloor = yMax - yMin < 0.05 * k && yMin < 0.1 * k && yMin > -0.4 * k;
        if (!band && !isFloor) continue;
        const xMin = Math.min(v[0], v[3], v[6]), xMax = Math.max(v[0], v[3], v[6]);
        const zMin = Math.min(v[2], v[5], v[8]), zMax = Math.max(v[2], v[5], v[8]);
        const gx0 = Math.max(0, ix(xMin)), gx1 = Math.min(W - 1, ix(xMax));
        const gz0 = Math.max(0, iz(zMin)), gz1 = Math.min(H - 1, iz(zMax));
        if (gx1 < gx0 || gz1 < gz0) continue;
        for (let gz = gz0; gz <= gz1; gz++)
          for (let gx = gx0; gx <= gx1; gx++) {
            const px = floorLo[0] + (gx + 0.5) * cell;
            const pz = floorLo[1] + (gz + 0.5) * cell;
            if (!inTri(px, pz, v[0], v[2], v[3], v[5], v[6], v[8])) continue;
            const gi = gz * W + gx;
            if (band) obstacle[gi] = 1;
            if (isFloor) floorM[gi] = 1;
          }
      }
    }
  }

  /* --- 4) 連結成分 → 箱 --- */
  const label = new Int32Array(W * H).fill(-1);
  const boxes = [];
  const stack = [];
  let nextId = 0;
  for (let s0 = 0; s0 < W * H; s0++) {
    if (!obstacle[s0] || label[s0] >= 0) continue;
    const id = nextId++;
    label[s0] = id;
    stack.push(s0);
    let cx = 1e9, cx1 = -1e9, cz = 1e9, cz1 = -1e9, n = 0;
    while (stack.length) {
      const cur = stack.pop();
      const gx = cur % W, gz = (cur - gx) / W;
      n++;
      cx = Math.min(cx, gx); cx1 = Math.max(cx1, gx);
      cz = Math.min(cz, gz); cz1 = Math.max(cz1, gz);
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = gx + dx, nz = gz + dz;
          if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue;
          const ni = nz * W + nx;
          if (!obstacle[ni] || label[ni] >= 0) continue;
          label[ni] = id;
          stack.push(ni);
        }
    }
    if (n < 3) continue; // ノイズ
    boxes.push({
      // モデル空間の矩形（メートル換算は呼び出し側で）
      mx0: floorLo[0] + cx * cell, mx1: floorLo[0] + (cx1 + 1) * cell,
      mz0: floorLo[1] + cz * cell, mz1: floorLo[1] + (cz1 + 1) * cell,
      cells: n,
    });
  }

  /* --- 5) クラスタ（マテリアル名）をモデル空間矩形で返す --- */
  const clusters = {};
  for (const [name, e] of clusterRaw) {
    clusters[name] = { tris: Math.round(e.tris), mx0: e.lo[0], mx1: e.hi[0], my0: e.lo[1], my1: e.hi[1], mz0: e.lo[2], mz1: e.hi[2] };
  }

  return {
    json,
    floorY: floorSurface,
    unitsPerMeter: k,
    scaleReason: reason.join(','),
    triangles: triTotal,
    grid: { W, H, cell, floorLo, floorHi, obstacle, floorM },
    floorSurface,
    rawBoxes: boxes,
    clusters,
  };
}

/**
 * モデル空間 → 世界（メートル, 黒板を手前 -Z に向ける -90° 回転）への変換を作る。
 * 部屋の中心が世界原点付近に来るようにずらす。
 */
/**
 * 占有グリッドを矩形にまとめる（当たり判定用）。
 * 連結成分の外接箱だと壁のリングが部屋全体を覆ってしまうので、
 * グリッドの横ラン → 縦拡張で素直に矩形分解する。
 * step>1 でセルを粗くする（1セルでも占有なら占有＝わずかに大きめ＝隙間なし）。
 * @returns {{mx0:number,mx1:number,mz0:number,mz1:number,cells:number}[]} モデル空間の矩形
 */
export function gridRects(a, { step = 1, minCells = 1 } = {}) {
  const { W, H, cell, floorLo, obstacle } = a.grid;
  const CW = Math.ceil(W / step), CH = Math.ceil(H / step);
  const cs = cell * step;
  const occ = new Uint8Array(CW * CH);
  for (let cj = 0; cj < CH; cj++)
    for (let ci = 0; ci < CW; ci++) {
      let hit = 0;
      for (let j = cj * step; j < Math.min(H, (cj + 1) * step) && !hit; j++)
        for (let i = ci * step; i < Math.min(W, (ci + 1) * step); i++)
          if (obstacle[j * W + i]) { hit = 1; break; }
      occ[cj * CW + ci] = hit;
    }
  const used = new Uint8Array(CW * CH);
  const rects = [];
  for (let j = 0; j < CH; j++) {
    let i = 0;
    while (i < CW) {
      if (!occ[j * CW + i] || used[j * CW + i]) { i++; continue; }
      let i1 = i;
      while (i1 + 1 < CW && occ[j * CW + i1 + 1] && !used[j * CW + i1 + 1]) i1++;
      let j1 = j;
      let grow = true;
      while (grow && j1 + 1 < CH) {
        for (let t = i; t <= i1; t++) {
          if (!occ[(j1 + 1) * CW + t] || used[(j1 + 1) * CW + t]) { grow = false; break; }
        }
        if (grow) j1++;
      }
      for (let jj = j; jj <= j1; jj++)
        for (let t = i; t <= i1; t++) used[jj * CW + t] = 1;
      const n = (i1 - i + 1) * (j1 - j + 1);
      if (n >= minCells) {
        rects.push({
          mx0: floorLo[0] + i * cs, mx1: floorLo[0] + (i1 + 1) * cs,
          mz0: floorLo[1] + j * cs, mz1: floorLo[1] + (j1 + 1) * cs,
          cells: n,
        });
      }
      i = i1 + 1;
    }
  }
  return rects;
}

export function makeTransform(a, opts = {}) {
  const k = 1 / a.unitsPerMeter;
  const rot = opts.rotY ?? -Math.PI / 2;
  const c = Math.cos(rot), s = Math.sin(rot);
  // 床矩形の中心（モデル空間）
  const g = a.grid;
  const mcx = (g.floorLo[0] + g.floorHi[0]) / 2;
  const mcz = (g.floorLo[1] + g.floorHi[1]) / 2;
  const off = opts.center ?? [0, 0];
  const p = (mx, mz) => {
    const x = (mx - mcx) * k, z = (mz - mcz) * k;
    return [x * c + z * s + off[0], -x * s + z * c + off[1]];
  };
  const rect = (mx0, mz0, mx1, mz1) => {
    const pts = [p(mx0, mz0), p(mx1, mz0), p(mx0, mz1), p(mx1, mz1)];
    const xs = pts.map((q) => q[0]), zs = pts.map((q) => q[1]);
    return { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
  };
  return { k, rot, p, rect, y: (my) => my * k };
}
