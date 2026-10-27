#!/usr/bin/env bash
# 立ち絵を「切り絵用」アセットに加工する。
#
# 元絵 (assets_src/chara/*.png) をそのまま使うのではなく、
#  - 透明部分をトリムして人物の実寸を取得
#  - 高さ 1200px に正規化し、足元を下端・水平中央に固定
#  - パレットを 160 色に減色（印刷物＝紙の切り絵として扱うため）
#  という工程を挟むことで、3D 空間に置ける「紙の立ち人形」テクスチャを作る。
#
# 使い方:  bash tools/prepare-art.sh
set -euo pipefail

SRC_DIR="${1:-assets_src/chara}"
OUT_DIR="${2:-public/chara}"
mkdir -p "$OUT_DIR"

H=1200      # 正規化した人物の高さ(px)
W=480       # キャンバス幅(px)  ← 480/1200 = 0.4 → 3D では 0.688m 幅 / 1.72m 高

for src in "$SRC_DIR"/*.png; do
  name="$(basename "$src" .png)"
  out="$OUT_DIR/$name.png"

  convert "$src" \
    -trim +repage \
    -resize "x${H}" \
    -background none \
    -gravity south \
    -extent "${W}x${H}" \
    -colors 160 \
    -define png:compression-level=9 \
    -strip \
    "$out"

  printf '%-38s %s\n' "$name" "$(du -h "$out" | cut -f1)"
done

echo "done -> $OUT_DIR"
