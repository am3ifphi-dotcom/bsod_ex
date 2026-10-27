// ヘッドレス統合スモークテスト: WebGL/DOM/Audioをモックし、実際のゲームロジックを全工程で実行する
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------------- DOM mock ----------------
function makeClassList() {
  const set = new Set(['hidden'].slice(0, 0));
  return {
    add: (c) => set.add(c), remove: (c) => set.delete(c), toggle: (c, f) => (f ? set.add(c) : set.delete(c)),
    contains: (c) => set.has(c),
  };
}
function makeEl(tag = 'div') {
  const el = {
    tagName: tag.toUpperCase(), style: {}, children: [], _innerHTML: '',
    classList: makeClassList(),
    addEventListener() {}, removeEventListener() {}, appendChild(c) { this.children.push(c); return c; },
    removeChild() {}, querySelector() { return makeEl(); }, querySelectorAll() { return []; },
    setAttribute() {}, removeAttribute() {}, focus() {}, blur() {}, click() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720, right: 1280, bottom: 720 }),
    getContext() { return null; },
    get lastChild() { return this.children[this.children.length - 1]; },
    get firstChild() { return this.children[0]; },
    get lastElementChild() { return this.children[this.children.length - 1]; },
    scrollTop: 0,
    offsetWidth: 1,
  };
  Object.defineProperty(el, 'innerHTML', { get() { return el._innerHTML; }, set(v) { el._innerHTML = v; } });
  Object.defineProperty(el, 'textContent', { get() { return el._text || ''; }, set(v) { el._text = v; } });
  Object.defineProperty(el, 'value', { get() { return el._value || ''; }, set(v) { el._value = v; } });
  return el;
}

const elements = new Map();
function getEl(id) {
  if (!elements.has(id)) elements.set(id, makeEl(id));
  return elements.get(id);
}

