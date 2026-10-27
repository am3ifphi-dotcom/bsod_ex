/**
 * DOM 側の UI。
 */
import { CHARACTERS } from './data/characters.js';

const $ = (id) => document.getElementById(id);

export class UI {
  constructor({ scenes, on }) {
    this.scenes = scenes;
    this.on = on;
    this.current = 0;
    this.typing = null;
    this.auto = false;
    this.autoTimer = null;
    this.autoWait = 2400;
    this.uiHidden = false;

    this.el = {
      loading: $('loading'),
      fill: $('loading-fill'),
      pct: $('loading-pct'),
      note: $('loading-note'),
      title: $('title'),
      topbar: $('topbar'),
      toc: $('toc'),
      tocList: $('toc-list'),
      chapter: $('scene-chapter'),
      titleText: $('scene-title'),
      dialogue: $('dialogue'),
      accent: $('dlg-accent'),
      speaker: $('dlg-speaker'),
      role: $('dlg-role'),
      text: $('dlg-text'),
      hint: $('dlg-hint'),
      count: $('dlg-count'),
      next: $('dlg-next'),
      autoBtn: $('dlg-auto'),
      caption: $('caption'),
      card: $('charcard'),
      cardBody: $('cc-body'),
      credits: $('credits'),
      hintbar: $('hintbar'),
      fps: $('fps'),
    };

    this.buildTOC();
    this.bind();
  }

