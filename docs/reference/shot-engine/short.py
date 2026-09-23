"""ScoopFeeds native 9:16 short — Greenland pact. Shot list anchored to words (align.json)."""
import sys, json, re, subprocess, math, numpy as np, cv2
from PIL import Image, ImageDraw
import vengine as E
from vengine import (W, H, FPS, INK, LIME, BONE, GREY, WHITE, BLACK, RED, PAPER, ANTON, INTER, OSW, MONO, SERIF, SERIFI,
                     tpatch, blit, rect, darken, bar_label, wrap, eo, eio, prog, clamp, lerp, blank, Shot, Photo, SatZoom, MapShot, vignette)

OFF = 0.30
A = json.load(open('align.json'))[0]
VO_LEN = 59.21
TOTAL = round(OFF + VO_LEN + 1.9, 2)
norm = lambda w: re.sub(r"[^a-z0-9]", "", w.lower())
AN = [norm(w['w']) for w in A]
def at(phrase, k=0):
    p = [norm(x) for x in phrase.split()]
    hits = [i for i in range(len(AN)) if AN[i:i + len(p)] == p]
    if len(hits) <= k: raise ValueError(f'anchor not in script: {phrase!r}')
    return OFF + A[hits[k]]['s']

# ------------------------------------------------------------ vertical chrome (overrides film positions)
M = 54
def kicker(dst, text, a=1.0):
    blit(dst, tpatch(text.upper(), OSW(38, 'SemiBold'), INK, LIME, (16, 9), track=3), M, 250, a)
def source(dst, text, a=1.0):
    blit(dst, tpatch('SOURCE  ' + text.upper(), MONO(24), (215, 211, 200), (12, 10, 9), (14, 8)), M, 1432, a * 0.92, 'lb')
def credit(dst, text, a=1.0):
    blit(dst, tpatch(text, MONO(22), (215, 211, 200), (12, 10, 9), (12, 7)), M, 1474, a * 0.85, 'lb')
BR = tpatch('SCOOPFEEDS', ANTON(44), LIME)
def post(self, f, tl):
    if self.vign: vignette(f)
    if self.kick: kicker(f, self.kick, prog(tl, 0.1, 0.35))
    if self.src: source(f, self.src, prog(tl, 0.3, 0.4))
    if self.cred: credit(f, self.cred, prog(tl, 0.3, 0.4))
    blit(f, BR, W - M, 250, 0.6, 'rt')
Shot.post = post
Shot.caps = True

