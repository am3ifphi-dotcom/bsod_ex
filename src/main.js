import './style.css';
import { World } from './world.js';
import { Explorer } from './controls.js';
import { Minimap } from './minimap.js';
import { Ambient } from './audio.js';
import { ModelViewer } from './viewer.js';
import { ThumbnailStreamer } from './thumbnails.js';
import {
  loadFeed,
  selectModels,
  THEMES,
  ISLAND_COUNT,
  embedUrl,
  themeLabel,
  formatCount,
} from './sketchfab.js';

const $ = (id) => document.getElementById(id);

/* ───────────────────────── state ───────────────────────── */

const state = {
  pool: [],
  source: 'curated',
  themeId: 'all',
  models: [],
  islands: [],
  focus: null,
  dismissed: new Set(),
  opened: new Set(),
  visited: new Set(),
  quality: 'high',
  scale: 1,
  thumbsReady: 0,
  thumbsInflight: 0,
  viewerOpen: false,
  fps: 60,
};

let world;
let explorer;
let minimap;
let ambient;
let viewer;
let streamer;
let billboardLayer;

const pins = [];
let toastTimer = null;
let hintTimer = null;
let frameCount = 0;
let fpsAccum = 0;
let lastPerfPaint = 0;
let cardRetiredFor = -1;
let running = false;

/* ───────────────────────── boot ───────────────────────── */

function bootMessage(text, progress) {
  const msg = $('bootMsg');
  const bar = $('bootBar');
  if (msg && text) msg.textContent = text;
  if (bar && typeof progress === 'number') bar.style.width = `${Math.round(progress * 100)}%`;
}

function toast(text, duration = 3400) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), duration);
}

async function init() {
  bootMessage('フィードを取得しています…', 0.12);

  let feed;
  try {
    feed = await loadFeed();
  } catch (error) {
    feed = { models: [], source: 'curated', note: 'フィードを取得できませんでした', total: 0 };
  }

  state.pool = feed.models;
  state.source = feed.source;
  bootMessage(feed.source === 'curated' ? 'サンプル世界を生成しています…' : '世界を生成しています…', 0.42);

  try {
    world = new World($('scene'));
  } catch (error) {
    bootMessage('このブラウザでは WebGL を利用できません。', 1);
    return;
  }

  streamer = new ThumbnailStreamer();
  streamer.onChange((stats) => {
    state.thumbsReady = stats.loaded;
    state.thumbsInflight = stats.inflight;
    paintPerf();
  });

  world.setQuality(state.quality);
  world.resize();

  minimap = new Minimap($('minimap'));
  minimap.resize();
  ambient = new Ambient();
  viewer = new ModelViewer({
    onOpen: () => {
      state.viewerOpen = true;
      if (explorer) {
        explorer.enabled = false;
        explorer.keys.clear();
        explorer.velocity.set(0, 0, 0);
      }
      paintPerf();
    },
    onClose: () => {
      state.viewerOpen = false;
      if (explorer) explorer.enabled = true;
      paintPerf();
    },
  });

  buildThemeBar();
  bootMessage('島を浮かべています…', 0.66);

  explorer = new Explorer(world, {
    canvas: $('scene'),
    onFocusChange: handleFocusChange,
    onTap: handleTap,
    onKey: handleKey,
    onAutopilotEnd: (entry) => {
      if (entry) unlockIsland(entry);
    },
  });

  setTheme('all', { instant: true, boot: true });

  feedStatus(feed);
  bindUi();
  bindResize();

  bootMessage('準備完了', 1);
  setTimeout(() => {
    $('boot').classList.add('done');
    if (state.source === 'curated') {
      toast('Sketchfab に接続できないため、サンプル世界で起動しました', 5200);
    } else {
      toast('島をクリックすると自動航行します · 3Dモデルは開いた時だけ読み込みます', 5200);
    }
  }, 420);

  // 起動後、最初の島へゆっくり向かう
  const first = world.islands[2] || world.islands[0];
  if (first) {
    setTimeout(() => {
      if (!explorer.focus && !explorer.autopilot) explorer.travelTo(first);
    }, 1600);
  }

  start();

  // 起動直後のカクつきを避けてから、高画質モードのブルームを後乗せする
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1200));
  idle(() => {
    if (state.quality !== 'high') return;
    world.enablePostFx().then((ok) => {
      if (ok) world.setBloomEnabled(true);
    });
  });
}

function feedStatus(feed) {
  const dot = $('feedDot');
  const text = $('feedText');
  dot.classList.remove('live', 'offline');
  if (feed.source === 'live' || feed.source === 'proxy') {
    dot.classList.add('live');
    text.textContent = feed.source === 'live' ? 'LIVE FEED' : 'LIVE · PROXY';
    $('feedChip').title = feed.note;
  } else {
    dot.classList.add('offline');
    text.textContent = 'SAMPLE WORLD';
    $('feedChip').title = `${feed.note}${feed.error ? ` (${feed.error})` : ''}`;
  }
}

