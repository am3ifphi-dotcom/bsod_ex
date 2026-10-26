/**
 * Sketchfab の公式 3D 埋め込みビューアを「1 体だけ」マウントする管理役。
 * 開いていないときは iframe 自体が存在しないので、モデルの転送量はゼロ。
 */
export class ModelViewer {
  constructor({ onOpen, onClose } = {}) {
    this.root = document.getElementById('viewer');
    this.frame = document.getElementById('viewerFrame');
    this.titleEl = document.getElementById('viewerTitle');
    this.subEl = document.getElementById('viewerSub');
    this.linkEl = document.getElementById('viewerLink');
    this.closeBtn = document.getElementById('viewerClose');
    this.onOpen = onOpen || (() => {});
    this.onClose = onClose || (() => {});
    this.model = null;
    this.loading = null;

    this.closeBtn.addEventListener('click', () => this.close());
    this.root.addEventListener('pointerdown', (event) => {
      if (event.target === this.root) this.close();
    });
  }

  get isOpen() {
    return this.root.classList.contains('show');
  }

  open(model) {
    if (!model) return;
    this.close(true);

    this.model = model;
    this.titleEl.textContent = model.title;
    this.linkEl.href = model.url;
    this.subEl.textContent = model.uid ? 'SKETCHFAB 3D VIEWER · オンデマンド読込' : 'CURATED ISLAND · サンプル';

    this.frame.innerHTML = '';

    if (model.uid) {
      const loading = document.createElement('div');
      loading.className = 'viewer-loading';
      loading.innerHTML = '<div class="spinner"></div><span>モデルを読み込んでいます…</span>';
      this.frame.appendChild(loading);
      this.loading = loading;

      const iframe = document.createElement('iframe');
      iframe.title = model.title;
      iframe.setAttribute('loading', 'lazy');
      iframe.setAttribute('allow', 'autoplay; fullscreen; xr-spatial-tracking');
      iframe.setAttribute('allowfullscreen', 'true');
      iframe.src = model.embedUrl;
      iframe.addEventListener('load', () => this._finishLoading());
      this.frame.appendChild(iframe);

      // 埋め込み側の読み込み完了通知が来ない場合の保険
      this.loadTimer = setTimeout(() => this._finishLoading(), 9000);
    } else {
      const panel = document.createElement('div');
      panel.style.cssText =
        'position:absolute;inset:0;display:grid;place-content:center;gap:14px;text-align:center;padding:32px;';
      panel.innerHTML = `
        <p style="margin:0;font-size:13px;letter-spacing:.14em;color:#8fa8c8">この島はサンプルデータです</p>
        <p style="margin:0;font-size:11.5px;line-height:1.9;color:rgba(197,215,241,.55);max-width:34ch">
          Sketchfab に接続できない環境で表示しているため、3D モデルの埋め込みはありません。<br>
          接続できる環境では、島のモデルがそのまま読み込まれます。
        </p>
        <a class="btn" style="justify-self:center" href="${model.url}" target="_blank" rel="noopener noreferrer">
          Sketchfab で探す ↗
        </a>`;
      this.frame.appendChild(panel);
    }

    this.root.classList.add('show');
    document.body.classList.add('viewer-open');
    this.onOpen(model);
  }

  _finishLoading() {
    clearTimeout(this.loadTimer);
    if (this.loading) {
      this.loading.style.transition = 'opacity .4s';
      this.loading.style.opacity = '0';
      const node = this.loading;
      setTimeout(() => node.remove(), 420);
      this.loading = null;
    }
  }

  close(silent = false) {
    if (!this.root.classList.contains('show') && !this.frame.firstChild) return;
    clearTimeout(this.loadTimer);
    // iframe を破棄して WebGL コンテキストとメモリを解放
    this.frame.innerHTML = '';
    this.loading = null;
    this.root.classList.remove('show');
    document.body.classList.remove('viewer-open');
    const closed = this.model;
    this.model = null;
    if (!silent && closed) this.onClose(closed);
  }
}
