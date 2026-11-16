#!/usr/bin/env python3
"""AVIF copies of the bundled sample photos (src/assets/news-*.jpg), kept only where they pay.

The JPEGs are already lossy, so each AVIF is measured against the JPEG as decoded (what people see today): the lowest
AVIF quality whose decode keeps SSIM ≥ TARGET (ffmpeg's ssim filter, all channels), full resolution. A photo whose
AVIF can't reach TARGET, or saves under MIN_SAVING, stays JPEG only. The JPEG remains the fallback for browsers that
can't decode AVIF (src/lib/image-fallback.ts). Run from the repo root: python3 scripts/encode-photos.py
"""
import glob, os, subprocess, tempfile
from PIL import Image

TARGET, MIN_SAVING = 0.985, 0.20
ROOT = os.path.join(os.path.dirname(__file__), '..', 'src', 'assets')

def ssim(a, b):
    err = subprocess.run(['ffmpeg', '-hide_banner', '-i', a, '-i', b, '-lavfi', 'ssim', '-f', 'null', '-'], capture_output=True, text=True, check=True).stderr
    return float([l for l in err.splitlines() if 'All:' in l][-1].split('All:')[1].split()[0])

with tempfile.TemporaryDirectory() as tmp:
    for src in sorted(glob.glob(os.path.join(ROOT, 'news-*.jpg'))):
        img = Image.open(src).convert('RGB'); ref = os.path.join(tmp, 'ref.png'); img.save(ref)
        out = src[:-4] + '.avif'; size = os.path.getsize(src); kept = None
        for q in range(40, 96, 2):
            img.save(os.path.join(tmp, 'q.avif'), 'AVIF', quality=q, speed=4)
            Image.open(os.path.join(tmp, 'q.avif')).convert('RGB').save(os.path.join(tmp, 'dec.png'))
            s = ssim(ref, os.path.join(tmp, 'dec.png'))
            if s >= TARGET:
                n = os.path.getsize(os.path.join(tmp, 'q.avif'))
                if n <= size * (1 - MIN_SAVING): os.replace(os.path.join(tmp, 'q.avif'), out); kept = (q, s, n)
                break
        name = os.path.basename(src)
        if kept: print(f'{name:24} {size:>7,} B JPEG → {kept[2]:>7,} B AVIF q{kept[0]} SSIM {kept[1]:.4f} ({100*(1-kept[2]/size):.0f}% smaller)')
        else:
            if os.path.exists(out): os.remove(out)
            print(f'{name:24} {size:>7,} B JPEG kept (no AVIF reached SSIM {TARGET} with ≥{int(MIN_SAVING*100)}% saving)')
