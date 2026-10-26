import type { Quality } from '../core/fx';
import type { Assets } from '../core/assets';

export type Settings = {
  sensitivity: number;
  volume: number;
  glitch: number;
  shake: number;
  quality: Quality;
  dynamic: boolean;
};

export type UICallbacks = {
  onStart: () => void;
  onResume: () => void;
  onRestart: () => void;
  onSettings: (s: Settings, changed: keyof Settings) => void;
  onConsoleOpen: () => void;
  onConsoleClose: () => void;
  onConsoleCommand: (cmd: string) => void;
  onResumeOverlay: () => void;
};

const STORAGE_KEY = 'bsod_ex_settings_v1';

export class UI {
  cb: UICallbacks;
  settings: Settings;
  private el: Record<string, HTMLElement> = {};
  private menuOpen = false;
  private consoleOpen = false;
  private composing = false;
  private subtitleTimer = 0;
  private toastTimer = 0;
  private chapterTimer = 0;
  private lastCreditsBuilt = false;
  private fpsHistory: number[] = [];
  private frameTimes: number[] = [];

  constructor(cb: UICallbacks) {
    this.cb = cb;
    const saved = localStorage.getItem(STORAGE_KEY);
    this.settings = {
      sensitivity: 1,
      volume: 0.7,
      glitch: 1,
      shake: 1,
      quality: 'medium',
      dynamic: true,
    };
    if (saved) {
      try {
        Object.assign(this.settings, JSON.parse(saved));
      } catch {}
    }
    this.cacheElements();
    this.bind();
    this.applySettingsToInputs();
  }

  private $(id: string) {
    const e = document.getElementById(id);
    if (!e) throw new Error(`missing DOM element #${id}`);
    return e;
  }

  private cacheElements() {
    for (const id of [
      'title-screen', 'start-btn', 'title-settings-btn', 'load-status', 'hud', 'reticle', 'prompt',
      'prompt-label', 'subtitle', 'toast', 'fps', 'chapter', 'menu', 'resume-btn', 'restart-btn',
      'restart', 'sens', 'vol', 'glitch', 'shake', 'quality', 'dynamic', 'sens-val', 'vol-val',
      'glitch-val', 'shake-val', 'credits-list', 'console', 'console-log', 'console-input',
      'console-ime', 'resume-overlay', 'blackout', 'iris', 'loading-veil',
    ]) {
      const e = document.getElementById(id);
      if (e) this.el[id] = e;
    }
  }

