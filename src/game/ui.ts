// All DOM UI: HUD, pause menu, in-game console, credits, boot screen.
import { settings, Quality } from '../core/settings';
import creditsData from '../../assets/credits.json';
import type { UiSound } from '../core/audio';

export interface UIHandlers {
  onStart: (reduceMotion: boolean) => void;
  onResume: () => void;
  onRestart: () => void;
  onSettingsChanged: () => void;
  onConsoleCommand: (line: string) => void;
  onConsoleOpen: () => void;
  onConsoleClose: () => void;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export class UI {
  handlers!: UIHandlers;
  consoleOpen = false;
  menuOpen = false;
  creditsOpen = false;
  private composing = false;
  private history: string[] = [];
  private historyIdx = -1;
  private perfOn = false;
  private lastUiSound: ((kind: UiSound) => void) | null = null;

  // elements
  private el = {
    hud: $('hud'), reticle: $('reticle'), prompt: $('prompt'), toast: $('toast'),
    hint: $('hint'), perf: $('perf'), cursor: $('softcursor'), clickHint: $('clickHint'),
    boot: $('boot'), startBtn: $<HTMLButtonElement>('startBtn'), bootProgress: $('bootProgress'),
    bootReduce: $<HTMLInputElement>('bootReduce'), bootCredits: $('bootCredits'),
    menu: $('menu'), menuPhase: $('menuPhase'), credits: $('credits'), creditsBody: $('creditsBody'),
    creditsClose: $<HTMLButtonElement>('creditsClose'), creditsBtn: $<HTMLButtonElement>('creditsBtn'),
    resumeBtn: $<HTMLButtonElement>('resumeBtn'), restartBtn: $<HTMLButtonElement>('restartBtn'),
    consoleWrap: $('consoleWrap'), consoleLog: $('consoleLog'), consoleInput: $<HTMLInputElement>('consoleInput'),
    consoleState: $('consoleState'), chapter: $('chapter'), bootLine: $('bootLine'),
    letterbox: $('letterbox'),
  };

  constructor() {
    this.buildCredits();
    this.bindSettings();
    this.bindConsole();
    this.el.startBtn.addEventListener('click', () => {
      if (this.el.startBtn.disabled) return;
      this.playUi('click');
      this.hideBoot();
      this.handlers.onStart(this.el.bootReduce.checked);
    });
    this.el.bootCredits.addEventListener('click', () => this.openCredits());
    this.el.creditsClose.addEventListener('click', () => this.closeCredits());
    this.el.creditsBtn.addEventListener('click', () => this.openCredits());
    this.el.resumeBtn.addEventListener('click', () => { this.playUi('click'); this.handlers.onResume(); });
    this.el.restartBtn.addEventListener('click', () => { this.playUi('click'); this.handlers.onRestart(); });
    for (const b of document.querySelectorAll('button')) {
      b.addEventListener('mouseenter', () => this.playUi('hover'));
    }
  }

  setUiSound(fn: (kind: UiSound) => void) { this.lastUiSound = fn; }
  private playUi(kind: UiSound) { this.lastUiSound?.(kind); }

  // ------------------------------------------------------------- boot
  setBootProgress(frac: number, label: string) {
    this.el.startBtn.textContent = `起動中… ${Math.round(frac * 100)}% ${label}`;
    this.el.bootProgress.textContent = `${Math.round(frac * 100)}%`;
  }
  enableStart() {
    this.el.startBtn.disabled = false;
    this.el.startBtn.textContent = 'クリックして開始';
    this.el.bootProgress.textContent = 'READY';
  }
  showBootError(msg: string) {
    this.el.startBtn.textContent = '読み込み失敗';
    this.el.bootProgress.textContent = msg;
    this.el.bootProgress.style.color = '#ff9a9a';
    this.el.bootProgress.style.fontSize = '12px';
    this.el.bootProgress.style.maxWidth = '60vw';
  }
  hideBoot() {
    this.el.boot.classList.add('hidden');
    this.el.letterbox.classList.add('on');
  }

  // -------------------------------------------------------------- HUD
  showPrompt(text: string | null) {
    if (!text) {
      this.el.prompt.classList.remove('show');
      this.el.reticle.classList.remove('active');
      return;
    }
    const em = this.el.prompt.querySelector('em');
    if (em) em.textContent = text;
    this.el.prompt.classList.add('show');
    this.el.reticle.classList.add('active');
  }
  setReticle(visible: boolean) { this.el.reticle.style.display = visible ? '' : 'none'; }
  toast(text: string, ms = 2600) {
    this.el.toast.textContent = text;
    this.el.toast.classList.add('show');
    window.clearTimeout((this as any)._toastT);
    (this as any)._toastT = window.setTimeout(() => this.el.toast.classList.remove('show'), ms);
  }
  hint(text: string | null) {
    if (!text) { this.el.hint.classList.remove('show'); return; }
    this.el.hint.textContent = text;
    this.el.hint.classList.add('show');
  }
  chapter(kicker: string, title: string, ms = 4600) {
    const ch = this.el.chapter;
    ch.innerHTML = '';
    const k = document.createElement('div');
    k.textContent = kicker;
    const t = document.createElement('span');
    t.textContent = title;
    ch.append(k, t);
    ch.classList.add('show');
    window.clearTimeout((this as any)._chapterT);
    (this as any)._chapterT = window.setTimeout(() => ch.classList.remove('show'), ms);
  }
  setLetterbox(on: boolean) { this.el.letterbox.classList.toggle('on', on); }
  bootLine(text: string | null) {
    if (!text) { this.el.bootLine.classList.add('hidden'); return; }
    this.el.bootLine.textContent = text;
    this.el.bootLine.classList.remove('hidden');
  }

  // ------------------------------------------------------- soft cursor
  setCursor(visible: boolean, x = 0, y = 0) {
    const c = this.el.cursor;
    c.classList.toggle('show', visible);
    c.style.transform = `translate(${x - 3}px, ${y - 2}px)`;
  }
  showClickHint(on: boolean) {
    this.el.clickHint.classList.toggle('hidden', !on);
  }

  // ------------------------------------------------------ perf monitor
  togglePerf(force?: boolean) {
    this.perfOn = force ?? !this.perfOn;
    this.el.perf.classList.toggle('show', this.perfOn);
    return this.perfOn;
  }
  perfVisible() { return this.perfOn; }

  // ------------------------------------------------------------ menus
  openMenu(phaseLabel: string) {
    if (this.menuOpen) return;
    this.menuOpen = true;
    this.el.menuPhase.textContent = phaseLabel;
    this.el.menu.classList.remove('hidden');
    this.syncSettingsUi();
    this.playUi('open');
  }
  closeMenu() {
    if (!this.menuOpen) return;
    this.menuOpen = false;
    this.el.menu.classList.add('hidden');
    this.playUi('close');
  }
  openCredits() {
    this.creditsOpen = true;
    this.el.credits.classList.remove('hidden');
  }
  closeCredits() {
    this.creditsOpen = false;
    this.el.credits.classList.add('hidden');
    this.playUi('close');
  }

  private bindSettings() {
    const s = settings.value;
    const bind = (id: string, out: string, key: keyof typeof s, fmt: (v: any) => string) => {
      const inp = $<HTMLInputElement>(id);
      const o = $(out);
      inp.value = String(s[key]);
      o.textContent = fmt(s[key]);
      inp.addEventListener('input', () => {
        const v = inp.type === 'checkbox' ? inp.checked : Number(inp.value);
        (settings.value as any)[key] = v;
        o.textContent = fmt(v);
        settings.set({ [key]: v } as any);
        this.handlers?.onSettingsChanged?.();
      });
    };
    bind('sSens', 'oSens', 'sensitivity', (v) => Number(v).toFixed(2));
    bind('sVol', 'oVol', 'volume', (v) => `${Math.round(v * 100)}%`);
    bind('sGlitch', 'oGlitch', 'glitch', (v) => `${Math.round(v * 100)}%`);
    bind('sShake', 'oShake', 'shake', (v) => `${Math.round(v * 100)}%`);
    bind('sRes', 'oRes', 'resScale', (v) => Number(v).toFixed(2));

    const q = $<HTMLSelectElement>('sQuality');
    q.value = s.quality;
    q.addEventListener('change', () => {
      settings.set({ quality: q.value as Quality });
      $('oQuality').textContent = '';
      this.handlers?.onSettingsChanged?.();
      this.playUi('click');
    });

    const dyn = $<HTMLInputElement>('sDyn');
    dyn.checked = s.dynamicRes;
    dyn.addEventListener('change', () => {
      settings.set({ dynamicRes: dyn.checked });
      this.handlers?.onSettingsChanged?.();
    });

    this.el.consoleInput.addEventListener('input', () => this.playUi('key'));
  }

  syncSettingsUi() {
    const s = settings.value;
    $<HTMLInputElement>('sSens').value = String(s.sensitivity);
    $('oSens').textContent = s.sensitivity.toFixed(2);
    $<HTMLInputElement>('sVol').value = String(s.volume);
    $('oVol').textContent = `${Math.round(s.volume * 100)}%`;
    $<HTMLInputElement>('sGlitch').value = String(s.glitch);
    $('oGlitch').textContent = `${Math.round(s.glitch * 100)}%`;
    $<HTMLInputElement>('sShake').value = String(s.shake);
    $('oShake').textContent = `${Math.round(s.shake * 100)}%`;
    $<HTMLInputElement>('sRes').value = String(s.resScale);
    $('oRes').textContent = s.resScale.toFixed(2);
    $<HTMLSelectElement>('sQuality').value = s.quality;
    $<HTMLInputElement>('sDyn').checked = s.dynamicRes;
  }

  // ---------------------------------------------------------- console
  private bindConsole() {
    const input = this.el.consoleInput;
    input.addEventListener('compositionstart', () => { this.composing = true; });
    input.addEventListener('compositionend', () => { this.composing = false; });
    input.addEventListener('keydown', (e) => {
      // stop the game's global handlers from seeing console keys
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        this.closeConsole();
        return;
      }
      if (e.key === 'Enter') {
        if (this.composing || e.isComposing) return;   // IME confirm, not submit
        if (e.repeat) return;                          // key repeat must not spam
        e.preventDefault();
        const line = input.value;
        input.value = '';
        if (line.trim().length) this.history.push(line);
        this.historyIdx = this.history.length;
        this.printLine(`> ${line}`, 'echo');
        this.playUi('click');
        this.handlers.onConsoleCommand(line);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (!this.history.length) return;
        this.historyIdx = Math.max(0, this.historyIdx - 1);
        input.value = this.history[this.historyIdx] ?? '';
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.historyIdx = Math.min(this.history.length, this.historyIdx + 1);
        input.value = this.history[this.historyIdx] ?? '';
        return;
      }
    });
    // keyup also isolated
    input.addEventListener('keyup', (e) => e.stopPropagation());
    input.addEventListener('keypress', (e) => e.stopPropagation());
  }

