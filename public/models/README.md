# 教室モデル（classroom.glb）

いま収録されているのは **The Japanese School Classroom** by [volvor](https://sketchfab.com/volvor) —
**CC-BY-4.0**（[モデルのページ](https://sketchfab.com/3d-models/the-japanese-school-classroom-d9fc039ba0b6433db91ec129abe86b52)）。

> This work is based on "The Japanese School Classroom"
> (https://sketchfab.com/3d-models/the-japanese-school-classroom-d9fc039ba0b6433db91ec129abe86b52)
> by volvor (https://sketchfab.com/volvor) licensed under CC-BY-4.0
> (http://creativecommons.org/licenses/by/4.0/)

- `classroom.glb` … 7.1 MB / 22,102 三角形 / 10 メッシュ / 8 マテリアル
- 部屋の実寸 … 7.10 × 7.86 m、床 y=0、天井 y=2.90、窓のある壁は -X、黒板は -Z
- 形状・マテリアルは無改変。テクスチャだけ 2K→1024 に縮小し、baseColor と emissive を WebP(q85) にした
  （normal / metallicRoughness は非可逆圧縮を避けて PNG のまま）

Vite の `public/` はそのまま配信されるので、ブラウザからは `./models/classroom.glb` で取得できます
（`npm run build` 後も同じパス）。このファイルが無い場合は three.js の手続き生成教室にフォールバックします。

## どうやって取得したか（この環境から再現できる手順）

このサンドボックスは `github.com` / `api.github.com` / `codeload.github.com` /
`registry.npmjs.org` / `pypi.org` / `files.pythonhosted.org` にしか出られません
（Sketchfab・S3・CloudFront・`raw.githubusercontent.com`・Google 系は TLS の SNI で遮断）。
Sketchfab のダウンロード API には認証ヘッダが必要で、`fetch_page` はヘッダを送れないため、
**同じモデルを再配布している GitHub リポジトリ**を探して取得しました。

1. `api.github.com` の Data API（`fetch_page` 経由）でライセンスと取得可否を確認する
   `GET /v3/models/{uid}` → `isDownloadable: true` / `price: null` / `license.label: CC Attribution`
2. **モデル UID で GitHub コード検索**してミラーを探す（コード検索は認証が必要）
   ```bash
   curl -sS -H "Authorization: Bearer $(gh auth token)" \
     "https://api.github.com/search/code?q=d9fc039ba0b6433db91ec129abe86b52"
   ```
   → `scene.gltf` / `scene.bin` / `license.txt` / `textures/*` を一式持つリポジトリが見つかる
3. 各ファイルを **blobs API** で落とす（`raw.githubusercontent.com` は遮断されているので使わない）
   ```bash
   curl -sS -H "Authorization: Bearer $(gh auth token)" \
     -H "Accept: application/vnd.github.raw+json" \
     "https://api.github.com/repos/{owner}/{repo}/git/blobs/{sha}" -o scene.bin
   ```
   sha は `GET /repos/{owner}/{repo}/contents/{path}` か git trees API で取る
4. `@gltf-transform/cli`（devDependency）で `.glb` にまとめて軽くする
   ```bash
   ./node_modules/.bin/gltf-transform copy     scene.gltf classroom_raw.glb   # 44 MB
   ./node_modules/.bin/gltf-transform resize   classroom_raw.glb c1024.glb --width 1024 --height 1024
   ./node_modules/.bin/gltf-transform webp     c1024.glb classroom.glb --quality 85 \
     --slots "{baseColorTexture,emissiveTexture}"
   ```
   （`npx gltf-transform` はリポジトリの外からだと失敗するので `node_modules/.bin/` を直接叩く。
   出力形式は拡張子で決まる）
5. 解析して配置を決める
   ```bash
   node tools/inspect-glb.mjs public/models/classroom.glb
   ```
   縮尺（units/m）・回転・部屋寸法・占有マップ・マテリアル／メッシュ別クラスタが出るので、
   それに合わせて `src/glb-content.js`（調べられる物とかけらの座標）を書く
6. 検証 … `node tools/smoke.mjs`（[11]〜[14] が GLB 用）、`node tools/audit.mjs`、`npx vite build`

`asset.extras` に作者・ライセンス・出典・タイトルが入っているので、モデル自体にも来歴が残ります。

## 別の .glb に差し替えたいとき

### A. GitHub に置く（自動取得できます）

このリポジトリ（または自分の別リポジトリ）に `.glb` をコミットしておけば、次だけで取得・検証・配置まで走ります。

```bash
npm run model:fetch
# 別のリポジトリ／パス／ブランチから取る場合
node tools/fetch-model.mjs --repo owner/name --ref main --path models/classroom.glb
# URL をそのまま渡す場合（github.com の blob/raw/tree URL、npm の tarball URL なども可）
node tools/fetch-model.mjs --url https://github.com/owner/repo/blob/main/models/classroom.glb
```

glTF バイナリかどうか（magic / version / 宣言長）を検証してから配置するので、
Git LFS のポインタファイルや `.gltf` テキストを掴まされることはありません。

> リリース添付（`releases/download/...`）と `raw.githubusercontent.com` は
> 許可ホストに含まれないため使えません。**リポジトリへのコミット**でお願いします
> （Web UI からのアップロードは 1 ファイル 25 MB まで、`git push` なら 100 MB まで）。

### B. 手元にダウンロードして渡す

1. Sketchfab にログインした状態でモデルのページを開く
2. **Download 3D Model** を押す（作者が許可していない場合は出ません。Store の有料モデルも不可）
3. フォーマットは **glTF（.glb）** を選ぶ
4. **ライセンス表記（`license.txt`）をそのまま残す** — CC-BY は作者表示が必須です
5. このフォルダに `classroom.glb` という名前で置く（`scene.gltf` + `scene.bin` + `textures/` のままでも可）

### 注意点

- 差し替えたら `node tools/inspect-glb.mjs` で間取りを取り直し、`src/glb-content.js` の座標を更新してください
  （部屋の寸法・黒板の向き・机の並びは モデルごとに違います）
- ライセンスが CC-BY 系のときは、`index.html` のロード画面と右下パネル、README、このファイルの
  クレジットも必ず差し替えること
- 30 MB を超える場合はテクスチャの縮小／WebP 化を（上の手順 4）
