// Fully procedural sound design (no audio files): every sound below is
// synthesised with the Web Audio API, so all audio is original / CC0 by
// construction.  Bus layout:
//
//   sources -> [bus gain] -> preMaster -> compressor -> limiter -> destination
//                          \-> reverbSend -> convolver -> wet -> preMaster
//
// PannerNodes are used for positional sources (monument hum, city ambience).
import * as THREE from 'three';
import { settings } from './settings';
import { RNG, clamp } from './utils';

type Surf = 'wood' | 'carpet' | 'concrete' | 'sand' | 'metal' | 'glass';

const rng = new RNG(90210);

export class AudioEngine {
  ctx: AudioContext | null = null;
  private preMaster!: GainNode;
  private comp!: DynamicsCompressorNode;
  private limiter!: DynamicsCompressorNode;
  private reverb!: ConvolverNode;
  private reverbSend!: GainNode;
  private sfxBus!: GainNode;
  private ambBus!: GainNode;
  private uiBus!: GainNode;
  private noiseWhite!: AudioBuffer;
  private noisePink!: AudioBuffer;

  private roomAmb: AmbienceRoom | null = null;
  private worldAmb: AmbienceWorld | null = null;
  private wind: FallWind | null = null;
  private monumentHum: { panner: PannerNode; gain: GainNode; oscs: OscillatorNode[] } | null = null;
  private started = false;
  private tClock = 0;

  get ready() { return !!this.ctx; }
  get time() { return this.ctx?.currentTime ?? 0; }

  async init() {
    if (this.ctx) { await this.ctx.resume(); return; }
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    const ctx: AudioContext = new Ctx({ latencyHint: 'interactive' });
    this.ctx = ctx;

    this.preMaster = ctx.createGain();
    this.preMaster.gain.value = 0.9;

    // gentle bus compression, then a hard-ish limiter for safety
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.knee.value = 22;
    this.comp.ratio.value = 2.4;
    this.comp.attack.value = 0.008;
    this.comp.release.value = 0.24;

    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -3;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.002;
    this.limiter.release.value = 0.12;

    this.preMaster.connect(this.comp);
    this.comp.connect(this.limiter);
    this.limiter.connect(ctx.destination);

    // reverb: procedurally generated impulse response (decaying noise)
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(2.9, 2.6);
    const wet = ctx.createGain();
    wet.gain.value = 0.5;
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.34;
    this.reverbSend.connect(this.reverb);
    this.reverb.connect(wet);
    wet.connect(this.preMaster);

    this.sfxBus = ctx.createGain(); this.sfxBus.gain.value = 1.0; this.sfxBus.connect(this.preMaster);
    this.ambBus = ctx.createGain(); this.ambBus.gain.value = 0.85; this.ambBus.connect(this.preMaster);
    this.uiBus = ctx.createGain(); this.uiBus.gain.value = 0.55; this.uiBus.connect(this.preMaster);

    this.noiseWhite = this.makeNoise(2, 'white');
    this.noisePink = this.makeNoise(3, 'pink');
    this.applyVolume();
    this.started = true;
    await ctx.resume();
  }

  applyVolume() {
    if (!this.ctx) return;
    const v = settings.value.volume;
    const target = v <= 0 ? 0 : Math.pow(v, 1.35) * 0.95;
    this.preMaster.gain.setTargetAtTime(target, this.ctx.currentTime, 0.05);
  }

  suspend() { this.ctx?.suspend(); }
  resume() { this.ctx?.resume(); }

