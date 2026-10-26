# AGENTS.md — エージェント作業規約

このリポジトリで作業するエージェント（Arena Agent Mode 含む）向けの申し送り。
**人間の依頼文に貼る用のプロンプト部品は [§4](#4-依頼文に貼るプロンプト部品コピペ用) にある。**

---

## 0. セッション開始時にやること

1. `git fetch origin` → 現在のブランチと `origin` の差分を確認（サンドボックスは回収されると
   `node_modules` が消え、`.git` が巻き戻ることがある。ズレていたら `git reset --mixed origin/<branch>`）
2. `node_modules` が無ければ `npm install`
3. **外部アセットを扱うなら、推測せず到達性を実測する** → `node tools/probe-egress.mjs`
4. 変更後は `node tools/smoke.mjs` → `node tools/audit.mjs` → `npx vite build` を通す

---

## 1. 外部アセット取得プロトコル（いわゆる「URL変換」）

### 1.1 原則

サンドボックスの外向き HTTPS は **ホスト名（TLS の SNI）単位の許可リスト**で絞られる。
パスでも中身でもリダイレクトでもなく **ホスト名** で決まる。遮断は HTTP ステータスではなく
TLS ハンドシェイクの失敗（`curl: (35) SSL_ERROR_SYSCALL` / HTTP code `000`）として現れる。

→ だから **同じバイト列を「到達できるホストの別表現」に載せ替えれば取得できる**。これが URL変換。

### 1.2 手順（梯子）

1. **直接は1回だけ試す。** TLS で切られたホストは二度と叩かない（時間の無駄）。
2. `tools/probe-egress.mjs` で **輸送路に使えるホストを確定**する。
3. 欲しいものを**使えるホスト上で自律的に探す**（ユーザーに URL を聞く前に探す）:
   - GitHub: `api.github.com/search/repositories?q=…`、`/search/code?q=…`（**Bearer 必須**、無認証は 0 件が返る）、
     `repos/{o}/{r}/git/trees/{sha}?recursive=1`
   - npm: `registry.npmjs.org/{pkg}`（packument）
   - PyPI: `pypi.org/pypi/{pkg}/json`
   - **ライセンス（spdx）を必ず確認**し、再配布可のものだけ使う（§1.5）
4. **変換テーブルに従って取得**する（§1.3）。
5. **検証**してから配置する（magic bytes / 宣言長 / 実サイズ / sha256）。
   `.glb` なら `tools/inspect-glb.mjs` で縮尺と家具配置を世界座標（m）に起こす。
6. 統合し、**ヘッドレスでテスト**（占有グリッド→コライダー、洪水充填での到達性、
   視線判定の再現、ビルド）。目で見られない分をテストで担保する。
7. どれも無いとき**だけ**、ユーザーに最小の「1ホップ」を依頼する（§1.6 の定型文）。

### 1.3 変換テーブル（実測済み）

| 欲しいものの在り処 | 実際に叩く URL | 備考 |
|---|---|---|
| 公開 GitHub リポジトリのファイル | `api.github.com/repos/{o}/{r}/contents/{path}?ref={ref}` | ≤1 MB は base64 で中身が返る |
| 同上（1 MB 〜 100 MB） | `api.github.com/repos/{o}/{r}/git/blobs/{sha}` + `Accept: application/vnd.github.raw+json` | **大本命。** 37 MB の .glb もこれで落ちた |
| リポジトリ丸ごと | `codeload.github.com/{o}/{r}/tar.gz/{ref}` | GNU tar は `--wildcards "*/{path}"` で抽出 |
| npm パッケージ内のファイル | `registry.npmjs.org/{pkg}/-/{pkg}-{ver}.tgz` | tar 内は必ず `package/` 始まり |
| PyPI パッケージ内のファイル | `pypi.org/pypi/{pkg}/json` → `urls[].url`（`files.pythonhosted.org`） | wheel / sdist どちらも可 |
| GitHub 上のコード検索 | `api.github.com/search/code`（要 Bearer） | `gh api search` は 0 件を返すことがあるので curl 推奨 |

### 1.3b 第2の経路：環境提供ツール（fetch_page / web_search）は egress 制限を通らない

サンドボックスの curl が TLS で切られるホストでも、**Arena が提供するページ取得・検索ツールは
別のネットワーク経路**なので届くことがある。実測：

| 対象 | 結果 |
|---|---|
| `api.sketchfab.com/v3/models/{uid}`（JSON） | ✓ **取れた**（curl だと HTTP 000 のホスト） |
| `api.sketchfab.com/v3/search?type=models&downloadable=true&q=…` | ✓ 取れた（`archives` の GLB サイズや license まで見える） |
| `raw.githubusercontent.com/…/screenshot.png`（バイナリ） | ✗ HTTP 500 |
| `.glb`（バイナリ） | ✗ プロキシ署名エラー |

**使い分け**：メタデータ・API レスポンス・ドキュメント・検索＝ツール経由で読む。
**バイト列（.glb / .png / .zip）は運べない**ので、実体は必ず §1.3 の輸送路（GitHub / npm / PyPI）へ載せ替える。
つまり「ツールで当たりを付けて（ライセンス・サイズ・DL可否を確認）、実体は許可ホストから落とす」が最強の組み合わせ。

**このリポジトリでは `node tools/fetch-model.mjs <URL>` がこの変換を自動でやる。**

```bash
node tools/fetch-model.mjs https://github.com/me/assets/blob/main/models/room.glb
node tools/fetch-model.mjs https://raw.githubusercontent.com/me/assets/main/room.glb
node tools/fetch-model.mjs --npm some-pkg --npm-path models/room.glb
node tools/fetch-model.mjs --repo me/assets --path models/room.glb --ref main --force
```

### 1.4 変換しても届かないもの（実測）

`raw.githubusercontent.com` / `gist.githubusercontent.com` / `objects.githubusercontent.com`
（＝ **GitHub Release の添付ファイルは不可**、302 で飛ぶ） / `camo.githubusercontent.com` /
`*.github.io`（Pages） / `cdn.jsdelivr.net` / `unpkg.com` / `cdnjs.cloudflare.com` /
`sketchfab.com` とその CDN（S3・CloudFront） / `huggingface.co` /
`www.googleapis.com` / `storage.googleapis.com` / `drive.google.com` / `docs.google.com`

罠: `github.com/{o}/{r}/raw/{ref}/{path}` は **302 で `raw.githubusercontent.com` へ飛ぶので不可**。
リダイレクトは変換にならない（最終ホストで判定される）。

実装上の注意: このサンドボックスの外向き HTTPS は MITM プロキシ（issuer `O=E2B; CN=E2B Proxy CA`）を通る。
その CA は `/etc/ssl/certs` にあるが Node の既定信頼ストアに無いので、**`node:fetch` だと
`UNABLE_TO_VERIFY_LEAF_SIGNATURE` になる。HTTP は `curl` に寄せる**と手元マシンでもそのまま動く。

### 1.5 ライセンスとクレジット

- 取得前に spdx を確認。**MIT / Apache-2.0 / CC0 / CC-BY** 等の許諾範囲でのみ使う。不明なら使わずに聞く。
- 出典（リポジトリ or URL）・著作権表示・ライセンスを **README と実行時の表示（ロード画面など）の両方**に明記する。
- 目的のものと**別物で代用した場合は、必ず何を代わりに使ったかを報告**する（黙って差し替えない）。

### 1.6 ユーザーに1ホップ頼むときの定型文

> このサンドボックスからは `<ホスト>` に TLS で遮断されて届きません。
> **届くホストは `api.github.com` / `codeload.github.com` / `registry.npmjs.org` / `files.pythonhosted.org` です。**
> お手元のブラウザで `<ファイル>` をダウンロードし、**公開 GitHub リポジトリの任意のパス**に置いて
> その URL を貼ってください（Web UI のドラッグ＆ドロップで 100 MB まで）。
> 以降の取得・検証・縮尺解析・統合・テスト・コミットはこちらで全部やります。

### 1.7 コネクタ（Google Drive 等）の扱い

コネクタ呼び出しはサンドボックスの網を通らないので**届く**。ただし
`download_file` のバイナリは **base64 でコンテキストに返る**ため数 MB が実用上限。
`return_download_url=true` が返す URL は `googleapis.com` なので**サンドボックスからは取得不可**。
→ **大容量アセットは GitHub / npm / PyPI 経由を優先。** コネクタは設定・コメント・小型ファイル向き。

### 1.8 禁止事項

- 遮断ホストへのリトライ地獄、VPN/プロキシ等による**アクセス制御の回避工作**
- パスワード・トークン・OAuth コード・2FA の要求や保存（認証は環境側が用意したものだけ使う）
- 検証せずの配置（壊れた .glb / LFS ポインタ / 途中切れを掴むので必ず magic と長さを確認）
- 巨大ファイルの不用意な commit（サイズを報告し、`.gitignore` 対象か外部保存かを判断する）

### 1.9 認証情報（API トークン）について — **ユーザーに貼らせない**

- **トークン・パスワード・OAuth コード・2FA をチャットで要求しない。受け取らない。保存しない。**
  使うのは環境が最初から用意している認証だけ（ここでは `GH_TOKEN`。`api.github.com` の読み取りに使用）。
- 鍵が必要な API で鍵が無い場合は「鍵が無いので不可」と報告し、**§1.6 の1ホップ案**を出す。
  ユーザーの個人トークンを借りて解決しようとしない。
- **そもそもトークンは host 単位の遮断を越えられない。** 遮断は TLS ハンドシェイクで起きるので、
  `Authorization` ヘッダを送る前に接続が切られる。実測：
  ```
  curl -H "Authorization: Token <正しいトークン>" https://api.sketchfab.com/v3/models/<uid>/download
  → HTTP 000（curl 35 / SSL_ERROR_SYSCALL）   # トークンの正否以前に届かない
  ```
  「API トークンを渡せばダウンロードできる」という提案は、**届くホストに対してのみ**意味がある
  （例：`api.github.com` の私有リポジトリ。ただし本プロジェクトは公開リポジトリで足りる）。
- 参考：Sketchfab の「private API token」は **exporter からのアップロード用**であり、ダウンロードは
  `/v3/models/{uid}/download`（自分が所有 or DL 許可されたモデル限定）。しかも返るのは
  `static.sketchfab.com` / S3 / CloudFront の URL で、**これも全部 TLS 遮断済み**。
- 万が一ユーザーがトークンを貼ってしまったら、その場で「無効化（revoke / 再生成）してください」と伝え、
  値をどこにも書き残さない（コミット・ログ・README・コード内すべて禁止）。

---

## 2. このリポジトリの道具

| コマンド | 用途 |
|---|---|
| `node tools/probe-egress.mjs [host…] [--json]` | 外向き到達性マトリクスの実測（**推測しない**） |
| `node tools/fetch-model.mjs <URL>` | URL 変換 → 取得 → glTF 検証 → 配置 |
| `node tools/inspect-glb.mjs public/models/classroom.glb` | GLB の縮尺・部屋・家具を世界座標（m）の ASCII 見取り図に |
| `node tools/smoke.mjs` | ブラウザなしの通し検証（`[11]`〜`[14]` が GLB 教室） |
| `node tools/audit.mjs` | 手続き生成版の形状監査（壁・床・天井のめり込み） |
| `npm run dev` / `npx vite build` | プレビュー（0.0.0.0:5173）/ ビルド |

---

## 3. 教室 GLB の統合メモ（差し替えるときに読む）

### 3.0 モチーフの Sketchfab「Old Classroom」は**取得不能**（再調査不要）

`api.sketchfab.com/v3/models/be2db5bb488a4392abda0d36c7b46e71`（fetch_page 経由で実測）：

- `isDownloadable: **false**` / `price: 499`（＝ストアの有料商品 $4.99）/ license `Standard`
- 作者 Rafael Rodrigues（@RafaelBR873D）、56.5k faces / 31.7k verts / 19 textures、tags: school, abandoned, b3d, blender, noai

→ **トークンがあっても、URL変換でも、1ホップリレーでも取得できない**（購入が唯一の道で、
購入しても Standard ライセンスの範囲。公開リポジトリへの再アップは不可）。

**Sketchfab の API 文書から確定した「トークンが使えない理由」**（再調査不要）：

- Download API: 「100万以上の無料 CC モデルを glTF / GLB / USDZ で提供。**DL には Sketchfab アカウントでの
  認証が必要**（＝エンドユーザーがアプリ内でログインする設計）」。FBX/OBJ は不可。
- ところが本環境では (1) sandbox の curl は `api.sketchfab.com` に TLS で届かない、
  (2) `fetch_page` は **URL しか渡せず `Authorization` ヘッダを付けられない**、
  (3) `fetch_page` は**バイナリを運べない**（PNG → HTTP 500）。
  → **認証情報を渡す手段そのものが無い。** トークンは「足りないピース」ではない。
- OAuth2: アプリ登録は Sketchfab への問い合わせ（Client ID/Secret の発行）が必要で日数がかかる。
  Username/Password グラントは**ユーザーのパスワードを要求することになるので絶対に使わない**。

**代わりに使える正規ルート（実測で候補を確認済み）**：Sketchfab には
**CC Attribution＝クレジット明記で再配布可**の無料DL可能な日本の教室がある。
CC-BY なら *公開 GitHub リポジトリへのリレーも合法* なので、1ホップ（ユーザーがブラウザでDL →
公開リポジトリへ置く → URLを貼る）で `npm run model:fetch -- <URL>` がそのまま効く。

| モデル | UID | 規模 | DL数 | ライセンス |
|---|---|---|---|---|
| Japanese Classroom / T I A N (@Tian96) | `2a1e3b294c1e4e91bed794bfa520c4f4` | 326k tris / 169.9k verts | 25,273 | CC-BY |
| The Japanese School Classroom / volvor | `d9fc039ba0b6433db91ec129abe86b52` | **22.1k tris** / 13.1k verts | 3,447 | CC-BY |
| Japanese Classroom / davioly | `2930eb3931fd48778fb338252ae08599` | 259.5k tris / 135.2k verts | 3,969 | CC-BY |
| Anime Classroom / ArielCastilleroV | `6e17b75780c044429323cd7ab6a5b83c` | — | — | CC-BY |
| School Classroom / Alihan | `dbc97b1e744348bdb01f440bc5d472e2` | 76.8k tris | 1,749 | CC-BY |
| Japanese Classroom / favorsLab（古い日本の教室・33 textures） | `e96f7511f84444ce93315436654d36b0` | 130,676 polys | — | **DL不可表記** |

候補の追加調査は `https://api.sketchfab.com/v3/search?type=models&downloadable=true&q=japanese classroom`
（fetch_page 経由で叩ける。`archives.glb.size` で GLB の実サイズ、`license.label` で許諾が分かる）。
**差し替えたら §3 の手順（縮尺逆算 → 占有グリッド → 物/かけらの再配置 → smoke `[13][14]`）をやり直すこと。**
CC-BY なのでクレジット（作者名・モデル名・ライセンス・元URL）を README とロード画面の両方に入れること。

- モデル: `public/models/classroom.glb` — © grep-many / Ryoshi, **MIT**
  （`github.com/grep-many/ryoshi` の `web/public/models/classroom_alternative.glb`）
- **縮尺はモデル非依存で逆算する**: `src/glb-collide.js` が「黒板の書き面＝実寸 1.15 m」から
  `unitsPerMeter` を求める（現モデルは 4.1 u → **3.542 u/m**）。無ければ扉高さ 2.3 m でフォールバック。
- 配置: 床クラスタの上面を `y=0`、床矩形の中心を原点、`rotation.y = -π/2` で黒板を **-Z** に。
- **当たり判定は占有グリッドから作る**: 三角形を 0.1 m 格子に焼き、「床から 0.32〜1.28 m の帯」を占有とし、
  `gridRects()`（横ラン→縦拡張）で矩形分解（現モデルで 392 個）。
  *連結成分の外接箱を使ってはいけない* — 壁のリングが部屋全体を覆い、プレイヤーが閉じ込められる。
- **レイキャストはプロキシに撃つ**: 487k 三角形に毎フレーム撃てないので、調べられる物と遮蔽は
  `visible=false` の `BoxGeometry` で代用（three のレイキャスタは `visible` を見ないので正しく当たる）。
- **体の半径**: GLB 教室は `0.16 m`（手続き版 `0.235 m`）。机間が実測 0.3〜0.6 m しかないため。
- **IBL 必須**: 44 マテリアルのうち 6 つが `metalness>0.15`（未指定＝1.0 の既定を含む）。
  `scene.environment`（PMREM 済み `RoomEnvironment`）が無いと金属が黒つぶれする。
- ガラスは `transmission` を落として `castShadow=false` にする（本物の太陽光が窓から床に落ちる）。
- 物とかけらの座標は `src/glb-content.js`。**モデルを差し替えたら `tools/inspect-glb.mjs` の
  見取り図を見て置き直す**こと（`tools/smoke.mjs` の `[13][14]` が到達性と検知を保証する）。

---

## 4. 依頼文に貼るプロンプト部品（コピペ用）

### 4.1 短縮版（ふだんはこれで足りる）

```text
外部アセット（3Dモデル/画像/フォント/データ等）が必要になったら、URLを渡さなくても自律的に取得して組み込んでほしい。
この環境の外向き通信はホスト名単位の許可リストなので、まず到達性を実測し、TLSで切れたホストは繰り返さないこと。
届かないものは「届くホスト（GitHub の blob/tarball、npm レジストリ、PyPI）」へ載せ替える URL変換 で入手する。
取得物は magic/サイズ/sha256 で検証し、ライセンスを確認したうえで、出典とライセンスを README とアプリ内の両方に明記する。
目的のものが無く別物で代用した場合は必ずそう言うこと。どうしても人間の1ホップが必要なときだけ、
「どのホストの・どのパスへ・何MBまで・何形式で」置けばよいかを具体的に指示してほしい。
なお環境が提供するページ取得・検索ツール（fetch_page / web_search 等）はサンドボックスのegress制限を通らない別経路なので、
ブロックされたホストのJSON/API/文書はそれで読んでよい（ただしバイナリは運べないので実体は上記の輸送路から落とす）。
APIトークンやパスワードは私に要求しないこと（貼らせない・保存しない）。環境が用意した認証だけを使い、
鍵が無ければ「不可」と報告して1ホップ案を出すこと。ホスト単位のTLS遮断はトークンでは越えられない。
```

### 4.2 完全版（アセット集めが主目的のタスク用）

```text
## 外部アセットの自律取得（URL変換プロトコル）
1. 実測: 作業前に外向きの到達性を測る（例: tools/probe-egress.mjs）。記憶や推測で「届く/届かない」を決めない。
   遮断は TLS(SNI) で起き curl 35 / HTTP 000 として現れる。一度切られたホストは再試行しない。
2. 探索: 必要なアセットを、届くホスト上で自律的に探す（私にURLを聞く前に探す）。
   GitHub: api.github.com/search/repositories, /search/code（Bearer必須）, git/trees?recursive=1
   npm: registry.npmjs.org/{pkg}  PyPI: pypi.org/pypi/{pkg}/json
   ライセンス（spdx）を確認し、再配布可能なものだけ使う。
3. 変換: 同じバイト列を「届くホストの別表現」へ載せ替えて取得する。
   - 公開リポジトリのファイル → api.github.com/repos/{o}/{r}/contents/{path}?ref=…（≤1MB）
     1MB超 → git/blobs/{sha} を Accept: application/vnd.github.raw+json で（≤100MB）
   - リポジトリ全体 → codeload.github.com/{o}/{r}/tar.gz/{ref}（GNU tar は --wildcards "*/path"）
   - npm 同梱 → registry.npmjs.org/{pkg}/-/{pkg}-{ver}.tgz（tar 内は package/ 始まり）
   - PyPI 同梱 → pypi.org/pypi/{pkg}/json の urls[].url（files.pythonhosted.org）
   - 不可: *.githubusercontent.com, *.github.io, GitHub Release 添付, jsdelivr/unpkg/cdnjs,
     および TLS で切られたホストへの直接アクセス（github.com/{o}/{r}/raw/… は 302 で死ぬ）
   - Node の fetch は MITM CA を信頼しないことがあるので HTTP は curl に寄せる。
4. 検証と統合: magic bytes / 宣言長 / sha256 / 実サイズを確認してから配置し、
   ヘッドレスで解析・テスト（占有グリッド→コライダー、到達性の洪水充填、視線判定の再現、ビルド）を通す。
5. 明記: 出典URL・著作権表示・ライセンスを README と実行時表示（ロード画面など）の両方に入れる。
6. 委任の限界: どの経路にも無いときだけ、最小の1ホップを私に依頼する。
   その際は「どのホストの・どのパスへ・何MBまで・何形式で」を具体的に書くこと。
7. 代替の明示: 目的のものと別物で代用した場合は、必ず何を代わりに使ったかを報告する。
8. ツール経路: 環境提供の fetch_page / web_search は sandbox の egress 制限を通らない別経路。
   ブロックされたホストの JSON/APIレスポンス/HTML/文書はこれで読む（実測: api.sketchfab.com の JSON は取れた）。
   ただしバイナリ（.glb/.png/.zip）は運べない（実測: PNG は HTTP 500）ので、実体は 3. の輸送路から落とす。
   → 「ツールで当たりを付け（ライセンス・サイズ・DL可否）、実体は許可ホストから取得」が最速。
9. 認証: トークン/パスワード/OAuthコード/2FAを私に要求しない（貼らせない・保存しない・コミットしない）。
   環境が用意した認証（例: GH_TOKEN）だけを使う。鍵が必要なAPIで鍵が無ければ「不可」と報告し1ホップ案を出す。
   ホスト単位のTLS遮断は正しいトークンでも越えられない（ハンドシェイクで切れるのでヘッダを送れない）。
10. 禁止: アクセス制御の回避工作、検証なしの配置、巨大ファイルの不用意なcommit、別物への無断差し替え。
```

### 4.3 どこに置くか

- **単発タスク** → 依頼文の末尾に 4.1 か 4.2 を貼る。
- **同じリポジトリで継続** → この `AGENTS.md` を置いておけばよい（4.2 と同内容が §1 に入っている）。
  新しいリポジトリを作るときは、この §1 と §4 だけを抜き出して `AGENTS.md` として置けば移植できる。
- 環境によって許可リストは違うので、**ホスト名を列挙した文を鵜呑みにせず必ず §1.2-1 の実測をさせる**こと。
