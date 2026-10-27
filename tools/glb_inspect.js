// Minimal GLB inspector: prints scene graph, meshes, materials, animations, dimensions
const fs = require('fs');

function readGLB(path) {
  const buf = fs.readFileSync(path);
  const magic = buf.toString('ascii', 0, 4);
  if (magic !== 'glTF') throw new Error('not glb: ' + path);
  const version = buf.readUInt32LE(4);
  const total = buf.readUInt32LE(8);
  let offset = 12;
  let json = null;
  while (offset < total) {
    const len = buf.readUInt32LE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const data = buf.slice(offset + 8, offset + 8 + len);
    if (type === 'JSON') json = JSON.parse(data.toString('utf8'));
    offset += 8 + len;
  }
  return json;
}

const file = process.argv[2];
const g = readGLB(file);
console.log('FILE:', file);
console.log('generator:', g.asset && g.asset.generator);
console.log('scenes:', (g.scenes || []).length, 'nodes:', (g.nodes || []).length,
  'meshes:', (g.meshes || []).length, 'materials:', (g.materials || []).length,
  'textures:', (g.textures || []).length, 'images:', (g.images || []).length,
  'animations:', (g.animations || []).length);

// image sizes
(g.images || []).forEach((im, i) => {
  console.log('  image', i, im.name || '', im.mimeType, im.bufferView != null ? 'embedded' : im.uri || '');
});

// materials
(g.materials || []).forEach((m, i) => {
  console.log('  mat', i, JSON.stringify(m.name));
});

// animations
(g.animations || []).forEach((a, i) => {
  console.log('  anim', i, a.name, 'channels:', a.channels.length,
    'targets:', a.channels.map(c => `${(g.nodes[c.target.node] || {}).name || c.target.node}.${c.target.path}`).slice(0, 8).join(','));
});

// bounding box from accessor min/max of POSITION
let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
(g.accessors || []).forEach(a => {
  if (a.type === 'VEC3' && a.min && a.max && a.bufferView != null) {
    // heuristic: POSITION accessors usually have no normalized attr; just gather all VEC3 with min/max
    for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], a.min[i]); max[i] = Math.max(max[i], a.max[i]); }
  }
});
console.log('raw bbox min:', min.map(v => v.toFixed(3)).join(', '), 'max:', max.map(v => v.toFixed(3)).join(', '));
console.log('raw size:', max.map((v, i) => (v - min[i]).toFixed(3)).join(' x '));

// scene graph
function printNode(i, depth) {
  const n = g.nodes[i];
  if (!n) return;
  const parts = [];
  parts.push(n.name || '(unnamed)');
  if (n.mesh != null) parts.push('mesh=' + n.mesh + (g.meshes[n.mesh] ? '(' + (g.meshes[n.mesh].name || '') + ')' : ''));
  if (n.translation) parts.push('t=[' + n.translation.map(v => v.toFixed(2)).join(',') + ']');
  if (n.rotation) parts.push('r=[' + n.rotation.map(v => v.toFixed(2)).join(',') + ']');
  if (n.scale) parts.push('s=[' + n.scale.map(v => v.toFixed(2)).join(',') + ']');
  if (n.children) parts.push('children=' + n.children.length);
  console.log('  '.repeat(depth) + '- ' + parts.join(' '));
  (n.children || []).forEach(c => printNode(c, depth + 1));
}
(g.scenes || []).forEach((s, si) => {
  console.log('SCENE', si, s.name || '');
  (s.nodes || []).forEach(n => printNode(n, 1));
});
