# Video Production Pipeline — Specification v1.0
## Multi-platform video as a ScoopFeeds distribution and revenue channel

**Document type:** Service specification
**Version:** 1.0
**Owner:** DrJ (Founder)
**Companion documents:** Agentic Build Workflow (`docs/agentic-workflow.md`), Source Scoring Service Spec v1.0 (`docs/specs/source_scoring_service.md`), Social Credentials runbook (`docs/ops/social_credentials.md`), Video Channel Tracker (`docs/content/video_channel_tracker.md`)
**Last updated:** July 2026
**Status:** Draft — awaiting 🛑 DrJ approval before Phase V2 implementation

---

## 0. About this document

This specification covers the video branch of the ScoopFeeds pipeline: how article and event data become narrated video, how that video reaches YouTube, Facebook, Instagram, and TikTok, and what has to change for those channels to become a revenue stream rather than a distribution afterthought.

It is written **after** a repo audit, not before one. A substantial video pipeline already exists in `backend/src/services/` and `scripts/`. This document therefore describes the current implemented state honestly (§2), names the gaps (§3), and specifies only the work that is genuinely new (§4–§6). Nothing here proposes rebuilding what already runs.

It does not prescribe channel names, editorial niche boundaries, or business-entity decisions. Those are founder decisions recorded in the companion tracker.

---

## 1. Purpose and scope

### 1.1 What the video pipeline does

- Selects newsworthy articles and events from the existing corpus and event graph.
- Renders branded, narrated video without human editing.
- Routes each render to the appropriate platforms with per-platform metadata.
- Holds every render behind a review gate before anything publishes.
- Records what was published where, so no story double-posts.

### 1.2 What it does not do

- It does not generate synthetic footage of real events. Visuals are typographic slides, owned brand assets, and licensed stock only. This is a standing constraint, not a phase decision — see §7.1.
- It does not publish without a human approval decision (default posture; see §7.2).
- It does not make editorial judgements about which stories are appropriate for a public channel. That remains a founder decision at the gate.

### 1.3 Why video, and why now

Two reasons, in priority order:

1. **Distribution.** Short-form video is where news discovery happens for audiences that will never visit an RSS-derived website. Each video is a funnel back to scoopfeeds.com.
2. **Revenue.** Platform monetization programs (YouTube Partner Programme, Facebook Content Monetization, TikTok Creator Rewards, Instagram bonuses) turn distribution into direct income. This is the first ScoopFeeds revenue mechanism that does not require selling anything to anyone.

The second reason changes technical requirements in ways the current pipeline does not yet satisfy — principally video length and aspect ratio (§3.3).

---

## 2. Current implemented state (repo audit, July 2026)

This section is descriptive. Everything below already exists in the repository and is not part of the work to be done.

### 2.1 Services

| File | Lines | Role |
|---|---|---|
| `backend/src/services/videoGenerator.js` | ~1,464 | Satori → PNG slides → FFmpeg → MP4. Three generators: per-article, recap, live-event. |
| `backend/src/services/ttsService.js` | ~281 | Five-tier TTS fallback: OpenAI → ElevenLabs → Google Cloud → Google Translate (free) → silent. Also holds `buildVideoScript()`. |
| `backend/src/services/videoPublisher.js` | ~392 | Publishes approved jobs to YouTube Shorts, IG Reels, FB Reels, TikTok. Holds the auto-approve criteria. |
| `backend/src/services/cardRenderer.js` | ~1,604 | Branded PNG cards; shares the Satori + resvg rendering approach video slides use. |
| `backend/src/services/youtubeClient.js` | — | YouTube Data API v3 upload + `getVideoStats()`. |
| `backend/src/services/{facebook,instagram,tiktok}Client.js` | — | Per-platform publish adapters. |

### 2.2 Job lifecycle

The `video_jobs` table carries each render through:

```
queued → rendering → ready → review_approved → published
```

`findArticlesForVideoQueue()` selects candidates; the scheduler enqueues at 2 AM; render workers pick up batches; `videoPublisher.js` publishes approved jobs and marks them published once at least one platform succeeds.

### 2.3 Render offloading

