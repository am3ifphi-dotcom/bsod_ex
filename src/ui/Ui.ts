import type { Settings, QualityPreset } from '../core/Settings';
import type { PerfStats } from '../core/Renderer';
import { clamp } from '../core/math';

export interface UiCallbacks {
  onStart: () => void;
  onResume: () => void;
  onRestart: () => void;
  onQuitToTitle: () => void;
  onSettingsChange: (key: string, value: number | string | boolean) => void;
  onConsoleCommand: (text: string) => void;
  onConsoleClose: () => void;
  onBsodClick: () => void;
  onRequestLock: () => void;
}

interface CreditsData {
  assets: {
    id: string; title: string; authors: string[]; licenses: string[];
    licenseNote?: string; source?: string; sourceLabel?: string; use?: string; type?: string;
  }[];
  software: { title: string; authors: string[]; licenses: string[]; source: string; use: string }[];
  selfMade: { title: string; licenses: string[]; note: string }[];
}

const $ = <T extends HTMLElement>(sel: string): T => {
  const el = document.querySelector(sel);
  if (!el) throw new Error(`missing element ${sel}`);
  return el as T;
};

export class Ui {
  private callbacks: UiCallbacks | null = null;
  private creditsData: CreditsData | null = null;
  private menuOpen = false;
  private creditsOpen = false;
  private consoleOpen = false;
  private bsodStage = 0;
  private subtitleTimer = 0;
  private perfVisible = false;
  private history: string[] = [];
  private historyIndex = -1;
  private composedRecently = false;

  private hud = $('#hud');
  private reticle = $('#reticle');
  private prompt = $('#prompt');
  private promptText = $('#prompt-text');
  private subtitleEl = $('#subtitle');
  private hintEl = $('#hint');
  private objectivesEl = $('#objectives');
  private bsodEl = $('#bsod');
  private consoleEl = $('#console-overlay');
  private consoleLog = $('#console-log');
  private consoleInput = $<HTMLInputElement>('#console-input');
  private menuEl = $('#menu');
  private creditsEl = $('#credits');
  private titleEl = $('#title-screen');
  private loadingEl = $('#loading');
  private loadFill = $('#load-fill');
  private loadLabel = $('#load-label');
  private fadeEl = $('#fade');
  private perfEl = $('#perf');
  private crashEl = $('#crash-screen');
  private devHint = $('#dev-hint');

  constructor(private settings: Settings) {
    this.bindConsole();
    this.loadCredits();
  }

  setCallbacks(cb: UiCallbacks): void { this.callbacks = cb; }

  /* ------------------------------------------------------------- loading */
  setProgress(p: number, label: string): void {
    const pct = clamp(p, 0, 1) * 100;
    this.loadFill.style.width = `${pct.toFixed(1)}%`;
    this.loadLabel.textContent = label;
  }

  hideLoading(): void {
    this.loadingEl.classList.add('gone');
    window.setTimeout(() => this.loadingEl.classList.add('hidden'), 900);
  }

  /* --------------------------------------------------------------- title */
  showTitle(): void {
    this.titleEl.classList.remove('hidden');
    this.titleEl.innerHTML = `
      <div class="title-inner">
        <div class="title-kicker">A SHORT FIRST-PERSON HORROR</div>
        <h1 class="title-main">BSOD <span class="glitch">//</span> EX</h1>
        <div class="title-sub">青い画面に、部屋ごと食われる。</div>
        <p class="title-warn">
          <b>ご注意</b> — この作品には、画面のちらつき（点滅）・グリッチ・強いコントラストの演出が含まれます。
          光に敏感な方、てんかんの既往のある方はご注意ください。
          Esc メニューの「グリッチ演出の強度」と「カメラ揺れ／ヘッドボブ」で強度を下げられます。
          音量は控えめに設定されています。ヘッドホン推奨。
        </p>
        <div class="title-controls">
          <div><b>WASD</b> 移動</div><div><b>マウス</b> 視点</div>
          <div><b>Shift</b> ダッシュ</div><div><b>E / クリック</b> 調べる</div>
          <div><b>F</b> ライト</div><div><b>C</b> コンソール</div>
          <div><b>Esc</b> メニュー</div><div><b>F3</b> パフォーマンス</div>
        </div>
        <div class="title-actions">
          <button class="btn primary" id="btn-start">開始する</button>
          <button class="btn" id="btn-title-settings">設定</button>
          <button class="btn" id="btn-title-credits">クレジット</button>
        </div>
        <p class="title-note">推奨: デスクトップ / Chrome・Edge・Firefox・Safari 最新版 / ヘッドホン</p>
      </div>`;
    $('#btn-start').addEventListener('click', () => this.callbacks?.onStart());
    $('#btn-title-settings').addEventListener('click', () => this.openMenu(true));
    $('#btn-title-credits').addEventListener('click', () => this.openCredits(true));
  }

