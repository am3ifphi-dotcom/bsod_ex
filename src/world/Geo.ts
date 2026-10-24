import * as THREE from 'three';

/**
 * Geometry helpers. Everything is authored so a material's texture repeat can stay at 1 and the
 * *UVs* carry the world-space scale: surfaces then have identical texture density (no stretching
 * on large walls, no over-tiling on small props).
 */

export interface BoxUVOptions {
  /** texture tiles per metre (0.5 = a texture every 2 m) */
  tiles: number;
  /** optional UV offset so adjacent panels do not line up */
  offset?: [number, number];
}

/** BoxGeometry with UVs derived from face size in metres. */
export function box(w: number, h: number, d: number, opts: BoxUVOptions = { tiles: 1 }): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  scaleBoxUVs(g, w, h, d, opts.tiles, opts.offset);
  return g;
}

export function scaleBoxUVs(
  g: THREE.BufferGeometry, w: number, h: number, d: number,
  tiles: number, offset: [number, number] = [0, 0],
): void {
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  // face order: +x, -x, +y, -y, +z, -z (4 vertices each)
  const spans: [number, number][] = [
    [d, h], [d, h], [w, d], [w, d], [w, h], [w, h],
  ];
  for (let f = 0; f < 6; f++) {
    const [su, sv] = spans[f];
    for (let i = 0; i < 4; i++) {
      const idx = f * 4 + i;
      uv.setXY(idx, uv.getX(idx) * su * tiles + offset[0], uv.getY(idx) * sv * tiles + offset[1]);
    }
  }
  uv.needsUpdate = true;
}

/** A wall panel with world-scaled UVs, optionally with a rectangular hole (window/door). */
export function wallWithHole(
  w: number, h: number, thickness: number,
  hole: { x: number; y: number; width: number; height: number } | null,
  tiles = 0.5,
): THREE.BufferGeometry {
  if (!hole) return box(w, h, thickness, { tiles });
  const parts: THREE.BufferGeometry[] = [];
  const hx0 = hole.x - hole.width / 2;
  const hx1 = hole.x + hole.width / 2;
  const hy0 = hole.y - hole.height / 2;
  const hy1 = hole.y + hole.height / 2;
  const seg = (
    cx: number, cy: number, sw: number, sh: number,
  ) => {
    if (sw <= 0.001 || sh <= 0.001) return;
    const g = box(sw, sh, thickness, { tiles });
    g.translate(cx, cy, 0);
    parts.push(g);
  };
  // left / right pillars, bottom / top spans
  seg((-w / 2 + hx0) / 2, 0, hx0 + w / 2, h);
  seg((hx1 + w / 2) / 2, 0, w / 2 - hx1, h);
  seg(hole.x, (-h / 2 + hy0) / 2, hole.width, hy0 + h / 2);
  seg(hole.x, (hy1 + h / 2) / 2, hole.width, h / 2 - hy1);
  const merged = mergeSimple(parts);
  parts.forEach((p) => p.dispose());
  return merged;
}

export function mergeSimple(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  // Minimal merge (all are BoxGeometry with identical attribute sets).
  let total = 0;
  let indexTotal = 0;
  for (const g of geos) {
    total += g.getAttribute('position').count;
    indexTotal += g.index ? g.index.count : g.getAttribute('position').count;
  }
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);
  const index = new Uint32Array(indexTotal);
  let vo = 0, io = 0;
  for (const g of geos) {
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    const n = g.getAttribute('normal') as THREE.BufferAttribute;
    const t = g.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      pos[(vo + i) * 3] = p.getX(i);
      pos[(vo + i) * 3 + 1] = p.getY(i);
      pos[(vo + i) * 3 + 2] = p.getZ(i);
      nor[(vo + i) * 3] = n.getX(i);
      nor[(vo + i) * 3 + 1] = n.getY(i);
      nor[(vo + i) * 3 + 2] = n.getZ(i);
      uv[(vo + i) * 2] = t.getX(i);
      uv[(vo + i) * 2 + 1] = t.getY(i);
    }
    if (g.index) {
      for (let i = 0; i < g.index.count; i++) index[io + i] = g.index.getX(i) + vo;
      io += g.index.count;
    } else {
      for (let i = 0; i < p.count; i++) index[io + i] = vo + i;
      io += p.count;
    }
    vo += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(index, 1));
  return out;
}

/** Staircase ramp from y0 to y1 along +Z (or +X), including visual steps. */
export function stairs(opts: {
  steps: number;
  width: number;
  run: number;
  rise: number;
  stepsMaterial?: THREE.Material;
}): { group: THREE.Group; rise: number; run: number } {
  const g = new THREE.Group();
  return { group: g, rise: opts.rise, run: opts.run };
}

/** Railing: posts + two horizontal bars along a path. */
export function railing(points: THREE.Vector3[], height = 1.05, material?: THREE.Material): THREE.Group {
  const group = new THREE.Group();
  const mat = material ?? new THREE.MeshStandardMaterial({ color: 0x1a1d22, roughness: 0.5, metalness: 0.8 });
  const barGeo = new THREE.CylinderGeometry(0.026, 0.026, 1, 7, 1, true);
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const dist = a.distanceTo(b);
    if (dist < 0.01) continue;
    for (const h of [height, height * 0.55]) {
      const bar = new THREE.Mesh(barGeo, mat);
      bar.scale.y = dist;
      const mid = a.clone().add(b).multiplyScalar(0.5);
      bar.position.set(mid.x, mid.y + h, mid.z);
      bar.lookAt(b.x, b.y + h, b.z);
      bar.rotateX(Math.PI / 2);
      bar.castShadow = false;
      bar.receiveShadow = true;
      group.add(bar);
    }
  }
  for (const p of points) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, height, 7), mat);
    post.position.set(p.x, p.y + height / 2, p.z);
    post.receiveShadow = true;
    group.add(post);
  }
  return group;
}

