# ScoopFeeds YouTube Automation — Build & Operations Note

Written 3 Aug 2026, the day the loop went live on `@scoopfeedsnews`.
Purpose: so future-me knows what exists, why it's shaped this way, and what to
check when it misbehaves.

> **This note describes the pipeline. It does not carry the reasoning behind the
> work done on it between 11–15 Aug 2026** — the vertical pivot, multi-platform
> publishing, the selection budgets, the premium visual track and the editorial
> gates. Several of those calls could reasonably have gone the other way and the
> arguments are not reconstructable from the diffs. Before reversing any of them,
> read [`docs/phases/video_premium_track_2026-08.md`](phases/video_premium_track_2026-08.md).

---

## 0. There are TWO video systems. This note is about the first one.

They share a channel and nothing else — different code, different cadence,
different approval model. Confusing them is the most likely way to break either.

| | **Automated shorts** (this note) | **Long-form explainers** |
|---|---|---|
| What | 60–100s clips from a news article | 7–10 min film + 5 vertical Shorts |
| Code | `backend/src/services/video*.js` | `backend/src/services/longform/engine/` |
| Cadence | hourly cron, up to 4/day | one per topic, hand-directed |
| Runs | scheduler + worker, unattended | locally, agent-driven |
| Cost | 1–4 cents each | ~$2 of ElevenLabs; renders free |
| Approval | publishes unattended | DrJ approves every post |

**Long-form lives in the `video-factory` skill**, not in `backend/`. Its
workflow, house style, quality gates and platform notes are in
[`.claude/skills/video-factory/SKILL.md`](../.claude/skills/video-factory/SKILL.md)
and the `references/` beside it. Read those before touching long-form; read
*this* note before touching `video*.js`.

The two do share the platform clients (`youtubeClient`, `facebookClient`,
`instagramClient`) and therefore the traps documented in §7 here and in the
skill's `references/platform-apis.md` — notably that the YouTube token carries
`upload` + `readonly` only, so `videos.update` is unavailable and `publishAt`
must be set inside `videos.insert`.

---

## 1. What it does

Every hour a cron in the **scheduler** picks a fresh news article, turns it into a
60–100 second explainer video, and uploads it to YouTube. Public, unattended,
up to 4 a day.

The chain: select article → fetch full text → LLM writes a slide spec →
validate → ElevenLabs voices each caption → render keyframes → ffmpeg assembles
→ upload → record in `video_posts`.

Cost is about **1–4 cents per published video**, including the candidates that
get rejected on the way.

---

## 2. The format, and why

Dark slide cards with big Anton type on `#090706`, one acid-lime `#dde706`
accent per frame, code-rendered rather than filmed. Six card types:

| card | role |
|---|---|
| `title` | opener; carries the code-injected source badge, date, and the single spoken credit |
| `stat` | one figure, big |
| `bars` | comparison, 2+ bars |
| `diagram` | the mechanism — ticked rule with directional chevrons |
| `turn` | the hinge where the obvious reading gives way |
| `kicker` | closer; never wraps up, ends forward-looking |

There is **no attribution card** — it was removed because a credit slide at
position 2 is a dead beat where retention is decided.

**Motion is keyframes, not frames.** Each card renders 4 *states* — 5 for
`stat` — (empty → line 1 → line 2 → complete); ffmpeg crossfades between them.
It used to also pan the whole slide; that is off — see below.

A true 30fps sequence is 1,800 renders for a 60s video — that figure is frames
per second times duration and does not depend on card count. Keyframes are
**27–46 renders**, computed from the real shape rather than assumed: 6–10
slides at 4 states each, 5 for `stat`, with `stat` capped near a third of the
cards by the mix rule (2 of 6, 3 of 10), plus 3 thumbnail variants. The earlier
"~95 renders, ~8s, ~4MB" assumed a 20-card video; the CPU and size figures were
measured against that assumption and scale roughly with render count, so the
real cost is well under them.

**The slide pan is OFF (DrJ, 2026-08-12).** Slides are static. `xfade` between
keyframe states stays — content appearing is the format's motion design; the
*frame moving* was the problem. A slow whole-frame pan under text someone is
reading is eye-straining, and every measured refinement below was work to make
that motion tolerable rather than to establish it was wanted.

