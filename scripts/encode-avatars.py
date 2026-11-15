#!/usr/bin/env python3
"""Re-encode the bundled memoji avatar presets (1024 px PNG masters, ~1 MB each) for the web.

Avatars display at most at 96 CSS px (desktop profile) → 288 device px at 3x, so 512 px leaves headroom. For each
preset this resizes the master with Lanczos, then picks the lowest quality whose decoded image keeps SSIM ≥ TARGET
against that resized reference (ffmpeg's ssim filter, all channels), for AVIF (libavif/aom via Pillow) and WebP
(libwebp, method 6). AVIF is what Atlas serves; WebP is the fallback for the few browsers without AVIF.

Run from the repo root: python3 scripts/encode-avatars.py
"""
import os, subprocess, tempfile
from PIL import Image

SIZE, TARGET = 512, 0.985
ROOT = os.path.join(os.path.dirname(__file__), '..', 'src', 'assets', 'avatars')

def ssim(a: str, b: str) -> float:
    err = subprocess.run(['ffmpeg', '-hide_banner', '-i', a, '-i', b, '-lavfi', 'ssim', '-f', 'null', '-'],
                         capture_output=True, text=True, check=True).stderr
    return float([l for l in err.splitlines() if 'All:' in l][-1].split('All:')[1].split()[0])

def encode(img, fmt, q, path):
    if fmt == 'avif': img.save(path, 'AVIF', quality=q, speed=4)
    else: img.save(path, 'WEBP', quality=q, method=6)

def best(img, fmt, ref, tmp):
    for q in range(30, 101, 2):
        out = os.path.join(tmp, f'q.{fmt}')
        encode(img, fmt, q, out)
        dec = os.path.join(tmp, 'dec.png'); Image.open(out).convert('RGB').save(dec)
        s = ssim(ref, dec)
        if s >= TARGET: return q, s
    raise SystemExit(f'{fmt}: no quality reached SSIM {TARGET}')

with tempfile.TemporaryDirectory() as tmp:
    print(f'{"preset":10} {"png":>9} {"avif":>16} {"webp":>16}')
    for n in range(1, 5):
        src = os.path.join(ROOT, f'avatar-{n}.png')
        img = Image.open(src).convert('RGB').resize((SIZE, SIZE), Image.LANCZOS)
        ref = os.path.join(tmp, 'ref.png'); img.save(ref)
        row = [f'avatar-{n}', f'{os.path.getsize(src):>9,}']
        for fmt in ('avif', 'webp'):
            q, s = best(img, fmt, ref, tmp)
            out = os.path.join(ROOT, f'avatar-{n}.{fmt}')
            encode(img, fmt, q, out)
            row.append(f'{os.path.getsize(out):>7,} q{q} {s:.4f}')
        print(' '.join(f'{c:>16}' if i else f'{c:10}' for i, c in enumerate(row)))
