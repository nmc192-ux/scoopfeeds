"""Render a shot plan to a silent 1080x1920 MP4, a preview, or a contact sheet.

    python render.py plan.json render  out.mp4
    python render.py plan.json preview out.jpg 1.0,4.5,9.2
    python render.py plan.json contact out.jpg        # 12 evenly spaced frames

THE PLAN is written by the Node side (services/shots/shotPlan.js): the timeline
(every shot's t0 and T, cut on spoken words), the word timings for captions,
local paths for every fetched asset, and the chrome text. This file draws; it
decides nothing editorial — every choice of what to show was made, gated and
recorded before a plan exists.
"""
import sys, os, json, re, math, subprocess, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, cv2
from PIL import Image, ImageDraw
import engine as E
from engine import W, H, FPS, M, LIME, WHITE, INK, blit, tpatch, ANTON, prog, eo, clamp

def build_shot(sp, plan):
    k = sp['kind']
    chrome = {key: sp.get(key) for key in ('kick', 'src', 'cred') if sp.get(key)}
    if 'caps' in sp: chrome['caps'] = bool(sp['caps'])
    labels = [dict(L) for L in sp.get('labels', [])]
    if k == 'clip':
        s = E.Clip(sp['path'], sp.get('start', 0.0), [tuple(c) for c in sp['cams']], ymax=sp.get('ymax', 1.0),
                   dark=sp.get('dark', 0.0), labels=labels, **chrome)
    elif k == 'photo':
        s = E.Photo(sp['path'], kb=tuple(tuple(x) for x in sp.get('kb', ((0.5, 0.5, 1.02), (0.5, 0.5, 1.08)))),
                    contain=sp.get('contain', False), dark=sp.get('dark', 0.0), labels=labels, **chrome)
    elif k == 'satellite':
        import tiles
        keys = [tuple(x) for x in sp['keys']]
        s = E.SatZoom(keys, tiles.mosaics_for(keys), labels=sp.get('slabels', []), **chrome)
    elif k == 'map':
        if sp.get('auto'):
            sp['bbox'], sp['cams'] = E.auto_frame(sp.get('codes', []), [(p['lat'], p['lon']) for p in sp.get('pins', [])] +
                                                  [(p['lat'], p['lon']) for p in sp.get('points', [])], sp['t0'], sp['T'],
                                                  zoom=sp.get('zoom', 1.0), focus=tuple(sp['focus']) if sp.get('focus') else None,
                                                  min_span=sp.get('min_span', 6.0))
        s = E.MapShot(tuple(sp['bbox']), [tuple(c) for c in sp['cams']], hi={iso: (tuple(v[0]), v[1]) for iso, v in sp.get('hi', {}).items()},
                      pins=sp.get('pins', []), texts=sp.get('texts', []), **chrome)
    elif k == 'headline':
        s = E.Headline(sp['outlet'], sp['headline'], sp.get('date', ''), hl=sp.get('hl', ''), hl_at=sp.get('hl_at'), bg=sp.get('bg'), zoom=sp.get('zoom', 1.0), **chrome)
    elif k == 'punch':
        s = E.Punch([tuple(x) for x in sp['lines']], **chrome)
    elif k == 'count':
        s = E.Count(sp['value'], label=sp.get('label', ''), prefix=sp.get('prefix', ''), suffix=sp.get('suffix', ''),
                    decimals=sp.get('decimals', 0), t_start=sp.get('t_start'), bg=sp.get('bg'), settled=sp.get('settled', False), **chrome)
    elif k == 'graphic':
        s = E.Graphic(title=sp.get('title', ''), bars=sp.get('bars', []), unit=sp.get('unit', ''), lines=sp.get('lines', []), hi=sp.get('hi', 0), **chrome)
    elif k == 'end':
        s = E.EndCard(sp.get('sources', []), bg=sp.get('bg'), **chrome)
    else:
        raise ValueError(f'unknown shot kind {k!r}')
    s.t0, s.T = sp['t0'], sp['T']
    s.kind = k
    s.fresh = sp.get('fresh', True)
    return s

# ─── Captions: word-by-word, active word lime (brief §1.5) ──────────────────
CAP_Y = 1190
def build_captions(words):
    toks = [[w['w'], w['s'], w['e']] for w in words]
    chunks, cur = [], []
    for t in toks:
        cur.append(t)
        if re.search(r'[.?!,:;]["”’)]*$', t[0]) or len(' '.join(x[0] for x in cur)) > 14 or len(cur) >= 3:
            chunks.append(cur); cur = []
    if cur: chunks.append(cur)
    return chunks

