# CC BRIEF — Vertical (9:16) video layout

**Repo:** scoop-news · **Base:** current `main` (verify with `git log -1`)
**Branch:** `feat/video-vertical-layout`
**File it at:** `docs/briefs/vertical-layout.md` and commit it, as with the last brief.

## Why

The channel has no audience. The Shorts and Reels feeds are the only surfaces that push
video to people who have never heard of it — the main YouTube feed largely does not. A
60–90 second 16:9 video is in the worst possible shape for that: too short to earn watch
time as longform, wrong aspect to enter the feed that does discovery.

Everything shipped in the last two days — voice, script arc, static slides — improves an
artifact almost nobody sees. This pass is what makes that work matter.

## What this pass does NOT touch

The spec writer, the arc rules, Rule 0, voice, the assembler's audio path, selection, or
publishing. This is **layout and render geometry only**. If you find yourself editing
`videoSpecWriter.js`, `videoSpecSchema.js` or `videoPakistanBlock.js`, stop and report.

---

## Platform facts (verify before relying on any of them)

Gathered Aug 2026; re-check the ones marked ⚠ since they move.

| | |
|---|---|
| Aspect / resolution | 9:16, **1080×1920**, MP4 H.264 |
| YouTube Shorts max length | ⚠ **3 minutes** since Oct 2024 — many sources still print the old 60s figure. Our videos are 60–90s so either way we qualify |
| Shorts classification | Automatic from **duration + aspect ratio**. No `#shorts` tag required |
| Instagram Reels max | ⚠ ~90 seconds for most accounts — the tighter constraint if length ever grows |
| Audio | YouTube normalises to **−14 LUFS**, which is already the loudnorm target chosen for the music work |

**The consequence worth internalising:** we do not need a new upload path for Shorts. A
vertical MP4 under the limit uploaded through the existing YouTube API *is* a Short. This
pass is layout, not distribution.

---

## The central design decision

**Additive per-card-type vertical variants, with an orientation switch. Not a responsive
squeeze of the existing 16:9 layouts.**

Reasoning, so you can argue with it rather than guess at it:

- A single layout that "adapts" to both ratios produces a compromise that is mediocre in
  both. Our cards are information-dense; they need real reflow, not scaling.
- Reframing 16:9 → 9:16 in ffmpeg either letterboxes into a stripe with dead bars top and
  bottom, or crops and **cuts content out of frame**. Neither is acceptable for cards whose
  whole purpose is legibility.
- The existing 16:9 layouts stay **frozen and working**. They are not deleted, not
  refactored, not "generalised". The future longform track will want them. This means the
  pass is genuinely additive and there is no dual maintenance today — 16:9 simply sits
  untouched.

So: an orientation parameter threaded through the render path, vertical layouts added
alongside the existing ones, and the daily loop defaulting to vertical.

If reading the code convinces you a different structure is better, **say so before
building** — this is the one decision worth arguing about, and it is cheaper to argue now.

---

## Step 1 — Reference render before pipeline work

Before wiring anything, render **one still frame of every card type** at 1080×1920 with
representative content, and show them to me. A contact sheet or individual PNGs, either is
fine.

This is the cheapest possible way to catch a layout disaster. Do not build the pipeline
integration and then discover that `bars` is unreadable.

Use realistic worst cases, not friendly ones: the longest caption in the corpus, a `bars`
card with the maximum entries the schema allows, a `stat` with a long label.

## Step 2 — Safe zones

**This is the thing most likely to be got wrong, because it is invisible in your renders
and only appears in the app.**

In the Shorts and Reels feeds the platform overlays its own UI on top of the video:

- **bottom** — title, channel handle, caption, progress bar
- **right edge** — like / comment / share / sound controls
- **top** — occasionally a status or "Shorts" chrome

Content placed there is obscured on the viewer's screen even though the render looks
perfect. Several references recommend keeping key content within a **4:5 safe area** inside
the 9:16 frame.

Implement the safe area as **named constants with a comment explaining what each margin is
protecting against**, not as magic numbers scattered through layouts. And add a debug flag
that renders the safe-area boundary as a visible overlay, so this is checkable by looking
rather than by arithmetic.

Report the margins you chose and what you based them on.

## Step 3 — Per-card-type layouts

Every card type in the closed set needs a vertical variant. The two hard ones:

**`bars`** — horizontal-native. In vertical, entries stack with the label above or beside a
shorter bar, and the maximum readable entry count is lower than in 16:9. If the schema
allows more entries than vertical can show legibly, report that — it is a schema question,
not a layout one, and I will decide.

**`diagram`** — same problem, worse. Report what the current diagram card actually renders
before proposing a vertical form; I would rather know its real range than have you design
for the general case.

`title`, `stat`, `turn`, `kicker` and `sources` should be more tractable — bigger type,
fewer words per line, more vertical breathing room.

## Step 4 — The caption predictor becomes load-bearing

The 2-line caption limit is currently **predicted from character count**, and that predictor
is already measurably conservative in 16:9 — two slides flagged as over-long rendered fine.

The vertical text column is far narrower, so that prediction will be wrong more often and in
both directions. This was filed as an optional item (B5) in the quality brief; for vertical
it is **mandatory**.

Measure the rendered line count from the actual satori layout instead of predicting it from
character count.

## Step 5 — Pipeline integration

Thread the orientation through, default the daily loop to vertical, and confirm:

- Output is exactly 1080×1920, H.264, MP4
- Duration is unchanged — this pass must not alter timing, state collapse, or the audio mix
- The static-slide work still holds: no drift, no supersample, 2% overscan behaves the same
  at the new geometry (**check this, do not assume — the overscan is a percentage of
  dimensions that just changed**)
- The 400ms inter-slide gap is unaffected

## Step 6 — Full sample

One complete vertical video from a real article, rendered locally, for me to watch on a
phone. The bundled ffmpeg on the Mac is 4.4 and has xfade, so this is possible — the header
comment claiming 4.1 was stale and is now corrected.

**Watch it on a phone yourself before sending it.** A layout that reads on a 27-inch monitor
can be illegible at actual size, and that is the entire point of this pass.

---

## What I need reported

1. The **reference stills** from Step 1, before pipeline work.
2. The **safe-area margins** chosen and their basis.
3. Any card type where vertical **cannot** legibly carry what the schema permits — with the
   number, so I can decide whether to constrain the schema.
4. Whether the overscan needs re-deriving at the new geometry.
5. Full suite green, with the count.
6. One complete sample video.

Nothing merged without my review. Default the loop to vertical, but keep the 16:9 path
selectable — I want a one-line revert if the vertical output disappoints, the same way
`VIDEO_SLIDE_DRIFT_ENABLED` gave me one for the pan.
