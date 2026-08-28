# GROUND — Incident Media Engine §1

**Date:** 28 Aug 2026 · **Brief:** `docs/briefs/incident-media-engine.md` (committed at `53db732`)
**Measured at:** `2c5dc95` (= `origin/main` at time of writing)
**Status:** report only. No Phase 1 code written.

Everything below is either a measurement I ran in this session or a file:line citation.
Where something is unverified, it says so and why.

---

## 1. Suite baselines — measured, not carried

| Suite | Result | Command |
|---|---|---|
| Backend | **1388 pass / 0 fail / 15 cancelled** (1403 total, 51 files) | `node --test "src/**/*.test.js"` |
| Frontend e2e | **11 passed / 0 failed** | `npx playwright test` |

Two things had to be fixed before either number meant anything, and both are container
conditions rather than repo problems:

**`node_modules` was empty in both workspaces.** The first run reported 192 pass / 84 fail,
every failure a bare `ERR_MODULE_NOT_FOUND`. After `npm ci` in both workspaces the suite is
green. Any baseline taken before that install is noise.

**The 15 cancelled are pre-existing, deterministic, and not the known SIGABRT flake.**
All 15 are `src/jobs/queues.test.js`, and the file fails identically when run alone:

```
error: 'Promise resolution is still pending but the event loop has already resolved'
failureType: 'cancelledByParent'
```

There is no Redis in this container and `queues.js` needs one at import. Because it is
deterministic it is a usable baseline: **every PR in this engine reports against
1388 / 0 fail / 15 cancelled**, and any movement in that cancelled count is mine to explain.
Note this is a *different* failure from the SIGABRT class documented in `CLAUDE.md` — none of
the commonly-affected files listed there failed in this container.

**The e2e number required two container fixes, both of which would otherwise have produced a
vacuously "unavailable" result:**

