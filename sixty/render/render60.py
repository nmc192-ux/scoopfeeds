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

def stopwatch(dst):
    t = _now['t']
    left = max(0, math.ceil(FILM_SECS - t - 1e-6))
    cx, cy, r = W - M - 40, 250 + 40, 36
    # dark disc so the ring reads on any picture
    cv2.circle(dst, (cx, cy), r + 10, (12, 10, 9), -1, cv2.LINE_AA)
    cv2.circle(dst, (cx, cy), r, (62, 58, 52), 5, cv2.LINE_AA)
    frac = min(1.0, t / FILM_SECS)
    if frac < 1.0:  # remaining time as a lime arc, sweeping clockwise from 12 o'clock
        cv2.ellipse(dst, (cx, cy), (r, r), -90, 360 * frac, 360, LIME, 5, cv2.LINE_AA)
    num = _patch(('n', left), lambda: tpatch(str(left), ANTON(40), WHITE))
    blit(dst, num, cx, cy - num.shape[0] // 2, 1.0, 'ct')
    word = _patch('60', lambda: tpatch('60 ·', ANTON(52), LIME))
    blit(dst, word, cx - r - 22, cy - word.shape[0] // 2, 1.0, 'rt')
    sf = _patch('sf', lambda: tpatch('SCOOPFEEDS', MONO(20), (215, 211, 200)))
    blit(dst, sf, W - M, cy + r + 18, 0.8, 'rt')

E.brand = stopwatch   # Shot.post() calls brand(f) on every chromed frame

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
PIN_Y = 372
_pin = {}
def draw_pin(f, t, pin):
    if not pin or not (pin.get('from', 0) <= t < pin.get('until', FILM_SECS - 2.6)): return
    if 'p' not in _pin:
        txt = str(pin['text']).upper(); size = 44
        while size > 26 and ANTON(size).getlength(txt) + 40 > W - 2 * M - 120: size -= 2
        _pin['p'] = tpatch(txt, ANTON(size), WHITE, (12, 10, 9), (18, 10))
    a = E.eo(E.prog(t, pin.get('from', 0), 0.35))
    blit(f, _pin['p'], M, PIN_Y, 0.92 * a)

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
