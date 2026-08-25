# Gotchas

Every entry cost real time. Read this before debugging anything that looks impossible.

## Tooling

**`npm install` inside a video working directory destroys it.** These directories
carry `node_modules -> backend/node_modules` as a symlink. npm replaces the
symlink with a real directory containing only the new package
(`npm warn reify Removing non-directory`), and ffmpeg/satori/resvg vanish for
every other script. To add a package, install to a sidecar and import by
absolute path. Restore with:
`ln -sfn <repo>/backend/node_modules node_modules`

**Always pass `-nostdin` to ffmpeg.** ffmpeg consumes stdin, so an ffmpeg call
inside a `while read` loop eats every other line. This once produced a confident
and completely wrong diagnosis that video segments were out of order — the
segments were fine; the diagnostic script had the bug.

**`drawtext` needs an explicit `fontfile=`.** No default resolution.

**`timeout` does not exist on macOS.** A command wrapped in it silently produces
nothing. Use a background process plus a polling loop.

**zsh eats `$var[...]`** as an array subscript, which mangles ffmpeg filtergraph
labels like `[0:v]`. Write filter scripts to a file and run with bash.

**`node -c ""` hangs** reading stdin. Use `node --check <file>`.

**`fetch` has no default timeout.** An un-settled request hangs forever; an
unattended job stalled past five minutes holding a public tunnel open. Always
pass `AbortSignal.timeout(ms)`, and give any unattended script a watchdog.

## Timing and assembly

**Never recompute the timeline.** `build.mjs` extends shots for readability, so
narration durations plus a fixed gap no longer describe the film. Read
`out/<slug>.srt` and `out/shots.json`. Recomputing drifted Shorts by up to 5.2s,
so each opened on the tail of the previous beat and ended mid-sentence — which
is what "the voice lags behind the visuals" looks like from the outside.

**Chapter timestamps in the description drift the same way.** Recompute them
from the SRT after the final build, or they will be a minute out.

**`renders += await ...`** reads before awaiting and loses updates under
concurrency. Cosmetic in a counter; fatal in an accumulator.

## Audio

**Limiter goes LAST, after `loudnorm`.** Reversed, peaks came back at +0.25 dBFS.

**True peak on a decoded AAC overshoots and that is normal.** Judge clipping by
`astats` flat factor (must be 0.000), not by `loudnorm`'s `input_tp` on the
encoded file.

**Sidechain threshold matters more than ratio.** 0.03 crushed the music bed
permanently because narration sits above -30 dB almost continuously. 0.09 with
ratio 2.5 ducks without killing it.

**A mono bed sounds dead.** Measure the side channel; -91 dB means mono. Detune
the two sides (~1.0015) and add a ~11 ms Haas offset.

## Rendering

**`C.recededText` and friends must exist.** An undefined colour renders silently
and wrongly — ledger rows shipped with an undefined colour for a whole build.

**Centre-cropping 16:9 cards to 9:16 slices the type mid-word** ("EMPLO…").
Letterbox onto the brand ground instead.

**Screenshot crops and highlight boxes must be measured, never guessed.** See
`sourcing.md`.

## Platform

**A token for the wrong page still answers to the right name.** Gate on
`/me` returning the expected ID before any post.

**Facebook's disk-cache token outranks env.** `data/facebook-token.json` wins in
the production client; a script that reads only env gates on one token and posts
with another.

**Verify by reading state back.** An upload response is not proof the schedule
stuck.

**Never slice narration audio per shot.** The first engine cut each beat's take
into per-segment AAC streams (`atrim=start=…` per shot). Every within-beat cut
— cutaway inserts, split footage beats — chopped the voice mid-word and glued
the halves back with ~30ms of codec priming between them: viewers heard the
voice hiccup and die at cuts "for no cogent reason". Segments are video-only
now; narration is ONE continuous track assembled at final mux, each take placed
at its beat's MEASURED start (header durations, not planned seconds — 80+
frame-roundings drift). Verify sync after building: silencedetect speech onsets
vs SRT cue starts, tolerance ~0.15s.

**Screen B-roll for identifiable vessels, brands and flags.** A "generic
tanker" clip turned out to carry a legible nameplate and Sovcomflot (sanctioned
Russian state carrier) branding — an editorial claim smuggled into a
strictly-neutral film about a live war. Sample frames from every clip and look
before building; record rejections in LICENSES.md.

