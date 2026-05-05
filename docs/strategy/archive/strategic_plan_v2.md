# Scoopfeeds Strategic Plan v2.0
## One Event Graph. Two Layers. Three Revenue Streams.

**Document type:** Strategic north-star
**Version:** 2.0 (supersedes v1.0)
**Owner:** DrJ (Founder)
**Review cadence:** Quarterly
**Last updated:** May 2026

---

## 1. The Vision

Scoopfeeds is **one event graph powering two reader experiences and three revenue streams.** A shared data spine ingests, clusters, enriches, and analyzes global events. Two distinct surfaces present that data at different depths to two different audiences. Three revenue streams compound on a single cost base.

### The architectural principle

**One event graph. Two presentation layers. Three monetization streams.**

This is the principle that makes a two-tier ambition feasible for a small team. The same ingestion pipeline, dedup logic, enrichment workers, and Reality Index calculations feed both layers. Cost is amortized across audiences. Layer 1 generates traffic, brand, and ad revenue. Layer 2 generates subscription and API revenue. Each layer makes the other better: Layer 1's scale validates Layer 2's data quality publicly; Layer 2's depth gives Layer 1 stories portals cannot match.

### The two layers

**Layer 1 — The Newsroom.** A fast, mobile-first, broadly accessible news and event-tracking platform serving ordinary readers. The bar is Yahoo News and Al Jazeera English: clean topic feeds, reliable breaking news, regional depth, video coverage, distinctive editorial voice, strong newsletter products. Free, ad-supported, SEO-driven, optimized for daily use. South Asian and Muslim-world coverage is a genuine differentiator — the lens through which Scoopfeeds covers stories Western platforms underweight.

**Layer 2 — The Intelligence Desk.** A research-grade analytical workstation serving journalists, policy researchers, intelligence analysts, traders, and academics. The bar is Bloomberg Terminal and Reuters Eikon, scaled for non-financial events: Reality Index dashboards, full Event Dossiers with source triangulation, anomaly alerts, watchlists, source credibility scoring, historical archive, advanced semantic search, programmatic API access, embeddable widgets, AI briefs with human review. Subscription-priced for individuals; tiered API access for institutions.

### The bridge

Every event exists in both layers. Layer 1 readers see a clean, well-told story. Layer 2 subscribers see the full dossier behind it — timeline, actors, map, sentiment, sources, probability signals, anomaly flags, related events. The "Read more in Intelligence Desk" CTA on Layer 1 is the conversion funnel. Stories are not written twice; they are *projected* twice from the same underlying event graph.

### The positioning sentence

**"Read the news. Track the events. Decode the signals."**

This captures the user's escalating journey through the platform — and tells partners, investors, and users that Scoopfeeds serves all three modes of engagement.

### The honest comparison set

| Surface | Aspirational peers | What we take from them |
|---|---|---|
| **Layer 1** | Yahoo News, Al Jazeera English, Reuters.com, BBC News, Google News | Speed, breadth, mobile-first UX, regional voice, newsletter discipline |
| **Layer 2** | Bloomberg Terminal, Reuters Eikon, FT Pro, Stratfor, Crisis Group, GZERO Media | Depth, methodology, real-time analytics, premium credibility, professional density |
| **Bridge** | Reuters Connect, AP wire, AlphaSense | Programmatic distribution, API economy, machine-readable intelligence |

### What Scoopfeeds is *not*

It is not a portal. The current site has portal genetics (cars, magazine modules, X feed widgets) that must be killed even though the broader categories (video, regional, topic) remain. It is not a Bloomberg replica — Bloomberg owns finance and we are not entering finance head-on. It is not Polymarket — prediction signals are inputs, not the product. It is not a wire service — we synthesize and analyze, we do not break stories first.

---

## 2. Where We Stand (Honest Assessment)

Scoopfeeds today is a feature-rich monolith with strong architectural ambition but weak operational discipline. The backend has been substantially hardened in code (admin auth, web/scheduler/worker separation, Redis/BullMQ foundation, Postgres planning) but most of that work has not yet reached production. The frontend has not been touched by any modernization phase and presents as a generic news portal.

The biggest leverage point is not technical. It is positioning. Once the production deployment is fixed and the homepage is restructured around the two-layer model, every other piece of work becomes additive rather than corrective.

**Assets:** Reality Index architecture, multi-source ingestion, public API and embed scaffolding, multilingual base, founder domain expertise, regional access advantage.

