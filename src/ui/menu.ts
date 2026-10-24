/**
 * Esc メニュー / クレジット / 開始画面 / エラー画面
 */
import type { SettingsStore, QualityPreset } from '../core/settings';

export class MenuUI {
  private menuEl = document.getElementById('menu')!;
  private creditsEl = document.getElementById('credits')!;
  private creditsBody = document.getElementById('credits-body')!;
  private resumeHint = document.getElementById('resume-hint')!;

  onResume: (() => void) | null = null;
  onRestart: (() => void) | null = null;

  constructor(private settings: SettingsStore) {
    const bind = (id: string, key: 'sensitivity' | 'masterVolume' | 'glitchIntensity' | 'shake', fmt: (v: number) => string, valId: string): void => {
      const el = document.getElementById(id) as HTMLInputElement;
      const val = document.getElementById(valId)!;
      el.value = String(settings.data[key]);
      val.textContent = fmt(settings.data[key]);
      el.addEventListener('input', () => {
        const v = parseFloat(el.value);
        val.textContent = fmt(v);
        settings.set(key, v);
      });
    };
    bind('set-sens', 'sensitivity', (v) => v.toFixed(2), 'val-sens');
    bind('set-vol', 'masterVolume', (v) => v.toFixed(2), 'val-vol');
    bind('set-glitch', 'glitchIntensity', (v) => v.toFixed(2), 'val-glitch');
    bind('set-shake', 'shake', (v) => v.toFixed(2), 'val-shake');

    const segs = document.querySelectorAll<HTMLDivElement>('#set-quality .seg');
    const syncSegs = (): void => {
      segs.forEach((s) => {
        s.classList.toggle('active', s.dataset.q === settings.data.quality);
      });
    };
    syncSegs();
    segs.forEach((s) => {
      s.addEventListener('click', () => {
        settings.set('quality', s.dataset.q as QualityPreset);
        syncSegs();
      });
    });

    document.getElementById('menu-resume')!.addEventListener('click', () => {
      this.hide();
      this.onResume?.();
    });
    document.getElementById('menu-restart')!.addEventListener('click', () => {
      this.hide();
      this.onRestart?.();
    });
    document.getElementById('menu-credits')!.addEventListener('click', () => {
      this.showCredits();
    });
    document.getElementById('credits-close')!.addEventListener('click', () => {
      this.creditsEl.classList.add('hidden');
    });

    this.resumeHint.addEventListener('click', () => {
      this.resumeHint.classList.remove('show');
      this.onResume?.();
    });
  }

  show(): void {
    this.menuEl.classList.remove('hidden');
  }

  hide(): void {
    this.menuEl.classList.add('hidden');
    this.creditsEl.classList.add('hidden');
  }

  get visible(): boolean {
    return !this.menuEl.classList.contains('hidden');
  }

  showResumeHint(): void {
    this.resumeHint.classList.add('show');
  }

  hideResumeHint(): void {
    this.resumeHint.classList.remove('show');
  }

  async showCredits(): Promise<void> {
    this.creditsEl.classList.remove('hidden');
    try {
      const res = await fetch('CREDITS.txt');
      if (res.ok) {
        this.creditsBody.textContent = await res.text();
        return;
      }
    } catch {
      /* fall through */
    }
    this.creditsBody.textContent = 'CREDITS.txt を読み込めませんでした。リポジトリの CREDITS.md を参照してください。';
  }
}
