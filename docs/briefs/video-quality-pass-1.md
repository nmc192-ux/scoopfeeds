# CC BRIEF — Video Quality Pass 1: Audio Mix + Script Arc

**Repo:** scoop-news · **Base:** current `main` (verify with `git log -1` before branching)
**Goal:** move the autoposted YouTube videos from "correct animated infographic" to "produced explainer."

This pass deliberately does **not** touch the renderer, the selection gates, Rule 0, the
Facebook cross-post, or the publish path. Two independent workstreams on two branches:

| | Branch | Touches |
|---|---|---|
| **A — Audio mix** | `feat/video-music-bed` | assembler, TTS settings, `backend/assets/music/`, flags |
| **B — Script arc** | `feat/video-script-arc` | `videoSpecWriter.js`, `videoSpecSchema.js`, harness |

The file sets are disjoint, so A and B can be built in either order or in parallel.
The only shared files are `env_reference.md` and `docs/video-pipeline.md` — expect a
trivial conflict there and resolve by keeping both sections.

---

## Standing rules for this pass

1. **Rule 0 is untouchable.** Do not read, refactor, or "tidy" `videoPakistanBlock.js`.
2. **No silent degrades.** Every new failure path either throws with a named error or logs
   at `warn` with the reason and the fallback taken. Never `null`, never a swallowed catch.
3. **Measure, don't eyeball.** Audio quality especially — see the verification sections.
   If a claim can't be backed by a number from `ffprobe`/`astats`/a test, say it's unverified.
4. **`parseInt(x) || default` is banned** in all new flag parsing. `0` and `0.5` both collapse
   to the default under that idiom; this has already bitten us on `FACEBOOK_VIDEO_MAX_MB`.
   Use an explicit parse + `Number.isFinite` check.
5. **Migration ids:** check the current max in `migrate.js` before writing one. Two agents
   have appended to that hand-maintained array minutes apart before; the array is keyed by id
   and a duplicate is **silently skipped at runtime with no error**.
6. Every new env flag goes into `env_reference.md`. That file currently documents zero
   `VIDEO_*` vars, which is its own defect — this pass starts fixing it.

---

# WORKSTREAM A — Audio mix

## Why

The videos are voice-over-silence. Nothing marks a video as automated faster. A quiet
music bed under the narration, plus a proper loudness target, is the single largest
change in perceived production value available to us, and it costs one ffmpeg stage.

## A1. Track library

Create `backend/assets/music/` in the repo (baked into the image — no runtime download,
no missing-asset failure in prod).

- **8–10 tracks**, each trimmed to **≤ 2:30** (videos run 60–100s) and encoded
  **128 kbps stereo MP3**. Budget ≈ 2 MB/track, ≈ 20 MB total. That is acceptable
  repo weight; anything larger is not.
- **Licensing is a hard requirement, not a preference.** Use only tracks that are free
  for commercial use with **no attribution required** — the YouTube Audio Library filtered
  to "no attribution" is the safest source. Do **not** use anything CC-BY unless you also
  build the attribution line into the description builder, which is out of scope here.
- Ship `backend/assets/music/LICENSES.md` recording, per track: filename, title, source
  URL, license, attribution-required yes/no, date downloaded. A test asserts every file in
  the directory has an entry and every entry has a file.
- Ship `backend/assets/music/manifest.json`: `[{file, tone, bpmFeel}]` where `tone` is one
  of `tense | neutral | forward`. A test asserts every tone bucket has **≥ 2** tracks, so
  no bucket can degenerate to a single repeated track.

**Do not commit the audio files until DrJ has confirmed the source and licence.** Build
against 2–3 placeholder tracks he supplies, and open the PR with the manifest schema plus
the tests, so the library can be dropped in without code changes.

## A2. Track selection

New module `backend/src/services/videoMusic.js`.

```
selectTrack({ articleId, category, lastTrackFile }) -> { file, tone, reason }
```

