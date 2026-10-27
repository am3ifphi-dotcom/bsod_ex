# BSOD_EX :( — 一人称・短編ホラー／グリッチ体験

深夜の自室から始まり、PCのBSODに「食われ」、青いグリッチ世界を探索し、
コンソールに脱出コマンドを打ち込んで崩壊する世界から自室へ帰還する、
全工程プレイ可能な短編インタラクティブ作品です。

## 遊び方

```bash
npm install
npm run dev   # http://localhost:5173
```

- ヘッドホン推奨 / デスクトップ + マウス・キーボード向け
- 進行: 自室を歩く → PCに近づき `E` で調べる → BSODの「:(」をクリックし続ける
  → 異世界を探索する → 中央の巨像で手がかり発見 → `C` でコンソール → コマンド実行
  → 崩壊・落下 → 自室へ帰還（その後も歩行・再挑戦可能）

## 技術・軽量化

- Three.js (Vite)。WebGLポストプロセス・チェーンを使わず、CSSオーバーレイと
  グループ変換・ライティングのみで遷移演出を構成し、安定したフレームレートを優先。
- Google Drive の `modern_stylized_bedroom.glb` (62MB) と GitHub リポジトリの
  GLB 群を glTF-Transform で Meshopt 圧縮 + テクスチャ WebP 化 + ジオメトリ簡略化。
  寝室 62MB → 5.2MB、全モデル合計 約 8MB。
- モニター画面は Canvas に描く本物仕様の Windows BSOD（:( / 停止コード / QR /
  %表示）。狂気は「無から口が現れる」のではなく、実在要素そのものの文字化け・
  グリフ変形・QR崩壊・停止コード変質として表現。

## 素材クレジット

- 3D: modern_stylized_bedroom (CC-BY-4.0, Visthétique / Sketchfab, Google Drive 経由)、
  CRT monitor / office chair / motherboard / CRAY-1 / server rack / cables /
  gaming desktop PC（GitHub リポジトリ収録 GLB を最適化）
- Audio: CC0 Public Domain Sounds (GitHub: lavenderdotpet/CC0-Public-Domain-Sounds)
  のループ・SE + WebAudio 合成（ドローン／グリッチ／風／低音）
