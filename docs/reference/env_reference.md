# Environment / feature-flag reference

**Status:** current as of 2026-07-20 (commit `6046e11`). This is the single list — it did
not exist before; `backend/.env.example` documented 77 of the ~262 vars the code reads.

**How to read this**

- **Default** = what the *code* falls back to when the var is unset. Most prod behaviour
  runs on these — prod's `.env` sets only ~57 keys.
- **Prod** = whether the value is explicitly set on the server (`/opt/scoopfeeds/backend/.env`).
  "default" means the code default is in force.
- **Runtime-flip** = safe to change and restart the affected container without a migration
  or rebuild. `build` = frontend build-time (requires a rebuild). `migration` = needs one.
- Booleans are parsed as the literal string `"true"` unless noted; anything else is false.

> ⚠️ **One live config hazard remains** (not changed — DrJ's call):
> - `STORYLINE_ENABLED` appears **twice** in prod `.env` (lines 53 and 59, both `true`).
>   dotenv takes the last one, so editing the first has no effect. Harmless today, a trap later.
>
> **Resolved 2026-07-20 (commit fixing the cat-span divergence):** `EVENT_ENTITY_MAX_CATSPAN`
> used to be read in three places with three defaults — `3` (storyAffinity, the live matcher),
> `5` (eventBreaker's legacy ctx), `999` (eventPromoter's signature path). The breaker's
> legacy path was deleted (with the retired `EVENT_UNIFIED_AFFINITY` flag), and the signature
> path now reads its own `EVENT_SIGNATURE_MAX_CATSPAN`. So `EVENT_ENTITY_MAX_CATSPAN` now has a
> single reader (storyAffinity) and one meaning.

---

## Event graph — matcher / promoter

| Var | Default | Prod | Runtime-flip | Purpose |
|---|---|---|---|---|
| `EVENT_UNIFIED_AFFINITY` | `false` | **`true`** | yes | Wave 2. One `storyAffinity` measure shared by promoter/merge/breaker. Killed the create-merge-split treadmill. |
| `EVENT_MIN_ARTICLES` | `5` | default | yes | Cluster size (or ≥1 bound market) required to promote an event. |
| `EVENT_MATCH_TAU` | `0.78` | default | yes | Cluster↔event centroid-cosine floor for a match. |
| `EVENT_MERGE_TAU` | `0.86` | default | yes | Event↔event cosine floor confirming a convergence merge. |
| `EVENT_MATCH_COSINE_FLOOR` | = `MATCH_TAU` | default | yes | Override the match cosine floor independently. |
| `EVENT_MERGE_COSINE_FLOOR` | = `MERGE_TAU` | default | yes | Override the merge cosine floor independently. |
| `EVENT_ENTITY_MIN` | `0` (off) | **`0.05`** | yes | Legacy rarity-weighted entity gate. `0` disables. Superseded by unified affinity but still gates signature writes. |
| `EVENT_ENTITY_TOPK` | `40` | default | yes | Top-K rarest entity keys kept per entity set. |
| `EVENT_ENTITY_CORE_FRAC` | `0.3` | default | yes | Key must appear in ≥ this fraction of members to count as "core". |
| `EVENT_ENTITY_MAX_CATSPAN` | `3` | default | yes | Hub filter for the live matcher (storyAffinity): drop entities spanning more than N categories. Single reader as of 2026-07-20. |
| `EVENT_SIGNATURE_MAX_CATSPAN` | `999` (no filter) | default | yes | Hub filter for the DURABLE signature path only (upsertSignature → chainStoryline). Separate from the matcher on purpose — see the open question in the architecture doc. |
| `EVENT_PROMOTE_MAX_CLUSTER_AGE_MS` | `48h` | default | yes | Only clusters refreshed within this window may spawn NEW events. |
| `EVENT_CLOSE_ENABLED` | `false` | **`true`** | yes | R2a temporal bounds: dormant events eventually close and can never re-absorb. |
| `EVENT_CLOSE_AFTER_MS` | `21d` | default | yes | Inactivity before a dormant event closes. |

### Affinity thresholds (`storyAffinity.js`)

| Var | Default | Prod | Runtime-flip | Purpose |
|---|---|---|---|---|
| `AFFINITY_T_MATCH` | `0.23` | default | yes | ent ≥ this ⇒ AFFINE (attach/merge allowed). |
| `AFFINITY_T_DISJOINT` | `0.19` | default | yes | ent < this ⇒ FOREIGN (breaker may split). Between the two ⇒ AMBIGUOUS, everything holds. |
| `AFFINITY_MIN_CORE_KEYS` | `2` | default | yes | Coherence contract: fewer core keys ⇒ incoherent. |
| `AFFINITY_MIN_CORE_IDF` | `4` | default | yes | Coherence contract: core idf mass floor. |
| `AFFINITY_NEWBORN_MAX_MEMBERS` | `8` | default | yes | Newborn exemption from the incoherence check (R1). |
| `AFFINITY_NEWBORN_MAX_AGE_MS` | `24h` | default | yes | Newborn exemption by age. |

### W2.1 merge floor — **shipped DISABLED, do not enable without recalibration**

| Var | Default | Prod | Runtime-flip | Purpose |
|---|---|---|---|---|
| `EVENT_MERGE_FLOOR_MIN_SIDE` | `0` (**disabled**) | default | yes | Block an AFFINE merge when the smaller side has fewer than N articles. `0` = no-op. |
| `EVENT_MERGE_FLOOR_ENT` | `0.50` | default | yes | The ent below which the thin-side block applies. |

**Why it is off:** calibration on the 2026-07-16 COW showed labeled SAME pairs span
containment **0.248–0.377 — entirely below the 0.50 floor**, so the `ent < 0.50` condition is
always-true for real merges and the floor collapses to "block every thin-sided merge",
including the R1 newborn continuation (0.248 / min-side 5). That would re-open under-merge
churn through the anti-blob door. Recalibrate on the decision-time `(ent, min-side)` corpus
the 🧭 `promoter-merge` line now logs, then set a threshold from real distributions — or
conclude no floor is the honest answer.

## Event breaker + A5 facets

| Var | Default | Prod | Runtime-flip | Purpose |
|---|---|---|---|---|
| `EVENT_BREAKER_ENABLED` | `false` | **`true`** | yes | Curative splitter: spins genuinely foreign sub-clusters out of an event. |
| `EVENT_BREAKER_MIN_ARTICLES` | `6` | default | yes | Minimum members before an event is a breaker candidate. |
| `EVENT_BREAKER_DISJOINT` | `0.06` | default | yes | Legacy (non-unified) core-overlap split threshold. |
| `EVENT_BREAKER_DETACH` | `false` | **`true`** | yes | Trim un-clusterable orphan tails from kept events. |
| `EVENT_BREAKER_MAX_PASSES` | `6` | default | yes | Sweep convergence bound. |
| `EVENT_FACETS_PERSIST` | `false` | **`true`** | yes | A5: persist render-ready facets (`event_facets`). Requires unified affinity. |
| `EVENT_FACET_TAU` | `0.88` | default | yes | **Presentation-only** sub-clustering tau for facets. Does NOT affect the breaker's split decision (still 0.78). |
| `FACET_MIN_ARTICLES` | `5` | default | yes | Earn-render: minimum articles for a facet to qualify. |
| `FACET_MAX_SHARE` | `0.5` | default | yes | A facet holding more than this share of the event is a pseudo-event, not an angle — rejected. |
| `FACET_DEDUP_OVMIN` | `0.5` | default | yes | Member **overlap-over-min** (containment) dedup threshold. Chosen empirically over Jaccard: tombstone duplicates are *nested* accretion stages, where Jaccard misses (0.22–0.25) and overlap-over-min catches (0.5–1.0). |

## Storylines (R2b)

| Var | Default | Prod | Runtime-flip | Purpose |
|---|---|---|---|---|
| `STORYLINE_ENABLED` | `false` | **`true`** ⚠️dup | yes | Chain a new event to a prior episode's storyline. Feeds the dossier ANGLES section. |
| `STORYLINE_MIN` | `0.25` | default | yes | Weighted-Jaccard floor for chaining. |
| `STORYLINE_MIN_SHARED_IDF` | `10` | default | yes | Rare-evidence floor: ≥2 shared keys carrying this idf mass. Prevents the subset-degeneracy failure (a police seizure chained to a singer obituary). |
| `STORYLINE_LOOKBACK_MS` | `90d` | default | yes | How far back to search for a prior episode. |

## Dossier timeline (A6)

| Var | Default | Prod | Runtime-flip | Purpose |
|---|---|---|---|---|
| `EVENT_TL_DEDUP_TAU` | `0.88` | default | yes | Near-dup cosine for grouping articles into one occurrence. |
| `EVENT_TL_DEDUP_WINDOW_H` | `6` | default | yes | **Load-bearing.** Caps an occurrence's time span. Without it, near-dup clustering chains distinct beats across days (78 articles / 100h into one row). At 12h two same-day strike rounds wrongly merged; 6h separates them. |
| `EVENT_TL_MIN_DEDUP` | `4` | default | yes | Below this article count, dedup is a no-op so thin events never over-collapse. |
| `EVENT_TIMELINE_MAX_EVENTS` | `2000` | default | yes | Selection window for the `event_timeline` writer (was a hardcoded 500). See the starvation failure mode in the architecture doc. |

## LLM (gate (a) cost rails — incident closed)

| Var | Default | Prod | Runtime-flip | Purpose |
|---|---|---|---|---|
| `GEMINI_GENERATION_MODEL` | `gemini-2.5-flash` | **`gemini-3.1-flash-lite`** | yes | Pinned generation model. A dead pin returns 404 and falls back deterministically — see `--list-models`. |
| `GEMINI_API_KEY` | — | set | yes | Credential. |
| `LLM_DAILY_CALL_CAP` | `2000` | default | yes | Hard daily ceiling on LLM calls. Part of the cost rails after the gate-(a) incident. |
| `LLM_DISABLED` / `GEMINI_DISABLED` | unset | default | yes | Kill switches; deterministic fallbacks take over. |
| `ANALYSIS_MAX_OUTPUT_TOKENS` | see code | default | yes | Output cap (cost rail). `thinkingBudget` is pinned to 0 in `llmQueue.js`. |
| `ENTITY_EXTRACTION_ENABLED` | `false` | **set** | yes | LLM/NER entity extraction feeding the affinity measure. |
| `ENTITY_EXTRACTION_BATCH` | `100` | **set** | yes | Articles per extraction batch. |
| `ENTITY_IDF_ENABLED` | `false` | default | yes | Maintain the rolling entity-IDF window that all rarity weighting depends on. |
| `ENTITY_IDF_WINDOW_MS` | `30d` | default | yes | IDF rolling window. |
| `ACTOR_EXTRACT_PER_CYCLE` | `25` | default | yes | Events per actor-extraction cycle (ledgered; see migration 016). |

## Frontend (build-time — `VITE_*` requires a rebuild)

| Var | Default | Prod | Runtime-flip | Purpose |
|---|---|---|---|---|
| `VITE_SENTIMENT_ENABLED` | `false` (**hidden**) | default | **build** | Sentiment module. Hidden because it fails comprehensibility, not data sufficiency — see the architecture doc. |

## Scheduler / ingestion

| Var | Default | Prod | Runtime-flip | Purpose |
|---|---|---|---|---|
| `ENABLE_REALITY_INDEX` | `true` | default | yes | Master gate for the whole Reality-Index cron block (markets, promoter, breaker, timeline, actors, sentiment, GDELT/USGS/NOAA/ACLED/FRED). |
| `ENABLE_GDELT` / `ENABLE_USGS` / `ENABLE_NOAA` / `ENABLE_ACLED` / `ENABLE_SPORTSDB` / `ENABLE_TMDB` | varies | varies | yes | Per-source ingestion toggles. **USGS/NOAA create article-less machine events — see the quarantine open item.** |
| `SCOOP_PERSISTENT_DATA_DIR` | `backend/data` | set | restart | SQLite location. Prod: `/var/lib/scoop`. |
| `SCOOP_PROCESS_ROLE` | — | set | restart | `web` \| `worker` \| `scheduler`. Determines which crons a container runs. |
| `HOMEPAGE_GROUPING` | `false` | default | yes | Group homepage cards by story. |
| `HOMEPAGE_GROUP_TAU` | `0.86` | default | yes | Grouping threshold. |

## Video autopost (§6.1) — gates, retention, cross-post

The loop is `videoAutopost.runVideoRenderCycle`, enqueued hourly at **`:12`** by the scheduler
and run in the **worker**. See `docs/video-pipeline.md` for why the rules are what they are.

| Var | Default | Prod | Runtime-flip | Purpose |
|---|---|---|---|---|
| `VIDEO_AUTOPOST_ENABLED` | unset (**off**) | `1` | yes | Master switch. The only thing between built and live. Literal `"1"`. |
| `VIDEO_SPEC_ENABLED` | unset (**off**) | `1` | yes | Required, *and* `GEMINI_API_KEY` must be set, or the cycle aborts loudly rather than skipping every candidate. |
| `VIDEO_MAX_PER_DAY` | `4` | **`12`** | yes | Rolling-24h publish cap. Not a calendar day — a calendar reset lets a quiet day burst. |
| `VIDEO_MIN_INTERVAL_MS` | `24h / max × 0.8` (≈1.6h at 12/day) | default | yes | Spacing gate. The 0.8 slack gives more opportunities than videos, so a failure costs time rather than a video. |
| `VIDEO_MAX_ATTEMPTS_PER_CYCLE` | `8` | default | yes | Candidates tried per cycle before giving up. |
| `VIDEO_MAX_PER_PUBLISHER_PER_CYCLE` | `2` | default | yes | Publisher diversity **at selection**. The publish-time cooldown cannot fix a candidate list already monopolised by one masthead. |
| `VIDEO_PUBLISHER_COOLDOWN_MS` | `24h` | default | yes | Per-publisher gate at publish time. |
| `VIDEO_EVENT_COOLDOWN_MS` | `48h` | default | yes | Per-event gate at publish time. |
| `VIDEO_CYCLE_HANG_MS` | `3600000` (1h) | default | yes | A cycle older than this is declared HUNG and a fresh one proceeds. |
| `VIDEO_PENDING_HANG_MS` | `2700000` (45m) | default | yes | A `pending` row older than this counts as a failed attempt in the two-failure retire rule. |
| `VIDEO_ALLOW_PK_DOMESTIC` | unset (**blocked**) | default | yes | Rule 0 escape hatch. Do not set it without reading §Rule 0 of `docs/video-pipeline.md`. |
| `YOUTUBE_PRIVACY` | `public` | default | yes | Written to `video_posts.privacy_status` on publish. |

### Voice direction

Narration pacing and timbre (`videoVoice.js`). **Every default is the value the channel
already shipped on**, so an unset environment is byte-identical to the pre-flag code.

> ⚠️ **The first five invalidate the entire TTS cache.** `cacheKeyFor` digests
> caption + voice + model + settings, so changing any one of them re-synthesises **every
> caption** on the next run at full ElevenLabs price. That is the design — it is what makes a
> tuning change impossible to serve stale — not a regression. `VIDEO_VOICE_GAP_MS` is
> deliberately **not** in the key: it is silence added at assembly, so re-pacing is free.

| Var | Default | Prod | Runtime-flip | Purpose |
|---|---|---|---|---|
| `VIDEO_VOICE_ID` | `21m00Tcm4TlvDq8ikWAM` (Rachel) | default | restart | Takes precedence over the older `ELEVENLABS_VOICE_ID`, which is still honoured beneath it. |
| `VIDEO_VOICE_MODEL` | `eleven_turbo_v2` | default | restart | The TTS tier. Not validated against a list — ElevenLabs adds and retires models faster than this file changes, and an allowlist would reject the next good one. ⚠️ **`eleven_v3` accepts `speed` and ignores it** (measured 2026-08-11: 0.7 and 1.2 both produced 7.00s), which silently disables `VIDEO_VOICE_SPEED` — slide duration *is* audio duration. Takes precedence over `ELEVENLABS_MODEL_ID`. |
| `VIDEO_VOICE_SPEED` | `1.05` | default | restart | ElevenLabs range 0.7–1.2. Out-of-range warns and falls back rather than 422-ing mid-render. |
| `VIDEO_VOICE_STABILITY` | `0.5` | default | restart | Range 0–1. **`0` means zero** — it is ElevenLabs' most expressive setting, not "unset". |
| `VIDEO_VOICE_SIMILARITY` | `0.75` | default | restart | `similarity_boost`. Range 0–1, `0` means zero. |
| `VIDEO_VOICE_GAP_MS` | `0` (**inert**) | default | restart | Trailing silence per caption — the pause *between ideas* that separates documentary pacing from podcast pacing. Extends slide duration by exactly itself; capped at 5000. Measured clean at 400ms against both the drift gate and the state-collapse rule (`docs/video-pipeline.md` §2). |
| `ELEVENLABS_VOICE_ID` | — | unverified | restart | Pre-existing, undocumented, also read by `ttsService`. Kept as a fallback so adding `VIDEO_VOICE_ID` cannot repoint the voice as a side effect. |
| `ELEVENLABS_MODEL_ID` | — | unverified | restart | Same: kept beneath `VIDEO_VOICE_MODEL`. Both names produce an **identical** cache key for the same value, so they are interchangeable rather than two caches. |

**Changing the model costs more than changing a setting.** It rolls the cache like the others,
but the model also carries its own per-character rate — so switching tiers re-buys the entire
corpus at the *new* price. Verified 2026-08-11: with everything at defaults the key is
`2d080f87…`; setting `VIDEO_VOICE_MODEL=eleven_multilingual_v2` moves it to `c281f131…`.

`SLIDE_TAIL_SECS` (`VIDEO_SLIDE_TAIL`, `0.3`) is **not** the same knob: it is the mechanical
margin that stops the last consonant being clipped by the cut. Shortening the editorial gap
must never be able to clip a slide, so the two stay separate numbers.

### Artifact retention

All three are swept at **worker startup** (`workerProcess.js` → `sweepAtStartup()`), not on a
cron. ⚠️ Until 2026-08-04 nothing called that function, so none of these values had any
effect — see the note in `docs/video-pipeline.md` §8.

| Var | Default | Prod | Runtime-flip | Purpose |
|---|---|---|---|---|
| `VIDEO_MP4_RETENTION_HOURS` | `48` | default | restart | MP4 window. Long enough to inspect a bad upload; YouTube holds the copy that matters. |
| `VIDEO_TTS_RETENTION_DAYS` | `7` | default | restart | TTS clip cache window. |
| `VIDEO_FRAMES_DIR` | `os.tmpdir()/scoop-video-frames` | default | restart | Frame scratch. **Must stay off the persistent volume** — a leaked render is ~120 files. |
| `VIDEO_TTS_CACHE_DIR` | `<persist>/tts` | default | restart | TTS clip cache location. |

### Facebook cross-post

Every published video is also uploaded **natively** to the Scoopfeeds page as a normal page
video post (`POST /{page-id}/videos`), in the same cycle, immediately after the YouTube
upload. Best-effort: a Facebook failure is logged loudly and recorded in
`video_posts.facebook_status`, and can never fail, retry or undo the YouTube upload.

| Var | Default | Prod | Runtime-flip | Purpose |
|---|---|---|---|---|
| `VIDEO_FACEBOOK_ENABLED` | `0` (**dark**) | *set at ship* | yes | Kill switch. Off = nothing attempted and nothing recorded (`facebook_status` stays NULL). |
| `VIDEO_FACEBOOK_MAX_PER_DAY` | falls through to `VIDEO_MAX_PER_DAY` (so `12`) | default | yes | Independent rolling-24h cap. **`0` means zero**, not unset — throttling to nothing is one env line. |
| `FACEBOOK_PAGE_ID` | — | set | restart | Numeric page id, not the username. |
| `FACEBOOK_PAGE_TOKEN` | — | set | restart | Page token. Needs `pages_manage_posts` + `pages_read_engagement` + **`pages_show_list`** — the third is required by `/videos` and its absence appears only at upload time. |
| `FACEBOOK_VIDEO_MAX_MB` | `200` | default | yes | Single-request upload ceiling. Renders are ~2 MB; above this the code refuses rather than silently 400ing, and Meta's Resumable Upload API is the answer, not a bigger number. |
| `FACEBOOK_VIDEO_TIMEOUT_MS` | `120000` | default | yes | Upload timeout. `fetch()` has none by default and a stall would hold the cycle open until the hang guard fires. |

> ⚠️ **The page token cache outranks the env var.** `facebookClient._loadToken()` reads
> `<persist>/facebook-token.json` **first** and only falls back to `FACEBOOK_PAGE_TOKEN`.
> Rotating the env var without deleting that file is a no-op. Delete it on rotation.

> ⚠️ **Verify a page token with `/me`, never with `/{page-id}?fields=name`** — the latter
> returns the page's public name for *any* valid token, including one scoped to a different
> page. See `docs/video-pipeline.md` §8 for the check and the incident.

> ⚠️ **The Graph API version is pinned and expires.** `facebookClient.js` pins `v26.0`
> (released 2026-07-29). Meta does not hard-fail an expired version — it silently routes to
> the oldest live one, so this drifts without an error. Versions live ~2 years.

### Legacy `video_jobs` publisher — separate pipeline

`videoPublisher.js` + `runVideoPublishCycle` (hourly) publish **short-form** jobs from the
`video_jobs` table to YouTube Shorts / IG Reels / FB Reels / TikTok. Unrelated to the
autopost loop above and gated off in prod.

| Var | Default | Prod | Runtime-flip | Purpose |
|---|---|---|---|---|
| `VIDEO_AUTO_APPROVE` | unset (**off**) | `0` | yes | Auto-promote `ready` jobs to `review_approved`. Off = human review only. |
| `VIDEO_AUTO_APPROVE_MIN_CREDIBILITY` | `8` | default | yes | Auto-approval credibility floor. |
| `VIDEO_AUTO_APPROVE_MAX_AGE_HOURS` | `24` | default | yes | Auto-approval staleness limit. |
| `ENABLE_INPROCESS_VIDEO_CRON` | `false` | default | restart | Runs the legacy generator in-process on the web container. Parsed as the string `"true"`. |

**Not listed here, on purpose:** the render-tuning vars (`VIDEO_FPS`, `VIDEO_DRIFT_*`,
`VIDEO_CROSSFADE_SECS`, `VIDEO_SLIDE_TAIL`, `VIDEO_SPEC_MODEL`, `VIDEO_SPEC_WPM`,
`VIDEO_SPEC_*_CHARS`, `VIDEO_*_MAX_OUTPUT_TOKENS`, `VIDEO_FULLTEXT_*`, `VIDEO_TTS_TIMEOUT_MS`).
They change how a video looks or costs, never whether or where one publishes, and all run on
their code defaults in prod.

## Liveness — dead-man switches and cycle health

**An in-process check cannot report a dead process.** Every staleness check in
`socialPublisher`/`videoAutopost` runs only when the cycle it monitors runs, so a runner that
stops firing produces exactly one warning — at recovery, from the cycle that finally ran.
That is what these external checks are for: the monitor notices the *absence* of a ping,
which no code inside the absent process can do.

Three **independent** checks, one per cycle. Each fires a start/success pair: `{url}/start`
on entry, `{url}` only on clean completion, so a wedged cycle shows as a start with no
success. `{url}/fail` is pinged when the cycle *knows* it is broken. All are no-ops when
unset — and log a one-time "no external dead-man switch" line at first use so an unarmed
monitor is visible in the boot log rather than indistinguishable from a healthy one.

| Var | Default | Prod | Runtime-flip | Purpose |
|---|---|---|---|---|
| `SOCIAL_HEARTBEAT_PING_URL` | unset (**no switch**) | **set** | restart | Social posting cycle. Runs `*/30` **from a host crontab**, not node-cron — see the social note below. |
| `VIDEO_HEARTBEAT_PING_URL` | unset (**no switch**) | **set** | restart | Video render/publish cycle (`videoAutopost`), hourly at **`:12`**. |
| `INGESTION_HEARTBEAT_PING_URL` | unset (**no switch**) | **set** | restart | RSS ingestion, **`2,32`** — the **root** cycle; breaking-push hangs off it. |

> ⚠️ **These minutes have moved once and will move again.** The 2026-08-09 collision fix
> restaggered every dispatch cron (ingestion `*/30`→`2,32`, video autopost `:07`→`:12`, video
> ingestion `:00`→`:09`) and this table was not updated with it — which sent a later
> investigation looking for a fault in code that had none. **If you move a cron in
> `scheduler.js`, update these rows and re-check the monitor's expected period in the same
> change.** `scheduler.cronCollision.test.js` now parses this table and fails on drift.

**Verified against the monitor 2026-08-11**: all three checks green. Ingestion period 30m /
grace 1h, social period 30m / grace 1h, video period 2h / grace 3h. Note the grace windows are
far wider than the cycles they cover (ingestion runs ~57s), so these checks catch a runner
that *stops*, not one that runs slowly.

> **No alert state, cooldowns or dedupe table exists in this repo, deliberately.** The
> external monitor already does edge-triggering, dedupe and the re-arm ceiling, and does
> them across restarts and deploys, which an in-process table cannot. Rebuilding it here is
> how the per-platform staleness warning became something to ignore.

**`/fail` — the failure a dead-man switch cannot see.** A cycle can run on schedule,
complete, and ping success while every unit of work inside it fails; a dead YouTube token
kept the video loop green for 17h that way. So a cycle that threw, aborted on config, or in
which **every attempt failed at the same stage** pings `/fail` with the stage and reason
instead of success. One article failing is a bad news day; 8 of 8 failing identically is a
dependency.

| Var | Default | Prod | Runtime-flip | Purpose |
|---|---|---|---|---|
| `VIDEO_FAIL_PING_MIN_ATTEMPTS` | `3` | default | yes | Floor before uniformity means anything — at n=1 it proves nothing. |
| `VIDEO_FAIL_PING_IGNORE_STAGES` | *empty* (every stage counts) | default | yes | Comma-separated stages excluded from the check. **`spec` is the one to reach for** if quiet nights start paging — see the note below. |
| `SOCIAL_FAIL_PING_MIN_ATTEMPTS` | `2` | default | yes | Lower floor: social runs ~6 platforms, not 8 articles. |

> ⚠️ **`spec` is the ambiguous stage.** A real run on 2026-08-03 rejected 8 of 8 candidates
> as "too thin" — a candidate-*ordering* defect, since fixed by the length-first `ORDER BY`.
> A recurrence would be a regression worth paging on, but a genuinely thin news hour reads
> identically from inside the cycle. Shipped counting it, per the incident-not-a-bad-news-day
> rule; if it pages on quiet nights, `VIDEO_FAIL_PING_IGNORE_STAGES=spec` is the whole fix.
> Healthy declines are **already** excluded on the social side (cadence guard, no candidate,
> everything filtered, not configured) — those are not attempts.

**In-process staleness thresholds** (these log; they do not ping):

| Var | Default | Prod | Runtime-flip | Purpose |
|---|---|---|---|---|
| `VIDEO_CYCLE_STALE_MS` | `10800000` (3h = 3 missed hourly runs) | default | yes | **New.** The video cycle had hang detection only, so a loop that stopped being dispatched had no signal at all — no start to go stale, no error, no failed row. |
| `SOCIAL_CYCLE_HANG_MS` | `900000` (15m) | default | yes | A social cycle that started and never completed. |
| `VIDEO_CYCLE_HANG_MS` | `3600000` (1h) | default | yes | Same, for the render loop. |
| `SOCIAL_TAIL_TIMEOUT_MS` | `600000` (10m) | default | yes | Bounds how long the social tail can hold ingestion's `isRunning` guard. Social must never be able to stop ingestion. |

Registered heartbeats in `system_heartbeats`: `social_cycle` (stale 90m, hang 15m),
`video_cycle` (stale 3h, hang 1h), and `breaking_push`.

> ⚠️ **`breaking_push` is written by four call sites and read by none**
> (`breakingNewsPusher.js:133/158/161/170`). It is a heartbeat with no consumer — the same
> shape as `sweepAtStartup()` before it was wired: the recording works, nothing acts on it,
> and the surface *looks* monitored. Left as-is deliberately; noted so it is a decision
> rather than an oversight. Detached broadcast failures are currently invisible.

## Dispatch observability + queues

The scheduler enqueues; the worker runs. Ingestion stopped dispatching twice in one day and
left **nothing** in the log — the only ingestion line lived inside `enqueueSingletonJob`
*after* four unbounded Redis awaits, so "the cron never fired" and "the cron fired and hung"
were indistinguishable and two successive diagnoses were argued from an absence of evidence.

`runDispatch` now logs **START before the first await**, then OK-with-elapsed or
FAIL-with-reason, so the three cases separate themselves:

| Log seen | Meaning |
|---|---|
| no START at all | the cron is not firing — look at node-cron, not at Redis |
| START, then nothing (plus a STUCK line) | the task hung; the enqueue deadline names which await |
| START then `dispatch failed` | it threw, with the reason attached |

| Var | Default | Prod | Runtime-flip | Purpose |
|---|---|---|---|---|
| `DISPATCH_STUCK_MS` | `60000` | default | yes | A dispatch pending this long logs `STUCK`. Set **above** `QUEUE_ENQUEUE_TIMEOUT_MS` so an enqueue hang surfaces as a named rejection first and this only fires for a hang elsewhere. |
| `QUEUE_ENQUEUE_TIMEOUT_MS` | `10000` | default | yes | Per-await deadline inside `enqueueSingletonJob` (`getJob` / `getState` / `remove` / `add`). **Rejects naming the step, queue, job and jobId — never retries.** A hang turned into a silent retry is the same failure wearing a hat. |
| `QUEUE_CONCURRENCY_SOCIAL` | `1` | default | restart | **Strictly 1.** `socialPublisher`'s single-flight guard is process-local, so a second concurrent consumer would not see it and both would post. |

> ⚠️ **`assertRedisAvailable` does no I/O.** It is `Boolean(REDIS_URL)` plus a `REQUIRE_REDIS`
> throw — no socket, no PING, no connection object. It cannot hang and cannot be affected by
> `enableOfflineQueue`. The `maxRetriesPerRequest: 1` connection a few lines below it in
> `redis.js` belongs to `getRedisStatus()`, a different function that really does ping. The
> two are adjacent and have been conflated once already in an outage post-mortem, costing a
> round of debugging aimed at the wrong layer.

**Producer connections do not buffer.** The `bullmq-queues` connection is now created with
`enableOfflineQueue: false`. With ioredis's default (`true`), an `add()` issued while the
socket is down is queued and **never settles** — not resolved, not rejected — taking the
dispatch promise with it. A producer wants to be told it cannot reach Redis; the caller can
skip a cycle, it cannot un-wait. Worker connections keep the default, because they hold
blocking reads across reconnects and would throw on ordinary blips.

**Social is decoupled from ingestion.** It was a tail step inside `runIngestionCycle`, which
coupled them both ways: a wedged social cycle held ingestion's `isRunning` flag, and — the
one that kept recurring — any ingestion fault took all six platforms down with it. It now has
its own queue (`social`), its own singleton job (`social.post.all`) and its own worker
consumer. `scheduler.js` registers a `15,45` cron for it — offset a quarter-hour after
ingestion so fresh articles are available, but unaffected if that tick failed, hung, or never
dispatched.

> ⚠️ **That `15,45` cron does not run in prod.** `ENABLE_AUTO_SOCIAL=false` on the server, so
> the node-cron registration is skipped entirely (the scheduler logs `📣 Social posting cron
> NOT registered`). The live schedule is **`*/30` from a host crontab** invoking
> `runSocialCycleWithTimeout`. Both paths reach the same cycle and the same heartbeat check,
> so the monitor cannot tell them apart — but `15,45` is the *code default*, not what fires.
> Read `crontab -l` on the host before reasoning about social timing.

| Var | Default | Prod | Runtime-flip | Purpose |
|---|---|---|---|---|
| `ENABLE_AUTO_SOCIAL` | `true` | **`false`** | restart | Gates **cron registration**, not a step inside ingestion. Off in prod because social is driven from the host crontab instead. |
| `SOCIAL_TAIL_TIMEOUT_MS` | `600000` (10m) | default | yes | Still bounds the cycle. Kept: it no longer protects ingestion, but it stops one wedged run holding the worker's social slot. |

## Scheduler cron offsets — why the minutes are what they are

⚠️ **Minute offsets in `scheduler.js` are load-bearing. Do not "tidy" them back to `*/30`.**

### The live schedule of the monitored cycles

These four are the ones an external check watches, and therefore the ones whose documented
timing has to be true. The 2026-08-09 restagger moved three of them and this file was not
updated with it; the table below is **parsed and asserted** by
`backend/src/services/scheduler.cronCollision.test.js`, so it can no longer drift silently.

<!-- cron-map:start — machine-read by scheduler.cronCollision.test.js. Keys are dispatch function names. -->

| Dispatch | Live schedule | Registered by |
|---|---|---|
| `dispatchIngestionCycle` | `2,32 * * * *` | `scheduler.js` |
| `dispatchVideoCycle` | `9 * * * *` | `scheduler.js` |
| `dispatchVideoRenderCycle` | `12 * * * *` | `scheduler.js` |
| `dispatchSocialCycle` | `*/30` | host crontab — `ENABLE_AUTO_SOCIAL=false` skips the `15,45` node-cron |

<!-- cron-map:end -->

The social row is the one that cannot be checked against source, and it is marked so
deliberately rather than omitted: `scheduler.js` really does contain a `15,45` registration,
it simply never runs in prod. A reader who finds `15,45` in the code and stops there gets the
wrong answer, which is exactly the trap this row exists to spring.

`node-cron@3.0.3` re-arms every task with a fixed `setTimeout(matchTime, 1000)` **after** the
callback returns, and matches on an exact **one-second window** (`time-matcher.js` compares
`getSeconds()`; a 5-field expression expands with seconds `= "0"`). The look-back loop that
would recover a missed tick is gated on `recoverMissedExecutions`, which defaults to `false`
and is not passed. So the tick must *land* inside its second, the period is always ≥1000ms,
and the drift never self-corrects.

Measured directly against 3.0.3:

| Effective tick period | Result |
|---|---|
| ~1015ms (idle) | every pattern fires |
| ~1065ms (moderate event-loop lag) | 83% for one pattern |
| ~3023ms (heavy lag) | **zero firings, every pattern** |

So a cron sharing its minute with a cycle that blocks the loop does not fire *less often* —
it stops. Production, 18h of scheduler logs: `video autopost dispatch START` **18/18**, every
other dispatch **0**. `:07` was the only dispatch minute with no heavy in-process neighbour.

**The fix was structural**: `runAnalysisCycle`, `runEventsCycle`, `runPolymarketCycle` and
`runUsgsCycle` now run in the **worker** (queues `analysis` and `reality-index`), per the
codebase's own rule that the scheduler only enqueues. Offsets are the second layer.

`src/services/scheduler.cronCollision.test.js` asserts the invariant — **no dispatch cron may
share a minute with an in-process cron** — plus a snapshot count of in-process crons, so
adding one is a decision rather than an accident.

**`recoverMissedExecutions: true` is not the fix.** Measured: it recovers 0% → 100% under
heavy lag, but **double-fires** under light lag. On non-idempotent cycles that is a worse
failure than the one it solves.

| Var | Default | Prod | Runtime-flip | Purpose |
|---|---|---|---|---|
| `QUEUE_CONCURRENCY_ANALYSIS` | `1` | default | restart | **Strictly 1** — `runAnalysisCycle` guards itself with a process-local `isRunning` flag a second consumer would not see. |
| `QUEUE_CONCURRENCY_REALITY_INDEX` | `1` | default | restart | **Strictly 1** — events / polymarket / usgs / promoter / RI-compose share this queue and contend for the same tables. |
| `CRON_SLOW_MS` | `500` | default | yes | A cron holding the loop synchronously this long is logged. **500ms, not 5s**: on the 2-core prod host that is already half a node-cron match window, and only one cycle in the fleet ever crossed 5s. |
| `LOOP_STALL_MS` | `1500` | default | yes | Excursion threshold for the stall/freeze line. The **distribution** (p50/p95/max/drift/heap) is logged every window regardless — an excursion-only alarm reported one event in 90 minutes while nearly every cron was missing ticks. |
| `LOOP_LAG_WINDOW_MS` | `60000` | default | yes | Reporting window for the lag distribution. |

**Six cycles have been moved from the scheduler to the worker, each after being MEASURED
holding the event loop** — never on suspicion:

| Cycle | Measured hold | Caught by |
|---|---|---|
| `runRealityIndexComposeCycle` | 5,481ms, 4 ticks missed, 41% on CPU | timer instrumentation (`+540s` boot pulse) |
| `runEventPromoterCronCycle` | 10,245ms | cron instrumentation |
| `runAnalysisCycle` / `runEventsCycle` / `runPolymarketCycle` / `runUsgsCycle` | — | the `:00`/`:30` collision map |

> **A theory that did not survive measurement**, recorded so it is not revived: *"runNoaaCycle
> blocks the social cron."* NOAA sits at `4,14,24,34,44,54` and never appeared in the slow
> list. Proximity in the minute map is not evidence.

> **`cpu_shares` is PARKED, not adopted.** 4096/512 was staged to protect the scheduler from
> the worker's renders. A later reading showed scheduler 0.04% / worker 111% mid-render, and
> the earlier 103% scheduler reading was a transient snapshot. Weighting is aimed at a
> contender that is not contending. See the comment in `docker-compose.production.yml`.

## Undocumented-var audit

`262` distinct `process.env.*` reads in `backend/`; `backend/.env.example` covered `77`.
The behaviour-critical gaps are now covered above and mirrored into `.env.example`. The
remaining undocumented names are third-party credentials and per-integration tuning
(social posting, TTS/video, translation, affiliate IDs) — self-describing, and several are
for features that are off. If you add a var, add it here **and** to `.env.example`.
