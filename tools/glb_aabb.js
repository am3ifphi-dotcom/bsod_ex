// Compute world-space AABBs for every node (POSITION accessor min/max + node TRS chain)
const fs = require('fs');

function readGLB(path) {
  const buf = fs.readFileSync(path);
  const total = buf.readUInt32LE(8);
  let offset = 12, json = null;
  while (offset < total) {
    const len = buf.readUInt32LE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    if (type === 'JSON') json = JSON.parse(buf.slice(offset + 8, offset + 8 + len).toString('utf8'));
    offset += 8 + len;
  }
  return json;
}

// minimal mat4 / vec3 math (column-major like three)
function identity() { return [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]; }
function mul(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    o[c*4+r] = a[r]*b[c*4] + a[4+r]*b[c*4+1] + a[8+r]*b[c*4+2] + a[12+r]*b[c*4+3];
  }
  return o;
}
function trs(t, r, s) {
  let m = identity();
  if (t) { m[12]=t[0]; m[13]=t[1]; m[14]=t[2]; }
  if (r) {
    const [x,y,z,w] = r;
    const x2=x+x,y2=y+y,z2=z+z;
    const xx=x*x2,xy=x*y2,xz=x*z2,yy=y*y2,yz=y*z2,zz=z*z2,wx=w*x2,wy=w*y2,wz=w*z2;
    const rm = [1-(yy+zz),xy+wz,xz-wy,0, xy-wz,1-(xx+zz),yz+wx,0, xz+wy,yz-wx,1-(xx+yy),0, 0,0,0,1];
    m = mul(m, rm);
  }
  if (s) {
    const sm = [s[0],0,0,0, 0,s[1],0,0, 0,0,s[2],0, 0,0,0,1];
    m = mul(m, sm);
  }
  return m;
}
function transformPt(m, p) {
  return [
    m[0]*p[0]+m[4]*p[1]+m[8]*p[2]+m[12],
    m[1]*p[0]+m[5]*p[1]+m[9]*p[2]+m[13],
    m[2]*p[0]+m[6]*p[1]+m[10]*p[2]+m[14],
  ];
}

const g = readGLB(process.argv[2]);
const nodes = g.nodes || [];

// local bbox per mesh (union of primitives' POSITION accessors)
function meshBBox(mi) {
  const mesh = g.meshes[mi];
  let mn = [Infinity,Infinity,Infinity], mx = [-Infinity,-Infinity,-Infinity];
  for (const prim of mesh.primitives) {
    const accIdx = prim.attributes.POSITION;
    const acc = g.accessors[accIdx];
    if (!acc.min) continue;
    for (let i=0;i<3;i++){ mn[i]=Math.min(mn[i],acc.min[i]); mx[i]=Math.max(mx[i],acc.max[i]); }
  }
  return [mn, mx];
}
const meshBoxes = (g.meshes||[]).map((_,i)=>meshBBox(i));

function worldBox(localBox, m) {
  const [mn,mx] = localBox;
  const corners = [
    [mn[0],mn[1],mn[2]],[mx[0],mn[1],mn[2]],[mn[0],mx[1],mn[2]],[mx[0],mx[1],mn[2]],
    [mn[0],mn[1],mx[2]],[mx[0],mn[1],mx[2]],[mn[0],mx[1],mx[2]],[mx[0],mx[1],mx[2]],
  ];
  let wmn=[Infinity,Infinity,Infinity], wmx=[-Infinity,-Infinity,-Infinity];
  for (const c of corners) {
    const w = transformPt(m, c);
    for (let i=0;i<3;i++){ wmn[i]=Math.min(wmn[i],w[i]); wmx[i]=Math.max(wmx[i],w[i]); }
  }
  return [wmn,wmx];
}

function nodeMatrix(n) {
  if (n.matrix) { const m = n.matrix.slice(); return m; }
  return trs(n.translation, n.rotation, n.scale);
}

const results = [];
function walk(idx, parentM) {
  const n = nodes[idx];
  const world = mul(parentM, nodeMatrix(n));
  if (n.mesh != null) {
    const [wmn,wmx] = worldBox(meshBoxes[n.mesh], world);
    results.push({name: n.name || ('node'+idx), mesh: n.mesh, mn: wmn, mx: wmx});
  }
  (n.children||[]).forEach(c => walk(c, world));
}
(g.scenes||[]).forEach(s => (s.nodes||[]).forEach(n => walk(n, identity())));

const f = v => v.toFixed(2).padStart(8);
results.sort((a,b)=>a.mn[1]-b.mn[1]);
for (const r of results) {
  const size = r.mx.map((v,i)=>(v-r.mn[i]).toFixed(2));
  console.log(`${r.name.slice(0,46).padEnd(46)} min(${f(r.mn[0])},${f(r.mn[1])},${f(r.mn[2])}) max(${f(r.mx[0])},${f(r.mx[1])},${f(r.mx[2])}) size(${size.join(',')})`);
}
// whole scene
let gmn=[Infinity,Infinity,Infinity],gmx=[-Infinity,-Infinity,-Infinity];
for (const r of results) for (let i=0;i<3;i++){gmn[i]=Math.min(gmn[i],r.mn[i]);gmx[i]=Math.max(gmx[i],r.mx[i]);}
console.log('SCENE min', gmn.map(v=>v.toFixed(3)), 'max', gmx.map(v=>v.toFixed(3)), 'size', gmx.map((v,i)=>(v-gmn[i]).toFixed(3)));
