# CREDITS — BSOD_EX

本作品は自作(手続き生成・合成)素材と、以下の公開アセットを使用しています。
音声素材はすべて Web Audio による自作合成です(外部音声ファイルは使用していません)。

## 3Dモデル / テクスチャ / 環境マップ

### Khronos glTF Sample Assets (github.com/KhronosGroup/glTF-Sample-Assets)
https://github.com/KhronosGroup/glTF-Sample-Assets

| モデル | ライセンス | 著作権表示 | 用途 |
|---|---|---|---|
| FlightHelmet | CC0-1.0 | 2018 Public | 自室・棚のヒーロープロップ |
| AntiqueCamera | CC0-1.0 (UX3Dロゴ除く) | 2018 UX3D | 自室・棚 |
| BoomBox | CC0-1.0 | 2017 Public | 自室・棚 / 都市残骸 |
| Lantern | CC0-1.0 | 2017 Microsoft / 2018 Frank Galligan | 自室・崩壊建築 |
| WaterBottle | CC0-1.0 | 2017 Public | 自室・机 |
| GlassVaseFlowers | CC0-1.0 | 2023 Public | 自室・棚 |
| ScatteringSkull | CC0-1.0 | 2025 Public | 自室・崩壊建築・深層 |
| SheenChair | CC0-1.0 | 2020 Wayfair, LLC | 自室・隅 |
| ToyCar | CC0-1.0 | 2020 Public | 自室・棚 |
| ChairDamaskPurplegold | CC-BY-4.0 | 2021 Wayfair | 自室・椅子 |
| GlamVelvetSofa | CC-BY-4.0 | 2021 Wayfair, LLC | 自室・ソファ |
| GlassHurricaneCandleHolder | CC-BY-4.0 (Khronosロゴ除く) | 2021 Wayfair, LLC | 自室・棚 |
| IridescenceLamp | CC-BY-4.0 | 2022 Wayfair, LLC | 自室・机 |
| ChronographWatch | CC-BY-4.0 (Khronos/DGGロゴ除く) | 2025 Darmstadt Graphics Group GmbH | 自室・机 |
| MaterialsVariantsShoe | CC-BY-4.0 | 2021 Shopify | 自室・ドア脇 |
| SunglassesKhronos | CC-BY-4.0 (Khronosロゴ除く) | 2024 Darmstadt Graphics Group GmbH | 自室・机 |
| DamagedHelmet | CC-BY-4.0 / 一部 CC-BY-NC-4.0 | 2018 ctxwing / 2016 theblueturtle_ | 自室・棚 / 深層 |
| CommercialRefrigerator | CC-BY-4.0 | 2025 Darmstadt Graphics Group GmbH / 2025 Sean Thomas | 都市残骸・店内 |
| TrafficCone | CC-BY-4.0 + CC0-1.0 | 2024 hinndia / 2020 PolyHaven | 崩壊建築 / 都市残骸 |
| **Sponza** | **Cryengine Limited License Agreement(非商用・制限付き)** | 2016 Crytek | 異世界・崩壊建築エリアの中央建築 |

- DamagedHelmet のテクスチャの一部は CC-BY-NC-4.0(非商用)です。
- **Sponza は「Cryengine Limited License Agreement」に基づく制限付き素材です(商用利用不可)。**
  本作品は非商用の体験作品として使用しています。再配布・流用の際はこの条件を確認してください。
  https://www.cryengine.com/ce-terms
- 各モデルのライセンス全文は `public/assets/licenses/` に取得されます。

**不採用とした素材(条件が本作品に合わないため):**
- VirtualCity (3DRT.com) — 「glTF ツールのテスト専用」ライセンスのため不採用
- Duck — SCEA Shared Source License(条件が流用に不適)のため不採用
- PlaysetLightTest — CC-BY-NC-SA-4.0(Inter IKEA Systems B.V.)。ShareAlike 条件が本作品に波及するため不採用

### BabylonJS Assets (github.com/BabylonJS/Assets) — CC-BY-4.0
https://github.com/BabylonJS/Assets
- `ibl/room.hdr`, `ibl/night.hdr`, `ibl/country.hdr` — 環境マップ(IBL)
- `textures/rockyGround_*` — 岩地PBRテクスチャ
- `textures/dirt.jpg`, `sand.jpg`, `rock.png` — 地表テクスチャ
- `textures/woodAlbedo.png` — 木部テクスチャ
- `meshes/vintageDeskFan/` — アニメーション付き扇風機(自室)

### three.js examples (github.com/mrdoob/three.js) — コード MIT
https://github.com/mrdoob/three.js
- `examples/textures/hardwood2_{diffuse,bump,roughness}.jpg` — 木製床PBR
- `examples/textures/brick_{diffuse,bump,roughness}.jpg` — レンガPBR
- `examples/textures/equirectangular/moonless_golf_1k.hdr` — 夜間HDRI
  (原典: Poly Haven / HDRI Haven「moonless golf」by Greg Zaal, CC0)

### ライブラリ
- three.js (MIT) https://threejs.org/
- Vite (MIT) https://vitejs.dev/
- TypeScript (Apache-2.0) https://www.typescriptlang.org/

## サウンド
すべて Web Audio API による合成(自作)。外部音源ファイルは使用していません。

## その他の素材
- BSOD 画面・エラー文字・破損UI・亀裂・ポスター・時計文字盤・窓の夜景などの
  テクスチャはすべて本作品のために手続き生成した自作物です。
- 建築(崩壊ホール・都市のビル・深層・中心構造物)の主要構造は、
  PBRテクスチャを用いた自作ジオメトリです(衝突判定付き)。
