// audio.js — lightweight WebAudio manager (loops, one-shots, buses)
const FILES = {
  // room
  room_hum: 'room_hum.ogg', room_atmos: 'room_atmos.ogg',
  clock_tick: 'clock_tick.ogg', click: 'click.ogg', mclick: 'mclick.ogg',
  beep: 'beep.ogg', twobeep: 'twobeep.ogg', triplebeep: 'triplebeep.ogg',
  deniedbeep: 'deniedbeep.ogg', chime: 'chime.ogg', buzz: 'buzz.ogg', buzz_sigh: 'buzz_sigh.ogg',
  creak1: 'creak1.ogg', creak2: 'creak2.ogg', creak3: 'creak3.ogg',
  flicker: 'flicker.ogg', sparks1: 'sparks1.ogg', sparks2: 'sparks2.ogg', sparks3: 'sparks3.ogg',
  carpet1: 'carpet1.ogg', carpet2: 'carpet2.ogg', carpet3: 'carpet3.ogg',
  // transition / madness
  rend: 'rend.ogg', portal_open1: 'portal_open1.ogg', portal_open2: 'portal_open2.ogg',
  portal_open3: 'portal_open3.ogg', portal_travel: 'portal_travel.ogg', portal_close: 'portal_close.ogg',
  timeparadox: 'timeparadox.ogg', teleport_diss: 'teleport_diss.ogg', charge: 'charge.ogg',
  empulse: 'empulse.ogg', creepalert: 'creepalert.ogg', narsie: 'narsie_rises.ogg',
  static: 'static.ogg', radiostatic: 'radiostatic.ogg',
  // world
  world_amb: 'world_amb.ogg', world_amb2: 'world_amb2.ogg', world_amb3: 'world_amb3.ogg',
  world_amb4: 'world_amb4.ogg', voidsembrace: 'voidsembrace.ogg', voidsembrace_short: 'voidsembrace_short.ogg',
  ghost1: 'ghost1.ogg', ghost2: 'ghost2.ogg', ghosty_wind: 'ghosty_wind.ogg',
  ghost_whisper: 'ghost_whisper.ogg', far_noise: 'far_noise.ogg', veryfar_noise: 'veryfar_noise.ogg',
  sting_a: 'sting_a.ogg', sting_b: 'sting_b.ogg', sting_c: 'sting_c.ogg', sting_sin: 'sting_sin.ogg',
  malf: 'malf.ogg', sisyphus: 'sisyphus.ogg', title2: 'title2.ogg',
  asteroid1: 'asteroid1.ogg', asteroid2: 'asteroid2.ogg',
  catwalk1: 'catwalk1.ogg', catwalk2: 'catwalk2.ogg',
  // collapse / fall
  gateway: 'gateway_disrupted.ogg', alert: 'alert.ogg', siren: 'siren.ogg',
  glassbr1: 'glassbr1.ogg', glassbr2: 'glassbr2.ogg', glassbr3: 'glassbr3.ogg',
  glassknock: 'glassknock.ogg', glass_reverse: 'glass_reverse.ogg',
  explosioncreak: 'explosioncreak.ogg', explosionfar: 'explosionfar.ogg',
  explosion_distant: 'explosion_distant.ogg', meteorimpact: 'meteorimpact.ogg',
  rumble: 'rumble.ogg', rumble_far1: 'rumble_far1.ogg', rumble_far3: 'rumble_far3.ogg',
  wind: 'wind.ogg', bodyfall1: 'bodyfall1.ogg', bodyfall2: 'bodyfall2.ogg',
  // console
  terminal_prompt: 'terminal_prompt.ogg', terminal_success: 'terminal_success.ogg',
  terminal_error: 'terminal_error.ogg', doorclick: 'doorclick.ogg',
  ui_click: 'ui_click.wav', ui_click2: 'ui_click2.wav', ui_hover: 'ui_hover.wav', ui_switch: 'ui_switch.wav',
};

