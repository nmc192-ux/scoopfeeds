# Scoopfeeds Strategic Plan v5.0
## One Event Graph. Two Layers. Three Revenue Streams. Comprehension at the Core. Distribution as a Discipline. Search as the Front Door.

**Document type:** Strategic north-star
**Version:** 5.0 (supersedes v4.0)
**Owner:** DrJ (Founder)
**Review cadence:** Quarterly
**Last updated:** May 2026

---

## 1. The Vision

Scoopfeeds is **one event graph powering two reader experiences and three revenue streams**, with **comprehension at the core, distribution as a discipline, and search as the front door.** A shared data spine ingests, clusters, enriches, tracks, and analyzes global events from a comprehensive source matrix. Two distinct surfaces present that data at different depths to two different audiences. Three revenue streams compound on a single cost base. Every story includes the visual, quantitative, and analytical scaffolding that lets a reader actually understand what happened. Every event becomes content for multiple distribution channels. And every user query — whether typed into the search bar or arriving from elsewhere on the web — is met with intelligence-grade answers, not generic web results.

### The architectural principle

**One event graph. Two presentation layers. Three monetization streams. Every event has a Tracker. Every story is multi-channel by default. Every search returns intelligence, not links.**

This is the principle that makes the ambition feasible for a small team. The same ingestion pipeline, dedup logic, enrichment workers, prediction triangulation, and tracker infrastructure feed both layers. The same per-event content is projected automatically into newsletters, social posts, embeds, and API outputs. The same source-credibility scoring that ranks news sources also ranks search results. Cost is amortized across audiences and channels.

### The two layers

**Layer 1 — The Newsroom.** Fast, mobile-first, broadly accessible. Yahoo News + Al Jazeera English bar, with quantitative trackers, multi-perspective op-eds, verified video, and an intelligence-augmented search portal on every major event. Free, ad-supported.

**Layer 2 — The Intelligence Desk.** Research-grade analytical workstation. Bloomberg Terminal + Reuters Eikon bar, scaled for non-financial events: multi-source prediction triangulation, full Event Dossiers with downloadable data, custom alert rules, watchlists, source credibility scoring, advanced and semantic search with credibility filters, programmatic API access. Subscription-priced.

### The bridge

Every event exists in both layers at different depths. Stories are not written twice; they are projected from the same event graph. **Search is now a primary conversion vector** — the moment a user searches, they discover Scoopfeeds; the moment they want filtered/advanced/no-ad search, they discover Layer 2.

### The positioning sentence

**"Read the news. See the data. Hear the perspectives. Decode the signals. Search like an analyst."**

Five verbs, five capabilities, one platform.

### The honest comparison set

| Surface | Aspirational peers | What we take |
|---|---|---|
| **Layer 1 — News** | Yahoo News, Al Jazeera English, Reuters.com, BBC News | Speed, mobile UX, regional voice |
| **Layer 1 — Data viz** | The Economist, NYT Upshot, Reuters Graphics, FT Visual Journalism, Our World in Data, Visual Capitalist | Quantitative storytelling, methodology |
| **Layer 1 — Perspectives** | AllSides, Ground News, The Browser | Multi-perspective framing |
| **Layer 1 — Video** | Reuters TV, Al Jazeera, AP, broadcaster YouTube | Verified video |
| **Layer 1 — Search** | **Perplexity, Brave Search, You.com, Phind, Andi, DuckDuckGo** | **AI-augmented answers, source citations, privacy posture, entity awareness** |
| **Layer 2 — Intelligence** | Bloomberg Terminal, Reuters Eikon, FT Pro, Stratfor, Crisis Group, GZERO | Density, real-time, credibility |
| **Layer 2 — Probability** | Metaculus, Good Judgment, Polymarket, Kalshi, PredictIt | Multi-source aggregation, calibration |
| **Layer 2 — Search** | **Kagi, AlphaSense, Bloomberg internal search, Factiva, Westlaw** | **No-ads premium search, credibility filters, professional-grade discovery, citation-ready results** |
| **Bridge — Distribution** | Reuters Connect, AP wire, AlphaSense | Programmatic distribution |
| **Social — Data brands** | Visual Capitalist, Chartr, Morning Brew, Bloomberg Quicktake, NowThis | Social-native data storytelling |

---

## 2. Where We Stand (Honest Assessment)

Scoopfeeds today is a feature-rich monolith with strong architectural ambition but weak operational discipline. Backend hardening exists in code but has not reached production. Frontend has not been touched. The platform has no quantitative trackers, no breaking news engine, no op-ed aggregation, single-source predictions, a thin source base, no engineered social distribution, **and a basic SQLite FTS5 search that doesn't even fully serve internal content discovery, let alone web search.**

