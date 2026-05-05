# Scoopfeeds Strategic Plan v4.0
## One Event Graph. Two Layers. Three Revenue Streams. Comprehension at the Core. Distribution as a Discipline.

**Document type:** Strategic north-star
**Version:** 4.0 (supersedes v3.0)
**Owner:** DrJ (Founder)
**Review cadence:** Quarterly
**Last updated:** May 2026

---

## 1. The Vision

Scoopfeeds is **one event graph powering two reader experiences and three revenue streams**, with **comprehension at the core and distribution as a discipline.** A shared data spine ingests, clusters, enriches, tracks, and analyzes global events from a comprehensive source matrix. Two distinct surfaces present that data at different depths to two different audiences. Three revenue streams compound on a single cost base. Every story includes the visual, quantitative, and analytical scaffolding that lets a reader actually understand what happened. And every event becomes content for multiple distribution channels — newsletter, social, embed, API — engineered as a system, not improvised.

### The architectural principle

**One event graph. Two presentation layers. Three monetization streams. Every event has a Tracker. Every story is multi-channel by default.**

This is the principle that makes the ambition feasible for a small team. The same ingestion pipeline, dedup logic, enrichment workers, prediction triangulation, and tracker infrastructure feed both layers. The same per-event content is projected automatically into newsletters, social posts, embeds, and API outputs. Cost is amortized across audiences and channels.

### The two layers

**Layer 1 — The Newsroom.** Fast, mobile-first, broadly accessible. Yahoo News + Al Jazeera English bar, with quantitative trackers, multi-perspective op-eds, and verified video on every major event. Free, ad-supported, optimized for daily use. South Asian and Muslim-world coverage as a genuine differentiator.

**Layer 2 — The Intelligence Desk.** Research-grade analytical workstation. Bloomberg Terminal + Reuters Eikon bar, scaled for non-financial events: multi-source prediction triangulation, full Event Dossiers with downloadable data, custom alert rules, watchlists, source credibility scoring, advanced search, programmatic API access. Subscription-priced for individuals; tiered API for institutions.

### The bridge

Every event exists in both layers at different depths. Stories are not written twice; they are projected from the same event graph.

### The positioning sentence

**"Read the news. See the data. Hear the perspectives. Decode the signals."**

Four verbs, four capabilities, one platform.

### The honest comparison set

| Surface | Aspirational peers | What we take |
|---|---|---|
| **Layer 1 — News** | Yahoo News, Al Jazeera English, Reuters.com, BBC News | Speed, mobile UX, regional voice, newsletter discipline |
| **Layer 1 — Data viz** | The Economist, NYT Upshot, Reuters Graphics, FT Visual Journalism, Our World in Data, Visual Capitalist | Quantitative storytelling, methodology transparency |
| **Layer 1 — Perspectives** | AllSides, Ground News, The Browser, RealClearPolitics | Multi-perspective framing, ideological transparency |
| **Layer 1 — Video** | Reuters TV, Al Jazeera, AP video, broadcaster YouTube | Verified video, broadcast-grade clips |
| **Layer 2 — Intelligence** | Bloomberg Terminal, Reuters Eikon, FT Pro, Stratfor, Crisis Group, GZERO | Density, real-time, premium credibility, methodology rigor |
| **Layer 2 — Probability** | Metaculus, Good Judgment, Polymarket, Kalshi, PredictIt | Multi-source aggregation, calibration tracking |
| **Bridge — Distribution** | Reuters Connect, AP wire, AlphaSense | Programmatic distribution, API economy |
| **Social — Data brands** | Visual Capitalist, Chartr, Morning Brew, Bloomberg Quicktake, The Economist Espresso, Our World in Data, NowThis | Social-native data storytelling, multi-platform discipline, monetization through reach |

---

## 2. Where We Stand (Honest Assessment)

Scoopfeeds today is a feature-rich monolith with strong architectural ambition but weak operational discipline. Backend hardening exists in code but has not reached production. Frontend has not been touched. The platform has no quantitative trackers, no breaking news engine, no op-ed aggregation, single-source predictions, **a thin source base (~30-50 active sources, Pakistan-skewed, English-dominant), and no engineered social distribution.** Manual or sporadic social posting at best.

**Assets:** Reality Index architecture, multi-source ingestion infrastructure, public API and embed scaffolding, multilingual base, founder domain expertise, regional access advantage, YouTube ingestion already in stack.

**Liabilities:** Production runs old architecture; homepage signals "portal"; **source base is shallow and regionally skewed**; corpus is single-language-dominant; search is keyword-only; dedup is fragile; no metrics defined; no editorial layer; no quantitative tracker layer; no breaking news engine; single-source prediction; no op-ed aggregation; video ingestion exists but no curation layer; **no social distribution engine** (the single biggest growth-channel gap).

**Two biggest leverage points in v4:**
1. **Trackers + infographics layer** — what turns Scoopfeeds from "news site" into "place you go to understand a story."
2. **Social distribution engine** — what turns a credible platform into a *known* one. Without engineered social distribution, even great analytical work stays invisible.

---

## 3. The Data Spine (Shared Infrastructure)

The data spine has four core capabilities. Both layers consume them at different depths. Two of the four expand significantly in v4 (Capability 1 with the source matrix; Capability 4 with social distribution).

### Capability 1 — Live Event Stream + Breaking News + **Source Curation Matrix**

Ingestion → clustering → dedup → ranking → breaking-news signal detection → alert generation. v4 adds an explicit source curation strategy — the foundation under everything.

#### The Source Matrix

A credible global intelligence platform needs sources organized along three dimensions: **category × region × source-type**. The matrix is filled deliberately, not opportunistically.

**Categories (16):** Politics & Government · Conflict & Security · Economics & Markets · Health & Medicine · Climate & Environment · Science & Technology · Sports · Culture & Society · Religion · Migration & Refugees · Energy & Resources · Maritime & Shipping · Aviation · Agriculture & Food Security · Education · Human Rights

**Regions (10):** North America · Latin America · Europe (Western/Eastern/Nordic split as needed) · Russia & Central Asia · Middle East & North Africa (split: Levant, Gulf, Maghreb, Iran, Turkey, Israel/Palestine) · Sub-Saharan Africa (split: West, East, Horn, Southern, Central) · South Asia · Southeast Asia (ASEAN) · East Asia (China, Japan, Korea, Taiwan) · Oceania & Pacific