  private save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
  }

  private bind() {
    this.el['start-btn'].addEventListener('click', () => this.cb.onStart());
    this.el['title-settings-btn'].addEventListener('click', () => this.openMenu(true));
    this.el['resume-btn'].addEventListener('click', () => this.cb.onResume());
    this.el['restart-btn'].addEventListener('click', () => {
      this.closeMenu();
      this.cb.onRestart();
    });
    this.el['resume-overlay'].addEventListener('click', () => {
      this.hideResume();
      this.cb.onResumeOverlay();
    });

    for (const tab of Array.from(document.querySelectorAll<HTMLElement>('.tab'))) {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        document.querySelectorAll<HTMLElement>('.tab-body').forEach((p) => p.classList.add('hidden'));
        const body = document.querySelector<HTMLElement>(`.tab-body[data-panel="${tab.dataset.tab}"]`);
        body?.classList.remove('hidden');
        if (tab.dataset.tab === 'credits') this.buildCredits();
      });
    }

    const sens = this.el['sens'] as HTMLInputElement;
    sens.addEventListener('input', () => {
      this.settings.sensitivity = parseFloat(sens.value);
      this.el['sens-val'].textContent = this.settings.sensitivity.toFixed(2);
      this.cb.onSettings(this.settings, 'sensitivity');
      this.save();
    });
    const vol = this.el['vol'] as HTMLInputElement;
    vol.addEventListener('input', () => {
      this.settings.volume = parseInt(vol.value) / 100;
      this.el['vol-val'].textContent = vol.value;
      this.cb.onSettings(this.settings, 'volume');
      this.save();
    });
    const glitch = this.el['glitch'] as HTMLInputElement;
    glitch.addEventListener('input', () => {
      this.settings.glitch = parseInt(glitch.value) / 100;
      this.el['glitch-val'].textContent = glitch.value;
      this.cb.onSettings(this.settings, 'glitch');
      this.save();
    });
    const shake = this.el['shake'] as HTMLInputElement;
    shake.addEventListener('input', () => {
      this.settings.shake = parseInt(shake.value) / 100;
      this.el['shake-val'].textContent = shake.value;
      this.cb.onSettings(this.settings, 'shake');
      this.save();
    });
    const quality = this.el['quality'] as HTMLSelectElement;
    quality.addEventListener('change', () => {
      this.settings.quality = quality.value as Quality;
      this.cb.onSettings(this.settings, 'quality');
      this.save();
    });
    const dynamic = this.el['dynamic'] as HTMLInputElement;
    dynamic.addEventListener('change', () => {
      this.settings.dynamic = dynamic.checked;
      this.cb.onSettings(this.settings, 'dynamic');
      this.save();
    });

    // console: IME + Enter handling
    const input = this.el['console-input'] as HTMLInputElement;
    input.addEventListener('compositionstart', () => {
      this.composing = true;
      this.el['console-ime'].classList.add('on');
    });
    input.addEventListener('compositionend', () => {
      this.composing = false;
      this.el['console-ime'].classList.remove('on');
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.closeConsole();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (this.composing || e.isComposing) return;
        if (e.repeat) return;
        const value = input.value;
        input.value = '';
        this.cb.onConsoleCommand(value);
      }
    });
    // keep game keys from leaking while the console is open
    this.el['console'].addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (k === 'escape' || k === 'enter') return;
      if (['w', 'a', 's', 'd', 'c', 'f'].includes(k)) e.stopPropagation();
    });
  }

  private applySettingsToInputs() {
    (this.el['sens'] as HTMLInputElement).value = String(this.settings.sensitivity);
    this.el['sens-val'].textContent = this.settings.sensitivity.toFixed(2);
    (this.el['vol'] as HTMLInputElement).value = String(Math.round(this.settings.volume * 100));
    this.el['vol-val'].textContent = String(Math.round(this.settings.volume * 100));
    (this.el['glitch'] as HTMLInputElement).value = String(Math.round(this.settings.glitch * 100));
    this.el['glitch-val'].textContent = String(Math.round(this.settings.glitch * 100));
    (this.el['shake'] as HTMLInputElement).value = String(Math.round(this.settings.shake * 100));
    this.el['shake-val'].textContent = String(Math.round(this.settings.shake * 100));
    (this.el['quality'] as HTMLSelectElement).value = this.settings.quality;
    (this.el['dynamic'] as HTMLInputElement).checked = this.settings.dynamic;
  }

  hideLoadingVeil() {
    this.el['loading-veil'].classList.add('done');
  }

  setReticle(visible: boolean) {
    this.el['reticle'].style.display = visible ? '' : 'none';
  }

  setLoading(text: string) {
    const e = this.el['load-status'];
    if (e) e.textContent = text;
  }

  hideTitle() {
    this.el['title-screen'].classList.add('hidden');
    this.el['hud'].classList.remove('hidden');
    this.el['loading-veil'].classList.add('done');
  }

  showTitle() {
    this.el['title-screen'].classList.remove('hidden');
    this.el['hud'].classList.add('hidden');
  }

  setPrompt(text: string | null) {
    const p = this.el['prompt'];
    if (text) {
      if (p.classList.contains('hidden') || this.el['prompt-label'].textContent !== text) {
        p.classList.remove('hidden');
        p.classList.remove('pop');
        void p.offsetWidth;
        p.classList.add('pop');
      }
      this.el['prompt-label'].textContent = text;
      this.el['reticle'].classList.add('active');
    } else {
      p.classList.add('hidden');
      this.el['reticle'].classList.remove('active');
    }
  }

  subtitle(text: string, sys = '', duration = 4.2) {
    const s = this.el['subtitle'];
    s.innerHTML = `${sys ? `<span class="sys">${sys}</span>` : ''}${text}`;
    s.classList.add('show');
    this.subtitleTimer = duration;
  }

  hideChapter() {
    this.el['chapter'].classList.remove('show');
    this.chapterTimer = 0;
  }

  clearSubtitle() {
    this.el['subtitle'].classList.remove('show');
    this.subtitleTimer = 0;
  }

  toast(text: string, duration = 2.2) {
    const t = this.el['toast'];
    t.textContent = text;
    t.classList.add('show');
    this.toastTimer = duration;
  }

  chapter(text: string, duration = 3.5) {
    const c = this.el['chapter'];
    c.textContent = text;
    c.classList.add('show');
    this.chapterTimer = duration;
  }

  update(dt: number) {
    if (this.subtitleTimer > 0) {
      this.subtitleTimer -= dt;
      if (this.subtitleTimer <= 0) this.el['subtitle'].classList.remove('show');
    }
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.el['toast'].classList.remove('show');
    }
    if (this.chapterTimer > 0) {
      this.chapterTimer -= dt;
      if (this.chapterTimer <= 0) this.el['chapter'].classList.remove('show');
    }
  }

  get menuVisible() {
    return this.menuOpen;
  }

  get consoleVisible() {
    return this.consoleOpen;
  }

  openMenu(fromTitle = false) {
    if (this.consoleOpen) return;
    this.menuOpen = true;
    this.el['menu'].classList.remove('hidden');
    if (fromTitle) this.el['title-screen'].classList.add('hidden');
    this.buildCredits();
  }

  closeMenu() {
    this.menuOpen = false;
    this.el['menu'].classList.add('hidden');
    if (!this.el['title-screen'].classList.contains('hidden')) {
      // closing settings from the title returns to the title screen
      this.el['title-screen'].classList.remove('hidden');
    }
  }

  openConsole() {
    if (this.consoleOpen) return;
    this.consoleOpen = true;
    this.el['console'].classList.remove('hidden');
    const input = this.el['console-input'] as HTMLInputElement;
    setTimeout(() => {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }, 30);
    this.cb.onConsoleOpen();
  }

  closeConsole() {
    if (!this.consoleOpen) return;
    this.consoleOpen = false;
    this.el['console'].classList.add('hidden');
    (this.el['console-input'] as HTMLInputElement).blur();
    this.cb.onConsoleClose();
  }

  consoleLog(text: string, cls = '') {
    const log = this.el['console-log'];
    const line = document.createElement('div');
    line.className = `line ${cls}`;
    line.textContent = text;
    log.appendChild(line);
    while (log.children.length > 160) log.removeChild(log.firstChild!);
    log.scrollTop = log.scrollHeight;
  }

  consoleClear() {
    this.el['console-log'].innerHTML = '';
  }

  focusConsole() {
    const input = this.el['console-input'] as HTMLInputElement;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }

  isConsoleFocused() {
    return document.activeElement === this.el['console-input'];
  }

  showResume() {
    this.el['resume-overlay'].classList.remove('hidden');
  }

  hideResume() {
    this.el['resume-overlay'].classList.add('hidden');
  }

  setBlackout(v: number) {
    this.el['blackout'].style.opacity = String(v);
  }

  setIrisDom(v: number) {
    this.el['iris'].style.opacity = String(v);
  }

  updatePerf(stats: Record<string, string | number>) {
    const el = this.el['fps'];
    const lines = Object.entries(stats).map(([k, v]) => `${k.padEnd(14, ' ')}${v}`);
    el.textContent = lines.join('\n');
  }

  togglePerf() {
    this.el['fps'].classList.toggle('hidden');
    return !this.el['fps'].classList.contains('hidden');
  }

  get perfVisible() {
    return !this.el['fps'].classList.contains('hidden');
  }

  private buildCredits() {
    if (this.lastCreditsBuilt) return;
    this.lastCreditsBuilt = true;
    const list = this.el['credits-list'];
    const assets = (window as any).__BSOD_ASSETS__ as Assets | undefined;
    const manifest = assets?.manifest;
    const rows: string[] = [];
    rows.push('<h3>BSOD:EX</h3>');
    rows.push('<p>Design / Programming / Sound synthesis / Level design — BSOD:EX project</p>');
    rows.push('<p class="lic">Built with three.js (MIT), Vite (MIT), TypeScript (Apache-2.0), glTF Transform (MIT), sharp (Apache-2.0).</p>');
    rows.push('<h3>PBR TEXTURES / HDRIS — CC0</h3>');
    rows.push('<p>ambientCG (WoodFloor041, Wood027, Fabric026, Metal035, Metal009, Plastic, Snow003) — CC0</p>');
    rows.push('<p>Poly Haven (rock_05, sandstone_cracks, brown_planks_04, dikhololo_night, large_corridor, apartment, night, city, warehouse, hall, lab, column, pillar, rock, stone) — CC0</p>');
    rows.push('<p class="lic">Mirrored via the CC0 @pmndrs/assets and aframe-enviropacks packages.</p>');
    rows.push('<h3>3D MODELS</h3>');
    rows.push('<p>Sheen Chair — Khronos glTF Sample Assets — CC0</p>');
    rows.push('<p>Lantern — Khronos glTF Sample Assets — CC0</p>');
    rows.push('<p>GlamVelvetSofa — Khronos glTF Sample Assets — CC BY 4.0</p>');
    rows.push('<p>Battle Damaged Sci-fi Helmet — theblueturtle_ / Khronos glTF Sample Assets — CC BY-NC 4.0 <span class="warnline">(non-commercial only)</span></p>');
    rows.push('<h3>SOUND</h3>');
    rows.push('<p>Every sound is procedurally synthesised in this project with the Web Audio API (original, CC0).</p>');
    if (manifest?.models?.length) {
      rows.push('<h3>ASSET MANIFEST</h3>');
      for (const m of manifest.models) rows.push(`<p class="lic">${m.id} — ${m.credit}</p>`);
    }
    rows.push('<h3>LICENCE NOTES</h3>');
    rows.push('<p class="lic">Full licence texts are stored in public/assets/licenses and reproduced in CREDITS.md.</p>');
    list.innerHTML = rows.join('');
  }
}
