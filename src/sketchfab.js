/**
 * Sketchfab のモデルを埋め込みビューアで表示する
 * -------------------------------------------------------------
 * ビルド環境（サンドボックス）からは sketchfab.com に接続できないため、
 * この iframe は実行時にユーザーのブラウザから直接読み込まれる。
 *
 * SKETCHFAB       … いま歩いている教室そのもの（CC-BY-4.0 / volvor）。
 *                   作者表示が必須なので、パネルと index.html にクレジットを出す。
 * SKETCHFAB_MOTIF … 最初に依頼された「Old Classroom」。Sketchfab Store の有料（499）かつ
 *                   isDownloadable:false なので配布物には組み込めない。参照用に残す。
 */
export const SKETCHFAB = {
  uid: 'd9fc039ba0b6433db91ec129abe86b52',
  page: 'https://sketchfab.com/3d-models/the-japanese-school-classroom-d9fc039ba0b6433db91ec129abe86b52',
  title: 'The Japanese School Classroom',
  author: 'volvor',
  authorPage: 'https://sketchfab.com/volvor',
  license: 'CC-BY-4.0',
  licensePage: 'http://creativecommons.org/licenses/by/4.0/',
  credit:
    'This work is based on "The Japanese School Classroom" ' +
    '(https://sketchfab.com/3d-models/the-japanese-school-classroom-d9fc039ba0b6433db91ec129abe86b52) ' +
    'by volvor (https://sketchfab.com/volvor) licensed under CC-BY-4.0 ' +
    '(http://creativecommons.org/licenses/by/4.0/)',
};

export const SKETCHFAB_MOTIF = {
  uid: 'be2db5bb488a4392abda0d36c7b46e71',
  page: 'https://sketchfab.com/3d-models/old-classroom-be2db5bb488a4392abda0d36c7b46e71',
  title: 'Old Classroom',
  author: 'RafaelBR873D',
  license: 'Sketchfab Store（Standard）',
};

const params = new URLSearchParams({
  autostart: '1',
  preload: '1',
  ui_theme: 'dark',
  ui_infos: '0',
  ui_watermark: '0',
  ui_watermark_link: '0',
  ui_hint: '0',
  ui_ar: '0',
  ui_help: '0',
  ui_settings: '1',
  ui_fullscreen: '1',
  ui_annotations: '1',
  ui_inspector: '0',
  camera: '0',
  transparent: '0',
});

export const EMBED_URL = `https://sketchfab.com/models/${SKETCHFAB.uid}/embed?${params.toString()}`;

export class SketchfabPanel {
  constructor(ui) {
    this.ui = ui;
    this.loaded = false;
    this.timer = null;
    const frame = ui.el.fabFrame;
    frame.addEventListener('load', () => {
      this.loaded = true;
      clearTimeout(this.timer);
      ui.el.fabLoading.classList.add('hidden');
    });
    frame.addEventListener('error', () => this._fail());
  }

  open() {
    const { el } = this.ui;
    this.ui.overlay('fab', true);
    el.fabLoading.classList.remove('hidden', 'error');
    el.fabLoading.textContent = 'Sketchfab ビューアを読み込んでいます…';
    if (!el.fabFrame.src || el.fabFrame.src === 'about:blank') {
      el.fabFrame.src = EMBED_URL;
    }
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (!this.loaded) this._fail();
    }, 12000);
  }

  _fail() {
    const l = this.ui.el.fabLoading;
    l.classList.remove('hidden');
    l.classList.add('error');
    l.innerHTML =
      'Sketchfab を読み込めませんでした。<br />（この環境から sketchfab.com への接続がブロックされている可能性があります）<br />' +
      `<a href="${SKETCHFAB.page}" target="_blank" rel="noopener noreferrer" style="color:#e9b563">ブラウザで直接ひらく ↗</a>`;
  }

  close() {
    this.ui.overlay('fab', false);
    clearTimeout(this.timer);
    // 裏で回り続けないように unload
    const frame = this.ui.el.fabFrame;
    if (frame.src && frame.src !== 'about:blank') {
      frame.src = 'about:blank';
      this.loaded = false;
    }
  }
}