/** Simple cable/pipe along a CatmullRom path. */
export function cable(points: THREE.Vector3[], radius = 0.012, material?: THREE.Material, segments = 64): THREE.Mesh {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => p.clone()));
  const geo = new THREE.TubeGeometry(curve, segments, radius, 5, false);
  const mat = material ?? new THREE.MeshStandardMaterial({ color: 0x0b0d10, roughness: 0.7 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  return mesh;
}

/** A picture/poster plane with optional frame. */
export function poster(
  w: number, h: number, map: THREE.Texture,
  frameMaterial?: THREE.Material,
): THREE.Group {
  const g = new THREE.Group();
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshStandardMaterial({ map, roughness: 0.9, metalness: 0 }),
  );
  plane.position.z = 0.004;
  g.add(plane);
  if (frameMaterial) {
    const t = 0.025;
    const frameParts = [
      [0, h / 2 + t / 2, w + t * 2, t],
      [0, -h / 2 - t / 2, w + t * 2, t],
      [-w / 2 - t / 2, 0, t, h],
      [w / 2 + t / 2, 0, t, h],
    ];
    for (const [x, y, fw, fh] of frameParts) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(fw, fh, 0.02), frameMaterial);
      bar.position.set(x, y, 0);
      bar.castShadow = true;
      g.add(bar);
    }
  }
  return g;
}

/** Procedural bookshelf book rows: cheap instanced upright boxes with varied colours. */
export function bookRow(count: number, span: number, height: number, depth: number, seed = 3): THREE.InstancedMesh[] {
  const groups: THREE.InstancedMesh[] = [];
  const palettes = [0x6d1f1f, 0x1f3a5f, 0x2b4a2f, 0x5a4a1c, 0x3c2b4a, 0x7a6a5a];
  let s = seed;
  const rand = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
  palettes.forEach((color, pi) => {
    const mats: THREE.Matrix4[] = [];
    const g = new THREE.BoxGeometry(1, 1, 1);
    const per = Math.ceil(count / palettes.length);
    for (let i = 0; i < per; i++) {
      const w = 0.028 + rand() * 0.03;
      const h = height * (0.72 + rand() * 0.28);
      const m = new THREE.Matrix4();
      const x = -span / 2 + (i + 0.5) * (span / per) + (rand() - 0.5) * 0.02;
      m.compose(
        new THREE.Vector3(x + pi * 0.001, h / 2, (rand() - 0.5) * 0.03),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, (rand() - 0.5) * 0.02)),
        new THREE.Vector3(w, h, depth * (0.75 + rand() * 0.2)),
      );
      mats.push(m);
    }
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
    const inst = new THREE.InstancedMesh(g, mat, mats.length);
    mats.forEach((mm, i) => inst.setMatrixAt(i, mm));
    inst.castShadow = true;
    inst.receiveShadow = true;
    groups.push(inst);
  });
  return groups;
}

/** Dust motes drifting in a light beam. */
export function dustMotes(count: number, bounds: THREE.Vector3, seed = 5): THREE.Points {
  const pos = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  let s = seed;
  const rand = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (rand() - 0.5) * bounds.x;
    pos[i * 3 + 1] = rand() * bounds.y;
    pos[i * 3 + 2] = (rand() - 0.5) * bounds.z;
    sizes[i] = 0.5 + rand();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(0x9fc4ff) }, uOpacity: { value: 0.5 } },
    vertexShader: `
      attribute float aSize;
      uniform float uTime;
      varying float vAlpha;
      void main() {
        vec3 p = position;
        p.x += sin(uTime * 0.13 + position.y * 3.0) * 0.06;
        p.y += sin(uTime * 0.09 + position.x * 2.0) * 0.05;
        p.z += cos(uTime * 0.1 + position.z * 2.5) * 0.05;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = aSize * (28.0 / -mv.z);
        vAlpha = smoothstep(9.0, 1.0, -mv.z) * 0.7;
      }`,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying float vAlpha;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        float a = smoothstep(0.5, 0.0, length(d));
        gl_FragColor = vec4(uColor, a * vAlpha * uOpacity);
      }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  return points;
}

/** Grid of instanced debris shards. */
export function debrisField(opts: {
  count: number;
  radius: number;
  height: number;
  seed?: number;
  material: THREE.Material;
  sizeRange?: [number, number];
}): THREE.InstancedMesh {
  const { count, radius, height, material, seed = 9, sizeRange = [0.2, 2.2] } = opts;
  let s = seed;
  const rand = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mats: THREE.Matrix4[] = [];
  for (let i = 0; i < count; i++) {
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * radius;
    const size = sizeRange[0] + rand() * (sizeRange[1] - sizeRange[0]);
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(Math.cos(a) * r, rand() * height, Math.sin(a) * r),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rand() * 0.6, rand() * Math.PI, rand() * 0.6)),
      new THREE.Vector3(size, size * (0.1 + rand() * 0.5), size * (0.4 + rand() * 1.6)),
    );
    mats.push(m);
  }
  const inst = new THREE.InstancedMesh(geo, material, mats.length);
  mats.forEach((mm, i) => inst.setMatrixAt(i, mm));
  inst.castShadow = true;
  inst.receiveShadow = true;
  return inst;
}