Rendering does not run on the production VPS. `scripts/render-queue.mjs` and `scripts/render-recap.mjs` run as GitHub Actions workers (`.github/workflows/render-videos.yml`, `render-recap.yml`), pulling batches over HTTP from `/scoop-ops/videos-gen/next-batch`, rendering locally with `@ffmpeg-installer/ffmpeg`, and uploading MP4s back. This keeps FFmpeg's CPU cost off the production host at zero marginal cost.

### 2.4 Existing formats

| Format | Spec | Trigger |
|---|---|---|
| Per-article Short | 1080×1920, 35–45s, 5 slides (title, 3 points, CTA) | 2 AM gen cron |
| Recap | ~60s vertical, top-5 articles | Daily / weekly |
| Live event | vertical | Every 6h |

### 2.5 Existing review gate

Manual approval by default. `VIDEO_AUTO_APPROVE=1` opts into automatic promotion of `ready` → `review_approved` when a job meets: credibility ≥ `VIDEO_AUTO_APPROVE_MIN_CREDIBILITY` (default 8), no tragedy keywords, and age < `VIDEO_AUTO_APPROVE_MAX_AGE_HOURS` (default 24).

**Assessment:** the pipeline is architecturally complete for short-form distribution. What it lacks is narrative quality, event-level content, and monetizable formats.

---

## 3. Gap analysis

### 3.1 Gap V2 — Script quality (highest leverage, smallest change)

`buildVideoScript()` in `ttsService.js` is a mechanical template:

> `"{source} reports: {headline}. {bullet}. {bullet}. {bullet}. For the full story, visit Scoop Feeds at scoopfeeds dot com."`

This produces grammatically valid narration with no narrative arc, no hook, no reason to keep watching past second three. Retention is the single variable every platform's algorithm optimises for and every monetization programme pays against. A templated script caps retention structurally, no matter how good the visuals get.

The repo already has an established LLM integration pattern (`analysisService.js` calls Gemini via `axios` with a pinned model and a model-gone-detection guard), so this gap is a new module following an existing convention rather than new infrastructure.

### 3.2 Gap V3 — No dossier-level video

Every generator renders from a single article or a flat top-N list. The A2 dossier — the structure that makes ScoopFeeds different from a headline aggregator — never becomes video. Its section order (Header → Timeline → Coverage → Angles → Actors → Intelligence) is already an editorial structure and maps cleanly onto video chapters.

This is the only format in the plan that competitors structurally cannot copy, because it depends on the event graph.

### 3.3 Gap V4 — Format does not support monetization

All current output is vertical short-form. This matters commercially:

- **YouTube:** Shorts monetize at a small fraction of long-form RPM, and the watch-hours pathway into the Partner Programme is driven by long-form viewing. A channel of only Shorts is a channel with a low revenue ceiling.
- **TikTok:** the Creator Rewards programme requires videos over one minute. Current Shorts are 35–45 seconds — below the threshold by design.
- **Facebook:** Reels and longer video monetize under different terms.

Gaps V3 and V4 resolve each other: the dossier video is the natural landscape long-form format.

### 3.4 Gap V5 — No feedback loop

`getVideoStats()` exists in `youtubeClient.js` but performance data does not flow back into selection logic. The pipeline cannot currently learn which categories, events, or scripts earn watch-time.

### 3.5 Gap V1 — Channels not activated

Credentials, channel/page creation, and cron activation are unfinished operational work, not engineering work. Listed here for completeness because it blocks everything else.

---

## 4. Phase V2 — LLM scriptwriter

### 4.1 Contract

New module `backend/src/services/scriptWriter.js`.

**Input:** an article record (title, summary/content, source name, category, credibility score) or an event dossier object, plus a target format descriptor (`short` | `recap` | `dossier`) and target duration in seconds.

**Output:** a structured object, or `null` on any failure.

```
{
  narration:   string,        // spoken script, plain prose, TTS-safe
  slides:      [{ heading, body }],   // on-screen text, aligned to narration beats
  titles:      { youtube, tiktok, instagram, facebook },
  description: string,
  hashtags:    string[],
  disclosure:  boolean        // true → mark as altered/synthetic on upload
}
```

### 4.2 Behavioural requirements

