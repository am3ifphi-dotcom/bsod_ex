#!/usr/bin/env python3
"""
BSOD_EX — GitHub-hosted external asset fetcher / converter.

Downloads *verified* files through the GitHub REST API (git blobs, base64):
  - PBR textures from mrdoob/three.js  (MIT License; the ambientCG set is CC0)
  - Lantern model from KhronosGroup/glTF-Sample-Assets (CC0, (c) 2017 Microsoft)

The Lantern's 2K PNG textures are down-scaled to 512px JPEGs and the .gltf
image URIs are rewritten, shrinking ~9.4 MB to roughly 1 MB (mesh untouched).

Usage:  python3 scripts/fetch_github_assets.py
Requires: Python 3.9+, Pillow (pip install pillow). Uses GITHUB_TOKEN env or
`gh auth token` when available (unauthenticated also works, 60 req/h limit).
All outputs are written under public/ and are safe to re-run (idempotent).
"""
import base64, io, json, os, subprocess, sys, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API = "https://api.github.com"

def token():
    t = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    if t: return t
    try:
        return subprocess.check_output(["gh", "auth", "token"], text=True, timeout=10).strip() or None
    except Exception:
        return None

TOK = token()
def api(path):
    req = urllib.request.Request(API + path, headers={
        "Accept": "application/vnd.github+json",
        "User-Agent": "bsod-ex-asset-fetcher",
        **({"Authorization": f"Bearer {TOK}"} if TOK else {}),
    })
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode())

def blob(repo, sha):
    d = api(f"/repos/{repo}/git/blobs/{sha}")
    assert d.get("encoding") == "base64", d
    return base64.b64decode(d["content"])

def list_dir(repo, path):
    return {e["name"]: e for e in api(f"/repos/{repo}/contents/{path}") if e["type"] == "file"}

def save(relpath, data: bytes):
    p = os.path.join(ROOT, relpath)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "wb") as f: f.write(data)
    print(f"  -> {relpath}  ({len(data)/1024:.0f} KiB)")

THREE = "mrdoob/three.js"
TEXTURES = [  # (dir in repo, [files], out dir)
    ("examples/textures", ["hardwood2_diffuse.jpg", "hardwood2_bump.jpg", "hardwood2_roughness.jpg",
                           "brick_diffuse.jpg", "brick_bump.jpg", "brick_roughness.jpg"], "public/textures/ext"),
    ("examples/textures/floors", ["FloorsCheckerboard_S_Diffuse.jpg", "FloorsCheckerboard_S_Normal.jpg"], "public/textures/ext"),
    ("examples/textures/ambientcg", ["Ice002_1K-JPG_Color.jpg", "Ice002_1K-JPG_NormalGL.jpg", "Ice002_1K-JPG_Roughness.jpg"], "public/textures/ext"),
]

def fetch_textures():
    print("[1/2] three.js PBR textures (MIT / ambientCG CC0)")
    for d, files, out in TEXTURES:
        listing = list_dir(THREE, d)
        for name in files:
            if name not in listing:
                print(f"  !! MISSING in repo: {d}/{name} (skipped)"); continue
            save(f"{out}/{name}", blob(THREE, listing[name]["sha"]))

def fetch_Lantern():
    print("[2/2] Khronos Lantern model (CC0) + texture downscale to 512px JPEG")
    from PIL import Image
    repo, d = "KhronosGroup/glTF-Sample-Assets", "Models/Lantern/glTF"
    listing = list_dir(repo, d)
    print("  files:", ", ".join(sorted(listing)))
    gltf_name = next(n for n in listing if n.endswith(".gltf"))
    gltf = json.loads(blob(repo, listing[gltf_name]["sha"]).decode())
    for name, e in listing.items():
        if name.endswith(".bin"):
            save(f"public/models/Lantern/{name}", blob(repo, e["sha"]))
    for img in gltf.get("images", []):
        uri = img["uri"]
        raw = blob(repo, listing[uri]["sha"])
        im = Image.open(io.BytesIO(raw)).convert("RGB")
        im.thumbnail((512, 512), Image.LANCZOS)
        new = os.path.splitext(uri)[0] + ".jpg"
        buf = io.BytesIO(); im.save(buf, "JPEG", quality=82)
        save(f"public/models/Lantern/{new}", buf.getvalue())
        img["uri"] = new; img.pop("mimeType", None)
    save(f"public/models/Lantern/{gltf_name}", json.dumps(gltf).encode())

if __name__ == "__main__":
    try:
        fetch_textures(); fetch_Lantern()
        print("DONE. External assets are in public/textures/ext and public/models/Lantern")
    except urllib.error.URLError as e:
        print("Network/API error:", e, "\nThe game still runs: every external texture has a procedural fallback.", file=sys.stderr)
        sys.exit(1)
