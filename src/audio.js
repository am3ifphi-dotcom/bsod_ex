/**
 * 音 — 全部 WebAudio で合成する（音声ファイルゼロ）
 * 廊下の反響、セミの声、木の床の足音、ピアノ、扇風機…。
 */

function makeNoiseBuffer(ctx, seconds = 4, brown = true) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (brown) {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.2;
    } else {
      d[i] = w;
    }
  }
  return buf;
}

function makeIR(ctx, duration = 1.9, decay = 2.4) {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * duration);
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      let v = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
      // 初期反射
      if (i < rate * 0.06) {
        const k = Math.floor(i / (rate * 0.012));
        if (i % Math.floor(rate * 0.012) < 40) v += (Math.random() - 0.5) * 0.5 * (1 - k * 0.18);
      }
      d[i] = v;
    }
  }
  return buf;
}

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.volume = 0.7;
    this.muted = false;
    this.mode = 'day';
    this.fanOn = false;
    this._creakTimer = 0;
    this._nextCreak = 12;
  }

  init() {
    if (this.ready) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.noise = makeNoiseBuffer(ctx, 4, true);
    this.white = makeNoiseBuffer(ctx, 2, false);

    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(ctx.destination);

    this.dry = ctx.createGain();
    this.dry.gain.value = 0.9;
    this.dry.connect(this.master);

    this.wet = ctx.createGain();
    this.wet.gain.value = 0.34;
    this.conv = ctx.createConvolver();
    this.conv.buffer = makeIR(ctx);
    this.wet.connect(this.conv);
    this.conv.connect(this.master);

    this._buildRoomTone();
    this._buildInsects();
    this._buildFan();
    this._buildLampHum();
    this.setMode(this.mode);
    this.ready = true;
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : v, this.ctx.currentTime, 0.05);
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.05);
  }

  /* ---------- 環境音 ---------- */
  _buildRoomTone() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 320;
    const g = ctx.createGain();
    g.gain.value = 0.0;
    src.connect(lp).connect(g);
    g.connect(this.dry);
    g.connect(this.wet);
    src.start();
    this.roomTone = g;

    // 窓の外（風のざわめき）
    const wsrc = ctx.createBufferSource();
    wsrc.buffer = this.noise;
    wsrc.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 700;
    bp.Q.value = 0.6;
    const wg = ctx.createGain();
    wg.gain.value = 0;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 0.012;
    lfo.connect(lfoG).connect(wg.gain);
    lfo.start();
    wsrc.connect(bp).connect(wg);
    wg.connect(this.dry);
    wsrc.start();
    this.wind = wg;
  }

  _insectVoice({ freq, buzz, env, gain, q = 9, type = 'sawtooth' }) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const osc2 = ctx.createOscillator();
    osc2.type = type;
    osc2.frequency.value = freq * 1.007;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = q;
    const buzzGain = ctx.createGain();
    buzzGain.gain.value = 0.5;
    const buzzLfo = ctx.createOscillator();
    buzzLfo.type = 'square';
    buzzLfo.frequency.value = buzz;
    const buzzDepth = ctx.createGain();
    buzzDepth.gain.value = 0.5;
    buzzLfo.connect(buzzDepth).connect(buzzGain.gain);
    buzzLfo.start();
    const envGain = ctx.createGain();
    envGain.gain.value = 0.05;
    const envLfo = ctx.createOscillator();
    envLfo.type = 'sine';
    envLfo.frequency.value = env;
    const envDepth = ctx.createGain();
    envDepth.gain.value = 0.6;
    envLfo.connect(envDepth).connect(envGain.gain);
    envLfo.start();
    const out = ctx.createGain();
    out.gain.value = 0;
    osc.connect(bp);
    osc2.connect(bp);
    bp.connect(buzzGain).connect(envGain).connect(out);
    out.connect(this.dry);
    osc.start();
    osc2.start();
    return out;
  }

  _buildInsects() {
    // 昼：ミンミンゼミ ／ 夕方：ヒグラシ ／ 夜：コオロギ
    this.cicada = this._insectVoice({ freq: 4100, buzz: 42, env: 0.55, q: 7 });
    this.higurashi = this._insectVoice({ freq: 3050, buzz: 26, env: 2.1, q: 11 });
    this.cricket = this._insectVoice({ freq: 4750, buzz: 55, env: 1.4, q: 16, gain: 1 });
  }

  _buildFan() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 480;
    bp.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.value = 0;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 58;
    const og = ctx.createGain();
    og.gain.value = 0.35;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    osc.connect(og).connect(lp).connect(g);
    src.connect(bp).connect(g);
    g.connect(this.dry);
    g.connect(this.wet);
    src.start();
    osc.start();
    this.fanGain = g;
  }

  _buildLampHum() {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 100;
    const osc2 = ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.value = 5200;
    const g = ctx.createGain();
    g.gain.value = 0;
    const g2 = ctx.createGain();
    g2.gain.value = 0;
    osc.connect(g);
    osc2.connect(g2);
    const mix = ctx.createGain();
    mix.gain.value = 1;
    g.connect(mix);
    g2.gain.value = 0.02;
    g2.connect(mix);
    mix.connect(this.dry);
    osc.start();
    osc2.start();
    this.lampHum = mix;
    this.lampHumLow = g;
  }

  setMode(mode) {
    this.mode = mode;
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const ramp = (node, v, tc = 1.6) => node.gain.setTargetAtTime(v, t, tc / 3);
    const P = {
      day: { room: 0.05, wind: 0.03, cicada: 0.05, higurashi: 0, cricket: 0, lamp: 0 },
      dusk: { room: 0.045, wind: 0.035, cicada: 0.012, higurashi: 0.05, cricket: 0, lamp: 0 },
      night: { room: 0.03, wind: 0.012, cicada: 0, higurashi: 0, cricket: 0.035, lamp: 0.012 },
    }[mode];
    ramp(this.roomTone, P.room);
    ramp(this.wind, P.wind);
    ramp(this.cicada, P.cicada);
    ramp(this.higurashi, P.higurashi);
    ramp(this.cricket, P.cricket);
    ramp(this.lampHumLow, P.lamp);
  }

  setFan(on) {
    this.fanOn = on;
    if (!this.ready) return;
    this.fanGain.gain.setTargetAtTime(on ? 0.075 : 0, this.ctx.currentTime, on ? 0.25 : 0.5);
  }

  /* ---------- 効果音 ---------- */
  _env(g, t, peak, attack, decay) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  step(power = 1) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.playbackRate.value = 0.8 + Math.random() * 0.5;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 320 + Math.random() * 520;
    bp.Q.value = 1.1;
    const g = ctx.createGain();
    this._env(g, t, 0.16 * power, 0.005, 0.13);
    src.connect(bp).connect(g);
    g.connect(this.dry);
    g.connect(this.wet);
    src.start(t);
    src.stop(t + 0.25);

    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(120 + Math.random() * 40, t);
    o.frequency.exponentialRampToValueAtTime(56, t + 0.1);
    const og = ctx.createGain();
    this._env(og, t, 0.11 * power, 0.006, 0.11);
    o.connect(og);
    og.connect(this.dry);
    og.connect(this.wet);
    o.start(t);
    o.stop(t + 0.2);
  }

  creak() {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    const f0 = 180 + Math.random() * 220;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.linearRampToValueAtTime(f0 * (0.6 + Math.random() * 0.9), t + 0.5);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900;
    bp.Q.value = 6;
    const g = ctx.createGain();
    this._env(g, t, 0.035, 0.12, 0.5);
    o.connect(bp).connect(g);
    g.connect(this.dry);
    g.connect(this.wet);
    o.start(t);
    o.stop(t + 0.8);
  }

  knock() {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.white;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1500;
    bp.Q.value = 2;
    const g = ctx.createGain();
    this._env(g, t, 0.1, 0.003, 0.07);
    src.connect(bp).connect(g);
    g.connect(this.dry);
    g.connect(this.wet);
    src.start(t);
    src.stop(t + 0.12);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(260, t);
    o.frequency.exponentialRampToValueAtTime(150, t + 0.08);
    const og = ctx.createGain();
    this._env(og, t, 0.07, 0.004, 0.09);
    o.connect(og);
    og.connect(this.dry);
    og.connect(this.wet);
    o.start(t);
    o.stop(t + 0.15);
  }

  ui(up = true) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(up ? 660 : 440, t);
    o.frequency.exponentialRampToValueAtTime(up ? 990 : 330, t + 0.09);
    const g = ctx.createGain();
    this._env(g, t, 0.05, 0.005, 0.1);
    o.connect(g);
    g.connect(this.dry);
    o.start(t);
    o.stop(t + 0.18);
  }

  note(freq, when = 0, vel = 0.42, dur = 2.4) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vel, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const parts = [
      [1, 1, 'triangle'],
      [2, 0.4, 'sine'],
      [3.01, 0.15, 'sine'],
      [4.06, 0.07, 'sine'],
      [5.4, 0.03, 'sine'],
    ];
    for (const [mult, amp, type] of parts) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq * mult;
      o.detune.value = (Math.random() - 0.5) * 7;
      const og = ctx.createGain();
      og.gain.value = amp;
      o.connect(og).connect(g);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
    // 打鍵音
    const src = ctx.createBufferSource();
    src.buffer = this.white;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2200;
    const ng = ctx.createGain();
    this._env(ng, t, vel * 0.16, 0.002, 0.05);
    src.connect(bp).connect(ng);
    ng.connect(this.dry);
    src.start(t);
    src.stop(t + 0.08);

    g.connect(this.dry);
    g.connect(this.wet);
  }

  /** だれかが弾いた、たどたおしいフレーズ */
  melody() {
    const seq = [
      [523.25, 0],
      [659.25, 0.34],
      [783.99, 0.68],
      [659.25, 1.02],
      [587.33, 1.36],
      [523.25, 1.78],
      [392.0, 2.3],
    ];
    for (const [f, at] of seq) this.note(f, at, 0.34 + Math.random() * 0.1, 2.6);
    // 最後の和音
    this.note(261.63, 2.72, 0.22, 3.4);
    this.note(392.0, 2.72, 0.2, 3.4);
    this.note(523.25, 2.72, 0.2, 3.4);
  }

  pickup(step = 0) {
    if (!this.ready) return;
    const base = 659.25 * Math.pow(2, step / 12);
    const seq = [base, base * 1.26, base * 1.5, base * 2];
    seq.forEach((f, i) => this.note(f, i * 0.075, 0.2, 1.5));
    // きらきら
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(base * 3, t);
    o.frequency.exponentialRampToValueAtTime(base * 5, t + 0.6);
    const g = ctx.createGain();
    this._env(g, t, 0.045, 0.02, 0.7);
    o.connect(g);
    g.connect(this.wet);
    o.start(t);
    o.stop(t + 0.85);
  }

  chime() {
    const seq = [
      [783.99, 0],
      [659.25, 0.5],
      [587.33, 1.0],
      [523.25, 1.5],
    ];
    for (const [f, at] of seq) this.note(f, at, 0.3, 3.2);
  }

  /** 毎フレーム：たまに建物がきしむ */
  update(dt) {
    if (!this.ready) return;
    this._creakTimer += dt;
    if (this._creakTimer > this._nextCreak) {
      this._creakTimer = 0;
      this._nextCreak = 14 + Math.random() * 28;
      this.creak();
    }
  }
}

export const audio = new AudioEngine();
