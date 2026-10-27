// 完全プロシージャルなWeb Audioサウンドエンジン(外部音源なし)
import { clamp, rand, choice } from './util.js';

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.layers = {};
    this.tension = 0;
    this._heartTimer = 0;
    this._started = false;
  }

  async init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') await this.ctx.resume(); return; }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    const ctx = this.ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.ratio.value = 6; comp.attack.value = 0.004; comp.release.value = 0.25;
    this.master.connect(comp); comp.connect(ctx.destination);

    // リバーブ(短いインパルス)
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._makeImpulse(2.4, 2.2);
    this.revGain = ctx.createGain(); this.revGain.gain.value = 0.35;
    this.reverb.connect(this.revGain); this.revGain.connect(this.master);

    this._buildRoomLayer();
    this._buildVoidLayer();
    this._startScheduler();
    this._started = true;
  }

  _makeImpulse(seconds, decay) {
    const ctx = this.ctx, rate = ctx.sampleRate;
    const len = rate * seconds;
    const buf = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  _noiseBuffer(seconds = 2) {
    const ctx = this.ctx;
    const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) { // ブラウンノイズ
      const w = Math.random() * 2 - 1;
      last = clamp(last + 0.02 * w, -1, 1);
      d[i] = last * 3.2;
    }
    return buf;
  }

  _buildRoomLayer() {
    const ctx = this.ctx;
    const bus = ctx.createGain(); bus.gain.value = 0; bus.connect(this.master);
    // 低温ドローン
    const noise = ctx.createBufferSource(); noise.buffer = this._noiseBuffer(4); noise.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 110; lp.Q.value = 0.6;
    const ng = ctx.createGain(); ng.gain.value = 0.5;
    noise.connect(lp); lp.connect(ng); ng.connect(bus); noise.start();
    // 60Hz ハム
    const hum = ctx.createGain(); hum.gain.value = 0.045; hum.connect(bus);
    [60, 120.3].forEach((f, i) => {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = ctx.createGain(); g.gain.value = i === 0 ? 1 : 0.35;
      o.connect(g); g.connect(hum); o.start();
    });
    // 時折のきしみ用LP
    this.layers.room = bus;
  }

  _buildVoidLayer() {
    const ctx = this.ctx;
    const bus = ctx.createGain(); bus.gain.value = 0; bus.connect(this.master);
    // 風
    const noise = ctx.createBufferSource(); noise.buffer = this._noiseBuffer(4); noise.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 480; bp.Q.value = 0.8;
    const wg = ctx.createGain(); wg.gain.value = 0.16;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
    const lfoG = ctx.createGain(); lfoG.gain.value = 260;
    lfo.connect(lfoG); lfoG.connect(bp.frequency); lfo.start();
    noise.connect(bp); bp.connect(wg); wg.connect(bus); noise.start();
    // 重低域
    const sub = ctx.createOscillator(); sub.type = 'sawtooth'; sub.frequency.value = 27.5;
    const sub2 = ctx.createOscillator(); sub2.type = 'sawtooth'; sub2.frequency.value = 27.9;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 160;
    const sg = ctx.createGain(); sg.gain.value = 0.11;
    sub.connect(lp); sub2.connect(lp); lp.connect(sg); sg.connect(bus);
    sub.start(); sub2.start();
    this.voidFilter = lp;
    this.layers.void = bus;
  }

  _startScheduler() {
    const tick = () => {
      if (!this.ctx) return;
      const dt = 1 / 30;
      // 心拍(テンション連動)
      if (this.tension > 0.05) {
        this._heartTimer -= dt;
        if (this._heartTimer <= 0) {
          this._heartbeat();
          this._heartTimer = lerp2(1.15, 0.42, this.tension);
        }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  _heartbeat() {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const vol = 0.10 + this.tension * 0.22;
    [[0, 0.9], [0.16, 0.55]].forEach(([off, scale]) => {
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(62, t + off);
      o.frequency.exponentialRampToValueAtTime(34, t + off + 0.16);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t + off);
      g.gain.linearRampToValueAtTime(vol * scale, t + off + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + off + 0.22);
      o.connect(g); g.connect(this.master);
      o.start(t + off); o.stop(t + off + 0.26);
    });
  }

  setMood(mood) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const targets = { room: 0.5, void: 0, none: 0 };
    if (mood === 'room') { this._fade(this.layers.room, 0.5, t, 1.2); this._fade(this.layers.void, 0, t, 1.2); }
    else if (mood === 'void') { this._fade(this.layers.room, 0, t, 1.5); this._fade(this.layers.void, 0.7, t, 2); }
    else if (mood === 'transition') { this._fade(this.layers.room, 0.25, t, 1); this._fade(this.layers.void, 0.5, t, 1.5); }
    else if (mood === 'collapse') { this._fade(this.layers.room, 0.1, t, 1); this._fade(this.layers.void, 0.9, t, 1); }
    else if (mood === 'silence') { this._fade(this.layers.room, 0, t, 0.6); this._fade(this.layers.void, 0, t, 0.6); }
  }

  setTension(v) {
    this.tension = clamp(v, 0, 1);
    if (this.voidFilter && this.ctx) {
      this.voidFilter.frequency.setTargetAtTime(160 + this.tension * 900, this.ctx.currentTime, 0.4);
    }
  }

  _fade(gain, value, t, dur) {
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), t);
    gain.gain.exponentialRampToValueAtTime(Math.max(value, 0.0001), t + dur);
  }

  setMuted(m) {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.05);
  }
  toggleMute() { this.setMuted(!this.muted); return this.muted; }

  // ---------------- SFX ----------------
  blip(freq = 880, dur = 0.07, type = 'square', vol = 0.08) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  keyClack() { this.blip(rand(1400, 2200), 0.03, 'square', 0.03); }

  uiOpen() { this.blip(520, 0.08, 'triangle', 0.07); setTimeout(() => this.blip(780, 0.1, 'triangle', 0.06), 55); }
  uiClose() { this.blip(660, 0.07, 'triangle', 0.06); setTimeout(() => this.blip(330, 0.1, 'triangle', 0.06), 50); }

  footstep() {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this._noiseBuffer(0.12);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = rand(180, 320); bp.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
    src.connect(bp); bp.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + 0.13);
  }

  // グリッチ: 音の断片をランダムに飛ばす
  glitch(intensity = 0.5) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const n = 1 + ((intensity * 4) | 0);
    for (let i = 0; i < n; i++) {
      const start = t + rand(0, 0.18);
      const dur = rand(0.02, 0.12) * (0.5 + intensity);
      const o = ctx.createOscillator();
      o.type = choice(['square', 'sawtooth']);
      o.frequency.value = choice([rand(60, 240), rand(900, 3200)]);
      const g = ctx.createGain();
      g.gain.setValueAtTime(rand(0.02, 0.09) * intensity, start);
      g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
      o.connect(g); g.connect(this.master);
      o.start(start); o.stop(start + dur + 0.02);
    }
    if (intensity > 0.6) { // ノイズ破裂
      const src = ctx.createBufferSource(); src.buffer = this._noiseBuffer(0.25);
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1800;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.10 * intensity, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      src.connect(hp); hp.connect(g); g.connect(this.master);
      src.start(t); src.stop(t + 0.22);
    }
  }

  whoosh(dur = 1.2, vol = 0.5) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this._noiseBuffer(dur + 0.5); src.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(120, t);
    bp.frequency.exponentialRampToValueAtTime(3400, t + dur * 0.55);
    bp.frequency.exponentialRampToValueAtTime(90, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp); bp.connect(g); g.connect(this.master); g.connect(this.reverb);
    src.start(t); src.stop(t + dur + 0.1);
  }

  swallow() { // 捕食の瞬間
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    this.whoosh(1.6, 0.7);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(24, t + 1.4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.7);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 1.8);
  }

  rumble(dur = 2, vol = 0.3) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this._noiseBuffer(dur + 0.5); src.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 90;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(lp); lp.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + dur + 0.1);
  }

  crack() {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this._noiseBuffer(0.3);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 600;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    src.connect(hp); hp.connect(g); g.connect(this.master); g.connect(this.reverb);
    src.start(t); src.stop(t + 0.3);
    this.rumble(1.2, 0.18);
  }

  thud(vol = 0.8) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(28, t + 0.35);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    o.connect(g); g.connect(this.master); g.connect(this.reverb);
    o.start(t); o.stop(t + 0.55);
    const src = ctx.createBufferSource(); src.buffer = this._noiseBuffer(0.2);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 300;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(vol * 0.5, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    src.connect(lp); lp.connect(ng); ng.connect(this.master);
    src.start(t); src.stop(t + 0.2);
  }

  chime() {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = ctx.createGain();
      const st = t + i * 0.09;
      g.gain.setValueAtTime(0, st);
      g.gain.linearRampToValueAtTime(0.12, st + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, st + 1.4);
      o.connect(g); g.connect(this.master); g.connect(this.reverb);
      o.start(st); o.stop(st + 1.5);
    });
  }

  flash() {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 2400;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.18, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 1.7);
  }
}

function lerp2(a, b, t) { return a + (b - a) * t; }
