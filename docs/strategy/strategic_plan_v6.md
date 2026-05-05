# Scoopfeeds Strategic Plan v6.0
## One Event Graph. Two Layers. Three Revenue Streams. Decisions Made. Ready to Build.

**Document type:** Strategic north-star (decision-integrated)
**Version:** 6.0 (supersedes v5.0)
**Owner:** DrJ (Founder)
**Companion documents:** Section 10 Decisions Log v1.0
**Review cadence:** Quarterly
**Last updated:** May 2026

**What changed from v5:**
- All 30 strategic decisions integrated (see Section 10 reference and Decisions Log v1.0)
- Entertainment & Culture added as 17th source matrix category with dedicated trackers and surfaces
- Tracker Auto-Detection Engine added as Capability 2 sub-capability
- Search product renamed "Scoop" (Decision 29)
- Alert channels updated: WhatsApp + Telegram replace SMS; Apple Messages dropped (Decision 13)
- Source onboarding workflow refined: AI proposes both priority cells AND candidate sources (Decision 16)
- Existing social automation (FB page, Instagram, Bluesky) acknowledged as upgrade base, not new build (Decision 19)
- Phase A scope expanded to include existing social media audit, source audit, search infrastructure audit
- Brave + Exa.ai confirmed as search backbones (Decision 23); multi-model AI routing for answers (Decision 24)

---

## 1. The Vision

Scoopfeeds is **one event graph powering two reader experiences and three revenue streams**, with comprehension at the core, distribution as a discipline, search as the front door, and entertainment alongside intelligence. A shared data spine ingests, clusters, enriches, tracks, and analyzes events across 17 categories from a comprehensive global source matrix. Two distinct surfaces present that data at different depths to two different audiences. Three revenue streams compound on a single cost base.

Every story includes the visual, quantitative, and analytical scaffolding that lets a reader actually understand what happened. Every event becomes content for multiple distribution channels. Every user query is met with intelligence-grade answers, not generic web results. The search experience itself is named **Scoop** — short, ownable, journalism-grounded.

### The architectural principle

**One event graph. Two presentation layers. Three monetization streams. Every event has a Tracker. Every story is multi-channel by default. Every search returns intelligence, not links.**

This principle makes the ambition feasible for a small team. The same ingestion pipeline, dedup logic, enrichment workers, prediction triangulation, tracker auto-detection, and credibility scoring feed both layers. The same per-event content is projected automatically into newsletters, social posts, embeds, and Scoop search results. Cost is amortized across audiences and channels.

### The two layers

**Layer 1 — The Newsroom.** Fast, mobile-first, broadly accessible. Yahoo News + Al Jazeera English bar, with quantitative trackers, multi-perspective op-eds, verified video, intelligence-augmented Scoop search, and entertainment coverage on every relevant event. Free, ad-supported. South Asian and Muslim-world coverage as differentiator.

**Layer 2 — The Intelligence Desk** (`intel.scoopfeeds.com`). Research-grade analytical workstation. Bloomberg Terminal + Reuters Eikon bar, scaled for non-financial events including entertainment and culture: multi-source prediction triangulation, full Event Dossiers with downloadable data, custom alert rules via WhatsApp/webhooks/Slack/Teams, watchlists, source credibility scoring, advanced semantic search, programmatic API access. Subscription-priced ($19/month, $190/year).

### The bridge

Every event exists in both layers at different depths. Stories are not written twice; they are projected from the same event graph. **Scoop is now the primary acquisition vector** — search captures user intent at the moment it forms, with conversion paths to newsletter signup and Layer 2 premium.

### The positioning sentence

**"Read the news. See the data. Hear the perspectives. Decode the signals. Search like an analyst."**

Five verbs, five capabilities, one platform. The search verb maps to Scoop.

### The honest comparison set

| Surface | Aspirational peers | What we take |
|---|---|---|
| Layer 1 — News | Yahoo News, Al Jazeera English, Reuters.com, BBC News | Speed, mobile UX, regional voice |
| Layer 1 — Data viz | The Economist, NYT Upshot, Reuters Graphics, FT Visual Journalism, Our World in Data, Visual Capitalist | Quantitative storytelling |
| Layer 1 — Perspectives | AllSides, Ground News, The Browser | Multi-perspective framing |
| Layer 1 — Video | Reuters TV, Al Jazeera, AP, broadcaster YouTube | Verified video |
| Layer 1 — Entertainment | Variety, Deadline, Hollywood Reporter, Box Office Mojo, Bollywood Hungama | Industry coverage with quantitative depth |
| Layer 1 — Search (Scoop) | Perplexity, Brave Search, You.com, DuckDuckGo | AI-augmented answers, source citations, privacy posture |
| Layer 2 — Intelligence | Bloomberg Terminal, Reuters Eikon, FT Pro, Stratfor, Crisis Group, GZERO | Density, real-time, credibility |
| Layer 2 — Probability | Metaculus, Good Judgment, Polymarket, Kalshi | Multi-source aggregation, calibration |
| Layer 2 — Search (Scoop Pro) | Kagi, AlphaSense, Bloomberg internal search, Factiva | No-ads premium, credibility filters, citation-ready |
| Bridge — Distribution | Reuters Connect, AP wire, AlphaSense | Programmatic distribution, API economy |
| Social — Data brands | Visual Capitalist, Chartr, Morning Brew, Bloomberg Quicktake, NowThis | Social-native data storytelling, multi-platform discipline |

---

## 2. Where We Stand

Scoopfeeds today is a feature-rich monolith with strong architectural ambition but weak operational discipline. Backend hardening exists in code but has not reached production. Frontend has not been touched. The platform has no quantitative trackers, no breaking news engine, no op-ed aggregation, single-source predictions, a thin source base, basic FTS5 search, and no intelligence-augmented search experience.

**Existing assets to build on:**
- Reality Index architecture with multi-source ingestion infrastructure
- Public API and embed scaffolding
- Multilingual base (English + Urdu)
- Founder domain expertise and regional access advantage
- YouTube ingestion already in stack
- TMDB ingestion already in stack (the foundation for Entertainment category)
- sqlite-vec scaffolding for semantic search
- **Auto-posting already operational on FB page, Instagram, and Bluesky** — content quality, visual treatment, and cross-platform discipline need upgrading; not a from-zero build

**Liabilities (gaps to close):**
- Production runs old architecture; deployment doesn't match the hardened code on `main`
- Homepage signals "portal" not "intelligence platform"
- Source base shallow and regionally skewed (~30-50 active sources, Pakistan-heavy, English-dominant)
- No tracker layer, no Tracker Auto-Detection Engine
- No breaking news engine
- Single-source prediction (Polymarket only)
- No op-ed aggregation
- No video curation or verification layer
- Existing social posting lacks coherent voice, brand kit, or analytical depth
- Search is FTS5-only over Scoopfeeds' own content; no web search portal, no AI-augmented answers, no entity awareness

**Three biggest leverage points:**
1. **Tracker Auto-Detection Engine + comprehension layer** — turns Scoopfeeds from "news site" into "place you go to understand a story."
2. **Scoop search portal** — captures user intent at the moment it forms; the highest-value behavior on the internet for an intelligence platform.
3. **Engineered social distribution** — turns a credible platform into a known one. Existing FB/Instagram/Bluesky setup is the upgrade base.

---

## 3. The Data Spine (Shared Infrastructure)

Five core capabilities. Both layers consume them at different depths.

### Capability 1 — Live Event Stream + Breaking News + Source Curation Matrix

Ingestion → clustering → dedup → ranking → breaking news signal detection → alert generation. The source matrix is the foundation under everything.

#### The Source Matrix (17 categories × 10 regions × 10 source types)

