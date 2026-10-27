/**
 * ぜんぶ Canvas で描いたテクスチャ。
 * 外部画像は classroom.glb と立ち絵だけ、という構成にしたかった。
 */
import * as THREE from 'three';

const JP_SERIF = '"Hiragino Mincho ProN","Yu Mincho","YuMincho","Noto Serif JP",serif';
const JP_SANS = '"Hiragino Sans","Yu Gothic","YuGothic","Noto Sans JP",sans-serif';
const MONO = 'ui-monospace,"SFMono-Regular",Menlo,Consolas,monospace';

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function toTexture(canvas, { repeat = false, aniso = 4 } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
  }
  t.needsUpdate = true;
  return t;
}

/* ------------------------------------------------------------------ */
/* チョーク                                                           */
/* ------------------------------------------------------------------ */

function grain(canvas, amount = 0.35, size = 2) {
  const ctx = canvas.getContext('2d');
  const { width: w, height: h } = canvas;
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  const n = Math.floor((w * h) / (size * size) / 26);
  for (let i = 0; i < n; i++) {
    ctx.globalAlpha = Math.random() * amount * 0.5;
    ctx.fillStyle = '#000';
    ctx.fillRect(Math.random() * w, Math.random() * h, Math.random() * size + 0.5, Math.random() * size + 0.5);
  }
  ctx.restore();
}

/**
 * 手描き風のチョーク線。数回わずかにずらして重ねる。
 */
function chalkLine(ctx, pts, { w = 7, alpha = 0.85, passes = 3, jitter = 1.6 } = {}) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let p = 0; p < passes; p++) {
    ctx.globalAlpha = alpha / passes + 0.12;
    ctx.lineWidth = w * (0.72 + Math.random() * 0.5);
    ctx.strokeStyle = p === 0 ? '#f6f5ef' : 'rgba(246,245,239,0.85)';
    ctx.beginPath();
    pts.forEach(([x, y], i) => {
      const jx = x + (Math.random() - 0.5) * jitter;
      const jy = y + (Math.random() - 0.5) * jitter;
      if (i === 0) ctx.moveTo(jx, jy);
      else ctx.lineTo(jx, jy);
    });
    ctx.stroke();
  }
  ctx.restore();
}

function chalkCircle(ctx, cx, cy, rx, ry, opts = {}) {
  const pts = [];
  const n = 56;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const wob = 1 + (Math.random() - 0.5) * 0.02;
    pts.push([cx + Math.cos(a) * rx * wob, cy + Math.sin(a) * ry * wob]);
  }
  chalkLine(ctx, pts, opts);
}

