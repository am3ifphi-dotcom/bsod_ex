import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { BSOD } from '../core/bsod.js';

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

const load = (url) => loader.loadAsync(url);
const rand = (a, b) => a + Math.random() * (b - a);
let SCREEN_POS = { x: -0.245, y: 0.455, z: 0.33 };

/* ------------------------------------------------------------------ noise */
function noiseTexture(size, scale, octave = 4, seed = 1) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const grid = [];
  for (let o = 0; o < octave; o++) {
    const gs = Math.max(2, Math.floor(scale * Math.pow(2, o)));
    const g = new Float32Array((gs + 1) * (gs + 1));
    for (let i = 0; i < g.length; i++) g[i] = rnd();
    grid.push({ gs, g });
  }
  const sample = (o, x, y) => {
    const { gs, g } = grid[o];
    const fx = x * gs, fy = y * gs;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const at = (xx, yy) => g[(Math.min(gs, Math.max(0, yy))) * (gs + 1) + Math.min(gs, Math.max(0, xx))];
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const a = at(x0, y0), b = at(x0 + 1, y0), cc = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
    return (a * (1 - sx) + b * sx) * (1 - sy) + (cc * (1 - sx) + d * sx) * sy;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0, amp = 1, tot = 0;
      for (let o = 0; o < octave; o++) { v += sample(o, x / size, y / size) * amp; tot += amp; amp *= 0.5; }
      v = v / tot;
      const i = (y * size + x) * 4;
      const c8 = Math.floor(v * 255);
      img.data[i] = img.data[i + 1] = img.data[i + 2] = c8;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function woodTextures() {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  const base = ctx.createLinearGradient(0, 0, S, 0);
  base.addColorStop(0, '#2c2018');
  base.addColorStop(0.5, '#3a2a1e');
  base.addColorStop(1, '#241a13');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, S, S);
  // grain
  for (let i = 0; i < 420; i++) {
    const y = Math.random() * S;
    const alpha = 0.02 + Math.random() * 0.07;
    ctx.strokeStyle = Math.random() > 0.5 ? `rgba(120,90,64,${alpha})` : `rgba(12,8,5,${alpha * 1.4})`;
    ctx.lineWidth = 0.5 + Math.random() * 2.2;
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= S; x += 24) {
      ctx.lineTo(x, y + Math.sin(x * 0.02 + i) * (2 + Math.random() * 5));
    }
    ctx.stroke();
  }
  // knots
  for (let i = 0; i < 4; i++) {
    const x = Math.random() * S, y = Math.random() * S;
    const r = 6 + Math.random() * 16;
    const g = ctx.createRadialGradient(x, y, 1, x, y, r);
    g.addColorStop(0, 'rgba(10,6,4,0.75)');
    g.addColorStop(1, 'rgba(10,6,4,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  tex.anisotropy = 8;

  // roughness
  const rc = document.createElement('canvas');
  rc.width = rc.height = S;
  const rx = rc.getContext('2d');
  rx.fillStyle = '#8a8a8a'; rx.fillRect(0, 0, S, S);
  for (let i = 0; i < 900; i++) {
    rx.fillStyle = `rgba(${Math.random() > .5 ? 255 : 0},${Math.random() > .5 ? 255 : 0},0,0.03)`;
    rx.fillRect(Math.random() * S, Math.random() * S, Math.random() * 40, Math.random() * 2);
  }
  const rough = new THREE.CanvasTexture(rc);
  rough.wrapS = rough.wrapT = THREE.RepeatWrapping;
  rough.repeat.set(2, 2);
  return { map: tex, rough };
}

function fabricTexture(baseCol = '#1b1a1d', size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = baseCol; ctx.fillRect(0, 0, size, size);
  for (let y = 0; y < size; y += 3) {
    ctx.fillStyle = `rgba(255,255,255,${0.012 + Math.random() * 0.012})`;
    ctx.fillRect(0, y, size, 1);
  }
  for (let x = 0; x < size; x += 3) {
    ctx.fillStyle = `rgba(0,0,0,${0.02 + Math.random() * 0.02})`;
    ctx.fillRect(x, 0, 1, size);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 3);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* --------------------------------------------------------------- geometry */
function box(w, h, d, mat, x = 0, y = 0, z = 0, castShadow = true, receive = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = castShadow; m.receiveShadow = receive;
  return m;
}

/**
 * The room — night, one desk, one PC, one bed.
 */
export class Room {
  boxMesh(w, h, d, mat, x, y, z, cast = true) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = cast; m.receiveShadow = true;
    return m;
  }

  constructor(engine, audio, opts = {}) {
    this.engine = engine;
    this.audio = audio;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05070c);
    this.scene.fog = new THREE.FogExp2(0x060a12, 0.012);
    this.scene.userData.bloom = 0.48;
    this.scene.userData.bloomThreshold = 0.86;

    this.group = new THREE.Group();
    this.scene.add(this.group);

    this.interactables = [];
    this.lights = {};
    this.time = 0;
    this.hasReturned = opts.hasReturned || false;
    this.eyeHeight = 1.62;
    this.surface = 'wood';
    this.gravity = 18;

    // world bounds / colliders
    this.bounds = { minX: -2.02, maxX: 2.9, minZ: -3.0, maxZ: 1.58 };
    this.colliders = [];
    this.spawn = { pos: new THREE.Vector3(0.55, 0, 0.15), yaw: -Math.PI / 2, pitch: 0 };

    this.bsod = new BSOD(1600, 900);
    this.screenOn = false;
    this.eaten = 0;
    this.monitorMesh = null;
    this.screenPlane = null;
    this.screenLight = null;

    this.ready = null;
  }

  // ------------------------------------------------------------------ build
  async build() {
    const [bedroom, pcGltf, chairGltf, rackGltf, crayGltf, moboGltf, cablesGltf] = await Promise.all([
      load('models/bedroom.glb'), load('models/pc.glb'), load('models/chair.glb'),
      load('models/rack.glb'), load('models/cray.glb'), load('models/mobo.glb'),
      load('models/cables.glb'),
    ]);

    // ---- room shell ----------------------------------------------------
    const roomRoot = bedroom.scene;
    this.group.add(roomRoot);
    roomRoot.traverse((o) => {
      if (!o.isMesh) return;
      const n = o.name;
      // the enclosing shell must not cast shadows or it blocks every light
      const shell = /^(Main_Walls|Main_Floor|Dustpan|RoofWindows|Window_Window|Window_Glass|Glasscontainer_Glass)/.test(n);
      o.castShadow = !shell;
      o.receiveShadow = true;
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => {
          if (!m) return;
          m.envMapIntensity = 0.7;
          if (/glass/i.test(m.name || '')) { m.transparent = true; m.opacity = 0.35; m.roughness = 0.06; m.metalness = 0.1; }
        });
      }
    });

    // the bedroom model also ships its own monitor standing where our monitor goes:
    // its glass is a bright white panel that would cover the live screen. Remove it whole.
    const bedroomScreen = [];
    roomRoot.traverse((o) => { if (o.isMesh && /my_screen/i.test(o.name)) bedroomScreen.push(o); });
    if (bedroomScreen.length) {
      const sb = new THREE.Box3().setFromObject(bedroomScreen[0]);
      const sc = sb.getCenter(new THREE.Vector3());
      const hide = [];
      roomRoot.traverse((o) => {
        if (!o.isMesh) return;
        const b = new THREE.Box3().setFromObject(o);
        const c = b.getCenter(new THREE.Vector3());
        if (c.distanceTo(sc) < 0.42) hide.push(o);
      });
      hide.forEach((o) => { o.visible = false; });
      bedroomScreen.forEach((o) => { o.visible = false; });
      this.bedroomMonitorHidden = hide.length;
    }

    // the bedroom model's own desk and its little monitor are hidden (we build both)
    const hideBedroom = (name, extra) => {
      roomRoot.traverse((o) => {
        if (!o.isMesh || o.name !== name) return;
        const b = new THREE.Box3().setFromObject(o);
        extra(o, b);
      });
    };
    hideBedroom('Cube_Material_0', (o, b) => { o.visible = false; });          // the model's desk
    hideBedroom('Cube004_Material002_0', (o, b) => {                         // its monitor/electronics
      if (b.getSize(new THREE.Vector3()).y < 0.5) o.visible = false;
    });
    this.notesOnWall = true;

    // the bedroom model ships a laptop that lands next to our monitor — put it on the bed
    const laptop = [];
    roomRoot.traverse((o) => { if (o.isMesh && /^MacBook/i.test(o.name)) laptop.push(o); });
    if (laptop.length) {
      const lg = new THREE.Group();
      laptop.forEach((o) => { o.parent.remove(o); lg.add(o); });
      roomRoot.add(lg);
      lg.position.set(0.15, 0.0, 0.0);
      lg.rotation.set(0.05, 0.6, 0);
      lg.scale.setScalar(0.85);
      // sit it on the duvet
      lg.position.set(-0.55, 0.62, -1.15);
    }

    // night sky beyond the window
    this.buildOutside();

    // ---- desk -----------------------------------------------------------
    const wood = woodTextures();
    const deskMat = new THREE.MeshStandardMaterial({
      map: wood.map, roughnessMap: wood.rough, roughness: 0.68, metalness: 0.03, color: 0xb9a894,
    });
    const darkMetal = new THREE.MeshStandardMaterial({ color: 0x0b0d11, roughness: 0.45, metalness: 0.65 });
    const desk = new THREE.Group();
    desk.add(this.boxMesh(0.86, 0.045, 1.86, deskMat, 1.94, 0.75, 0.12));
    for (const z of [-0.68, 0.92]) {
      desk.add(this.boxMesh(0.05, 0.72, 0.05, darkMetal, 1.60, 0.36, z));
      desk.add(this.boxMesh(0.05, 0.72, 0.05, darkMetal, 2.28, 0.36, z));
    }
    desk.add(this.boxMesh(0.03, 0.4, 1.66, darkMetal, 2.3, 0.5, 0.12));
    this.group.add(desk);
    this.desk = desk;

    // ---- tower (re-used from the imported PC model) ---------------------
    const pcWorld = new THREE.Group();
    const pcModel = pcGltf.scene;
    pcModel.scale.setScalar(0.15);
    pcWorld.add(pcModel);
    this.group.add(pcWorld);
    this.pcWorld = pcWorld;
    this.pcModel = pcModel;

    pcWorld.updateWorldMatrix(true, true);
    const keep = [];
    pcModel.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => { if (m) m.envMapIntensity = 0.85; });
      const bb = new THREE.Box3().setFromObject(o);
      const size = bb.getSize(new THREE.Vector3());
      const c = pcWorld.worldToLocal(bb.getCenter(new THREE.Vector3()));
      // everything except the tower lives off the tower's footprint
      const isTower = c.z < -0.32 && c.y > 0.0;
      const isDesk = size.y < 0.2 && size.x > 1.0 && size.z > 1.8;   // the model's own desk
      const isPeripheral = c.z > 0.2;
      if (!isTower || isDesk || isPeripheral || /my_screen|gigabyte|logo|gallery|bg2/i.test(o.name)) {
        o.visible = false;
      } else keep.push(o);
    });
    // park the tower on our desk, front glass toward the room
    const towerBox = new THREE.Box3();
    keep.forEach((o) => towerBox.expandByObject(o));
    const ts = towerBox.getSize(new THREE.Vector3());
    const tc = towerBox.getCenter(new THREE.Vector3());
    const target = new THREE.Vector3(2.19, 0.7725, -0.42);
    pcWorld.position.set(target.x - tc.x, target.y - towerBox.min.y, target.z - tc.z);
    this.towerSize = ts;

    // ---- monitor (own construction: a clean panel for the live screen) ---
    const MON = { x: 2.02, y: 0.985, z: 0.34, w: 0.58, h: 0.335, d: 0.022 };
    this.monitor = MON;
    SCREEN_POS = { x: MON.x - MON.d / 2 - 0.005, y: MON.y, z: MON.z };
    this.SCREEN_POS = SCREEN_POS;

    const bezelMat = new THREE.MeshStandardMaterial({ color: 0x05070a, roughness: 0.38, metalness: 0.4 });
    const panel = this.boxMesh(MON.d, MON.h, MON.w, bezelMat, MON.x, MON.y, MON.z);
    panel.castShadow = false;
    this.group.add(panel);
    // back shell
    const shell = this.boxMesh(0.05, MON.h * 0.86, MON.w * 0.9, bezelMat, MON.x + 0.036, MON.y, MON.z);
    shell.castShadow = false;
    this.group.add(shell);
    // stand
    const standMat = new THREE.MeshStandardMaterial({ color: 0x1a1d22, roughness: 0.4, metalness: 0.6 });
    this.group.add(this.boxMesh(0.03, 0.16, 0.06, standMat, MON.x + 0.07, MON.y - MON.h / 2 - 0.06, MON.z));
    const foot = this.boxMesh(0.2, 0.012, 0.3, standMat, MON.x + 0.1, 0.7625, MON.z);
    this.group.add(foot);

    // live screen panel (its own geometry, slightly in front of the bezel)
    const screenGeo = new THREE.PlaneGeometry(MON.w * 0.965, MON.h * 0.93, 40, 24);
    this.screenBase = screenGeo.attributes.position.array.slice();
    this.screenGeo = screenGeo;
    this.screenMat = new THREE.MeshBasicMaterial({
      map: this.bsod.texture, toneMapped: false, transparent: false, fog: false,
      color: new THREE.Color(0.02, 0.03, 0.05),
    });
    // the monitor is already on: a dim blue backlight that owns the room's light
    this.bsod.standby = true;
    this.bsod.update(0, 0, { stage: 0 });
    this.screenMat.color.setRGB(0.16, 0.26, 0.40);
    this.screenLit = 0;
    this.powered = false;
    this.screenOn = true;
    const screenPlane = new THREE.Mesh(screenGeo, this.screenMat);
    screenPlane.rotation.y = -Math.PI / 2;
    screenPlane.position.set(SCREEN_POS.x, SCREEN_POS.y, SCREEN_POS.z);
    screenPlane.renderOrder = 2;
    this.group.add(screenPlane);
    this.screenPlane = screenPlane;

    // screen light (physical units: candela)
    this.screenPoint = new THREE.PointLight(0x2f7fd0, 0, 5.2, 1.7);
    this.screenPoint.position.set(SCREEN_POS.x - 0.22, SCREEN_POS.y + 0.05, SCREEN_POS.z);
    this.group.add(this.screenPoint);

    // peripherals
    this.buildPeripherals(SCREEN_POS, MON);

    // ---- chair ---------------------------------------------------------
    const chair = chairGltf.scene;
    chair.scale.setScalar(0.92);
    chair.position.set(1.12, 0.0, 0.62);
    chair.rotation.y = -1.42;
    chair.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.group.add(chair);
    this.chair = chair;
    this.colliders.push({ type: 'circle', x: 1.12, z: 0.62, r: 0.34 });

    // ---- cables & clutter ---------------------------------------------
    const cables = cablesGltf.scene.clone();
    cables.scale.setScalar(0.6);
    cables.position.set(1.62, 0.7775, -0.2);
    cables.rotation.y = 0.4;
    this.group.add(cables);

    this.buildClutter();

    // ---- lights --------------------------------------------------------
    this.buildLights();

    // ---- dust ----------------------------------------------------------
    this.buildDust();

    // ---- interactables -------------------------------------------------
    this.buildInteractables();

    // ---- colliders -----------------------------------------------------
    this.colliders.push(
      { type: 'box', minX: -2.1, maxX: 2.75, minZ: -3.0, maxZ: -0.16 },    // bed
      { type: 'box', minX: 1.5, maxX: 2.38, minZ: -0.82, maxZ: 1.06 },     // desk
      { type: 'box', minX: -2.1, maxX: -1.85, minZ: -2.9, maxZ: 0.5 },     // plant corner
      { type: 'circle', x: -0.62, z: 0.72, r: 0.3 },                       // stool
    );

    if (this.hasReturned) this.applyReturnState();
    this.ready = true;
    return this;
  }

  buildOutside() {
    // night sky seen through the roof windows + a distant city glow
    const sky = new THREE.Mesh(
      new THREE.BoxGeometry(60, 30, 60),
      new THREE.MeshBasicMaterial({ color: 0x03060c, side: THREE.BackSide, fog: false })
    );
    sky.position.set(0, 6, -6);
    this.group.add(sky);
    // stars
    const g = new THREE.BufferGeometry();
    const n = 500, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const th = Math.random() * Math.PI * 2;
      const ph = Math.random() * 0.8;
      const R = 40;
      pos[i * 3] = Math.cos(th) * Math.cos(ph) * R;
      pos[i * 3 + 1] = 6 + Math.sin(ph) * R * 0.7;
      pos[i * 3 + 2] = Math.sin(th) * Math.cos(ph) * R - 6;
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(g, new THREE.PointsMaterial({
      color: 0x9fbcff, size: 0.35, sizeAttenuation: true, transparent: true, opacity: 0.55, fog: false, depthWrite: false,
    }));
    this.group.add(this.stars);

    // faint city haze just above the horizon
    const hazeTex = noiseTexture(128, 4, 3, 7);
    const haze = new THREE.Mesh(
      new THREE.PlaneGeometry(50, 12),
      new THREE.MeshBasicMaterial({ map: hazeTex, color: 0x121c2c, transparent: true, opacity: 0.55, fog: false, depthWrite: false })
    );
    haze.position.set(0, 3.5, -22);
    this.group.add(haze);
  }

  buildPeripherals(screen, MON) {
    const DESK_Y = 0.7725;
    const dark = new THREE.MeshStandardMaterial({ color: 0x0b0d11, roughness: 0.42, metalness: 0.55 });
    const keyMat = new THREE.MeshStandardMaterial({ color: 0x07090d, roughness: 0.72, metalness: 0.2 });
    const glow = new THREE.MeshBasicMaterial({ color: 0x3fd0ff });

    // keyboard
    const kb = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.018, 0.42), dark);
    kb.add(base);
    const rows = 5, cols = 15;
    const keyGeo = new THREE.BoxGeometry(0.0145, 0.008, 0.0145);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const k = new THREE.Mesh(keyGeo, keyMat);
        k.position.set(0, 0.0125, (c - (cols - 1) / 2) * 0.0215 + (r % 2) * 0.003);
        k.position.x = (r - (rows - 1) / 2) * 0.0225;
        kb.add(k);
      }
    }
    const under = new THREE.Mesh(new THREE.BoxGeometry(0.105, 0.0012, 0.415),
      new THREE.MeshBasicMaterial({ color: 0x1b4f6b }));
    under.position.y = 0.0088;
    kb.add(under);
    kb.position.set(1.83, DESK_Y + 0.012, 0.34);
    kb.rotation.y = Math.PI / 2;
    this.group.add(kb);

    // mouse + pad
    const pad = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.004, 0.32),
      new THREE.MeshStandardMaterial({ color: 0x080a0e, roughness: 0.85 }));
    pad.position.set(1.79, DESK_Y + 0.003, 0.78);
    pad.rotation.y = 0.05;
    pad.receiveShadow = true;
    this.group.add(pad);
    const mouse = new THREE.Mesh(new THREE.SphereGeometry(0.035, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55),
      new THREE.MeshStandardMaterial({ color: 0x14181e, roughness: 0.35, metalness: 0.3 }));
    mouse.scale.set(1, 0.62, 1.55);
    mouse.position.set(1.79, DESK_Y + 0.03, 0.78);
    mouse.castShadow = true;
    this.group.add(mouse);
  }

  buildClutter() {
    const g = new THREE.Group();
    this.group.add(g);
    const paperMats = [];
    for (let i = 0; i < 3; i++) {
      paperMats.push(new THREE.MeshStandardMaterial({ color: [0x8b877c, 0x7d8489, 0x928a7a][i], roughness: 0.96 }));
    }
    // scattered papers on the desk
    const p1 = box(0.16, 0.002, 0.22, paperMats[0], 1.68, 0.7745, 0.12);
    p1.rotation.y = 0.5;
    g.add(p1);
    const p2 = box(0.16, 0.002, 0.22, paperMats[1], 1.73, 0.7765, 0.05);
    p2.rotation.y = 0.2;
    g.add(p2);

    // sticky notes on the wall above the desk
    const noteCols = [0xb9a765, 0xb08f5c, 0x8fa4b4];
    for (let i = 0; i < 5; i++) {
      const m = new THREE.MeshStandardMaterial({ color: noteCols[i % 3], roughness: 0.95, emissive: 0x0a0803, emissiveIntensity: 0.25 });
      const note = new THREE.Mesh(new THREE.PlaneGeometry(0.072, 0.072), m);
      // on the plaster wall above the monitor, where you actually look
      note.position.set(1.42 + (i % 3) * 0.09 + rand(-0.02, 0.02), 1.46 + (i % 4) * 0.075 + rand(-0.02, 0.02), -2.94);
      note.rotation.y = 0;
      note.rotation.z = rand(-0.2, 0.2);
      g.add(note);
    }

    // mug (right of the keyboard)
    const mug = new THREE.Group();
    const ceramic = new THREE.MeshStandardMaterial({ color: 0x1b222b, roughness: 0.35, metalness: 0.08 });
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.036, 0.095, 22, 1, true), ceramic);
    cup.castShadow = true;
    mug.add(cup);
    const bottom = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.008, 22), ceramic);
    bottom.position.y = -0.045;
    mug.add(bottom);
    const coffee = new THREE.Mesh(new THREE.CircleGeometry(0.038, 20), new THREE.MeshStandardMaterial({ color: 0x140a05, roughness: 0.15, metalness: 0.25 }));
    coffee.rotation.x = -Math.PI / 2;
    coffee.position.y = 0.04;
    mug.add(coffee);
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.028, 0.008, 8, 16, Math.PI), ceramic);
    handle.position.set(-0.045, 0, 0);
    handle.rotation.z = Math.PI / 2;
    handle.rotation.y = Math.PI / 2;
    mug.add(handle);
    mug.position.set(1.63, 0.8225, 0.72);
    g.add(mug);
    this.mug = mug;

    // spilled pills near the keyboard
    const pillMat = new THREE.MeshStandardMaterial({ color: 0xe6e2d4, roughness: 0.5 });
    for (let i = 0; i < 7; i++) {
      const p = new THREE.Mesh(new THREE.CapsuleGeometry(0.004, 0.008, 3, 6), pillMat);
      p.position.set(1.68 + rand(-0.05, 0.05), 0.776, 0.52 + rand(-0.07, 0.07));
      p.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      g.add(p);
    }
    // pill bottle
    const bottle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.021, 0.021, 0.075, 16),
      new THREE.MeshStandardMaterial({ color: 0x9a5b2a, roughness: 0.35, metalness: 0.05 })
    );
    bottle.position.set(1.70, 0.8135, 0.55);
    bottle.castShadow = true;
    g.add(bottle);

    // headphones on the desk corner
    const hpMat = new THREE.MeshStandardMaterial({ color: 0x14171c, roughness: 0.6, metalness: 0.2 });
    const hp = new THREE.Group();
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.008, 8, 24, Math.PI), hpMat);
    hp.add(band);
    for (const s of [-1, 1]) {
      const cup2 = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.036, 0.028, 18), hpMat);
      cup2.rotation.z = Math.PI / 2;
      cup2.position.set(s * 0.075, -0.005, 0);
      hp.add(cup2);
    }
    hp.position.set(1.66, 0.83, -0.5);
    hp.rotation.set(0.15, 0.4, 0.1);
    g.add(hp);

    // small desk lamp: warm pool of light over the keyboard
    const lamp = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({ color: 0x24262b, roughness: 0.42, metalness: 0.72 });
    const baseL = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.012, 20), metal);
    lamp.add(baseL);
    const arm1 = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.34, 8), metal);
    arm1.position.set(0, 0.17, 0);
    lamp.add(arm1);
    const arm2 = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.28, 8), metal);
    arm2.position.set(-0.1, 0.32, 0.05);
    arm2.rotation.set(0.2, 0, 0.8);
    lamp.add(arm2);
    const shade = new THREE.Group();
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(0.075, 0.1, 18, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.4, metalness: 0.6, side: THREE.DoubleSide })
    );
    cone.rotation.z = 0.5;
    shade.add(cone);
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.026, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xc99a5e })
    );
    bulb.position.set(0.01, -0.03, 0);
    shade.add(bulb);
    shade.position.set(-0.22, 0.4, 0.02);
    lamp.add(shade);
    lamp.position.set(1.63, 0.7935, -0.62);
    lamp.rotation.y = -0.9;
    g.add(lamp);
    this.lamp = lamp;

    const lampLight = new THREE.SpotLight(0xffc39a, 6.5, 4.2, Math.PI * 0.36, 0.75, 1.6);
    lampLight.position.set(1.52, 1.14, -0.52);
    lampLight.target.position.set(1.78, 0.77, 0.25);
    lampLight.castShadow = false;
    lampLight.shadow.bias = -0.0016;
    lampLight.shadow.camera.near = 0.1;
    lampLight.shadow.camera.far = 4;
    lampLight.shadow.radius = 3;
    g.add(lampLight);
    g.add(lampLight.target);
    this.lights.lamp = lampLight;

    // a poster above the bed
    const posterTex = noiseTexture(256, 6, 4, 22);
    const poster = new THREE.Mesh(
      new THREE.PlaneGeometry(0.5, 0.7),
      new THREE.MeshStandardMaterial({ map: posterTex, color: 0x2b3440, roughness: 0.9 })
    );
    poster.position.set(0.55, 1.95, -2.97);
    g.add(poster);

    // a phone on the bed
    const phone = new THREE.Mesh(
      new THREE.BoxGeometry(0.075, 0.008, 0.15),
      new THREE.MeshStandardMaterial({ color: 0x0a0b0d, roughness: 0.22, metalness: 0.6 })
    );
    phone.position.set(0.42, 0.64, -1.05);
    phone.rotation.y = 0.5;
    phone.castShadow = true;
    g.add(phone);
    const phoneGlow = new THREE.PlaneGeometry(0.065, 0.13);
    const pg = new THREE.Mesh(phoneGlow, new THREE.MeshBasicMaterial({ color: 0x2b4a66 }));
    pg.rotation.x = -Math.PI / 2;
    pg.rotation.z = 0.5;
    pg.position.set(0.42, 0.646, -1.05);
    g.add(pg);

    this.clutter = g;
  }

  buildLights() {
    const moon = new THREE.DirectionalLight(0x9dbcff, 2.6);
    moon.position.set(3.2, 6.2, -4.6);
    moon.target.position.set(0.2, 0.4, 0.6);
    moon.castShadow = true;
    moon.shadow.mapSize.set(2048, 2048);
    moon.shadow.camera.left = -5;
    moon.shadow.camera.right = 5;
    moon.shadow.camera.top = 5;
    moon.shadow.camera.bottom = -5;
    moon.shadow.camera.near = 0.5;
    moon.shadow.camera.far = 22;
    moon.shadow.bias = -0.0009;
    moon.shadow.normalBias = 0.02;
    this.group.add(moon, moon.target);
    this.lights.moon = moon;

    const hemi = new THREE.HemisphereLight(0x35507a, 0x0d0a08, 1.15);
    this.group.add(hemi);
    this.lights.hemi = hemi;

    const amb = new THREE.AmbientLight(0x2a3a55, 0.75);
    this.group.add(amb);
    this.lights.amb = amb;

    // a soft upward bounce, faked by a second (unshadowed) hemisphere instead of
    // another punctual light — same look, much cheaper per fragment
    const fill = new THREE.HemisphereLight(0x6f96cc, 0x120f0c, 0.55);
    this.group.add(fill);
    this.lights.fill = fill;

    // moonlight spilling through the slanted roof windows onto the bed
    const shaft = new THREE.SpotLight(0xa9c8ff, 26, 9, 0.62, 0.85, 1.4);
    shaft.position.set(0.4, 4.2, -3.4);
    shaft.target.position.set(0.2, 0, -0.9);
    this.group.add(shaft, shaft.target);
    this.lights.shaft = shaft;

    // warm bounce from the city outside the side window
    const city = new THREE.PointLight(0xff9a5a, 12, 6.5, 2);
    city.position.set(3.4, 1.7, -0.4);
    this.group.add(city);
    this.lights.city = city;

    // there is no separate ceiling light: the "glitch flash" is the monitor's own
    // light surging, which keeps the punctual-light count down
    this.lights.ceil = { intensity: 0 };
  }

  buildDust() {
    const n = 420;
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = rand(-2.0, 2.9);
      pos[i * 3 + 1] = rand(0.05, 2.9);
      pos[i * 3 + 2] = rand(-3.0, 1.6);
      seed[i] = Math.random() * 6.28;
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const sprite = document.createElement('canvas');
    sprite.width = sprite.height = 32;
    const sc = sprite.getContext('2d');
    const grd = sc.createRadialGradient(16, 16, 0, 16, 16, 16);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.4, 'rgba(255,255,255,0.35)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    sc.fillStyle = grd; sc.fillRect(0, 0, 32, 32);
    const tex = new THREE.CanvasTexture(sprite);
    const mat = new THREE.PointsMaterial({
      size: 0.016, map: tex, transparent: true, opacity: 0.42, depthWrite: false,
      blending: THREE.AdditiveBlending, color: 0xbfd8ff,
    });
    this.dust = new THREE.Points(g, mat);
    this.dust.userData.seed = seed;
    this.group.add(this.dust);
  }

  buildInteractables() {
    this.interactables = [
      {
        id: 'pc', pos: new THREE.Vector3(1.72, 1.05, 0.4), radius: 1.35,
        prompt: '<b>E</b>　モニターを見る',
        onUse: () => this.onInteract?.('pc'),
      },
      {
        id: 'mug', pos: new THREE.Vector3(1.63, 0.84, 0.72), radius: 0.6,
        prompt: '<b>E</b>　カップを見る',
        onUse: () => this.story('mug'),
      },
      {
        id: 'phone', pos: new THREE.Vector3(0.42, 0.66, -1.05), radius: 0.7,
        prompt: '<b>E</b>　スマホを見る',
        onUse: () => this.story('phone'),
      },
      {
        id: 'notes', pos: new THREE.Vector3(2.6, 1.32, -0.35), radius: 0.85,
        prompt: '<b>E</b>　付箋を読む',
        onUse: () => this.story('notes'),
      },
      {
        id: 'window', pos: new THREE.Vector3(2.35, 1.7, -0.4), radius: 1.0,
        prompt: '<b>E</b>　窓の外を見る',
        onUse: () => this.story('window'),
      },
    ];
    if (this.hasReturned) this.interactables[0].prompt = '<b>E</b>　モニターを見る';
  }

  /** Little bits of story — short, diegetic, never explanatory. */
  story(id) {
    this.onStory?.(id);
  }

  /* --------------------------------------------------------------- states */
  powerOnScreen() {
    if (this.powered) return;
    this.powered = true;
    this.screenOn = true;
    this.bsod.standby = false;
    this.powerT = this.time || 0;
    // never let an empty/stale canvas reach the GPU: draw it and hand the
    // material a fresh texture object (an un-uploaded texture samples as white)
    this.bsod.update(0, 0, { stage: this.eaten });
    const fresh = new THREE.CanvasTexture(this.bsod.canvas);
    fresh.colorSpace = THREE.SRGBColorSpace;
    fresh.anisotropy = 1;
    fresh.minFilter = THREE.LinearFilter;
    fresh.magFilter = THREE.LinearFilter;
    fresh.generateMipmaps = false;
    fresh.needsUpdate = true;
    const old = this.bsod.texture;
    this.bsod.texture = fresh;
    if (this.screenMat) { this.screenMat.map = fresh; this.screenMat.needsUpdate = true; }
    if (old && old !== fresh) old.dispose();
    this.screenMat.color.setRGB(1, 1, 1);
    this.audio?.play('powerup', { vol: 0.45 });
    this.audio?.play('switch', { vol: 0.3 });
    this.audio?.loop('amb.pc_fan', { vol: 0.28, fade: 2.5, id: 'pc_fan' });
    this.audio?.loop('amb.tower', { vol: 0.16, fade: 3, id: 'tower' });
  }

  setEaten(v) {
    this.eaten = v;
    // the room's own light dies as the screen takes over
    if (this.lights.lamp) this.lights.lamp.intensity = 6.5 * (1 - v * 0.85);
    if (this.lights.moon) this.lights.moon.intensity = 2.6 * (1 - v * 0.7);
    if (this.lights.hemi) this.lights.hemi.intensity = 1.15 * (1 - v * 0.6);
    if (this.lights.fill) this.lights.fill.intensity = 1.6 * (1 - v * 0.7);
    if (this.lights.shaft) this.lights.shaft.intensity = 26 * (1 - v * 0.8);
    if (this.lights.city) this.lights.city.intensity = 12 * (1 - v * 0.8);
    this.screenPoint.intensity = (this.powered ? 1.5 : 0.5) + v * 1.8;
    this.scene.fog.density = 0.012 + v * 0.07;
  }

  /** After the fall: small wrongnesses. */
  applyReturnState() {
    // the mug is knocked over, the clock has stopped, one sticky note is missing
    if (this.mug) { this.mug.rotation.z = Math.PI / 2.1; this.mug.position.y = 0.81; }
    this.buildReturnMarks();
    this.onStory && 0;
  }

  buildReturnMarks() {
    const g = new THREE.Group();
    this.returnMarks = g;
    this.group.add(g);
    // a handprint of static on the monitor glass, and a black drip under the desk
    const dripMat = new THREE.MeshStandardMaterial({ color: 0x02040a, roughness: 0.2, metalness: 0.1 });
    const drip = new THREE.Mesh(new THREE.ConeGeometry(0.03, 1.1, 8, 1, true), dripMat);
    drip.position.set(1.55, 0.2, 0.5);
    g.add(drip);
    // one sticky note lies on the floor
    const note = new THREE.Mesh(
      new THREE.PlaneGeometry(0.072, 0.072),
      new THREE.MeshStandardMaterial({ color: 0xd8c46a, roughness: 0.95, side: THREE.DoubleSide })
    );
    note.rotation.x = -Math.PI / 2;
    note.rotation.z = 0.7;
    note.position.set(1.35, 0.005, -0.15);
    g.add(note);
  }

  /* ------------------------------------------------------------- physics */
  sampleGround(x, z) { return 0.02; }

  collide(pos, radius) {
    const b = this.bounds;
    pos.x = THREE.MathUtils.clamp(pos.x, b.minX + radius, b.maxX - radius);
    pos.z = THREE.MathUtils.clamp(pos.z, b.minZ + radius, b.maxZ - radius);
    for (const c of this.colliders) {
      if (c.type === 'box') {
        const cx = THREE.MathUtils.clamp(pos.x, c.minX, c.maxX);
        const cz = THREE.MathUtils.clamp(pos.z, c.minZ, c.maxZ);
        let dx = pos.x - cx, dz = pos.z - cz;
        const d = Math.hypot(dx, dz);
        if (d < radius) {
          if (d < 1e-4) {
            // inside: push out along the shortest axis
            const toX = Math.min(Math.abs(pos.x - c.minX), Math.abs(pos.x - c.maxX));
            const toZ = Math.min(Math.abs(pos.z - c.minZ), Math.abs(pos.z - c.maxZ));
            if (toX < toZ) pos.x += (pos.x - (c.minX + c.maxX) / 2 > 0 ? 1 : -1) * (radius + toX);
            else pos.z += (pos.z - (c.minZ + c.maxZ) / 2 > 0 ? 1 : -1) * (radius + toZ);
          } else {
            pos.x = cx + (dx / d) * radius;
            pos.z = cz + (dz / d) * radius;
          }
        }
      } else if (c.type === 'circle') {
        const dx = pos.x - c.x, dz = pos.z - c.z;
        const d = Math.hypot(dx, dz);
        const rr = c.r + radius;
        if (d < rr) {
          if (d < 1e-4) { pos.x += rr; }
          else { pos.x = c.x + (dx / d) * rr; pos.z = c.z + (dz / d) * rr; }
        }
      }
    }
  }

  resetToStart() {
    if (this.mug) { this.mug.rotation.set(0, 0, 0); this.mug.position.set(1.63, 0.8225, 0.72); }
    if (this.returnMarks) this.returnMarks.visible = false;
    this.eaten = 0;
    this.powered = false;
    this.screenOn = true;
    // the monitor drops back to its standby backlight, and the room's own light returns
    this.bsod.standby = true;
    this.bsod.update(0, 0, { stage: 0 });
    this.screenMat.color.setRGB(0.16, 0.26, 0.40);
    if (this.screenPoint) this.screenPoint.intensity = 0.55;
    if (this.lights.lamp) this.lights.lamp.intensity = 6.5;
    if (this.lights.moon) this.lights.moon.intensity = 2.6;
    if (this.lights.hemi) this.lights.hemi.intensity = 1.15;
    if (this.lights.fill) this.lights.fill.intensity = 0.55;
    if (this.lights.shaft) this.lights.shaft.intensity = 26;
    if (this.lights.city) this.lights.city.intensity = 12;
    this.scene.fog.density = 0.012;
    this.glitchT = 0;
  }

  /* ---------------------------------------------------------------- frame */
  update(dt, t, ctx) {
    this.time = t;
    // dust drift
    if (this.dust) {
      const p = this.dust.geometry.attributes.position;
      const seed = this.dust.userData.seed;
      for (let i = 0; i < p.count; i++) {
        let y = p.getY(i) + dt * (0.012 + (seed[i] % 1) * 0.02);
        let x = p.getX(i) + Math.sin(t * 0.22 + seed[i]) * dt * 0.02;
        if (y > 3.0) y = 0.03;
        p.setY(i, y); p.setX(i, x);
      }
      p.needsUpdate = true;
    }
    if (this.stars) this.stars.rotation.y = t * 0.004;

    // physical deformation of the panel as the thing inside pushes out
    if (this.screenGeo && this.eaten > 0.01) {
      const pos = this.screenGeo.attributes.position;
      const base = this.screenBase;
      const e = this.eaten;
      for (let i = 0; i < pos.count; i++) {
        const x = base[i * 3], y = base[i * 3 + 1];
        const r = Math.hypot(x / 0.47, y / 0.27);
        // local +Z faces the room (the plane is rotated -90° about Y), so a
        // positive offset pushes the picture out of the glass toward the player
        const bulge = Math.max(0, 1 - r) * e * 0.075;
        const wob = Math.sin(x * 6 + t * 2.2) * Math.cos(y * 7 - t * 1.7) * e * 0.018;
        pos.setZ(i, base[i * 3 + 2] + bulge + wob);
      }
      pos.needsUpdate = true;
      this.screenGeo.computeVertexNormals();
    }

    // screen: redraw while visible (capped at ~30 Hz — the canvas upload is the
    // single most expensive thing in this scene)
    if (this.bsod && this.screenOn && !this.bsod.standby) {
      this._bsodAcc = (this._bsodAcc || 0) + dt;
      // the canvas upload is the most expensive thing in this scene: 12 Hz is
      // plenty for text that crawls and a face that breathes
      if (this._bsodAcc > 1 / 12) {
        this._bsodAcc = 0;
        this.bsod.update(t, dt, {
          stage: this.eaten,
          hover: ctx?.hoverScreen || false,
          pupil: ctx?.pupil || null,
        });
      }
    }

    // lamp flicker (a tired bulb)
    if (this.lights.lamp && this.eaten < 0.25) {
      const f = 0.94 + Math.sin(t * 11.3) * 0.02 + Math.sin(t * 3.1) * 0.03 + (Math.random() < 0.008 ? -0.18 : 0);
      this.lights.lamp.intensity = 6.5 * f * (1 - this.eaten * 0.85);
    }

    // the monitor's light pushes into the room
    if (this.screenPoint) {
      const base = this.powered ? 1.5 : 0.5;
      const pulse = this.eaten > 0.05 ? (1 + Math.sin(t * 8.3) * 0.12 + Math.sin(t * 31) * 0.05) : 1;
      this.screenPoint.intensity = (base + this.eaten * 1.8) * pulse;
      this.screenPoint.color.setRGB(
        THREE.MathUtils.lerp(0.18, 0.35, this.eaten),
        THREE.MathUtils.lerp(0.5, 0.75, this.eaten),
        1.0
      );
    }

    // glitch pulses when the player is close to the monitor while it's eating
    if (ctx?.glitchPulse && this.screenPoint) {
      this.screenPoint.intensity += ctx.glitchPulse * 9;
    }
  }

  /** Where to put the camera when examining the monitor. */
  screenFocus() {
    return new THREE.Vector3(SCREEN_POS.x, SCREEN_POS.y, SCREEN_POS.z);
  }

  dispose() {
    this.scene.traverse((o) => {
      if (o.isMesh) {
        o.geometry?.dispose?.();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => { if (m) { m.map?.dispose?.(); m.dispose?.(); } });
      }
    });
  }
}

export { noiseTexture, woodTextures, fabricTexture, box, rand };