const canvas2dMock = () => new Proxy({}, {
  get(t, p) {
    if (p === 'measureText') return () => ({ width: 10, actualBoundingBoxAscent: 8 });
    if (p === 'createLinearGradient' || p === 'createRadialGradient') return () => ({ addColorStop() {} });
    if (p === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
    if (typeof p === 'string') return (..._a) => undefined;
    return undefined;
  },
  set() { return true; },
});

function makeCanvas() {
  const c = makeEl('canvas');
  c.width = 1280; c.height = 720;
  c.getContext = (type) => (type === '2d' ? canvas2dMock() : glProxy);
  c.addEventListener = () => {};
  return c;
}

// ---------------- WebGL mock ----------------
const GL_ENUM = {
  POINTS: 0, LINES: 1, LINE_LOOP: 2, LINE_STRIP: 3, TRIANGLES: 4, TRIANGLE_STRIP: 5, TRIANGLE_FAN: 6,
  ARRAY_BUFFER: 34962, ELEMENT_ARRAY_BUFFER: 34963, UNIFORM_BUFFER: 35345, TEXTURE_2D: 3553,
  TEXTURE_CUBE_MAP: 34067, TEXTURE_3D: 32879, RGBA: 6408, RGB: 6407, UNSIGNED_BYTE: 5121,
  UNSIGNED_INT: 5125, UNSIGNED_SHORT: 5123, FLOAT: 5126, INT: 5124, HALF_FLOAT: 36193,
  FRAMEBUFFER: 36160, RENDERBUFFER: 36161, COLOR_ATTACHMENT0: 36064, DEPTH_ATTACHMENT: 36096,
  DEPTH_COMPONENT16: 33189, DEPTH_COMPONENT24: 33190, STENCIL_ATTACHMENT: 36128,
  COMPILE_STATUS: 35713, LINK_STATUS: 35714, ACTIVE_UNIFORMS: 35718, ACTIVE_ATTRIBUTES: 35721,
  ACTIVE_UNIFORM_BLOCKS: 35382, UNIFORM_BLOCK_DATA_SIZE: 35392, UNIFORM_BLOCK_ACTIVE_UNIFORMS: 35394,
  UNIFORM_BLOCK_ACTIVE_UNIFORM_INDICES: 35395, UNIFORM_BLOCK_REFERENCED_BY_VERTEX_SHADER: 35398,
  UNIFORM_BLOCK_REFERENCED_BY_FRAGMENT_SHADER: 35399, TEXTURE0: 33984, MAX_TEXTURE_IMAGE_UNITS: 34930,
  MAX_VERTEX_TEXTURE_IMAGE_UNITS: 35660, MAX_COMBINED_TEXTURE_IMAGE_UNITS: 35661,
  FRAGMENT_SHADER: 35632, VERTEX_SHADER: 35633, STATIC_DRAW: 35044, DYNAMIC_DRAW: 35048,
  COLOR_BUFFER_BIT: 16384, DEPTH_BUFFER_BIT: 256, STENCIL_BUFFER_BIT: 1024, LEQUAL: 515, LESS: 513,
  ALWAYS: 519, NEAREST: 9728, LINEAR: 9729, REPEAT: 10497, CLAMP_TO_EDGE: 33071,
  MIRRORED_REPEAT: 33648, TEXTURE_MAG_FILTER: 10240, TEXTURE_MIN_FILTER: 10241, TEXTURE_WRAP_S: 10242,
  TEXTURE_WRAP_T: 10243, TEXTURE_WRAP_R: 32882, TEXTURE_CUBE_MAP_POSITIVE_X: 34069,
  TEXTURE_CUBE_MAP_NEGATIVE_X: 34070, TEXTURE_CUBE_MAP_POSITIVE_Y: 34071, TEXTURE_CUBE_MAP_NEGATIVE_Y: 34072,
  TEXTURE_CUBE_MAP_POSITIVE_Z: 34073, TEXTURE_CUBE_MAP_NEGATIVE_Z: 34074, DRAW_FRAMEBUFFER: 36009,
  READ_FRAMEBUFFER: 36008, TEXTURE_2D_MULTISAMPLE: 37120, R8: 33321, RG8: 33323, R16F: 33325,
  RG16F: 33327, R32F: 33326, RG32F: 33328, RGBA8: 32856, RGBA16F: 34842, RGBA32F: 34836,
  SRGB8_ALPHA8: 35907, TEXTURE_COMPARE_MODE: 34892, COMPARE_REF_TO_TEXTURE: 34894,
  TEXTURE_MIN_LOD: 33082, TEXTURE_MAX_LOD: 33083, TEXTURE_BASE_LEVEL: 35056, TEXTURE_MAX_LEVEL: 33085,
  UNPACK_FLIP_Y_WEBGL: 37440, UNPACK_PREMULTIPLY_ALPHA_WEBGL: 37441, UNPACK_ALIGNMENT: 3317,
  PACK_ALIGNMENT: 3333, COLOR_WRITEMASK: 31067, DEPTH_WRITEMASK: 31068, DEPTH_FUNC: 31069,
  DEPTH_TEST: 2929, BLEND: 3042, CULL_FACE: 2884, FRONT: 1028, BACK: 1029,
};
const glProxy = new Proxy({}, {
  get(_t, prop) {
    if (prop in GL_ENUM) return GL_ENUM[prop];
    if (prop === 'canvas') return makeCanvas();
    if (prop === 'drawingBufferWidth' || prop === 'drawingBufferHeight') return 1280;
    if (prop === 'getParameter') return (p) => {
      if (p === 0x1f00) return 'WebKit';
      if (p === 0x1f01) return 'MockGL';
      if (p === 0x1f02) return 'WebGL 2.0';
      if (p === 0x8869) return 16; // MAX_VERTEX_UNIFORM_VECTORS
      if (typeof p === 'number') return 16;
      return 'mock';
    };
    if (prop === 'getExtension') return () => new Proxy({}, { get: () => () => undefined, set: () => true });
    if (prop === 'getSupportedExtensions') return () => ['WEBGL_draw_buffers', 'EXT_texture_filter_anisotropic', 'OES_texture_half_float', 'WEBGL_compressed_texture_s3tc'];
    if (prop === 'getShaderPrecisionFormat') return () => ({ rangeMin: 127, rangeMax: 127, precision: 23 });
    if (prop === 'createTexture' || prop === 'createBuffer' || prop === 'createFramebuffer' ||
        prop === 'createRenderbuffer' || prop === 'createShader' || prop === 'createProgram' ||
        prop === 'createQuery' || prop === 'createSampler' || prop === 'createTransformFeedback' ||
        prop === 'createVertexArray' || prop === 'createFenceSync') return () => ({});
    if (prop === 'checkFramebufferStatus') return () => 0x8cd5;
    if (prop === 'getError') return () => 0;
    if (prop === 'isContextLost') return () => false;
    if (prop === 'getProgramInfoLog' || prop === 'getShaderInfoLog') return () => '';
    if (prop === 'getUniformLocation' || prop === 'getAttribLocation') return () => ({});
    if (prop === 'getShaderSource' || prop === 'getShaderParameter' || prop === 'getProgramParameter') return () => 1;
    if (prop === 'getActiveUniform' || prop === 'getActiveAttrib') return () => ({ name: 'mock', size: 1, type: 0x8b51 });
    if (prop === 'getActiveUniformBlockParameter') return () => 1;
    return () => undefined;
  },
  set() { return true; },
});

// ---------------- globals ----------------
const listeners = {};
const def = (k, v) => { try { Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true }); } catch { try { globalThis[k] = v; } catch {} } };
def('window', globalThis);
def('self', globalThis);
def('addEventListener', () => {});
def('removeEventListener', () => {});
def('devicePixelRatio', 1);
def('innerWidth', 1280); def('innerHeight', 720);
def('requestAnimationFrame', (cb) => setTimeout(() => cb(performance.now()), 16));
def('cancelAnimationFrame', (id) => clearTimeout(id));
def('document', {
  getElementById: getEl,
  querySelector: () => makeEl('q'),
  querySelectorAll: () => [],
  createElement: (tag) => (tag === 'canvas' ? makeCanvas() : makeEl(tag)),
  createElementNS: (_ns, tag) => (tag === 'canvas' ? makeCanvas() : new globalThis.Image()),
  addEventListener: (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); },
  removeEventListener() {},
  body: makeEl('body'),
  pointerLockElement: null,
  exitPointerLock() {},
  hidden: false,
});
def('navigator', { userAgent: 'node-mock', hardwareConcurrency: 4 });
def('location', { href: 'http://localhost/', reload() {} });
// three r160のFileLoaderはfetch/Requestを使う: 相対URLをpublic/へ向けるモック
class MockRequest {
  constructor(input, init) { this.url = String(input); this.init = init || {}; }
}
def('Request', MockRequest);
def('fetch', async (req) => {
  const rel = String(req.url || req).replace(/^https?:\/\/[^/]+\//, '').replace(/^\.?\//, '');
  const p = path.join(root, 'public', rel);
  const data = fs.readFileSync(p);
  return {
    ok: true, status: 200, headers: { get: () => null },
    arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    text: async () => data.toString(),
    json: async () => JSON.parse(data.toString()),
    blob: async () => ({ size: data.byteLength, type: '' }),
  };
});
try { URL.createObjectURL = () => 'blob:mock'; URL.revokeObjectURL = () => {}; } catch {}
def('Image', class {
  constructor() { this._listeners = {}; this.width = 64; this.height = 64; }
  addEventListener(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); }
  removeEventListener() {}
  set src(v) {
    this._src = v;
    if (String(v).startsWith('data:')) { this.width = 1; this.height = 1; }
    setTimeout(() => {
      this.onload && this.onload();
      (this._listeners.load || []).forEach((fn) => fn());
    }, 0);
  }
  get src() { return this._src; }
});
def('ImageBitmap', class {});
def('createImageBitmap', async () => ({ width: 4, height: 4, close() {} }));
def('HTMLCanvasElement', class {});
def('HTMLVideoElement', class {});
def('OffscreenCanvas', class { constructor() { return makeCanvas(); } });
// Web Audio mock
const AUDIO_METHODS = new Set(['connect', 'start', 'stop', 'disconnect', 'addEventListener', 'removeEventListener', 'close', 'suspend', 'resume']);
function audioNode() {
  return new Proxy({}, {
    get(t, p) {
      if (AUDIO_METHODS.has(p)) return p === 'connect' ? () => audioNode() : () => {};
      if (p === 'buffer') return t.__buffer ?? null;
      if (typeof p === 'symbol') return undefined;
      // それ以外はAudioParamとして振る舞う
      return { value: 0, defaultValue: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {}, cancelScheduledValues() {}, cancelAndHoldAtTime() {} };
    },
    set(t, p, v) { t[p] = v; return true; },
  });
}
def('AudioContext', class {
  constructor() { this.state = 'running'; this.sampleRate = 44100; this.currentTime = 0; this.destination = audioNode(); }
  createGain() { return audioNode(); }
  createOscillator() { const n = audioNode(); n.frequency = { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {} }; n.type = ''; n.start = () => {}; n.stop = () => {}; n.connect = () => n; return n; }
  createBiquadFilter() { const n = audioNode(); n.type = ''; n.frequency = { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {} }; n.Q = { value: 1 }; n.connect = () => n; return n; }
  createBufferSource() { const n = audioNode(); n.loop = false; n.buffer = null; n.start = () => {}; n.stop = () => {}; n.connect = () => n; return n; }
  createBuffer(ch, len) { return { getChannelData: () => new Float32Array(len), length: len, numberOfChannels: ch }; }
  createConvolver() { return audioNode(); }
  createDynamicsCompressor() { return audioNode(); }
  createDelay() { return audioNode(); }
  resume() { return Promise.resolve(); }
});
def('webkitAudioContext', globalThis.AudioContext);