/** チョーク文字（一文字ずつ微妙に傾ける） */
function chalkText(ctx, text, x, y, size, { alpha = 0.9, rotate = 0, family = JP_SANS, gap = 0, vert = false } = {}) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#f7f6f0';
  ctx.font = `600 ${size}px ${family}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.translate(x, y);
  ctx.rotate(rotate);
  const chars = [...text];
  let cx = 0;
  let cy = 0;
  for (const ch of chars) {
    const w = ctx.measureText(ch).width + gap;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((Math.random() - 0.5) * 0.05);
    ctx.globalAlpha = alpha * (0.72 + Math.random() * 0.28);
    ctx.fillText(ch, 0, 0);
    ctx.restore();
    if (vert) cy += size * 1.06;
    else cx += w;
  }
  ctx.restore();
}

/** 黒板テクスチャ（板全体に対して透明背景 + チョーク） */
export function chalkTexture(kind = 'contour') {
  const W = 2048;
  const H = 560;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');

  // 板枠
  const frame = () => {
    chalkLine(ctx, [[70, 46], [70, 512], [1930, 512], [1930, 46], [70, 46]], { w: 4, alpha: 0.5, passes: 2 });
  };

  if (kind === 'contour') {
    frame();
    // 丘（等高線）
    const cx = 470;
    const cy = 300;
    for (let i = 0; i < 5; i++) {
      const rx = 96 + i * 52;
      const ry = 58 + i * 30;
      const pts = [];
      for (let k = 0; k <= 60; k++) {
        const a = (k / 60) * Math.PI * 2;
        const wob = 1 + Math.sin(a * 3 + i) * 0.07 + Math.cos(a * 5 + i) * 0.02;
        pts.push([cx + Math.cos(a) * rx * wob, cy + Math.sin(a) * ry * wob]);
      }
      chalkLine(ctx, pts, { w: i === 4 ? 7 : 4.5, alpha: 0.88 });
    }
    chalkText(ctx, '等高線', 120, 120, 38);
    chalkLine(ctx, [[250, 128], [300, 190]], { w: 3, alpha: 0.5, passes: 2 });

    // 崖（ハッチ）
    for (let i = 0; i < 9; i++) {
      const x = 810 + i * 15;
      chalkLine(ctx, [[x, 190 + i * 3], [x - 13, 240 + i * 3]], { w: 4, alpha: 0.7, passes: 2 });
    }
    chalkText(ctx, '崖', 828, 152, 32);

    // 川
    chalkLine(ctx, [[1190, 60], [1150, 150], [1215, 240], [1165, 330], [1235, 430], [1200, 505]], { w: 9, alpha: 0.85 });
    chalkText(ctx, '川', 1250, 210, 34);

    // 田んぼ
    for (let i = 0; i < 4; i++) {
      const y = 96 + i * 26;
      chalkLine(ctx, [[1420, y], [1520, y - 12]], { w: 5, alpha: 0.7, passes: 2 });
      chalkLine(ctx, [[1420, y + 13], [1520, y + 25]], { w: 5, alpha: 0.7, passes: 2 });
    }
    chalkText(ctx, '田んぼ', 1545, 130, 32);

    // 集落
    for (let i = 0; i < 4; i++) {
      const bx = 1420 + (i % 2) * 112;
      const by = 300 + Math.floor(i / 2) * 78;
      chalkLine(ctx, [[bx, by], [bx + 62, by], [bx + 62, by + 46], [bx, by + 46], [bx, by]], { w: 4.5, alpha: 0.65, passes: 2 });
    }
    chalkText(ctx, '集落', 1668, 348, 32);

    chalkText(ctx, '等高線の 向こうに 人がいる', 1010, 470, 42, { alpha: 0.95 });
    chalkText(ctx, '※ 等高線の間隔が狭い＝傾斜が急', 110, 474, 22, { alpha: 0.62 });
    chalkText(ctx, '測量した人間の足跡', 1690, 474, 22, { alpha: 0.62 });
  } else if (kind === 'miso') {
    frame();
    // 糸魚川-静岡構造線
    chalkLine(ctx, [[1030, 52], [960, 150], [1040, 250], [955, 350], [1030, 448], [990, 512]], { w: 9, alpha: 0.95 });
    chalkText(ctx, '糸魚川', 860, 74, 36);
    chalkText(ctx, '静岡', 820, 474, 36);
    chalkText(ctx, '－ 静岡構造線', 1080, 74, 22, { alpha: 0.66 });
    chalkText(ctx, '西', 860, 280, 62, { alpha: 0.95 });
    chalkText(ctx, '東', 1130, 280, 62, { alpha: 0.95 });

    chalkText(ctx, '赤味噌', 720, 348, 40);
    chalkText(ctx, '白味噌', 1180, 348, 40);
    chalkText(ctx, '丸餅', 740, 412, 34);
    chalkText(ctx, '角餅', 1200, 412, 34);

    chalkCircle(ctx, 340, 150, 46, 34, { w: 5, alpha: 0.6, passes: 2 });
    chalkText(ctx, '石', 328, 154, 28);
    chalkCircle(ctx, 1620, 150, 40, 38, { w: 5, alpha: 0.6, passes: 2 });
    chalkText(ctx, '石', 1608, 154, 28);
    chalkText(ctx, '石が違う→土壌→作物→味噌', 150, 250, 27, { alpha: 0.8 });
    chalkText(ctx, '地殻変動が 朝飯を 決めている', 1330, 486, 34, { alpha: 0.92 });
    chalkText(ctx, '今朝の味噌汁は 何億年前の地面が決めた', 150, 486, 24, { alpha: 0.66 });
  } else if (kind === 'terrace') {
    frame();
    const levels = [
      [110, 120, 1800, 120],
      [110, 236, 1500, 236],
      [110, 352, 1140, 352],
      [110, 462, 820, 462],
    ];
    levels.forEach(([x1, y1, x2, y2], i) => {
      chalkLine(ctx, [[x1, y1], [x2, y2]], { w: 8, alpha: 0.92 });
      chalkText(ctx, ['今の地面', '一段古い地面', 'さらに古い地面', 'もっと古い地面'][i], 120, y1 - 34, 30, { alpha: 0.9 });
      if (i < levels.length - 1) {
        chalkLine(ctx, [[x2, y2], [x2 + 80, levels[i + 1][1]]], { w: 6, alpha: 0.55 });
      }
      const ax = 1720 - i * 40;
      chalkLine(ctx, [[ax, y1 + 16], [ax, y1 + 56]], { w: 4, alpha: 0.5, passes: 2 });
      chalkLine(ctx, [[ax - 9, y1 + 46], [ax, y1 + 60], [ax + 9, y1 + 46]], { w: 4, alpha: 0.5, passes: 2 });
    });
    chalkText(ctx, '時間を掘る', 1560, 300, 44, { rotate: -0.08 });
    chalkText(ctx, '河岸段丘', 1300, 76, 40);
    chalkText(ctx, '川が削った跡が段になる', 1360, 112, 22, { alpha: 0.66 });
    chalkText(ctx, '一番上の段が一番古い', 140, 500, 24, { alpha: 0.7 });
  } else if (kind === 'honnshitsu') {
    frame();
    const cx = 1010;
    const cy = 286;
    chalkLine(ctx, [[cx, cy - 178], [cx, cy + 178]], { w: 17, alpha: 0.95 });
    chalkLine(ctx, [[cx - 112, cy - 88], [cx + 112, cy - 88]], { w: 17, alpha: 0.95 });
    chalkCircle(ctx, cx, cy - 8, 224, 196, { w: 4, alpha: 0.32, passes: 2 });

    chalkText(ctx, '本', 1440, 176, 80, { alpha: 0.92 });
    chalkText(ctx, '質', 1440, 320, 80, { alpha: 0.92 });
    chalkText(ctx, '本質に 〈何が〉 はない', 170, 120, 38, { alpha: 0.92 });
    chalkText(ctx, '目的があったら 本質じゃない', 170, 420, 32, { alpha: 0.85 });
    chalkText(ctx, 'あるから、あるだけ', 1690, 452, 26, { alpha: 0.72 });
    chalkText(ctx, '※ 人類共通の記号ではない', 170, 484, 22, { alpha: 0.55 });
    chalkText(ctx, '✝', 1660, 130, 52, { alpha: 0.9 });
  }

  grain(c, 0.45, 2);
  return toTexture(c, { aniso: 8 });
}

/* ------------------------------------------------------------------ */
/* 匿名掲示板ホログラム                                               */
/* ------------------------------------------------------------------ */

export function holoTexture(posts = []) {
  const W = 1100;
  const H = 660;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');

  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, 'rgba(12,30,38,0.92)');
  g.addColorStop(1, 'rgba(8,14,22,0.86)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // 走査線
  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = '#7cf6d8';
  for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 1);
  ctx.restore();

  // 枠
  ctx.strokeStyle = 'rgba(124,246,216,0.55)';
  ctx.lineWidth = 2;
  ctx.strokeRect(12, 12, W - 24, H - 24);

  ctx.fillStyle = '#7cf6d8';
  ctx.font = `500 26px ${MONO}`;
  ctx.fillText('✝本質✝ 匿名掲示板', 40, 62);
  ctx.font = `400 18px ${MONO}`;
  ctx.fillStyle = 'rgba(124,246,216,0.62)';
  ctx.fillText('桐葉高校 / 好きな教師スレッド / 過疎', 40, 92);
  ctx.strokeStyle = 'rgba(124,246,216,0.28)';
  ctx.beginPath();
  ctx.moveTo(40, 110);
  ctx.lineTo(W - 40, 110);
  ctx.stroke();

  let y = 158;
  for (const p of posts) {
    ctx.fillStyle = p.mark ? 'rgba(255,196,120,0.95)' : 'rgba(150,225,245,0.8)';
    ctx.font = `500 20px ${MONO}`;
    ctx.fillText(`${p.no}  ${p.name}`, 40, y);
    y += 32;
    ctx.fillStyle = 'rgba(236,244,246,0.92)';
    ctx.font = `400 22px ${JP_SANS}`;
    const lines = String(p.body).split('\n');
    for (const line of lines) {
      const wrapped = wrap(ctx, line, W - 140);
      for (const w of wrapped) {
        ctx.fillText(w, 58, y);
        y += 32;
      }
    }
    if (p.mark) {
      ctx.fillStyle = 'rgba(255,196,120,0.9)';
      ctx.font = `400 16px ${MONO}`;
      ctx.fillText('▲ 本質判定：✝', 58, y);
      y += 26;
    }
    y += 18;
    if (y > H - 90) break;
  }

  ctx.fillStyle = 'rgba(124,246,216,0.5)';
  ctx.font = `400 16px ${MONO}`;
  ctx.fillText('5人中5人が名無し　/　読み込み 2024.12', 40, H - 40);

  return toTexture(c, { aniso: 8 });
}

function wrap(ctx, text, maxWidth) {
  const out = [];
  let line = '';
  for (const ch of text) {
    if (ctx.measureText(line + ch).width > maxWidth) {
      out.push(line);
      line = ch;
    } else line += ch;
  }
  if (line) out.push(line);
  return out;
}

/* ------------------------------------------------------------------ */
/* 自販機                                                             */
/* ------------------------------------------------------------------ */

export function vendingTexture(state = 'normal') {
  const W = 560;
  const H = 1120;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');

  // 本体
  const body = ctx.createLinearGradient(0, 0, W, 0);
  body.addColorStop(0, '#1b232a');
  body.addColorStop(0.4, '#2a3740');
  body.addColorStop(1, '#151b20');
  ctx.fillStyle = body;
  ctx.fillRect(0, 0, W, H);

  // 上部ヘッダー
  ctx.fillStyle = '#0d1317';
  ctx.fillRect(16, 16, W - 32, 118);
  ctx.fillStyle = '#8ee7ff';
  ctx.font = `600 34px ${JP_SANS}`;
  ctx.fillText('北棟 1F', 36, 66);
  ctx.fillStyle = 'rgba(142,231,255,0.65)';
  ctx.font = `400 17px ${MONO}`;
  ctx.fillText('COLD  /  HOT  /  つめたい', 36, 98);
  ctx.fillStyle = 'rgba(255,120,120,0.9)';
  ctx.font = `400 15px ${MONO}`;
  ctx.fillText('NO CASH  /  交通系のみ', 300, 98);

  // 商品棚 3段 x 6列
  const drinks = [
    ['ミネラル', '#a9d8ff'], ['カフェオレ', '#d8b58a'], ['コーラ', '#7a4a3a'], ['緑茶', '#8fbf82'],
    ['スポーツ', '#8fd0ff'], ['コーンポタージュ', '#ffcf6b'], ['ミルク', '#f0efe6'], ['缶コーヒー', '#6b4a34'],
    ['紅茶', '#c98a5a'], ['炭酸水', '#cfe8f2'], ['コーンスープ', '#ffbf3f'], ['おしるこ', '#b4795c'],
    ['ミネラル', '#a9d8ff'], ['コーン', '#ffcf6b'], ['カフェオレ', '#d8b58a'], ['緑茶', '#8fbf82'],
    ['コーンスープ', '#ffbf3f'], ['コーラ', '#7a4a3a'],
  ];
  const cols = 6;
  const rows = 3;
  const cw = 78;
  const ch = 210;
  const x0 = 34;
  const y0 = 168;
  let idx = 0;
  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      const x = x0 + col * (cw + 8);
      const y = y0 + r * (ch + 10);
      const [label, color] = drinks[idx % drinks.length];
      const isSoup = label.includes('コーン');
      const empty = isSoup && state === 'absent';

      // ボタン棚
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(x, y, cw, ch);
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, cw - 1, ch - 1);

      // 缶
      if (!empty) {
        const g = ctx.createLinearGradient(x, y, x + cw, y);
        g.addColorStop(0, color);
        g.addColorStop(0.45, '#ffffff');
        g.addColorStop(0.55, color);
        g.addColorStop(1, 'rgba(0,0,0,0.5)');
        ctx.save();
        ctx.globalAlpha = state === 'returned' && isSoup ? 1 : 0.85;
        ctx.fillStyle = g;
        ctx.fillRect(x + 16, y + 26, cw - 32, ch - 78);
        ctx.restore();
      } else {
        // 売り切れ
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(x + 16, y + 26, cw - 32, ch - 78);
        ctx.fillStyle = 'rgba(255,80,80,0.85)';
        ctx.font = `600 15px ${MONO}`;
        ctx.fillText('SOLD', x + 18, y + 86);
        ctx.fillText('OUT', x + 34, y + 104);
        ctx.restore();
      }

      // 選択ボタン
      ctx.beginPath();
      ctx.arc(x + cw / 2, y + ch - 26, 13, 0, Math.PI * 2);
      ctx.fillStyle = empty ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.22)';
      ctx.fill();
      ctx.strokeStyle = empty ? 'rgba(255,255,255,0.15)' : 'rgba(160,230,255,0.6)';
      ctx.stroke();

      ctx.fillStyle = empty ? 'rgba(255,255,255,0.28)' : 'rgba(230,240,245,0.75)';
      ctx.font = `400 12px ${JP_SANS}`;
      ctx.fillText(label.slice(0, 7), x + 6, y + ch - 52);
      idx++;
    }
  }

  // コーンスープの不在表示
  if (state === 'absent') {
    ctx.save();
    ctx.translate(W - 96, 520);
    ctx.rotate(-0.08);
    ctx.fillStyle = 'rgba(255,214,120,0.95)';
    ctx.font = `600 22px ${JP_SANS}`;
    ctx.fillText('補充なし', 0, 0);
    ctx.font = `600 40px ${MONO}`;
    ctx.fillText('3ヶ月', -6, 44);
    ctx.fillStyle = 'rgba(255,214,120,0.9)';
    ctx.font = `400 20px ${JP_SANS}`;
    ctx.fillText('✝本質✝', 4, 78);
    ctx.restore();
  } else if (state === 'returned') {
    ctx.save();
    ctx.fillStyle = 'rgba(255,200,90,0.95)';
    ctx.font = `600 24px ${JP_SANS}`;
    ctx.fillText('コーンスープ 入荷', 300, 640);
    ctx.font = `400 18px ${MONO}`;
    ctx.fillText('補充完了', 300, 672);
    ctx.restore();
  }

  // 下部：取り出し口
  ctx.fillStyle = '#0a0e11';
  ctx.fillRect(28, H - 210, W - 56, 150);
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.strokeRect(28.5, H - 209.5, W - 57, 149);
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.font = `400 16px ${MONO}`;
  ctx.fillText('PUSH', 44, H - 120);
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.fillRect(110, H - 160, W - 160, 60);

  return toTexture(c, { aniso: 8 });
}

/* ------------------------------------------------------------------ */
/* 窓の外                                                             */
/* ------------------------------------------------------------------ */

export function outdoorTexture(kind = 'school') {
  const W = 2048;
  const H = 1024;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  const horizon = 470;

  if (kind === 'lava') {
    const sky = ctx.createLinearGradient(0, 0, 0, horizon + 80);
    sky.addColorStop(0, '#3b1420');
    sky.addColorStop(0.45, '#8e2f24');
    sky.addColorStop(0.78, '#e2703a');
    sky.addColorStop(1, '#ffb267');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, horizon + 80);

    // 噴煙
    for (let i = 0; i < 16; i++) {
      const x = 700 + Math.random() * 700;
      const y = 120 + Math.random() * 260;
      const r = 80 + Math.random() * 160;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(60,40,42,0.5)');
      g.addColorStop(1, 'rgba(60,40,42,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // 山（火山）
    ctx.fillStyle = '#241a1e';
    ctx.beginPath();
    ctx.moveTo(0, horizon + 120);
    ctx.lineTo(520, horizon + 120);
    ctx.lineTo(760, 250);
    ctx.lineTo(900, 300);
    ctx.lineTo(1040, 250);
    ctx.lineTo(1320, horizon + 120);
    ctx.lineTo(W, horizon + 120);
    ctx.lineTo(W, horizon + 260);
    ctx.lineTo(0, horizon + 260);
    ctx.closePath();
    ctx.fill();

    // 溶岩の照り返し
    const glow = ctx.createLinearGradient(0, 250, 0, horizon + 120);
    glow.addColorStop(0, 'rgba(255,140,60,0.55)');
    glow.addColorStop(1, 'rgba(255,80,30,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.moveTo(700, 250);
    ctx.lineTo(1040, 250);
    ctx.lineTo(1200, horizon + 120);
    ctx.lineTo(600, horizon + 120);
    ctx.closePath();
    ctx.fill();

    // 溶岩台地
    const ground = ctx.createLinearGradient(0, horizon + 60, 0, H);
    ground.addColorStop(0, '#2b2226');
    ground.addColorStop(1, '#120f11');
    ctx.fillStyle = ground;
    ctx.fillRect(0, horizon + 100, W, H - horizon);

    // 亀裂の発光
    for (let i = 0; i < 40; i++) {
      const x = Math.random() * W;
      const y = horizon + 130 + Math.random() * (H - horizon - 120);
      ctx.strokeStyle = `rgba(255,${100 + Math.random() * 90},40,${0.25 + Math.random() * 0.5})`;
      ctx.lineWidth = 1 + Math.random() * 3.5;
      ctx.beginPath();
      ctx.moveTo(x, y);
      let px = x;
      let py = y;
      for (let k = 0; k < 6; k++) {
        px += (Math.random() - 0.5) * 120;
        py += (Math.random() - 0.2) * 46;
        ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    // 遠景の塊
    for (let i = 0; i < 26; i++) {
      const x = Math.random() * W;
      const y = horizon + 110 + Math.random() * (H - horizon - 100);
      ctx.fillStyle = `rgba(10,9,11,${0.4 + Math.random() * 0.5})`;
      ctx.beginPath();
      ctx.ellipse(x, y, 40 + Math.random() * 140, 18 + Math.random() * 50, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    // 通学路の景色：田んぼ・山・送電線・川（一枚の書き割り）
    const sky = ctx.createLinearGradient(0, 0, 0, horizon + 30);
    sky.addColorStop(0, '#8fb4d6');
    sky.addColorStop(0.42, '#c3d8e6');
    sky.addColorStop(0.82, '#e8e5da');
    sky.addColorStop(1, '#f4ecdd');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, horizon + 40);

    // 雲：横に薄く広がる層
    for (let i = 0; i < 40; i++) {
      const x = Math.random() * W;
      const y = 40 + Math.random() * 300;
      const rx = 90 + Math.random() * 260;
      const ry = 18 + Math.random() * 46;
      const g = ctx.createRadialGradient(x, y, 0, x, y, rx);
      const v = 240 + Math.random() * 15;
      g.addColorStop(0, `rgba(${v},${v},${v - 2},${0.5 + Math.random() * 0.3})`);
      g.addColorStop(0.6, `rgba(${v},${v},${v},0.16)`);
      g.addColorStop(1, `rgba(${v},${v},${v},0)`);
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(1, ry / rx);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, rx, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 遠景の山並み（3層、奥ほど霞む）
    const ridge = (color, baseY, amp, freq, seed) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, horizon + 60);
      for (let x = 0; x <= W; x += 10) {
        const y = baseY - Math.sin(x * freq + seed) * amp - Math.sin(x * freq * 3.3 + seed * 2) * amp * 0.3;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(W, horizon + 60);
      ctx.closePath();
      ctx.fill();
    };
    ridge('rgba(150,172,190,0.72)', horizon - 96, 132, 0.0021, 1.2);
    ridge('rgba(112,140,146,0.82)', horizon - 42, 96, 0.0028, 3.4);
    ridge('rgba(78,104,98,0.9)', horizon - 4, 62, 0.0037, 0.6);

    // 山肌のテクスチャ（細かい点）
    ctx.save();
    ctx.globalAlpha = 0.12;
    for (let i = 0; i < 2400; i++) {
      const x = Math.random() * W;
      const y = horizon - 160 + Math.random() * 200;
      ctx.fillStyle = Math.random() > 0.5 ? '#20302a' : '#dfe8e0';
      ctx.fillRect(x, y, 2, 2);
    }
    ctx.restore();

    // 地平線の霞
    const haze = ctx.createLinearGradient(0, horizon - 90, 0, horizon + 40);
    haze.addColorStop(0, 'rgba(236,238,232,0)');
    haze.addColorStop(0.6, 'rgba(236,238,232,0.42)');
    haze.addColorStop(1, 'rgba(236,238,232,0.1)');
    ctx.fillStyle = haze;
    ctx.fillRect(0, horizon - 90, W, 130);

    // 手前の林（シルエット）
    const treeLine = (baseY, color, amp) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, horizon + 30);
      for (let x = 0; x <= W; x += 6) {
        const y = baseY - Math.sin(x * 0.013) * 6 - Math.sin(x * 0.037 + 1) * 5 - Math.sin(x * 0.09) * 3;
        ctx.lineTo(x, y - amp * (0.4 + Math.random() * 0.6));
      }
      ctx.lineTo(W, horizon + 30);
      ctx.closePath();
      ctx.fill();
    };
    treeLine(horizon - 2, 'rgba(58,80,68,0.95)', 14);

    // 田んぼ
    const field = ctx.createLinearGradient(0, horizon, 0, H);
    field.addColorStop(0, '#c4bd8a');
    field.addColorStop(0.25, '#b3b678');
    field.addColorStop(0.6, '#98a469');
    field.addColorStop(1, '#7b8858');
    ctx.fillStyle = field;
    ctx.fillRect(0, horizon + 6, W, H - horizon);

    // 田んぼの区画（パース）
    const rows = 16;
    for (let i = 0; i < rows; i++) {
      const t0 = Math.pow(i / rows, 1.9);
      const t1 = Math.pow((i + 1) / rows, 1.9);
      const y0 = horizon + 8 + t0 * (H - horizon);
      const y1 = horizon + 8 + t1 * (H - horizon);
      ctx.fillStyle = i % 2 ? 'rgba(150,162,96,0.28)' : 'rgba(186,190,124,0.28)';
      ctx.fillRect(0, y0, W, Math.max(2, y1 - y0));
      ctx.strokeStyle = `rgba(96,102,62,${0.18 + t0 * 0.22})`;
      ctx.lineWidth = 1 + t0 * 2.4;
      ctx.beginPath();
      ctx.moveTo(0, y0);
      ctx.lineTo(W, y0);
      ctx.stroke();
    }
    // 畦（縦）
    ctx.strokeStyle = 'rgba(104,110,68,0.4)';
    for (let i = -10; i <= 10; i++) {
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(W / 2 + i * 22, horizon + 10);
      ctx.lineTo(W / 2 + i * 330, H);
      ctx.stroke();
    }
    // 水を張った田（光の反射）
    for (let i = 0; i < 26; i++) {
      const x = Math.random() * W;
      const y = horizon + 40 + Math.random() * (H - horizon - 40);
      ctx.save();
      ctx.globalAlpha = 0.16 + Math.random() * 0.2;
      ctx.fillStyle = Math.random() > 0.4 ? '#dce6e8' : '#9fb2a2';
      ctx.beginPath();
      ctx.ellipse(x, y, 30 + Math.random() * 90, 4 + Math.random() * 10, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 川
    ctx.fillStyle = 'rgba(158,184,196,0.9)';
    ctx.beginPath();
    ctx.moveTo(210, horizon + 14);
    ctx.quadraticCurveTo(430, horizon + 220, 330, H);
    ctx.lineTo(650, H);
    ctx.quadraticCurveTo(700, horizon + 200, 440, horizon + 14);
    ctx.closePath();
    ctx.fill();
    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.strokeStyle = '#eef4f6';
    for (let i = 0; i < 26; i++) {
      const y = horizon + 40 + Math.random() * (H - horizon);
      ctx.lineWidth = 1 + Math.random() * 2;
      ctx.beginPath();
      ctx.moveTo(300 + Math.random() * 100, y);
      ctx.lineTo(380 + Math.random() * 120, y + 2);
      ctx.stroke();
    }
    ctx.restore();

    // 町並み（小さな家＋屋根）
    for (let i = 0; i < 30; i++) {
      const x = 1080 + Math.random() * 940;
      const w = 26 + Math.random() * 46;
      const h = 18 + Math.random() * 34;
      const y = horizon + 6 + Math.random() * 46;
      ctx.fillStyle = `rgba(${226 + Math.random() * 18},${224 + Math.random() * 18},${212 + Math.random() * 18},0.95)`;
      ctx.fillRect(x, y - h, w, h);
      ctx.fillStyle = 'rgba(112,118,126,0.95)';
      ctx.beginPath();
      ctx.moveTo(x - 4, y - h);
      ctx.lineTo(x + w / 2, y - h - h * 0.45);
      ctx.lineTo(x + w + 4, y - h);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(120,126,120,0.7)';
      ctx.fillRect(x + w * 0.22, y - h * 0.7, w * 0.16, h * 0.3);
    }

    // 送電線（奥の1本は遠く、手前の1本は近く）
    const pole = (x, top, baseY, scale) => {
      ctx.strokeStyle = 'rgba(58,60,64,0.92)';
      ctx.lineWidth = 5 * scale;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, baseY);
      ctx.stroke();
      ctx.lineWidth = 2.6 * scale;
      [[-46, 30], [-22, 12], [22, 12], [46, 30]].forEach(([dx, dy]) => {
        ctx.beginPath();
        ctx.moveTo(x, top + dy);
        ctx.lineTo(x + dx * scale, top + dy - 6);
        ctx.stroke();
      });
    };
    for (let i = 0; i < 6; i++) pole(90 + i * 380, horizon - 268 + i * 6, horizon + 74 + i * 22, 1);
    ctx.strokeStyle = 'rgba(52,54,58,0.8)';
    for (let k = 0; k < 4; k++) {
      for (let i = 0; i < 5; i++) {
        const x1 = 90 + i * 380;
        const x2 = 90 + (i + 1) * 380;
        const y1 = horizon - 268 + i * 6 + 12 + k * 6;
        const y2 = horizon - 268 + (i + 1) * 6 + 12 + k * 6;
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.quadraticCurveTo((x1 + x2) / 2, (y1 + y2) / 2 + 52, x2, y2);
        ctx.stroke();
      }
    }

    // 線路と電車
    const railY = horizon + 250;
    ctx.strokeStyle = 'rgba(78,78,82,0.9)';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(-60, railY + 76);
    ctx.lineTo(W + 60, railY - 34);
    ctx.stroke();
    // 車両（二両編成）
    for (let i = 0; i < 2; i++) {
      const x = 1080 + i * 246;
      const y = railY - 30 + i * 4;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-0.05);
      // 影
      ctx.fillStyle = 'rgba(40,44,40,0.35)';
      ctx.beginPath();
      ctx.ellipse(105, 44, 106, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      // 車体
      ctx.fillStyle = '#eef1ef';
      ctx.beginPath();
      ctx.roundRect(0, 0, 208, 44, 7);
      ctx.fill();
      // 帯
      ctx.fillStyle = 'rgba(56,116,158,0.92)';
      ctx.fillRect(2, 26, 204, 8);
      ctx.fillStyle = 'rgba(56,116,158,0.92)';
      ctx.fillRect(2, 8, 204, 3);
      // 窓
      ctx.fillStyle = 'rgba(64,88,104,0.82)';
      for (let k = 0; k < 7; k++) ctx.fillRect(10 + k * 28, 13, 20, 11);
      // 扉
      ctx.fillStyle = 'rgba(210,216,214,0.9)';
      ctx.fillRect(96, 10, 16, 30);
      // 台車
      ctx.fillStyle = '#3a3f42';
      ctx.fillRect(22, 43, 32, 9);
      ctx.fillRect(154, 43, 32, 9);
      ctx.restore();
    }

    // 手前の草
    ctx.fillStyle = 'rgba(88,102,62,0.9)';
    for (let i = 0; i < 320; i++) {
      const x = Math.random() * W;
      const y = H - Math.random() * 80;
      ctx.fillRect(x, y, 2, 8 + Math.random() * 22);
    }
  }

  return toTexture(c, { aniso: 8 });
}

/* ------------------------------------------------------------------ */
/* 研究ノート（櫻）                                                   */
/* ------------------------------------------------------------------ */

export function notebookTexture() {
  const W = 1024;
  const H = 720;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');

  // 紙
  ctx.fillStyle = '#f3efe6';
  ctx.fillRect(0, 0, W, H);
  const shadowGrad = ctx.createLinearGradient(W / 2 - 30, 0, W / 2 + 30, 0);
  shadowGrad.addColorStop(0, 'rgba(120,110,96,0.05)');
  shadowGrad.addColorStop(0.5, 'rgba(90,82,70,0.26)');
  shadowGrad.addColorStop(1, 'rgba(120,110,96,0.05)');
  ctx.fillStyle = shadowGrad;
  ctx.fillRect(W / 2 - 30, 0, 60, H);

  // 罫線
  ctx.strokeStyle = 'rgba(120,150,180,0.35)';
  ctx.lineWidth = 1;
  for (let y = 60; y < H; y += 34) {
    ctx.beginPath();
    ctx.moveTo(24, y);
    ctx.lineTo(W / 2 - 26, y);
    ctx.moveTo(W / 2 + 26, y);
    ctx.lineTo(W - 24, y);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(200,90,90,0.3)';
  ctx.beginPath();
  ctx.moveTo(W / 2, 0);
  ctx.lineTo(W / 2, H);
  ctx.stroke();

  ctx.fillStyle = 'rgba(52,46,40,0.92)';
  ctx.font = `500 24px ${JP_SANS}`;
  ctx.fillText('恋愛学 研究ノート', 46, 44);
  ctx.font = `400 15px ${MONO}`;
  ctx.fillStyle = 'rgba(90,84,74,0.7)';
  ctx.fillText('SAKURA YUU / SAMPLE: G-07', 46, 68);

  const lines = [
    '第十三法則（暫定）',
    '',
    '恋愛は✝本質✝の一形態である',
    '可能性がある。',
    '',
    'G-07の観察により、意味のない共有',
    '（＝✝本質✝）が結合を生むことが',
    '確認された。',
    '',
    '恋愛もまた、客観的には意味のない',
    '行為（特定の個体への偏った感情的',
    '投資）だが、当事者にとっては',
    '✝本質✝的に有意味である。',
    '',
    'つまり、恋愛とは✝本質✝であり、',
    '✝本質✝とは恋愛である。',
    '',
    '……何を言っているかわからない。',
    'わからないが、',
    'わからないことこそが',
    '✝本質✝であるとすれば、',
    'この理論崩壊自体が',
    '✝本質✝的に正しいことになる。',
    '',
    '助けて。',
  ];
  ctx.font = `400 21px ${JP_SANS}`;
  let y = 108;
  for (const line of lines) {
    ctx.fillStyle = line.includes('✝') ? 'rgba(170,70,90,0.95)' : 'rgba(48,44,38,0.9)';
    ctx.fillText(line, 46, y);
    y += 34;
  }

  // 右ページ：図
  ctx.strokeStyle = 'rgba(60,56,48,0.55)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(W / 2 + 230, 190, 74, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(W / 2 + 230, 190, 34, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = 'rgba(60,56,48,0.7)';
  ctx.font = `400 16px ${MONO}`;
  ctx.fillText('n = 1', W / 2 + 200, 300);
  ctx.fillText('観測＝崩壊', W / 2 + 176, 330);
  ctx.strokeStyle = 'rgba(180,90,70,0.7)';
  for (let i = 0; i < 7; i++) {
    ctx.beginPath();
    ctx.moveTo(W / 2 + 60 + i * 8, 400 + i * 26);
    ctx.lineTo(W - 60, 400 + i * 26);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(170,70,90,0.9)';
  ctx.font = `500 22px ${JP_SANS}`;
  ctx.fillText('✝', W - 120, 620);
  ctx.fillText('✝', W / 2 + 130, 620);

  return toTexture(c, { aniso: 8 });
}

/* ------------------------------------------------------------------ */
/* 小物                                                               */
/* ------------------------------------------------------------------ */

export function nameTagTexture(name, sub, accent) {
  const W = 512;
  const H = 128;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(8,10,13,0.55)';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, 5, H);
  ctx.fillStyle = 'rgba(245,243,238,0.96)';
  ctx.font = `500 44px ${JP_SANS}`;
  ctx.fillText(name, 24, 62);
  ctx.fillStyle = accent;
  ctx.font = `400 18px ${MONO}`;
  ctx.fillText(sub, 26, 100);
  return toTexture(c);
}

export function a4Texture() {
  const W = 420;
  const H = 594;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f7f5ee';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(120,118,110,0.45)';
  ctx.lineWidth = 2;
  for (let y = 80; y < H - 60; y += 46) {
    ctx.beginPath();
    ctx.moveTo(40, y);
    ctx.lineTo(W - 40, y);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(40,38,34,0.9)';
  ctx.font = `600 34px ${JP_SANS}`;
  ctx.fillText('✝ 本質 ✝', 42, 54);
  ctx.font = `400 20px ${JP_SANS}`;
  ctx.fillStyle = 'rgba(52,50,44,0.85)';
  ctx.fillText('本質を追えば追うほど、', 46, 120);
  ctx.fillText('本質は遠くなる。', 46, 152);
  ctx.fillText('正しいことより、', 46, 240);
  ctx.fillText('本当のことの方が大事だ。', 46, 272);
  ctx.fillStyle = 'rgba(160,60,70,0.85)';
  ctx.font = `500 26px ${JP_SANS}`;
  ctx.fillText('✝', W - 70, H - 60);
  return toTexture(c);
}

export function shadowTexture() {
  const S = 256;
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(0,0,0,0.55)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.22)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  return toTexture(c);
}

export function petalTexture() {
  const W = 64;
  const H = 64;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#ffe3ea');
  g.addColorStop(1, '#f6a7bd');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(W / 2, H / 2, 22, 13, 0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.beginPath();
  ctx.ellipse(W / 2 - 5, H / 2 - 4, 9, 5, 0.4, 0, Math.PI * 2);
  ctx.fill();
  return toTexture(c);
}

export function signTexture() {
  const W = 512;
  const H = 256;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0e1a14';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(140,220,180,0.5)';
  ctx.lineWidth = 3;
  ctx.strokeRect(6, 6, W - 12, H - 12);
  ctx.fillStyle = 'rgba(190,245,220,0.95)';
  ctx.font = `600 64px ${JP_SANS}`;
  ctx.fillText('北棟 2F', 34, 92);
  ctx.font = `400 30px ${JP_SANS}`;
  ctx.fillStyle = 'rgba(190,245,220,0.62)';
  ctx.fillText('理数科  B組', 34, 146);
  ctx.font = `400 20px ${MONO}`;
  ctx.fillText('HONNSHITSU  CLASSROOM', 34, 190);
  ctx.fillStyle = 'rgba(255,190,110,0.9)';
  ctx.font = `500 26px ${JP_SANS}`;
  ctx.fillText('✝', W - 90, 200);
  return toTexture(c);
}

export function signTexture2() {
  const W = 512;
  const H = 256;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#141a12';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(200,220,150,0.45)';
  ctx.lineWidth = 3;
  ctx.strokeRect(6, 6, W - 12, H - 12);
  ctx.fillStyle = 'rgba(226,240,190,0.95)';
  ctx.font = `600 58px ${JP_SANS}`;
  ctx.fillText('本質', 32, 96);
  ctx.font = `400 26px ${MONO}`;
  ctx.fillStyle = 'rgba(226,240,190,0.6)';
  ctx.fillText('ESSENCE / 漏出中', 34, 146);
  ctx.fillStyle = 'rgba(255,190,110,0.9)';
  ctx.font = `500 72px ${JP_SANS}`;
  ctx.fillText('✝', W - 140, 180);
  return toTexture(c);
}
