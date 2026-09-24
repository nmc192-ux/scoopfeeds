"""The shot engine's sound (shot-engine brief, Phase 5), ported from the approved
sample's mix (docs/reference/shot-engine/mix_short.py).

    python mix.py mix.json

mix.json: { narration, bed (path|null), bed_level ("normal"|"low"|"none"),
            cuts: [{t, kind, turn}], total, out, sr? }

  - BED under the voice, looped with a crossfade when the short outruns it,
    faded in/out, and ENVELOPE-DUCKED under speech (fast attack, slow release —
    the reference's 10 ms follower). `low` sits 10 dB further down: stories
    involving deaths, disasters or grief get a very low bed or none, never a
    driving one (DrJ, 24 Sep 2026).
  - SFX kept SUBTLE (DrJ): a soft filtered whoosh on every cut and a low hit on
    punctuation and turn shots only. No pops, dings or cartoon sounds, and no
    hits at all on a `low` (grief) mix.
  - LOUDNESS: two-pass loudnorm to -14 LUFS, true peak -2 dBTP, LRA 11, written
    as PCM; the caller encodes AAC and re-measures (the bar is -14 +/-1 LUFS and
    true peak <= -1 dBTP AFTER AAC).
Prints one JSON line: the measured first-pass values.
"""
import sys, json, subprocess
import numpy as np

SR = 48000
TARGET = dict(I=-14, TP=-2.0, LRA=11)

def load(path, sr=SR):
    b = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', path, '-f', 'f32le', '-ac', '2', '-ar', str(sr), '-'])
    return np.frombuffer(b, np.float32).reshape(-1, 2).copy()

def rms(a): return float(np.sqrt(np.mean(a ** 2) + 1e-12))

def place(dst, a, t, fin=0.0, fout=0.0):
    i = int(t * SR)
    if i >= len(dst): return
    a = a[:max(0, min(len(a), len(dst) - i))].copy()
    if fin: k = min(len(a), int(fin * SR)); a[:k] *= np.linspace(0, 1, k)[:, None]
    if fout: k = min(len(a), int(fout * SR)); a[len(a) - k:] *= np.linspace(1, 0, k)[:, None]
    dst[i:i + len(a)] += a

def loop_to(a, n, xfade=2.0):
    """Repeat a bed with an equal-power crossfade until it is n samples long."""
    if len(a) >= n: return a[:n]
    k = int(xfade * SR); out = a.copy()
    while len(out) < n:
        fo = np.cos(np.linspace(0, np.pi / 2, k))[:, None]; fi = np.sin(np.linspace(0, np.pi / 2, k))[:, None]
        head = out[:-k]; tail = out[-k:] * fo + a[:k] * fi
        out = np.concatenate([head, tail, a[k:]])
    return out[:n]

rng = np.random.default_rng(7)
def whoosh(dst, t, dur=0.36, amp=0.035):
    """Soft band-limited air, rising — the reference whoosh at roughly half its level."""
    n = int(dur * SR); w = rng.standard_normal(n).astype(np.float32)
    fc = np.linspace(250, 4500, n); y = np.zeros(n, np.float32); s = 0.0
    alpha = np.minimum(1.0, 2 * np.pi * fc / SR)
    for k in range(n):
        s += alpha[k] * (w[k] - s); y[k] = s
    e = np.concatenate([np.linspace(0, 1, int(n * .7)) ** 2, np.linspace(1, 0, n - int(n * .7))])
    y *= e * amp / (np.abs(y).max() + 1e-9)
    place(dst, np.stack([y * 0.9, np.roll(y, 40)], 1), max(0, t - dur * 0.75))

def low_hit(dst, t, amp=0.28):
    """A low, soft impact: a decaying sub sine with a short noise transient. Never a click."""
    n = int(1.4 * SR); tt = np.arange(n) / SR
    y = np.sin(2 * np.pi * (50 - 12 * tt) * tt) * np.exp(-tt * 3.4)
    y += rng.standard_normal(n) * np.exp(-tt * 40) * 0.12
    y[:int(0.004 * SR)] *= np.linspace(0, 1, int(0.004 * SR))   # 4 ms attack: no click
    place(dst, (np.stack([y, y], 1) * amp).astype(np.float32), t)

def main(cfg):
    total = float(cfg['total']); N = int(total * SR) + SR
    V = np.zeros((N, 2), np.float32); Mb = np.zeros((N, 2), np.float32); X = np.zeros((N, 2), np.float32)
    place(V, load(cfg['narration']), 0.0)
    env = np.abs(V).mean(1); sp = env > 0.02
    if sp.any(): V *= 10 ** (-19 / 20) / rms(V[sp])

    level = cfg.get('bed_level', 'normal')
    if cfg.get('bed') and level != 'none':
        A = load(cfg['bed']); A *= 10 ** (-19 / 20) / rms(A)
        if level == 'low': A *= 10 ** (-10 / 20)
        A = loop_to(A, int((total - 0.05) * SR))
        place(Mb, A, 0, 0.4, 2.5)
        # Ducking envelope on 10 ms frames: attack fast, release slow.
        hop = SR // 100; fr = np.abs(V[:len(V) // hop * hop, 0]).reshape(-1, hop).max(1)
        act = (fr > 0.03).astype(np.float32); d = np.zeros_like(act); v = 0.0
        for i, a in enumerate(act):
            v = v + (a - v) * (0.25 if a > v else 0.02); d[i] = v
        g_db = -8 - 9.5 * d
        g = np.repeat(10 ** (g_db / 20), hop); g = np.concatenate([g, np.full(N - len(g), g[-1])])
        Mb *= g[:, None]

    cuts = cfg.get('cuts', [])
    for i, c in enumerate(cuts):
        t = float(c['t'])
        if i == 0: continue   # the opening frame needs no whoosh
        if (c.get('kind') == 'punch' or c.get('turn')) and level != 'low':
            low_hit(X, t); whoosh(X, t, 0.34, 0.03); continue
        gap = t - float(cuts[i - 1]['t'])
        whoosh(X, t, 0.34 if gap > 1.5 else 0.24, (0.035 if gap > 1.5 else 0.025) * (0.5 if level == 'low' else 1.0))

    mix = V + Mb + X
    np.clip(mix, -1, 1, out=mix)
    raw = cfg['out'] + '.f32'
    mix[:int(total * SR)].astype(np.float32).tofile(raw)
    t = TARGET
    first = ['ffmpeg', '-v', 'info', '-f', 'f32le', '-ar', str(SR), '-ac', '2', '-i', raw, '-af',
             f"loudnorm=I={t['I']}:TP={t['TP']}:LRA={t['LRA']}:print_format=json", '-f', 'null', '-']
    err = subprocess.run(first, capture_output=True, text=True).stderr
    js = json.loads(err[err.rfind('{'):err.rfind('}') + 1])
    af = (f"loudnorm=I={t['I']}:TP={t['TP']}:LRA={t['LRA']}:measured_I={js['input_i']}:measured_TP={js['input_tp']}:"
          f"measured_LRA={js['input_lra']}:measured_thresh={js['input_thresh']}:offset={js['target_offset']}:linear=true")
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', '2', '-i', raw, '-af', af,
                    '-ar', str(SR), '-c:a', 'pcm_s16le', cfg['out']], check=True)
    import os; os.remove(raw)
    print(json.dumps({'measured_I': js['input_i'], 'measured_TP': js['input_tp'], 'bed_level': level,
                      'bed': bool(cfg.get('bed')) and level != 'none', 'cuts': len(cuts)}), flush=True)

if __name__ == '__main__':
    main(json.load(open(sys.argv[1])))
