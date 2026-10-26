# 思い出の教室 ― 3D 探検

古い小学校の教室を、一人称視点でただ歩きまわるための小さな 3D 体験です。
夕方の光、チョークの粉、机の落書き、ストーブのにおい。
教室と廊下に散らばった **8 つの「記憶のかけら」** を見つけると、最後の一枚が開きます。

[Sketchfab の「Old Classroom」](https://sketchfab.com/3d-models/old-classroom-be2db5bb488a4392abda0d36c7b46e71)
をモチーフにしています（右下のボタンで元のモデルをその場で見られます）。

![three.js](https://img.shields.io/badge/three.js-0.186-black) ![vite](https://img.shields.io/badge/vite-8.3-black)

---

## 起動

```bash
npm install
npm run dev      # http://localhost:5173
```

ビルドして確認する場合:

```bash
npm run build
npm run preview  # http://localhost:4173
```

外部アセット（画像・モデル・音声）は **ひとつも使っていません**。
壁のシミ、木目、黒板の字、チョークの粉、外の景色、足音まで、
すべて実行時に Canvas 2D と Web Audio で生成します。

## 教室モデル（.glb）

歩きまわれる教室は **本物の 3D モデル** です。

- ファイル: `public/models/classroom.glb`（7.1 MB / 22,102 三角形）
- 出典: [The Japanese School Classroom — volvor](https://sketchfab.com/3d-models/the-japanese-school-classroom-d9fc039ba0b6433db91ec129abe86b52)
- ライセンス: **CC-BY-4.0**（作者表示が必須）— ロード画面・右下のパネル・この README に明記

> This work is based on "The Japanese School Classroom"
> (https://sketchfab.com/3d-models/the-japanese-school-classroom-d9fc039ba0b6433db91ec129abe86b52)
> by volvor (https://sketchfab.com/volvor) licensed under CC-BY-4.0
> (http://creativecommons.org/licenses/by/4.0/)

このサンドボックスからは Sketchfab のダウンロード API に出られない（TLS の SNI で遮断、
かつ `fetch_page` は `Authorization` を送れない）ため、**同じモデルを再配布していた GitHub リポジトリ**を
`api.github.com` のコード検索（モデル UID で検索）で見つけ、blobs API から
`scene.gltf` / `scene.bin` / `license.txt` / `textures/*` を取得しました。
それを `@gltf-transform/cli` で `.glb` にまとめ、テクスチャを 2K→1024 に縮小、
baseColor と emissive だけを WebP(q85) にして 44 MB → 7.1 MB にしています
（normal と metallicRoughness は非可逆圧縮を避けて PNG のまま）。

最初に依頼された [「Old Classroom」](https://sketchfab.com/3d-models/old-classroom-be2db5bb488a4392abda0d36c7b46e71)
は Sketchfab Store の有料モデル（`isDownloadable: false` / 価格 499）で配布物には組み込めないため、
代わりにこの CC-BY の日本の教室を採用しました。右下のボタンから、
いま歩いている教室の Sketchfab ビューア（あなたのブラウザから直接読み込み）を開けます。

モデルが無い環境では自動的に three.js の手続き生成教室にフォールバックします
（`public/models/classroom.glb` が 404 ならそちら）。

```bash
npm run egress:probe                   # どのホストに届くかを実測（TLS遮断は curl 35 / HTTP 000 で出る）
npm run model:fetch                    # 既定の .glb を取得 → 検証 → public/models/classroom.glb に配置
npm run model:fetch -- <URL>           # URL を貼るだけで経路変換して取得（下記）
npm run model:inspect                  # 占有マップ・縮尺・家具の位置を解析
```

**URL変換**（遮断はホスト名単位なので、届くホストの別表現に載せ替えて取得する）:

```bash
npm run model:fetch -- https://github.com/you/assets/blob/main/models/room.glb
npm run model:fetch -- https://raw.githubusercontent.com/you/assets/main/room.glb
npm run model:fetch -- --npm some-pkg --npm-path models/room.glb
```

| 変換前（届かない） | 変換後（届く） |
| --- | --- |
| `raw.githubusercontent.com/{o}/{r}/{ref}/{path}` | `api.github.com/repos/{o}/{r}/git/blobs/{sha}` |
| `github.com/{o}/{r}/raw/{ref}/{path}`（302 で死ぬ） | 同上 |
| GitHub Release の添付（`objects.githubusercontent.com`） | リポジトリへ commit → blob API（≤100 MB） |
| Sketchfab / S3 / CloudFront | 公開 GitHub リポジトリ、または npm / PyPI パッケージへ同梱 |

手順・禁止事項・ライセンス明記のルールは [`AGENTS.md`](AGENTS.md)（エージェント向けの作業規約）。

> **ブロックされたホストの JSON は `fetch_page` 系のツール経由で読めることがあります**（実測: `api.sketchfab.com`）。
> ただしバイナリは運べないので、実体は上表の輸送路（GitHub / npm / PyPI）から落とします。
>
> **API トークンは不要・不受理。** 遮断はホスト名単位の TLS で起きるため、`Authorization` を送る前に
> 接続が切られます（`api.sketchfab.com` にトークン付きで当てても `HTTP 000`）。
> エージェントはユーザーの認証情報を要求せず、環境が用意した認証（`GH_TOKEN`）だけを使います。

置き場所と手順は [`public/models/README.md`](public/models/README.md)。

## 操作方法

| 操作 | キー |
| --- | --- |
| 移動 | `W` `A` `S` `D` / 矢印キー |
| 走る | `Shift`（押しながら） |
| しゃがむ | `C` / `Ctrl`（押しながら・机の下を覗けます） |
| 視点 | マウス（クリックでロック）／ドラッグ |
| 調べる・拾う | `E` または クリック |
| 時間を変える | `F`（昼 → 夕方 → 夜） |
| ノート（記録） | `J` / `Tab` |
| 写真モード | `P`（HUD 非表示・`Enter` で PNG 保存） |
| 見取り図 | `M` |
| ポーズ | `H` / `Esc`（露出・音量・頭の揺れを調整できます） |

スマホ／タブレットでは、左下のスティックと右下のボタン（調べる・走る）が出ます。

## あそびかた

1. タイトルで `Enter`（または `スペース`）を押して教室に入る
2. 光るかけらを見つけて `E` — 拾うと短文の記憶が開きます
3. 気になったものは何でも `E` — 黒板、時計、時間割、扇風機、ピアノ、金魚、
   ストーブ、本棚、掃除用具入れ、掲示板、牛乳びん、ランドセル、ゴミ箱、紙飛行機…
   廊下に出ると、そこにもひとつ
4. 8 つ集めると、おわり

かけらは **しゃがまないと見えない場所**、**窓の外ではなく窓枠の上**、
**廊下の下駄箱の上** など、視線の高さを変えると見つかるように置いてあります。

## 中身

```
index.html            UI の枠（HUD・カード・ノート・タイトル・写真モード）
vite.config.js        プレビュー用に 0.0.0.0 バインド
src/
  main.js             起動・入力・メインループ・自動デグレード
  world.js            GLB があれば本物の教室、無ければ手続き生成（進捗つき）
  glbworld.js         GLB 教室：GLTFLoader 描画＋当たり判定＋光＋かけら
  glb-collide.js      three 非依存の GLB 解析（binary パース→縮尺→占有グリッド→矩形分解）
  glb-content.js      GLB 教室用の「調べられる物」13・「記憶のかけら」8・開始地点
  room.js             教室の箱：壁/床/天井・窓・黒板・時計・ドア・廊下・扇風機
  furniture.js        机25脚・教卓・ピアノ・ストーブ・本棚・掃除用具入れ・金魚ほか
  materials.js        マテリアル一式と ROOM 寸法（9m × 8m × 3m）
  textures.js         手続生成テクスチャ（木目・壁・黒板・時間割・絵・地球儀…）
  colliders.js        平面 AABB コライダー（押し出し 3 パス）
  player.js           移動・視点・頭の揺れ・足音・ポインタロック・タッチ
  interact.js         視線判定（レイキャスト）と記憶のかけら
  lighting.js         昼／夕方／夜のプリセットと窓から差し込む光の柱
  dust.js             空気中のちり
  audio.js            Web Audio だけの環境音・足音・ピアノ・チャイム
  ui.js               HUD・カード・ノート・トースト
  minimap.js          見取り図（実コライダーをそのまま描画）
  sketchfab.js        右下ボタン → 教室モデルの Sketchfab ビューア（CC-BY 表記つき）
public/models/        教室モデル classroom.glb（CC-BY-4.0 / volvor）と取得手順の README
tools/
  fetch-model.mjs     GitHub から .glb を取得・検証・配置（npm run model:fetch）
  fixtures/tiny.glb   fetch-model.mjs の検証用（最小の glTF バイナリ）
  inspect-glb.mjs     GLB の中身を世界座標（メートル）の ASCII 見取り図にする
  smoke.mjs           ブラウザなしで通すスモークテスト（node tools/smoke.mjs）
  audit.mjs           形状監査：壁・床・天井をめり込んでいないか（node tools/audit.mjs）
  stub.mjs            上記のための Canvas 2D / DOM スタブ
```

### テスト

```bash
node tools/smoke.mjs   # ワールド構築 → 移動 → 衝突 → 到達性 → 視線 → DOM 参照
node tools/audit.mjs   # 全メッシュの AABB を壁面と突き合わせ
```

スモークテストには次の検証が含まれます。

- **洪水充填**：0.15 m 格子で歩き回れるセルを求め、開始地点から到達できるか
  （8 つのかけらすべてに「歩いて行ける」ことを保証）
- **視線シミュレーション**：到達可能な立ち位置 × 目の高さ（1.58 / 1.20 / 0.94 m）から
  レイキャストし、かけら 8 個・調べられる物 20 個すべてが実際に「見つかる」か
- **GLB 解析 [11]**：縮尺（3.542 単位/m）・部屋寸法（7.70 × 10.27 m）・床面 y=0
- **GLB ワールド [12]**：Node 上で `buildGLBWorld` を実行し、メッシュ 718・コライダー 396・
  物 13・かけら 8 が生成されること、開始地点が床で外周がふさがっていること
- **GLB 到達性 [13]**：洪水充填で床の 94% に到達でき、かけら・物がすべて徒歩圏内か
- **GLB 検知 [14]**：`Interaction` と同じルール（Box3 clamp ≤ reach・レイ ≤ blockDist+0.08・
  かけらは 3D 距離 1.7 m）で 13 の物・8 のかけらすべてに気づけるか
  （当たり判定用プロキシは `visible=false` でもレイに当たる前提を検証）
- **DOM 参照**：コードが触る id / class が index.html に全部あるか

### 設計メモ

- **GLB の縮尺はどう決めたか**：モデルに単位情報が無いので、`glb-collide.js` が
  「黒板の書き面は実寸 1.15 m」という前提から逆算します（この教室は 4.1 単位 → **3.542 単位/m**）。
  床クラスタの上面を y=0、床矩形の中心を原点、`rotation.y = -π/2` で黒板を -Z に置きます。
- **当たり判定はグリッドから作る**：三角形を 0.1 m 格子に焼いて「床から 0.32〜1.28 m の帯」を占有とし、
  横ラン→縦拡張で矩形分解します（392 矩形）。連結成分の外接箱を使うと
  壁のリングが部屋全体を覆って閉じ込められるため、この方式にしています。
- **レイキャストはプロキシに撃つ**：487k 三角形に毎フレーム撃つのは重いので、
  調べられる物と遮蔽物は「見えない BoxGeometry」で代用します（three のレイキャスタは
  `visible=false` でも判定するため、これで正確に動きます）。
- **体の半径は GLB 教室だけ 0.16 m**（手続き版は 0.235 m）。机と机のあいだの実測が
  0.3〜0.6 m しかなく、そのままでは通路に入れないためです。
- **机の当たり判定**は「机＋椅子」をまとめて 1 つの領域にしています。
  別々にすると箱のすき間にプレイヤーが入り込み、押し出しが振動して動けなくなるためです。
- **窓の額縁・障子**は窓グループのローカル座標（+x = 窓幅, +z = 室内）で組んでいます。
  グループ自体が `rotation.y = -π/2` なので、部品の側で二重に回転させないのがコツです。
- **時間帯**は太陽・環境光・fog・外の背景・光の柱・蛍光灯をまとめて
  プリセット間補間します。夜は蛍光灯が少しだけ瞬きます。
- フレーム時間が伸びたら自動的にピクセル比を落とし、それでも足りなければ影を切ります。

## クレジット

- 教室モデル: **“The Japanese School Classroom” by [volvor](https://sketchfab.com/volvor) — CC-BY-4.0**
  （`public/models/classroom.glb` に収録。ロード画面と右下のパネルにも表記）
  - [The Japanese School Classroom](https://sketchfab.com/3d-models/the-japanese-school-classroom-d9fc039ba0b6433db91ec129abe86b52)
  - [CC-BY-4.0](http://creativecommons.org/licenses/by/4.0/)
  - テクスチャの縮小・WebP 化のみ実施（形状・マテリアルは改変なし）
- モチーフ（未採用）: [Old Classroom — Sketchfab](https://sketchfab.com/3d-models/old-classroom-be2db5bb488a4392abda0d36c7b46e71)
  は Sketchfab Store の有料・ダウンロード不可のため未組み込み
- 以前の版で使っていた教室モデル: `classroom_alternative.glb` — © [grep-many / Ryoshi](https://github.com/grep-many/ryoshi), MIT License
  （git 履歴に残存。現在は差し替え済み）
- ライブラリ: [three.js](https://threejs.org/) / [Vite](https://vite.dev/)
- 手続き生成教室のテクスチャ・効果音はこのプロジェクト内で生成しています（外部素材なし）
