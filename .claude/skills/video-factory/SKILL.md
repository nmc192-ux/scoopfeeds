---
name: video-factory
description: Produce a narrated explainer video (7-10 min) plus vertical Shorts/Reels on any topic, and schedule them to YouTube, Facebook and Instagram. Use when the user asks to make a video, an explainer, Shorts, Reels, or to publish/schedule video to the ScoopFeeds channels. Covers topic demand-validation, scripting, card animation, procedural music, quality gates and cross-platform publishing.
---

# Video factory

Produces a ScoopFeeds explainer: a 7-10 minute 1920x1080 film, 5 vertical
Shorts cut from it, a thumbnail, and scheduled posts on YouTube, Facebook and
Instagram. Everything renders locally with ffmpeg and satori. No paid video
generation.

**The engine in `engine/` is reusable verbatim.** Only two files are written
fresh per topic: `script.md` (the narration) and `storyboard.mjs` (what is on
screen for each beat). Author those; do not rewrite the engine.

## Deployment

**There is nothing to deploy to a server.** This is a project skill: it lives in
the repo at `.claude/skills/video-factory/` and is active for anyone whose
Claude Code session has this repo open. Merging the branch to `main` is the
whole "release". It does **not** run on the VPS — it needs local ffmpeg, satori
and Playwright, and every post is human-approved, which is the opposite of the
unattended hourly loop in `backend/src/services/video*.js`.

Nothing in the engine is tied to a machine any more: `REPO_ROOT` is derived from
the skill's own location, so any checkout path works. (Seven absolute paths to
one developer's home directory used to be baked in.)

**Prerequisites on whatever machine runs it:**

| Need | Why | Check |
|---|---|---|
| `backend/node_modules` installed | ffmpeg, satori, resvg | `node -e "require('@ffmpeg-installer/ffmpeg')"` |
| `frontend/node_modules` installed | Playwright, for source screenshots | `ls frontend/node_modules/playwright` |
| `ELEVENLABS_API_KEY` | narration | in `backend/.env` or `~/.scoopfeeds.env` |
| `YOUTUBE_*`, `FACEBOOK_PAGE_TOKEN` | scheduling | `node engine/publish-all.mjs` dry run prints both identities |
| Node 18+ | engine is ESM | `node -v` |

Verify a fresh machine in one command — it prints both platform identities and
schedules nothing:

```bash
cd <project> && node <skill>/engine/publish-all.mjs
```

**macOS-only:** `ig-setup.sh` uses `launchctl`. Instagram cannot schedule (no
`publish_time`, and containers expire in 24h), so posting needs a process awake
at post time. On Linux the same `ig-run.mjs` works — replace the launchd plist
with a systemd timer or cron entry running `ig-cron.sh` every 30 minutes.

**Per-film state lives outside the repo** in `~/.scoopfeeds-igpost-<slug>/`, one
directory per film, each with its own marker and launchd label. Those are
runtime state, deliberately not committed.

## Before anything else: does anyone search for this?

The first film made under this pipeline was well-built and got **2 views**,
because nobody searches for its subject. Craft does not rescue a topic nobody
is looking for.

```bash
node engine/demand.mjs "your candidate phrasing"
```

This probes Google/YouTube autocomplete, which is a demand signal: a phrase
with **zero** suggestions has no search behind it. Test 5-10 phrasings and
title the video with a phrase that actually returns suggestions. Report the
counts to the user before scripting — do not skip to production because the
topic feels important.

## Pipeline

Scaffold the working directory — this creates the `node_modules` and `fonts`
symlinks and verifies the toolchain resolves:

```bash
bash engine/new-project.sh <slug> scratchpad
```

**Never `npm install` into that directory.** It deletes the symlink and breaks
ffmpeg/satori for every script (see `references/gotchas.md`).

