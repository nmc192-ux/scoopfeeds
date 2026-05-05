# Scoopfeeds Strategic Plan v3.0
## One Event Graph. Two Layers. Three Revenue Streams. Comprehension at the Core.

**Document type:** Strategic north-star
**Version:** 3.0 (supersedes v2.0)
**Owner:** DrJ (Founder)
**Review cadence:** Quarterly
**Last updated:** May 2026

---

## 1. The Vision

Scoopfeeds is **one event graph powering two reader experiences and three revenue streams**, with **comprehension at the core**. A shared data spine ingests, clusters, enriches, tracks, and analyzes global events. Two distinct surfaces present that data at different depths to two different audiences. Three revenue streams compound on a single cost base. And every story includes the visual, quantitative, and analytical scaffolding that lets a reader actually understand what happened — not just read about it.

### The architectural principle

**One event graph. Two presentation layers. Three monetization streams. Every event has a Tracker.**

This is the principle that makes a two-tier ambition feasible for a small team while delivering genuinely differentiated value. The same ingestion pipeline, dedup logic, enrichment workers, and Reality Index calculations feed both layers. The same per-event quantitative tracker (casualties, hardware, prices, cases, flows — whatever the event needs) appears at every level of depth. Cost is amortized across audiences.

### The two layers

**Layer 1 — The Newsroom.** A fast, mobile-first, broadly accessible news and event-tracking platform serving ordinary readers. The bar is Yahoo News and Al Jazeera English, but with two upgrades they don't offer: every story has a quantitative tracker with infographics, and every event surfaces multiple perspectives (news, op-ed, video). Free, ad-supported, SEO-driven, optimized for daily use. South Asian and Muslim-world coverage is a genuine differentiator.

**Layer 2 — The Intelligence Desk.** A research-grade analytical workstation serving journalists, policy researchers, intelligence analysts, traders, and academics. The bar is Bloomberg Terminal and Reuters Eikon, scaled for non-financial events: multi-source prediction triangulation, full Event Dossiers with downloadable data, custom alert rules, watchlists, source credibility scoring, historical archive, advanced semantic search, programmatic API access. Subscription-priced for individuals; tiered API access for institutions.

### The bridge

Every event exists in both layers at different depths. Layer 1 readers see a clean story with a tracker, a brief, op-eds, and a video clip. Layer 2 subscribers see the full dossier — every source, every probability signal triangulated across networks, downloadable data behind every chart, custom alerts, sentiment matrix, citation export. The "Open in Intelligence Desk" CTA on Layer 1 is the conversion funnel. Stories are not written twice; they are *projected* twice from the same event graph.

### The positioning sentence

**"Read the news. See the data. Hear the perspectives. Decode the signals."**

Four verbs, four capabilities, one platform. Each verb maps to a strategic asset: news (Layer 1), data (trackers + infographics), perspectives (op-eds + video), signals (Reality Index).

### The honest comparison set

| Surface | Aspirational peers | What we take |
|---|---|---|
| **Layer 1 — News** | Yahoo News, Al Jazeera English, Reuters.com, BBC News | Speed, mobile UX, regional voice, newsletter discipline |
| **Layer 1 — Data viz** | The Economist, NYT Upshot, Reuters Graphics, FT Visual Journalism, Our World in Data, Visual Capitalist | Quantitative storytelling, chart literacy, methodology transparency |
| **Layer 1 — Perspectives** | AllSides, Ground News, The Browser, RealClearPolitics | Multi-perspective framing, ideological transparency |
| **Layer 1 — Video** | Reuters TV, Al Jazeera, AP video, broadcaster YouTube channels | Verified video integration, broadcast-grade clips |
| **Layer 2 — Intelligence** | Bloomberg Terminal, Reuters Eikon, FT Pro, Stratfor, Crisis Group, GZERO | Density, real-time, premium credibility, methodology rigor |
| **Layer 2 — Probability** | Metaculus, Good Judgment, Polymarket, Kalshi, PredictIt | Multi-source aggregation, calibration tracking, methodology disclosure |
| **Bridge** | Reuters Connect, AP wire, AlphaSense | Programmatic distribution, API economy, machine-readable intelligence |

---

## 2. Where We Stand (Honest Assessment)

Scoopfeeds today is a feature-rich monolith with strong architectural ambition but weak operational discipline. Backend hardening exists in code but has not reached production. Frontend has not been touched by any modernization phase. Critically, the platform has **no quantitative trackers, no breaking news alert engine, no op-ed aggregation, and a single-source prediction signal (Polymarket only)** — gaps the v3 vision specifically addresses.

**Assets:** Reality Index architecture, multi-source ingestion, public API and embed scaffolding, multilingual base, founder domain expertise, regional access advantage, YouTube ingestion already in stack (under-used).

**Liabilities:** Production runs old architecture; homepage signals "portal"; corpus skews Pakistan-heavy; search is keyword-only; dedup is fragile; no metrics defined; no editorial layer; **no quantitative tracker layer; no breaking news engine; single-source prediction; no op-ed aggregation; video ingestion exists but no verification or curation layer.**

**Single biggest leverage point:** The trackers + infographics layer. This is what turns Scoopfeeds from "another news site" into "the place you go to understand a story." Higher impact than any other single capability investment.

---

## 3. The Data Spine (Shared Infrastructure)

