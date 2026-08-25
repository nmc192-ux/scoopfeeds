# House style

## Palette

From `backend/src/services/videoSlideChrome.js` — keep them in sync.

| Token | Hex | Use |
|---|---|---|
| base | `#090706` | ground |
| lime | `#dde706` | the one accent; emphasis, rules, figures |
| white | `#f5f2ea` | primary type |
| sub | `#cfcabd` | secondary type |
| dim | `#8a8578` | labels, eyebrows |
| faint | `#6b675e` | source credits |
| track | `#4a473f` | bar tracks |
| recededText | `#4a473f` | ledger rows not yet revealed |
| recededFigure | `#3f3c35` | figures not yet revealed |
| recededFill | `#26241f` | fills not yet revealed |
| alert | `#e0452b` | loss, removal, a blocked route |
| water / land | `#0e1a22` / `#191510` | map ground |

Lime is an accent, not a colour scheme. One idea per card carries it.

Fonts: **Anton** for display, **Inter Bold/SemiBold** for everything else.
Both are in `assets/fonts/`.

## Card grammar

`render.mjs` exports these types. Each is a function of progress `p ∈ [0,1]`.

| Card | Carries |
|---|---|
| `title` | the film's title card |
| `chapter` | numbered section divider |
| `statement` | a sentence, set large |
| `stat` | one number with a label |
| `bars` | a small comparison, 2-5 bars |
| `equation` | A vs B, two paths |
| `map` | schematic geography — registry `variant` (hormuz, drc, saudi, uae) or inline `geo: {…}` data |
| `linechart` | a value over time, plotted on a real axis |
| `ledger` | a list revealed row by row |
| `doc` | a captured source screenshot with measured highlights |
| `dotgrid` | proportion of a hundred |
| `pipeline` | ordered stages |
| `quote` | attributed words |
| `tweet` | a captured statement, verbatim from the evidence archive |
| `outro` | the sign-off |

**Entrance and payoff.** Cards in `HAS_PAYOFF` split at `PAYOFF_P = 0.35`: the
card assembles, then the point lands. `build.mjs` times the payoff so the card
is complete well before the shot ends.

**Readability floor.** A shot must hold a card for `words ÷ 3.0` seconds after
it has fully formed, with a 1.4s minimum. `build.mjs` extends shots to satisfy
this and logs every extension. 26 cards once failed this and the video read as
unfollowable.

**Every timing on a HAS_PAYOFF card must complete by `PAYOFF_P` (0.35), except
the payoff itself.** The entrance span is rendered over p∈[0,0.35] and then
HELD; a timing that straddles 0.35 freezes mid-motion and jumps. Check a new
card by rendering at exactly p=0.35 — it must look deliberately paused.

**Maps: shapes in SVG, labels in HTML.** satori does not give its fonts to
images it rasterises, so `<text>` inside a nested SVG renders as nothing.
Every label is an absolutely-positioned div in viewBox coordinates. Draw all
maps in a film on ONE shared base, and keep the thing being avoided on screen
when showing a bypass — a bypass is only legible next to what it bypasses.

**Maps are data, not code.** `backend/src/services/longform/engine/mapGeo.mjs` defines a small element
grammar (`drawPath`, `flowDot`, `pulseMarker`, `regionFill`, `blockMark`, …);
a map card takes `variant` (the shipped registry) or inline `geo: {…}` data —
a new story's geography is authored, not engineered. Colours in map data are
palette TOKENS resolved at render; an unknown string passes through as a
literal (validateGeo does not check colours), so token names are a convention
the review enforces, not the renderer.
`validateGeo` rejects bad data naming the element and field; nothing repairs.

## Motion opt-ins

Each is opt-in per beat/spec, proven pixel-identical to the pre-existing look
when not used, and each must land on exactly the authored content at p=1 —
the animation may change the road, never the destination.

| Opt-in | Where | What it does |
|---|---|---|
| `roll: true` | `stat` | the figure COUNTS to its value over the entrance; prefix, decimals and comma grouping preserved; settles before `PAYOFF_P` |
| `wipe: true` | `equation` | terms UNCOVER left-to-right instead of fading up; same windows |
| `parallax: {fg, shift?, scale?, anchor?}` | photo beats | two-layer collage motion: bg keeps the house Ken Burns, the transparent-PNG cutout drifts the other way. REPLACES the still's motion, never stacks on footage. Validated at plan time (`parallax.mjs`). Costs ~1.5× a plain still shot to encode (measured 2026-08-25, 8s shot, MacBook: 1.08s vs 0.72s — re-measure on the prod host in #75) |

The `doc` card's highlight sweep is not in this table because it is not an
opt-in — measured-rect sweeps have been the default since the card shipped.

**Loss recolours, it does not vanish.** A dot removed from a dotgrid reads as
"never there"; the claim is almost always "these are the loss". Recolour to
`alert` instead.

**Earn-render.** A section renders only when it has real data. An absent element
is correct; placeholders are not.

## Evidence

