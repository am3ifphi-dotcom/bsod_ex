#!/usr/bin/env python3
"""Subset Noto Sans JP to the glyphs actually used in the game UI.

Source: https://github.com/google/fonts/tree/main/ofl/notosansjp (OFL-1.1)
Usage: python3 scripts/make-font-subset.py /tmp/gfonts/ofl/notosansjp/"NotoSansJP[wght].ttf"
"""
import sys, glob, os, subprocess, tempfile

src = sys.argv[1] if len(sys.argv) > 1 else '/tmp/gfonts/ofl/notosansjp/NotoSansJP[wght].ttf'
chars = set()
for pat in ['index.html', 'src/**/*.js', 'src/**/*.css', 'src/*.js', 'src/*.css']:
    for f in glob.glob(pat, recursive=True):
        chars.update(open(f, encoding='utf-8').read())
# always include printable ASCII + common JP punctuation / symbols
chars.update(chr(c) for c in range(0x20, 0x7f))
chars.update('、。・「」『』（）〈〉《》【】…‥ー〜～：；！？　％※→←↑↓★☆●○■□◆◇—–―‑')
text = ''.join(sorted(c for c in chars if c.isprintable() or c == ' '))
print('glyphs in corpus:', len(text))

os.makedirs('public/fonts', exist_ok=True)
for weight, name in [(300, 'NotoSansJP-Light'), (400, 'NotoSansJP-Regular'), (500, 'NotoSansJP-Medium')]:
    with tempfile.NamedTemporaryFile(suffix='.ttf', delete=False) as tmp:
        inst = tmp.name
    subprocess.run([sys.executable, '-m', 'fontTools.varLib.instancer', src, f'wght={weight}',
                    '-o', inst], check=True, stdout=subprocess.DEVNULL)
    out = f'public/fonts/{name}.woff2'
    subprocess.run([sys.executable, '-m', 'fontTools.subset', inst,
                    '--text=' + text, '--flavor=woff2', '--layout-features=kern,liga',
                    '--desubroutinize', '--no-hinting', f'--output-file={out}'], check=True,
                   stdout=subprocess.DEVNULL)
    os.unlink(inst)
    print(out, round(os.path.getsize(out) / 1024, 1), 'KB')