The data spine has four core capabilities, expanded in v3 to reflect the additions. Both layers consume these capabilities at different depths.

### Capability 1 — Live Event Stream + Breaking News Engine

Ingestion → clustering → dedup → ranking → **breaking-news signal detection → alert generation**.

Articles flow in from RSS, GDELT, Polymarket, Kalshi, USGS, NOAA, ACLED, FRED, World Bank, SportsDB, TMDB, YouTube, broadcaster RSS, and op-ed feeds. They are clustered into events using semantic similarity, deduplicated using hybrid scoring, and ranked by signal strength.

**Breaking news detection** is a new sub-capability. A story is "breaking" when (a) coverage volume spikes across diverse sources within a short window, (b) source-type diversity is high (wire + regional + social + primary data), (c) sentiment is high-magnitude, or (d) a watchlisted entity appears. The signal triggers alert generation.

**Alert generation** produces categorized alerts (politics, sports, business, regional, watchlist) with severity levels, routed to delivery channels via Capability 4.

*Layer 1 sees:* breaking news banner on homepage, web push notifications (opt-in), email alerts.
*Layer 2 sees:* full breaking-news feed, custom alert rules, webhook delivery, Slack/Teams integration.

### Capability 2 — Event Dossier (Comprehension Layer)

This is the most significantly expanded capability in v3. Every event accumulates:

- **Synthesis:** AI brief, "why this matters," "what changed in 24h"
- **Enrichment:** actors (people/orgs/places), timeline graph
- **Tracker (NEW):** a quantitative scorecard tied to the event type — casualty counts for conflicts, case counts for outbreaks, hardware loss for wars, tanker movements for maritime events, flight data for aviation events, vote tallies for elections, market indices for financial events. Each tracker is a curated dashboard pulling from authoritative sources (UN, WHO, ACLED, government statistics, established media data teams) with provenance and uncertainty marked.
- **Infographics (NEW):** maps, time series, comparisons, network graphs, flow diagrams — automatically generated where possible, hand-curated for major events. Every event has at least one infographic on Layer 1.
- **Perspectives (NEW):** aggregated op-eds from across the political/regional spectrum with author credibility scoring. Each perspective tagged with ideological lean, region, source credibility. Multi-source mapping ("here's how the left/right/wire/regional views this") becomes a primary engagement surface.
- **Video evidence (NEW):** verified video clips and shorts from broadcaster channels, official sources, and (carefully verified) citizen footage. Each clip labeled with source, verification status, and provenance.
- **Source triangulation:** who's reporting what, where they agree or disagree
- **Related events:** graph of connected events

*Layer 1 sees:* a clean story page with brief, tracker (1-2 key metrics), one infographic, 2-3 op-ed snippets across perspectives, one short video clip, "Open full dossier" CTA.
*Layer 2 sees:* full dossier — all sources, all op-eds with full text where licensed, full tracker with downloadable data, all videos, sentiment matrix, citation export, custom annotation.

### Capability 3 — Reality Index (Multi-Source Probability Triangulation)

This is meaningfully expanded in v3 to address the single-source bias risk.

**Probability inputs come from multiple independent sources:**
- **Polymarket:** crypto-native prediction market, US-event-heavy, high liquidity on certain topics
- **Kalshi:** CFTC-regulated US prediction market, more mainstream events
- **Metaculus:** forecasting community with public calibration track record, strong on long-tail and policy questions
- **Good Judgment Open:** academic forecasting tournaments, policy and geopolitics focus
- **PredictIt** (where still operating): smaller markets, political focus
- **Manifold Markets:** play-money but interesting for niche events
- **AI-generated estimates** (Claude, GPT-class models) with their own calibration tracked over time
- **Survey data and expert polls** where applicable
- **Bayesian updates from news flow** (internal model)

**Triangulation methodology:**
- Each source has a calibration score based on historical accuracy
- Signals are aggregated weighted by calibration
- **Divergence between sources is itself a signal** — large disagreement flags either a contested question or a market inefficiency, surfaced as an "Anomaly: Source Divergence" event
- Methodology is documented openly and citably; weights and models are proprietary
- A "primary source" can be selected by the user (default = aggregated) for transparency

**Other Reality Index capabilities (carried forward from v2):**
- Anomaly detection (coverage spikes, sentiment shifts, unusual patterns)
- Truth-gap analysis (where do sources agree/disagree?)
- Confidence scoring with calibration history

*Layer 1 sees:* a single aggregated probability shown on event cards as "Signal of the day" — stripped of complexity.
*Layer 2 sees:* full multi-source dashboard, per-source drilldown, divergence alerts, calibration histories, custom watchlists with probability triggers.

### Capability 4 — Intelligence Distribution

Programmatic access. Same data, different output. Now expanded to include alert delivery as a first-class function, not an afterthought.

- **REST API + GraphQL:** events, dossiers, trackers, probabilities — free tier, paid tier, enterprise tier
- **Alert delivery (NEW infrastructure):** web push (free), email (free), mobile push (Phase E), webhooks (paid), Slack/Teams integrations (paid), SMS for major alerts (paid)
- **Embed widgets:** event card, tracker widget, Reality Index strip, anomaly band, breaking news ticker, perspective comparison
- **RSS feeds:** topical, regional, watchlist-driven (free for basic, paid for custom)
- **Newsletter distribution:** Daily Brief, Regional Briefs, Topic Briefs, Reality Index Weekly, Tracker Updates

