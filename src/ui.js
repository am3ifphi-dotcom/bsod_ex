/**
 * DOM まわりの UI 制御
 */
const $ = (id) => document.getElementById(id);

export class UI {
  constructor() {
    this.el = {
      hud: $('hud'),
      crosshair: $('crosshair'),
      prompt: $('prompt'),
      promptKey: $('promptKey'),
      promptText: $('promptText'),
      memoryCount: $('memoryCount'),
      memoryTotal: $('memoryTotal'),
      notesCount: $('notesCount'),
      notesTotal: $('notesTotal'),
      chipMemories: $('chipMemories'),
      chipNotes: $('chipNotes'),
      timeLabel: $('timeLabel'),
      minimapWrap: $('minimapWrap'),
      card: $('card'),
      cardTag: $('cardTag'),
      cardTitle: $('cardTitle'),
      cardBody: $('cardBody'),
      cardExtra: $('cardExtra'),
      cardClose: $('cardClose'),
      toast: $('toast'),
      journal: $('journal'),
      journalList: $('journalList'),
      start: $('start'),
      pause: $('pause'),
      ending: $('ending'),
      fab: $('fab'),
      fabFrame: $('fabFrame'),
      fabLoading: $('fabLoading'),
      loading: $('loading'),
      loadBar: $('loadBar'),
      loadText: $('loadText'),
      touch: $('touch'),
      hintbar: $('hintbar'),
    };
    this._toastTimer = null;
    this._cardTimer = null;
    this.cardOpen = false;
    this.el.cardClose.addEventListener('click', () => this.hideCard());
  }

  /* --- 読み込み --- */
  progress(p, text) {
    this.el.loadBar.style.width = `${Math.round(p * 100)}%`;
    if (text) this.el.loadText.textContent = text;
  }
  hideLoading() {
    this.el.loading.classList.add('done');
    setTimeout(() => (this.el.loading.style.display = 'none'), 700);
  }

  /* --- HUD --- */
  showHUD(on) {
    this.el.hud.classList.toggle('hidden', !on);
  }
  crosshair(on) {
    this.el.crosshair.classList.toggle('active', !!on);
  }
  prompt(name, verb = '調べる') {
    this.el.promptText.textContent = `${name} ― ${verb}`;
    this.el.prompt.classList.remove('hidden');
  }
  hidePrompt() {
    this.el.prompt.classList.add('hidden');
  }
  memories(n, total) {
    this.el.memoryCount.textContent = n;
    this.el.memoryTotal.textContent = total;
    this._pulse(this.el.chipMemories);
  }
  notes(n, total) {
    this.el.notesCount.textContent = n;
    this.el.notesTotal.textContent = total;
    this._pulse(this.el.chipNotes);
  }
  time(label) {
    this.el.timeLabel.textContent = label;
  }
  minimap(on) {
    this.el.minimapWrap.style.display = on ? '' : 'none';
  }
  _pulse(node) {
    node.classList.remove('pulse');
    void node.offsetWidth;
    node.classList.add('pulse');
  }

  /* --- カード --- */
  card({ tag, title, body, extra, memory = false, duration = 0 }) {
    this.el.cardTag.textContent = tag;
    this.el.cardTitle.textContent = title;
    this.el.cardBody.textContent = body;
    this.el.cardExtra.textContent = extra || '';
    this.el.card.classList.remove('hidden');
    this.cardOpen = true;
    clearTimeout(this._cardTimer);
    if (memory && duration === 0) duration = 6200;
    if (duration > 0) {
      this._cardTimer = setTimeout(() => this.hideCard(), duration);
    }
  }
  hideCard() {
    this.el.card.classList.add('hidden');
    this.cardOpen = false;
  }

  /* --- トースト --- */
  toast(text, ms = 2600) {
    this.el.toast.textContent = text;
    this.el.toast.classList.remove('hidden');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => this.el.toast.classList.add('hidden'), ms);
  }

  /* --- オーバーレイ --- */
  overlay(name, on) {
    const el = this.el[name];
    if (el) el.classList.toggle('hidden', !on);
  }
  anyOverlayOpen() {
    return ['start', 'pause', 'journal', 'ending', 'fab'].some((k) => !this.el[k].classList.contains('hidden'));
  }

  /* --- ノート --- */
  journal(hotspots, discovered, fragments) {
    const list = this.el.journalList;
    list.innerHTML = '';
    const mk = (idx, title, body, on) => {
      const d = document.createElement('div');
      d.className = 'note' + (on ? '' : ' locked');
      const s = document.createElement('span');
      s.className = 'idx';
      s.textContent = idx;
      const t = document.createElement('div');
      const b = document.createElement('b');
      b.textContent = on ? title : '？？？';
      t.appendChild(b);
      if (on && body) {
        const p = document.createElement('span');
        p.textContent = body;
        t.appendChild(p);
      }
      d.append(s, t);
      return d;
    };
    hotspots.forEach((h, i) => {
      list.appendChild(mk(String(i + 1).padStart(2, '0'), h.title, h.body?.split('\n')[0], discovered.has(h.id)));
    });
    fragments.forEach((f, i) => {
      list.appendChild(mk(`✦${i + 1}`, `記憶のかけら・${f.name}`, f.body?.split('\n')[0], f.collected));
    });
  }

  /* --- 写真モード --- */
  photo(on) {
    document.body.classList.toggle('photo', on);
    let badge = $('photoBadge');
    if (on && !badge) {
      badge = document.createElement('div');
      badge.id = 'photoBadge';
      badge.textContent = '写真モード — Enter で保存 / P で終了';
      document.body.appendChild(badge);
    }
  }

  /* --- タッチ --- */
  setTouch(on) {
    this.el.touch.classList.toggle('hidden', !on);
    this.el.hintbar.style.display = on ? 'none' : '';
  }
}
