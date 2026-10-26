# BSOD:EX — 青い画面に飲み込まれる、5分のホラー

深夜の自室。モニタが青い。クリックするたびに、その青は「向こう側」に変わる。

`BSOD:EX` は **three.js + TypeScript + Vite** で作った、1 プレイ約 5 分のファーストパーソン・ホラー／グリッチ体験です。
カメラは最後までワンカット。暗転による場面転換はなく、部屋から BSOD の内部世界まで 1 本のカメラで繋がっています。

- エンジン: **three.js 0.186.1**（WebGL2） / TypeScript / Vite 7
- 1 unit = 1 m、右手系、Y-up、物理ベース（PBR）マテリアル + ACES tone mapping
- 外部アセットは CC0 / CC BY / CC BY-NC（非商用のみ）を `CREDITS.md` とゲーム内 Esc メニューに明記

> ⚠️ **光の点滅に関する警告**: 本作にはフラッシュ表現が含まれます。起動時にも同じ警告を表示します。
> まぶしさ／点滅に敏感な方は、Esc → SETTINGS で **GLITCH INTENSITY / SHAKE** を最小にしてください。
> フラッシュは実装上 **1 秒あたり最大 3 回**、ピーク輝度も上限（0.62）でクランプしています。

---

## 1. 動かす

```bash
npm install

# アセット（public/assets は同梱済み。再生成したいときだけ実行）
npm run assets          # = assets:fetch（curl + sha256 検証）→ assets:optimize（WebP / glTF 最適化）

npm run dev             # http://localhost:5173
npm run build           # tsc --noEmit && vite build  → dist/
npm run preview         # http://localhost:4173
npm run verify          # ヘッドレス Chromium による自動プレイスルー検証（60 項目）
```

`npm run verify` は **ビルド後の `dist/`** を `vite preview` で起動して検証します（先に `npm run build`）。
`-- --url http://localhost:5173` で既存の dev サーバを対象にすることもできます。
Chrome/Chromium のパスを差し替えたい場合は環境変数 `CHROME_PATH` を指定してください。

必要なもの: WebGL2 が動くデスクトップブラウザ（Chrome / Edge / Firefox / Safari 17+）。
キーボード + マウス前提です（タッチ操作は未対応）。

---

## 2. なぜ three.js か

- **1 カット・シームレス遷移が最重要要件**だったため、シーングラフの差し替え（部屋 ⇄ 別世界）をフレーム内で完結できる即時性が欲しかった。three.js は `Scene` への追加／削除とポストプロセス差し替えが同フレームで完結する。
- BSOD 世界は「壊れた UI テクスチャ」「ノイズ」「ワイヤーフレーム」を**Canvas で実行時生成**する。アセットを増やさず、クリックごとに段階的に壊していける。
- GTAO / Bloom / 独自グレードシェーダ / 動的解像度など、必要なポストエフェクトを**自前のシェーダで 1 パスずつ制御**したかった（副作用の少ない順序で合成）。
- ビルドサイズと反復速度: Vite + ESM で 3 秒ビルド、HMR で即確認。

物理は自前の AABB スイープ（`src/core/physics.ts`）。段差 0.38 m まで歩いて登り、40 cm 以内の段差は吸着、それ以上は壁として扱う。レール・階段・屋上まで、すべて同じコリジョンで通しています。

---

## 3. 操作

| 入力 | 動作 |
| --- | --- |
| `WASD` | 移動 |
| マウス | 視点（Esc メニューで感度 0.2–3.0） |
| `Shift` | ダッシュ（約 2 倍速） |
| `E` / 左クリック | 調べる・決定（中央の極小レティクル＋文脈プロンプトのみ表示） |
| `C` | 復旧コンソール（**BSOD 世界でのみ**。壊れた UI を読んで初めて存在を知る） |
| `F` | スマートフォンのライト（スポットライト） |
| `F3` | パフォーマンス表示（**初期状態はオフ**） |
| `Esc` | ポーズメニュー（感度 / 音量 / グリッチ強度 / 揺れ / 画質 / 動的解像度 / クレジット） |

コンソールを開いている間、ゲーム側のキー入力（WASD/C/F/E）は端末が奪います（`C` を押しても閉じない）。閉じるのは **Esc** か `EXIT`。

---

## 4. 体験の流れ（ネタバレあり）

