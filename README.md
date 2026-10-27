# BSOD_EX — 青い画面の向こう側

一人称視点の短編ホラー/グリッチ・インタラクティブ体験。three.js (r160) + Vite 製。
実写的な寝室を歩き、ブルースクリーンの `:(` に触れ、モニターの中の異世界に飲み込まれ、
隠されたコマンド `WAKE_UP` を発見して世界の崩壊から帰還する、再生可能な一本道の体験です。

## 操作方法

| 入力 | 動作 |
| --- | --- |
| W A S D | 移動 |
| マウス | 視点 (Pointer Lock) |
| SHIFT | 走る |
| E / クリック | PC を調べる / 顔に触れる / インスペクト解除 |
| C | ゲーム内コンソールを開く (ブラウザ DevTools ではない) |
| ESC | ポーズ (ロック解除) |
| M | ミュート切替 |

## 体験の流れ

1. **夜の自室** — 自由歩行。机の PC に近づくとカメラが自然に寄り、BSOD が点灯する。
2. **捕食遷移** — `:(` をクリックするたびにグリッチが増幅。6回で顔が口/ポータル化し、
   部屋が侵食・歪み、カメラは抵抗しながらモニターへ吸い込まれる(カットなしの連続空間遷移)。
3. **BSOD グリッチ世界** — 青い霧の世界を探索。中央の巨構造物に近づくと `WAKE_UP` が発見される
   (事前の UI 説明なし)。グリッチは静寂と異常の緩急を持つ。
4. **コンソールと崩壊** — C でコンソールを開き `WAKE_UP` を実行すると強制シネマティック崩壊。
   操作はこの間だけ無効化され、終了後に必ず復帰する。
5. **帰還と再生** — 落下の慣性のまま自室に着地。PC と部屋に小さな異変が残る。何度でも再生可能。

## 開発

```bash
npm install
npm run dev        # 開発サーバ (http://localhost:5173)
npm run build      # 本番ビルド (dist/)
npm test           # ヘッドレス統合スモークテスト (実 GLB パース + 全フロー assert)
```

ブラウザが無い CI 環境向けに、`tools/smoke.mjs` は WebGL/DOM/Audio を Proxy モックし、
実際の GLTFLoader (meshopt) でアセットをパースして全状態遷移を assert します。

## 構成

```
src/
  main.js               ブートストラップ(ロード → タイトル → 開始)
  core/
    Game 相当の基盤: AssetManager(GLB/テクスチャ, 静的モデル融合), Input(Pointer Lock),
    Player(円 vs AABB 最小貫通衝突, ヘッドボブ, 足音), PostFX(グリッチ/侵食/フラッシュ),
    AudioEngine(完全プロシージャル Web Audio), CameraRig(頭の慣性)
  game/
    Game.js             状態機(room/inspect/consume/void_entry/void/console/collapse/landing)
    BedroomScene.js     GLB 寝室 + 卓上プロップ + 侵食シェーダ + 帰還後の異変
    BSOD.js             動的 BSOD キャンバステクスチャ + 顔ポータルシェーダ
    ConsumeTransition.js 捕食遷移(ためらい → 吸引 → 突入)
    GlitchScene.js      異世界(地形, 巨構造物, 浮遊残骸, 崩落タイル, シャフト)
    CollapseSequence.js パニック視点 → 自由落下の強制カメラ演出
    Console.js          ゲーム内端末(誤コマンドには世界観上の応答)
    HUD.js / textures.js
public/models/          最適化済み GLB (meshopt + WebP, 合計 約 7.6 MB)
tools/
    smoke.mjs           ヘッドレス統合テスト
    optimize.mjs        GLB 最適化パイプライン (gltf-transform + sharp)
    glb_aabb.js / glb_inspect.js  アセット調査用
```

## 設計上の注記

- グリッチは常時点滅ではなく、4〜9.5 秒間隔のバーストと減衰で緩急を付けている。
- 演出の遅延はゲーム時間ベース (`Game.after`)。バックグラウンドタブのタイマー抑制に影響されない。
- 異世界の遠景ラック/基板はマテリアル単位に融合 (`bakeStaticModel`) しドローコールを削減。
- `WAKE_UP` の立体文字は発見まで非表示。遠景からの光でネタバレしない。