**Source types (10):** Wire services (Reuters, AP, AFP, Xinhua, ANI, IRNA, EFE, etc.) · International broadcasters (BBC, Al Jazeera, DW, France24, NHK, ABC AU, CCTV, RT) · National newspapers (NYT, WaPo, Guardian, Le Monde, Der Spiegel, Asahi Shimbun, Times of India, etc.) · Regional newspapers (Dawn, The Hindu, Daily Sabah, SCMP, Haaretz, etc.) · Specialized publications (Foreign Affairs, FT, WSJ, Economist, Lancet, Nature, Science, Defense News, Maritime Executive) · Think tanks & research orgs (Brookings, RAND, IISS, SIPRI, ICG, ACLED — already in stack — ICRC, MSF reports, Atlantic Council, Carnegie) · Government & primary data (UN, WHO, World Bank, IMF, central banks, government statistics agencies) · Independent journalism (Bellingcat, ProPublica, OCCRP, IRIN/New Humanitarian) · Academic sources (university press releases, journal RSS) · Local-language sources (translated; Arabic, Urdu, Russian, Mandarin, Spanish, Portuguese, French initial priority)

**Source target by Phase:**
- Phase A: audit existing sources, document gaps. Currently ~30-50 active.
- Phase B exit: ≥150 active sources, with no single source >10% of corpus, ≥6 regions covered daily.
- Phase C exit: ≥300 active sources, ≥10 regions covered, ≥4 source types per major event, translation pipeline operational for ≥4 languages.
- Phase D exit: ≥500 active sources, paid licensing deals in place for ≥3 premium publishers (FT, Reuters, AP, or similar) for Layer 2 use.
- Phase E exit: ≥800 active sources, full local-language coverage in 7+ languages.

**Source quality scoring** — each source assigned a credibility score (0-100) based on:
- Editorial track record (corrections, retractions, fact-check ratings)
- Methodology transparency
- Domain expertise for the category
- Independence (state-controlled / corporate-owned / independent)
- Historical accuracy on past events
Scores are public for premium tier (transparency moat) and used internally for ranking.

**Translation pipeline** — non-English sources translated via:
- AI translation (Claude/GPT-class) for first-pass
- Human review for sensitive geopolitical content (Phase C onwards)
- Languages prioritized by Phase: English → Urdu → Arabic → Russian → Mandarin → Spanish → French

**Source partnerships** — Phase D onward:
- Free RSS aggregation continues (the volume play)
- Paid licensing deals with 3-5 premium publishers for Layer 2 access (e.g., full FT articles, Reuters wire access, AP photography)
- Reciprocal embed deals with regional publishers (we feature their work; they embed our trackers)

#### Breaking News Engine (carried forward from v3)

A story is "breaking" when coverage volume spikes across diverse sources within a short window, source-type diversity is high, sentiment is high-magnitude, or a watchlisted entity appears. The signal triggers alert generation and routes to delivery channels via Capability 4.

*Layer 1 sees:* breaking news banner, web push, email alerts.
*Layer 2 sees:* full breaking-news feed, custom rules, webhook delivery, Slack/Teams.

### Capability 2 — Event Dossier (Comprehension Layer)

Carried forward from v3. Every event accumulates: synthesis (brief, "what changed"), enrichment (actors, timeline), **tracker** (quantitative scorecard), **infographics** (charts, maps, network graphs), **perspectives** (op-eds with credibility scoring across spectrum), **video evidence** (verified clips), source triangulation, related events.

*Layer 1 sees:* curated subset — brief + tracker + 1 infographic + 2-3 op-ed snippets + 1 video clip + dossier CTA.
*Layer 2 sees:* full dossier — all sources, all op-eds, downloadable data, all videos, sentiment matrix, citation export.

### Capability 3 — Reality Index (Multi-Source Probability Triangulation)

Carried forward from v3. Probability inputs from Polymarket + Kalshi + Metaculus + Good Judgment + AI estimates + survey data, aggregated weighted by calibration. Source divergence is itself a signal.

*Layer 1 sees:* aggregated probability as "Signal of the day."
*Layer 2 sees:* full multi-source dashboard, per-source drilldown, divergence alerts, calibration histories, custom watchlists.

### Capability 4 — Intelligence Distribution & Audience Engine

Significantly expanded in v4 to make social distribution a first-class discipline.

#### 4a — Programmatic distribution
REST API + GraphQL: events, dossiers, trackers, probabilities. Free / paid / enterprise tiers.
Embed widgets: event card, tracker, Reality Index strip, anomaly band, breaking ticker, perspective comparison.
RSS feeds: topical, regional, watchlist-driven.

#### 4b — Alert delivery
Web push (free), email (free), mobile push (Phase E), webhooks (paid), Slack/Teams (paid), SMS for major events (paid).

#### 4c — Newsletter distribution
Daily Brief, Regional Briefs, Topic Briefs, Reality Index Weekly, Tracker Updates, Breaking Alerts.

#### 4d — Social Media Engine (NEW major sub-capability)

A purpose-built engine that generates platform-optimized content from the event graph and publishes to multiple platforms automatically, with engagement tracking, A/B testing, and revenue attribution. This is closer to Visual Capitalist or Chartr's playbook than to typical news-site social-media management.

**Goals (in priority order):**
1. **Brand recognition** — "Scoopfeeds" becomes known as a data-driven intelligence brand on social. Recognition compounds; reach without recognition is wasted.
2. **Traffic generation** — drive returning users to scoopfeeds.com and Layer 2 trial.
3. **Premium conversion** — social → newsletter → premium funnel.
4. **Direct social revenue** — platform monetization (YouTube AdSense, X creator payouts, Instagram bonuses), brand sponsorships, affiliate.

