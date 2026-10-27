import * as THREE from 'three';

const LINES = [
  'Your PC ran into a problem and needs to restart.',
  "We're just collecting some error info, and then we'll restart for you.",
  '0% complete',
  '',
  "If you'd like to know more, you can search online later for this error:",
  'CRITICAL_PROCESS_DIED',
  '',
  'Stop code: 0x000000EF',
];

// BSODキャンバステクスチャ(腐敗進行で文字が崩れる)
export class BSODTexture {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1280; this.canvas.height = 960;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.corruption = 0;
    this.cracked = false;
    this._t = 0;
    this._redrawClock = 0;
    this.draw(0);
  }

  _scramble(text, amount) {
    if (amount <= 0) return text;
    const chars = '█▓▒░#%$@&!?01\u2588\u2592';
    let out = '';
    for (const ch of text) {
      if (ch === ' ') { out += ' '; continue; }
      out += Math.random() < amount * 0.5 ? chars[(Math.random() * chars.length) | 0] : ch;
    }
    return out;
  }

  draw(time) {
    const ctx = this.ctx, W = this.canvas.width, H = this.canvas.height;
    const c = this.corruption;
    const base = this.cracked ? '#06264d' : '#0a6fc4';
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, W, H);

    // 微細なノイズ
    if (c > 0.05) {
      const n = (c * 220) | 0;
      for (let i = 0; i < n; i++) {
        ctx.fillStyle = `rgba(${180 + Math.random() * 75},${220 + Math.random() * 35},255,${Math.random() * 0.12 * c})`;
        ctx.fillRect(Math.random() * W, Math.random() * H, 2 + Math.random() * 30, 1 + Math.random() * 4);
      }
    }

    ctx.fillStyle = '#ffffff';
    // :( (大きく中央上に)
    ctx.save();
    const jitter = c * (Math.sin(time * 9) * 6 + (Math.random() - 0.5) * 8 * c);
    ctx.translate(W / 2 - 150 + jitter, 250 + (Math.random() - 0.5) * 7 * c);
    ctx.scale(1 + c * 0.1 * Math.sin(time * 5), 1 + c * 0.14);
    ctx.font = '200 300px "Segoe UI", Arial, sans-serif';
    ctx.fillText(this.cracked ? ':)' : ':(', 0, 0);
    ctx.restore();

    // 本文
    ctx.font = '28px "Segoe UI", Arial, sans-serif';
    let y = 470;
    const pct = Math.min(100, Math.floor(c * 100));
    const lines = LINES.map((l) => (l === '0% complete' ? `${pct}% complete` : l));
    for (const line of lines) {
      if (!line) { y += 26; continue; }
      const slices = c > 0.3 ? 3 : 1;
      for (let s = 0; s < slices; s++) {
        const off = (Math.random() - 0.5) * 26 * c;
        ctx.fillText(this._scramble(line, c), 140 + off, y);
      }
      y += 44;
    }

    // QRもどき
    const qx = W - 300, qy = H - 300, qs = 150;
    ctx.fillStyle = '#000';
    ctx.fillRect(qx - 12, qy - 12, qs + 24, qs + 24);
    ctx.fillStyle = '#fff';
    const cells = 15;
    for (let i = 0; i < cells; i++) for (let j = 0; j < cells; j++) {
      if (Math.random() > 0.48 - c * 0.3) ctx.fillRect(qx + (i * qs) / cells, qy + (j * qs) / cells, qs / cells - 1, qs / cells - 1);
    }

    // 侵食が進むと赤い裂け目
    if (c > 0.45) {
      ctx.strokeStyle = `rgba(255,40,70,${(c - 0.4) * 1.4})`;
      ctx.lineWidth = 3 + c * 6;
      ctx.beginPath();
      let x = 0, yy = H * (0.3 + Math.random() * 0.4);
      ctx.moveTo(x, yy);
      while (x < W) { x += 60 + Math.random() * 90; yy += (Math.random() - 0.5) * 120 * c; ctx.lineTo(x, yy); }
      ctx.stroke();
    }

    // クラック状態の追加要素
    if (this.cracked) {
      ctx.font = 'bold 44px "Courier New", monospace';
      ctx.fillStyle = 'rgba(140,210,255,0.85)';
      ctx.fillText('WAKE_UP // returned', 140, H - 120);
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 2;
      for (let i = 0; i < 7; i++) {
        ctx.beginPath();
        let cx = 200 + Math.random() * (W - 400), cy = 60;
        ctx.moveTo(cx, cy);
        while (cy < H - 80) { cy += 40 + Math.random() * 60; cx += (Math.random() - 0.5) * 70; ctx.lineTo(cx, cy); }
        ctx.stroke();
      }
    }
    this.texture.needsUpdate = true;
  }

  setCorruption(v) { this.corruption = THREE.MathUtils.clamp(v, 0, 1); }
  setCracked(v) { this.cracked = v; this.draw(this._t); }

  update(dt) {
    this._t += dt;
    this._redrawClock += dt;
    const interval = this.corruption > 0.4 ? 0.07 : 0.25;
    if (this._redrawClock >= interval) {
      this._redrawClock = 0;
      this.draw(this._t);
    }
  }
}

