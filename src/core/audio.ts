import * as THREE from 'three';
import { clamp, lerp, mulberry32 } from './util';

type LoopName =
  | 'roomTone'
  | 'fan'
  | 'traffic'
  | 'worldWind'
  | 'deepHum'
  | 'monolithHum'
  | 'static'
  | 'voidDrone'
  | 'heartbeat';

type Loop = {
  gain: GainNode;
  nodes: AudioNode[];
  target: number;
  active: boolean;
};

/**
 * Fully procedural audio engine (noise / oscillators / convolution).
 * All sound in the game is synthesised here, so the audio is original and
 * CC0-clean. Loudness is controlled by a master gain -> compressor -> limiter
 * chain plus conservative per-source gains.
 */
export class AudioEngine {
  ctx: AudioContext | null = null;
  master!: GainNode;
  comp!: DynamicsCompressorNode;
  limiter!: DynamicsCompressorNode;
  sfxBus!: GainNode;
  ambBus!: GainNode;
  uiBus!: GainNode;
  reverb!: ConvolverNode;
  reverbRoom!: ConvolverNode;
  reverbSend!: GainNode;
  reverbRoomSend!: GainNode;
  volume = 0.7;
  started = false;
  private white!: AudioBuffer;
  private brown!: AudioBuffer;
  private pink!: AudioBuffer;
  private loops = new Map<LoopName, Loop>();
  private rnd = mulberry32(0x51a7);
  private clockTimer = 0;
  private trafficTimer = 8;
  private whisperTimer = 18;
  private listenerPos = new THREE.Vector3();
  private listenerQuat = new THREE.Quaternion();
  private panners: { panner: PannerNode; pos: THREE.Vector3; gain: GainNode }[] = [];

  async init() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new Ctx({ latencyHint: 'interactive' });
    this.ctx = ctx;
    await ctx.resume();

    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -16;
    this.comp.knee.value = 22;
    this.comp.ratio.value = 5;
    this.comp.attack.value = 0.006;
    this.comp.release.value = 0.24;
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -3.5;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.002;
    this.limiter.release.value = 0.12;
    this.master.connect(this.comp);
    this.comp.connect(this.limiter);
    this.limiter.connect(ctx.destination);

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 0.9;
    this.sfxBus.connect(this.master);
    this.ambBus = ctx.createGain();
    this.ambBus.gain.value = 0.8;
    this.ambBus.connect(this.master);
    this.uiBus = ctx.createGain();
    this.uiBus.gain.value = 0.55;
    this.uiBus.connect(this.master);

    this.white = this.makeNoise(2.0, 'white');
    this.brown = this.makeNoise(3.0, 'brown');
    this.pink = this.makeNoise(3.0, 'pink');

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeIR(2.4, 0.55, 0.7);
    this.reverbRoom = ctx.createConvolver();
    this.reverbRoom.buffer = this.makeIR(1.1, 0.35, 0.45);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.33;
    this.reverbSend.connect(this.reverb);
    this.reverb.connect(this.master);
    this.reverbRoomSend = ctx.createGain();
    this.reverbRoomSend.gain.value = 0.22;
    this.reverbRoomSend.connect(this.reverbRoom);
    this.reverbRoom.connect(this.master);