export class AudioMan {
  constructor() {
    this.ctx = null;
    this.buffers = new Map();
    this.pending = new Map();
    this.loops = new Set();
    this.masterGain = null;
    this.buses = {};
    this.ready = false;
    this.muted = false;
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.9;
    this.masterGain.connect(this.ctx.destination);
    for (const name of ['music', 'amb', 'sfx', 'ui']) {
      const g = this.ctx.createGain();
      g.gain.value = 1;
      g.connect(this.masterGain);
      this.buses[name] = g;
    }
    this.ready = true;
  }

  resume() {
    if (!this.ctx) this.init();
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  async preload(names) {
    if (!this.ctx) this.init();
    await Promise.all(names.map((n) => this.load(n)));
  }

  load(name) {
    if (this.buffers.has(name)) return Promise.resolve(this.buffers.get(name));
    if (this.pending.has(name)) return this.pending.get(name);
    const file = FILES[name];
    if (!file) return Promise.resolve(null);
    const p = fetch(`./assets/audio/${file}`)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error('404 ' + file))))
      .then((buf) => this.ctx.decodeAudioData(buf))
      .then((audio) => {
        this.buffers.set(name, audio);
        this.pending.delete(name);
        return audio;
      })
      .catch((e) => {
        this.pending.delete(name);
        console.warn('[audio]', name, e.message);
        return null;
      });
    this.pending.set(name, p);
    return p;
  }

  /** one-shot */
  play(name, opts = {}) {
    if (!this.ready || this.muted) return null;
    const buf = this.buffers.get(name);
    if (!buf) {
      this.load(name).then(() => {});
      return null;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = opts.rate || 1;
    if (opts.detune && src.detune) src.detune.value = opts.detune;
    const g = this.ctx.createGain();
    g.gain.value = opts.vol != null ? opts.vol : 1;
    let node = src;
    if (opts.pan != null && this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, opts.pan));
      src.connect(p);
      node = p;
    }
    node.connect(g);
    g.connect(this.buses[opts.bus || 'sfx']);
    src.start(0, opts.offset || 0);
    return { src, gain: g };
  }

  /** looping source with fadeable gain */
  loop(name, opts = {}) {
    if (!this.ready) return null;
    const buf = this.buffers.get(name);
    if (!buf) {
      this.load(name).then(() => {});
      return null;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.playbackRate.value = opts.rate || 1;
    const g = this.ctx.createGain();
    const target = opts.vol != null ? opts.vol : 1;
    g.gain.value = 0;
    src.connect(g);
    g.connect(this.buses[opts.bus || 'amb']);
    src.start();
    const t = this.ctx.currentTime;
    g.gain.linearRampToValueAtTime(target, t + (opts.fade != null ? opts.fade : 1.5));
    const handle = {
      src, gain: g,
      setVol: (v, fade = 0.6) => {
        const now = this.ctx.currentTime;
        g.gain.cancelScheduledValues(now);
        g.gain.setValueAtTime(g.gain.value, now);
        g.gain.linearRampToValueAtTime(v, now + fade);
      },
      setRate: (r, fade = 0.4) => {
        const now = this.ctx.currentTime;
        src.playbackRate.cancelScheduledValues(now);
        src.playbackRate.setValueAtTime(src.playbackRate.value, now);
        src.playbackRate.linearRampToValueAtTime(r, now + fade);
      },
      stop: (fade = 1.2) => {
        const now = this.ctx.currentTime;
        try {
          g.gain.cancelScheduledValues(now);
          g.gain.setValueAtTime(g.gain.value, now);
          g.gain.linearRampToValueAtTime(0, now + fade);
          src.stop(now + fade + 0.05);
        } catch (e) { /* already stopped */ }
        this.loops.delete(handle);
      },
    };
    this.loops.add(handle);
    return handle;
  }

  stopLoops(fade = 1.0) {
    for (const h of [...this.loops]) h.stop(fade);
  }

  setBus(name, vol, fade = 0.8) {
    const b = this.buses[name];
    if (!b) return;
    const now = this.ctx.currentTime;
    b.gain.cancelScheduledValues(now);
    b.gain.setValueAtTime(b.gain.value, now);
    b.gain.linearRampToValueAtTime(vol, now + fade);
  }

  get time() { return this.ctx ? this.ctx.currentTime : 0; }
}
