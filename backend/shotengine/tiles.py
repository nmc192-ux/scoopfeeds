"""Esri World Imagery mosaics for SatZoom.

For each integer zoom level a SatZoom camera passes through, fetch just the
tiles its viewport touches (plus a margin) and stitch them into one image.
Tiles are cached on disk by z/x/y, so a second short over the same place costs
nothing; the renderer keeps only the finished MP4.

Credit on screen: "Imagery: Esri World Imagery (Maxar, Earthstar Geographics)".
"""
import os, math, time, urllib.request
import numpy as np
from PIL import Image
from io import BytesIO

TILE = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
UA = 'Scoopfeeds-ShotEngine/1.0 (+https://scoopfeeds.com; contact: ops@scoopfeeds.com)'
MAX_TILES_PER_LEVEL = 140
CACHE = os.environ.get('SHOT_TILE_CACHE') or os.path.join(
    os.environ.get('SCOOP_PERSISTENT_DATA_DIR', os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data')), 'tile-cache')

def _unit(lat, lon):
    lat = max(-85, min(85, lat))
    return (lon + 180) / 360, (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2

def fetch_tile(z, x, y):
    path = os.path.join(CACHE, str(z), str(x), f'{y}.jpg')
    if os.path.exists(path) and os.path.getsize(path) > 500:
        return Image.open(path).convert('RGB')
    req = urllib.request.Request(TILE.format(z=z, x=x, y=y), headers={'User-Agent': UA})
    for attempt in range(3):
        try:
            data = urllib.request.urlopen(req, timeout=15).read()
            if data[:2] != b'\xff\xd8' and data[:4] != b'\x89PNG':
                raise ValueError('not an image')
            os.makedirs(os.path.dirname(path), exist_ok=True)
            open(path, 'wb').write(data)
            return Image.open(BytesIO(data)).convert('RGB')
        except Exception:
            time.sleep(0.5 * (attempt + 1))
    return Image.new('RGB', (256, 256), (13, 16, 19))

def mosaics_for(keys, fps=24, W=1080, H=1920, cy=0.42):
    """keys: [(t, Z, lat, lon)] as SatZoom takes them. Returns {L: (ndarray, x0, y0)}."""
    from engine import SatZoom
    probe = SatZoom(keys, {0: (np.zeros((1, 1, 3), np.uint8), 0, 0)})
    t0, t1 = keys[0][0], keys[-1][0]
    ts = np.linspace(t0, t1 + 0.01, max(2, int((t1 - t0) * 4) + 2))
    need = {}
    for t in ts:
        Z, c = probe.cam(t)
        L = int(max(1, min(18, math.floor(Z))))
        sc = 2 ** (Z - L)
        half_w, top, bot = W / 2 / sc, H * cy / sc, H * (1 - cy) / sc
        px, py = c[0] * 256 * 2 ** L, c[1] * 256 * 2 ** L
        box = need.setdefault(L, [math.inf, math.inf, -math.inf, -math.inf])
        box[0] = min(box[0], px - half_w); box[1] = min(box[1], py - top)
        box[2] = max(box[2], px + half_w); box[3] = max(box[3], py + bot)
    out = {}
    for L, (x0, y0, x1, y1) in need.items():
        n = 2 ** L
        tx0, ty0 = max(0, int(x0 // 256) - 1), max(0, int(y0 // 256) - 1)
        tx1, ty1 = min(n - 1, int(x1 // 256) + 1), min(n - 1, int(y1 // 256) + 1)
        if (tx1 - tx0 + 1) * (ty1 - ty0 + 1) > MAX_TILES_PER_LEVEL:
            # Too wide for this level: keep the centre of the box, stated not silent.
            cxm, cym = (tx0 + tx1) / 2, (ty0 + ty1) / 2
            half = int(math.sqrt(MAX_TILES_PER_LEVEL) / 2)
            tx0, tx1 = int(cxm - half), int(cxm + half); ty0, ty1 = int(cym - half), int(cym + half)
            print(f'tiles: level {L} capped to {(tx1 - tx0 + 1) * (ty1 - ty0 + 1)} tiles', flush=True)
        img = Image.new('RGB', ((tx1 - tx0 + 1) * 256, (ty1 - ty0 + 1) * 256))
        for ty in range(ty0, ty1 + 1):
            for tx in range(tx0, tx1 + 1):
                img.paste(fetch_tile(L, tx % n, ty), ((tx - tx0) * 256, (ty - ty0) * 256))
        out[L] = (np.array(img), tx0, ty0)
    return out