# ------------------------------------------------------------ footage with a moving 9:16 crop window
class Clip(Shot):
    """cams: list of (abs_t, cx, cy, zoom) in source-normalised coords. ymax crops off burned-in banners."""
    def __init__(s, path, start, cams, ymax=1.0, dark=0.0, labels=(), overlay=None, kick=None, src=None, cred=None, speed=1.0):
        s.path, s.start, s.cams, s.ymax, s.dark, s.labels, s.overlay, s.kick, s.src, s.cred, s.speed = path, start, cams, ymax, dark, labels, overlay, kick, src, cred, speed
        s.vign = True; s.proc = None; s.last = None; s.n = 0
    def _open(s):
        vf = f"fps={FPS / s.speed},scale=1920:1080"
        s.proc = subprocess.Popen(['ffmpeg', '-v', 'error', '-ss', str(s.start), '-i', s.path, '-t', str(s.T * s.speed + 2), '-vf', vf,
                                   '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], stdout=subprocess.PIPE, bufsize=1920 * 1080 * 3 * 2)
    def cam(s, ta):
        cs = s.cams
        if ta <= cs[0][0]: return cs[0][1:]
        for a, b in zip(cs, cs[1:]):
            if ta <= b[0]:
                p = eio((ta - a[0]) / max(b[0] - a[0], 1e-3)); return tuple(lerp(x, y, p) for x, y in zip(a[1:], b[1:]))
        return cs[-1][1:]
    def frame(s, tl):
        if s.proc is None: s._open()
        buf = s.proc.stdout.read(1920 * 1080 * 3)
        if len(buf) == 1920 * 1080 * 3: s.last = np.frombuffer(buf, np.uint8).reshape(1080, 1920, 3)
        src = s.last if s.last is not None else np.zeros((1080, 1920, 3), np.uint8)
        cx, cy, z = s.cam(s.t0 + tl)
        hh = 1080 * s.ymax / z; ww = hh * W / H
        x0 = clamp(cx * 1920 - ww / 2, 0, 1920 - ww); y0 = clamp(cy * 1080 - hh / 2, 0, 1080 * s.ymax - hh)
        k = H / hh
        Mx = np.float32([[k, 0, -k * x0], [0, k, -k * y0]])
        f = cv2.warpAffine(src, Mx, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        darken(f, s.dark)
        if s.overlay: s.overlay(f, tl, s)
        E.draw_labels(f, tl, s)
        return f

# ------------------------------------------------------------ clipping card at vertical scale
class VCard(Shot):
    def __init__(s, outlet, headline, date, hl, hl_at, bg, kick=None, src=None, tilt=-1.5):
        s.outlet, s.headline, s.date, s.hl, s.hl_at, s.bg, s.kick, s.src, s.tilt = outlet, headline, date, hl, hl_at, bg, kick, src, tilt
        s.card = None; s.vign = False; s.bgimg = None
    def build(s):
        cw = 1500; fh = SERIF(104); lines = wrap(s.headline, fh, cw - 160); lh = 146
        ch = 330 + len(lines) * lh + 90
        im = Image.new('RGBA', (cw, ch), PAPER + (255,)); d = ImageDraw.Draw(im)
        d.text((80, 70), s.outlet, font=OSW(74, 'Bold'), fill=(20, 18, 16))
        d.line((80, 190, cw - 80, 190), fill=(20, 18, 16), width=4)
        d.text((80, 215), s.date.upper(), font=MONO(40), fill=(110, 104, 96))
        s.hlr = []; y = 310; ws = set(norm(x) for x in s.hl.split())
        for ln in lines:
            d.text((80, y), ln, font=fh, fill=(14, 12, 10)); x = 80
            for wd in ln.split(' '):
                wl = fh.getlength(wd)
                if norm(wd) in ws: s.hlr.append((x - 8, y - 6, x + wl + 8, y + 122))
                x += wl + fh.getlength(' ')
            y += lh
        s.card = np.array(im)
    def frame(s, tl):
        if s.card is None: s.build()
        if s.bgimg is None:
            s.bgimg = Photo(s.bg, dark=0.72, kb=((0.5, 0.45, 1.05), (0.5, 0.45, 1.12))); s.bgimg.T = s.T; s.bgimg.t0 = s.t0
        f = s.bgimg.frame(tl); card = s.card.copy(); ta = s.t0 + tl
        he = eio(prog(ta, s.hl_at, 0.7))
        if he > 0 and s.hlr:
            tot = sum(r[2] - r[0] for r in s.hlr); cut = tot * he; acc = 0; ov = card.copy()
            for (x0, y0, x1, y1) in s.hlr:
                wv = min(x1 - x0, max(0, cut - acc)); acc += x1 - x0
                if wv > 0: cv2.rectangle(ov, (int(x0), int(y0)), (int(x0 + wv), int(y1)), (221, 231, 6, 255), -1)
            m = (ov[..., :3] != card[..., :3]).any(2, keepdims=True)
            card[..., :3] = np.where(m, np.minimum(card[..., :3], ov[..., :3]), card[..., :3])
        e = eo(prog(tl, 0.0, 0.5)); ch, cw = card.shape[:2]; sc = W * 0.88 / cw * lerp(0.92, 1.0, e)
        Mx = cv2.getRotationMatrix2D((cw / 2, ch / 2), s.tilt, sc); Mx[0, 2] += W / 2 - cw / 2; Mx[1, 2] += 700 - ch / 2 + 80 * (1 - e)
        wp = cv2.warpAffine(card, Mx, (W, H), flags=cv2.INTER_AREA, borderValue=(0, 0, 0, 0))
        al = wp[..., 3:4].astype(np.float32) / 255 * e
        f[:] = (wp[..., :3] * al + f * (1 - al)).astype(np.uint8)
        return f

# ------------------------------------------------------------ kinetic punctuation
class Punch(Shot):
    def __init__(s, lines, bg=None, kick=None, src=None):
        s.lines, s.bg, s.kick, s.src = lines, bg, kick, src; s.caps = False
    def frame(s, tl):
        f = s.bg.frame(tl) if s.bg else blank()
        if s.bg is not None: s.bg.T = s.T; s.bg.t0 = s.t0
        ta = s.t0 + tl; ps = []
        for (t0, text, size, col) in s.lines:
            ps.append((tpatch(text, ANTON(size), col), t0))
        tot = sum(p.shape[0] for p, _ in ps) + 30 * (len(ps) - 1); y = 820 - tot / 2
        for p, t0 in ps:
            e = eo(prog(ta, t0, 0.3)); blit(f, p, W / 2, y + 40 * (1 - e), e, 'ct'); y += p.shape[0] + 30
        return f

class Flag(Shot):
    def __init__(s, t_flag, t_line, kick=None):
        s.t_flag, s.t_line, s.kick = t_flag, t_line, kick; s.caps = False; s.vign = False
    def frame(s, tl):
        f = blank(); ta = s.t0 + tl
        blit(f, tpatch("HERE'S THE TURN", ANTON(120), LIME), W / 2, 430, eo(prog(tl, 0.0, 0.3)), 'cc')
        e = eio(prog(ta, s.t_flag, 0.6))
        if e > 0:
            fw, fh = 780, 520; x0, y0 = (W - fw) // 2, 560
            fl = np.zeros((fh, fw, 3), np.uint8); fl[:fh // 2] = WHITE; fl[fh // 2:] = (200, 16, 46)
            cxp, r = int(fw * 7 / 18), int(fh * 4 / 12)
            circ = np.zeros((fh, fw), np.uint8); cv2.circle(circ, (cxp, fh // 2), r, 255, -1, cv2.LINE_AA)
            top = circ.copy(); top[fh // 2:] = 0; bot = circ.copy(); bot[:fh // 2] = 0
            fl[top > 0] = (200, 16, 46); fl[bot > 0] = WHITE
            wv = int(fw * e); f[y0:y0 + fh, x0:x0 + wv] = fl[:, :wv]
        blit(f, tpatch("THE FLAG", ANTON(150), WHITE), W / 2, 1150, eo(prog(ta, s.t_line, 0.35)), 'cc')
        blit(f, tpatch("DOESN'T CHANGE.", ANTON(150), WHITE), W / 2, 1310, eo(prog(ta, s.t_line + 0.25, 0.35)), 'cc')
        return f

def quote_overlay(q, attr, t_q):
    def ov(f, tl, s):
        ta = s.t0 + tl; g = np.clip(np.linspace(0, 1.6, H - 720), 0, 1)[:, None, None] ** 1.2
        reg = f[720:].astype(np.float32); f[720:] = (reg * (1 - 0.85 * g)).astype(np.uint8)
        blit(f, tpatch('\u201c', SERIF(240), LIME), M, 700, eo(prog(ta, t_q - 0.2, 0.4)))
        y = 930
        for i, ln in enumerate(wrap(q, SERIFI(84), W - 2 * M - 20)):
            blit(f, tpatch(ln, SERIFI(84), WHITE), M + 10, y, eo(prog(ta, t_q + i * 0.25, 0.4))); y += 118
        blit(f, tpatch(attr, INTER(34, 'SemiBold'), BONE), M + 10, y + 24, eo(prog(ta, t_q + 0.6, 0.4)))
    return ov

def names_overlay(items):
    def ov(f, tl, s):
        ta = s.t0 + tl; cur = [it for it in items if ta >= it[0]]
        if cur:
            t0, txt, sz = cur[-1]; bar_label(f, txt, M, 1080, sz, INK, LIME, 1, 'lb', eo(prog(ta, t0, 0.4)))
    return ov

def count_overlay(t0):
    def ov(f, tl, s):
        ta = s.t0 + tl
        blit(f, tpatch('US SITES NAMED IN THE PACT', OSW(46, 'SemiBold'), INK, LIME, (18, 10), track=3), W / 2, 440, eo(prog(tl, 0.0, 0.3)), 'ct')
        v = 1 + 2 * eo(prog(ta, t0, 0.9))
        blit(f, tpatch(f'{int(round(v))}', ANTON(520), WHITE), W / 2, 560, 1, 'ct')
        blit(f, tpatch('WAS 1 · NOW 3', ANTON(80), LIME), W / 2, 1120, eo(prog(ta, t0 + 0.6, 0.4)), 'ct')
    return ov

def end_overlay(f, tl, s):
    blit(f, tpatch('TELL US IN', ANTON(130), WHITE), W / 2, 520, eo(prog(tl, 0.0, 0.35)), 'ct')
    blit(f, tpatch('THE COMMENTS', ANTON(130), LIME), W / 2, 680, eo(prog(tl, 0.2, 0.35)), 'ct')
    blit(f, tpatch('FOLLOW SCOOPFEEDS', OSW(58, 'SemiBold'), INK, LIME, (28, 16), track=4), W / 2, 900, eo(prog(tl, 1.0, 0.35)), 'ct')
    ys = 1060
    for i, ln in enumerate(['SOURCES', 'White House video (public domain) · ABC News / AP', 'CNBC · Al Jazeera · Fortune · U.S. News',
                            'Imagery: Esri · Maps: Natural Earth', 'Photos: U.S. Space Force, C. Ursilva, European Union,', 'Wikimedia Commons (CC BY-SA)']):
        blit(f, tpatch(ln, MONO(26) if i else OSW(30, 'SemiBold'), GREY if i else LIME), W / 2, ys + i * 42, eo(prog(tl, 1.4 + i * 0.08, 0.3)), 'ct')

# ------------------------------------------------------------ shot list
SHOTS = []
def add(t, shot): shot.t0 = t; SHOTS.append(shot)
SIGN, BAN = 'foot/signing.webm', 0.80
PIT = (76.531, -68.703); NAR = (61.161, -45.426); MES = (72.24, -23.93); NUUK = (64.18, -51.72)

# 1 hook: satellite zoom from Greenland to Pituffik
t1 = 0.0
sat = SatZoom([(0.0, 3.95, 72.5, -40.0), (0.7, 3.95, 72.5, -40.0), (at('Greenland.') + 0.2, 13.3, PIT[0], PIT[1] + 0.02)], labels=[
    dict(lat=74.5, lon=-41, text='GREENLAND', size=78, alpha=lambda Z, ta: clamp(1 - (Z - 4.2) / 0.8)),
    dict(lat=PIT[0], lon=PIT[1], text='PITUFFIK SPACE BASE', pin=True, size=48, alpha=lambda Z, ta: clamp((Z - 10.5) / 0.8))])
sat.cred = 'Imagery: Esri World Imagery'
def hook(f, tl):
    for i, (t, fg, bg) in enumerate([('SIGNED.', WHITE, BLACK), ('NOT SOLD.', INK, LIME)]):
        blit(f, tpatch(t, ANTON(140), fg, bg, (34, 18)), W / 2, 400 + i * 205, eo(prog(tl, 0.15 + i * 0.3, 0.35)) * clamp((4.6 - tl) / 0.4), 'ct')
_sf = sat.frame
sat.frame = lambda tl: (lambda f: (hook(f, tl), f)[1])(_sf(tl))
add(t1, sat)

# 2 January: the two leaders during the crisis
add(at('In January,'), Photo('photos/nielsen_frederiksen.jpg', contain=True, kb=((0.5, 0.5, 1.0), (0.5, 0.5, 1.06)), kick='January 2026',
    cred='Photo: Christian Ursilva, CC BY-SA 4.0'))
# 3 tariffs on eight allies: map
EU8 = ['DNK', 'NOR', 'SWE', 'FIN', 'DEU', 'FRA', 'GBR', 'NLD']
ta0 = at('threatened')
add(at('Trump threatened'), MapShot((-30, 33, 45, 76), [(ta0 - 0.3, 11.5, 59.0, 50), (ta0 + 3.5, 11.5, 58.5, 44)], res=3000,
    hi={c: (RED, ta0 + 0.4 + i * 0.16) for i, c in enumerate(EU8)}, grat=10,
    texts=[dict(lat=66.5, lon=-17, text='8 NATO ALLIES', t=at('eight') , size=64, fg=WHITE, bg=RED),
           dict(lat=37.2, lon=10, text='10% TARIFF THREAT', t=at('European'), size=60, fg=INK, bg=LIME)],
    kick='January 2026', src='Fortune, 21 Jan 2026'))
# 4 force: glacier calving
add(at("wouldn't rule"), Clip('foot/eqi.webm', 5.0, [(0, 0.5, 0.5, 1.0)], dark=0.3, kick='January 2026',
    src='CNBC; U.S. News', cred='Video: Giles Laurent, CC BY-SA 4.0'))
# 5 the headline: CNBC clipping over the signing room
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', '690', '-i', SIGN, '-frames:v', '1', '-vf', 'crop=1920:900:0:0', 'photos/sign_still.jpg'])
add(at('On Tuesday,'), VCard('CNBC', 'U.S. strikes Greenland deal at UN to expand military presence at Arctic outposts', '22 September 2026',
    'strikes Greenland deal', at('that fight'), 'photos/sign_still.jpg', kick='UN HQ · New York'))
# 6 punctuation
add(at('Not with'), Punch([(at('Not with'), 'NOT A SALE.', 170, LIME)]))
# 7 the signature itself
add(at('With a signature.'), Clip(SIGN, 641.0, [(0, 0.28, 0.52, 1.25)], ymax=BAN, kick='22 Sep 2026 · UN HQ', cred='Video: The White House, public domain'))
# 8 three leaders holding the pact — pan across as each is named
tT, tF, tN = at('Trump, Denmark\'s'), at('Mette'), at('Jens-Frederik')
add(tT, Clip(SIGN, 690.0, [(tT, 0.17, 0.5, 1.02), (tF - 0.1, 0.17, 0.5, 1.02), (tF + 0.8, 0.47, 0.5, 1.02), (tN - 0.1, 0.47, 0.5, 1.02), (tN + 0.8, 0.79, 0.5, 1.02)],
    ymax=BAN, speed=0.8, kick='The pact', cred='Video: The White House, public domain', overlay=names_overlay([
        (tT + 0.2, 'TRUMP · UNITED STATES', 54), (tF + 0.35, 'FREDERIKSEN · DENMARK', 54), (tN + 0.35, 'NIELSEN · GREENLAND', 54)])))
# 9 Pituffik expands
add(at('It lets'), Photo('photos/pituffik_pano.jpg', kb=((0.30, 0.5, 1.0), (0.42, 0.5, 1.06)), kick='What the pact allows',
    labels=[dict(at=at('expand'), text='EXPAND PITUFFIK', kind='lime', size=64, xy=(M, 1080), anchor='lb')],
    cred='Photo: U.S. Space Force / Paul Honnick, public domain', src='Al Jazeera; AP'))
# 10 map: the new sites, then the whole island
tO = at('open new'); tNa = at('Narsarsuaq'); tMe = at('Mestersvig'); tFl = at('fly and land')
gm = MapShot((-100, 52, 5, 84), [(tO - 0.2, -40, 69.4, 115), (tFl + 2.4, -40, 69.4, 108)], res=3200, grat=10,
    hi={'GRL': (LIME, tFl + 0.1)},
    pins=[dict(lat=PIT[0], lon=PIT[1], t=tO - 0.2, text='PITUFFIK', size=46, fg=INK, bg=LIME, col=LIME),
          dict(lat=NAR[0], lon=NAR[1], t=tNa - 0.1, text='NARSARSUAQ · NEW', size=46, fg=INK, bg=LIME, col=LIME),
          dict(lat=MES[0], lon=MES[1], t=tMe - 0.1, text='MESTERSVIG · NEW', size=46, fg=INK, bg=LIME, dx=-50, col=LIME),
          dict(lat=NUUK[0], lon=NUUK[1], t=tO - 0.2, text='Nuuk', size=36, fg=WHITE, bg=BLACK, col=GREY)],
    texts=[dict(lat=79.5, lon=-76, text='CANADA', t=tO - 0.2, size=40, plain=True), dict(lat=64.4, lon=-21.5, text='ICELAND', t=tO - 0.2, size=40, plain=True),
           dict(lat=82.0, lon=-40, text='FLY & LAND ANYWHERE', t=tFl + 0.3, size=56, fg=INK, bg=LIME)],
    kick='What the pact allows', src='Al Jazeera, 22 Sep 2026')
add(tO, gm)
add(tNa - 0.05, Photo('photos/narsarsuaq.jpg', kb=((0.5, 0.5, 1.02), (0.55, 0.5, 1.08)), kick='South',
    labels=[dict(t=0.15, text='NARSARSUAQ AREA', kind='lime', size=56, xy=(M, 1080), anchor='lb')], cred='Photo: Wikimedia Commons, CC BY-SA 4.0'))
add(tMe - 0.05, Photo('photos/mestersvig.jpg', kb=((0.5, 0.5, 1.02), (0.45, 0.5, 1.08)), kick='East',
    labels=[dict(t=0.15, text='MESTERSVIG AIRFIELD', kind='lime', size=56, xy=(M, 1080), anchor='lb')], cred='Photo: Berland, CC BY-SA 3.0'))
gm2 = MapShot(gm.bbox, gm.cams, res=3200, grat=10, hi=gm.hi, pins=gm.pins, texts=gm.texts, kick=gm.kick, src=gm.src)
add(at('and fly'), gm2)
# 11 no end date
nb = Clip('foot/arcsix.webm', 2.0, [(0, 0.55, 0.55, 1.0)], dark=0.45, cred='Video: NASA / Gary Banziger, public domain')
add(at('And it has'), Punch([(at('no end'), 'NO END', 190, WHITE), (at('date.'), 'DATE.', 190, LIME)], bg=nb, src='Al Jazeera, 22 Sep 2026'))
# 12 the turn
add(at("Here's the turn."), Flag(at('flag'), at("doesn't change.")))
# 13 stays Danish
tD = at('Greenland stays')
add(tD, MapShot((-80, 45, 25, 84), [(tD - 0.2, -18, 66.5, 112), (tD + 2.0, -16, 66.0, 104)], res=3000, grat=10,
    hi={'GRL': (RED, tD), 'DNK': (RED, tD + 0.15), 'FRO': (RED, tD + 0.15)},
    texts=[dict(lat=80.5, lon=-38, text='KINGDOM OF DENMARK', t=tD + 0.3, size=54, fg=WHITE, bg=RED),
           dict(lat=74, lon=-40, text='GREENLAND', t=tD + 0.1, size=40, plain=True, fg=WHITE),
           dict(lat=53.5, lon=10, text='DENMARK', t=tD + 0.3, size=40, plain=True, fg=WHITE)],
    kick='Sovereignty unchanged', src='U.S. News; Al Jazeera'))
# 14 footprint grows: 1 -> 3
add(at('But America\'s'), Photo('photos/pituffik_port.jpg', dark=0.62, kb=((0.5, 0.5, 1.02), (0.5, 0.5, 1.08)), overlay=count_overlay(at('footprint')),
    src='Al Jazeera, 22 Sep 2026', cred='Photo: U.S. Space Force, public domain'))
# 15 reactions — quotes over the real podium footage
q1 = Clip(SIGN, 379.0, [(0, 0.5, 0.40, 1.35)], ymax=BAN, dark=0.1, kick='Reaction', src='ABC News / AP',
          overlay=quote_overlay('A deal that can last forever.', 'METTE FREDERIKSEN · PRIME MINISTER OF DENMARK', at('a deal')))
q1.caps = False; add(at('Frederiksen called'), q1)
q2 = Clip(SIGN, 432.0, [(0, 0.5, 0.40, 1.35)], ymax=BAN, dark=0.1, kick='Reaction', src='ABC News / AP',
          overlay=quote_overlay('A win-win-win agreement.', 'JENS-FREDERIK NIELSEN · PREMIER OF GREENLAND', at('Nielsen called') + 0.4))
q2.caps = False; add(at('Nielsen called'), q2)
# 16 the question, over the handshake
hs = Clip(SIGN, 704.0, [(0, 0.40, 0.5, 1.05), (4.0, 0.52, 0.5, 1.1)], ymax=BAN, dark=0.5)
hs_T = None
add(at('Smart compromise,'), Punch([(at('Smart'), 'SMART', 160, WHITE), (at('compromise,'), 'COMPROMISE?', 150, WHITE),
                                     (at('or too'), 'OR TOO MUCH', 150, LIME), (at('given away?'), 'GIVEN AWAY?', 150, LIME)], bg=hs))
# 17 end card
ec = Clip('foot/eqi.webm', 26.0, [(0, 0.5, 0.5, 1.0)], dark=0.72, overlay=end_overlay)
ec.caps = False; add(at('Tell us'), ec)

for a_, b_ in zip(SHOTS, SHOTS[1:]): a_.T = b_.t0 - a_.t0
SHOTS[-1].T = TOTAL - SHOTS[-1].t0
for s_ in SHOTS:
    if isinstance(s_, Punch) and s_.bg is not None: s_.bg.t0, s_.bg.T = s_.t0, s_.T

# ------------------------------------------------------------ captions (word-by-word, active word lime)
REP = {'eight': '8'}
toks = [[REP.get(norm(w['w']), w['w']), OFF + w['s'], OFF + w['e']] for w in A]
chunks, cur = [], []
for t in toks:
    cur.append(t)
    if re.search(r'[.?!,:;]$', t[0]) or len(' '.join(x[0] for x in cur)) > 14 or len(cur) >= 3: chunks.append(cur); cur = []
if cur: chunks.append(cur)
_cc = {}
def cap_patch(ci, ai):
    if (ci, ai) in _cc: return _cc[(ci, ai)]
    ws = [re.sub(r'[,;:]$', '', w[0]).upper() for w in chunks[ci]]; f = ANTON(92)
    widths = [f.getlength(w) for w in ws]; sp = f.getlength(' '); tw = int(sum(widths) + sp * (len(ws) - 1)) + 40
    im = Image.new('RGBA', (tw, 150), (0, 0, 0, 0)); d = ImageDraw.Draw(im); x = 20
    for j, (w, wd) in enumerate(zip(ws, widths)):
        d.text((x, 12), w, font=f, fill=LIME if j == ai else WHITE, stroke_width=7, stroke_fill=(0, 0, 0)); x += wd + sp
    a = np.array(im)
    if a.shape[1] > W - 2 * M: a = cv2.resize(a, (W - 2 * M, int(150 * (W - 2 * M) / a.shape[1])), interpolation=cv2.INTER_AREA)
    _cc[(ci, ai)] = a; return a
def captions(f, t, shot):
    if not shot.caps: return
    for ci, ch in enumerate(chunks):
        nxt = chunks[ci + 1][0][1] if ci + 1 < len(chunks) else ch[-1][2] + 0.4
        if ch[0][1] - 0.05 <= t < min(nxt, ch[-1][2] + 0.6):
            ai = max([j for j, w in enumerate(ch) if w[1] - 0.05 <= t] or [0])
            blit(f, cap_patch(ci, ai), W / 2, 1190, 1, 'ct'); return

def shot_at(t):
    for s_ in SHOTS:
        if s_.t0 <= t < s_.t0 + s_.T: return s_
    return SHOTS[-1]
def render_frame(t):
    s_ = shot_at(t); tl = t - s_.t0
    f = s_.frame(tl); s_.post(f, tl); captions(f, t, s_); return f

if __name__ == '__main__':
    mode = sys.argv[1]
    if mode == 'plan':
        for i, s_ in enumerate(SHOTS): print(f'{i:2} {s_.t0:6.2f} {s_.T:5.2f} {type(s_).__name__:8} {s_.kick or ""}')
        json.dump(dict(TOTAL=TOTAL, OFF=OFF, cuts=[s_.t0 for s_ in SHOTS], kinds=[type(s_).__name__ for s_ in SHOTS]), open('timeline.json', 'w'))
    elif mode == 'preview':
        ts = [float(x) for x in sys.argv[2].split(',')]; ims = []
        for t in ts:
            s_ = shot_at(t)
            if isinstance(s_, Clip): s_.proc = None; s_.start_saved = s_.start; s_.start = s_.start + (t - s_.t0) * s_.speed
            if isinstance(s_, Punch) and isinstance(s_.bg, Clip): s_.bg.proc = None; s_.bg.start += (t - s_.t0)
            f = render_frame(t)
            if isinstance(s_, Clip): s_.start = s_.start_saved; s_.proc = None
            if isinstance(s_, Punch) and isinstance(s_.bg, Clip): s_.bg.start -= (t - s_.t0); s_.bg.proc = None
            im = Image.fromarray(f).resize((270, 480)); ImageDraw.Draw(im).text((6, 6), f'{t:.1f}', fill='yellow'); ims.append(im)
        c = 8; S = Image.new('RGB', (270 * c, 480 * ((len(ims) + c - 1) // c)))
        for i, im in enumerate(ims): S.paste(im, ((i % c) * 270, (i // c) * 480))
        S.save('cs/preview.jpg', quality=85); print('ok')
    elif mode == 'render':
        n = int(TOTAL * FPS)
        p = subprocess.Popen(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
                              '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', 'video_noaudio.mp4'], stdin=subprocess.PIPE)
        import time; t0 = time.time()
        for i in range(n):
            p.stdin.write(render_frame(i / FPS).tobytes())
            if i % 120 == 0: print(f'frame {i}/{n} {time.time() - t0:.0f}s', flush=True)
        p.stdin.close(); p.wait(); print('done', time.time() - t0)
