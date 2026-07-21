# Scoopfeeds Dependencies

**Document type:** Reference / Operational
**Owner:** DrJ
**Last updated:** May 2026
**Status:** Active

This document tracks all third-party services, APIs, and external dependencies the Scoopfeeds platform relies on. Updated whenever new dependencies are added or existing ones materially change.

## How to read this document

For each dependency:
- **Purpose:** what it does for Scoopfeeds
- **Account owner:** who controls the API key / billing
- **Cost:** estimated monthly cost (or `TBD` / `free`)
- **Phase introduced:** when this became part of the stack
- **Criticality:** Critical (platform breaks if down) / Important (degraded experience) / Optional (nice to have)
- **Replacement options:** alternatives if this dependency becomes unavailable
- **Code references:** files in the repo that integrate with this dependency (where applicable)

---

## 1. Hosting and infrastructure

### Hostinger
- **Purpose:** Production web tier hosting
- **Account owner:** DrJ
- **Cost:** [TBD]
- **Phase introduced:** Pre-Phase-A
- **Criticality:** Critical
- **Replacement options:** Fly.io, Railway, Render, AWS App Runner
- **Code references:** No code-level integration (deploy target only). Mentioned in `backend/start.js`, `backend/server.cjs`, [docs/ops/hostinger_migration.md](ops/hostinger_migration.md), [README.md](../README.md), and `backend/.env.example` (`PRIMARY_SITE_URL`, `REDIRECT_FROM_HOSTS`).

### Mac mini M4 (DrJ's setup)
- **Purpose:** Auxiliary processing, local AI inference, development environment
- **Account owner:** DrJ
- **Cost:** $0 (owned hardware)
- **Phase introduced:** Pre-Phase-A
- **Criticality:** Important (development velocity, local AI)
- **Replacement options:** Any local development machine with sufficient RAM for AI models
- **Code references:** [docs/ops/mac_mini_deploy.md](ops/mac_mini_deploy.md)

### Docker production stack
- **Purpose:** Containerized production deployment (added recently to repo)
- **Status:** Available; deployment status TBD
- **Code references:** `Dockerfile`, `docker-compose.production.yml`, `.dockerignore` (in repo root)

### Railway / Fly.io / Render (planned)
- **Purpose:** Migration target if Hostinger constraints bind
- **Status:** Documented; not yet active. `nixpacks.toml` and `railway.json` exist at repo root, suggesting Railway has been pre-scoped.
- **Phase introduced:** Phase E (only if needed)

## 2. AI and ML services

> **Note on the AI stack — updated 2026-07-20.** The Strategic Plan describes a *planned*
> multi-model routing pattern (DeepSeek routine / Claude-GPT complex) for the Phase-C
> generative-answers feature; that is still a plan, not the current wiring. **What is
> actually wired and paid for today is Google Gemini**, pinned via
> `GEMINI_GENERATION_MODEL` (prod: `gemini-3.1-flash-lite`) with hard cost rails
> (`thinkingBudget: 0`, output caps, `LLM_DAILY_CALL_CAP`, actor-attempts ledger) added
> after the gate-(a) cost incident. Cerebras / Groq / Cloudflare Workers AI / NVIDIA NIM /
> Ollama remain configurable alternatives in `llmQueue.js` but are not the live path.
> Anthropic, OpenAI and DeepSeek are not paid API integrations. Every LLM path has a
> deterministic non-LLM fallback. See [`reference/env_reference.md`](reference/env_reference.md).
>
> *(This note previously described Cerebras+Groq as the live stack — accurate in May 2026,
> superseded by the Gemini pin in July.)*

### Cerebras Cloud
- **Purpose:** STANDARD-tier LLM (matching, sentiment, reranking, default `LLM_PROVIDER`)
- **Model:** `llama-3.3-70b` (~450 tok/s inference)
- **Account owner:** DrJ
- **Cost:** Free tier — 1M tokens/day
- **Phase introduced:** Pre-Phase-A
- **Criticality:** Important (default LLM path)
- **Replacement options:** Groq, Cloudflare Workers AI, NVIDIA NIM, local Ollama
- **Code references:** [backend/src/realityIndex/llmQueue.js](../backend/src/realityIndex/llmQueue.js); env: `CEREBRAS_API_KEY`, `CEREBRAS_MODEL`