1. **Fallback is mandatory.** If the LLM call fails, times out, is unconfigured, or returns unparseable output, the caller falls back to the existing `buildVideoScript()`. The pipeline must never lose the ability to produce video because an API is down. This mirrors the five-tier fallback discipline already in `ttsService.js`.
2. **TTS-safe output.** No markdown, no bullet glyphs, no URLs in narration ("scoopfeeds dot com", not "scoopfeeds.com"), no unpronounceable characters. Numbers and abbreviations expanded.
3. **Duration control.** The prompt specifies a word budget derived from target duration at ~150 wpm, and the module truncates at sentence boundaries if the model overshoots.
4. **Grounding constraint.** The prompt forbids any claim not present in the supplied article/dossier text. No inferred causes, no speculation about motive, no predicted outcomes. Hallucinated facts in a news product are an existential credibility risk, and unlike a website error, a published video cannot be quietly corrected.
5. **Tone constraint.** Neutral wire-service register. No editorialising, no outrage framing, no clickbait phrasing in narration. Hooks come from *specificity*, not sensationalism.
6. **Cost telemetry.** Log tokens and estimated cost per call, following the existing job-logging pattern, so the tracker can carry a real cost-per-video figure.

### 4.3 Integration points

- `videoGenerator.js` line ~777 (`const script = buildVideoScript(article, bullets)`) becomes a call to the new module with fallback to the existing function.
- Slide text generation (`extractBullets`) can optionally consume `slides[]` when the LLM path succeeds, so narration and on-screen text stop drifting apart.
- Publishing metadata in `videoPublisher.js` consumes `titles`/`description`/`hashtags` per platform instead of reusing the headline everywhere.

### 4.4 Configuration

| Env var | Default | Purpose |
|---|---|---|
| `SCRIPT_LLM_ENABLED` | `0` | Master switch; off means current behaviour, unchanged |
| `SCRIPT_LLM_PROVIDER` | `gemini` | Reuse the configured provider; Claude/OpenAI selectable |
| `SCRIPT_LLM_MODEL` | pinned | Explicit pin, per the `analysisService.js` precedent |
| `SCRIPT_LLM_MAX_WORDS` | derived | Override word budget |

Default-off is deliberate: the flag ships dark, gets validated on a handful of jobs against the templated output, and only then flips. Same posture as `EVENT_FACETS_PERSIST`.

### 4.5 Acceptance criteria

- With `SCRIPT_LLM_ENABLED=0`, output is byte-identical to today's.
- With it on, ten sample articles produce scripts that: stay within ±15% of the word budget, contain no claim absent from the source text (manual check), and read cleanly through TTS.
- Killing the LLM endpoint mid-batch produces videos via fallback, with a logged warning and no failed jobs.

---

## 5. Phase V3 — Dossier video generator

### 5.1 Contract

New generator `generateDossierVideo(event, opts)` in `videoGenerator.js`, reusing the existing Satori → FFmpeg → TTS chain.

**Format:** 1920×1080 landscape, target 3–6 minutes, chaptered.

**Chapter structure**, derived from the A2 section order:

| Chapter | Source data | Video treatment |
|---|---|---|
| Cold open | Event header + latest development | Hook: what just happened |
| Timeline | Event timeline entries | Sequential dated cards, latest-first per the A2 decision |
| Coverage | Article set across sources | "How many outlets, which ones" — source-count visual |
| Angles | Storyline siblings / A5 facets | One card per angle |
| Actors | Actor chips | Named entities with role labels |
| Close | CTA | Full dossier at scoopfeeds.com |

### 5.2 Requirements

1. Chapter boundaries emit YouTube chapter timestamps into the description, which improves both retention and searchability.
2. If an event has too few timeline entries or too few sources to sustain three minutes, the generator returns `null` rather than padding. Thin content published as long-form is worse than not publishing.
3. Landscape slide layouts are a new template set; the existing vertical templates stay untouched.
4. Selection: only events above a size threshold (article count, source diversity, recency of last development) are eligible. Threshold configurable, starting conservative.

### 5.3 Acceptance criteria

- A macro-event with a populated timeline renders a coherent 3–6 minute landscape MP4 with correct chapter timestamps.
- A thin event returns `null` and logs the reason.
- Existing short-form output is unaffected.

---

## 6. Phase V4 — Distribution and revenue loop