| # | Step | Command | Produces |
|---|---|---|---|
| 1 | Demand check | `node engine/demand.mjs "<phrase>"` | title decision |
| 2 | Research + script | *authored* | `script.md` |
| 3 | Storyboard | *authored* | `storyboard.mjs` |
| 4 | Source screenshots | author `docs.json`, then `node engine/capture-measured.mjs` | `out/docs/*.png` + `rects.json` |
| 5 | Footage + stills | *acquired* | `out/footage/`, `out/photos/` |
| 6 | Narration | `node engine/narrate.mjs` | `out/audio/b*.mp3`, `takes.json` |
| 7 | Render + assemble | `node engine/build.mjs` | film + **`out/<slug>.srt`** |
| 8 | Music | `node engine/music.mjs` | scored film |
| 9 | Shorts | author `shorts.json`, then `node engine/shorts.mjs` | `out/shorts/*.mp4` |
| 10 | Thumbnail | *authored ffmpeg* | `out/THUMB.png` |
| 11 | QC | `node engine/qc.mjs out/<slug>-scored.mp4` | gate report |
| 12 | Publish YT + FB | author `publish.json`, then `node engine/publish-all.mjs --confirm` | scheduled posts |
| 13 | Instagram | author `ig.json`, then `bash engine/ig-setup.sh <slug>` | armed poller |

### The SRT is the timeline

`build.mjs` extends shots to make dense cards readable, so **final shot
positions are not derivable from narration durations**. It emits an SRT built
from the real shot plan. Anything downstream that needs a timestamp — Shorts
cut points, chapter markers in the description — must read that SRT.

Recomputing the timeline instead drifted Shorts by up to 5.2 seconds, so each
one opened on the tail of the previous beat and ended mid-sentence. That is
what "the voice lags behind the visuals" looked like from the outside.

## Story engine

Adapted from `anthropic-skills:vox-motion-graphics`, whose story rules are
sharper than anything we had. A sequence of individually good cards reads as a
slide deck; these four things are what make it a film. **Decide all four before
writing a single beat.**

1. **One through-line object.** A single concrete thing that appears in nearly
   every chapter and escalates. Not a theme — an object the viewer can picture.
   It carries the argument when the numbers change.
2. **A question posed early, answered last.** State the question plainly in the
   opening, then withhold the answer until the final chapter. Our v1/v2 habit of
   "open on the reversal" front-loads the payoff and leaves the viewer owed
   nothing. Create a debt and settle it.
3. **One reveal the film is remembered by.** A single moment where the picture
   reframes everything before it — a number that recontextualises the opening,
   a scale change, a name. Design it deliberately; neither earlier film had one.
4. **Escalation.** Each chapter must raise the stakes on the last. If chapters
   are interchangeable, the film has no spine.

State all four at the top of `script.md` as a `STORY SPINE` block, so the
storyboard can serve them instead of decorating beats individually.

## Per-project data files

Three small files live in the project root, not the engine, because they are
judgements about THIS video, not engine behaviour. Carrying them in the engine
is how it shipped writing every project's output to `out/who-pays-for-ai.mp4`
— video 1's filename — and how `capture-measured.mjs` once had one film's
source list hardcoded into it.

- **`project.json`** — `{ "slug": "...", "title": "..." }`. The slug names
  every output file (`out/<slug>.mp4`, `.srt`, `-scored.mp4`). `new-project.sh`
  writes a stub; fill in a real slug before building.
- **`docs.json`** — array of `{ name, url, container, phrases, pad, minW?, minH? }`
  for `capture-measured.mjs`. `container` is text inside the element to frame;
  `phrases` are the exact strings to highlight.
- **`shorts.json`** — array of `{ name, from, to, title, hook }` for
  `shorts.mjs`. `from`/`to` are beat numbers forming one self-contained
  argument. Starting a Short on a chapter-divider beat is rejected by the engine.
- **`publish.json`** — everything YouTube and Facebook need: film/thumb/srt
  paths, `youtube:{title,description,tags,publishAt,categoryId}`,
  `shorts:[{file,title,desc,publishAt}]`, `facebook:{caption,publishAt,reel}`,
  and `syntheticContent` (false, or a sentence naming the AI imagery used).
- **`ig.json`** — `{ filmId, posts:[{ file, caption, tags }] }`. `filmId` is the
  YouTube id the poller waits on before posting.

## Writing `script.md`

Numbered beats, one or two sentences each, 1,000-1,400 words for 7-10 minutes.
Read `references/house-style.md` before writing.

- **Open on the reversal, not the setup.** The first 15 seconds decide.
- **Budget words against seconds, not just totals.** Narration runs ~2.5 words/sec
  as one flowing comma-joined sentence but ~1.8 words/sec on choppy, name-heavy
  lines, because TTS pauses ~0.7s at every full stop. The same word count can
  differ by four seconds. Prefer flowing sentences; check `takes.json` durations
  after narration and re-voice outliers rather than letting the assembler
  compensate.
