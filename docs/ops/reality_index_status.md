# Reality Index — build status
Document type: Operational runbook
Owner: DrJ
Last updated: 2026-05-03
Status: Active

Snapshot of the Scoopfeeds → Reality Index conversion. One section per
plan phase; every sub-bullet either ✅ shipped, ⚠️ partial, or ⏭️ deferred.
Last updated 2026-05-03.

---

## Phase 1 — Foundations

- ✅ SQLite + sqlite-vec for 768-dim embeddings (vec0 virtual table)
- ✅ Multi-provider LLM queue (default: Cerebras free tier; embeds: Cloudflare bge-base-en-v1.5)
- ✅ Thin DAL (`vectorStore.js`) so future Postgres+pgvector cutover is mechanical
- ✅ Polymarket ingester → `prediction_markets` + `prediction_market_snapshots`
- ✅ Per-cron run-locks + status reporting via `getSchedulerStatus()`

## Phase 2 — Event tracker

- ✅ `events` table with category, severity, geo (lat/lng/polygon), status
- ✅ `event_timeline` (article + market_move + statement entries)
- ✅ `event_actors` extracted from cluster articles
- ✅ `event_market_links` joining events ↔ Polymarket
- ✅ `/events` grid + `/events/:slug` dossier
- ✅ `/timeline/:slug` standalone (Phase 7 add-on, see A2)

## Phase 3 — Reality Index composition

- ✅ Multi-channel sentiment (per-source + aggregated + time-series)
- ✅ Confidence-weighted geometric-mean composite (market 0.5 + media 0.2 + social 0.2 + econ 0.1)
- ✅ Truth Gap = market_norm − media_norm, signed [-1, +1]
- ✅ `bayesianUpdater` attributes market moves to articles within ±30 min
- ✅ `/truth-gap` page with badge + explainer
- ✅ Anomaly detector + `anomaly_alerts` table
- ✅ `/anomalies` page + watchlist push fan-out

## Phase 4 — Briefs + watchlists

- ✅ `generated_briefs` table (status: draft → reviewed → published / rejected)
- ✅ `analystBriefGenerator` writes drafts only; never auto-publishes
- ✅ `/briefs` (public) + `/briefs/:slug` + `/scoop-ops/briefs` (review queue)
- ✅ `user_watchlists` + per-user push subscriptions
- ✅ `/dashboard` for "my watchlist" view

## Phase 5 — Markets, macro, geo, sport, entertainment

- ✅ `/finance` terminal (movers + sectors + truth-gap + briefs)
- ✅ `/macro` + FRED + World Bank ingesters (FRED needs key; WB no key)
- ✅ `/world-map` vanilla SVG equirectangular (no react-simple-maps dep)
- ✅ Geo ingesters: USGS earthquakes (verified live), NOAA alerts (verified live), ACLED (key-gated)
- ✅ Sports ingester (TheSportsDB free tier, key=3)
- ✅ Entertainment ingester (TMDB, key-gated)
- ✅ 6 category alias pages: `/health` `/climate` `/sports` `/crypto` `/ai` `/space` (Phase 7 A1)
- ⏭️ Per-entity detail pages (`/finance/ticker/:symbol`, `/sports/:league`) — deferred (A5)

## Phase 6 — Synthetic markets

- ✅ Polymarket-style constant-product AMM (mint complete sets + swap)
  - Slippage verified: $10 YES at 50/50 → 19.09 shares, avg $0.524
- ✅ `synthetic_markets` + `synthetic_market_trades` + atomic resolver
- ✅ Brier scoring → `user_reputation` + `agent_reputation` (same transaction)
- ✅ 3 AI persona traders (skeptic / optimist / contrarian), 6h cooldown per (agent, market)
- ✅ `/synthetic` browse + `/synthetic/:id` trade UI
- ✅ `/leaderboard` (Humans / AI Agents tabs, smoothed reputation)

### Phase 6.5 — outcome resolution (drafts only)

- ✅ LLM-driven outcome proposer writes to `synthetic_markets.meta`
- ✅ `/scoop-ops/synthetic` editor review queue (manual confirm)
- ✅ Per-agent Brier tracking + `/leaderboard` AI tab

## Phase 7 — Open it up

- ✅ Public read-only API at `/api/v1/*` with key auth + per-tier rate limits
  - Tiers: free 60 RPM / pro 600 RPM / enterprise 6000 RPM
  - `RateLimit-*` + `X-RateLimit-Tier` headers
  - Admin: `/scoop-ops/ri-ops/api-keys/*`
- ✅ iframe embeds: `/embed/event/:slug` + `/embed/market/:id` (frame-ancestors *)
- ✅ i18n via no-deps `useT()` hook + lazy JSON dicts
  - 10 languages live: en / ur / es / ar / fr / de / pt / hi / zh / ja
- ✅ Playwright e2e smoke (11 specs passing, backend-data-independent)
- ✅ Brief calibration tracker (Z) — per-category approval rates surfaced on `/scoop-ops/reality-index`
  - Auto-publication gate stays disabled until ≥100 decided briefs AND ≥70% approval per category
- ✅ Category alias pages (A1) — `/health` `/climate` `/sports` `/crypto` `/ai` `/space`
- ✅ Standalone `/timeline/:slug` (A2) — focused chronological view
- ✅ Two new chart components (A3, vanilla SVG, no chart-lib dep)
  - `SectorHeatmap` (squarified treemap) → FinancePage
  - `SankeyNarrative` (two-column flow) → AnalysisPage "Story Flow"
- ✅ Global density toggle (A4) — Comfortable ↔ Compact "Pro" mode persisted via Zustand
- ⏭️ Storybook — skipped (heavy install footprint, low marginal value vs. Playwright)
- ⏭️ Per-entity detail pages (A5) — deferred

---

## Operational notes

- **Deploy:** push to `origin/main` → Hostinger auto-deploys
- **Schema migrations:** all in `backend/src/realityIndex/schema.js`, idempotent (CREATE IF NOT EXISTS + per-column ALTER guards)
- **Scheduler status:** `GET /api/health` for run-lock + last-run state; `/scoop-ops/reality-index` for full pipeline dashboard
- **Admin gate:** `ADMIN_KEY` env var protects `/scoop-ops/*`
- **Tests:**
  - `cd frontend && npm run test:e2e` — Playwright smoke on key routes
  - `cd backend && node scripts/test-reality-index.js` — pipeline smoke
- **Cost ceiling today:** $0/mo on free tiers (Cerebras + Cloudflare embeddings + free APIs)
  - FRED, ACLED, TMDB are key-gated but free; skip the ingester or bring a key

## What's intentionally NOT done

- **Auto-publication of briefs.** Stays manual until per-category approval-rate calibration data clears the §5J threshold (100 decided + 70% approved). Z gives us the measurement; the gate logic lives in the future.
- **Per-entity detail pages (`/finance/ticker/:symbol`, `/sports/:league`).** Deferred — the aggregate views (`/finance`, `/sports`) cover the 80% case.
- **Postgres cutover.** SQLite + sqlite-vec is fine to >10M rows. The vectorStore DAL keeps the door open.
