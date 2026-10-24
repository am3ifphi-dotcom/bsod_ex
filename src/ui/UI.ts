import { CREDITS, LICENSE_NOTES } from '../data/credits';

export type Quality = 'low' | 'medium' | 'high' | 'epic';

export type Settings = {
  sensitivity: number;
  master: number;
  ambience: number;
  sfx: number;
  glitch: number;
  shake: number;
  invertY: boolean;
  dynamicRes: boolean;
  quality: Quality;
};

const KEY = 'bsod_ex_settings_v1';

const DEFAULTS: Settings = {
  sensitivity: 1.0, master: 0.85, ambience: 0.9, sfx: 1.0,
  glitch: 1.0, shake: 1.0, invertY: false, dynamicRes: true, quality: 'high',
};

function $(id: string) { return document.getElementById(id)!; }

export class UI {
  settings: Settings;
  onStart?: () => void;
  onResume?: () => void;
  onRestart?: () => void;
  onConsoleSubmit?: (text: string) => void;
  onConsoleOpen?: () => void;
  onConsoleClose?: () => void;
  onSettingsChanged?: (s: Settings, key: keyof Settings) => void;
  reading = false;

  private el = {
    hud: $('hud'), dot: $('dot'), prompt: $('prompt'), promptLabel: $('prompt-label'),
    subtitle: $('subtitle'), areaTitle: $('area-title'), clickHint: $('click-hint'),
    ring: $('crosshair-ring'), fps: $('fps'), chapter: $('chapter'),
    loading: $('loading'), loadBar: $('load-bar'), loadText: $('load-text'),
    start: $('start'), startBtn: $('start-btn'), startQuality: $('start-quality') as HTMLSelectElement,
    menu: $('menu'), resumeBtn: $('resume-btn'), restartBtn: $('restart-btn'),
    credits: $('credits'),
    console: $('console'), consoleLog: $('console-log'), consoleInput: $('console-input') as HTMLInputElement,
    read: $('read'), readTitle: $('read-title'), readBody: $('read-body'),
    debug: $('debug'),
  };

  consoleOpen = false;
  private subtitleTimer = 0;
  private titleTimer = 0;
  private composing = false;