*Layer 1 contribution:* basic RSS, free web push, free email alerts, embed widgets free with attribution.
*Layer 2 contribution:* full API tiers, webhooks, custom alert rules, white-label embeds, institutional licensing.

These four capabilities are the engineering investment. The two layers are the product investment. Confusing the two is the most common strategic mistake at this scale.

---

## 4. Layer 1 — The Newsroom

### Audience
Ordinary news readers globally, with strength in South Asia, Middle East, and broader Muslim-world readership. Mobile-first. Multilingual (English first, Urdu second, Arabic later). Time-pressed but curious.

### Surfaces
- **Homepage:** Reality Index "Signal of the day" strip, breaking news banner (severity-driven), top tracked events with thumbnail trackers, regional cluster, video shorts row, newsletter signup, trending topics. Prioritized for scanability AND comprehension.
- **Topic pages:** Politics, World, Business, Science, Health, Sports, Tech. Each is an event-centric feed, not an article feed.
- **Regional pages:** South Asia, Middle East, Africa, Europe, Americas, East Asia. Genuine regional voice.
- **Event pages (Layer 1 view):** Brief → Tracker (1-2 key metrics with infographic) → Timeline → Perspectives (3 op-eds across spectrum) → Video clip → Related events → "Open full dossier" CTA
- **Trackers index:** Browseable directory of active trackers (e.g., "Russia-Ukraine war tracker," "Global polio cases," "Strait of Hormuz tanker movements") — destinations in their own right
- **Breaking news feed:** Live ticker of breaking events with severity, time elapsed, and source diversity indicator
- **Video page:** Curated news shorts, longer explainers, broadcaster clips
- **Perspectives page:** "What different sources say about today's biggest events" — daily curated multi-perspective view
- **Search:** Fast, fuzzy, recency-weighted, with tracker and topic filters
- **Newsletter products:** Daily Brief (morning), Regional Brief (weekly), Topic Briefs (weekly), Tracker Updates (when major changes), Breaking Alerts (on-demand)
- **Mobile experience:** Native feel in browser; PWA-installable; bottom nav; offline reading; web push for breaking alerts; shorts-first mobile feed for younger readers

### Design principles
- **Speed AND comprehension.** Layer 1 must feel fast on a 3G connection in Karachi or Lagos AND must explain the news visually within 30 seconds.
- **Every story has a chart.** No event card without at least one quantitative element where data exists.
- **Scanability over depth, but depth one click away.** Every story has the "Open in Intelligence Desk" link clearly available.
- **Warmth without clutter.** Editorial voice present; no portal-style noise.
- **Mobile-first, not mobile-also.** Design starts at 375px width.
- **Accessibility minimum:** WCAG 2.1 AA, RTL-correct.
- **Verified video only.** Never unverified citizen footage on Layer 1 without clear labeling.

### What's distinctive
- South Asian and Muslim-world coverage as a genuine voice
- Quantitative tracker with infographic on every major event
- Multi-perspective framing (left/right/wire/regional + multiple op-eds)
- Verified video clips integrated into stories
- Reality Index teasers hint at the deeper layer
- Breaking news alerts that lead to context, not headlines
- Multilingual from day one (English, Urdu)

### Monetization
Display advertising (programmatic + select direct), free newsletter subscriptions (the conversion funnel into Layer 2), affiliate revenue tasteful and below the fold.

### Domain
`scoopfeeds.com` — primary front door, organic search and direct visits.

---

## 5. Layer 2 — The Intelligence Desk

### Audience
Journalists at regional and international outlets needing research artifacts they can cite. Policy researchers at think tanks, universities, NGOs. Intelligence analysts at corporates, governments, consultancies. Traders covering geopolitical and commodity exposure. Academics in international relations, public health, political economy. Developers integrating intelligence into their products.

### Surfaces
- **Reality Index dashboard:** Multi-source probability board with per-source drilldown, divergence alerts, calibration histories, custom watchlists, anomaly feed, truth-gap matrix
- **Event Dossier (Layer 2 view):** Full dossier — all sources, all op-eds (full text where licensed), full tracker with **downloadable data (CSV/JSON)**, all videos, sentiment matrix, citation export, custom annotation
- **Trackers (deep):** Full historical data, custom queries, data export, embed-ready charts, methodology documentation per tracker
- **Watchlists and custom alerts:** User-defined event tracking with email, webhook, Slack, mobile push, SMS notifications. Custom alert rules ("notify me when probability shifts >10%," "when source divergence exceeds threshold," "when an entity appears in coverage").
- **Anomaly feed:** Curated stream of unusual patterns
- **Perspectives engine:** Op-ed aggregation with author credibility scores, ideological mapping, search by stance, comparative reading mode
- **Video archive:** Verified clips with provenance, search by event/actor/source
- **Source credibility ledger:** Public methodology, per-source reliability, correction tracking
- **Advanced search:** Entity, semantic, faceted, date-range, source-type, by-tracker
- **Historical archive:** Searchable archive of past events, dossiers, Reality Index snapshots, tracker history
- **API console:** Developer dashboard, key management, rate limits, usage analytics
- **Embed catalog:** Pre-built widgets with copy-paste integration, white-label option for paid tier
- **Methodology documentation:** Open documentation of clustering, signal scoring, brief review, tracker sourcing, prediction triangulation

