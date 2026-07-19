# Video Channel Tracker
## Plan and implementation status for the multi-platform video channel

**Document type:** Operational tracker
**Owner:** DrJ (Founder)
**Companion documents:** Video Production Pipeline Spec v1.0 (`docs/specs/video_production_pipeline.md`), Agentic Build Workflow (`docs/agentic-workflow.md`), Social Credentials runbook (`docs/ops/social_credentials.md`)
**Last updated:** July 19, 2026 (session 2)
**Status:** Active

---

## 0. How to use this document

This is the running record of the video channel work — what was decided, what was built, what is live, and what is still open. It is the answer to "where are we on video?" without needing to read the spec or the code.

**Update discipline:** every session that touches video work updates §2 (status board) and appends to §5 (session log) in the same commit as the code. A status line that was never updated is worse than no status line, because it lies with authority.

**Honesty rule (from `docs/agentic-workflow.md` §5):** status values describe what has been *verified*, not what has been *written*. Code that exists but has never run is `BUILT`, not `LIVE`.

**Status vocabulary:**

| Status | Meaning |
|---|---|
| `NOT STARTED` | No work done |
| `SPEC` | Specified, not implemented |
| `BUILT` | Code written, not yet verified running in production |
| `VERIFIED` | Ran successfully at least once, evidence recorded |
| `LIVE` | Running on cadence in production |
| `BLOCKED` | Waiting on a decision or dependency — blocker named |

---

## 1. Why this channel exists

Two goals, in priority order:

1. **Distribution** — reach audiences who will never visit a news website, and funnel them back to scoopfeeds.com.
2. **Revenue** — platform monetization programmes as the first ScoopFeeds income stream that does not require selling anything to anyone.

Target platforms: YouTube, Facebook, Instagram, TikTok. Same renders, per-platform metadata.

---

## 2. Status board

### 2.1 Already built before this workstream (repo audit, July 19, 2026)

Recorded so nobody rebuilds it. All of this predates the current plan.

| Component | File | Status | Note |
|---|---|---|---|
| Slide-show video renderer | `backend/src/services/videoGenerator.js` | `LIVE` | Satori → FFmpeg, 3 generators |
| TTS with 5-tier fallback | `backend/src/services/ttsService.js` | `LIVE` | Free tier means $0 baseline |
| Job queue + lifecycle | `video_jobs` table + scheduler | `LIVE` | queued→rendering→ready→approved→published |
| Render offloading | `scripts/render-queue.mjs`, `.github/workflows/` | `LIVE` | GitHub Actions runners, $0 |
| Review gate | `backend/src/services/videoPublisher.js` | `LIVE` | Manual by default; auto-approve opt-in |
| YouTube publish | `backend/src/services/youtubeClient.js` | `BUILT` | Code present; channel not yet activated |
| Facebook / Instagram / TikTok publish | respective `*Client.js` | `BUILT` | Code present; credentials not yet issued |
| Per-article Short (35–45s vertical) | `generateVideo()` | `LIVE` | |
| Daily/weekly recap (~60s vertical) | `generateRecapVideo()` | `LIVE` | |
| Live-event video (6h) | `generateLiveEventVideo()` | `LIVE` | |

**Audit conclusion:** the pipeline is architecturally complete for short-form distribution. Gaps are narrative quality, event-level content, and monetizable formats — not infrastructure.

### 2.2 This workstream

| ID | Item | Status | Blocker / next action |
|---|---|---|---|
| **V0** | Spec + tracker written and committed | `BUILT` | Landed |
| **V1** | Channel activation (accounts, credentials, cron on) | `BLOCKED` | D1 resolved; still needs **D2** (channel identity) |
| **V2a** | Editorial boundary filter (`videoEditorialPolicy.js`) | `BUILT` | Implements D1. 9/9 unit cases pass locally; not yet run in prod |
| **V2b** | LLM scriptwriter (`scriptWriter.js`) | `BUILT` | Ships default-off (`SCRIPT_LLM_ENABLED=0`); not yet run against a live model |
| **V3** | Dossier video generator (landscape long-form) | `SPEC` | Sequenced after V2 |
| **V4** | Analytics feedback + monetization applications | `NOT STARTED` | Needs V1 live + threshold volume |

---

## 3. Decisions

### 3.1 Made

| ID | Decision | Date | Rationale |
|---|---|---|---|
| **VD1** | Build on the existing in-repo pipeline; do **not** adopt n8n + JSON2Video/Creatomate | Jul 19, 2026 | Repo audit found the equivalent already built and running at $0. External stack would be a redundant parallel system with ~$100/mo cost. |
| **VD2** | Exclude generative video models (Higgsfield, Sora, Veo, Kling) from the render path | Jul 19, 2026 | Credibility risk on a credibility product; non-deterministic output unsuited to unattended pipelines; tightening platform policy on synthetic depictions of real events. Permitted only for non-representational brand assets. Spec §7.1. |
| **VD3** | Human review gate stays the default posture | Jul 19, 2026 | Publishing is irreversible; operator holds public office. Spec §7.2. |
| **VD4** | Ship V2 behind a default-off flag (`SCRIPT_LLM_ENABLED=0`) | Jul 19, 2026 | Same dark-ship posture as `EVENT_FACETS_PERSIST`. Validate against templated output before flipping. |
| **VD5** | Long-form landscape is the monetization format; Shorts are the discovery format | Jul 19, 2026 | Shorts RPM is structurally low and the YouTube watch-hours pathway is long-form driven. Spec §3.3. |
| **VD6 (D1)** | Public video excludes Pakistani domestic and political news unless the founder specifically directs otherwise. Focus is global audiences and topics of wider public interest. | Jul 19, 2026 | Founder decision. Implemented in `backend/src/services/videoEditorialPolicy.js`; escape hatch via `VIDEO_ALLOW_PK_DOMESTIC=1` or `{ force: true }`. Filter scope is **video only** — PK-domestic coverage continues on scoopfeeds.com and text social as normal. |
| **VD7** | Grounding failures fall back to the templated script rather than publishing the LLM output | Jul 19, 2026 | A templated-but-true script beats a fluent-but-invented one for a credibility product. Fail closed. |