  buildTOC() {
    this.el.tocList.innerHTML = this.scenes
      .map(
        (s, i) => `
      <li>
        <button class="toc-item" data-index="${i}">
          <span class="no">${s.no}</span>
          <span class="ttl">${s.title}</span>
          <span class="ch">${s.chapter}</span>
        </button>
      </li>`
      )
      .join('');
    this.el.tocList.querySelectorAll('.toc-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        const i = Number(btn.dataset.index);
        this.closeTOC();
        this.on.scene(i);
      });
    });
  }

  bind() {
    $('enter').addEventListener('click', () => this.on.enter());
    $('btn-toc').addEventListener('click', () => this.toggleTOC());
    $('toc-close').addEventListener('click', () => this.closeTOC());
    $('btn-free').addEventListener('click', () => this.on.free());
    $('btn-style').addEventListener('click', () => this.on.style());
    $('btn-audio').addEventListener('click', () => this.on.audio());
    $('btn-credits').addEventListener('click', () => this.openCredits());
    $('credits-close').addEventListener('click', () => this.closeCredits());
    this.el.credits.addEventListener('click', (e) => {
      if (e.target.id === 'credits') this.closeCredits();
    });
    document.querySelectorAll('[data-open="credits"]').forEach((b) => b.addEventListener('click', () => this.openCredits()));

    this.el.next.addEventListener('click', (e) => {
      e.stopPropagation();
      this.on.next();
    });
    this.el.autoBtn.addEventListener('click', () => this.toggleAuto());
    $('cc-close').addEventListener('click', () => this.closeCard());

    // ダイアログのクリックでも送る（ボタン以外）
    this.el.dialogue.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      this.on.next();
    });
  }

  /* ----- ローディング ----- */
  progress(ratio, note) {
    const p = Math.round(Math.min(1, ratio) * 100);
    this.el.fill.style.width = `${p}%`;
    this.el.pct.textContent = String(p);
    if (note) this.el.note.textContent = note;
  }

  loaded() {
    this.el.loading.classList.add('done');
  }

  showTitle() {
    this.el.title.classList.remove('hide');
  }

  hideTitle() {
    this.el.title.classList.add('hide');
    this.el.topbar.classList.remove('is-hidden');
    this.el.dialogue.classList.remove('is-hidden');
    this.el.hintbar.classList.remove('is-hidden');
    setTimeout(() => this.el.caption.classList.remove('show'), 3200);
  }

  /* ----- 目次 ----- */
  toggleTOC() {
    const open = this.el.toc.classList.contains('is-hidden');
    if (open) this.el.toc.classList.remove('is-hidden');
    else this.el.toc.classList.add('is-hidden');
    $('btn-toc').classList.toggle('on', open);
  }

  closeTOC() {
    this.el.toc.classList.add('is-hidden');
    $('btn-toc').classList.remove('on');
  }

  /* ----- 場面 ----- */
  setScene(scene, index) {
    this.current = index;
    document.documentElement.style.setProperty('--accent', scene.accent);
    this.el.chapter.textContent = scene.chapter;
    this.el.titleText.textContent = scene.title;
    this.el.accent.style.background = `linear-gradient(to bottom, ${scene.accent}, transparent)`;
    this.el.accent.style.boxShadow = `0 0 22px ${scene.accent}`;
    this.el.tocList.querySelectorAll('.toc-item').forEach((b, i) => b.classList.toggle('active', i === index));

    // キャプション
    this.el.caption.innerHTML = `
      <div class="cap-no">${scene.no} · ${scene.chapter}</div>
      <div class="cap-title">${scene.title}</div>
      <div class="cap-rule"></div>`;
    this.el.caption.classList.add('show');
    clearTimeout(this._capT);
    this._capT = setTimeout(() => this.el.caption.classList.remove('show'), 3400);
  }

  /* ----- 本文 ----- */
  setLine(line, index, total) {
    clearTimeout(this.autoTimer);
    const spk = line.spk === 'narr' ? null : CHARACTERS[line.spk];
    this.el.speaker.textContent = spk ? spk.name : 'ナレーション';
    this.el.speaker.style.color = spk ? spk.accent : 'var(--ink-dim)';
    this.el.role.textContent = spk ? spk.role : '桐葉高校 北棟 理数科B組';
    this.el.count.textContent = `${index + 1} / ${total}`;
    this.el.hint.textContent = this.auto ? '自動送り中' : 'Space / クリックで次へ';
    this.el.autoBtn.classList.toggle('on', this.auto);
    this.typeLine(line.text, () => this.queueAuto());
  }

  typeLine(text, done) {
    clearTimeout(this.typing);
    const el = this.el.text;
    el.textContent = '';
    let i = 0;
    const speed = 26;
    const step = () => {
      if (i >= text.length) {
        this.typing = null;
        if (done) done();
        return;
      }
      // 句読点で少し溜める
      const ch = text[i];
      i += 1;
      el.textContent = text.slice(0, i);
      const pause = /[、。！？…]/.test(ch) ? 110 : ch === '\n' ? 90 : 0;
      this.typing = setTimeout(step, speed + pause);
    };
    step();
  }

  /** 送り。タイプ中なら全文表示して終わり */
  advancePreview() {
    if (this.typing) {
      clearTimeout(this.typing);
      this.typing = null;
      const line = this._line;
      if (line) this.el.text.textContent = line;
      this.queueAuto();
      return false;
    }
    return true;
  }

  isTyping() {
    return !!this.typing;
  }

  queueAuto() {
    clearTimeout(this.autoTimer);
    if (!this.auto) return;
    this.autoTimer = setTimeout(() => this.on.next(), this.autoWait);
  }

  toggleAuto() {
    this.auto = !this.auto;
    this.el.autoBtn.classList.toggle('on', this.auto);
    this.el.hint.textContent = this.auto ? '自動送り中' : 'Space / クリックで次へ';
    if (this.auto) this.queueAuto();
    else clearTimeout(this.autoTimer);
  }

  setStyleLabel(name) {
    $('btn-style').textContent = name;
  }

  setFreeLabel(on) {
    $('btn-free').classList.toggle('on', on);
    $('btn-free').textContent = on ? '演出視点' : '自由視点';
  }

  setAudioLabel(on) {
    $('btn-audio').classList.toggle('on', on);
    $('btn-audio').textContent = on ? '音 ON' : '音 OFF';
  }

  /* ----- 人物カード ----- */
  showCard(def) {
    if (!def) return;
    const stat = (s) => `
      <div class="cc-stat">
        <span>${s.k}</span>
        <i><b style="width:${s.v}%;background:${def.accent};box-shadow:0 0 10px ${def.accent}"></b></i>
        <em>${s.v}</em>
      </div>`;
    this.el.cardBody.innerHTML = `
      <div class="cc-name" style="color:${def.accent}">${def.name}</div>
      <div class="cc-kana">${def.kana}</div>
      <div class="cc-role">${def.role}</div>
      <p class="cc-bio">${def.bio}</p>
      <div class="cc-stats">${def.stats.map(stat).join('')}</div>
      <div class="cc-quote">${def.quote}</div>`;
    this.el.card.classList.remove('is-hidden');
  }

  closeCard() {
    this.el.card.classList.add('is-hidden');
    this.on.unhighlight?.();
  }

  /* ----- モーダル ----- */
  openCredits() {
    this.el.credits.classList.remove('is-hidden');
  }
  closeCredits() {
    this.el.credits.classList.add('is-hidden');
  }

  hideAllUI() {
    this.uiHidden = !this.uiHidden;
    const hide = this.uiHidden;
    this.el.topbar.classList.toggle('is-hidden', hide);
    this.el.dialogue.classList.toggle('is-hidden', hide);
    this.el.hintbar.classList.toggle('is-hidden', hide);
    this.el.toc.classList.add('is-hidden');
  }

  toast(msg) {
    this.el.hint.textContent = msg;
  }

  setFps(v) {
    if (v === null) {
      this.el.fps.classList.add('is-hidden');
      return;
    }
    this.el.fps.classList.remove('is-hidden');
    this.el.fps.textContent = `${v} fps`;
  }
}