**Liabilities:** Production runs old architecture; homepage signals "portal"; corpus skews Pakistan-heavy; search is keyword-only; dedup is fragile; no metrics defined; no editorial layer.

**Single biggest risk to the vision:** scope creep. With two audiences to serve, the temptation to add features will be doubled. The kill list (Section 6) and the one-sentence tests (Appendix B) exist to enforce discipline.

---

## 3. The Data Spine (Shared Infrastructure)

The data spine has four core capabilities. Both layers consume these capabilities at different depths. Engineering work primarily improves the spine; layer-specific work primarily presents the spine.

### Capability 1 — Live Event Stream
Ingestion → clustering → dedup → ranking. Articles flow in from RSS, GDELT, Polymarket, USGS, NOAA, ACLED, FRED, World Bank, SportsDB, TMDB, and YouTube. They are clustered into events using semantic similarity, deduplicated using hybrid scoring, and ranked by signal strength.

*Layer 1 sees:* the top 5–10 events, simply presented.
*Layer 2 sees:* the full event stream with filters, severity scoring, source provenance, and real-time updates.

### Capability 2 — Event Dossier
Synthesis → enrichment → presentation. Each event accumulates a timeline, actors (people/orgs/places), geographic map, sentiment delta across source perspectives, AI brief, related events, and source triangulation showing what wire services, regional outlets, and primary data say.

*Layer 1 sees:* a clean article-style page with the most important elements (timeline, brief, related coverage).
*Layer 2 sees:* the full dossier — every source, every actor, full timeline graph, sentiment matrix, downloadable data, citation export.

### Capability 3 — Reality Index
Probability → anomaly → truth-gap → confidence. Prediction-market signals from Polymarket are matched to events. Anomaly detection flags unusual signal patterns. Truth-gap analysis surfaces what sources agree or disagree on. Confidence scoring quantifies methodology certainty.

*Layer 1 sees:* a single "Signal of the day" tile and a stripped-down probability indicator on event cards. Teasers, not the full surface.
*Layer 2 sees:* the full Reality Index dashboard — probability movement, anomaly feed, truth-gap matrix, watchlist alerts, historical archive.

### Capability 4 — Intelligence API
Programmatic access. Same data, different output. Webhook subscriptions, REST endpoints, GraphQL queries, embed widgets, RSS feeds for power users.

*Layer 1 contribution:* RSS feeds, basic JSON endpoints (free tier).
*Layer 2 contribution:* full API with rate-limited paid tiers, webhook subscriptions, embed catalog, institutional licensing.

These four capabilities are the *engineering investment*. The two layers are the *product investment*. Confusing the two is the most common strategic mistake at this scale.

---

## 4. Layer 1 — The Newsroom

### Audience
Ordinary news readers globally, with strength in South Asia, Middle East, and broader Muslim-world readership. Mobile-first. Multilingual (English first, Urdu second, Arabic later). Time-pressed but curious. Reads on phone in commute, evening, before bed.

### Surfaces
- **Homepage:** Top events strip, breaking news, regional cluster, video module, newsletter signup, trending topics. Prioritized for scanability and time-on-site.
- **Topic pages:** Politics, World, Business, Science, Health, Sports, Tech. Each is a curated feed of events plus articles.
- **Regional pages:** South Asia, Middle East, Africa, Europe, Americas, East Asia. Genuine regional voice, not just geo-filtered headlines.
- **Event pages (Layer 1 view):** Clean, article-style presentation with timeline, brief, related coverage, "Read full dossier" CTA.
- **Video page:** Curated news video, magazine-format explainers.
- **Search:** Fast, fuzzy, recency-weighted.
- **Newsletter products:** Daily Brief (morning), Regional Brief (weekly), Topic Briefs (weekly).
- **Mobile experience:** Native feel in the browser; PWA-installable; bottom nav; offline reading.

### Design principles
- Speed over density. Layer 1 must feel fast on a 3G connection in Karachi or Lagos.
- Scanability over depth. Every card answers "what happened?" in 5 seconds.
- Warmth without clutter. Editorial voice present, but no portal-style noise.
- Mobile-first, not mobile-also. Design starts at 375px width.
- Accessibility minimum: WCAG 2.1 AA.
- RTL-correct for Urdu (and Arabic when added).

