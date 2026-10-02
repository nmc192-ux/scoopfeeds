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

The tick is audio and lives in sixty/tools/mix.mjs, not here.
"""
import sys, os, re, json, math, importlib.util
HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE = os.path.abspath(os.path.join(HERE, '..', '..', 'backend', 'shotengine'))
sys.path.insert(0, ENGINE)
import numpy as np, cv2
import engine as E
import render as R
from engine import W, M, LIME, WHITE, INK, blit, tpatch, ANTON, MONO
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
    if mode == 'render': R.render(plan, out)
    elif mode == 'preview': R.stills(plan, [float(x) for x in sys.argv[4].split(',')], out)
    elif mode == 'contact':
        T = plan['total']; R.stills(plan, [round(T * (i + 0.5) / 12, 2) for i in range(12)], out)
    else: raise SystemExit(f'unknown mode {mode}')