A principal's post is a **dated declaration** — the register the films already
use. It is also the most forgeable, deletable, context-collapsible artifact in
journalism, so:

- **`statement.mjs` is the only door.** There is deliberately no code path from
  a found screenshot image to a `tweet` card. `captureStatement` fetches the
  live endpoints (syndication primary, oEmbed fallback — both free, no auth)
  and archives the raw responses to `out/evidence/<id>.json` as provenance.
- **X is evidence, never discovery.** Topics come from the event graph and
  `demand.mjs`. The paid X search API buys nothing the graph does not already
  provide, and is not used.
- **Verbatim or nothing.** The card renders from the archive and re-checks it:
  display text may re-break lines, a single changed word throws. No
  paraphrase, no composite, no reconstruction.
- **A reply needs its parent.** Capture the parent first and pass its id;
  a reply quoted out of its thread misrepresents it and is rejected.
- **Re-verified before publish.** `publish-all.mjs` re-fetches every archived
  statement before any upload and REFUSES on deleted/changed. `--evidence-ok`
  overrides, for the case where the deletion is the story — the card has a
  "since deleted" state for exactly that.
- **The card is not X's trade dress.** It is a house quotation card carrying
  verbatim content, attribution, the post date, and the archive date.

### Imagery: the rights-clean registries

Personality cutouts, landmarks and flags live in repo-level registries
(`assets/evidence-assets/`, beside genscenes) and amortize the same way — one
registered portrait serves every film that person appears in, and `uses`
tracks it.

**The license field is the gate.** Allowed: `public-domain` (US federal —
White House, Congress, State, DVIDS, NASA), `cc-by` / `cc-by-sa` (attribution
mandatory, so `author` is required), `handout`. Getty/AP/agency editorial
licenses are structurally absent — adding one is a deliberate commit, not a
looser string. Nothing registers a promise: the file must exist.

`sourcing.md`'s rule is unchanged — every person on screen is real imagery or
inside a cited source. A cutout is a real licensed photo with its background
removed, which complies; synthetic humans never do.

## Rhythm

Reference measurements from a Vox explainer, against our own films:

| | Vox | v1 | v2 |
|---|---|---|---|
| median shot | 3.42s | 7.69s | 5.34s |
| shots under 2s | 21% | 0% | 10% |
| moving frames | 62% | 19% | 37% |

**Motion cadence.** Something should change on screen at least every ~3 seconds
— a payoff landing, a bar filling, a highlight sweeping, a push starting. Vox
runs 62% moving frames against our 37%; that gap is the difference between
"informative" and "watchable", and it is a within-shot property that shot-length
gates do not capture.

Long static shots are the default failure. Break a long beat into two shots with
opposed Ken Burns moves rather than holding one frame.

## Inserts

`INSERTS` cuts a brief image into a beat. **Only on imagery beats, never on a
text card.** Interrupting a slide mid-read and returning to it gives the viewer
time to read neither half — this was the loudest complaint on v2, and there were
ten of them.

## Music

Procedural, built by `music.mjs` with ffmpeg `aevalsrc`. The design that works:

- **112 BPM, A minor.** The first attempt was a 46 BPM drone and made the film
  feel slower and duller — "barely audible and does not suit the video".
- **Stereo by construction**: detune the two sides (~1.0015) and offset one by
  ~11 ms (Haas). Measure the side channel; a mono bed reads about -91 dB.
- **Chapter gates**: kick, hats and a second arp enter and leave across chapters
  so the bed has an arc. Risers into chapters, a boom on each chapter start.
- **Intensity arc**: drop to ~0.40 at the turn, rebuild after.
- **The reveal drops the bed.** If the storyboard exports `REVEAL` (the beat
  number of the STORY SPINE's one remembered moment), the arc thins into it,
  drops to 0.18 ON it, holds ~2.6s, and swells out slightly hot
  (`backend/src/services/longform/engine/arc.mjs::applyReveal`). Timed from the SRT — never a modelled
  timeline. No `REVEAL` export → arc untouched.
- **Ducking**: `sidechaincompress` threshold 0.09, ratio 2.5.
- **Chain order**: `loudnorm=I=-14:TP=-2.0:LRA=11` then `alimiter=limit=0.85`.
  The limiter is LAST.

## Shorts

- Cut from the finished film using `out/<slug>.srt` for beat boundaries.
- **Letterbox, never crop.** Scale to 1080x608 and pad onto the brand ground.
- Burn a hook line under the video panel; keep the lime edge rule and wordmark.
- Never open on a chapter card — it wastes the only second that matters.
- Each Short targets a **different** measured search phrase so they do not
  compete with each other.

## Thumbnail

- 1280x720, under 2 MB.
- **Check it at 168px** before accepting it. That is the size it is judged at.
- A real human face outperforms an empty room. If the source frame puts the
  subject on the wrong side, mirror it — there is no text in frame to reverse.
- Two lines of Anton maximum, plus one lime line. More does not survive the
  downscale.
- Build the scrim as a smooth ramp; a stepped one bands visibly.