**Categories (17, with Entertainment & Culture added):**
Politics & Government · Conflict & Security · Economics & Markets · Health & Medicine · Climate & Environment · Science & Technology · Sports · Culture & Society · Religion · Migration & Refugees · Energy & Resources · Maritime & Shipping · Aviation · Agriculture & Food Security · Education · Human Rights · **Entertainment & Culture (NEW)**

**Regions (10):** North America · Latin America · Europe · Russia & Central Asia · Middle East & North Africa · Sub-Saharan Africa · South Asia · Southeast Asia · East Asia · Oceania & Pacific

**Source types (10):** Wire services · International broadcasters · National newspapers · Regional newspapers · Specialized publications · Think tanks & research orgs · Government & primary data · Independent journalism · Academic sources · Local-language sources

**Source onboarding workflow (Decision 16):**

The AI agent operates with more autonomy than v5 indicated:
1. AI agent runs weekly analysis: which (category × region × type) cells are below target source count? Which gaps in the matrix are most strategically valuable to fill?
2. AI agent crawls RSS directories, news APIs, Wikipedia infoboxes, and language-specific aggregators for candidates
3. AI agent presents weekly batch: priority cells flagged + ~50 candidate sources with metadata (ownership, language, frequency, RSS health, sample headlines, estimated credibility)
4. DrJ approves/rejects in ~30-minute weekly review
5. AI agent onboards approved sources and monitors ingestion health

**Source target progression:**
- Phase B exit: ≥150 active sources, no single source >10% of corpus, ≥6 regions covered daily
- Phase C exit: ≥300 active sources, ≥10 regions, ≥4 source types per major event, translation pipeline operational for Arabic + Russian + Mandarin (in addition to English + Urdu)
- Phase D exit: ≥500 active sources, paid licensing deals (Project Syndicate primary; one of Reuters wire / Foreign Affairs)
- Phase E exit: ≥800 active sources, full local-language coverage in 7+ languages

**Source quality scoring (0-100):** editorial track record, methodology transparency, domain expertise, independence (state/corporate/independent), historical accuracy. Public for premium tier (transparency moat); used internally for ranking.

**Translation pipeline (Decision 17):** AI-only translation for routine content. **Second-AI verification** automatically applied to sensitive content (war, politics, regional disputes, religious topics, named-person quotes). Human review only when AIs disagree or for highest-stakes geopolitical content. Provenance markers visible on every translated piece: "Translated from [language] by [AI model], [verification status]."

**Entertainment & Culture sources (new category):**
Box office data (Box Office Mojo, The Numbers), streaming analytics (Nielsen, Parrot Analytics), critical reviews (Rotten Tomatoes, Metacritic, IMDb), industry trade press (Variety, Deadline, Hollywood Reporter, Screen Daily), regional industries (Bollywood Hungama, Box Office India, Korean BIFF, Pakistani Lux Style Awards, Arabic content trackers), festivals and awards (Cannes, Venice, Toronto, Sundance, Oscars, Emmys, regional awards).

#### Breaking News Engine

A story is "breaking" when coverage volume spikes across diverse sources within a short window, source-type diversity is high, sentiment is high-magnitude, or a watchlisted entity appears. Triggers alert generation routed via Capability 4.

### Capability 2 — Event Dossier (Comprehension Layer) + Tracker Auto-Detection Engine

Every event accumulates: synthesis (brief, "what changed"), enrichment (actors, timeline), tracker (quantitative scorecard), infographics, perspectives (op-eds), video evidence, source triangulation, related events.

#### Tracker Auto-Detection Engine (NEW sub-capability)

The platform intelligence layer monitors event signals and automatically proposes when a new tracker should be created. This eliminates the bottleneck of hand-curating each tracker while validated templates encode best practices.

**Auto-detection signals by event type:**
- **Major war / armed conflict:** ACLED data spike + multi-source coverage threshold → conflict tracker template (casualties, hardware loss, territorial control, refugee flows)
- **Epidemic / outbreak:** WHO surveillance signal + case-count growth rate → outbreak tracker template (cases by country, deaths, vaccinations, regional spread)
- **Major accident / crash:** Aviation, maritime, or industrial incident with casualty floor → incident tracker template
- **Sports event:** Scheduled fixture + interest indicator → sports tracker template (games, standings, key stats)
- **Wildfire / environmental event:** NOAA/USGS/ACLED + news coverage threshold → environmental tracker template (extreme weather, displacement, damage)
- **Election / poll / referendum:** Scheduled date + competitive race indicator → election tracker template (polling, money, competitive races)
- **Major study release:** Journal publication + media pickup + topic relevance → study tracker template (findings, methodology, replication)
- **Entertainment release:** Release date + opening signal → entertainment tracker template (box office, streaming charts, critical reception)

**Workflow:** Auto-detect event → propose tracker template → AI agent reviews and proposes (or DrJ if novel category) → tracker instantiated using validated template → tracker auto-updates from configured data sources with human review on each instantiation.

**Tracker templates** are derived from trusted journalism conventions (Reuters Graphics methodology, WHO surveillance formats, ACLED reporting standards, Our World in Data conventions, Box Office Mojo presentation patterns) — not invented from scratch.

**Phase B target:** Tracker Auto-Detection Engine operational; ≥10 active trackers across the eight signal types.

*Layer 1 sees:* curated subset — brief + tracker (1-2 key metrics) + 1 infographic + 2-3 op-ed snippets + 1 video clip + dossier CTA.

*Layer 2 sees:* full dossier — all sources, all op-eds, downloadable data, all videos, sentiment matrix, citation export.

### Capability 3 — Reality Index (Multi-Source Probability Triangulation)

Probability inputs from multiple independent sources, aggregated weighted by calibration history.

**Phase C launch sources (Decision 11):** Polymarket + Kalshi + Metaculus + AI estimates.
**Phase D addition:** Good Judgment Open.
**Skipped:** Manifold (play-money, weak calibration), PredictIt (regulatory limbo).

Source divergence is itself a signal — large disagreement flags either contested questions or market inefficiencies. Methodology open and citable; weights and models proprietary (Decision 7).

*Layer 1 sees:* aggregated probability as "Signal of the day."
*Layer 2 sees:* full multi-source dashboard, per-source drilldown, divergence alerts, calibration histories, custom watchlists.

### Capability 4 — Intelligence Distribution & Audience Engine

Significantly expanded to make distribution a first-class discipline.

#### 4a — Programmatic distribution
REST API + GraphQL: events, dossiers, trackers, probabilities. Free / paid / enterprise tiers. Embed widgets, RSS feeds.

#### 4b — Alert delivery (Decision 13 — REVISED)
**Free tier:** Web push + email + **Telegram broadcast (free, zero per-message cost)**
**Logged-in free tier:** Above + per-category Telegram channel subscriptions
**Premium tier ($19):** **WhatsApp Business alerts** (rate limited ~30/month) + webhooks + Slack/Teams integrations + custom alert rules
**Phase E:** Mobile push native via mobile app

**Dropped:** SMS (expensive internationally, less culturally appropriate for Muslim-world audience), Apple Messages for Business (positioned as customer-service channel, not notifications).

**Why this mix wins:** WhatsApp dominates South Asia, Middle East, broader Muslim world (target audience). Telegram dominates Russia, Iran, Central Asia, tech audiences (free at scale). Combined coverage is broader than SMS at lower cost.

**Implementation:** WhatsApp Business API (~$0.005-0.05/message, country-dependent). Telegram Bot API (free, high limits). Phase B builds Telegram broadcast + web push + email. Phase D launches WhatsApp premium tier.

#### 4c — Newsletter distribution
Daily Brief, Regional Briefs, Topic Briefs, Reality Index Weekly, Tracker Updates, Breaking Alerts.

#### 4d — Social Media Engine