**Assets:** Reality Index architecture, multi-source ingestion infrastructure, public API and embed scaffolding, multilingual base, founder domain expertise, regional access advantage, YouTube ingestion, **sqlite-vec scaffolding already in place for semantic search.**

**Liabilities:** Production runs old architecture; homepage signals "portal"; source base shallow and regionally skewed; corpus single-language-dominant; **search is keyword-only FTS5 and only over Scoopfeeds' own content**; dedup is fragile; no tracker layer; no breaking news engine; single-source prediction; no op-ed aggregation; no video curation; no social distribution engine; **no web search portal; no AI-augmented answers; no entity-aware search; no source-credibility-weighted ranking.**

**Three biggest leverage points in v5:**
1. **Trackers + infographics layer** — turns Scoopfeeds from "news site" into "place you go to understand a story."
2. **Social distribution engine** — turns a credible platform into a known one.
3. **Search & Discovery portal** — captures user intent at the moment it forms; the highest-value behavior on the internet.

---

## 3. The Data Spine (Shared Infrastructure)

The data spine has **five core capabilities** in v5. Both layers consume them at different depths.

### Capability 1 — Live Event Stream + Breaking News + Source Curation Matrix

Carried forward from v4. Source matrix (16 categories × 10 regions × 10 source types). Targets ≥150 sources Phase B exit, ≥300 Phase C exit, ≥500 Phase D exit, ≥800 Phase E. Source quality scoring (0-100). Translation pipeline. Breaking news engine.

### Capability 2 — Event Dossier (Comprehension Layer)

Carried forward from v3/v4. Synthesis + enrichment + tracker + infographics + perspectives (op-eds) + video evidence + source triangulation + related events.

### Capability 3 — Reality Index (Multi-Source Probability Triangulation)

Carried forward from v3/v4. Polymarket + Kalshi + Metaculus + Good Judgment + AI estimates + survey data, aggregated weighted by calibration.

### Capability 4 — Intelligence Distribution & Audience Engine

Carried forward from v4. Programmatic distribution (4a), alert delivery (4b), newsletter (4c), social media engine (4d).

### Capability 5 — Search & Discovery Portal (NEW)

A purpose-built search experience that sits at the front door of Scoopfeeds and captures user intent for intelligence-flavored queries. Not a Google replacement — a Scoopfeeds-grade search that wins for events, geopolitics, public health, climate, governance, and analytical queries, with general web search as a fallback.

#### The model

The model is **Perplexity (AI-augmented answers with citations) × Kagi (premium quality, no spam, ad-free option) × AlphaSense (entity-aware, professional)**, with Scoopfeeds' source credibility ledger as the ranking spine.

When a user searches "polio Pakistan 2026," the result is:
1. **Scoopfeeds tracker** as the top result (if relevant) — direct link to the polio tracker with WHO data, regional breakdown, recent news.
2. **AI-generated summary** with inline citations — a 3-5 sentence answer drawing from authoritative sources, each fact citable.
3. **Scoopfeeds event coverage** — recent events, dossiers, op-eds, video clips related to the query.
4. **Web results** ranked by source credibility — only high-credibility sources surface above the fold; low-credibility sources are de-ranked or filtered.
5. **Related entities** — sidebar showing actors, places, organizations connected to the query.
6. **Suggested watchlists** — premium teaser for tracking the topic over time.

For general queries (e.g., "how to bake bread"), Scoopfeeds returns clean web results with the same credibility ranking but no AI summary or intelligence overlay — politely degrading to a useful general-purpose search rather than shoving intelligence framing where it doesn't fit.

#### Sub-capabilities

**5a — Internal search.** Search across Scoopfeeds' own content: events, dossiers, trackers, articles, op-eds, videos, briefs. Already partly exists (FTS5); needs upgrade to entity + semantic + credibility-weighted in Phase C.

