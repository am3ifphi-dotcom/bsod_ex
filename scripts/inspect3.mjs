import { NodeIO } from '@gltf-transform/core';
const io = new NodeIO();
const doc = await io.read(process.argv[2]);
const root = doc.getRoot();
const scene = root.getDefaultScene() || root.listScenes()[0];
const rows=[];
function mul(a,b){ // column-major 4x4
  const o=new Array(16).fill(0);
  for(let c=0;c<4;c++)for(let r=0;r<4;r++){let s=0;for(let k=0;k<4;k++)s+=a[k*4+r]*b[c*4+k];o[c*4+r]=s;}
  return o;
}
function walk(n, parentM){
  const M=mul(parentM, n.getMatrix());
  const mesh=n.getMesh();
  if(mesh){
    const b={min:[1e9,1e9,1e9],max:[-1e9,-1e9,-1e9]};
    for(const prim of mesh.listPrimitives()){
      const pos=prim.getAttribute('POSITION'); if(!pos) continue;
      const mn=pos.getMin([]), mx=pos.getMax([]);
      for(let i=0;i<8;i++){
        const v=[(i&1)?mx[0]:mn[0],(i&2)?mx[1]:mn[1],(i&4)?mx[2]:mn[2]];
        const x=M[0]*v[0]+M[4]*v[1]+M[8]*v[2]+M[12];
        const y=M[1]*v[0]+M[5]*v[1]+M[9]*v[2]+M[13];
        const z=M[2]*v[0]+M[6]*v[1]+M[10]*v[2]+M[14];
        b.min[0]=Math.min(b.min[0],x); b.min[1]=Math.min(b.min[1],y); b.min[2]=Math.min(b.min[2],z);
        b.max[0]=Math.max(b.max[0],x); b.max[1]=Math.max(b.max[1],y); b.max[2]=Math.max(b.max[2],z);
      }
    }
    const size=[0,1,2].map(i=>b.max[i]-b.min[i]);
    rows.push({name:n.getName(), min:b.min.map(v=>+v.toFixed(2)), max:b.max.map(v=>+v.toFixed(2)), size:size.map(v=>+v.toFixed(2))});
  }
  for(const c of n.listChildren()) walk(c, M);
}
const I=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
for(const n of scene.listChildren()) walk(n,I);
const g={min:[1e9,1e9,1e9],max:[-1e9,-1e9,-1e9]};
for(const r of rows) for(let i=0;i<3;i++){g.min[i]=Math.min(g.min[i],r.min[i]);g.max[i]=Math.max(g.max[i],r.max[i]);}
console.log('WORLD BBOX', g.min.map(v=>+v.toFixed(2)), g.max.map(v=>+v.toFixed(2)));
rows.sort((a,b)=>(b.size[0]*b.size[1]*b.size[2])-(a.size[0]*a.size[1]*a.size[2]));
for(const r of rows.slice(0,30)) console.log(r.name,'min',r.min,'max',r.max,'size',r.size);