### Design principles
- Density over speed (within reason)
- Real-time first
- Professional palette, reduced motion, keyboard shortcuts
- Citation-ready throughout
- Methodology transparency
- Desktop-primary, mobile-secondary

### Monetization
Premium subscription (~$19/month individual; ~$49/month professional with API; institutional licensing $99-199/seat for teams). Tiered API pricing (free → paid → enterprise). Embed licensing (free with attribution; paid for white-label). Sponsored intelligence briefs (Phase E, clearly labeled and editorially separated).

### Domain
`intel.scoopfeeds.com` — visually and architecturally distinct from Layer 1, recognizably the same brand family.

---

## 6. The Bridge (How the Layers Connect)

The bridge is where free readers become paying subscribers and where Layer 1 differentiates from generic portals. v3 adds two new conversion vectors to the v2 framework.

### Conversion mechanics
- Every Layer 1 event page contains "Open full dossier in Intelligence Desk" CTA
- Every Reality Index teaser links to the full multi-source dashboard with a soft paywall
- Every newsletter contains one premium-only insight per issue
- Every search result on Layer 1 shows premium-tier filters greyed out with "Available in Intelligence Desk"
- **NEW: Every tracker on Layer 1 links to the full data + custom queries on Layer 2**
- **NEW: Every breaking news alert links to the dossier; premium users get custom alert rules**

### Quality compounds
The shared event graph means improvements to the data spine lift both layers. A new prediction source benefits Layer 1 (more reliable signal) and Layer 2 (more drill-down options). A new tracker type benefits Layer 1 (more comprehension) and Layer 2 (more downloadable data). This is why data-spine work is the engineering priority.

### Brand coherence
Both layers share: logo, color system, typography family, voice principles, accessibility commitments. Both layers differ in: information density, palette emphasis, motion, navigation, default layouts. Like Bloomberg.com vs Bloomberg Terminal.

---

## 7. The Kill List (Refined for v3)

| Module / pattern | Decision | Rationale |
|---|---|---|
| Cars section | **Kill** | Off-strategy. |
| Generic magazine modules on homepage | **Kill** | Portal clutter. |
| X feed widget on homepage | **Kill** | Off-brand. Use X as a Layer 2 source, not a Layer 1 surface. |
| Tip jar widget | **Move to footer** | Premature monetization signal. |
| Affiliate widgets on homepage | **Kill or move below fold** | Erodes credibility. |
| `LiveTVChannelEmbed` (dead component) | **Delete** | Dead in code. |
| Generic "most read" article sidebar | **Replace** | Becomes "Top tracked events." |
| **Single-source prediction signals** | **Refactor** | **Multi-source triangulation required by Phase C.** |
| **Plain text-only event cards** | **Refactor** | **Every event card must support a tracker thumbnail and an op-ed snippet by Phase B.** |
| **Unverified citizen video** | **Reject from Layer 1** | Must be verified or labeled. Verification gate enforced. |
| Video coverage | **Keep, redesign** | Returns as Layer 1 furniture done well. |
| Regional pages | **Keep, deepen** | Core differentiator. |
| Topic feeds | **Keep, restructure** | Event-centric, not article-centric. |
| Newsletter products | **Keep, expand** | Three at Phase B exit; five at Phase D exit. |
| Breaking news | **Keep, build the engine** | Was implicit; now a named capability. |
| Live TV section | **Move to dedicated route** | Off homepage; reframe as live-event coverage hub. |

The principle: portal *clutter* dies; comprehension *furniture* (trackers, charts, perspectives, video) gets done well.

---

## 8. Success Metrics

### Data spine metrics
- Events tracked simultaneously: 500+ active events
- **NEW: Events with active trackers: ≥50 by Phase B exit, ≥200 by Phase D exit**
- **NEW: Prediction sources integrated: ≥4 by Phase C exit, ≥6 by Phase D exit**
- Source diversity index: no single source >10% of corpus, ≥6 regions covered, ≥3 source types
- Time-to-first-cluster: ≤30 minutes
- **NEW: Time-to-first-alert (breaking news): ≤15 minutes from signal threshold breach**
- Dedup accuracy: <5% false-positive
- Brief accuracy: ≥90% on weekly audit
- **NEW: Tracker accuracy: ≥95% on quarterly audit (high stakes — lives, cases, hardware)**

### Layer 1 metrics
- DAU: baseline by Phase B exit
- Returning user rate (7-day): ≥35% by Phase C exit
- Average session depth: ≥3 events per session
- Newsletter open rate: ≥35%
- **NEW: Newsletter subscribers: ≥10,000 by Phase C exit, ≥30,000 by Phase D exit**
- Mobile Lighthouse: ≥90 on key pages
- Time-on-site (returning): ≥4 minutes
- **NEW: Tracker page time-on-site: ≥5 minutes (trackers should be sticky destinations)**
- **NEW: Web push opt-in rate: ≥15% of returning users**
- **NEW: Breaking news alert click-through: ≥25%**
- **NEW: Video clip play rate: ≥30% of event-page visitors**

