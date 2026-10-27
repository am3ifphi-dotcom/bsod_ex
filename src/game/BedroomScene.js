import * as THREE from 'three';
import { instantiateModel, findNode, findNodes, placeOnFloor } from '../core/AssetManager.js';
import { BSODTexture, createFacePortal } from './BSOD.js';
import { makeClockTexture, drawClock, makeCrackTexture } from './textures.js';
import { damp, rand } from '../core/util.js';

// 侵食シェーダーで全材質が共有するuniform
const ERODE = {
  uniforms: {
    uErode: { value: 0 },
    uAnchor: { value: new THREE.Vector3() },
    uTime: { value: 0 },
  },
};

function standUp(obj) {
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  if (size.z > size.y * 1.4) obj.rotation.x = -Math.PI / 2;
  const box2 = new THREE.Box3().setFromObject(obj);
  obj.position.y += -box2.min.y;
}

export class BedroomScene {
  constructor() {
    this.group = new THREE.Group();
    this.name = 'bedroom';
    this.colliders = [];
    this.bounds = { minX: -1.95, maxX: 2.82, minZ: -2.95, maxZ: 1.5 };
    this.playerStart = { pos: new THREE.Vector3(-0.45, 0.02, 0.95), yaw: -Math.PI / 2, pitch: 0 };
    this.anomaly = false;
    this._ceilingFlicker = 0;
    this._erode = 0;
  }

