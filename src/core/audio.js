/**
 * Audio — a tiny WebAudio engine: music beds, ambience, one-shots, and
 * procedural "machine" sounds (risers, tape-stop, digital stutter, heartbeat).
 * All samples are CC0 loops/sfx baked into /public/audio (see CREDITS.md).
 */

const MANIFEST = {
  'music.room': 'music/room.ogg',
  'music.world': 'music/world.ogg',
  'music.void': 'music/void.ogg',
  'amb.rain': 'amb/rain.ogg',
  'amb.pc_fan': 'amb/pc_fan.ogg',
  'amb.void_drone': 'amb/void_drone.ogg',
  'amb.static': 'amb/static.ogg',
  'amb.tower': 'amb/tower.ogg',
  'amb.room_noise': 'amb/room_noise.ogg',
  'amb.whisper_bed': 'amb/whisper_bed.ogg',
  'click': 'sfx/click.ogg',
  'click_soft': 'sfx/click_soft.ogg',
  'ui_open': 'sfx/ui_open.ogg',
  'ui_close': 'sfx/ui_close.ogg',
  'ui_tick': 'sfx/ui_tick.ogg',
  'ui_error': 'sfx/ui_error.ogg',
  'ui_deny': 'sfx/ui_deny.ogg',
  'switch': 'sfx/switch.ogg',
  'glitch1': 'sfx/glitch1.ogg',
  'glitch2': 'sfx/glitch2.ogg',
  'glitch3': 'sfx/glitch3.ogg',
  'glitch4': 'sfx/glitch4.ogg',
  'zap': 'sfx/zap.ogg',
  'lowdown': 'sfx/lowdown.ogg',
  'powerup': 'sfx/powerup.ogg',
  'weird': 'sfx/weird.ogg',
  'weird2': 'sfx/weird2.ogg',
  'step_carpet1': 'sfx/step_carpet1.ogg',
  'step_carpet2': 'sfx/step_carpet2.ogg',
  'step_carpet3': 'sfx/step_carpet3.ogg',
  'step_wood1': 'sfx/step_wood1.ogg',
  'step_wood2': 'sfx/step_wood2.ogg',
  'step_wood3': 'sfx/step_wood3.ogg',
  'step_concrete1': 'sfx/step_concrete1.ogg',
  'step_concrete2': 'sfx/step_concrete2.ogg',
  'step_concrete3': 'sfx/step_concrete3.ogg',
  'impact_soft': 'sfx/impact_soft.ogg',
  'impact_plate': 'sfx/impact_plate.ogg',
  'impact_glass': 'sfx/impact_glass.ogg',
  'sub_drop': 'sfx/sub_drop.ogg',
  'rock_break': 'sfx/rock_break.ogg',
  'rock_break2': 'sfx/rock_break2.ogg',
  'rock_fall': 'sfx/rock_fall.ogg',
  'glass_break': 'sfx/glass_break.ogg',
  'whoosh1': 'sfx/whoosh1.ogg',
  'whoosh2': 'sfx/whoosh2.ogg',
  'whoosh3': 'sfx/whoosh3.ogg',
  'whoosh4': 'sfx/whoosh4.ogg',
};

export class Audio {
  constructor() {
    this.ready = false;
    this.buffers = new Map();
    this.loops = new Map();
    this.musicHandle = null;
    this.muted = false;
    this.volume = 0.8;
    this._lastStep = 0;
  }

  async init(onProgress = () => {}) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx({ latencyHint: 'interactive' });
    const ctx = this.ctx;

    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(ctx.destination);

    // gentle master shaping so nothing clips
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -10;
    this.limiter.knee.value = 12;
    this.limiter.ratio.value = 5;
    this.limiter.attack.value = 0.004;
    this.limiter.release.value = 0.28;
    this.limiter.connect(this.master);

    // global low-pass (used when the world is "consumed")
    this.muffle = ctx.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = 20000;
    this.muffle.Q.value = 0.4;
    this.muffle.connect(this.limiter);

    this.busMusic = ctx.createGain(); this.busMusic.gain.value = 0.55;
    this.busAmb = ctx.createGain(); this.busAmb.gain.value = 0.7;
    this.busSfx = ctx.createGain(); this.busSfx.gain.value = 0.85;
    for (const b of [this.busMusic, this.busAmb, this.busSfx]) b.connect(this.muffle);

    // noise buffer for procedural grit
    this.noise = this._makeNoise(2.4);
    this.brown = this._makeNoise(3.0, true);

