import numpy as np, cv2, json, math, re, os, subprocess
from PIL import Image, ImageDraw, ImageFont, ImageFilter
W, H, FPS = 1080, 1920, 24
INK = (9, 7, 6); LIME = (221, 231, 6); BONE = (238, 234, 224); GREY = (150, 144, 134); DIM = (62, 58, 52)
RED = (232, 64, 52); BLUE = (70, 140, 240); PAPER = (246, 242, 233); OCEAN = (13, 16, 19); LAND = (40, 38, 34)
WHITE = (255, 255, 255); BLACK = (0, 0, 0)
FD = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fonts') + '/'
_fc = {}
def font(name, size, var=None):
    k = (name, size, var)
    if k not in _fc:
        f = ImageFont.truetype(FD + name, size)
        if var:
            try: f.set_variation_by_name(var)
            except Exception: pass
        _fc[k] = f
    return _fc[k]
ANTON = lambda s: font('Anton-Regular.ttf', s)
INTER = lambda s, v='Regular': font('Inter.ttf', s, v)
OSW = lambda s, v='Bold': font('Oswald.ttf', s, v)
MONO = lambda s: font('IBMPlexMono-Medium.ttf', s)
SERIF = lambda s: font('LibreBaskerville-Regular.ttf', s)
SERIFI = lambda s: font('LibreBaskerville-Italic.ttf', s)

def clamp(x, a=0.0, b=1.0): return max(a, min(b, x))
def eo(x): x = clamp(x); return 1 - (1 - x) ** 3
def eio(x): x = clamp(x); return x * x * (3 - 2 * x)
def prog(t, t0, d=0.6): return clamp((t - t0) / d) if d > 0 else float(t >= t0)
def lerp(a, b, x): return a + (b - a) * x

