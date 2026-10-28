/** DOM layer: HUD, prompts, narration, menus and the in-game console. */
export class UI {
  constructor(game) {
    this.game = game;
    this.el = {
      hud: document.getElementById('hud'),
      prompt: document.getElementById('prompt'),
      toast: document.getElementById('toast'),
      chapter: document.getElementById('chapter'),
      narration: document.getElementById('narration'),
      keys: document.getElementById('keys'),
      rec: document.getElementById('rec'),
      clock: document.getElementById('clock'),
      crosshair: document.getElementById('crosshair'),
      console: document.getElementById('console'),
      consoleLog: document.getElementById('console-log'),
      consoleInput: document.getElementById('console-input'),
      consoleClose: document.getElementById('console-close'),
      flash: document.getElementById('flash'),
      static: document.getElementById('static'),
      loading: document.getElementById('loading'),
      menu: document.getElementById('menu'),
      settings: document.getElementById('settings'),
      help: document.getElementById('help'),
      pause: document.getElementById('pause'),
      end: document.getElementById('end'),
      loadbar: document.querySelector('#loading .loadbar i'),
      nogl: document.getElementById('nogl'),
    };
    this.promptHTML = '';
    this.consoleOpen = false;
    this.history = [];
    this.historyIdx = -1;
    this.onCommand = null;
    this._bind();
  }

  _bind() {
    const e = this.el;
    e.consoleInput.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        const v = e.consoleInput.value.trim();
        e.consoleInput.value = '';
        if (v) { this.history.push(v); this.historyIdx = this.history.length; }
        this.print(`<span class="cmd">&gt; ${escapeHtml(v)}</span>`, 0);
        this.onCommand?.(v);
        ev.preventDefault();
      } else if (ev.key === 'ArrowUp') {
        ev.preventDefault();
        if (this.historyIdx > 0) { this.historyIdx--; e.consoleInput.value = this.history[this.historyIdx]; }
      } else if (ev.key === 'ArrowDown') {
        ev.preventDefault();
        if (this.historyIdx < this.history.length - 1) { this.historyIdx++; e.consoleInput.value = this.history[this.historyIdx]; }
        else { this.historyIdx = this.history.length; e.consoleInput.value = ''; }
      } else if (ev.key === 'Escape' || (ev.key === 'c' && !e.consoleInput.value)) {
        ev.preventDefault();
        this.closeConsole();
      }
      ev.stopPropagation();
    });
    e.consoleInput.addEventListener('keyup', (ev) => ev.stopPropagation());
    e.consoleInput.addEventListener('keypress', (ev) => ev.stopPropagation());
    e.consoleClose.addEventListener('click', () => this.closeConsole());
  }

  showScreen(name, on = true) {
    const el = this.el[name];
    if (!el) return;
    el.hidden = !on;
    requestAnimationFrame(() => el.classList.toggle('on', on));
    if (!on) setTimeout(() => { if (!el.classList.contains('on')) el.hidden = true; }, 520);
  }

  setLoad(p) { this.el.loadbar.style.width = `${Math.round(p * 100)}%`; }
  hideLoading() { this.el.loading.classList.add('done'); setTimeout(() => this.el.loading.style.display = 'none', 900); }

  hud(on) { this.el.hud.classList.toggle('on', on); }
  keys(on) { this.el.keys.classList.toggle('on', on); }
  rec(on) { this.el.rec.classList.toggle('on', on); }

  prompt(html) {
    if (html === this.promptHTML) return;
    this.promptHTML = html || '';
    if (!html) { this.el.prompt.classList.remove('on'); return; }
    this.el.prompt.innerHTML = html;
    this.el.prompt.classList.add('on');
  }

  setCrosshair(hot) { this.el.crosshair.classList.toggle('hot', hot); }

  toast(text, ms = 2600) {
    const el = this.el.toast;
    clearTimeout(this._toastTimer);
    el.textContent = text;
    el.classList.add('on');
    this._toastTimer = setTimeout(() => el.classList.remove('on'), ms);
  }

  chapter(num, title, sub, ms = 5200) {
    const c = this.el.chapter;
    c.querySelector('.chapter-num').textContent = num;
    c.querySelector('.chapter-title').textContent = title;
    c.querySelector('.chapter-sub').textContent = sub;
    c.classList.add('on');
    clearTimeout(this._chapterTimer);
    this._chapterTimer = setTimeout(() => c.classList.remove('on'), ms);
  }

  narration(html, ms = 5200) {
    const n = this.el.narration;
    clearTimeout(this._narTimer);
    if (!html) { n.classList.remove('on'); return; }
    n.innerHTML = html;
    n.classList.add('on');
    if (ms > 0) this._narTimer = setTimeout(() => n.classList.remove('on'), ms);
  }

  flash(v, ms = 120) {
    const f = this.el.flash;
    f.style.transition = 'none';
    f.style.opacity = String(v);
    requestAnimationFrame(() => {
      f.style.transition = `opacity ${ms}ms ease-out`;
      f.style.opacity = '0';
    });
  }

  setStatic(v) { this.el.static.style.opacity = String(v); }

  clock(totalSeconds) {
    const s = Math.floor(totalSeconds);
    const base = 3 * 3600 + 14 * 60 + 7;
    const t = base + s;
    const hh = String(Math.floor((t / 3600) % 24)).padStart(2, '0');
    const mm = String(Math.floor((t / 60) % 60)).padStart(2, '0');
    const ss = String(t % 60).padStart(2, '0');
    this.el.clock.textContent = `${hh}:${mm}:${ss}`;
  }

  // ------------------------------------------------------------------ console
  openConsole(prefill = '') {
    if (this.consoleOpen) return;
    this.consoleOpen = true;
    this.el.console.classList.add('on');
    this.el.console.setAttribute('aria-hidden', 'false');
    this.el.consoleInput.value = prefill;
    setTimeout(() => this.el.consoleInput.focus(), 60);
    this.game.input.setTyping(true);
    this.game.audio?.play('ui_open', { vol: 0.5 });
  }

  closeConsole() {
    if (!this.consoleOpen) return;
    this.consoleOpen = false;
    this.el.console.classList.remove('on');
    this.el.console.setAttribute('aria-hidden', 'true');
    this.el.consoleInput.blur();
    this.game.input.setTyping(false);
    this.game.input.setEnabled(true);
    this.game.audio?.play('ui_close', { vol: 0.45 });
    this.game.requestLockSoon?.();
  }

  print(html, delay = 40) {
    const el = this.el.consoleLog;
    const div = document.createElement('div');
    div.innerHTML = html;
    if (delay) { div.style.opacity = '0'; div.style.transition = 'opacity .18s'; }
    el.appendChild(div);
    el.scrollTop = el.scrollHeight;
    if (delay) requestAnimationFrame(() => { div.style.opacity = '1'; });
    return div;
  }

  clearConsole() { this.el.consoleLog.innerHTML = ''; }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
