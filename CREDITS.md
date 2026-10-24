# CREDITS / ライセンス

`bsod_ex` に同梱している外部アセットの一覧です。**すべて実際に取得し、ライセンスを個別に確認したものだけ**を使用しています。
同梱物はすべて改変（再マテリアル化・BSOD 化・頂点量子化・1024px WebP への再圧縮）しています。

非商用 (NC) 限定の素材（例: `DamagedHelmet` = CC-BY-NC-4.0）は検討のみで、**最終ビルドには含まれていません**。

---

## 1. 3D モデル — Khronos glTF-Sample-Assets

出典: <https://github.com/KhronosGroup/glTF-Sample-Assets>
各モデルのライセンス原文は `licenses/KHRONOS-<Model>-LICENSE.md`。

| ゲーム内キー | モデル | 作者 / クレジット | ライセンス | 用途 |
| --- | --- | --- | --- | --- |
| `chair` | Sheen Chair | Eric Chadwick / Wayfair, LLC | **CC0-1.0**（メタデータは CC-BY-4.0） | 自室の椅子 / 異世界の断片 |
| `sofa` | Sheen Wood Leather Sofa | 原案 Fran Calvente (CC0) / 2024 改修 Eric Chadwick, Darmstadt Graphics Group | **CC-BY-4.0** | 異世界に浮遊する家具 |
| `lantern` | Lantern | Khronos glTF Sample Assets contributors | **CC0-1.0** | 自室のフロアランプ |
| `bottle` | Water Bottle | Microsoft | **CC0-1.0** | 机の上の小物 |
| `plant` | Diffuse Transmission Plant | Rico Cilliers (モデル, CC0) / Eric Chadwick, DGG (マテリアル・アニメーション, CC-BY-4.0) | **CC0-1.0 + CC-BY-4.0** | 自室の観葉植物 |
| `vase` | Glass Vase with Flowers | Eric Chadwick（花瓶）/ Rico Cilliers（花） | **CC0-1.0** | 棚の花瓶 |
| `toycar` | Toy Car | Guido Odendahl / Eric Chadwick | **CC0-1.0** | 机の上のミニカー |
| `coals` | Pot of Coals | Eric Chadwick / Darmstadt Graphics Group（Khronos ロゴを含む） | **CC-BY-4.0** | 棚の鉢 |
| `helmet_scifi` | SciFi Helmet | Michael Pavlovic（glTF 変換: Norbert Nopper） | **CC0-1.0** | 異世界の記憶の断片 |
| `helmet_flight` | Flight Helmet | Gary Hsu | **CC0-1.0** | 都市の上に浮かぶ記憶の断片 |

CC-BY-4.0 の素材については、上記のクレジットを本ファイルおよびゲーム内 Esc メニューに表示しています。

### 使用を見送ったもの（ライセンス確認の結果）
- `Sponza` — Cryengine Limited License Agreement（クレジット表記では利用不可）→ 不採用
- `VirtualCity` — 3DRT のテスト用途限定ライセンス → 不採用
- `BrainStem` — Poser EULA（`LicenseRef-Poser-EULA`）→ 不採用
- `DamagedHelmet` — CC-BY-NC-4.0（非商用限定）→ 本作では未使用

---

## 2. PBR テクスチャ — ambientCG (CC0-1.0)

出典: <https://ambientcg.com/> / 取得経路: `petroulacl/fps-asset-kit` の 2K セット
変換: 1024px WebP（albedo / normal / ORM パック）に再圧縮し、repeat・色・粗さを場面ごとに再設定。

| ゲーム内キー | ambientCG ID |
| --- | --- |
| `floor_wood` | Wood092 |
| `desk_wood` | Wood094 |
| `wood_planks` | Wood095 |
| `wall_plaster` | Plaster001 |
| `wall_plaster_old` | Plaster002 |
| `ceiling_plaster` | Plaster007 |
| `concrete` | Concrete048 |
| `brick` | Bricks102 |
| `metal` | Metal063 |
| `asphalt` | Asphalt031 |
| `rock` | Rock058 |
| `ground` | Ground054 |

すべて **CC0-1.0**（表示義務なし。ここでは出典の尊重のために記載）。

---

## 3. 音

| 種別 | 出典 | ライセンス |
| --- | --- | --- |
| 足音（砂利 / 土 / 石） | Fantozzi's Footsteps — <https://opengameart.org/content/fantozzis-footsteps-grasssand-stone> | **CC0-1.0** |
| 環境音（PC ファン / 時計 / 遠くの車 / 風 / 深い唸り / 構造物のハム） | 本作で Web Audio API によりリアルタイム合成 | 本作オリジナル |
| 効果音（BSOD 起動音 / グリッチ / 亀裂 / 落下風 / 着地 / 心拍 / 呼吸 / 帰還和音 / UI 音） | 本作で Web Audio API によりリアルタイム合成 | 本作オリジナル |
| 残響 (Convolver IR) | 本作で実行時生成（ノイズ + 指数減衰） | 本作オリジナル |

BGM は意図的に最小限です（環境音のドローンと和音のみ）。

---

## 4. ソフトウェア

| 名称 | ライセンス | 用途 |
| --- | --- | --- |
| three.js r186（および addons） | MIT | レンダリング / ポストエフェクト / glTF 読み込み |
| `RoomEnvironment`（three.js addons） | MIT | 反射プローブ（IBL）生成 |
| Vite 7 | MIT | 開発サーバ / ビルド |
| TypeScript 5 | Apache-2.0 | 型チェック |
| gltf-transform | MIT | glTF 量子化・テクスチャ圧縮（ビルド時のみ） |
| sharp | Apache-2.0 | 画像変換（ビルド時のみ） |

ゲーム内のテクスチャ（BSOD 画面・`:(` の顔・壊れた UI・夜景・時計・ポスター・QR 風ブロック）はすべて本作が Canvas2D で実行時生成しています。

---

## 5. ライセンス全文

- `licenses/CC0-1.0.txt`
- `licenses/CC-BY-4.0.txt`
- `licenses/KHRONOS-*.md`（モデルごとの原文）

再取得・再変換は `npm run fetch-assets && npm run build-assets` で再現できます。
