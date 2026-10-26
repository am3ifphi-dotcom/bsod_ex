/**
 * ごく軽い環境音（WebAudio のドローン）。
 * 音源ファイルは読み込まず、2 つのオシレータとフィルタだけ。0.8KB 程度の負荷。
 */

export class Ambient {
  constructor() {
    this.ctx = null;
    this.enabled = false;
    this.nodes = null;
  }

  toggle() {
    if (this.enabled) {
      this.stop();
      return false;
    }
    this.start();
    return true;
  }

  start() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();

    const ctx = this.ctx;
    const master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 520;
    filter.Q.value = 3.2;
    filter.connect(master);

    const oscA = ctx.createOscillator();
    oscA.type = 'sine';
    oscA.frequency.value = 55;

    const oscB = ctx.createOscillator();
    oscB.type = 'triangle';
    oscB.frequency.value = 82.5;

    const oscC = ctx.createOscillator();
    oscC.type = 'sine';
    oscC.frequency.value = 164.6;
    const oscCGain = ctx.createGain();
    oscCGain.gain.value = 0.18;

    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 180;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);

    oscA.connect(filter);
    oscB.connect(filter);
    oscC.connect(oscCGain).connect(filter);

    const t = ctx.currentTime;
    oscA.start(t);
    oscB.start(t);
    oscC.start(t);
    lfo.start(t);
    master.gain.linearRampToValueAtTime(0.085, t + 1.8);

    this.nodes = { master, filter, oscA, oscB, oscC, lfo };
    this.enabled = true;
  }

  /** 島に近づいたときの小さなチャイム */
  ping(frequency = 660) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(frequency, t);
    osc.frequency.exponentialRampToValueAtTime(frequency * 1.5, t + 0.22);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.06, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    osc.connect(gain).connect(this.nodes.master);
    osc.start(t);
    osc.stop(t + 0.6);
  }

  stop() {
    if (!this.nodes) return;
    const { master, oscA, oscB, oscC, lfo } = this.nodes;
    const t = this.ctx.currentTime;
    master.gain.cancelScheduledValues(t);
    master.gain.setValueAtTime(master.gain.value, t);
    master.gain.linearRampToValueAtTime(0.0001, t + 0.5);
    [oscA, oscB, oscC, lfo].forEach((osc) => {
      try {
        osc.stop(t + 0.6);
      } catch (error) {
        /* already stopped */
      }
    });
    this.enabled = false;
    this.nodes = null;
  }
}
