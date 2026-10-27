export class HUD {
  constructor() {
    this.root = document.getElementById('hud');
    this.crosshair = document.getElementById('crosshair');
    this.prompt = document.getElementById('prompt');
    this.subtitle = document.getElementById('subtitle');
    this.hintBar = document.getElementById('hint-bar');
    this.discovery = document.getElementById('discovery');
    this._subTimer = null;
  }

  show() { this.root.classList.remove('hidden'); }
  hide() { this.root.classList.add('hidden'); }

  setHot(on) { this.crosshair.classList.toggle('hot', on); }
  showCrosshair(on) { this.crosshair.style.opacity = on ? '' : '0'; }

  showPrompt(html) {
    if (this._lastPrompt === html) return;
    this._lastPrompt = html;
    this.prompt.innerHTML = html;
    this.prompt.classList.remove('hidden');
  }
  hidePrompt() { this._lastPrompt = null; this.prompt.classList.add('hidden'); }


  say(text, duration = 3.2) {
    this.subtitle.textContent = text;
    this.subtitle.classList.remove('hidden');
    clearTimeout(this._subTimer);
    if (duration > 0) this._subTimer = setTimeout(() => this.subtitle.classList.add('hidden'), duration * 1000);
  }
  clearSubtitle() { clearTimeout(this._subTimer); this.subtitle.classList.add('hidden'); }

  setHint(html) {
    if (!html) { this.hintBar.classList.add('hidden'); return; }
    this.hintBar.innerHTML = html;
    this.hintBar.classList.remove('hidden');
  }

  showDiscovery(text) {
    this.discovery.textContent = text;
    this.discovery.classList.remove('hidden');
    // アニメーション再開始
    this.discovery.style.animation = 'none';
    void this.discovery.offsetWidth;
    this.discovery.style.animation = '';
    setTimeout(() => this.discovery.classList.add('hidden'), 6200);
  }
}