### What's distinctive
- South Asian and Muslim-world coverage as a genuine voice, not a parochial focus.
- Intelligence spine underneath: every event has more depth one click away.
- Reality Index teasers: every event card carries a probability or anomaly signal that hints at the deeper layer.
- Multilingual from day one in English and Urdu.

### Monetization
Display advertising (programmatic + select direct), free newsletter subscriptions (the conversion funnel into Layer 2), affiliate revenue on relevant categories (positioned tastefully, not on the homepage).

### Domain
`scoopfeeds.com` — the primary domain, the front door for organic search and direct visits.

---

## 5. Layer 2 — The Intelligence Desk

### Audience
Journalists at regional and international outlets needing research artifacts they can cite. Policy researchers at think tanks, universities, NGOs. Intelligence analysts at corporates, governments, and consultancies. Traders covering geopolitical and commodity exposure. Academics in international relations, political economy, public health. Developers integrating intelligence into their own products.

### Surfaces
- **Reality Index dashboard:** Real-time probability movements, anomaly feed, truth-gap matrix, market-implied sentiment.
- **Event Dossier (Layer 2 view):** Full dossier with all sources, actors, timeline graph, sentiment matrix, downloadable data, citation export, related events, watchlist toggle.
- **Watchlists and alerts:** User-defined event tracking with email/webhook notifications on signal changes.
- **Anomaly feed:** Curated stream of unusual patterns — source divergence, market disagreement, sudden coverage spikes.
- **Source credibility ledger:** Public methodology, per-source reliability scoring, correction tracking.
- **Advanced search:** Entity search (people, places, orgs), semantic search, faceted filters, date-range, source-type.
- **Historical archive:** Searchable archive of past events, dossiers, and Reality Index snapshots.
- **API console:** Developer dashboard, key management, rate limits, usage analytics.
- **Embed catalog:** Pre-built widgets (event card, Reality Index strip, anomaly band) with copy-paste integration.
- **Methodology documentation:** Open documentation of how events are clustered, signals scored, and briefs reviewed.

### Design principles
- Density over speed (within reason). Layer 2 users expect Bloomberg-like information density.
- Real-time first. Updates push to dashboard without page refresh.
- Professional palette. Less warmth, more clarity. Reduced motion. Keyboard shortcuts.
- Citation-ready. Every dossier has export options (PDF, JSON, citation formats).
- Methodology transparency. Signals show their derivation; users trust what they understand.
- Desktop-primary, mobile-secondary. Layer 2 is used at a desk; mobile is for alerts.

### What's distinctive
- The only platform applying Bloomberg-style intelligence layering to non-financial events at scale.
- AI briefs human-reviewed before publication on the premium tier.
- Reality Index methodology is open and citable — academic credibility.
- API and embed economy from day one.
- Regional event coverage that Western platforms underweight.

### Monetization
Premium subscription (~$15-30/month for individual; ~$50-100/month for professional with API access; institutional licensing for teams). Tiered API pricing (free → paid → enterprise). Embed licensing for newsrooms (free for attribution; paid for white-label).

### Domain
`intel.scoopfeeds.com` (recommended) or `scoopfeeds.com/intelligence` — visually and architecturally distinct from Layer 1, recognizably the same brand family.

---

## 6. The Bridge (How the Layers Connect)

The bridge is the most important strategic surface in the platform. It is what turns a free reader into a premium subscriber, and it is what makes Layer 1 different from generic news portals.

### Conversion mechanics
Every Layer 1 event page contains a "Read full dossier in Intelligence Desk" CTA. Every Reality Index teaser on Layer 1 links to the full dashboard with a soft paywall (first three views free, then sign-up required, then subscription). Every newsletter contains one premium-only insight per issue, marked clearly. Every search result on Layer 1 shows premium-tier filters greyed out with "Available in Intelligence Desk" labels.

### Quality compounds
The shared event graph means improvements to the data spine lift both layers. A better dedup algorithm makes Layer 1 cleaner *and* Layer 2 more trustworthy. A new entity extractor adds entity pages on Layer 1 *and* faceted search on Layer 2. This is why the data spine (Section 3) is the engineering priority.

### Cross-layer SEO
Layer 2 is not aggressively crawled (premium content). Layer 1 carries the SEO weight, ranking for breaking-event queries, regional coverage, and topic depth. The bridge from Layer 1 to Layer 2 is editorial and product-driven, not SEO-driven.