**Decision 19 context:** Auto-posting already operational on FB page, Instagram, and Bluesky. Phase B is upgrade-and-expand, not from-zero build. Phase A audits the existing setup and documents the upgrade path.

**Goals (priority order):**
1. Brand recognition for Scoopfeeds as data-driven intelligence brand
2. Traffic generation to scoopfeeds.com and Layer 2
3. Premium conversion (social → newsletter → premium funnel)
4. Direct social revenue (brand partnerships first, then platform monetization, then affiliate, then newsletter sponsorships — Decision 21)

**Content taxonomy (templated, mostly auto-generated):**
- Insight posts (single chart/infographic + key insight)
- Breaking + analysis (real-time news with quick context)
- Multi-perspective threads (op-ed views compared)
- Tracker updates (recurring engagement)
- Reality Index callouts (premium conversion drivers)
- Sponsored content (clearly labeled, occasional)
- Newsletter promotion
- Premium teasers
- Long-form video (Phase D+)
- **Entertainment posts** (box office charts, streaming top 10, critical-vs-audience divergence — high social engagement category)

**Platform sequencing:**

| Platform | Phase | Status / format | Revenue mechanism |
|---|---|---|---|
| **FB page** | A audit → B upgrade | **Existing auto-posting; quality and visual treatment upgrade** | In-stream ads at scale; brand partnerships |
| **Instagram** | A audit → B upgrade | **Existing auto-posting; Reels + carousel quality upgrade** | Reels Bonuses, brand partnerships |
| **Bluesky** | A audit → B upgrade | **Existing auto-posting; brand voice alignment** | Brand-building only (no native monetization yet) |
| **X (Twitter)** | B new build | Threads, single-image, breaking alerts | X Creator Monetization (Phase D) |
| **LinkedIn** | B new build | Professional analysis, document carousels | Sponsored content, B2B Layer 2 prospects |
| **Threads** | C | Forked from X with image emphasis | None native yet |
| **YouTube Shorts** | C | Vertical video clips of breaking events | YouTube AdSense once monetized |
| **TikTok** | D | Vertical video, narrative-driven | Brand partnerships |
| **YouTube long-form** | D | Deep-dive analysis, weekly cadence | YouTube AdSense (highest direct social revenue) |
| **Podcast** (Spotify, Apple) | E | Weekly Reality Index review or topic deep-dive | Sponsorships, platform monetization |

**Content generation approach (Decision 20):**
- **Phase B:** AI-generated drafts with human review (DrJ or designated reviewer) on every post
- **Phase C onward:** AI-generated with AI-agent review for tone/accuracy/policy; human review only on breaking news, sponsored, and high-stakes (geopolitical, religious, contested) topics
- **Always:** Kill-switch enables 30-second retraction across all platforms

**Brand voice (Decision 22):** Per-platform variation with consistent core voice. Tonality varies; substance does not. Core: informed, data-first, regionally-aware, never partisan, never sensationalized.

### Capability 5 — Scoop (Search & Discovery Portal)

Named **Scoop** (Decision 29). Three letters, ownable, journalism-grounded ("scoop the answer," "scoop of intelligence"). Tagline candidate: *"Scoop tells you what's happening, why it matters, and what's likely next."*

#### The model

Perplexity (AI-augmented answers with citations) × Kagi (premium quality, no spam, ad-free at premium) × AlphaSense (entity-aware, professional), with Scoopfeeds' source credibility ledger as the ranking spine.

#### Sub-capabilities

**5a — Internal search.** Across Scoopfeeds events, dossiers, trackers, articles, op-eds, videos, briefs. Phase B upgrade adds entity awareness, semantic search (existing sqlite-vec scaffolding), credibility-weighted ranking.

**5b — Web search backbone (Decision 23):** **Brave Search API as primary** (independent index, ~$5/1000 queries, Goggles for ranking customization). **Exa.ai for semantic queries** (Layer 2 advanced). **Phase D adds second backbone** (Mojeek or Bing replacement) for redundancy and negotiation leverage.

**5c — AI generative answers (Decision 24):** Multi-model routing. **DeepSeek-R1 (or comparable cheap model) for routine queries; Claude/GPT-class for complex analytical queries.** Cost dashboards from Phase C launch. Cost target: ≤$0.03 average per answer; hallucination rate <1%.

**5d — Source credibility-weighted ranking.** The differentiator. Web results re-ranked using Scoopfeeds' source quality scores. Spam, low-credibility content farms, and known-unreliable sources are filtered or de-ranked.

**5e — Search advertising (Decision 25):** **Sponsored links only above organic results, clearly labeled, contextually relevant. No display ads.** Layer 1 carries ads; Layer 2 is ad-free (Decision 27). Categories rejected: crypto pump-and-dump, gambling, pseudoscience, partisan advocacy. Categories pursued: research databases, B2B SaaS aligned with intelligence audiences, premium media, executive education, conferences.

#### Hallucination tolerance (Decision 28)

**Zero-tolerance.** Every claim citable. "I don't know" preferred over fabrication. Citation discipline (every fact linked to specific source). Confidence thresholds (below threshold = fall back to organic results). Restricted topics (medical/legal/investment advice = automatic fallback + disclaimer). Public correction log. Weekly audit on 100 random + 50 sensitive-topic queries.

#### Query limits (Decision 26)

- **Anonymous Layer 1:** 50/day Phase B-C, 20/day Phase D (soft limit with sign-up CTA)
- **Logged-in free:** 200/day
- **Premium:** Unlimited

#### Layer differentiation

*Layer 1 search (Scoop):* Free, ad-supported. AI summary (cheap-model routing), web results with credibility ranking, Scoopfeeds dossier promotion, daily query limit.

*Layer 2 search (Scoop Pro):* No ads. Advanced AI answers (premium model, multi-step reasoning). Semantic search across full archive. Faceted filters (date, source, source-type, region, category, credibility threshold). Saved searches with email/webhook/WhatsApp alerts. Citation export. API access.

#### SEO posture (Decision 30)

**Noindex search results pages.** Index portal landing page only (`/search` with no query). Robots.txt blocks `/search?q=*`. Sitemap excludes results pages. Industry-universal pattern.

#### Cost economics

At 1M queries/month: Brave backbone ~$5K + AI inference ~$14K (multi-model routing) = ~$19K total infrastructure. Search ad revenue at 2% CTR × $0.50-2.00 CPC = $10-40K/month. Self-sustaining ~500K queries/month; profitable 1M+.

---

## 4. Layer 1 — The Newsroom

### Audience
Ordinary news readers globally with strength in South Asia, Middle East, broader Muslim-world readership. Mobile-first. Multilingual (English + Urdu through Phase D; Arabic added Phase E).

### Surfaces
- Homepage with Reality Index strip, prominent **Scoop search bar**, breaking news banner, top tracked events with thumbnail trackers, regional cluster, video shorts row, **entertainment top-10 strip**, newsletter signup
- **Scoop search portal** at `/search` with full-page experience
- Topic pages (event-centric): Politics, World, Business, Science, Health, Sports, Tech, **Entertainment & Culture**
- Regional pages
- Event pages (Layer 1 view): brief → tracker → timeline → perspectives → video → CTA
- Trackers index (browseable directory across all 8 tracker types including entertainment)
- Breaking news feed
- Video page
- Perspectives page
- **Entertainment surfaces** (NEW): box office tracker, streaming charts, critical reception aggregator, awards prediction (Reality Index applied), regional industry pages (Bollywood, Pakistani drama, Korean content, Arabic series)
- Newsletter products (Daily Brief, Regional Brief, Topic Briefs including Entertainment, Tracker Updates, Breaking Alerts)
- Mobile experience (PWA, web push, shorts feed, **Telegram broadcast subscriptions**)
- Social-driven landing pages (UTM-tagged)
- Search-driven landing pages (Scoop UTM)

