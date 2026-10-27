import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { BSODScreen, makeTextSprite } from './bsod.js';
import { AudioEngine } from './audio.js';

/* ============ DOM ============ */
const $ = id => document.getElementById(id);
const canvas = $('game-canvas'), hud = $('hud'), promptEl = $('prompt'), objectiveEl = $('objective'),
  subtitleEl = $('subtitle'), hintEl = $('hint-corner'), consoleEl = $('console'), consoleLog = $('console-log'),
  consoleInput = $('console-input'), vignetteEl = $('vignette'), bluewashEl = $('bluewash'), flashEl = $('flash'), grainEl = $('grain');

const audio = new AudioEngine();
const bsod = new BSODScreen();
const bsodTex = new THREE.CanvasTexture(bsod.canvas);
bsodTex.colorSpace = THREE.SRGBColorSpace; bsodTex.anisotropy = 4;

/* ============ Renderer / Scene ============ */
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.12;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 400);
const roomScene = new THREE.Scene(); roomScene.background = new THREE.Color(0x020409);
roomScene.fog = new THREE.Fog(0x020409, 8, 26);
const worldScene = new THREE.Scene(); worldScene.background = new THREE.Color(0x020b26);
worldScene.fog = new THREE.FogExp2(0x04163e, 0.02);

let scene = roomScene;
const player = new THREE.Object3D(); // yaw rig; camera is child for pitch
player.add(camera); camera.position.set(0, 0, 0);
let pitchObj = camera;
let yaw = 0, pitch = 0;
const EYE = 1.62;
player.position.set(0, EYE, 2);

/* ============ State ============ */
const S = { LOADING: 0, TITLE: 1, ROOM: 2, TO_FOCUS: 3, FOCUS: 4, FROM_FOCUS: 5, DEVOUR: 6, WORLD: 7, COLLAPSE: 8, RETURN: 9 };
let state = S.LOADING;
let returned = false;           // has completed one loop
let seenWake = false;
let consoleOpen = false;
let pointerLocked = false;
let corruption = 0, misclicks = 0;
let stateT = 0;                 // time in current state
let clockTime = 0;

function setState(s) { state = s; stateT = 0; }

/* ============ Helpers ============ */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeInOut = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
const easeOut = t => 1 - Math.pow(1 - t, 3);
function spring(cur, vel, target, k, d, dt) { // returns [value, vel]
  const f = (target - cur) * k - vel * d; vel += f * dt; cur += vel * dt; return [cur, vel];
}
let subtitleTimer = null;
function subtitle(text, dur = 3600) {
  subtitleEl.textContent = text; subtitleEl.style.opacity = 1;
  clearTimeout(subtitleTimer); subtitleTimer = setTimeout(() => subtitleEl.style.opacity = 0, dur);
}
function objective(text) { objectiveEl.textContent = text || ''; }
function fitModel(obj, maxDim) {
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3()); const center = box.getCenter(new THREE.Vector3());
  const s = maxDim / Math.max(size.x, size.y, size.z);
  obj.scale.setScalar(s);
  obj.position.set(-center.x * s, -box.min.y * s, -center.z * s);
  const wrap = new THREE.Group(); wrap.add(obj); wrap.userData.size = size.multiplyScalar(s);
  return wrap;
}
function findByName(root, pred) { let f = null; root.traverse(o => { if (!f && pred(o.name || '')) f = o; }); return f; }

/* ============ Loading models ============ */
const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
const MODELS = ['bedroom', 'crt_computer_monitor', 'office_chair', 'motherboard', 'cray_1_supercomputer', 'data_center_server_rack', 'modular_cables', 'gaming_desktop_pc'];
const gltfs = {};
async function loadAll() {
  let done = 0;
  for (const name of MODELS) {
    $('load-status').textContent = `読み込み中: ${name} (${done + 1}/${MODELS.length})`;
    try { gltfs[name] = await loader.loadAsync(`/models/${name}.glb`); }
    catch (e) { console.warn('model failed', name, e); }
    done++; $('load-bar').style.width = `${(done / MODELS.length) * 100}%`;
  }
}

/* ============ ROOM ============ */
const roomGroup = new THREE.Group(); roomScene.add(roomGroup);
let monitorPos = new THREE.Vector3(0, 1.05, -1.6), monitorFront = new THREE.Vector3(0, 0, 1), glassMesh = null;
let deskAnchor = new THREE.Vector3(), roomBounds = { minX: -2, maxX: 2, minZ: -2.6, maxZ: 1.4 };
let lampLight, monitorLight, chairObj, clockHands = {}, roomDust, roomObstacles = [];
let roomSpawn = { pos: new THREE.Vector3(0, EYE, 2), yaw: 0 };

