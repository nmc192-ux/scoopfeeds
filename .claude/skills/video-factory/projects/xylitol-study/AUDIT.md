# Xylitol film — visual coverage audit

Generated 2026-09-01 against `storyboard.json` (115 beats) and `beats.json`.
Everything here is derived from files on disk, not estimated.

---

## 0. The premise needs correcting first

> "28 footage files cover a fraction of the beats; the rest are empty."

The real state is different, and it changes what "run acquisition to completion"
will do.

**All 28 files are magenta placeholder slates. There is no real footage at all.**

- Every one is 60–70 KB. A 1080p Pexels clip is 2–15 MB.
- Each decodes to a magenta card reading `PLACEHOLDER — NOT FOR PUBLICATION`
  with the key name on it. Verified by extracting a frame from
  `F_GUM_PACKET_HAND.mp4`.
- `out/footage/_acquired.json` **does not exist**. `acquire.mjs` writes that
  ledger unconditionally on any non-`--dry` run.

So acquisition has never been run to completion in this directory. Nothing was
downloaded and rejected — nothing was attempted.

**The gates were therefore not what blocked it, and turning them off changes
nothing on its own.** The licence gate refuses candidates *after* a search
returns them; no search ever ran. This matters because "both gates are now off"
implies the previous run was blocked by them, and a re-run will now succeed.
The re-run will be the *first* run.

Coverage is also not partial in the way the number suggests: all 71 footage
beats already carry a key, and all 28 keys have a file. The problem is not
missing assignments. It is that every file is fake.

---

## 1. The structural finding: 71 beats, 28 ideas

| Beats carried | Key | Beats |
|---|---|---|
| **9** | `F_GUM_PACKET_HAND` | 1, 3, 104, 106–109, 111, 112 |
| **9** | `F_IV_DRIP_BAG` | 64–70, 74, 76 |
| **6** | `F_LAB_TUBES_RACK` | 8, 10, 11, 14, 15, 20 |
| **5** | `F_KETO_SHELF` | 35, 36, 38, 39, 40 |
| **5** | `F_STOPWATCH_MACRO` | 49, 56, 58, 59, 60 |
| **5** | `F_KITCHEN_SCALE_POWDER` | 83, 84, 85, 87, 91 |
| **4** | `F_CROWD_STREET_SLOMO` | 24, 26, 27, 28 |
| **4** | `F_DOG_KITCHEN_COUNTER` | 95, 97, 101, 102 |
| 2 | `F_SUPERMARKET_AISLE`, `F_DROPLET_COLLISION_MACRO`, `F_TOOTHBRUSH_MACRO`, `F_NUTRITION_LABEL_MACRO` | — |
| 1 | the remaining 16 keys | — |

Two clips are being asked to carry nine beats each. Chapter 6 (beats 64–76) is
**one IV drip bag for thirteen consecutive beats**, across an argument that
moves through four distinct claims and two named groups of researchers.

This is the real reason the cut reads as a slideshow, and acquisition does not
fix it: filling all 28 keys perfectly still yields 28 distinct images for an
eleven-minute film. **It is an authoring gap, not an acquisition gap.**

---

## 2. Beats where stock would be the *wrong* answer

These name something specific, real and checkable. A stock clip here is the
"invented match" to avoid — it does not merely under-deliver, it implies the
viewer is looking at the actual thing when they are not. In a film whose whole
argument is *"I read the actual paper, not the headline"*, that is a
credibility problem, not an aesthetic one.

| Beat | Line | Currently | What it actually needs |
|---|---|---|---|
| **13** | "Last Saturday in Munich, at the world's biggest heart conference, a team from the Charité in Berlin presented this." | `F_ESC_CONGRESS_FLOOR` — generic "conference hall audience" | The **ESC Congress 2026** itself, or the abstract's title block. A stock auditorium standing in for a named, dated event at a named institution is the clearest case of a wrong clip in the film. Failing that: a typographic beat — venue, date, institution — which is honest. |
| **5** | "So I read the actual paper. Not the headline." | `F_HEADLINES_SCROLL` — generic "scrolling news website" | **The real headlines**, as themselves, then the paper's first page. The beat is *about* the gap between the two; a generic screen erases the contrast the line exists to draw. |
| **30** | "In 2023, the same lab published **this** on erythritol" | `F_POURING_SWEETENER` | The **Nature Medicine 2023** paper. "This" is deictic — it points at a document. |
| **56** | "It's what the researchers wrote themselves, in the 2024 paper." | `F_STOPWATCH_MACRO` | The **paper page with that sentence visible**. Beat 57 already quotes it on a card; 56 should show the source. |
| **67** | "Other cardiologists have pushed back, in the same journal, under their own names." | `F_IV_DRIP_BAG` | The **published correspondence**, names legible. "Under their own names" is the whole point of the line. |
| **76** | "…the senior author holds patents with his institution on cardiovascular diagnostics." | `F_IV_DRIP_BAG` | The **disclosure statement or patent record**. This is the film's COI beat; it should be documentary. |
| **100** | "The FDA has warned about this repeatedly." | `F_VET_EXAMINING_DOG` | The **FDA consumer update**. A citable public document, and US federal work — public domain by construction. |

**Beat 68 is the one legitimate use of `F_IV_DRIP_BAG`**: "xylitol was given
intravenously to patients in Germany from the 1970s". The clip fits that line
exactly. It is the other eight beats that stretch it.

---

## 3. The 44 card beats have nothing behind them

Under brief v2, footage is the base layer. These beats are currently cards on
flat near-black (or on one of the six generated grounds):

`4, 6, 7, 12, 18, 19, 21, 22, 25, 29, 31–34, 37, 41, 44–46, 48, 50, 51, 53, 54,
57, 61, 63, 71, 75, 77–80, 86, 88, 92–94, 96, 98, 103, 105, 114, 115`

That is 38 % of the film with no media layer at all. The compositing path to put
footage under them does not exist yet — `build.mjs` has `shotStill` and
`shotCard` as mutually exclusive branches.

---

## 4. What acquisition *can* fill

25 of the 28 keys are ordinary consumer/lab/domestic subjects that Pexels covers
well, and they are legitimate rung-3/4 subject illustration — they illustrate
the *subject*, not the *event*, which is the brief's own Tier-2 rule:

> gum packet · supermarket aisle · birch forest · lab tubes · centrifuge ·
> pipette · hospital corridor · crowd · keto shelf · pouring sweetener · droplet
> macro · pipe interior · stopwatch · breakfast table · blood vial · dentist
> chair · toothbrush · kitchen scale · mixing bowl · ice cream tub · nutrition
> label · dog · vet · handbag · smoke alarm

Expect these to fill. The three that should **not** be filled from stock are
`F_ESC_CONGRESS_FLOOR`, `F_HEADLINES_SCROLL`, and `F_IV_DRIP_BAG` beyond beat 68.

---

## 5. Recommended disposition

1. **Run acquisition** for the 25 legitimate keys. Delete the three misleading
   ones from `QUERIES` so they cannot be filled by accident.
2. **Beats 5, 13, 30, 56, 67, 76, 100 become real-material beats** — headline
   cards, paper excerpts, the FDA notice — sourced through `statement.mjs`-style
   capture rather than stock acquisition. Neither gate touches captured
   material, so this path is open now.
3. **Break up the two nine-beat keys.** Chapter 6 needs roughly four more
   distinct visuals; chapter 9 needs three.
4. **Then** the compositing inversion, so the 44 card beats sit on media.

Steps 2 and 3 are authoring, not acquisition, and they are where the cut stops
looking like a slideshow.