// :( が顔/口/入口へ変質するシェーダー平面
const FaceShader = {
  uniforms: {
    uTime: { value: 0 },
    uOpen: { value: 0 },      // 口が開く 0..1
    uCorruption: { value: 0 },
    uGlitch: { value: 0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
  `,
  fragmentShader: /* glsl */`
    precision highp float;
    uniform float uTime, uOpen, uCorruption, uGlitch;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(41.3,289.1)))*45758.5453); }

    float sdEllipse(vec2 p, vec2 r){
      return length(p / r) - 1.0;
    }
    float sdCircle(vec2 p, float r){ return length(p) - r; }

    void main(){
      vec2 p = vUv * 2.0 - 1.0;
      p.x += (hash(vec2(floor(vUv.y*24.0), floor(uTime*12.0))) - 0.5) * uGlitch * 0.12;
      vec3 col = vec3(0.0);
      float alpha = 0.0;

      // 目(窪んだ黒に青白い縁)
      vec2 eL = p - vec2(-0.42, 0.34);
      vec2 eR = p - vec2( 0.42, 0.34);
      float eyeShift = uOpen * 0.08;
      eL.y += eyeShift; eR.y += eyeShift;
      float eLd = sdEllipse(eL, vec2(0.13, 0.10 + uOpen*0.05));
      float eRd = sdEllipse(eR, vec2(0.13, 0.10 + uOpen*0.05));
      float eyes = smoothstep(0.02, -0.02, min(eLd, eRd));
      col = mix(col, vec3(0.005,0.02,0.06), eyes);
      alpha = max(alpha, eyes * 0.95);
      float eyeGlow = smoothstep(0.05, 0.0, min(abs(eLd), abs(eRd)));
      col += vec3(0.3,0.7,1.0) * eyeGlow * 0.5;

      // 口: :( の曲線 → 開いた穴
      if (uOpen < 0.25) {
        float arc = abs(length(p - vec2(0.0, -0.52)) - 0.42);
        float ang = atan(p.y + 0.52, p.x);
        float mouth = smoothstep(0.045, 0.015, arc) * smoothstep(-2.6, -1.6, ang) * smoothstep(-0.5, -1.5, ang);
        col = mix(col, vec3(0.01,0.03,0.08), mouth);
        alpha = max(alpha, mouth);
      }
      float mouthR = mix(0.06, 0.62, smoothstep(0.1, 0.85, uOpen));
      vec2 mp = p - vec2(0.0, -0.34 - uOpen * 0.12);
      float md = sdCircle(mp, mouthR);
      float mouthHole = smoothstep(0.02, -0.03, md);
      // 穴の内部: 暗い青
      vec3 inner = mix(vec3(0.0,0.01,0.04), vec3(0.02,0.12,0.28), hash(floor(p*60.0))*0.6);
      col = mix(col, inner, mouthHole);
      alpha = max(alpha, mouthHole);
      // 口の縁の発光
      float rim = smoothstep(0.06, 0.0, abs(md)) * uOpen;
      col += vec3(0.35,0.8,1.0) * rim * 1.6;
      alpha = max(alpha, rim * 0.8);

      // 顔の輪郭の淡い光
      float faceAura = smoothstep(1.15, 0.5, length(p - vec2(0.0,0.05))) * 0.10 * (0.4 + uCorruption);
      col += vec3(0.1,0.4,0.9) * faceAura;
      alpha = max(alpha, faceAura);

      // グリッチ筋
      float band = step(0.97 - uGlitch*0.5, hash(vec2(floor(vUv.y*18.0), floor(uTime*20.0))));
      col += vec3(0.4,0.8,1.0) * band * uGlitch * 0.8;
      alpha = max(alpha, band * uGlitch * 0.7);

      gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
    }
  `,
};

export function createFacePortal() {
  const group = new THREE.Group();
  group.visible = false;

  const darkDisc = new THREE.Mesh(
    new THREE.CircleGeometry(1, 48),
    new THREE.MeshBasicMaterial({ color: 0x01040c, transparent: true, opacity: 0.96, side: THREE.DoubleSide })
  );

  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(1, 0.055, 16, 64),
    new THREE.MeshBasicMaterial({ color: 0x39a7ff })
  );

  const faceMat = new THREE.ShaderMaterial({
    ...FaceShader,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const face = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4), faceMat);
  face.position.z = 0.02;

  group.add(darkDisc, rim, face);
  group.userData = { darkDisc, rim, faceMat, face };
  // プレイヤー方向(-X)を向く
  group.rotation.y = -Math.PI / 2;
  return group;
}