**5b — Web search backbone.** Third-party search index that powers general web results. Options:
- **Brave Search API** (independent index, ~$3-9 per 1000 queries, no Google dependency)
- **Exa.ai** (semantic-first, AI-native, good for long-tail content)
- **Bing API replacement** (Microsoft's offering; pricing in flux)
- **Mojeek** (independent but smaller index)
- **Google Programmable Search** (cheap but Google-dependent and limited)
Recommendation: **Brave as primary backbone (independence, reasonable cost), Exa.ai for semantic queries (Layer 2 advanced), with the option to add a second backbone for redundancy in Phase D.**

**5c — AI generative answers.** Perplexity-style summarization with citations. Built on top of:
- AI inference layer already in place (Claude, GPT-class, deepseek-r1 for routing)
- Source credibility scoring from Capability 1 (only high-credibility sources cited)
- Hallucination guardrails: every claim must be citable, citations link to source pages, "I don't know" preferred over fabrication
- Multi-model routing: cheap models for routine queries, premium models for complex analytical queries

**5d — Source credibility-weighted ranking.** The differentiator. Web results are re-ranked using Scoopfeeds' source quality scores. Spam, low-credibility content farms, and known-unreliable sources are filtered or de-ranked. High-credibility sources (wire services, primary research, established broadcasters) surface first. This is the moat that distinguishes Scoopfeeds Search from any generic search portal.

**5e — Search advertising.** Layer 1 (free tier) shows sponsored links above organic results — clearly labeled, contextually relevant, never deceptive. Layer 2 (premium tier) is ad-free. Search ads become a meaningful revenue stream once monthly query volume exceeds ~100K.

#### Design principles

- **Honesty first.** AI answers cite sources. If sources disagree, the answer says so. If we don't know, we say so.
- **Credibility-weighted by default.** Low-credibility sources are filtered, not just de-ranked.
- **Entity-aware.** Searching "Modi" surfaces a person; searching "Modi visit Saudi Arabia" surfaces an event; searching "Indian elections" surfaces a tracker.
- **Privacy-respecting.** No personalized search based on cross-site tracking. Logged-in users get personalization based on their watchlists; anonymous users get clean results.
- **Speed.** Search results within 800ms p95. AI summaries within 3s p95. Web results stream as they arrive.
- **No SEO spam.** Affiliate-linked content farms, keyword-stuffed pages, and AI-generated low-quality content are aggressively filtered.

#### Layer differentiation

*Layer 1 search:*
- Free, ad-supported
- AI summary (basic model, single-pass)
- Web results with credibility ranking
- Scoopfeeds dossier promotion
- Daily query limit for anonymous users (e.g., 20/day) to encourage sign-up

*Layer 2 search:*
- No ads
- Advanced AI answers (premium model, multi-step reasoning, deeper citations)
- Semantic search across Scoopfeeds' full archive
- Faceted filters (date, source, source-type, region, category, credibility threshold)
- Entity-only search ("show me everything about person X")
- Credibility-threshold filter ("only sources scored ≥80")
- Saved searches with email/webhook alerts on new matches
- Citation export
- Higher / unlimited query limits
- Search via API for institutional use

#### Cost economics

- Brave Search API at ~$5/1000 queries: 1M queries/month = $5,000/month
- AI inference for generative answers: ~$0.01-0.05 per answer at typical models = $5-25K/month at 1M answers
- Total search infrastructure cost at 1M queries/month: ~$10-30K/month
- Revenue offsets at 1M queries/month: search ads ($15-50K/month at typical CPMs), premium conversions (~$2-5K/month at 0.1-0.3% conversion to $19/month tier)
- **Self-sustaining at ~500K queries/month; profitable at 1M+**

---

## 4. Layer 1 — The Newsroom

### Audience
Ordinary news readers globally, with strength in South Asia, Middle East, broader Muslim-world readership.

### Surfaces (carried forward from v4 with search portal added)
- Homepage with Reality Index strip, **prominent search bar**, breaking news banner, top tracked events with thumbnail trackers, regional cluster, video shorts row, newsletter signup
- **NEW: Search portal at `/search` with full-page experience** — AI summary, web results, Scoopfeeds intelligence overlay, related entities sidebar
- Topic pages (event-centric)
- Regional pages
- Event pages (Layer 1 view)
- Trackers index
- Breaking news feed
- Video page
- Perspectives page
- Newsletter products
- Mobile experience (PWA, web push, shorts feed)
- Social-driven landing pages
- **NEW: Search-driven landing pages** — UTM-tagged, optimized for query-intent matching

### Distinctive
- South Asian and Muslim-world coverage
- Quantitative tracker on every major event
- Multi-perspective framing
- Verified video clips
- Reality Index teasers
- Breaking news with context
- Multilingual from day one
- Social-native presence
- **NEW: Search that returns intelligence, not just links** — the differentiator that captures intent

### Monetization
Display advertising, free newsletter (conversion funnel), affiliate revenue tasteful and below the fold, social platform direct revenue, **search advertising (sponsored links above organic results, clearly labeled).**

### Domain
`scoopfeeds.com` — primary front door for organic search, direct visits, social link-outs, **and Scoopfeeds Search itself.**

---

## 5. Layer 2 — The Intelligence Desk

### Audience
Journalists, policy researchers, intelligence analysts, traders, academics, developers.

### Surfaces (carried forward from v4 with advanced search added)
- Reality Index dashboard (multi-source)
- Event Dossier (Layer 2 view) with downloadable data
- Trackers (deep, with custom queries)
- Watchlists and custom alerts
- Anomaly feed
- Perspectives engine
- Video archive
- Source credibility ledger
- **NEW: Advanced search portal** — no ads, full Scoopfeeds archive, semantic search, credibility-threshold filter, faceted filters, saved searches with alerts, entity-only search, citation export, API access
- Historical archive
- API console
- Embed catalog
- Methodology documentation
- Premium licensed publisher content (Phase D+)

### Monetization
Premium subscription ($19/month, $190/year), professional tier ($49/month with API access), institutional licensing ($99-199/seat for teams), tiered API pricing (now includes search API access for institutions), embed licensing, sponsored intelligence briefs (Phase E).

### Domain
`intel.scoopfeeds.com`

---

## 6. The Bridge (How the Layers Connect)

v5 adds search as a primary conversion vector alongside the existing mechanisms.

### Acquisition funnel
**Discovery:** **search (Scoopfeeds Search itself, plus Google/Bing for SEO),** social media, direct.
**First visit:** search query → Scoopfeeds Search results → Layer 1 destination (event, tracker, dossier) → newsletter signup or article read.
**Regular visit:** Layer 1 → newsletter open → return.
**Conversion:** Layer 1 → soft paywall on premium feature → trial → premium subscriber.

### Conversion mechanics (v3 + v4 + v5 additions)
- All v4 mechanisms carried forward
- **NEW: Anonymous search query limit (e.g., 20/day) → sign-up gate after exceeded → newsletter or premium trial offered**
- **NEW: Advanced search features (semantic, faceted, credibility filter, saved alerts) gated to Layer 2 — visible but locked for free users**
- **NEW: Search ads in Layer 1 disappear when user upgrades to Layer 2** — concrete value of premium ("ad-free search")
- **NEW: Search citation export gated to Layer 2** — for the academic/journalist audience, this is a meaningful trigger

### Quality compounds
The shared event graph means data-spine improvements lift all five capabilities. A new prediction source benefits Layer 1 (signal), Layer 2 (drilldown), social engine (post material), AND search (better citations). A new tracker type benefits all four. Search & discovery is a *consumer* of every other capability — when search works well, every other investment becomes more visible to users.

---

## 7. The Kill List (Refined for v5)

| Module / pattern | Decision | Rationale |
|---|---|---|
| Cars section | Kill | Off-strategy. |
| Generic magazine modules on homepage | Kill | Portal clutter. |
| X feed widget on homepage | Kill | Off-brand. |
| Tip jar widget | Move to footer | Premature monetization. |
| Affiliate widgets on homepage | Kill or move below fold | Erodes credibility. |
| `LiveTVChannelEmbed` | Delete | Dead in code. |
| Generic "most read" sidebar | Replace | "Top tracked events." |
| Single-source prediction signals | Refactor | Multi-source by Phase C. |
| Plain text-only event cards | Refactor | Trackers + perspectives by Phase B. |
| Unverified citizen video | Reject from Layer 1 | Verification gate. |
| Manual / sporadic social posting | Kill | Replace with engineered Social Media Engine. |
| Source-by-source ad-hoc onboarding | Kill | Replace with systematic source matrix. |
| **Basic FTS5-only search** | **Refactor** | **Replace with full Search & Discovery portal in Phase B (internal upgrade) and Phase C (web search + AI answers).** |
| **Generic search bar with no AI overlay or credibility ranking** | **Refactor** | **Search must serve intelligence positioning by Phase C.** |
| Video coverage | Keep, redesign | Layer 1 furniture done well. |
| Regional pages | Keep, deepen | Differentiator. |
| Topic feeds | Keep, restructure | Event-centric. |
| Newsletter products | Keep, expand | Conversion funnel. |
| Breaking news | Keep, build engine | Named capability. |
| Live TV section | Move off homepage | Live-event hub. |

---

## 8. Success Metrics

### Data spine metrics
- Events tracked simultaneously: 500+
- Events with active trackers: ≥50 by Phase B exit, ≥200 by Phase D exit
- Active sources: ≥150 / ≥300 / ≥500 / ≥800 by Phase B/C/D/E exits
- Sources per (category × region) cell filled: ≥80% of priority cells by Phase C exit
- Languages with ingestion: ≥4 by Phase C, ≥7 by Phase E
- Prediction sources integrated: ≥4 by Phase C, ≥6 by Phase D
- Source diversity index: no source >10%, ≥6 regions, ≥3 source types
- Time-to-first-cluster: ≤30 minutes
- Time-to-first-alert: ≤15 minutes
- Dedup accuracy: <5% false-positive
- Brief accuracy: ≥90%
- Tracker accuracy: ≥95%

### Layer 1 metrics
- DAU baseline by Phase B
- Returning user rate (7-day): ≥35% by Phase C
- Average session depth: ≥3 events
- Newsletter open rate: ≥35%
- Newsletter subscribers: ≥10,000 / ≥30,000 by Phase C/D
- Mobile Lighthouse: ≥90
- Time-on-site (returning): ≥4 minutes
- Tracker page time-on-site: ≥5 minutes
- Web push opt-in: ≥15%
- Breaking alert click-through: ≥25%
- Video clip play rate: ≥30%
- Social-driven traffic share: ≥30% by Phase D
- Social → newsletter conversion: ≥3%

### Layer 2 metrics
- Premium subscribers: ≥500 within 12 months
- API consumers (active): ≥10 within 6 months of launch
- Embed installs: ≥50 within 12 months
- Premium retention (90-day): ≥80%
- Layer 2 DAU / Premium subs: ≥40%
- Reality Index DAU as share of Layer 2: ≥60%
- Layer 1 → Layer 2 conversion: ≥1% of returning users
- Tracker data downloads: ≥500/month by Phase D
- Custom alert rules per active premium user: ≥3

### Social media metrics
- Combined followers: ≥10,000 / ≥50,000 / ≥250,000 by Phase B/C/D
- Average engagement rate per post: ≥3%
- Click-through to scoopfeeds.com: ≥1% of impressions
- Direct social revenue: ≥$500 / ≥$5,000 / ≥$25,000 per month by Phase C/D/E
- YouTube subscribers (long-form): ≥10,000 by Phase E
- Posts per platform per week: per platform target

### Search & Discovery metrics (NEW section)
- **Search queries per month: ≥10,000 by Phase B exit, ≥100,000 by Phase C exit, ≥500,000 by Phase D exit, ≥1,000,000 by Phase E exit**
- **Search → site retention (user does another action): ≥40% (industry benchmark ~25%)**
- **Search → newsletter conversion: ≥2% of unique searchers**
- **Search → premium conversion: ≥0.2% of unique searchers**
- **AI answer accuracy (citation accuracy on weekly audit): ≥95% (every claim must be supported by cited source)**
- **AI answer hallucination rate: <1% (zero tolerance for fabricated facts)**
- **Average search latency (p95): ≤800ms for results, ≤3s for AI summary**
- **Search ad CTR: ≥2% (industry benchmark 1%)**
- **Search ad revenue per query: ≥$0.02 by Phase D, ≥$0.05 by Phase E**
- **Layer 2 search query share: ≥20% of Layer 2 DAU sessions involve advanced search by Phase D**

### Operational metrics
- Production uptime: ≥99.5%
- Scheduler last-run age: ≤15 minutes
- Failed BullMQ rate: <1%
- AI inference cost per event: trending down
- Alert delivery latency p95: ≤30s web push, ≤5min email
- Social post generation cost per post: ≤$0.05
- **NEW: Search backbone API cost per query: ≤$0.005 (must be tightly managed)**
- **NEW: AI answer cost per query: ≤$0.03 (cheap model routing for routine queries)**

---

## 9. Phased Roadmap

### Phase A — Stabilize (Now → 4 weeks)
**Strategic goal:** Production runs new architecture. Foundation sound.

**Work:** All v4 Phase A work + **NEW: Audit existing search infrastructure (FTS5 + sqlite-vec scaffolding); document the path to Phase B internal search upgrade.**

### Phase B — Launch Layer 1 with Comprehension + Distribution + Internal Search (Months 1–3)
**Strategic goal:** Layer 1 launches with comprehension layer, social distribution engine, AND upgraded internal search baked in. Web search backbone integrated as preview.

**Work (additions to v4 Phase B):**
- All v4 Phase B work
- **NEW: Internal search upgrade** — entity-aware, semantic (using existing sqlite-vec), credibility-weighted ranking across Scoopfeeds' own content (events, dossiers, trackers, articles, op-eds)
- **NEW: Web search backbone integration (Brave Search API)** — preview integration; web results visible but un-styled and behind a feature flag for Phase B
- **NEW: Search portal page (`/search`)** with new layout: search bar, AI placeholder, Scoopfeeds results, web results section
- **NEW: Search bar prominent on homepage** — replaces or complements existing search affordance

**Exit criteria additions:**
- Internal search returns entity + semantic + credibility-weighted results
- Web search backbone integrated (not yet polished or AI-augmented)
- ≥10,000 search queries/month
- Search returns dossiers/trackers as top results for ≥60% of category-relevant queries

### Phase C — Deepen the Data Spine + Scale Distribution + Launch AI-Augmented Search (Months 3–5)
**Strategic goal:** Data spine becomes premium-grade. Source matrix fills out. Social distribution scales. **Search becomes the differentiator with AI-generated answers and credibility-weighted web ranking.**

**Work (additions to v4 Phase C):**
- All v4 Phase C work
- **NEW: AI generative answers (Perplexity-style)** — multi-model routing, citation discipline, hallucination guardrails
- **NEW: Source credibility-weighted ranking applied to web results** — using the source quality scores from Capability 1
- **NEW: Entity-aware search results** — searching for a person/place/org surfaces structured information (Wikipedia-like card) plus events/dossiers
- **NEW: Search portal polished as a destination** — full-page experience, related entities sidebar, suggested watchlists
- **NEW: Search analytics dashboard** — query volumes, click-through, AI answer accuracy, latency

**Exit criteria additions:**
- AI generative answers live with ≥95% citation accuracy on weekly audit
- ≥100,000 search queries/month
- AI answer hallucination rate <1%
- Search becomes a measurable acquisition channel (≥10% of new newsletter signups attributed to search)

### Phase D — Launch Layer 2 + Monetize Distribution + Search Revenue (Months 5–8)
**Strategic goal:** Intelligence Desk launches. First non-ad revenue. Social media revenue meaningful. **Search ads launch as a revenue stream; advanced search features paywalled into Layer 2.**

**Work (additions to v4 Phase D):**
- All v4 Phase D work
- **NEW: Advanced search features moved into Layer 2** — semantic search across full archive, faceted filters, credibility-threshold filter, entity-only search, saved searches with alerts, citation export
- **NEW: Search ads launch on Layer 1** — sponsored links above organic results, clearly labeled, never deceptive
- **NEW: Layer 2 search is ad-free** — concrete value of premium
- **NEW: Search via API for institutional use** — enterprise customers can query Scoopfeeds Search programmatically
- **NEW: Daily query limit for anonymous Layer 1 users** (e.g., 20/day) to drive sign-ups
- **NEW: Saved searches with alert rules** as Layer 2 feature

**Exit criteria additions:**
- ≥500,000 search queries/month
- Search ad revenue ≥$5,000/month
- ≥50 saved searches per active premium user (median)
- Search-attributed premium conversions ≥0.2% of unique searchers

### Phase E — Expand (Months 8–12)
**Strategic goal:** Platform compounds. Editorial layer. Mobile native app. Premium scales. Social and search become major revenue streams. AgentX integration explored.

**Work (additions to v4 Phase E):**
- All v4 Phase E work
- **NEW: Multi-language search** — search results and AI answers in Arabic, Russian, Mandarin, Spanish, Portuguese, French (in addition to English and Urdu)
- **NEW: Search integration in mobile native app** — offline-first results for cached events; web search live
- **NEW: Voice search** for mobile (optional; quality depends on AI infrastructure)
- **NEW: Search backbone redundancy** — second backbone (e.g., Exa.ai or Mojeek) for redundancy and cost optimization
- **NEW: Topic-specific search portals** for institutional clients (e.g., "Pharma Intelligence Search," "Maritime Intelligence Search") as licensed products

**Exit criteria additions:**
- ≥1,000,000 search queries/month
- Search ad revenue ≥$25,000/month
- Multi-language search live in 7+ languages
- Search as ≥20% of total platform revenue

---

## 10. Strategic Decisions Required

Decisions 1-22 carried forward from v4. New decisions in v5 below.

[Decisions 1-22 unchanged from v4]

23. **NEW: Search backbone choice.** Brave Search API (independent, ~$5/1000 queries), Exa.ai (semantic-first, AI-native), Bing API replacement (Microsoft, in flux), Mojeek (independent but smaller), or hybrid approach? Recommend: **Brave as primary backbone for general web; Exa.ai for semantic queries (Layer 2 advanced); option to add second backbone in Phase D for redundancy.** Decision: ___

24. **NEW: AI generative answer model.** Single model (e.g., always Claude), multi-model routing (cheap for routine, premium for complex), or open-source self-hosted? Recommend: **multi-model routing — deepseek-r1 for routine queries, Claude/GPT-class for complex analytical queries, with cost dashboards from Phase C launch.** Decision: ___

25. **NEW: Search ad model.** Sponsored links above organic only (cleanest), display ads alongside (more revenue), or hybrid? Recommend: **sponsored links only — clearly labeled, contextually relevant, never disguised as organic. No display ads on search pages — maintains "Scoopfeeds-grade" feel.** Decision: ___

26. **NEW: Anonymous search query limits for Layer 1.** Unlimited (highest UX, no conversion pressure), 20/day (strong conversion driver), 50/day (light conversion pressure)? Recommend: **50/day in Phase B/C, 20/day in Phase D once value proposition is clearer.** Decision: ___

27. **NEW: Search advertising revenue split.** All search ads on Layer 1 only (Layer 2 is ad-free as premium value), or some sponsored content even in Layer 2 (more revenue, less premium)? Recommend: **Layer 2 entirely ad-free — "no ads" is concrete premium value worth protecting.** Decision: ___

28. **NEW: AI hallucination tolerance.** Zero-tolerance ("I don't know" preferred over fabricated answers), low-tolerance (block answers below confidence threshold), or trust-the-model (rely on training)? Recommend: **zero-tolerance — every claim citable, "I don't know" preferred over fabrication, weekly accuracy audits with public correction process.** Decision: ___

29. **NEW: Search portal branding.** "Scoopfeeds Search," "Scoopfeeds Discover," or unbranded ("Search" within Scoopfeeds)? Recommend: **"Scoopfeeds Search" as the named capability for marketing; just "Search" in the navigation. Avoid "Discover" — too overloaded across other products.** Decision: ___

30. **NEW: SEO posture for Scoopfeeds Search itself.** Should Scoopfeeds Search be itself indexed by Google/Bing (results pages crawlable for organic search traffic), no-indexed (privacy posture, no second-order indexing), or hybrid? Recommend: **noindex search results pages; index search portal landing page only.** Avoids duplicate content penalties and keeps focus on organic search to scoopfeeds.com directly. Decision: ___

---

## 11. Risk Register

[Risks 1-25 carried forward from v4. New risks in v5 below.]

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **NEW: Search API cost runaway** | Medium | High | **Per-query cost dashboards from Phase B. Daily query limits for anonymous users. Cache aggressively. Multi-backbone redundancy in Phase D for cost negotiation.** |
| **NEW: AI answer hallucination** | Medium | Critical | **Zero-tolerance policy. Citations on every claim. "I don't know" preferred over fabrication. Weekly audit with public correction log. Conservative confidence thresholds for breaking news queries.** |
| **NEW: Search backbone API terms changes** (Brave/Bing/Mojeek change pricing or terms) | Medium | High | **Multi-backbone option in Phase D. Internal index aspirational for Phase E if economics support. Avoid lock-in to single provider.** |
| **NEW: Search quality vs Google** (we'll never beat Google on general queries) | High | Medium | **Don't try. Win for intelligence/event/analytical queries; gracefully degrade to clean web results for general queries. Position as "Scoopfeeds for intelligence, Google for everything else." Don't compete head-on.** |
| **NEW: SEO spam manipulation of Scoopfeeds Search ranking** | Medium | Medium | **Source credibility scoring filters most spam. Manual blocklist for known spam farms. Aggressive filtering of AI-generated low-quality content.** |
| **NEW: Search ad quality** (low-quality ads erode credibility) | Medium | High | **Curated ad inventory in Phase D — direct sales only initially. No programmatic ad networks until ad quality framework is mature. Reject categories that conflict with positioning (gambling, crypto pump-and-dump, etc.).** |
| **NEW: Privacy backlash** (logged search history seen as surveillance) | Low | High | **Default: no logged search history for anonymous users. Logged-in users see history they can clear. Privacy policy clearly stated. Don't sell search data.** |

---

## 12. How to Use This Document

This document is the source of truth for "is this on strategy?"

**Before adding any feature:**
- Which layer does this serve? (1, 2, both, bridge?)
- Which capability does it use or improve?
- Which audience benefits?
- Which success metric will it move?
- Does it have a social distribution angle?
- **NEW: Does it have a search/discovery angle? Will users find it via search? Does it improve search results for relevant queries?**
- If none, kill it.

**Before approving any code change:**
- Which phase is this in?
- Which exit criterion does it contribute to?
- Is there a deploy-verification step?

**Before each phase kicks off:**
- Re-read Section 1, 8, 10
- Confirm prior phase exit criteria
- Update decisions log
- Reassess risks

**Quarterly review:**
- Score against metrics
- Update risk register
- Reaffirm or revise kill list
- Update decisions log
- Bump version on structural change

---

## Appendix A — Mapping Tactical Plans to Strategic Phases

[All v4 mappings carried forward. New entries below.]

| Tactical Item | Phase | Layer / Capability |
|---|---|---|
| **NEW: Internal search upgrade (entity + semantic + credibility-weighted)** | B | Cap. 5a |
| **NEW: Web search backbone integration (Brave Search API)** | B | Cap. 5b |
| **NEW: Search portal page (`/search`) v1** | B | Cap. 5 / Layer 1 |
| **NEW: AI generative answers with citations** | C | Cap. 5c |
| **NEW: Source credibility-weighted ranking on web results** | C | Cap. 5d |
| **NEW: Entity-aware search results** | C | Cap. 5 |
| **NEW: Advanced search features (Layer 2 paywall)** | D | Cap. 5 / Layer 2 |
| **NEW: Search advertising launch** | D | Cap. 5e |
| **NEW: Search via API for institutional use** | D | Cap. 5 + 4a |
| **NEW: Multi-language search** | E | Cap. 5 |
| **NEW: Search backbone redundancy (second backbone)** | E | Cap. 5b |
| **NEW: Topic-specific search portals (institutional licensing)** | E | Cap. 5 / Layer 2 |

---

## Appendix B — One-Sentence Tests

All v4 tests carried forward. New tests below.

**For search (NEW):**
- *"For an intelligence-flavored query, would the user find a better answer here than on Google?"* If no, why not?
- *"Does the AI answer cite every claim, with citations linking to the actual source?"*
- *"Are low-credibility sources filtered out of the top results?"*
- *"Does the search return Scoopfeeds dossiers/trackers when relevant, or are we hiding our own intelligence under generic web results?"*
- *"Is the search ad clearly distinguished from organic results, with no deception?"*
- *"For a general (non-intelligence) query, does the search degrade gracefully to clean web results without forcing intelligence framing where it doesn't fit?"*
- *"Would a researcher cite an AI answer from this search, or only the underlying sources?"* The answer should be: cite the sources, but the AI answer made finding them faster.

---

## Appendix C — Comparison Set (Detailed)

[All v4 entries carried forward. New search-related entries below.]

### Search — AI-augmented and intelligence-grade (NEW section)

**Perplexity AI.** ~$25M ARR in 2024, ~10M MAU. Steal: AI-generated answers with citations, focus mode for academic/finance/etc., copilot for follow-up queries. Avoid: cluttered UX in some places, occasional hallucination on weakly-cited topics.

**Kagi.** Subscription-based ($10/month), no ads, premium quality. Steal: ad-free as concrete value, "lenses" for filtering by source type, family-safe and academic modes, public source quality ratings. Avoid: small index limitations.

**Brave Search.** Independent index, ~30B pages. Steal: Goggles (user-defined ranking rules), source diversity, no Google dependency. Avoid: index gaps in long-tail content.

**You.com.** AI-augmented, multiple search modes. Steal: app-based search results (built-in apps for finance, dev, etc.). Avoid: cluttered interface, AI persona drift.

**Phind.** Developer-focused AI search. Steal: domain-focused excellence, GitHub/StackOverflow integration. Avoid: too narrow for general intelligence applications.

**Andi Search.** Conversational AI search. Steal: chat-style interface for follow-ups. Avoid: less suited to professional research workflows.

**DuckDuckGo.** Privacy-first, ~100M daily searches. Steal: privacy posture, instant answers, !bang shortcuts. Avoid: less differentiated on quality.

**AlphaSense.** Enterprise search for finance/research. Steal: search-first UX, entity awareness, document-level depth, enterprise contracts. Avoid: finance-only positioning.

**Factiva, Westlaw, Lexis.** Professional-grade specialized search. Steal: source-bounded search, citation export, watchlist alerts. Avoid: legacy UX, opaque pricing.

**Bloomberg internal search (BBQ).** Steal: entity-aware, news-feed integrated, methodology transparency. Avoid: not consumer-facing.

**Ground News (also a search).** Steal: source-bias visualization on every result, blindspot indicator. Avoid: limited to news, no general web search.

---

*End of document. v5.0.*
