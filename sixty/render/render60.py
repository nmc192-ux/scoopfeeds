"""60 · — render a film plan with the shot engine plus the 60 · chrome.

    python render60.py plan.json render  out.mp4
    python render60.py plan.json preview out.jpg 1.0,4.5,9.2
    python render60.py plan.json contact out.jpg

Everything the shot engine draws is reused verbatim (backend/shotengine/render.py
and engine.py are imported, never copied). This file adds only:

  1. THE 60 · CHROME (DRAFT — the approved template was never committed; DrJ rules
     on this one at the Phase 0 checkpoint): a lime stopwatch ring top-right whose
     sweep and number count the film down from 60, with "60 ·" beside it and a
     small SCOOPFEEDS under it. Replaces the engine's plain brand mark.
  2. PER-FILM SHOT CODE: a plan may list `modules` (paths to .py files the Render
     engineer wrote for this film). A shot whose kind starts with "x-" is built by
     calling `make(sp, E)` from the module that exports that kind in `KINDS`.
     The returned object must subclass engine.Shot.

  3. SOURCE LOGO BUGS (DrJ, 13 Oct 2026): a `clip` shot may carry `logo` (a corner code
     tl|tr|bl|br, or a box [x0,y0,x1,y1] normalised 0-1 in the source frame). If the 9:16
     crop window would cut that logo off at any moment of the shot, the footage is shown as a
     full-width 16:9 BAND with the logo intact instead - never a crop that removes it. Each
     decision is written to layout.json beside the plan, for the QA gate.

The tick is audio and lives in sixty/tools/mix.mjs, not here.
"""
import sys, os, re, json, math, importlib.util
HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE = os.path.abspath(os.path.join(HERE, '..', '..', 'backend', 'shotengine'))
sys.path.insert(0, ENGINE)
import numpy as np, cv2
import engine as E
import render as R
from engine import W, H, M, LIME, WHITE, INK, blit, tpatch, ANTON, MONO
from PIL import Image, ImageDraw

FILM_SECS = 60.0
_now = {'t': 0.0}

# ─── 1. The 60 · chrome ────────────────────────────────────────────────────
_mark = {}
def _patch(key, make):
    if key not in _mark: _mark[key] = make()
    return _mark[key]