/* ───────────────────────── theme ───────────────────────── */

function buildThemeBar() {
  const bar = $('themeBar');
  bar.innerHTML = '';
  THEMES.forEach((theme) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.role = 'tab';
    button.textContent = theme.label;
    button.dataset.theme = theme.id;
    button.setAttribute('aria-selected', String(theme.id === state.themeId));
    button.addEventListener('click', () => setTheme(theme.id));
    bar.appendChild(button);
  });
}

function setTheme(themeId, options = {}) {
  const { instant = false, boot = false } = options;
  state.themeId = themeId;
  state.models = selectModels(state.pool, themeId, ISLAND_COUNT);

  if (!instant) {
    world.setPalette(themeId);
    for (const button of $('themeBar').children) {
      button.setAttribute('aria-selected', String(button.dataset.theme === themeId));
    }
  } else {
    world.setPalette(themeId, true);
  }

  state.islands = world.build(state.models);
  world.visited.clear();
  state.focus = null;
  state.visited.clear();
  state.opened.clear();
  state.dismissed.clear();
  cardRetiredFor = -1;

  buildBillboards();
  updateCounter();
  hideCard();

  if (!boot) {
    world.setFocus(-1);
    explorer.cancelAutopilot(true);
    const nearest = explorer.nextUnvisited();
    if (nearest) explorer.travelTo(nearest);
    toast(`テーマ「${themeLabel(themeId)}」で世界を再構成しました`, 2800);
  }
}

/* ───────────────────────── billboards ───────────────────────── */

function buildBillboards() {
  if (!billboardLayer) {
    billboardLayer = document.createElement('div');
    billboardLayer.id = 'billboards';
    $('app').insertBefore(billboardLayer, $('card'));
  }
  billboardLayer.innerHTML = '';
  pins.length = 0;

  state.islands.forEach((entry) => {
    const model = entry.model;
    const pin = document.createElement('div');
    pin.className = 'pin';
    pin.dataset.index = String(entry.index);

    const stem = document.createElement('div');
    stem.className = 'pin-stem';

    const card = document.createElement('div');
    card.className = 'pin-card';

    const media = document.createElement('div');
    media.className = 'pin-media';
    media.style.setProperty('--hue', String(model.hue));

    const fallback = document.createElement('div');
    fallback.className = 'pin-fallback';
    fallback.textContent = fallbackGlyph(model.kind);
    media.appendChild(fallback);

    const info = document.createElement('div');
    info.className = 'pin-info';

    const title = document.createElement('span');
    title.className = 'pin-title';
    title.textContent = model.title;

    const meta = document.createElement('span');
    meta.className = 'pin-meta';
    meta.textContent = `${themeLabel(model.theme)} · ${formatCount(model.views)}`;

    info.append(title, meta);
    card.append(media, info);
    pin.append(card, stem);

    const focusIsland = (event) => {
      event.stopPropagation();
      explorer.travelTo(entry);
    };
    pin.addEventListener('click', focusIsland);

    billboardLayer.appendChild(pin);
    pins.push({ el: pin, media, fallback, entry, hasImage: false, visible: true });
  });
}

function fallbackGlyph(kind) {
  return { nature: '❧', architecture: '⌂', vehicle: '✈', science: '✷', art: '◈' }[kind] || '◈';
}

/* ───────────────────────── focus / card ───────────────────────── */

function handleFocusChange(entry) {
  state.focus = entry;
  world.setFocus(entry ? entry.index : -1);

  if (entry) {
    state.visited.add(entry.index);
    updateCounter();
    if (cardRetiredFor !== entry.index) showCard(entry);
    if (ambient.enabled) ambient.ping(520 + (entry.model.hue % 240));
  }
  updatePinFocus();
}

function updatePinFocus() {
  for (const pin of pins) {
    pin.el.classList.toggle('focus', state.focus === pin.entry);
  }
  $('reticle').classList.toggle('active', Boolean(state.focus));
}

function showCard(entry) {
  const model = entry.model;
  const card = $('card');
  $('cardTitle').textContent = model.title;
  $('cardAuthor').textContent = model.live ? `by ${model.author}` : `${model.author} · サンプル`;
  const tag = $('cardTag');
  tag.textContent = model.live ? 'LIVE FEED' : 'CURATED';
  tag.classList.toggle('curated', !model.live);
  $('cardTheme').textContent = themeLabel(model.theme);
  $('cardViews').textContent = `${formatCount(model.views)} views`;
  const stateEl = $('cardState');
  const opened = state.opened.has(entry.index);
  stateEl.textContent = opened ? '3D閲覧済み' : '未調査';
  stateEl.classList.toggle('done', opened);
  $('cardLink').href = model.url;
  $('cardOpen').innerHTML = `<span class="btn-ico" aria-hidden="true">◈</span>${
    model.live ? '3Dビューアで開く' : 'サンプルを見る'
  }`;
  card.classList.add('show');
}

