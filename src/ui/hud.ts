/**
 * HUD(レティクル・プロンプト・トースト・パフォーマンス計測表示)
 */
export class HUD {
  private reticle = document.getElementById('reticle')!;
  private promptEl = document.getElementById('prompt')!;
  private toastEl = document.getElementById('toast')!;
  private perfEl = document.getElementById('perf')!;
  private toastTimer: number | null = null;

  private frameTimes: number[] = [];
  private windowTimes: number[] = [];
  private perfVisible = false;
  private perfTimer = 0;

  setPrompt(text: string | null): void {
    if (text) {
      this.promptEl.textContent = text;
      this.promptEl.classList.add('show');
      this.reticle.classList.add('hot');
    } else {
      this.promptEl.classList.remove('show');
      this.reticle.classList.remove('hot');
    }
  }

  toast(text: string, ms = 3200): void {
    this.toastEl.textContent = text;
    this.toastEl.style.opacity = '1';
    if (this.toastTimer !== null) clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toastEl.style.opacity = '0';
    }, ms);
  }

  togglePerf(force?: boolean): void {
    this.perfVisible = force ?? !this.perfVisible;
    this.perfEl.style.display = this.perfVisible ? 'block' : 'none';
  }

  /** 毎フレーム: dt(秒) を記録し、F3表示と計測統計を更新 */
  tick(dt: number, extra: string): void {
    this.frameTimes.push(dt);
    if (this.frameTimes.length > 6000) this.frameTimes.shift();
    this.windowTimes.push(dt);
    if (this.windowTimes.length > 120) this.windowTimes.shift();

    if (!this.perfVisible) return;
    this.perfTimer += dt;
    if (this.perfTimer < 0.25) return;
    this.perfTimer = 0;
    const win = this.windowTimes.slice().sort((a, b) => a - b);
    const avg = this.windowTimes.reduce((a, b) => a + b, 0) / Math.max(1, this.windowTimes.length);
    const onePct = win[Math.floor(win.length * 0.01)] ?? avg;
    this.perfEl.textContent =
      `FPS   ${Math.round(1 / Math.max(0.0001, avg))}\n` +
      `1%low ${Math.round(1 / Math.max(0.0001, onePct))}\n` +
      `frame ${(avg * 1000).toFixed(1)} ms\n` +
      extra;
  }

  /** プレイ全体の統計 */
  stats(): { avgFps: number; onePercentLowFps: number; minFps: number; samples: number } {
    if (this.frameTimes.length === 0) return { avgFps: 0, onePercentLowFps: 0, minFps: 0, samples: 0 };
    const sorted = this.frameTimes.slice().sort((a, b) => a - b);
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    const onePct = sorted[Math.floor(sorted.length * 0.01)] ?? avg;
    const worst = sorted[sorted.length - 1];
    return {
      avgFps: 1 / avg,
      onePercentLowFps: 1 / onePct,
      minFps: 1 / worst,
      samples: this.frameTimes.length,
    };
  }

  resetStats(): void {
    this.frameTimes = [];
    this.windowTimes = [];
  }
}