// テスト用にRAF自動ループを止める(フレームは手動で回す)
let rafEnabled = false;
const origRAF = globalThis.requestAnimationFrame;
def('requestAnimationFrame', (cb) => (rafEnabled ? origRAF(cb) : 0));

// ---------------- テスト本体 ----------------
const { Game } = await import('../src/game/Game.js');

function assert(cond, msg) {
  if (!cond) { console.error('❌ ASSERT FAIL:', msg); process.exitCode = 1; }
  else console.log('  ✓', msg);
}

const canvas = makeCanvas();
canvas.requestPointerLock = () => {};
const game = new Game(canvas);

console.log('● アセット読み込み(実GLBパース)');
await game.load((p) => process.stdout.write(`\r  progress ${(p * 100) | 0}%   `));
console.log();
assert(!!game.bedroom.room, 'bedroom GLB loaded');
assert(game.bedroom.tiles === undefined, 'bedroom object ok');
assert(game.void.tiles.length === 25, '25 fracture tiles');
assert(game.void.wakeText, 'WAKE_UP text geometry built');
assert(game.void.racks.length === 6, '6 server racks around monument');
assert(!!game.bedroom.bsod, 'BSOD texture ready');
assert(!!game.bedroom.faceHitbox, 'face hitbox ready');
assert(game.bedroom.colliders.length >= 6, 'bedroom colliders built');