### Groq
- **Purpose:** PREMIUM-tier LLM (analyst briefs, high-quality jobs); globally accessible (works from Pakistan, where NVIDIA NIM is geo-restricted)
- **Model:** `llama-3.3-70b-versatile` (GPT-4-class quality)
- **Account owner:** DrJ
- **Cost:** Free tier — ~30 RPM
- **Phase introduced:** Pre-Phase-A
- **Criticality:** Important (premium tier default)
- **Replacement options:** NVIDIA NIM, Cerebras for premium fallback
- **Code references:** [backend/src/realityIndex/llmQueue.js](../backend/src/realityIndex/llmQueue.js); env: `GROQ_API_KEY`, `GROQ_MODEL`

### Cloudflare Workers AI
- **Purpose:** Embeddings (default `EMBED_PROVIDER`) + generation fallback. 768-dim embeddings drop-in for sqlite-vec.
- **Models:** `@cf/baai/bge-base-en-v1.5` (embeddings), `@cf/meta/llama-3.3-70b-instruct-fp8-fast` (generation)
- **Account owner:** DrJ
- **Cost:** Free tier — 10k neurons/day
- **Phase introduced:** Pre-Phase-A
- **Criticality:** Important (semantic search backbone)
- **Replacement options:** Ollama (local, `nomic-embed-text`), Gemini Embedding API
- **Code references:** [backend/src/realityIndex/llmQueue.js](../backend/src/realityIndex/llmQueue.js); env: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_GEN_MODEL`, `CLOUDFLARE_EMBED_MODEL`

### NVIDIA NIM (build.nvidia.com)
- **Purpose:** Premium LLM alternative (geo-restricted in Pakistan, hence Groq is preferred)
- **Account owner:** DrJ
- **Cost:** Free credits — ~1000/model
- **Phase introduced:** Pre-Phase-A
- **Criticality:** Optional (Groq fills the same role with better availability)
- **Code references:** [backend/src/realityIndex/llmQueue.js](../backend/src/realityIndex/llmQueue.js); env: `NVIDIA_API_KEY`, `NIM_MODEL`

### Ollama (local)
- **Purpose:** Optional local fallback for both generation and embeddings
- **Account owner:** DrJ
- **Cost:** Free (local infra)
- **Phase introduced:** Pre-Phase-A
- **Criticality:** Optional
- **Code references:** [backend/src/realityIndex/llmQueue.js](../backend/src/realityIndex/llmQueue.js); env: `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `OLLAMA_EMBED_MODEL`

### Gemini (legacy)
- **Purpose:** Legacy LLM / embedding provider, retained for compatibility
- **Account owner:** DrJ
- **Cost:** Free tier — 15 RPM
- **2026-07-09:** prod currently runs Gemini embeddings on **PAID tier** as an interim measure (see decisions log Decision 32); permanent provider decision scheduled Phase C.
- **Phase introduced:** Pre-Phase-A
- **Criticality:** Optional
- **Code references:** [backend/src/realityIndex/llmQueue.js](../backend/src/realityIndex/llmQueue.js); env: `GEMINI_API_KEY`, `GEMINI_GENERATION_MODEL`, `GEMINI_EMBEDDING_MODEL`

### Anthropic (Claude API) — *not currently integrated*
- **Purpose (planned):** Complex query AI answers, brief generation, sensitive content review (per Strategic Plan)
- **Account owner:** DrJ (planned)
- **Cost:** [TBD — varies with usage]
- **Phase introduced:** Planned (referenced in README and Strategic Plan; not yet wired)
- **Criticality:** Important (when adopted)
- **Replacement options:** Currently filled by Groq + Cerebras; could be added alongside as a quality tier
- **Code references:** Not found as an API integration. Anthropic appears in [backend/src/config/sources.js](../backend/src/config/sources.js) only as an RSS news source (`anthropic.com/news/rss.xml`).

