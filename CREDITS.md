# CREDITS / ライセンス表記

`BSOD:EX` は **非商用** の短編作品として公開する前提でライセンスを構成しています。
CC BY-NC（非商用のみ）のアセットを 1 点だけ使用しているため、**本作の再配布・公開は非商用に限られます**。

ゲーム内でも **Esc → CREDITS** に同じ内容を表示します（`src/ui/ui.ts` の `buildCredits()`）。
アセットのライセンス全文は `public/assets/licenses/` に同梱しています。

---

## エンジン / 開発ツール

| 名称 | ライセンス |
| --- | --- |
| three.js r186 | MIT |
| Vite 7 | MIT |
| TypeScript | Apache-2.0 |
| @gltf-transform（core / functions / extensions / cli） | MIT |
| sharp | Apache-2.0 |
| Playwright (playwright-core) + @sparticuz/chromium（検証のみ） | Apache-2.0 |

## PBR テクスチャ — CC0 1.0

| セット | 出典 |
| --- | --- |
| WoodFloor041, Wood027, Fabric026, Metal035, Metal009, Plastic, Snow003 | ambientCG — CC0 |
| rock_05, sandstone_cracks, brown_planks_04 | Poly Haven — CC0 |

取得経路: `@pmndrs/assets`（npm, CC0 ミラー）および `aframe-enviropacks`（npm, CC0 ミラー）。
ライセンスは原典（ambientCG / Poly Haven の CC0 1.0）に従います。改変（WebP 変換・解像度変更・チャンネル分離）を行っています。

## HDRI — CC0 1.0

| ファイル | 出典 |
| --- | --- |
| dikhololo_night.hdr | Poly Haven — CC0 |
| large_corridor.hdr | Poly Haven — CC0 |
| apartment / night / city / warehouse / hall / lab (.exr) | Poly Haven（`@pmndrs/assets` 経由） — CC0 |

寝室の反射プローブは実行時に `apartment` HDRI から焼いています（`Room.bakeProbe`）。

## 3D モデル — Khronos glTF Sample Assets

| モデル | 作者 | ライセンス |
| --- | --- | --- |
| Sheen Chair | Khronos / 寄贈者 | **CC0 1.0** |
| Lantern | Khronos / 寄贈者 | **CC0 1.0** |
| GlamVelvetSofa | Khronos / 寄贈者 | **CC BY 4.0** |
| Battle Damaged Sci-fi Helmet | **theblueturtle_** | **CC BY-NC 4.0（非商用のみ）** |

- ヘルメットは **非商用** の制約があるため、本作は非商用配布のみとします。クレジットは作者 `theblueturtle_` を明記。
- すべて glTF に再出力し、未使用ノード削除・溶接・テクスチャ WebP 化を行っています（改変許可済み）。
- 使用箇所: ヘルメットは BSOD 世界の深層（破片として再マテリアライズ）、ソファ／椅子／ランタン／柱は寝室と崩壊建築の小道具。

## フォント

| 名称 | ライセンス |
| --- | --- |
| Inter（SDF アトラス `public/assets/fonts/inter_bold.json`） | SIL Open Font License 1.1 |

## サウンド

**すべて本プロジェクト内で Web Audio API によりリアルタイム合成**しています（外部音源なし）。
対象: 環境音（部屋のハム、外の風、ケーブルの唸り）、BSOD のビープ、ライザー、囁き、ポータル、心音、息、
ひび割れ、破片、落下風、足音（木／コンクリート／金属／破片）、UI クリック、エラー音、グリッチバースト。
空間音響は `PannerNode` + `ConvolverNode`（自作インパルス応答）で、モニタ位置やモノリス位置に配置しています。

## テクスチャ / ジオメトリの実行時生成

BSOD 画面、壊れた UI フラグメント、ひび割れ、ビットマップ風エラー文字、ノイズは
`src/core/glitch.ts` / `src/sequences.ts` / `src/scenes/*.ts` 内で Canvas 2D により生成しています（オリジナル）。

## 謝辞

- three.js コミュニティのポストプロセス実装（EffectComposer / GTAOPass / UnrealBloomPass）
- Khronos glTF Sample Assets と、CC0 ミラーを公開している pmndrs / A-Frame チーム
- ambientCG と Poly Haven の CC0 スキャンデータ

---

### 再配布について

本作を再配布・公開する場合は次を守ってください。

1. **非商用**であること（Battle Damaged Sci-fi Helmet が CC BY-NC 4.0 のため）
2. `theblueturtle_` へのクレジット（CC BY 4.0 / CC BY-NC 4.0 の条件）
3. 本ファイルと `public/assets/licenses/` を同梱すること
4. CC0 アセットは改変・再配布自由ですが、出典表示を残すことを推奨します
