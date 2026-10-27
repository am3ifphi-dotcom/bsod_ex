// room.js — the bedroom at night (Drive bedroom GLB + GitHub PC props)
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

export async function buildRoom(bsodCanvas, onProgress) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x04070d);
  scene.fog = new THREE.Fog(0x04070d, 6, 16);

  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);

  const loadGLB = (url, idx) => new Promise((res, rej) => {
    loader.load(url, (g) => res(g.scene), (e) => {
      if (onProgress && e.lengthComputable) onProgress(idx, e.loaded / e.total);
    }, rej);
  });

  const [bedroom, crt, tower, chair, cables] = await Promise.all([
    loadGLB('./assets/glb/bedroom.glb', 0),
    loadGLB('./assets/glb/crt_monitor.glb', 1),
    loadGLB('./assets/glb/pc_tower.glb', 2),
    loadGLB('./assets/glb/chair.glb', 3),
    loadGLB('./assets/glb/cables.glb', 4),
  ]);

  // ------------------------------------------------------- bedroom shell
  bedroom.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          if (m.map) m.map.anisotropy = 4;
        }
      }
    }
  });
  scene.add(bedroom);

  // ------------------------------------------------------------- lights
  const ambient = new THREE.AmbientLight(0x25354e, 0.55);
  scene.add(ambient);
  const hemi = new THREE.HemisphereLight(0x2c4266, 0x0a0e16, 0.55);
  scene.add(hemi);

  // moonlight through the window
  const moon = new THREE.DirectionalLight(0x86aee8, 1.35);
  moon.position.set(5.2, 3.2, -1.2);
  moon.castShadow = true;
  moon.shadow.mapSize.set(1024, 1024);
  moon.shadow.camera.left = -5; moon.shadow.camera.right = 5;
  moon.shadow.camera.top = 5; moon.shadow.camera.bottom = -5;
  moon.shadow.camera.near = 0.5; moon.shadow.camera.far = 14;
  moon.shadow.bias = -0.0015;
  scene.add(moon);

  // warm ceiling lamp (the hanging light in the model sits near -1.35,1.2,-2.5)
  const lamp = new THREE.PointLight(0xffd2a0, 6.5, 9, 2);
  lamp.position.set(-1.35, 1.28, -2.45);
  scene.add(lamp);

  // bedside glow
  const bedside = new THREE.PointLight(0xffc98c, 1.8, 4, 2);
  bedside.position.set(-1.75, 0.95, -2.3);
  scene.add(bedside);

  // ------------------------------------------------------- monitor (CRT)
  // window-bench surface is at y≈0.685 (where the MacBook sits);
  // the CRT model's base bottom is at local y=-0.254 → lift the group so it rests on the bench
  const monitor = new THREE.Group();
  // bench free gap: z -0.77..-0.26 (between the glass container and the MacBook)
  monitor.position.set(2.42, 1.003, -0.51);
  monitor.rotation.y = -Math.PI / 2 - 0.22;
  monitor.scale.setScalar(1.25);
  crt.traverse((o) => {
    if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
  });
  monitor.add(crt);

  // screen plane in front of the glass (glass bbox: x±0.155, y-0.102..0.131, z0.2..0.215)
  const tex = new THREE.CanvasTexture(bsodCanvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const screenMat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.315, 0.238), screenMat);
  screen.position.set(0, 0.0145, 0.2165);
  monitor.add(screen);
  scene.add(monitor);

  // the screen's blue light on the room
  const monLight = new THREE.PointLight(0x55a2ff, 2.0, 4.2, 2);
  monLight.position.copy(monitor.position);
  monLight.position.x -= 0.55;
  monLight.position.y += 0.25;
  scene.add(monLight);

  // --------------------------------------------------------------- PC tower
  // on the floor beside the desk (rug area), clear of the bench & radiator
  const towerG = new THREE.Group();
  tower.rotation.x = -Math.PI / 2;       // model is Z-up
  towerG.add(tower);
  normalize(towerG, 0.52);
  towerG.position.set(1.78, 0, 0.62);
  towerG.rotation.y = -Math.PI / 2 + 0.35;
  towerG.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  scene.add(towerG);

  // ------------------------------------------------------------------ chair
  const chairG = new THREE.Group();
  chairG.add(chair);
  normalize(chairG, 1.18);
  chairG.position.set(1.22, 0, -0.52);
  chairG.rotation.y = -Math.PI / 2 + 0.42;
  chairG.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  scene.add(chairG);

  // ------------------------------------------------------------------ cables
  const cable1 = cables.clone(true);
  cable1.position.set(1.98, 0.03, 0.32);
  cable1.rotation.y = 0.8;
  cable1.scale.setScalar(0.9);
  scene.add(cable1);
  const cable2 = cables.clone(true);
  cable2.position.set(1.42, 0.03, 0.08);
  cable2.rotation.y = -1.9;
  cable2.scale.setScalar(0.7);
  scene.add(cable2);
  [cable1, cable2].forEach((c) => c.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }));

  // --------------------------------------------------------------- dust
  const dustN = 110;
  const dustGeo = new THREE.BufferGeometry();
  const dpos = new Float32Array(dustN * 3);
  for (let i = 0; i < dustN; i++) {
    dpos[i * 3] = 0.4 + Math.random() * 2.2;
    dpos[i * 3 + 1] = 0.35 + Math.random() * 1.9;
    dpos[i * 3 + 2] = -1.6 + Math.random() * 2.2;
  }
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dpos, 3));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
    color: 0x9db8dd, size: 0.011, transparent: true, opacity: 0.5, depthWrite: false,
  }));
  scene.add(dust);

  // world position of the screen centre (computed via matrix)
  monitor.updateMatrixWorld(true);
  const screenWorld = new THREE.Vector3();
  screen.getWorldPosition(screenWorld);
  const screenNormal = new THREE.Vector3(0, 0, 1)
    .applyQuaternion(monitor.getWorldQuaternion(new THREE.Quaternion())).normalize();

  return {
    scene, screen, tex, monLight, monitor, lamp, bedside,
    screenWorld, screenNormal,
    spawn: { pos: new THREE.Vector3(0.35, 1.62, 0.35), yaw: -1.18, pitch: -0.02 },
    interactPos: new THREE.Vector3(1.95, 1.12, -0.45),
    colliders: [
      { min: { x: -2.4, z: -3.4 }, max: { x: -1.95, z: 2.0 } },   // left wall
      { min: { x: -2.4, z: -3.4 }, max: { x: 3.2, z: -2.98 } },   // back wall
      { min: { x: -2.4, z: 1.5 }, max: { x: 3.2, z: 2.0 } },      // front wall
      { min: { x: 2.62, z: -3.4 }, max: { x: 3.3, z: 2.0 } },     // window wall
      { min: { x: -1.62, z: -2.98 }, max: { x: 1.42, z: -1.02 } },// bed
      { min: { x: 1.92, z: -1.28 }, max: { x: 2.62, z: 0.88 } },  // desk / window ledge
      { min: { x: 1.95, z: 0.36 }, max: { x: 2.66, z: 1.02 } },   // storage box
      { min: { x: 1.52, z: 0.38 }, max: { x: 2.04, z: 0.88 } },   // pc tower
    ],
    dust,
    update(t, dt) {
      // drifting dust
      const p = dust.geometry.attributes.position.array;
      for (let i = 0; i < dustN; i++) {
        p[i * 3 + 1] += dt * 0.012 * (0.5 + (i % 5) * 0.2);
        p[i * 3] += Math.sin(t * 0.3 + i) * dt * 0.012;
        if (p[i * 3 + 1] > 2.3) p[i * 3 + 1] = 0.35;
      }
      dust.geometry.attributes.position.needsUpdate = true;
    },
  };
}

/** normalize a model group: fit height, rest on y=0 */
function normalize(group, targetHeight) {
  const box = new THREE.Box3().setFromObject(group);
  const size = new THREE.Vector3();
  box.getSize(size);
  const k = targetHeight / size.y;
  group.scale.setScalar(k);
  const box2 = new THREE.Box3().setFromObject(group);
  group.position.y -= box2.min.y;
}
