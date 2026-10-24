// main.js — BSOD_EX orchestration: renderer/post, state machine, sequences
// (inspect -> devour -> world -> collapse -> fall -> return), input, UI, perf.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { initMaterials, makeErrorTextTexture, canvasTex, BASE } from './textures.js';
import { buildRoom, MONITOR_POS, DESK_FRONT } from './room.js';
import { buildWorld, WO, WORLD_SPAWN, SPIRE_POS, WAKE_POS } from './world.js';
import { CollisionWorld, Player } from './player.js';
import { AudioEngine } from './audio.js';
import { GameConsole } from './gameConsole.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const DEV = params.get('dev') === '1';
const AUTOTEST = params.get('autotest') === '1';
const clamp = THREE.MathUtils.clamp, lerp = THREE.MathUtils.lerp;
const smooth = t => t * t * (3 - 2 * t);
const easeIO = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/* ---------------- settings ---------------- */
const SET = Object.assign({ sens: 1.0, vol: .8, glitch: 1.0, bob: 1.0, quality: 'high' },
  JSON.parse(localStorage.getItem('bsod_ex_settings') || '{}'));
const saveSet = () => localStorage.setItem('bsod_ex_settings', JSON.stringify(SET));
const QUALITY = {
  low:   { pr: 1.0,  samples: 0, bloom: false, dirShadow: 0,    flashShadow: false },
  med:   { pr: 1.25, samples: 2, bloom: true,  dirShadow: 1024, flashShadow: false },
  high:  { pr: 1.75, samples: 4, bloom: true,  dirShadow: 2048, flashShadow: true },
  ultra: { pr: 2.25, samples: 4, bloom: true,  dirShadow: 2048, flashShadow: true },
};

/* ---------------- renderer / scene ---------------- */
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.domElement.className = 'webgl';
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.info.autoReset = false; // accumulate across composer passes (reset manually per frame)
$('app').appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
scene.fog = new THREE.FogExp2(0x010204, .05);
const camera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, .05, 2000);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), .04).texture;
scene.environmentIntensity = .16;

const hemi = new THREE.HemisphereLight(0x8fb6dd, 0x1a140f, .14); scene.add(hemi);
const dirLight = new THREE.DirectionalLight(0x7db8ff, 0); // world sun (follows player)
dirLight.castShadow = true; dirLight.shadow.bias = -.0006; dirLight.shadow.camera.near = 1; dirLight.shadow.camera.far = 260;
Object.assign(dirLight.shadow.camera, { left: -55, right: 55, top: 55, bottom: -55 });
scene.add(dirLight, dirLight.target);
const flash = new THREE.SpotLight(0xcfe4ff, 0, 30, .48, .55, 1.25);
flash.castShadow = true; flash.shadow.mapSize.set(1024, 1024); flash.shadow.bias = -.003; flash.shadow.camera.near = .12; flash.shadow.camera.far = 28;
scene.add(flash, flash.target);
let flashOn = false;

/* post: bloom + final film/glitch/warp shader */
let composer, bloomPass, finalPass;
function buildComposer() {
  const q = QUALITY[SET.quality];
  const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: q.samples });
  composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), .38, .35, .82);
  bloomPass.enabled = q.bloom; composer.addPass(bloomPass);
  finalPass = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uGlitch: { value: 0 }, uWarp: { value: 0 },
      uBlur: { value: 0 }, uFlash: { value: 0 }, uCA: { value: .0016 }, uVig: { value: .32 }, uAspect: { value: innerWidth / innerHeight } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `
      uniform sampler2D tDiffuse; uniform float uTime,uGlitch,uWarp,uBlur,uFlash,uCA,uVig,uAspect; varying vec2 vUv;
      float hash(float n){ return fract(sin(n)*43758.5453); }
      void main(){
        vec2 uv = vUv; vec2 c = uv - .5; c.x *= uAspect; float r2 = dot(c,c);
        uv -= (uv - .5) * uWarp * r2 * 2.1;                    // sucked into the screen
        if(uGlitch > .003){                                    // slice glitch (bands, capped rate)
          float band = floor(uv.y * 72.0); float seed = floor(uTime * 17.0);
          float h = hash(band * 12.9 + seed * 78.2);
          if(h > 1.0 - uGlitch * .5) uv.x += (hash(band + seed) - .5) * .14 * uGlitch;
          uv.y += (hash(seed * 3.1) - .5) * .006 * uGlitch;
        }
        vec3 col = vec3(0.0);
        float ca = uCA + uGlitch * .006 + uWarp * .004;
        int taps = uBlur > .01 ? 5 : 1;
        for(int i = 0; i < 5; i++){
          if(i >= taps) break;
          float w = 1.0 / float(taps);
          vec2 off = (uv - .5) * (float(i) * uBlur * .02 * r2 * 4.0);
          vec2 u2 = uv - off;
          col += w * vec3(texture2D(tDiffuse, u2 + vec2(ca,0.)*(0.5+r2)).r,
                          texture2D(tDiffuse, u2).g,
                          texture2D(tDiffuse, u2 - vec2(ca,0.)*(0.5+r2)).b);
        }
        col += (hash(vUv.x * 1234.5 + vUv.y * 987.6 + fract(uTime) * 43.7) - .5) * .045; // film grain
        col *= 1.0 - uVig * smoothstep(.18, 1.05, r2 * 1.6);
        col = mix(col, vec3(.82,.92,1.0), uFlash);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  composer.addPass(finalPass);
  composer.addPass(new OutputPass());
  onResize();
}
const U = () => finalPass.uniforms;

/* ---------------- game objects ---------------- */
const col = new CollisionWorld();
const player = new Player(col);
const audio = new AudioEngine();
let M = null, room = null, world = null;
let state = 'title'; // title|room|inspectIn|inspect|inspectOut|devour|world|collapse|fall|land
let started = false, returned = false, discovered = false, fragCount = 0;
let playTime = 0, bsodClicks = 0, collapseTriggered = false;
const keys = new Set();
let pointerLocked = false, menuOpen = false;
let interactTarget = null; // {kind:'pc'} | {kind:'fragment', f}
const visitedAreas = new Set();
let currentArea = '';

/* tweens */
const tweens = [];
function tween(dur, update, done = null, ease = easeIO, delay = 0) { tweens.push({ t: -delay, dur, update, done, ease }); }
function stepTweens(dt) { for (let i = tweens.length - 1; i >= 0; i--) { const tw = tweens[i]; tw.t += dt; if (tw.t < 0) continue;
  const k = clamp(tw.t / tw.dur, 0, 1); tw.update(tw.ease(k)); if (k >= 1) { tweens.splice(i, 1); tw.done && tw.done(); } } }

/* cinematic camera: eye(→fast) then head(→slow) two-stage look lag */
const cine = { active: false, pos: new THREE.Vector3(), lookEye: new THREE.Vector3(), lookHead: new THREE.Vector3(), roll: 0, fov: 68, tremor: 0 };
function cineStart(fromPos, fromLook) { cine.active = true; cine.pos.copy(fromPos); cine.lookEye.copy(fromLook); cine.lookHead.copy(fromLook); cine.roll = 0; }
function cineUpdate(dt, t, lookTarget, posTarget, posRate = 4) {
  cine.lookEye.lerp(lookTarget, 1 - Math.exp(-13 * dt));
  cine.lookHead.lerp(cine.lookEye, 1 - Math.exp(-4.6 * dt));
  if (posTarget) cine.pos.lerp(posTarget, 1 - Math.exp(-posRate * dt));
  camera.position.copy(cine.pos);
  if (cine.tremor > 0) { const s = cine.tremor * SET.bob;
    camera.position.x += Math.sin(t * 31.7) * .006 * s; camera.position.y += Math.sin(t * 27.3 + 2) * .007 * s; }
  const look = cine.lookHead.clone();
  if (cine.tremor > 0) { look.x += Math.sin(t * 23.1) * .05 * cine.tremor * SET.bob; look.y += Math.cos(t * 19.7) * .04 * cine.tremor * SET.bob; }
  camera.up.set(Math.sin(cine.roll), Math.cos(cine.roll), 0);
  camera.lookAt(look);
  if (Math.abs(camera.fov - cine.fov) > .05) { camera.fov += (cine.fov - camera.fov) * Math.min(1, 5 * dt); camera.updateProjectionMatrix(); }
}
function freeCam(dt, t) {
  const eye = player.eyePos(new THREE.Vector3(), SET.bob);
  camera.position.copy(eye);
  camera.up.set(0, 1, 0);
  camera.rotation.set(0, 0, 0); camera.rotation.order = 'YXZ';
  camera.rotation.y = player.yaw; camera.rotation.x = player.pitch;
  camera.rotation.z = Math.sin(player.bobPhase) * .004 * player.bobAmp * SET.bob + (landDip.roll || 0);
  camera.position.y -= landDip.y || 0;
  if (Math.abs(camera.fov - 68) > .05) { camera.fov += (68 - camera.fov) * Math.min(1, 6 * dt); camera.updateProjectionMatrix(); }
}
const landDip = { y: 0, roll: 0 };

/* ---------------- UI helpers ---------------- */
let captionTimer = 0;
function showCaption(text, dur = 4.6) { const el = $('caption'); el.textContent = text; el.classList.add('show'); captionTimer = dur; }
function setPrompt(html) { const p = $('prompt'); if (html) { p.innerHTML = html; p.classList.remove('hidden'); $('reticle').classList.add('active'); }
  else { p.classList.add('hidden'); $('reticle').classList.remove('active'); } }
const CREDITS = `— CREDITS / 素材クレジット —
■ 3Dモデル: "Lantern" © 2017 Microsoft — CC0 1.0
  KhronosGroup/glTF-Sample-Assets (github.com) より取得し、
  テクスチャを512pxへ変換・青系へ再マテリアル化して使用。