`VIDEO_SLIDE_DRIFT_ENABLED=1` restores it. Default off, so static ships without
anyone having to remember a flag. Measured on the same article, same fixture:

| | frames | duplicate of previous frame | file |
|---|---|---|---|
| static (default) | 735 | **587 (80%)** | 1.5 MB |
| pan (`=1`) | 735 | 157 (21%) | 2.3 MB |

The surviving 148 non-duplicate frames in the static build are the crossfades
and state reveals — exactly what should remain. Identical frame counts confirm
slide duration is untouched. The 35% smaller file is a side effect of a still
frame compressing better, not a quality change.

The 2% overscan is KEPT (with no pan it is a harmless slight crop; removing it
is a layout change with its own risk). The **4× supersample is skipped** when
the pan is off — it existed solely to give an *animated* integer crop sub-pixel
precision, and a still crop lands on one coordinate and stays there. Dropping
the round trip also removes its slight softening, so static output is
fractionally crisper.

**When the pan is enabled, it must be supersampled 4×.** At output resolution
the crop coordinates are integers (and yuv420p forces them even), so ~0.3px/frame
of intended motion becomes a 2px snap — visible as shake. 2× was measured and
still fails; 4× passes at ≤0.33px/frame.

### Narration pacing — documentary, not podcast

Voice direction is four env vars (`VIDEO_VOICE_ID` / `_SPEED` / `_STABILITY` /
`_SIMILARITY`) plus `VIDEO_VOICE_GAP_MS`. All five default to today's values, so
they are inert until someone sets one. See `docs/reference/env_reference.md`
§Voice direction for ranges and the cache consequence.