  openConsole() {
    if (this.consoleOpen) return;
    this.consoleOpen = true;
    this.el.consoleWrap.classList.remove('hidden');
    this.el.consoleState.textContent = 'READY';
    if (!this.el.consoleLog.childElementCount) {
      this.printLine('MICROSOFT MEMORY RECOVERY CONSOLE — build 0x0000EA', 'sys');
      this.printLine('この端末はもう存在しません。', 'sys');
      this.printLine('HELP でコマンド一覧。', 'sys');
    }
    setTimeout(() => this.el.consoleInput.focus(), 20);
    this.playUi('open');
    this.handlers.onConsoleOpen();
  }

  closeConsole() {
    if (!this.consoleOpen) return;
    this.consoleOpen = false;
    this.el.consoleWrap.classList.add('hidden');
    this.el.consoleInput.blur();
    this.composing = false;
    this.playUi('close');
    this.handlers.onConsoleClose();
  }

  clearConsole() {
    this.el.consoleLog.innerHTML = '';
  }

  printLine(text: string, kind: 'sys' | 'err' | 'ok' | 'warn' | 'echo' | 'plain' = 'plain') {
    const d = document.createElement('div');
    d.className = kind === 'plain' ? '' : kind;
    d.textContent = text;
    this.el.consoleLog.appendChild(d);
    while (this.el.consoleLog.childElementCount > 220) this.el.consoleLog.firstElementChild?.remove();
    this.el.consoleLog.scrollTop = this.el.consoleLog.scrollHeight;
  }

