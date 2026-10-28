import { NodeIO } from '@gltf-transform/core';
import fs from 'fs';
const io = new NodeIO();
const doc = await io.read(process.argv[2]);
const root = doc.getRoot();
const scene = root.getDefaultScene() || root.listScenes()[0];
function bbox(node, out) {
  const mesh = node.getMesh();
  if (mesh) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      if (!pos) continue;
      const min = pos.getMin([]), max = pos.getMax([]);
      // local bbox corners
      for (let i=0;i<8;i++){
        const v = [ (i&1)?max[0]:min[0], (i&2)?max[1]:min[1], (i&4)?max[2]:min[2] ];
        const t = node.getMatrix(); // world matrix
        const x = t[0]*v[0]+t[4]*v[1]+t[8]*v[2]+t[12];
        const y = t[1]*v[0]+t[5]*v[1]+t[9]*v[2]+t[13];
        const z = t[2]*v[0]+t[6]*v[1]+t[10]*v[2]+t[14];
        out.min[0]=Math.min(out.min[0],x); out.min[1]=Math.min(out.min[1],y); out.min[2]=Math.min(out.min[2],z);
        out.max[0]=Math.max(out.max[0],x); out.max[1]=Math.max(out.max[1],y); out.max[2]=Math.max(out.max[2],z);
      }
    }
  }
  for (const c of node.listChildren()) bbox(c, out);
}
const g = {min:[1e9,1e9,1e9],max:[-1e9,-1e9,-1e9]};
for (const n of scene.listChildren()) bbox(n, g);
console.log('SCENE BBOX', g.min.map(v=>v.toFixed(2)), g.max.map(v=>v.toFixed(2)));
const rows=[];
function walk(node, depth){
  const mesh=node.getMesh();
  if (mesh){ const b={min:[1e9,1e9,1e9],max:[-1e9,-1e9,-1e9]}; bbox(node,b); rows.push({name:node.getName(), depth, min:b.min.map(v=>+v.toFixed(2)), max:b.max.map(v=>+v.toFixed(2))}); }
  for (const c of node.listChildren()) walk(c, depth+1);
}
for (const n of scene.listChildren()) walk(n,0);
// top-level only names + bounds
for (const r of rows.filter(r=>r.depth<=2)) console.log(r.name, JSON.stringify(r.min), JSON.stringify(r.max));
