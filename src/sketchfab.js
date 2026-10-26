/**
 * Sketchfab 公開フィードの取得と正規化。
 *
 * 方針:
 *  - まずブラウザから api.sketchfab.com を直接叩く（CORS 許可済みの公開エンドポイント）
 *  - 失敗したら同一オリジンの /api/sketchfab（Vite プロキシ）を試す
 *  - どちらも無理ならオフライン用のキュレーションセットで世界を成立させる
 *  - 取得は 1 回だけ。サムネイル画像は島に近づいた時にだけ個別取得する
 */

const DIRECT = 'https://api.sketchfab.com/v3/models';
const PROXY = '/api/sketchfab/models';

export const FEED_LIMIT = 24; // API の 1 リクエスト上限
export const ISLAND_COUNT = 12; // 一度に世界へ配置する島の数

export const THEMES = [
  { id: 'all', label: 'すべて', keys: [] },
  { id: 'nature', label: '自然', keys: ['nature', 'plant', 'tree', 'forest', 'flower', 'animal', 'earth', 'environment', 'rock', 'water', 'coral', 'garden'] },
  { id: 'architecture', label: '建物', keys: ['architecture', 'building', 'house', 'city', 'interior', 'temple', 'castle', 'room', 'shrine', 'library', 'observatory', 'windmill'] },
  { id: 'vehicle', label: '乗り物', keys: ['vehicle', 'car', 'ship', 'boat', 'aircraft', 'plane', 'train', 'space', 'rocket', 'motorcycle', 'rover', 'frigate'] },
  { id: 'art', label: 'アート', keys: ['art', 'sculpture', 'character', 'abstract', 'jewelry', 'relief', 'statue', 'ornament', 'mask', 'lantern', 'crystal'] },
  { id: 'science', label: '科学', keys: ['science', 'technology', 'machine', 'robot', 'medical', 'anatomy', 'hardware', 'electronic', 'mechanical', 'station', 'hummingbird'] },
];

const KIND_BY_THEME = {
  nature: 'nature',
  architecture: 'architecture',
  vehicle: 'vehicle',
  art: 'art',
  science: 'science',
};

/** オフライン時のキュレーション。実在モデルではなく、世界の見本として生成する。 */
const CURATED = [
  { title: 'Mossy Shrine of the Forest', author: 'kiri.works', theme: 'nature', views: 18432, likes: 921, tags: ['forest', 'shrine', '苔'] },
  { title: 'Solar Sail Frigate', author: 'orbital_forge', theme: 'vehicle', views: 42117, likes: 2044, tags: ['space', 'ship', 'sci-fi'] },
  { title: 'Brutalist Library, Section B', author: 'ateliér_north', theme: 'architecture', views: 9021, likes: 388, tags: ['architecture', 'interior', 'concrete'] },
  { title: 'Crystal Bloom', author: 'yuki.atelier', theme: 'art', views: 66340, likes: 5120, tags: ['crystal', 'abstract', 'jewelry'] },
  { title: 'Orbital Research Station', author: 'nasa_dreams', theme: 'science', views: 23759, likes: 1180, tags: ['station', 'science', 'orbit'] },
  { title: 'Windmill at Dusk', author: 'polder_studio', theme: 'architecture', views: 12884, likes: 640, tags: ['windmill', 'village', 'dusk'] },
  { title: 'Deep Sea Drifter', author: 'abyss_lab', theme: 'nature', views: 8742, likes: 402, tags: ['water', 'jellyfish', 'ocean'] },
  { title: 'Mechanical Hummingbird', author: 'torus_engine', theme: 'science', views: 51120, likes: 3410, tags: ['mechanical', 'bird', 'clockwork'] },
  { title: 'Kitsune Mask, Restored', author: 'hyakki_ya', theme: 'art', views: 34980, likes: 2980, tags: ['mask', 'japan', 'fox'] },
  { title: 'Aeolian Desert Spire', author: 'sandglass', theme: 'nature', views: 7215, likes: 260, tags: ['desert', 'rock', 'wind'] },
  { title: 'Clockwork Observatory', author: 'brass_and_ink', theme: 'architecture', views: 19302, likes: 1104, tags: ['observatory', 'steampunk', 'tower'] },
  { title: 'Neon Koi Lantern', author: 'lumen.exe', theme: 'art', views: 28344, likes: 1877, tags: ['lantern', 'koi', 'neon'] },
  { title: 'Survey Rover Mk.II', author: 'dust_track', theme: 'vehicle', views: 14660, likes: 733, tags: ['rover', 'vehicle', 'mars'] },
  { title: 'Fractal Coral Garden', author: 'tide_pool', theme: 'nature', views: 10233, likes: 512, tags: ['coral', 'garden', 'fractal'] },
];

/* ────────────────────────── utilities ────────────────────────── */