  async load(assets) {
    const roomGLTF = await assets.loadGLB('./models/bedroom.glb');
    // 部屋自体は影を受けるだけ(描画コスト削減)。影を落とすのは卓上プロップのみ
    this.room = instantiateModel(roomGLTF, { castShadow: false, receiveShadow: true });
    this.group.add(this.room);

    // MacBookは自前のPC環境に置き換えるため非表示
    findNodes(this.room, (o) => o.name && o.name.startsWith('MacBook')).forEach((o) => { o.visible = false; });
    // ガラス類を夜の暗さに
    findNodes(this.room, (o) => o.isMesh && o.name && /Glass/i.test(o.name)).forEach((o) => {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => {
        m.color.set(0x0a1426); m.roughness = 0.15; m.metalness = 0.1;
        m.emissive = new THREE.Color(0x0a1830); m.emissiveIntensity = 0.35;
      });
    });
    // 全体をやや落ち着かせる
    this.room.traverse((o) => {
      if (o.isMesh) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => {
          if (m && m.color && !/Glass/i.test(o.name)) m.color.multiplyScalar(0.9);
        });
      }
    });

    this._patchErosion();
    this._buildSky();
    this._buildLights();
    await this._buildDesk(assets);
    this._buildProps(assets);
    this._buildColliders();
    this._buildDust();

    ERODE.uniforms.uAnchor.value.copy(this.anchor);
    this.group.traverse((o) => { if (o.isMesh) o.frustumCulled = true; });
  }

  _patchErosion() {
    const seen = new Set();
    this.room.traverse((o) => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => {
        if (!m || seen.has(m.uuid)) return;
        seen.add(m.uuid);
        m.onBeforeCompile = (shader) => {
          shader.uniforms.uErode = ERODE.uniforms.uErode;
          shader.uniforms.uAnchor = ERODE.uniforms.uAnchor;
          shader.uniforms.uTime = ERODE.uniforms.uTime;
          shader.vertexShader = 'uniform float uErode;\nuniform vec3 uAnchor;\nuniform float uTime;\n' + shader.vertexShader;
          shader.vertexShader = shader.vertexShader.replace(
            '#include <begin_vertex>',
            /* glsl */`#include <begin_vertex>
            {
              vec4 wp4 = modelMatrix * vec4(transformed, 1.0);
              float ed = distance(wp4.xyz, uAnchor);
              float en = sin(wp4.x*9.0 + uTime*4.0) * sin(wp4.y*7.0 - uTime*3.0) * sin(wp4.z*8.0 + uTime*2.0);
              float ef = smoothstep(0.35, 5.2, ed) * uErode;
              transformed += normal * en * ef * 0.30;
              vec3 toA = uAnchor - wp4.xyz;
              transformed += normalize(toA + vec3(0.0001)) * ef * 0.20;
            }`
          );
        };
        m.customProgramCacheKey = () => 'erode-' + m.uuid;
      });
    });
  }

  _buildSky() {
    const geo = new THREE.SphereGeometry(80, 24, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: { uTop: { value: new THREE.Color(0x02040c) }, uBottom: { value: new THREE.Color(0x071228) }, uRed: { value: 0 } },
      vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader: `uniform vec3 uTop; uniform vec3 uBottom; uniform float uRed; varying vec3 vP;
        void main(){ float h = normalize(vP).y*0.5+0.5; vec3 c = mix(uBottom, uTop, h); c.r += uRed*0.12*(1.0-h); gl_FragColor = vec4(c,1.0);}`,
    });
    this.skyMat = mat;
    this.group.add(new THREE.Mesh(geo, mat));

    const moon = new THREE.Mesh(
      new THREE.CircleGeometry(2.2, 40),
      new THREE.MeshBasicMaterial({ color: 0xdce8ff, transparent: true, opacity: 0.85, side: THREE.DoubleSide })
    );
    moon.position.set(14, 5, -0.5);
    moon.rotation.y = -Math.PI / 2;
    this.group.add(moon);
    this.moon = moon;
  }

  _buildLights() {
    const L = new THREE.Group();
    this.hemi = new THREE.HemisphereLight(0x33507e, 0x080a10, 0.5);
    this.ambient = new THREE.AmbientLight(0x1b2740, 0.5);
    this.moonLight = new THREE.DirectionalLight(0x9db8ff, 0.9);
    this.moonLight.position.set(8, 7, 3);
    this.moonLight.castShadow = true;
    this.moonLight.shadow.mapSize.set(1024, 1024);
    this.moonLight.shadow.camera.left = -5; this.moonLight.shadow.camera.right = 5;
    this.moonLight.shadow.camera.top = 5; this.moonLight.shadow.camera.bottom = -5;
    this.moonLight.shadow.camera.near = 1; this.moonLight.shadow.camera.far = 25;
    this.moonLight.shadow.bias = -0.004;

    this.lampSpot = new THREE.SpotLight(0xffc27d, 26, 6, 0.72, 0.65, 1.7);
    // シャドウパスは月光のみ(スポットは影なしでドローコール節約)
    this.lampSpot.castShadow = false;

    this.monitorLight = new THREE.PointLight(0x2f8fff, 0, 5.5, 1.8);
    this.ceilingLight = new THREE.PointLight(0xffe6c0, 0, 8, 1.8);
    this.ceilingLight.position.set(-0.1, 2.85, -0.6);
    this.redLed = new THREE.PointLight(0xff2244, 0, 1.6, 2);

    L.add(this.hemi, this.ambient, this.moonLight, this.lampSpot, this.monitorLight, this.ceilingLight, this.redLed);
    this.group.add(L);
  }

  async _buildDesk(assets) {
    const desk = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0x2a1d16, roughness: 0.75, metalness: 0.05 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x14161c, roughness: 0.45, metalness: 0.7 });
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.06, 1.55), wood);
    top.position.set(2.48, 0.72, 0.05);
    top.castShadow = top.receiveShadow = true;
    desk.add(top);
    for (const dx of [-0.28, 0.28]) for (const dz of [-0.7, 0.7]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.72, 0.05), metal);
      leg.position.set(2.48 + dx, 0.36, 0.05 + dz);
      leg.castShadow = true;
      desk.add(leg);
    }
    this.group.add(desk);
    this.deskTopY = 0.75;

    // --- CRT モニター ---
    const crtGLTF = await assets.loadGLB('./models/crt.glb');
    const crt = instantiateModel(crtGLTF, { targetHeight: 0.6, materials: true });
    standUp(crt);
    const crtBox = new THREE.Box3().setFromObject(crt);
    const crtSize = crtBox.getSize(new THREE.Vector3());
    this.monitorHolder = new THREE.Group();
    this.monitorHolder.position.set(2.38, this.deskTopY - crtBox.min.y, 0.05);
    this.monitorHolder.rotation.y = -Math.PI / 2; // 画面(-Z→ -X)方向へ
    crt.position.set(0, 0, 0);
    this.monitorHolder.add(crt);
    this.group.add(this.monitorHolder);

    // ガラス面をBSODに差し替え
    this.bsod = new BSODTexture();
    const glass = findNode(crt, (o) => o.isMesh && o.material && /monitor_glass/i.test(
      Array.isArray(o.material) ? o.material.map((m) => m.name).join(',') : o.material.name || ''));
    if (glass) {
      const gm = glass.material.clone();
      gm.map = this.bsod.texture;
      gm.emissive = new THREE.Color(0xffffff);
      gm.emissiveMap = this.bsod.texture;
      gm.emissiveIntensity = 0.85;
      gm.color.set(0xffffff);
      gm.roughness = 0.25;
      glass.material = gm;
      this.glassMesh = glass;
    }

    // 顔ヒットボックス(非表示)
    const hitMat = new THREE.MeshBasicMaterial({ visible: false });
    this.faceHitbox = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.3), hitMat);
    this.faceHitbox.position.set(0, 0.02, crtSize.z * 0.5 + 0.02);
    this.monitorHolder.add(this.faceHitbox);

    // 顔ポータル(捕食遷移で使用)。holderが既に-90°回っているので局所回転は0
    this.portal = createFacePortal();
    this.portal.rotation.y = 0;
    this.portal.position.set(0, 0.02, crtSize.z * 0.5 + 0.05);
    this.monitorHolder.add(this.portal);

    // モニター青光
    this.monitorLight.position.set(2.05, 1.18, 0.05);

    // アンカー(侵食の中心)
    this.anchor = new THREE.Vector3();
    this.faceHitbox.getWorldPosition(this.anchor);

    // --- ゲーミングPCタワー ---
    const pcGLTF = await assets.loadGLB('./models/pc.glb');
    const pc = instantiateModel(pcGLTF, { materials: true });
    standUp(pc);
    {
      const s = new THREE.Box3().setFromObject(pc).getSize(new THREE.Vector3());
      const k = 0.5 / s.y;
      pc.scale.multiplyScalar(k);
    }
    const pcBox = new THREE.Box3().setFromObject(pc);
    pc.position.set(2.46, this.deskTopY - pcBox.min.y, -0.52);
    pc.rotation.y = rand(-0.08, 0.08);
    this.pcTower = pc;
    this.group.add(pc);
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.018, 10, 10),
      new THREE.MeshBasicMaterial({ color: 0x39a7ff }));
    led.position.set(2.2, this.deskTopY + 0.12, -0.52);
    this.pcLed = led;
    this.group.add(led);
    this.redLed.position.copy(led.position);

    // --- オフィスチェア ---
    const chairGLTF = await assets.loadGLB('./models/chair.glb');
    this.chair = instantiateModel(chairGLTF, { targetHeight: 1.05 });
    this.chair.position.set(1.78, 0, 0.05);
    this.chair.rotation.y = Math.PI / 2;
    this.group.add(this.chair);

    // --- ケーブル ---
    const cableGLTF = await assets.loadGLB('./models/cables.glb');
    for (let i = 0; i < 3; i++) {
      const cab = instantiateModel(cableGLTF, { targetSize: 0.55, castShadow: false });
      cab.position.set(2.3 - i * 0.05, this.deskTopY + 0.01, -0.2 - i * 0.12);
      cab.rotation.set(rand(-0.3, 0.3), rand(0, Math.PI), rand(-0.4, 0.4));
      this.group.add(cab);
    }

    // --- デスクランプ ---
    this._buildLamp();
  }

  _buildLamp() {
    const g = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({ color: 0x20242c, roughness: 0.4, metalness: 0.8 });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.03, 20), metal);
    base.position.set(2.52, this.deskTopY + 0.015, 0.6);
    const arm1 = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.4, 10), metal);
    arm1.position.set(2.52, this.deskTopY + 0.22, 0.6);
    const arm2 = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.34, 10), metal);
    arm2.position.set(2.4, this.deskTopY + 0.42, 0.55);
    arm2.rotation.z = 0.7;
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.14, 20, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x2a2e36, roughness: 0.5, metalness: 0.6, side: THREE.DoubleSide }));
    shade.position.set(2.3, this.deskTopY + 0.5, 0.5);
    shade.rotation.z = -0.5;
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xffd9a0 }));
    bulb.position.set(2.28, this.deskTopY + 0.45, 0.5);
    g.add(base, arm1, arm2, shade, bulb);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.group.add(g);
    this.lampSpot.position.set(2.28, this.deskTopY + 0.46, 0.5);
    this.lampSpot.target.position.set(2.35, this.deskTopY, 0.2);
    this.group.add(this.lampSpot.target);
  }

  _buildProps(assets) {
    // 置時計(ベッドサイド)
    const clockTex = makeClockTexture();
    this.clockTex = clockTex.tex;
    drawClock(this.clockTex, '2:17');
    const clockBody = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.1, 0.08),
      new THREE.MeshStandardMaterial({ color: 0x11141a, roughness: 0.5 }));
    clockBody.position.set(0.95, 0.62, -2.22);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.075),
      new THREE.MeshBasicMaterial({ map: this.clockTex }));
    face.position.set(0.95, 0.625, -2.175);
    clockBody.castShadow = true;
    this.group.add(clockBody, face);

    // 壁のひび割れ(帰還後の異変)
    const crackTex = makeCrackTexture();
    this.crackDecal = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9),
      new THREE.MeshBasicMaterial({ map: crackTex, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    this.crackDecal.position.set(2.9, 1.75, 0.05);
    this.crackDecal.rotation.y = -Math.PI / 2;
    this.crackDecal.visible = false;
    this.group.add(this.crackDecal);
  }

  _buildColliders() {
    const B = (a, b) => new THREE.Box3(new THREE.Vector3(...a), new THREE.Vector3(...b));
    this.colliders = [
      B([-2.0, 0, -2.95], [2.72, 1.25, -0.22]),       // ベッド+ベッドサイド
      B([2.15, 0, -0.78], [2.85, 1.3, 0.88]),          // 机
      B([1.5, 0, -0.3], [2.12, 1.1, 0.4]),             // チェア
      B([2.55, 0, -2.05], [2.9, 1.3, -1.72]),          // 本棚
      B([2.55, 0, -1.95], [2.85, 0.62, -0.72]),        // ラジエーター
      B([1.85, 0, 0.82], [2.78, 1.5, 1.72]),           // 大きい植物
      B([1.96, 0, 0.4], [2.62, 0.68, 0.98]),           // 収納ボックス
      B([1.3, 0, -2.34], [1.72, 1.0, -1.92]),          // 空気清浄機
    ];
  }

  _buildDust() {
    const n = 220;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = rand(-1.8, 2.6);
      pos[i * 3 + 1] = rand(0.3, 2.9);
      pos[i * 3 + 2] = rand(-2.8, 1.3);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: 0x9fc4ee, size: 0.012, transparent: true, opacity: 0.3,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.dust = new THREE.Points(geo, mat);
    this.group.add(this.dust);
  }

  // 画面の状態設定
  setMonitorPower(on) {
    this._monitorOn = on;
    this.bsod.setCorruption(0);
    if (this.glassMesh) {
      this.glassMesh.material.emissiveIntensity = on ? 0.85 : 0.05;
      if (!on) this.glassMesh.material.map = null;
      else this.glassMesh.material.map = this.bsod.texture;
      this.glassMesh.material.needsUpdate = true;
    }
    this.monitorLight.intensity = on ? 9 : 0;
  }

  setErosion(v) {
    this._erode = v;
    ERODE.uniforms.uErode.value = v;
  }

  setAnomaly(on) {
    this.anomaly = on;
    if (!on) return;
    this.bsod.setCracked(true);
    this.crackDecal.visible = true;
    this.chair.rotation.y = Math.PI / 2 + 0.35;
    drawClock(this.clockTex, '3:33', '#ff5a6e');
    this.skyMat.uniforms.uRed.value = 1;
    this.pcLed.material.color.set(0xff2244);
    this._ceilingFlicker = 4;
  }

  reset() {
    this.setAnomaly(false);
    this.bsod.setCracked(false);
    this.crackDecal.visible = false;
    this.chair.rotation.y = Math.PI / 2;
    drawClock(this.clockTex, '2:17');
    this.skyMat.uniforms.uRed.value = 0;
    this.pcLed.material.color.set(0x39a7ff);
    this.redLed.intensity = 0;
    this.setErosion(0);
    this.portal.visible = false;
    this.bsod.setCorruption(0);
    this.setMonitorPower(false);
  }

  // インスペクト視点(座って画面を見る)
  getInspectPose() {
    const screen = new THREE.Vector3();
    this.faceHitbox.getWorldPosition(screen);
    return {
      pos: new THREE.Vector3(1.82, 1.22, 0.05),
      lookAt: screen.clone(),
    };
  }

  update(dt, time) {
    ERODE.uniforms.uTime.value = time;
    // モニター消灯中はキャンバス再描画しない
    if (this._monitorOn) this.bsod.update(dt);
    if (this.dust) {
      this.dust.rotation.y += dt * 0.008;
      const p = this.dust.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) {
        let y = p.getY(i) + dt * 0.03;
        if (y > 3) y = 0.25;
        p.setY(i, y);
      }
      p.needsUpdate = true;
    }
    // モニターの微フリッカー
    if (this.monitorLight.intensity > 0.1) {
      if (Math.random() < 0.012) this.monitorLight.intensity *= 0.7;
      else this.monitorLight.intensity = damp(this.monitorLight.intensity, this._monitorTarget || 9, 10, dt);
    }
    if (this.anomaly) {
      const pulse = 0.6 + Math.sin(time * 6) * 0.4;
      this.redLed.intensity = pulse * 1.4;
      this.pcLed.scale.setScalar(1 + Math.sin(time * 6) * 0.2);
      if (Math.random() < 0.006) this.flashCeiling(time, 0.07, 7);
    }
    // ゲーム時間ベースの天井フラッシュ(タブ抑制の影響を受けない)
    if (this._ceilingOffAt && time >= this._ceilingOffAt) {
      this.ceilingLight.intensity = 0;
      this._ceilingOffAt = 0;
    }
    if (this._ceilingFlicker > 0) {
      this._ceilingFlicker -= dt;
      this.ceilingLight.intensity = Math.random() < 0.5 ? 9 : 0;
      if (this._ceilingFlicker <= 0) this.ceilingLight.intensity = 0;
    }
  }

  setMonitorTarget(v) { this._monitorTarget = v; this.monitorLight.intensity = v; }

  flashCeiling(time, dur, intensity = 12) {
    this.ceilingLight.intensity = intensity;
    this._ceilingOffAt = time + dur;
  }
}