### Distinctive
- South Asian and Muslim-world coverage as a genuine voice
- Quantitative tracker on every major event via Tracker Auto-Detection Engine
- Multi-perspective framing (left/right/wire/regional + op-eds)
- Verified video clips
- Reality Index teasers
- Breaking news with context (web push + email + Telegram)
- Multilingual from day one
- **Entertainment with analytical depth, not portal fluff**
- **Scoop search returns intelligence, not just links** — the differentiator

### Monetization
Display advertising (Layer 1 only), free newsletter (conversion funnel), affiliate revenue tasteful, social platform direct revenue, search advertising (Scoop sponsored links above organic).

### Domain
`scoopfeeds.com`

---

## 5. Layer 2 — The Intelligence Desk

### Domain (Decision 1)
`intel.scoopfeeds.com` — visually and architecturally distinct from Layer 1, recognizably the same brand family. Founder-named subdomain (`drj.scoopfeeds.com`) was considered and rejected.

### Audience
Journalists, policy researchers, intelligence analysts, traders, academics, developers. Includes entertainment industry professionals (studio analysts, talent agents, streaming-platform researchers, regional film industry strategists).

### Pricing (Decision 2)
- **Standard:** $19/month, $190/year
- **Professional (with API):** $49/month
- **Institutional:** $99-199/seat/month for teams (Phase D launch after first 100 standard subscribers)

### Surfaces
- Reality Index dashboard (multi-source: Polymarket + Kalshi + Metaculus + AI estimates Phase C; + Good Judgment Phase D)
- Event Dossier (Layer 2 view) with downloadable data
- Trackers (deep, with custom queries and full historical data) — including **Entertainment trackers** (full historical box office, streaming analytics, regional industry deep dives)
- Watchlists with custom alerts (WhatsApp + webhooks + Slack/Teams + custom rules)
- Anomaly feed
- Perspectives engine (with op-ed credibility scoring)
- Video archive (verified)
- Source credibility ledger (public methodology)
- **Scoop Pro** — advanced search: semantic, faceted, credibility-threshold filter, entity-only search, saved searches with alerts, citation export, no ads
- Historical archive (≥6 months by Phase D launch)
- API console
- Embed catalog
- Methodology documentation (open and citable)
- Premium licensed publisher content (Phase D+: Project Syndicate primary)

### Monetization (Decision 3 — staggered launch)
- **Week 1 of Phase D:** Subscription launch ($19/month standard)
- **Week 4:** API tiered launch (free / paid / enterprise)
- **After 100 subscribers:** Institutional licensing ($99-199/seat for teams)
- **Phase E:** Sponsored intelligence briefs (clearly labeled, editorially separated)

### Ad posture (Decision 27)
**Entirely ad-free at launch.** Revisit only if all three conditions met: (a) ≥1,000 premium subscribers, (b) audience research confirms tolerance, (c) specific high-value sponsorship justifies brand-positioning trade-off.

---

## 6. The Bridge

### Acquisition funnel
**Discovery:** Scoop search (the front door), social media, SEO, direct.
**First visit:** Source → Layer 1 destination → newsletter signup or article read.
**Regular visit:** Layer 1 → newsletter open → return.
**Conversion:** Layer 1 → soft paywall on premium feature → trial → premium subscriber.

### Conversion mechanics
- Every Layer 1 event page → "Open full dossier in Intelligence Desk" CTA
- Every Reality Index teaser → soft paywall on full multi-source dashboard
- Every newsletter → one premium-only insight per issue
- Every search result → premium-tier filters greyed out with paywall (Scoop Pro promotion)
- Every tracker on Layer 1 → full data + custom queries on Layer 2
- Every breaking alert → dossier + premium custom alerts
- Every social post showcasing analytical capability includes link to deeper Layer 2 surface
- Social-driven traffic gets higher-intent conversion offer (14-day trial vs 7-day for SEO)
- **Anonymous search query limit hit → sign-up gate → newsletter or premium trial**
- **Advanced Scoop features (semantic, faceted, credibility filter, alerts, citation export) gated to Layer 2 — visible but locked for free users**
- **Search ads disappear when user upgrades to Layer 2 — concrete value of premium ("ad-free Scoop")**

### Quality compounds
Shared event graph means data-spine improvements lift all five capabilities. New prediction source benefits Layer 1 (signal), Layer 2 (drilldown), social (post material), Scoop (better citations). New tracker type benefits all four. **Scoop is a consumer of every other capability** — when Scoop works well, every other investment becomes more visible.

---

## 7. The Kill List

| Module / pattern | Decision | Rationale |
|---|---|---|
| Cars section | Kill | Off-strategy |
| Generic magazine modules on homepage | Kill | Portal clutter |
| X feed widget on homepage | Kill | X is source/distribution channel, not Layer 1 surface |
| Tip jar widget | Move to footer | Premature monetization |
| Affiliate widgets on homepage | Kill or move below fold | Erodes credibility |
| `LiveTVChannelEmbed` | Delete | Dead in code |
| Generic "most read" sidebar | Replace with "Top tracked events" | Article→event-centric |
| Single-source prediction signals | Refactor | Multi-source by Phase C |
| Plain text-only event cards | Refactor | Trackers + perspectives by Phase B |
| Unverified citizen video | Reject from Layer 1 | Verification gate |
| Manual / sporadic social posting | Replace with engineered Social Media Engine | Audit + upgrade in Phase A-B |
| Source-by-source ad-hoc onboarding | Replace with systematic source matrix workflow | Decision 16 |
| Basic FTS5-only search | Refactor | Full Scoop launch Phase B-C |
| Generic search bar with no AI/credibility | Refactor | Scoop must serve intelligence positioning |
| **SMS as alert channel** | **Kill** | **WhatsApp + Telegram replace it (Decision 13)** |
| **Apple Messages for Business** | **Don't pursue** | Wrong category (customer service, not notifications) |
| Video coverage | Keep, redesign | Layer 1 furniture done well |
| Regional pages | Keep, deepen | Differentiator |
| Topic feeds | Keep, restructure | Event-centric |
| Newsletter products | Keep, expand | Conversion funnel |
| Breaking news | Keep, build engine | Named capability |
| Live TV section | Move off homepage | Live-event hub |
| **Entertainment** | **Add as 17th category, deepen with trackers** | **High traffic, high engagement, regional advantage, clean monetization** |

---

## 8. Success Metrics

### Data spine
- Events tracked simultaneously: 500+
- Events with active trackers: ≥50 by Phase B exit, ≥200 by Phase D exit
- Active sources: ≥150 / ≥300 / ≥500 / ≥800 by Phase B/C/D/E exits
- Sources per (category × region) cell filled: ≥80% of priority cells by Phase C exit
- Languages with ingestion: ≥4 by Phase C, ≥7 by Phase E
- Prediction sources integrated: ≥4 by Phase C, ≥6 by Phase D
- Time-to-first-cluster: ≤30 minutes
- Time-to-first-alert: ≤15 minutes
- Dedup accuracy: <5% false-positive
- Brief accuracy: ≥90%
- Tracker accuracy: ≥95%

### Layer 1
- DAU baseline by Phase B
- Returning user rate (7-day): ≥35% by Phase C
- Average session depth: ≥3 events
- Newsletter open rate: ≥35%
- Newsletter subscribers: ≥10,000 / ≥30,000 by Phase C/D
- Mobile Lighthouse: ≥90
- Time-on-site (returning): ≥4 minutes
- Tracker page time-on-site: ≥5 minutes
- Web push opt-in: ≥15%
- **Telegram channel subscribers: ≥5,000 by Phase B exit, ≥25,000 by Phase D**
- Breaking alert click-through: ≥25%
- Video clip play rate: ≥30%
- Social-driven traffic share: ≥30% by Phase D
- Social → newsletter conversion: ≥3%
- **Entertainment page DAU as share of Layer 1 DAU: ≥15% by Phase C** (entertainment has high-volume audience)