  // ------------------------------------------------------------- buffers
  private makeNoise(seconds: number, kind: 'white' | 'pink') {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    if (kind === 'white') {
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } else {
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      }
    }
    return buf;
  }

  private makeImpulse(seconds: number, decay: number) {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        const env = Math.pow(1 - t, decay);
        // low-passed noise = darker, roomier tail
        lp += ((Math.random() * 2 - 1) - lp) * 0.34;
        d[i] = lp * env * (i < 60 ? i / 60 : 1);
      }
    }
    return buf;
  }

  private noiseSrc(pink = true, playbackRate = 1) {
    const s = this.ctx!.createBufferSource();
    s.buffer = pink ? this.noisePink : this.noiseWhite;
    s.loop = true;
    s.playbackRate.value = playbackRate;
    return s;
  }

  // ------------------------------------------------------------ primitives
  private env(g: GainNode, t0: number, a: number, peak: number, d: number, hold = 0) {
    const p = g.gain;
    p.cancelScheduledValues(t0);
    p.setValueAtTime(0.0001, t0);
    p.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + a);
    if (hold > 0) p.setValueAtTime(Math.max(0.0002, peak), t0 + a + hold);
    p.exponentialRampToValueAtTime(0.0001, t0 + a + hold + d);
  }

  private sendReverb(node: AudioNode, amount: number) {
    const g = this.ctx!.createGain();
    g.gain.value = amount;
    node.connect(g);
    g.connect(this.reverbSend);
  }

  private burst(opts: {
    bus?: GainNode; t?: number; dur?: number; gain?: number; type?: BiquadFilterType;
    freq: number; freqEnd?: number; q?: number; pink?: boolean; reverb?: number; rate?: number;
  }) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = opts.t ?? ctx.currentTime;
    const src = this.noiseSrc(opts.pink ?? false, opts.rate ?? 1);
    const filt = ctx.createBiquadFilter();
    filt.type = opts.type ?? 'bandpass';
    filt.frequency.setValueAtTime(opts.freq, t);
    if (opts.freqEnd) filt.frequency.exponentialRampToValueAtTime(Math.max(40, opts.freqEnd), t + (opts.dur ?? 0.2));
    filt.Q.value = opts.q ?? 1.2;
    const g = ctx.createGain();
    this.env(g, t, Math.min(0.02, (opts.dur ?? 0.2) * 0.2), opts.gain ?? 0.2, (opts.dur ?? 0.2));
    src.connect(filt); filt.connect(g); g.connect(opts.bus ?? this.sfxBus);
    if (opts.reverb) this.sendReverb(g, opts.reverb);
    src.start(t); src.stop(t + (opts.dur ?? 0.2) + 0.1);
  }

  private tone(opts: {
    bus?: GainNode; t?: number; dur?: number; gain?: number; type?: OscillatorType;
    f0: number; f1?: number; detune?: number; reverb?: number; glide?: number;
  }) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = opts.t ?? ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = opts.type ?? 'sine';
    o.frequency.setValueAtTime(opts.f0, t);
    if (opts.f1 != null) {
      const gl = opts.glide ?? opts.dur ?? 0.3;
      o.frequency.exponentialRampToValueAtTime(Math.max(8, opts.f1), t + gl);
    }
    if (opts.detune) o.detune.value = opts.detune;
    const g = ctx.createGain();
    this.env(g, t, 0.006, opts.gain ?? 0.2, opts.dur ?? 0.3);
    o.connect(g); g.connect(opts.bus ?? this.sfxBus);
    if (opts.reverb) this.sendReverb(g, opts.reverb);
    o.start(t); o.stop(t + (opts.dur ?? 0.3) + 0.12);
  }

  // --------------------------------------------------------------- ambience
  startRoomAmbience() {
    if (!this.ctx) return;
    this.stopWorldAmbience();
    if (!this.roomAmb) this.roomAmb = new AmbienceRoom(this);
    this.roomAmb.start();
  }
  stopRoomAmbience() { this.roomAmb?.stop(); }

  startWorldAmbience() {
    if (!this.ctx) return;
    this.stopRoomAmbience();
    if (!this.worldAmb) this.worldAmb = new AmbienceWorld(this);
    this.worldAmb.start();
    this.startMonumentHum(new THREE.Vector3(0, 14, 0));
  }
  stopWorldAmbience() { this.worldAmb?.stop(); this.stopMonumentHum(); }

  /** internal helper so the ambience classes can talk to the engine */
  amb(): {
    ctx: AudioContext; bus: GainNode; pink: AudioBuffer; sink: (n: AudioNode, wet: number) => void;
  } {
    return {
      ctx: this.ctx!, bus: this.ambBus, pink: this.noisePink,
      sink: (n, wet) => {
        n.connect(this.ambBus);
        if (wet > 0) this.sendReverb(n, wet);
      },
    };
  }

  startMonumentHum(pos: THREE.Vector3) {
    if (!this.ctx || this.monumentHum) return;
    const ctx = this.ctx;
    const panner = ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 12;
    panner.rolloffFactor = 1.1;
    panner.maxDistance = 260;
    setPannerPos(panner, pos);
    const gain = ctx.createGain();
    gain.gain.value = 0.22;
    const oscs: OscillatorNode[] = [];
    for (const [f, g] of [[41.2, 0.5], [61.8, 0.26], [123.6, 0.09]] as const) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 220; lp.Q.value = 2;
      const og = ctx.createGain(); og.gain.value = g;
      // slow tremolo for a "breathing machine" feel
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07 + f * 0.001;
      const lg = ctx.createGain(); lg.gain.value = 0.35;
      lfo.connect(lg); lg.connect(og.gain);
      o.connect(lp); lp.connect(og); og.connect(gain);
      o.start(); lfo.start();
      oscs.push(o, lfo);
    }
    gain.connect(panner); panner.connect(this.sfxBus);
    this.sendReverb(panner, 0.5);
    this.monumentHum = { panner, gain, oscs };
  }
  stopMonumentHum() {
    if (!this.monumentHum) return;
    const { panner, oscs } = this.monumentHum;
    const g = this.monumentHum.gain;
    g.gain.setTargetAtTime(0, this.ctx!.currentTime, 0.25);
    setTimeout(() => {
      oscs.forEach((o) => { try { o.stop(); } catch { /* already stopped */ } });
      try { panner.disconnect(); } catch { /* noop */ }
    }, 900);
    this.monumentHum = null;
  }

  // ------------------------------------------------------------------ sfx
  footstep(surface: Surf, running: boolean) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + 0.001;
    const v = running ? 1 : 0.72;
    switch (surface) {
      case 'wood':
        this.burst({ t, dur: 0.09, gain: 0.24 * v, freq: 320 + rng.range(-60, 90), freqEnd: 130, q: 1.4, reverb: 0.12 });
        this.burst({ t: t + 0.012, dur: 0.05, gain: 0.1 * v, freq: 2400, q: 2.4, pink: true });
        break;
      case 'carpet':
        this.burst({ t, dur: 0.13, gain: 0.16 * v, freq: 240, q: 0.7, pink: true });
        break;
      case 'sand':
        this.burst({ t, dur: 0.2, gain: 0.16 * v, freq: 1500, freqEnd: 600, q: 0.6, pink: true, reverb: 0.2 });
        this.burst({ t: t + 0.03, dur: 0.07, gain: 0.07 * v, freq: 320, q: 1.1 });
        break;
      case 'metal':
        this.burst({ t, dur: 0.11, gain: 0.2 * v, freq: 900, freqEnd: 320, q: 3 });
        this.tone({ t, dur: 0.22, gain: 0.05 * v, f0: 220 + rng.range(-20, 30), f1: 180, type: 'triangle', reverb: 0.7 });
        break;
      case 'glass':
        this.burst({ t, dur: 0.06, gain: 0.14 * v, freq: 3200, q: 4, reverb: 0.5 });
        this.burst({ t, dur: 0.12, gain: 0.1 * v, freq: 700, q: 1.5 });
        break;
      default: // concrete
        this.burst({ t, dur: 0.1, gain: 0.22 * v, freq: 420 + rng.range(-80, 120), freqEnd: 180, q: 1.1, reverb: 0.45 });
        this.burst({ t: t + 0.008, dur: 0.12, gain: 0.07 * v, freq: 1200, q: 0.8, pink: true, reverb: 0.55 });
    }
  }

  bsodClick(stage: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone({ t, f0: 900 - stage * 90, f1: 220 - stage * 12, dur: 0.1, gain: 0.16, type: 'square', reverb: 0.1 });
    this.burst({ t, dur: 0.06, gain: 0.14, freq: 2600 + stage * 260, q: 2.6, reverb: 0.2 });
    if (stage > 1) this.burst({ t: t + 0.03, dur: 0.18, gain: 0.1 * stage / 5, freq: 480, freqEnd: 90, q: 1.4 });
  }

  glitchBurst(intensity = 1) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const i = clamp(intensity, 0.1, 1);
    // digital stutter: rapid random gated noise
    const n = 2 + Math.floor(i * 4);
    for (let k = 0; k < n; k++) {
      const tt = t + k * rng.range(0.015, 0.05);
      this.burst({ t: tt, dur: rng.range(0.02, 0.06), gain: 0.12 * i, freq: rng.range(500, 7000), q: rng.range(2, 9) });
    }
    this.tone({ t, f0: rng.range(120, 900), f1: rng.range(40, 1600), dur: 0.06 + i * 0.1, gain: 0.07 * i, type: 'sawtooth' });
  }

  tear() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.burst({ t, dur: 0.32, gain: 0.16, freq: 2600, freqEnd: 220, q: 0.8, reverb: 0.4 });
    this.tone({ t, f0: 220, f1: 48, dur: 0.34, gain: 0.1, type: 'sawtooth', reverb: 0.3 });
  }

  ui(kind: 'hover' | 'click' | 'open' | 'close' | 'error' = 'click') {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    switch (kind) {
      case 'hover': this.tone({ bus: this.uiBus, t, f0: 1600, dur: 0.03, gain: 0.05, type: 'sine' }); break;
      case 'click': this.tone({ bus: this.uiBus, t, f0: 780, f1: 640, dur: 0.05, gain: 0.11, type: 'square' }); break;
      case 'open': this.tone({ bus: this.uiBus, t, f0: 420, f1: 760, dur: 0.14, gain: 0.09, type: 'triangle' }); break;
      case 'close': this.tone({ bus: this.uiBus, t, f0: 700, f1: 380, dur: 0.12, gain: 0.08, type: 'triangle' }); break;
      case 'error':
        this.tone({ bus: this.uiBus, t, f0: 300, f1: 240, dur: 0.12, gain: 0.12, type: 'square' });
        this.tone({ bus: this.uiBus, t: t + 0.14, f0: 220, f1: 170, dur: 0.16, gain: 0.1, type: 'square' });
        break;
    }
  }

  keypress() {
    if (!this.ctx) return;
    this.burst({ bus: this.uiBus, dur: 0.025, gain: 0.06, freq: 3200 + rng.range(-400, 600), q: 3 });
  }

  monitorOn() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone({ t, f0: 60, f1: 120, dur: 0.2, gain: 0.12, type: 'sine' });
    this.burst({ t, dur: 0.4, gain: 0.05, freq: 5200, q: 0.6, pink: true });
  }

  /** long descending "suction" used while the room is devoured */
  consumeRiser(duration = 6) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = this.noiseSrc(true, 0.8);
    src.playbackRate.setValueAtTime(0.6, t);
    src.playbackRate.exponentialRampToValueAtTime(2.0, t + duration);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = 1.1;
    bp.frequency.setValueAtTime(180, t);
    bp.frequency.exponentialRampToValueAtTime(4200, t + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + duration * 0.75);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration + 0.4);
    src.connect(bp); bp.connect(g); g.connect(this.sfxBus); this.sendReverb(g, 0.6);
    src.start(t); src.stop(t + duration + 0.5);

    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(26, t + duration);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.24, t + duration * 0.7);
    og.gain.exponentialRampToValueAtTime(0.0001, t + duration + 0.6);
    o.connect(og); og.connect(this.sfxBus);
    o.start(t); o.stop(t + duration + 0.7);
  }

  crack(size = 1) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.burst({ t, dur: 0.18 + size * 0.2, gain: 0.2 * size, freq: 1800, freqEnd: 260, q: 0.9, reverb: 0.5 });
    this.burst({ t: t + 0.03, dur: 0.5, gain: 0.09 * size, freq: 90, q: 0.8, pink: true, reverb: 0.4 });
    this.tone({ t, f0: 90, f1: 40, dur: 0.4, gain: 0.12 * size, type: 'triangle', reverb: 0.4 });
  }

  debris(count = 6, spread = 1) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    for (let i = 0; i < count; i++) {
      const t = t0 + rng.range(0.02, 1.6 * spread);
      this.burst({ t, dur: rng.range(0.08, 0.25), gain: rng.range(0.05, 0.16), freq: rng.range(200, 1400), freqEnd: rng.range(80, 300), q: rng.range(0.8, 2.5), reverb: 0.7 });
    }
  }

  rumble(duration = 6, gain = 0.2) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = this.noiseSrc(true, 0.5);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 160; lp.Q.value = 1.4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 1.1);
    g.gain.setValueAtTime(gain, t + duration * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(lp); lp.connect(g); g.connect(this.sfxBus);
    src.start(t); src.stop(t + duration + 0.2);

    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(34, t);
    o.frequency.exponentialRampToValueAtTime(19, t + duration);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(gain * 1.1, t + 1.4);
    og.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    o.connect(og); og.connect(this.sfxBus);
    o.start(t); o.stop(t + duration + 0.1);
  }

  landing() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone({ t, f0: 88, f1: 28, dur: 0.7, gain: 0.34, type: 'sine', reverb: 0.5 });
    this.burst({ t, dur: 0.55, gain: 0.3, freq: 240, freqEnd: 60, q: 0.5, pink: true, reverb: 0.7 });
    this.burst({ t: t + 0.02, dur: 0.14, gain: 0.14, freq: 2200, q: 1.2, reverb: 0.35 });
    this.tone({ t: t + 0.06, f0: 4200, f1: 3600, dur: 1.6, gain: 0.035, type: 'sine', reverb: 0.6 });
    this.tone({ t: t + 0.1, f0: 3100, f1: 2800, dur: 1.9, gain: 0.022, type: 'sine', reverb: 0.6 });
  }

  heartbeat(strength = 0.5) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone({ t, f0: 62, f1: 38, dur: 0.16, gain: 0.14 * strength, type: 'sine' });
    this.tone({ t: t + 0.18, f0: 56, f1: 34, dur: 0.2, gain: 0.1 * strength, type: 'sine' });
  }

  breath(intake = true) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.burst({
      t, dur: intake ? 0.42 : 0.55, gain: 0.055, freq: intake ? 1100 : 700,
      freqEnd: intake ? 1800 : 380, q: 1.1, pink: true, reverb: 0.15,
    });
  }

  // ------------------------------------------------------------ fall wind
  startFallWind() {
    if (!this.ctx) return;
    if (!this.wind) this.wind = new FallWind(this);
    this.wind.start();
  }
  setFallWindLevel(level: number, pitch = 1) { this.wind?.set(level, pitch); }
  stopFallWind() { this.wind?.stop(); this.wind = null; }

  startRoomFanWhine(level = 1) { this.roomAmb?.setFan(level); }

  setMonumentPosition(pos: THREE.Vector3) {
    if (this.monumentHum) setPannerPos(this.monumentHum.panner, pos);
  }

  /** update listener transform + scheduled ambience events */
  update(dt: number, cam: THREE.Camera) {
    const ctx = this.ctx;
    if (!ctx) return;
    const l = ctx.listener;
    const p = cam.position;
    const q = cam.quaternion;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    if (l.positionX) {
      l.positionX.setTargetAtTime(p.x, ctx.currentTime, 0.02);
      l.positionY.setTargetAtTime(p.y, ctx.currentTime, 0.02);
      l.positionZ.setTargetAtTime(p.z, ctx.currentTime, 0.02);
      l.forwardX.setTargetAtTime(fwd.x, ctx.currentTime, 0.02);
      l.forwardY.setTargetAtTime(fwd.y, ctx.currentTime, 0.02);
      l.forwardZ.setTargetAtTime(fwd.z, ctx.currentTime, 0.02);
      l.upX.setTargetAtTime(up.x, ctx.currentTime, 0.02);
      l.upY.setTargetAtTime(up.y, ctx.currentTime, 0.02);
      l.upZ.setTargetAtTime(up.z, ctx.currentTime, 0.02);
    } else {
      (l as any).setPosition(p.x, p.y, p.z);
      (l as any).setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
    }
    this.tClock += dt;
    this.roomAmb?.update(dt);
    this.worldAmb?.update(dt);
  }

  get began() { return this.started; }
}