# ---------------------------------------------------------------- text patches
_tc = {}
def tpatch(text, f, fill=WHITE, bg=None, pad=(0, 0), track=0):
    key = (text, id(f), fill, bg, pad, track)
    if key in _tc: return _tc[key]
    l, t, r, b = f.getbbox(text if text else ' ')
    if track:
        ws = [f.getlength(c) for c in text]; tw = int(sum(ws) + track * max(0, len(text) - 1)) + 2
    else:
        tw = int(math.ceil(max(r, f.getlength(text)))) + 2
    th = b - t
    w, h = tw + 2 * pad[0], th + 2 * pad[1]
    im = Image.new('RGBA', (max(w, 1), max(h, 1)), (bg + (255,)) if bg else (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if track:
        x = pad[0]
        for c, wc in zip(text, ws): d.text((x, pad[1] - t), c, font=f, fill=fill); x += wc + track
    else:
        d.text((pad[0], pad[1] - t), text, font=f, fill=fill)
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

# ---------------------------------------------------------------- shared overlays
def bar_label(dst, text, x, y, size=96, fg=WHITE, bg=BLACK, a=1.0, anchor='lt', wipe=1.0, font_fn=None):
    p = tpatch(text, (font_fn or ANTON)(size), fg, bg, (int(size * .32), int(size * .22)))
    blit(dst, p, x, y, a, anchor, wipe)

def source(dst, text, a=1.0):
    if not text: return
    p = tpatch('SOURCE  ' + text.upper(), MONO(40), (200, 196, 186), (12, 10, 9), (26, 14))
    blit(dst, p, 150, H - 140, a * 0.92, 'lb')

def credit(dst, text, a=1.0):
    if not text: return
    p = tpatch(text, MONO(36), (215, 211, 200), (12, 10, 9), (22, 12))
    blit(dst, p, W - 150, H - 140, a * 0.85, 'rb')

def kicker(dst, text, a=1.0):
    if not text: return
    p = tpatch(text.upper(), OSW(58, 'SemiBold'), INK, LIME, (26, 14), track=4)
    blit(dst, p, 150, 150, a)

BRAND = None
def brand(dst):
    global BRAND
    if BRAND is None: BRAND = tpatch('SCOOPFEEDS', ANTON(58), LIME)
    blit(dst, BRAND, W - 150, 150, 0.55, 'rt')

# ---------------------------------------------------------------- shot base
class Shot:
    t0 = 0.0; T = 1.0; vign = False; kick = None; src = None; cred = None; show_brand = True
    def frame(self, tl): raise NotImplementedError
    def post(self, f, tl):
        if self.vign: vignette(f)
        a = min(prog(tl, 0.25, 0.5), prog(self.T - tl, 0.0, 0.35) if self.T > 1.2 else 1)
        if self.kick: kicker(f, self.kick, prog(tl, 0.15, 0.4))
        if self.src: source(f, self.src, prog(tl, 0.5, 0.5))
        if self.cred: credit(f, self.cred, prog(tl, 0.4, 0.5))
        if self.show_brand: brand(f)
    def at(self, tl): return self.t0 + tl  # absolute time

# ---------------------------------------------------------------- photos
def load_rgb(path, maxw=5600):
    im = Image.open(path).convert('RGB')
    if im.width > maxw: im = im.resize((maxw, int(im.height * maxw / im.width)), Image.LANCZOS)
    return np.array(im)

class Photo(Shot):
    """kb: ((cx,cy,zoom),(cx,cy,zoom)) normalised source centre + zoom relative to cover."""
    def __init__(s, path, kb=((0.5, 0.5, 1.02), (0.5, 0.5, 1.12)), labels=(), cred=None, kick=None, dark=0.0,
                 contain=False, bw=False, src=None, overlay=None):
        s.path, s.kb, s.labels, s.cred, s.kick, s.dark, s.contain, s.bw, s.src, s.overlay = path, kb, labels, cred, kick, dark, contain, bw, src, overlay
        s.vign = True; s.img = None
    def load(s):
        img = load_rgb(s.path)
        if s.bw: g = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY); img = np.dstack([g] * 3)
        s.img = img; h, w = img.shape[:2]
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
            k = min(W * 0.78 / w, H * 0.80 / h) * z
            f = s.bg.copy()
            M = np.float32([[k, 0, W / 2 - k * w / 2 + (cx - 0.5) * 0], [0, k, H / 2 - k * h / 2]])
            cv2.warpAffine(s.img, M, (W, H), dst=f, flags=cv2.INTER_AREA if k < 1 else cv2.INTER_LINEAR, borderMode=cv2.BORDER_TRANSPARENT)
        else:
            k = max(W / w, H / h) * z
            hx, hy = W / (2 * k), H / (2 * k)
            px = clamp(cx * w, hx, w - hx); py = clamp(cy * h, hy, h - hy)
            M = np.float32([[k, 0, W / 2 - k * px], [0, k, H / 2 - k * py]])
            f = cv2.warpAffine(s.img, M, (W, H), flags=cv2.INTER_AREA if k < 1 else cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
        darken(f, s.dark)
        if s.overlay: s.overlay(f, tl, s)
        draw_labels(f, tl, s)
        return f

def draw_labels(f, tl, s):
    for L in s.labels:
        t_in = L.get('t', 0.4) if 'at' not in L else L['at'] - s.t0
        e = eo(prog(tl, t_in, 0.45))
        if e <= 0: continue
        kind = L.get('kind', 'bar')
        x, y = L.get('xy', (150, H - 330))
        if kind == 'bar':
            bar_label(f, L['text'], x, y, L.get('size', 96), L.get('fg', WHITE), L.get('bg', BLACK), 1, L.get('anchor', 'lb'), e)
        elif kind == 'lime':
            bar_label(f, L['text'], x, y, L.get('size', 96), INK, LIME, 1, L.get('anchor', 'lb'), e)
        elif kind == 'big':
            p = tpatch(L['text'], ANTON(L.get('size', 300)), L.get('fg', WHITE))
            blit(f, p, x, y + 40 * (1 - e), e, L.get('anchor', 'lb'))
        elif kind == 'sub':
            p = tpatch(L['text'], INTER(L.get('size', 70), 'SemiBold'), L.get('fg', BONE))
            blit(f, p, x, y + 20 * (1 - e), e, L.get('anchor', 'lb'))

# ---------------------------------------------------------------- footage
class Video(Shot):
    def __init__(s, path, clips, labels=(), cred=None, kick=None, dark=0.0, src=None):
        s.path, s.clips, s.labels, s.cred, s.kick, s.dark, s.src = path, clips, labels, cred, kick, dark, src
        s.vign = True; s.proc = None; s.ci = -1; s.last = None; s.clip_t = 0
    def _open(s, i):
        if s.proc: s.proc.kill()
        st, du = s.clips[i]
        vf = f"fps={FPS},scale={W}:{H}:force_original_aspect_ratio=increase:flags=lanczos,crop={W}:{H}"
        s.proc = subprocess.Popen(['ffmpeg', '-v', 'error', '-ss', str(st), '-i', s.path, '-t', str(du + 2), '-vf', vf,
                                   '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], stdout=subprocess.PIPE, bufsize=W * H * 3 * 2)
        s.ci = i
    def frame(s, tl):
        # clip schedule: clips play in order, last one fills
        acc = 0; want = len(s.clips) - 1
        for i, (_, du) in enumerate(s.clips):
            if tl < acc + du or i == len(s.clips) - 1: want = i; break
            acc += du
        if want != s.ci: s._open(want)
        buf = s.proc.stdout.read(W * H * 3)
        if len(buf) == W * H * 3: s.last = np.frombuffer(buf, np.uint8).reshape(H, W, 3).copy()
        f = s.last.copy() if s.last is not None else blank()
        darken(f, s.dark); draw_labels(f, tl, s)
        return f

# ---------------------------------------------------------------- satellite zoom
def unit(lat, lon):
    return (lon + 180) / 360, (1 - math.asinh(math.tan(math.radians(clamp(lat, -85, 85)))) / math.pi) / 2

class SatZoom(Shot):
    """keys: list of (abs_t, Z, lat, lon). Between keys: zoom-to-target interpolation."""
    def __init__(s, keys, labels=(), outline=None, dark=0.0, kick=None, src='Imagery: Esri World Imagery (Maxar, Earthstar Geographics)'):
        s.keys, s.slabels, s.outline, s.dark, s.kick, s.cred = keys, labels, outline, dark, kick, src
        s.src = None; s.vign = True; s.cache = {}; s.meta = json.load(open('sat/meta.json'))
    def mosaic(s, L):
        if L not in s.cache:
            if len(s.cache) >= 2: s.cache.pop(next(iter(s.cache)))
            s.cache[L] = np.array(Image.open(f'sat/z{L}.jpg'))
        return s.cache[L]
    def cam(s, ta):
        ks = s.keys
        if ta <= ks[0][0]: return ks[0][1], unit(ks[0][2], ks[0][3])
        for (t0, z0, la0, lo0), (t1, z1, la1, lo1) in zip(ks, ks[1:]):
            if ta <= t1:
                p = eio((ta - t0) / max(t1 - t0, 1e-3)); Z = lerp(z0, z1, p)
                u0, u1 = np.array(unit(la0, lo0)), np.array(unit(la1, lo1))
                off0 = (u1 - u0) * (2 ** z0)                      # target offset (in z0-world units)
                c = u1 - off0 * (1 - p) / (2 ** Z) if z1 > z0 else u0 + (u1 - u0) * p
                return Z, tuple(c)
        return ks[-1][1], unit(ks[-1][2], ks[-1][3])
    def to_screen(s, lat, lon, Z, c):
        u = np.array(unit(lat, lon)); S = 256 * 2 ** Z
        return (u[0] - c[0]) * S + W / 2, (u[1] - c[1]) * S + H / 2
    def frame(s, tl):
        ta = s.t0 + tl
        Z, c = s.cam(ta)
        L = int(clamp(math.floor(Z), 3, 14)); sc = 2 ** (Z - L)
        m = s.mosaic(L); x0, y0 = s.meta[str(L)]
        cx = c[0] * 256 * 2 ** L - x0 * 256; cy = c[1] * 256 * 2 ** L - y0 * 256
        M = np.float32([[sc, 0, W / 2 - sc * cx], [0, sc, H / 2 - sc * cy]])
        f = cv2.warpAffine(m, M, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=OCEAN)
        darken(f, s.dark)
        if s.outline is not None:
            oa = s.outline[1](Z)
            if oa > 0:
                S = 256 * 2 ** Z
                ov = f.copy()
                for ring in s.outline[0]:
                    pts = ((ring - np.array(c)) * S + np.array([W / 2, H / 2])).astype(np.int32)
                    cv2.polylines(ov, [pts], True, LIME, 9, cv2.LINE_AA)
                cv2.addWeighted(ov, oa, f, 1 - oa, 0, f)
        for L_ in s.slabels:
            a = L_['alpha'](Z, ta)
            if a <= 0: continue
            x, y = s.to_screen(L_['lat'], L_['lon'], Z, c)
            if L_.get('pin'):
                cv2.circle(f, (int(x), int(y)), 22, LIME, -1, cv2.LINE_AA); cv2.circle(f, (int(x), int(y)), 40, LIME, 5, cv2.LINE_AA)
                bar_label(f, L_['text'], x + 60, y, L_.get('size', 96), INK, LIME, a, 'lc')
            else:
                bar_label(f, L_['text'], x + L_.get('dx', 0), y + L_.get('dy', 0), L_.get('size', 96),
                          L_.get('fg', WHITE), L_.get('bg', BLACK), a, L_.get('anchor', 'cc'), eo(a * 1.5))
        return f

# ---------------------------------------------------------------- vector maps
_GEO = None
def geo():
    global _GEO
    if _GEO is None:
        g = json.load(open('geo/ne_50m_admin_0_countries.geojson'))
        C = {}
        for ft in g['features']:
            p = ft['properties']; iso = p.get('ADM0_A3') or p.get('ISO_A3')
            geom = ft['geometry']; polys = geom['coordinates'] if geom['type'] == 'MultiPolygon' else [geom['coordinates']]
            rings = []
            for poly in polys:
                for ring in poly[:1]:
                    a = np.array(ring, np.float64)
                    u = (a[:, 0] + 180) / 360
                    v = (1 - np.arcsinh(np.tan(np.radians(np.clip(a[:, 1], -85, 85)))) / np.pi) / 2
                    rings.append(np.stack([u, v], 1))
            C[iso] = dict(name=p.get('NAME'), rings=rings)
        riv = json.load(open('geo/ne_50m_rivers_lake_centerlines.geojson'))
        R = []
        for ft in riv['features']:
            if (ft['properties'].get('name') or '') in ('Congo', 'Lualaba', 'Kasai', 'Ubangi', 'Zambezi', 'Nile', 'Niger'):
                geom = ft['geometry']; ls = geom['coordinates'] if geom['type'] == 'MultiLineString' else [geom['coordinates']]
                for l in ls:
                    a = np.array(l, np.float64); u = (a[:, 0] + 180) / 360
                    v = (1 - np.arcsinh(np.tan(np.radians(a[:, 1]))) / np.pi) / 2; R.append(np.stack([u, v], 1))
        lk = json.load(open('geo/ne_50m_lakes.geojson')); LK = []
        for ft in lk['features']:
            geom = ft['geometry']; polys = geom['coordinates'] if geom['type'] == 'MultiPolygon' else [geom['coordinates']]
            for poly in polys:
                a = np.array(poly[0], np.float64); u = (a[:, 0] + 180) / 360
                v = (1 - np.arcsinh(np.tan(np.radians(a[:, 1]))) / np.pi) / 2; LK.append(np.stack([u, v], 1))
        _GEO = (C, R, LK)
    return _GEO

class MapShot(Shot):
    """bbox (lon0,lat0,lon1,lat1) pre-render; cams list of (abs_t, lon, lat, span_lon_deg)."""
    def __init__(s, bbox, cams, res=7000, hi=None, pins=(), routes=(), texts=(), kick=None, src=None, grat=10, arcs=()):
        s.bbox, s.cams, s.res, s.hi, s.pins, s.routes, s.texts, s.kick, s.src, s.grat, s.arcs = bbox, cams, res, hi or {}, pins, routes, texts, kick, src, grat, arcs
        s.base = None; s.vign = True
    def build(s):
        C, R, LK = geo()
        lo0, la0, lo1, la1 = s.bbox
        u0, v1 = unit(la0, lo0); u1, v0 = unit(la1, lo1)
        s.S = s.res / (u1 - u0); s.o = np.array([u0, v0])
        w, h = s.res, int((v1 - v0) * s.S)
        img = np.empty((h, w, 3), np.uint8); img[:] = OCEAN
        tp = lambda r: ((r - s.o) * s.S * 4).astype(np.int32)
        if s.grat:
            for lon in range(-180, 181, s.grat):
                x = int(((lon + 180) / 360 - u0) * s.S); cv2.line(img, (x, 0), (x, h), (22, 25, 28), 2, cv2.LINE_AA)
            for lat in range(-80, 81, s.grat):
                y = int((unit(lat, 0)[1] - v0) * s.S); cv2.line(img, (0, y), (w, y), (22, 25, 28), 2, cv2.LINE_AA)
        for iso, c in C.items():
            for r in c['rings']: cv2.fillPoly(img, [tp(r)], LAND, cv2.LINE_AA, shift=2)
        for r in LK: cv2.fillPoly(img, [tp(r)], OCEAN, cv2.LINE_AA, shift=2)
        for r in R: cv2.polylines(img, [tp(r)], False, (46, 70, 84), 4, cv2.LINE_AA, shift=2)
        for iso, c in C.items():
            for r in c['rings']: cv2.polylines(img, [tp(r)], True, (78, 74, 66), 3, cv2.LINE_AA, shift=2)
        s.base = img
    def cam(s, ta):
        cs = s.cams
        if ta <= cs[0][0]: c = cs[0]
        elif ta >= cs[-1][0]: c = cs[-1]
        else:
            for a, b in zip(cs, cs[1:]):
                if ta <= b[0]:
                    p = eio((ta - a[0]) / max(b[0] - a[0], 1e-3))
                    ua, ub = np.array(unit(a[2], a[1])), np.array(unit(b[2], b[1]))
                    sa, sb = math.log(a[3]), math.log(b[3])
                    span = math.exp(lerp(sa, sb, p)); u = ua + (ub - ua) * p
                    return u, W / (span / 360 * s.S)
        return np.array(unit(c[2], c[1])), W / (c[3] / 360 * s.S)
    def scr(s, lat, lon, u, k):
        q = (np.array(unit(lat, lon)) - u) * s.S * k
        return q[0] + W / 2, q[1] + H / 2
    def frame(s, tl):
        if s.base is None: s.build()
        ta = s.t0 + tl
        u, k = s.cam(ta)
        cpx = (u - s.o) * s.S
        M = np.float32([[k, 0, W / 2 - k * cpx[0]], [0, k, H / 2 - k * cpx[1]]])
        f = cv2.warpAffine(s.base, M, (W, H), flags=cv2.INTER_AREA if k < 0.9 else cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=OCEAN)
        C = geo()[0]
        for iso, (col, t_in) in s.hi.items():
            a = eo(prog(ta, t_in, 0.6))
            if a <= 0 or iso not in C: continue
            ov = f.copy()
            for r in C[iso]['rings']:
                pts = ((r - u) * s.S * k * 4 + np.array([W / 2, H / 2]) * 4).astype(np.int32)
                cv2.fillPoly(ov, [pts], col, cv2.LINE_AA, shift=2)
            cv2.addWeighted(ov, 0.82 * a, f, 1 - 0.82 * a, 0, f)
            for r in C[iso]['rings']:
                pts = ((r - u) * s.S * k * 4 + np.array([W / 2, H / 2]) * 4).astype(np.int32)
                cv2.polylines(f, [pts], True, col, 5, cv2.LINE_AA, shift=2)
        for rt in s.routes:
            p = eio(prog(ta, rt['t'], rt.get('d', 2.5)))
            if p <= 0: continue
            pts = np.array([s.scr(la, lo, u, k) for la, lo in rt['pts']], np.float64)
            seg = np.sqrt(((pts[1:] - pts[:-1]) ** 2).sum(1)); cum = np.concatenate([[0], np.cumsum(seg)]); Lt = cum[-1] * p
            n = np.searchsorted(cum, Lt)
            part = pts[:max(n, 1)]
            if n < len(pts):
                j = max(n - 1, 0); fr = (Lt - cum[j]) / max(seg[j] if j < len(seg) else 1, 1e-6)
                head = pts[j] + (pts[min(j + 1, len(pts) - 1)] - pts[j]) * clamp(fr)
                part = np.vstack([pts[:j + 1], head])
            else: head = pts[-1]
            cv2.polylines(f, [(part * 4).astype(np.int32)], False, (0, 0, 0), 26, cv2.LINE_AA, shift=2)
            cv2.polylines(f, [(part * 4).astype(np.int32)], False, rt['col'], 14, cv2.LINE_AA, shift=2)
            cv2.circle(f, (int(head[0]), int(head[1])), 20, rt['col'], -1, cv2.LINE_AA)
            if rt.get('label') and p > 0.6:
                lx, ly = s.scr(*rt['label_at'], u, k)
                bar_label(f, rt['label'], lx, ly, 78, rt.get('lfg', WHITE), rt.get('lbg', BLACK), 1, 'cc', eo((p - 0.6) / 0.4))
        for ac in s.arcs:
            p = eio(prog(ta, ac['t'], ac.get('d', 1.6)))
            if p <= 0: continue
            a0 = np.array(s.scr(*ac['a'], u, k)); b0 = np.array(s.scr(*ac['b'], u, k))
            mid = (a0 + b0) / 2 + np.array([0, -np.linalg.norm(b0 - a0) * 0.28])
            ts = np.linspace(0, p, 60)[:, None]
            curve = (1 - ts) ** 2 * a0 + 2 * (1 - ts) * ts * mid + ts ** 2 * b0
            cv2.polylines(f, [(curve * 4).astype(np.int32)], False, ac['col'], 12, cv2.LINE_AA, shift=2)
            cv2.circle(f, tuple(curve[-1].astype(int)), 18, ac['col'], -1, cv2.LINE_AA)
            if ac.get('label') and p > 0.7:
                bar_label(f, ac['label'], mid[0], mid[1] - 30, 72, INK, ac['col'], 1, 'cb', eo((p - 0.7) / 0.3))
        for pn in s.pins:
            a = eo(prog(ta, pn['t'], 0.5))
            if a <= 0: continue
            x, y = s.scr(pn['lat'], pn['lon'], u, k)
            col = pn.get('col', LIME)
            cv2.circle(f, (int(x), int(y)), int(18 * a) + 1, col, -1, cv2.LINE_AA)
            cv2.circle(f, (int(x), int(y)), int(34 * a) + 1, col, 4, cv2.LINE_AA)
            if pn.get('text'):
                dx = pn.get('dx', 56); anc = 'lc' if dx >= 0 else 'rc'
                bar_label(f, pn['text'], x + dx, y + pn.get('dy', 0), pn.get('size', 80), pn.get('fg', WHITE), pn.get('bg', BLACK), 1, anc, a)
        for tx in s.texts:
            a = eo(prog(ta, tx['t'], 0.5))
            if a <= 0: continue
            x, y = s.scr(tx['lat'], tx['lon'], u, k)
            if tx.get('plain'):
                p = tpatch(tx['text'], OSW(tx.get('size', 64), 'Medium'), tx.get('fg', (170, 164, 152)), track=6)
                blit(f, p, x, y, a, 'cc')
            else:
                bar_label(f, tx['text'], x, y, tx.get('size', 96), tx.get('fg', WHITE), tx.get('bg', BLACK), 1, 'cc', a)
        return f

# ---------------------------------------------------------------- charts & cards
def title_block(f, title, sub, tl, x=150, y=300, col=WHITE):
    e = eo(prog(tl, 0.1, 0.5))
    blit(f, tpatch(title, ANTON(150), col), x, y, 1, 'lt', e)
    if sub: blit(f, tpatch(sub, INTER(64, 'Medium'), GREY), x, y + 200, eo(prog(tl, 0.35, 0.5)))

def fmt(v, dec=0):
    return f"{v:,.{dec}f}"

class Bars(Shot):
    """bars: list of dict(label, v, col, txt, at(abs time) optional)."""
    def __init__(s, title, sub, bars, src, kick=None, maxv=None, unit=''):
        s.title, s.sub, s.bars, s.src, s.kick, s.maxv, s.unit = title, sub, bars, src, kick, maxv, unit
        s.vign = False
    def frame(s, tl):
        f = blank(); title_block(f, s.title, s.sub, tl)
        n = len(s.bars); top = 760; avail = H - top - 330; rowh = min(260, avail / n); bh = rowh * 0.56
        x0 = 1100; xmax = W - 700; mv = s.maxv or max(b['v'] for b in s.bars)
        for i, b in enumerate(s.bars):
            t_in = (b['at'] - s.t0) if 'at' in b else 0.6 + i * 0.35
            e = eo(prog(tl, t_in, 1.0)); y = top + i * rowh
            if e <= 0 and 'at' in b and tl < t_in - 0.01:
                pass
            lab = tpatch(b['label'], OSW(78, 'SemiBold'), BONE if b.get('col', BONE) != LIME else WHITE)
            blit(f, lab, 150, y + bh / 2, prog(tl, t_in - 0.2, 0.3), 'lc')
            wbar = (xmax - x0) * b['v'] / mv * e
            rect(f, x0, y, x0 + max(wbar, 6 * (e > 0)), y + bh, b.get('col', BONE))
            if e > 0.05:
                txt = b.get('txt') or fmt(b['v'] * e) + s.unit
                if 'txt' not in b: txt = fmt(b['v'] * e) + s.unit
                vp = tpatch(txt, INTER(84, 'Bold'), b.get('col', BONE) if b.get('col', BONE) != DIM else GREY)
                blit(f, vp, x0 + wbar + 40, y + bh / 2, eo(prog(tl, t_in + 0.2, 0.4)), 'lc')
            if b.get('note') and e > 0.5:
                np_ = tpatch(b['note'], INTER(52, 'Medium'), GREY)
                blit(f, np_, x0, y + bh + 22, eo(prog(tl, t_in + 0.6, 0.5)))
        return f

class Share(Shot):
    """big number + full-width 100% bar split into segments."""
    def __init__(s, big, segs, caption, src, kick=None, count=None, bg=None, bigcol=LIME):
        s.big, s.segs, s.caption, s.src, s.kick, s.count, s.bgp, s.bigcol = big, segs, caption, src, kick, count, bg, bigcol
        s.bgimg = None
    def frame(s, tl):
        if s.bgp and s.bgimg is None:
            ph = Photo(s.bgp, dark=0.72); ph.T = s.T; ph.t0 = s.t0; s.bgimg = ph
        f = s.bgimg.frame(tl) if s.bgimg else blank()
        e = eo(prog(tl, 0.2, 1.2))
        txt = s.big
        if s.count:
            v0, v1, form = s.count; txt = form.format(lerp(v0, v1, e))
        p = tpatch(txt, ANTON(560), s.bigcol)
        blit(f, p, 150, 1270, eo(prog(tl, 0.1, 0.4)), 'lb')
        cy = 1270 + 30
        for i, ln in enumerate(wrap(s.caption, INTER(84, 'SemiBold'), W - 300 - 0)):
            blit(f, tpatch(ln, INTER(84, 'SemiBold'), BONE), 150, cy + i * 110, eo(prog(tl, 0.5 + i * .1, 0.5)))
        if s.segs:
            x = 150; bw = W - 300; y0, y1 = H - 470, H - 360; acc = 0
            rect(f, x, y0, x + bw, y1, (30, 28, 25))
            for i, (lab, frac, col) in enumerate(s.segs):
                ee = eo(prog(tl, 0.9 + i * 0.45, 0.9))
                xa = x + bw * acc; xb = xa + bw * frac * ee
                rect(f, xa, y0, xb, y1, col)
                if ee > 0.3 and frac > 0.04:
                    lp = tpatch(lab, OSW(52, 'SemiBold'), col if col != DIM else GREY)
                    blit(f, lp, xa + 8, y1 + 22, ee)
                acc += frac
        return f

class Line(Shot):
    """points: list of (x, y, tag); reveal: list of (abs_t, index float); notes: list of (index, text, above)."""
    def __init__(s, title, sub, pts, reveal, src, notes=(), shades=(), kick=None, xr=(2021, 2027), yr=(0, 32), ylab='$ / lb'):
        s.title, s.sub, s.pts, s.reveal, s.src, s.notes, s.shades, s.kick, s.xr, s.yr, s.ylab = title, sub, pts, reveal, src, notes, shades, kick, xr, yr, ylab
        s.base = None
    def P(s, x, y):
        X0, X1, Y0, Y1 = 520, W - 360, H - 380, 700
        return X0 + (x - s.xr[0]) / (s.xr[1] - s.xr[0]) * (X1 - X0), Y0 + (y - s.yr[0]) / (s.yr[1] - s.yr[0]) * (Y1 - Y0)
    def build(s):
        b = blank()
        for yv in range(s.yr[0], s.yr[1] + 1, 10):
            x0, y = s.P(s.xr[0], yv); x1, _ = s.P(s.xr[1], yv)
            cv2.line(b, (int(x0), int(y)), (int(x1), int(y)), (38, 36, 32), 3, cv2.LINE_AA)
            blit(b, tpatch(f'${yv}', MONO(50), GREY), x0 - 30, y, 1, 'rc')
        for xv in range(s.xr[0], s.xr[1] + 1):
            x, y = s.P(xv, s.yr[0])
            blit(b, tpatch(str(xv), MONO(50), GREY), x, y + 40, 1, 'ct')
            cv2.line(b, (int(x), int(y)), (int(x), int(y) + 18), GREY, 3)
        s.base = b
    def idx_at(s, ta):
        cur = 0.0
        for t, ix in s.reveal:
            if ta < t: break
            dur = 1.4 if ix - cur < 2 else 2.4
            cur = lerp(cur, ix, eio((ta - t) / dur))
        return cur
    def frame(s, tl):
        if s.base is None: s.build()
        f = s.base.copy(); title_block(f, s.title, s.sub, tl)
        ta = s.t0 + tl; ix = s.idx_at(ta)
        for (xa, xb, lab, col, t_in) in s.shades:
            a = eo(prog(ta, t_in, 0.7))
            if a <= 0: continue
            (px0, _), (px1, _) = s.P(xa, 0), s.P(xb, 0)
            _, ytop = s.P(0, s.yr[1]); _, ybot = s.P(0, s.yr[0])
            rect(f, px0, ytop, px1, ybot, col, 0.18 * a)
            blit(f, tpatch(lab, OSW(54, 'SemiBold'), col), px0 + 18, ytop + 20, a)
        pp = [s.P(x, y) for x, y, _ in s.pts]
        n = int(math.floor(ix)); fr = ix - n
        path = pp[:n + 1]
        if n + 1 < len(pp) and fr > 0: path = path + [(lerp(pp[n][0], pp[n + 1][0], fr), lerp(pp[n][1], pp[n + 1][1], fr))]
        if len(path) >= 2:
            arr = (np.array(path) * 4).astype(np.int32)
            cv2.polylines(f, [arr], False, (60, 64, 10), 30, cv2.LINE_AA, shift=2)
            cv2.polylines(f, [arr], False, LIME, 14, cv2.LINE_AA, shift=2)
        for i, (x, y, tag) in enumerate(s.pts):
            if i <= ix + 1e-6:
                cv2.circle(f, (int(pp[i][0]), int(pp[i][1])), 16, LIME, -1, cv2.LINE_AA)
        if path:
            hx, hy = path[-1]; cv2.circle(f, (int(hx), int(hy)), 28, WHITE, -1, cv2.LINE_AA)
        for (i, txt, up) in s.notes:
            if ix >= i - 0.02:
                a = eo(clamp((ix - i + 0.02) / 0.3)) if ix < len(s.pts) - 1 or i < len(s.pts) - 1 else 1
                x, y = pp[i]; dy = -150 if up else 150
                cv2.line(f, (int(x), int(y)), (int(x), int(y + dy * 0.75)), WHITE, 4, cv2.LINE_AA)
                bar_label(f, txt, x, y + dy, 70, INK, LIME, 1, 'cb' if up else 'ct', a)
        blit(f, tpatch(s.ylab, MONO(46), GREY), 520, 640, 1, 'lb')
        return f

class Card(Shot):
    """News / document clipping on paper. hl = substring to highlight (at abs time)."""
    def __init__(s, outlet, headline, date, hl=None, hl_at=None, dek=None, kind='news', kick=None, src=None, bgp=None, tilt=-1.2, hsize=128):
        s.outlet, s.headline, s.date, s.hl, s.hl_at, s.dek, s.kind, s.kick, s.src, s.bgp, s.tilt, s.hsize = outlet, headline, date, hl, hl_at, dek, kind, kick, src, bgp, tilt, hsize
        s.card = None; s.bgimg = None
    def build(s):
        cw = 2900; f_h = (SERIF if s.kind == 'news' else SERIF)(s.hsize)
        lines = wrap(s.headline, f_h, cw - 300)
        lh = int(s.hsize * 1.42)
        dek_lines = wrap(s.dek, INTER(62), cw - 300) if s.dek else []
        ch = 420 + len(lines) * lh + (len(dek_lines) * 86 + 60 if dek_lines else 0) + 150
        im = Image.new('RGBA', (cw, ch), PAPER + (255,)); d = ImageDraw.Draw(im)
        of = SERIF(78) if s.kind == 'news' else MONO(56)
        d.text((150, 120), s.outlet, font=of, fill=(20, 18, 16))
        d.line((150, 250, cw - 150, 250), fill=(20, 18, 16), width=4)
        d.text((150, 285), s.date.upper(), font=MONO(46), fill=(110, 104, 96))
        y = 400; s.boxes = []
        full = ' '.join(lines)
        for ln in lines:
            d.text((150, y), ln, font=f_h, fill=(14, 12, 10))
            if s.hl:
                start = 0
                while True:
                    j = ln.find(s.hl.split()[0], start) if False else -1
                    break
            s.boxes.append((150, y, ln)); y += lh
        yy = y + 40
        for ln in dek_lines: d.text((150, yy), ln, font=INTER(62), fill=(70, 66, 60)); yy += 86
        s.card = np.array(im); s.lh = lh; s.fh = f_h
        # highlight rects for words in hl phrase
        s.hlr = []
        if s.hl:
            words = s.hl.lower().split(); ws = set(words)
            for (x0, y0, ln) in s.boxes:
                x = x0
                for wd in ln.split(' '):
                    wl = re.sub(r"[^a-z0-9%$'’-]", '', wd.lower())
                    wlen = f_h.getlength(wd)
                    if wl in ws or wl.strip("'’") in ws: s.hlr.append((x - 10, y0 - 8, x + wlen + 10, y0 + s.hsize * 1.18))
                    x += wlen + f_h.getlength(' ')
    def frame(s, tl):
        if s.card is None: s.build()
        if s.bgp and s.bgimg is None:
            ph = Photo(s.bgp, dark=0.78, kb=((0.5, 0.5, 1.05), (0.5, 0.5, 1.12))); ph.T = s.T; ph.t0 = s.t0; s.bgimg = ph
        f = s.bgimg.frame(tl) if s.bgimg else blank((16, 14, 12))
        card = s.card.copy()
        ta = s.t0 + tl
        if s.hlr:
            he = eio(prog(ta, s.hl_at if s.hl_at else s.t0 + 1.2, 0.9))
            if he > 0:
                tot = sum(r[2] - r[0] for r in s.hlr); cut = tot * he; acc = 0
                ov = card.copy()
                for (x0, y0, x1, y1) in s.hlr:
                    wv = min(x1 - x0, max(0, cut - acc)); acc += x1 - x0
                    if wv > 0: cv2.rectangle(ov, (int(x0), int(y0)), (int(x0 + wv), int(y1)), (221, 231, 6, 255), -1)
                card = np.where(ov[..., :1] != card[..., :1], (card * 0.45 + ov * 0.55).astype(np.uint8), card)
                # re-draw text darkness: multiply blend keeps text visible
        e = eo(prog(tl, 0.0, 0.7)); z = lerp(0.9, 1.0, e) * lerp(1.0, 1.035, tl / max(s.T, 1))
        ang = s.tilt * (1 - 0.3 * e)
        ch, cw = card.shape[:2]
        sc = min(W * 0.8 / cw, H * 0.74 / ch) * z
        M = cv2.getRotationMatrix2D((cw / 2, ch / 2), ang, sc)
        M[0, 2] += W / 2 - cw / 2; M[1, 2] += H / 2 - ch / 2 + 140 * (1 - e) + 40
        warped = cv2.warpAffine(card, M, (W, H), flags=cv2.INTER_AREA, borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))
        ys, xs = np.nonzero(warped[::8, ::8, 3])
        if len(xs):
            x0, x1 = max(xs.min() * 8 - 160, 0), min(xs.max() * 8 + 168, W); y0, y1 = max(ys.min() * 8 - 160, 0), min(ys.max() * 8 + 168, H)
            wr = warped[y0:y1, x0:x1]; fr = f[y0:y1, x0:x1]
            sm = cv2.resize(wr[..., 3], ((x1 - x0) // 4, (y1 - y0) // 4), interpolation=cv2.INTER_AREA)
            sm = cv2.GaussianBlur(sm, (0, 0), 8); sm = cv2.resize(sm, (x1 - x0, y1 - y0))
            sm = np.roll(np.roll(sm, 30, 0), 18, 1)
            shd = sm.astype(np.float32)[..., None] / 255 * 0.6 * e
            al = wr[..., 3:4].astype(np.float32) / 255 * e
            fr[:] = (wr[..., :3] * al + (fr * (1 - shd)) * (1 - al)).astype(np.uint8)
        return f

class Kinetic(Shot):
    """lines: list of (abs_t, text, style) stacked & vertically centred."""
    def __init__(s, lines, bgp=None, dark=0.75, kick=None, src=None, gap=40):
        s.lines, s.bgp, s.dark, s.kick, s.src, s.gap = lines, bgp, dark, kick, src, gap; s.bgimg = None
    def pat(s, text, style):
        if style == 'big': return tpatch(text, ANTON(330), WHITE)
        if style == 'lime': return tpatch(text, ANTON(330), LIME)
        if style == 'red': return tpatch(text, ANTON(330), RED)
        if style == 'mid': return tpatch(text, ANTON(210), WHITE)
        if style == 'midlime': return tpatch(text, ANTON(210), LIME)
        if style == 'tag': return tpatch(text, OSW(70, 'SemiBold'), INK, LIME, (28, 14), track=5)
        return tpatch(text, INTER(90, 'SemiBold'), BONE)
    def frame(s, tl):
        if s.bgp and s.bgimg is None:
            ph = Photo(s.bgp, dark=s.dark); ph.T = s.T; ph.t0 = s.t0; s.bgimg = ph
        f = s.bgimg.frame(tl) if s.bgimg else blank()
        ta = s.t0 + tl
        ps = [(s.pat(t, st), t0) for (t0, t, st) in s.lines]
        tot = sum(p.shape[0] for p, _ in ps) + s.gap * (len(ps) - 1); y = H / 2 - tot / 2
        for (p, t0) in ps:
            e = eo(prog(ta, t0, 0.4))
            blit(f, p, W / 2, y + 50 * (1 - e), e, 'ct'); y += p.shape[0] + s.gap
        return f

class Quote(Shot):
    def __init__(s, photo, crop, quote, attr, src=None, kick=None):
        s.photo, s.crop, s.quote, s.attr, s.src, s.kick = photo, crop, quote, attr, src, kick; s.pan = None
    def frame(s, tl):
        if s.pan is None:
            im = Image.open(s.photo).convert('RGB'); w, h = im.size; x0, y0, x1, y1 = s.crop
            im = im.crop((int(x0 * w), int(y0 * h), int(x1 * w), int(y1 * h)))
            pw = int(W * 0.40); im = im.resize((pw, int(im.height * pw / im.width)), Image.LANCZOS)
            if im.height < H: im = im.resize((int(im.width * H / im.height), H), Image.LANCZOS)
            a = np.array(im); s.pan = a[(a.shape[0] - H) // 2:(a.shape[0] - H) // 2 + H, :int(W * 0.40)].copy()
        f = blank(); pw = s.pan.shape[1]
        e = eo(prog(tl, 0, 0.6)); f[:, :pw] = s.pan; darken(f[:, :pw], 0.08)
        rect(f, pw, 0, pw + 14, H, LIME)
        blit(f, tpatch('“', SERIF(420), LIME), pw + 200, 330, e)
        words = s.quote.split(); fq = SERIFI(118)
        lines = wrap(s.quote, fq, W - pw - 500); y = 720
        shown = int(len(words) * clamp((tl - 0.5) / 2.6)) if tl > 0.5 else 0; c = 0
        for ln in lines:
            ws = ln.split(); vis = ' '.join(ws[:max(0, shown - c)]); c += len(ws)
            if vis: blit(f, tpatch(vis, fq, WHITE), pw + 240, y)
            y += 175
        for j, ln in enumerate(wrap(s.attr, INTER(62, 'SemiBold'), W - pw - 500)):
            blit(f, tpatch(ln, INTER(62, 'SemiBold'), GREY), pw + 240, y + 60 + j * 84, eo(prog(tl, 1.2, 0.6)))
        return f

class DotGrid(Shot):
    def __init__(s, n, k, title, sub, fill_at, legend_on, legend_off, src, kick=None):
        s.n, s.k, s.title, s.sub, s.fill_at, s.lon, s.loff, s.src, s.kick = n, k, title, sub, fill_at, legend_on, legend_off, src, kick
    def frame(s, tl):
        f = blank(); title_block(f, s.title, s.sub, tl); ta = s.t0 + tl
        cols = 10; r = 95; gx = 250; x0 = W / 2 - (cols - 1) * gx / 2; y0 = 1120
        for i in range(s.n):
            cx = x0 + (i % cols) * gx + (gx / 2 if i >= cols else 0); cy = y0 + (i // cols) * 280
            a = eo(prog(tl, 0.4 + i * 0.05, 0.4))
            if a <= 0: continue
            red = i < s.k and ta >= s.fill_at + i * 0.09
            col = RED if red else (70, 66, 60)
            cv2.circle(f, (int(cx), int(cy)), int(r * a), col, -1, cv2.LINE_AA)
            cv2.circle(f, (int(cx), int(cy)), int(r * a * 0.55), (0, 0, 0) if red else (50, 47, 42), 10, cv2.LINE_AA)
        la = eo(prog(ta, s.fill_at + 0.4, 0.5))
        rect(f, 150, H - 560, 210, H - 500, RED, la); blit(f, tpatch(s.lon, OSW(64, 'SemiBold'), WHITE), 250, H - 530, la, 'lc')
        rect(f, 1900, H - 560, 1960, H - 500, (70, 66, 60), la); blit(f, tpatch(s.loff, OSW(64, 'SemiBold'), GREY), 2000, H - 530, la, 'lc')
        return f

class Timeline(Shot):
    def __init__(s, title, events, src, kick=None):
        s.title, s.events, s.src, s.kick = title, events, src, kick
    def frame(s, tl):
        f = blank(); title_block(f, s.title, None, tl); ta = s.t0 + tl
        n = len(s.events); x0, x1, y = 300, W - 300, 1250
        last = max([i for i, e in enumerate(s.events) if ta >= e[0]], default=-1)
        prog_x = x0 + (x1 - x0) * clamp(eo(prog(tl, 0.2, 0.8)) * 0.02 + (last + 0.5) / n if last >= 0 else 0.02)
        cv2.line(f, (x0, y), (x1, y), (48, 45, 40), 8, cv2.LINE_AA)
        cv2.line(f, (x0, y), (int(prog_x), y), LIME, 8, cv2.LINE_AA)
        for i, (t0, date, desc) in enumerate(s.events):
            x = x0 + (x1 - x0) * (i + 0.5) / n; a = eo(prog(ta, t0, 0.5))
            on = i == last; col = LIME if on else (BONE if ta >= t0 else (70, 66, 60))
            cv2.circle(f, (int(x), y), 30 if on else 22, col, -1, cv2.LINE_AA)
            if a > 0:
                up = i % 2 == 0
                blit(f, tpatch(date, ANTON(96), col), x, y - 90 if up else y + 90, a, 'cb' if up else 'ct')
                for j, ln in enumerate(wrap(desc, INTER(56, 'Medium'), 620)):
                    yy = (y - 250 - (len(wrap(desc, INTER(56, 'Medium'), 620)) - 1 - j) * 72) if up else (y + 230 + j * 72)
                    blit(f, tpatch(ln, INTER(56, 'Medium'), BONE if on else GREY), x, yy, a, 'cb' if up else 'ct')
        return f

class Element(Shot):
    def __init__(s, kick=None, src=None, bgp=None):
        s.kick, s.src, s.bgp = kick, src, bgp; s.bgimg = None
    def frame(s, tl):
        if s.bgp and s.bgimg is None:
            ph = Photo(s.bgp, dark=0.8, kb=((0.5, 0.5, 1.2), (0.52, 0.5, 1.3))); ph.T = s.T; ph.t0 = s.t0; s.bgimg = ph
        f = s.bgimg.frame(tl) if s.bgimg else blank()
        e = eo(prog(tl, 0.1, 0.7)); sz = 1000; x = W / 2 - sz / 2 - 700; y = H / 2 - sz / 2 + 60 * (1 - e)
        rect(f, x, y, x + sz, y + sz, (46, 76, 168), e); rect(f, x + 14, y + 14, x + sz - 14, y + sz - 14, (28, 50, 128), e)
        blit(f, tpatch('27', INTER(120, 'Bold'), WHITE), x + 70, y + 70, e)
        blit(f, tpatch('58.933', INTER(84, 'Medium'), (200, 210, 240)), x + sz - 70, y + 80, e, 'rt')
        blit(f, tpatch('Co', INTER(440, 'Bold'), WHITE), x + sz / 2, y + sz / 2 + 20, e, 'cc')
        blit(f, tpatch('COBALT', OSW(110, 'SemiBold'), WHITE, track=10), x + sz / 2, y + sz - 90, e, 'cb')
        tx = x + sz + 200
        for i, (t, st) in enumerate([('HARD. BLUISH.', 'big'), ('BATTERIES · JET ENGINES', 'lime'), ('MAGNETS · TOOLS · CATALYSTS', 'sub')]):
            a = eo(prog(tl, 0.8 + i * 0.5, 0.5))
            p = tpatch(t, ANTON(190) if st != 'sub' else INTER(78, 'SemiBold'), WHITE if st == 'big' else (LIME if st == 'lime' else GREY))
            blit(f, p, tx, H / 2 - 250 + i * 250 + 30 * (1 - a), a)
        return f

class Title(Shot):
    def __init__(s, bgp, big, sub):
        s.bgp, s.big, s.sub = bgp, big, sub; s.bgimg = None; s.vign = True
    def frame(s, tl):
        if s.bgimg is None:
            ph = Photo(s.bgp, dark=0.62, kb=((0.5, 0.5, 1.0), (0.5, 0.5, 1.15))); ph.T = s.T; ph.t0 = s.t0; s.bgimg = ph
        f = s.bgimg.frame(tl)
        e = eo(prog(tl, 0.15, 0.7))
        p = tpatch(s.big, ANTON(470), WHITE)
        blit(f, p, W / 2, H / 2 - 40, 1, 'cb', e)
        ul = eo(prog(tl, 0.6, 0.6)); pw = p.shape[1]
        rect(f, W / 2 - pw / 2, H / 2 - 10, W / 2 - pw / 2 + pw * ul, H / 2 + 26, LIME)
        blit(f, tpatch(s.sub, INTER(84, 'Medium'), BONE), W / 2, H / 2 + 90, eo(prog(tl, 1.0, 0.6)), 'ct')
        return f

class Chapter(Shot):
    def __init__(s, num, title, bgp=None):
        s.num, s.title, s.bgp = num, title, bgp; s.bgimg = None
    def frame(s, tl):
        if s.bgp and s.bgimg is None:
            ph = Photo(s.bgp, dark=0.8); ph.T = s.T; ph.t0 = s.t0; s.bgimg = ph
        f = s.bgimg.frame(tl) if s.bgimg else blank()
        e = eo(prog(tl, 0.0, 0.5))
        blit(f, tpatch(s.num, ANTON(230), LIME), 300, H / 2 + 30, e, 'lc')
        blit(f, tpatch(s.title, ANTON(300), WHITE), 720, H / 2 + 30, 1, 'lc', eo(prog(tl, 0.15, 0.6)))
        return f

class Checklist(Shot):
    def __init__(s, items, final, kick=None):
        s.items, s.final, s.kick = items, final, kick
    def frame(s, tl):
        f = blank(); ta = s.t0 + tl; y = 520
        for (t0, text) in s.items:
            a = eo(prog(ta, t0, 0.4))
            if a > 0:
                cv2.rectangle(f, (300, int(y - 70)), (440, int(y + 70)), LIME, 10, cv2.LINE_AA)
                if a > 0.5:
                    cv2.polylines(f, [np.array([[320, y], [360, y + 50], [440, y - 70]], np.int32)], False, LIME, 18, cv2.LINE_AA)
                blit(f, tpatch(text, ANTON(170), WHITE), 540, y, a, 'lc')
            y += 330
        t0, text, col = s.final; a = eo(prog(ta, t0, 0.35))
        if a > 0:
            darken(f, 0.55 * a)
            blit(f, tpatch(text, ANTON(420), col), W / 2, H / 2, a, 'cc')
        return f

class EndCard(Shot):
    def __init__(s, kind, lines=None):
        s.kind, s.lines = kind, lines or []; s.show_brand = False
    def frame(s, tl):
        f = blank()
        if s.kind == 'method':
            blit(f, tpatch('HOW WE MADE THIS', ANTON(150), LIME), 200, 260, 1, 'lt', eo(prog(tl, 0.1, 0.5)))
            y = 560
            for i, ln in enumerate(s.lines):
                for j, sub in enumerate(wrap(ln, INTER(66, 'Medium'), W - 500)):
                    blit(f, tpatch(sub, INTER(66, 'Medium'), BONE if j == 0 else GREY), 260, y, eo(prog(tl, 0.4 + i * 0.25, 0.5))); y += 92
                y += 40
                rect(f, 200, y - 250 - 0, 214, y - 250, LIME, 0)
        else:
            blit(f, tpatch('SOURCES', ANTON(150), LIME), 200, 220, 1, 'lt', eo(prog(tl, 0.1, 0.5)))
            colw = (W - 400) / 2; y0 = 480
            for i, ln in enumerate(s.lines):
                c = 0 if i < (len(s.lines) + 1) // 2 else 1; r = i if c == 0 else i - (len(s.lines) + 1) // 2
                blit(f, tpatch(ln, INTER(46, 'Medium'), BONE), 200 + c * colw, y0 + r * 84, eo(prog(tl, 0.2 + i * 0.03, 0.4)))
            blit(f, tpatch('SCOOPFEEDS', ANTON(110), LIME), W - 200, H - 150, eo(prog(tl, 0.5, 0.5)), 'rb')
        return f