### Layer 2 metrics
- Premium subscribers: ≥500 within 12 months
- API consumers (active): ≥10 within 6 months of Layer 2 launch
- Embed installs: ≥50 within 12 months
- Premium retention (90-day): ≥80%
- Layer 2 DAU / Premium subs: ≥40%
- Reality Index DAU as share of Layer 2 DAU: ≥60%
- Layer 1 → Layer 2 conversion: ≥1% of Layer 1 returning users
- **NEW: Tracker data downloads per month: ≥500 by Phase D exit**
- **NEW: Custom alert rules per active premium user: ≥3**

### Operational metrics
- Production uptime: ≥99.5%
- Scheduler last-run age: ≤15 minutes 99% of the time
- Failed BullMQ job rate: <1%
- AI inference cost per event: tracked, trending down
- **NEW: Alert delivery latency p95: ≤30 seconds for web push, ≤5 minutes for email**

---

## 9. Phased Roadmap

### Phase A — Stabilize (Now → 4 weeks)
**Strategic goal:** Production runs the new architecture. Foundation is sound.

**Layer focus:** Foundation only.

**Work:** Step 0 worktree sync, all P0 items, P1 items 1-7, P3 hygiene. Define and instrument first 5 success metrics. **NEW: Audit existing video ingestion and op-ed sources; document gaps.**

**Exit criteria:** Scheduler running, admin auth secured, Urdu RTL working, hollow features populating, 5 metrics captured.

### Phase B — Launch Layer 1 with Comprehension Layer (Months 1–3)
**Strategic goal:** Layer 1 launches as a coherent product with the comprehension layer (trackers, infographics, perspectives, video, breaking news) baked in from day one — not retrofitted later.

**Layer focus:** Layer 1 primary.

**Work:**
- Execute kill list
- Mobile-first homepage redesign with the new layout (Reality Index strip, breaking news banner, top tracked events with thumbnail trackers, regional, video shorts row)
- Mobile-first Event Dossier (Layer 1 view) with brief + tracker + timeline + perspectives + video + "Open dossier" CTA
- **NEW: Build first 10-15 event trackers as flagship destinations** (e.g., one major war, one health crisis, one regional security event, one election cycle, one economic indicator). These are hand-curated and high-quality to set the bar.
- **NEW: Tracker infrastructure** — schema, ingestion, chart library, infographic generation
- **NEW: Op-ed aggregation MVP** — RSS-based ingestion from major op-ed sources, basic ideological tagging
- **NEW: Video clip integration** — YouTube broadcaster channels curated, verification labels, mobile shorts UI
- **NEW: Breaking news engine v1** — signal detection, severity scoring, web push and email delivery
- Topic and regional pages restructured around events
- Three newsletter products launched (Daily Brief, Regional Brief, Topic Briefs)
- Accessibility audit and remediation
- New tagline and brand refresh
- SEO and structured data
- First 5 BullMQ migrations from Claude Code plan

**Exit criteria:**
- Homepage above the fold = intelligence + comprehension content only
- Mobile Lighthouse ≥90 on homepage and Event Dossier
- ≥10 active trackers live with infographics
- Breaking news alerts working with web push opt-in flow
- Op-ed perspectives appearing on ≥80% of major event pages
- Video clip on ≥60% of major event pages
- Three newsletter products with ≥30% open rates
- Returning user rate ≥25%

### Phase C — Deepen the Data Spine (Months 3–5)
**Strategic goal:** The data spine becomes premium-grade. Multi-source prediction triangulation, semantic search, source credibility, and tracker breadth all reach Layer 2 launch threshold.

**Layer focus:** Foundation work benefiting both layers; sets up Layer 2.

**Work:**
- **NEW: Integrate Kalshi, Metaculus, Good Judgment as prediction sources** — at minimum 4 prediction sources by exit
- **NEW: Build calibration tracking infrastructure** — score each source's historical accuracy, weight aggregation
- **NEW: Source divergence alerts** — flag when prediction sources disagree significantly
- **NEW: Tracker library expansion** — from 10-15 hand-curated to 50+ trackers across topics
- **NEW: Op-ed credibility scoring** — author tracking, publication credibility, ideological mapping
- **NEW: Video verification layer** — provenance tracking, deepfake detection where feasible, citizen footage gating
- Entity extraction + entity pages
- Semantic search with hybrid scoring
- Semantic dedup
- Source diversity caps + ≥10 new non-South-Asian sources
- Source credibility public methodology
- "Why this matters" / "What changed in 24h" briefs default
- Watchlist and alert system on data spine
- Remaining BullMQ migrations
- CSP enabled in production

**Exit criteria:**
- ≥4 prediction sources integrated with calibration scores published
- Reality Index shows multi-source view by default
- ≥50 active trackers live
- Op-ed credibility scores published for major sources
- Video clips on ≥80% of major event pages with verification labels
- Search supports entity, semantic, faceted
- Source diversity meets target
- Brief accuracy ≥90%
- Tracker accuracy ≥95%
- Layer 1 returning user rate ≥35%

### Phase D — Launch Layer 2 (Months 5–8)
**Strategic goal:** Intelligence Desk launches. First non-ad revenue stream. Conversion funnel operational.

**Layer focus:** Layer 2 launch.

