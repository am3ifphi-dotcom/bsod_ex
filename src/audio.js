// Audio: CC0 loops from GitHub (lavenderdotpet/CC0-Public-Domain-Sounds)
// layered with WebAudio synthesis (drones, glitch, wind, rumble) as designed sound + fallback.
const FILES = {
  rain: '/audio/rain.ogg', room: '/audio/room-ambient.ogg', noise: '/audio/noise-loop.ogg',
  world: '/audio/world-ambient.ogg', machine: '/audio/machine-loop.ogg', worldMachine: '/audio/world-machine.ogg',
  collapse: '/audio/collapse.ogg', beep: '/audio/beep.ogg', terminal: '/audio/terminal.ogg',
  teleport: '/audio/teleport.ogg', weird1: '/audio/weird1.ogg', weird2: '/audio/weird2.ogg',
};
export class AudioEngine {
  constructor() { this.ready = false; this.buffers = {}; this.loops = {}; this.synthNodes = []; }
  async init() {
    if (this.ready) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = this.ctx.createGain(); this.master.gain.value = 0.9; this.master.connect(this.ctx.destination);
    // shared noise buffer
    const len = this.ctx.sampleRate * 2; const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    await Promise.all(Object.entries(FILES).map(async ([k, url]) => {
      try { const r = await fetch(url); const ab = await r.arrayBuffer(); this.buffers[k] = await this.ctx.decodeAudioData(ab); }
      catch (e) { console.warn('audio missing', k, e); }
    }));
    this.ready = true;
  }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }
  _loop(name, key, vol, rate = 1) {
    this.stopLoop(name, 0.4);
    if (!this.buffers[key]) return null;
    const src = this.ctx.createBufferSource(); src.buffer = this.buffers[key]; src.loop = true; src.playbackRate.value = rate;
    const g = this.ctx.createGain(); g.gain.value = 0; g.gain.linearRampToValueAtTime(vol, this.ctx.currentTime + 1.2);
    src.connect(g); g.connect(this.master); src.start();
    this.loops[name] = { src, g, vol }; return this.loops[name];
  }
  stopLoop(name, fade = 0.8) { const l = this.loops[name]; if (!l) return; const t = this.ctx.currentTime; l.g.gain.cancelScheduledValues(t); l.g.gain.setValueAtTime(l.g.gain.value, t); l.g.gain.linearRampToValueAtTime(0, t + fade); try { l.src.stop(t + fade + 0.1); } catch {} delete this.loops[name]; }
  setLoopVol(name, v) { const l = this.loops[name]; if (l) l.g.gain.linearRampToValueAtTime(v, this.ctx.currentTime + 0.3); }
  startRoom(after = false) { this._loop('rain', 'rain', after ? 0.10 : 0.14); this._loop('room', 'room', 0.10, after ? 0.94 : 1); this.startDrone(after ? 46 : 0); }
  startWorld() { this.stopLoop('rain', 1); this.stopLoop('room', 1); this._loop('world', 'world', 0.16); this._loop('wmachine', 'worldMachine', 0.07); this.startDrone(55); }
  startDrone(freq) {
    this.stopDrone();
    if (!freq) return;
    const g = this.ctx.createGain(); g.gain.value = 0; g.gain.linearRampToValueAtTime(0.045, this.ctx.currentTime + 2);
    const o1 = this.ctx.createOscillator(); o1.type = 'sine'; o1.frequency.value = freq;
    const o2 = this.ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = freq * 1.007;
    const o3 = this.ctx.createOscillator(); o3.type = 'triangle'; o3.frequency.value = freq * 2.02;
    const g3 = this.ctx.createGain(); g3.gain.value = 0.25;
    o1.connect(g); o2.connect(g); o3.connect(g3); g3.connect(g); g.connect(this.master);
    o1.start(); o2.start(); o3.start(); this.drone = { g, o1, o2, o3 };
  }
  stopDrone() { if (!this.drone) return; const t = this.ctx.currentTime; this.drone.g.gain.linearRampToValueAtTime(0, t + 0.6); const d = this.drone; setTimeout(() => { try { d.o1.stop(); d.o2.stop(); d.o3.stop(); } catch {} }, 800); this.drone = null; }
  play(key, { vol = 0.5, rate = 1, pan = 0 } = {}) {
    if (!this.ready || !this.buffers[key]) return;
    const src = this.ctx.createBufferSource(); src.buffer = this.buffers[key]; src.playbackRate.value = rate;
    const g = this.ctx.createGain(); g.gain.value = vol;
    let node = g;
    if (pan && this.ctx.createStereoPanner) { const p = this.ctx.createStereoPanner(); p.pan.value = pan; g.connect(p); node = p; }
    src.connect(g); node.connect(this.master); src.start();
  }
  // --- synthesis ---
  glitchBurst(intensity = 0.5, dur = 0.28) {
    if (!this.ready) return; const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.setValueAtTime(400 + Math.random() * 3000, t); f.frequency.exponentialRampToValueAtTime(80, t + dur); f.Q.value = 2;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12 + intensity * 0.3, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master); src.start(t); src.stop(t + dur + 0.05);
    // digital chirps
    for (let i = 0; i < 3 + intensity * 6; i++) {
      const o = this.ctx.createOscillator(); o.type = 'square'; const st = t + Math.random() * dur;
      o.frequency.setValueAtTime(200 + Math.random() * 4000, st); o.frequency.exponentialRampToValueAtTime(60, st + 0.05);
      const og = this.ctx.createGain(); og.gain.setValueAtTime(0.05 * intensity, st); og.gain.exponentialRampToValueAtTime(0.0001, st + 0.06);
      o.connect(og); og.connect(this.master); o.start(st); o.stop(st + 0.08);
    }
  }
  clickHard() { this.play('beep', { vol: 0.25, rate: 0.7 }); this.glitchBurst(0.4, 0.15); }
  devourRise(dur = 5) { // rising shepard-ish pull
    if (!this.ready) return null; const t = this.ctx.currentTime;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16, t + dur * 0.8); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.4);
    g.connect(this.master);
    const oscs = [];
    for (let i = 0; i < 4; i++) { const o = this.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(55 * Math.pow(2, i * 0.5), t); o.frequency.exponentialRampToValueAtTime(55 * Math.pow(2, i * 0.5 + 2.2), t + dur); const og = this.ctx.createGain(); og.gain.value = 0.25 / (i + 1); const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900; o.connect(f); f.connect(og); og.connect(g); o.start(t); o.stop(t + dur + 0.5); oscs.push(o); }
    const n = this.ctx.createBufferSource(); n.buffer = this.noiseBuf; n.loop = true; const nf = this.ctx.createBiquadFilter(); nf.type = 'highpass'; nf.frequency.setValueAtTime(200, t); nf.frequency.exponentialRampToValueAtTime(6000, t + dur); const ng = this.ctx.createGain(); ng.gain.value = 0.35; n.connect(nf); nf.connect(ng); ng.connect(g); n.start(t); n.stop(t + dur + 0.5);
    return { stop: () => { try { g.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.2); } catch {} } };
  }
  rumble(dur = 3, vol = 0.4) {
    if (!this.ready) return; const t = this.ctx.currentTime;
    const n = this.ctx.createBufferSource(); n.buffer = this.noiseBuf; n.loop = true;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 120;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.3); g.gain.setValueAtTime(vol, t + dur - 0.5); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(f); f.connect(g); g.connect(this.master); n.start(t); n.stop(t + dur + 0.1);
    const o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(38, t); o.frequency.linearRampToValueAtTime(24, t + dur); o.connect(g); o.start(t); o.stop(t + dur + 0.1);
  }
  windSwell(dur = 4) {
    if (!this.ready) return; const t = this.ctx.currentTime;
    const n = this.ctx.createBufferSource(); n.buffer = this.noiseBuf; n.loop = true;
    const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 0.7; f.frequency.setValueAtTime(300, t); f.frequency.linearRampToValueAtTime(1400, t + dur);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.22, t + dur * 0.6); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(f); f.connect(g); g.connect(this.master); n.start(t); n.stop(t + dur + 0.1);
  }
  tick() { if (!this.ready) return; const t = this.ctx.currentTime; const o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 1900; const g = this.ctx.createGain(); g.gain.setValueAtTime(0.012, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03); o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.05); }
  thud(vol = 0.5) { if (!this.ready) return; const t = this.ctx.currentTime; const o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(32, t + 0.35); const g = this.ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4); o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.45); this.rumble(0.5, vol * 0.4); }
}