const frames = async (n, dt = 0.016) => { for (let i = 0; i < n; i++) { game._clock.getDelta = () => dt; game.update(); } await new Promise(r => setTimeout(r, 20)); };
const press = (code) => game.input._justPressed.add(code);

console.log('● ROOM: 自由歩行');
game.startGame();
assert(game.state === 'room', 'state=room after start');
game.input.enabled = true;
for (let i = 0; i < 120; i++) {
  game.input.keys.add('KeyW');
  await frames(1);
}
game.input.keys.clear();
assert(game.player.position.x > game.bedroom.playerStart.pos.x + 0.3, 'W moves toward desk (+X)');
console.log('  player pos:', game.player.position.toArray().map(v => v.toFixed(2)).join(','));
{
  let meshes = 0, tris = 0;
  game.sceneRoom.traverse((o) => {
    if (!o.isMesh || o.visible === false) return;
    meshes++;
    const g = o.geometry;
    if (!g) return;
    tris += g.index ? g.index.count : (g.attributes.position ? g.attributes.position.count : 0);
  });
  console.log(`  [perf] room meshes=${meshes} verts=${tris}`);
  assert(meshes < 260, `room mesh count sane (${meshes})`);
  assert(tris < 1_200_000, `room vertex count sane (${tris})`);
}