### Brand coherence
Both layers share: logo, color system, typography family, voice principles, accessibility commitments. Both layers differ in: information density, palette emphasis, motion design, navigation patterns, default page layouts. Like Bloomberg.com vs Bloomberg Terminal — recognizably the same family, clearly different rooms.

---

## 7. The Kill List (Refined for Two-Tier Model)

A two-tier model does not mean keeping everything. The discipline is to kill what signals "portal" and keep what serves the layers.

| Module / pattern | Decision | Rationale |
|---|---|---|
| Cars section | **Kill** | Off-strategy. Not intelligence. Not news. |
| Generic magazine modules on homepage | **Kill** | Portal clutter. Replace with curated regional or topic features. |
| X feed widget on homepage | **Kill** | Off-brand. Use X as a Layer 2 source, not a Layer 1 surface. |
| Tip jar widget | **Move to footer** | Premature monetization signal on key pages. |
| Affiliate widgets on homepage | **Kill or move below fold** | Erodes credibility above the fold. |
| `LiveTVChannelEmbed` (dead component) | **Delete** | Already dead in code. |
| Generic "most read" article sidebar | **Replace** | Becomes "Top tracked events" on Layer 1. |
| Video coverage | **Keep, redesign** | Returns as Layer 1 furniture done well, not as a clutter module. |
| Regional pages | **Keep, deepen** | Core Layer 1 differentiator. Invest. |
| Topic feeds | **Keep, restructure** | Core Layer 1 furniture. Move from article-centric to event-centric. |
| Newsletter products | **Keep, expand** | Critical conversion funnel. Three products by Phase B exit. |
| Breaking news banner | **Keep, smarten** | Triggered by signal strength, not editorial whim. |
| Live TV section | **Move to dedicated route** | Off homepage; reframe as live-event coverage hub if kept. |

The principle: portal *clutter* dies; category *furniture* stays and gets done well.

---

## 8. Success Metrics

### Data spine metrics (engineering health)
- Events tracked simultaneously: target 500+ active events
- Source diversity index: no single source >10% of corpus, ≥6 regions covered daily, ≥3 source types
- Time-to-first-cluster: new event identified and dossier created within 30 minutes
- Dedup accuracy: <5% false-positive on cross-source verification
- Brief accuracy: ≥90% factual accuracy on weekly human audit

### Layer 1 metrics (Newsroom)
- Daily active users (DAU): baseline by Phase B exit; target trajectory thereafter
- Returning user rate (7-day): ≥35% by Phase C exit
- Average session depth: ≥3 events per session for returning users
- Newsletter open rate: ≥35% (industry benchmark 22%)
- Newsletter subscribers: ≥10,000 by Phase C exit
- Mobile Lighthouse score: ≥90 on all key pages
- Time-on-site (returning users): ≥4 minutes

### Layer 2 metrics (Intelligence Desk)
- Premium subscribers: ≥500 within 12 months at $15-30/month tier
- API consumers (active): ≥10 within 6 months of Layer 2 launch
- Embed installs: ≥50 within 12 months of Layer 2 launch
- Premium retention (90-day): ≥80%
- Layer 2 DAU / Premium subs: ≥40% (means people are using what they pay for)
- Reality Index DAU as share of Layer 2 DAU: ≥60%
- Average Layer 1 → Layer 2 conversion rate: ≥1% of Layer 1 returning users

### Operational metrics
- Production uptime: ≥99.5% on web tier
- Scheduler last-run age: ≤15 minutes 99% of the time
- Failed BullMQ job rate: <1% over 24-hour rolling window
- AI inference cost per event: tracked and trending down
- Support ticket response time (premium): <24 hours

---

## 9. Phased Roadmap

The Claude Code plan describes the *tactical* work. This roadmap describes the *strategic* phases. Tactical items map to strategic phases via Appendix A.

### Phase A — Stabilize (Now → 4 weeks)
**Strategic goal:** Production runs the new architecture. Backend hardening reaches production. Hollow features fill in. Foundation is sound enough to redesign on top of.

**Layer focus:** Foundation only. Both layers benefit.

**Work:** Step 0 worktree sync, all P0 items, P1 items 1-7, P3 hygiene. Define and instrument the first 5 success metrics.

**Exit criteria:**
- Scheduler running in production; `lastRun` always within 15 minutes
- Admin auth secured everywhere (including `ri-ops.js`)
- Urdu RTL working
- All hollow features populating with data within 6 hours of restart
- 5 metrics being captured (even if values are baseline-poor)

