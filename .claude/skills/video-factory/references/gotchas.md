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
