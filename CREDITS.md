# CREDITS — 外部素材とライセンス

本作で使用している外部由来の素材は以下だけです。いずれも各素材ごとにライセンスを確認し、
改変・再配布・公開に問題のないものだけを採用しています（取得日: 2026-10-24）。
ゲーム内 Esc メニューの「クレジット」にも同内容を表示しています。

## 3Dモデル（同梱）

| 素材 | 出典 | ライセンス | 本作での改変 |
|---|---|---|---|
| Lantern（街灯） | KhronosGroup/glTF-Sample-Assets `Models/Lantern`（© 2017 Microsoft）https://github.com/KhronosGroup/glTF-Sample-Assets | **CC0 1.0** | テクスチャを512px JPEGへダウンサンプル、青系へ再マテリアル化（発光部を青白光に）。都市エリアの街灯として配置 |

## PBRテクスチャ（同梱、`public/textures/ext/`）

取得は GitHub API 経由（`scripts/fetch_github_assets.py` で再現可能）。

| ファイル | 出典 | ライセンス | 用途 |
|---|---|---|---|
| hardwood2_diffuse/bump/roughness | mrdoob/three.js `examples/textures` | **MIT License**（three.js 本体ライセンス） | 自室の床・机 |
| brick_diffuse/bump/roughness | 同上 | MIT | 異世界の都市・遺跡の壁（青く再着色） |
| FloorsCheckerboard_S_Diffuse/Normal | 同上 `examples/textures/floors` | MIT | 建築床・広場・到着台（青く再着色） |
| Ice002_1K-JPG_Color/NormalGL/Roughness | ambientCG「Ice002」、three.js 同梱分を経由取得 | **CC0 1.0**（ambientCG） | 荒野の地面（亀裂のある青い大地に再着色） |

## テクスチャ（任意・未同梱、ユーザーがスクリプトで取得可能）

| 素材 | 出典 | ライセンス |
|---|---|---|
| Poly Haven テクスチャ各種（wood_floor_deck 等） | https://polyhaven.com （`npm run fetch:polyhaven`、公式API経由で取得。2026-10-24 に `api.polyhaven.com` で実在確認済み） | **CC0 1.0** |

## ライブラリ

- three.js (MIT License) — https://threejs.org
- Vite (MIT License) — 開発・ビルド用

## 自作素材について

上記以外のすべての要素——自室・異世界のジオメトリ、残りのテクスチャ
（エラー文字壁、回路基板、ブロックノイズ、夜景、BSOD画面そのもの等）、
全ての音（環境音・足音・グリッチ・崩壊・落下・息づかいまで Web Audio 合成）、
文章・演出——は本作のために手続き生成／合成したオリジナル素材です。

## スケール・規格の統一について

1ユニット=1m、glTF は PBR（metallic-roughness）として取り込み、
外部モデルは実寸へ正規化（街灯は高さ約3.55m）+ テクスチャ圧縮（JPEG化・解像度低減）、
自作ジオメトリはマテリアル単位でマージ、破片はインスタンシングして負荷を抑えています。