# DrJ 2 Oct 2026: a small SOLID pill so it reads on dark and pale footage alike; in a
# corner; never over a face (a face under it moves it to the other top corner) and never
# over captions (they start at y 1190, the pill lives at y 250).
PILL_W, PILL_H, PILL_Y = 196, 72, 238
_faces = {'t': -9, 'boxes': []}
# YuNet (OpenCV's own DNN face detector, ~230 KB, free) handles profiles and faces cut by
# the frame edge, which the Haar cascades missed on the 2 Oct stills. Haar is the fallback.
_YUNET = os.path.join(os.path.expanduser('~'), 'sixty', 'models', 'face_detection_yunet_2023mar.onnx')
_yunet = None
try:
    if os.path.exists(_YUNET):
        _yunet = cv2.FaceDetectorYN.create(_YUNET, '', (W // 4, 480), 0.6, 0.3, 50)
except Exception:
    _yunet = None
try:
    _cascade = cv2.CascadeClassifier(os.path.join(cv2.data.haarcascades, 'haarcascade_frontalface_default.xml'))
except Exception:
    _cascade = None

def faces(dst, t):
    """Face boxes in full-frame coords, re-detected every 0.25 s on a 1/4-size frame."""
    if t - _faces['t'] >= 0.25 or t < _faces['t']:
        small = cv2.resize(dst, (W // 4, dst.shape[0] // 4))
        found = []
        if _yunet is not None:
            _yunet.setInputSize((small.shape[1], small.shape[0]))
            _, det = _yunet.detect(cv2.cvtColor(small, cv2.COLOR_RGB2BGR))
            found = [tuple(int(v) for v in d[:4]) for d in (det if det is not None else [])]
        elif _cascade is not None:
            found = list(_cascade.detectMultiScale(cv2.cvtColor(small, cv2.COLOR_RGB2GRAY), 1.15, 8, minSize=(18, 18)))
        _faces['boxes'] = [(x * 4, y * 4, w * 4, h * 4) for (x, y, w, h) in found]
        _faces['t'] = t
    return _faces['boxes']

def _overlaps(box, x0, y0, x1, y1, pad=6):
    x, y, w, h = box
    return not (x + w < x0 - pad or x > x1 + pad or y + h < y0 - pad or y > y1 + pad)

def stopwatch(dst):
    t = _now['t']
    left = max(0, math.ceil(FILM_SECS - t - 1e-6))
    # Corner decided on the bare picture (before chrome) in post() below.
    if _now.get('side') == 'left': x0 = M; x1 = M + PILL_W
    else: x1 = W - M; x0 = x1 - PILL_W
    y0, y1 = PILL_Y, PILL_Y + PILL_H
    r = PILL_H // 2
    pill = dst[y0:y1, x0:x1]
    ov = pill.copy()
    cv2.rectangle(ov, (r, 0), (PILL_W - r, PILL_H), (8, 7, 6), -1)
    cv2.circle(ov, (r, r), r, (8, 7, 6), -1, cv2.LINE_AA); cv2.circle(ov, (PILL_W - r, r), r, (8, 7, 6), -1, cv2.LINE_AA)
    pill[:] = cv2.addWeighted(ov, 0.94, pill, 0.06, 0)
    cx, cy, rr = x1 - r, y0 + r, r - 12
    cv2.circle(dst, (cx, cy), rr, (70, 66, 60), 5, cv2.LINE_AA)
    frac = min(1.0, t / FILM_SECS)
    if frac < 1.0: cv2.ellipse(dst, (cx, cy), (rr, rr), -90, 360 * frac, 360, LIME, 5, cv2.LINE_AA)
    num = _patch(('n', left), lambda: tpatch(str(left), ANTON(30), WHITE))
    blit(dst, num, cx, cy - num.shape[0] // 2, 1.0, 'ct')
    word = _patch('60', lambda: tpatch('60 ·', ANTON(44), LIME))
    blit(dst, word, x0 + 22, cy - word.shape[0] // 2, 1.0, 'lt')

E.brand = stopwatch   # Shot.post() calls brand(f) on every chromed frame

_post = E.Shot.post
def post(self, f, tl):
    # Faces are found on the picture BEFORE any chrome is drawn, then the pill picks a corner.
    xr1 = W - M; xr0 = xr1 - PILL_W
    _now['side'] = 'left' if any(_overlaps(b, xr0, PILL_Y, xr1, PILL_Y + PILL_H) for b in faces(f, _now['t'])) else 'right'
    return _post(self, f, tl)
E.Shot.post = post

_kicker = E.kicker
def kicker(dst, text, a=1.0):
    # When the pill takes the top-left corner, the kicker tag moves just below it.
    if _now.get('side') != 'left': return _kicker(dst, text, a)
    blit(dst, tpatch(text.upper(), E.OSW(38, 'SemiBold'), INK, LIME, (16, 9), track=3), M, PILL_Y + PILL_H + 10, a)
E.kicker = kicker

# ─── 2. Per-film shot code ─────────────────────────────────────────────────
_custom = {}
def load_modules(plan, plan_dir):
    for rel in plan.get('modules', []):
        p = rel if os.path.isabs(rel) else os.path.join(plan_dir, rel)
        spec = importlib.util.spec_from_file_location(os.path.splitext(os.path.basename(p))[0], p)
        mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
        for kind in getattr(mod, 'KINDS', []):
            if not kind.startswith('x-'): raise SystemExit(f'{p}: custom kind {kind!r} must start with "x-"')
            _custom[kind] = mod

_build = R.build_shot
def build_shot(sp, plan):
    k = sp['kind']
    if k.startswith('x-'):
        if k not in _custom: raise SystemExit(f'no module exports kind {k!r}')
        s = _custom[k].make(sp, E)
        if not isinstance(s, E.Shot): raise SystemExit(f'{k}: make() must return an engine.Shot')
        for key in ('kick', 'src', 'cred'):
            if sp.get(key): setattr(s, key, sp[key])
        if 'caps' in sp: s.caps = bool(sp['caps'])
        s.t0, s.T, s.kind, s.fresh = sp['t0'], sp['T'], k, sp.get('fresh', True)
        return s
    return _build(sp, plan)
R.build_shot = build_shot

# ─── 4. Source logo bugs: never crop them out ──────────────────────────────
# A footage shot says where the SOURCE's own logo sits (`logo`: corner code or normalised box;
# "none" = the Researcher looked and there is none). The 9:16 crop is a moving window; if it
# would cut the logo at ANY moment, the whole frame is shown as a full-width 16:9 band instead:
# the house black ground, a 6 px lime rule above and below (the look DrJ approved on the
# 2 Oct film), no pan, no zoom, no vignette. This hooks E.Clip.frame itself, so it also covers
# per-film `x-` shots that inherit it. A subclass with its own frame() keeps its own layout
# and is recorded as "custom" in layout.json for the QA agent to look at.
LOGO_CORNERS = {'tl': (0.0, 0.0, 0.22, 0.22), 'tr': (0.78, 0.0, 1.0, 0.22),
                'bl': (0.0, 0.78, 0.22, 1.0), 'br': (0.78, 0.78, 1.0, 1.0)}
BAND_Y0 = 490              # top of the band; 608 px tall for 16:9 -> 490-1098, clear of the pin (396) and the captions (1190)
BAND_RULE = 6
BAND_MAX_H = 640           # a taller-than-16:9 source is scaled to fit, never cropped
BAND_LABEL_Y, BAND_LABEL_SIZE = 1165, 40   # lower-thirds drop BELOW the band, so they never cover the logo
LAYOUT = []                # one entry per footage shot that declared a logo; written to layout.json

def logo_box(v):
    """-> (x0, y0, x1, y1) normalised, or None for "no logo". Raises on anything unreadable."""
    if v in (None, False, '', 'none', 'None'): return None
    err = f'clip logo {v!r}: use tl|tr|bl|br, a box [x0,y0,x1,y1] in 0-1, or "none"'
    if isinstance(v, str):
        if v.lower() in LOGO_CORNERS: return LOGO_CORNERS[v.lower()]
        raise SystemExit(err)
    try: x0, y0, x1, y1 = [float(a) for a in v]
    except Exception: raise SystemExit(err)
    if not (0 <= x0 < x1 <= 1 and 0 <= y0 < y1 <= 1): raise SystemExit(err + ' (need 0 <= x0 < x1 <= 1 and 0 <= y0 < y1 <= 1)')
    return (x0, y0, x1, y1)

def crop_windows(clip, sw, sh, n=40):
    """The 9:16 crop window (x0, y0, x1, y1 in source px) at n+1 moments of the shot, using Clip.frame's own maths."""
    wins = []
    for i in range(n + 1):
        cx, cy, z = clip.cam(clip.t0 + clip.T * i / n)
        hh = sh * clip.ymax / z; ww = hh * W / H
        if ww > sw: ww = sw; hh = ww * H / W
        x0 = E.clamp(cx * sw - ww / 2, 0, sw - ww); y0 = E.clamp(cy * sh - hh / 2, 0, sh * clip.ymax - hh)
        wins.append((x0, y0, x0 + ww, y0 + hh))
    return wins

def crop_keeps_logo(clip, box, sw, sh, margin_px=2.0):
    """True only if the whole logo box lies inside the crop window at EVERY sampled moment."""
    lx0, ly0, lx1, ly1 = box[0] * sw, box[1] * sh, box[2] * sw, box[3] * sh
    return all(x0 <= lx0 - margin_px and lx1 + margin_px <= x1 and y0 <= ly0 - margin_px and ly1 + margin_px <= y1
               for (x0, y0, x1, y1) in crop_windows(clip, sw, sh))

def band_frame(s, tl):
    """The WHOLE source frame, full width, on the house ground between two lime rules."""
    n = s.sw * s.sh * 3
    buf = s.proc.stdout.read(n)
    if len(buf) == n: s.last = np.frombuffer(buf, np.uint8).reshape(s.sh, s.sw, 3)
    src = s.last if s.last is not None else np.zeros((s.sh, s.sw, 3), np.uint8)
    k = min(W / s.sw, BAND_MAX_H / s.sh)
    bw, bh = int(round(s.sw * k)), int(round(s.sh * k))
    f = E.blank()
    pic = cv2.resize(src, (bw, bh), interpolation=cv2.INTER_AREA)
    if s.dark: E.darken(pic, s.dark)
    x0 = (W - bw) // 2
    f[BAND_Y0:BAND_Y0 + bh, x0:x0 + bw] = pic
    f[BAND_Y0 - BAND_RULE:BAND_Y0] = LIME
    f[BAND_Y0 + bh:BAND_Y0 + bh + BAND_RULE] = LIME
    if s.overlay: s.overlay(f, tl, s)
    E.draw_labels(f, tl, s)
    return f

def _decide_layout(s):
    """Once per shot, when the source size is known: crop if it keeps the logo, else band."""
    box = s.logo_box
    entry = {'t0': s.t0, 'T': s.T, 'path': s.path, 'logo': list(box), 'source': [s.sw, s.sh]}
    if crop_keeps_logo(s, box, s.sw, s.sh):
        entry.update(layout='crop', logo_in_crop=True); s._band = False
    else:
        entry.update(layout='band', logo_in_crop=False, reason='the 9:16 crop window would cut the source logo'); s._band = True
        s.vign = False                      # the vignette dims the frame edges, where logo bugs live
        for L in s.labels:                  # name bars go under the band, never over the footage
            L['y'] = BAND_LABEL_Y; L['size'] = min(int(L.get('size', 56)), BAND_LABEL_SIZE)
        print(f"band: footage at {s.t0:.1f}s ({os.path.basename(s.path)}) - logo outside the 9:16 crop, shown as a full-width 16:9 band", flush=True)
    LAYOUT.append(entry)

_clip_frame = E.Clip.frame
def clip_frame(s, tl):
    if getattr(s, 'logo_box', None) is None: return _clip_frame(s, tl)
    if s.proc is None: s._open()
    if not hasattr(s, '_band'): _decide_layout(s)
    return band_frame(s, tl) if s._band else _clip_frame(s, tl)
E.Clip.frame = clip_frame

_build_prev = build_shot
def build_shot(sp, plan):
    s = _build_prev(sp, plan)
    if 'logo' not in sp or 'path' not in sp or 'cams' not in sp: return s
    box = logo_box(sp['logo'])
    if not isinstance(s, E.Clip):                      # not footage we draw ourselves
        LAYOUT.append({'t0': sp['t0'], 'T': sp['T'], 'path': sp['path'], 'logo': sp['logo'], 'layout': 'custom', 'logo_in_crop': None})
        return s
    if type(s).frame is not clip_frame:                # a per-film subclass with its own frame(): its layout, recorded for the QA agent
        LAYOUT.append({'t0': sp['t0'], 'T': sp['T'], 'path': sp['path'], 'logo': sp['logo'], 'layout': 'custom', 'logo_in_crop': None})
        return s
    if box is None:
        LAYOUT.append({'t0': sp['t0'], 'T': sp['T'], 'path': sp['path'], 'logo': 'none', 'layout': 'crop', 'logo_in_crop': None})
        return s
    s.logo_box = box
    return s
R.build_shot = build_shot

# ─── 3. Playbook: pinned headline/question card, key-word captions ─────────
# plan.pin = {"text": "WHO DECIDES: PENTAGON OR CONGRESS?", "from": 2.4, "until": 57.4}
#   One line, on screen for the whole film (playbook rule 3), under the chrome row.
# plan.keywords = ["20%", "congress"] — caption words drawn INK on a LIME box (rule 7).
PIN_Y = 396
_pin = {}
PIN_LOW_Y = 1108   # above the captions (1190), below lower-thirds (which end at 1080)
def draw_pin(f, t, pin):
    if not pin or not (pin.get('from', 0) <= t < pin.get('until', FILM_SECS - 2.6)): return
    if 'p' not in _pin:
        txt = str(pin['text']).upper(); size = 44
        while size > 26 and ANTON(size).getlength(txt) + 40 > W - 2 * M - 120: size -= 2
        _pin['p'] = tpatch(txt, ANTON(size), WHITE, (12, 10, 9), (18, 10))
    a = E.eo(E.prog(t, pin.get('from', 0), 0.35))
    h, w = _pin['p'].shape[:2]
    # Never over a face: while one sits under the pin's usual place, it drops above the captions.
    y = PIN_Y if not any(_overlaps(b, M, PIN_Y, M + w, PIN_Y + h) for b in _faces['boxes']) else PIN_LOW_Y
    blit(f, _pin['p'], M, y, 0.92 * a)

_norm = lambda w: re.sub(r'[^a-z0-9%$]', '', str(w).lower())
KEYWORDS = set()
def cap_patch(chunks, ci, ai):
    if (ci, ai) in R._cc: return R._cc[(ci, ai)]
    ws = [re.sub(r'[,;:]+$', '', w[0]).upper() for w in chunks[ci]]
    f = E.safe_font(' '.join(ws), ANTON(92))
    widths = [f.getlength(w) for w in ws]; sp = f.getlength(' ')
    tw = int(sum(widths) + sp * (len(ws) - 1)) + 40
    im = Image.new('RGBA', (tw, 150), (0, 0, 0, 0)); d = ImageDraw.Draw(im); x = 20
    for j, (w, wd) in enumerate(zip(ws, widths)):
        if _norm(w) in KEYWORDS:
            d.rectangle((x - 10, 14, x + wd + 10, 136), fill=LIME + (255,))
            d.text((x, 12), w, font=f, fill=INK)
        else:
            d.text((x, 12), w, font=f, fill=LIME if j == ai else WHITE, stroke_width=7, stroke_fill=(0, 0, 0))
        x += wd + sp
    a = np.array(im)
    if a.shape[1] > W - 2 * M:
        a = cv2.resize(a, (W - 2 * M, int(150 * (W - 2 * M) / a.shape[1])), interpolation=cv2.INTER_AREA)
    R._cc[(ci, ai)] = a; return a
R.cap_patch = cap_patch

_frame = R.Renderer.frame
def frame(self, t):
    _now['t'] = t
    f = _frame(self, t)
    draw_pin(f, t, self.plan.get('pin'))
    return f
R.Renderer.frame = frame

if __name__ == '__main__':
    plan_path, mode, out = sys.argv[1], sys.argv[2], sys.argv[3]
    plan = json.load(open(plan_path))
    if abs(plan.get('total', 0) - FILM_SECS) > 1e-6:
        raise SystemExit(f"plan total is {plan.get('total')} — a 60 · film is exactly {FILM_SECS} s")
    load_modules(plan, os.path.dirname(os.path.abspath(plan_path)))
    KEYWORDS.update(_norm(k) for k in plan.get('keywords', []))
    def _write_layout():
        json.dump({'shots': LAYOUT}, open(os.path.join(os.path.dirname(os.path.abspath(plan_path)), 'layout.json'), 'w'), indent=1)
    if mode == 'render': R.render(plan, out); _write_layout()
    elif mode == 'preview': R.stills(plan, [float(x) for x in sys.argv[4].split(',')], out)
    elif mode == 'contact':
        T = plan['total']; R.stills(plan, [round(T * (i + 0.5) / 12, 2) for i in range(12)], out)
    else: raise SystemExit(f'unknown mode {mode}')