1. **ROOM** — 深夜の寝室。モニタの青が主光源。生活感（マグ、本、スリッパ、時計、カーテン、ゴミ箱…）。環境音はすべて実行時合成。PC に近づいて `E` → 首を傾けるようなリーンイン + 被写界深度。
2. **BSOD** — 大きな `:(` 。クリックごとに段階的に壊れる（ノイズ → 画面の剥離 → 部屋の歪み → 巨大な顔 → 口）。**7 クリック**でポータルが開き、カメラは口の中へ吸い込まれる（暗転なし。白い閃光と虹彩リビールで世界へ繋ぐ）。
3. **WORLD** — 巨大な BSOD 世界。到着の荒地 → 崩壊した建築（床・階段・手すり・中二階） → 浸食された街（内部に入れる建物と屋上） → ケーブル／ブロックノイズの深層（地下サーバ） → 中央構造体（`WAKE_UP`）。実 3D LOD + 距離フォグでシームレスに接続。ジオメトリ／テクスチャ／ライティングすべてにグリッチが乗る。
4. **COLLAPSE** — 中央構造体で `WAKE_UP` を知る。コンソールで `WAKE_UP` と入力した瞬間だけ崩壊が始まる（他のコマンドでは何も起きない）。操作は奪われ、視線だけが動く：目 → 頭 → 身体、躊躇、足元を見る、ひび割れを追う、走る。地面が砕け、世界が遠ざかりながら落下。**操作が戻る**。
5. **EPILOGUE** — 落ちた先は元の寝室。小さな異変（時計、モニタ、床の欠片）が残る。メニューの `RESTART` で完全初期化して再プレイ。

---

## 5. コンソール

壊れた UI フラグメント（`[C] CONNECT`）を見つけると存在が分かります。存在しないコマンドは**世界の中のエラー**として返ります。

```
HELP / STATUS / DIR / WHOAMI / SYSINFO / PING / TRACE / SCAN / OPEN / FORMAT / CLEAR / EXIT
WAKE_UP   ← これだけが崩壊を起こす
```

- 前後空白を無視、大文字小文字を無視、連続空白は 1 つに正規化
- 空 Enter は `ERR_EMPTY_INPUT`
- 未知のコマンドは `ERR_0x…` 形式のランダムなコード + その場限りのヒント
- IME 変換中（`compositionstart`〜`compositionend`）の Enter は送信しない
- キーリピート（`e.repeat`）では二重送信しない
- 開いている間はポインタロックを解除し、閉じると復帰。**シネマティック中は `C` も `Esc` も効かない**

---

## 6. パフォーマンス

### 実装している最適化

- **静的ジオメトリの自動バッチ**（`mergeStatic`）: マテリアル単位で結合。シーン内メッシュ 1020 → **317**、ワールドのドローコールは 71（1 フレームの全ポストエフェクト込み）
- **遠景 LOD** + 手前の詳細カリング、`frustumCulled` 前提の配置
- **テクスチャ圧縮**: 1024 / 512 の WebP（color・normal・rough・ao・metal）、HDRI は EXR/HDR
- **動的解像度**: 0.55–1.0 のレンダースケールを FPS から自動調整（メニューで ON/OFF）
- **画質プリセット** low / medium / high / ultra（影解像度、GTAO、Bloom、DPR、グレイン量）
- BSOD 世界は **1 シーンに 5 エリアを同居** させ、カメラ移動だけで接続（ロード画面なし）

### 計測値（この環境で取れた事実）

ヘッドレス Chromium + **SwiftShader（ソフトウェア描画）** で測った 1 フレームあたりの値です。
GPU がないため **FPS の数値は参考になりません**（ソフトウェアラスタライザは実 GPU の 1/50〜1/300）。

| フェーズ | draw calls / frame | triangles / frame | 備考 |
| --- | ---: | ---: | --- |
| ROOM | 823 | 493 k | 影 2 灯 + GTAO のノーマルパス込み |
| WORLD | 71 | 987 k | 合流後（バッチ後） |
| COLLAPSE | 173 | 983 k | 破片・ひび割れ追加時 |
| EPILOGUE | 423 | 265 k | |

**正直な注記（重要）**: RTX 3050 / GTX 1660 / M1 での **1080p 60 fps は目標値であり、この環境では実機検証できていません**。このサンドボックスに GPU がなく、計測はすべて SwiftShader です。したがって README には「実測 60 fps」と書かず、上記の客観値（ドローコール／三角形数／解像度スケール）のみを載せています。実機で確認する場合は `?bench=1` で `window.__BENCH__` に平均・1% low が入ります（`npm run verify -- --bench`）。

---

## 7. 検証

```bash
npm run build
npm run verify            # 60 checks
npm run verify -- --bench # + 各フェーズのフレーム時間（SwiftShader なので参考値）
npm run verify -- --shots # 失敗時にスクリーンショットも保存
```

自動検証の内容（すべて実入力 or 実 API 呼び出しの結果を読む）:

