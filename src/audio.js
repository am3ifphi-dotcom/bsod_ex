/**
 * 手続き生成の環境音。
 * 教室のハム、廊下のノイズ、遠くの電車、本質が漏れる音。
 * 音声ファイルは使っていない。
 */
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = true;
    this.mood = 'room';
  }

  async start() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0.0;
    this.master.connect(ctx.destination);

    // 教室のハム（蛍光灯）
    this.humGain = ctx.createGain();
    this.humGain.gain.value = 0.045;
    const humFilter = ctx.createBiquadFilter();
    humFilter.type = 'lowpass';
    humFilter.frequency.value = 320;
    this.humGain.connect(humFilter).connect(this.master);
    [55, 110, 165].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = i === 2 ? 'triangle' : 'sine';
      o.frequency.value = f + (Math.random() - 0.5) * 0.6;
      const g = ctx.createGain();
      g.gain.value = i === 0 ? 0.5 : 0.16;
      o.connect(g).connect(this.humGain);
      o.start();
    });

    // 空気（ブラウンノイズ）
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.2;
    }
    this.noise = ctx.createBufferSource();
    this.noise.buffer = buf;
    this.noise.loop = true;
    this.noiseFilter = ctx.createBiquadFilter();
    this.noiseFilter.type = 'lowpass';
    this.noiseFilter.frequency.value = 520;
    this.noiseGain = ctx.createGain();
    this.noiseGain.gain.value = 0.22;
    this.noise.connect(this.noiseFilter).connect(this.noiseGain).connect(this.master);
    this.noise.start();

    // ゆっくりした風のうねり
    this.lfo = ctx.createOscillator();
    this.lfo.frequency.value = 0.06;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.12;
    this.lfo.connect(lfoGain).connect(this.noiseGain.gain);
    this.lfo.start();

    this.master.gain.linearRampToValueAtTime(0.85, ctx.currentTime + 2.5);
    this.muted = false;
    this.setScene('room');
  }

  setMuted(m) {
    if (!this.ctx) {
      this.muted = m;
      return;
    }
    this.muted = m;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.linearRampToValueAtTime(m ? 0.0 : 0.85, t + 0.4);
  }

  /** 場面ごとの空気 */
  setScene(mood = 'room') {
    this.mood = mood;
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const set = (param, v, dur = 1.6) => {
      param.cancelScheduledValues(now);
      param.linearRampToValueAtTime(v, now + dur);
    };
    if (mood === 'window') {
      set(this.noiseFilter.frequency, 900);
      set(this.noiseGain.gain, 0.34);
    } else if (mood === 'night' || mood === 'stream') {
      set(this.noiseFilter.frequency, 260);
      set(this.noiseGain.gain, 0.14);
    } else if (mood === 'lava') {
      set(this.noiseFilter.frequency, 180);
      set(this.noiseGain.gain, 0.4);
    } else if (mood === 'march') {
      set(this.noiseFilter.frequency, 760);
      set(this.noiseGain.gain, 0.24);
    } else {
      set(this.noiseFilter.frequency, 520);
      set(this.noiseGain.gain, 0.22);
    }
  }

  /** 本質が落ちてくる音 */
  chime(base = 880) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    [1, 1.5, 2.0].forEach((m, i) => {
      const o = ctx.createOscillator();
      o.type = i === 0 ? 'sine' : 'triangle';
      o.frequency.value = base * m * (1 + (Math.random() - 0.5) * 0.004);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.06 / (i + 1.2), t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6 + i * 0.2);
      o.connect(g).connect(this.master);
      o.start(t);
      o.stop(t + 2.2);
    });
  }

  /** 紙をめくる音（本文送り） */
  rustle() {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const len = Math.floor(ctx.sampleRate * 0.12);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const env = Math.pow(1 - i / len, 3);
      d[i] = (Math.random() * 2 - 1) * env;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 2400 + Math.random() * 1200;
    f.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.value = 0.09;
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
  }
}