function buildRoom() {
  // lights
  roomScene.add(new THREE.HemisphereLight(0x2a3a5f, 0x0a0c12, 0.55));
  const moon = new THREE.DirectionalLight(0x5f83c4, 0.35); moon.position.set(3, 6, 2); roomScene.add(moon);
  lampLight = new THREE.SpotLight(0xffc98a, 14, 7, 0.65, 0.5, 1.6);
  lampLight.castShadow = true; lampLight.shadow.mapSize.set(1024, 1024); lampLight.shadow.bias = -0.004;
  roomScene.add(lampLight); roomScene.add(lampLight.target);
  monitorLight = new THREE.PointLight(0x2f7fe0, 3.2, 5.5, 1.8); roomScene.add(monitorLight);

  const bedroom = gltfs.bedroom.scene;
  bedroom.traverse(o => { if (o.isMesh) { o.receiveShadow = true; o.castShadow = false; } });
  const bb = new THREE.Box3().setFromObject(bedroom);
  const bc = bb.getCenter(new THREE.Vector3());
  bedroom.position.set(-bc.x, -bb.min.y, -bc.z);
  roomGroup.add(bedroom);
  roomBounds = { minX: bb.min.x - bc.x + 0.35, maxX: bb.max.x - bc.x - 0.35, minZ: bb.min.z - bc.z + 0.35, maxZ: bb.max.z - bc.z - 0.35 };

  // locate the MacBook -> that surface becomes our PC desk
  const mac = findByName(bedroom, n => n === 'MacBook');
  let macBox = null;
  if (mac) { macBox = new THREE.Box3().setFromObject(mac); mac.visible = false; }
  if (macBox) { deskAnchor.copy(macBox.getCenter(new THREE.Vector3())); deskAnchor.y = macBox.min.y; }
  else deskAnchor.set(0, 0.76, roomBounds.minZ + 0.8);

  const roomCenter = new THREE.Vector3(0, 0, 0);

  // ---- CRT monitor with live BSOD glass ----
  const crt = gltfs.crt_computer_monitor.scene;
  const glass = findByName(crt, n => n.includes('monitor_glass'));
  const plastic = findByName(crt, n => n.includes('monitor_plastic'));
  // front direction BEFORE rotation: glass offset from plastic
  const crtWrap0 = fitModel(crt, 0.62);
  let frontLocal = new THREE.Vector3(0, 0, 1);
  if (glass && plastic) {
    const g = new THREE.Box3().setFromObject(glass).getCenter(new THREE.Vector3());
    const p = new THREE.Box3().setFromObject(plastic).getCenter(new THREE.Vector3());
    frontLocal.subVectors(g, p); frontLocal.y = 0;
    if (frontLocal.lengthSq() < 0.0001) frontLocal.set(0, 0, 1); frontLocal.normalize();
  }
  if (glass) {
    glass.material = new THREE.MeshBasicMaterial({ map: bsodTex, toneMapped: false });
    glassMesh = glass;
  }
  crt.traverse(o => { if (o.isMesh && o !== glass) { o.castShadow = true; o.receiveShadow = true; } });
  monitorPos.set(deskAnchor.x, deskAnchor.y, deskAnchor.z);
  crtWrap0.position.copy(monitorPos);
  const desired = roomCenter.clone().sub(monitorPos); desired.y = 0; desired.normalize();
  crtWrap0.rotation.y = Math.atan2(desired.x, desired.z) - Math.atan2(frontLocal.x, frontLocal.z);
  monitorFront.copy(desired);
  roomGroup.add(crtWrap0);
  // true screen centre (world) for camera work
  if (glass) new THREE.Box3().setFromObject(glass).getCenter(monitorPos);
  monitorLight.position.copy(monitorPos).addScaledVector(monitorFront, 0.45).add(new THREE.Vector3(0, 0.1, 0));
  lampLight.position.copy(monitorPos).add(new THREE.Vector3(-0.55, 0.85, 0.25));
  lampLight.target.position.copy(monitorPos).add(new THREE.Vector3(0, -0.3, 0));

  // ---- gaming PC tower (strip keyboard-key letter meshes to cut draw calls) ----
  try {
    const pc = gltfs.gaming_desktop_pc.scene;
    const kill = [];
    pc.traverse(o => { if (/^(Text\.|Text_|Object_9|Object_10)/.test(o.name || '')) kill.push(o); });
    kill.forEach(o => o.parent && o.parent.remove(o));
    const pcWrap = fitModel(pc, 0.58);
    const right = new THREE.Vector3(-monitorFront.z, 0, monitorFront.x);
    pcWrap.position.copy(monitorPos).addScaledVector(right, 0.55); pcWrap.position.y = 0;
    pcWrap.rotation.y = Math.atan2(desired.x, desired.z);
    pcWrap.traverse(o => { if (o.isMesh) o.castShadow = true; });
    roomGroup.add(pcWrap);
  } catch (e) { console.warn(e); }

  // ---- office chair ----
  const chairWrap = fitModel(gltfs.office_chair.scene.clone(), 1.08);
  chairWrap.position.copy(monitorPos).addScaledVector(monitorFront, 0.62); chairWrap.position.y = 0;
  chairWrap.rotation.y = Math.atan2(-monitorFront.x, -monitorFront.z);
  chairWrap.traverse(o => { if (o.isMesh) o.castShadow = true; });
  roomGroup.add(chairWrap); chairObj = chairWrap;

  // ---- removed motherboard lying on the desk (foreshadowing) ----
  const mbWrap = fitModel(gltfs.motherboard.scene.clone(), 0.3);
  const left = new THREE.Vector3(monitorFront.z, 0, -monitorFront.x);
  mbWrap.position.copy(monitorPos).addScaledVector(left, 0.42); mbWrap.position.y = deskAnchor.y + 0.005;
  mbWrap.rotation.y = Math.random() * 0.6;
  roomGroup.add(mbWrap);

  // ---- cables on floor ----
  const cabWrap = fitModel(gltfs.modular_cables.scene.clone(), 1.4);
  cabWrap.position.copy(monitorPos).addScaledVector(monitorFront, 0.35); cabWrap.position.y = 0.01;
  cabWrap.rotation.y = Math.random() * Math.PI;
  roomGroup.add(cabWrap);

  // ---- wall clock 2:47 ----
  const clockG = new THREE.Group();
  const face = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.03, 32), new THREE.MeshStandardMaterial({ color: 0xdfe6f2, roughness: 0.6 }));
  face.rotation.x = Math.PI / 2; clockG.add(face);
  const hourH = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.085, 0.006), new THREE.MeshBasicMaterial({ color: 0x11131c }));
  const minH = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.13, 0.006), new THREE.MeshBasicMaterial({ color: 0x11131c }));
  hourH.geometry.translate(0, 0.04, 0); minH.geometry.translate(0, 0.06, 0);
  hourH.position.z = minH.position.z = 0.02; clockG.add(hourH, minH);
  clockHands = { hourH, minH };
  setClock(2, 47);
  clockG.position.set(monitorPos.x - monitorFront.z * 1.2, 2.15, monitorPos.z + monitorFront.x * 1.2);
  // put clock on the wall behind-ish: push toward minZ wall if far
  clockG.position.x = clamp(clockG.position.x, roomBounds.minX + 0.3, roomBounds.maxX - 0.3);
  clockG.lookAt(clockG.position.clone().add(monitorFront));
  roomGroup.add(clockG);

  // dust motes
  const N = 220, pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { pos[i * 3] = lerp(roomBounds.minX, roomBounds.maxX, Math.random()); pos[i * 3 + 1] = Math.random() * 2.6; pos[i * 3 + 2] = lerp(roomBounds.minZ, roomBounds.maxZ, Math.random()); }
  const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  roomDust = new THREE.Points(dg, new THREE.PointsMaterial({ color: 0x9db9e8, size: 0.008, transparent: true, opacity: 0.55, depthWrite: false }));
  roomGroup.add(roomDust);

  // bed collision volume (real layout measured from the Drive model)
  roomObstacles = [];
  const bedNode = findByName(bedroom, n => n === 'ModernBed');
  if (bedNode) {
    const bb2 = new THREE.Box3().setFromObject(bedNode);
    roomObstacles.push({ minX: bb2.min.x, maxX: bb2.max.x, minZ: bb2.min.z, maxZ: bb2.max.z });
  }
  const insideObs = (x, z, pad) => roomObstacles.some(o => x > o.minX - pad && x < o.maxX + pad && z > o.minZ - pad && z < o.maxZ + pad);
  // spawn: search candidates in front of the desk that are not inside furniture
  const perp = new THREE.Vector3(-monitorFront.z, 0, monitorFront.x);
  let chosen = null;
  outer: for (const d of [1.5, 1.9, 2.3, 2.7]) for (const s of [0, -1.0, 1.0, -1.7, 1.7, -2.4]) {
    const cand = monitorPos.clone().addScaledVector(monitorFront, d).addScaledVector(perp, s);
    cand.x = clamp(cand.x, roomBounds.minX + 0.25, roomBounds.maxX - 0.25);
    cand.z = clamp(cand.z, roomBounds.minZ + 0.25, roomBounds.maxZ - 0.25);
    if (!insideObs(cand.x, cand.z, 0.22) && cand.distanceTo(deskAnchor) > 0.85) { chosen = cand; break outer; }
  }
  roomSpawn.pos.copy(chosen || monitorPos.clone().addScaledVector(monitorFront, 2)); roomSpawn.pos.y = EYE;
  const toMon = monitorPos.clone().sub(roomSpawn.pos);
  roomSpawn.yaw = Math.atan2(-toMon.x, -toMon.z);
}
function setClock(h, m) {
  if (!clockHands.hourH) return;
  clockHands.hourH.rotation.z = -((h % 12) + m / 60) / 12 * Math.PI * 2;
  clockHands.minH.rotation.z = -(m / 60) * Math.PI * 2;
}