### 6.1 Per-platform routing matrix

| Format | YouTube | Facebook | Instagram | TikTok | X / Bluesky / LinkedIn |
|---|---|---|---|---|---|
| Short (vertical, 35–45s) | Shorts | Reels | Reels | ⚠ below 1-min rewards threshold | link post |
| Short-plus (vertical, 60–90s) | Shorts | Reels | Reels | ✅ eligible | link post |
| Dossier (landscape, 3–6 min) | ✅ primary revenue format | ✅ video | — | — | link post |

The "short-plus" length variant exists solely to clear TikTok's one-minute rewards threshold; it is a duration parameter on the existing generator, not a new format.

### 6.2 Analytics feedback

Extend the existing `getVideoStats()` usage into a scheduled job that writes per-video performance (views, average view duration, retention where available) back to the database, keyed to the article/event that produced it. Two consumers:

- The tracker, for honest reporting of what is working.
- Selection logic, eventually: categories and event types that earn watch-time get weighted up in `findArticlesForVideoQueue()`.

### 6.3 Monetization prerequisites

Programme eligibility, payout routing (Urben LLC vs. personal), and tax treatment are **founder decisions with legal and tax consequences**, recorded in the tracker as open items. This spec does not decide them and no implementation depends on them. Requirements should be verified directly against each platform's current published policy at the time of application rather than assumed from prior knowledge.

---

## 7. Standing constraints

### 7.1 No synthetic footage of real events

Generative video models (Higgsfield, Sora, Veo, Kling and similar) are **excluded from the render path**. Rationale:

- A product whose differentiator is source credibility scoring cannot attach AI-imagined footage to real news events without undermining its own premise.
- Non-deterministic generation requires taste-based retries, which an unattended nightly pipeline cannot perform.
- Platform policy on synthetic depictions of real events is tightening, and news is the most scrutinised category.

Permitted use, if any: generate-once brand assets (channel intro, abstract motion backgrounds) that are clearly non-representational and reused across videos. These are art direction, not journalism, and never depict a real event, person, or place.

### 7.2 The review gate is not optional

`VIDEO_AUTO_APPROVE` may be enabled for narrow, well-tested categories once a track record exists. It must not become the default posture for the whole queue. Rationale: published video is effectively irreversible (it is downloaded, re-shared, and screenshotted within minutes), the operator holds public office, and a misinformation strike is materially harder to recover from than a website correction. Per `docs/agentic-workflow.md` §4, irreversible actions require a 🛑 human gate.

### 7.3 Visual asset licensing

Video visuals use the same discipline `cardRenderer.js` already documents: typographic slides and owned brand assets by default, stock imagery via licensed APIs only. No publisher hero images, no broadcast clips.

### 7.4 AI disclosure

Videos with synthesised narration are marked as altered/synthetic content where the platform provides the field, and the channel's about page states that production is AI-assisted with human editorial review.

---

## 8. Cost model

| Item | Monthly |
|---|---|
| Rendering (GitHub Actions runners) | $0 |
| TTS — free tier (Google Translate voice) | $0 |
| TTS — ElevenLabs (quality upgrade, optional) | ~$22 |
| Script LLM (~60 videos/mo, small model) | ~$5 |
| Publishing APIs | $0 |
| **Total** | **$0 – $27** |

The pipeline is already built and self-hosted, so the marginal cost of the whole video channel is a rounding error against the VPS. This is the strongest argument for proceeding: the downside is capped at pocket change and the upside is a genuine revenue line.

---

## 9. Open questions for the founder

1. **Editorial boundary.** Which categories are in scope for public video, given the operator's public office? Recommend excluding Pakistani domestic politics entirely and stating the boundary explicitly before launch.
2. **Channel identity.** Names and handles across four platforms; brand-account ownership.
3. **Entity.** Channel ownership and payout routing via Urben LLC or personally — a decision with tax consequences that should be checked before applying to any monetization programme.
4. **Auto-approve appetite.** Which categories, if any, eventually qualify for `VIDEO_AUTO_APPROVE`.

---

## 10. Change log

| Version | Date | Change |
|---|---|---|
| 1.0 | July 2026 | Initial specification following repo audit. Documents existing pipeline state; specifies Phases V2–V4. |
