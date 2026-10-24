import * as THREE from 'three';

type Layer = { stop: (fade?: number) => void };
type Emitter = { pos: THREE.Vector3; freq: number };

/**
 * 音響エンジン。
 *  - 環境音 (PC ファン / 時計 / 遠くの車 / 異世界の風と唸り) はすべて実行時合成
 *  - 足音のみ CC0 のサンプル (Fantozzi's Footsteps)
 *  - マスターにコンプレッサを挟み、どの場面でもクリップしないようにする
 */
export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private ambBus!: GainNode;
  private comp!: DynamicsCompressorNode;
  private verbSend!: GainNode;
  private verb!: ConvolverNode;
  private verbGain!: GainNode;
  private buffers = new Map<string, AudioBuffer[]>();
  private noise!: AudioBuffer;
  private layers: Layer[] = [];
  private lastReverb = -1;
  private pendingVolumes = { master: 0.85, ambience: 0.9, sfx: 1 };
  private clockAcc = 0;
  private clockTick = 0;
  private carTimer = 14;
  private speakerPos = new THREE.Vector3();
  private started = false;

  get ready() { return this.started && this.ctx !== null; }

  async init() {
    if (this.ctx) { await this.ctx.resume(); return; }
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx({ latencyHint: 'interactive' });
    this.ctx = ctx;
    await ctx.resume();

    this.master = ctx.createGain();
    this.master.gain.value = this.pendingVolumes.master;

    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.knee.value = 16;
    this.comp.ratio.value = 5;
    this.comp.attack.value = 0.004;
    this.comp.release.value = 0.22;

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = this.pendingVolumes.sfx;
    this.ambBus = ctx.createGain();
    this.ambBus.gain.value = this.pendingVolumes.ambience;

    this.verb = ctx.createConvolver();
    this.verb.buffer = this.makeImpulse(1.6, 0.35);
    this.verbGain = ctx.createGain();
    this.verbGain.gain.value = 0.3;
    this.verbSend = ctx.createGain();
    this.verbSend.gain.value = 0.5;

    this.ambBus.connect(this.master);
    this.ambBus.connect(this.verbSend);
    this.sfxBus.connect(this.master);
    this.sfxBus.connect(this.verbSend);
    this.verbSend.connect(this.verb);
    this.verb.connect(this.verbGain);
    this.verbGain.connect(this.master);
    this.master.connect(this.comp);
    this.comp.connect(ctx.destination);

    this.noise = this.makeNoise(3);
    this.started = true;
  }

  /* ---------------- 合成ヘルパ ---------------- */
  private makeNoise(seconds: number, brown = false) {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
    }
    return buf;
  }

  private makeImpulse(seconds: number, decay: number) {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2 + decay * 6);
      }
    }
    return buf;
  }

  private noiseSource(loop = false) {
    const s = this.ctx!.createBufferSource();
    s.buffer = this.noise;
    s.loop = loop;
    return s;
  }

  private panner(pos: THREE.Vector3, ref = 3, max = 80) {
    const ctx = this.ctx!;
    const p = ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = ref;
    p.maxDistance = max;
    p.rolloffFactor = 1.1;
    p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z;
    return p;
  }

  private lfo(target: AudioParam, freq: number, depth: number, base = 0) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.value = depth;
    osc.connect(g).connect(target);
    target.value = base;
    osc.start();
    return osc;
  }

  /** 破棄可能なレイヤを作る */
  private makeLayer(nodes: AudioNode[], oscs: { stop: (t?: number) => void }[], gain: GainNode): Layer {
    const layer: Layer = {
      stop: (fade = 0.6) => {
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        try {
          gain.gain.cancelScheduledValues(now);
          gain.gain.setValueAtTime(gain.gain.value, now);
          gain.gain.linearRampToValueAtTime(0.0001, now + fade);
        } catch { /* noop */ }
        for (const o of oscs) { try { o.stop(now + fade + 0.05); } catch { /* noop */ } }
        for (const n of nodes) { try { n.disconnect(); } catch { /* noop */ } }
        this.layers = this.layers.filter((l) => l !== layer);
      },
    };
    this.layers.push(layer);
    return layer;
  }

  private fadeIn(gain: GainNode, target: number, time = 0.8) {
    const now = this.ctx!.currentTime;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, target), now + time);
  }

  /* ---------------- 設定 ---------------- */
  setVolumes(v: { master: number; ambience: number; sfx: number }) {
    this.pendingVolumes = v;
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(v.master, now, 0.05);
    this.ambBus.gain.setTargetAtTime(v.ambience, now, 0.05);
    this.sfxBus.gain.setTargetAtTime(v.sfx, now, 0.05);
  }
  setMuted(m: boolean) {
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(m ? 0 : this.pendingVolumes.master, this.ctx.currentTime, 0.05);
  }
  setReverb(amount: number, preset: 'room' | 'void' = 'room') {
    if (!this.ctx) return;
    const key = amount * 10 + (preset === 'void' ? 100 : 0);
    if (Math.abs(key - this.lastReverb) < 0.35) return;
    this.lastReverb = key;
    this.verb.buffer = this.makeImpulse(preset === 'void' ? 3.4 : 1.3, preset === 'void' ? 0.55 : 0.3);
    this.verbGain.gain.setTargetAtTime(0.12 + amount * 0.55, this.ctx.currentTime, 0.2);
  }

  /* ---------------- リスナ ---------------- */
  updateListener(camera: THREE.Camera) {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    const p = camera.position;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    this.speakerPos.copy(p);
    const t = this.ctx.currentTime;
    if (l.positionX) {
      l.positionX.setTargetAtTime(p.x, t, 0.02);
      l.positionY.setTargetAtTime(p.y, t, 0.02);
      l.positionZ.setTargetAtTime(p.z, t, 0.02);
      l.forwardX.setTargetAtTime(fwd.x, t, 0.02);
      l.forwardY.setTargetAtTime(fwd.y, t, 0.02);
      l.forwardZ.setTargetAtTime(fwd.z, t, 0.02);
      l.upX.setTargetAtTime(up.x, t, 0.02);
      l.upY.setTargetAtTime(up.y, t, 0.02);
      l.upZ.setTargetAtTime(up.z, t, 0.02);
    } else {
      l.setPosition(p.x, p.y, p.z);
      l.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
    }
  }

  /* ---------------- サンプル ---------------- */
  async loadFootsteps(urls: string[]) {
    if (!this.ctx) return;
    const list: AudioBuffer[] = [];
    await Promise.all(urls.slice(0, 24).map(async (u) => {
      try {
        const res = await fetch(u);
        const ab = await res.arrayBuffer();
        list.push(await this.ctx!.decodeAudioData(ab));
      } catch { /* 1 つ失敗しても続行 */ }
    }));
    if (list.length) this.buffers.set('footsteps', list);
  }

  playFootstep(surface: 'wood' | 'stone' | 'metal', vol = 1, running = false) {
    if (!this.ctx) return;
    const list = this.buffers.get('footsteps');
    const ctx = this.ctx;
    if (!list || !list.length) { this.synthStep(surface, vol, running); return; }
    const buf = list[Math.floor(Math.random() * list.length)];
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = (surface === 'wood' ? 0.92 : 1.02) * (running ? 1.1 : 1) * (0.94 + Math.random() * 0.12);
    const g = ctx.createGain();
    g.gain.value = vol * (running ? 0.5 : 0.34);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = surface === 'wood' ? 90 : 160;
    src.connect(hp).connect(g).connect(this.sfxBus);
    src.start();
  }

  /** 足音サンプルが無い場合の合成足音 */
  private synthStep(surface: string, vol: number, running: boolean) {
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    const src = this.noiseSource(false);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = surface === 'wood' ? 190 : 520;
    bp.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(Math.max(0.001, vol * (running ? 0.4 : 0.26)), now + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
    src.connect(bp).connect(g).connect(this.sfxBus);
    src.start(now, Math.random() * 2, 0.18);
  }

  /* ---------------- 環境音: 自室 ---------------- */
  roomAmbience(opts: { pc: THREE.Vector3; window: THREE.Vector3 }) {
    if (!this.ctx) return { stop: () => {} };
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = 0.0001;
    out.connect(this.ambBus);
    const nodes: AudioNode[] = [out];
    const oscs: { stop: (t?: number) => void }[] = [];

    // PC のファン: 低いハム + 帯域ノイズ
    const hum = ctx.createOscillator();
    hum.type = 'sawtooth';
    hum.frequency.value = 58.3;
    const humF = ctx.createBiquadFilter();
    humF.type = 'lowpass';
    humF.frequency.value = 320;
    const humG = ctx.createGain();
    humG.gain.value = 0.05;
    hum.connect(humF).connect(humG).connect(out);
    hum.start();
    oscs.push(hum);

    const whir = this.noiseSource(true);
    const whirF = ctx.createBiquadFilter();
    whirF.type = 'bandpass';
    whirF.frequency.value = 780;
    whirF.Q.value = 1.4;
    const whirG = ctx.createGain();
    whirG.gain.value = 0.035;
    whir.connect(whirF).connect(whirG).connect(out);
    whir.start();
    const whirLfo = this.lfo(whirG.gain, 0.09, 0.01, 0.035);
    oscs.push(whirLfo);
    nodes.push(whir, whirF, whirG, humF, humG);

    // 窓の外の街: 遠いロードノイズ
    const city = this.noiseSource(true);
    const cityF = ctx.createBiquadFilter();
    cityF.type = 'lowpass';
    cityF.frequency.value = 380;
    const cityG = ctx.createGain();
    cityG.gain.value = 0.03;
    const cityPan = this.panner(opts.window, 4, 60);
    city.connect(cityF).connect(cityG).connect(cityPan).connect(out);
    city.start();
    nodes.push(city, cityF, cityG, cityPan);

    // 部屋の空気 (ごく低い共鳴)
    const air = ctx.createOscillator();
    air.type = 'sine';
    air.frequency.value = 41;
    const airG = ctx.createGain();
    airG.gain.value = 0.028;
    air.connect(airG).connect(out);
    air.start();
    oscs.push(air);

    this.fadeIn(out, 0.85, 1.4);
    this.clockAcc = 0;
    this.carTimer = 9;
    return this.makeLayer(nodes, oscs, out);
  }

  /* ---------------- 環境音: 異世界 ---------------- */
  voidAmbience(emitters: Emitter[]) {
    if (!this.ctx) return { stop: () => {} };
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = 0.0001;
    out.connect(this.ambBus);
    const nodes: AudioNode[] = [out];
    const oscs: { stop: (t?: number) => void }[] = [];

    // 風
    const wind = this.noiseSource(true);
    const wf = ctx.createBiquadFilter();
    wf.type = 'lowpass';
    wf.frequency.value = 520;
    wf.Q.value = 0.6;
    const wg = ctx.createGain();
    wg.gain.value = 0.05;
    wind.connect(wf).connect(wg).connect(out);
    wind.start();
    oscs.push(this.lfo(wf.frequency, 0.037, 220, 520));
    oscs.push(this.lfo(wg.gain, 0.061, 0.02, 0.05));

    // 深い唸り (2 音)
    for (const [f, g] of [[34.6, 0.05], [51.9, 0.03]] as const) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      const gg = ctx.createGain();
      gg.gain.value = g;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 180;
      o.connect(lp).connect(gg).connect(out);
      o.start();
      oscs.push(o);
    }

    // 空間に置かれたハム音 (距離減衰 + HRTF)
    for (const e of emitters.slice(0, 6)) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = e.freq;
      const g = ctx.createGain();
      g.gain.value = 0.05;
      const p = this.panner(e.pos, 6, 120);
      o.connect(g).connect(p).connect(out);
      o.start();
      oscs.push(o, this.lfo(g.gain, 0.08 + Math.random() * 0.07, 0.03, 0.05));
      nodes.push(g, p);
    }

    this.fadeIn(out, 0.9, 2.0);
    return this.makeLayer(nodes, oscs, out);
  }

  /** 時計・遠くの車・家鳴りなどのイベント(自室のみ) */
  update(dt: number, room = true) {
    if (!this.ctx || !this.started) return;
    const ctx = this.ctx;
    if (room) {
      this.clockAcc += dt;
      if (this.clockAcc > 1.0) {
        this.clockAcc -= 1.0;
        this.clockTick = (this.clockTick + 1) % 2;
        const now = ctx.currentTime;
        const src = this.noiseSource(false);
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = this.clockTick ? 2600 : 2100;
        bp.Q.value = 6;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, now);
        g.gain.exponentialRampToValueAtTime(this.clockTick ? 0.05 : 0.032, now + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);
        src.connect(bp).connect(g).connect(this.sfxBus);
        src.start(now, Math.random() * 2, 0.08);
      }
      this.carTimer -= dt;
      if (this.carTimer <= 0) {
        this.carTimer = 16 + Math.random() * 22;
        // 遠くを通る車
        const now = ctx.currentTime;
        const src = this.noiseSource(true);
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(300, now);
        lp.frequency.linearRampToValueAtTime(900, now + 3.6);
        lp.frequency.linearRampToValueAtTime(260, now + 7.2);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, now);
        g.gain.linearRampToValueAtTime(0.03, now + 3.0);
        g.gain.linearRampToValueAtTime(0.0001, now + 7.4);
        src.connect(lp).connect(g).connect(this.ambBus);
        src.start(now);
        src.stop(now + 7.5);
      }
    }
  }

  stopAllLayers(fade = 0.6) {
    for (const l of [...this.layers]) l.stop(fade);
    this.layers = [];
  }

  /* ---------------- 効果音 (合成) ---------------- */
  private tone(freq: number, dur: number, type: OscillatorType, vol: number, slideTo?: number, delay = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t0 + Math.min(0.02, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(this.sfxBus);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  private burst(dur: number, freq: number, vol: number, type: BiquadFilterType = 'bandpass', delay = 0, q = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
    const src = this.noiseSource(false);
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t0);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(this.sfxBus);
    src.start(t0, Math.random() * 2, dur + 0.02);
  }

  uiTick(vol = 0.2) { this.burst(0.04, 3200, vol * 0.5, 'highpass'); }
  uiConfirm(up = true) {
    this.tone(up ? 660 : 520, 0.09, 'sine', 0.09);
    this.tone(up ? 990 : 390, 0.12, 'sine', 0.05, undefined, 0.06);
  }
  consoleKey() { this.burst(0.03, 1800, 0.05, 'highpass'); this.tone(120, 0.04, 'square', 0.02); }
  errorBeep(n = 1) {
    for (let i = 0; i < Math.min(3, n); i++) this.tone(150, 0.16, 'square', 0.07, 110, i * 0.19);
  }
  bsodBoot() {
    this.tone(880, 0.5, 'sine', 0.08, 440);
    this.tone(1320, 0.35, 'sine', 0.04, 660, 0.02);
    this.burst(0.5, 2400, 0.05, 'highpass');
  }
  glitchHit(intensity = 1) {
    const v = Math.min(1.4, Math.max(0.1, intensity));
    this.burst(0.05 + 0.1 * v, 900 + Math.random() * 1800, 0.07 * v, 'bandpass', 0, 2.5);
    this.tone(90 + Math.random() * 500, 0.07 + 0.1 * v, 'square', 0.05 * v, 60);
  }
  impact(amount = 1) {
    const v = Math.min(1.4, amount);
    this.tone(70, 0.5, 'sine', 0.35 * v, 32);
    this.burst(0.35, 380, 0.3 * v, 'lowpass');
    this.burst(0.12, 2200, 0.12 * v, 'highpass');
  }
  heartbeat(intensity = 1) {
    const v = Math.min(1.6, intensity);
    this.tone(58, 0.18, 'sine', 0.3 * v, 40);
    this.tone(52, 0.22, 'sine', 0.22 * v, 36, 0.22);
  }
  breath(inhale: boolean, intensity = 1) {
    const v = Math.min(1.5, intensity);
    this.burst(inhale ? 0.42 : 0.55, inhale ? 900 : 620, 0.055 * v, 'bandpass', 0, 0.7);
  }
  crack(intensity = 1) {
    const v = Math.min(2, intensity);
    this.burst(0.12 + 0.1 * v, 2600, 0.16 * v, 'highpass');
    this.tone(120, 0.25, 'square', 0.06 * v, 55);
    this.burst(0.6, 160, 0.18 * v, 'lowpass');
  }
  wakeChord() {
    // 短三度を含む、少しだけ不協和な和音
    const notes = [174.6, 207.7, 261.6, 349.2];
    notes.forEach((f, i) => this.tone(f, 3.6, 'sine', 0.055, undefined, i * 0.09));
    this.tone(87.3, 4.2, 'triangle', 0.04);
  }
  fallWind() {
    if (!this.ctx) return { set: (_v: number) => {}, stop: (_f?: number) => {} };
    const ctx = this.ctx;
    const src = this.noiseSource(true);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 600;
    bp.Q.value = 0.5;
    const g = ctx.createGain();
    g.gain.value = 0.0001;
    src.connect(bp).connect(g).connect(this.sfxBus);
    src.start();
    this.fadeIn(g, 0.12, 0.5);
    const osc = this.lfo(bp.frequency, 0.6, 300, 700);
    return {
      set: (v: number) => { g.gain.setTargetAtTime(Math.min(0.3, 0.1 * v), ctx.currentTime, 0.3); },
      stop: (fade = 0.6) => {
        g.gain.setTargetAtTime(0.0001, ctx.currentTime, fade * 0.4);
        try { osc.stop(ctx.currentTime + fade + 0.2); } catch { /* noop */ }
        try { src.stop(ctx.currentTime + fade + 0.2); } catch { /* noop */ }
      },
    };
  }
  collapseRumble() {
    if (!this.ctx) return { stop: (_f?: number) => {} };
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = 0.0001;
    out.connect(this.sfxBus);
    const src = this.noiseSource(true);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 220;
    const g = ctx.createGain();
    g.gain.value = 0.16;
    src.connect(lp).connect(g).connect(out);
    src.start();
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = 31;
    const sg = ctx.createGain();
    sg.gain.value = 0.14;
    sub.connect(sg).connect(out);
    sub.start();
    const lfo = this.lfo(g.gain, 0.13, 0.06, 0.16);
    this.fadeIn(out, 1, 0.4);
    return {
      stop: (fade = 1) => {
        out.gain.setTargetAtTime(0.0001, ctx.currentTime, fade * 0.35);
        try { sub.stop(ctx.currentTime + fade + 0.3); } catch { /* noop */ }
        try { lfo.stop(ctx.currentTime + fade + 0.3); } catch { /* noop */ }
        try { src.stop(ctx.currentTime + fade + 0.3); } catch { /* noop */ }
      },
    };
  }
  /** 異世界の遠くで鳴るシステム音 */
  distantBeep(pan = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const p = this.panner(new THREE.Vector3(pan * 30, 4, -20), 8, 120);
    p.connect(this.ambBus);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = 1046;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.05, ctx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    o.connect(g).connect(p);
    o.start();
    o.stop(ctx.currentTime + 0.4);
  }
}