/* ============ WORLD ============ */
const worldGroup = new THREE.Group(); worldScene.add(worldGroup);
const MONUMENT_POS = new THREE.Vector3(0, 0, -34);
let monument, wakePlane, worldShards, worldMotes, floatingSprites = [], cableGroup;
let tiles = [], tileGroup, crackPlane;
const worldSpawn = { pos: new THREE.Vector3(0, EYE, 30), yaw: 0 }; // looking -Z (yaw PI? handled below)

function gridTexture() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 256; const c = cv.getContext('2d');
  c.fillStyle = '#041233'; c.fillRect(0, 0, 256, 256);
  c.strokeStyle = 'rgba(70,150,255,0.85)'; c.lineWidth = 3; c.strokeRect(0, 0, 256, 256);
  c.strokeStyle = 'rgba(50,110,230,0.35)'; c.lineWidth = 1; c.strokeRect(64, 64, 128, 128);
  c.fillStyle = 'rgba(120,190,255,0.5)'; c.fillRect(0, 0, 4, 4);
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(46, 46); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function crackTexture() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 512; const c = cv.getContext('2d');
  c.clearRect(0, 0, 512, 512); c.strokeStyle = '#8fd0ff'; c.shadowColor = '#2f8fff'; c.shadowBlur = 12;
  for (let i = 0; i < 26; i++) {
    let x = 256, y = 256; const a = (i / 26) * Math.PI * 2 + Math.random() * 0.3; c.lineWidth = 1 + Math.random() * 2.5; c.beginPath(); c.moveTo(x, y);
    const steps = 5 + Math.floor(Math.random() * 5);
    for (let s2 = 0; s2 < steps; s2++) { x += Math.cos(a + (Math.random() - 0.5) * 0.7) * (18 + Math.random() * 26); y += Math.sin(a + (Math.random() - 0.5) * 0.7) * (18 + Math.random() * 26); c.lineTo(x, y); }
    c.stroke();
  }
  const t = new THREE.CanvasTexture(cv); return t;
}
function buildWorld() {
  worldScene.add(new THREE.HemisphereLight(0x6f9fff, 0x02061a, 0.75));
  const dir = new THREE.DirectionalLight(0x8fb8ff, 0.7); dir.position.set(10, 30, 14); worldScene.add(dir);
  const monLight = new THREE.PointLight(0x3d8bff, 60, 60, 1.7); monLight.position.set(0, 9, -26); worldScene.add(monLight);
  const spawnLight = new THREE.PointLight(0x2f6fe0, 20, 34, 1.8); spawnLight.position.set(0, 6, 26); worldScene.add(spawnLight);

  const ground = new THREE.Mesh(new THREE.CircleGeometry(85, 56),
    new THREE.MeshStandardMaterial({ map: gridTexture(), emissive: 0x1c56d8, emissiveIntensity: 0.32, emissiveMap: null, roughness: 0.9, color: 0x8fb4ff }));
  ground.rotation.x = -Math.PI / 2; worldGroup.add(ground);

  // glowing path strips toward monument
  const pathMat = new THREE.MeshBasicMaterial({ color: 0x3d8bff, transparent: true, opacity: 0.5, toneMapped: false });
  for (const sx of [-1.4, 1.4]) {
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 60), pathMat);
    strip.rotation.x = -Math.PI / 2; strip.position.set(sx, 0.02, 0); worldGroup.add(strip);
  }

  // central monument: CRAY-1
  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(6.4, 7.4, 1.2, 8), new THREE.MeshStandardMaterial({ color: 0x0a1c44, roughness: 0.55, metalness: 0.4, emissive: 0x0a2c70, emissiveIntensity: 0.5 }));
  pedestal.position.set(MONUMENT_POS.x, 0.6, MONUMENT_POS.z); worldGroup.add(pedestal);
  monument = fitModel(gltfs.cray_1_supercomputer.scene.clone(), 8.2);
  monument.position.set(MONUMENT_POS.x, 1.2, MONUMENT_POS.z); worldGroup.add(monument);

  // WAKE_UP inscription — readable up close, etched into light
  const wakeCv = document.createElement('canvas'); wakeCv.width = 1024; wakeCv.height = 256;
  const wc = wakeCv.getContext('2d'); wc.clearRect(0, 0, 1024, 256);
  wc.font = '200 148px Consolas,monospace'; wc.textAlign = 'center'; wc.textBaseline = 'middle';
  wc.shadowColor = '#59a7ff'; wc.shadowBlur = 26; wc.fillStyle = '#cfe6ff'; wc.fillText('WAKE_UP', 512, 118);
  wc.shadowBlur = 0; wc.fillStyle = 'rgba(160,200,255,0.75)'; wc.font = '24px Consolas,monospace';
  wc.fillText('— REMOTE KERNEL INSCRIPTION —', 512, 218);
  const wakeTex = new THREE.CanvasTexture(wakeCv); wakeTex.colorSpace = THREE.SRGBColorSpace;
  wakePlane = new THREE.Mesh(new THREE.PlaneGeometry(9.5, 2.4), new THREE.MeshBasicMaterial({ map: wakeTex, transparent: true, opacity: 0, toneMapped: false, depthWrite: false }));
  wakePlane.position.set(MONUMENT_POS.x, 4.4, MONUMENT_POS.z + 4.6); worldGroup.add(wakePlane);
  const wakeBack = wakePlane.clone(); wakeBack.rotation.y = Math.PI; wakeBack.position.z = MONUMENT_POS.z - 4.6; worldGroup.add(wakeBack);
  worldGroup.userData.wakeBack = wakeBack;

  // server-rack towers
  const rackProto = gltfs.data_center_server_rack.scene;
  const rackPositions = [[-13, -18, 5.5], [12, -22, 7], [-19, 2, 8.5], [17, -4, 6], [-10, 16, 5], [14, 12, 9], [-24, -30, 10], [22, -32, 8]];
  worldGroup.userData.obstacles = [];
  for (const [x, z, h] of rackPositions) {
    const r = fitModel(rackProto.clone(), h);
    r.position.set(x, 0, z); r.rotation.y = Math.atan2(-x, -z) + (Math.random() - 0.5) * 0.5;
    worldGroup.add(r); worldGroup.userData.obstacles.push({ x, z, r: h * 0.32 });
  }
  worldGroup.userData.obstacles.push({ x: MONUMENT_POS.x, z: MONUMENT_POS.z, r: 7.6 });

  // floating motherboard shards (instanced-ish clones share geometry)
  const mbProto = gltfs.motherboard.scene;
  floatingSprites = [];
  for (let i = 0; i < 9; i++) {
    const m = fitModel(mbProto.clone(), 1.4 + Math.random() * 2.2);
    const a = Math.random() * Math.PI * 2, r = 12 + Math.random() * 26;
    m.position.set(Math.cos(a) * r, 2 + Math.random() * 7, Math.sin(a) * r - 6);
    m.rotation.set(Math.random(), Math.random() * 3, Math.random());
    m.userData.float = { baseY: m.position.y, sp: 0.2 + Math.random() * 0.5, ph: Math.random() * 9, rot: (Math.random() - 0.5) * 0.4 };
    worldGroup.add(m); floatingSprites.push(m);
  }
  // modular cables snaking on ground
  cableGroup = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const cb = fitModel(gltfs.modular_cables.scene.clone(), 7 + Math.random() * 6);
    const a = Math.random() * Math.PI * 2, r = 9 + Math.random() * 22;
    cb.position.set(Math.cos(a) * r, 0.03, Math.sin(a) * r - 4); cb.rotation.y = Math.random() * Math.PI;
    cableGroup.add(cb);
  }
  worldGroup.add(cableGroup);

  // floating error-text sprites
  const texts = ['0x00000000', 'MEMORY_MANAGEMENT', 'IRQL_NOT_LESS_OR_EQUAL', 'PAGE_FAULT_IN_NONPAGED_AREA', ':( :(', 'KERNEL_DATA_INPAGE_ERROR', 'DPC_WATCHDOG_VIOLATION', 'still here?', 'SYSTEM_THREAD_EXCEPTION', '0xDEAD', 'you clicked the face', 'CRITICAL_PROCESS_DIED'];
  for (let i = 0; i < texts.length; i++) {
    const s = makeTextSprite(texts[i], { size: 40, color: i === 8 ? '#ffd9d9' : '#a9ccff' });
    const tex = new THREE.CanvasTexture(s.canvas); tex.colorSpace = THREE.SRGBColorSpace;
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.75, depthWrite: false }));
    const a = (i / texts.length) * Math.PI * 2, r = 16 + (i % 4) * 7;
    spr.position.set(Math.cos(a) * r, 3 + (i % 5) * 1.6, Math.sin(a) * r - 8);
    spr.scale.set(3.4 * s.aspect * 0.24, 3.4 * 0.24, 1);
    spr.userData.float = { baseY: spr.position.y, sp: 0.25 + Math.random() * 0.4, ph: Math.random() * 9 };
    worldGroup.add(spr); floatingSprites.push(spr);
  }
  // BSOD fragment monoliths (reuse authentic screen at corruption 3)
  const frag = new BSODScreen(); frag.setLevel(3); frag.draw(3, 1);
  const fragTex = new THREE.CanvasTexture(frag.canvas); fragTex.colorSpace = THREE.SRGBColorSpace;
  for (let i = 0; i < 5; i++) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 2.55), new THREE.MeshBasicMaterial({ map: fragTex, toneMapped: false, transparent: true, opacity: 0.92 }));
    const a = i * 1.35 + 0.6, r = 24 + (i % 3) * 8;
    p.position.set(Math.cos(a) * r, 2.6 + (i % 3), Math.sin(a) * r - 10);
    p.lookAt(0, 2.4, 10); p.userData.float = { baseY: p.position.y, sp: 0.15 + Math.random() * 0.3, ph: i * 2 };
    worldGroup.add(p); floatingSprites.push(p);
  }
  // instanced debris
  const shardGeo = new THREE.BoxGeometry(0.32, 0.05, 0.24);
  const shardMat = new THREE.MeshStandardMaterial({ color: 0x2a5fc0, emissive: 0x1a4fc0, emissiveIntensity: 0.7, roughness: 0.4 });
  worldShards = new THREE.InstancedMesh(shardGeo, shardMat, 110);
  worldShards.userData.items = [];
  const dummy = new THREE.Object3D();
  for (let i = 0; i < 110; i++) {
    const a = Math.random() * Math.PI * 2, r = 6 + Math.random() * 44;
    const it = { x: Math.cos(a) * r, y: 0.5 + Math.random() * 11, z: Math.sin(a) * r - 6, rx: Math.random() * 3, rz: Math.random() * 3, sp: 0.2 + Math.random() * 0.7, ph: Math.random() * 9 };
    worldShards.userData.items.push(it);
    dummy.position.set(it.x, it.y, it.z); dummy.rotation.set(it.rx, 0, it.rz); dummy.updateMatrix();
    worldShards.setMatrixAt(i, dummy.matrix);
  }
  worldGroup.add(worldShards);
  // blue motes
  const N = 700, pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { const a = Math.random() * Math.PI * 2, r = Math.random() * 55; pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = Math.random() * 16; pos[i * 3 + 2] = Math.sin(a) * r - 6; }
  const mg = new THREE.BufferGeometry(); mg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  worldMotes = new THREE.Points(mg, new THREE.PointsMaterial({ color: 0x6fb2ff, size: 0.07, transparent: true, opacity: 0.7, depthWrite: false }));
  worldGroup.add(worldMotes);

  // collapse tiles (hidden until WAKE_UP) — grid repositioned under player at collapse start
  tileGroup = new THREE.Group(); tileGroup.visible = false; worldGroup.add(tileGroup);
  const tileGeo = new THREE.BoxGeometry(1.7, 0.16, 1.7);
  const tileMat = new THREE.MeshStandardMaterial({ color: 0x0a2c6e, emissive: 0x1c56d8, emissiveIntensity: 0.35, roughness: 0.7 });
  tiles = [];
  for (let gx = -3; gx <= 3; gx++) for (let gz = -3; gz <= 3; gz++) {
    const t = new THREE.Mesh(tileGeo, tileMat);
    t.position.set(gx * 1.78, -0.06, gz * 1.78);
    t.userData = { home: t.position.clone(), vy: 0, delay: Math.hypot(gx, gz) * 0.34 + Math.random() * 0.2, falling: false, rx: 0, rz: 0 };
    tileGroup.add(t); tiles.push(t);
  }
  crackPlane = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), new THREE.MeshBasicMaterial({ map: crackTexture(), transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
  crackPlane.rotation.x = -Math.PI / 2; crackPlane.position.y = 0.03; crackPlane.visible = false; worldGroup.add(crackPlane);
}

/* ============ Input / movement ============ */
const keys = {};
let vel = new THREE.Vector3();
addEventListener('keydown', e => {
  if (consoleOpen) return; // console handles its own keys
  keys[e.code] = true;
  if (e.code === 'KeyE' && state === S.ROOM && nearMonitor()) startFocus();
  if (e.code === 'KeyC' && state === S.WORLD) openConsole();
  if (e.code === 'Escape' && state === S.FOCUS) exitFocus(false);
});
addEventListener('keyup', e => keys[e.code] = false);
let mouseNDC = new THREE.Vector2(), faceHover = false;
addEventListener('mousemove', e => {
  mouseNDC.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  if (pointerLocked && (state === S.ROOM || state === S.WORLD)) {
    yaw -= e.movementX * 0.0021; pitch -= e.movementY * 0.0021;
    pitch = clamp(pitch, -1.45, 1.45);
  }
});
canvas.addEventListener('mousedown', () => {
  audio.resume();
  if (state === S.FOCUS) handleScreenClick();
});
function lockPointer() { try { const p = canvas.requestPointerLock({ unadjustedMovement: true }); if (p && p.catch) p.catch(() => { try { canvas.requestPointerLock(); } catch {} }); } catch { try { canvas.requestPointerLock(); } catch {} } }
document.addEventListener('pointerlockchange', () => {
  pointerLocked = document.pointerLockElement === canvas;
  if (!pointerLocked && (state === S.ROOM || state === S.WORLD) && !consoleOpen) $('pause-screen').classList.remove('hidden');
  else $('pause-screen').classList.add('hidden');
});
$('resume-btn').addEventListener('click', lockPointer);

function nearMonitor() { return player.position.distanceTo(monitorPos) < 1.9; }

function updateMovement(dt) {
  const speedBase = (keys.ShiftLeft || keys.ShiftRight) ? 4.4 : 2.6;
  const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
  const wish = new THREE.Vector3();
  if (keys.KeyW || keys.ArrowUp) wish.add(fwd);
  if (keys.KeyS || keys.ArrowDown) wish.sub(fwd);
  if (keys.KeyD || keys.ArrowRight) wish.add(right);
  if (keys.KeyA || keys.ArrowLeft) wish.sub(right);
  if (wish.lengthSq()) wish.normalize().multiplyScalar(speedBase);
  vel.x = lerp(vel.x, wish.x, 1 - Math.exp(-10 * dt)); vel.z = lerp(vel.z, wish.z, 1 - Math.exp(-10 * dt));
  player.position.x += vel.x * dt; player.position.z += vel.z * dt;
  const moving = Math.hypot(vel.x, vel.z);
  // collisions
  if (scene === roomScene) {
    player.position.x = clamp(player.position.x, roomBounds.minX, roomBounds.maxX);
    player.position.z = clamp(player.position.z, roomBounds.minZ, roomBounds.maxZ);
    // desk block
    const dx = player.position.x - deskAnchor.x, dz = player.position.z - deskAnchor.z;
    const d = Math.hypot(dx, dz); if (d < 0.72 && d > 0.001) { player.position.x = deskAnchor.x + dx / d * 0.72; player.position.z = deskAnchor.z + dz / d * 0.72; }
    // furniture AABBs (bed): push out along smallest penetration
    for (const o of roomObstacles) {
      if (player.position.x > o.minX && player.position.x < o.maxX && player.position.z > o.minZ && player.position.z < o.maxZ) {
        const pl = player.position.x - o.minX, pr = o.maxX - player.position.x, pb = player.position.z - o.minZ, pf = o.maxZ - player.position.z;
        const m = Math.min(pl, pr, pb, pf);
        if (m === pl) player.position.x = o.minX; else if (m === pr) player.position.x = o.maxX;
        else if (m === pb) player.position.z = o.minZ; else player.position.z = o.maxZ;
      }
    }
  } else {
    const d = Math.hypot(player.position.x, player.position.z + 6);
    if (d > 58) { player.position.x *= 58 / d; player.position.z = -6 + (player.position.z + 6) * 58 / d; }
    for (const o of (worldGroup.userData.obstacles || [])) {
      const dx = player.position.x - o.x, dz = player.position.z - o.z, dd = Math.hypot(dx, dz);
      if (dd < o.r && dd > 0.001) { player.position.x = o.x + dx / dd * o.r; player.position.z = o.z + dz / dd * o.r; }
    }
  }
  // head bob + breathing
  bobT += dt * (2 + moving * 1.9);
  const bob = Math.sin(bobT * 2) * 0.016 * clamp(moving / 2.6, 0, 1) + Math.sin(clockTime * 1.4) * 0.004;
  player.position.y = EYE + bob;
  player.rotation.y = yaw; pitchObj.rotation.x = pitch;
}
let bobT = 0;

/* ============ FOCUS / BSOD interaction ============ */
let savedTransform = null, focusAnim = null;
function startFocus() {
  savedTransform = { pos: player.position.clone(), yaw, pitch };
  const targetPos = monitorPos.clone().addScaledVector(monitorFront, 0.66); targetPos.y = monitorPos.y + 0.02;
  const dir = monitorPos.clone().sub(targetPos);
  let tYaw = Math.atan2(-dir.x, -dir.z); const tPitch = Math.atan2(dir.y, Math.hypot(dir.x, dir.z));
  while (tYaw - yaw > Math.PI) tYaw -= Math.PI * 2;
  while (tYaw - yaw < -Math.PI) tYaw += Math.PI * 2;
  if (bsod.mode !== 'bsod') { bsod.mode = 'bsod'; corruption = 0; bsod.setLevel(0); bsod.draw(0, clockTime); bsodTex.needsUpdate = true; monitorLight.color.set(0x2f7fe0); }
  focusAnim = { fromPos: player.position.clone(), toPos: targetPos, fromYaw: yaw, toYaw: tYaw, fromPitch: pitch, toPitch: tPitch, back: false };
  setState(S.TO_FOCUS);
  document.exitPointerLock();
  objective(''); promptEl.classList.add('hidden');
  audio.setLoopVol('rain', 0.05);
  subtitle('モニターが、青い画面のまま固まっている。', 2600);
}
function exitFocus(completed) {
  if (!savedTransform) return;
  let tYaw2 = savedTransform.yaw;
  while (tYaw2 - yaw > Math.PI) tYaw2 -= Math.PI * 2;
  while (tYaw2 - yaw < -Math.PI) tYaw2 += Math.PI * 2;
  focusAnim = { fromPos: player.position.clone(), toPos: savedTransform.pos, fromYaw: yaw, toYaw: tYaw2, fromPitch: pitch, toPitch: savedTransform.pitch, back: true };
  setState(S.FROM_FOCUS);
  document.body.classList.remove('focus-mode', 'face-hover');
}
const raycaster = new THREE.Raycaster();
function updateFaceHover() {
  if (!glassMesh) return;
  raycaster.setFromCamera(mouseNDC, camera);
  const hit = raycaster.intersectObject(glassMesh, false)[0];
  faceHover = false;
  if (hit && hit.uv) {
    const f = bsod.faceUV();
    faceHover = hit.uv.x >= f.x0 && hit.uv.x <= f.x1 && hit.uv.y >= f.y0 && hit.uv.y <= f.y1;
    if (!faceHover) faceHover = hit.uv.x < 0.5 && hit.uv.y > 0.45; // generous fallback
  }
  document.body.classList.toggle('face-hover', faceHover);
}
function handleScreenClick() {
  if (state !== S.FOCUS) return;
  updateFaceHover();
  if (!faceHover) {
    misclicks++;
    audio.play('beep', { vol: 0.12, rate: 0.5 });
    shake(0.06);
    if (misclicks === 2) subtitle('…反応がない。画面の中で、ひとつだけ「こちらを見ている」ものがある。', 3400);
    return;
  }
  corruption = Math.min(12, corruption + 1);
  bsod.setLevel(corruption); bsod.draw(corruption, clockTime); bsodTex.needsUpdate = true;
  audio.clickHard(); audio.glitchBurst(0.25 + corruption * 0.06, 0.22 + corruption * 0.02);
  shake(0.05 + corruption * 0.035);
  monitorLight.intensity = 3.2 + corruption * 0.8;
  if (corruption === 3) subtitle('文字が、剥がれはじめた。', 2200);
  if (corruption === 6) subtitle('違う。これは画面の乱れじゃない。', 2400);
  if (corruption === 9) subtitle('「:(」が、大きくなっている。もとから大きかったような気もする。', 2800);
  if (corruption >= 12) startDevour();
}
let shakeAmp = 0;
function shake(a) { shakeAmp = Math.max(shakeAmp, a); }

/* ============ DEVOUR (light: camera + light + group warp, no post chain) ============ */
let devour = null;
function startDevour() {
  const startPos = player.position.clone();
  devour = { startPos, startYaw: yaw, startPitch: pitch, rise: audio.devourRise(6.5) };
  setState(S.DEVOUR);
  document.body.classList.remove('focus-mode', 'face-hover');
  objective(''); subtitle('', 1);
  audio.setLoopVol('rain', 0.02); audio.glitchBurst(1, 0.8);
}
function updateDevour(dt) {
  const T = 7.2, t = clamp(stateT / T, 0, 1);
  const inten = Math.pow(t, 1.6);
  // resistance curve: slow hesitation, then unstoppable
  const pull = t < 0.32 ? easeInOut(t / 0.32) * 0.22 : 0.22 + easeInOut(clamp((t - 0.32) / 0.68, 0, 1)) * 0.95;
  const through = monitorPos.clone().addScaledVector(monitorFront, -0.55);
  player.position.lerpVectors(devour.startPos, monitorPos, clamp(pull * 0.82, 0, 0.86));
  if (t > 0.55) player.position.lerp(through, (t - 0.55) / 0.45 * 0.9);
  // head struggle: tries to look away (toward door/chair), increasingly fails
  const struggle = Math.sin(stateT * 2.2) * 0.55 * (1 - t) + Math.sin(stateT * 13) * 0.05 * inten;
  const toMon = monitorPos.clone().sub(player.position);
  const baseYaw = Math.atan2(-toMon.x, -toMon.z), basePitch = Math.atan2(toMon.y, Math.hypot(toMon.x, toMon.z));
  yaw = baseYaw + struggle; pitch = basePitch + Math.sin(stateT * 3.1) * 0.14 * (1 - t) - inten * 0.06;
  player.rotation.y = yaw; camera.rotation.x = pitch;
  camera.rotation.z = Math.sin(stateT * 1.7) * 0.06 * inten + struggle * 0.1;
  camera.fov = lerp(72, 108, inten); camera.updateProjectionMatrix();
  // room warps toward the screen (cheap: group transform only)
  roomGroup.rotation.z = Math.sin(stateT * 0.9) * 0.018 * inten;
  roomGroup.rotation.x = -0.012 * inten;
  roomGroup.position.copy(monitorPos).multiplyScalar(-0.06 * inten).setY(0);
  monitorLight.intensity = 3 + inten * 26; lampLight.intensity = 14 * (1 - inten * 0.92) * (Math.random() > inten * 0.6 ? 1 : 0.25);
  bluewashEl.style.opacity = (inten * 0.75).toFixed(3);
  grainEl.style.opacity = (inten * 0.55).toFixed(3);
  vignetteEl.style.opacity = 0.9 + inten * 0.1;
  shakeAmp = Math.max(shakeAmp, inten * 0.055);
  if (stateT > T - 0.9 && stateT < T - 0.7) audio.glitchBurst(1, 0.5);
  if (stateT >= T) finishDevour();
}
function finishDevour() {
  // reset room warp
  roomGroup.rotation.set(0, 0, 0); roomGroup.position.set(0, 0, 0);
  lampLight.intensity = 14; monitorLight.intensity = 3.2; camera.rotation.z = 0; camera.fov = 72; camera.updateProjectionMatrix();
  bluewashEl.style.opacity = 0; grainEl.style.opacity = 0;
  flashEl.style.transition = 'none'; flashEl.style.opacity = 0.95;
  requestAnimationFrame(() => { flashEl.style.transition = 'opacity 1.1s'; flashEl.style.opacity = 0; });
  audio.play('teleport', { vol: 0.6 }); audio.glitchBurst(0.8, 0.6);
  enterWorld();
}
function enterWorld() {
  scene = worldScene; worldScene.add(player);
  player.position.copy(worldSpawn.pos);
  yaw = Math.PI; pitch = 0; // face -Z toward monument (fwd = -sin,-cos => yaw PI faces +Z; correct below)
  yaw = 0; // fwd=(0,0,-1) -> toward monument at -Z. Correct: yaw 0 faces -Z.
  player.rotation.y = yaw; camera.rotation.x = 0;
  fallOffset = 1.1; fallVel = 0; // small landing drop for continuity
  setState(S.WORLD);
  audio.startWorld();
  objective('');
  hintEl.innerHTML = '';
  lockPointer();
  setTimeout(() => { if (state === S.WORLD) subtitle('…どこだ、ここは。', 3000); }, 900);
}

/* ============ CONSOLE ============ */
function consolePrint(text, cls = '') {
  const div = document.createElement('div'); if (cls) div.className = cls;
  div.textContent = text; consoleLog.appendChild(div); consoleLog.scrollTop = consoleLog.scrollHeight;
}
function openConsole() {
  consoleOpen = true; consoleEl.classList.remove('hidden');
  document.exitPointerLock();
  consoleLog.innerHTML = '';
  consolePrint('KERNEL_CONSOLE v0.0.0 — 接続先: UNKNOWN', 'dim');
  consolePrint('この場所の「言葉」は、まだ少しだけ通じる。', 'dim');
  consolePrint(seenWake ? '刻印の言葉を、そのまま入力してみろ。' : 'コマンドを入力せよ。手がかりは、この世界のどこかに刻まれている。', 'dim');
  consolePrint('');
  setTimeout(() => consoleInput.focus(), 30);
  audio.play('terminal', { vol: 0.35 });
}
function closeConsole() {
  consoleOpen = false; consoleEl.classList.add('hidden'); consoleInput.value = '';
  if (state === S.WORLD) lockPointer();
}
consoleInput.addEventListener('keydown', e => {
  e.stopPropagation();
  if (e.key === 'Enter') {
    const raw = consoleInput.value.trim();
    consolePrint('> ' + raw, 'cmd'); consoleInput.value = '';
    handleCommand(raw);
  } else if (e.key === 'Escape') closeConsole();
});
addEventListener('keydown', e => {
  if (consoleOpen && e.code === 'KeyC') { e.preventDefault(); closeConsole(); }
});
const wrongLines = [
  ['ERROR 0x0000005C: その言葉は、ここでは無効だ。', 'err'],
  ['> …聞こえたのは、自分の足音だけだった。', 'dim'],
  ['ERROR: コマンドは飲み込まれました。再試行は推奨されません。', 'err'],
  ['> 入力を受け付けた。意味は、受け付けていない。', 'dim'],
  ['0xDEAD: それは出口の言葉ではない。', 'err'],
];
function handleCommand(raw) {
  const cmd = raw.toUpperCase().replace(/\s+/g, '_');
  audio.play('beep', { vol: 0.18, rate: 1.2 });
  if (cmd === 'WAKE_UP') {
    consolePrint('WAKE_UP …… 認証。', 'ok');
    consolePrint('世界の保持を終了します。足元に注意。', 'ok');
    audio.play('terminal', { vol: 0.4, rate: 0.8 });
    setTimeout(() => { closeConsoleSilent(); startCollapse(); }, 850);
    return;
  }
  if (cmd === 'HELP') { consolePrint('使用可能な断片: STATUS / LOOK / WHOAMI / WAKE_??', 'dim'); consolePrint('最後のひとつは、この世界の中心に刻まれている。', 'dim'); return; }
  if (cmd === 'STATUS') { consolePrint(`PROCESS: YOU.EXE — 状態: ${returned ? '二度目の迷子' : '迷子'} / 整合性: 低下中`, 'dim'); return; }
  if (cmd === 'LOOK') { consolePrint('青い地平。浮かぶ基板。中心の巨像。刻印は、近づけば読める。', 'dim'); return; }
  if (cmd === 'WHOAMI') { consolePrint('USER: ゲスト（招かれていない）', 'dim'); return; }
  if (cmd === 'EXIT' || cmd === 'CLOSE' || cmd === 'QUIT') { consolePrint('コンソールを閉じます。世界は閉じません。', 'dim'); setTimeout(closeConsole, 500); return; }
  if (cmd === '') { consolePrint('> ……', 'dim'); return; }
  if (cmd.includes('WAKE')) { consolePrint('近い。だが、刻印の綴りと完全には一致しない。', 'err'); shake(0.1); return; }
  const [line, cls] = wrongLines[Math.floor(Math.random() * wrongLines.length)];
  consolePrint(line, cls);
  if (Math.random() < 0.5) { shake(0.08); audio.glitchBurst(0.3, 0.2); }
}
function closeConsoleSilent() { consoleOpen = false; consoleEl.classList.add('hidden'); consoleInput.value = ''; }

/* ============ COLLAPSE (forced first-person camera) ============ */
let collapse = null;
function startCollapse() {
  collapse = { events: {}, camVelYaw: 0, camVelPitch: 0, fallV: 0, falling: false, landed: false };
  // tiles under player
  tileGroup.visible = true;
  tileGroup.position.set(player.position.x, 0, player.position.z);
  crackPlane.visible = true; crackPlane.position.set(player.position.x, 0.03, player.position.z);
  tiles.forEach(t => { t.position.copy(t.userData.home); t.rotation.set(0, 0, 0); t.userData.vy = 0; t.userData.falling = false; });
  crackPlane.material.opacity = 0; crackPlane.scale.setScalar(0.3);
  setState(S.COLLAPSE);
  audio.rumble(4, 0.35); audio.play('collapse', { vol: 0.5 });
  subtitle('——何か、来る。', 1800);
}
function headLook(targetYaw, targetPitch, dt, stiff, damp) {
  [yaw, collapse.camVelYaw] = spring(yaw, collapse.camVelYaw, targetYaw, stiff, damp, dt);
  [pitch, collapse.camVelPitch] = spring(pitch, collapse.camVelPitch, targetPitch, stiff, damp, dt);
  player.rotation.y = yaw; camera.rotation.x = pitch;
}
function updateCollapse(dt) {
  const t = stateT; const ev = collapse.events;
  const monDir = MONUMENT_POS.clone().sub(player.position);
  const yawToMon = Math.atan2(-monDir.x, -monDir.z);
  camera.rotation.z = lerp(camera.rotation.z, Math.sin(t * 2.3) * 0.02, dt * 3);

  if (t < 1.15) { // panic: look left, then right
    const target = t < 0.55 ? yawToMon + 1.05 : yawToMon - 1.2;
    headLook(target, -0.05, dt, 90, 9);
    if (!ev.look1) { ev.look1 = 1; subtitle('なんだ。なんだなんだなんだ。', 1400); }
  } else if (t < 2.3) { // realise: look down at feet
    headLook(yawToMon + 0.15, -1.12, dt, 70, 10);
    crackPlane.material.opacity = clamp((t - 1.2) / 0.8, 0, 0.95);
    crackPlane.scale.setScalar(0.3 + (t - 1.2) * 0.75);
    if (!ev.crack) { ev.crack = 1; audio.rumble(3, 0.5); subtitle('足元が——', 1200); }
    shakeAmp = Math.max(shakeAmp, 0.03 + (t - 1.2) * 0.03);
  } else if (t < 4.1) { // follow the crack, tiles start to drop
    headLook(yawToMon - 0.5 + Math.sin(t * 1.4) * 0.35, -0.85 + Math.sin(t * 2) * 0.12, dt, 55, 9);
    tiles.forEach(tile => { if (t > 2.1 + tile.userData.delay * 0.55) tile.userData.falling = true; });
    if (!ev.tiles) { ev.tiles = 1; audio.play('collapse', { vol: 0.45, rate: 0.8 }); }
    shakeAmp = Math.max(shakeAmp, 0.06);
  } else if (t < 5.4) { // stumble back, look up at monument — then floor gives way
    player.position.addScaledVector(new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)), dt * 1.1); // step back
    headLook(yawToMon, 0.34, dt, 60, 9);
    camera.rotation.z = Math.sin(t * 6) * 0.045;
    if (monument) monument.rotation.z = Math.sin(t * 1.2) * 0.006;
    if (!ev.give) { ev.give = 1; audio.rumble(2.5, 0.65); tiles.forEach(tile => tile.userData.falling = true); subtitle('——落ちる。', 1000); }
  } else { // FALL
    if (!collapse.falling) { collapse.falling = true; collapse.fallV = 0; audio.windSwell(4.5); }
    collapse.fallV += 22 * dt;
    player.position.y -= collapse.fallV * dt;
    // gaze: down into the hole, then up at the receding world (spring gives inertia lag)
    const targetPitch = t < 7.2 ? -0.9 : 0.85;
    headLook(yaw + Math.sin(t * 1.8) * 0.22, targetPitch, dt, 26, 6.5);
    camera.fov = lerp(camera.fov, 86, dt * 1.6); camera.updateProjectionMatrix();
    camera.rotation.z = Math.sin(t * 1.3) * 0.08;
    grainEl.style.opacity = clamp((t - 5.4) * 0.2, 0, 0.5);
    bluewashEl.style.opacity = clamp((t - 5.4) * 0.16, 0, 0.6);
    if (t > 8.6 && !ev.flash) { ev.flash = 1; flashEl.style.transition = 'none'; flashEl.style.opacity = 1; }
    if (t > 9.1) returnToRoom();
  }
  // tile physics
  for (const tile of tiles) {
    if (!tile.userData.falling) continue;
    tile.userData.vy += 18 * dt;
    tile.position.y -= tile.userData.vy * dt;
    tile.rotation.x += tile.userData.rx += dt * 0.6; tile.rotation.z += dt * 0.4;
    tile.position.x += Math.sin(tile.id) * dt * 0.4;
  }
  if (monument && t > 5.4) { monument.position.y = 1.2 + (t - 5.4) * 0.4; monument.rotation.y += dt * 0.05; }
}