**Never put `<text>` inside an SVG you hand to satori.** satori gives its fonts
to its own layout engine, not to images it rasterises through resvg, so SVG
text renders as *nothing* — silently. The first maps came out as unlabelled
blobs. Draw shapes in the SVG; put every label in an absolutely-positioned div
over it, in viewBox coordinates.

**Every animation timing on a HAS_PAYOFF card must finish by `PAYOFF_P` (0.35),
except the payoff itself.** build.mjs renders the entrance span over p∈[0,0.35],
holds the last entrance frame, then plays the payoff. A timing that straddles
0.35 freezes mid-motion and then jumps: the equation card's rule was still
drawing (0.18→0.44) and its denominator still fading in (0.26→0.48), so it
visibly stalled half-built. Check new cards by rendering at exactly p=0.35 —
it must look deliberately paused, not broken.

**Separate scrolling from measuring in capture-measured.mjs.** `scrollIntoView`
respects CSS `scroll-behavior`, so on a page that sets `smooth` the scroll is
still animating when `getBoundingClientRect` runs, and every coordinate is read
against a layout about to move. That put a highlight exactly one line low — on
"Safety Division." instead of the quote it was meant to mark. Scroll in one
evaluate, wait, measure in a second with `noScroll: true`. Also reject rects
that fall outside the captured box: pages carry offscreen duplicates of their
own copy (print styles, a11y text), and matching one of those measures to
coordinates nowhere near the screenshot. **Verify by drawing the rect onto the
raw PNG** — a highlight on the wrong sentence asserts a claim the source did
not make.

**Check that footage does not contradict the narration.** 4:43 ran a Hamburg
container terminal under "sitting at anchor for months" — a working port is the
opposite of the claim. Sample frames from each clip and read them against the
beat's line before building.

**An insert must never be able to shorten its beat.** build.mjs pushed the head
and the insert, then dropped the tail fragment whenever `after < MIN_PIECE` —
but the clamp above it lands `after` exactly ON MIN_PIECE, which in floating
point is 1.0999999. Two beats silently lost 0.72s each, so their narration ran
past their own visuals and overlapped the next card (audible as the opening
line colliding with the title card). Test BOTH fragments with epsilon slack and
play the beat un-split if either fails; pieces must always sum to `seconds`.
Assert it: every beat's shot total >= its take duration.

**Open on silence.** Narration starting at t=0 sits under a 1.4s video fade and
a 0.8s audio fade, so the first line is half-swallowed. `LEAD_IN` holds the
first frame before the voice enters — and the SRT must be anchored to the VOICE
(`p.start + audioLead`), not the shot, or captions lead the audio and shorts.mjs
cuts from the wrong place.

**`card:"outro"` is the brand sign-off and build.mjs already appends exactly
one.** Its renderer takes `_spec` and ignores it, so a beat authored as
`card:"outro"` printed the ScoopFeeds wordmark a SECOND time and silently threw
away that beat's own `lines`/`sub` — the film's real closing card never
appeared at all. Use `card:"title"` for a closing card. The renderer now throws
if handed `lines`/`sub` rather than swallowing them.

**Don't invent country shapes for maps.** The first bypass maps drew Saudi and
the UAE as two separate rounded blobs with a straight line across each:
unrecognisable as geography and animated only by a dash-reveal. Draw every map
in a chapter on ONE shared regional base so the viewer reads later maps against
the one they already learned, keep the thing being avoided ON SCREEN and marked
(a bypass is only legible next to what it bypasses), and animate flow along the
route rather than drawing the line.

**Publish metadata belongs in the project, never the engine.** publish-all.mjs
shipped with video 2's title, description, tags, Shorts list and schedule baked
in. Publishing the wrong film's copy is not fixable after the fact — the
notification has already gone out. It now reads `publish.json` from the project,
same pattern as docs.json/shorts.json.

**A disclosure prompt must track the actual film.** The same hardcoding printed
"Tick 'Altered or synthetic content' — 5 AI environment stills are used" under a
film containing no AI imagery at all, i.e. it instructed a disclosure that would
itself have been false. Driven by `syntheticContent` in publish.json now, and it
says explicitly when NOT to tick.