### Layer 2
- Premium subscribers: ≥500 within 12 months
- API consumers (active): ≥10 within 6 months of launch
- Embed installs: ≥50 within 12 months
- Premium retention (90-day): ≥80%
- Layer 2 DAU / Premium subs: ≥40%
- Reality Index DAU as share of Layer 2: ≥60%
- Layer 1 → Layer 2 conversion: ≥1%
- Tracker data downloads: ≥500/month by Phase D
- Custom alert rules per active premium user: ≥3
- **WhatsApp alert opt-in among premium: ≥60%**

### Social
- Combined followers: ≥10,000 / ≥50,000 / ≥250,000 by Phase B/C/D
- Average engagement rate per post: ≥3%
- Click-through to scoopfeeds.com: ≥1%
- Direct social revenue: ≥$500 / ≥$5,000 / ≥$25,000 per month by Phase C/D/E
- YouTube subscribers (long-form): ≥10,000 by Phase E

### Scoop (search & discovery)
- Search queries per month: ≥10,000 / ≥100,000 / ≥500,000 / ≥1,000,000 by Phase B/C/D/E
- Search → site retention: ≥40%
- Search → newsletter conversion: ≥2%
- Search → premium conversion: ≥0.2%
- AI answer accuracy (citation accuracy): ≥95% on weekly audit
- AI answer hallucination rate: <1%
- Average search latency p95: ≤800ms results, ≤3s AI summary
- Search ad CTR: ≥2%
- Search ad revenue per query: ≥$0.02 by Phase D, ≥$0.05 by Phase E
- Scoop Pro query share of Layer 2 sessions: ≥20% by Phase D

### Operational
- Production uptime: ≥99.5%
- Scheduler last-run age: ≤15 minutes
- Failed BullMQ rate: <1%
- AI inference cost per event: trending down
- Alert delivery latency p95: ≤30s web push, ≤5min email, ≤30s Telegram, ≤1min WhatsApp
- Social post generation cost: ≤$0.05/post
- Search backbone API cost: ≤$0.005/query
- AI answer cost: ≤$0.03/query

---

## 9. Phased Roadmap

### Phase A — Stabilize + Audit (Now → 4 weeks)

**Strategic goal:** Production runs new architecture. Foundation sound. Existing assets (sources, social, search) audited and upgrade paths documented.

**Work:**
- Step 0 worktree sync, all P0 items, P1 items 1-7, P3 hygiene from Claude Code plan
- Define and instrument first 5 success metrics
- **Source audit and gap analysis** (current ~30-50 active sources mapped against the 17 × 10 × 10 matrix; priority cells identified for Phase B)
- **Existing social media audit** (FB page, Instagram, Bluesky current setup, content quality, visual treatment, posting cadence; upgrade path documented)
- **Search infrastructure audit** (FTS5 + sqlite-vec scaffolding; path to Phase B internal search upgrade documented)
- **Tracker template library design** (validated templates from trusted sources for the 8 tracker types — conflict, outbreak, incident, sports, environmental, election, study, entertainment)

**Exit criteria:** Scheduler running, admin auth secured, Urdu RTL working, hollow features populating, 5 metrics captured, source/social/search audits complete.

### Phase B — Launch Layer 1 with Comprehension + Distribution + Internal Scoop (Months 1-3)

**Strategic goal:** Layer 1 launches as a coherent product with the comprehension layer (trackers, infographics, perspectives, video, breaking news), upgraded social distribution, internal Scoop search, and Entertainment baked in from day one.

**Work:**

*Comprehension layer:*
- Mobile-first homepage redesign with new layout
- Mobile-first Event Dossier (Layer 1 view)
- **Tracker Auto-Detection Engine v1** with the 8 signal types
- First trackers go live across the 8 categories using validated templates (auto-proposed by the engine, human-reviewed)
- Op-ed aggregation MVP (RSS-based, basic ideological tagging)
- Video clip integration with verification labels (broadcaster YouTube embeds)
- Breaking news engine v1 (signal detection + alert generation)

*Source matrix:*
- Source onboarding workflow operational (AI agent proposes cells AND candidates; weekly DrJ review)
- Source matrix expansion to ≥150 active sources
- Source quality scoring infrastructure
- AI translation pipeline operational for Urdu (English already native)

*Distribution:*
- **Social Media Engine v2:** audit-driven upgrade of existing FB page + Instagram + Bluesky (content quality, visual treatment, brand voice alignment); new build for X (Twitter) and LinkedIn
- Per-platform content templates and brand voice guidelines documented
- UTM tagging and analytics dashboard for social-driven traffic
- Three newsletter products launched (Daily Brief, Regional Brief, Topic Briefs including Entertainment)
- **Alert engine v1:** web push + email + Telegram broadcast (free)

*Search:*
- **Internal Scoop search upgrade:** entity-aware, semantic (using existing sqlite-vec), credibility-weighted ranking across Scoopfeeds' own content
- Brave Search API integration as preview (web results visible, behind feature flag, un-styled)
- Scoop search portal page (`/search`) v1 with new layout

*Entertainment:*
- Entertainment topic page launched with TMDB integration deepened
- Box office tracker (template-driven via auto-detection)
- Streaming charts page
- Critical reception aggregator
- Regional entertainment landing pages (Bollywood, Pakistani drama, Korean content)

*Foundation:*
- Accessibility audit and remediation (WCAG 2.1 AA)
- New tagline and brand refresh (Decision 9)
- SEO and structured data
- First 5 BullMQ migrations from Claude Code plan

**Exit criteria:**
- Homepage above the fold = intelligence + comprehension content only
- Mobile Lighthouse ≥90
- Tracker Auto-Detection Engine operational with ≥10 active trackers
- Breaking news alerts live across web push + email + Telegram
- Op-ed perspectives on ≥80% of major events
- Video clips on ≥60% of major events
- 3 newsletter products with ≥30% open rates
- ≥150 active sources with quality scores
- Combined social followers ≥10,000 across X, LinkedIn, Instagram (existing FB/Bluesky audit complete and upgrade path executed)
- ≥3% engagement rate average on social
- ≥10,000 search queries/month on Scoop
- Scoop returns dossiers/trackers as top results for ≥60% of category-relevant queries
- Returning user rate ≥25%
- Telegram channel subscribers ≥5,000

### Phase C — Deepen Data Spine + Scale Distribution + Launch AI-Augmented Scoop (Months 3-5)

**Strategic goal:** Data spine becomes premium-grade. Source matrix fills out. Social distribution scales. Scoop becomes the differentiator with AI-generated answers and credibility-weighted web ranking.

**Work:**

*Predictions:*
- Multi-source prediction integration: Polymarket + Kalshi + Metaculus + AI estimates
- Calibration tracking infrastructure
- Source divergence alerts (anomaly feed)

*Comprehension:*
- Tracker library expansion (Auto-Detection Engine matures; ≥50 active trackers)
- Op-ed credibility scoring (author database, publication credibility, ideological mapping)
- Video verification layer (provenance tracking)
- Entity extraction + entity pages

*Search (Scoop):*
- AI generative answers (Perplexity-style) with multi-model routing (DeepSeek for routine, Claude/GPT for complex)
- Source credibility-weighted ranking applied to web results
- Entity-aware search results
- Scoop portal polished as destination

*Sources:*
- Source matrix expansion to ≥300 active sources
- Translation pipeline operational for Arabic + Russian + Mandarin
- Second-AI verification on sensitive content

