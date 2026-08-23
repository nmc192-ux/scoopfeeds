# The GPS grammar — a shot-by-shot study of one broadcast segment

Studied 2026-08-24 from a 5:32 recording of Fareed Zakaria's GPS segment
"How China Has Kept Up With America On A.I." (CNN, via the vertical feed).
Method: scdet cut detection on the video region, then 46 frames sampled at
every hard cut plus 8-second intervals inside long holds. Numbers below are
measured from this segment, not recalled from memory about the show.

**Measurement limits, stated up front:** scdet found 28 hard cuts, but GPS
moves between b-roll shots with DISSOLVES, which scdet misses — so the true
shot count is higher and the effective median lower than the hard-cut figures.
And the audio treatment could not be assessed from a phone recording of a
compressed feed; nothing below claims anything about their music.

## The structure, as broadcast

| span | what | note |
|---|---|---|
| 0:00–0:30 | **cold open: proof montage** | leader diptych → data-centre b-roll → dated headline cutting → robot-barista b-roll. Four visual proofs BEFORE the anchor appears. |
| 0:30–1:50 | anchor thesis + evidence | b-roll runs dissolving every 4–8s under continuous narration |
| 1:50–4:30 | interview | split-screen two-ups, reaction shots held, credential chyrons rotating |
| ~4:30 | **the turn, announced by the chyron** | kicker strap rewrites: "HOW CHINA HAS KEPT UP…" → "IS THE A.I. RACE NOT A RACE AT ALL?" |
| 4:30–5:20 | historical analogy + close | b/w Edison archival still, factory-robot b-roll, studio wide |

The arc is ours — cold open, evidence, turn, kicker. What differs is execution.

## The eight devices worth stealing

1. **The leader diptych.** Two SEPARATE photographs butted into a hard
   vertical split — Trump on green foliage, Xi on a red flag. The colour
   contrast does the "opposition" work; no map, no text, no composite. Getty
   credit in the corner. It is the segment's very first frame.

2. **Headline cuttings float over related imagery, and always carry a date.**
   CNBC headline ("JUL 22 2026") over the Moonshot logo field; Washington Post
   ("January 31, 2025") over a DeepSeek phone photo; NYT ("June 15, 2018")
   over the actual photograph of the Xi–Trump trade dinner. The date is part
   of the citation — the exact rule we adopted independently for old footage.
   Our `doc` card sits on plain ground; theirs sits on evidence.

3. **Every third-party asset wears its source in the corner.** Getty, Reuters,
   CNBC — top-right, small, persistent. Trust is rendered, not implied.

4. **The kicker strap is persistent and REWRITES at the turn.** A full-screen
   turn card stops the video to make its point; GPS changes the standing
   question under everything instead, so every subsequent shot argues the new
   thesis. Cheapest possible "act two" marker.

5. **B-roll runs under continuous speech, joined by dissolves, 4–8s a shot,
   thematically literal.** Chip close-up for chips, pylons for power, robot
   barista for "AI in daily life". Nothing decorative; every cutaway is a
   noun from the narration.

6. **Faces are held even when silent.** Split-screen keeps the listener's
   reaction on screen. The camera treats a face as content, not filler — and
   our shorts currently contain zero faces.

7. **Credential chyrons rotate.** The same guest is captioned three ways
   across the segment (staff writer → former Beijing bureau chief → @handle).
   Authority accumulates instead of repeating.

8. **History is black-and-white and dated.** The Edison still reads instantly
   as "another era" — no label needed beyond the credit. Archival public
   domain is a register, not a compromise.

## What this maps to in our stack

| GPS device | our state | build item |
|---|---|---|
| corner source badge | credits live in LICENSES.md, not on screen | **auto-render the badge from the provenance manifest** — the data already exists per insert |
| kicker strap + turn rewrite | full-screen `turn` card only | persistent strap via the existing caption chain; strap text swaps at the turn beat |
| dissolves into b-roll | hard cuts on INSERTS | xfade at insert boundaries in build.mjs |
| leader diptych | mounts exist (fixed in #57), singly | `diptych` card: two mounts, hard split, contrasting grounds — real photos, zero AI |
| cutting over evidence | `doc` card on plain ground | accept a backdrop image, dimmed, with the new image-layer motion (#56) behind the dated cutting |
| literal 4–8s b-roll cadence | footage-search finds it; nothing paces it | selection guidance: one cutaway noun per narration clause |
| recency, or a visible date | date-in-credit rule for old footage | footage-search ranks by asset date vs story window; older assets REQUIRE the dated badge |
| faces | none | the cutout library, already planned — this study is the strongest argument for it |

## What we deliberately do NOT copy

- **The interview form.** We have no guests; split-screen reaction shots
  don't transfer to a narrated format.
- **The anchor.** A face on camera is GPS's spine. Ours is the narration —
  our equivalent of "anchor authority" is the source badge and the date.
- **Their pacing wholesale.** A 22s talking-head open works when the head is
  Fareed Zakaria. Our cold open stays visual — which, notably, is also how
  GPS opens before he speaks.