/* ============ RETURN ============ */
let fallOffset = 0, fallVel = 0, returnAnim = null;
function returnToRoom() {
  scene = roomScene; roomScene.add(player);
  tileGroup.visible = false; crackPlane.visible = false;
  if (monument) { monument.position.y = 1.2; monument.rotation.set(0, 0, 0); }
  camera.fov = 72; camera.updateProjectionMatrix(); camera.rotation.z = 0;
  grainEl.style.opacity = 0; bluewashEl.style.opacity = 0;
  player.position.copy(roomSpawn.pos); yaw = roomSpawn.yaw; pitch = 0;
  player.rotation.y = yaw; camera.rotation.x = 0;
  returned = true;
  bsod.mode = 'after'; bsod.draw(0, clockTime); bsodTex.needsUpdate = true;
  corruption = 0; bsod.setLevel(0); misclicks = 0; seenWake = false;
  if (chairObj) chairObj.rotation.y += 1.15; // chair has turned
  setClock(3, 33);
  monitorLight.color.set(0x6f9fff); monitorLight.intensity = 1.6;
  returnAnim = { drop: 1.5, vel: 0, thudded: false };
  setState(S.RETURN);
  audio.stopLoop('world', 1); audio.stopLoop('wmachine', 1); audio.stopDrone();
  audio.startRoom(true);
  audio.rumble(0.7, 0.4);
  flashEl.style.transition = 'opacity 0.9s'; flashEl.style.opacity = 0;
  setTimeout(() => { $('ending-toast').classList.remove('hidden'); document.exitPointerLock(); }, 1400);
}
$('ending-close').addEventListener('click', () => {
  $('ending-toast').classList.add('hidden');
  if (state === S.RETURN) { setState(S.ROOM); objective(''); lockPointer(); }
});