function setPannerPos(p: PannerNode, v: THREE.Vector3) {
  if (p.positionX) {
    p.positionX.value = v.x; p.positionY.value = v.y; p.positionZ.value = v.z;
  } else {
    (p as any).setPosition(v.x, v.y, v.z);
  }
}

// ---------------------------------------------------------------- ambiences
class AmbienceRoom {
  private nodes: AudioNode[] = [];
  private srcs: AudioScheduledSourceNode[] = [];
  private bus!: GainNode;
  private fanGain!: GainNode;
  private master!: GainNode;
  private running = false;
  private nextTick = 0;
  private nextCar = 0;
  private tickPhase = 0;

  constructor(private e: AudioEngine) {}

  start() {
    if (this.running) return;
    const { ctx, bus, pink, sink } = (this.e as any).amb();
    this.running = true;
    this.master = ctx.createGain();
    this.master.gain.value = 0.0001;
    this.master.gain.exponentialRampToValueAtTime(1, ctx.currentTime + 2.2);

    // --- PC fan: pink noise through a resonant band-pass + slow wobble
    const fan = ctx.createBufferSource(); fan.buffer = pink; fan.loop = true; fan.playbackRate.value = 0.9;
    const fanF = ctx.createBiquadFilter(); fanF.type = 'bandpass'; fanF.frequency.value = 520; fanF.Q.value = 1.1;
    const fanF2 = ctx.createBiquadFilter(); fanF2.type = 'lowpass'; fanF2.frequency.value = 2400;
    this.fanGain = ctx.createGain(); this.fanGain.gain.value = 0.075;
    const wob = ctx.createOscillator(); wob.frequency.value = 0.23;
    const wobG = ctx.createGain(); wobG.gain.value = 0.02;
    wob.connect(wobG); wobG.connect(this.fanGain.gain);
    fan.connect(fanF); fanF.connect(fanF2); fanF2.connect(this.fanGain); this.fanGain.connect(this.master);

    // --- electrical hum (mains + SMPS)
    const hum = ctx.createOscillator(); hum.type = 'sawtooth'; hum.frequency.value = 50;
    const humF = ctx.createBiquadFilter(); humF.type = 'lowpass'; humF.frequency.value = 260;
    const humG = ctx.createGain(); humG.gain.value = 0.012;
    hum.connect(humF); humF.connect(humG); humG.connect(this.master);

    // --- room tone (very quiet air)
    const air = ctx.createBufferSource(); air.buffer = pink; air.loop = true; air.playbackRate.value = 0.4;
    const airF = ctx.createBiquadFilter(); airF.type = 'lowpass'; airF.frequency.value = 380;
    const airG = ctx.createGain(); airG.gain.value = 0.035;
    air.connect(airF); airF.connect(airG); airG.connect(this.master);

    this.master.connect(bus);
    sink(this.master, 0.18);

    [fan, hum, air, wob].forEach((s) => { s.start(); this.srcs.push(s); });
    this.nodes.push(fanF, fanF2, this.fanGain, humF, humG, airF, airG, wobG, this.master);
    this.nextTick = ctx.currentTime + 0.6;
    this.nextCar = ctx.currentTime + 6;
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    const ctx = (this.e as any).ctx as AudioContext;
    this.master.gain.cancelScheduledValues(ctx.currentTime);
    this.master.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.35);
    const srcs = this.srcs, nodes = this.nodes;
    this.srcs = []; this.nodes = [];
    setTimeout(() => {
      srcs.forEach((s) => { try { s.stop(); } catch { /* noop */ } });
      nodes.forEach((n) => { try { n.disconnect(); } catch { /* noop */ } });
    }, 1400);
  }

  setFan(level: number) {
    if (!this.fanGain) return;
    const ctx = (this.e as any).ctx as AudioContext;
    this.fanGain.gain.setTargetAtTime(0.075 * clamp(level, 0, 3), ctx.currentTime, 0.4);
  }

  update(_dt: number) {
    if (!this.running) return;
    const e = this.e as any;
    const ctx: AudioContext = e.ctx;
    const now = ctx.currentTime;
    if (now >= this.nextTick) {
      // wall clock: tick / tock alternation, slightly imperfect
      const tt = now + 0.001;
      e.burst({ t: tt, dur: 0.03, gain: 0.05, freq: this.tickPhase % 2 ? 2600 : 2100, q: 6, reverb: 0.22, bus: this.master });
      this.tickPhase++;
      this.nextTick = now + (this.tickPhase % 2 ? 1.01 : 0.99);
    }
    if (now >= this.nextCar) {
      // a car passing somewhere outside, heavily filtered
      const tt = now + 0.001;
      const dur = 4 + Math.random() * 5;
      e.burst({ t: tt, dur, gain: 0.03, freq: 300 + Math.random() * 200, freqEnd: 160, q: 0.7, pink: true, reverb: 0.5, bus: this.master });
      this.nextCar = now + 12 + Math.random() * 22;
    }
  }
}