    const entries = Object.entries(MANIFEST);
    let done = 0;
    await Promise.all(entries.map(async ([key, path]) => {
      try {
        const res = await fetch('audio/' + path);
        if (!res.ok) throw new Error(res.status);
        const arr = await res.arrayBuffer();
        const buf = await ctx.decodeAudioData(arr);
        this.buffers.set(key, buf);
      } catch (e) {
        console.warn('[audio] missing', key, e.message);
      } finally {
        done++;
        onProgress(done / entries.length);
      }
    }));
    this.ready = true;
    return this;
  }

  _makeNoise(seconds, brown = false) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let last = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.2; }
        else d[i] = w;
      }
    }
    return buf;
  }

  resume() {
    if (this.ctx && this.ctx.state !== 'running') this.ctx.resume();
  }

  get t() { return this.ctx ? this.ctx.currentTime : 0; }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  // ---------------------------------------------------------------- one-shot
  play(key, opts = {}) {
    if (!this.ready) return null;
    const buf = this.buffers.get(key);
    if (!buf) return null;
    const { vol = 1, rate = 1, pan = 0, bus = 'sfx', when = 0, randomRate = 0 } = opts;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate * (1 + (Math.random() * 2 - 1) * randomRate);
    const g = ctx.createGain();
    g.gain.value = vol;
    let node = src;
    if (pan) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      src.connect(g); g.connect(p); node = p;
    } else {
      src.connect(g);
    }
    const dest = bus === 'music' ? this.busMusic : bus === 'amb' ? this.busAmb : this.busSfx;
    node.connect(dest);
    const t0 = ctx.currentTime + when;
    src.start(t0);
    src.onended = () => { try { g.disconnect(); } catch (e) {} };
    return { src, gain: g, stop: (fade = 0.08) => {
      try {
        g.gain.setTargetAtTime(0, ctx.currentTime, fade / 3);
        src.stop(ctx.currentTime + fade);
      } catch (e) {}
    }};
  }

  // ------------------------------------------------------------------- loops
  loop(key, { vol = 1, fade = 1.5, bus = 'amb', rate = 1, id = key } = {}) {
    if (!this.ready) return null;
    if (this.loops.has(id)) this.stopLoop(id, fade);
    const buf = this.buffers.get(key);
    if (!buf) return null;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true; src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(g);
    const dest = bus === 'music' ? this.busMusic : bus === 'amb' ? this.busAmb : this.busSfx;
    g.connect(dest);
    src.start(0, Math.random() * buf.duration * 0.5);
    g.gain.setTargetAtTime(vol, ctx.currentTime, fade / 3);
    const handle = { src, gain: g, key, vol, bus };
    this.loops.set(id, handle);
    return handle;
  }

  setLoopVol(id, vol, time = 0.4) {
    const h = this.loops.get(id);
    if (h) h.gain.gain.setTargetAtTime(vol, this.ctx.currentTime, time / 3);
  }

  stopLoop(id, fade = 0.8) {
    const h = this.loops.get(id);
    if (!h) return;
    try {
      h.gain.gain.setTargetAtTime(0, this.ctx.currentTime, Math.max(0.01, fade / 3));
      h.src.stop(this.ctx.currentTime + fade + 0.1);
    } catch (e) {}
    this.loops.delete(id);
  }

  stopAllLoops(fade = 0.6) {
    for (const id of [...this.loops.keys()]) this.stopLoop(id, fade);
  }

  music(key, vol = 0.5, fade = 2.0) {
    if (this.musicHandle) this.stopLoop('music', fade);
    this.musicHandle = this.loop(key, { vol, fade, bus: 'music', id: 'music' });
    return this.musicHandle;
  }

  muffleTo(hz, time = 1.2) {
    if (!this.muffle) return;
    this.muffle.frequency.cancelScheduledValues(this.ctx.currentTime);
    this.muffle.frequency.setTargetAtTime(hz, this.ctx.currentTime, time / 3);
  }

  duck(amount = 0.35, time = 0.6) {
    if (!this.busMusic) return;
    this.busMusic.gain.setTargetAtTime(0.55 * amount, this.ctx.currentTime, time / 3);
  }

  unduck(time = 1.4) {
    if (!this.busMusic) return;
    this.busMusic.gain.setTargetAtTime(0.55, this.ctx.currentTime, time / 3);
  }

  // -------------------------------------------------------------- footsteps
  footstep(surface = 'carpet', intensity = 0.5) {
    if (!this.ready) return;
    const n = 1 + Math.floor(Math.random() * 3);
    const key = `step_${surface}${n}`;
    const now = this.ctx.currentTime;
    if (now - this._lastStep < 0.09) return;
    this._lastStep = now;
    this.play(key, { vol: 0.28 * intensity + 0.08, rate: 0.94 + Math.random() * 0.12, pan: (Math.random() - 0.5) * 0.35 });
  }

  // ----------------------------------------------------------- procedural fx
  /** Rising tension: filtered noise + detuned saws + accelerating heartbeat. */
  riser(duration = 6, intensity = 1) {
    if (!this.ready) return;
    const ctx = this.ctx, t0 = ctx.currentTime;
    // noise sweep
    const n = ctx.createBufferSource(); n.buffer = this.noise; n.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 3.5;
    bp.frequency.setValueAtTime(180, t0);
    bp.frequency.exponentialRampToValueAtTime(4200, t0 + duration);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.32 * intensity, t0 + duration * 0.92);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration + 0.25);
    n.connect(bp).connect(g).connect(this.busSfx);
    n.start(t0); n.stop(t0 + duration + 0.3);

    // low drone that swells
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(28, t0);
    o.frequency.exponentialRampToValueAtTime(72, t0 + duration);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 240;
    const og = ctx.createGain(); og.gain.setValueAtTime(0.0001, t0);
    og.gain.exponentialRampToValueAtTime(0.16 * intensity, t0 + duration * 0.9);
    og.gain.exponentialRampToValueAtTime(0.0001, t0 + duration + 0.4);
    o.connect(lp).connect(og).connect(this.busSfx);
    o.start(t0); o.stop(t0 + duration + 0.5);
  }

  /** Tape-stop / falling pitch noise for being swallowed. */
  downpitch(duration = 2.2) {
    if (!this.ready) return;
    const ctx = this.ctx, t0 = ctx.currentTime;
    const n = ctx.createBufferSource(); n.buffer = this.brown; n.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'lowpass';
    bp.frequency.setValueAtTime(3200, t0);
    bp.frequency.exponentialRampToValueAtTime(110, t0 + duration);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.35, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    n.connect(bp).connect(g).connect(this.busSfx);
    n.start(t0); n.stop(t0 + duration + 0.1);
    const o = ctx.createOscillator(); o.type = 'square';
    o.frequency.setValueAtTime(240, t0);
    o.frequency.exponentialRampToValueAtTime(24, t0 + duration);
    const og = ctx.createGain(); og.gain.setValueAtTime(0.06, t0);
    og.gain.exponentialRampToValueAtTime(0.0005, t0 + duration);
    const olp = ctx.createBiquadFilter(); olp.type = 'lowpass'; olp.frequency.value = 900;
    o.connect(olp).connect(og).connect(this.busSfx);
    o.start(t0); o.stop(t0 + duration + 0.1);
  }

  /** Broken digital stutter burst. */
  stutter(times = 5, gain = 0.18) {
    if (!this.ready) return;
    const ctx = this.ctx;
    let t = ctx.currentTime;
    for (let i = 0; i < times; i++) {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.playbackRate.value = 0.4 + Math.random() * 2.2;
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 500 + Math.random() * 2400;
      const g = ctx.createGain();
      const dur = 0.02 + Math.random() * 0.07;
      g.gain.setValueAtTime(gain * (1 - i / times * 0.5), t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(hp).connect(g).connect(this.busSfx);
      src.start(t, Math.random(), dur);
      t += dur + Math.random() * 0.03;
    }
  }

  /** Deep impact with a sub thump. */
  thump(gain = 0.6, freq = 62) {
    if (!this.ready) return;
    const ctx = this.ctx, t0 = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(freq, t0);
    o.frequency.exponentialRampToValueAtTime(26, t0 + 0.55);
    const g = ctx.createGain(); g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.8);
    o.connect(g).connect(this.busSfx);
    o.start(t0); o.stop(t0 + 0.85);
    this.play('sub_drop', { vol: gain * 0.5 });
  }

  heartbeat(period = 1.1, gain = 0.22, count = 2) {
    if (!this.ready) return () => {};
    const ctx = this.ctx;
    let i = 0, stopped = false;
    const beat = () => {
      if (stopped) return;
      const t0 = ctx.currentTime;
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(58, t0);
      o.frequency.exponentialRampToValueAtTime(30, t0 + 0.18);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gain, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.3);
      o.connect(g).connect(this.busSfx); o.start(t0); o.stop(t0 + 0.32);
      const o2 = ctx.createOscillator(); o2.type = 'sine';
      o2.frequency.setValueAtTime(44, t0 + 0.16);
      o2.frequency.exponentialRampToValueAtTime(26, t0 + 0.34);
      const g2 = ctx.createGain(); g2.gain.setValueAtTime(0.0001, t0 + 0.16);
      g2.gain.exponentialRampToValueAtTime(gain * 0.6, t0 + 0.18);
      g2.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
      o2.connect(g2).connect(this.busSfx); o2.start(t0 + 0.16); o2.stop(t0 + 0.52);
      i++;
      this._hbTimer = setTimeout(beat, period * 1000);
    };
    beat();
    return () => { stopped = true; clearTimeout(this._hbTimer); };
  }

  stopAll() {
    if (!this.ctx) return;
    this.stopAllLoops(0.2);
    this.muffleTo(20000, 0.3);
  }
}
