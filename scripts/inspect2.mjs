import { NodeIO } from '@gltf-transform/core';
const io = new NodeIO();
const doc = await io.read(process.argv[2]);
const root = doc.getRoot();
const scene = root.getDefaultScene() || root.listScenes()[0];
const rows=[];
function corners(node){ return 8; }
function nodeBBox(node){
  const b={min:[1e9,1e9,1e9],max:[-1e9,-1e9,-1e9]};
  const t=node.getMatrix();
  const mesh=node.getMesh();
  if(mesh){
    for(const prim of mesh.listPrimitives()){
      const pos=prim.getAttribute('POSITION'); if(!pos) continue;
      const mn=pos.getMin([]), mx=pos.getMax([]);
      for(let i=0;i<8;i++){
        const v=[(i&1)?mx[0]:mn[0],(i&2)?mx[1]:mn[1],(i&4)?mx[2]:mn[2]];
        const x=t[0]*v[0]+t[4]*v[1]+t[8]*v[2]+t[12];
        const y=t[1]*v[0]+t[5]*v[1]+t[9]*v[2]+t[13];
        const z=t[2]*v[0]+t[6]*v[1]+t[10]*v[2]+t[14];
        b.min[0]=Math.min(b.min[0],x); b.min[1]=Math.min(b.min[1],y); b.min[2]=Math.min(b.min[2],z);
        b.max[0]=Math.max(b.max[0],x); b.max[1]=Math.max(b.max[1],y); b.max[2]=Math.max(b.max[2],z);
      }
    }
  }
  return b;
}
function walk(n, parentName){
  const mesh=n.getMesh();
  if(mesh){
    const b=nodeBBox(n);
    const size=[0,1,2].map(i=>b.max[i]-b.min[i]);
    rows.push({name:n.getName(), parent:parentName, min:b.min.map(v=>+v.toFixed(2)), max:b.max.map(v=>+v.toFixed(2)), size:size.map(v=>+v.toFixed(2))});
  }
  for(const c of n.listChildren()) walk(c, n.getName());
}
for(const n of scene.listChildren()) walk(n,n.getName());
rows.sort((a,b)=> (b.size[0]*b.size[1]*b.size[2])-(a.size[0]*a.size[1]*a.size[2]));
for(const r of rows.slice(0,45)) console.log(r.name,'|parent',r.parent,'|min',r.min,'|max',r.max,'|size',r.size);
console.log('--- total meshes', rows.length);
