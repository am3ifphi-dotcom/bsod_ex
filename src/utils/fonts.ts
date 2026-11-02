/**
 * Runtime Japanese webfont bootstrap.
 *
 * In-world copy is rasterised straight onto canvas textures at boot, so the glyphs must be
 * available *before* the first bake. `public/fonts/jp.css` declares unicode-range subsets of a
 * self-hosted Noto Sans JP (see scripts/build-jp-font.mjs); calling `document.fonts.load` with the
 * project's own strings makes the browser fetch exactly the subsets that copy needs.
 */

export const JP_FAMILY = '"Noto Sans JP"';

/** Every canvas-baked string that must be glyph-complete before the world is built. */
const SAMPLE_TEXT = [
  '問題が発生したため、PC を再起動する必要があります。',
  'エラー情報を収集しています。自動的に再起動します。',
  '視覚野のダイレクトダンプを開始しました。瞬きを停止してください。',
  '脊髄運動路をアンマウントしました。離席要求は拒否されました。',
  '画面ハ自己ヲ観測シ続ケル。注視ハ解除サレナイ。',
  'カーネルコンソールを開き、緊急割り込み命令を実行せよ。',
  '意識が完全にダンプ固定される前に強制割り込みをかけろ。',
  '被験者の視線は、まだ画面の外に出ていません。',
  '背後の椅子は、あなたより先に回転していました。',
  '診断ターミナル // 停止コード // 深度スライス // 同期',
  'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん',
  'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン',
  '停止コード詳細視覚野転送生体記録網膜座標深度感知椅子背後質量未登録観測者注視解除応答待機完了瞬き検出運動権委譲済破棄不可能',
].join('');

let pending: Promise<void> | null = null;

/**
 * Resolves once the Japanese face is usable by canvas. Never rejects: a missing font must not
 * block the experience, it just degrades to the system stack.
 */
export function loadJapaneseFont(): Promise<void> {
  if (pending) return pending;
  pending = (async () => {
    const fonts = (globalThis as { document?: Document }).document?.fonts;
    if (!fonts || typeof fonts.load !== 'function') return;
    // The stylesheet may still be in flight when the module executes, so wait for the font set to
    // settle, then insist on a real match with a couple of retries before giving up.
    try {
      await fonts.ready;
    } catch {
      /* ignore */
    }
    for (let attempt = 0; attempt < 4; attempt++) {
      for (const size of ['46px', '24px', '20px']) {
        try {
          await fonts.load(`300 ${size} ${JP_FAMILY}`, SAMPLE_TEXT);
        } catch {
          /* ignore */
        }
      }
      let ok = false;
      try {
        ok = fonts.check(`300 24px ${JP_FAMILY}`, '問題');
      } catch {
        ok = false;
      }
      if (ok) return;
      await new Promise<void>((resolve) => setTimeout(resolve, 60));
    }
  })();
  return pending;
}

/** True when the Japanese face is actually resolved (used for diagnostics only). */
export function japaneseFontReady(): boolean {
  const fonts = (globalThis as { document?: Document }).document?.fonts;
  if (!fonts || typeof fonts.check !== 'function') return false;
  try {
    return fonts.check(`300 24px ${JP_FAMILY}`, '問題');
  } catch {
    return false;
  }
}