    this.started = true;
  }

  setVolume(v: number) {
    this.volume = clamp(v);
    if (this.master) this.master.gain.setTargetAtTime(this.volume, this.ctx!.currentTime, 0.05);
  }

  private makeNoise(seconds: number, kind: 'white' | 'brown' | 'pink') {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let b = 0;
    let p0 = 0, p1 = 0, p2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'white') data[i] = w * 0.6;
      else if (kind === 'brown') {
        b = (b + 0.02 * w) / 1.02;
        data[i] = b * 3.2;
      } else {
        const pink = 0.99765 * p0 + w * 0.0990460;
        p0 = pink;
        const pink2 = 0.96300 * p1 + w * 0.2965164;
        p1 = pink2;
        const pink3 = 0.57000 * p2 + w * 1.0526913;
        p2 = pink3;
        data[i] = (pink + pink2 + pink3 + w * 0.1848) * 0.22;
      }
    }
    return buffer;
  }

  private makeIR(seconds: number, decay: number, damp: number) {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        const n = Math.random() * 2 - 1;
        lp += (n - lp) * damp;
        data[i] = lp * Math.pow(1 - t, decay * 5 + 1.2) * (0.6 + 0.4 * Math.sin(i * 0.00037));
      }
      // early reflections
      for (const [ms, g] of [[13, 0.4], [29, 0.3], [47, 0.22], [71, 0.16]]) {
        const idx = Math.floor((ms / 1000) * ctx.sampleRate);
        if (idx < len) data[idx] += (ch === 0 ? 1 : -1) * g;
      }
    }
    return buffer;
  }

  private now() {
    return this.ctx!.currentTime;
  }

  private makeLoop(name: LoopName, build: (ctx: AudioContext) => { gain: GainNode; nodes: AudioNode[] }) {
    if (!this.ctx || !this.ambBus) return;
    if (this.loops.has(name)) return;
    const { gain, nodes } = build(this.ctx!);
    gain.connect(this.ambBus);
    this.loops.set(name, { gain, nodes, target: 0, active: true });
    gain.gain.value = 0;
  }

  startRoomAmbience() {
    if (!this.ctx || !this.ambBus) return;
    if (!this.loops.has('roomTone')) {
      this.makeLoop('roomTone', (ctx) => {
        const gain = ctx.createGain();
        const src = ctx.createBufferSource();
        src.buffer = this.pink;
        src.loop = true;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 420;
        src.connect(lp).connect(gain);
        src.start();
        return { gain, nodes: [src, lp] };
      });
    }
    if (!this.loops.has('fan')) {
      this.makeLoop('fan', (ctx) => {
        const gain = ctx.createGain();
        const src = ctx.createBufferSource();
        src.buffer = this.brown;
        src.loop = true;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 260;
        lp.Q.value = 0.8;
        const peak = ctx.createBiquadFilter();
        peak.type = 'peaking';
        peak.frequency.value = 118;
        peak.Q.value = 5;
        peak.gain.value = 7;
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 0.23;
        const lfoGain = ctx.createGain();
        lfoGain.gain.value = 22;
        lfo.connect(lfoGain).connect(lp.frequency);
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = 60;
        const oscGain = ctx.createGain();
        oscGain.gain.value = 0.012;
        src.connect(lp).connect(peak).connect(gain);
        osc.connect(oscGain).connect(gain);
        src.start();
        lfo.start();
        osc.start();
        return { gain, nodes: [src, lp, peak, lfo, lfoGain, osc, oscGain] };
      });
    }
    if (!this.loops.has('traffic')) {
      this.makeLoop('traffic', (ctx) => {
        const gain = ctx.createGain();
        const src = ctx.createBufferSource();
        src.buffer = this.brown;
        src.loop = true;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 160;
        src.connect(lp).connect(gain);
        src.start();
        return { gain, nodes: [src, lp] };
      });
    }
    this.setLoop('roomTone', 0.16);
    this.setLoop('fan', 0.3);
    this.setLoop('traffic', 0.06);
  }

  startWorldAmbience() {
    if (!this.ctx || !this.ambBus) return;
    if (!this.loops.has('worldWind')) {
      this.makeLoop('worldWind', (ctx) => {
        const gain = ctx.createGain();
        const src = ctx.createBufferSource();
        src.buffer = this.pink;
        src.loop = true;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 620;
        bp.Q.value = 0.6;
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 0.07;
        const lfoGain = ctx.createGain();
        lfoGain.gain.value = 260;
        lfo.connect(lfoGain).connect(bp.frequency);
        src.connect(bp).connect(gain);
        src.start();
        lfo.start();
        return { gain, nodes: [src, bp, lfo, lfoGain] };
      });
    }
    if (!this.loops.has('voidDrone')) {
      this.makeLoop('voidDrone', (ctx) => {
        const gain = ctx.createGain();
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = 41;
        const osc2 = ctx.createOscillator();
        osc2.type = 'sine';
        osc2.frequency.value = 82.4;
        const g2 = ctx.createGain();
        g2.gain.value = 0.35;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 220;
        osc.connect(lp).connect(gain);
        osc2.connect(g2).connect(lp);
        osc.start();
        osc2.start();
        return { gain, nodes: [osc, osc2, g2, lp] };
      });
    }
    this.setLoop('worldWind', 0.26);
    this.setLoop('voidDrone', 0.14);
  }

  stopRoomAmbience() {
    this.setLoop('roomTone', 0);
    this.setLoop('fan', 0);
    this.setLoop('traffic', 0);
  }

  stopWorldAmbience() {
    this.setLoop('worldWind', 0);
    this.setLoop('voidDrone', 0);
  }

  setLoop(name: LoopName, target: number, time = 1.6) {
    const loop = this.loops.get(name);
    if (!loop) return;
    loop.target = target;
    loop.gain.gain.cancelScheduledValues(this.now());
    loop.gain.gain.setTargetAtTime(target, this.now(), time / 3.2);
  }

  /** distance-attenuated spatial hum used for the monolith and lamps */
  addSpatialHum(pos: THREE.Vector3, freq = 55, gain = 0.08) {
    if (!this.ctx) return;
    const panner = this.ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 3;
    panner.maxDistance = 60;
    panner.rolloffFactor = 1.1;
    panner.positionX.value = pos.x;
    panner.positionY.value = pos.y;
    panner.positionZ.value = pos.z;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const osc2 = this.ctx.createOscillator();
    osc2.type = 'triangle';
    osc2.frequency.value = freq * 2.01;
    const g2 = this.ctx.createGain();
    g2.gain.value = 0.3;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.13;
    const lfoG = this.ctx.createGain();
    lfoG.gain.value = 0.35;
    lfo.connect(lfoG).connect(g.gain);
    osc.connect(lp);
    osc2.connect(g2).connect(lp);
    lp.connect(g).connect(panner).connect(this.ambBus);
    osc.start();
    osc2.start();
    lfo.start();
    this.panners.push({ panner, pos: pos.clone(), gain: g });
  }

  clearSpatial() {
    for (const p of this.panners) {
      try {
        p.gain.gain.setTargetAtTime(0, this.now(), 0.3);
      } catch {}
      setTimeout(() => {
        try {
          p.panner.disconnect();
          p.gain.disconnect();
        } catch {}
      }, 1200);
    }
    this.panners = [];
  }

  updateListener(camera: THREE.Camera) {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    camera.getWorldPosition(this.listenerPos);
    camera.getWorldQuaternion(this.listenerQuat);
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.listenerQuat);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.listenerQuat);
    if (l.positionX) {
      l.positionX.setTargetAtTime(this.listenerPos.x, this.now(), 0.02);
      l.positionY.setTargetAtTime(this.listenerPos.y, this.now(), 0.02);
      l.positionZ.setTargetAtTime(this.listenerPos.z, this.now(), 0.02);
      l.forwardX.setTargetAtTime(forward.x, this.now(), 0.02);
      l.forwardY.setTargetAtTime(forward.y, this.now(), 0.02);
      l.forwardZ.setTargetAtTime(forward.z, this.now(), 0.02);
      l.upX.setTargetAtTime(up.x, this.now(), 0.02);
      l.upY.setTargetAtTime(up.y, this.now(), 0.02);
      l.upZ.setTargetAtTime(up.z, this.now(), 0.02);
    } else {
      (l as any).setPosition(this.listenerPos.x, this.listenerPos.y, this.listenerPos.z);
      (l as any).setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
    }
  }

  update(dt: number, phase: string) {
    if (!this.ctx) return;
    if (phase === 'room' || phase === 'bsod' || phase === 'epilogue') {
      this.clockTimer -= dt;
      if (this.clockTimer <= 0) {
        this.clockTimer = 1.0;
        this.tick();
      }
      this.trafficTimer -= dt;
      if (this.trafficTimer <= 0) {
        this.trafficTimer = 14 + this.rnd() * 22;
        this.carPass();
      }
      this.whisperTimer -= dt;
      if (this.whisperTimer <= 0 && (phase === 'epilogue' || phase === 'bsod')) {
        this.whisperTimer = 12 + this.rnd() * 16;
        this.whisper(phase === 'epilogue' ? 0.05 : 0.035);
      }
    }
  }

  private connectOut(node: AudioNode, wet = 0.25, room = false) {
    const g = this.ctx!.createGain();
    g.gain.value = 1;
    node.connect(g);
    g.connect(this.sfxBus);
    const send = this.ctx!.createGain();
    send.gain.value = wet;
    g.connect(send);
    send.connect(room ? this.reverbRoomSend : this.reverbSend);
    return g;
  }

  private tick() {
    const ctx = this.ctx!;
    const t = this.now();
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = 2100 + this.rnd() * 300;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.03, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2400;
    bp.Q.value = 2;
    osc.connect(bp).connect(g);
    this.connectOut(g, 0.18, true);
    osc.start(t);
    osc.stop(t + 0.06);
    // second, lower tick for a mechanical clock feel
    const osc2 = ctx.createOscillator();
    osc2.type = 'triangle';
    osc2.frequency.value = 420;
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.02, t + 0.001);
    g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    osc2.connect(g2);
    this.connectOut(g2, 0.2, true);
    osc2.start(t);
    osc2.stop(t + 0.08);
  }

  private carPass() {
    const ctx = this.ctx!;
    const t = this.now();
    const src = ctx.createBufferSource();
    src.buffer = this.brown;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(180, t);
    bp.frequency.linearRampToValueAtTime(420, t + 2.2);
    bp.frequency.linearRampToValueAtTime(140, t + 4.6);
    bp.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.05, t + 1.6);
    g.gain.linearRampToValueAtTime(0.0001, t + 4.6);
    const pan = ctx.createStereoPanner();
    pan.pan.setValueAtTime(-0.9, t);
    pan.pan.linearRampToValueAtTime(0.9, t + 4.6);
    src.connect(bp).connect(g).connect(pan);
    this.connectOut(pan, 0.4);
    src.start(t);
    src.stop(t + 5);
  }

  footstep(surface: 'wood' | 'concrete' | 'metal' | 'shard', strength = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = this.now();
    const src = ctx.createBufferSource();
    src.buffer = this.white;
    src.playbackRate.value = 0.8 + this.rnd() * 0.4;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    const cfgs = { wood: [420, 1.4], concrete: [900, 0.9], metal: [1500, 2.4], shard: [2600, 3.2] } as const;
    const [freq, q] = cfgs[surface];
    bp.frequency.value = freq * (0.9 + this.rnd() * 0.2);
    bp.Q.value = q;
    const g = ctx.createGain();
    const peak = (surface === 'wood' ? 0.06 : 0.045) * strength;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (surface === 'metal' ? 0.18 : 0.12));
    src.connect(bp).connect(g);
    this.connectOut(g, surface === 'metal' ? 0.5 : 0.22, surface !== 'metal');

    const thump = ctx.createOscillator();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(surface === 'wood' ? 92 : 62, t);
    thump.frequency.exponentialRampToValueAtTime(42, t + 0.1);
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(peak * 0.7, t);
    tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
    thump.connect(tg);
    this.connectOut(tg, 0.15);
    thump.start(t);
    thump.stop(t + 0.16);
    src.start(t);
    src.stop(t + 0.24);
  }

  click(kind: 'ui' | 'soft' | 'mech' = 'ui') {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = this.now();
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    const f = kind === 'ui' ? 1200 : kind === 'mech' ? 380 : 720;
    osc.frequency.setValueAtTime(f, t);
    osc.frequency.exponentialRampToValueAtTime(f * 0.4, t + 0.06);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.05, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    osc.connect(g);
    this.connectOut(g, 0.15);
    osc.start(t);
    osc.stop(t + 0.1);
    if (kind === 'mech') this.noiseBurst(0.03, 1800, 0.04);
  }

  keyboardClick() {
    this.noiseBurst(0.02, 3000, 0.035);
  }

  bsodBeep() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = this.now();
    for (let i = 0; i < 3; i++) {
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = i === 2 ? 440 : 880;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.035, t + i * 0.11);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.11 + 0.08);
      osc.connect(g);
      this.connectOut(g, 0.2, true);
      osc.start(t + i * 0.11);
      osc.stop(t + i * 0.11 + 0.1);
    }
  }

  noiseBurst(duration = 0.1, freq = 1200, volume = 0.05, type: BiquadFilterType = 'bandpass') {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = this.now();
    const src = ctx.createBufferSource();
    src.buffer = this.white;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = 1.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(volume, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(f).connect(g);
    this.connectOut(g, 0.2);
    src.start(t);
    src.stop(t + duration + 0.05);
  }

  glitchBurst(intensity = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = this.now();
    const src = ctx.createBufferSource();
    src.buffer = this.white;
    src.playbackRate.value = 0.5 + this.rnd() * 1.5;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 700 + this.rnd() * 2000;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * 2 - 1;
      curve[i] = Math.sin(x * Math.PI * 2.5) * 0.6;
    }
    shaper.curve = curve;
    const g = ctx.createGain();
    const dur = 0.05 + 0.12 * intensity;
    g.gain.setValueAtTime(0.04 * intensity, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(shaper).connect(g);
    this.connectOut(g, 0.3);
    src.start(t);
    src.stop(t + dur + 0.02);
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(90 + this.rnd() * 500, t);
    osc.frequency.exponentialRampToValueAtTime(60, t + dur * 1.5);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.02 * intensity, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + dur * 1.8);
    osc.connect(og);
    this.connectOut(og, 0.2);
    osc.start(t);
    osc.stop(t + dur * 2);
  }

  errorTone() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = this.now();
    for (let i = 0; i < 2; i++) {
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = i === 0 ? 233 : 311;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.025, t + i * 0.16);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.16 + 0.13);
      osc.connect(g);
      this.connectOut(g, 0.2);
      osc.start(t + i * 0.16);
      osc.stop(t + i * 0.16 + 0.15);
    }
  }

  whisper(volume = 0.04) {
    if (!this.ctx || volume <= 0.001) return;
    const ctx = this.ctx;
    const t = this.now();
    const src = ctx.createBufferSource();
    src.buffer = this.pink;
    src.loop = true;
    const panner = ctx.createStereoPanner();
    panner.pan.setValueAtTime(-0.7 + this.rnd() * 1.4, t);
    const dur = 2.2 + this.rnd() * 2.6;
    const f1 = ctx.createBiquadFilter();
    f1.type = 'bandpass';
    f1.frequency.value = 800 + this.rnd() * 600;
    f1.Q.value = 6;
    const f2 = ctx.createBiquadFilter();
    f2.type = 'bandpass';
    f2.frequency.value = 1800 + this.rnd() * 900;
    f2.Q.value = 8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(volume, t + 0.5);
    g.gain.linearRampToValueAtTime(volume * 0.7, t + dur * 0.7);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    const mix = ctx.createGain();
    f1.connect(mix);
    f2.connect(mix);
    src.connect(f1);
    src.connect(f2);
    mix.connect(g).connect(panner);
    this.connectOut(panner, 0.5, true);
    src.start(t);
    src.stop(t + dur + 0.1);
  }

  breath(intensity = 1, pitch = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = this.now();
    const dur = 0.45 + this.rnd() * 0.35;
    const src = ctx.createBufferSource();
    src.buffer = this.pink;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(600 * pitch, t);
    f.frequency.linearRampToValueAtTime(1100 * pitch, t + dur * 0.4);
    f.frequency.linearRampToValueAtTime(450 * pitch, t + dur);
    f.Q.value = 1.1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.05 * intensity, t + dur * 0.25);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g);
    this.connectOut(g, 0.18, true);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  heartbeat(intensity = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = this.now();
    for (let i = 0; i < 2; i++) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(58, t + i * 0.17);
      osc.frequency.exponentialRampToValueAtTime(32, t + i * 0.17 + 0.16);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + i * 0.17);
      g.gain.linearRampToValueAtTime(0.09 * intensity, t + i * 0.17 + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.17 + 0.2);
      osc.connect(g);
      this.connectOut(g, 0.1);
      osc.start(t + i * 0.17);
      osc.stop(t + i * 0.17 + 0.24);
    }
  }

  crack(intensity = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = this.now();
    this.noiseBurst(0.12 * intensity, 3200, 0.05 * intensity, 'highpass');
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(180, t);
    osc.frequency.exponentialRampToValueAtTime(55, t + 0.35);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.05 * intensity, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    osc.connect(g);
    this.connectOut(g, 0.35);
    osc.start(t);
    osc.stop(t + 0.45);
  }

  debris() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = this.now();
    this.noiseBurst(0.6, 260, 0.09, 'lowpass');
    for (let i = 0; i < 5; i++) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = 300 + this.rnd() * 900;
      const g = ctx.createGain();
      const tt = t + this.rnd() * 0.7;
      g.gain.setValueAtTime(0.012, tt);
      g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.18);
      osc.connect(g);
      this.connectOut(g, 0.5);
      osc.start(tt);
      osc.stop(tt + 0.2);
    }
  }

  whoosh(duration = 1.4, intensity = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = this.now();
    const src = ctx.createBufferSource();
    src.buffer = this.brown;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 0.8;
    bp.frequency.setValueAtTime(120, t);
    bp.frequency.exponentialRampToValueAtTime(1800, t + duration * 0.6);
    bp.frequency.exponentialRampToValueAtTime(220, t + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.11 * intensity, t + duration * 0.35);
    g.gain.linearRampToValueAtTime(0.0001, t + duration);
    src.connect(bp).connect(g);
    this.connectOut(g, 0.4);
    src.start(t);
    src.stop(t + duration + 0.1);
  }

  riser(duration = 2.6, intensity = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = this.now();
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(48, t);
    osc.frequency.exponentialRampToValueAtTime(360, t + duration);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(180, t);
    f.frequency.exponentialRampToValueAtTime(4200, t + duration);
    f.Q.value = 3;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.07 * intensity, t + duration * 0.8);
    g.gain.linearRampToValueAtTime(0.0001, t + duration);
    osc.connect(f).connect(g);
    this.connectOut(g, 0.4);
    osc.start(t);
    osc.stop(t + duration + 0.05);
    this.noiseBurst(duration * 0.9, 2400, 0.03 * intensity, 'highpass');
  }

  impact(intensity = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = this.now();
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, t);
    osc.frequency.exponentialRampToValueAtTime(28, t + 0.6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.16 * intensity, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    osc.connect(g);
    this.connectOut(g, 0.5);
    osc.start(t);
    osc.stop(t + 1);
    this.noiseBurst(0.4, 300, 0.1 * intensity, 'lowpass');
  }

  portal() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = this.now();
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(70, t);
    osc.frequency.linearRampToValueAtTime(30, t + 2.4);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(300, t);
    f.frequency.exponentialRampToValueAtTime(90, t + 2.4);
    f.Q.value = 4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.09, t + 0.4);
    g.gain.linearRampToValueAtTime(0.0001, t + 2.6);
    osc.connect(f).connect(g);
    this.connectOut(g, 0.7);
    osc.start(t);
    osc.stop(t + 2.7);
    this.whisper(0.05);
  }

  /** called from the collapse script for falling wind */
  fallWind(level: number) {
    if (!this.ctx) return;
    const loop = this.loops.get('voidDrone');
    if (loop) loop.gain.gain.setTargetAtTime(clamp(level, 0, 1) * 0.5, this.now(), 0.2);
  }

  chime(freq = 880, volume = 0.05) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = this.now();
    [1, 2.02, 3.01, 4.1].forEach((h, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq * h;
      const g = ctx.createGain();
      g.gain.setValueAtTime(volume / (i + 2), t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6 + i * 0.4);
      osc.connect(g);
      this.connectOut(g, 0.5, true);
      osc.start(t);
      osc.stop(t + 2.4);
    });
  }
}