_cc = {}
def cap_patch(chunks, ci, ai):
    if (ci, ai) in _cc: return _cc[(ci, ai)]
    ws = [re.sub(r'[,;:]+$', '', w[0]).upper() for w in chunks[ci]]
    f = E.safe_font(' '.join(ws), ANTON(92))
    widths = [f.getlength(w) for w in ws]; sp = f.getlength(' ')
    tw = int(sum(widths) + sp * (len(ws) - 1)) + 40
    im = Image.new('RGBA', (tw, 150), (0, 0, 0, 0)); d = ImageDraw.Draw(im); x = 20
    for j, (w, wd) in enumerate(zip(ws, widths)):
        d.text((x, 12), w, font=f, fill=LIME if j == ai else WHITE, stroke_width=7, stroke_fill=(0, 0, 0)); x += wd + sp
    a = np.array(im)
    if a.shape[1] > W - 2 * M:
        a = cv2.resize(a, (W - 2 * M, int(150 * (W - 2 * M) / a.shape[1])), interpolation=cv2.INTER_AREA)
    _cc[(ci, ai)] = a; return a

def draw_captions(f, t, chunks):
    for ci, ch in enumerate(chunks):
        nxt = chunks[ci + 1][0][1] if ci + 1 < len(chunks) else ch[-1][2] + 0.4
        if ch[0][1] - 0.05 <= t < min(nxt, ch[-1][2] + 0.6):
            ai = max([j for j, w in enumerate(ch) if w[1] - 0.05 <= t] or [0])
            blit(f, cap_patch(chunks, ci, ai), W / 2, CAP_Y, 1, 'ct'); return

# ─── Hook (brief §1.7): hook text over the opening place shot for ~4 s ──────
def draw_hook(f, t, hook):
    if not hook or t > hook.get('until', 4.2) + 0.4: return
    fade = clamp((hook.get('until', 4.2) + 0.4 - t) / 0.4)
    for i, (text, col) in enumerate(hook['lines'][:2]):
        fg, bg = (WHITE, E.BLACK) if col != 'lime' else (INK, LIME)
        # FIT THE WIDTH: a long hook line ran off both edges in the first samples.
        size = 118
        while size > 56 and ANTON(size).getlength(text.upper()) + 2 * 30 > W - 2 * M: size -= 4
        blit(f, tpatch(text.upper(), ANTON(size), fg, bg, (30, 16)), W / 2, 400 + i * 180, eo(prog(t, 0.15 + i * 0.3, 0.35)) * fade, 'ct')

class Renderer:
    def __init__(self, plan):
        self.plan = plan
        self.shots = [build_shot(sp, plan) for sp in plan['shots']]
        self.chunks = build_captions(plan.get('words', []))
        self.total = plan['total']
    def shot_at(self, t):
        for s in self.shots:
            if s.t0 <= t < s.t0 + s.T: return s
        return self.shots[-1]
    def frame(self, t):
        s = self.shot_at(t); tl = t - s.t0
        f = s.frame(tl); s.post(f, tl)
        if t < 5: draw_hook(f, t, self.plan.get('hook'))
        if s.caps and not (self.plan.get('hook') and t < self.plan['hook'].get('until', 4.2)):
            draw_captions(f, t, self.chunks)
        return f

def render(plan, out):
    r = Renderer(plan)
    n = int(round(r.total * FPS))
    p = subprocess.Popen(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
                          '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out],
                         stdin=subprocess.PIPE)
    t0 = time.time()
    for i in range(n):
        p.stdin.write(r.frame(i / FPS).tobytes())
        if i % 240 == 0: print(f'frame {i}/{n} {time.time() - t0:.0f}s', flush=True)
    p.stdin.close(); p.wait()
    for s in r.shots:
        if hasattr(s, 'close'): s.close()
    el = time.time() - t0
    print(json.dumps({'frames': n, 'seconds': round(el, 1), 'secs_per_frame': round(el / max(n, 1), 4)}), flush=True)

def stills(plan, times, out, cols=6):
    """Frames at `times`, rendered by seeking each clip to that moment."""
    r = Renderer(plan); ims = []
    for t in times:
        s = r.shot_at(t)
        if isinstance(s, E.Clip):
            s.proc = None; saved = s.start; s.start = saved + (t - s.t0) * s.speed
        f = r.frame(t)
        if isinstance(s, E.Clip):
            s.close(); s.start = saved
        im = Image.fromarray(f).resize((270, 480)); ImageDraw.Draw(im).text((6, 6), f'{t:.1f}s', fill='yellow'); ims.append(im)
    rows = (len(ims) + cols - 1) // cols
    S = Image.new('RGB', (270 * cols, 480 * rows))
    for i, im in enumerate(ims): S.paste(im, ((i % cols) * 270, (i // cols) * 480))
    S.save(out, quality=85)

if __name__ == '__main__':
    plan = json.load(open(sys.argv[1])); mode = sys.argv[2]; out = sys.argv[3]
    E.W, E.H = plan.get('W', W), plan.get('H', H)
    if mode == 'render': render(plan, out)
    elif mode == 'preview': stills(plan, [float(x) for x in sys.argv[4].split(',')], out)
    elif mode == 'contact':
        T = plan['total']; stills(plan, [round(T * (i + 0.5) / 12, 2) for i in range(12)], out)
    else: raise SystemExit(f'unknown mode {mode}')
