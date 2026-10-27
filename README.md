# BSOD_EX — ひとりで、しずかな夜に。

一人称視点で遊ぶ、短編ホラー／グリッチ体験です。静かな自室から始まり、PCの青いBSODに「食われる」ことで、画面の内側——BSODの青でできた異世界——へ落ちていきます。

## 遊び方

```bash
cd web
python3 -m http.server 8000
# → http://localhost:8000 を開く
```

WebGL2 対応ブラウザ（Chrome / Edge / Firefox 推奨）でプレイしてください。

| 操作 | 動作 |
| --- | --- |
| WASD / マウス | 自室・異世界を歩く（クリックで視点操作） |
| E / クリック | PCを調べる（近づいてから） |
| マウスクリック | BSODの「:(」を撫でる……そして、連打する |
| C | 異世界でコンソールを開く |
| ESC | モニターの観察から離れる / コンソールを閉じる |
| R | 最初からやり直す |

## 体験の流れ

1. **自室** — 夜の部屋。机の上のPCを調べる。
2. **BSOD** — 本物のWindows風ブルースクリーン。「:(」にカーソルを合わせてクリックすると、少しずつ——顔そのものが、狂っていく。
3. **捕食** — 連打の果てに、部屋ごとモニターの青へ引きずり込まれる。
4. **グリッチ世界** — BSODの青、白いエラー文字、破損したUIが漂う探索可能な3D世界。中心の巨大構造物に「WAKE_UP」の文字が彫られている。
5. **コンソール** — Cキーで開く。`HELP`、`STATUS`、`SCAN`……そして、発見した単語を入力する。
6. **崩壊と落下** — 世界が砕け、穴へ落ちる。落下の果てに、最初の自室。
7. **帰還** — モニターには、小さな異変が残る。Rキーで最初から。

## 構成

```
web/
  index.html        UIオーバーレイ
  js/
    main.js         状態機械・入力・アンビエンス演出
    bsod.js         本物風BSOD描画 + 「:(」の変質モーフ
    room.js         自室（DriveのベッドルームGLB + GitHubのPC props）
    glitchworld.js  BSOD異世界（地形・Cray-1構造物・WAKE_UP）
    cinematics.js   捕食遷移・崩壊・落下・帰還カメラ
    console.js      ゲーム内コンソール
    controls.js     一人称操作（ポインターロック）
    fx.js           画面空間グリッチ/吸引ポストパス
    audio.js        WebAudio マネージャ
  assets/glb        最適化済みGLB（meshopt + WebP）
  assets/audio      SE/BGM
  vendor/three      three.js r186 (vendored)
```

## アセット出典

詳細は [CREDITS.md](./CREDITS.md) を参照。