/* ============ Main loop ============ */
const clock = new THREE.Clock();
let bsodFlickerT = 0, weirdT = 0, clockTickT = 0;
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  clockTime += dt; stateT += dt;

  // camera shake (decaying noise offset, cheap)
  shakeAmp = Math.max(0, shakeAmp - dt * 0.35);
  const shx = (Math.random() - 0.5) * shakeAmp, shy = (Math.random() - 0.5) * shakeAmp;

  switch (state) {
    case S.ROOM: case S.WORLD: {
      if (pointerLocked) updateMovement(dt);
      else { player.rotation.y = yaw; pitchObj.rotation.x = pitch; }
      if (state === S.WORLD) updateWorldAmbient(dt);
      // room prompt
      if (state === S.ROOM) {
        if (nearMonitor()) { promptEl.innerHTML = '<b>[E]</b> PCを調べる'; promptEl.classList.remove('hidden'); }
        else promptEl.classList.add('hidden');
        // after-return anomaly: rare lamp flicker
        if (returned && Math.random() < dt * 0.25) lampLight.intensity = 6 + Math.random() * 10;
        else if (returned) lampLight.intensity = lerp(lampLight.intensity, 14, dt * 2);
      }
      break;
    }
    case S.TO_FOCUS: case S.FROM_FOCUS: {
      const T = 1.5, k = easeInOut(clamp(stateT / T, 0, 1));
      player.position.lerpVectors(focusAnim.fromPos, focusAnim.toPos, k);
      yaw = lerp(focusAnim.fromYaw, focusAnim.toYaw, k); pitch = lerp(focusAnim.fromPitch, focusAnim.toPitch, k);
      // unwrap yaw lerp
      player.rotation.y = yaw; camera.rotation.x = pitch;
      if (stateT >= T) {
        if (focusAnim.back) { setState(S.ROOM); lockPointer(); }
        else { setState(S.FOCUS); document.body.classList.add('focus-mode'); subtitle(returned ? 'また、青い。…今度は最初から、おかしい。' : 'BSOD。固まったままだ。「:(」が、こちらを見ている気がする。', 3200); }
      }
      break;
    }
    case S.FOCUS: {
      updateFaceHover();
      player.rotation.y = yaw; camera.rotation.x = pitch + Math.sin(clockTime * 1.3) * 0.0022; // breathing
      // slow push-in, very subtle
      bsodFlickerT += dt;
      if (corruption >= 3 && bsodFlickerT > 0.12) { bsodFlickerT = 0; bsod.draw(corruption, clockTime); bsodTex.needsUpdate = true; }
      break;
    }
    case S.DEVOUR: updateDevour(dt); break;
    case S.COLLAPSE: updateCollapse(dt); break;
    case S.RETURN: {
      // landing: fall from height with two damped bounces
      if (returnAnim) {
        returnAnim.vel += 26 * dt; returnAnim.drop -= returnAnim.vel * dt;
        if (returnAnim.drop <= 0) {
          returnAnim.drop = 0;
          if (!returnAnim.thudded) { returnAnim.thudded = true; audio.thud(0.55); shake(0.09); }
          returnAnim.vel = -returnAnim.vel * 0.32;
          if (Math.abs(returnAnim.vel) < 1.4) returnAnim = null;
        }
        player.position.y = EYE + (returnAnim ? returnAnim.drop : 0);
      }
      // brief vertigo sway
      camera.rotation.z = Math.sin(stateT * 2.2) * 0.02 * Math.exp(-stateT * 0.8);
      player.rotation.y = yaw; camera.rotation.x = pitch;
      break;
    }
  }

  // world->room continuity drop when entering world
  if (state === S.WORLD && fallOffset > 0) {
    fallVel += 20 * dt; fallOffset -= fallVel * dt;
    if (fallOffset <= 0) { fallOffset = 0; audio.thud(0.3); shake(0.05); }
    player.position.y += fallOffset;
  }

  // apply shake as camera-local offset
  camera.position.x = shx; camera.position.y = shy;

  // dust drift
  if (roomDust) roomDust.rotation.y += dt * 0.006;
  if (worldMotes) { worldMotes.rotation.y += dt * 0.01; }

  // monitor light breathing in BSOD focus
  if (state === S.FOCUS) monitorLight.intensity = 3.2 + corruption * 0.8 + Math.sin(clockTime * 7) * 0.15 * (1 + corruption * 0.3);

  renderer.render(scene, camera);
}
function updateWorldAmbient(dt) {
  const t = clockTime;
  for (const o of floatingSprites) {
    const f = o.userData.float; if (!f) continue;
    o.position.y = f.baseY + Math.sin(t * f.sp + f.ph) * 0.5;
    if (f.rot) o.rotation.y += dt * f.rot;
  }
  if (worldShards) {
    const dummy = new THREE.Object3D(); const items = worldShards.userData.items;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      dummy.position.set(it.x, it.y + Math.sin(t * it.sp + it.ph) * 0.6, it.z);
      dummy.rotation.set(it.rx + t * 0.12, it.ph, it.rz);
      dummy.updateMatrix(); worldShards.setMatrixAt(i, dummy.matrix);
    }
    worldShards.instanceMatrix.needsUpdate = true;
  }
  // WAKE_UP inscription: fades in when close (discovery, not UI)
  const dMon = player.position.distanceTo(MONUMENT_POS);
  const targetOp = dMon < 20 ? clamp(1 - (dMon - 7) / 13, 0.15, 1) : 0;
  wakePlane.material.opacity = lerp(wakePlane.material.opacity, targetOp * (0.82 + Math.sin(t * 2.4) * 0.1), dt * 3);
  if (worldGroup.userData.wakeBack) worldGroup.userData.wakeBack.material.opacity = wakePlane.material.opacity;
  if (dMon < 19 && !seenWake) {
    seenWake = true;
    subtitle('巨像に、言葉が刻まれている。', 3200);
    hintEl.innerHTML = 'C — コンソール';
    setTimeout(() => subtitle('「WAKE_UP」……脱出コマンド、だろうか。', 3400), 3400);
  }
  // distant weird sounds
  weirdT -= dt;
  if (weirdT <= 0) { weirdT = 7 + Math.random() * 11; audio.play(Math.random() > 0.5 ? 'weird1' : 'weird2', { vol: 0.14, rate: 0.7 + Math.random() * 0.5, pan: Math.random() * 2 - 1 }); }
  // monument slow rotation presence
  if (monument) monument.rotation.y = Math.sin(t * 0.05) * 0.04;
}

/* ============ Boot ============ */
$('start-btn').addEventListener('click', async () => {
  await audio.init(); audio.resume(); audio.startRoom(false);
  $('title-screen').classList.add('hidden'); hud.classList.remove('hidden');
  player.position.copy(roomSpawn.pos); yaw = roomSpawn.yaw; pitch = 0;
  setState(S.ROOM);
  objective('自室 — PCの様子がおかしい');
  setTimeout(() => objective(''), 4200);
  subtitle('深夜2時47分。PCが、青い画面のまま固まっている。', 4200);
  hintEl.innerHTML = 'WASD 移動 / E 調べる';
  lockPointer();
});
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
(async () => {
  try {
    await loadAll();
    buildRoom(); buildWorld();
    roomScene.add(player);
    player.position.copy(roomSpawn.pos); yaw = roomSpawn.yaw;
    player.rotation.y = yaw;
    $('loading-screen').classList.add('hidden');
    $('title-screen').classList.remove('hidden');
    setState(S.TITLE);
    animate();
  } catch (e) {
    $('load-status').textContent = '読み込みエラー: ' + e.message;
    console.error(e);
  }
})();