console.log('● INSPECT: 着座 → BSOD');
game.player.position.set(0.95, 0.02, 0.05); game.player.velocity.set(0,0,0); // モニター手前の安全な位置
await frames(5);
press('KeyE');
await frames(2);
assert(game.state === 'inspect', 'E enters inspect');
await frames(90); // 着座モーション完了
assert(game.inspectBlend >= 1, 'inspect blend complete');
assert(game.bedroom.glassMesh.material.map === game.bedroom.bsod.texture, 'glass shows BSOD');

console.log('● 顔クリック ×6 → 捕食遷移');
for (let i = 0; i < 6; i++) {
  game._lastMouse = { clientX: 640, clientY: 360 };
  // ヒットボックスに確実に当たるよう強制
  game._raycaster.intersectObject = () => [{ object: game.bedroom.faceHitbox }];
  press('Mouse0');
  await frames(3);
}
assert(game.state === 'consume', `state=consume after 6 clicks (got ${game.state})`);
console.log('● 捕食遷移シミュレート');
for (let i = 0; i < 500 && game.state === 'consume'; i++) await frames(1);
assert(game.state === 'void_entry', `entered void entry (got ${game.state})`);
for (let i = 0; i < 220 && game.state === 'void_entry'; i++) await frames(1);
assert(game.state === 'void', `void controls returned (got ${game.state})`);
assert(game.player.enabled, 'player enabled in void');
await frames(30);
{
  let meshes = 0, tris = 0;
  game.sceneVoid.traverse((o) => {
    if (!o.isMesh || o.visible === false) return;
    meshes++;
    const g = o.geometry;
    if (!g) return;
    if (o.isInstancedMesh) { meshes += o.count - 1; tris += (g.index ? g.index.count : g.attributes.position.count) * o.count; return; }
    tris += g.index ? g.index.count : (g.attributes.position ? g.attributes.position.count : 0);
  });
  // 実メッシュオブジェクト数(InstancedMesh は1オブジェクト)
  let realMeshes = 0;
  game.sceneVoid.traverse((o) => { if (o.isMesh && o.visible !== false) realMeshes++; });
  console.log(`  [perf] void meshObjects=${realMeshes} verts=${tris}`);
  assert(realMeshes < 260, `void mesh object count sane (${realMeshes})`);
  assert(tris < 1_300_000, `void vertex count sane (${tris})`);
  const byName = new Map();
  game.sceneVoid.traverse((o) => {
    if (!o.isMesh || o.visible === false || !o.geometry) return;
    const n = o.name || o.type;
    const v = (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) * (o.isInstancedMesh ? o.count : 1);
    byName.set(n, (byName.get(n) || 0) + v);
  });
  console.log('  [perf] top:', [...byName.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([n, v]) => `${n}=${(v / 1000) | 0}k`).join(' '));
}

console.log('● 発見前の WAKE_UP は拒否される');
press('KeyC');
await frames(2);
assert(game.state === 'console', 'console opens pre-discovery');
game.console.input.value = 'wake_up';
game.console._exec();
assert(game.state === 'console', 'wake_up rejected before discovery (no collapse)');
assert(/ERR_UNKNOWN_SIGNAL/.test(game.console.logEl.lastChild.textContent), 'themed unknown-signal error');
game.console.close();
await frames(2);
assert(game.state === 'void', 'console closes back to void');