- アセット全件ロード、起動警告、タイトル → 開始
- 移動、壁・机での停止、ダッシュでも壁を抜けない
- Esc メニュー、感度 0.2–3.0 の即時反映、クレジット表示（CC0 / CC BY-NC / MIT）
- PC インタラクト → リーンイン → BSOD、`:(` の 7 クリックで段階進行 → ポータル → 世界（ロードカットなし）
- コンソール: 開閉、フォーカス、開いている間の移動停止、空 Enter、HELP、SUDO 拒否、未知コマンド、STATUS、キーリピート二重送信なし、Esc で復帰
- 世界の踏破: 崩壊建築の階段 → 中二階（6.15 m）、街の屋上階段 → 屋上（6.7 m）、建物内部、地下サーバ入口、中央構造体の当たり
- ライト（F）、パフォーマンス表示（F3）
- `WAKE_UP` のみ崩壊、シネマティック中の入力ロック、`Esc`/`C` 無効、落下 → 寝室（エピローグ）、操作復帰、異変の残存
- RESTART で完全初期化（フェーズ／プレイヤー位置／破片の掃除）
- フラッシュ上限（1 秒 3 回・ピーク 0.62）
- `?debug=1` のときだけ F9 が効く／通常プレイでは効かない
- 未捕捉例外ゼロ

この環境での結果: **60/60 passed**。ただしソフトウェア描画のため、実 GPU での見た目・フレームレートは別途確認が必要です。

### 手動で確認してほしい項目

- 実機 GPU での 1080p / 60 fps（`?bench=1`）
- 実ブラウザでのポインタロックの挙動（Esc で解除 → メニュー）
- 音（Web Audio は実行時合成。ヘッドレスでは確認できない）
- 実際の IME（日本語入力）での Enter 挙動

---

## 8. デバッグ

| URL / キー | 内容 |
| --- | --- |
| `?debug=1` | `F9` でフェーズジャンプ（通常プレイでは無効） |
| `?phase=room\|bsod\|world\|collapse\|epilogue` | そのフェーズから開始（タイトルなし） |
| `?bench=1` | 各フェーズのフレーム時間を測り `window.__BENCH__` に保存 |
| `?quality=low\|medium\|high\|ultra` | 画質プリセットを強制 |
| `?manual=1` | 描画を手動に（自動検証用。`window.__BSOD__.advance()`） |
| `?nomerge=1` | 静的バッチを無効化（比較用） |
| `window.__BSOD__` | `jump / state / advance / useConsole / clickBsod / teleport / bench` |

---

## 9. アセット

`public/assets`（11 MB、コミット済み）は `tools/fetch-assets.mjs` + `tools/optimize-assets.mjs` で生成しています。

- **取得**: `curl` + `sha256` 固定（`assets.lock.json`）。npm tarball（`@pmndrs/assets`, `aframe-enviropacks`）と Khronos glTF Sample Assets の blob を SHA 指定で取得
- **最適化**: テクスチャ → WebP（color/normal 1024、rough/metal/ao 512）、glTF → 重複排除・溶接・未使用ノード削除・テクスチャ圧縮、`manifest.json` に credit を記録
- ライセンス全文は `public/assets/licenses/` と `CREDITS.md`

ライセンス: CC0（ambientCG / Poly Haven / Khronos / SheenChair / Lantern）、CC BY 4.0（GlamVelvetSofa）、
**CC BY-NC 4.0（Battle Damaged Sci-fi Helmet — 非商用のみ）**、フォント Inter は SIL OFL 1.1。
本作は**非商用**の前提でライセンスを構成しています（後述の CREDITS を参照）。

---

## 10. 構成

```
src/
  main.ts              起動（エラー時はローディング画面に表示）
  game.ts              オーケストレーション: フェーズ、入力、UI、コンソール、デバッグ、ベンチ
  sequences.ts         リーンイン / ポータル吸引 / 崩壊（いずれも 1 カメラのまま）
  scenes/room.ts       寝室（生成テクスチャ、生活感、時計、カーテン、プローブ）
  scenes/world.ts      BSOD 世界 5 エリア + 遠景 + LOD + 物理
  core/assets.ts       ローダ、テクスチャセット、マテリアル生成
  core/fx.ts           RenderPass → GTAO → Bloom → Grade(自作) → OutputPass、動的解像度
  core/physics.ts      AABB 物理 + プレイヤー
  core/audio.ts        Web Audio 合成（環境音、足音、心音、落下風、UI）
  core/input.ts        ポインタロック、キー、クリック、ホイール
  core/glitch.ts       グリッチシェーダの共有 uniform とノイズ
  core/util.ts         数学、静的バッチ（mergeStatic）、canvas ヘルパ
  ui/ui.ts             HUD、メニュー、設定、コンソール（IME / リピート対応）
tools/
  fetch-assets.mjs     アセット取得（sha256 検証）
  optimize-assets.mjs  WebP / glTF 最適化 → public/assets + manifest
  verify.mjs           自動プレイスルー検証（60 checks）
```

---

## 11. 既知の制限

- 実 GPU でのフレームレートは未検証（上記の通り）。`?bench=1` で確認できます
- 音はすべて合成。ヘッドレス環境では聴感評価ができていません
- タッチ / ゲームパッド未対応、キーボード + マウス専用
- 日本語と英語が混在（世界観としての「壊れた UI」表現を含む）
- セーブは設定のみ（`localStorage`）。進行状況は保存しません