**Copying the Instagram job for a new film: derive the file list.** ig-run.mjs
had v2's five filenames hardcoded, so the copied job crashed on startup pointing
at files that did not exist. It reads out/shorts now. Each film also needs its
OWN directory, marker and launchd label — two jobs sharing a label means one
disarms the other.

**A chapter card must not sit on a beat that carries content.** If the chapter
divider occupies the beat whose narration is the chapter's first real fact, the
divider absorbs that line and every following card runs one beat late. At ~7s a
beat that reads to a viewer as the voice running five to seven seconds ahead of
the picture — and it is NOT a sync bug: measured audio/visual drift was 0.21s.
Two duplicate cards (a map and a dotgrid both showing 97%) compounded it by
consuming a beat with no narration of its own. Audit by printing each beat's
narration beside its card and reading the pair; anything that self-corrects
mid-chapter is this bug, not a timing one.

**Draw maps from real geometry.** The first DRC map was a hand-drawn blob. On a
film about specific provinces, invented borders are not good enough — and
Natural Earth 1:110m is public domain, ~120 points per country, and projects
into the viewBox in a few lines. Mark real coordinates (Bunia 1.56N 30.25E,
Goma -1.68 29.22E) rather than eyeballed dots.

**Percentages in gate output need a decimal.** qc printed 7.69% as "8%" against
a ">= 8%" gate — the row read as passing while correctly reporting FAIL.

---

## The narration cache was keyed on the beat NUMBER

Takes are written to `out/audio/bNN.mp3` and the cache was a bare `existsSync`
on that path. Edit beat 12's line and you keep beat 12's old audio. Insert a
beat and every number after it shifts, so the whole back half of the film
narrates the previous script over the new script's cards — and the build reports
nothing, because both files are internally valid.

`narrate.mjs` now writes a `bNN.txt` sidecar with the exact text each take was
synthesised from, and re-synthesises on any difference. It prints `!` for a
re-synthesis and `·` for a genuine reuse, so a run that should have changed
nothing but re-synthesises 40 takes is visible immediately.

**When adopting this on an existing project, seed the sidecars from the script
that produced the current cut before editing anything** — otherwise the first
run re-synthesises every beat at full API cost.

## Cards and narration had nothing enforcing their correspondence

Same root cause, other half. `backend/src/services/longform/engine/align.mjs` prints every beat's narration
beside the card that plays over it and fails on the structural errors: a beat
with no card, a card with no beat, a `FOOTAGE`/`INSERTS` key pointing at a beat
that is not a footage beat. It cannot judge whether card 9 is *about* line 9 —
read the two columns. Run it after any script edit, before `narrate`.

It caught a stale `for (const k of [1, 35, 51]) FOOTAGE[k].grade = "clinical"`
on the first run after a renumber. Derive such loops from `Object.keys(FOOTAGE)`.

## A beat's main footage restarted from the same second on every fragment

A beat with two cutaways plays main → cut → main → cut → main. Every non-insert
fragment spread the same `base` object, so `clipIn` stayed at the beat's start
and the clip replayed the *identical* seconds three times inside nine. Fixed by
advancing the in-point across the beat's own cutaways.

That alone was not enough. `ken` and `zoom0` were read only on the **image**
branch of `shotStill` — footage got no reframing at all, so on a locked-off
tripod shot the returns were pixel-identical however far the in-point advanced.
Main fragments now walk a framing ladder (wide → 1.22 punch left → 1.34 punch
right), cropped *before* the 1920×1080 normalise so a 2560-wide source spends
its real resolution on the punch. Kept at 1.34 max because most stock is 1080p
and a harder punch is visibly soft.

Related: insert `clipIn` was hardcoded (`ins.footage === "F_CPU" ? 1 : 2`, and a
flat `3` for extras), so a `clipIn` set in the storyboard was silently ignored.
And in-points now wrap against the source duration — a 6.66s clip under a beat
whose main fragments total 5.3s was about to seek past its end and render black.

## `linechart` hardcoded a currency prefix