*Social:*
- Threads, Bluesky cross-posting operationalized
- YouTube Shorts launch
- Facebook upgraded
- Brand partnership conversations begin
- Phase B human-review-every-post → Phase C AI-agent-review-with-human-gates transition for routine content

*Foundation:*
- Search overhaul (entity, semantic, faceted)
- Semantic dedup using sqlite-vec
- Source diversity caps + ≥10 new non-South-Asian sources
- "Why this matters" / "What changed in 24h" briefs default
- Watchlist + alert system on data spine
- Remaining BullMQ migrations
- CSP enabled in production

**Exit criteria:**
- ≥4 prediction sources with calibration scores published
- ≥50 active trackers across all 8 types
- AI generative answers in Scoop with ≥95% citation accuracy
- ≥100,000 search queries/month
- Search becomes measurable acquisition channel (≥10% of new newsletter signups)
- Op-ed credibility scores published
- Video clips on ≥80% of major events with verification labels
- ≥300 active sources, 4-language ingestion
- ≥50,000 combined social followers (6+ platforms)
- ≥$500/month direct social revenue
- Layer 1 returning user rate ≥35%
- Telegram channel subscribers ≥15,000

### Phase D — Launch Layer 2 + Monetize Distribution + Scoop Revenue (Months 5-8)

**Strategic goal:** Intelligence Desk launches at `intel.scoopfeeds.com`. First non-ad revenue. Social media revenue meaningful. Scoop ads launch on Layer 1; advanced Scoop features paywalled into Layer 2.

**Work:**

*Layer 2 launch (staggered per Decision 3):*
- **Week 1:** `intel.scoopfeeds.com` live with multi-source Reality Index dashboard + premium subscription ($19/month, $190/year)
- Full Event Dossier (Layer 2 view) with downloadable data
- Scoop Pro: semantic search, faceted filters, credibility-threshold filter, entity-only search, saved searches with alerts (WhatsApp + webhook), citation export, ad-free
- Watchlist + custom alert rules + WhatsApp + webhook + Slack/Teams integrations
- Anomaly feed
- Historical archive (≥6 months)
- Methodology documentation published
- **Week 4:** API v2 launches with three tiers
- **After 100 subscribers:** Institutional licensing tier ($99-199/seat for teams)

*Sources:*
- Source matrix expansion to ≥500 active sources
- First paid licensing deals (Project Syndicate primary; Reuters wire or Foreign Affairs secondary)
- $1,500/month licensing budget activated

*Search:*
- Search ads launch (sponsored links, Layer 1 only)
- Search via API for institutional use
- Anonymous query limit tightened to 20/day
- Daily query limit enforcement with sign-up CTA

*Predictions:*
- Good Judgment Open added (≥6 prediction sources total)

*Social:*
- TikTok launch
- YouTube long-form (1 video/week cadence)
- Platform monetization optimization (YouTube AdSense, X Creator)
- Active brand partnership program

*Distribution:*
- Two more newsletter products (Reality Index Weekly, Tracker Updates)
- Social-to-premium conversion funnel optimized (UTM-tagged free trials)

**Exit criteria:**
- Layer 2 live with ≥3 distinct surfaces
- ≥100 premium subscribers (per pricing test against ≥2% conversion)
- ≥3 active API consumers
- ≥10 embed installs
- Premium retention (30-day) ≥85%
- ≥6 prediction sources
- ≥200 active trackers
- ≥500 tracker data downloads/month
- ≥500 active sources, 3 paid publisher deals signed
- ≥500,000 search queries/month
- Search ad revenue ≥$5,000/month
- ≥250,000 combined social followers (8+ platforms)
- ≥$5,000/month direct social revenue
- YouTube channel monetized
- WhatsApp alert opt-in among premium ≥60%

### Phase E — Expand (Months 8-12)

**Strategic goal:** Platform compounds. Editorial layer adds defensibility. Mobile native app (iOS + Android simultaneous launch). Premium scales. Social and search become major revenue streams. AgentX integration explored.

**Work:**
- **Editorial layer:** 1-2 part-time editors hired (after ≥300 premium subscribers; Decision 4)
- **Mobile native app:** iOS + Android simultaneous launch — alerts-first, breaking news, Reality Index alerts, tracker updates, mobile push
- Arabic added as full UI language (Decision 6)
- Institutional licensing scaled
- Newsletter sponsorships activated
- 1-2 university or think tank partnerships
- **AgentX integration:** loose coupling — Scoopfeeds events as data source for AgentX agents via API
- Postgres migration if (and only if) SQLite shows binding constraints
- Sponsored intelligence briefs as occasional revenue (clearly labeled, editorially separated)
- Hand-curated mega-trackers for top 5-10 stories
- Source matrix expansion to ≥800 active sources, full local-language coverage in 7+ languages
- Reciprocal embed deals with 5+ regional publishers
- Multi-language Scoop search (Arabic, Russian, Mandarin, Spanish, Portuguese, French)
- Scoop backbone redundancy (second backbone added)
- Topic-specific Scoop portals for institutional clients (Pharma Intelligence Search, Maritime Intelligence Search) as licensed products
- Podcast launch (Spotify, Apple) — weekly Reality Index review
- Licensing budget scaled to $5,000/month

**Exit criteria:**
- ≥500 premium subscribers
- ≥10 active API consumers, ≥50 embed installs
- Editorial review process operational
- Mobile native app live (iOS + Android) with ≥10,000 downloads
- ≥800 active sources, 7+ languages
- ≥1,000,000 search queries/month
- Search ad revenue ≥$25,000/month
- ≥$25,000/month total social media revenue
- All success metrics from Section 8 met
- Platform self-sustaining or growth-funded

---

## 10. Strategic Decisions Reference

All 30 strategic decisions are final. Full rationale, review triggers, and implementation notes are in the **Section 10 Decisions Log v1.0** (companion document). Quick reference:

| # | Area | Decision |
|---|---|---|
| 1 | URL strategy | `intel.scoopfeeds.com` (subdomain) |
| 2 | Premium pricing | $19/month, $190/year |
| 3 | Phase D revenue sequencing | Stagger: subs week 1 → API week 4 → institutional after 100 subs |
| 4 | Editorial layer | Yes after ≥300 subscribers |
| 5 | AgentX integration | Loose coupling Phase E |
| 6 | Multilingual | EN+UR full UI through D; AR added E; RU/ZH/ES/PT/FR ingestion-only Phase C |
| 7 | Methodology posture | Open methodology; proprietary weights |
| 8 | Mobile native app | Phase E, iOS+Android simultaneous |
| 9 | Brand identity | Refresh in Phase B |
| 10 | Postgres timing | Defer indefinitely |
| 11 | Predictions Phase C | Polymarket + Kalshi + Metaculus + AI estimates; +Good Judgment Phase D |
| 12 | Tracker build | AI-generated from validated templates with human review; auto-detection engine |
| 13 | Alert delivery | Free: web push + email + Telegram. Premium: WhatsApp + webhooks + Slack/Teams + custom rules |
| 14 | Video sourcing | Broadcaster YouTube aggregation Phase B-D; partnerships Phase E |
| 15 | Op-ed sourcing | RSS snippets + link-out free; licensing Phase E (Project Syndicate primary) |
| 16 | Source onboarding | AI proposes cells AND candidates; DrJ approves both |
| 17 | Translation | AI-only with second-AI verification on sensitive content; human review on AI disagreement |
| 18 | Source licensing budget | $0 → $1.5K/mo Phase D → $5K/mo Phase E |
| 19 | Social platform priority | X + LinkedIn + Instagram new; FB + Instagram + Bluesky audit-and-upgrade |
| 20 | Social content generation | Phase B human review every post; Phase C AI agent review with human gates on sensitive |
| 21 | Social revenue priority | Brand partnerships → platform monetization → affiliate → newsletter sponsorships |
| 22 | Social brand voice | Per-platform variation, consistent core voice; never partisan, never sensationalized |
| 23 | Search backbone | Brave (primary) + Exa.ai (semantic L2) + second backbone Phase D |
| 24 | AI answer model | Multi-model routing (DeepSeek routine; Claude/GPT complex) |
| 25 | Search ad model | Sponsored links only, no display ads |
| 26 | Anonymous query limits | 50/day Phase B-C → 20/day Phase D; 200/day logged-in free; unlimited premium |
| 27 | Layer 2 ad posture | Entirely ad-free; revisit only if 3 conditions met |
| 28 | Hallucination tolerance | Zero-tolerance with citation discipline, restricted topics, public correction log |
| 29 | Search portal name | **Scoop** |
| 30 | Search results SEO | Noindex results pages; index portal landing only |

