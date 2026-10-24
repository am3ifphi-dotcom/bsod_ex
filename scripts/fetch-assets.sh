#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# fetch-assets.sh
#
# Downloads the upstream, licence-checked 3D assets used by BSOD_EX into
# .asset-cache/ (git-ignored).  Nothing in this script touches the network
# outside of github.com / registry.npmjs.org, and every model that is pulled
# in is listed below together with the licence recorded in the upstream
# KhronosGroup/glTF-Sample-Assets repository.
#
#   CC0-1.0     public domain, no attribution required (credited anyway)
#   CC-BY-4.0   attribution required -> see CREDITS.md / in-game credits
#
# Usage:  bash scripts/fetch-assets.sh
# ---------------------------------------------------------------------------
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CACHE="$ROOT/.asset-cache"
GSA="$CACHE/glTF-Sample-Assets"
SPARSE="Sponza" # placeholder, replaced below

# --- models consumed by the game (CC0 unless noted) -------------------------
MODELS=(
  "SheenChair"                 # CC0        desk chair (room)
  "DiffuseTransmissionPlant"   # CC-BY-4.0  potted plant (room)
  "WaterBottle"                # CC0        water bottle (room desk)
  "Lantern"                    # CC0        hanging lantern (room / deep layer)
  "GlassVaseFlowers"           # CC0        vase with flowers (room shelf)
  "SciFiHelmet"                # CC0        floating monolith fragment (world)
  "AntiqueCamera"              # CC0        floating fragment (world)
  "PotOfCoals"                 # CC-BY-4.0  embers in the deep layer
  "DamagedHelmet"              # CC-BY-4.0  floating fragment (world)
  "CarConcept"                 # CC-BY-4.0  wrecked car (city area)
  "GlassBrokenWindow"          # CC-BY-4.0  shattered window shards (city)
  "GlamVelvetSofa"             # CC-BY-4.0  floating furniture (world)
  "ABeautifulGame"             # CC-BY-4.0  chess pieces in the wasteland
  "ChronographWatch"           # CC-BY-4.0  watch on the desk (room)
  "GlassHurricaneCandleHolder" # CC-BY-4.0  candle holder (room)
)

mkdir -p "$CACHE"

# === 1. Khronos glTF Sample Assets ==========================================
if [ ! -d "$GSA/Models/SheenChair" ]; then
  echo ">> cloning KhronosGroup/glTF-Sample-Assets (blobless, sparse)"
  rm -rf "$GSA"
  git clone --filter=blob:none --no-checkout --depth 1 \
      https://github.com/KhronosGroup/glTF-Sample-Assets.git "$GSA"
  (
    cd "$GSA"
    git sparse-checkout init --cone
    args=()
    for m in "${MODELS[@]}"; do args+=("Models/$m"); done
    args+=("LICENSES" "Models/model-index.json" "Models/Models-core.md" "Models/Models-extension.md")
    git sparse-checkout set --cone "${args[@]}"
    git checkout
  )
else
  echo ">> glTF-Sample-Assets already present"
fi

# === 2. @pmndrs/assets — CC0 HDRIs =========================================
PMND="$CACHE/pmndrs"
if [ ! -f "$PMND/assets.tgz" ]; then
  echo ">> downloading @pmndrs/assets (CC0 HDRIs)"
  mkdir -p "$PMND"
  # Resolve the current tarball straight from the npm registry metadata.
  url=$(curl -s https://registry.npmjs.org/@pmndrs%2Fassets \
        | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(j.versions[j["dist-tags"].latest].dist.tarball)})')
  echo "   -> $url"
  curl -sL "$url" -o "$PMND/assets.tgz"
  mkdir -p "$PMND/package"
  tar xzf "$PMND/assets.tgz" -C "$PMND"
fi

# === 3. sanity check =======================================================
missing=0
for m in "${MODELS[@]}"; do
  if [ ! -f "$GSA/Models/$m/glTF-Binary/$m.glb" ] && [ ! -f "$GSA/Models/$m/glTF/$m.gltf" ]; then
    echo "!! missing $m(.glb|.gltf)" >&2
    missing=1
  fi
  if [ ! -f "$GSA/Models/$m/LICENSE.md" ]; then
    echo "!! missing licence for $m" >&2
    missing=1
  fi
done
[ -f "$PMND/package/hdri/night.exr.js" ] || { echo "!! missing HDRI" >&2; missing=1; }
if [ "$missing" -ne 0 ]; then
  echo "Asset fetch incomplete; aborting." >&2
  exit 1
fi
echo ">> all source assets present in $CACHE"