**Work:**
- `intel.scoopfeeds.com` launches with multi-source Reality Index dashboard
- Full Event Dossier (Layer 2 view) with all sources, full op-eds, downloadable tracker data, full videos, sentiment matrix, citation export
- Watchlist + custom alert rules (probability triggers, divergence triggers, entity triggers)
- Webhook + Slack/Teams integrations
- Anomaly feed as primary engagement surface
- Search advanced features paywalled on Layer 1
- Historical archive (≥6 months)
- Premium subscription tier ($19/month, $190/year)
- API v2 with three tiers
- Embed catalog (event card, tracker widget, Reality Index strip, anomaly band, breaking ticker, perspective comparison)
- Stripe integration, billing, account management
- Methodology documentation published (clustering, prediction weighting, tracker sourcing, brief review)
- First 3-5 partner outreach conversations
- Two more newsletter products (Reality Index Weekly, Tracker Updates)

**Exit criteria:**
- Layer 2 live with ≥3 distinct surfaces
- ≥100 premium subscribers
- ≥3 active API consumers
- ≥10 embed installs
- Layer 1 → Layer 2 conversion rate measurable
- Premium retention (30-day) ≥85%
- ≥6 prediction sources integrated
- ≥200 active trackers
- ≥500 tracker data downloads/month

### Phase E — Expand (Months 8–12)
**Strategic goal:** Platform compounds. Editorial layer adds defensibility. Mobile native app extends reach. Premium scales. AgentX integration explored.

**Work:**
- Editorial layer: 1-2 part-time editors reviewing premium briefs and curating Layer 1 features
- Mobile native app (iOS first) — alerts-first, breaking news, Reality Index alerts, tracker updates
- Arabic language added
- Institutional licensing tier ($99-199/seat/month for teams)
- Newsletter sponsorships activated
- Partnership with 1-2 universities or think tanks
- AgentX integration: Scoopfeeds events as data source for AgentX agents (loose coupling)
- Postgres migration *if and only if* SQLite shows binding constraints
- Sponsored intelligence briefs as occasional revenue
- **NEW: Hand-curated mega-trackers** for top 5-10 stories (Russia-Ukraine, Middle East, India-Pakistan, US elections, China economy, climate) — destinations in their own right with dedicated UX

**Exit criteria:**
- ≥500 premium subscribers
- ≥10 active API consumers, ≥50 embed installs
- Editorial review process operational
- Mobile native app live with ≥10,000 downloads
- All success metrics from Section 8 met
- Platform self-sustaining or growth-funded

---

## 10. Strategic Decisions Required

These cascade into every subsequent phase. Decide before Phase B kicks off.

1. **URL strategy.** Subdomain (`intel.scoopfeeds.com`) or path (`/intelligence`). Recommendation: **subdomain.** Decision: ___

2. **Premium pricing.** Recommendation: **start at $19/month, $190/year.** Adjust after first 100 subscribers. Decision: ___

3. **Revenue stream sequencing within Phase D.** Recommendation: **subscription first, API in week 4, institutional after first 100 subscribers.** Decision: ___

4. **Editorial layer commitment.** Recommendation: **yes, but only after ≥300 premium subscribers prove the case.** Decision: ___

5. **AgentX integration depth.** Recommendation: **loose coupling in Phase E — Scoopfeeds publishes events via API; AgentX consumes them.** Decision: ___

6. **Multilingual sequencing.** Recommendation: **English + Urdu through Phase D; Arabic in Phase E.** Decision: ___

7. **Open-source posture for methodology.** Recommendation: **methodology open and citable; weights, models, source-credibility scores proprietary.** Decision: ___

8. **Mobile native app timing.** Recommendation: **Phase E.** Decision: ___

9. **Brand identity refresh.** Recommendation: **refresh in Phase B alongside homepage redesign.** Decision: ___

10. **Postgres timing.** Recommendation: **defer until SQLite shows binding constraints; revisit only in Phase E if needed.** Decision: ___

11. **NEW: Prediction source priority.** Of Polymarket, Kalshi, Metaculus, Good Judgment, PredictIt, Manifold, AI estimates, expert polls — which 4 launch in Phase C? Recommendation: **Polymarket (already in stack), Kalshi (CFTC-regulated mainstream coverage), Metaculus (calibration discipline, long-tail coverage), AI estimates (cheap to add, complements market sources).** Add Good Judgment in Phase D. Decision: ___

12. **NEW: Tracker build strategy.** Hand-curated only (high quality, slow), template-driven (medium quality, fast), or AI-generated with human review (medium quality, fast, scalable)? Recommendation: **hand-curated for first 10-15 flagship trackers in Phase B; template-driven (with human review) thereafter; AI-generated only where data sources are highly structured.** Decision: ___

13. **NEW: Alert delivery strategy.** Web push and email free for all; mobile push, SMS, webhooks paid? Or freemium with rate limits? Recommendation: **web push + email free with rate limits; webhooks + Slack/Teams + custom rules paid; mobile push in Phase E with native app; SMS only for major Phase E events.** Decision: ___

14. **NEW: Video sourcing posture.** Aggregation only (legally simpler, lower quality), broadcaster partnerships (higher quality, slower to ramp), or both? Recommendation: **aggregation from broadcaster YouTube channels (legal under fair use with attribution and embed) + curated playlists; broadcaster partnerships in Phase E if revenue justifies.** Decision: ___

