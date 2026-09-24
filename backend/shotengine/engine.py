"""ScoopFeeds shot engine — vertical primitives and shot classes.

Adapted from the approved Greenland sample's engine (docs/reference/shot-engine/
vengine.py + short.py). Changes from the reference, each deliberate:
  - fonts from backend/assets/fonts (Anton) and assets/fonts/shot (OFL faces);
    scripts those faces lack (CJK, Arabic, ...) fall back to a Noto subset
    fetched once from Google Fonts and cached (see fallback_font);
  - geography from the shipped Natural Earth files (countries-50m.geo.json keyed
    by ISO3 `id`, cities-50m.json, marine-10m.json label points) — no runtime
    fetch except Esri tiles for SatZoom (tiles.py);
  - the subject is framed ABOVE the caption band: map and satellite cameras
    centre at CY (0.42 H), not H/2, because captions start at y 1190;
  - vertical chrome at the brief's safe zones (kicker/brand y 250, source
    baseline 1432, credit baseline 1474, nothing at x > 950 in y 1000-1700).
"""
import os, re, json, math, subprocess, hashlib, urllib.request, urllib.parse
import numpy as np, cv2
from PIL import Image, ImageDraw, ImageFont

W, H, FPS = 1080, 1920, 24
CY = int(H * 0.42)          # where map/satellite subjects sit — above the captions
M = 54                      # side margin (brief §1.6)
INK = (9, 7, 6); LIME = (221, 231, 6); BONE = (238, 234, 224); GREY = (150, 144, 134); DIM = (62, 58, 52)
RED = (232, 64, 52); PAPER = (246, 242, 233); OCEAN = (13, 16, 19); LAND = (40, 38, 34)
WHITE = (255, 255, 255); BLACK = (0, 0, 0); SEA_TEXT = (96, 128, 150)
MAX_AUTO_LABELS = 6

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, '..', 'assets')
FONT_DIR = os.path.join(ASSETS, 'fonts')
SHOT_FONTS = os.path.join(FONT_DIR, 'shot')
GEO_DIR = os.path.join(ASSETS, 'geo')
FONT_CACHE = os.environ.get('SHOT_FONT_CACHE') or os.path.join(
    os.environ.get('SCOOP_PERSISTENT_DATA_DIR', os.path.join(HERE, '..', 'data')), 'font-cache')

_fc = {}
def font(path, size, var=None):
    k = (path, size, var)
    if k not in _fc:
        f = ImageFont.truetype(path, size)
        if var:
            try: f.set_variation_by_name(var)
            except Exception: pass
        _fc[k] = f
    return _fc[k]

ANTON = lambda s: font(os.path.join(FONT_DIR, 'Anton-Regular.ttf'), s)
INTER = lambda s, v='Regular': font(os.path.join(SHOT_FONTS, 'Inter.ttf'), s, v)
OSW = lambda s, v='Bold': font(os.path.join(SHOT_FONTS, 'Oswald.ttf'), s, v)
MONO = lambda s: font(os.path.join(SHOT_FONTS, 'IBMPlexMono-Medium.ttf'), s)
SERIF = lambda s: font(os.path.join(SHOT_FONTS, 'LibreBaskerville-Regular.ttf'), s)
SERIFI = lambda s: font(os.path.join(SHOT_FONTS, 'LibreBaskerville-Italic.ttf'), s)

# ─── Script fallback ────────────────────────────────────────────────────────
_SCRIPTS = [
    (re.compile(r'[぀-ヿ]'), 'Noto Sans JP'),
    (re.compile(r'[가-힯ᄀ-ᇿ]'), 'Noto Sans KR'),
    (re.compile(r'[一-鿿㐀-䶿]'), 'Noto Sans SC'),
    (re.compile(r'[؀-ۿ]'), 'Noto Sans Arabic'),
    (re.compile(r'[֐-׿]'), 'Noto Sans Hebrew'),
    (re.compile(r'[ऀ-ॿ]'), 'Noto Sans Devanagari'),
    (re.compile(r'[฀-๿]'), 'Noto Sans Thai'),
]
def needs_fallback(text):
    for rx, fam in _SCRIPTS:
        if rx.search(text or ''): return fam
    return None

def _is_font(b):
    return len(b) > 100 and (b[:4] in (b'\x00\x01\x00\x00', b'OTTO', b'true'))

def fallback_font(text, size):
    """A Noto face subset to exactly `text`'s characters, cached; None on any failure."""
    fam = needs_fallback(text)
    if not fam: return None
    chars = ''.join(sorted(set(text)))
    key = hashlib.sha1(f'{fam}|{chars}'.encode()).hexdigest()[:20]
    path = os.path.join(FONT_CACHE, key + '.ttf')
    try:
        if not (os.path.exists(path) and _is_font(open(path, 'rb').read(8) + b'x' * 200)):
            css = urllib.request.urlopen(
                f'https://fonts.googleapis.com/css2?family={urllib.parse.quote(fam)}&text={urllib.parse.quote(chars)}', timeout=8).read().decode()
            m = re.search(r"src:\s*url\(([^)]+)\)\s*format\('(?:truetype|opentype)'\)", css)
            if not m: return None
            data = urllib.request.urlopen(m.group(1), timeout=8).read()
            if not _is_font(data): return None
            os.makedirs(FONT_CACHE, exist_ok=True)
            open(path, 'wb').write(data)
        return font(path, size)
    except Exception:
        return None

def safe_font(text, f):
    """`f`, unless the text needs a script it lacks — then a Noto fallback at the same size."""
    if not needs_fallback(text): return f
    fb = fallback_font(text, f.size)
    return fb or f