1. The pinned `@playwright/test` wants chromium build **1217**; the image ships **1194**. Per
   the environment's own rule I did not run `playwright install` — I pointed `executablePath`
   at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` through a config at
   `frontend/node_modules/.container-pw.config.js`. It lives inside `node_modules` so it can
   never be committed; `frontend/playwright.config.js` is untouched.
2. With the browser fixed the run was still **2 passed / 9 failed** — the specs need a live
   API. After `npm run db:migrate` into a scratchpad `SCOOP_PERSISTENT_DATA_DIR` and starting
   the web role on :4000, it is **11/11**.

**Docs drift found in passing:** `CLAUDE.md` and `docs/STATE_OF_PLAY.md` both state
"464 pass / 0 fail across 30 files". It is 1403 across 51. Worth correcting in a later
housekeeping commit — it is the same "numbers carried from a document" failure the brief's
own §3 forbids.

---

## 2. The ingestion path, and the seam

### Where scooped material lands

- `articles` — `src/models/database.js:208-232`. `id, title, description, content, url
  (UNIQUE), image_url, source_name, category, region, author, published_at, fetched_at,
  credibility, tags, language, is_duplicate`. **One image per article** (`image_url`), no
  media table, no multi-asset relation.
- `events` — `src/realityIndex/schema.js:195-220`, with `hero_image_url` and a `meta` JSON
  blob explicitly described as "for future extension".
- `event_articles` — `schema.js:241-250`, the many-to-many. As `CLAUDE.md` warns, **no
  `ON DELETE CASCADE`**; the 7-day prune sweeps orphans itself.
- `event_timeline` — `schema.js:225-239`, a `kind` enum of `article | market_move |
  sentiment_shift | statement`. This is the closest thing to an extensible per-event feed.

**There is no media table of any kind.** `media_candidates` is genuinely new; it does not
overlap an existing store.

### The seam — and a correction to the brief

The brief's intake source (b) says candidate URLs can be "surfaced from the existing
ingestion/event path **where posts already flow**". Posts flow, but **nothing persists a post
URL anywhere in the database.** Tracing it:

- `src/realityIndex/intelligence/sentimentScorer.js:61-62` fetches up to 30 posts per event
  per source and immediately hands them to `aggregateScores`.
- `normalizePost` (`ingest/social/baseSocialFetcher.js:48-58`) produces
  `{ source, text, ts, author, url, engagement }` — **the URL and author are right there.**
- `aggregateScores` (`intelligence/simpleSentiment.js:94-119`) reads only `p.text` and
  `p.engagement`, and returns `{ polarity, intensity, volume, samples }` where **`samples` is
  an integer count** (`charged`, line 118), not post samples.
- `sentimentScorer.js:114` persists `raw_meta: { samples: out.samples }` — that integer.

So every post URL the platform already hands us is fetched, normalised, counted, and thrown
away. The brief's phrasing implies a store that does not exist.

**The good news: the seam is one line deep and free.** `scoreEventForSource`
(`sentimentScorer.js:57-68`) holds the full normalised `posts` array — with `url`, `author`,
`ts`, `source` — before aggregation. A candidate-harvest hook there costs **zero new network
calls**, because the fetch has already happened for sentiment. That is where Phase 1's
automatic intake belongs.

**And the platforms are not the ones the brief assumes.** The fetchers that actually run are
`bluesky`, `reddit`, `mastodon`, `hn` (`sentimentScorer.js:39-49`), all default-on. There is
**no X, Instagram, or TikTok fetcher in the repo at all.** This materially improves the
picture — see §4.

Caveat, stated because it changes how much source (b) is worth: the sentiment module is
recorded in `STATE_OF_PLAY.md` as "hidden on comprehensibility grounds". The *cycle* is wired
(`services/scheduler.js:45,1032-1039`) and the fetchers are default-on, but I have **not**
verified against the real prod `.env` that it is running there. Given this repo's history
with `VIDEO_SUBJECT_VISUALS_ENABLED` — four PRs built on a flag that was off in prod — that
is a check DrJ should make before Phase 1 leans on source (b). Sources (a) manual and
(c) commissioned have no such dependency.

---

## 3. What must be reused, and where extending it would break something

### Reuse cleanly

**`longform/engine/footage-search.mjs`** — already carries a four-tier **provenance ladder**
(lines 12-32): `verified` (US federal PD — DVIDS/NASA/USGS) → `declared` (Wikimedia,
Archive.org) → `platform` (Pexels, "the platform vouches for the catalogue") → `unverified`
(YouTube CC, **lead generation only, never downloaded**). The incident engine's lanes are the
missing rungs of *this* ladder, not a parallel one. Its header also states the YouTube answer
outright: *"Downloading also breaks YouTube's ToS regardless of what the licence field
claims."* That is a settled repo position; §4 confirms it externally.

**`longformFootageRelevance.js`** — embedding cosine against the story, using the same Gemini
embeddings the event graph runs on, with the embedder injected so it is testable offline. It
exists because a published film ran six clips of unrelated Army b-roll that passed every
other gate. Directly reusable for "is this candidate about this story", unchanged.

**`longformGroundedness.js`** — two layers, mechanical before LLM. The reusable idea is its
core lesson: *a check is vacuous against input that simply lacks the thing being checked.*
That is the same trap the brief flags for the prior-appearance check.

**`editorialSensitivity.js`** (31 lines) — one shared regex, headline-only,
`isSensitiveHeadline("")` returns **true** (no headline → take the safe path). Phase 2's
sensitivity routing wires to this. `videoStockLibrary.js:163-167` already shows the exact
pattern: a flagged headline suppresses cutaways for the **whole video**, because there is no
per-beat signal and manufacturing one would be a classifier rather than a guard.

**Rule 0** (`videoPakistanBlock.js`) — three independent layers, each re-running the full
matcher: `filterAtSelection` (l.248), `checkPostGeneration` (l.273),
`assertPublishAllowed` (l.302, throws). No flag, no force, no bypass. **Rule 0 is strictly
stronger than the brief's Pakistan kill rule**: the brief kills on "cannot confirm" for
Pakistan-related stories, whereas Rule 0 already blocks confirmed Pakistan content outright,
ahead of any confidence judgement. The engine's rule sits behind Rule 0, never beside it.

**Migration 031** (`db/migrations/031_stock_asset_usage.js`) — the conventions to follow:
`CREATE TABLE IF NOT EXISTS`, **no foreign key** (following `video_posts` and
`longform_posts`), an index justified by the ops question rather than the hot path, and a
header that explains *why the table is in the DB and the library is not*. `media_candidates`
differs in one respect worth stating in its own header: unlike `stock_asset_usage` it is the
**primary record**, not derived cache, so a lost row is a lost editorial defence.

**The stock manifest reader** (`videoStockLibrary.js`) — `loadLibrary` never throws
(l.75-107); a missing or malformed library yields no cutaways, "which is a correct video, not
a failed one". `REQUIRED` (l.68) makes `creator`, `sourceUrl` and `license` mandatory at load.
`selectCutaways` (l.262-306) gives rotation (LRU), a one-contributor-per-video cap, a
no-consecutive-beats rule, and — importantly — logs every unmatched noun as the acquisition
backlog. Incident assets should enter through this same selection surface.

### Where extension would disturb the longform track — the seam to propose

**`longformMediaGate.js` must NOT be extended for incident media.** Its `ALLOWED_LICENCES`
(l.36-41) is `pexels | public-domain | cc-by | cc-by-sa | handout`, and the file's job is to
make the film's AI-provenance disclosure *trustworthy*:

```
acquisition gate → LICENSES.md → derived disclosure → QC gate
```

A per-poster grant is not in that list, and a fair-use excerpt is definitionally **not a
licence at all**. Adding `grant` or `fair_use` to `ALLOWED_LICENCES` would let a fair-use
excerpt flow into a long-form film through a gate built to guarantee something else — and
`longformQcGate.js` is described in `CLAUDE.md` as the highest-consequence file in the repo
precisely because a published film cannot be quietly corrected.

**Proposed seam:** incident clearance is its own gate (`incidentClearanceGate`) that outputs a
`cleared(...)` ledger state, and the *renderer* accepts an asset if it satisfies **either**
`longformMediaGate` (open-licence stock, unchanged) **or** the incident gate. Two gates, one
render path — which is also what keeps the "one compositing path" constraint honest. No line
of `longformMediaGate.js` changes.

### A gap the brief assumes is already closed

The brief says "the renderer refuses a third-party asset without [`creditText`]". **It does
not today.** In `videoAssembler.js:436`:

```js
const credit = cutaway.credit ? `,${cutaway.credit}` : "";
```

A null credit renders a silently uncredited cutaway, and `videoCutaway.test.js:49,67,93,103`
passes `credit: null` as a legal input. It has never bitten because the stock manifest makes
`creator` mandatory upstream (`videoStockLibrary.js:68`) — but for incident media credit is a
**rights condition**, not a courtesy. Phase 5 must add that refusal **at the assembler**, not
upstream, because upstream is exactly where a bug would silently drop it. This is a build
item, not an existing property, and I would rather say so now than let the brief's phrasing
carry into a PR description.

---

## 4. Platform access — stated honestly

| Platform | Automated media lane | Basis |
|---|---|---|
| **Bluesky** | **OPEN** — already fetched today | Public AT Protocol endpoints, no key, no approval |
| **Mastodon** | **OPEN** — already fetched today | Public instance API |
| **Reddit / HN** | **OPEN** — already fetched today | Public APIs |
| **X / Twitter** | Metadata payable; **media reuse still needs Lane 2** | Pay-per-use since Feb 2026 |
| **YouTube** | **CLOSED** | Download outside their own tools is a ToS breach |
| **Instagram** | **CLOSED** | ToS bars automated collection |
| **TikTok** | **CLOSED** | ToS bars scraping and bars downloading without poster consent |

**The finding that matters most:** the three platforms the repo *already* fetches — Bluesky,
Mastodon, Reddit — are exactly the ones whose lanes are open, and the three the brief worries
about — X, Instagram, TikTok — have **no fetcher in the repo at all**. The automatic intake
lane is therefore buildable in Phase 1 with **no new API spend and no ToS exposure**, on
platforms already being called. X/IG/TikTok go to Lane 2 (ask the poster), exactly as the
brief directs.

**One distinction the ledger must encode, because it is the easiest mistake to make here:**
an *open access lane is not cleared rights*. Bluesky's API being public means we may fetch the
post; it says nothing about whether we may republish the poster's video. Access and rights are
separate columns, and verification (truth) is separate from clearance (rights) — which is the
brief's own architecture, and worth restating in the migration header.

**X pricing, flagged as UNVERIFIED against the primary source.** `developer.x.com` is blocked
by this container's egress proxy, so the figures below come from secondary reporting only and
DrJ should confirm before anything depends on them: pay-per-use became the default on
2026-02-06 with no free tier for new developers; roughly **$0.005 per post read**, capped
~2M reads/month; legacy Basic ($200/mo) and Pro ($5,000/mo) closed to new signups; Enterprise
from ~$42,000/mo. If accurate, reading X post *metadata* is cheap — but that buys metadata,
not the right to republish the media, so it does not open the lane.

---

## 5. Perceptual hashing and keyframes — measured in this container

All three below were **executed here**, not inferred. Answer to the brief's expected
dependency exception: **no new npm dependencies are needed.**

The bundled static ffmpeg is at
`backend/node_modules/@ffmpeg-installer/linux-x64/ffmpeg` (already a dependency for the
render path).

1. **dHash with zero packages.**
   `ffmpeg -i x.png -vf "scale=9:8,format=gray" -f rawvideo -pix_fmt gray -` returned exactly
   **72 bytes** — the 9×8 grayscale a 64-bit dHash needs. Row-adjacent comparison and Hamming
   distance are then integer work in plain JS.
2. **Keyframe-only extraction.** `-skip_frame nokey` on a 6s clip encoded with `-g 25`
   produced **6 keyframes**. Works.
3. **MPEG-7 video signature is compiled in** — `signature  N->V  Calculate the MPEG-7 video
   signature` appears in `-filters`. Available if dHash proves too weak for video, though I
   would start with dHash because its failure modes are legible.

**One caveat, with an existing repo answer.** `@ffmpeg-installer` ships **ffmpeg only, no
ffprobe**. The repo already handles this: `videoVoice.js:184-192` resolves ffprobe or falls
back to parsing ffmpeg's stderr, and both paths are exercised by tests. Reuse that rather
than adding `@ffprobe-installer`.

---

## 6. Answers to Q1–Q4

### Q1 — Reverse-search route and cost · **the check cannot be fully automated; make it a structured human step**

This is the answer I am least comfortable giving and most confident is right.

Two routes are legitimate (no scraping, real API terms):

| Route | Cost | Returns |
|---|---|---|
| **Google Cloud Vision `WEB_DETECTION`** | **$3.50 / 1,000 images**, first 1,000/month free (confirmed at `cloud.google.com/vision/pricing`) | `pagesWithMatchingImages`, `fullMatchingImages`, `partialMatchingImages`, `webEntities`, `bestGuessLabels` |
| **TinEye commercial API** | from **~$200 for 5,000 searches**, prepaid bundles | match list with crawl/first-indexed data |

**The problem is not cost. It is that the Phase 2 check as written needs a DATE, and the
cheap route does not return one.**

The brief's rule is "an appearance predating the claimed incident = `killed(stale)`". Google's
Web Detection returns *URLs of pages carrying the image* — as far as I can establish, with no
crawl date, no first-seen timestamp, no date field on any of the nested types. **I could not
verify this against the primary API reference: `docs.cloud.google.com` is blocked by this
container's egress proxy.** So treat it as high-confidence-but-unconfirmed, and confirm it
before committing to a design.

If that holds, then building "prior-appearance" on Web Detection means fetching each returned
page and inferring a date from its markup — which is (a) exactly the arbitrary website
retrieval the brief's §3 rules out, and (b) unreliable, since page dates lie.

TinEye's model is date-aware and is the API actually designed for this question. At ~$0.04
per search it is affordable at the volumes this engine implies (tens of candidates a day, not
thousands).

**My recommendation, for DrJ to rule on:**

- **Do not ship an automated pass/fail on prior-appearance in Phase 2.** A check that returns
  "no earlier appearance found" from an API that cannot see dates is precisely the vacuous
  gate the brief and this repo's history both forbid — it would look like protection while
  proving nothing.
- **Ship it as a structured human step** in the Phase 4 queue: run Web Detection (cheap, and
  genuinely useful — it surfaces *where else this image lives*), present the matching pages to
  the operator with the claimed date beside them, and require an explicit tap. The machine
  gathers evidence; the human rules. The ledger records which pages were surfaced and what was
  decided, which is the editorial defence either way.
- **Revisit TinEye** if the human step becomes the bottleneck. That is a volume decision, not
  a design decision, and buying it later costs nothing now.
- Corroboration (check 2) and same-file repost collapse **do not depend on any of this** —
  they are local dHash work, free, and fully automatable. Build those in Phase 2 as real
  automated gates.

### Q2 — Lane 3 excerpt cap · **propose ≤3s per excerpt, ≤6s per video — and it needs no new number**

Grounding: the render path an incident asset must travel through is already capped.
`videoStockLibrary.js` sets `CUTAWAY_MIN_SECS = 1.5`, `CUTAWAY_MAX_SECS = 3` (l.213-214),
default `2.2` (l.224), `MAX_CUTAWAYS = 2` (l.210) — and `videoAssembler.js:546-552` clamps a
cutaway against its slide so it can never outlast it.

So a Lane 3 excerpt entering through #121's mechanism is **already ≤3 seconds, at most twice
per video: ≤6 seconds total.** That is far inside any commentary-format norm (broadcasters
commonly self-impose ~10s for third-party UGC), it is *transformative by construction* because
the typography and narration layer sit over it, and it requires no new constant to be invented
and calibrated.

**Recommendation:** define the Lane 3 cap as *inheriting* `CUTAWAY_MAX_SECS` rather than
introducing `INCIDENT_EXCERPT_MAX_SECS`. One number, one place, and the cap cannot drift from
the mechanism that enforces it. If DrJ wants a lower Lane 3 figure than Lane 0/2 (defensible —
fair use is a posture, not a permission), the clean form is a Lane-3-only floor *below* the
shared ceiling, not a second ceiling.

### Q3 — Queue surface · **admin page, and most of it already exists**

The admin surface is not just cheaper — the shape is already built.
`/scoop-ops/videos-gen` (`src/routes/videos-gen.js`, 897 lines) already serves:

```
GET  /queue         — list jobs, filterable by status
POST /approve/:id   — approve a 'ready' job
POST /reject/:id    — reject a 'ready' job
GET  /preview/:id   — base64 thumbnail PNG for a job
```

That is Phase 4's requirement — thumbnail, approve, kill — minus the incident-specific
columns. And `server.js:290` mounts `adminRouteLimiter + adminAuth + adminAuditLogger` across
the whole `/scoop-ops` prefix, so a new sub-router inherits auth, rate limiting **and the
audit log** for free. Given the ledger *is* the product, inheriting an audit logger rather
than writing one is worth more than the code it saves.

A CLI would need its own auth story, would not run on the operator's phone, and would not be
reachable in the ~1 minute/day budget the brief sets.

### Q4 — Pre-clearance file storage · **`SCOOP_PERSISTENT_DATA_DIR/incident-quarantine/`, with its own sweeper, written in the same PR**

Location follows the rule `videoStockLibrary.js:40-55` states explicitly: **not
`backend/data`**, because the deploy directory is replaced on every release and the image
bakes its own copy of the tree. `videoArtifacts.js:52-53` uses the same base for `videos/`.

The sweeper is not optional and should not be a follow-up. `cardSweep.js` documents the cost
of skipping it — 36,000 files and 34GB in about a month — and its header names four safety
properties to copy verbatim: a **cap per run**, **unparseable names skipped rather than
guessed at**, **count and bytes both reported** so "it ran" and "it did something" are
distinguishable, and **batched `readdir` with `withFileTypes`**.

Two respects in which incident quarantine is *harder* than cards, and both belong in the
migration/sweeper header:

- **A card is a cache; a quarantined candidate is not.** Deleting a live card costs one cold
  render. Deleting the file behind a `verified` candidate destroys evidence. Retention must
  key on **ledger state**, not mtime alone: `killed` sweeps fast, `candidate`/`verifying`
  sweeps on a timer, `cleared` does not sweep while a video references it.
- **A killed candidate's file should be deleted while its ledger row survives** — the same
  shape the stock brief's §8.4 uses for rejected assets, and for the same reason: the row is
  what stops it being re-acquired, and it is the record of *why* it was killed.

Precedent for the retention knob: `VIDEO_MP4_RETENTION_HOURS` (`videoArtifacts.js:56-57`,
default 48). Follow that naming and register it in `env_reference.md`.

---

## 7. Defects found in the brief

Reported per the standing instruction to flag these rather than quietly work around them.

1. **The §3 heading is missing.** The document jumps from §2b to an unheaded bullet list to
   "§4. Open questions" — while §2b's last line references "per §3". The constraint bullets
   between them *are* §3. Committed verbatim as instructed; flagged here.
2. **"where posts already flow" (§2, intake source b) overstates what exists.** Posts are
   fetched and discarded; no URL is persisted. The seam is real and cheap, but it is a hook to
   build, not a store to read. See §2 above.
3. **"the renderer refuses a third-party asset without [creditText]" (§3) describes a
   property that does not exist yet.** `videoAssembler.js:436` renders an uncredited cutaway
   silently. It is a Phase 5 build item.
4. **Phase 6's "the existing transcription path if one exists" — it does not exist.** There is
   no speech-to-text anywhere in the repo. SRT output is built from ElevenLabs *character
   timestamps on text we wrote* (`longform/engine/publish-all.mjs:286` says so explicitly:
   "it is the correct caption track — not a re-transcription"). Transcript alignment on a
   *foreign* video would need a new capability, and that is a Phase 6 decision worth knowing
   about now.
5. **Minor: `docs/briefs/stock-cutaways-render.md` (cited in the header as #121's brief) is
   not in the repo.** `docs/briefs/` holds only `stock-library-builder.md`,
   `vertical-layout.md`, `video-quality-pass-1.md`. Not blocking — #121's mechanism is legible
   from the code — but the citation dangles.

---

## 8. What I need ruled before Phase 1

1. **Q1** — accept "prior-appearance is a structured human step, not an automated gate", or
   fund TinEye. Everything else in Phase 2 proceeds either way.
2. **Q2** — accept inheriting `CUTAWAY_MAX_SECS` (≤3s/excerpt, ≤6s/video), or name a number.
3. **Q3** — confirm admin page under `/scoop-ops`.
4. **Q4** — confirm `SCOOP_PERSISTENT_DATA_DIR/incident-quarantine/` with a state-aware
   sweeper in the same PR.
5. **The `longformMediaGate` seam** (§3) — confirm two gates feeding one render path, with
   `ALLOWED_LICENCES` untouched.
6. **Operational check only DrJ can make:** is the sentiment cycle actually running in prod?
   Intake source (b) depends on it. Sources (a) and (c) do not — Phase 1 can be built and
   verified without this answer, but it changes how much source (b) is worth.