### OpenAI (GPT API) — *not currently integrated*
- **Purpose (planned):** Backup model for complex queries, document classification (per Strategic Plan)
- **Account owner:** DrJ (planned)
- **Cost:** [TBD]
- **Phase introduced:** Planned
- **Criticality:** Important (when adopted)
- **Replacement options:** Already filled by the OpenAI-compatible providers above (Cerebras / Groq / Cloudflare / NVIDIA all expose `/v1/chat/completions`)
- **Code references:** Not found as a paid integration. The string "OpenAI" appears in [backend/src/realityIndex/llmQueue.js](../backend/src/realityIndex/llmQueue.js) only as the name of the protocol shim (`_callOpenAICompat`) used to call the providers above.

### DeepSeek — *not currently integrated*
- **Purpose (planned):** Cost-efficient routing for routine queries
- **Account owner:** DrJ (planned)
- **Cost:** [TBD]
- **Phase introduced:** Planned
- **Criticality:** Important (cost discipline)
- **Replacement options:** Cost discipline is currently met by Cerebras's free tier
- **Code references:** Zero matches in the codebase. Pure forward-looking item.

### Cerebras (per ARIA pattern)
*See "Cerebras Cloud" above — same dependency, listed once.*

## 3. Search backbones (Phase B+)

### Brave Search API
- **Purpose:** Primary web search backbone for Scoop
- **Account owner:** DrJ (to be set up Phase B)
- **Cost:** ~$3-9 per 1000 queries (tier-dependent)
- **Phase introduced:** Phase B (preview), Phase C (full)
- **Criticality:** Critical (Phase D+)
- **Replacement options:** Mojeek, Bing API replacement, Exa.ai (semantic only)
- **Code references:** Not found in current scan — pre-integration.

### Exa.ai
- **Purpose:** Semantic search backbone for Layer 2
- **Account owner:** DrJ (to be set up Phase C)
- **Cost:** ~$5-10 per 1000 queries
- **Phase introduced:** Phase C
- **Criticality:** Important (Layer 2)
- **Replacement options:** Brave + own semantic layer
- **Code references:** Not found in current scan — pre-integration.

## 4. Reality Index data sources

### Polymarket
- **Purpose:** US-event prediction signals (existing integration)
- **Account owner:** DrJ
- **Cost:** Free (public data)
- **Phase introduced:** Pre-Phase-A
- **Criticality:** Important
- **Replacement options:** API may change; fallback to scraping
- **Code references:** [backend/src/realityIndex/ingest/predictionMarkets/polymarketFetcher.js](../backend/src/realityIndex/ingest/predictionMarkets/polymarketFetcher.js), [polymarketSnapshotter.js](../backend/src/realityIndex/ingest/predictionMarkets/polymarketSnapshotter.js), [backend/src/routes/predictions.js](../backend/src/routes/predictions.js), [backend/src/services/scheduler.js](../backend/src/services/scheduler.js).

### Kalshi (Phase C)
- **Purpose:** CFTC-regulated mainstream prediction signals
- **Account owner:** DrJ (to be set up)
- **Cost:** [TBD] — Free or low API cost expected
- **Phase introduced:** Phase C
- **Criticality:** Important
- **Replacement options:** Polymarket alone (with reduced credibility)
- **Code references:** Schema enum entry in [backend/src/realityIndex/schema.js](../backend/src/realityIndex/schema.js); no fetcher yet.

### Metaculus (Phase C)
- **Purpose:** Calibrated forecaster signals
- **Account owner:** DrJ (to be set up)
- **Cost:** Free public API
- **Phase introduced:** Phase C
- **Criticality:** Important
- **Replacement options:** Good Judgment Open
- **Code references:** Schema enum entry in [backend/src/realityIndex/schema.js](../backend/src/realityIndex/schema.js); no fetcher yet.

### Good Judgment Open (Phase D)
- **Purpose:** Premium forecasting signals
- **Account owner:** DrJ (to be set up)
- **Cost:** Free public access
- **Phase introduced:** Phase D
- **Criticality:** Optional (additional triangulation)
- **Code references:** Not found — pre-integration.

## 5. News ingestion sources