  hideTitle(): void {
    this.titleEl.classList.add('hidden');
  }

  get titleVisible(): boolean { return !this.titleEl.classList.contains('hidden'); }

  /* ----------------------------------------------------------------- HUD */
  setHudVisible(v: boolean): void {
    this.hud.classList.toggle('hidden', !v);
  }

  setReticleHot(hot: boolean, idle = false): void {
    this.reticle.classList.toggle('hot', hot);
    this.reticle.classList.toggle('idle', idle);
  }

  setPrompt(text: string | null, key = 'E'): void {
    if (!text) {
      this.prompt.classList.add('hidden');
      return;
    }
    this.prompt.classList.remove('hidden');
    this.prompt.querySelector('.key')!.textContent = key;
    this.promptText.textContent = text;
  }

  subtitle(text: string, ms = 5200): void {
    this.subtitleEl.textContent = text;
    this.subtitleEl.classList.add('show');
    window.clearTimeout(this.subtitleTimer);
    this.subtitleTimer = window.setTimeout(() => this.subtitleEl.classList.remove('show'), ms);
  }

  clearSubtitle(): void {
    this.subtitleEl.classList.remove('show');
  }

  hint(lines: string[] | null): void {
    if (!lines || !lines.length) {
      this.hintEl.classList.remove('show');
      return;
    }
    this.hintEl.innerHTML = lines.map((l) => `<div>${l}</div>`).join('');
    this.hintEl.classList.add('show');
  }

  objectives(text: string | null): void {
    if (!text) {
      this.objectivesEl.classList.remove('show');
      return;
    }
    this.objectivesEl.textContent = text;
    this.objectivesEl.classList.add('show');
  }

  /* ---------------------------------------------------------------- BSOD */
  showBsod(show: boolean): void {
    this.bsodEl.classList.toggle('hidden', !show);
    if (show) {
      this.bsodStage = 0;
      this.renderBsod();
    }
  }

  setBsodRect(left: number, top: number, width: number, height: number): void {
    this.bsodEl.style.left = `${left}px`;
    this.bsodEl.style.top = `${top}px`;
    this.bsodEl.style.width = `${width}px`;
    this.bsodEl.style.height = `${height}px`;
  }

  get bsodVisible(): boolean { return !this.bsodEl.classList.contains('hidden'); }

  setBsodStage(stage: number): void {
    this.bsodStage = stage;
    this.renderBsod();
  }

  get bsodClickCount(): number { return this.bsodStage; }

