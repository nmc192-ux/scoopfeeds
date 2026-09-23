import json, subprocess, numpy as np, re
SR = 48000
TL = json.load(open('timeline.json')); TOTAL = TL['TOTAL']
def load(p):
    b = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', p, '-f', 'f32le', '-ac', '2', '-ar', str(SR), '-'])
    return np.frombuffer(b, np.float32).reshape(-1, 2).copy()
N = int(TOTAL * SR) + SR
V = np.zeros((N, 2), np.float32); M = np.zeros((N, 2), np.float32); X = np.zeros((N, 2), np.float32)
def place(dst, a, t, fin=0.0, fout=0.0):
    i = int(t * SR); a = a[:max(0, min(len(a), N - i))].copy()
    if fin: k = int(fin * SR); a[:k] *= np.linspace(0, 1, k)[:, None]
    if fout: k = int(fout * SR); a[-k:] *= np.linspace(1, 0, k)[:, None]
    dst[i:i + len(a)] += a
place(V, load('audio/vo1.mp3'), TL['OFF'])
rms = lambda a: np.sqrt(np.mean(a ** 2) + 1e-12)
env = np.abs(V).mean(1)
sp = env > 0.02; V *= 10 ** (-19 / 20) / rms(V[sp])
A = load('audio/musA.mp3'); A *= 10 ** (-19 / 20) / rms(A)
place(M, A[:int((TOTAL - 0.05) * SR)], 0, 0.3, 2.5)
# ducking envelope (10 ms frames)
hop = SR // 100; fr = np.abs(V[:len(V) // hop * hop, 0]).reshape(-1, hop).max(1)
act = (fr > 0.03).astype(np.float32); d = np.zeros_like(act); v = 0
for i, a in enumerate(act):
    v = v + (a - v) * (0.25 if a > v else 0.02); d[i] = v
g_db = -8 - 9.5 * d
g = np.repeat(10 ** (g_db / 20), hop); g = np.concatenate([g, np.full(N - len(g), g[-1])])
M *= g[:, None]
# SFX
rng = np.random.default_rng(7)
def whoosh(t, dur=0.42, amp=0.10):
    n = int(dur * SR); w = rng.standard_normal(n).astype(np.float32)
    fc = np.linspace(300, 7000, n) ** 1; y = np.zeros(n, np.float32); s = 0.0
    for k in range(n):
        a = min(1.0, 2 * np.pi * fc[k] / SR); s += a * (w[k] - s); y[k] = s
    e = np.concatenate([np.linspace(0, 1, int(n * .7)) ** 2, np.linspace(1, 0, n - int(n * .7))])
    y *= e * amp / (np.abs(y).max() + 1e-9)
    st = np.stack([y * 0.9, np.roll(y, 40)], 1); place(X, st, max(0, t - dur * 0.75))
def impact(t, amp=0.5):
    n = int(1.6 * SR); tt = np.arange(n) / SR
    y = np.sin(2 * np.pi * (52 - 14 * tt) * tt) * np.exp(-tt * 3.2)
    y += rng.standard_normal(n) * np.exp(-tt * 28) * 0.35
    place(X, (np.stack([y, y], 1) * amp).astype(np.float32), t)
def riser(t, dur=1.4, amp=0.08):
    n = int(dur * SR); w = rng.standard_normal(n).astype(np.float32); e = np.linspace(0, 1, n) ** 3
    place(X, np.stack([w * e * amp, np.roll(w, 90) * e * amp], 1), t - dur)
kinds = TL['kinds']; cuts = TL['cuts']
for i, (t, k) in enumerate(zip(cuts, kinds)):
    if i == 0: impact(0.05, 0.35); continue
    if k in ('Punch', 'Flag'): impact(t, 0.4); whoosh(t, 0.4, 0.07); continue
    gap = cuts[i] - cuts[i - 1]
    whoosh(t, 0.36 if gap > 1.5 else 0.25, 0.07 if gap > 1.5 else 0.05)
mix = V + M + X
np.clip(mix, -1, 1, out=mix)
mix[:int(TOTAL * SR)].astype(np.float32).tofile('mix_raw.f32')
# loudness normalise (two-pass)
cmd = ['ffmpeg', '-v', 'info', '-f', 'f32le', '-ar', str(SR), '-ac', '2', '-i', 'mix_raw.f32', '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-']
out = subprocess.run(cmd, capture_output=True, text=True).stderr
js = json.loads(out[out.rfind('{'):out.rfind('}') + 1])
af = (f"loudnorm=I=-14:TP=-1.5:LRA=11:measured_I={js['input_i']}:measured_TP={js['input_tp']}:measured_LRA={js['input_lra']}:"
      f"measured_thresh={js['input_thresh']}:offset={js['target_offset']}:linear=true")
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', '2', '-i', 'mix_raw.f32', '-af', af, '-ar', '48000', '-c:a', 'pcm_s16le', 'mix_final.wav'], check=True)
print('measured', js['input_i'], js['input_tp'])