- Map article `category` → tone bucket. Keep the map small, explicit and in one place;
  default to `neutral` for anything unmapped, and log the unmapped category once per
  process so the map can grow from real data rather than guesswork.
- Within the bucket, pick deterministically: `hash(articleId) % bucket.length`. Determinism
  matters — a re-render of the same article must produce the same video.
- If the pick equals `lastTrackFile`, take the next index in the bucket. This is why the
  bucket floor is 2.
- Missing file, unreadable file, empty bucket → return `null` with a `warn` naming the
  cause. **Music is decorative; its absence must never fail a video.** This is the opposite
  of `VoiceError`, which is a hard failure because voice is content. State that contrast in
  a comment so nobody "fixes" the asymmetry later.

## A3. Recording which track played (migration)

Add `music_track TEXT` to `video_posts` (nullable). Two reasons: the no-repeat rule needs
`lastTrackFile`, and if a licence question ever arises we can say exactly which track is on
which published video.

- Check the max migration id first (023 and 024 are known to exist; another agent may have
  taken 025 since).
- Use 010's idempotent `PRAGMA` idiom, as 023 did.
- **Also add the guard CC asked for previously:** a test asserting the `MIGRATIONS` array has
  unique, strictly-ascending ids. Prove it by temporarily duplicating an id and watching the
  test fail.

`lastTrackFile` comes from a `SELECT music_track FROM video_posts WHERE music_track IS NOT
NULL ORDER BY published_at DESC LIMIT 1`.

## A4. The mix stage

This is the core of the workstream. Current assembly muxes narration onto the composed
video. New stage sits between "narration audio is final" and "mux."

Target filter graph (ffmpeg 5.1 in the container has `sidechaincompress`, `loudnorm` and
`xfade` — all three verified present):

```
[music] aloop=loop=-1:size=2e9, atrim=0:DUR,
        afade=t=in:st=0:d=1.5, afade=t=out:st=DUR-2.0:d=2.0,
        volume=<VIDEO_MUSIC_GAIN_DB>dB                       [mus]
[voice] asplit=2                                             [v1][sc]
[mus][sc] sidechaincompress=threshold=0.05:ratio=8:attack=20:release=400  [duck]
[v1][duck] amix=inputs=2:duration=first:dropout_transition=0  [mixed]
[mixed] loudnorm=I=-14:TP=-1.5:LRA=11                         [out]
```

Notes on each choice — change them if measurement says otherwise, but say so:

- **Sidechain ducking, not static volume.** The music dips only while narration is speaking
  and comes back up in the gaps. That gap-breathing is most of what "produced" sounds like.
- `release=400` is the tunable that decides whether the music swells feel natural or pumpy.
  Try 300/400/600 and keep the measured winner.
- **`loudnorm` targets −14 LUFS integrated / −1.5 dBTP** because that is where YouTube
  normalises. Single-pass is acceptable for v1; run a measurement pass
  (`-af loudnorm=print_format=json -f null -`) on the output and record `output_i` in the
  log line, so drift is visible without a special investigation.
- Music runs to `DUR` = full video length, faded out over the last 2s.

## A5. Tail pad

Add `VIDEO_MUSIC_TAIL_MS` (default **1200**): extend the **last slide's** hold by this much
so the video lands on music rather than cutting on the final syllable.

This is the **only** place this workstream changes durations. Two things to check:

- The state-collapse rule (collapse from second-to-last backwards when caption audio is too
  short) operates on caption audio length, so extending the final hold should not interact
  with it — **verify that, don't assume it.**
- Drift rate is pinned at 0.240 px/frame with amplitude capped by the 2% overscan, so a
  longer final slide must not exceed the cap. Re-run the existing drift gate on a build with
  the tail applied.

## A6. Voice settings

Cheap wins in `videoVoice.js`, all measured against the same caption set:

- Speed **1.05 → 1.00** (documentary narration is slower than podcast narration).
- Stability **0.5 → 0.55–0.65**: more consistent delivery across captions, at some cost in
  expressiveness. Test both ends.
- Try 2–3 voice ids beyond the Rachel default and let DrJ pick from samples.

**Cache-key warning:** the TTS cache is keyed on
`sha1(caption + voiceId + modelId + settings)`. Changing any setting invalidates the entire
cache — correct behaviour, but expect a full-price re-render on the first run after deploy.
Say so in the PR description so it isn't mistaken for a cost regression.

## A7. Flags

| Flag | Default | Meaning |
|---|---|---|
| `VIDEO_MUSIC_ENABLED` | `0` | Master switch. Dark until proven. |
| `VIDEO_MUSIC_GAIN_DB` | `-18` | Bed level before ducking. |
| `VIDEO_MUSIC_TAIL_MS` | `1200` | Music-only landing. `0` must mean zero, not the default. |
| `VIDEO_LOUDNORM_TARGET` | `-14` | Integrated LUFS target. |
| `VIDEO_VOICE_SPEED` | `1.0` | |
| `VIDEO_VOICE_STABILITY` | `0.55` | |

## A8. Verification — this is the part that matters

Audio cannot be checked by looking at it. Required evidence in the PR:

1. **Streams unchanged in shape:** `ffprobe` shows one AAC stereo 48 kHz track, same as now.
2. **Loudness:** measurement pass reports `output_i` within ±1.0 LU of −14 and `output_tp`
   at or below −1.5 dBTP.
3. **Ducking is real, with a number:** take a window where narration is speaking and a window
   where it is silent, run `volumedetect`/`astats` on each, and show the music-only window is
   **≥ 8 dB louder** than the bed under speech. A ducking claim without that delta is not
   evidence.
4. **Off means byte-identical:** with `VIDEO_MUSIC_ENABLED=0`, the output audio stream is
   byte-identical to a build from before this branch (same sha256). Prove it, don't assert it.
5. **Missing track degrades, doesn't fail:** delete a manifest-listed file, run, and show the
   video still completes with a warn naming the missing file.
6. **No-repeat holds:** two consecutive videos in the same tone bucket get different tracks.

Then produce **one full sample video** from a real prod article for DrJ to listen to,
alongside the same article rendered without music, so the comparison is direct.

---

# WORKSTREAM B — Script arc

## Why

The captions are accurate and independent. Read aloud in sequence they are a list of
correct facts, not a story. Vox-style scripts have a shape: a hook that creates a question,
beats that answer it with connective tissue between them, a turn, and a close that says why
it matters. Everything here is prompt and validation work in `videoSpecWriter.js` /
`videoSpecSchema.js` — no new model, no new call, no renderer change.

## B0. Read this first

The spec output shape is `{beats:[{kind, beat, evidence}], slides:[]}` and emitted content
cards must **equal** `beats.length` exactly (excluding title/kicker/sources). That equality
constraint is load-bearing and must survive this pass.

**Consequence:** style problems must never cause a card **drop**, because a drop breaks the
equality. Follow the split that already exists on the packaging path — *trust failures
reject, style failures warn.* Arc violations are spec-level rejections that consume the
**existing single regeneration retry**, not new drops and not a second retry budget.
Correction notes still go through `stripCounts`.

## B1. Cold open

The title card's spoken caption currently restates the headline. Require instead a **hook**:
a question, a stake, or a concrete anomaly — something that makes the next 60 seconds feel
necessary.

Teach it with a **CORRECT / WRONG worked example** in the prompt. That technique is what
completely fixed the `stat` `lines` defect; abstract instructions have failed repeatedly on
this model. Two or three contrasting pairs, marked ILLUSTRATIVE ONLY as the beats example is.

**Validation:** reuse the existing `tooSimilar` helper (60% content-word overlap, recovered
from `01638c7`). If the opening caption overlaps the article headline above threshold, the
spec is rejected as `hook_restates_headline` and regenerated once.