  private renderBsod(): void {
    const stage = this.bsodStage;
    const glitchClass = stage > 0 ? `glitch-${Math.min(5, stage)}` : '';
    const pct = [47, 52, 61, 74, 88, 99, 100][Math.min(6, stage)] ?? 47;
    const plea = stage >= 4;
    this.bsodEl.className = `${glitchClass} ${plea ? 'pleading' : ''}`;
    this.bsodEl.innerHTML = `
      <div class="bsod-inner">
        <div class="face${stage === 0 || stage === 5 ? ' hot' : ''}" id="bsod-face">:(</div>
        <div class="msg">Your PC ran into a problem and needs to restart.
          We're just collecting some error info, and then we'll restart for you.</div>
        <div class="pct">${pct}% complete</div>
        <div class="stop">Stop code: CRITICAL_PROCESS_DIED &nbsp;·&nbsp; 0x000000EF &nbsp;·&nbsp; sector ${(0x2f63 + stage * 12).toString(16).toUpperCase()}</div>
        ${stage >= 2 ? '<div class="plea">LOOK AT ME</div>' : ''}
        <div class="scanline"></div>
        <div class="qr" aria-hidden="true">${Array.from({ length: 81 }, () => `<i class="${Math.random() < 0.45 ? 'on' : ''}"></i>`).join('')}</div>
        ${Array.from({ length: stage * 3 }, (_, i) => {
          const w = 12 + Math.random() * 90;
          const h = 4 + Math.random() * 16;
          const top = Math.random() * 100;
          const left = Math.random() * 100;
          return `<div class="shard" style="left:${left}%;top:${top}%;width:${w}px;height:${h}px;opacity:${0.1 + Math.random() * 0.4}"></div>`;
        }).join('')}
      </div>`;
    const face = this.bsodEl.querySelector('#bsod-face') as HTMLElement | null;
    face?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.callbacks?.onBsodClick();
      this.callbacks?.onRequestLock();
    });
    this.bsodEl.onclick = () => this.callbacks?.onBsodClick();
    if (stage >= 5) {
      face?.classList.add('hot');
      face && (face.style.transform = 'scale(1.35)');
    }
    if (stage >= 3) {
      face && (face.style.letterSpacing = `${stage * 0.03}em`);
    }
  }

  /* -------------------------------------------------------------- console */
  private bindConsole(): void {
    // IME-safe: never submit while composing (Japanese input)
    this.consoleInput.addEventListener('compositionstart', () => { this.composedRecently = true; });
    this.consoleInput.addEventListener('compositionend', () => {
      window.setTimeout(() => { this.composedRecently = false; }, 30);
    });
    this.consoleInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        if (e.isComposing || this.composedRecently || (e as unknown as { keyCode: number }).keyCode === 229) return;
        e.preventDefault();
        const text = this.consoleInput.value;
        this.consoleInput.value = '';
        if (text.trim().length) {
          this.history.push(text);
          this.historyIndex = this.history.length;
        }
        this.callbacks?.onConsoleCommand(text);
        return;
      }
      // Esc always closes. Ctrl/Cmd+C also closes, but a plain "c" must stay typeable so
      // commands like "cat notes.txt" or "clear" work.
      if (e.key === 'Escape' || ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C'))) {
        e.preventDefault();
        this.closeConsole();
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (!this.history.length) return;
        this.historyIndex = Math.max(0, this.historyIndex - 1);
        this.consoleInput.value = this.history[this.historyIndex] ?? '';
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.historyIndex = Math.min(this.history.length, this.historyIndex + 1);
        this.consoleInput.value = this.history[this.historyIndex] ?? '';
      }
    });
    this.consoleInput.addEventListener('keyup', (e) => e.stopPropagation());
    this.consoleInput.addEventListener('keypress', (e) => e.stopPropagation());
    this.consoleEl.addEventListener('click', () => this.consoleInput.focus());
  }

  openConsole(): void {
    this.consoleOpen = true;
    this.consoleEl.classList.remove('hidden');
    this.consoleInput.disabled = false;
    this.consoleInput.value = '';
    window.setTimeout(() => this.consoleInput.focus(), 30);
    this.setHudVisible(false);
  }

  closeConsole(): void {
    if (!this.consoleOpen) return;
    this.consoleOpen = false;
    this.consoleInput.blur();
    this.consoleEl.classList.add('hidden');
    this.callbacks?.onConsoleClose();
  }

  get isConsoleOpen(): boolean { return this.consoleOpen; }

  consolePrint(text: string, cls: 'cmd' | 'err' | 'ok' | 'sys' | 'warn' | 'line' = 'line'): void {
    const div = document.createElement('div');
    div.className = `line ${cls}`;
    div.textContent = text;
    this.consoleLog.appendChild(div);
    this.consoleLog.scrollTop = this.consoleLog.scrollHeight;
  }

  consoleClear(): void { this.consoleLog.innerHTML = ''; }

  consoleFocus(): void { this.consoleInput.focus(); }

  consoleSetEnabled(v: boolean): void {
    this.consoleInput.disabled = !v;
  }

  /* ----------------------------------------------------------------- menu */
  openMenu(fromTitle = false): void {
    if (this.menuOpen) return;
    this.menuOpen = true;
    this.menuEl.classList.remove('hidden');
    this.renderMenu(fromTitle);
  }

  closeMenu(): void {
    if (!this.menuOpen) return;
    this.menuOpen = false;
    this.menuEl.classList.add('hidden');
    this.callbacks?.onResume();
  }

  get isMenuOpen(): boolean { return this.menuOpen; }

  private renderMenu(fromTitle: boolean): void {
    const s = this.settings.data;
    this.menuEl.innerHTML = `
      <div class="menu-panel">
        <div class="menu-title">PAUSED — SESSION 0x2F63</div>
        <h2 class="menu-h2">設定</h2>
        <div class="menu-row">
          <label for="set-sens">マウス感度</label>
          <input id="set-sens" type="range" min="0.2" max="3" step="0.05" value="${s.sensitivity}" />
          <span class="val" id="val-sens">${s.sensitivity.toFixed(2)}</span>
        </div>
        <div class="menu-row">
          <label for="set-vol">音量</label>
          <input id="set-vol" type="range" min="0" max="1" step="0.01" value="${s.volume}" />
          <span class="val" id="val-vol">${Math.round(s.volume * 100)}%</span>
        </div>
        <div class="menu-row">
          <label for="set-glitch">グリッチ演出の強度</label>
          <input id="set-glitch" type="range" min="0" max="1" step="0.01" value="${s.glitch}" />
          <span class="val" id="val-glitch">${Math.round(s.glitch * 100)}%</span>
        </div>
        <div class="menu-row">
          <label for="set-cam">カメラ揺れ／ヘッドボブ</label>
          <input id="set-cam" type="range" min="0" max="1" step="0.01" value="${s.cameraMotion}" />
          <span class="val" id="val-cam">${Math.round(s.cameraMotion * 100)}%</span>
        </div>
        <div class="menu-row">
          <label for="set-fov">視野角 (FOV)</label>
          <input id="set-fov" type="range" min="60" max="95" step="1" value="${s.fov}" />
          <span class="val" id="val-fov">${s.fov}°</span>
        </div>
        <div class="menu-row">
          <label for="set-quality">画質プリセット</label>
          <select id="set-quality">
            <option value="low"${s.quality === 'low' ? ' selected' : ''}>low — 軽量 / AOなし</option>
            <option value="medium"${s.quality === 'medium' ? ' selected' : ''}>medium — 推奨</option>
            <option value="high"${s.quality === 'high' ? ' selected' : ''}>high — GTAO + 高解像度</option>
          </select>
          <span class="val" id="val-quality"></span>
        </div>
        <div class="menu-row">
          <label for="set-f3">パフォーマンス表示 (F3)</label>
          <select id="set-f3">
            <option value="off"${!s.showPerf ? ' selected' : ''}>off</option>
            <option value="on"${s.showPerf ? ' selected' : ''}>on</option>
          </select>
          <span class="val"></span>
        </div>
        <div class="menu-row">
          <label>操作</label>
          <div style="font-family:var(--mono);font-size:11px;color:rgba(180,205,240,0.55);line-height:1.9">
            WASD 移動 / Shift ダッシュ / E・クリック 調べる / F ライト / C コンソール / Esc メニュー
          </div>
          <span></span>
        </div>
        <div class="menu-actions">
          ${fromTitle ? '' : '<button class="btn primary" id="btn-resume">再開する</button>'}
          <button class="btn" id="btn-credits">アセット クレジット</button>
          <button class="btn danger" id="btn-restart">最初からやり直す</button>
          ${fromTitle ? '' : '<button class="btn" id="btn-quit">タイトルへ</button>'}
        </div>
        <p class="menu-note">
          設定はこのブラウザに自動保存されます。感度スライダーは動かした瞬間から視点に反映されます。<br>
          点滅が苦手な方は「グリッチ演出の強度」を 0% にしてください（物語上の演出は残ります）。
        </p>
      </div>`;

    const bind = (id: string, key: 'sensitivity' | 'volume' | 'glitch' | 'cameraMotion' | 'fov', fmt: (v: number) => string) => {
      const input = this.menuEl.querySelector(`#${id}`) as HTMLInputElement;
      const val = this.menuEl.querySelector(`#val-${id.replace('set-', '')}`);
      input.addEventListener('input', () => {
        const v = Number(input.value);
        this.settings.set(key, v);
        if (val) val.textContent = fmt(v);
        this.callbacks?.onSettingsChange(key, v);
      });
    };
    bind('set-sens', 'sensitivity', (v) => v.toFixed(2));
    bind('set-vol', 'volume', (v) => `${Math.round(v * 100)}%`);
    bind('set-glitch', 'glitch', (v) => `${Math.round(v * 100)}%`);
    bind('set-cam', 'cameraMotion', (v) => `${Math.round(v * 100)}%`);
    bind('set-fov', 'fov', (v) => `${Math.round(v)}°`);

    (this.menuEl.querySelector('#set-quality') as HTMLSelectElement).addEventListener('change', (e) => {
      const q = (e.target as HTMLSelectElement).value as QualityPreset;
      this.settings.set('quality', q);
      this.callbacks?.onSettingsChange('quality', q);
    });
    (this.menuEl.querySelector('#set-f3') as HTMLSelectElement).addEventListener('change', (e) => {
      const on = (e.target as HTMLSelectElement).value === 'on';
      this.settings.set('showPerf', on);
      this.callbacks?.onSettingsChange('showPerf', on);
      this.setPerfVisible(on);
    });
    this.menuEl.querySelector('#btn-resume')?.addEventListener('click', () => this.closeMenu());
    this.menuEl.querySelector('#btn-credits')?.addEventListener('click', () => this.openCredits(false));
    this.menuEl.querySelector('#btn-restart')?.addEventListener('click', () => {
      this.menuEl.classList.add('hidden');
      this.menuOpen = false;
      this.callbacks?.onRestart();
    });
    this.menuEl.querySelector('#btn-quit')?.addEventListener('click', () => {
      this.menuEl.classList.add('hidden');
      this.menuOpen = false;
      this.callbacks?.onQuitToTitle();
    });
  }

  /* -------------------------------------------------------------- credits */
  private async loadCredits(): Promise<void> {
    try {
      const res = await fetch('assets/credits.json');
      if (res.ok) this.creditsData = (await res.json()) as CreditsData;
    } catch {
      this.creditsData = null;
    }
  }

  openCredits(fromTitle: boolean): void {
    this.creditsOpen = true;
    this.creditsEl.classList.remove('hidden');
    const d = this.creditsData;
    const item = (a: CreditsData['assets'][number]) => `
      <div class="credit-item">
        <div class="name">${escapeHtml(a.title)} <span style="opacity:.45">— ${escapeHtml(a.authors.join(', '))}</span></div>
        <div class="meta">${escapeHtml(a.licenses.join(' / '))} · ${escapeHtml(a.sourceLabel ?? '')}</div>
        ${a.source ? `<div class="meta"><a href="${escapeAttr(a.source)}" target="_blank" rel="noopener">${escapeHtml(a.source.replace(/^https?:\/\//, ''))}</a></div>` : ''}
        ${a.use ? `<div class="meta" style="opacity:.7">用途: ${escapeHtml(a.use)}</div>` : ''}
        ${a.licenseNote ? `<div class="meta" style="opacity:.55">${escapeHtml(a.licenseNote)}</div>` : ''}
      </div>`;
    this.creditsEl.innerHTML = `
      <div class="menu-panel credits-panel">
        <div class="menu-title">CREDITS — LICENSES</div>
        <h2 class="menu-h2">クレジット</h2>
        ${d ? `
        <div class="credit-section">
          <h3>3D MODELS</h3>
          ${d.assets.filter((a) => a.type === 'model').map(item).join('')}
        </div>
        <div class="credit-section">
          <h3>ENVIRONMENTS / TEXTURES</h3>
          ${d.assets.filter((a) => a.type !== 'model').map(item).join('')}
        </div>
        <div class="credit-section">
          <h3>SOFTWARE</h3>
          ${d.software.map((s) => `
            <div class="credit-item">
              <div class="name">${escapeHtml(s.title)} <span style="opacity:.45">— ${escapeHtml(s.authors.join(', '))}</span></div>
              <div class="meta">${escapeHtml(s.licenses.join(' / '))} · <a href="${escapeAttr(s.source)}" target="_blank" rel="noopener">${escapeHtml(s.source.replace(/^https?:\/\//, ''))}</a></div>
            </div>`).join('')}
        </div>
        <div class="credit-section">
          <h3>ORIGINAL / PROCEDURAL (CC0)</h3>
          ${d.selfMade.map((s) => `
            <div class="credit-item">
              <div class="name">${escapeHtml(s.title)}</div>
              <div class="meta">${escapeHtml(s.licenses.join(' / '))} — ${escapeHtml(s.note)}</div>
            </div>`).join('')}
        </div>` : '<div class="credit-item">クレジットの読み込みに失敗しました（assets/credits.json）。</div>'}
        <div class="menu-actions">
          <button class="btn" id="btn-credits-back">戻る</button>
        </div>
        <p class="menu-note">
          Poly Haven の HDRI は CC0、Khronos glTF Sample Assets のモデルは各 LICENSE に従います（CC0 / CC-BY-4.0）。
          CC-BY の素材は作者名を表示しています。改変（再マテリアル化・再ライティング・破損加工）は本作品内で行っています。
        </p>
      </div>`;
    (this.creditsEl.querySelector('#btn-credits-back') as HTMLButtonElement).addEventListener('click', () => {
      this.creditsOpen = false;
      this.creditsEl.classList.add('hidden');
      if (fromTitle) this.openMenu(true);
      else this.openMenu(false);
    });
  }

  get isCreditsOpen(): boolean { return this.creditsOpen; }

  /** Close the credits panel without forcing the menu back open (ESC / resume paths). */
  closeCredits(): void {
    if (!this.creditsOpen) return;
    this.creditsOpen = false;
    this.creditsEl.classList.add('hidden');
  }

  /* ----------------------------------------------------------------- perf */
  setPerfVisible(v: boolean): void {
    this.perfVisible = v;
    this.perfEl.classList.toggle('hidden', !v);
  }

  get isPerfVisible(): boolean { return this.perfVisible; }

  setPerf(stats: PerfStats, extra: Record<string, string>): void {
    if (!this.perfVisible) return;
    this.perfEl.textContent =
      `FPS ${stats.fps.toFixed(0).padStart(3)}  (1% low ${stats.low1.toFixed(0)})\n`
      + `frame ${stats.frameMs.toFixed(2)} ms  res ${(stats.scale * 100).toFixed(0)}%\n`
      + `draw ${stats.drawCalls}  tris ${(stats.triangles / 1000).toFixed(0)}k\n`
      + Object.entries(extra).map(([k, v]) => `${k}: ${v}`).join('\n');
  }

  setDevHint(text: string | null): void {
    if (!text) { this.devHint.classList.add('hidden'); return; }
    this.devHint.textContent = text;
    this.devHint.classList.remove('hidden');
  }

  /* ----------------------------------------------------------------- misc */
  fade(toBlack: boolean, durationMs = 900): Promise<void> {
    this.fadeEl.style.transitionDuration = `${durationMs}ms`;
    this.fadeEl.style.opacity = toBlack ? '1' : '0';
    this.fadeEl.style.pointerEvents = toBlack ? 'all' : 'none';
    return new Promise((resolve) => window.setTimeout(resolve, durationMs));
  }

  setFadeInstant(toBlack: boolean): void {
    this.fadeEl.style.transitionDuration = '0ms';
    this.fadeEl.style.opacity = toBlack ? '1' : '0';
  }

  showCrashScreen(): void {
    this.crashEl.classList.remove('hidden');
    this.crashEl.innerHTML = `
      <div class="bigface">:(</div>
      <div class="msg">The room has stopped responding.<br />It will be restarted shortly.</div>
      <div class="foot">0x000000EF · WAKE_UP</div>`;
  }

  hideCrashScreen(): void { this.crashEl.classList.add('hidden'); }

  setCursorLocked(locked: boolean): void {
    document.body.classList.toggle('locked', locked);
    document.body.classList.toggle('pointer', !locked);
  }

  showBsodFaceOnly(): void {
    this.bsodEl.innerHTML = '<div class="bsod-inner"><div class="face" style="transform:scale(6);opacity:0.9">:(</div></div>';
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
function escapeAttr(s: string): string { return escapeHtml(s); }