**Content taxonomy (templated and largely auto-generated):**
- **Insight posts** — single chart/infographic + key insight. Showcases analytical capability. Drives recognition.
- **Breaking + analysis** — real-time news with quick analytical context. Drives traffic to event dossier.
- **Multi-perspective threads** — three op-ed views on a topic. Drives engagement; showcases unique capability.
- **Tracker updates** — "polio cases this week," "tankers through Hormuz this month." Drives recurring engagement.
- **Reality Index callouts** — "markets diverge sharply on Question X." Drives premium conversion.
- **Sponsored content** — clearly labeled, occasional. Direct revenue.
- **Newsletter promotion** — drives newsletter signups (the conversion funnel into Layer 2).
- **Premium teasers** — "See full dossier in Intelligence Desk."
- **Long-form video** — YouTube deep-dives on major events (Phase D+).

**Platform strategy (sequenced by phase):**

| Platform | Phase | Format priority | Revenue mechanism |
|---|---|---|---|
| **X (Twitter)** | B | Threads, single-image posts, breaking alerts | X Creator Monetization (Phase D) |
| **LinkedIn** | B | Professional analysis posts, document carousels | Sponsored content; B2B brand awareness for Layer 2 |
| **Instagram** | B | Carousels (insight posts), Reels (breaking + analysis), Stories | Reels Bonuses, brand partnerships |
| **Threads** | C | Forked from X content with image emphasis | None native yet; brand-building only |
| **Bluesky** | C | Forked from X content; tech-savvy audience | None native yet; brand-building |
| **Facebook** | C | Image + text + link, video reposts | In-stream ads (with audience scale), brand partnerships |
| **YouTube Shorts** | C | Vertical video clips of breaking events with analysis | YouTube AdSense once monetized |
| **TikTok** | D | Vertical video, narrative-driven; younger audience | Brand partnerships (Creator Fund declining) |
| **YouTube long-form** | D | Deep-dive analysis videos, weekly / bi-weekly cadence | YouTube AdSense (highest direct social revenue) |

**Per-platform optimization:**
- Each platform has its own tone, length, format, hashtag strategy, posting cadence
- Auto-generated drafts reviewed by a human (or by another AI agent with high confidence) before publication
- Cross-platform repurposing (one event → 6 platform-tuned posts)
- A/B testing on hooks, images, CTAs

**Technical stack (Phase B build):**
- Content generation pipeline (per-platform templates, AI generation with guardrails)
- Image composition (infographic → social-ready image with branding)
- Video clipping for shorts (auto-clip + caption + voiceover)
- Scheduling engine (Buffer-like; could use existing tools or build)
- Analytics ingestion (per-platform performance, click-through, engagement)
- Compliance layer (ensure brand voice, fact-checking, no policy violations)

**Revenue attribution:**
- UTM-tagged links for traffic attribution
- Per-platform conversion tracking (free → newsletter → premium)
- Direct social revenue dashboard (creator fund payouts, sponsorships, affiliate)

*Layer 1 contribution from social engine:* drives traffic, newsletter signups, brand recognition.
*Layer 2 contribution from social engine:* showcases premium-tier capabilities (Reality Index, full dossiers, custom alerts) to convert prospects.