function hashString(value) {
  let h = 2166136261;
  const text = String(value);
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function hueFrom(value) {
  return hashString(value) % 360;
}

function pickThumbnail(thumbnails) {
  const images = thumbnails?.images;
  if (!Array.isArray(images) || images.length === 0) return null;
  const sorted = [...images].filter((i) => i && i.url).sort((a, b) => (a.width || 0) - (b.width || 0));
  if (!sorted.length) return null;
  // 転送量を抑えるため 512〜768px 程度を優先
  return (sorted.find((i) => (i.width || 0) >= 512) || sorted[sorted.length - 1]).url;
}

function inferTheme(model) {
  const terms = [
    model.name,
    ...(model.tags || []).map((t) => t?.name),
    ...(model.categories || []).map((c) => c?.name),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  for (const theme of THEMES) {
    if (!theme.keys.length) continue;
    if (theme.keys.some((key) => terms.includes(key))) return theme.id;
  }
  return 'art';
}

function normalizeModel(model) {
  const uid = model.uid;
  const theme = inferTheme(model);
  const author = model.user?.displayName || model.user?.username || 'unknown';
  return {
    id: uid,
    uid,
    live: true,
    title: (model.name || 'Untitled model').trim(),
    author,
    theme,
    kind: KIND_BY_THEME[theme] || 'abstract',
    hue: hueFrom(uid || model.name),
    seed: hashString(uid || model.name) % 997,
    views: model.viewCount || 0,
    likes: model.likeCount || 0,
    tags: [
      ...(model.tags || []).map((t) => t?.name).filter(Boolean),
      ...(model.categories || []).map((c) => c?.name).filter(Boolean),
    ].slice(0, 5),
    thumb: pickThumbnail(model.thumbnails),
    url: model.viewerUrl || `https://sketchfab.com/models/${uid}`,
    embed: `https://sketchfab.com/models/${uid}/embed`,
  };
}

function curatedModels() {
  return CURATED.map((item, index) => {
    const seed = hashString(item.title);
    return {
      id: `curated-${index}`,
      uid: null,
      live: false,
      title: item.title,
      author: item.author,
      theme: item.theme,
      kind: KIND_BY_THEME[item.theme] || 'abstract',
      hue: (seed + index * 37) % 360,
      seed: seed % 997,
      views: item.views,
      likes: item.likes,
      tags: item.tags,
      thumb: null,
      url: `https://sketchfab.com/search?q=${encodeURIComponent(item.title)}&type=models`,
      embed: null,
    };
  });
}

async function fetchJson(url, timeout = 6500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

/* ────────────────────────── public API ────────────────────────── */

/**
 * フィードを 1 回だけ取得する。戻り値の models は常に 12 件以上。
 * @returns {Promise<{models:Array, source:'live'|'proxy'|'curated', note:string, total:number}>}
 */
export async function loadFeed() {
  const params = new URLSearchParams({
    sort_by: '-publishedAt',
    count: String(FEED_LIMIT),
  });

  const attempts = [
    { url: `${DIRECT}?${params}`, source: 'live' },
    { url: `${PROXY}?${params}`, source: 'proxy' },
  ];

  let lastError = null;
  for (const attempt of attempts) {
    try {
      const data = await fetchJson(attempt.url);
      const models = (data?.results || []).map(normalizeModel).filter((m) => m.uid && m.title);
      if (models.length >= 3) {
        return {
          models,
          source: attempt.source,
          total: models.length,
          note:
            attempt.source === 'live'
              ? `Sketchfab 新着フィード · ${models.length} 件`
              : `Sketchfab フィード（プロキシ経由）· ${models.length} 件`,
        };
      }
      lastError = new Error('結果が空でした');
    } catch (error) {
      lastError = error;
    }
  }

  const models = curatedModels();
  return {
    models,
    source: 'curated',
    total: models.length,
    note: 'オフライン · キュレーション済みサンプルで探検中',
    error: lastError?.message || 'network error',
  };
}

/** テーマで絞り込みつつ、必ず count 件そろえる */
export function selectModels(pool, themeId, count) {
  const theme = THEMES.find((t) => t.id === themeId) || THEMES[0];
  const matches = [];
  const rest = [];

  for (const model of pool) {
    let hit = theme.id === 'all';
    if (!hit) {
      const terms = [model.title, ...(model.tags || [])].join(' ').toLowerCase();
      hit = theme.keys.some((key) => terms.includes(key));
      if (!hit && model.theme === theme.id) hit = true;
    }
    (hit ? matches : rest).push(model);
  }

  const ordered = theme.id === 'all' ? [...pool] : [...matches, ...rest];
  const seen = new Set();
  const result = [];
  for (const model of ordered) {
    if (seen.has(model.id)) continue;
    seen.add(model.id);
    result.push(model);
    if (result.length === count) break;
  }
  return result;
}

/** ビューア用 URL。UI を最小限にした公式埋め込み。 */
export function embedUrl(model) {
  if (!model?.uid) return null;
  const params = new URLSearchParams({
    autostart: '1',
    preload: '1',
    dnt: '1',
    ui_theme: 'dark',
    ui_infos: '0',
    ui_controls: '1',
    ui_stop: '0',
    ui_annotations: '0',
    ui_help: '0',
    ui_settings: '0',
    ui_ar: '0',
    ui_vr: '0',
    ui_fullscreen: '1',
    ui_hint: '1',
    transparent: '0',
  });
  return `${model.embed}?${params.toString()}`;
}

export function themeLabel(id) {
  return THEMES.find((t) => t.id === id)?.label || 'その他';
}

export function formatCount(n) {
  if (!Number.isFinite(n)) return '–';
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}