■ PBRテクスチャ: mrdoob/three.js examples (MIT License)
  hardwood2 / brick / FloorsCheckerboard を使用。
■ PBRテクスチャ: ambientCG "Ice002" — CC0 1.0 (three.js同梱分)
■ 追加テクスチャ(任意取得): Poly Haven — CC0 1.0
  ※ scripts/fetch_polyhaven.mjs 実行時のみ差し替わります。
■ 上記以外のモデル・テクスチャ・音源は全て本作のための
  手続き生成／合成による自作素材です。
■ ライブラリ: three.js (MIT) / Vite (MIT)
詳細はリポジトリの CREDITS.md を参照してください。`;

/* ---------------- pointer lock / menu ---------------- */
function lockPointer() { try { const p = renderer.domElement.requestPointerLock({ unadjustedMovement: true });
  if (p && p.catch) p.catch(() => { try { renderer.domElement.requestPointerLock(); } catch (e) { showResume(); } });
} catch (e) { try { renderer.domElement.requestPointerLock(); } catch (e2) { showResume(); } } }
function showResume() { if (started && !menuOpen && !fallbackLook && (state === 'room' || state === 'world') && !cine.active && !gameConsole.isOpen) $('resumeClick').classList.remove('hidden'); }
function hideResume() { $('resumeClick').classList.add('hidden'); }
let lockFailures = 0, fallbackLook = false;
$('resumeClick').addEventListener('click', () => { $('resumeClick').classList.add('hidden'); lockPointer(); audio.resume(); });
document.addEventListener('pointerlockerror', () => { if (fallbackLook) return; lockFailures++;
  if (lockFailures >= 2 && !fallbackLook) { fallbackLook = true; hideResume();
    showCaption('（ポインタロックが使えない環境のため、ドラッグで視点移動に切り替えました）', 5); return; }
  setTimeout(showResume, 60); });
let dragging = false;
renderer.domElement.addEventListener('mousedown', () => { if (!pointerLocked) dragging = true; }); // drag-look whenever not locked
addEventListener('mouseup', () => dragging = false);
document.addEventListener('pointerlockchange', () => {
  pointerLocked = document.pointerLockElement === renderer.domElement;
  if (pointerLocked) { $('resumeClick').classList.add('hidden'); closeMenu(false); }
  else if (started && (state === 'room' || state === 'world') && !gameConsole.isOpen && !menuOpen && !cine.active) openMenu();
});
document.addEventListener('mousemove', e => {
  if (cine.active || gameConsole.isOpen || menuOpen) return;
  if (!pointerLocked && !dragging) return;
  if (state !== 'room' && state !== 'world') return;
  player.yaw -= e.movementX * .0021 * SET.sens;
  player.pitch = clamp(player.pitch - e.movementY * .0021 * SET.sens, -1.52, 1.52);
});
let mouseClient = { x: innerWidth / 2, y: innerHeight / 2 };
addEventListener('mousemove', e => { mouseClient.x = e.clientX; mouseClient.y = e.clientY; });
document.addEventListener('contextmenu', e => { e.preventDefault(); if (state === 'inspect') exitInspect(); });

function openMenu() { if (menuOpen || !started) return; menuOpen = true; $('menu').classList.remove('hidden'); $('resumeClick').classList.add('hidden');
  $('menuStat').textContent = `${returned ? '帰還後 — 自室' : state === 'world' ? 'BSOD世界 — ' + areaLabel(currentArea) : '自室'}　／　断片 ${fragCount} / 7　／　経過 ${fmtTime(playTime)}`; }
function closeMenu(relock = true) { if (!menuOpen) return; menuOpen = false; $('menu').classList.add('hidden'); if (relock) lockPointer(); }
$('btnResume').addEventListener('click', () => { audio.uiClick(); closeMenu(true); });
$('btnRestart').addEventListener('click', () => { audio.uiClick(); closeMenu(false); resetCycle(true); });
$('btnCredits').addEventListener('click', () => { const b = $('creditsBox'); b.textContent = CREDITS; b.classList.toggle('hidden'); });
function bindSlider(id, key, fmt, apply) { const el = $(id), out = $(id + 'V'); el.value = SET[key]; out.textContent = fmt(SET[key]);
  el.addEventListener('input', () => { SET[key] = parseFloat(el.value); out.textContent = fmt(SET[key]); saveSet(); apply && apply(SET[key]); }); }
bindSlider('setSens', 'sens', v => v.toFixed(2));
bindSlider('setVol', 'vol', v => Math.round(v * 100) + '%', v => audio.setVolume(v));
bindSlider('setGlitch', 'glitch', v => Math.round(v * 100) + '%');
bindSlider('setBob', 'bob', v => Math.round(v * 100) + '%');
$('setQuality').value = SET.quality;
$('setQuality').addEventListener('change', e => { SET.quality = e.target.value; saveSet(); applyQuality(); });
function applyQuality() { const q = QUALITY[SET.quality];
  dirLight.castShadow = q.dirShadow > 0;
  if (q.dirShadow > 0 && dirLight.shadow.mapSize.x !== q.dirShadow) { dirLight.shadow.mapSize.set(q.dirShadow, q.dirShadow); if (dirLight.shadow.map) { dirLight.shadow.map.dispose(); dirLight.shadow.map = null; } }
  flash.castShadow = q.flashShadow;
  if (room) room.monitorLight.castShadow = SET.quality !== 'low';
  buildComposer(); }
const fmtTime = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const areaLabel = a => ({ waste: '到着エリア — 青い荒野', arch: '崩壊した大建築', city: '侵食された都市', deep: '深層', plaza: '中心構造物前' }[a] || '不明セクター');

/* ---------------- console ---------------- */
const gameConsole = new GameConsole({
  audio, dev: DEV,
  getStatus: () => { let nearest = null;
    world.fragments.forEach(f => { if (!f.taken) { const d = Math.round(f.pos.distanceTo(player.pos)); if (nearest === null || d < nearest) nearest = d; } });
    return { area: areaLabel(currentArea), fragments: fragCount, fragmentsTotal: 7, discovered,
      nearestFragment: nearest, toSpire: Math.round(SPIRE_POS.distanceTo(player.pos)) }; },
  tryWakeUp: (head) => {
    if (head !== 'wake_up') return 'wrongform';
    if (!discovered || collapseTriggered) return discovered ? 'locked' : 'locked';
    collapseTriggered = true;
    setTimeout(() => { gameConsole.close(); startCollapse(); }, 900);
    return 'ok'; },
  onClose: () => { if ((state === 'world') && !cine.active) lockPointer(); },
  devCommand: (args, say) => devCommand(args, say),
});

/* ---------------- input ---------------- */
addEventListener('keydown', e => {
  if (e.code === 'F3') { e.preventDefault(); $('perf').classList.toggle('hidden'); return; }
  if (gameConsole.isOpen) { if (e.code === 'Escape') gameConsole.close(); return; }
  if (menuOpen) { if (e.code === 'Escape') closeMenu(true); return; }
  if (state === 'inspect') { if (e.code === 'Escape' || e.code === 'KeyE') { e.preventDefault(); exitInspect(); } return; }
  if (e.repeat) { keys.add(e.code); return; }
  keys.add(e.code);
  if (['KeyW','KeyA','KeyS','KeyD'].includes(e.code)) hideResume();
  if (cine.active || !started) return;
  if (e.code === 'Escape' && fallbackLook && (state === 'room' || state === 'world')) { openMenu(); return; }
  if (e.code === 'KeyF') { flashOn = !flashOn; audio._blip(flashOn ? 1560 : 900, .05, .05, 'square'); }
  if (e.code === 'KeyE') doInteract();
  if (e.code === 'KeyC' && state === 'world') { hideResume(); document.exitPointerLock(); gameConsole.open(); }
  if (DEV && e.code.startsWith('Digit')) devJump(parseInt(e.code.slice(5)));
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
renderer.domElement.addEventListener('mousedown', e => {
  if (!started || menuOpen || gameConsole.isOpen) return;
  if (state === 'inspect') { if (e.button === 0) inspectClick(e); return; }
  if (!cine.active && e.button === 0) doInteract();
});
function doInteract() {
  if (!interactTarget || cine.active) return;
  if (interactTarget.kind === 'pc') enterInspect();
  else if (interactTarget.kind === 'fragment') { const f = interactTarget.f;
    f.taken = true; f.mesh.visible = false; f.halo.visible = false; fragCount++;
    audio.fragmentPickup(); showCaption(f.text, 5.2); setPrompt(null); interactTarget = null; }
}

/* ---------------- tunnels & fall shaft ---------------- */
let tunnelRoom, tunnelWorld, tunnelMat;
function buildTunnels() {
  const tex = makeErrorTextTexture({ w: 512, h: 512 }); tex.repeat.set(5, 9);
  tunnelMat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false });
  const geo = new THREE.CylinderGeometry(2.3, 2.3, 74, 20, 1, true); geo.rotateX(Math.PI / 2);
  const mk = () => { const grp = new THREE.Group(); const tube = new THREE.Mesh(geo, tunnelMat); grp.add(tube);
    for (let i = 0; i < 9; i++) { const ring = new THREE.Mesh(new THREE.TorusGeometry(2.05, .05, 6, 28), M.bsodBright);
      ring.position.z = -33 + i * 8; grp.add(ring); } grp.visible = false; scene.add(grp); return grp; };
  tunnelRoom = mk(); tunnelRoom.position.set(MONITOR_POS.x, MONITOR_POS.y, MONITOR_POS.z - 36);
  tunnelWorld = mk(); tunnelWorld.position.set(WORLD_SPAWN.x, WORLD_SPAWN.y + 1.9, WORLD_SPAWN.z + 40); tunnelWorld.rotation.y = Math.PI;
}
let shaft = null, shaftDebris = null, shaftHole = null;
function buildShaft(x, z, topY) {
  if (shaft) { scene.remove(shaft); }
  shaft = new THREE.Group(); shaft.position.set(x, topY, z);
  const wallMat = M.blockNoise.clone(); wallMat.side = THREE.BackSide;
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(13, 13, 300, 18, 1, true), wallMat); wall.position.y = -150; shaft.add(wall);
  shaftDebris = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), M.shardDark, 150); shaftDebris.frustumCulled = false;
  const d = new THREE.Object3D();
  for (let i = 0; i < 150; i++) { const a = Math.random() * Math.PI * 2, r = 5.5 + Math.random() * 6.8;
    d.position.set(Math.cos(a) * r, -Math.random() * 280, Math.sin(a) * r);
    d.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    const s = .5 + Math.random() * 2.6; d.scale.set(s, s * .5, s * .8); d.updateMatrix(); shaftDebris.setMatrixAt(i, d.matrix); }
  shaft.add(shaftDebris);
  for (let i = 0; i < 7; i++) { const s = new THREE.Mesh(new THREE.BoxGeometry(7, 16 + Math.random() * 18, 7), M.monolithFar);
    const a = i / 7 * Math.PI * 2 + .4; s.position.set(Math.cos(a) * 11.6, -30 - i * 36, Math.sin(a) * 11.6); s.rotation.y = a; shaft.add(s); }
  shaftHole = new THREE.Group();
  const rim = new THREE.Mesh(new THREE.RingGeometry(3.1, 12.7, 28), new THREE.MeshBasicMaterial({ color: 0x0d3a80, fog: false, side: THREE.DoubleSide }));
  const core = new THREE.Mesh(new THREE.CircleGeometry(3.15, 24), new THREE.MeshBasicMaterial({ color: 0xeaf6ff, fog: false, side: THREE.DoubleSide }));
  rim.rotation.x = Math.PI / 2; core.rotation.x = Math.PI / 2; shaftHole.add(rim, core);
  shaftHole.position.y = 2.5; shaft.add(shaftHole);
  const glow = new THREE.PointLight(0x6fb4ff, 30, 60, 1.8); glow.name = 'shaftGlow'; shaft.add(glow);
  scene.add(shaft);
}

/* ---------------- sequences ---------------- */
const INSPECT_EYE = MONITOR_POS.clone().add(new THREE.Vector3(0, .02, .6));
function enterInspect() {
  if (state !== 'room') return;
  if (returned) resetCycle(false); // touching the PC again: the loop rewinds completely
  state = 'inspectIn'; setPrompt(null); interactTarget = null; hideResume();
  document.exitPointerLock();
  const fromPos = camera.position.clone(), fromLook = fromPos.clone().add(player.forward(new THREE.Vector3()).multiplyScalar(2));
  cineStart(fromPos, fromLook); cine.fov = 68;
  const lookT = MONITOR_POS.clone();
  tween(1.7, k => { cine.pos.lerpVectors(fromPos, INSPECT_EYE, k);
      cine.lookEye.lerpVectors(fromLook, lookT, k); cine.lookHead.copy(cine.lookEye);
      cine.roll = Math.sin(k * Math.PI) * -.035; cine.fov = lerp(68, 54, k); U().uBlur.value = k * .38; },
    () => { state = 'inspect'; cine.active = true; cine.roll = 0;
      if (bsodClicks === 0) showCaption('画面が、止まっている。…「:(」が、こちらを見ている。', 4.2); });
  audio._blip(700, .08, .03);
}
function exitInspect() {
  if (state !== 'inspect') return;
  state = 'inspectOut';
  const fromPos = cine.pos.clone(), fromLook = cine.lookHead.clone();
  const eyeT = player.eyePos(new THREE.Vector3(), 0);
  const lookT = eyeT.clone().add(player.forward(new THREE.Vector3()).multiplyScalar(2));
  tween(1.15, k => { cine.pos.lerpVectors(fromPos, eyeT, k);
      cine.lookEye.lerpVectors(fromLook, lookT, k); cine.lookHead.copy(cine.lookEye);
      cine.fov = lerp(54, 68, k); U().uBlur.value = (1 - k) * .38; },
    () => { state = 'room'; cine.active = false; lockPointer(); });
}
const _ray = new THREE.Raycaster();
function inspectClick(e) {
  const ndc = new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  _ray.setFromCamera(ndc, camera);
  const hit = _ray.intersectObject(room.screen, false)[0];
  if (!hit || !hit.uv) { audio.uiClick(); return; }
  const s = bsodClicks / 12;
  // face rect in UV space (grows with stage)
  const fw = 250 / 1024 * (1 + s * 1.1), fh = 190 / 600 * (1 + s * 1.1);
  const fx = 78 / 1024 - s * .03, fyTop = 66 / 600 - s * .03;
  const u = hit.uv.x, vTop = 1 - hit.uv.y;
  const inFace = u >= fx - .02 && u <= fx + fw + .03 && vTop >= fyTop - .02 && vTop <= fyTop + fh + .03;
  if (!inFace) { audio.uiClick(); room.drawBSOD(performance.now()); pulseGlitch(.12); return; }
  bsodClicks = Math.min(12, bsodClicks + 1);
  const ns = bsodClicks / 12;
  room.bsodState.stage = ns; room.bsodState.percent = Math.min(99, bsodClicks * 8.3);
  room.bsodState.mouth = clamp((bsodClicks - 9) / 3, 0, 1);
  room.setScreenBulge(ns); room.drawBSOD(performance.now());
  audio.glitchHit(ns); pulseGlitch(.25 + ns * .75);
  glitchBase = ns * .3;
  shakeImpulse = Math.min(1, shakeImpulse + .16 + ns * .5);
  // monitor light dip (single pulse, not a strobe)
  const L = room.monitorLight, base = 14;
  tween(.28, k => { L.intensity = base * (1 - Math.sin(k * Math.PI) * (.3 + ns * .55)); }, null, t => t);
  if (bsodClicks >= 8) { room.faceGroup.visible = true;
    const sc = .24 + (bsodClicks - 8) / 4 * .5; room.faceGroup.scale.setScalar(sc);
    room.mouth.scale.set(Math.max(.001, (bsodClicks - 9.4) / 2.6 * .8), Math.max(.001, (bsodClicks - 9.4) / 2.6), 1); }
  if (bsodClicks === 3) showCaption('……今、文字がずれた？', 3);
  if (bsodClicks === 6) showCaption('やめた方がいい。分かっているのに、指が止まらない。', 3.4);
  if (bsodClicks === 9) showCaption('顔が、画面から——近づいている。', 3.2);
  if (bsodClicks === 11) showCaption('——口が、開く。', 2.6);
  if (bsodClicks >= 12) startDevour();
}
let glitchPulse = 0, glitchBase = 0, shakeImpulse = 0;
function pulseGlitch(v) { glitchPulse = Math.min(1.2, Math.max(glitchPulse, v)); }

function startDevour() {
  state = 'devour'; cine.tremor = .4; hideResume();
  audio.devourSwell(3.6);
  room.faceGroup.visible = true;
  const mouthC = MONITOR_POS.clone().add(new THREE.Vector3(.07, -.07, .1));
  const startPos = cine.pos.clone();
  const through = MONITOR_POS.clone().add(new THREE.Vector3(0, 0, -3));
  const deepIn = MONITOR_POS.clone().add(new THREE.Vector3(0, 0, -34));
  let swapped = false;
  const wStart = new THREE.Vector3(WORLD_SPAWN.x, WORLD_SPAWN.y + 1.95, WORLD_SPAWN.z + 40);
  const wMid = new THREE.Vector3(WORLD_SPAWN.x, WORLD_SPAWN.y + 1.8, WORLD_SPAWN.z + 12);
  const wEnd = new THREE.Vector3(WORLD_SPAWN.x, WORLD_SPAWN.y + 1.62, WORLD_SPAWN.z);
  const curveA = new THREE.CatmullRomCurve3([startPos, mouthC.clone().add(new THREE.Vector3(0, 0, .34)), mouthC, through, deepIn]);
  const curveB = new THREE.CatmullRomCurve3([wStart, wMid, wEnd.clone().add(new THREE.Vector3(0, .5, 3.5)), wEnd]);
  tween(7.4, (kRaw) => { const t = kRaw; // linear-ish custom pacing below
    if (t < .16) { const k = t / .16; // face lunges, room warps
      U().uWarp.value = k * .95; U().uBlur.value = .38 * (1 - k) + k * .3;
      room.faceGroup.scale.setScalar(.74 + k * 2.1);
      room.faceGroup.position.copy(MONITOR_POS).z += k * .55;
      room.mouth.scale.set(.8 + k * 2.4, 1 + k * 3.2, 1);
      cine.fov = lerp(54, 80, k); cine.tremor = .4 + k * 1.6;
      cine.pos.copy(startPos).z -= k * .08; cine.lookEye.copy(mouthC); cine.lookHead.copy(mouthC);
      room.monitorLight.color.setHex(0x6fb4ff); room.monitorLight.intensity = 14 + k * 12;
    } else if (t < .52) { const k = (t - .16) / .36; // through the mouth, into the tunnel
      if (k > .18 && room.group.visible) { room.group.visible = false; tunnelRoom.visible = true; audio.subDrop(); }
      const p = curveA.getPoint(smooth(k)); const ahead = curveA.getPoint(Math.min(1, smooth(k) + .045));
      cine.pos.copy(p); cine.lookEye.copy(ahead); cine.lookHead.lerp(ahead, .5);
      cine.roll = Math.sin(k * Math.PI * 2.2) * .5 * k; cine.tremor = 1.4;
      U().uWarp.value = .95 * (1 - k * .7); pulseGlitch(.5);
      tunnelMat.map.offset.y -= .028;
      if (k > .62 && !swapped) { swapped = true; // seamless mid-tunnel swap room->world
        tunnelRoom.visible = false; world.group.visible = true; tunnelWorld.visible = true;
        setWorldAtmosphere(1); }
    } else { const k = (t - .52) / .48; // emerge over the wasteland, settle at spawn
      const kk = 1 - Math.pow(1 - k, 2.2);
      const p = curveB.getPoint(kk); const ahead = curveB.getPoint(Math.min(1, kk + .05));
      ahead.z -= 6; ahead.y -= .4; // gaze out toward the spire
      cine.pos.copy(p); cine.lookEye.copy(ahead); cine.lookHead.lerp(ahead, .35);
      cine.roll = Math.sin(k * Math.PI) * .14 * (1 - k); cine.tremor = 1.2 * (1 - k);
      cine.fov = lerp(80, 68, k); U().uWarp.value = .3 * (1 - k); U().uBlur.value = .3 * (1 - k);
      tunnelMat.map.offset.y -= .02 * (1 - k);
      if (k > .55) tunnelWorld.visible = false;
    }
  }, () => {
    player.teleport(WORLD_SPAWN.x, WORLD_SPAWN.y, WORLD_SPAWN.z, 0, -.03);
    state = 'world'; cine.active = false; cine.tremor = 0; cine.roll = 0; camera.up.set(0, 1, 0);
    U().uWarp.value = 0; U().uBlur.value = 0; glitchBase = .05;
    room.monitorLight.color.setHex(0x8fc4ff);
    showCaption('— ここは、画面の「中」だ —', 4.5);
    audio.fade('fan', 0, 1); audio.fade('roomtone', 0, 1);
    audio.worldAmbience(); audio.spireHum(new THREE.Vector3(0, 30, 0).add(SPIRE_POS).setY(30));
    audio.fade('drone', .5, 2); audio.fade('wind', .16, 2); audio.fade('spire', 1, 2); audio.setReverb(.5);
    lockPointer();
  }, t => t);
}
function setWorldAtmosphere(k) { // k: 0 room -> 1 world (called discretely + lerped in loop targets)
  atmTarget = { fogColor: new THREE.Color(0x0a3870), fogDensity: .0034, hemiI: .68, dirI: 1.4, exposure: 1.12, envI: .34, bg: new THREE.Color(0x04122e) };
}
let atmTarget = { fogColor: new THREE.Color(0x010204), fogDensity: .05, hemiI: .14, dirI: 0, exposure: 1.05, envI: .16, bg: new THREE.Color(0x000000) };
function setRoomAtmosphere() { atmTarget = { fogColor: new THREE.Color(0x010204), fogDensity: .05, hemiI: .14, dirI: 0, exposure: 1.05, envI: .16, bg: new THREE.Color(0x000000) }; }

/* collapse + fall */
let crackMesh = null, fallChunks = [], disabledGrounds = [], collapseT = 0, fallDepth = 0, fallStartY = 0;
function makeCrackTexture() {
  return canvasTex(512, 512, (c2, w, h) => { c2.clearRect(0, 0, w, h);
    c2.strokeStyle = 'rgba(190,225,255,.95)'; c2.lineCap = 'round';
    for (let i = 0; i < 15; i++) { let x = 256, y = 256; const a = i / 15 * Math.PI * 2 + Math.random() * .4;
      c2.lineWidth = 3.2; c2.beginPath(); c2.moveTo(x, y);
      let d = 0; while (d < 230) { d += 16 + Math.random() * 22; const aa = a + (Math.random() - .5) * .5;
        x = 256 + Math.cos(aa) * d; y = 256 + Math.sin(aa) * d; c2.lineTo(x, y); c2.lineWidth = Math.max(.7, 3.2 - d / 90); }
      c2.stroke(); }
    const grd = c2.createRadialGradient(256, 256, 4, 256, 256, 90);
    grd.addColorStop(0, 'rgba(0,2,10,.96)'); grd.addColorStop(.75, 'rgba(0,4,18,.75)'); grd.addColorStop(1, 'rgba(0,4,18,0)');
    c2.fillStyle = grd; c2.beginPath(); c2.arc(256, 256, 90, 0, 7); c2.fill();
  }, { srgb: true });
}
function startCollapse() {
  if (state !== 'world') return;
  state = 'collapse'; collapseT = 0; setPrompt(null); hideResume();
  document.exitPointerLock();
  const eye = player.eyePos(new THREE.Vector3(), 0);
  cineStart(eye, eye.clone().add(player.forward(new THREE.Vector3()).multiplyScalar(3)));
  cine.fov = 68; cine.tremor = .25;
  // crack decal under the player
  const gy = (col.groundYAt(player.pos.x, player.pos.z, player.pos.y + .5) || { y: player.pos.y }).y;
  if (crackMesh) scene.remove(crackMesh);
  crackMesh = new THREE.Mesh(new THREE.PlaneGeometry(11, 11),
    new THREE.MeshBasicMaterial({ map: makeCrackTexture(), transparent: true, opacity: 0, depthWrite: false }));
  crackMesh.rotation.x = -Math.PI / 2; crackMesh.position.set(player.pos.x, gy + .04, player.pos.z);
  crackMesh.renderOrder = 3; scene.add(crackMesh);
  // ground chunks that will break away
  fallChunks.forEach(c => scene.remove(c.mesh)); fallChunks = [];
  for (let i = 0; i < 16; i++) { const a = Math.random() * Math.PI * 2, r = 1 + Math.random() * 4.6;
    const sx = player.pos.x + Math.cos(a) * r, sz = player.pos.z + Math.sin(a) * r;
    const g2 = col.groundYAt(sx, sz, player.pos.y + .5); const sy = g2 ? g2.y : gy;
    const s = .6 + Math.random() * 1.7;
    const m = new THREE.Mesh(new THREE.BoxGeometry(s, .5, s * .8), i % 3 ? M.shardDark : M.concreteBlue);
    m.position.set(sx, sy - .22, sz); m.rotation.y = Math.random() * 3; m.castShadow = true; m.receiveShadow = true; scene.add(m);
    fallChunks.push({ mesh: m, vy: 0, av: new THREE.Vector3((Math.random() - .5) * 2.4, (Math.random() - .5) * 2, (Math.random() - .5) * 2.4),
      state: 'idle', delay: 3.2 + r * .55 + Math.random() * 1.6, tilt: 0 }); }
  audio.rumble(9); audio.crack(false);
  setTimeout(() => audio.crack(false), 1400); setTimeout(() => audio.crack(true), 3400);
  setTimeout(() => audio.crack(true), 5600); setTimeout(() => audio.crack(true), 7600);
  showCaption('— 世界が、軋んでいる —', 3.2);
}
function updateCollapse(dt, t) {
  collapseT += dt; const T = collapseT;
  const eyeBase = player.eyePos(new THREE.Vector3(), 0);
  const px = player.pos.x, pz = player.pos.z, py = player.pos.y;
  // scripted, human-like gaze: startle left -> right -> up -> down at the cracks -> chase a crack -> feet -> horizon
  const keysLook = [
    [0.0, new THREE.Vector3(px + Math.sin(player.yaw + .2) * -3, py + 1.6, pz + Math.cos(player.yaw) * -3)],
    [.7, new THREE.Vector3(px - 7, py + 1.5, pz - 2)], [1.5, new THREE.Vector3(px - 7.5, py + 1.4, pz - 2.4)],
    [1.9, new THREE.Vector3(px + 7, py + 1.5, pz - 3)], [2.7, new THREE.Vector3(px + 6.5, py + 2.6, pz - 4)],
    [3.2, new THREE.Vector3(px + .5, py + 6.5, pz - 7)],
    [3.9, new THREE.Vector3(px + .3, py - .4, pz + .9)], [5.2, new THREE.Vector3(px - .4, py - .6, pz + .4)],
    [5.7, new THREE.Vector3(px + 2.6, py - .3, pz - 2.2)], [6.8, new THREE.Vector3(px + .8, py - .5, pz - .6)],
    [7.6, new THREE.Vector3(px, py - .8, pz + .2)],
    [8.6, new THREE.Vector3(px - Math.sin(player.yaw) * 8, py + 1.7, pz - Math.cos(player.yaw) * 8)],
    [10.0, new THREE.Vector3(px, py - 1, pz)],
  ];
  let look = keysLook[keysLook.length - 1][1];
  for (let i = 0; i < keysLook.length - 1; i++) { const [t0, v0] = keysLook[i], [t1, v1] = keysLook[i + 1];
    if (T >= t0 && T <= t1) { const k = smooth(clamp((T - t0) / (t1 - t0), 0, 1)); look = v0.clone().lerp(v1, k); break; } }
  // stumbling body: hesitant half-steps away from the cracks + sinking at the end
  const stumble = new THREE.Vector3(
    Math.sin(T * 1.1) * .12 * Math.min(1, T / 3) + (T > 5.6 ? Math.sin((T - 5.6) * 2.4) * .1 : 0),
    (T > 8.4 ? -(T - 8.4) * .16 : 0) + Math.abs(Math.sin(T * 3.1)) * .02 * Math.min(1, T / 4),
    (T > 3.9 ? Math.min(.55, (T - 3.9) * .16) : 0));
  if (T > 3.9 && Math.random() < dt * 2.2) audio.footstep(true, false);
  if (Math.random() < dt * (0.5 + T * .12)) audio.breath(clamp(T / 9, 0, 1));
  cine.tremor = .25 + Math.min(1.4, T * .14);
  cine.roll = Math.sin(T * .9) * .02 + (T > 8.2 ? (T - 8.2) * .05 : 0);
  cineUpdate(dt, t, look, eyeBase.add(stumble), 7);
  glitchBase = .08 + Math.min(.5, T * .05); if (Math.random() < dt * 1.4) pulseGlitch(.35 + T * .05);
  if (crackMesh) { crackMesh.material.opacity = clamp((T - 2.6) / 3.4, 0, 1);
    const sc = .55 + clamp((T - 2.6) / 5.6, 0, 1) * .85; crackMesh.scale.set(sc, sc, 1); }
  for (const c of fallChunks) {
    if (c.state === 'idle' && T > c.delay) c.state = 'tilt';
    if (c.state === 'tilt') { c.tilt += dt * .9; c.mesh.rotation.x += c.av.x * dt * .34; c.mesh.rotation.z += c.av.z * dt * .3;
      c.mesh.position.y -= dt * .1; if (c.tilt > .8) c.state = 'fall'; }
    else if (c.state === 'fall') { c.vy -= 19 * dt; c.mesh.position.y += c.vy * dt;
      c.mesh.rotation.x += c.av.x * dt; c.mesh.rotation.z += c.av.z * dt; }
  }
  if (T > 10.2) startFall();
}
function startFall() {
  state = 'fall'; fallDepth = 0; fallStartY = player.pos.y;
  disabledGrounds = [];
  for (const g of col.grounds) { if (!g.enabled) continue;
    const cx = (g.x0 + g.x1) / 2, cz = (g.z0 + g.z1) / 2;
    const nearX = clamp(player.pos.x, g.x0, g.x1), nearZ = clamp(player.pos.z, g.z0, g.z1);
    if (Math.hypot(player.pos.x - nearX, player.pos.z - nearZ) < 5.5 && g.tag !== 'room-floor') { g.enabled = false; disabledGrounds.push(g); } }
  buildShaft(player.pos.x, player.pos.z, fallStartY + .5);
  player.vel.set(0, 0, 0); player.vy = -1;
  audio.fallWind(); audio.crack(true); audio.rumble(3);
  showCaption('', .1);
}
function updateFall(dt, t) {
  player.updateFall(dt, 20, false);
  fallDepth = fallStartY - player.pos.y;
  const speed01 = clamp(Math.abs(player.vy) / 40, 0, 1);
  audio.setFallWind(speed01);
  if (Math.random() < dt * 1.6) audio.breath(.9);
  // uncontrolled tumbling camera: slowly pitching, brief upward glances at the shrinking hole
  const eye = player.pos.clone(); eye.y += 1.55;
  const upLook = Math.max(0, Math.sin(t * .55)) > .86;
  const look = upLook
    ? new THREE.Vector3(player.pos.x + Math.sin(t * .7) * 2, fallStartY + 4, player.pos.z + Math.cos(t * .6) * 2)
    : new THREE.Vector3(player.pos.x + Math.sin(t * .9) * 5, player.pos.y - 6 - speed01 * 6, player.pos.z + Math.cos(t * .8) * 5);
  cine.roll = Math.sin(t * .8) * .55 * (0.4 + speed01 * .6) * SET.bob;
  cine.tremor = .8 + speed01 * 1.6; cine.fov = 68 + speed01 * 17;
  cineUpdate(dt, t, look, eye, 22);
  pulseGlitch(.25 + speed01 * .4);
  const glow = shaft && shaft.getObjectByName('shaftGlow'); if (glow) glow.position.y = -fallDepth + 2;
  if (fallDepth > 150) { // begin white-out into the room (single soft swell, not a strobe)
    U().uFlash.value = clamp((fallDepth - 150) / 36, 0, .96);
    atmTarget.fogDensity = .012 + (fallDepth - 150) / 36 * .03;
  }
  if (fallDepth > 186) landInRoom();
}
function landInRoom() {
  // continuous momentum: same falling body, now above the bedroom floor
  world.group.visible = false; if (shaft) shaft.visible = false; if (crackMesh) crackMesh.visible = false;
  fallChunks.forEach(c => c.mesh.visible = false);
  room.group.visible = true; room.setAnomaly(true);
  setRoomAtmosphere();
  player.teleport(DESK_FRONT.x, 1.9, DESK_FRONT.z + .25, Math.PI, -.12);
  player.vy = -8.5; fallDepth = 0;
  state = 'land';
  audio.setFallWind(0); audio.fade('drone', 0, .5); audio.fade('wind', 0, .5); audio.fade('spire', 0, .5); audio.fade('deep', 0, .5);
  audio.setReverb(0);
  cine.roll = .1;
}
function updateLand(dt, t) {
  const landedVy = player.updateFall(dt, 24, true);
  const eye = player.eyePos(new THREE.Vector3(), 0);
  const look = eye.clone().add(new THREE.Vector3(Math.sin(t * .5) * .5, -.25 + Math.sin(t * .8) * .15, 1.4));
  cineUpdate(dt, t, look, eye, 20);
  U().uFlash.value = Math.max(0, U().uFlash.value - dt * 1.1);
  if (landedVy !== false) {
    audio.landThud(); shakeImpulse = 1;
    state = 'room'; returned = true; cine.active = false; cine.tremor = 0; cine.roll = 0; camera.up.set(0, 1, 0);
    player.yaw = Math.PI; player.pitch = -.06; // facing the room (away from desk)
    tween(.7, k => { landDip.y = Math.sin(k * Math.PI) * .22; landDip.roll = Math.sin(k * Math.PI * 2) * .05 * (1 - k); },
      () => { landDip.y = 0; landDip.roll = 0; });
    audio.fade('fan', .5, 2); audio.fade('roomtone', .4, 2);
    showCaption('—— 自室だ。……夢、だったのか？', 4.5);
    setTimeout(() => { if (state === 'room' && returned) showEndCard(); }, 6500);
    lockPointer();
  }
}
function showEndCard() {
  $('endStats').innerHTML = `体験時間 ${fmtTime(playTime)}　／　断片 ${fragCount} / 7<br>PCを調べると、もう一度——最初から。`;
  $('endCard').classList.add('show');
  setTimeout(() => $('endCard').classList.remove('show'), 8000);
}

/* ---------------- reset / dev ---------------- */
function resetCycle(toRoomStart) {
  disabledGrounds.forEach(g => g.enabled = true); disabledGrounds = [];
  fallChunks.forEach(c => scene.remove(c.mesh)); fallChunks = [];
  if (crackMesh) { scene.remove(crackMesh); crackMesh = null; }
  if (shaft) { scene.remove(shaft); shaft = null; }
  room.reset(); world.reset();
  bsodClicks = 0; discovered = false; fragCount = 0; collapseTriggered = false; returned = false;
  playTime = 0; visitedAreas.clear(); glitchBase = 0; glitchPulse = 0;
  U().uWarp.value = 0; U().uBlur.value = 0; U().uFlash.value = 0;
  gameConsole.printBoot();
  world.group.visible = false; room.group.visible = true;
  tunnelRoom.visible = false; tunnelWorld.visible = false;
  setRoomAtmosphere();
  audio.fade('drone', 0, .6); audio.fade('wind', 0, .6); audio.fade('spire', 0, .6); audio.fade('deep', 0, .6); audio.setFallWind(0); audio.setReverb(0);
  audio.fade('fan', .5, 1.5); audio.fade('roomtone', .4, 1.5);
  $('endCard').classList.remove('show');
  if (toRoomStart) { player.teleport(.95, 0, 1.2, .3, -.03); state = 'room'; cine.active = false; lockPointer(); }
}
function devJump(n) { hideResume();
  const goWorld = () => { room.group.visible = false; world.group.visible = true; setWorldAtmosphere(1);
    audio.worldAmbience(); audio.spireHum(new THREE.Vector3(0, 30, 0).add(SPIRE_POS).setY(30));
    audio.fade('drone', .5, 1); audio.fade('wind', .16, 1); audio.fade('spire', 1, 1); audio.setReverb(.5); state = 'world'; cine.active = false; };
  if (n === 1) resetCycle(true);
  if (n === 2) { player.teleport(DESK_FRONT.x, 0, DESK_FRONT.z, 0, 0); enterInspect(); }
  if (n === 3) { goWorld(); player.teleport(WORLD_SPAWN.x, WORLD_SPAWN.y, WORLD_SPAWN.z, 0, 0); }
  if (n === 4) { goWorld(); const p = WAKE_POS; player.teleport(p.x, .85, p.z + 6, 0, 0); }
  if (n === 5) { if (state !== 'world') devJump(4); discovered = true; startCollapse(); }
}
function devCommand(args, say) {
  const [c, v] = args.split(/\s+/);
  if (c === 'goto') { devJump({ room: 1, inspect: 2, world: 3, spire: 4, collapse: 5 }[v] || 0); say('jumped: ' + v); }
  else if (c === 'givekey') { discovered = true; say('WAKE_UP discovered (debug)'); }
  else if (c === 'pos') say(`pos ${player.pos.x.toFixed(1)}, ${player.pos.y.toFixed(1)}, ${player.pos.z.toFixed(1)} area=${currentArea} state=${state}`);
  else say('debug: goto room|inspect|world|spire|collapse / givekey / pos');
}

/* ---------------- boot ---------------- */
async function loadLantern() {
  try {
    const gltf = await new GLTFLoader().loadAsync(BASE + 'models/Lantern/Lantern.gltf');
    const obj = gltf.scene;
    const bb = new THREE.Box3().setFromObject(obj);
    const h = bb.max.y - bb.min.y, s = 3.55 / (h || 1);
    const wrap = new THREE.Group(); obj.scale.setScalar(s);
    obj.position.set(-(bb.min.x + bb.max.x) / 2 * s, -bb.min.y * s, -(bb.min.z + bb.max.z) / 2 * s);
    wrap.add(obj); return wrap;
  } catch (e) { console.warn('[assets] Lantern load failed, using procedural lamps:', e && e.message); return null; }
}
async function boot() {
  const loadEl = $('titleLoad');
  M = await initMaterials(p => { loadEl.textContent = 'LOADING TEXTURES ' + Math.round(p * 60) + '%'; });
  loadEl.textContent = 'LOADING MODEL 70%';
  const lantern = await loadLantern();
  loadEl.textContent = 'BUILDING WORLD 85%';
  room = buildRoom(M, col); scene.add(room.group);
  world = buildWorld(M, col, lantern); world.group.visible = false; scene.add(world.group);
  buildTunnels();
  buildComposer(); applyQualityRefs();
  player.teleport(.95, 0, 1.2, .3, -.03);
  player.onFootstep = (run) => audio.footstep(state === 'world' || state === 'collapse', run);
  console.info('[BSOD_EX] external textures:', M._extLoaded, 'lantern:', !!lantern);
  loadEl.textContent = AUTOTEST ? 'AUTOTEST…' : 'READY';
  if (AUTOTEST) startAutotest();
}
function applyQualityRefs() { const q = QUALITY[SET.quality];
  dirLight.castShadow = q.dirShadow > 0;
  if (q.dirShadow > 0) dirLight.shadow.mapSize.set(q.dirShadow, q.dirShadow);
  flash.castShadow = q.flashShadow;
  if (room) room.monitorLight.castShadow = SET.quality !== 'low';
}
$('title').addEventListener('click', () => {
  if (started || !world) return;
  started = true; state = 'room';
  audio.init(); audio.setVolume(SET.vol); audio.resume();
  audio.roomAmbience(room.fanPos, room.clockPos);
  audio.fade('fan', .5, 2.5); audio.fade('roomtone', .4, 2.5);
  const tt = $('title'); tt.style.transition = 'opacity 1.1s'; tt.style.opacity = '0';
  setTimeout(() => tt.classList.add('hidden'), 1150);
  $('reticle').classList.remove('hidden');
  lockPointer();
  showCaption('午前3時32分。眠れない夜だった。', 4.4);
});

/* autotest: flies the player through every area, then reports fps (for README measurement) */
let autotest = null;
function startAutotest() {
  $('title').classList.add('hidden'); $('perf').classList.remove('hidden');
  started = true; audio.init();
  devJump(3);
  autotest = { t: 0, frames: [] };
  showCaption('AUTOTEST: measuring…', 30);
}
function updateAutotest(dt) {
  autotest.t += dt; autotest.frames.push(dt);
  const T = autotest.t;
  const path = [[0, .42, 2], [-6, 0, -60], [4, 0, -120], [4, 0, -150], [12.6, 4.4, -160], [-4, 4.4, -182], [-10, 0, -200], [-4, 0, -250], [-3, 0, -292], [-3, 0, -340], [0, .85, -372]];
  const seg = clamp(T / 40, 0, .999) * (path.length - 1); const i = Math.floor(seg), k = seg - i;
  const a = path[i], b = path[i + 1];
  player.teleport(lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k) + WO.z, Math.sin(T * .4) * .7, Math.sin(T * .3) * .15);
  if (T > 42) { const f = autotest.frames.slice(60); f.sort((x, y) => x - y);
    const avg = f.reduce((s, v) => s + v, 0) / f.length; const p99 = f[Math.floor(f.length * .99)];
    const msg = `AUTOTEST RESULT avg ${(1 / avg).toFixed(1)} fps / 1% low ${(1 / p99).toFixed(1)} fps / calls ${renderer.info.render.calls} / tris ${(renderer.info.render.triangles / 1000).toFixed(0)}k`;
    console.info(msg); document.title = msg; showCaption(msg, 600); autotest = null; state = 'world'; }
}

/* ---------------- per-frame ---------------- */
let last = performance.now(), elapsed = 0, carTimer = 14, chirpTimer = 6, bsodRedraw = 0;
let dynScale = 1, emaFrame = 16, dynTimer = 0;
const frameTimes = [];
function updateInteract() {
  interactTarget = null; let prompt = null;
  if (state === 'room' && !cine.active) {
    const d = player.pos.distanceTo(new THREE.Vector3(MONITOR_POS.x, 0, MONITOR_POS.z));
    const toMon = MONITOR_POS.clone().sub(player.eyePos(new THREE.Vector3(), 0)).normalize();
    const facing = player.forward(new THREE.Vector3()).dot(toMon) > .5;
    if (d < 1.7 && facing) { interactTarget = { kind: 'pc' }; prompt = '<b>E</b>PCを調べる'; }
  } else if (state === 'world' && !cine.active) {
    let best = null, bd = 2.4;
    for (const f of world.fragments) { if (f.taken) continue; const d = f.pos.distanceTo(player.pos.clone().setY(f.pos.y));
      if (d < bd) { bd = d; best = f; } }
    if (best) { interactTarget = { kind: 'fragment', f: best }; prompt = '<b>E</b>断片に触れる'; }
  }
  setPrompt(prompt);
}
function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const rawDt = (now - last) / 1000; last = now;
  let dt = Math.min(.083, rawDt); elapsed += dt; const t = elapsed;
  frameTimes.push(rawDt); if (frameTimes.length > 300) frameTimes.shift();
  if (!world) { renderer.render(scene, camera); return; }
  renderer.info.reset();
  stepTweens(dt);
  if (autotest) updateAutotest(dt);

  /* dynamic resolution: keep 60fps before prettiness */
  emaFrame = emaFrame * .95 + rawDt * 1000 * .05; dynTimer -= dt;
  if (dynTimer <= 0) { dynTimer = .5;
    if (emaFrame > 19 && dynScale > .58) dynScale = Math.max(.58, dynScale - .09);
    else if (emaFrame < 14.5 && dynScale < 1) dynScale = Math.min(1, dynScale + .05);
    const pr = Math.min(devicePixelRatio || 1, QUALITY[SET.quality].pr) * dynScale;
    if (Math.abs(renderer.getPixelRatio() - pr) > .02) { renderer.setPixelRatio(pr); composer.setPixelRatio(pr); onResize(); } }

  const inWorld = state === 'world' || state === 'collapse' || state === 'fall';
  if (started && !menuOpen && !gameConsole.isOpen && state !== 'title') playTime += dt;

  /* --- state updates --- */
  if (state === 'title') { // slow drift behind the (fading) title
    const p = new THREE.Vector3(.95 + Math.sin(t * .1) * .14, 1.6, 1.2);
    camera.position.copy(p); camera.lookAt(MONITOR_POS.x, 1.05, MONITOR_POS.z); camera.up.set(0, 1, 0);
  } else if (state === 'room' || state === 'world') {
    const canControl = started && !gameConsole.isOpen && !menuOpen; // keys always move you (lock/drag only affect looking)
    if (canControl) {
      const f = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
      const r = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
      player.updateWalk(dt, { f, r, sprint: keys.has('ShiftLeft') || keys.has('ShiftRight') }, SET.bob);
    } else player.updateWalk(dt, { f: 0, r: 0, sprint: false }, SET.bob);
    freeCam(dt, t);
    updateInteract();
  } else if (state === 'inspectIn' || state === 'inspectOut' || state === 'devour') {
    if (state !== 'devour' || true) cineUpdate(dt, t, cine.lookEye, null, 0); // pos driven by tween
    if (state === 'inspectIn' || state === 'inspectOut') { /* tween drives cine */ }
  } else if (state === 'inspect') { // subtle mouse parallax — you are leaning in
    const nx = (mouseClient.x / innerWidth - .5), ny = (mouseClient.y / innerHeight - .5);
    const par = INSPECT_EYE.clone(); par.x += nx * .05; par.y -= ny * .035;
    const look = MONITOR_POS.clone(); look.x += nx * .06; look.y -= ny * .05;
    cine.pos.lerp(par, 1 - Math.exp(-7 * dt));
    cineUpdate(dt, t, look, null, 0);
    bsodRedraw -= dt;
    if (bsodRedraw <= 0) { bsodRedraw = .15; room.bsodState.percent = clamp(room.bsodState.percent + .06, 0, 99); room.drawBSOD(now); }
  } else if (state === 'collapse') updateCollapse(dt, t);
  else if (state === 'fall') updateFall(dt, t);
  else if (state === 'land') updateLand(dt, t);

  if (state === 'devour') { /* look/pos set inside tween; still apply roll/up */ camera.up.set(Math.sin(cine.roll), Math.cos(cine.roll), 0); }

  /* --- world/room life --- */
  if (room.group.visible) room.update(dt, t, (state === 'room' || state === 'title') ? audio : null);
  if (world.group.visible) world.update(dt, t, player.pos, glitchPulse * SET.glitch);
  if (inWorld) {
    currentArea = world.areaAt(player.pos);
    if (!visitedAreas.has(currentArea) && state === 'world') { visitedAreas.add(currentArea);
      const caps = { waste: '到着エリア — 遠くの塔が、信号を放っている', arch: '崩壊した大建築 — 上階の回廊が見える',
        city: '侵食された都市 — 街路がエラー文字に食われている', deep: '深層 — ライト［F］が要る暗さだ', plaza: '中心構造物 — 信号の源はここだ' };
      if (currentArea !== 'waste') showCaption(caps[currentArea], 4.2); }
    audio.fade('deep', currentArea === 'deep' ? .4 : .05, 1.5);
    atmTarget.fogDensity = state === 'fall' ? atmTarget.fogDensity : (currentArea === 'deep' ? .016 : currentArea === 'arch' ? .005 : .0034);
    chirpTimer -= dt; if (chirpTimer <= 0) { chirpTimer = 3 + Math.random() * 8; audio.dataChirp(); }
    // WAKE_UP discovery: close + looking at the wall
    if (!discovered && state === 'world') {
      const d = player.pos.distanceTo(WAKE_POS);
      if (d < 14) { const to = WAKE_POS.clone().sub(player.eyePos(new THREE.Vector3(), 0)).normalize();
        if (player.forward(new THREE.Vector3()).dot(to) > .55) { discovered = true; audio.discover();
          showCaption('壊れた文字の中で、その言葉だけが安定して読めた — 「WAKE_UP」', 5.5); pulseGlitch(.3); } } }
    // sun follows (snapped to reduce shadow shimmer)
    const sx = Math.round(player.pos.x / 8) * 8, sz = Math.round(player.pos.z / 8) * 8;
    dirLight.position.set(sx + 46, 84, sz + 30); dirLight.target.position.set(sx, 0, sz);
  }
  if (state === 'room') { carTimer -= dt; if (carTimer <= 0) { carTimer = 17 + Math.random() * 22; audio.distantCar(); } }

  /* flashlight follows with a whisper of lag */
  const eyeNow = camera.position;
  flash.intensity += (((flashOn && started && !cine.active) || (flashOn && state === 'inspect')) ? 30 : 0) * 0 + ((flashOn ? 30 : 0) - flash.intensity) * Math.min(1, 14 * dt);
  flash.position.copy(eyeNow);
  const fwd = new THREE.Vector3(); camera.getWorldDirection(fwd);
  flash.target.position.copy(eyeNow).addScaledVector(fwd, 7);

  /* atmosphere easing */
  scene.fog.color.lerp(atmTarget.fogColor, Math.min(1, 1.6 * dt));
  scene.fog.density += (atmTarget.fogDensity - scene.fog.density) * Math.min(1, 1.6 * dt);
  hemi.intensity += (atmTarget.hemiI - hemi.intensity) * Math.min(1, 1.6 * dt);
  dirLight.intensity += (atmTarget.dirI - dirLight.intensity) * Math.min(1, 1.6 * dt);
  renderer.toneMappingExposure += (atmTarget.exposure - renderer.toneMappingExposure) * Math.min(1, 1.6 * dt);
  scene.environmentIntensity += (atmTarget.envI - scene.environmentIntensity) * Math.min(1, 1.6 * dt);
  scene.background = atmTarget.bg;

  /* post uniforms */
  glitchPulse = Math.max(0, glitchPulse - dt * 1.7);
  shakeImpulse = Math.max(0, shakeImpulse - dt * 2.6);
  const u = U(); u.uTime.value = t;
  if (state !== 'fall') u.uFlash.value = Math.max(0, u.uFlash.value - dt * .85); // eyes adjust after landing
  u.uGlitch.value = clamp((glitchBase + glitchPulse) * SET.glitch, 0, 1);
  if (shakeImpulse > 0 && !cine.active) { camera.position.x += (Math.random() - .5) * .03 * shakeImpulse * SET.bob;
    camera.position.y += (Math.random() - .5) * .03 * shakeImpulse * SET.bob; }

  /* audio listener + captions timer + perf */
  if (audio.ready) { const up = new THREE.Vector3(0, 1, 0); audio.setListener(camera.position, fwd, up); }
  if (captionTimer > 0) { captionTimer -= dt; if (captionTimer <= 0) $('caption').classList.remove('show'); }
  if (!$('perf').classList.contains('hidden') && (perfTick += dt) > .25) { perfTick = 0;
    const f = frameTimes.slice(); const avg = f.reduce((s, v) => s + v, 0) / Math.max(1, f.length);
    const sorted = f.sort((a, b) => a - b); const p99 = sorted[Math.floor(sorted.length * .99)] || avg;
    $('perf').textContent =
      `fps avg ${(1 / avg).toFixed(0)}  1%low ${(1 / p99).toFixed(0)}  frame ${(avg * 1000).toFixed(1)}ms\n` +
      `calls ${lastRenderInfo.calls}  tris ${(lastRenderInfo.triangles / 1000).toFixed(0)}k  res x${dynScale.toFixed(2)}\n` +
      `state ${state}  area ${currentArea || '-'}  pos ${player.pos.x.toFixed(0)},${player.pos.y.toFixed(0)},${player.pos.z.toFixed(0)}`; }

  composer.render();
  lastRenderInfo.calls = renderer.info.render.calls; lastRenderInfo.triangles = renderer.info.render.triangles;
}
let perfTick = 0;
const lastRenderInfo = { calls: 0, triangles: 0 };
function onResize() { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); if (composer) composer.setSize(innerWidth, innerHeight);
  if (finalPass) finalPass.uniforms.uAspect.value = innerWidth / innerHeight; }
addEventListener('resize', onResize);
document.addEventListener('visibilitychange', () => { last = performance.now(); keys.clear(); });

if (DEV) window.__bsod = { get state() { return state; }, get clicks() { return bsodClicks; },
  get dbg() { return { pointerLocked, fallbackLook, menuOpen, lockFailures, keys: [...keys] }; },
  get discovered() { return discovered; }, get frags() { return fragCount; }, player, jump: devJump,
  inspectClickAt: (x, y) => inspectClick({ clientX: x, clientY: y }) };
boot();
animate();