- Numbers get context: "5.6% against 4.3%", not "5.6%".
- **A `SOURCES` block is mandatory**, and so is a **`Deliberately excluded`**
  block listing figures you could not verify to a primary source and why.
  Honesty rules are enforced, not aspirational (`docs/agentic-workflow.md` §5).
- Include any caveat the source itself states. If Goldman says their own
  estimate likely overstates the effect, that goes in the film.

## Writing `storyboard.mjs`

Maps each beat to a card type or footage. Copy `template/storyboard.example.mjs`
and read `references/house-style.md` for the card grammar.

Two rules that are load-bearing:

- **`INSERTS` may only target imagery beats, never text cards.** Cutting away
  from a slide mid-read and returning to it leaves no time to read either half.
  Ten of these was the single loudest complaint on v2.
- **Vary the visual.** Consecutive statement cards read as a slide deck. Mix
  footage, stat, bars, doc, dotgrid, pipeline, ledger.

## Quality gates

`node engine/qc.mjs` measures and prints these. Do not report a video as
finished until they pass, and **report unmeasured items as "unverified", never
as "passing"**.

| Gate | Target | Why |
|---|---|---|
| Unreadable cards | **0** | words ÷ 3.0 w/s must fit the shot |
| Text cards interrupted by inserts | **0** | see above |
| Median shot length | ≤ 6s | Vox reference: 3.42s; v1 was 7.69s |
| Shots under 2s | ≥ 8% | rhythm; Vox 21%, v1 0% |
| Integrated loudness | −14 LUFS ±1 | platform normalisation target |
| True peak | *context, not a gate* | decoded AAC overshoots by design; clipping is judged by flat factor |
| Clipping (flat factor) | 0.000 | measured on the final mix |
| Music side channel | > −60 dB | a mono bed measured −91 dB and sounded dead |
| Shorts duration | < 59s | hard platform limit |
| Shorts opening beat | not a chapter card | wastes the only decisive second |

## Publishing

Read `references/platform-apis.md` **before** touching any publisher — it
records scope limits and traps that are invisible until they fail.

The short version:

- **Always identity-gate before posting.** A token minted for the wrong page or
  channel answers name queries perfectly happily. Check `/me` against the
  expected ID and refuse on mismatch.
- **Verify by reading state back.** An upload response saying `publishAt` was
  accepted is not proof it stuck; re-query the object.
- YouTube: `publishAt` must go **inside** `videos.insert`. Keep it there even
  once the token can `videos.update` — see `references/platform-apis.md`.
- Facebook: `published=false` + `scheduled_publish_time`. The **disk-cache
  token outranks env** — load it the same way `facebookClient` does.
- Instagram: **cannot schedule at all** and **cannot accept uploaded bytes**.
  `ig-setup.sh` installs a per-film launchd poller that wakes every 30 minutes,
  refuses until the YouTube film is actually public, serves the Shorts over a
  temporary tunnel for the minute Meta needs to fetch them, posts once, writes a
  marker and disarms itself. Every film gets its own directory, marker and
  label — sharing a label means one film's job unloads another's. Stories
  currently fail with error 2207077; Reels work, and a Story failure is caught
  so it cannot take the Reels down with it.

**Captions upload automatically**, from the SRT `build.mjs` emits — the real
shot timeline, not a re-transcription. This needs `youtube.force-ssl`, which
`scripts/youtube-auth.mjs` now requests; **a token minted before that still
carries the old scopes and must be re-minted.** `publish-all.mjs` checks the
scope for free before spending the 400 units, and downgrades to "do it in
Studio" on any failure rather than failing the publish.

**Disclosure follows the film, not habit.** `publish-all.mjs` prints the
synthetic-content instruction from `publish.json`. If the film contains no AI
imagery it says so explicitly — telling someone to tick that box on a film with
no AI in it is itself a false disclosure.

**DrJ approves every external post.** Build, verify, present the dry run, and
wait. Never publish unasked.

## Reference files

Load these when the step needs them, not upfront:

- `references/house-style.md` — brand palette, card grammar, animation timing, music design
- `references/quality-gates.md` — how each gate is measured, with the ffmpeg invocations
- `references/platform-apis.md` — YouTube/Facebook/Instagram specifics, scopes, error codes
- `references/sourcing.md` — footage licensing, AI-generated-clip screening, measured screenshot capture, disclosure rules
- `references/gotchas.md` — the failures that cost hours; read before debugging anything odd
