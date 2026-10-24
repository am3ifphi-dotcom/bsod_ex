/**
 * サウンドエンジン — 全て Web Audio で合成(自作/CC0のみ使用の要件を満たす)
 * - 環境音: PCファン / 時計 / 遠い車 / 部屋の底噪 / 異世界ドローン
 * - 足音(材質別) / グリッチ / 吸い込み / 崩壊 / 落下風 / 着地
 * - 空間音響: PannerNode + 生成インパルス応答のリバーブ
 * - 音量管理: マスターコンプレッサー+リミッタでクリップ防止
 */
import * as THREE from 'three';

type Surface = 'wood' | 'stone' | 'metal' | 'debris';

interface FootstepProfile {
  freq: number;
  q: number;
  gain: number;
  dur: number;
}

const SURFACE_PROFILES: Record<Surface, FootstepProfile> = {
  wood: { freq: 320, q: 1.2, gain: 0.5, dur: 0.09 },
  stone: { freq: 220, q: 0.9, gain: 0.62, dur: 0.11 },
  metal: { freq: 520, q: 2.2, gain: 0.45, dur: 0.13 },
  debris: { freq: 420, q: 1.0, gain: 0.55, dur: 0.12 },
};

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private reverb: ConvolverNode | null = null;
  private reverbSend: GainNode | null = null;

  private noiseBuffer: AudioBuffer | null = null;
  private brownBuffer: AudioBuffer | null = null;

  // ambient nodes
  private roomGain: GainNode | null = null;
  private voidGain: GainNode | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private fanNodes: AudioNode[] = [];
  private clockTimer: number | null = null;
  private carTimer: number | null = null;
  private droneNodes: AudioNode[] = [];
  private beaconSource: AudioBufferSourceNode | null = null;
  private beaconPanner: PannerNode | null = null;

  private _volume = 0.8;
  private started = false;

  async init(): Promise<void> {
    if (this.started) return;
    this.started = true;
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    this.ctx = ctx;
    await ctx.resume().catch(() => undefined);

    const master = ctx.createGain();
    master.gain.value = this._volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 22;
    comp.ratio.value = 5;
    comp.attack.value = 0.004;
    comp.release.value = 0.24;
    // ソフトリミッタ相当: 出力前にさらに軽い圧縮
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 6;
    limiter.ratio.value = 14;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.1;

    master.connect(comp);
    comp.connect(limiter);
    limiter.connect(ctx.destination);
    this.master = master;
    this.compressor = comp;

    // リバーブ(自作インパルス応答: 減衰ノイズ)
    const reverb = ctx.createConvolver();
    reverb.buffer = this.makeImpulse(ctx, 2.2, 2.6);
    const send = ctx.createGain();
    send.gain.value = 0.32;
    send.connect(reverb);
    reverb.connect(master);
    this.reverb = reverb;
    this.reverbSend = send;

    this.noiseBuffer = this.makeNoise(ctx, 2.0, 'white');
    this.brownBuffer = this.makeNoise(ctx, 3.0, 'brown');
  }

  get ready(): boolean {
    return this.started && this.ctx !== null;
  }

  setVolume(v: number): void {
    this._volume = v;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
    }
  }

  suspend(): void {
    this.ctx?.suspend().catch(() => undefined);
  }

  resume(): void {
    this.ctx?.resume().catch(() => undefined);
  }

  /** カメラ追従(リスナー) */
  syncListener(camera: THREE.PerspectiveCamera): void {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    const pos = new THREE.Vector3();
    camera.getWorldPosition(pos);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    const t = this.ctx.currentTime;
    if (l.positionX) {
      l.positionX.setTargetAtTime(pos.x, t, 0.02);
      l.positionY.setTargetAtTime(pos.y, t, 0.02);
      l.positionZ.setTargetAtTime(pos.z, t, 0.02);
      l.forwardX.setTargetAtTime(fwd.x, t, 0.02);
      l.forwardY.setTargetAtTime(fwd.y, t, 0.02);
      l.forwardZ.setTargetAtTime(fwd.z, t, 0.02);
      l.upX.setTargetAtTime(up.x, t, 0.02);
      l.upY.setTargetAtTime(up.y, t, 0.02);
      l.upZ.setTargetAtTime(up.z, t, 0.02);
    } else {
      (l as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(pos.x, pos.y, pos.z);
      (l as unknown as { setOrientation(a: number, b: number, c: number, d: number, e: number, f: number): void }).setOrientation(
        fwd.x, fwd.y, fwd.z, up.x, up.y, up.z,
      );
    }
  }

  // ------------------------------------------------------------------
  //  バッファ生成
  // ------------------------------------------------------------------
  private makeNoise(ctx: AudioContext, seconds: number, kind: 'white' | 'brown'): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      let last = 0;
      for (let i = 0; i < len; i++) {
        const white = Math.random() * 2 - 1;
        if (kind === 'white') {
          data[i] = white;
        } else {
          last = (last + 0.02 * white) / 1.02;
          data[i] = last * 3.2;
        }
      }
    }
    return buf;
  }

  private makeImpulse(ctx: AudioContext, seconds: number, decay: number): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
      }
    }
    return buf;
  }

  private loopSource(buffer: AudioBuffer, rate = 1): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.playbackRate.value = rate;
    return src;
  }

  // ------------------------------------------------------------------
  //  環境音
  // ------------------------------------------------------------------

  /** 自室の環境音: ファン / 時計 / 遠い車 / 部屋の底噪 */
  startRoomTone(): void {
    if (!this.ctx || !this.master || !this.noiseBuffer || !this.brownBuffer || this.roomGain) return;
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = 0;
    g.gain.setTargetAtTime(1, ctx.currentTime, 1.2);
    g.connect(this.master);
    this.roomGain = g;

    // 部屋の底噪
    const tone = this.loopSource(this.brownBuffer, 1);
    const toneLP = ctx.createBiquadFilter();
    toneLP.type = 'lowpass';
    toneLP.frequency.value = 220;
    const toneGain = ctx.createGain();
    toneGain.gain.value = 0.16;
    tone.connect(toneLP).connect(toneGain).connect(g);
    tone.start();
    this.fanNodes.push(tone);

    // PCファン(回転ハム+風)
    const hum = ctx.createOscillator();
    hum.type = 'sawtooth';
    hum.frequency.value = 62;
    const humLP = ctx.createBiquadFilter();
    humLP.type = 'lowpass';
    humLP.frequency.value = 180;
    const humGain = ctx.createGain();
    humGain.gain.value = 0.028;
    hum.connect(humLP).connect(humGain).connect(g);
    hum.start();
    this.fanNodes.push(hum);

    const fanNoise = this.loopSource(this.noiseBuffer, 1);
    const fanBP = ctx.createBiquadFilter();
    fanBP.type = 'bandpass';
    fanBP.frequency.value = 480;
    fanBP.Q.value = 0.6;
    const fanGain = ctx.createGain();
    fanGain.gain.value = 0.05;
    // 回転ムラ
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.22;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.012;
    lfo.connect(lfoGain).connect(fanGain.gain);
    lfo.start();
    fanNoise.connect(fanBP).connect(fanGain).connect(g);
    fanNoise.start();
    this.fanNodes.push(fanNoise, lfo);

    // 時計の秒針
    this.clockTimer = window.setInterval(() => {
      if (!this.ctx || !this.roomGain) return;
      this.tick(this.roomGain.gain.value > 0.01);
    }, 1000);

    // 遠い車(たまに)
    const scheduleCar = (): void => {
      if (!this.ctx) return;
      this.carTimer = window.setTimeout(() => {
        this.distantCar();
        scheduleCar();
      }, 9000 + Math.random() * 16000);
    };
    scheduleCar();
  }

  stopRoomTone(fade = 1.5): void {
    if (!this.ctx || !this.roomGain) return;
    const t = this.ctx.currentTime;
    this.roomGain.gain.setTargetAtTime(0, t, fade / 3);
    const g = this.roomGain;
    window.setTimeout(() => {
      try {
        g.disconnect();
      } catch {
        /* ignore */
      }
    }, fade * 1000 + 500);
    this.roomGain = null;
    if (this.clockTimer !== null) {
      clearInterval(this.clockTimer);
      this.clockTimer = null;
    }
    if (this.carTimer !== null) {
      clearTimeout(this.carTimer);
      this.carTimer = null;
    }
    for (const n of this.fanNodes) {
      try {
        (n as OscillatorNode).stop?.();
      } catch {
        /* ignore */
      }
      try {
        n.disconnect();
      } catch {
        /* ignore */
      }
    }
    this.fanNodes = [];
  }

  private tick(quiet = false): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = 1800 + Math.random() * 300;
    const g = ctx.createGain();
    const vol = quiet ? 0.022 : 0.012;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
    osc.connect(g);
    const p = ctx.createBiquadFilter();
    p.type = 'bandpass';
    p.frequency.value = 2400;
    p.Q.value = 1.4;
    g.connect(p);
    p.connect(this.master);
    p.connect(this.reverbSend!);
    osc.start(t);
    osc.stop(t + 0.05);
  }

  private distantCar(): void {
    if (!this.ctx || !this.master || !this.brownBuffer) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = this.loopSource(this.brownBuffer, 0.7);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(90, t);
    lp.frequency.linearRampToValueAtTime(160, t + 2.5);
    lp.frequency.linearRampToValueAtTime(70, t + 6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.11, t + 2.2);
    g.gain.linearRampToValueAtTime(0, t + 6.2);
    src.connect(lp).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + 6.5);
  }

  /** 異世界ドローン: 深さ(0-1)で音色変化 */
  startVoidDrone(): void {
    if (!this.ctx || !this.master || this.voidGain) return;
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = 0;
    g.gain.setTargetAtTime(1, ctx.currentTime, 2.5);
    g.connect(this.master);
    this.voidGain = g;

    const freqs = [42, 55, 83, 110.5];
    for (const f of freqs) {
      const o = ctx.createOscillator();
      o.type = f < 60 ? 'sine' : 'triangle';
      o.frequency.value = f;
      const og = ctx.createGain();
      og.gain.value = f < 60 ? 0.09 : 0.035;
      // ゆっくりした揺らぎ
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.05 + Math.random() * 0.08;
      const lg = ctx.createGain();
      lg.gain.value = f < 60 ? 0.03 : 0.015;
      lfo.connect(lg).connect(og.gain);
      lfo.start();
      o.connect(og).connect(g);
      o.start();
      this.droneNodes.push(o, lfo);
    }

    // 風ノイズ
    if (this.noiseBuffer) {
      const n = this.loopSource(this.noiseBuffer, 0.5);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 320;
      bp.Q.value = 0.4;
      const ng = ctx.createGain();
      ng.gain.value = 0.045;
      n.connect(bp).connect(ng).connect(g);
      n.start();
      this.droneNodes.push(n);
    }
  }

  stopVoidDrone(fade = 2): void {
    if (!this.ctx || !this.voidGain) return;
    const t = this.ctx.currentTime;
    this.voidGain.gain.setTargetAtTime(0, t, fade / 3);
    const g = this.voidGain;
    window.setTimeout(() => {
      try {
        g.disconnect();
      } catch {
        /* ignore */
      }
    }, fade * 1000 + 400);
    this.voidGain = null;
    for (const n of this.droneNodes) {
      try {
        (n as OscillatorNode).stop?.();
      } catch {
        /* ignore */
      }
      try {
        n.disconnect();
      } catch {
        /* ignore */
      }
    }
    this.droneNodes = [];
  }

  /** 深層エリアの低域プレッシャー(0..1) */
  setVoidDepth(depth: number): void {
    if (!this.ctx || !this.voidGain) return;
    // ドローンのLPF的な暗さはゲイン差で表現
    const t = this.ctx.currentTime;
    this.voidGain.gain.setTargetAtTime(1 + depth * 0.35, t, 0.8);
  }

  /** 中心構造物のビーコン(空間音源) */
  startBeacon(position: THREE.Vector3): void {
    if (!this.ctx || !this.master || this.beaconSource || !this.noiseBuffer) return;
    const ctx = this.ctx;
    const src = ctx.createOscillator();
    src.type = 'sine';
    src.frequency.value = 58;
    const g = ctx.createGain();
    g.gain.value = 0.08;
    const p = ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'exponential';
    p.refDistance = 12;
    p.rolloffFactor = 1.1;
    p.positionX.value = position.x;
    p.positionY.value = position.y;
    p.positionZ.value = position.z;
    // 周期的なパルス
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.36;
    const lg = ctx.createGain();
    lg.gain.value = 0.05;
    lfo.connect(lg).connect(g.gain);
    lfo.start();
    src.connect(g).connect(p);
    p.connect(this.master);
    p.connect(this.reverbSend!);
    src.start();
    this.beaconSource = src as unknown as AudioBufferSourceNode;
    this.beaconPanner = p;
    (this as unknown as { _beaconLfo?: OscillatorNode })._beaconLfo = lfo;
  }

  stopBeacon(): void {
    const lfo = (this as unknown as { _beaconLfo?: OscillatorNode })._beaconLfo;
    try {
      this.beaconSource?.stop();
    } catch {
      /* ignore */
    }
    try {
      lfo?.stop();
    } catch {
      /* ignore */
    }
    try {
      this.beaconPanner?.disconnect();
    } catch {
      /* ignore */
    }
    this.beaconSource = null;
    this.beaconPanner = null;
  }

  // ------------------------------------------------------------------
  //  ワンショット
  // ------------------------------------------------------------------
  footstep(surface: Surface = 'wood', intensity = 1): void {
    if (!this.ctx || !this.master || !this.noiseBuffer) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const p = SURFACE_PROFILES[surface];
    const src = this.loopSource(this.noiseBuffer, 1);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = p.freq * (0.85 + Math.random() * 0.3);
    bp.Q.value = p.q;
    const g = ctx.createGain();
    const vol = p.gain * intensity * (0.8 + Math.random() * 0.35);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + p.dur + 0.05);
    src.connect(bp).connect(g);
    g.connect(this.master);
    g.connect(this.reverbSend!);
    src.start(t, Math.random());
    src.stop(t + p.dur + 0.12);
    // 低域成分
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = 70 + Math.random() * 25;
    const og = ctx.createGain();
    og.gain.setValueAtTime(0, t);
    og.gain.linearRampToValueAtTime(vol * 0.45, t + 0.01);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    o.connect(og).connect(this.master);
    o.start(t);
    o.stop(t + 0.14);
  }

  /** BSOD クリックのグリッチ音(段階で変化) */
  glitchBlip(stage: number): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const base = 220 + stage * 90 + Math.random() * 60;
    const o = ctx.createOscillator();
    o.type = stage > 2 ? 'sawtooth' : 'square';
    o.frequency.setValueAtTime(base, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(50, base * (Math.random() > 0.5 ? 2.2 : 0.4)), t + 0.07 + stage * 0.012);
    const g = ctx.createGain();
    const vol = 0.05 + stage * 0.022;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12 + stage * 0.03);
    const shaper = ctx.createWaveShaper();
    shaper.curve = this.makeDistortion(20 + stage * 30);
    o.connect(shaper).connect(g);
    g.connect(this.master);
    g.connect(this.reverbSend!);
    o.start(t);
    o.stop(t + 0.3);

    if (stage >= 2 && this.noiseBuffer) {
      // ノイズの裂け目
      const n = this.loopSource(this.noiseBuffer, 2);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1200 + stage * 500;
      bp.Q.value = 1.2;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0, t);
      ng.gain.linearRampToValueAtTime(0.05 + stage * 0.015, t + 0.01);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      n.connect(bp).connect(ng).connect(this.master);
      n.start(t);
      n.stop(t + 0.2);
    }
  }

  private makeDistortion(amount: number): Float32Array {
    const n = 1024;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      curve[i] = ((3 + amount) * x * 20 * (Math.PI / 180)) / (Math.PI + amount * Math.abs(x));
    }
    return curve;
  }

  /** 吸い込まれる(ズーム/吸引)サウンド: 0..1 で進行 */
  suction(progress: number, intensity = 1): void {
    if (!this.ctx || !this.master || !this.noiseBuffer) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = this.loopSource(this.noiseBuffer, 1);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 120 + progress * 2600;
    const g = ctx.createGain();
    g.gain.value = (0.03 + progress * 0.22) * intensity;
    src.connect(lp).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + 0.28);
    // 低域の吸い込み
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(48 + progress * 30, t);
    o.frequency.exponentialRampToValueAtTime(30 + progress * 90, t + 0.25);
    const og = ctx.createGain();
    og.gain.value = (0.04 + progress * 0.1) * intensity;
    o.connect(og).connect(this.master);
    o.start(t);
    o.stop(t + 0.3);
  }

  /** 崩壊の轟音(長め) */
  collapseRumble(duration = 6, intensity = 1): () => void {
    if (!this.ctx || !this.master || !this.brownBuffer) {
      return () => undefined;
    }
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = this.loopSource(this.brownBuffer, 0.6);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 140;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.32 * intensity, t + duration * 0.2);
    g.gain.linearRampToValueAtTime(0.42 * intensity, t + duration * 0.7);
    g.gain.linearRampToValueAtTime(0, t + duration);
    src.connect(lp).connect(g).connect(this.master);
    g.connect(this.reverbSend!);
    src.start(t);
    src.stop(t + duration + 0.1);

    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(36, t);
    o.frequency.linearRampToValueAtTime(24, t + duration);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0, t);
    og.gain.linearRampToValueAtTime(0.22 * intensity, t + 0.4);
    og.gain.linearRampToValueAtTime(0, t + duration);
    o.connect(og).connect(this.master);
    o.start(t);
    o.stop(t + duration + 0.1);

    return () => {
      try {
        src.stop();
        o.stop();
      } catch {
        /* ignore */
      }
    };
  }

  /** 崩壊時の個別破片音 */
  debrisCrack(intensity = 1): void {
    if (!this.ctx || !this.master || !this.noiseBuffer) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = this.loopSource(this.noiseBuffer, 1.5);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 500 + Math.random() * 1200;
    bp.Q.value = 1.6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.14 * intensity, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35 + Math.random() * 0.3);
    src.connect(bp).connect(g);
    g.connect(this.master);
    g.connect(this.reverbSend!);
    src.start(t);
    src.stop(t + 0.8);
  }

  /** 落下中の風(速度 0..1) */
  startFallWind(): void {
    if (!this.ctx || !this.master || !this.noiseBuffer || this.windGain) return;
    const ctx = this.ctx;
    const src = this.loopSource(this.noiseBuffer, 1.2);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 300;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(lp).connect(g).connect(this.master);
    src.start();
    this.windFilter = lp;
    this.windGain = g;
  }

  setFallSpeed(speed: number): void {
    if (!this.ctx || !this.windGain || !this.windFilter) return;
    const t = this.ctx.currentTime;
    this.windGain.gain.setTargetAtTime(Math.min(0.5, 0.06 + speed * 0.4), t, 0.15);
    this.windFilter.frequency.setTargetAtTime(240 + speed * 2200, t, 0.2);
  }

  stopFallWind(): void {
    if (!this.ctx || !this.windGain) return;
    const t = this.ctx.currentTime;
    this.windGain.gain.setTargetAtTime(0, t, 0.3);
    const g = this.windGain;
    const src = g as unknown as { disconnect(): void };
    window.setTimeout(() => {
      try {
        src.disconnect();
      } catch {
        /* ignore */
      }
    }, 1200);
    this.windGain = null;
    this.windFilter = null;
  }

  landingThud(): void {
    if (!this.ctx || !this.master || !this.noiseBuffer) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(32, t + 0.28);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.55, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    o.connect(g).connect(this.master);
    g.connect(this.reverbSend!);
    o.start(t);
    o.stop(t + 0.6);

    const n = this.loopSource(this.noiseBuffer, 1);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0, t);
    ng.gain.linearRampToValueAtTime(0.32, t + 0.01);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    n.connect(lp).connect(ng).connect(this.master);
    n.start(t);
    n.stop(t + 0.5);
  }

  /** 帰還直後の胸音 */
  heartbeat(times = 3): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    for (let i = 0; i < times; i++) {
      const t0 = ctx.currentTime + i * 0.85;
      for (let k = 0; k < 2; k++) {
        const t = t0 + k * 0.22;
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.setValueAtTime(k === 0 ? 58 : 50, t);
        o.frequency.exponentialRampToValueAtTime(36, t + 0.12);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(k === 0 ? 0.16 : 0.11, t + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
        o.connect(g).connect(this.master);
        o.start(t);
        o.stop(t + 0.22);
      }
    }
  }

  uiOpen(): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(520, t);
    o.frequency.exponentialRampToValueAtTime(760, t + 0.05);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.05, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.15);
  }

  uiClose(): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(680, t);
    o.frequency.exponentialRampToValueAtTime(360, t + 0.06);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.045, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.18);
  }

  uiBlip(): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = 880;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.025, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.07);
  }

  /** システム的なエラー音(コンソール用) */
  consoleError(): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(180, t);
    o.frequency.exponentialRampToValueAtTime(90, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.05, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.2);
  }

  /** コンソール実行音 */
  consoleExec(): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(420, t);
    o.frequency.exponentialRampToValueAtTime(640, t + 0.04);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.04, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.12);
  }

  /** 帰還後の残響的トーン */
  afterglow(): void {
    if (!this.ctx || !this.master || !this.reverbSend) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    for (const f of [110, 164.8, 220.5]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.035, t + 0.8);
      g.gain.linearRampToValueAtTime(0, t + 4.5);
      o.connect(g).connect(this.master);
      o.connect(this.reverbSend);
      o.start(t);
      o.stop(t + 4.8);
    }
  }
}