def clamp(x, a=0.0, b=1.0): return max(a, min(b, x))
def eo(x): x = clamp(x); return 1 - (1 - x) ** 3
def eio(x): x = clamp(x); return x * x * (3 - 2 * x)
def prog(t, t0, d=0.6): return clamp((t - t0) / d) if d > 0 else float(t >= t0)
def lerp(a, b, x): return a + (b - a) * x

# ─── Text patches ───────────────────────────────────────────────────────────
_tc = {}
def tpatch(text, f, fill=WHITE, bg=None, pad=(0, 0), track=0, stroke=0):
    f = safe_font(text, f)
    key = (text, id(f), fill, bg, pad, track, stroke)
    if key in _tc: return _tc[key]
    l, t, r, b = f.getbbox(text if text else ' ', stroke_width=stroke)
    if track:
        ws = [f.getlength(c) for c in text]; tw = int(sum(ws) + track * max(0, len(text) - 1)) + 2
    else:
        tw = int(math.ceil(max(r, f.getlength(text)))) + 2 + 2 * stroke
    th = b - t
    w, h = tw + 2 * pad[0], th + 2 * pad[1]
    im = Image.new('RGBA', (max(w, 1), max(h, 1)), (bg + (255,)) if bg else (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if track:
        x = pad[0]
        for c, wc in zip(text, ws): d.text((x, pad[1] - t), c, font=f, fill=fill); x += wc + track
    else:
        d.text((pad[0] + stroke, pad[1] - t), text, font=f, fill=fill, stroke_width=stroke, stroke_fill=(0, 0, 0))
    a = np.array(im); _tc[key] = a; return a

def wrap(text, f, maxw):
    out, cur = [], ''
    for w in text.split():
        cand = (cur + ' ' + w).strip()
        if f.getlength(cand) <= maxw or not cur: cur = cand
        else: out.append(cur); cur = w
    if cur: out.append(cur)
    return out

def blit(dst, p, x, y, a=1.0, anchor='lt', wipe=1.0):
    if a <= 0.003 or wipe <= 0.003: return
    if wipe < 1: p = p[:, :max(1, int(p.shape[1] * wipe))]
    h, w = p.shape[:2]
    if anchor[0] == 'c': x -= w / 2
    elif anchor[0] == 'r': x -= w
    if anchor[1] == 'c': y -= h / 2
    elif anchor[1] == 'b': y -= h
    x, y = int(round(x)), int(round(y))
    x0, y0, x1, y1 = max(x, 0), max(y, 0), min(x + w, W), min(y + h, H)
    if x0 >= x1 or y0 >= y1: return
    sp = p[y0 - y:y1 - y, x0 - x:x1 - x]
    al = sp[..., 3:4].astype(np.float32) * (a / 255.0)
    dr = dst[y0:y1, x0:x1]
    dr[:] = (sp[..., :3] * al + dr * (1 - al)).astype(np.uint8)

def rect(dst, x0, y0, x1, y1, col, a=1.0):
    x0, y0, x1, y1 = [int(round(v)) for v in (max(x0, 0), max(y0, 0), min(x1, W), min(y1, H))]
    if x1 <= x0 or y1 <= y0 or a <= 0: return
    r = dst[y0:y1, x0:x1]
    if a >= 1: r[:] = col
    else: r[:] = (r * (1 - a) + np.array(col, np.float32) * a).astype(np.uint8)

def darken(f, amt):
    if amt > 0: cv2.convertScaleAbs(f, dst=f, alpha=1 - amt)

_yy, _xx = np.mgrid[0:H, 0:W].astype(np.float32)
_d = np.sqrt(((_xx - W / 2) / (W / 2)) ** 2 + ((_yy - H / 2) / (H / 2)) ** 2)
_v = np.clip(1 - 0.55 * np.clip(_d - 0.6, 0, None) ** 1.5, 0.45, 1)
VIG = (np.dstack([_v] * 3) * 255).astype(np.uint8); del _yy, _xx, _d, _v
def vignette(f): cv2.multiply(f, VIG, dst=f, scale=1 / 255.0)

def blank(col=INK):
    f = np.empty((H, W, 3), np.uint8); f[:] = col; return f

def bar_label(dst, text, x, y, size=96, fg=WHITE, bg=BLACK, a=1.0, anchor='lt', wipe=1.0, font_fn=None):
    p = tpatch(text, (font_fn or ANTON)(size), fg, bg, (int(size * .32), int(size * .22)))
    blit(dst, p, x, y, a, anchor, wipe)

# ─── Vertical chrome (brief §1.6) ───────────────────────────────────────────
def kicker(dst, text, a=1.0):
    blit(dst, tpatch(text.upper(), OSW(38, 'SemiBold'), INK, LIME, (16, 9), track=3), M, 250, a)
def source_line(dst, text, a=1.0):
    blit(dst, tpatch('SOURCE  ' + text.upper(), MONO(24), (215, 211, 200), (12, 10, 9), (14, 8)), M, 1432, a * 0.92, 'lb')
def credit_line(dst, text, a=1.0):
    blit(dst, tpatch(text, MONO(22), (215, 211, 200), (12, 10, 9), (12, 7)), M, 1474, a * 0.85, 'lb')
BRAND = None
def brand(dst):
    global BRAND
    if BRAND is None: BRAND = tpatch('SCOOPFEEDS', ANTON(44), LIME)
    blit(dst, BRAND, W - M, 250, 0.6, 'rt')

class Shot:
    t0 = 0.0; T = 1.0; vign = False; kick = None; src = None; cred = None; caps = True; chrome = True
    labels = ()
    def frame(self, tl): raise NotImplementedError
    def post(self, f, tl):
        if self.vign: vignette(f)
        if not self.chrome: return
        if self.kick: kicker(f, self.kick, prog(tl, 0.1, 0.35))
        if self.src: source_line(f, self.src, prog(tl, 0.3, 0.4))
        if self.cred: credit_line(f, self.cred, prog(tl, 0.3, 0.4))
        brand(f)

def draw_labels(f, tl, s):
    """Name labels. A later label REPLACES the earlier one (brief, Phase 4: the
    label changes as the camera arrives at each person) — only the latest shows."""
    live = [L for L in s.labels if tl >= L.get('t', 0.4)]
    if not live: return
    L = live[-1]
    e = eo(prog(tl, L.get('t', 0.4), 0.4))
    bar_label(f, L['text'], M, L.get('y', 1080), L.get('size', 56), INK, LIME, 1, 'lb', e)

# ─── Photos ─────────────────────────────────────────────────────────────────
def load_rgb(path, maxw=5600):
    im = Image.open(path).convert('RGB')
    if im.width > maxw: im = im.resize((maxw, int(im.height * maxw / im.width)), Image.LANCZOS)
    return np.array(im)

class Photo(Shot):
    """kb: ((cx,cy,zoom),(cx,cy,zoom)) — a slow push-in (approved in the sample)."""
    def __init__(s, path, kb=((0.5, 0.5, 1.02), (0.5, 0.5, 1.08)), contain=False, dark=0.0, labels=(), overlay=None, **chrome):
        s.path, s.kb, s.contain, s.dark, s.labels, s.overlay = path, kb, contain, dark, labels, overlay
        s.vign = True; s.img = None
        for k, v in chrome.items(): setattr(s, k, v)
    def load(s):
        img = load_rgb(s.path); s.img = img; h, w = img.shape[:2]
        if s.contain:
            sm = cv2.resize(img, (480, int(480 * h / w))); sm = cv2.GaussianBlur(sm, (0, 0), 18)
            sc = max(W / sm.shape[1], H / sm.shape[0])
            bg = cv2.resize(sm, (int(sm.shape[1] * sc) + 2, int(sm.shape[0] * sc) + 2), interpolation=cv2.INTER_LINEAR)
            y0 = (bg.shape[0] - H) // 2; x0 = (bg.shape[1] - W) // 2
            s.bg = np.ascontiguousarray(bg[y0:y0 + H, x0:x0 + W]); darken(s.bg, 0.55)
            b = 14; s.img = cv2.copyMakeBorder(img, b, b, b, b, cv2.BORDER_CONSTANT, value=PAPER)
    def frame(s, tl):
        if s.img is None: s.load()
        h, w = s.img.shape[:2]
        e = eio(tl / max(s.T, 0.01))
        (ax, ay, az), (bx, by, bz) = s.kb
        cx, cy, z = lerp(ax, bx, e), lerp(ay, by, e), lerp(az, bz, e)
        if s.contain:
            k = min(W * 0.84 / w, H * 0.52 / h) * z
            f = s.bg.copy()
            Mx = np.float32([[k, 0, W / 2 - k * w / 2], [0, k, CY - k * h / 2]])
            cv2.warpAffine(s.img, Mx, (W, H), dst=f, flags=cv2.INTER_AREA if k < 1 else cv2.INTER_LINEAR, borderMode=cv2.BORDER_TRANSPARENT)
        else:
            k = max(W / w, H / h) * z
            hx, hy = W / (2 * k), H / (2 * k)
            px = clamp(cx * w, hx, w - hx); py = clamp(cy * h, hy, h - hy)
            Mx = np.float32([[k, 0, W / 2 - k * px], [0, k, H / 2 - k * py]])
            f = cv2.warpAffine(s.img, Mx, (W, H), flags=cv2.INTER_AREA if k < 1 else cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
        darken(f, s.dark)
        if s.overlay: s.overlay(f, tl, s)
        draw_labels(f, tl, s)
        return f

# ─── Footage with a moving 9:16 crop window ─────────────────────────────────
class Clip(Shot):
    """cams: [(abs_t, cx, cy, zoom)] in source-normalised coords. ymax crops burned-in banners.
    `path` is the LOCAL padded window the Node side fetched; `start` is the in-point inside it."""
    def __init__(s, path, start, cams, ymax=1.0, dark=0.0, labels=(), overlay=None, speed=1.0, **chrome):
        s.path, s.start, s.cams, s.ymax, s.dark, s.labels, s.overlay, s.speed = path, start, cams, ymax, dark, labels, overlay, speed
        s.vign = True; s.proc = None; s.last = None; s.sw = s.sh = None
        for k, v in chrome.items(): setattr(s, k, v)
    def _open(s):
        if s.sw is None:
            out = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height',
                                  '-of', 'csv=p=0', s.path], capture_output=True, text=True).stdout.strip().split(',')
            iw, ih = (int(out[0]), int(out[1])) if len(out) == 2 and out[0].isdigit() else (1920, 1080)
            s.sh = 1080; s.sw = int(round(iw * 1080 / ih / 2)) * 2
        vf = f"fps={FPS / s.speed},scale={s.sw}:{s.sh}"
        s.proc = subprocess.Popen(['ffmpeg', '-v', 'error', '-ss', str(max(0, s.start)), '-i', s.path, '-t', str(s.T * s.speed + 2), '-vf', vf,
                                   '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], stdout=subprocess.PIPE, bufsize=s.sw * s.sh * 3 * 2)
    def cam(s, ta):
        cs = s.cams
        if ta <= cs[0][0]: return cs[0][1:]
        for a, b in zip(cs, cs[1:]):
            if ta <= b[0]:
                p = eio((ta - a[0]) / max(b[0] - a[0], 1e-3)); return tuple(lerp(x, y, p) for x, y in zip(a[1:], b[1:]))
        return cs[-1][1:]
    def frame(s, tl):
        if s.proc is None: s._open()
        n = s.sw * s.sh * 3
        buf = s.proc.stdout.read(n)
        if len(buf) == n: s.last = np.frombuffer(buf, np.uint8).reshape(s.sh, s.sw, 3)
        src = s.last if s.last is not None else np.zeros((s.sh, s.sw, 3), np.uint8)
        cx, cy, z = s.cam(s.t0 + tl)
        hh = s.sh * s.ymax / z; ww = hh * W / H
        if ww > s.sw: ww = s.sw; hh = ww * H / W
        x0 = clamp(cx * s.sw - ww / 2, 0, s.sw - ww); y0 = clamp(cy * s.sh - hh / 2, 0, s.sh * s.ymax - hh)
        k = H / hh
        Mx = np.float32([[k, 0, -k * x0], [0, k, -k * y0]])
        f = cv2.warpAffine(src, Mx, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        darken(f, s.dark)
        if s.overlay: s.overlay(f, tl, s)
        draw_labels(f, tl, s)
        return f
    def close(s):
        if s.proc: s.proc.kill(); s.proc = None

# ─── Satellite zoom ─────────────────────────────────────────────────────────
def unit(lat, lon):
    return (lon + 180) / 360, (1 - math.asinh(math.tan(math.radians(clamp(lat, -85, 85)))) / math.pi) / 2

class SatZoom(Shot):
    """keys: [(abs_t, Z, lat, lon)]. Mosaics per integer zoom come from tiles.py:
    mosaics[L] = (image ndarray, x0_tile, y0_tile)."""
    def __init__(s, keys, mosaics, labels=(), dark=0.0, **chrome):
        s.keys, s.mosaics, s.slabels, s.dark = keys, mosaics, labels, dark
        s.vign = True
        for k, v in chrome.items(): setattr(s, k, v)
    def cam(s, ta):
        ks = s.keys
        if ta <= ks[0][0]: return ks[0][1], unit(ks[0][2], ks[0][3])
        for (t0, z0, la0, lo0), (t1, z1, la1, lo1) in zip(ks, ks[1:]):
            if ta <= t1:
                p = eio((ta - t0) / max(t1 - t0, 1e-3)); Z = lerp(z0, z1, p)
                u0, u1 = np.array(unit(la0, lo0)), np.array(unit(la1, lo1))
                off0 = (u1 - u0) * (2 ** z0)
                c = u1 - off0 * (1 - p) / (2 ** Z) if z1 > z0 else u0 + (u1 - u0) * p
                return Z, tuple(c)
        return ks[-1][1], unit(ks[-1][2], ks[-1][3])
    def to_screen(s, lat, lon, Z, c):
        u = np.array(unit(lat, lon)); S = 256 * 2 ** Z
        return (u[0] - c[0]) * S + W / 2, (u[1] - c[1]) * S + CY
    def frame(s, tl):
        ta = s.t0 + tl
        Z, c = s.cam(ta)
        levels = sorted(s.mosaics)
        L = max([l for l in levels if l <= math.floor(Z)] or [levels[0]])
        m, x0, y0 = s.mosaics[L]
        sc = 2 ** (Z - L)
        cx = c[0] * 256 * 2 ** L - x0 * 256; cy = c[1] * 256 * 2 ** L - y0 * 256
        Mx = np.float32([[sc, 0, W / 2 - sc * cx], [0, sc, CY - sc * cy]])
        f = cv2.warpAffine(m, Mx, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=OCEAN)
        darken(f, s.dark)
        for L_ in s.slabels:
            a = clamp((Z - L_.get('from_z', 0)) / 0.8) if 'from_z' in L_ else 1.0
            if 'until_z' in L_: a = min(a, clamp(1 - (Z - L_['until_z']) / 0.8))
            if a <= 0: continue
            x, y = s.to_screen(L_['lat'], L_['lon'], Z, c)
            if L_.get('pin'):
                cv2.circle(f, (int(x), int(y)), 22, LIME, -1, cv2.LINE_AA); cv2.circle(f, (int(x), int(y)), 40, LIME, 5, cv2.LINE_AA)
                bar_label(f, L_['text'], min(x + 60, W - M - 400), y, L_.get('size', 48), INK, LIME, a, 'lc')
            else:
                bar_label(f, L_['text'], x, y, L_.get('size', 72), WHITE, BLACK, a, 'cc', eo(a * 1.5))
        return f

# ─── Vector maps ────────────────────────────────────────────────────────────
_GEO = None
def _to_unit(a):
    u = (a[:, 0] + 180) / 360
    v = (1 - np.arcsinh(np.tan(np.radians(np.clip(a[:, 1], -85, 85)))) / np.pi) / 2
    return np.stack([u, v], 1)

def geo():
    """Countries by ISO3 (ring list, name, centroid of the largest ring) and marine label points."""
    global _GEO
    if _GEO is None:
        g = json.load(open(os.path.join(GEO_DIR, 'countries-50m.geo.json')))
        C = {}
        for ft in g['features']:
            iso = ft.get('id'); geom = ft['geometry']
            polys = geom['coordinates'] if geom['type'] == 'MultiPolygon' else [geom['coordinates']]
            rings = [_to_unit(np.array(poly[0], np.float64)) for poly in polys if poly]
            if not rings: continue
            big = max(rings, key=len)
            C[iso] = dict(name=ft['properties'].get('name'), rings=rings, centre=big.mean(0),
                          span=float(max(r[:, 0].max() - r[:, 0].min() for r in rings)))
        marine = json.load(open(os.path.join(GEO_DIR, 'marine-10m.json')))['places']
        _GEO = (C, marine)
    return _GEO

class MapShot(Shot):
    """bbox (lon0,lat0,lon1,lat1) pre-rendered; cams [(abs_t, lon, lat, span_lon_deg)].
    hi {ISO3: (colour, abs_t)} fills timed to words; pins/texts timed too. Neighbouring
    countries and seas in view are labelled automatically, receded, so the viewer can
    orient (brief: labelled neighbours; the 18 Sep marine follow-up)."""
    def __init__(s, bbox, cams, hi=None, pins=(), texts=(), res=3000, grat=10, neighbours=True, **chrome):
        s.bbox, s.cams, s.hi, s.pins, s.texts, s.res, s.grat, s.neighbours = bbox, cams, hi or {}, pins, texts, res, grat, neighbours
        s.base = None; s.vign = True; s.auto = []
        for k, v in chrome.items(): setattr(s, k, v)
    def build(s):
        C, marine = geo()
        lo0, la0, lo1, la1 = s.bbox
        u0, v1 = unit(la0, lo0); u1, v0 = unit(la1, lo1)
        s.S = s.res / (u1 - u0); s.o = np.array([u0, v0])
        w, h = s.res, max(2, int((v1 - v0) * s.S))
        img = np.empty((h, w, 3), np.uint8); img[:] = OCEAN
        tp = lambda r: ((r - s.o) * s.S * 4).astype(np.int32)
        if s.grat:
            for lon in range(-180, 181, s.grat):
                x = int(((lon + 180) / 360 - u0) * s.S); cv2.line(img, (x, 0), (x, h), (22, 25, 28), 2, cv2.LINE_AA)
            for lat in range(-80, 81, s.grat):
                y = int((unit(lat, 0)[1] - v0) * s.S); cv2.line(img, (0, y), (w, y), (22, 25, 28), 2, cv2.LINE_AA)
        for iso, c in C.items():
            for r in c['rings']: cv2.fillPoly(img, [tp(r)], LAND, cv2.LINE_AA, shift=2)
        for iso, c in C.items():
            for r in c['rings']: cv2.polylines(img, [tp(r)], True, (78, 74, 66), 3, cv2.LINE_AA, shift=2)
        s.base = img
        # Auto labels from the final camera: countries and seas whose label point is
        # on screen and clear of the caption band and the platform buttons.
        if s.neighbours:
            # A FEW receded labels to orient by, never a gazetteer: the biggest
            # features first, at most MAX_AUTO, none within 150 px of another or
            # of a pin/text the shot places itself.
            u, k = s.cam(s.t0 + s.T)
            named = set(s.hi) | {t.get('iso') for t in s.texts}
            taken = [s.scr(p['lat'], p['lon'], u, k) for p in list(s.pins) + list(s.texts)]
            cands = []
            for iso, c in C.items():
                if iso in named: continue
                px = c['span'] * s.S * k
                if px < 110: continue
                cands.append((-px, c['centre'], str(c['name']).upper(), 'country'))
            for mp in marine:
                if mp['k'] not in ('ocean', 'sea', 'strait', 'gulf', 'bay'): continue
                px = (mp['b'][2] - mp['b'][0]) / 360 * s.S * k
                if px < 140: continue
                cands.append((-px, unit(mp['o'][1], mp['o'][0]), mp['n'], 'sea'))
            for _, uv, text, kind in sorted(cands, key=lambda c: c[0]):
                x, y = s.scr_u(uv, u, k)
                # The WHOLE label must fit: a name cut by the frame edge reads as a typo.
                half = (SERIFI(34) if kind == 'sea' else OSW(34, 'Medium')).getlength(text) / 2 + (0 if kind == 'sea' else len(text) * 2.5)
                if not (40 + half < x < W - 40 - half and 380 < y < 1120): continue
                if any(abs(x - tx) < 150 and abs(y - ty) < 60 for tx, ty in taken): continue
                # Never on or against a highlighted country: the fill is the subject.
                if any(cv2.pointPolygonTest(((r - u) * s.S * k + np.array([W / 2, CY])).astype(np.float32), (float(x), float(y)), True) > -half
                       for iso in s.hi if iso in C for r in C[iso]['rings']):
                    continue
                s.auto.append(dict(x=x, y=y, text=text, kind=kind)); taken.append((x, y))
                if len(s.auto) >= MAX_AUTO_LABELS: break
    def cam(s, ta):
        cs = s.cams
        if ta <= cs[0][0]: c = cs[0]
        elif ta >= cs[-1][0]: c = cs[-1]
        else:
            for a, b in zip(cs, cs[1:]):
                if ta <= b[0]:
                    p = eio((ta - a[0]) / max(b[0] - a[0], 1e-3))
                    ua, ub = np.array(unit(a[2], a[1])), np.array(unit(b[2], b[1]))
                    span = math.exp(lerp(math.log(a[3]), math.log(b[3]), p)); uu = ua + (ub - ua) * p
                    return uu, W / (span / 360 * s.S)
        return np.array(unit(c[2], c[1])), W / (c[3] / 360 * s.S)
    def scr_u(s, uv, u, k):
        q = (np.array(uv) - u) * s.S * k
        return q[0] + W / 2, q[1] + CY
    def scr(s, lat, lon, u, k):
        return s.scr_u(unit(lat, lon), u, k)
    def frame(s, tl):
        if s.base is None: s.build()
        ta = s.t0 + tl
        u, k = s.cam(ta)
        cpx = (u - s.o) * s.S
        Mx = np.float32([[k, 0, W / 2 - k * cpx[0]], [0, k, CY - k * cpx[1]]])
        f = cv2.warpAffine(s.base, Mx, (W, H), flags=cv2.INTER_AREA if k < 0.9 else cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=OCEAN)
        C, _ = geo()
        for iso, (col, t_in) in s.hi.items():
            a = eo(prog(ta, t_in, 0.6))
            if a <= 0 or iso not in C: continue
            ov = f.copy()
            for r in C[iso]['rings']:
                pts = ((r - u) * s.S * k * 4 + np.array([W / 2, CY]) * 4).astype(np.int32)
                cv2.fillPoly(ov, [pts], tuple(col), cv2.LINE_AA, shift=2)
            cv2.addWeighted(ov, 0.82 * a, f, 1 - 0.82 * a, 0, f)
            for r in C[iso]['rings']:
                pts = ((r - u) * s.S * k * 4 + np.array([W / 2, CY]) * 4).astype(np.int32)
                cv2.polylines(f, [pts], True, tuple(col), 5, cv2.LINE_AA, shift=2)
        # Receded orientation labels go ABOVE the fills (a fill must not eat a name)
        # and below the shot's own pins and texts.
        for L in s.auto:
            if L['kind'] == 'sea':
                blit(f, tpatch(L['text'], SERIFI(34), SEA_TEXT), L['x'], L['y'], 0.9, 'cc')
            else:
                blit(f, tpatch(L['text'], OSW(34, 'Medium'), (150, 144, 134), track=5), L['x'], L['y'], 0.9, 'cc')
        for pn in s.pins:
            a = eo(prog(ta, pn['t'], 0.5))
            if a <= 0: continue
            x, y = s.scr(pn['lat'], pn['lon'], u, k)
            col = tuple(pn.get('col', LIME))
            cv2.circle(f, (int(x), int(y)), int(18 * a) + 1, col, -1, cv2.LINE_AA)
            cv2.circle(f, (int(x), int(y)), int(34 * a) + 1, col, 4, cv2.LINE_AA)
            if pn.get('text'):
                dx = pn.get('dx', 56) if x < W - 420 else -56
                bar_label(f, pn['text'], x + dx, y, pn.get('size', 46), INK, LIME, 1, 'lc' if dx >= 0 else 'rc', a)
        for tx in s.texts:
            a = eo(prog(ta, tx['t'], 0.5))
            if a <= 0: continue
            x, y = s.scr(tx['lat'], tx['lon'], u, k)
            # Inside the safe area: below the kicker/brand row, above the captions.
            x = clamp(x, M + 200, W - M - 200); y = clamp(y, 340, 1120)
            bar_label(f, tx['text'], x, y, tx.get('size', 56), tuple(tx.get('fg', WHITE)), tuple(tx.get('bg', BLACK)), 1, 'cc', a)
        return f

# ─── Cards ──────────────────────────────────────────────────────────────────
def _norm(w): return re.sub(r'[^a-z0-9]', '', w.lower())

class Headline(Shot):
    """A recreated headline clipping with a highlight sweep: outlet, date, under 15
    words, never an article body (brief, Phase 4). Over a darkened background."""
    def __init__(s, outlet, headline, date, hl='', hl_at=None, bg=None, tilt=-1.5, zoom=1.0, **chrome):
        s.outlet, s.headline, s.date, s.hl, s.hl_at, s.bg, s.tilt, s.zoom = outlet, ' '.join(headline.split()[:15]), date, hl, hl_at, bg, tilt, zoom
        s.card = None; s.bgimg = None; s.caps = False
        for k, v in chrome.items(): setattr(s, k, v)
    def build(s):
        cw = 1500; fh = safe_font(s.headline, SERIF(104)); lines = wrap(s.headline, fh, cw - 160); lh = 146
        ch = 330 + len(lines) * lh + 90
        im = Image.new('RGBA', (cw, ch), PAPER + (255,)); d = ImageDraw.Draw(im)
        d.text((80, 70), s.outlet, font=safe_font(s.outlet, OSW(74, 'Bold')), fill=(20, 18, 16))
        d.line((80, 190, cw - 80, 190), fill=(20, 18, 16), width=4)
        d.text((80, 215), s.date.upper(), font=MONO(40), fill=(110, 104, 96))
        s.hlr = []; y = 310; ws = set(_norm(x) for x in s.hl.split())
        for ln in lines:
            d.text((80, y), ln, font=fh, fill=(14, 12, 10)); x = 80
            for wd in ln.split(' '):
                wl = fh.getlength(wd)
                if _norm(wd) in ws: s.hlr.append((x - 8, y - 6, x + wl + 8, y + 122))
                x += wl + fh.getlength(' ')
            y += lh
        s.card = np.array(im)
    def frame(s, tl):
        if s.card is None: s.build()
        if s.bg and s.bgimg is None:
            s.bgimg = Photo(s.bg, dark=0.72, kb=((0.5, 0.45, 1.05), (0.5, 0.45, 1.12))); s.bgimg.T = s.T; s.bgimg.t0 = s.t0
        f = s.bgimg.frame(tl) if s.bgimg else blank((16, 14, 12))
        card = s.card.copy(); ta = s.t0 + tl
        he = eio(prog(ta, s.hl_at if s.hl_at is not None else s.t0 + 0.8, 0.7))
        if he > 0 and s.hlr:
            tot = sum(r[2] - r[0] for r in s.hlr); cut = tot * he; acc = 0; ov = card.copy()
            for (x0, y0, x1, y1) in s.hlr:
                wv = min(x1 - x0, max(0, cut - acc)); acc += x1 - x0
                if wv > 0: cv2.rectangle(ov, (int(x0), int(y0)), (int(x0 + wv), int(y1)), (221, 231, 6, 255), -1)
            m = (ov[..., :3] != card[..., :3]).any(2, keepdims=True)
            card[..., :3] = np.where(m, np.minimum(card[..., :3], ov[..., :3]), card[..., :3])
        e = eo(prog(tl, 0.0, 0.5)) if s.zoom == 1.0 else 1.0; ch, cw = card.shape[:2]; sc = W * 0.88 / cw * lerp(0.92, 1.0, e) * s.zoom
        # A closer view pushes into the highlighted words (or the headline's first line).
        fx, fy = cw / 2, ch / 2
        if s.zoom != 1.0:
            if s.hlr: fx = (s.hlr[0][0] + s.hlr[-1][2]) / 2; fy = (s.hlr[0][1] + s.hlr[0][3]) / 2
            else: fy = 380
            fx = lerp(cw / 2, fx, 0.7)
        # The push-in view anchors the highlight lower, so the enlarged card stays below the kicker/brand row.
        anchor_y = 700 if s.zoom == 1.0 else 880
        Mx = cv2.getRotationMatrix2D((fx, fy), s.tilt, sc); Mx[0, 2] += W / 2 - fx; Mx[1, 2] += anchor_y - fy + 80 * (1 - e)
        wp = cv2.warpAffine(card, Mx, (W, H), flags=cv2.INTER_AREA, borderValue=(0, 0, 0, 0))
        al = wp[..., 3:4].astype(np.float32) / 255 * e
        f[:] = (wp[..., :3] * al + f * (1 - al)).astype(np.uint8)
        return f

class Punch(Shot):
    """Deliberate text-only punctuation (at most two a short). lines: [(abs_t, text, size, colour)]."""
    def __init__(s, lines, bg=None, **chrome):
        s.lines, s.bg = lines, bg; s.caps = False
        for k, v in chrome.items(): setattr(s, k, v)
    def frame(s, tl):
        if s.bg is not None: s.bg.T = s.T; s.bg.t0 = s.t0
        f = s.bg.frame(tl) if s.bg else blank()
        ta = s.t0 + tl
        ps = [(tpatch(text, ANTON(size), tuple(col)), t0) for (t0, text, size, col) in s.lines]
        tot = sum(p.shape[0] for p, _ in ps) + 30 * (len(ps) - 1); y = 820 - tot / 2
        for p, t0 in ps:
            e = eo(prog(ta, t0, 0.3)); blit(f, p, W / 2, y + 40 * (1 - e), e, 'ct'); y += p.shape[0] + 30
        return f

class Count(Shot):
    """Count-up number over a darkened picture or the house ground."""
    def __init__(s, value, label='', prefix='', suffix='', decimals=0, t_start=None, bg=None, settled=False, **chrome):
        s.value, s.label, s.prefix, s.suffix, s.decimals, s.t_start, s.bg, s.settled = value, label, prefix, suffix, decimals, t_start, bg, settled
        s.bgimg = None
        for k, v in chrome.items(): setattr(s, k, v)
    def frame(s, tl):
        if s.bg and s.bgimg is None:
            s.bgimg = Photo(s.bg, dark=0.66); s.bgimg.T = s.T; s.bgimg.t0 = s.t0
        f = s.bgimg.frame(tl) if s.bgimg else blank()
        ta = s.t0 + tl; t0 = s.t_start if s.t_start is not None else s.t0 + 0.2
        v = s.value if s.settled else s.value * eo(prog(ta, t0, 0.9))
        txt = f'{s.prefix}{v:,.{s.decimals}f}{s.suffix}'
        size = 420 if len(txt) <= 4 else max(160, int(420 * 4 / len(txt)))
        blit(f, tpatch(txt, ANTON(size), WHITE), W / 2, 560, 1, 'ct')
        if s.label:
            for i, ln in enumerate(wrap(s.label.upper(), ANTON(72), W - 2 * M - 40)[:2]):
                blit(f, tpatch(ln, ANTON(72), LIME), W / 2, 560 + size + 40 + i * 92, eo(prog(ta, t0 + 0.5, 0.4)), 'ct')
        return f

class Graphic(Shot):
    """Simple data graphic: horizontal bars when given, else a titled statement."""
    def __init__(s, title='', bars=(), unit='', lines=(), hi=0, **chrome):
        s.title, s.bars, s.unit, s.lines, s.hi = title, list(bars), unit, list(lines), hi
        for k, v in chrome.items(): setattr(s, k, v)
    def frame(s, tl):
        f = blank()
        if s.title:
            for i, ln in enumerate(wrap(s.title.upper(), ANTON(96), W - 2 * M)[:2]):
                blit(f, tpatch(ln, ANTON(96), WHITE), M, 400 + i * 116, eo(prog(tl, 0.05 + i * 0.1, 0.4)))
        if s.bars:
            mv = max(abs(b[1]) for b in s.bars) or 1; top = 700; rowh = min(150, 560 / len(s.bars)); bw = W - 2 * M
            for i, (lab, v) in enumerate(s.bars):
                e = eo(prog(tl, 0.3 + i * 0.2, 0.8)); y = top + i * rowh
                blit(f, tpatch(str(lab).upper(), OSW(40, 'SemiBold'), BONE), M, y, prog(tl, 0.2 + i * 0.2, 0.3))
                rect(f, M, y + 52, M + max(6, bw * 0.78 * abs(v) / mv * e), y + 52 + rowh * 0.4, LIME if i == s.hi else BONE)
                if e > 0.05:
                    blit(f, tpatch(f'{v * e:,.0f}{s.unit}', INTER(40, 'Bold'), WHITE), M + bw * 0.78 * abs(v) / mv * e + 20, y + 52 + rowh * 0.2, 1, 'lc')
        else:
            for i, ln in enumerate(s.lines[:4]):
                col = LIME if (i == s.hi and len(s.lines) > 1) else BONE
                for j, sub in enumerate(wrap(ln, INTER(58, 'SemiBold'), W - 2 * M)[:2]):
                    blit(f, tpatch(sub, INTER(58, 'SemiBold'), col), M, 760 + i * 150 + j * 72, eo(prog(tl, 0.3 + i * 0.3, 0.4)))
        return f

class EndCard(Shot):
    """CTA plus a compact sources list (brief §1.7), over a darkened picture if given."""
    def __init__(s, sources, bg=None, **chrome):
        s.sources, s.bg = sources, bg; s.caps = False; s.bgimg = None
        for k, v in chrome.items(): setattr(s, k, v)
    def frame(s, tl):
        if s.bg and s.bgimg is None:
            s.bgimg = Photo(s.bg, dark=0.74); s.bgimg.T = s.T; s.bgimg.t0 = s.t0
        f = s.bgimg.frame(tl) if s.bgimg else blank()
        blit(f, tpatch('TELL US IN', ANTON(130), WHITE), W / 2, 520, eo(prog(tl, 0.0, 0.35)), 'ct')
        blit(f, tpatch('THE COMMENTS', ANTON(130), LIME), W / 2, 680, eo(prog(tl, 0.2, 0.35)), 'ct')
        blit(f, tpatch('FOLLOW SCOOPFEEDS', OSW(58, 'SemiBold'), INK, LIME, (28, 16), track=4), W / 2, 900, eo(prog(tl, 1.0, 0.35)), 'ct')
        lines = ['SOURCES'] + [ln for src in s.sources for ln in wrap(src, MONO(26), W - 2 * M - 40)][:9]
        for i, ln in enumerate(lines):
            blit(f, tpatch(ln, MONO(26) if i else OSW(30, 'SemiBold'), GREY if i else LIME), W / 2, 1060 + i * 42, eo(prog(tl, 1.4 + i * 0.08, 0.3)), 'ct')
        return f


def auto_frame(codes=(), points=(), t0=0.0, T=3.0, min_span=6.0, zoom=1.0, focus=None):
    """Frame a map on its subject: the union of each named country's MAINLAND
    (largest ring — an overseas territory must not aim the camera, the 17 Sep
    finding) and any marked points. Returns (bbox, cams): a slow push-in from
    1.25x to 1.0x of the fitted span, centred for the band above the captions."""
    C, _ = geo()
    lons, lats = [], []
    for iso in codes:
        c = C.get(iso)
        if not c: continue
        big = max(c['rings'], key=len)
        lon = big[:, 0] * 360 - 180
        lat = np.degrees(np.arctan(np.sinh(np.pi * (1 - 2 * big[:, 1]))))
        lons += [lon.min(), lon.max()]; lats += [lat.min(), lat.max()]
    for p in points:
        lons.append(p[1]); lats.append(p[0])
    if not lons: lons, lats = [-20, 40], [20, 60]
    lo0, lo1, la0, la1 = min(lons), max(lons), min(lats), max(lats)
    clon, clat = (lo0 + lo1) / 2, (la0 + la1) / 2
    # The vertical frame is tall: fit the WIDTH, but make sure the latitude
    # extent (in mercator) also fits the ~60% of the height above the captions.
    u0, v0 = unit(la1, lo0); u1, v1 = unit(la0, lo1)
    need_w = (u1 - u0) * 1.5
    need_h = (v1 - v0) * 1.5 * W / (H * 0.55)
    span = max(min_span if codes else max(min_span, 18.0), max(need_w, need_h) * 360)
    span = min(span, 330)
    # A VIEW of the same map (sub-cut, DrJ 24 Sep): closer (`zoom` < 1) and/or
    # centred on one named place (`focus`). The base extent below still covers
    # the widest of the views, so every view of the shot shares one raster.
    if focus is not None: clat, clon = focus
    span_v = max(2.5, span * zoom)
    cams = [(t0, clon, clat, span_v * 1.12), (t0 + T, clon, clat, span_v)]
    wide_span = span
    # The base must cover the WIDEST view in both axes, measured in mercator:
    # at span S degrees across W px, the frame is S*H/W "degrees" tall in unit
    # space, CY px of it above the centre and H-CY below.
    wide = max(wide_span, span_v) * 1.25 * 1.05
    uc, vc = unit(clat, clon)
    su = wide / 360
    v_top, v_bot = vc - su * CY / W, vc + su * (H - CY) / W
    lat_of = lambda v: math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * v))))
    bbox = (max(-180, clon - wide / 2), max(-84, lat_of(min(0.999, v_bot))), min(180, clon + wide / 2), min(84, lat_of(max(0.001, v_top))))
    return bbox, cams
