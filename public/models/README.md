# ここに元モデルを置く

Sketchfab の [Old Classroom](https://sketchfab.com/3d-models/old-classroom-be2db5bb488a4392abda0d36c7b46e71)
をダウンロードできたら、このフォルダに **`classroom.glb`** という名前で置いてください。

```
public/models/classroom.glb
```

Vite の `public/` はそのまま配信されるので、置いた瞬間に
ブラウザからは `./models/classroom.glb` で取得できます（`npm run build` 後も同じパス）。

## GitHub に置いたら、あとは自動で取得できます

このリポジトリ（または自分の別リポジトリ）に `.glb` をコミットしておけば、
こちら側は `github.com` / `api.github.com` / `codeload.github.com` に出られるので、
次のコマンドだけで取得・検証・配置まで走ります。

```bash
npm run model:fetch
# 別のリポジトリ／パス／ブランチから取る場合
node tools/fetch-model.mjs --repo owner/name --ref main --path models/classroom.glb
```

取得できる経路は 3 つあり、自動で順に試します（`--via contents|blob|tarball` で固定も可）。
glTF バイナリかどうか（magic / version / 宣言長）を検証してから配置するので、
Git LFS のポインタファイルや `.gltf` テキストを掴まされることはありません。

> リリース添付（releases/download/...）と `raw.githubusercontent.com` は
> このサンドボックスの許可ホストに含まれないため使えません。**リポジトリへのコミット**でお願いします。

## ダウンロード手順（ブラウザ側）

1. Sketchfab にログインした状態でモデルのページを開く
2. 「3D Model」タブの下、または右上の **Download 3D Model** を押す
   （作者がダウンロードを許可していない場合は表示されません）
3. フォーマットは **glTF（.glb）** を選ぶ
4. ライセンス表記（CC-BY など）をメモしておく — クレジット表記に使います

## 注意点

- `.glb` は 1 ファイルにまとまっている形式が扱いやすいです（`.gltf` + 別ファイルでも可）
- 100 MB を超える場合は、テクスチャを間引いた版をください
- Git に入れるので、サイズが大きい場合は Git LFS ではなく「リポジトリに直接」で構いません