class AmbienceWorld {
  private srcs: AudioScheduledSourceNode[] = [];
  private nodes: AudioNode[] = [];
  private master!: GainNode;
  private running = false;
  private nextGlitch = 0;
  private nextWhisper = 0;

  constructor(private e: AudioEngine) {}

  start() {
    if (this.running) return;
    const { ctx, bus, pink, sink } = (this.e as any).amb();
    this.running = true;
    this.master = ctx.createGain();
    this.master.gain.value = 0.0001;
    this.master.gain.exponentialRampToValueAtTime(1, ctx.currentTime + 3.5);

    // --- sub drone (two detuned saws through a low-pass)
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 240; lp.Q.value = 3;
    const dg = ctx.createGain(); dg.gain.value = 0.055;
    [55, 55.35, 82.4].forEach((f, i) => {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
      const g = ctx.createGain(); g.gain.value = i === 2 ? 0.35 : 1;
      o.connect(g); g.connect(lp);
      o.start(); this.srcs.push(o); this.nodes.push(g);
    });
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.05;
    const lfoG = ctx.createGain(); lfoG.gain.value = 110;
    lfo.connect(lfoG); lfoG.connect(lp.frequency);
    lfo.start(); this.srcs.push(lfo); this.nodes.push(lfoG);
    lp.connect(dg); dg.connect(this.master);

    // --- wind
    const wind = ctx.createBufferSource(); wind.buffer = pink; wind.loop = true; wind.playbackRate.value = 0.7;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 620; bp.Q.value = 0.55;
    const wg = ctx.createGain(); wg.gain.value = 0.09;
    const wl = ctx.createOscillator(); wl.frequency.value = 0.037;
    const wlG = ctx.createGain(); wlG.gain.value = 260;
    wl.connect(wlG); wlG.connect(bp.frequency);
    const wamp = ctx.createOscillator(); wamp.frequency.value = 0.019;
    const wampG = ctx.createGain(); wampG.gain.value = 0.03;
    wamp.connect(wampG); wampG.connect(wg.gain);
    wind.connect(bp); bp.connect(wg); wg.connect(this.master);
    wind.start(); wl.start(); wamp.start();
    this.srcs.push(wind, wl, wamp);
    this.nodes.push(bp, wg, wlG, wampG);

    // --- glassy shimmer (fragments in the air)
    const sh = ctx.createOscillator(); sh.type = 'sine'; sh.frequency.value = 2637;
    const shG = ctx.createGain(); shG.gain.value = 0.006;
    const shL = ctx.createOscillator(); shL.frequency.value = 0.11;
    const shLG = ctx.createGain(); shLG.gain.value = 0.005;
    shL.connect(shLG); shLG.connect(shG.gain);
    sh.connect(shG); shG.connect(this.master);
    sh.start(); shL.start(); this.srcs.push(sh, shL); this.nodes.push(shG, shLG);

    this.master.connect(bus);
    sink(this.master, 0.55);
    this.nextGlitch = ctx.currentTime + 4;
    this.nextWhisper = ctx.currentTime + 9;
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    const ctx = (this.e as any).ctx as AudioContext;
    this.master.gain.cancelScheduledValues(ctx.currentTime);
    this.master.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.5);
    const srcs = this.srcs, nodes = this.nodes;
    this.srcs = []; this.nodes = [];
    setTimeout(() => {
      srcs.forEach((s) => { try { s.stop(); } catch { /* noop */ } });
      nodes.forEach((n) => { try { n.disconnect(); } catch { /* noop */ } });
    }, 1800);
  }

  update(_dt: number) {
    if (!this.running) return;
    const e = this.e as any;
    const ctx: AudioContext = e.ctx;
    const now = ctx.currentTime;
    if (now >= this.nextGlitch) {
      e.glitchBurst(0.25 + Math.random() * 0.5);
      this.nextGlitch = now + 7 + Math.random() * 14;
    }
    if (now >= this.nextWhisper) {
      // distant, filtered voice-like formants (never intelligible)
      const t = now + 0.01;
      for (let i = 0; i < 3; i++) {
        e.tone({ t: t + i * 0.14, f0: 220 + Math.random() * 120, f1: 180 + Math.random() * 60,
          dur: 0.3 + Math.random() * 0.3, gain: 0.02, type: 'sine', reverb: 0.9 });
      }
      this.nextWhisper = now + 14 + Math.random() * 20;
    }
  }
}

