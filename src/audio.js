// audio.js — 100% synthesized sound design (Web Audio). No audio files.
// Master -> compressor (loudness safety). Spatial emitters via PannerNode.
// Generated impulse reverb for the BSOD world. All loops are seamless buffers.
export class AudioEngine {
  constructor() { this.ready = false; this.volume = .8; this.muted = false; }
  init() {
    if (this.ready) return;
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = ctx.createGain(); this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 22; comp.ratio.value = 8; comp.attack.value = .004; comp.release.value = .24;
    const limiter = ctx.createGain(); limiter.gain.value = .92;
    this.master.connect(comp); comp.connect(limiter); limiter.connect(ctx.destination);
    // reverb send (generated impulse, 2.8s decay)
    this.verb = ctx.createConvolver(); this.verb.buffer = this._impulse(2.8, 2.6);
    this.verbGain = ctx.createGain(); this.verbGain.gain.value = 0;
    this.verb.connect(this.verbGain); this.verbGain.connect(this.master);
    this.noiseBuf = this._noise(2);
    this.listener = ctx.listener;
    this.ready = true;
    this._layers = {};
  }
  resume() { if (this.ready && this.ctx.state === 'suspended') this.ctx.resume(); }
  setVolume(v) { this.volume = v; if (this.ready) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, .05); }
  setReverb(amount) { if (this.ready) this.verbGain.gain.setTargetAtTime(amount, this.ctx.currentTime, .4); }
  _noise(sec) { const b = this.ctx.createBuffer(1, this.ctx.sampleRate * sec, this.ctx.sampleRate); const d = b.getChannelData(0);
    let last = 0; for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; last = (last + .02 * w) / 1.02; d[i] = (w * .55 + last * 2.2) * .6; } return b; }
  _impulse(sec, decay) { const rate = this.ctx.sampleRate, b = this.ctx.createBuffer(2, rate * sec, rate);
    for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, decay); } return b; }
  setListener(pos, fwd, up) { if (!this.ready) return; const L = this.listener, t = this.ctx.currentTime;
    if (L.positionX) { L.positionX.setTargetAtTime(pos.x, t, .03); L.positionY.setTargetAtTime(pos.y, t, .03); L.positionZ.setTargetAtTime(pos.z, t, .03);
      L.forwardX.setTargetAtTime(fwd.x, t, .03); L.forwardY.setTargetAtTime(fwd.y, t, .03); L.forwardZ.setTargetAtTime(fwd.z, t, .03);
      L.upX.value = up.x; L.upY.value = up.y; L.upZ.value = up.z; }
  }
  _src(buf, loop = true) { const s = this.ctx.createBufferSource(); s.buffer = buf || this.noiseBuf; s.loop = loop; return s; }
  _filter(type, freq, q = .7) { const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; return f; }
  _gain(v = 0) { const g = this.ctx.createGain(); g.gain.value = v; return g; }
  _panner(x, y, z, ref = 2, max = 60) { const p = this.ctx.createPanner(); p.panningModel = 'HRTF'; p.distanceModel = 'inverse';
    p.refDistance = ref; p.maxDistance = max; p.rolloffFactor = 1.1; p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; return p; }
  _layer(name, build) { if (this._layers[name]) return this._layers[name]; const L = build(); L.out.connect(this.master); if (L.verb) L.out.connect(this.verb); this._layers[name] = L; return L; }
  fade(name, v, t = .6) { const L = this._layers[name]; if (L) L.out.gain.setTargetAtTime(v, this.ctx.currentTime, t / 3); }

  /* ----- continuous layers ----- */
  roomAmbience(fanPos, clockPos) {
    const ctx = this.ctx;
    this._layer('fan', () => { const out = this._gain(0); const s = this._src(); const f = this._filter('bandpass', 340, .5);
      const hum = ctx.createOscillator(); hum.type = 'sine'; hum.frequency.value = 118; const hg = this._gain(.16);
      const pan = this._panner(fanPos.x, fanPos.y, fanPos.z, 1.2, 14);
      s.connect(f); f.connect(pan); hum.connect(hg); hg.connect(pan); pan.connect(out); s.start(); hum.start(); return { out }; });
    this._layer('roomtone', () => { const out = this._gain(0); const s = this._src(); const f = this._filter('lowpass', 180);
      s.connect(f); f.connect(out); s.start(); return { out }; });
    this.clockPanPos = clockPos;
  }
  clockTick() { if (!this.ready || !this.clockPanPos) return; const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'square'; o.frequency.setValueAtTime(1900, t); o.frequency.exponentialRampToValueAtTime(900, t + .012);
    const g = this._gain(0); g.gain.setValueAtTime(.10, t); g.gain.exponentialRampToValueAtTime(.0001, t + .03);
    const pan = this._panner(this.clockPanPos.x, this.clockPanPos.y, this.clockPanPos.z, 1, 12);
    o.connect(g); g.connect(pan); pan.connect(this.master); o.start(t); o.stop(t + .04); }
  distantCar() { if (!this.ready) return; const ctx = this.ctx, t = ctx.currentTime; const dur = 5 + Math.random() * 4;
    const s = this._src(); const f = this._filter('bandpass', 240, 1.4); const g = this._gain(0);
    f.frequency.setValueAtTime(160, t); f.frequency.linearRampToValueAtTime(420, t + dur * .5); f.frequency.linearRampToValueAtTime(140, t + dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.035, t + dur * .45); g.gain.linearRampToValueAtTime(0, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t); s.stop(t + dur + .1); }
  worldAmbience() {
    const ctx = this.ctx;
    this._layer('drone', () => { const out = this._gain(0);
      [55, 55.4, 110.3].forEach((fr, i) => { const o = ctx.createOscillator(); o.type = i < 2 ? 'sine' : 'triangle'; o.frequency.value = fr;
        const g = this._gain(i < 2 ? .12 : .03); const lfo = ctx.createOscillator(); lfo.frequency.value = .07 + i * .03;
        const lg = this._gain(.04); lfo.connect(lg); lg.connect(g.gain); o.connect(g); g.connect(out); o.start(); lfo.start(); });
      return { out, verb: true }; });
    this._layer('wind', () => { const out = this._gain(0); const s = this._src(); const f = this._filter('bandpass', 520, .45);
      const lfo = ctx.createOscillator(); lfo.frequency.value = .06; const lg = this._gain(230); lfo.connect(lg); lg.connect(f.frequency);
      s.connect(f); f.connect(out); s.start(); lfo.start(); return { out, verb: true }; });
    this._layer('deep', () => { const out = this._gain(0); const s = this._src(); const f = this._filter('lowpass', 120);
      s.connect(f); f.connect(out); s.start(); return { out, verb: true }; });
  }
  spireHum(pos) { const ctx = this.ctx;
    this._layer('spire', () => { const out = this._gain(0); const pan = this._panner(pos.x, pos.y, pos.z, 14, 420);
      [82.4, 164.8, 247].forEach((fr, i) => { const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = fr;
        const g = this._gain([.16, .07, .03][i]); o.connect(g); g.connect(pan); o.start(); });
      pan.connect(out); return { out, verb: true }; }); }
  dataChirp() { if (!this.ready) return; const ctx = this.ctx, t = ctx.currentTime; // sparse world detail
    const o = ctx.createOscillator(); o.type = 'sine'; const f0 = 900 + Math.random() * 2200;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * (Math.random() < .5 ? .5 : 1.6), t + .09);
    const g = this._gain(0); g.gain.setValueAtTime(.012 + Math.random() * .02, t); g.gain.exponentialRampToValueAtTime(.0001, t + .12);
    o.connect(g); g.connect(this.master); g.connect(this.verb); o.start(t); o.stop(t + .14); }

  /* ----- one shots ----- */
  footstep(world = false, run = false) { if (!this.ready) return; const ctx = this.ctx, t = ctx.currentTime;
    const s = this._src(null, false); s.playbackRate.value = .9 + Math.random() * .25;
    const f = this._filter('lowpass', world ? 700 : 480); const g = this._gain(0);
    const peak = run ? .17 : .12; g.gain.setValueAtTime(peak, t); g.gain.exponentialRampToValueAtTime(.0001, t + .11);
    s.connect(f); f.connect(g); g.connect(this.master); if (world) g.connect(this.verb); s.start(t, Math.random() * 1.5); s.stop(t + .13); }
  uiClick() { this._blip(1350, .05, .06, 'square'); }
  _blip(freq, dur, vol, type = 'sine') { if (!this.ready) return; const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq; const g = this._gain(0);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + .02); }
  glitchHit(stage01) { if (!this.ready) return; const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sawtooth'; const f0 = 320 - stage01 * 180 + Math.random() * 60;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(38, f0 * .22), t + .16 + stage01 * .14);
    const g = this._gain(0); g.gain.setValueAtTime(.05 + stage01 * .11, t); g.gain.exponentialRampToValueAtTime(.0001, t + .22 + stage01 * .16);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + .45);
    const n = this._src(null, false); const nf = this._filter('highpass', 2400 - stage01 * 1500); const ng = this._gain(0);
    ng.gain.setValueAtTime(.03 + stage01 * .09, t); ng.gain.exponentialRampToValueAtTime(.0001, t + .09 + stage01 * .1);
    n.connect(nf); nf.connect(ng); ng.connect(this.master); n.start(t, Math.random()); n.stop(t + .25); }
  errorBuzz() { if (!this.ready) return; const ctx = this.ctx, t = ctx.currentTime;
    [0, .09].forEach(off => { const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = 146;
      const g = this._gain(0); g.gain.setValueAtTime(.045, t + off); g.gain.setValueAtTime(.045, t + off + .05); g.gain.exponentialRampToValueAtTime(.0001, t + off + .075);
      o.connect(g); g.connect(this.master); o.start(t + off); o.stop(t + off + .09); }); }
  discover() { if (!this.ready) return; const ctx = this.ctx, t = ctx.currentTime;
    [523.25, 783.99, 1046.5].forEach((fr, i) => { const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = fr;
      const g = this._gain(0); const st = t + i * .14; g.gain.setValueAtTime(0, st); g.gain.linearRampToValueAtTime(.06, st + .03); g.gain.exponentialRampToValueAtTime(.0001, st + 1.4);
      o.connect(g); g.connect(this.master); g.connect(this.verb); o.start(st); o.stop(st + 1.5); }); }
  fragmentPickup() { this._blip(880, .3, .05); setTimeout(() => this._blip(1318, .45, .045), 70); }
  devourSwell(dur = 3.2) { if (!this.ready) return; const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(46, t); o.frequency.exponentialRampToValueAtTime(920, t + dur * .82); o.frequency.exponentialRampToValueAtTime(30, t + dur);
    const f = this._filter('lowpass', 300); f.frequency.exponentialRampToValueAtTime(5200, t + dur * .8);
    const g = this._gain(0); g.gain.linearRampToValueAtTime(.13, t + dur * .8); g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(f); f.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + .05);
    const n = this._src(); const nf = this._filter('bandpass', 400, .8); nf.frequency.exponentialRampToValueAtTime(2600, t + dur * .8);
    const ng = this._gain(0); ng.gain.linearRampToValueAtTime(.10, t + dur * .75); ng.gain.linearRampToValueAtTime(0, t + dur);
    n.connect(nf); nf.connect(ng); ng.connect(this.master); n.start(t); n.stop(t + dur + .05); }
  subDrop() { if (!this.ready) return; const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(26, t + 1.1);
    const g = this._gain(0); g.gain.setValueAtTime(.34, t); g.gain.exponentialRampToValueAtTime(.0001, t + 1.25);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 1.3); }
  crack(big = false) { if (!this.ready) return; const ctx = this.ctx, t = ctx.currentTime;
    const n = 3 + (Math.random() * (big ? 9 : 4) | 0);
    for (let i = 0; i < n; i++) { const st = t + Math.random() * (big ? .5 : .18); const s = this._src(null, false);
      const f = this._filter('bandpass', 700 + Math.random() * 2600, 2.4); const g = this._gain(0);
      g.gain.setValueAtTime(big ? .22 : .13, st); g.gain.exponentialRampToValueAtTime(.0001, st + .05 + Math.random() * .09);
      s.connect(f); f.connect(g); g.connect(this.master); g.connect(this.verb); s.start(st, Math.random()); s.stop(st + .18); } }
  rumble(dur = 4) { if (!this.ready) return; const ctx = this.ctx, t = ctx.currentTime;
    const s = this._src(); const f = this._filter('lowpass', 95); const g = this._gain(0);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.5, t + .8); g.gain.setValueAtTime(.5, t + dur * .7); g.gain.linearRampToValueAtTime(0, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t); s.stop(t + dur + .1);
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 33; const og = this._gain(0);
    og.gain.linearRampToValueAtTime(.22, t + 1); og.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(og); og.connect(this.master); o.start(t); o.stop(t + dur + .1); }
  breath(panic = .5) { if (!this.ready) return; const ctx = this.ctx, t = ctx.currentTime; const dur = .5 - panic * .22;
    const s = this._src(null, false); const f = this._filter('bandpass', 900 + panic * 500, .9); const g = this._gain(0);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.028 + panic * .05, t + dur * .45); g.gain.linearRampToValueAtTime(0, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t, Math.random()); s.stop(t + dur + .05); }
  fallWind() { const ctx = this.ctx; return this._layer('fallwind', () => { const out = this._gain(0);
    const s = this._src(); const f = this._filter('bandpass', 500, .6); s.connect(f); f.connect(out); s.start();
    return { out, filter: f }; }); }
  setFallWind(v01) { const L = this._layers['fallwind']; if (!L) return; const t = this.ctx.currentTime;
    L.out.gain.setTargetAtTime(v01 * .4, t, .1); if (L.filter) L.filter.frequency.setTargetAtTime(380 + v01 * 1500, t, .1); }
  landThud() { if (!this.ready) return; const ctx = this.ctx, t = ctx.currentTime;
    const s = this._src(null, false); const f = this._filter('lowpass', 220); const g = this._gain(0);
    g.gain.setValueAtTime(.5, t); g.gain.exponentialRampToValueAtTime(.0001, t + .3);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t); s.stop(t + .35);
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(74, t); o.frequency.exponentialRampToValueAtTime(34, t + .28);
    const og = this._gain(0); og.gain.setValueAtTime(.3, t); og.gain.exponentialRampToValueAtTime(.0001, t + .32);
    o.connect(og); og.connect(this.master); o.start(t); o.stop(t + .36);
    // chair creak
    const c = ctx.createOscillator(); c.type = 'sawtooth'; c.frequency.setValueAtTime(180, t + .05); c.frequency.linearRampToValueAtTime(96, t + .3);
    const cf = this._filter('bandpass', 520, 4); const cg = this._gain(0); cg.gain.setValueAtTime(.03, t + .05); cg.gain.exponentialRampToValueAtTime(.0001, t + .34);
    c.connect(cf); cf.connect(cg); cg.connect(this.master); c.start(t + .05); c.stop(t + .38); }
}