### Wired ingestion fetchers (Reality Index)
All have dedicated fetchers under [backend/src/realityIndex/ingest/](../backend/src/realityIndex/ingest/):

| Source | Domain | Fetcher |
|---|---|---|
| GDELT | News aggregator (multilingual) | `newsAggregators/gdeltFetcher.js` |
| FRED | US economic indicators | `economic/fredFetcher.js` |
| World Bank | Global economic indicators | `economic/worldBankFetcher.js` |
| TMDB | Entertainment / movies | `entertainment/tmdbFetcher.js` |
| ACLED | Conflict events | `geo/acledFetcher.js` |
| NOAA Alerts | Severe weather | `geo/noaaAlertsFetcher.js` |
| USGS | Earthquakes | `geo/usgsEarthquakeFetcher.js` |
| SportsDB | Sports fixtures/results | `sports/sportsdbFetcher.js` |
| Wikipedia | Pageview trends | `trends/wikipediaPageviewsFetcher.js` |
| Bluesky | Social signal | `social/blueskyFetcher.js` |
| HackerNews | Social signal | `social/hnFetcher.js` |
| Mastodon | Social signal | `social/mastodonFetcher.js` |
| Reddit | Social signal | `social/redditFetcher.js` |

### RSS feed catalog
- **Code:** [backend/src/config/sources.js](../backend/src/config/sources.js) (large catalog of named outlets across categories)
- **Account owner:** N/A (public RSS); some outlets may rate-limit
- **Cost:** Free
- **Criticality:** Important (news pipeline)

### YouTube ingestion
- **Purpose:** Video source for video-led news coverage
- **Account owner:** DrJ
- **Cost:** Free tier (Data API v3 has a daily quota)
- **Code references:** [backend/src/services/youtubeClient.js](../backend/src/services/youtubeClient.js), [backend/src/services/videoFetcher.js](../backend/src/services/videoFetcher.js), [backend/src/services/videoPublisher.js](../backend/src/services/videoPublisher.js), [backend/src/routes/videos-gen.js](../backend/src/routes/videos-gen.js), [backend/src/routes/liveStream.js](../backend/src/routes/liveStream.js), [scripts/youtube-auth.mjs](../scripts/youtube-auth.mjs)

### Source matrix expansion (Phase A audit will populate)
- Target Phase B: ≥150 active sources
- Target Phase C: ≥300 active sources
- Target Phase D: ≥500 active sources
- Target Phase E: ≥800 active sources

## 6. Communications and alerts

### Email — generic SMTP
- **Purpose:** Newsletter, breaking alerts, transactional email
- **Provider:** Configurable via SMTP env vars; no specific third-party SDK installed (uses `nodemailer` with raw SMTP).
- **Account owner:** DrJ
- **Cost:** [TBD — depends on chosen SMTP provider]
- **Phase introduced:** Pre-Phase-A
- **Criticality:** Critical
- **Replacement options:** Postmark, SES, SendGrid, Mailgun, Resend (all reachable via SMTP without code changes)
- **Code references:** [backend/src/services/mailer.js](../backend/src/services/mailer.js), [backend/src/routes/newsletter.js](../backend/src/routes/newsletter.js), [backend/src/routes/newsletter-ops.js](../backend/src/routes/newsletter-ops.js); env: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`

### Web push notifications
- **Purpose:** Free-tier breaking alerts
- **Current:** Browser-native VAPID; no third-party service. Auto-generates VAPID keypair on first boot if env unset.
- **Cost:** Free
- **Phase introduced:** Pre-Phase-A (Phase 2a per env comments)
- **Criticality:** Important
- **Code references:** `web-push` ^3.6.7 (in [backend/package.json](../backend/package.json)); env: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_CONTACT`, `ENABLE_BREAKING_PUSH`, `PUSH_QUIET_START`, `PUSH_QUIET_END`

