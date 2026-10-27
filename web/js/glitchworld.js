// glitchworld.js — the world inside the screen: BSOD blue terrain, broken UI,
// the great Cray-1 structure, and the WAKE_UP secret.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

// ---------------------------------------------------------------- noise
function hash2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y) {
  let f = 0, amp = 0.5, fr = 1;
  for (let i = 0; i < 4; i++) { f += amp * vnoise(x * fr, y * fr); amp *= 0.5; fr *= 2.03; }
  return f;
}

export function terrainHeight(x, z) {
  const r = Math.sqrt(x * x + z * z);
  const base = (fbm(x * 0.022 + 7.3, z * 0.022 + 2.1) - 0.5) * 9.0;
  const ridges = (fbm(x * 0.055, z * 0.055) - 0.5) * 2.4;
  // calm plateau near the centre and along the approach from the south
  const flat = THREE.MathUtils.smoothstep(r, 14, 34);
  const approach = Math.max(0, 1 - Math.abs(x) / 10) * THREE.MathUtils.smoothstep(z, 10, 30) * (1 - THREE.MathUtils.smoothstep(z, 30, 60));
  const k = Math.min(1, flat * (1 - approach * 0.85));
  return (base + ridges) * k;
}

// ------------------------------------------------------------- textures
function gridTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const x = c.getContext('2d');
  x.fillStyle = '#0b2c58';
  x.fillRect(0, 0, 512, 512);
  // noisy blue variation
  for (let i = 0; i < 2600; i++) {
    const px = Math.random() * 512, py = Math.random() * 512;
    x.fillStyle = `rgba(${20 + Math.random() * 40},${80 + Math.random() * 80},${170 + Math.random() * 70},0.12)`;
    x.fillRect(px, py, 2 + Math.random() * 22, 2 + Math.random() * 22);
  }
  // grid lines
  x.strokeStyle = 'rgba(120,190,255,0.30)';
  x.lineWidth = 2;
  for (let i = 0; i <= 8; i++) {
    const p = (i / 8) * 512;
    x.beginPath(); x.moveTo(p, 0); x.lineTo(p, 512); x.stroke();
    x.beginPath(); x.moveTo(0, p); x.lineTo(512, p); x.stroke();
  }
  x.strokeStyle = 'rgba(160,215,255,0.55)';
  x.lineWidth = 5;
  x.strokeRect(0, 0, 512, 512);
  return c;
}

function wakeTexture() {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 512;
  const x = c.getContext('2d');
  x.fillStyle = '#03142e';
  x.fillRect(0, 0, 1024, 512);
  const g = x.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, 'rgba(40,110,210,0.42)');
  g.addColorStop(1, 'rgba(10,40,100,0.12)');
  x.fillStyle = g;
  x.fillRect(0, 0, 1024, 512);
  x.font = '300 128px "Segoe UI", "Helvetica Neue", Arial, sans-serif';
  x.textAlign = 'center';
  x.fillStyle = 'rgba(120,190,255,0.35)';
  x.fillText('WAKE_UP', 512 + 9, 300 + 6);
  x.fillStyle = '#eef6ff';
  x.fillText('WAKE_UP', 512, 300);
  x.fillStyle = 'rgba(255,80,120,0.30)';
  x.fillText('WAKE_UP', 512 - 8, 300);
  // frame + scanlines + gibberish
  x.strokeStyle = 'rgba(150,205,255,0.65)';
  x.lineWidth = 6;
  x.strokeRect(28, 28, 968, 456);
  x.fillStyle = 'rgba(0,0,0,0.16)';
  for (let y = 0; y < 512; y += 4) x.fillRect(0, y, 1024, 1.6);
  x.font = '400 26px "Consolas", monospace';
  x.fillStyle = 'rgba(140,195,255,0.5)';
  const hex = '0123456789ABCDEF';
  for (let i = 0; i < 26; i++) {
    let s = '0x';
    for (let k = 0; k < 6; k++) s += hex[(Math.random() * 16) | 0];
    x.fillText(s, 46 + (i % 4) * 240, 72 + ((i / 4) | 0) * 62);
  }
  x.font = '300 34px "Segoe UI", sans-serif';
  x.fillStyle = 'rgba(190,225,255,0.75)';
  x.fillText('SYSTEM ROOT INSTRUCTION', 512, 420);
  return c;
}

function glyphTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const x = c.getContext('2d');
  x.clearRect(0, 0, 512, 512);
  const items = [':(', '0x', 'FF', 'NULL', '::', '##', 'ERR', '7F', '0x00', '???', 'PAGE', 'WAKE'];
  x.font = '300 64px "Consolas", monospace';
  x.fillStyle = '#cfe8ff';
  for (let i = 0; i < 36; i++) {
    x.globalAlpha = 0.35 + Math.random() * 0.65;
    x.fillText(items[(Math.random() * items.length) | 0], (i % 6) * 84 + 8, ((i / 6) | 0) * 84 + 62);
  }
  return c;
}

function beamTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 256;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 256, 0, 0);
  g.addColorStop(0, 'rgba(150,205,255,0.85)');
  g.addColorStop(0.35, 'rgba(90,160,255,0.35)');
  g.addColorStop(1, 'rgba(60,120,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 256);
  return c;
}

export async function buildWorld(onProgress) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x062647);
  scene.fog = new THREE.FogExp2(0x0a3566, 0.011);

  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const loadGLB = (url, idx) => new Promise((res, rej) => {
    loader.load(url, (g) => res(g.scene), (e) => {
      if (onProgress && e.lengthComputable) onProgress(idx, e.loaded / e.total);
    }, rej);
  });

  // ------------------------------------------------------------- sky dome
  const skyGeo = new THREE.SphereGeometry(420, 24, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uTime: { value: 0 } },
    vertexShader: `
      varying vec3 vPos;
      void main() { vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
    `,
    fragmentShader: `
      varying vec3 vPos;
      uniform float uTime;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      void main() {
        float h = normalize(vPos).y;
        vec3 top = vec3(0.008, 0.05, 0.13);
        vec3 horizon = vec3(0.03, 0.24, 0.47);
        vec3 col = mix(horizon, top, smoothstep(-0.05, 0.55, h));
        // slow drifting "data clouds"
        vec2 uv = normalize(vPos).xz * 2.2 + vec2(uTime * 0.008, uTime * 0.004);
        float n = hash(floor(uv * 6.0)) * 0.5 + hash(floor(uv * 13.0)) * 0.5;
        col += vec3(0.02, 0.10, 0.22) * n * smoothstep(0.05, 0.5, h);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  scene.add(sky);

  // -------------------------------------------------------------- lights
  scene.add(new THREE.HemisphereLight(0x6699dd, 0x0a2038, 1.15));
  const key = new THREE.DirectionalLight(0x9dc4ff, 1.5);
  key.position.set(30, 60, 10);
  scene.add(key);
  const core = new THREE.PointLight(0x4d9fff, 220, 90, 2);
  core.position.set(0, 14, 0);
  scene.add(core);

  // -------------------------------------------------------------- terrain
  const SIZE = 420, SEG = 128;
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setY(i, terrainHeight(x, z));
  }
  geo.computeVertexNormals();
  const gtex = new THREE.CanvasTexture(gridTexture());
  gtex.wrapS = gtex.wrapT = THREE.RepeatWrapping;
  gtex.repeat.set(36, 36);
  gtex.colorSpace = THREE.SRGBColorSpace;
  const terrain = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    map: gtex,
    color: 0x2f6fc0,
    roughness: 0.82,
    metalness: 0.18,
    emissive: 0x0a2c58,
    emissiveIntensity: 0.55,
  }));
  terrain.receiveShadow = true;
  scene.add(terrain);

  // --------------------------------------------------- central platform
  const platMat = new THREE.MeshStandardMaterial({
    color: 0x123a68, roughness: 0.6, metalness: 0.45,
    emissive: 0x14487f, emissiveIntensity: 0.8,
  });
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x66b6ff, transparent: true, opacity: 0.55 });
  const platform = new THREE.Group();
  const tiers = [[15, 1.6], [11.5, 1.5], [8.2, 1.4]];
  let y = 0;
  for (const [r, h] of tiers) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.05, h, 48), platMat);
    m.position.y = y + h / 2;
    platform.add(m);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 1.02, 0.12, 8, 64), ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = y + h;
    platform.add(ring);
    y += h;
  }
  scene.add(platform);

  // ------------------------------------- the great structure (Cray-1 ×9)
  const [cray, rack, mobo, cables] = await Promise.all([
    loadGLB('./assets/glb/cray1.glb', 0),
    loadGLB('./assets/glb/rack.glb', 1),
    loadGLB('./assets/glb/motherboard.glb', 2),
    loadGLB('./assets/glb/cables.glb', 3),
  ]);
  const crayG = new THREE.Group();
  crayG.add(cray);
  crayG.scale.setScalar(9.0);
  crayG.position.y = y;
  crayG.rotation.y = 0.6;
  scene.add(crayG);

  // rack monoliths around the platform
  const rackRing = new THREE.Group();
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + 0.22;
    const r = 24 + (i % 3) * 5.5;
    const rk = rack.clone(true);
    rk.position.set(Math.cos(a) * r, terrainHeight(Math.cos(a) * r, Math.sin(a) * r) - 0.1, Math.sin(a) * r);
    rk.rotation.y = -a + Math.PI / 2 + (i % 2 ? 0.22 : -0.18);
    rk.scale.setScalar(2.1 + (i % 3) * 0.35);
    if (i % 3 === 0) rk.rotation.z = (i % 2 ? 1 : -1) * 0.05;
    rackRing.add(rk);
  }
  // two floating racks
  for (let i = 0; i < 2; i++) {
    const rk = rack.clone(true);
    rk.position.set(i ? 17 : -14, 16 + i * 7, i ? -21 : -17);
    rk.rotation.set(0.24 * (i ? 1 : -1), i * 1.4, 0.12 * (i ? -1 : 1));
    rk.scale.setScalar(2.4);
    rackRing.add(rk);
  }
  scene.add(rackRing);

  // ---------------------------------------------------------- WAKE_UP
  const wakeTex = new THREE.CanvasTexture(wakeTexture());
  wakeTex.colorSpace = THREE.SRGBColorSpace;
  const monolith = new THREE.Group();
  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(11, 5.5, 0.9),
    new THREE.MeshStandardMaterial({
      map: wakeTex, emissiveMap: wakeTex, emissive: 0x86c4ff,
      emissiveIntensity: 1.25, color: 0x0b2344, roughness: 0.5, metalness: 0.3,
    })
  );
  slab.position.y = 3.1;
  monolith.add(slab);
  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(12, 6.6, 0.5),
    new THREE.MeshStandardMaterial({ color: 0x0d2c52, roughness: 0.45, metalness: 0.55, emissive: 0x0f3c72, emissiveIntensity: 0.7 })
  );
  frame.position.y = 3.1;
  frame.position.z = -0.45;
  monolith.add(frame);
  monolith.position.set(0, terrainHeight(0, 21) + 0.2, 21.5);
  monolith.rotation.y = Math.PI;
  scene.add(monolith);

  // ------------------------------------------------------- light beams
  const beamTex = new THREE.CanvasTexture(beamTexture());
  const beams = [];
  const beamPos = [[0, 0], [16, 8], [-14, 12], [22, -16], [-20, -14], [8, 26], [-24, 20]];
  for (let i = 0; i < beamPos.length; i++) {
    const [bx, bz] = beamPos[i];
    const h = 120;
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5 + (i % 3) * 0.7, 1.2 + (i % 2) * 0.8, h, 10, 1, true),
      new THREE.MeshBasicMaterial({
        map: beamTex, transparent: true, opacity: 0.30 + (i % 3) * 0.08,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
      })
    );
    beam.position.set(bx, terrainHeight(bx, bz) + h / 2, bz);
    scene.add(beam);
    beams.push(beam);
  }

  // ------------------------------------------- floating debris + glyphs
  // debris uses the first real mesh of the motherboard model
  let debrisGeo = new THREE.BoxGeometry(1, 1, 1);
  let debrisMat = new THREE.MeshStandardMaterial({ color: 0x224466 });
  mobo.traverse((o) => {
    if (o.isMesh && debrisGeo instanceof THREE.BoxGeometry) {
      debrisGeo = o.geometry;
      debrisMat = o.material;
    }
  });
  const debrisCount = 26;
  const debris = new THREE.InstancedMesh(debrisGeo, debrisMat, debrisCount);
  const dummy = new THREE.Object3D();
  const debrisState = [];
  for (let i = 0; i < debrisCount; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 20 + Math.random() * 60;
    const st = {
      a, r,
      y: 6 + Math.random() * 30,
      spin: (Math.random() - 0.5) * 0.12,
      tilt: Math.random() * Math.PI,
      bob: Math.random() * Math.PI * 2,
      s: 22 + Math.random() * 26,
    };
    debrisState.push(st);
    dummy.position.set(Math.cos(a) * r, st.y, Math.sin(a) * r);
    dummy.rotation.set(st.tilt, a, st.tilt * 0.5);
    dummy.scale.setScalar(st.s);
    dummy.updateMatrix();
    debris.setMatrixAt(i, dummy.matrix);
  }
  debris.instanceMatrix.needsUpdate = true;
  scene.add(debris);

  const glyphTex = new THREE.CanvasTexture(glyphTexture());
  glyphTex.colorSpace = THREE.SRGBColorSpace;
  const glyphCount = 52;
  const glyphs = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(3.2, 3.2),
    new THREE.MeshBasicMaterial({
      map: glyphTex, transparent: true, opacity: 0.55,
      depthWrite: false, side: THREE.DoubleSide,
    }),
    glyphCount
  );
  const glyphState = [];
  for (let i = 0; i < glyphCount; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 8 + Math.random() * 80;
    const st = { a, r, y: 2 + Math.random() * 38, vy: 0.15 + Math.random() * 0.5, spin: (Math.random() - 0.5) * 0.3 };
    glyphState.push(st);
    dummy.position.set(Math.cos(a) * r, st.y, Math.sin(a) * r);
    dummy.rotation.set(0, -a + Math.PI / 2, 0);
    dummy.scale.setScalar(0.8 + Math.random() * 1.6);
    dummy.updateMatrix();
    glyphs.setMatrixAt(i, dummy.matrix);
  }
  glyphs.instanceMatrix.needsUpdate = true;
  scene.add(glyphs);

  // hanging cables around the platform
  for (let i = 0; i < 5; i++) {
    const cb = cables.clone(true);
    const a = i * 1.31 + 0.4;
    cb.position.set(Math.cos(a) * (10 + i * 2), 3.5 + i * 1.1, Math.sin(a) * (10 + i * 2));
    cb.rotation.set(Math.random() * 0.8, a, Math.random() * 0.9);
    cb.scale.setScalar(7 + i * 1.5);
    scene.add(cb);
  }

  // ------------------------------------------------- collapse machinery
  const crackMat = new THREE.LineBasicMaterial({ color: 0x9fd6ff, transparent: true, opacity: 0.95 });
  const crackGeo = new THREE.BufferGeometry();
  const crackLines = new THREE.LineSegments(crackGeo, crackMat);
  crackLines.visible = false;
  scene.add(crackLines);

  const chunkCount = 56;
  const chunkMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({
      map: gtex, color: 0x2f6fc0, roughness: 0.8, metalness: 0.2,
      emissive: 0x0a2c58, emissiveIntensity: 0.6,
    }),
    chunkCount
  );
  chunkMesh.visible = false;
  scene.add(chunkMesh);
  const chunkState = [];

  return {
    scene, sky, skyMat, terrain, platform, crayG, monolith, slab, beams, debris, debrisState,
    glyphs, glyphState, core, dummy, crackLines, chunkMesh, chunkState,
    spawn: { pos: new THREE.Vector3(0, 0, 46), yaw: 0, pitch: -0.02 }, // yaw 0 => facing -Z (centre)

    update(t, dt) {
      skyMat.uniforms.uTime.value = t;
      // debris slow drift
      for (let i = 0; i < debrisCount; i++) {
        const st = debrisState[i];
        st.a += st.spin * dt * 0.12;
        const yy = st.y + Math.sin(t * 0.22 + st.bob) * 1.15;
        dummy.position.set(Math.cos(st.a) * st.r, yy, Math.sin(st.a) * st.r);
        dummy.rotation.set(st.tilt + Math.sin(t * 0.1 + st.bob) * 0.12, st.a + t * st.spin * 0.18, st.tilt * 0.5);
        dummy.scale.setScalar(st.s);
        dummy.updateMatrix();
        debris.setMatrixAt(i, dummy.matrix);
      }
      debris.instanceMatrix.needsUpdate = true;
      // glyphs rising
      for (let i = 0; i < glyphCount; i++) {
        const st = glyphState[i];
        st.y += st.vy * dt;
        if (st.y > 46) st.y = 1.5;
        dummy.position.set(Math.cos(st.a) * st.r, st.y, Math.sin(st.a) * st.r);
        dummy.rotation.set(0, -st.a + Math.PI / 2 + Math.sin(t * 0.2 + i) * 0.14, 0);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        glyphs.setMatrixAt(i, dummy.matrix);
      }
      glyphs.instanceMatrix.needsUpdate = true;
      core.intensity = 190 + Math.sin(t * 1.7) * 42 + Math.sin(t * 4.3) * 18;
      // animated chunk fall
      if (chunkMesh.visible) {
        for (let i = 0; i < chunkState.length; i++) {
          const st = chunkState[i];
          if (st.t < st.delay) { st.t += dt; continue; }
          st.t += dt;
          st.vy -= 12.5 * dt;
          st.y += st.vy * dt;
          st.rot += st.rotV * dt;
          dummy.position.set(st.x, st.y, st.z);
          dummy.rotation.set(st.rot, st.rotY, st.rot * 0.7);
          dummy.scale.set(st.sx, st.sy, st.sz);
          dummy.updateMatrix();
          chunkMesh.setMatrixAt(i, dummy.matrix);
        }
        chunkMesh.instanceMatrix.needsUpdate = true;
      }
    },

    /** build the crack lines radiating from a point */
    buildCracks(cx, cz) {
      const pts = [];
      const y0 = terrainHeight(cx, cz) + 0.06;
      for (let i = 0; i < 26; i++) {
        const a = (i / 26) * Math.PI * 2 + Math.random() * 0.35;
        let x = cx, z = cz, aa = a;
        for (let k = 0; k < 7; k++) {
          const len = 1.1 + Math.random() * 2.4;
          aa += (Math.random() - 0.5) * 0.9;
          const nx = x + Math.cos(aa) * len, nz = z + Math.sin(aa) * len;
          pts.push(x, y0 + Math.random() * 0.05, z, nx, y0 + Math.random() * 0.05, nz);
          x = nx; z = nz;
        }
      }
      crackGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      crackLines.visible = true;
      crackMat.opacity = 0.0;
    },

    /** falling ground chunks around the player */
    buildChunks(cx, cz) {
      chunkState.length = 0;
      for (let i = 0; i < chunkCount; i++) {
        const ring = i < 12 ? 1.1 : i < 30 ? 2.6 : 5.2;
        const a = (i / chunkCount) * Math.PI * 2 * 2.7;
        const r = ring + Math.random() * 1.6;
        const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
        const y = terrainHeight(x, z);
        const st = {
          x, z, y, sx: 1.6 + Math.random() * 2.6, sy: 0.7 + Math.random() * 1.4,
          sz: 1.6 + Math.random() * 2.6, rotY: Math.random() * Math.PI,
          rot: 0, rotV: (Math.random() - 0.5) * 1.6,
          vy: 0, t: 0, delay: 0.25 + Math.random() * 1.6,
        };
        chunkState.push(st);
        dummy.position.set(x, y, z);
        dummy.rotation.set(0, st.rotY, 0);
        dummy.scale.set(st.sx, st.sy, st.sz);
        dummy.updateMatrix();
        chunkMesh.setMatrixAt(i, dummy.matrix);
      }
      chunkMesh.instanceMatrix.needsUpdate = true;
      chunkMesh.visible = true;
    },
  };
}