  constructor() {
    this.settings = this.load();
    this.bindMenu();
    this.renderCredits();
    this.el.startQuality.value = this.settings.quality;
    this.el.startBtn.addEventListener('click', () => {
      this.settings.quality = this.el.startQuality.value as Quality;
      this.save();
      this.onStart?.();
    });
    this.el.consoleInput.addEventListener('compositionstart', () => { this.composing = true; });
    this.el.consoleInput.addEventListener('compositionend', () => { this.composing = false; });
    this.el.consoleInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        if (this.composing || e.isComposing) return;
        e.preventDefault();
        const v = this.el.consoleInput.value;
        this.el.consoleInput.value = '';
        this.onConsoleSubmit?.(v);
      }
      e.stopPropagation();
    });
    this.el.consoleInput.addEventListener('input', () => {
      // IME 変換中の Enter を誤爆しないための保険
      if (this.el.consoleInput.value.length > 96) this.el.consoleInput.value = this.el.consoleInput.value.slice(0, 96);
    });
    this.el.read.addEventListener('click', () => this.closeRead());
  }

  /* ---------------- 設定 ---------------- */
  private load(): Settings {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return { ...DEFAULTS };
      return { ...DEFAULTS, ...JSON.parse(raw) };
    } catch { return { ...DEFAULTS }; }
  }
  save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.settings)); } catch { /* noop */ }
  }

  private bindMenu() {
    const bindRange = (id: string, labelId: string, key: keyof Settings, fmt: (v: number) => string) => {
      const input = $(id) as HTMLInputElement;
      const label = $(labelId);
      const apply = () => {
        const v = parseFloat(input.value);
        (this.settings as unknown as Record<string, number>)[key as string] = v;
        label.textContent = fmt(v);
        this.save();
        this.onSettingsChanged?.(this.settings, key);
      };
      input.value = String((this.settings as unknown as Record<string, number>)[key as string]);
      label.textContent = fmt(parseFloat(input.value));
      input.addEventListener('input', apply);
    };
    bindRange('s-sens', 'v-sens', 'sensitivity', (v) => v.toFixed(2));
    bindRange('s-master', 'v-master', 'master', (v) => `${Math.round(v * 100)}`);
    bindRange('s-amb', 'v-amb', 'ambience', (v) => `${Math.round(v * 100)}`);
    bindRange('s-sfx', 'v-sfx', 'sfx', (v) => `${Math.round(v * 100)}`);
    bindRange('s-glitch', 'v-glitch', 'glitch', (v) => `${Math.round(v * 100)}`);
    bindRange('s-bob', 'v-bob', 'shake', (v) => `${Math.round(v * 100)}`);

    const invert = $('s-invert') as HTMLInputElement;
    invert.checked = this.settings.invertY;
    invert.addEventListener('change', () => {
      this.settings.invertY = invert.checked;
      this.save();
      this.onSettingsChanged?.(this.settings, 'invertY');
    });
    const dyn = $('s-dynres') as HTMLInputElement;
    dyn.checked = this.settings.dynamicRes;
    dyn.addEventListener('change', () => {
      this.settings.dynamicRes = dyn.checked;
      this.save();
      this.onSettingsChanged?.(this.settings, 'dynamicRes');
    });
    const q = $('s-quality') as HTMLSelectElement;
    q.value = this.settings.quality;
    q.addEventListener('change', () => {
      this.settings.quality = q.value as Quality;
      this.save();
      this.onSettingsChanged?.(this.settings, 'quality');
    });
    this.el.resumeBtn.addEventListener('click', () => this.onResume?.());
    this.el.restartBtn.addEventListener('click', () => this.onRestart?.());
  }

  private renderCredits() {
    const html: string[] = [];
    html.push('<div class="cc">本作は以下の公開アセットを使用しています (すべて CC0 / CC-BY-4.0 / MIT / 自作)。</div><br/>');
    for (const c of CREDITS) {
      html.push(`<b>${escapeHtml(c.name)}</b><br/>`);
      html.push(`${escapeHtml(c.author)}<br/>`);
      html.push(`<span class="cc">${escapeHtml(c.license)} — ${escapeHtml(c.used)}</span><br/>`);
      if (c.url !== '—') html.push(`<span class="cc">${escapeHtml(c.url)}</span><br/>`);
      html.push('<br/>');
    }
    for (const n of LICENSE_NOTES) html.push(`<span class="cc">※ ${escapeHtml(n)}</span><br/>`);
    this.el.credits.innerHTML = html.join('');
  }

  /* ---------------- 画面 ---------------- */
  setLoading(p: number, text?: string) {
    this.el.loadBar.style.width = `${Math.round(p * 100)}%`;
    if (text) this.el.loadText.textContent = text;
  }
  hideLoading() { this.el.loading.classList.add('hidden'); }
  showStart() { this.el.start.classList.remove('hidden'); }
  hideStart() { this.el.start.classList.add('hidden'); }

  showHud(on: boolean) {
    this.el.hud.classList.toggle('hidden', !on);
    this.el.dot.classList.toggle('hidden-dot', !on);
  }

  setPrompt(text: string | null) {
    if (!text) { this.el.prompt.classList.add('hidden'); this.el.dot.classList.toggle('interactive', false); return; }
    this.el.promptLabel.textContent = text;
    this.el.prompt.classList.remove('hidden');
    this.el.dot.classList.add('interactive');
  }

  setReticle(state: 'default' | 'interactive' | 'clickable' | 'hidden') {
    this.el.dot.classList.toggle('interactive', state === 'interactive' || state === 'clickable');
    this.el.dot.classList.toggle('clickable', state === 'clickable');
    this.el.dot.classList.toggle('hidden-dot', state === 'hidden');
    this.el.clickHint.classList.toggle('hidden', state !== 'clickable');
    this.el.ring.classList.toggle('hidden', state !== 'clickable');
  }

  setSubtitle(text: string | null, duration = 6000, whisper = false) {
    if (!text) { this.el.subtitle.classList.add('hidden'); return; }
    this.el.subtitle.textContent = text;
    this.el.subtitle.classList.toggle('whisper', whisper);
    this.el.subtitle.classList.remove('hidden');
    this.subtitleTimer = duration / 1000;
  }

  setAreaTitle(text: string) {
    this.el.areaTitle.textContent = text;
    this.el.areaTitle.classList.remove('hidden');
    // アニメーションを再生し直す
    this.el.areaTitle.style.animation = 'none';
    void this.el.areaTitle.offsetWidth;
    this.el.areaTitle.style.animation = '';
    this.titleTimer = 5;
  }

  setChapter(text: string) {
    this.el.chapter.textContent = text;
    this.el.chapter.classList.toggle('hidden', !text);
  }

  setFps(on: boolean) { this.el.fps.classList.toggle('hidden', !on); }
  setFpsText(text: string) { this.el.fps.textContent = text; }

  setDebug(on: boolean, text = '') {
    this.el.debug.classList.toggle('hidden', !on);
    if (on) this.el.debug.innerHTML = text;
  }

  tick(dt: number) {
    if (this.subtitleTimer > 0) {
      this.subtitleTimer -= dt;
      if (this.subtitleTimer <= 0) this.el.subtitle.classList.add('hidden');
    }
    if (this.titleTimer > 0) {
      this.titleTimer -= dt;
      if (this.titleTimer <= 0) this.el.areaTitle.classList.add('hidden');
    }
  }

  /* ---------------- メニュー ---------------- */
  openMenu() {
    this.el.menu.classList.remove('hidden');
    this.refreshMenuValues();
  }
  closeMenu() { this.el.menu.classList.add('hidden'); }
  get menuOpen() { return !this.el.menu.classList.contains('hidden'); }
  refreshMenuValues() {
    ($('s-sens') as HTMLInputElement).value = String(this.settings.sensitivity);
    $('v-sens').textContent = this.settings.sensitivity.toFixed(2);
    ($('s-master') as HTMLInputElement).value = String(this.settings.master);
    $('v-master').textContent = `${Math.round(this.settings.master * 100)}`;
    ($('s-amb') as HTMLInputElement).value = String(this.settings.ambience);
    $('v-amb').textContent = `${Math.round(this.settings.ambience * 100)}`;
    ($('s-sfx') as HTMLInputElement).value = String(this.settings.sfx);
    $('v-sfx').textContent = `${Math.round(this.settings.sfx * 100)}`;
    ($('s-glitch') as HTMLInputElement).value = String(this.settings.glitch);
    $('v-glitch').textContent = `${Math.round(this.settings.glitch * 100)}`;
    ($('s-bob') as HTMLInputElement).value = String(this.settings.shake);
    $('v-bob').textContent = `${Math.round(this.settings.shake * 100)}`;
    ($('s-quality') as HTMLSelectElement).value = this.settings.quality;
  }

  /* ---------------- 読み物 ---------------- */
  openRead(title: string, body: string) {
    this.el.readTitle.textContent = title;
    this.el.readBody.textContent = body;
    this.el.read.classList.remove('hidden');
    this.reading = true;
  }
  closeRead() {
    this.el.read.classList.add('hidden');
    this.reading = false;
  }

  /* ---------------- コンソール ---------------- */
  openConsole() {
    this.el.console.classList.remove('hidden');
    this.consoleOpen = true;
    this.el.consoleInput.focus();
    this.el.consoleInput.value = '';
    this.onConsoleOpen?.();
  }
  closeConsole() {
    this.el.console.classList.add('hidden');
    this.consoleOpen = false;
    this.el.consoleInput.blur();
    this.onConsoleClose?.();
  }
  focusConsole() {
    if (this.consoleOpen) this.el.consoleInput.focus();
  }
  printConsole(text: string, cls: 'sys' | 'err' | 'warn' | 'dim' | 'in' | 'out' = 'out') {
    const div = document.createElement('div');
    div.className = cls;
    div.textContent = text;
    this.el.consoleLog.appendChild(div);
    this.el.consoleLog.scrollTop = this.el.consoleLog.scrollHeight;
    while (this.el.consoleLog.childElementCount > 300) this.el.consoleLog.removeChild(this.el.consoleLog.firstChild!);
  }
  clearConsole() { this.el.consoleLog.innerHTML = ''; }
  setConsoleInputEnabled(on: boolean) {
    this.el.consoleInput.disabled = !on;
    if (on) this.el.consoleInput.focus();
  }
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
