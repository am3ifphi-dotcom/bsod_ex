# ここに元モデルを置く

Sketchfab の [Old Classroom](https://sketchfab.com/3d-models/old-classroom-be2db5bb488a4392abda0d36c7b46e71)
をダウンロードできたら、このフォルダに **`classroom.glb`** という名前で置いてください。

```
public/models/classroom.glb
```

Vite の `public/` はそのまま配信されるので、置いた瞬間に
ブラウザからは `./models/classroom.glb` で取得できます（`npm run build` 後も同じパス）。

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