### Telegram Bot API (Phase B)
- **Purpose:** Free-tier broadcast alerts
- **Account owner:** DrJ (to be set up Phase B)
- **Cost:** Free (no per-message charge for channel broadcasts)
- **Phase introduced:** Phase B
- **Criticality:** Important (free-tier alert reach)
- **Code references:** Not found as an API integration. The string "telegram" appears only in [backend/src/routes/seo.js](../backend/src/routes/seo.js) as a share-button platform name and bot-UA regex token — not a posting integration.

### WhatsApp Business API (Phase D)
- **Purpose:** Premium-tier alerts
- **Provider:** Twilio WhatsApp / MessageBird (TBD)
- **Account owner:** DrJ (to be set up Phase D)
- **Cost:** ~$0.005-0.05 per message, country-dependent
- **Phase introduced:** Phase D
- **Criticality:** Critical (premium-tier value proposition)
- **Replacement options:** Webhooks-only fallback if API issues
- **Code references:** Not found — same status as Telegram (share-button only).

### Webhooks / Slack / Teams (Phase D)
- **Purpose:** Premium-tier integration alerts
- **Account owner:** DrJ (to be set up Phase D)
- **Cost:** Free (per-customer integrations)
- **Phase introduced:** Phase D
- **Criticality:** Important
- **Code references:** Not found — pre-integration.

## 7. Monitoring and ops

### Sentry
- **Purpose:** Error tracking, performance monitoring (also profiling via `@sentry/profiling-node`)
- **Account owner:** DrJ
- **Cost:** [TBD — Free tier or paid]
- **Phase introduced:** Pre-Phase-A
- **Criticality:** Important
- **Replacement options:** Datadog, New Relic, self-hosted GlitchTip
- **Code references:** [backend/src/config/observability.js](../backend/src/config/observability.js); deps: `@sentry/node`, `@sentry/profiling-node` (in [backend/package.json](../backend/package.json)); env: `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_TRACES_SAMPLE_RATE`, `SENTRY_PROFILES_SAMPLE_RATE`

### Logging service
- **Current:** Local Winston logging (`winston` ^3.11.0 in deps); no external log aggregator detected.
- **Phase introduced:** Pre-Phase-A
- **Criticality:** Important
- **Replacement options:** Sentry already captures errors; for full log aggregation: Logtail/BetterStack, Papertrail, Datadog Logs.

### Redis / BullMQ (queue infrastructure)
- **Purpose:** Background job processing
- **Provider:** Self-hosted Redis (or any managed Redis-compatible service)
- **Cost:** [TBD — depends on hosting choice]
- **Status:** Wired in code; activation gated behind `USE_BULLMQ=true`. Production split documented in `.env.example`: web (no scheduler) / scheduler / worker.
- **Code references:** Deps `bullmq` ^5.76.5, `ioredis` ^5.10.1; jobs at [backend/src/jobs/](../backend/src/jobs/) (`schedulerProcess.js`, `workerProcess.js`, `queues.js`, `redis.js`); env: `REDIS_URL`, `BULLMQ_PREFIX`, `USE_BULLMQ`, `REQUIRE_REDIS`, `QUEUE_CONCURRENCY_*`

## 8. Payments

### Stripe — *already wired*
- **Purpose:** Currently wired as **Stripe Checkout tip jar** ([backend/src/routes/tips.js](../backend/src/routes/tips.js)); designed to graceful-degrade when keys are unset (`{ configured: false }`).
- **Future use:** Premium subscription billing, API tier billing (Phase D)
- **Account owner:** DrJ
- **Cost:** 2.9% + $0.30 per transaction (standard pricing)
- **Phase introduced:** Pre-Phase-A (tips); Phase D for subscriptions
- **Criticality:** Critical (revenue dependency once subscriptions launch)
- **Replacement options:** Paddle (alternative for SaaS subscriptions)
- **Code references:** [backend/src/routes/tips.js](../backend/src/routes/tips.js), [backend/server.js](../backend/server.js), [backend/src/models/database.js](../backend/src/models/database.js); deps: `stripe` ^16.0.0; env: `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`

## 9. Social platforms