console.log('● 異世界探索 → WAKE_UP発見');
assert(game.void.wakeText.visible === false, 'WAKE_UP hidden before discovery (no spoilers)');
assert(game.void.moboSlabs.length === 5, 'distant structures built during load (no pop-in)');
// シャフト上端は地面より上に出ていない
const shaftWall = game.void.shaft.children.find((c) => c.geometry && c.geometry.type === 'CylinderGeometry');
assert(shaftWall.position.y + shaftWall.geometry.parameters.height / 2 <= 0.001, 'shaft rim below ground');
game.player.position.set(8, 0.05, 0);
await frames(120);
assert(game.void.discovered === true, 'WAKE_UP discovered near monument');
assert(game.void.wakeText.visible === true, 'WAKE_UP revealed after discovery');
assert(game.void._wakeReveal >= 1, 'WAKE_UP reveal animation finished');
assert(game.console.discovery === true, 'console knows discovery');

console.log('● コンソール: 誤コマンド → WAKE_UP');
press('KeyC');
await frames(2);
assert(game.state === 'console', 'C opens console');
game.console.input.value = 'help';
game.console._exec();
assert(game.console.logEl.children.length > 2, 'help prints lines');
game.console.input.value = 'foobar';
game.console._exec();
const lastErr = game.console.logEl.lastChild.textContent;
assert(/ERR_COMMAND_NOT_FOUND/.test(lastErr), 'unknown command themed error');
game.console.input.value = 'wake_up';
game.console._exec();
await frames(40);
assert(game.state === 'collapse', `wake_up triggers collapse (got ${game.state})`);
assert(game.input.enabled === false, 'controls disabled during collapse cinematic');
assert(game.player.enabled === false, 'player frozen during collapse cinematic');

console.log('● 崩壊 → 落下 → 自室帰還');
for (let i = 0; i < 1200 && (game.state === 'collapse' || game.state === 'landing'); i++) await frames(1);
assert(['landing', 'room'].includes(game.state), `collapse finished (got ${game.state})`);
assert(game.bedroom.anomaly, 'bedroom anomaly active');
assert(game.bedroom.crackDecal.visible, 'crack decal placed');
if (game.state === 'landing') game._afterLanding();
assert(game.state === 'room', `controls returned in room (got ${game.state})`);
assert(game.player.enabled, 'player re-enabled after landing');
assert(game.input.enabled === true, 'input re-enabled after landing');

console.log('● ポーズ / ミュート');
game._pause();
assert(game._paused === true, 'pause engages');
const beforePaused = game.time;
await frames(10);
assert(Math.abs(game.time - beforePaused) < 0.001, 'game time frozen while paused');
game._resume();
assert(game._paused === false, 'resume clears pause');
press('KeyM');
await frames(2);
assert(game.audio.muted === true, 'M mutes audio');
press('KeyM');
await frames(2);
assert(game.audio.muted === false, 'M restores audio');

console.log('● リプレイ: 再びBSOD → 異世界');
game.player.position.set(0.95, 0.02, 0.05); game.player.velocity.set(0,0,0);
await frames(5);
press('KeyE');
await frames(100);
assert(['inspect', 'consume'].includes(game.state), 'replay inspect starts');
if (game.state === 'inspect') {
  for (let i = 0; i < 6; i++) {
    game._raycaster.intersectObject = () => [{ object: game.bedroom.faceHitbox }];
    press('Mouse0');
    await frames(3);
  }
}
for (let i = 0; i < 800 && !['void_entry', 'void'].includes(game.state); i++) await frames(1);
assert(['void_entry', 'void'].includes(game.state), 'replay reaches void again');
for (let i = 0; i < 240 && game.state === 'void_entry'; i++) await frames(1);
assert(game.void.wakeText.visible === false, 'replay hides WAKE_UP again (secret reset)');
assert(game.void.discovered === false, 'replay resets discovery flag');
// 崩壊で落ちたタイルは reset で元に戻る
assert(game.void.tiles.every((t) => !t.userData.falling && t.visible), 'tiles restored on reset');

console.log(process.exitCode ? '\n❌ SMOKE TEST FAILED' : '\n✅ ALL SMOKE TESTS PASSED');