15. **NEW: Op-ed sourcing posture.** RSS aggregation with snippets only (legally safest), licensing deals with major publishers (more content, more cost), or hybrid? Recommendation: **RSS aggregation with snippets + link-out for free tier; licensing deals only for premium tier in Phase E if specific publishers prove valuable.** Decision: ___

---

## 11. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Single-developer bottleneck | High | Critical | Claude Code with structured handoffs. 1 part-time engineer in Phase D. |
| Brand confusion between layers | Medium | High | Distinct subdomain. Visually differentiated UIs. Clear copy. |
| Editorial cost for Layer 1 | Medium | High | AI does 90%; humans review prominent placements. Scale only after revenue. |
| AI brief accuracy failures | Medium | Critical | Layer 2 briefs human-reviewed. Layer 1 labeled clearly. Weekly audits. |
| **NEW: Tracker accuracy failures** | Medium | **Critical** | **High-stakes data (lives, cases, hardware) demands ≥95% accuracy. Sourcing from authoritative bodies (UN, WHO, ACLED, government statistics) with provenance shown. Quarterly audit. Public correction process.** |
| **NEW: Single-source prediction bias** | Medium | High | **Triangulation across ≥4 sources by Phase C. Calibration tracking. Divergence as a feature, not a bug.** |
| **NEW: Video misinformation / deepfake exposure** | Medium | High | **Verification gate before Layer 1 publication. Citizen footage labeled. Provenance shown. No unverified breaking-event video.** |
| **NEW: Op-ed copyright exposure** | Medium | High | **Snippet + link-out for free tier. Licensing deals only where premium revenue justifies. Legal review before Phase D.** |
| **NEW: Alert fatigue / unsubscribe rate** | High | Medium | **Severity thresholding. User-controlled categories. Smart defaults (top events only). Quiet hours.** |
| **NEW: Infographic accuracy at scale** | Medium | High | **Auto-generation only where data sources are highly structured (case counts, market data). Human review for hand-curated trackers. Public correction log.** |
| Scope creep | High | High | This document. Kill list. One-sentence tests. |
| Conversion funnel underperforms | Medium | High | A/B test. Adjust premium-tease intensity. Freemium fallback. |
| Competitive entry | Medium | High | Move fast. Methodology as moat. API consumer lock-in. |
| Source legal exposure | Medium | High | Brief excerpts only with attribution. Legal review before Phase D. |
| Cost runaway on AI inference | Medium | Medium | Local model routing. Cost dashboards from Phase A. |
| Hostinger / infra limits | Medium | Medium | Container plan exists. Migration path to Fly/Railway/Render. |
| Geopolitical content risk | Low | High | Editorial guidelines. Multi-source requirement. No partisan framing. |
| Codex / agent execution drift | High | High | Mandatory deploy-verification. Post-merge smoke tests. |
| DrJ-time conflict | High | High | Phases scoped for realistic velocity. |

---

## 12. How to Use This Document

This document is the source of truth for "is this on strategy?"

**Before adding any feature:**
- Which layer does this serve? (1, 2, both, or bridge?)
- Which data-spine capability does it use or improve?
- Which audience benefits?
- Which success metric will it move?
- If none, kill it.

**Before approving any code change:**
- Which strategic phase is this in?
- Which exit criterion does it contribute to?
- Is there a deploy-verification step?

**Before each phase kicks off:**
- Re-read Section 1 and Section 8
- Confirm prior exit criteria met
- Update Section 10 if decisions shifted
- Reassess Section 11 risks

**Quarterly review:**
- Score against Section 8 metrics
- Update risk register
- Reaffirm or revise kill list and decisions
- Bump version if structural changes

This document is a compass, not a contract. Updates are deliberate, written, dated.

---

## Appendix A — Mapping Tactical Plans to Strategic Phases

| Tactical Item | Phase | Layer / Capability |
|---|---|---|
| Step 0 (worktree sync) | A | Foundation |
| P0-1 to P0-6 | A | Foundation |
| P1-1 to P1-7 | A | Foundation |
| P2-1 (homepage redesign — *expanded with comprehension layer*) | B | Layer 1 + Bridge |
| **NEW: First 10-15 flagship trackers** | B | Cap. 2 / Layer 1 |
| **NEW: Tracker infrastructure (schema, charts, infographics)** | B | Cap. 2 |
| **NEW: Op-ed aggregation MVP** | B | Cap. 2 / Layer 1 |
| **NEW: Video clip curation + verification labels** | B | Cap. 2 / Layer 1 |
| **NEW: Breaking news engine v1 (detection + delivery)** | B | Cap. 1 + 4 |
| Newsletter products (3) | B | Layer 1 |
| Mobile-first redesign | B | Layer 1 |
| Accessibility audit | B | Both layers |
| **NEW: Multi-source prediction integration (Kalshi, Metaculus, AI estimates)** | C | Cap. 3 |
| **NEW: Calibration tracking infrastructure** | C | Cap. 3 |
| **NEW: Source divergence alerts** | C | Cap. 3 / Layer 2 |
| **NEW: Tracker library expansion to 50+** | C | Cap. 2 |
| **NEW: Op-ed credibility scoring** | C | Cap. 2 |
| **NEW: Video verification layer** | C | Cap. 2 |
| Entity extraction + pages | C | Cap. 2 |
| Source credibility scoring | C | Cap. 2 |
| P2-2 search overhaul | C / D | Both layers |
| P2-3 semantic dedup | C | Cap. 1 |
| P2-4 source diversity | C | Cap. 1 |
| Premium subscription launch | D | Layer 2 |
| API v2 + tiered access | D | Cap. 4 |
| **NEW: Custom alert rules + webhooks** | D | Cap. 4 / Layer 2 |
| Embed catalog | D | Cap. 4 |
| **NEW: Tracker data downloads** | D | Layer 2 |
| Editorial layer | E | Layer 2 |
| Mobile native app | E | Both |
| Arabic language | E | Layer 1 |
| AgentX integration | E | Cap. 4 |
| **NEW: Mega-trackers for top 5-10 stories** | E | Cap. 2 |
| Postgres migration (if needed) | E | Foundation |