### Phase B — Launch Layer 1 (Months 1–3)
**Strategic goal:** Scoopfeeds stops looking like a portal and starts looking like a credible news platform with intelligence underneath. Layer 1 is launched as a coherent product with the kill list executed.

**Layer focus:** Layer 1 primary. Layer 2 elements (Reality Index teasers, Event Dossier deep links) appear as conversion hooks.

**Work:**
- Execute the kill list
- Mobile-first homepage redesign with the new pillar layout (Reality Index strip, top events, anomalies band, breaking news, regional, topic feeds)
- Mobile-first Event Dossier (Layer 1 view) with timeline, brief, related, "Full dossier" CTA
- Topic and regional pages restructured around events, not just articles
- Three newsletter products launched (Daily Brief, Regional Brief, Topic Briefs)
- Accessibility audit and remediation (WCAG 2.1 AA)
- New tagline and positioning copy across the site
- SEO audit and structured-data implementation
- First 5 BullMQ migrations from the Claude Code plan

**Exit criteria:**
- Homepage above the fold contains only intelligence and news content (no cars, magazine modules, off-brand widgets)
- Mobile Lighthouse score ≥90 on homepage and Event Dossier
- All three newsletter products live with ≥30% open rates
- Returning user rate (7-day) ≥25% (will rise toward 35% in Phase C)
- Reality Index "Signal of the day" visible on homepage
- Brand and positioning sentence consistently applied

### Phase C — Deepen the Data Spine (Months 3–5)
**Strategic goal:** The data spine becomes good enough to support a premium product. Search, dedup, source diversity, entity extraction, and credibility scoring all reach the threshold needed for Layer 2 launch.

**Layer focus:** Foundation work that benefits both layers; sets up Layer 2 launch.

**Work:**
- Entity extraction + entity pages (people, places, organizations)
- Semantic search with hybrid BM25 + cosine scoring
- Semantic dedup using sqlite-vec embeddings
- Source diversity caps + ≥10 new non-South-Asian sources
- Source credibility scoring (public methodology)
- "Why this matters" and "What changed in 24h" briefs as default
- Watchlist and alert system on data spine (Layer 2 surface comes in Phase D)
- Remaining BullMQ migrations from the Claude Code plan
- CSP enabled in production

**Exit criteria:**
- Event Dossier has ≥4 sources, timeline, map, sentiment, brief for ≥80% of active events
- Search supports entity, semantic, and faceted queries
- Source diversity index meets target (no source >10%, ≥6 regions)
- Source credibility scores published and updated weekly
- Brief accuracy audit: ≥90%
- Layer 1 returning user rate ≥35%

### Phase D — Launch Layer 2 (Months 5–8)
**Strategic goal:** The Intelligence Desk launches as a distinct premium surface. The first revenue stream beyond ads is live. Conversion funnel from Layer 1 is operational.

**Layer focus:** Layer 2 launch.

**Work:**
- `intel.scoopfeeds.com` (or chosen URL) launches with Reality Index dashboard
- Full Event Dossier (Layer 2 view) with all sources, actors, sentiment matrix, exports
- Watchlist + alert system surfaced as core feature
- Anomaly feed as primary engagement surface
- Search advanced features (entity, semantic, faceted) with paywall on Layer 1
- Historical archive (≥6 months of past events)
- Premium subscription tier launched ($15-30/month individual)
- API v2 with three tiers (free, paid, enterprise)
- Embed catalog launched (event card, Reality Index strip, anomaly band)
- Stripe integration, billing, account management
- Methodology documentation published
- First 3-5 partner outreach conversations (newsrooms, research orgs)

**Exit criteria:**
- Layer 2 live with at least 3 distinct surfaces (Reality Index, Event Dossier, Watchlists)
- ≥100 premium subscribers
- ≥3 active API consumers
- ≥10 embed installs
- Layer 1 → Layer 2 conversion rate measurable
- Premium retention (30-day) ≥85%

### Phase E — Expand (Months 8–12)
**Strategic goal:** The platform compounds. Editorial layer adds defensibility. Mobile native app extends reach. Premium tier scales. AgentX integration explored as adjacent revenue.

**Layer focus:** Both layers deepen; new surfaces added selectively.