function hideCard() {
  $('card').classList.remove('show');
}

function updateCounter() {
  $('discoverNum').textContent = String(state.visited.size);
  $('islandNum').textContent = String(state.islands.length);
}

function unlockIsland(entry) {
  if (!entry) return;
  if (!entry.visited) {
    entry.visited = true;
    state.visited.add(entry.index);
    updateCounter();
    if (ambient.enabled) ambient.ping(660);
  }
  if (cardRetiredFor !== entry.index) showCard(entry);
}

function handleTap(clientX, clientY) {
  const entry = world.getIslandAt(clientX, clientY);
  if (entry) {
    explorer.travelTo(entry);
    cardRetiredFor = -1;
  }
}

/* ───────────────────────── viewer ───────────────────────── */

function openViewer(entry) {
  if (!entry) return;
  const model = { ...entry.model };
  model.embedUrl = embedUrl(model);
  state.opened.add(entry.index);
  state.visited.add(entry.index);
  entry.visited = true;
  world.markVisited(entry.index);
  updateCounter();
  if (state.focus === entry) showCard(entry);
  viewer.open(model);
}

/* ───────────────────────── UI binding ───────────────────────── */

function bindUi() {
  $('cardOpen').addEventListener('click', () => openViewer(state.focus));
  $('cardLink').addEventListener('click', (event) => event.stopPropagation());
  $('cardNext').addEventListener('click', () => {
    const next = explorer.nextUnvisited(state.focus);
    if (next) {
      cardRetiredFor = -1;
      hideCard();
      explorer.travelTo(next);
    }
  });
  $('cardClose').addEventListener('click', () => {
    hideCard();
    cardRetiredFor = state.focus ? state.focus.index : -1;
  });

  $('fpsChip').addEventListener('click', () => {
    const panel = $('perfPanel');
    panel.hidden = !panel.hidden;
    paintPerf(true);
  });

  $('qualityBtn').addEventListener('click', () => {
    state.quality = state.quality === 'high' ? 'low' : 'high';
    world.setQuality(state.quality);
    world.setResolutionScale(state.scale);
    state.scale = 1;
    $('qualityBtn').textContent = state.quality === 'high' ? '画質 高' : '画質 軽量';
    toast(state.quality === 'high' ? '高画質モード（解像度・星・霧を強化）' : '軽量モード（描画負荷を削減）', 2400);
  });
  $('qualityBtn').textContent = state.quality === 'high' ? '画質 高' : '画質 軽量';

  $('soundBtn').addEventListener('click', () => {
    const on = ambient.toggle();
    $('soundBtn').setAttribute('aria-pressed', String(on));
    toast(on ? '環境音をオン（ヘッドホン推奨）' : '環境音をオフ', 1800);
  });

  const help = $('help');
  const openHelp = () => help.classList.add('show');
  const closeHelp = () => help.classList.remove('show');
  $('helpBtn').addEventListener('click', openHelp);
  $('helpClose').addEventListener('click', closeHelp);
  help.addEventListener('click', (event) => {
    if (event.target === help) closeHelp();
  });

  if (window.matchMedia('(pointer: coarse)').matches) {
    $('joystick').classList.add('show');
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) explorer.keys.clear();
  });

  hintTimer = setTimeout(() => $('hint').classList.add('fade'), 14000);
}

function handleKey(event) {
  if (event.code === 'Escape') {
    if (viewer.isOpen) {
      viewer.close();
      return;
    }
    if ($('help').classList.contains('show')) {
      $('help').classList.remove('show');
      return;
    }
    hideCard();
    cardRetiredFor = state.focus ? state.focus.index : -1;
    return;
  }

  if (viewer.isOpen) return;

  if (event.code === 'KeyE') {
    if (state.focus) openViewer(state.focus);
    else {
      const entry = explorer.nextUnvisited();
      if (entry) explorer.travelTo(entry);
    }
  }

  if (event.code === 'KeyH' || event.code === 'Slash') {
    $('help').classList.toggle('show');
  }

  if (event.code === 'KeyM') {
    const on = ambient.toggle();
    $('soundBtn').setAttribute('aria-pressed', String(on));
  }

  if (event.code === 'KeyF') {
    $('fpsChip').click();
  }

  if (event.code === 'KeyR') {
    explorer.position.set(0, 11, 46);
    explorer.yaw = Math.PI;
    explorer.pitch = -0.06;
    explorer.velocity.set(0, 0, 0);
    toast('スタート地点に戻りました', 1800);
  }
}

/* ───────────────────────── resize ───────────────────────── */