---

## Appendix B — One-Sentence Tests

**For features and surfaces:**
- *"Does this serve Layer 1, Layer 2, both, or the bridge?"*
- *"Could this run on a generic portal homepage?"* If yes, reconsider.
- *"Would a Yahoo News reader find this useful?"* (Layer 1 test.)
- *"Would a Bloomberg Terminal user find this useful?"* (Layer 2 test, adapted.)
- *"Would a journalist cite this?"* (Layer 2 quality test.)
- *"Would a developer pay for this via API?"* (Capability 4 test.)
- *"Does this make returning users come back?"* (Engagement test.)
- **NEW: *"Does this event have a chart, map, or tracker that explains it?"* If no on a major event, why not?**
- **NEW: *"Are we relying on more than one prediction source for this signal?"* If no, fix it.**
- **NEW: *"Would this alert deserve to interrupt a user's day?"* If not, don't send it.**
- **NEW: *"Are we showing op-eds from more than one perspective on this event?"* If no, broaden.**
- **NEW: *"Is this video verified, and is the verification visible to the reader?"* If no, don't publish.**

**For editorial decisions:**
- *"Is this fact-checked enough to publish under Scoopfeeds?"*
- *"Could a competitor reproduce this in a week?"* If yes, where's the moat?
- *"Would I bet my reputation on this brief or this tracker number?"* If no, don't publish.

**For engineering:**
- *"Is this a data-spine improvement or a layer-specific feature?"* Spine first.
- *"Will this still matter at 10x events?"*
- *"Does this make the deploy more or less risky?"*

---

## Appendix C — Comparison Set (Detailed)

### Layer 1 — News surfaces
**Yahoo News.** Steal: scanability, breaking prominence. Avoid: clutter.
**Al Jazeera English.** Steal: voice, regional coverage, video. Avoid: regional retreat.
**Reuters.com.** Steal: reliability signaling. Avoid: paywall maze.
**BBC News.** Steal: mobile UX, accessibility, multilingual. Avoid: institutional blandness.
**Google News.** Steal: freshness, source diversity. Avoid: shallow aggregation.

### Layer 1 — Data and infographics
**The Economist.** Steal: chart literacy, methodology footnotes.
**NYT Upshot.** Steal: explanatory data journalism, narrative + chart pairing.
**Reuters Graphics.** Steal: production values, animation discipline.
**FT Visual Journalism.** Steal: investigative depth + visual rigor.
**Our World in Data.** Steal: methodology transparency, source disclosure, downloadable data.
**Visual Capitalist.** Steal: shareability, single-image clarity.

### Layer 1 — Perspectives
**AllSides.** Steal: left/center/right framing, transparency about lean.
**Ground News.** Steal: source-bias visualization, blindspot analysis.
**The Browser.** Steal: editorial curation, quality threshold.
**RealClearPolitics.** Steal: op-ed aggregation discipline.

### Layer 1 — Video
**Reuters TV.** Steal: production values, breaking-event speed.
**Al Jazeera, AP video.** Steal: regional coverage breadth, broadcast-grade clips.
**Broadcaster YouTube channels.** Steal: aggregation surface for verified content.

### Layer 2 — Intelligence
**Bloomberg Terminal.** Steal: density, real-time, methodology, palette. Avoid: pricing tier, finance-only.
**Reuters Eikon.** Steal: alerts, research tools, watchlists. Avoid: UX complexity.
**FT Pro.** Steal: premium positioning, editorial review. Avoid: methodology opacity.
**Stratfor.** Steal: subscription model, methodology transparency. Avoid: slow cadence.
**Crisis Group.** Steal: methodology rigor, regional expertise. Avoid: institutional slowness.
**GZERO Media.** Steal: video formats, personality framing. Avoid: shallow analysis.
**AlphaSense.** Steal: search-first UX, enterprise sales. Avoid: finance-only.

### Layer 2 — Probability
**Polymarket.** Steal: liquidity-driven price signals on US events.
**Kalshi.** Steal: regulated mainstream coverage, broader event categories.
**Metaculus.** Steal: calibration discipline, long-tail and policy coverage.
**Good Judgment.** Steal: forecasting rigor, methodology transparency.
**PredictIt.** Steal: political market depth where still operating.
**Manifold Markets.** Steal: niche-event coverage, community engagement.

### Bridge — Distribution
**Reuters Connect.** Steal: programmatic distribution model.
**AP wire.** Steal: machine-readable formats, enterprise SLAs.
**AlphaSense.** Steal: API economy, enterprise lock-in.

---

*End of document. v3.0.*