It was built for a film about oil prices, so its y-axis emitted `$${v}`. A
case-fatality-rate chart therefore rendered "$55, $50, $45" and shipped through
a whole review cycle unnoticed. The axis unit is now the caller's to declare
(`yPrefix` / `ySuffix`, both empty by default) — **any existing storyboard using
this card for money must add `yPrefix: "$"` explicitly.**

## QC counted the Shorts on disk, not the Shorts being published

`qc.mjs` globbed `shorts/*.mp4`. Shorts from an earlier cut — renamed or dropped
since — were still counted and still measured, so a run that cut 5 reported 8
and its "longest" figure described a file that no longer belonged to the film.
It now gates the names declared in `shorts.json`, fails on a declared Short that
was not cut, and reports leftovers rather than silently including them. A stale
file named like a current one is how the wrong video reaches the upload.

## Pexels search results include AI-generated video

Results interleave `content.pexels.com/aigc-bundle/…` items, which are generated
rather than filmed, and the search UI does not label them. Four appeared on the
first page of one search. Any film whose description claims real footage must
filter to `videos.pexels.com/video-files/…` uploads. Check the host, not the
thumbnail.

## Charts: read the data table, not the picture

A published chart usually ships an accessible data table beneath it — CDC's
five-outbreak comparison carried all 101 rows in the DOM. Extract those and
redraw in house style: exact values, no licence question, no eyeballing pixels.
Watch for thousands separators; `Number("1,003")` is `NaN`, which silently
truncated a series at day 37 and looked like the source only had partial data.

When several series sit flat while one climbs, their end labels all want the
same y and overprint into a smear. `multiline` de-collides them after layout.

## The Instagram poller was installed without a module it imports

`ig-setup.sh` copied `ig-run.mjs` and `ig-publish.mjs` into the per-film
directory but never `_deps.mjs`, which `ig-publish.mjs` imports. Every poller
installed after `_deps.mjs` was introduced died on `ERR_MODULE_NOT_FOUND`, every
30 minutes, forever — while `launchctl list` reported `LastExitStatus = 0`,
because the cron wrapper always exits 0 by design.

`_deps.mjs` is now **symlinked**, not copied: it derives `REPO_ROOT` four levels
up from its own location, so a copy sitting in `$HOME` resolves `BACKEND` to
nonsense. Node resolves symlinks before computing `import.meta.url`, so the link
keeps the real engine path.

`ig-setup.sh` now also refuses to arm unless the self-test reaches the film gate
(exit code 2). **An armed poller that cannot run is worse than none** — it looks
scheduled and posts nothing. Check the log says "film not public yet", not just
that the install printed "armed".

## publish-all printed the video ids and never saved them

Everything is uploaded private with a `publishAt`, so until the slot arrives the
video id is the only way to find, correct or cancel an upload — and a private
video does not appear in the channel's public listing. The ids went to stdout
only, so a scrolled-past terminal meant re-querying the API to recover them.
They are written to `out/publish-result.json` now.

## Thumbnails carry numbers, and numbers go stale

A thumbnail authored early in a project stated "5,021 cases" and was still
sitting in `out/` when the film had been rebuilt on a corrected figure of 5,105.
Nothing in the pipeline compares the two. Author it as a script with the figure
in one named constant, regenerate whenever a number in the film changes, and
look at the 168px version — that is the size the decision is made at.

Compositing note: the same thumbnail had vertical banding from scaling a
semi-transparent layer after overlay. Render the type once at final size as
transparent RGBA and overlay 1:1; scale nothing afterwards.

## TikTok: an un-audited client posts, and nobody can see it

TikTok does not reject a post from an un-audited Content Posting API client — it
accepts it and forces it to private viewing. So the naive integration reports
five successful posts and the account shows five videos no one but the owner can
open. `creator_info/query` returns `privacy_level_options`; if the level you
intend is not in that list, the client is not audited. Refuse there.

The same endpoint is the only reliable audit-status check available at runtime,
which is why the poller calls it every cycle rather than caching the answer.

## TikTok has no scheduling either

Like Instagram, and unlike YouTube and Facebook. Neither `publish_at` nor
`schedule_time` exists on any Content Posting endpoint. Two of the four
platforms in this pipeline can genuinely schedule; the other two need a process
that wakes up and posts. Do not promise a schedule the API cannot keep.
