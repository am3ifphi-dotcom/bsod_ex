import * as THREE from 'three';

export interface SoundManifestEntry {
  id: string;
  url: string;
}

export const SOUND_MANIFEST: SoundManifestEntry[] = [
  { id: 'room_tone', url: '/audio/room_tone.mp3' },
  { id: 'pc_fan_hum', url: '/audio/pc_fan_hum.mp3' },
  { id: 'clock_tick', url: '/audio/clock_tick.mp3' },
  { id: 'footstep_wood', url: '/audio/footstep_wood.mp3' },
  { id: 'creak_room', url: '/audio/creak_room.mp3' },
  { id: 'ui_hover', url: '/audio/ui_hover.mp3' },
  { id: 'mouse_click', url: '/audio/mouse_click.mp3' },
  { id: 'glitch_short', url: '/audio/glitch_short.mp3' },
  { id: 'monitor_glitch', url: '/audio/monitor_glitch.mp3' },
  { id: 'pain_glitch', url: '/audio/pain_glitch.mp3' },
  { id: 'reality_rift', url: '/audio/reality_rift.mp3' },
  { id: 'static_elec', url: '/audio/static_elec.mp3' },
  { id: 'horror_riser', url: '/audio/horror_riser.mp3' },
  { id: 'wormhole_suck', url: '/audio/wormhole_suck.mp3' },
  { id: 'gasp', url: '/audio/gasp.mp3' },
  { id: 'breathing_panic', url: '/audio/breathing_panic.mp3' },
  { id: 'bgm_glitch_world', url: '/audio/bgm_glitch_world.mp3' },
  { id: 'bgm_dread_drone', url: '/audio/bgm_dread_drone.mp3' },
  { id: 'core_scanner', url: '/audio/core_scanner.mp3' },
  { id: 'anomaly_tremor', url: '/audio/anomaly_tremor.mp3' },
  { id: 'console_error', url: '/audio/console_error.mp3' },
  { id: 'earthquake', url: '/audio/earthquake.mp3' },
  { id: 'shatter', url: '/audio/shatter.mp3' },
  { id: 'fall_wind', url: '/audio/fall_wind.mp3' },
  { id: 'land_impact', url: '/audio/land_impact.mp3' },
  { id: 'aftermath_piano', url: '/audio/aftermath_piano.mp3' },
  { id: 'key1', url: '/audio/key1.mp3' },
  { id: 'key2', url: '/audio/key2.mp3' },
  { id: 'key3', url: '/audio/key3.mp3' },
  { id: 'key4', url: '/audio/key4.mp3' },
  { id: 'step1', url: '/audio/step1.mp3' },
  { id: 'step2', url: '/audio/step2.mp3' },
  { id: 'step3', url: '/audio/step3.mp3' },
  { id: 'step4', url: '/audio/step4.mp3' },
  { id: 'whoosh_cyber', url: '/audio/whoosh_cyber.mp3' },
  { id: 'swoosh_thunder', url: '/audio/swoosh_thunder.mp3' },
  { id: 'transition_solemn', url: '/audio/transition_solemn.mp3' },
  { id: 'ghost_cantata', url: '/audio/ghost_cantata.mp3' },
  { id: 'glitch_stutter', url: '/audio/glitch_stutter.mp3' },
  { id: 'glitch_slice', url: '/audio/glitch_slice.mp3' },
  { id: 'sub_boom', url: '/audio/sub_boom.mp3' },
  { id: 'tape_stop', url: '/audio/tape_stop.mp3' },
  { id: 'void_swell', url: '/audio/void_swell.mp3' },
  { id: 'flesh_pulse', url: '/audio/flesh_pulse.mp3' },
  { id: 'scrapemare', url: '/audio/scrapemare.mp3' },
  { id: 'dissonance', url: '/audio/dissonance.mp3' },
  { id: 'noise_wave', url: '/audio/noise_wave.mp3' },
  { id: 'heartbeat', url: '/audio/heartbeat.mp3' },
];

interface ActiveLoop {
  source: AudioBufferSourceNode;
  gain: GainNode;
  filter?: BiquadFilterNode;
  panner?: PannerNode;
}