  setConsoleState(text: string) { this.el.consoleState.textContent = text; }

  // ---------------------------------------------------------- credits
  private buildCredits() {
    const root = this.el.creditsBody;
    root.innerHTML = '';
    const section = (title: string, rows: { name: string; author: string; licence: string; url: string }[]) => {
      const h = document.createElement('h3');
      h.textContent = title;
      root.appendChild(h);
      const table = document.createElement('table');
      for (const r of rows) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${esc(r.name)}</td><td>${esc(r.author)}<br><code>${esc(r.licence)}</code>${
          r.url ? `<br><span style="opacity:.6">${esc(r.url)}</span>` : ''}</td>`;
        table.appendChild(tr);
      }
      root.appendChild(table);
    };
    section('3D models — Khronos glTF Sample Assets', creditsData.models);
    section('Environments / HDRIs', creditsData.environments);
    section('Audio', creditsData.audio);
    section('Textures', creditsData.textures);
    section('Software', creditsData.software);
    const note = document.createElement('h3');
    note.textContent = 'Notes';
    root.appendChild(note);
    for (const n of creditsData.notes) {
      const p = document.createElement('p');
      p.textContent = n;
      p.style.color = '#8fa6c9';
      root.appendChild(p);
    }
  }

  setPerfText(text: string) {
    if (!this.perfOn) return;
    this.el.perf.textContent = text;
  }
}

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}