**`VIDEO_VOICE_GAP_MS` is the pacing knob.** It appends trailing silence to each
caption — the pause *between ideas*. It is applied where `SLIDE_TAIL_SECS`
already is (the slide's timing, and the `apad` on its audio stream), not baked
into the cached MP3, so re-pacing the whole channel costs nothing at ElevenLabs.
The two tails stay separate numbers on purpose: `SLIDE_TAIL_SECS` is the
mechanical margin that stops the last consonant being clipped by the cut, and
folding the editorial pause into it means the first person to shorten the pause
clips every slide.

Slide duration is audio duration (§5), so the gap extends the video. Both gates
that depend on slide duration were measured across every card type, 1–5 states,
and captions from 1.5s to 12.0s in 0.25s steps (`backend/_voiceGapGround.mjs`;
the assertions live in `videoAssembler.test.js`):

| gap | worst drift | verdict | collapse decisions changed | 7-slide runtime |
|---|---|---|---|---|
| 0ms (default) | 0.2426 px/frame | pass | — (baseline) | 38.40s |
| 200ms | 0.2419 px/frame | pass | 0 of 1,290 | 39.80s |
| **400ms** | **0.2412 px/frame** | **pass** | **0 of 1,290** | **41.20s** |
| 800ms | 0.2407 px/frame | pass | 0 of 1,290 | 44.00s |

The drift gate holds *structurally*, not coincidentally: the rate is pinned at
6px/s and the overscan caps total travel, so a longer slide can only ever drift
**slower**. Per-frame displacement sits at ~0.24px against the 0.5px criterion
(0.33px as stated above) for any gap anyone types.

The state-collapse rule is unaffected because `fitStatesToDuration` is fed the
**raw** audio duration — the gap is silence *after* the narration, not room to
pace states across. That is a decision, and it has a price: folding the gap into
the fit instead would have changed 110 collapse decisions over the same sweep,
i.e. it would quietly start keeping states the rule had decided to drop.

---

## 3. Rule 0 — no Pakistan-related video, ever

Absolute, no env flag, three independent layers (selection, post-generation,
publish). `videoPakistanBlock.js`. Pure word-boundary regex, never a prompt
instruction — a prompt is a request with a nonzero ignore rate.

Over-blocking is correct and deliberate: Indian Punjab stories, anything from
ARY/Geo/Dawn regardless of topic, and `pti` (which also catches Press Trust of
India) all block. Roughly 13% of the candidate pool. **Never narrow a term
because it produced a false positive.**

One real bug was fixed here: outlet names were being matched against article
*body text*, so "the nation" and "dawn" in ordinary prose blocked unrelated
stories. Outlet tokens now match source fields only; topical terms stay global.

---

## 4. Sourcing — one story, restated, credited (§3b)

Every video is built from **one** article. This was tested, not assumed: a
sibling-source bundle added 13,488 characters from 8 outlets and produced
**zero** additional beats, while introducing a misattribution risk the
validator couldn't catch.

Five rules:

1. Facts only, never phrasing — no verbatim runs, never mirror the article's
   structure
2. Never the publisher's images (this is the rule that actually prevents claims)
3. Attribute on screen and in narration — **once** per source, not per card
4. Link the original above the fold in the description
5. Add the pipeline's own layer — at least one `diagram` or `turn` card

**Attribution resolves to the real publisher, not the feed name.**
`videoAttribution.js` derives the registrable domain from the article URL and
cross-checks `source_name`. Caught live: a personal blog (`seanhelvey.com`)
arriving under "Hacker News", and Yahoo Finance syndicating WSJ and Barron's.
Measured override rate 1–4% across 57k articles.

---

## 5. Length is emergent — the thing that took longest to learn

Four independent levers were tried and **all came back flat**:

| lever | result |
|---|---|
| prompt framing (4 versions: target / floor / no-count / worked example) | 26 → 6 → 5 → 5 slides |
| model tier (flash-lite → flash → pro-preview) | 5 → 5.5 → 6.5 beats |
| article length (full-text fetch, 2.3–2.9× more chars) | no consistent gain |
| source breadth (8 sibling outlets) | Δ 0.00 beats |

**Conclusion: most news stories genuinely contain 4–8 distinct verifiable
facts.** The 6–20 slide target was wrong for this corpus. Observed typical
output is 6–10 slides, 60–100 seconds — that is what the corpus produces, **not
a floor**. The floor is `MIN_SLIDES = 5`, below which the article is skipped as
too thin rather than padded up to it. Density matters, not length — an analysis feature
yields 8 beats, a wire update yields 4, regardless of word count.

The spec emits `beats` as data first (`{kind, beat, evidence}`), and content
cards must equal `beats.length` exactly. The prompt contains **no slide number
in any form**; `MIN_SLIDES`/`MAX_SLIDES` are validation gates the model never
sees. Anything the model is shown, it anchors on.

---

## 6. Selection gates — every one earned by a live failure

- **Rule 0** (above)
- **Sport** and **live blogs** — rolling updates have no stable narrative
- **Stock commentary** — requires *both* ticker focus (title or body) *and*
  rating vocabulary (price target, analyst rating, buy/hold). Either alone
  passes, so Fed/Nvidia/Tesla stories survive.

  Caught by a **dry run, before the loop was armed** — nothing reached the
  channel. The article was:

  > "SoundHound AI's Next Earnings Report on Aug. 5 Could Send the Stock
  > Soaring. Here's Why."

  **That headline is the whole lesson.** It names the company at the start and
  calls it "the Stock" later, so the company and the word are never *adjacent* —
  and every `<Company> stock` pattern needs the two touching. The adjacency rule
  could not see it at all; `THE_STOCK_RE` exists precisely for this shape (a
  bare definite-article reference to a single security in a title that also
  carries a proper noun, excluding "the stock market"). Body dominance caught it
  independently, but only because the piece named SoundHound five times — a
  shorter one would have gone through.
- **Publisher diversity** — max 2 candidates per publisher per cycle, then
  **round-robin interleave**. Capping alone wasn't enough: length-first
  ordering still put both Yahoo Finance articles at attempts 1 and 2.

**The ordering fix was the single biggest yield change.** The accessor sorted
by `credibility DESC, published_at DESC` — but credibility is a coarse 4-value
tier, so recency decided inside the top bucket, and the freshest rows are the
ones `contentEnricher` hasn't filled yet. The old top-8 were 66–194 character
stubs against a pool median of 2,219. Now: `LENGTH(content) DESC` → event
breadth → credibility → recency. Yield went from 0-in-8 to 1-in-2.

⚠️ **Four other accessors still share the old ORDER BY**, including
`findFreshUnpostedArticles` which feeds Instagram. Unmeasured. This plausibly
explains the July IG defect where bullets repeated the headline — there may
simply have been almost nothing to extract from.

---

## 7. Publishing

- `video_posts`, `UNIQUE(article_id)`, **no foreign key at all** (a `REFERENCES`
  clause invites a future `ON DELETE`). `source_name` and `title` denormalised
  so cooldowns survive the 7-day article prune. Rows are **permanent**.
- **Insert pending → upload → update.** A crash between upload and insert would
  otherwise orphan a published video.
- **Stale-pending rule**: one failure leaves the article selectable, two retire
  it. Without this, a failed upload permanently retires an article.
- Two independent rate gates: rolling-24h count (`VIDEO_MAX_PER_DAY`, 4) and
  spacing (`24h / max × 0.8` ≈ 4.8h). The 0.8 slack gives five slots for four
  videos, so a failure costs time rather than a video.
- `403 quotaExceeded` ends the cycle rather than burning a spec+render+TTS per
  remaining candidate. Uploads cost 1,600 units of 10,000/day, **shared with
  YouTube ingestion**.

### The fan-out, as of 2026-08-24

One render, **seven surfaces**. Every cross-post obeys the same three rules,
and each rule was bought:

| Channel | Flag | Delivery | Migration |
|---|---|---|---|
| YouTube | — | the publish itself | — |
| Facebook (feed) | `VIDEO_FACEBOOK_ENABLED` | native bytes | 023 |
| Facebook Reels | `VIDEO_FACEBOOK_REELS_ENABLED` | native bytes | 023 |
| Instagram Reels | `VIDEO_INSTAGRAM_REELS_ENABLED` | Meta FETCHES a URL | 024 |
| Threads | `VIDEO_THREADS_ENABLED` | Meta FETCHES a URL | 024 |
| Bluesky | `VIDEO_BLUESKY_ENABLED` | raw bytes | 026 |
| TikTok | `VIDEO_TIKTOK_ENABLED` | raw bytes | 028 |
| X | `VIDEO_X_ENABLED` | raw bytes | 029 |

1. **Never throws, never retries into the publish.** The YouTube video is live
   and irreversible before any of these run. A cross-post failure must not reach
   `markVideoFailed` (which would make the article selectable again and publish a
   SECOND YouTube video) or `isQuotaExceeded` (which would abort the cycle over
   someone else's throttling).
2. **A column per channel, not a shared ledger.** Every re-entry guard is
   `video_posts.<channel>_status`. This is what stops the Instagram double-post
   (#46) recurring, and it is why TikTok got migration 028 even though
   `videoPublisher` had posted there for months via the generic
   `recordSocialPost`: an append-only ledger records what happened but cannot
   cheaply answer "has this article already been posted?".
3. **`pending` only for URL-FETCH channels.** Instagram and Threads hand Meta a
   URL and Meta collects it later, which opens a window where the 48h sweep could
   delete a file mid-publish. Bluesky, TikTok and X upload the bytes in-band, so
   the file is irrelevant once the call returns. `hasPendingUrlFetchPublish` is
   deliberately NOT widened for them — its name is the contract.

**TikTok** (`VIDEO_TIKTOK_ENABLED`, dark) — `privacy_level` was a hardcoded
`SELF_ONLY` and the comment beside it read as caution. It was not: an *unaudited*
client is REFUSED any other value. The app was approved, `creator_info` now
offers `PUBLIC_TO_EVERYONE`, and the value moved into `VIDEO_TIKTOK_PRIVACY` —
defaulting to `SELF_ONLY`, because an approval that makes something possible is
not an instruction to do it. An unrecognised value falls back to private rather
than being passed through: an env var one character wrong must not be why
something goes public.

**X** (`VIDEO_X_ENABLED`, dark) — **posts carry no link, and that is the whole
design.** X went pay-per-use in Feb 2026: `$0.015` a post, or **`$0.20` if it
contains a link**. At this cadence that is $4.70/month against $63, and X
downranks link posts anyway. The site lives in the profile bio.
`xClient.assertNoLink` REFUSES a link at the call boundary rather than trusting
callers, because a post with a link succeeds identically to one without — the
difference appears only on a bill. X is therefore the one channel that does not
use `buildDescriptionCredit`; the publisher is NAMED instead, with
`xSafePublisher` stripping a trailing TLD so a real masthead like
**Investing.com** is credited as "Investing" rather than billed as a link.
Auth is OAuth **1.0a**, not 2.0: OAuth-2 refresh tokens rotate on every use and
must be persisted before the next call, and this runs in three containers off
one env file.

**Bluesky cannot take long-form.** Its ceiling is **3 minutes / 100MB**
(`BLUESKY_VIDEO_MAX_SECS`), confirmed current 2026-08. The automated shorts run
60–100s and fit comfortably; the video-factory films run 7–10 minutes and never
will. A link card is the only route for those, and is not built.

**Facebook cross-post** (`VIDEO_FACEBOOK_ENABLED`, ships dark)

- Every published video is also uploaded **natively** to the page —
  `POST /{page-id}/videos`, multipart `source`. Not a link share (Facebook
  demotes YouTube links, which is the whole reason this exists) and not a Reel
  (`/video_reels` is vertical; these renders are 1920×1080 and a Reel would need
  a second render path).
- Runs in the same cycle, immediately after `markVideoPublished`, on the MP4
  `produceVideo` just returned — so it is always well inside the 48h window.
- **No fallback.** Every other function in `facebookClient.js` degrades to a
  link post; this one throws. A degraded link share is the thing being avoided,
  so "succeeded by posting a link" is worse than failing.
- **A Facebook failure can never touch the YouTube publish.** It is recorded in
  `video_posts.facebook_status` (`posted` | `failed` | `skipped`; NULL = never
  attempted), which is a disjoint column set from `status` — so it cannot flip a
  published row to `failed`, cannot feed the stale-pending retire rule, and
  cannot get the same video uploaded to YouTube twice. The `isQuotaExceeded`
  path is unreachable from it. See the comment at the attach point; the inner
  try/catch there is load-bearing.
- Own rolling-24h cap, `VIDEO_FACEBOOK_MAX_PER_DAY`, defaulting to
  `VIDEO_MAX_PER_DAY` so it tracks unless deliberately throttled. `0` means zero.
- `X-Business-Use-Case-Usage` is logged on every Graph call. Meta's page limit
  is 4800 × engaged users per rolling 24h (error 80001) — nowhere near binding
  at 12/day, so the value of the number is that it is in the logs before the day
  it matters. Meta documents **no** per-day cap on page video posts; the
  "25 posts/day" figure that circulates is third-party, unverified.

---

## 8. Operations

**Where things live**

- Repo on VPS: `/opt/scoopfeeds` (deploy@72.62.196.97)
- Config: `backend/.env` — gitignored, single copy, back it up before edits
- Volume: `/var/lib/docker/volumes/scoopfeeds_scoop_data/_data` (root-owned)
- MP4s kept 48h, frames in container tmpdir, TTS cache 7 days — all swept at
  **worker startup** (`workerProcess.js` → `videoArtifacts.sweepAtStartup()`),
  not on a cron (a cron that stops firing is invisible). The worker is the only
  process that creates any of the three, and the sweep is awaited before the
  queue workers register so it cannot race a render's scratch dir.
- ⚠️ **All three sweeps were dead code until 2026-08-04.** `sweepAtStartup()`
  had no caller in any process, so nothing reclaimed video disk anywhere —
  this bullet described intent, not behaviour, for the whole life of the
  pipeline. A local checkout still held a rendered MP4 fifteen days old.
  `videoArtifacts.test.js` now asserts the function is reachable from a process
  entry point and fails if it is ever unwired again.

**Deploy rules learned the hard way**

- `build` and `up -d` with **no service filter** — the worker once ran
  month-old code for a week because deploys filtered to web+scheduler
- `restart` does **not** re-read `.env`; only `up -d` recreates
- `Started` in the output means recreated; `Running 0.0s` means nothing happened
- Check the site returns 200 after any recreate (Caddy port drift once caused a
  45-minute outage on a deploy that was otherwise fine)

**Liveness**

- Three independent dead-man switches, one per cycle:
  `INGESTION_HEARTBEAT_PING_URL`, `SOCIAL_HEARTBEAT_PING_URL`,
  `VIDEO_HEARTBEAT_PING_URL`. Start/success pair, plus `/fail` when the cycle
  knows it is broken. **An in-process check cannot report a dead process** —
  that is the whole reason these exist, and the reason the 933m staleness
  warning only appeared at recovery.
- `/fail` fires when the cycle threw, aborted on config (no spec / no voice /
  no YouTube / quota), or **every attempt failed at the same stage**. That last
  one is the shape a dead-man switch misses entirely: a dead YouTube token kept
  the loop green for 17h because the cycle itself completed fine every hour.
- The video cycle now has a **staleness threshold** (`VIDEO_CYCLE_STALE_MS`,
  3h = 3 missed hourly runs). It previously had hang detection only, so a loop
  that simply stopped being dispatched produced no signal whatsoever.
- No alert state, cooldown or dedupe lives in this repo. The external monitor
  owns edge-triggering and the re-arm ceiling; rebuilding that here is how a
  warning becomes noise.
- ⚠️ `breaking_push` is a heartbeat with **no reader** — written in four places,
  consumed nowhere. Detached push failures are invisible. Known, not fixed.

**Verifying the Facebook page token**

- **`/me` is the only reliable identity check.** `GET /{page-id}?fields=name`
  returns the page's public name for **any** valid token, including one minted
  for a different page entirely — so it confirms nothing about what the token
  can do. This cost a debugging session: the token in `.env` was a valid page
  token for the wrong page, `/{page-id}?fields=name` cheerfully returned
  "Scoopfeeds", and only `/me` revealed it was scoped to "Morpheus".

  ```bash
  curl -sG "https://graph.facebook.com/v26.0/me" \
    --data-urlencode "fields=id,name" \
    --data-urlencode "access_token=$FACEBOOK_PAGE_TOKEN"
  ```

  The `id` must equal `FACEBOOK_PAGE_ID` and the `name` must be the page you
  expect. Anything else — including a 200 — means the wrong token.
- `GET /debug_token?input_token=…&access_token=…` for scopes and expiry. The
  page token needs `pages_manage_posts`, `pages_read_engagement` **and**
  `pages_show_list`; the third is only exercised by `/videos`, so a token
  missing it posts photos fine and fails on video.
- ⚠️ **The disk cache outranks the env var.** `_loadToken()` reads
  `<persist>/facebook-token.json` first. Rotating `FACEBOOK_PAGE_TOKEN` without
  deleting that file changes nothing.

**Switches**

- `VIDEO_AUTOPOST_ENABLED` — master switch, the only thing between built and live
- `VIDEO_SPEC_ENABLED=1` — required, or every candidate skips
- `YOUTUBE_PRIVACY` defaults to `public`
- Dry run without publishing — inline, so it works on a fresh checkout
  (`backend/_*.mjs` is gitignored, so any local harness must be recreated):

  ```bash
  docker compose -f docker-compose.production.yml run --rm -T -w /app/backend \
    -e VIDEO_AUTOPOST_ENABLED=1 -e VIDEO_SPEC_ENABLED=1 web \
    node -e "import('./src/services/videoAutopost.js').then(m=>m.runVideoRenderCycle({dryRun:true})).then(r=>console.log(JSON.stringify(r,null,2)))"
  ```

  `dryRun: true` renders and stops: it never claims a `video_posts` row and
  never uploads.

**YouTube auth**

Channel is **ScoopFeeds / @scoopfeedsnews**, owned by `info.scoopfeeds@gmail.com`.
The OAuth app lives in the `scoopfeeds-video` Cloud project owned by
`nmc192@gmail.com` — that mismatch is fine and expected.

The app **must stay "In production"** on the Google Auth Platform → Audience
page. In Testing mode Google expires refresh tokens every 7 days. Uploading a
logo under Branding is what triggers the verification requirement — don't.

To renew: OAuth Playground with your own credentials, scopes
`youtube.upload` + `youtube.readonly`, signed in as **info.scoopfeeds@gmail.com**,
tick both permission boxes, exchange for tokens, replace
`YOUTUBE_REFRESH_TOKEN`. Verify with `getChannelInfo` — it prints the channel
name, which is the only reliable way to confirm *where* it will publish.

---

## 9. Method notes worth keeping

Patterns that repeated often enough to be worth naming:

- **Every gate needed a second pass after meeting real data**, and the fix was
  always to move the signal from a surface that's easy to rewrite to one that
  isn't: title → body, predicted → measured, count → position.
- **Rendering found bugs that reading could not** — chevrons rendered as
  squares, the progress line cropped away, two lime elements in one frame.
- **Validators must be validated against known-bad input**, or they pass
  vacuously. A featureless window measured 0.000px drift and "passed".
- **Config presence is not config correctness.** `publishConfigured: youtube
  true` was logged at boot for weeks while the token was dead.
- **The dry run earned its keep twice** — it caught a crash on the first thin
  candidate, and a stock tip about to publish under the brand.