export class AudioManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private reverbNode: ConvolverNode | null = null;
  private reverbWetGain: GainNode | null = null;

  private rawBuffers = new Map<string, ArrayBuffer>();
  private buffers = new Map<string, AudioBuffer>();
  private activeLoops = new Map<string, ActiveLoop>();
  private activeOneShots = new Set<{
    src: AudioBufferSourceNode;
    gain: GainNode;
    channel: 'sfx' | 'transition';
  }>();
  private masterVolume = 0.85;
  private unlocked = false;
  private stepIdx = 0;
  private lastFootstepTimeMs = 0;

  /** Continuous beds that must loop without an audible seam (MP3 encoder padding would click). */
  private static readonly LOOPING_IDS = new Set([
    'room_tone',
    'pc_fan_hum',
    'clock_tick',
    'static_elec',
    'fall_wind',
    'core_scanner',
    'bgm_glitch_world',
    'bgm_dread_drone',
    'earthquake',
    'rain_window',
    'rain_aftermath',
  ]);

  /**
   * Rebuilds a decoded bed as a seamless loop by equal-power crossfading its tail into its head.
   * Without this, an MP3 loop restarts with a ~50-110ms gap of encoder padding and the ambience
   * audibly "skips" every few seconds.
   */
  private makeSeamlessLoop(buffer: AudioBuffer): AudioBuffer {
    const ctx = this.ctx;
    if (!ctx) return buffer;
    const fade = Math.min(Math.floor(buffer.sampleRate * 0.09), Math.floor(buffer.length * 0.2));
    if (fade < 128) return buffer;
    const len = buffer.length - fade;
    const out = ctx.createBuffer(buffer.numberOfChannels, len, buffer.sampleRate);
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const src = buffer.getChannelData(ch);
      const dst = out.getChannelData(ch);
      dst.set(src.subarray(0, len));
      for (let i = 0; i < fade; i++) {
        const t = i / fade;
        const wIn = Math.sin(t * Math.PI * 0.5);
        const wOut = Math.cos(t * Math.PI * 0.5);
        dst[i] = src[i] * wIn + src[len + i] * wOut;
      }
    }
    return out;
  }

  private storeDecoded(id: string, decoded: AudioBuffer): void {
    this.buffers.set(
      id,
      AudioManager.LOOPING_IDS.has(id) ? this.makeSeamlessLoop(decoded) : decoded
    );
  }

  private ensureContext(): AudioContext | null {
    if (this.ctx) return this.ctx;
    try {
      const AudioCtx =
        window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.masterVolume;

      const compressor = this.ctx.createDynamicsCompressor();
      compressor.threshold.value = -12;
      compressor.ratio.value = 4;
      this.masterGain.connect(compressor);
      compressor.connect(this.ctx.destination);

      // Lightweight 0.85s stereo impulse reverb (2.6x lighter CPU than long convolution)
      this.reverbNode = this.ctx.createConvolver();
      this.reverbNode.buffer = this.buildImpulseBuffer(this.ctx, 0.85, 3.2);
      this.reverbWetGain = this.ctx.createGain();
      this.reverbWetGain.gain.value = 0.25;
      this.reverbNode.connect(this.reverbWetGain);
      this.reverbWetGain.connect(this.masterGain);

      // Synthesize realistic nocturnal window-rain & post-storm drip beds once at boot
      this.storeDecoded('rain_window', this.buildWindowRainBuffer(this.ctx, false));
      this.storeDecoded('rain_aftermath', this.buildWindowRainBuffer(this.ctx, true));
      return this.ctx;
    } catch {
      return null;
    }
  }

  /**
   * Fetch AND pre-decode audio buffers during the loading screen so clicking Start has ZERO delay!
   */
  public async preloadFiles(onProgress?: (loaded: number, total: number) => void): Promise<void> {
    const ctx = this.ensureContext();
    let done = 0;
    const total = SOUND_MANIFEST.length;

    await Promise.all(
      SOUND_MANIFEST.map(async (entry) => {
        try {
          const res = await fetch(entry.url);
          if (res.ok) {
            const buf = await res.arrayBuffer();
            if (ctx) {
              try {
                const decoded = await ctx.decodeAudioData(buf.slice(0));
                this.storeDecoded(entry.id, decoded);
              } catch {
                this.rawBuffers.set(entry.id, buf);
              }
            } else {
              this.rawBuffers.set(entry.id, buf);
            }
          }
        } catch {
          // Graceful fallback if offline
        } finally {
          done++;
          onProgress?.(done, total);
        }
      })
    );
  }

  /**
   * Synchronous-friendly resume called on user gesture (no blocking await needed before pointer lock!)
   */
  public unlock(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    if (!this.unlocked && this.rawBuffers.size > 0) {
      const pending = Array.from(this.rawBuffers.entries());
      this.rawBuffers.clear();
      for (const [id, raw] of pending) {
        ctx.decodeAudioData(raw.slice(0)).then((dec) => this.storeDecoded(id, dec)).catch(() => {});
      }
    }
    this.unlocked = true;
  }

  /**
   * Monotonic clock in seconds locked directly to WebAudio's hardware sample clock
   * when running (falls back to monotonic wall-clock if audio is unavailable/suspended).
   * Driving cutscene timelines from this clock guarantees ZERO audio/visual drift
   * even across low frame rates or transient main-thread stalls.
   */
  public getClockSeconds(): number {
    if (this.ctx && this.ctx.state === 'running') {
      return this.ctx.currentTime;
    }
    return performance.now() * 0.001;
  }

  public setPaused(paused: boolean): void {
    if (!this.ctx || !this.unlocked) return;
    if (paused && this.ctx.state === 'running') {
      this.ctx.suspend().catch(() => {});
    } else if (!paused && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  private buildImpulseBuffer(ctx: AudioContext, durationSec: number, decay: number): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * durationSec);
    const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        const t = i / length;
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
      }
    }
    return impulse;
  }

  /**
   * Synthesizes a realistic nocturnal rain-against-window-glass stereo bed:
   *  - Multi-pole filtered pink/velvet exterior rain curtain with slow gust breathing
   *  - Discrete physical droplet-on-glass damped resonances + metallic sill patters
   */
  private buildWindowRainBuffer(ctx: AudioContext, aftermathDrip: boolean): AudioBuffer {
    const sr = ctx.sampleRate;
    const dur = aftermathDrip ? 5.6 : 6.4;
    const len = Math.floor(sr * dur);
    const buf = ctx.createBuffer(2, len, sr);
    const left = buf.getChannelData(0);
    const right = buf.getChannelData(1);

    let seed = aftermathDrip ? 918273 : 482719;
    const rnd = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    // 1. Muffled exterior rain curtain (pink-filtered + window-pane lowpass)
    const curtainLevel = aftermathDrip ? 0.035 : 0.19;
    for (let ch = 0; ch < 2; ch++) {
      const out = ch === 0 ? left : right;
      let b0 = 0, b1 = 0, b2 = 0, lp1 = 0, lp2 = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        const gust = 0.78 + 0.22 * Math.sin(t * Math.PI * 2.0) + 0.10 * Math.sin(t * Math.PI * 6.0 + ch * 1.1);
        const w = rnd() * 2 - 1;
        b0 = 0.99765 * b0 + w * 0.099046;
        b1 = 0.96300 * b1 + w * 0.2965164;
        b2 = 0.57000 * b2 + w * 1.0526913;
        const pink = (b0 + b1 + b2 + w * 0.1848) * 0.14;
        // Double-glazed window muffling (~1.1kHz warm body)
        lp1 += 0.14 * (pink - lp1);
        lp2 += 0.22 * (lp1 - lp2);
        out[i] = lp2 * curtainLevel * gust;
      }
    }

    // 2. Discrete raindrop impacts against glass & exterior aluminum sill
    const dropCount = aftermathDrip ? 34 : 310;
    for (let d = 0; d < dropCount; d++) {
      const start = Math.floor(rnd() * (len - Math.floor(sr * 0.08)));
      const pan = rnd();
      const gainL = Math.cos(pan * Math.PI * 0.5);
      const gainR = Math.sin(pan * Math.PI * 0.5);
      const isHeavySill = rnd() < (aftermathDrip ? 0.45 : 0.22);
      const baseFreq = isHeavySill ? 340 + rnd() * 420 : 880 + rnd() * 1950;
      const pitchDrop = isHeavySill ? 0.35 : -0.22; // water bubble chirp vs dull glass tap
      const amp = (aftermathDrip ? 0.10 : 0.075) * (0.35 + Math.pow(rnd(), 1.6) * 0.95);
      const decay = isHeavySill ? 72 + rnd() * 55 : 135 + rnd() * 160;
      const tapSamples = Math.min(len - start, Math.floor(sr * 0.045));

      let phase = rnd() * Math.PI * 2;
      for (let k = 0; k < tapSamples; k++) {
        const dtSec = k / sr;
        const env = Math.exp(-dtSec * decay) * (1 - Math.exp(-dtSec * 1400));
        const instFreq = baseFreq * (1 + pitchDrop * Math.min(1, dtSec * 45));
        phase += (2 * Math.PI * instFreq) / sr;
        const click = k < 18 ? (rnd() * 2 - 1) * 0.35 * (1 - k / 18) : 0;
        const sample = (Math.sin(phase) * 0.8 + click) * amp * env;
        left[start + k] += sample * gainL;
        right[start + k] += sample * gainR;
      }
    }

    return buf;
  }

  public setMasterVolume(v: number): void {
    this.masterVolume = THREE.MathUtils.clamp(v, 0, 1);
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.masterVolume, this.ctx.currentTime, 0.04);
    }
  }

  public updateListener(camera: THREE.Camera): void {
    if (!this.ctx || !this.unlocked) return;
    const listener = this.ctx.listener;
    const pos = _tmpPos;
    const fwd = _tmpFwd;
    const up = _tmpUp;
    camera.getWorldPosition(pos);
    camera.getWorldDirection(fwd);
    up.copy(camera.up).applyQuaternion(camera.quaternion);

    if (listener.positionX) {
      listener.positionX.value = pos.x;
      listener.positionY.value = pos.y;
      listener.positionZ.value = pos.z;
      listener.forwardX.value = fwd.x;
      listener.forwardY.value = fwd.y;
      listener.forwardZ.value = fwd.z;
      listener.upX.value = up.x;
      listener.upY.value = up.y;
      listener.upZ.value = up.z;
    } else {
      listener.setPosition(pos.x, pos.y, pos.z);
      listener.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
    }
  }

  public playOneShot(
    id: string,
    opts: {
      volume?: number;
      rate?: number;
      detune?: number;
      reverb?: number;
      lowpassHz?: number;
      pos?: THREE.Vector3;
      offset?: number;
      duration?: number;
      fadeInSec?: number;
      /** Smooth release applied to the tail of a duration-limited cue (prevents hard chopped clicks). */
      releaseSec?: number;
      channel?: 'sfx' | 'transition';
    } = {}
  ): void {
    if (!this.ctx || !this.masterGain) return;
    const buffer = this.buffers.get(id);
    if (!buffer) return;

    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = opts.rate ?? 1.0;
    if (opts.detune) src.detune.value = opts.detune;

    const targetVol = opts.volume ?? 0.7;
    const gain = this.ctx.createGain();
    if (opts.fadeInSec && opts.fadeInSec > 0) {
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(targetVol, now + opts.fadeInSec);
    } else {
      gain.gain.setValueAtTime(targetVol, now);
    }

    let tail: AudioNode = src;
    if (opts.lowpassHz) {
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = opts.lowpassHz;
      tail.connect(lp);
      tail = lp;
    }

    if (opts.pos) {
      const panner = this.createLightPanner(opts.pos);
      tail.connect(panner);
      tail = panner;
    }

    tail.connect(gain);
    gain.connect(this.masterGain);

    if (opts.reverb && opts.reverb > 0 && this.reverbNode) {
      const send = this.ctx.createGain();
      send.gain.value = opts.reverb;
      gain.connect(send);
      send.connect(this.reverbNode);
    }

    const entry = { src, gain, channel: opts.channel ?? 'sfx' };
    this.activeOneShots.add(entry);
    src.onended = () => {
      this.activeOneShots.delete(entry);
      try {
        src.disconnect();
        gain.disconnect();
      } catch {
        // ignore
      }
    };

    const startOffset = Math.min(opts.offset ?? 0, Math.max(0, buffer.duration - 0.05));
    if (opts.duration !== undefined) {
      const playDur = Math.max(0.05, Math.min(opts.duration, Math.max(0.05, buffer.duration - startOffset)));
      // Musical release: always fade the truncated tail out instead of hard-cutting the sample.
      const rel = Math.min(opts.releaseSec ?? 0.22, playDur * 0.5);
      const holdEnd = Math.min(
        now + playDur - 0.02,
        Math.max(now + (opts.fadeInSec ?? 0) * 0.5, now + playDur - rel)
      );
      try {
        gain.gain.setValueAtTime(targetVol, holdEnd);
        gain.gain.linearRampToValueAtTime(0.0001, now + playDur);
      } catch {
        // ignore scheduling edge cases
      }
      src.start(now, startOffset, playDur);
    } else {
      src.start(now, startOffset);
    }
  }

  public stopOneShots(channel?: 'sfx' | 'transition', fadeSec = 0.25): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const fade = Math.max(0.06, fadeSec);
    for (const item of Array.from(this.activeOneShots)) {
      if (channel && item.channel !== channel) continue;
      this.activeOneShots.delete(item);
      try {
        const current = Math.max(0.0001, item.gain.gain.value);
        item.gain.gain.cancelScheduledValues(now);
        item.gain.gain.setValueAtTime(current, now);
        // Smooth equal-power-ish release (no digital chop on long risers.)
        item.gain.gain.linearRampToValueAtTime(current * 0.55, now + fade * 0.45);
        item.gain.gain.linearRampToValueAtTime(0.0001, now + fade);
        setTimeout(() => {
          try {
            item.src.stop();
            item.src.disconnect();
            item.gain.disconnect();
          } catch {
            // already ended
          }
        }, Math.ceil((fade + 0.08) * 1000));
      } catch {
        // ignore
      }
    }
  }

  public playKeystroke(): void {
    const idx = 1 + Math.floor(Math.random() * 4);
    this.playOneShot(`key${idx}`, {
      volume: 0.42,
      rate: 0.94 + Math.random() * 0.14,
      reverb: 0.08,
    });
  }

  public playFootstep(surface: 'wood' | 'rug' | 'glitch' | 'panic'): void {
    const nowMs = performance.now();
    const minGap = surface === 'panic' ? 120 : 210;
    if (nowMs - this.lastFootstepTimeMs < minGap) return;
    this.lastFootstepTimeMs = nowMs;

    this.stepIdx = (this.stepIdx % 4) + 1;
    const stepId = this.buffers.has(`step${this.stepIdx}`) ? `step${this.stepIdx}` : 'footstep_wood';

    if (surface === 'rug') {
      this.playOneShot(stepId, {
        volume: 0.24,
        rate: 0.84 + Math.random() * 0.1,
        lowpassHz: 680,
        duration: 0.24,
      });
    } else if (surface === 'wood') {
      this.playOneShot(stepId, {
        volume: 0.36,
        rate: 0.94 + Math.random() * 0.12,
        lowpassHz: 2100,
        duration: 0.24,
      });
    } else if (surface === 'panic') {
      this.playOneShot(stepId, {
        volume: 0.58,
        rate: 1.14 + Math.random() * 0.14,
        reverb: 0.35,
        duration: 0.24,
      });
    } else {
      this.playOneShot(stepId, {
        volume: 0.34,
        rate: 0.82 + Math.random() * 0.14,
        reverb: 0.42,
        lowpassHz: 1650,
        duration: 0.24,
      });
    }
  }

  public playJump(surface: 'wood' | 'rug' | 'glitch'): void {
    this.stepIdx = (this.stepIdx % 4) + 1;
    const stepId = this.buffers.has(`step${this.stepIdx}`) ? `step${this.stepIdx}` : 'footstep_wood';
    this.playOneShot(stepId, {
      volume: surface === 'rug' ? 0.26 : 0.34,
      rate: surface === 'glitch' ? 1.08 : 1.16,
      lowpassHz: surface === 'rug' ? 920 : 2400,
      reverb: surface === 'glitch' ? 0.32 : 0.08,
      duration: 0.18,
    });
  }

  public playJumpLand(surface: 'wood' | 'rug' | 'glitch', impactNorm = 1.0): void {
    this.lastFootstepTimeMs = performance.now();
    this.stepIdx = (this.stepIdx % 4) + 1;
    const stepId = this.buffers.has(`step${this.stepIdx}`) ? `step${this.stepIdx}` : 'footstep_wood';
    const strength = THREE.MathUtils.clamp(impactNorm, 0.35, 1.35);
    this.playOneShot(stepId, {
      volume: (surface === 'rug' ? 0.32 : 0.46) * strength,
      rate: (surface === 'glitch' ? 0.74 : 0.82) + Math.random() * 0.08,
      lowpassHz: surface === 'rug' ? 760 : 1950,
      reverb: surface === 'glitch' ? 0.46 : 0.12,
      duration: 0.26,
    });
    if (strength > 0.72) {
      this.playOneShot('land_impact', {
        volume: (surface === 'rug' ? 0.10 : 0.18) * strength,
        rate: surface === 'glitch' ? 1.18 : 1.32,
        lowpassHz: surface === 'rug' ? 620 : 1350,
        reverb: surface === 'glitch' ? 0.34 : 0.06,
        duration: 0.32,
        releaseSec: 0.14,
      });
    }
  }

  public startOrUpdateLoop(
    loopKey: string,
    soundId: string,
    opts: {
      volume: number;
      rate?: number;
      lowpassHz?: number;
      reverb?: number;
      pos?: THREE.Vector3;
      refDistance?: number;
      maxDistance?: number;
      fadeSec?: number;
    }
  ): void {
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const fade = opts.fadeSec ?? 0.35;

    const existing = this.activeLoops.get(loopKey);
    if (existing) {
      existing.gain.gain.setTargetAtTime(opts.volume, now, Math.max(0.03, fade * 0.35));
      if (opts.rate !== undefined) {
        existing.source.playbackRate.setTargetAtTime(opts.rate, now, 0.08);
      }
      if (opts.lowpassHz && existing.filter) {
        existing.filter.frequency.setTargetAtTime(opts.lowpassHz, now, 0.1);
      }
      if (opts.pos && existing.panner) {
        existing.panner.positionX.value = opts.pos.x;
        existing.panner.positionY.value = opts.pos.y;
        existing.panner.positionZ.value = opts.pos.z;
      }
      return;
    }

    const buffer = this.buffers.get(soundId);
    if (!buffer) return;

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.playbackRate.value = opts.rate ?? 1.0;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(opts.volume, now + fade);

    let tail: AudioNode = source;
    let filter: BiquadFilterNode | undefined;
    if (opts.lowpassHz) {
      filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = opts.lowpassHz;
      tail.connect(filter);
      tail = filter;
    }

    let panner: PannerNode | undefined;
    if (opts.pos) {
      panner = this.createLightPanner(opts.pos, opts.refDistance ?? 0.9, opts.maxDistance ?? 18);
      tail.connect(panner);
      tail = panner;
    }

    tail.connect(gain);
    gain.connect(this.masterGain);

    if (opts.reverb && opts.reverb > 0 && this.reverbNode) {
      const send = this.ctx.createGain();
      send.gain.value = opts.reverb;
      gain.connect(send);
      send.connect(this.reverbNode);
    }

    source.start(now, Math.random() * Math.min(1.5, buffer.duration * 0.4));
    this.activeLoops.set(loopKey, { source, gain, filter, panner });
  }

  public stopLoop(loopKey: string, fadeSec = 0.35): void {
    if (!this.ctx) return;
    const existing = this.activeLoops.get(loopKey);
    if (!existing) return;
    this.activeLoops.delete(loopKey);

    const now = this.ctx.currentTime;
    existing.gain.gain.cancelScheduledValues(now);
    existing.gain.gain.setValueAtTime(existing.gain.gain.value, now);
    existing.gain.gain.linearRampToValueAtTime(0.0001, now + fadeSec);
    setTimeout(() => {
      try {
        existing.source.stop();
        existing.source.disconnect();
        existing.gain.disconnect();
      } catch {
        // already stopped
      }
    }, Math.ceil((fadeSec + 0.08) * 1000));
  }

  public stopAllLoops(fadeSec = 0.3): void {
    for (const key of Array.from(this.activeLoops.keys())) {
      this.stopLoop(key, fadeSec);
    }
  }

  /**
   * Uses 'equalpower' panning instead of CPU-heavy HRTF convolution so audio never taxes frame time!
   */
  private createLightPanner(pos: THREE.Vector3, refDist = 0.8, maxDist = 14): PannerNode {
    const p = this.ctx!.createPanner();
    p.panningModel = 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = refDist;
    p.maxDistance = maxDist;
    p.rolloffFactor = 1.3;
    p.positionX.value = pos.x;
    p.positionY.value = pos.y;
    p.positionZ.value = pos.z;
    return p;
  }
}

const _tmpPos = new THREE.Vector3();
const _tmpFwd = new THREE.Vector3();
const _tmpUp = new THREE.Vector3();