---

## 11. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Single-developer bottleneck | High | Critical | Claude Code with structured handoffs. 1 part-time engineer in Phase D. |
| Brand confusion between layers | Medium | High | `intel.` subdomain. Visually differentiated UIs. Consistent brand family. |
| Editorial cost for Layer 1 quality | Medium | High | AI 90%; humans review prominent placements; scale only after revenue. |
| AI brief accuracy failures | Medium | Critical | Layer 2 human-reviewed; weekly audits; public correction log. |
| Tracker accuracy failures | Medium | Critical | Authoritative sources only (UN, WHO, ACLED). Quarterly audits. Public corrections. |
| Single-source prediction bias | Medium | High | Triangulation across ≥4 sources by Phase C. Calibration tracking. |
| Video misinformation / deepfake | Medium | High | Verification gate. No unverified citizen video on Layer 1. |
| Op-ed copyright exposure | Medium | High | Snippet + link-out free; licensing only where revenue justifies. |
| Alert fatigue | High | Medium | Severity thresholding. User-controlled categories. Quiet hours. |
| Infographic accuracy at scale | Medium | High | Auto-gen for structured data only; human review for hand-curated. |
| Scope creep | High | High | This document. Kill list. One-sentence tests. Decisions Log enforcement. |
| Conversion funnel underperforms | Medium | High | A/B test. Adjust intensity. Freemium fallback. |
| Competitive entry | Medium | High | Move fast. Methodology moat. API consumer lock-in. |
| Source legal exposure | Medium | High | Brief excerpts + attribution. Legal review before Phase D. |
| Cost runaway on AI inference | Medium | Medium | Local model routing. Cost dashboards from Phase A. |
| Hostinger / infrastructure limits | Medium | Medium | Container plan exists. Migration path to Fly.io / Railway / Render. |
| Geopolitical content risk | Low | High | Editorial guidelines. Multi-source requirement. No partisan framing. |
| Codex / agent execution drift | High | High | Mandatory deploy-verification step. Post-merge smoke tests. |
| DrJ time conflict | High | High | Phases scoped for realistic velocity. |
| Translation accuracy on geopolitics | Medium | High | Hybrid translation (second-AI verification on sensitive); human review on AI disagreement; provenance markers. |
| Source over-dependence on free RSS | Medium | Medium | Phase D licensing deals reduce dependence. |
| Social platform algorithm dependency | High | High | Multi-platform (no single platform >40% of social-driven traffic). Owned channels (newsletter, app) prioritized long-term. |
| Social platform terms-of-service changes | High | Medium | Multi-platform mitigates. No single-platform-dependent revenue assumption. |
| Social content brand-damage | Medium | High | Phase B human review every post; AI-agent review with human gates Phase C; 30-second kill-switch. |
| **Telegram platform risk** (geopolitical pressure on Telegram) | Medium | Medium | **WhatsApp covers most of the same audience as backup. Email and web push as universal fallbacks.** |
| **WhatsApp Business API pricing or terms changes** | Medium | Medium | **Telegram covers free tier. Premium audience can fall back to email + webhook.** |
| Search API cost runaway | Medium | High | Per-query cost dashboards. Daily limits for anonymous users. Cache aggressively. Multi-backbone redundancy Phase D. |
| AI answer hallucination | Medium | Critical | Zero-tolerance policy. Citations on every claim. Confidence thresholds. Public correction log. |
| Brave Search API terms changes | Medium | High | Multi-backbone Phase D. Internal index aspirational for later phase. |
| Scoop quality vs Google | High | Medium | Don't compete on general queries. Win for intelligence/event/analytical queries. Position as "Scoop for intelligence, Google for everything else." |
| SEO spam manipulation of Scoop ranking | Medium | Medium | Source credibility scoring filters most spam. Manual blocklist. |
| Search ad quality | Medium | High | Curated ad inventory Phase D. No programmatic networks until quality framework mature. |
| Privacy backlash on logged search history | Low | High | No logged history for anonymous; logged-in users see and clear; privacy policy clear; don't sell search data. |
| **Entertainment industry data licensing** (some box office data is paywalled) | Medium | Medium | **Free sources sufficient for Phase B-D. Paid licensing (e.g., Comscore, Nielsen) only Phase E if revenue justifies.** |

---

## 12. How to Use This Document

This document is the source of truth for "is this on strategy?" Together with the Decisions Log v1.0, it defines the platform's direction.

**Before adding any feature:**
- Which layer does this serve? (1, 2, both, bridge?)
- Which capability does it use or improve?
- Which audience benefits?
- Which success metric will it move?
- Does it have a social distribution angle?
- Does it have a search/discovery angle (Scoop)?
- Is this on strategy per the Decisions Log?
- If none of the above, kill it.

**Before approving any code change:**
- Which strategic phase is this in?
- Which exit criterion does it contribute to?
- Is there a deploy-verification step?

**Before each phase kicks off:**
- Re-read Section 1, Section 8, Section 10
- Confirm prior phase exit criteria are met
- Update Decisions Log if any decisions have shifted (with documented rationale and date)
- Reassess Section 11 risks

**Quarterly review:**
- Score against Section 8 metrics
- Update risk register
- Reaffirm or revise kill list (Section 7)
- Check decisions flagged for review in Decisions Log
- Bump document version on structural change

**Decision review triggers** (from Decisions Log):
- After first 100 premium subscribers: revisit pricing (Decision 2)
- At ≥300 premium subscribers: hire editorial layer (Decision 4)
- At ≥1,000 users on both Scoopfeeds and AgentX: deeper integration (Decision 5)
- At ≥1,000 premium subscribers: revisit Layer 2 ad posture (Decision 27)
- Weekly: Scoop AI hallucination audit (Decision 28)
- Quarterly: source licensing budget vs revenue (Decision 18)

---

## Appendix A — Mapping Tactical Plans to Strategic Phases