**Work:**
- Editorial layer: 1-2 part-time editors reviewing premium briefs and curating Layer 1 features
- Mobile native app (iOS first, Android second) — read-only, alerts-first, optimized for breaking news and Reality Index alerts
- Arabic language added to multilingual stack
- Institutional licensing tier launched (teams, $50-100/seat/month)
- Newsletter sponsorships activated as revenue
- Partnership with 1-2 universities or think tanks for credibility and data exchange
- AgentX integration: Scoopfeeds events as a data source for AgentX agents (DrJ's other platform)
- Postgres migration *if and only if* SQLite has become the binding constraint
- Sponsored intelligence briefs as occasional revenue (clearly labeled, editorially separated)

**Exit criteria:**
- ≥500 premium subscribers
- ≥10 active API consumers
- ≥50 embed installs
- Editorial review process operational with documented standards
- Mobile native app live with ≥10,000 downloads
- All success metrics from Section 8 met or exceeded
- Platform self-sustaining or growth-funded

---

## 10. Strategic Decisions Required

These decisions only the founder can make. They cascade into every subsequent phase.

1. **URL strategy.** `intel.scoopfeeds.com` (subdomain — cleaner separation, easier auth) or `scoopfeeds.com/intelligence` (path — easier SEO continuity, simpler infra). Recommendation: **subdomain.** Decision: ___

2. **Premium pricing.** $15/month (volume play), $25/month (positioning play), $30/month (premium signal). Annual option at 20% discount. Recommendation: **start at $19/month with annual at $190 ($16/month effective).** Adjust after first 100 subscribers based on price-elasticity feedback. Decision: ___

3. **Revenue stream sequencing within Phase D.** Subscription first, API second, institutional third? Or all three at once? Recommendation: **subscription first (week 1 of Phase D launch), API tiered launch in week 4, institutional after first 100 subscribers prove the model.** Decision: ___

4. **Editorial layer commitment.** Are you willing to retain 1-2 part-time editors in Phase E? Cost is meaningful (~$2-4K/month) but defensibility gains are significant. Recommendation: **yes, but only after ≥300 premium subscribers prove the revenue case.** Decision: ___

5. **AgentX integration depth.** Does Scoopfeeds become an *AgentX data source* (loose coupling, data-only), an *AgentX agent host* (Scoopfeeds events trigger AgentX agents), or stay independent until both platforms mature? Recommendation: **loose coupling in Phase E — Scoopfeeds publishes event signals via API; AgentX consumes them.** No tight coupling until both platforms have ≥1,000 users. Decision: ___

6. **Multilingual sequencing.** English + Urdu in Layer 1 from Phase B. Arabic in Phase E. Hindi, Indonesian, Bahasa, Persian later? Recommendation: **English + Urdu through Phase D. Arabic in Phase E. Others only if a specific market opportunity emerges.** Decision: ___

7. **Open-source posture for Reality Index methodology.** Methodology fully open (academic credibility play) vs methodology summarized but weights/models proprietary (competitive moat play). Recommendation: **methodology open and citable; weights, models, and source-credibility scores proprietary.** Decision: ___

8. **Mobile native app timing.** Phase E (recommended) or earlier? Recommendation: **Phase E.** A PWA in Phase B carries 80% of the value at 5% of the cost. Native app is for alerts-first power users post-traction. Decision: ___

9. **Brand identity refresh.** Current "Scoopfeeds — Intelligent news, curated" is generic. New positioning suggests refreshed visual identity. Recommendation: **refresh in Phase B alongside homepage redesign.** Logo can stay; color system, typography, and voice need work. Decision: ___

10. **Postgres timing.** Defer until SQLite shows binding constraints. Recommendation: **kill the Postgres conversation for Phase A-D. Revisit only if write contention or full-text search performance forces the migration in Phase E.** Decision: ___

---

## 11. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Single-developer bottleneck** (DrJ + AI agents only) | High | Critical | Heavy reliance on Claude Code with structured handoff documents. Hire 1 part-time engineer in Phase D once revenue starts. |
| **Brand confusion between layers** | Medium | High | Distinct URL (subdomain). Visually differentiated UIs. Consistent brand family. Clear copy: "Read in Newsroom / Research in Intelligence Desk." |
| **Editorial cost for Layer 1 quality** | Medium | High | AI does 90% of synthesis; humans review the 10% that gets prominent placement. Scale editorial only after revenue justifies. |
| **AI brief accuracy failures** (one bad brief = credibility damage) | Medium | Critical | Layer 2 briefs human-reviewed before publication. Layer 1 briefs labeled clearly as AI-generated. Weekly accuracy audits with corrections published. |
| **Scope creep returning to portal patterns** | High | High | This document. Kill list. One-sentence tests in Appendix B. Reject any feature that doesn't map to a layer + capability. |
| **Conversion funnel underperforms** (Layer 1 → Layer 2 < 1%) | Medium | High | A/B test paywall mechanics. Adjust premium-tease intensity. Worst case: shift to "freemium" model where some Layer 2 features are free with rate limits. |
| **Competitive entry** (a Moltbook-like player or Reuters pivots into events) | Medium | High | Move fast on Phase B. Reality Index methodology open and citable as moat. Build API consumer lock-in early. |
| **Source legal exposure** (RSS reproduction, fair use) | Medium | High | Brief excerpts only with strong attribution. Legal review before Phase D. Premium tier may need licensing deals with key wire services. |
| **Cost runaway on AI inference** | Medium | Medium | Local model routing for low-stakes work (pattern from ARIA). Cost dashboards from Phase A. Cerebras / DeepSeek for batch enrichment, GPT-class only for premium briefs. |
| **Hostinger / infrastructure limits** | Medium | Medium | Containerization plan exists. Migration path to Fly.io / Railway / Render documented. Trigger: any single-process memory limit or scheduler instability. |
| **Geopolitical content risk** (covering sensitive South Asia / Middle East from Pakistan) | Low | High | Editorial guidelines documented. Multiple-source requirement for sensitive events. No partisan framing. Disclosed methodology. |
| **Codex / AI agent execution drift** (already happened once with deploys) | High | High | Mandatory deploy-verification step in every phase. Post-merge production smoke tests. Automated `/api/health` checks in CI. |
| **DrJ-time conflict with AgentX, ARIA, civil service role** | High | High | Phases scoped for realistic velocity (months, not weeks). Claude Code handles execution; DrJ handles strategy and review. Calendar block for Scoopfeeds review. |

---

## 12. How to Use This Document

This document is the source of truth for "is this on strategy?" Every subsequent decision runs through it.

**Before adding any feature, ask:**
- Which layer does this serve? (1, 2, both, or bridge?)
- Which data-spine capability does it use or improve?
- Which audience benefits?
- Which success metric will it move?
- If none of the above, kill it.

**Before approving any code change, ask:**
- Which strategic phase is this in?
- Which exit criterion does it contribute to?
- Is there a deploy-verification step?

**Before each phase kicks off:**
- Re-read Section 1 (vision) and Section 8 (metrics)
- Confirm prior phase exit criteria are met
- Update Section 10 (decisions) if any have shifted
- Reassess Section 11 (risks)

**Quarterly review:**
- Score against Section 8 metrics
- Update the risk register
- Reaffirm or revise the kill list (Section 7)
- Update the decisions log (Section 10)
- Bump document version if structural changes

**This document is a compass, not a contract.** When the world changes — a competitor pivots, a metric surprises, an audience signals differently — the document updates. But every update is deliberate, written, and dated. Silent drift is the enemy.

---

## Appendix A — Mapping Tactical Plans to Strategic Phases

| Tactical Item (Claude Code plan) | Strategic Phase | Layer / Capability Served |
|---|---|---|
| Step 0 (worktree sync) | Phase A | Foundation |
| P0-1 to P0-6 (stop-the-bleeding) | Phase A | Foundation |
| P1-1 to P1-7 (debt) | Phase A | Foundation |
| P2-1 (homepage redesign — *expanded*) | Phase B | Layer 1 + Bridge |
| P2-2 (search overhaul) Stage 1-2 | Phase B/C | Both layers |
| P2-2 (search overhaul) Stage 3-4 | Phase D | Layer 2 |
| P2-3 (semantic dedup) | Phase C | Capability 1 |
| P2-4 (source diversity) | Phase C | Capability 1 |
| P2-5 (Reality Index home) | Phase B + D | Bridge → Layer 2 |
| P3-1 to P3-5 (hygiene) | Phase A | Foundation |
| Newsletter products (3 launches) | Phase B | Layer 1 |
| Mobile-first redesign | Phase B | Layer 1 |
| Accessibility audit | Phase B | Both layers |
| Entity extraction + pages | Phase C | Capability 2 |
| Source credibility scoring | Phase C | Capability 2 |
| Premium subscription launch | Phase D | Layer 2 |
| API v2 + tiered access | Phase D | Capability 4 |
| Embed catalog | Phase D | Capability 4 |
| Editorial layer | Phase E | Layer 2 |
| Mobile native app | Phase E | Both layers |
| Arabic language support | Phase E | Layer 1 |
| AgentX integration | Phase E | Capability 4 |
| Postgres migration (only if needed) | Phase E | Foundation |

---

## Appendix B — One-Sentence Tests

When in doubt, run any decision through these. If it doesn't pass at least one, it's probably not on strategy.

**For features and surfaces:**
- *"Does this serve Layer 1, Layer 2, both, or the bridge?"* If none, kill it.
- *"Could this run on the homepage of a generic portal?"* If yes, pause and reconsider.
- *"Would a Yahoo News reader find this useful?"* (Layer 1 test.)
- *"Would a Bloomberg Terminal user find this useful?"* (Layer 2 test — adapted for events not finance.)
- *"Would a journalist cite this in their reporting?"* (Layer 2 quality test.)
- *"Would a developer pay for this via API?"* (Capability 4 test.)
- *"Does this make returning users come back?"* (Engagement test.)

**For editorial decisions:**
- *"Is this fact-checked enough to publish under the Scoopfeeds name?"*
- *"Could a competitor reproduce this in a week?"* If yes, where's the moat?
- *"Would I bet my reputation on this brief?"* If no, don't publish.

**For engineering decisions:**
- *"Is this a data-spine improvement or a layer-specific feature?"* Spine improvements should be prioritized.
- *"Will this still matter when we have 10x the events?"*
- *"Does this make the deploy more or less risky?"*

**For monetization:**
- *"Is this revenue stream serving the right audience for this layer?"*
- *"Would a premium user feel the price is fair for what they get?"*
- *"Does this revenue source compromise editorial credibility?"*

---

## Appendix C — Comparison Set (Detailed)

### Layer 1 peers — what to study and steal

**Yahoo News.** Strength: scale, breadth, mobile UX. Weakness: portal clutter, no distinctive voice, ad-saturated. Steal: scanability, breaking news prominence. Avoid: clutter, generic feel.

**Al Jazeera English.** Strength: distinctive global voice, regional depth, editorial gravitas, video. Weakness: limited intelligence layer. Steal: voice, regional coverage, video integration. Avoid: any reduction in regional ambition.

**Reuters.com.** Strength: wire-grade reliability, depth, professional tone. Weakness: paywall maze. Steal: reliability signaling, professional voice. Avoid: confusing free/paid mix.

**BBC News.** Strength: clarity, mobile-first, accessibility, multilingual. Weakness: institutional voice. Steal: mobile UX, accessibility standards, multilingual discipline. Avoid: institutional blandness.

**Google News.** Strength: aggregation, personalization, freshness. Weakness: shallow, no synthesis. Steal: freshness, source diversity within an event. Avoid: shallow aggregation.

### Layer 2 peers — what to study and steal

**Bloomberg Terminal.** Strength: density, real-time, professional credibility, network effects (BBG message). Weakness: financial focus, $24K/year. Steal: density, real-time updates, methodology, professional palette. Avoid: pricing tier, finance-only focus.

**Reuters Eikon.** Strength: data integration, alerts, professional research tools. Weakness: complex UX, finance-centric. Steal: alerts surface, research tools, watchlist mechanics. Avoid: UX complexity.

**FT Pro.** Strength: editorial gravitas, premium positioning. Weakness: still finance-skewed. Steal: premium positioning, editorial review process. Avoid: opacity of methodology.

**Stratfor.** Strength: geopolitical analysis depth, subscription model. Weakness: small audience, slow. Steal: subscription model, methodology transparency. Avoid: slow publishing cadence.

**Crisis Group.** Strength: methodology, credibility, regional depth. Weakness: think-tank pace. Steal: methodology rigor, regional expertise framing. Avoid: institutional slowness.

**GZERO Media.** Strength: video, personality-driven analysis, AI integration. Weakness: limited analytical depth. Steal: video formats, personality framing. Avoid: shallow analysis.

**AlphaSense.** Strength: search-first interface, semantic search, enterprise SaaS model. Weakness: finance focus. Steal: search-first UX, enterprise sales motion. Avoid: finance-only positioning.

---

*End of document. v2.0.*