function bindResize() {
  window.addEventListener('resize', () => {
    world.resize();
    minimap.resize();
  });
  window.addEventListener('orientationchange', () => {
    setTimeout(() => {
      world.resize();
      minimap.resize();
    }, 220);
  });
}

/* ───────────────────────── HUD ───────────────────────── */

function paintPerf(force = false) {
  const now = performance.now();
  if (!force && now - lastPerfPaint < 320) {
    $('fpsChip').textContent = `${Math.round(state.fps)} fps`;
    return;
  }
  lastPerfPaint = now;

  $('fpsChip').textContent = `${Math.round(state.fps)} fps`;
  $('perfThumbs').textContent = String(state.thumbsReady);
  $('perfInflight').textContent = String(state.thumbsInflight);
  $('perfViewer').textContent = state.viewerOpen ? '1' : '0';
  $('perfRatio').textContent = state.scale.toFixed(2);

  if (!world) return;
  const info = world.renderer.info;
  $('perfTris').textContent = formatCount(info.render.triangles);
  $('perfCalls').textContent = String(info.render.calls);
}

/* ───────────────────────── main loop ───────────────────────── */

function updatePins() {
  const width = window.innerWidth;
  const height = window.innerHeight;

  for (const pin of pins) {
    const projection = world.project(pin.entry, width, height);
    pin.entry.distance = projection.distance;
    const d = projection.distance;

    if (!projection.visible || d > 60 || state.viewerOpen) {
      if (pin.visible) {
        pin.el.classList.add('hidden');
        pin.visible = false;
      }
      continue;
    }

    if (!pin.visible) {
      pin.el.classList.remove('hidden');
      pin.visible = true;
    }

    const scale = d < 14 ? 1.1 : d < 26 ? 1 : d < 40 ? 0.82 : 0.64;
    const opacity = d < 42 ? 1 : Math.max(0, 1 - (d - 42) / 16);
    pin.el.style.transform = `translate3d(${projection.x.toFixed(1)}px, ${projection.y.toFixed(1)}px, 0) translate(-50%, -100%) scale(${scale.toFixed(2)})`;
    pin.el.style.opacity = opacity.toFixed(2);
    pin.el.classList.toggle('near', d < 26);
    pin.el.classList.toggle('focus', state.focus === pin.entry);
    pin.el.classList.toggle('visited', state.visited.has(pin.entry.index));

    // 画像が届いていたら差し込む
    if (!pin.hasImage) {
      const img = streamer.image(pin.entry.model);
      if (img) {
        img.alt = pin.entry.model.title;
        img.className = 'pin-img';
        pin.media.appendChild(img);
        pin.media.classList.add('loaded');
        pin.hasImage = true;
      } else if (streamer.status(pin.entry.model) === 'failed') {
        pin.fallback.classList.add('failed');
      }
    }
  }
}

function start() {
  running = true;
  let last = performance.now();
  let streamAccum = 0;

  const loop = (now) => {
    requestAnimationFrame(loop);
    if (!running) return;

    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    if (document.hidden) return;

    // fps
    frameCount += 1;
    fpsAccum += dt;
    if (fpsAccum >= 0.5) {
      state.fps = frameCount / fpsAccum;
      frameCount = 0;
      fpsAccum = 0;
      adaptQuality();
      paintPerf();
    }

    explorer.update(dt);
    world.update(dt, explorer.position);
    updatePins();

    minimap.draw(
      world.islands,
      explorer.position,
      explorer.yaw,
      world.focusIndex,
      world.visited,
      dt,
      world.skyUniforms.uGlow.value.getStyle()
    );

    world.render();

    // 近傍のサムネイルだけを間引いて要求
    streamAccum += dt;
    if (streamAccum > 0.34) {
      streamAccum = 0;
      streamer.update(
        world.islands.map((entry) => ({ model: entry.model, distance: entry.distance }))
      );
    }
  };

  requestAnimationFrame(loop);

  const camPosEl = $('camPos');
  setInterval(() => {
    if (!explorer) return;
    camPosEl.textContent = `${explorer.position.x.toFixed(1)} , ${explorer.position.z.toFixed(1)}`;
  }, 500);
}

function adaptQuality() {
  // 重いとき: 解像度 → ブルーム の順に落とす
  if (state.fps < 42 && state.scale > 0.66) {
    state.scale = Math.max(0.66, state.scale - 0.08);
    world.setResolutionScale(state.scale);
  } else if (state.fps < 34 && state.quality === 'high') {
    world.setBloomEnabled(false);
  } else if (state.fps > 56 && state.quality === 'high') {
    if (state.scale < 1) {
      state.scale = Math.min(1, state.scale + 0.04);
      world.setResolutionScale(state.scale);
    }
    world.setBloomEnabled(true);
  }
}

/* ───────────────────────── go ───────────────────────── */

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
