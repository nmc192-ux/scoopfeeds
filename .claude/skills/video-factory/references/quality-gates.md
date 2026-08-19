# Quality gates

`node engine/qc.mjs <film.mp4>` measures these from the artifact.

## Gates

| Gate | Target | Measured by | Provenance |
|---|---|---|---|
| integrated loudness | -14 LUFS ±1.5 | `loudnorm=print_format=json` | platform normalisation |
| clipping (flat factor) | 0.000 | `astats` | real clipping in decoded audio |
| stereo side channel | > -60 dB | `aeval` L-R + `volumedetect` | a mono bed measured -91 dB |
| median shot length | <= 6s | `out/shots.json` | Vox 3.42s; v1 7.69s felt static |
| shots under 2s | >= 8% | `out/shots.json` | Vox 21%; v1 0% |
| shorts count | >= 3 | directory | distribution needs several entries |
| shorts duration + size | < 59s, 1080x1920 | `ffmpeg -i` | platform limits |

## Deliberately not a gate

**True peak on the encoded file.** Lossy decode legitimately overshoots the
encoder's input peak. A correctly mastered film (pre-encode peak -0.588 dB) read
+2.09 dBTP and would have failed a gate it should never have been subject to.
It prints as context. Clipping is judged by flat factor.

## Measure the artifact, never the plan

Rhythm gates read `out/shots.json`, which `build.mjs` emits from the actual shot
plan. An earlier version inferred shot length from SRT cue spacing — but cues
are **beats**, and a beat holds several shots, so it reported a 7.39s median for
a film whose real median shot was 5.34s and failed a gate the film passed.

If `shots.json` is missing the gate reports **UNVERIFIED**, not FAIL and not
PASS. Unmeasured is never reported as passing.

## Not measured here

- unreadable cards and text-card interruptions — `build.mjs` reports both counts
- thumbnail legibility at 168px — render it small and look
- whether the first 15 seconds earn the next 15