class FallWind {
  private src!: AudioBufferSourceNode;
  private bp!: BiquadFilterNode;
  private gain!: GainNode;
  private nodes: AudioNode[] = [];
  private running = false;

  constructor(private e: AudioEngine) {}

  start() {
    if (this.running) return;
    const e = this.e as any;
    const ctx: AudioContext = e.ctx;
    this.running = true;
    this.src = ctx.createBufferSource(); this.src.buffer = e.noisePink; this.src.loop = true;
    this.bp = ctx.createBiquadFilter(); this.bp.type = 'bandpass'; this.bp.frequency.value = 400; this.bp.Q.value = 0.7;
    this.gain = ctx.createGain(); this.gain.gain.value = 0.0001;
    this.src.connect(this.bp); this.bp.connect(this.gain); this.gain.connect(e.sfxBus);
    this.src.start();
    this.gain.gain.exponentialRampToValueAtTime(0.28, ctx.currentTime + 1.4);
    this.nodes.push(this.bp, this.gain);
  }

  set(level: number, pitch = 1) {
    const e = this.e as any;
    const ctx: AudioContext = e.ctx;
    this.gain.gain.setTargetAtTime(Math.max(0.0002, 0.3 * level), ctx.currentTime, 0.1);
    this.bp.frequency.setTargetAtTime(300 + 1800 * pitch, ctx.currentTime, 0.15);
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    const e = this.e as any;
    const ctx: AudioContext = e.ctx;
    this.gain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.25);
    const src = this.src, nodes = this.nodes;
    setTimeout(() => {
      try { src.stop(); } catch { /* noop */ }
      nodes.forEach((n) => { try { n.disconnect(); } catch { /* noop */ } });
    }, 1200);
  }
}
