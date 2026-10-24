/**
 * Audio engine — everything is synthesised at runtime with the Web Audio API.
 *
 *  - No sampled recordings anywhere: ambience, footsteps, glitches, impacts, drones and
 *    reverbs are generated from noise + oscillators (the reverb impulse responses are
 *    synthesised decaying noise). Licensing is therefore trivial (all original / CC0).
 *  - Spatialisation: PannerNode (inverse distance model) for world emitters plus a manual
 *    AudioListener update from the camera each frame.
 *  - Loudness: master gain -> gentle bus compressor -> limiter, all parameter changes use
 *    short setTargetAtTime ramps so nothing clicks or clips.
 */

export type SpaceKind = 'room' | 'world' | 'void';
export type SurfaceKind = 'wood' | 'carpet' | 'concrete' | 'metal' | 'ice' | 'tile' | 'asphalt' | 'rubble';

interface Bus {
  gain: GainNode;
  sendA: GainNode;
  sendB: GainNode;
}

const SURFACE_PROFILES: Record<SurfaceKind, { freq: number; q: number; decay: number; thump: number; gain: number }> = {
  wood: { freq: 520, q: 1.1, decay: 0.13, thump: 88, gain: 0.5 },
  carpet: { freq: 320, q: 0.7, decay: 0.09, thump: 62, gain: 0.34 },
  concrete: { freq: 900, q: 0.9, decay: 0.14, thump: 74, gain: 0.52 },
  metal: { freq: 1650, q: 2.4, decay: 0.22, thump: 120, gain: 0.42 },
  ice: { freq: 2400, q: 1.6, decay: 0.18, thump: 96, gain: 0.4 },
  tile: { freq: 1200, q: 1.2, decay: 0.1, thump: 100, gain: 0.45 },
  asphalt: { freq: 700, q: 0.6, decay: 0.12, thump: 70, gain: 0.44 },
  rubble: { freq: 1100, q: 0.8, decay: 0.16, thump: 66, gain: 0.5 },
};

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private limiter!: DynamicsCompressorNode;
  private compressor!: DynamicsCompressorNode;
  private buses!: Record<'ambience' | 'sfx' | 'foot' | 'ui' | 'music' | 'wind', Bus>;
  private reverbs: { room: ConvolverNode; world: ConvolverNode; void: ConvolverNode } | null = null;
  private noiseWhite: AudioBuffer | null = null;
  private noisePink: AudioBuffer | null = null;
  private noiseBrown: AudioBuffer | null = null;
  private started = false;
  private space: SpaceKind = 'room';
  private volume = 0.85;
  private ambienceNodes: AudioNode[] = [];
  private roomLayer: AudioNode[] = [];
  private worldLayer: AudioNode[] = [];
  private droneNodes: AudioNode[] = [];
  private activeLoops: Map<string, () => void> = new Map();
  private masterBlocked = false;

  get isReady(): boolean { return this.started; }

  async ensure(): Promise<boolean> {
    if (this.started) {
      if (this.ctx?.state === 'suspended') await this.ctx.resume().catch(() => {});
      return true;
    }
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) {
      console.warn('[audio] Web Audio API unavailable — the experience will be silent.');
      return false;
    }
    try {
      this.ctx = new Ctor({ latencyHint: 'interactive' });
      await this.ctx.resume().catch(() => {});
      this.build();
      this.started = true;
      return true;
    } catch (err) {
      console.warn('[audio] failed to initialise', err);
      this.ctx = null;
      return false;
    }
  }

  private build(): void {
    const ctx = this.ctx!;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume * 0.9;

    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -18;
    this.compressor.knee.value = 12;
    this.compressor.ratio.value = 3.5;
    this.compressor.attack.value = 0.01;
    this.compressor.release.value = 0.28;

    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -2.5;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.001;
    this.limiter.release.value = 0.12;

    this.master.connect(this.compressor);
    this.compressor.connect(this.limiter);
    this.limiter.connect(ctx.destination);

    this.reverbs = {
      room: this.makeReverb(1.05, 2.2),
      world: this.makeReverb(3.6, 1.5),
      void: this.makeReverb(2.2, 4.5),
    };
    for (const rv of Object.values(this.reverbs)) {
      const g = ctx.createGain();
      g.gain.value = 0.9;
      rv.connect(g).connect(this.master);
    }

    const mkBus = (gain: number, revA: number, revB: number): Bus => {
      const g = ctx.createGain();
      g.gain.value = gain;
      g.connect(this.master);
      const sendA = ctx.createGain();
      sendA.gain.value = revA;
      g.connect(sendA);
      if (this.reverbs) sendA.connect(this.reverbs.room);
      const sendB = ctx.createGain();
      sendB.gain.value = revB;
      g.connect(sendB);
      if (this.reverbs) sendB.connect(this.reverbs.world);
      return { gain: g, sendA, sendB };
    };

    this.buses = {
      ambience: mkBus(0.55, 0.1, 0.06),
      sfx: mkBus(0.9, 0.12, 0.22),
      foot: mkBus(0.8, 0.08, 0.1),
      ui: mkBus(0.7, 0.04, 0.02),
      music: mkBus(0.4, 0.18, 0.2),
      wind: mkBus(0.5, 0.02, 0.3),
    };

    this.noiseWhite = this.makeNoise('white', 2.0);
    this.noisePink = this.makeNoise('pink', 3.0);
    this.noiseBrown = this.makeNoise('brown', 4.0);
    this.updateListenerOrientation();
  }

  private makeNoise(kind: 'white' | 'pink' | 'brown', seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        if (kind === 'white') data[i] = w * 0.5;
        else if (kind === 'brown') {
          last = (last + 0.02 * w) / 1.02;
          data[i] = last * 3.2;
        } else {
          b0 = 0.99886 * b0 + w * 0.0555179;
          b1 = 0.99332 * b1 + w * 0.0750759;
          b2 = 0.969 * b2 + w * 0.153852;
          b3 = 0.8665 * b3 + w * 0.3104856;
          b4 = 0.55 * b4 + w * 0.5329522;
          b5 = -0.7616 * b5 - w * 0.016898;
          data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
          b6 = w * 0.115926;
        }
      }
      // fade the loop edges so it never clicks
      const fade = Math.min(2000, Math.floor(len * 0.05));
      for (let i = 0; i < fade; i++) {
        const k = i / fade;
        data[i] *= k;
        data[len - 1 - i] *= k;
      }
    }
    return buf;
  }

  private makeReverb(seconds: number, damping: number): ConvolverNode {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        const decay = Math.pow(1 - t, 2.4);
        const n = (Math.random() * 2 - 1) * decay;
        lp += (n - lp) * (0.45 / damping);
        d[i] = lp * (1 - t * 0.35);
      }
    }
    const conv = ctx.createConvolver();
    conv.buffer = buf;
    return conv;
  }

  // ------------------------------------------------------------------ routing
  private get now(): number { return this.ctx?.currentTime ?? 0; }

  private ramp(param: AudioParam, value: number, tau = 0.05): void {
    if (!this.ctx) return;
    param.setTargetAtTime(value, this.now, tau);
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.ctx && this.master) this.ramp(this.master.gain, this.volume * 0.9, 0.08);
  }

  setSpace(space: SpaceKind): void {
    if (!this.ctx || this.space === space) return;
    this.space = space;
    const b = this.buses;
    const cfgs: Record<SpaceKind, { sfx: number; sfxSend: number; amb: number }> = {
      room: { sfx: 0.12, sfxSend: 0.12, amb: 0.1 },
      world: { sfx: 0.1, sfxSend: 0.42, amb: 0.34 },
      void: { sfx: 0.06, sfxSend: 0.6, amb: 0.4 },
    };
    const c = cfgs[space];
    this.ramp(b.sfx.sendA.gain, c.sfx, 0.4);
    this.ramp(b.sfx.sendB.gain, c.sfxSend, 0.4);
    this.ramp(b.foot.sendB.gain, space === 'room' ? 0.06 : 0.3, 0.4);
    this.ramp(b.ambience.sendA.gain, c.amb, 0.4);
  }

  /** Duck the ambience/music bus briefly for a big event. */
  duck(amount = 0.35, seconds = 1.4): void {
    if (!this.ctx) return;
    const g = this.buses.ambience.gain.gain;
    const target = Math.max(0, 0.55 * amount);
    this.ramp(g, target, 0.06);
    setTimeout(() => { if (this.ctx) this.ramp(g, 0.55, 0.5); }, seconds * 1000);
  }

  // ------------------------------------------------------------------ loops
  private loopNoise(kind: 'white' | 'pink' | 'brown', rate = 1, start = 0): AudioBufferSourceNode {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = (kind === 'white' ? this.noiseWhite : kind === 'pink' ? this.noisePink : this.noiseBrown)!;
    src.loop = true;
    src.playbackRate.value = rate;
    src.start(0, (start * (src.buffer?.duration ?? 1)) % (src.buffer?.duration ?? 1));
    return src;
  }

  private filter(type: BiquadFilterType, freq: number, q = 0.7): BiquadFilterNode {
    const f = this.ctx!.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  private gainNode(v: number): GainNode {
    const g = this.ctx!.createGain();
    g.gain.value = v;
    return g;
  }

  /** Slow random LFO used to keep ambiences alive. */
  private lfo(freq: number, depth: number, target: AudioParam, offset = 0): OscillatorNode {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.frequency.value = freq;
    osc.type = 'sine';
    const g = ctx.createGain();
    g.gain.value = depth;
    osc.connect(g).connect(target);
    target.value += offset;
    osc.start();
    return osc;
  }

  // ------------------------------------------------------------------ ambience
  startRoomAmbience(): void {
    if (!this.ctx || this.roomLayer.length) { this.setSpace('room'); return; }
    this.stopWorldAmbience();
    this.setSpace('room');
    const ctx = this.ctx;
    const amb = this.buses.ambience.gain;

    // PC fan: brown noise, low-passed, with a very slow amplitude wobble
    const fan = this.loopNoise('brown', 1);
    const fanLP = this.filter('lowpass', 420, 0.6);
    const fanHP = this.filter('highpass', 55, 0.7);
    const fanGain = this.gainNode(0.16);
    fan.connect(fanHP).connect(fanLP).connect(fanGain).connect(amb);
    this.lfo(0.08, 0.03, fanGain.gain, 0.16);

    // PC electrical hum
    const hum = ctx.createOscillator();
    hum.type = 'sawtooth';
    hum.frequency.value = 60;
    const humLP = this.filter('lowpass', 160, 3.4);
    const humGain = this.gainNode(0.018);
    hum.connect(humLP).connect(humGain).connect(amb);
    hum.start();

    // room tone
    const tone = this.loopNoise('pink', 0.6);
    const toneLP = this.filter('lowpass', 900, 0.5);
    const toneGain = this.gainNode(0.045);
    tone.connect(toneLP).connect(toneGain).connect(amb);

    // distant traffic: slow swelling low noise, panned, random-ish schedule via LFOs
    const car = this.loopNoise('brown', 0.55);
    const carLP = this.filter('lowpass', 260, 1.2);
    const carGain = this.gainNode(0.0);
    const carPan = ctx.createStereoPanner();
    car.connect(carLP).connect(carGain).connect(carPan).connect(amb);
    carPan.pan.value = -0.6;
    const carOsc = this.lfo(0.037, 0.045, carGain.gain, 0.03);
    this.lfo(0.013, 0.5, carPan.pan as unknown as AudioParam, -0.3);

    // clock tick, scheduled with lookahead
    const tickTimer = window.setInterval(() => this.clockTick(), 1000);
    this.roomTickTimers.push(tickTimer);

    this.roomLayer = [fan, fanLP, fanHP, fanGain, hum, humLP, humGain, tone, toneLP, toneGain, car, carLP, carGain, carPan, carOsc];
    this.activeLoops.set('room', () => this.stopRoomAmbience());
  }

  private roomTickTimers: number[] = [];

  private clockTick(): void {
    if (!this.ctx || this.space !== 'room') return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseWhite;
    const bp = this.filter('bandpass', 2600 + Math.random() * 300, 9);
    const g = this.gainNode(0.0);
    src.connect(bp).connect(g).connect(this.buses.ambience.gain);
    const t = this.now;
    g.gain.setValueAtTime(0.0, t);
    g.gain.linearRampToValueAtTime(0.05, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.09);
    src.start(t, Math.random() * 1.5, 0.15);
  }

  stopRoomAmbience(): void {
    for (const t of this.roomTickTimers) window.clearInterval(t);
    this.roomTickTimers = [];
    for (const n of this.roomLayer) this.safeStop(n);
    this.roomLayer = [];
  }

  startWorldAmbience(): void {
    if (!this.ctx) return;
    if (this.worldLayer.length) { this.setSpace('world'); return; }
    this.stopRoomAmbience();
    this.setSpace('world');
    const ctx = this.ctx;
    const amb = this.buses.ambience.gain;

    // low machine drone
    const droneGain = this.gainNode(0.0);
    const droneLP = this.filter('lowpass', 320, 1.4);
    droneGain.connect(droneLP).connect(amb);
    const freqs = [48, 72.2, 96.5, 144.1];
    for (const f of freqs) {
      const o = ctx.createOscillator();
      o.type = f > 100 ? 'sine' : 'triangle';
      o.frequency.value = f;
      o.detune.value = (Math.random() - 0.5) * 9;
      const g = this.gainNode(0.05);
      o.connect(g).connect(droneGain);
      o.start();
      this.worldLayer.push(o);
      this.droneNodes.push(o);
      this.lfo(0.02 + Math.random() * 0.05, 0.02, g.gain, 0.05);
    }
    this.ramp(droneGain.gain, 0.5, 1.4);

    // airy wind
    const wind = this.loopNoise('pink', 0.4);
    const windBP = this.filter('bandpass', 620, 0.9);
    const windGain = this.gainNode(0.12);
    wind.connect(windBP).connect(windGain).connect(this.buses.wind.gain);
    this.lfo(0.07, 0.06, windGain.gain, 0.1);
    this.lfo(0.021, 320, windBP.frequency, 600);
    this.lfo(0.013, 0.5, (ctx.createStereoPanner()).pan, 0);

    // electrical sizzle (very quiet, high band)
    const sizzle = this.loopNoise('white', 0.25);
    const sizzleBP = this.filter('bandpass', 5200, 6);
    const sizzleGain = this.gainNode(0.012);
    sizzle.connect(sizzleBP).connect(sizzleGain).connect(amb);

    this.worldLayer.push(wind, windBP, windGain, sizzle, sizzleBP, sizzleGain, droneGain, droneLP);
    this.activeLoops.set('world', () => this.stopWorldAmbience());
    this.startWhisperScheduler();
  }

  private whisperTimer = 0;
  private startWhisperScheduler(): void {
    const tick = () => {
      if (!this.ctx || this.space !== 'world') return;
      if (Math.random() < 0.55) this.whisper();
      this.whisperTimer = window.setTimeout(tick, 4800 + Math.random() * 9000);
    };
    this.whisperTimer = window.setTimeout(tick, 5000 + Math.random() * 5000);
  }

  stopWorldAmbience(): void {
    if (this.whisperTimer) window.clearTimeout(this.whisperTimer);
    this.whisperTimer = 0;
    for (const n of this.worldLayer) this.safeStop(n);
    this.worldLayer = [];
    this.droneNodes = [];
  }

  stopAllAmbience(): void {
    this.stopRoomAmbience();
    this.stopWorldAmbience();
    for (const stop of this.activeLoops.values()) stop();
    this.activeLoops.clear();
  }

  private safeStop(node: AudioNode & { stop?: (when?: number) => void; disconnect?: () => void }): void {
    try {
      if (typeof node.stop === 'function') node.stop();
      node.disconnect?.();
    } catch { /* already stopped */ }
  }

  // ------------------------------------------------------------------ one-shots
  private noiseSource(kind: 'white' | 'pink' | 'brown'): AudioBufferSourceNode {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = (kind === 'white' ? this.noiseWhite : kind === 'pink' ? this.noisePink : this.noiseBrown)!;
    return src;
  }

  private burst(opts: {
    kind?: 'white' | 'pink' | 'brown';
    dur?: number;
    gain?: number;
    freq?: number;
    q?: number;
    type?: BiquadFilterType;
    attack?: number;
    pan?: number;
    bus?: Bus;
    sweepTo?: number;
  }): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const {
      kind = 'white', dur = 0.2, gain = 0.2, freq = 900, q = 1,
      type = 'bandpass', attack = 0.004, pan = 0, bus = this.buses.sfx, sweepTo,
    } = opts;
    const src = this.noiseSource(kind);
    const f = this.filter(type, freq, q);
    const g = this.gainNode(0.0001);
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    src.connect(f).connect(g).connect(p).connect(bus.gain);
    const t = this.now;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    if (sweepTo !== undefined) f.frequency.exponentialRampToValueAtTime(Math.max(30, sweepTo), t + dur);
    src.start(t, Math.random() * 1.2, dur + 0.05);
  }

  private tone(opts: {
    freq: number; to?: number; dur?: number; gain?: number; type?: OscillatorType;
    pan?: number; attack?: number; filter?: number; bus?: Bus;
  }): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const { freq, to, dur = 0.25, gain = 0.12, type = 'sine', pan = 0, attack = 0.006, filter, bus = this.buses.sfx } = opts;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, this.now);
    if (to !== undefined) o.frequency.exponentialRampToValueAtTime(Math.max(10, to), this.now + dur);
    const g = this.gainNode(0.0001);
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    let chain: AudioNode = o;
    if (filter) {
      const f = this.filter('lowpass', filter, 0.8);
      chain = chain.connect(f);
    }
    chain.connect(g).connect(p).connect(bus.gain);
    const t = this.now;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  // --- footsteps -----------------------------------------------------------
  footstep(surface: SurfaceKind, intensity = 1, sprinting = false): void {
    if (!this.ctx) return;
    const p = SURFACE_PROFILES[surface] ?? SURFACE_PROFILES.concrete;
    const jitter = 0.9 + Math.random() * 0.2;
    this.burst({
      kind: 'pink', dur: p.decay * (sprinting ? 1.15 : 1), gain: p.gain * intensity * 0.32,
      freq: p.freq * jitter, q: p.q, attack: 0.003, pan: (Math.random() - 0.5) * 0.25, bus: this.buses.foot,
    });
    this.tone({
      freq: p.thump * jitter, to: p.thump * 0.6, dur: p.decay * 0.9, gain: 0.05 * intensity,
      type: 'sine', filter: 260, bus: this.buses.foot,
    });
  }

  land(intensity = 1): void {
    this.burst({ kind: 'brown', dur: 0.35, gain: 0.5 * intensity, freq: 260, q: 0.7, attack: 0.002 });
    this.tone({ freq: 92, to: 34, dur: 0.5, gain: 0.42 * intensity, type: 'sine' });
    this.duck(0.5, 1.2);
  }

  // --- UI / computer -------------------------------------------------------
  uiClick(): void {
    this.tone({ freq: 1400, to: 900, dur: 0.05, gain: 0.045, type: 'square', filter: 3000, bus: this.buses.ui });
  }

  uiHover(): void {
    this.tone({ freq: 2200, dur: 0.03, gain: 0.018, type: 'square', bus: this.buses.ui });
  }

  keyType(): void {
    this.burst({ kind: 'white', dur: 0.03, gain: 0.05, freq: 2500, q: 2, bus: this.buses.ui, pan: (Math.random() - 0.5) * 0.4 });
  }

  consoleOpen(): void {
    this.tone({ freq: 240, to: 640, dur: 0.14, gain: 0.05, type: 'square', bus: this.buses.ui, filter: 2200 });
    this.burst({ kind: 'white', dur: 0.12, gain: 0.05, freq: 3800, q: 1.4, bus: this.buses.ui });
  }

  consoleError(): void {
    this.tone({ freq: 180, to: 90, dur: 0.22, gain: 0.09, type: 'sawtooth', filter: 900, bus: this.buses.ui });
    this.burst({ kind: 'white', dur: 0.08, gain: 0.04, freq: 1600, q: 0.8, bus: this.buses.ui });
  }

  bsodAppear(): void {
    this.tone({ freq: 70, to: 46, dur: 0.7, gain: 0.25, type: 'sine' });
    this.tone({ freq: 880, dur: 0.4, gain: 0.03, type: 'square', filter: 2400, bus: this.buses.ui });
    this.burst({ kind: 'brown', dur: 0.5, gain: 0.14, freq: 180, q: 0.6 });
  }

  /** Escalating glitch hit; `stage` 0..5 makes each click feel worse than the last. */
  glitchBurst(stage: number): void {
    if (!this.ctx) return;
    const power = 0.35 + stage * 0.16;
    const ctx = this.ctx;
    this.burst({ kind: 'white', dur: 0.06 + stage * 0.02, gain: 0.06 * power, freq: 900 + Math.random() * 4200, q: 6, sweepTo: 200 });
    // crushed digital chirp
    const o = ctx.createOscillator();
    o.type = 'square';
    const base = 80 + Math.random() * 700;
    o.frequency.setValueAtTime(base, this.now);
    o.frequency.exponentialRampToValueAtTime(base * (Math.random() < 0.5 ? 0.25 : 4), this.now + 0.12 + stage * 0.02);
    const ws = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * 2 - 1;
      curve[i] = Math.tanh(x * (2 + stage * 2.5));
    }
    ws.curve = curve;
    const g = this.gainNode(0);
    o.connect(ws).connect(g).connect(this.buses.sfx.gain);
    const t = this.now;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.045 * power, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.start(t);
    o.stop(t + 0.2);
    // sub thump grows with each stage
    this.tone({ freq: 60 - stage * 5, to: 32, dur: 0.28 + stage * 0.05, gain: 0.06 + stage * 0.035, type: 'sine' });
  }

  // --- world ---------------------------------------------------------------
  crack(intensity = 1): void {
    this.burst({ kind: 'white', dur: 0.12, gain: 0.3 * intensity, freq: 2600, q: 2.4, sweepTo: 700 });
    this.burst({ kind: 'brown', dur: 0.4, gain: 0.24 * intensity, freq: 150, q: 0.8 });
  }

  debris(): void {
    for (let i = 0; i < 5; i++) {
      const delay = i * (0.03 + Math.random() * 0.06);
      window.setTimeout(() => {
        this.burst({ kind: 'white', dur: 0.08 + Math.random() * 0.12, gain: 0.06 + Math.random() * 0.05, freq: 600 + Math.random() * 2600, q: 3, pan: (Math.random() - 0.5) * 1.2 });
      }, delay * 1000);
    }
  }

  rumble(duration = 3, intensity = 1): () => void {
    if (!this.ctx) return () => {};
    const ctx = this.ctx;
    const src = this.loopNoise('brown', 0.8);
    const lp = this.filter('lowpass', 110, 1.2);
    const g = this.gainNode(0.0001);
    src.connect(lp).connect(g).connect(this.buses.sfx.gain);
    const t = this.now;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.55 * intensity, t + 0.35);
    g.gain.setValueAtTime(0.55 * intensity, t + duration * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.start(t);
    src.stop(t + duration + 0.1);
    return () => { try { src.stop(); } catch { /* noop */ } };
  }

  whoosh(duration = 1.2, up = true): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const src = this.loopNoise('pink', 1);
    const bp = this.filter('bandpass', up ? 300 : 2400, 1.1);
    const g = this.gainNode(0.0001);
    src.connect(bp).connect(g).connect(this.buses.sfx.gain);
    const t = this.now;
    bp.frequency.setValueAtTime(up ? 300 : 2600, t);
    bp.frequency.exponentialRampToValueAtTime(up ? 3400 : 220, t + duration);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.22, t + duration * 0.45);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.start(t);
    src.stop(t + duration + 0.1);
  }

  /** Continuous fall wind; returns a control handle. */
  startFallWind(): () => void {
    if (!this.ctx) return () => {};
    const ctx = this.ctx;
    const src = this.loopNoise('pink', 1);
    const bp = this.filter('bandpass', 500, 0.8);
    const g = this.gainNode(0.0001);
    src.connect(bp).connect(g).connect(this.buses.wind.gain);
    this.lfo(0.7, 260, bp.frequency, 520);
    g.gain.setValueAtTime(0.0001, this.now);
    g.gain.linearRampToValueAtTime(0.5, this.now + 0.45);
    this.tone({ freq: 320, to: 80, dur: 3.4, gain: 0.05, type: 'sine' });
    let stopped = false;
    return () => {
      if (stopped) return;
      stopped = true;
      if (!this.ctx) return;
      this.ramp(g.gain, 0.0001, 0.25);
      setTimeout(() => { this.safeStop(src); this.safeStop(g); this.safeStop(bp); }, 900);
    };
  }

  heartbeat(intensity = 0.5): void {
    const g = 0.1 * intensity;
    this.tone({ freq: 62, to: 38, dur: 0.22, gain: g, type: 'sine' });
    window.setTimeout(() => this.tone({ freq: 54, to: 32, dur: 0.2, gain: g * 0.7, type: 'sine' }), 190);
  }

  breath(intensity = 0.5): void {
    this.burst({ kind: 'pink', dur: 0.55, gain: 0.1 * intensity, freq: 780, q: 0.7, attack: 0.12, sweepTo: 480 });
  }

  whisper(): void {
    const pan = (Math.random() - 0.5) * 1.8;
    this.burst({ kind: 'pink', dur: 0.5 + Math.random() * 0.5, gain: 0.035, freq: 900 + Math.random() * 1400, q: 4, attack: 0.15, pan });
  }

  doorThud(): void {
    this.tone({ freq: 80, to: 40, dur: 0.35, gain: 0.2, type: 'sine' });
    this.burst({ kind: 'brown', dur: 0.25, gain: 0.12, freq: 200, q: 1 });
  }

  clickLight(): void {
    this.burst({ kind: 'white', dur: 0.03, gain: 0.08, freq: 3400, q: 3, bus: this.buses.ui });
    this.tone({ freq: 1800, dur: 0.03, gain: 0.02, type: 'square', bus: this.buses.ui });
  }

  // ------------------------------------------------------------------ listener
  updateListener(camera: { position: { x: number; y: number; z: number }; quaternion: { x: number; y: number; z: number; w: number } }): void {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    const p = camera.position as unknown as { x: number; y: number; z: number };
    const t = this.now;
    if (l.positionX) {
      l.positionX.setTargetAtTime(p.x, t, 0.02);
      l.positionY.setTargetAtTime(p.y, t, 0.02);
      l.positionZ.setTargetAtTime(p.z, t, 0.02);
    } else {
      (l as unknown as { setPosition: (x: number, y: number, z: number) => void }).setPosition(p.x, p.y, p.z);
    }
    this.updateListenerOrientation();
  }

  private updateListenerOrientation(): void {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    const fwd = { x: 0, y: 0, z: -1 };
    const up = { x: 0, y: 1, z: 0 };
    if (l.forwardX) {
      l.forwardX.value = fwd.x; l.forwardY.value = fwd.y; l.forwardZ.value = fwd.z;
      l.upX.value = up.x; l.upY.value = up.y; l.upZ.value = up.z;
    } else {
      (l as unknown as { setOrientation: (...a: number[]) => void }).setOrientation(0, 0, -1, 0, 1, 0);
    }
  }

  setListenerFromYawPitch(x: number, y: number, z: number, yaw: number, pitch: number): void {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    const fx = -Math.sin(yaw) * Math.cos(pitch);
    const fy = Math.sin(pitch);
    const fz = -Math.cos(yaw) * Math.cos(pitch);
    const t = this.now;
    if (l.positionX) {
      l.positionX.setTargetAtTime(x, t, 0.015);
      l.positionY.setTargetAtTime(y, t, 0.015);
      l.positionZ.setTargetAtTime(z, t, 0.015);
      l.forwardX.setTargetAtTime(fx, t, 0.02);
      l.forwardY.setTargetAtTime(fy, t, 0.02);
      l.forwardZ.setTargetAtTime(fz, t, 0.02);
      l.upX.setTargetAtTime(0, t, 0.02);
      l.upY.setTargetAtTime(1, t, 0.02);
      l.upZ.setTargetAtTime(0, t, 0.02);
    } else {
      const legacy = l as unknown as { setPosition: (...a: number[]) => void; setOrientation: (...a: number[]) => void };
      legacy.setPosition(x, y, z);
      legacy.setOrientation(fx, fy, fz, 0, 1, 0);
    }
  }

  /** A looping positional source (lamps humming, monolith resonance, portal). */
  createEmitter(kind: 'lamp' | 'monolith' | 'portal' | 'terminal', position: { x: number; y: number; z: number }): SpatialLoop | null {
    if (!this.ctx) return null;
    const ctx = this.ctx;
    const panner = ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 5;
    panner.maxDistance = 160;
    panner.rolloffFactor = 1.1;
    panner.positionX.value = position.x;
    panner.positionY.value = position.y;
    panner.positionZ.value = position.z;

    const gain = this.gainNode(0);
    const nodes: AudioNode[] = [];
    let target = 0.2;
    if (kind === 'lamp') {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = 120;
      const o2 = ctx.createOscillator();
      o2.type = 'sine';
      o2.frequency.value = 240.6;
      const g2 = this.gainNode(0.2);
      o.connect(gain);
      o2.connect(g2).connect(gain);
      o.start(); o2.start();
      nodes.push(o, o2, g2);
      target = 0.06;
    } else if (kind === 'monolith') {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = 41;
      const o2 = ctx.createOscillator();
      o2.type = 'sine';
      o2.frequency.value = 61.5;
      o2.detune.value = 7;
      const o3 = ctx.createOscillator();
      o3.type = 'sine';
      o3.frequency.value = 122.9;
      const lp = this.filter('lowpass', 260, 0.8);
      o.connect(lp); o2.connect(lp); o3.connect(lp); lp.connect(gain);
      o.start(); o2.start(); o3.start();
      nodes.push(o, o2, o3, lp);
      target = 0.5;
    } else if (kind === 'portal') {
      const src = this.loopNoise('pink', 0.7);
      const bp = this.filter('bandpass', 1200, 1.6);
      const lfo = this.lfo(0.2, 700, bp.frequency);
      src.connect(bp).connect(gain);
      nodes.push(src, bp, lfo);
      target = 0.22;
    } else {
      const src = this.loopNoise('white', 0.5);
      const bp = this.filter('bandpass', 4200, 8);
      src.connect(bp).connect(gain);
      nodes.push(src, bp);
      target = 0.035;
    }
    gain.connect(panner).connect(this.buses.ambience.gain);
    gain.gain.setTargetAtTime(target, this.now, 0.8);
    return new SpatialLoop(panner, gain, nodes, target, this);
  }
}

export class SpatialLoop {
  constructor(
    public panner: PannerNode,
    public gain: GainNode,
    private nodes: AudioNode[],
    private baseGain: number,
    private engine: AudioEngine,
  ) {}

  setPosition(p: { x: number; y: number; z: number }): void {
    const t = this.engine.ctx?.currentTime ?? 0;
    this.panner.positionX.setTargetAtTime(p.x, t, 0.05);
    this.panner.positionY.setTargetAtTime(p.y, t, 0.05);
    this.panner.positionZ.setTargetAtTime(p.z, t, 0.05);
  }

  setActive(active: boolean, fade = 0.8): void {
    const t = this.engine.ctx?.currentTime ?? 0;
    this.gain.gain.setTargetAtTime(active ? this.baseGain : 0.0001, t, fade);
  }

  dispose(): void {
    try {
      for (const n of this.nodes) {
        const s = n as AudioNode & { stop?: () => void };
        s.stop?.();
        n.disconnect();
      }
      this.gain.disconnect();
      this.panner.disconnect();
    } catch { /* noop */ }
  }
}