These four capabilities (with social as a major sub-capability of #4) are the engineering investment. The two layers and the source matrix are the product investment.

---

## 4. Layer 1 — The Newsroom

### Audience
Ordinary news readers globally, with strength in South Asia, Middle East, broader Muslim-world readership. Mobile-first. Multilingual (English first, Urdu second, Arabic third).

### Surfaces (carried forward from v3 with minor updates)
- Homepage with Reality Index strip, breaking news banner, top tracked events with thumbnail trackers, regional cluster, video shorts row, newsletter signup
- Topic pages (event-centric)
- Regional pages (genuine voice)
- Event pages (Layer 1 view): brief → tracker → timeline → perspectives → video → CTA
- Trackers index (browseable directory)
- Breaking news feed (live ticker with severity)
- Video page (curated shorts + explainers)
- Perspectives page (daily multi-perspective view)
- Search (fast, fuzzy, recency-weighted, with tracker filters)
- Newsletter products (Daily Brief, Regional Brief, Topic Briefs, Tracker Updates, Breaking Alerts)
- Mobile experience (PWA, web push, shorts-first feed)
- **NEW: Social-driven landing pages** — UTM-tagged from social posts, optimized for first-visit conversion to newsletter signup

### Distinctive
- South Asian and Muslim-world coverage
- Quantitative tracker on every major event
- Multi-perspective framing
- Verified video clips
- Reality Index teasers
- Breaking news with context
- Multilingual from day one
- **NEW: Social-native presence — social isn't an afterthought, it's the front door for half of new visitors**

### Monetization
Display advertising, free newsletter (conversion funnel), affiliate revenue tasteful and below the fold, **social platform direct revenue** (YouTube AdSense, X creator monetization, Instagram bonuses, etc.).

### Domain
`scoopfeeds.com` — primary front door for organic search, direct visits, **and social link-outs**.

---

## 5. Layer 2 — The Intelligence Desk

### Audience
Journalists, policy researchers, intelligence analysts, traders, academics, developers.

### Surfaces (carried forward from v3)
- Reality Index dashboard (multi-source)
- Event Dossier (Layer 2 view) with downloadable data
- Trackers (deep, with custom queries)
- Watchlists and custom alerts
- Anomaly feed
- Perspectives engine
- Video archive
- Source credibility ledger (now backed by the systematic source-quality scoring from Capability 1)
- Advanced search
- Historical archive
- API console
- Embed catalog
- Methodology documentation
- **NEW: Premium content from licensed publishers** (Phase D onward — FT, Reuters wire, etc. depending on which deals close)

### Monetization
Premium subscription ($19/month, $190/year), professional tier ($49/month with API access), institutional licensing ($99-199/seat for teams), tiered API pricing, embed licensing, sponsored intelligence briefs (Phase E).

### Domain
`intel.scoopfeeds.com` — distinct, recognizable family.

---

## 6. The Bridge (How the Layers Connect)

v4 adds social media as a primary acquisition vector, alongside the existing Layer 1 → Layer 2 conversion mechanics.

### Acquisition funnel
**Discovery:** social media (X, Instagram, LinkedIn, etc.) → SEO → direct.
**First visit:** social → Layer 1 landing page (UTM-tagged) → newsletter signup or article read.
**Regular visit:** Layer 1 → newsletter open → return.
**Conversion:** Layer 1 → soft paywall on premium feature → trial → premium subscriber.

### Conversion mechanics (v3 + v4 additions)
- Every Layer 1 event page → "Open full dossier in Intelligence Desk" CTA
- Every Reality Index teaser → soft paywall on full multi-source dashboard
- Every newsletter → one premium-only insight per issue
- Every search result → premium-tier filters greyed out with paywall
- Every tracker on Layer 1 → full data + custom queries on Layer 2
- Every breaking news alert → dossier + premium custom alerts
- **NEW: Every social post that showcases analytical capability includes a link to a deeper Layer 2 surface, with a free-trial CTA**
- **NEW: Social-driven traffic gets a higher-intent conversion offer** (e.g., 14-day free trial vs 7-day for SEO traffic)

### Quality compounds
The shared event graph means data-spine improvements lift both layers and feed social content. A new prediction source benefits Layer 1, Layer 2, and produces shareable "markets disagree on X" social posts. A new tracker type benefits all three. This is why data-spine work is the engineering priority.

---

## 7. The Kill List (Refined for v4)

| Module / pattern | Decision | Rationale |
|---|---|---|
| Cars section | **Kill** | Off-strategy. |
| Generic magazine modules on homepage | **Kill** | Portal clutter. |
| X feed widget on homepage | **Kill** | Off-brand. X is a Layer 2 source AND a distribution channel, not a Layer 1 surface. |
| Tip jar widget | **Move to footer** | Premature monetization. |
| Affiliate widgets on homepage | **Kill or move below fold** | Erodes credibility. |
| `LiveTVChannelEmbed` | **Delete** | Dead in code. |
| Generic "most read" sidebar | **Replace** | Becomes "Top tracked events." |
| Single-source prediction signals | **Refactor** | Multi-source by Phase C. |
| Plain text-only event cards | **Refactor** | Trackers + perspectives by Phase B. |
| Unverified citizen video | **Reject from Layer 1** | Verification gate enforced. |
| **Manual / sporadic social posting** | **Kill** | **Replace with engineered Social Media Engine in Phase B.** |
| **Source-by-source ad-hoc onboarding** | **Kill** | **Replace with systematic source matrix expansion (Phase A audit, Phase B expansion plan).** |
| Video coverage | **Keep, redesign** | Layer 1 furniture done well. |
| Regional pages | **Keep, deepen** | Core differentiator. |
| Topic feeds | **Keep, restructure** | Event-centric. |
| Newsletter products | **Keep, expand** | Conversion funnel. |
| Breaking news | **Keep, build engine** | Named capability now. |
| Live TV section | **Move off homepage** | Reframe as live-event hub. |

Principle: portal *clutter* dies; *systems* (trackers, perspectives, video, source matrix, social engine) get built and operated as systems.

---

## 8. Success Metrics

### Data spine metrics
- Events tracked simultaneously: 500+
- Events with active trackers: ≥50 by Phase B exit, ≥200 by Phase D exit
- **Active sources: ≥150 by Phase B exit, ≥300 by Phase C exit, ≥500 by Phase D exit**
- **Sources per (category × region) cell filled: ≥80% of priority cells by Phase C exit**
- **Languages with ingestion: ≥4 by Phase C exit, ≥7 by Phase E exit**
- Prediction sources integrated: ≥4 by Phase C exit, ≥6 by Phase D exit
- Source diversity index: no single source >10%, ≥6 regions, ≥3 source types
- Time-to-first-cluster: ≤30 minutes
- Time-to-first-alert: ≤15 minutes
- Dedup accuracy: <5% false-positive
- Brief accuracy: ≥90%
- Tracker accuracy: ≥95% (high-stakes data)

### Layer 1 metrics
- DAU baseline by Phase B exit
- Returning user rate (7-day): ≥35% by Phase C exit
- Average session depth: ≥3 events
- Newsletter open rate: ≥35%
- Newsletter subscribers: ≥10,000 by Phase C exit, ≥30,000 by Phase D exit
- Mobile Lighthouse: ≥90
- Time-on-site (returning): ≥4 minutes
- Tracker page time-on-site: ≥5 minutes
- Web push opt-in: ≥15% of returning users
- Breaking alert click-through: ≥25%
- Video clip play rate: ≥30% of event-page visitors
- **NEW: Social-driven traffic share: ≥30% of total Layer 1 traffic by Phase D exit**
- **NEW: Social → newsletter conversion rate: ≥3% of social click-throughs**

### Layer 2 metrics
- Premium subscribers: ≥500 within 12 months
- API consumers: ≥10 within 6 months of launch
- Embed installs: ≥50 within 12 months
- Premium retention (90-day): ≥80%
- Layer 2 DAU / Premium subs: ≥40%
- Reality Index DAU as share of Layer 2: ≥60%
- Layer 1 → Layer 2 conversion: ≥1% of Layer 1 returning users
- Tracker data downloads: ≥500/month by Phase D exit
- Custom alert rules per active premium user: ≥3

### Social media metrics (NEW section)
- **Combined followers across platforms: ≥10,000 by Phase B exit (3 platforms), ≥50,000 by Phase C exit (6 platforms), ≥250,000 by Phase D exit (8+ platforms)**
- **Average engagement rate per post: ≥3% (industry benchmark 1-2%)**
- **Click-through to scoopfeeds.com per post: ≥1% of impressions**
- **Direct social revenue (creator funds + brand partnerships): ≥$500/month by Phase C exit, ≥$5,000/month by Phase D exit, ≥$25,000/month by Phase E exit**
- **YouTube subscribers (long-form): ≥10,000 by Phase E exit**
- **Posts per platform per week: ≥10 (X), ≥5 (Instagram, LinkedIn), ≥3 (FB, Threads, Bluesky), ≥7 (YouTube Shorts), ≥1 (YouTube long-form by Phase D)**

### Operational metrics
- Production uptime: ≥99.5%
- Scheduler last-run age: ≤15 minutes
- Failed BullMQ rate: <1%
- AI inference cost per event: trending down
- Alert delivery latency p95: ≤30s web push, ≤5min email
- **NEW: Social post generation cost per post: ≤$0.05 (must be highly automated)**

---

## 9. Phased Roadmap

### Phase A — Stabilize (Now → 4 weeks)
**Strategic goal:** Production runs new architecture. Foundation sound.

**Work:** Step 0 worktree sync, all P0 items, P1 items 1-7, P3 hygiene. Define and instrument first 5 metrics. **NEW: Audit existing sources (categorize by region × category × type, document gaps). Audit existing video and op-ed feeds. Document current social media posture (likely none / sporadic).**

**Exit criteria:** Scheduler running, admin auth secured, Urdu RTL working, hollow features populating, 5 metrics captured, source gap analysis complete.

### Phase B — Launch Layer 1 with Comprehension + Distribution Layers (Months 1–3)
**Strategic goal:** Layer 1 launches with comprehension layer (trackers, infographics, perspectives, video, breaking news) AND social distribution engine baked in from day one — not retrofitted.

**Work:**
- Execute kill list
- Mobile-first homepage redesign
- Mobile-first Event Dossier (Layer 1 view)
- First 10-15 flagship trackers
- Tracker infrastructure (schema, charts, infographics)
- Op-ed aggregation MVP
- Video clip integration with verification labels
- Breaking news engine v1
- Topic and regional pages restructured
- Three newsletter products
- Accessibility audit
- New tagline and brand refresh
- SEO and structured data
- First 5 BullMQ migrations
- **NEW: Source matrix expansion to ≥150 active sources** (priority on filling region × category gaps; English + Urdu only at this stage)
- **NEW: Source quality scoring infrastructure** (score every source, store in DB, expose internally for ranking)
- **NEW: Social Media Engine v1** — launch on X, LinkedIn, Instagram. Build content generation pipeline (templates per platform, AI generation, image composition). Manual review of all posts before publishing in this phase. Posting cadence: X 10/week, LinkedIn 5/week, Instagram 5/week.
- **NEW: Per-platform brand voice guidelines** documented
- **NEW: UTM tagging and analytics dashboard for social-driven traffic**

**Exit criteria:**
- Homepage above the fold = intelligence + comprehension content only
- Mobile Lighthouse ≥90
- ≥10 active trackers
- Breaking news alerts live
- Op-ed perspectives on ≥80% of major events
- Video clip on ≥60% of major events
- 3 newsletter products with ≥30% open rates
- ≥150 active sources with quality scores
- ≥10,000 combined followers across X, LinkedIn, Instagram
- ≥3% engagement rate average
- Returning user rate ≥25%

### Phase C — Deepen the Data Spine + Scale Distribution (Months 3–5)
**Strategic goal:** Data spine becomes premium-grade. Source matrix fills out. Social distribution scales to 6+ platforms with first revenue.

**Work:**
- Multi-source prediction integration (Kalshi, Metaculus, Good Judgment, AI estimates)
- Calibration tracking infrastructure
- Source divergence alerts
- Tracker library expansion to 50+
- Op-ed credibility scoring
- Video verification layer
- Entity extraction + entity pages
- Semantic search + dedup
- Source diversity caps + ≥10 new non-South-Asian sources
- "Why this matters" / "What changed" briefs default
- Watchlist + alert system on data spine
- Remaining BullMQ migrations
- CSP enabled
- **NEW: Source matrix expansion to ≥300 active sources** (fill ≥80% of priority category × region cells)
- **NEW: Translation pipeline operational** for Arabic + Russian + Mandarin (in addition to English + Urdu)
- **NEW: Social Media Engine v2** — add Threads, Bluesky, Facebook. Begin YouTube Shorts. Reduce manual review on routine posts; high-confidence AI agent reviews. Begin platform monetization optimization (creator fund signups where eligible). First brand partnership conversations.
- **NEW: Long-form Twitter / LinkedIn analysis posts** (1-2 per week per platform) showcasing premium-tier capabilities

**Exit criteria:**
- ≥4 prediction sources with calibration
- Reality Index multi-source view default
- ≥50 active trackers
- Op-ed credibility scores published
- Video clips on ≥80% of major events
- Search supports entity, semantic, faceted
- Source diversity meets target
- Tracker accuracy ≥95%
- ≥300 active sources
- 4-language ingestion operational
- ≥50,000 combined social followers (6 platforms)
- ≥$500/month direct social revenue
- Layer 1 returning user rate ≥35%

### Phase D — Launch Layer 2 + Monetize Distribution (Months 5–8)
**Strategic goal:** Intelligence Desk launches. First non-ad revenue. Social media revenue becomes meaningful. Source partnerships begin.

**Work:**
- `intel.scoopfeeds.com` launches with multi-source Reality Index dashboard
- Full Event Dossier (Layer 2 view) with downloadable data
- Watchlist + custom alert rules
- Webhook + Slack/Teams integrations
- Anomaly feed
- Search advanced features paywalled
- Historical archive (≥6 months)
- Premium subscription ($19/month)
- API v2 with three tiers
- Embed catalog
- Stripe + billing + accounts
- Methodology documentation
- First 3-5 partner outreach
- Two more newsletter products
- **NEW: Source matrix expansion to ≥500 active sources**
- **NEW: First paid licensing deals** (target: 3 premium publishers — FT, Reuters, AP, or similar — for Layer 2 content depth)
- **NEW: Social Media Engine v3** — add TikTok. Begin YouTube long-form (1 video/week). Optimize for direct platform monetization. Active brand partnership program.
- **NEW: Social-to-premium conversion funnel optimized** (UTM-tagged free trials with higher-intent offers for social traffic)

**Exit criteria:**
- Layer 2 live with ≥3 distinct surfaces
- ≥100 premium subscribers
- ≥3 active API consumers
- ≥10 embed installs
- Premium retention (30-day) ≥85%
- ≥6 prediction sources
- ≥200 active trackers
- ≥500 tracker data downloads/month
- ≥500 active sources
- ≥3 paid publisher deals signed
- ≥250,000 combined social followers (8+ platforms)
- ≥$5,000/month direct social revenue
- YouTube channel monetized

### Phase E — Expand (Months 8–12)
**Strategic goal:** Platform compounds. Editorial layer adds defensibility. Mobile native app. Premium scales. Social media becomes major revenue stream. AgentX integration explored.

**Work:**
- Editorial layer (1-2 part-time editors)
- Mobile native app (iOS first) — alerts-first
- Arabic added to Layer 1
- Institutional licensing tier ($99-199/seat for teams)
- Newsletter sponsorships
- 1-2 university / think tank partnerships
- AgentX integration: Scoopfeeds events as data source via API (loose coupling)
- Postgres migration if SQLite shows binding constraints
- Sponsored intelligence briefs (Phase E)
- Hand-curated mega-trackers for top 5-10 stories
- **NEW: Source matrix expansion to ≥800 active sources** with full local-language coverage in 7+ languages
- **NEW: Reciprocal embed deals with 5+ regional publishers**
- **NEW: Social Media Engine v4** — full multi-platform operation. Podcast launch (Spotify, Apple). YouTube channel as second-largest revenue source after premium subs. Brand partnerships as recurring revenue.
- **NEW: Social-original content series** (recurring weekly or monthly formats with brand-show feel — e.g., "Reality Check" weekly Reality Index review on YouTube)

**Exit criteria:**
- ≥500 premium subscribers
- ≥10 active API consumers, ≥50 embed installs
- Editorial review operational
- Mobile native app live with ≥10,000 downloads
- All success metrics met
- ≥800 active sources
- ≥7 languages
- ≥$25,000/month social media revenue
- Platform self-sustaining or growth-funded

---

## 10. Strategic Decisions Required

Decide before Phase B kicks off (decisions 1-15 are strategic; 16-22 are new in v4).

1. **URL strategy.** Recommend: subdomain `intel.scoopfeeds.com`. Decision: ___
2. **Premium pricing.** Recommend: $19/month, $190/year. Decision: ___
3. **Revenue stream sequencing within Phase D.** Recommend: subscription first, API week 4, institutional after 100 subs. Decision: ___
4. **Editorial layer commitment.** Recommend: yes, after ≥300 premium subs. Decision: ___
5. **AgentX integration depth.** Recommend: loose coupling Phase E. Decision: ___
6. **Multilingual sequencing.** Recommend: English + Urdu through Phase D; Arabic Phase E; Russian/Mandarin/Spanish/French as Phase C ingestion only (translation, not full UI). Decision: ___
7. **Open-source posture for methodology.** Recommend: methodology open; weights/models proprietary. Decision: ___
8. **Mobile native app timing.** Recommend: Phase E. Decision: ___
9. **Brand identity refresh.** Recommend: Phase B with homepage redesign. Decision: ___
10. **Postgres timing.** Recommend: defer until binding constraints. Decision: ___
11. **Prediction source priority.** Recommend: Polymarket + Kalshi + Metaculus + AI estimates by Phase C; Good Judgment Phase D. Decision: ___
12. **Tracker build strategy.** Recommend: hand-curated for first 10-15 flagship; template-driven thereafter. Decision: ___
13. **Alert delivery strategy.** Recommend: web push + email free; webhooks/Slack/Teams paid; mobile push Phase E. Decision: ___
14. **Video sourcing posture.** Recommend: aggregation from broadcaster YouTube + curated playlists; broadcaster partnerships Phase E if revenue justifies. Decision: ___
15. **Op-ed sourcing posture.** Recommend: RSS aggregation + link-out free tier; licensing for premium tier Phase E if specific publishers prove valuable. Decision: ___

16. **NEW: Source onboarding strategy.** Manual curation (slow, controlled, deep), automated discovery (fast, broad, lower quality), or hybrid (DrJ-curated priority list + AI-suggested expansion)? Recommend: **hybrid — DrJ defines the priority matrix (which category × region × type cells must be filled); Claude Code agent identifies candidate sources via RSS directory crawls; DrJ approves before onboarding.** Decision: ___

17. **NEW: Translation strategy.** AI-only (cheap, scalable, accuracy concerns), human-only (expensive, slow, reliable), hybrid (AI first-pass + human review for sensitive content)? Recommend: **AI-only for routine content with confidence scoring; human review (or second-AI verification) for content tagged sensitive (war, politics, regional disputes, religious topics).** Decision: ___

18. **NEW: Source paid licensing budget.** $0 (RSS only, slow path to credibility), $500-1500/month (1-2 mid-tier deals), $3-5k/month (3-5 premium publishers like FT or Reuters wire)? Recommend: **$0 through Phase C. $1,500/month starting Phase D for first 1-2 deals. Scale to $5k/month in Phase E if Layer 2 revenue supports.** Decision: ___

19. **NEW: Social media platform launch priority.** Which 3 launch in Phase B? Recommend: **X (lowest production effort, broadest reach for analytical content), LinkedIn (B2B audience for Layer 2 prospects), Instagram (visual-first, large global reach, infographic-friendly).** Decision: ___

20. **NEW: Social content generation approach.** AI-only (cheapest, risk of low quality), AI + human review on every post (medium cost, safe, slow), AI + human review on first 3 months then high-confidence AI-only (medium cost, scalable)? Recommend: **AI + human review (DrJ or designated reviewer) on every post in Phase B. Phase C onward: AI generates; another AI agent reviews for tone/accuracy/policy with human review for breaking news, sponsored, and high-stakes content only.** Decision: ___

21. **NEW: Social media revenue model priority.** Which revenue stream gets engineered first? Recommend: **brand partnerships first (highest direct revenue per post; aligned with intelligence positioning); platform monetization (YouTube AdSense, X Creator) second once thresholds hit; affiliate links third; paid newsletter sponsorships fourth.** Decision: ___

22. **NEW: Social brand voice posture.** More casual (broader appeal, more shareability), more professional (Layer 2 alignment, premium signal), per-platform variation (X casual, LinkedIn formal, Instagram visual)? Recommend: **per-platform variation with consistent core voice — informed, data-first, regionally-aware, never partisan. Tonality varies; substance does not.** Decision: ___

---

## 11. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Single-developer bottleneck | High | Critical | Claude Code with structured handoffs. 1 part-time engineer in Phase D. |
| Brand confusion between layers | Medium | High | Distinct subdomain. Visually differentiated UIs. |
| Editorial cost for Layer 1 quality | Medium | High | AI 90%; humans review prominent placements. |
| AI brief accuracy failures | Medium | Critical | Layer 2 human-reviewed; weekly audits. |
| Tracker accuracy failures | Medium | Critical | Authoritative sources only. Quarterly audits. Public corrections. |
| Single-source prediction bias | Medium | High | Triangulation across ≥4 sources by Phase C. Calibration tracking. |
| Video misinformation / deepfake exposure | Medium | High | Verification gate. No unverified breaking video. |
| Op-ed copyright exposure | Medium | High | Snippet + link-out free; licensing only where revenue justifies. |
| Alert fatigue | High | Medium | Severity thresholding. User-controlled categories. |
| Infographic accuracy at scale | Medium | High | Auto-gen only for structured data. Human review for hand-curated. |
| Scope creep | High | High | This document. Kill list. Tests. |
| Conversion funnel underperforms | Medium | High | A/B test. Adjust intensity. Freemium fallback. |
| Competitive entry | Medium | High | Move fast. Methodology moat. API consumer lock-in. |
| Source legal exposure | Medium | High | Brief excerpts + attribution. Legal review Phase D. |
| Cost runaway on AI inference | Medium | Medium | Local model routing. Cost dashboards. |
| Hostinger / infra limits | Medium | Medium | Container plan. Migration path documented. |
| Geopolitical content risk | Low | High | Editorial guidelines. Multi-source requirement. |
| Codex / agent execution drift | High | High | Mandatory deploy verification. Smoke tests. |
| DrJ-time conflict | High | High | Phases scoped for realistic velocity. |
| **NEW: Translation accuracy on geopolitics** | Medium | High | **Hybrid translation; human review for sensitive content; provenance markers; correction process.** |
| **NEW: Source over-dependence on free RSS** | Medium | Medium | **Phase D licensing deals reduce dependence. Source diversity index enforced.** |
| **NEW: Social platform algorithm dependency** | High | High | **Multi-platform from Phase B (no single platform >40% of social-driven traffic). Email list as primary owned channel. Direct site traffic as goal.** |
| **NEW: Social platform terms-of-service changes** | High | Medium | **Multi-platform mitigates. No single-platform-dependent revenue assumption. Owned channels (newsletter, app) as long-term priority.** |
| **NEW: Social content brand-damage** (one viral mistake) | Medium | High | **Human review on Phase B; AI-agent review with confidence thresholding Phase C+; never auto-publish breaking news without human gate. Crisis playbook documented.** |
| **NEW: Source onboarding cost (engineering time)** | Medium | Medium | **Source onboarding playbook standardized. RSS-first reduces per-source cost. Agent-driven discovery in Phase C+.** |

---

## 12. How to Use This Document

This document is the source of truth for "is this on strategy?"

**Before adding any feature:**
- Which layer does this serve? (1, 2, both, bridge?)
- Which capability does it use or improve?
- Which audience benefits?
- Which success metric will it move?
- **NEW: Does it have a social distribution angle? If yes, is the engine going to handle it automatically or will it need bespoke work?**
- If none of the above, kill it.

**Before approving any code change:**
- Which phase is this in?
- Which exit criterion does it contribute to?
- Is there a deploy-verification step?

**Before each phase kicks off:**
- Re-read Section 1, Section 8, Section 10
- Confirm prior phase exit criteria
- Update decisions log if shifted
- Reassess risks

**Quarterly review:**
- Score against metrics
- Update risk register
- Reaffirm or revise kill list
- Update decisions log
- Bump version on structural change

---

## Appendix A — Mapping Tactical Plans to Strategic Phases

| Tactical Item | Phase | Layer / Capability |
|---|---|---|
| Step 0 (worktree sync) | A | Foundation |
| P0-1 to P0-6 | A | Foundation |
| P1-1 to P1-7 | A | Foundation |
| **NEW: Source audit and gap analysis** | A | Cap. 1 |
| P2-1 (homepage redesign — comprehension layer) | B | Layer 1 + Bridge |
| First 10-15 flagship trackers | B | Cap. 2 / Layer 1 |
| Tracker infrastructure | B | Cap. 2 |
| Op-ed aggregation MVP | B | Cap. 2 / Layer 1 |
| Video clip curation + verification | B | Cap. 2 / Layer 1 |
| Breaking news engine v1 | B | Cap. 1 + 4 |
| **NEW: Source matrix expansion to ≥150** | B | Cap. 1 |
| **NEW: Source quality scoring infrastructure** | B | Cap. 1 |
| **NEW: Social Media Engine v1 (X, LinkedIn, Instagram)** | B | Cap. 4d |
| **NEW: Per-platform content templates + brand voice** | B | Cap. 4d |
| Newsletter products (3) | B | Layer 1 |
| Mobile-first redesign | B | Layer 1 |
| Accessibility audit | B | Both |
| Multi-source prediction integration | C | Cap. 3 |
| Calibration tracking | C | Cap. 3 |
| Source divergence alerts | C | Cap. 3 / Layer 2 |
| Tracker library expansion | C | Cap. 2 |
| Op-ed credibility scoring | C | Cap. 2 |
| Video verification layer | C | Cap. 2 |
| Entity extraction + pages | C | Cap. 2 |
| Source credibility scoring | C | Cap. 2 |
| Search overhaul | C / D | Both |
| Semantic dedup | C | Cap. 1 |
| **NEW: Source matrix to ≥300; translation pipeline (4 languages)** | C | Cap. 1 |
| **NEW: Social Media Engine v2 (+ Threads, Bluesky, Facebook, YouTube Shorts); first social revenue** | C | Cap. 4d |
| Premium subscription launch | D | Layer 2 |
| API v2 + tiered access | D | Cap. 4a |
| Custom alert rules + webhooks | D | Cap. 4b / Layer 2 |
| Embed catalog | D | Cap. 4a |
| Tracker data downloads | D | Layer 2 |
| **NEW: Source matrix to ≥500; first paid publisher licensing deals** | D | Cap. 1 |
| **NEW: Social Media Engine v3 (+ TikTok, YouTube long-form); social monetization** | D | Cap. 4d |
| Editorial layer | E | Layer 2 |
| Mobile native app | E | Both |
| Arabic language UI | E | Layer 1 |
| AgentX integration | E | Cap. 4 |
| Mega-trackers for top 5-10 stories | E | Cap. 2 |
| Postgres migration (if needed) | E | Foundation |
| **NEW: Source matrix to ≥800; full local-language coverage; reciprocal embed deals** | E | Cap. 1 + 4a |
| **NEW: Social Media Engine v4 (full multi-platform + podcast); social as major revenue stream** | E | Cap. 4d |

---

## Appendix B — One-Sentence Tests

**For features and surfaces:**
- *"Does this serve Layer 1, Layer 2, both, or the bridge?"*
- *"Could this run on a generic portal homepage?"* If yes, reconsider.
- *"Would a Yahoo News reader find this useful?"* (Layer 1.)
- *"Would a Bloomberg Terminal user find this useful?"* (Layer 2.)
- *"Would a journalist cite this?"* (Layer 2 quality.)
- *"Would a developer pay for this via API?"* (Capability 4.)
- *"Does this make returning users come back?"*
- *"Does this event have a chart, map, or tracker that explains it?"*
- *"Are we relying on more than one prediction source?"*
- *"Would this alert deserve to interrupt a user's day?"*
- *"Are we showing op-eds from more than one perspective?"*
- *"Is this video verified, and is the verification visible?"*
- **NEW: *"Have we considered sources from all priority regions for this story?"* If three regions matter and only one is represented, expand.**
- **NEW: *"Does this story have a social media format — single chart, thread, video clip, carousel — that showcases our analysis?"* If no, the social engine isn't doing its job.**
- **NEW: *"Would this social post drive traffic AND revenue, or just engagement?"* Engagement-only posts are vanity metrics.**
- **NEW: *"Can we publish this in any of our supported languages, or only English?"* Multilingual coverage is a moat.**

**For editorial:**
- *"Is this fact-checked enough to publish under Scoopfeeds?"*
- *"Could a competitor reproduce this in a week?"*
- *"Would I bet my reputation on this brief / tracker number / social post?"*

**For engineering:**
- *"Is this a data-spine improvement or a layer-specific feature?"* Spine first.
- *"Will this still matter at 10x events?"*
- *"Does this make the deploy more or less risky?"*

**For sources (NEW):**
- *"Where does this story show up in our source matrix?"* Empty cells are gaps.
- *"Is this source authoritative for this category and region?"* If not, why are we ingesting it?
- *"What is this source's credibility score, and how does it weight against contradicting sources?"*

**For social (NEW):**
- *"Which goal is this post serving — recognition, traffic, conversion, or revenue?"* All four is rare; one is normal.
- *"Has the platform-specific tone been applied, or is this cross-posted text?"*
- *"What's the link-out destination, and is it the right depth for the audience hitting it?"*

---

## Appendix C — Comparison Set (Detailed)

### Layer 1 — News surfaces
**Yahoo News.** Steal: scanability, breaking prominence. Avoid: clutter.
**Al Jazeera English.** Steal: voice, regional, video. Avoid: regional retreat.
**Reuters.com.** Steal: reliability signaling. Avoid: paywall maze.
**BBC News.** Steal: mobile UX, accessibility, multilingual. Avoid: institutional blandness.
**Google News.** Steal: freshness, source diversity. Avoid: shallow aggregation.

### Layer 1 — Data and infographics
**The Economist.** Steal: chart literacy, methodology footnotes.
**NYT Upshot.** Steal: explanatory data journalism.
**Reuters Graphics.** Steal: production values, animation discipline.
**FT Visual Journalism.** Steal: investigative depth + visual rigor.
**Our World in Data.** Steal: methodology transparency, downloadable data.
**Visual Capitalist.** Steal: shareability, single-image clarity.

### Layer 1 — Perspectives
**AllSides, Ground News.** Steal: ideological framing.
**The Browser, RealClearPolitics.** Steal: editorial curation discipline.

### Layer 1 — Video
**Reuters TV, Al Jazeera, AP video.** Steal: production, breaking-event speed.

### Layer 2 — Intelligence
**Bloomberg Terminal.** Steal: density, real-time, methodology. Avoid: pricing tier, finance-only.
**Reuters Eikon.** Steal: alerts, watchlists. Avoid: UX complexity.
**FT Pro.** Steal: premium positioning. Avoid: methodology opacity.
**Stratfor, Crisis Group.** Steal: subscription model, methodology rigor.
**GZERO Media.** Steal: video formats, personality framing.
**AlphaSense.** Steal: search-first UX, enterprise sales motion.

### Layer 2 — Probability
**Polymarket.** Steal: liquidity-driven price signals on US events.
**Kalshi.** Steal: regulated mainstream coverage.
**Metaculus.** Steal: calibration discipline, long-tail policy coverage.
**Good Judgment.** Steal: forecasting rigor.
**PredictIt, Manifold.** Steal: niche coverage.

### Bridge — Programmatic distribution
**Reuters Connect.** Steal: programmatic distribution model.
**AP wire.** Steal: machine-readable formats, enterprise SLAs.
**AlphaSense.** Steal: API economy.

### Social — Data-driven content brands (NEW section, primary models for the social engine)
**Visual Capitalist.** ~1.5M+ Instagram followers. Steal: infographic-as-brand strategy, sponsored-content discipline, daily cadence on social-native data viz. Avoid: clickbait drift on lesser-quality posts.
**Chartr / Sherwood News.** Steal: chart-of-the-day discipline, witty captions, financial-data → narrative storytelling. Avoid: overly US-centric framing.
**Morning Brew.** Steal: newsletter + social cross-promotion, voice consistency, monetization through brand partnerships. Avoid: superficiality on hard news.
**Bloomberg Quicktake.** Steal: social-native video format, breaking + analysis pairing. Avoid: corporate stiffness.
**The Economist Espresso (Instagram).** Steal: minimalist visual design, daily summary cadence. Avoid: paywall friction visible in social.
**NowThis News.** Steal: mobile-native video, captions-first, emotional resonance for breaking news. Avoid: editorial drift toward partisanship.
**Our World in Data (social presence).** Steal: methodology transparency, data citation discipline.
**Bellingcat.** Steal: investigative threads on X, citizen-journalism credibility framing.

### Newsletter — Cross-promotion peers (NEW section)
**Morning Brew, Axios, Stratechery, Sinocism, The Browser.** Steal: cadence discipline, voice consistency, conversion mechanics from free → premium.

---

*End of document. v4.0.*