## B2. Connective tissue

Each content caption after the first should relate to the one before it, not stand alone.

**The trap:** ban-lists and required openers produce five captions all starting
"But here's the catch." Do not prescribe openers. Instead:

- State the requirement as a relationship ("each beat must extend, complicate, or contradict
  the one before it — the viewer should never wonder why this fact follows that one").
- Add a **repetition warning**, not a rejection: if the same 3-word opening stem appears in
  more than two captions, emit a warning carrying the stem and the count. Warnings surface in
  the harness; they don't block a video.

## B3. The closer must answer "so what?"

The kicker currently tends to restate or credit. Require an implication, a consequence, or
what to watch next.

**Validation:** kicker caption fails `tooSimilar` against **both** the headline and the
opening caption → reject as `closer_restates` → single regeneration.

## B4. Verify the attribution amendment actually landed

There is an editorial ruling from Aug 2 that amends §3b/3: **one verbal mention per source is
sufficient; mention again only if the source changes.** The on-screen credit stays on every
figure card. It is not recorded whether the code was ever changed to match.

Check `videoSpecSchema.js`. If it still requires the source named in every stat/bars caption,
that single rule is producing the monotony DrJ flagged in the very first video — five captions
opening "Yahoo Finance reports that." Fix it: enforce credit on the **first** figure card and
on any card where the outlet changes; enforce the on-screen credit field on all of them.

If it was already fixed, say so and move on.

## B5. Optional, if B1–B4 land cleanly

**Rendered caption line count.** The 2-line limit is currently predicted from character count
and the predictor is measurably conservative — two flagged slides rendered 2 lines each in the
first published video. Measure the rendered line count from the actual satori layout instead
of predicting it. Small, self-contained, removes a class of false warnings.

**Turn card `prior` field.** The `turn` card was collapsed and its strikethrough dropped
because the schema has no prior-assumption field. Adding `prior` re-enables a genuine
before/after contrast, which is the most editorially valuable card type we have. **This
touches the renderer**, so it is out of scope for this pass unless everything else is done —
propose it, don't build it.

## B6. Verification

Run the existing harness over the **same** article set on `main` and on the branch, and print
a side-by-side comparison reporting:

1. Opening-caption ↔ headline overlap (%) — should drop sharply.
2. Count of captions sharing a 3-word opening stem — should fall to ≤ 2.
3. Kicker ↔ headline overlap (%) — should drop.
4. Beats and slide counts — should be **unchanged**; if the arc rules move slide counts, the
   prompt is leaking a length signal again and that has burned us four times.
5. Spec rejection rate and regeneration rate — a big jump means the arc gates are too strict.
6. Token in/out and cost per spec — the scaffold is ~2,290 tokens today; report the new figure.

Then paste 3 full caption sequences, before and after, in the PR. That is what DrJ will judge
this on — the numbers are the guardrail, the read-aloud is the verdict.

---

## Definition of done

- [ ] Both branches green on the full suite (598+ tests at last count), no new skips.
- [ ] `env_reference.md` has a `VIDEO_*` section covering every flag above.
- [ ] `docs/video-pipeline.md` gains an audio section and an arc section.
- [ ] One sample MP4 with music, one without, from the same real article.
- [ ] Before/after caption sequences for 3 articles.
- [ ] Every flag defaults **off/neutral**, so merging is inert until DrJ flips it in prod.
- [ ] Nothing merged to `main` without DrJ's review.

## Deploy order when both are approved

1. Merge B (`feat/video-script-arc`) first — it is prompt-only and reversible by revert.
2. Merge A (`feat/video-music-bed`) second; it carries a migration.
3. `git pull` on prod, **full no-filter rebuild** (new assets in the image), recreate containers.
4. `--force-recreate` is required for `.env` changes — `up -d` does not reliably pick them up.
5. Flip `VIDEO_MUSIC_ENABLED=1` only after the first post-deploy video renders clean without it.