### 3.2 Open — founder decisions required

> **D1 is now closed** — see VD6 above.

| ID | Question | Blocks | Notes |
|---|---|---|---|
| **D2** | Channel identity: names and handles across four platforms | V1 | Brand account, not a personal Google account. |
| **D3** | Entity: channel ownership and payout routing — Urben LLC (US) vs. personal (PK) | V4 | Real tax and AdSense consequences. Verify against current platform policy at application time; do not assume. |
| **D4** | Auto-approve appetite: which categories, if any, ever qualify | V4 | Default: none. Revisit only with a track record. |

---

## 4. Phase plan

### V1 — Channel activation *(operational, near-zero code)*
1. Create brand accounts / pages on all four platforms (needs **D1**, **D2**).
2. Run `scripts/youtube-auth.mjs` and `scripts/tiktok-auth.mjs`; record credentials per `docs/ops/social_credentials.md`.
3. Populate env: `YOUTUBE_*`, `FACEBOOK_PAGE_ID` + token, `INSTAGRAM_USER_ID`, `TIKTOK_*`.
4. Optional quality upgrade: add `ELEVENLABS_API_KEY` — already supported by `ttsService.js`, no code change.
5. Enable the 2 AM generation cron and the GitHub Actions render workflows.
6. Keep `VIDEO_AUTO_APPROVE=0`. Review every video manually for the first weeks.

**Exit criterion:** one video published to each platform from the existing pipeline, no code changes required.

### V2 — LLM scriptwriter
Per spec §4. New `backend/src/services/scriptWriter.js`; `videoGenerator.js` calls it with fallback to `buildVideoScript()`. Ships default-off.

**Exit criterion:** spec §4.5 acceptance criteria met, including verified fallback on API failure.

### V3 — Dossier video generator
Per spec §5. Landscape 3–6 min, chaptered on A2 dossier section order. Returns `null` on thin events rather than padding.

**Exit criterion:** spec §5.3 acceptance criteria met.

### V4 — Revenue loop
Per spec §6. Analytics writeback, per-platform length variants (including the 60–90s TikTok-eligible variant), monetization applications once thresholds are met.

---

## 5. Session log

Append one entry per session. Newest last.

### Jul 19, 2026 — Planning session (chat, no code)
- **Did:** Audited the repo for existing video capability before planning. Found a substantially complete pipeline (§2.1) that an earlier chat-only plan had proposed rebuilding externally.
- **Corrected:** Discarded the proposed n8n + JSON2Video/Creatomate stack (**VD1**). It would have duplicated working code at ~$100/mo.
- **Decided:** VD1–VD5.
- **Produced:** `docs/specs/video_production_pipeline.md` v1.0, this tracker.
- **Open:** D1–D4 await founder decision; V2 awaits 🛑 approval of spec §4.
- **Honest note:** nothing was built or run this session. All V2–V4 statuses are `SPEC` or lower, and every "already built" row in §2.1 reflects code read in the repo — the rows marked `BUILT` rather than `LIVE` (YouTube/FB/IG/TikTok publish) are marked so precisely because no video has yet been observed publishing through them.

---

### Jul 19, 2026 — Session 2: V2 implementation
- **Decision received:** D1 closed → **VD6**. Skip PK domestic/political news for video unless specifically directed; target global audiences and topics of wider public interest.
- **Built:**
  - `backend/src/services/videoEditorialPolicy.js` (new) — single source of truth for the D1 boundary. Category-level and headline-term exclusion, with a global-category short-circuit so "European Commissioner" and "NFL commissioner" are not caught by the "commissioner" term.
  - `backend/src/services/scriptWriter.js` (new) — Phase V2 LLM scriptwriter. Gemini call mirroring the pinned-model + retry pattern in `analysisService.js`; sanitizer, word-budget trim at sentence boundaries, and a grounding screen that rejects numbers and proper nouns absent from the source.
  - `backend/src/services/videoGenerator.js` (modified) — calls `writeScript()`, falls back to `buildVideoScript()` on null; LLM slide text used when available.
  - `backend/src/services/scheduler.js` (modified) — `filterVideoEligible()` applied to both selector paths.
- **Verified locally:** all four files parse under Node 22. D1 filter 9/9 on hand-built cases including the deliberate false-positive traps. Sanitizer strips markdown/quotes/brackets and spoken-form URLs. Grounding screen correctly flags an invented figure and an invented attributed name.
- **NOT verified:** no call has been made against a live model, and nothing has run in production. `scriptWriter.js` is therefore `BUILT`, not `VERIFIED` — the model-response path (real JSON shape, real latency, real cost) is entirely untested. The next session must validate it on a handful of real articles with `SCRIPT_LLM_ENABLED=1` before the flag flips anywhere permanent.
- **Deliberately not done:** did not enable any flag, did not touch credentials, did not push. All new behaviour is off by default.
- **Open:** D2 (channel identity) still blocks V1. D3, D4 unchanged.

---

## 6. Metrics

Empty until V1 is live. Populated by the V4 analytics job; do not fill in by hand from platform dashboards without noting the source.

| Period | Videos published | Platforms | Views | Avg. view duration | Subscribers | Revenue |
|---|---|---|---|---|---|---|
| — | — | — | — | — | — | — |