### Existing auto-posting (per Decision 19) — wired
- **Bluesky:** Active — [backend/src/services/blueskyClient.js](../backend/src/services/blueskyClient.js); env: `BLUESKY_HANDLE`, `BLUESKY_APP_PASSWORD`, `BLUESKY_PDS_URL`, `ENABLE_AUTO_SOCIAL`
- **Facebook page:** Active — referenced in [backend/src/routes/social.js](../backend/src/routes/social.js); env: `FACEBOOK_PAGE_ID`, `FACEBOOK_PAGE_TOKEN`
- **Instagram:** Match in `backend/src/routes/social.js` and [backend/src/models/database.js](../backend/src/models/database.js) — verify whether wired posting or share-graph metadata only [TBD]
- **Threads:** Wired client at [backend/src/services/threadsClient.js](../backend/src/services/threadsClient.js); env: `THREADS_ACCESS_TOKEN`, `THREADS_USER_ID`, `THREADS_HANDLE`. (Earlier than the Phase C plan.)
- **LinkedIn:** Client at [backend/src/services/linkedinClient.js](../backend/src/services/linkedinClient.js) plus OAuth helper at [backend/scripts/linkedin-auth.mjs](../backend/scripts/linkedin-auth.mjs)

### Phase B / C OAuth helpers (auth scaffolded, posting build pending)
- **Pinterest:** [backend/scripts/pinterest-auth.mjs](../backend/scripts/pinterest-auth.mjs)
- **YouTube Shorts:** [scripts/youtube-auth.mjs](../scripts/youtube-auth.mjs) and broader YouTube client (see §5)
- **Threads HTTP variant:** `backend/scripts/threads-auth-http.mjs`

### Phase B / C / D — not yet built
- **X (Twitter):** API access TBD; build planned Phase B
- **TikTok:** API access TBD; Phase D
- **YouTube long-form:** Same API as Shorts, different content strategy; Phase D

### Phase E additions
- **Podcast (Spotify, Apple):** API access TBD

For each platform: API access status, posting cadence, monetization status, brand voice guidelines documented in `docs/content/social_voice_<platform>.md` (to be created in Phase B).

## 10. Domain and DNS

### scoopfeeds.com
- **Account owner:** DrJ
- **Registrar:** [TBD]
- **Renewal date:** [TBD]
- **Criticality:** Critical

### intel.scoopfeeds.com (Phase D)
- **Subdomain of scoopfeeds.com**
- **DNS configuration:** Documented when set up

## 11. Other live dependencies (not in original spec)

### Pexels API — *active*
- **Purpose:** Stock photo backgrounds for branded social/news cards
- **Account owner:** DrJ
- **Cost:** Free tier — 200 reqs/hr, 20k/month
- **Phase introduced:** Pre-Phase-A
- **Criticality:** Optional (cards fall back to typographic-only when unset)
- **Replacement options:** Unsplash API, self-hosted image library
- **Code references:** [backend/src/services/stockPhoto.js](../backend/src/services/stockPhoto.js), [backend/src/services/cardRenderer.js](../backend/src/services/cardRenderer.js), [backend/src/routes/social.js](../backend/src/routes/social.js); env: `PEXELS_API_KEY`

### Google AdSense — *active*
- **Purpose:** Ad monetization on the Newsroom site
- **Account owner:** DrJ
- **Cost:** Revenue share (no fixed cost)
- **Phase introduced:** Pre-Phase-A
- **Criticality:** Important (current revenue lever)
- **Replacement options:** Mediavine / Ezoic (see [docs/ops/mediavine_readiness.md](ops/mediavine_readiness.md))
- **Code references:** Backend public-config endpoint serves AdSense IDs; env: `ADSENSE_CLIENT_ID`, `ADSENSE_PUBLISHER_ID`, `ADSENSE_SLOT_BANNER`, `ADSENSE_SLOT_SIDEBAR`, `ADSENSE_SLOT_INLINE`, `ADSENSE_TEST_MODE`. Frontend mirrors via `VITE_ADSENSE_*` in [frontend/.env.example](../frontend/.env.example).

---

## Update log

| Date | Change |
|---|---|
| 2026-05-05 | Initial document created (Sprint 0 Issue 0.9). Code-references populated from a repo scan; cost / ownership / registrar fields left as `[TBD]` for DrJ to fill in. |