| Tactical Item | Phase | Layer / Capability |
|---|---|---|
| Step 0 (worktree sync) | A | Foundation |
| P0-1 to P0-6 | A | Foundation |
| P1-1 to P1-7 | A | Foundation |
| Source audit and gap analysis | A | Cap. 1 |
| Existing social media audit | A | Cap. 4d |
| Search infrastructure audit | A | Cap. 5 |
| Tracker template library design | A | Cap. 2 |
| Mobile-first homepage redesign (with Entertainment) | B | Layer 1 + Bridge |
| Tracker Auto-Detection Engine v1 | B | Cap. 2 |
| First trackers across 8 types | B | Cap. 2 / Layer 1 |
| Op-ed aggregation MVP | B | Cap. 2 / Layer 1 |
| Video clip curation + verification | B | Cap. 2 / Layer 1 |
| Breaking news engine v1 | B | Cap. 1 + 4 |
| Source matrix expansion to ≥150 | B | Cap. 1 |
| Source quality scoring infrastructure | B | Cap. 1 |
| Social Media Engine v2 (audit + upgrade existing; new X + LinkedIn) | B | Cap. 4d |
| Per-platform brand voice guidelines | B | Cap. 4d |
| Alert engine v1 (web push + email + Telegram) | B | Cap. 4b |
| Internal Scoop search upgrade | B | Cap. 5a |
| Brave Search API integration (preview) | B | Cap. 5b |
| Scoop portal page v1 | B | Cap. 5 / Layer 1 |
| Entertainment surfaces (topic page, box office tracker, charts) | B | Cap. 2 / Layer 1 |
| Newsletter products (3 incl. Entertainment) | B | Layer 1 |
| Accessibility audit | B | Both layers |
| Brand refresh | B | Layer 1 |
| Multi-source prediction integration | C | Cap. 3 |
| Calibration tracking | C | Cap. 3 |
| Source divergence alerts | C | Cap. 3 / Layer 2 |
| Tracker library expansion to ≥50 | C | Cap. 2 |
| Op-ed credibility scoring | C | Cap. 2 |
| Video verification layer | C | Cap. 2 |
| Entity extraction + pages | C | Cap. 2 |
| Source credibility scoring (public methodology) | C | Cap. 2 |
| Search overhaul (entity, semantic, faceted) | C | Cap. 5 |
| Semantic dedup | C | Cap. 1 |
| Source matrix expansion to ≥300; translation pipeline (4 languages) | C | Cap. 1 |
| Social Media Engine v3 (+Threads, Bluesky, Facebook, YouTube Shorts; first social revenue) | C | Cap. 4d |
| AI generative answers in Scoop (Perplexity-style) | C | Cap. 5c |
| Source credibility-weighted ranking on web results | C | Cap. 5d |
| Entity-aware search results | C | Cap. 5 |
| Layer 2 launch (`intel.scoopfeeds.com`) | D | Layer 2 |
| Premium subscription launch ($19/mo) | D | Layer 2 |
| API v2 with three tiers | D | Cap. 4a |
| Custom alert rules + WhatsApp + webhooks + Slack/Teams | D | Cap. 4b / Layer 2 |
| Embed catalog | D | Cap. 4a |
| Tracker data downloads | D | Layer 2 |
| Source matrix expansion to ≥500; first paid licensing deals | D | Cap. 1 |
| Social Media Engine v4 (+TikTok, YouTube long-form); social monetization | D | Cap. 4d |
| Scoop Pro advanced features paywall | D | Cap. 5 / Layer 2 |
| Search ads launch (sponsored links) | D | Cap. 5e |
| Search via API for institutional use | D | Cap. 5 + 4a |
| Anonymous query limit tightened to 20/day | D | Cap. 5 |
| Institutional licensing tier launch | D (post-100 subs) | Layer 2 |
| Editorial layer (1-2 part-time editors) | E (post-300 subs) | Layer 2 |
| Mobile native app (iOS + Android simultaneous) | E | Both |
| Arabic full UI | E | Layer 1 |
| AgentX integration (loose coupling) | E | Cap. 4 |
| Mega-trackers for top 5-10 stories | E | Cap. 2 |
| Source matrix to ≥800; 7+ languages; reciprocal embed deals | E | Cap. 1 + 4a |
| Multi-language Scoop search | E | Cap. 5 |
| Scoop backbone redundancy | E | Cap. 5b |
| Topic-specific Scoop portals (institutional licensing) | E | Cap. 5 / Layer 2 |
| Podcast launch | E | Cap. 4d |
| Postgres migration (only if needed) | E | Foundation |

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
- *"Did the Tracker Auto-Detection Engine flag this event for a tracker?"*
- *"Are we relying on more than one prediction source?"*
- *"Would this alert deserve to interrupt a user's day on Telegram or WhatsApp?"*
- *"Are we showing op-eds from more than one perspective?"*
- *"Is this video verified, and is the verification visible?"*
- *"Have we considered sources from all priority regions?"*
- *"Does this story have a social media format that showcases our analysis?"*
- *"Would this social post drive traffic AND revenue, or just engagement?"*
- *"Can we publish this in any of our supported languages, or only English?"*
- *"For an intelligence-flavored query, would Scoop give a better answer than Google?"*
- *"Does the Scoop AI answer cite every claim?"*
- *"Are low-credibility sources filtered from Scoop's top results?"*
- *"For an entertainment release, do we have the box office, streaming, and critical reception data?"*

**For editorial:**
- *"Is this fact-checked enough to publish under Scoopfeeds?"*
- *"Could a competitor reproduce this in a week?"*
- *"Would I bet my reputation on this brief / tracker number / social post / Scoop answer?"*

**For engineering:**
- *"Is this a data-spine improvement or a layer-specific feature?"* Spine first.
- *"Will this still matter at 10x events?"*
- *"Does this make the deploy more or less risky?"*

**For sources:**
- *"Where does this story show up in our source matrix?"* Empty cells are gaps.
- *"Is this source authoritative for this category and region?"*
- *"What is this source's credibility score?"*

**For social:**
- *"Which goal is this post serving — recognition, traffic, conversion, or revenue?"*
- *"Has the platform-specific tone been applied?"*
- *"What's the link-out destination?"*

**For Scoop:**
- *"For this query type, did we route to the right AI model (cheap or premium)?"*
- *"Did we filter low-credibility sources?"*
- *"Did we prefer 'I don't know' over a fabricated answer?"*

---

## Appendix C — Comparison Set (Detailed)

[All entries from v5 carried forward. Updates and additions for v6 below.]

### Layer 1 — Entertainment (NEW SECTION)

**Variety, Deadline, Hollywood Reporter.** Steal: industry trade depth, breaking-release framing, awards-season coverage. Avoid: industry insider clubbiness.

**Box Office Mojo, The Numbers.** Steal: quantitative discipline, historical comparisons, regional breakdowns. Avoid: walled-garden interface limitations.

**Bollywood Hungama, Box Office India.** Steal: regional industry depth, vernacular sensibility for South Asian audience.

**Rotten Tomatoes, Metacritic.** Steal: critical aggregation, audience-vs-critic divergence as a signal. Avoid: simplistic single-score reduction without context.

**Letterboxd.** Steal: community-driven critical layer, social discovery patterns. Avoid: pure user-generated content without editorial.

**Variety Insight, IMDbPro.** Steal: industry-pro tier model for Layer 2 entertainment subscribers.

### Search — AI-augmented (Updated)

**Perplexity AI.** ~$25M ARR in 2024, ~10M MAU. Steal: AI-generated answers with citations, focus modes. Avoid: cluttered UX, occasional hallucination on weakly-cited topics.

**Kagi.** Subscription-based ($10/mo), no ads. Steal: ad-free positioning, "lenses" feature, public source ratings. Avoid: small index limitations.

**Brave Search.** Independent index, Goggles ranking primitive. Steal: independence, source diversity, no Google dependency. Avoid: index gaps in long-tail.

**You.com.** Steal: app-based search results format. Avoid: cluttered interface, AI persona drift.

**AlphaSense.** Enterprise search for finance. Steal: search-first UX, entity awareness, document-level depth, enterprise contracts. Avoid: finance-only positioning.

**Ground News.** Steal: source-bias visualization on every result, blindspot indicator.

### Alert channels (NEW)

**WhatsApp Business platforms (e.g., Twilio WhatsApp, MessageBird).** Steal: templated message discipline, regional coverage. Avoid: over-messaging, deliverability complacency.

**Telegram channels (data-driven examples).** Steal: high-frequency broadcast model, bot-driven distribution, free scale economics.

---

*End of document. v6.0.*
