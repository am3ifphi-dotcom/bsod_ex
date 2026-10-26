/**
 * サムネイルの近傍ストリーミング。
 *
 * - 島に近づいたものだけを、同時 3 本まで読み込む
 * - 一度読み込んだものは残し、遠ざかっても再取得しない（ブラウザキャッシュに任せる）
 * - 画像は WebGL テクスチャにせず HTML の <img> として重ねる（CORS の影響を受けない）
 */

const CONCURRENCY = 3;
const LOAD_RADIUS = 34; // これより近づいたら読み込み開始
const UNLOAD_MS = 5 * 60 * 1000; // 失敗したものは 5 分後に再試行

export class ThumbnailStreamer {
  constructor() {
    this.cache = new Map(); // key -> {status, url, element, at}
    this.queue = [];
    this.active = 0;
    this.listeners = new Set();
    this.stats = { loaded: 0, inflight: 0, failed: 0 };
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    for (const fn of this.listeners) fn(this.stats);
  }

  key(model) {
    return model.id;
  }

  /** キャッシュ済みの <img>（または null） */
  image(model) {
    const entry = this.cache.get(this.key(model));
    return entry?.status === 'loaded' ? entry.element : null;
  }

  status(model) {
    return this.cache.get(this.key(model))?.status || 'idle';
  }

  /**
   * 毎フレーム呼ぶ。島の距離に応じて読み込み要求を出し、
   * 使われなくなった要求はキューから落とす。
   */
  update(entries) {
    const wanted = [];
    for (const entry of entries) {
      if (!entry.model.thumb) continue;
      if (entry.distance > LOAD_RADIUS) continue;
      const key = this.key(entry.model);
      const cached = this.cache.get(key);
      if (cached?.status === 'loaded') continue;
      if (cached?.status === 'failed') {
        if (Date.now() - cached.at < UNLOAD_MS) continue;
      }
      if (cached?.status === 'loading') {
        wanted.push({ key, priority: entry.distance, keep: true });
        continue;
      }
      wanted.push({ key, priority: entry.distance, keep: false, model: entry.model });
    }

    wanted.sort((a, b) => a.priority - b.priority);
    const keys = new Set(wanted.map((w) => w.key));

    // 画面外に流れた待機中の要求を捨てる
    this.queue = this.queue.filter((job) => keys.has(job.key));

    for (const job of wanted) {
      if (job.keep) continue;
      if (this.queue.some((q) => q.key === job.key)) continue;
      this.queue.push(job);
    }

    // 近い順に並べ直す
    this.queue.sort((a, b) => a.priority - b.priority);
    this.pump();
    this.stats.inflight = this.active + this.queue.length;
    this.emit();
  }

  pump() {
    while (this.active < CONCURRENCY && this.queue.length) {
      const job = this.queue.shift();
      this.load(job.model);
    }
  }

  load(model) {
    const key = this.key(model);
    if (!model.thumb) return;
    const entry = { status: 'loading', at: Date.now(), element: null, url: model.thumb };
    this.cache.set(key, entry);
    this.active += 1;

    const img = new Image();
    img.decoding = 'async';
    img.loading = 'eager';
    img.referrerPolicy = 'no-referrer';

    const finish = (ok) => {
      this.active = Math.max(0, this.active - 1);
      if (ok) {
        entry.status = 'loaded';
        entry.element = img;
        this.stats.loaded += 1;
      } else {
        entry.status = 'failed';
        entry.at = Date.now();
        this.stats.failed += 1;
      }
      this.emit();
      this.pump();
    };

    img.onload = () => finish(true);
    img.onerror = () => finish(false);
    img.src = model.thumb;
  }

  dispose() {
    this.queue = [];
    for (const entry of this.cache.values()) {
      if (entry.element) entry.element.src = '';
    }
    this.cache.clear();
    this.listeners.clear();
  }
}
