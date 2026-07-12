# Scoopfeeds Section 10 Decisions Log v1.0
## Final Decisions on All 30 Strategic Questions

**Document type:** Decision reference
**Version:** 1.0 (Decision 32 appended July 2026)
**Owner:** DrJ (Founder)
**Decided:** May 2026
**Companion to:** Scoopfeeds Strategic Plan v6.0
**Status:** All 32 decisions final unless flagged for review

---

## How to Use This Document

This is the single source of truth for the 30 strategic decisions made during the v5 review. Each decision shows:
- **Question:** what was being decided
- **Decision:** the final answer
- **Rationale (concise):** why this answer
- **Review trigger (if any):** what would cause this decision to be revisited

When future questions arise about strategic direction, this document is consulted before adding new strategy. Decisions only change when a documented review trigger fires or when the founder explicitly chooses to revise — not through silent drift.

---

# Decisions 1–10: Architecture, Pricing, and Sequencing

## Decision 1 — URL strategy
**Decision:** `intel.scoopfeeds.com` (subdomain).
**Rationale:** Cleanest separation between mass-market Layer 1 and professional Layer 2. Easier auth isolation, easier infrastructure separation, cleaner analytics, mirrors industry pattern (Bloomberg.com vs Terminal). Founder-named subdomain (`drj.scoopfeeds.com`) was considered and rejected — would limit platform growth, conflict with institutional credibility positioning, and create conflict-of-interest perception given DrJ's civil service role. Personal brand to be built adjacent (newsletter under DrJ name, YouTube show, bylined briefs) rather than as the premium tier itself.
**Review trigger:** None — final.

## Decision 2 — Premium pricing
**Decision:** $19/month, $190/year (effective $16/month annual).
**Rationale:** Below psychological $20 line, accessible-but-premium positioning. Leaves room for Professional ($49) and Institutional ($99-199) tiers. Comparable to peers (NYT $25, Economist $24, Kagi $10).
**Review trigger:** After first 100 subscribers, check conversion rate. If >2%, raise to $24-29. If <0.5%, consider $14 with stronger annual incentive. Floor: never below $12.

## Decision 3 — Revenue stream sequencing within Phase D
**Decision:** Stagger — subscription week 1, API week 4, institutional after first 100 subscribers.
**Rationale:** Each stream needs separate marketing, support, and pricing logic. Subscription is the simplest and the cleanest signal of "do people pay." API needs polished documentation to debut well. Institutional sales requires reference customers (the first 100 subscribers).
**Review trigger:** None — execution sequence locked.

## Decision 4 — Editorial layer commitment
**Decision:** Yes — hire 1-2 part-time editors after ≥300 premium subscribers.
**Rationale:** Editorial judgment is the long-term moat against AI-only competitors. ~$2-4K/month cost is supportable from ~$5,700/month subscription revenue at the 300-subscriber threshold. Hiring earlier creates pressure to raise pricing prematurely or cut elsewhere.
**Review trigger:** If subscriber growth significantly outpaces or underperforms forecast, threshold may be revisited.

## Decision 5 — AgentX integration depth
**Decision:** Loose coupling in Phase E — Scoopfeeds publishes event signals via API; AgentX consumes them as one of many API customers.
**Rationale:** Strategic synergy is real (AgentX agents acting on Scoopfeeds signals) but tight coupling doubles risk. Loose coupling captures synergy without entanglement. Both platforms need ≥1,000 independent users before tight coupling makes sense.
**Review trigger:** If both platforms cross ≥10,000 users by Phase E, revisit potential for deeper integration (agent hosting, joint product surfaces).

## Decision 6 — Multilingual sequencing
**Decision:** English + Urdu as full UI languages through Phase D. Arabic added as full UI in Phase E. Russian, Mandarin, Spanish, Portuguese, French as ingestion-only (translated into English/Urdu/Arabic for display) starting Phase C.
**Rationale:** Two UI languages is operationally manageable for a small team. Urdu is genuine regional moat. Other languages open massive source pools without the UI translation cost. Arabic deferred to Phase E because doing it well requires editorial review of dialect variations.
**Review trigger:** If Layer 1 traffic from a specific non-Urdu region (e.g., Spanish-speaking Latin America) reaches ≥10% of total, consider promoting that language to full UI.

## Decision 7 — Open-source posture for methodology
**Decision:** Methodology open and citable; weights, models, and source-credibility scores proprietary.
**Rationale:** Open methodology = academic credibility = citation = free distribution. Proprietary weights/models = competitive moat. Bloomberg/Reuters/Stratfor pattern. `/methodology` page becomes a versioned public artifact (so academic papers can cite "Scoopfeeds Methodology v2.1, June 2026").
**Review trigger:** None — pattern is stable.

## Decision 8 — Mobile native app timing
**Decision:** Phase E (Months 8-12). iOS and Android launched simultaneously.
**Rationale:** PWA covers ~80% of native value at ~5% of cost through Phase D. Phase E launch when Layer 2 revenue justifies the investment.
**Caveat noted:** Simultaneous iOS+Android roughly doubles workload (two App Store reviews, two test cycles, two release pipelines). Acknowledged. If Phase E timeline pressure emerges, alternative is iOS-first by 2-3 months with Android close behind.

## Decision 9 — Brand identity refresh
**Decision:** Yes — refresh in Phase B alongside homepage redesign. Logo can stay if clean; color system, typography, voice, and social brand kit need work.
**Rationale:** New positioning demands new visual identity. Phase B is the right time because homepage is being rebuilt anyway. Logo is ownable; voice/visual treatment is generic. Estimated cost $2K-5K with freelance designer or 2-3 weeks DIY with Claude + design tooling.
**Review trigger:** None — locked into Phase B execution.

## Decision 10 — Postgres timing
**Decision:** Defer indefinitely. Revisit only in Phase E if SQLite shows binding constraints.
**Rationale:** SQLite handles surprisingly heavy loads (Notion, Apple, Cloudflare D1). Migration option already engineered (adapter seam, migration runner exist). Premature migration costs 4-6 weeks with zero user-facing benefit. Most likely outcome: never migrate.
**Review trigger:** If p95 query latency exceeds 500ms after optimization, OR write contention causes scheduler lock failures, OR institutional clients require dedicated databases for compliance, revisit.

---

# Decisions 11–15: Capabilities — Predictions, Trackers, Alerts, Video, Op-Eds

## Decision 11 — Prediction source priority
**Decision:** Phase C launch with Polymarket + Kalshi + Metaculus + AI estimates. Add Good Judgment Open in Phase D. Manifold and PredictIt only if specific use cases emerge.
**Rationale:** Polymarket (existing, high-liquidity US events) + Kalshi (CFTC-regulated mainstream) + Metaculus (calibrated forecasters, long-tail policy) + AI estimates (cheap, broad coverage) gives diverse triangulation. Good Judgment is the gold standard for premium tier in Phase D. Manifold is play-money (weak calibration); PredictIt is in regulatory limbo.
**Review trigger:** None — sequence is structural.

## Decision 12 — Tracker build strategy (REVISED FROM ORIGINAL RECOMMENDATION)
**Decision:** AI-generated trackers using validated templates (drawn from trusted sources like Reuters Graphics, WHO surveillance, ACLED, Our World in Data conventions) with human review on each instantiation. The platform intelligence layer auto-detects which events warrant trackers based on event-type signals.
**Tracker auto-detection signals:** Major war / armed conflict; epidemic or outbreak; major accident or crash; sports event (tournament, championship, major game); wildfire / environmental event; election / poll / referendum / political event; major study release; entertainment release (box office, streaming launch).
**Rationale (DrJ's framing):** Hand-curating the first 10-15 trackers is unnecessary if validated templates from trusted sources already encode best practices. Platform intelligence should propose which events warrant trackers, not require human curation per tracker. Human review remains on each instantiation to catch errors.
**Implementation note:** This adds a new sub-capability to **Capability 2 (Event Dossier): Tracker Auto-Detection Engine**. To be specified in v6 strategic plan.
**Review trigger:** If tracker accuracy on quarterly audit drops below 95%, increase human-review intensity or restrict template auto-population for affected categories.

## Decision 13 — Alert delivery strategy (REVISED FROM ORIGINAL RECOMMENDATION)
**Decision:** Free tier: web push + email + Telegram broadcast (free). Premium tier ($19): WhatsApp Business alerts + webhooks + Slack/Teams + custom alert rules. Apple Messages dropped (wrong category — customer-service channel, not notification). SMS dropped (expensive internationally, less appropriate for Muslim-world audience).
**Rationale (DrJ's framing):** WhatsApp is dominant in South Asia, Middle East, broader Muslim world. Telegram is strong in Russia, Iran, Central Asia, tech audiences globally with zero per-message cost. Apple Messages for Business is positioned for customer service, not notifications. SMS is expensive and culturally less appropriate for the target audience.
**Implementation note:** WhatsApp Business API costs ~$0.005-0.05/message depending on country. Telegram Bot API is free with high limits (channel broadcasts to unlimited subscribers at zero cost). Phase B builds the integration; Phase D launches premium WhatsApp tier.
**Review trigger:** If WhatsApp Business pricing changes materially or terms restrict news content, evaluate alternatives. If new platforms emerge with stronger regional fit, reassess.

## Decision 14 — Video sourcing posture
**Decision:** Phase B-D: aggregation from broadcaster YouTube channels (legal under fair use with proper attribution and embed; no rehosting), curated playlists per topic. Phase E: explore broadcaster partnerships (Reuters video API, Al Jazeera content drops) only if revenue supports.
**Rationale:** YouTube embeds are explicitly licensed by the broadcaster who uploads them; aggregation is legal at zero content cost. Partnerships cost real money (typically 3-6 months negotiation) and require Phase E revenue to justify. Citizen footage stays rejected from Layer 1 until verification pipeline matures (Phase D-E).
**Review trigger:** If a broadcaster proactively offers a partnership before Phase E, evaluate on its merits. If verification pipeline matures earlier than expected, citizen footage policy may be revised earlier.

## Decision 15 — Op-ed sourcing posture
**Decision:** Phase B-D: RSS aggregation with snippets (≤200 words, with attribution and link-out). Phase E: licensing deals with specific publishers where premium revenue justifies — primary targets are Project Syndicate (uniquely positioned for global op-eds) and one major outlet (FT or Foreign Affairs depending on negotiation).
**Rationale:** Snippet-and-link-out aggregation is fair use; established pattern for AllSides, Ground News, RealClearPolitics. Licensing deals expensive ($3-15K/year per publisher) and require revenue justification. Multi-perspective framing is the differentiator, not full op-ed reproduction.
**Review trigger:** If Layer 2 audience research consistently identifies a specific publisher as a "must-have" for premium tier, prioritize that licensing deal.

---

# Decisions 16–22: Sources and Social Distribution

## Decision 16 — Source onboarding strategy (REVISED FROM ORIGINAL RECOMMENDATION)
**Decision:** Hybrid — AI agent proposes priority cells (which category × region × source-type combinations need filling) AND candidate sources to fill them; DrJ approves both the prioritization and the specific sources before onboarding.
**Rationale (DrJ's framing):** AI may spot pattern gaps in the source matrix that DrJ would miss (e.g., "your East Africa health coverage is thin" or "no Mandarin tech sector sources"). Human approval remains the quality gate.
**Operational workflow:**
1. AI agent runs weekly analysis: which (category × region × type) cells are below target source count?
2. AI agent crawls RSS directories, news APIs, Wikipedia infoboxes, language-specific aggregators for candidates
3. AI agent presents weekly batch: priority cells flagged + 50 candidate sources with metadata (ownership, language, frequency, RSS health, sample headlines, estimated credibility)
4. DrJ approves/rejects in ~30 minutes per week
5. AI agent onboards approved sources and monitors ingestion health
**Review trigger:** If weekly review time grows beyond 60 minutes for sustained periods, automation thresholds tightened or batch size reduced.

## Decision 17 — Translation strategy (REVISED FROM ORIGINAL RECOMMENDATION)
**Decision:** AI translation only for Phase B-C. Second-AI verification added for sensitive content as a Phase C enhancement. Human translators or human review may be added later as revenue justifies. Sensitive content tags trigger second-AI verification; significant disagreement between AIs triggers human review.
**Rationale (DrJ's framing):** AI translation is the cost-efficient default. Second-AI verification on sensitive content (war, politics, regional disputes, religious topics, named-person quotes) catches contextual errors at low marginal cost. Human review only when AIs disagree.
**Provenance commitment:** Every translated piece carries a visible provenance marker — "Translated from [language] by [AI model], [verified by second AI / unreviewed]."
**Review trigger:** If a translation error of consequence is published (incorrect named entity, mistranslated quote, mischaracterized stance), tighten verification thresholds or add human review by category.

## Decision 18 — Source paid licensing budget
**Decision:** $0 through Phase C. $1,500/month starting Phase D for first 1-2 deals (Project Syndicate primary; one of Reuters wire or Foreign Affairs secondary). Scale to $5,000/month in Phase E if Layer 2 revenue justifies.
**Rationale:** RSS aggregation + own analytical layer provides credible Phase B-C value without licensing. Licensing budget tied to ratio of premium subscription revenue (~25% allocation to content licensing in Phase E is sustainable for content-intensive platform).
**Review trigger:** Reviewed quarterly against Layer 2 revenue. If Layer 2 revenue significantly exceeds forecast, accelerate licensing budget. If revenue lags, defer Phase E licensing increases.

## Decision 19 — Social media platform launch priority for Phase B
**Decision:** X + LinkedIn + Instagram for Phase B. Phase A includes audit of existing social setup (FB page, Instagram, Bluesky already have auto-posting) and documents the upgrade path for content quality, visual treatment, and cross-platform discipline.
**Rationale:** X (lowest production effort for analytical content, intelligence/policy audience lives here), LinkedIn (B2B audience for Layer 2 conversion), Instagram (visual-first, large reach, infographic-friendly). Existing FB/Bluesky posting is upgraded rather than built from zero in Phase B. Threads added Phase C (cross-post from X). Facebook upgraded Phase C. YouTube Shorts Phase C. TikTok and YouTube long-form Phase D.
**Review trigger:** If a specific platform shows disproportionate ROI or another platform emerges as critical to target audience, revise priority.

## Decision 20 — Social content generation approach
**Decision:** Phase B: AI-generated drafts with human review (DrJ or designated reviewer) on every post. Phase C onward: AI-generated with AI-agent review for tone/accuracy/policy; human review only on breaking news, sponsored content, and high-stakes (geopolitical, religious, contested) topics.
**Rationale:** Phase B human review catches misfires while patterns are being learned. Phase C transition is mathematical (review time exceeds sustainable hours/week as posting volume scales). Kill-switch for any post (30-second retraction across all platforms) preserves recovery option throughout.
**Review trigger:** If any AI-only post in Phase C creates brand damage, tighten human-review gates for affected category.

## Decision 21 — Social media revenue model priority
**Decision:** Brand partnerships first (highest direct revenue per post; aligned with intelligence positioning). Platform monetization (YouTube AdSense, X Creator) second once thresholds hit. Affiliate links third. Paid newsletter sponsorships fourth.
**Rationale:** Brand partnerships pay $500-5,000+ per sponsored post for accounts with 50K+ engaged followers in professional/intelligence niches. Platform monetization is supplemental passive revenue, valuable but smaller. Affiliate is small per-click but cumulative. Newsletter sponsorships scale with subscriber count (Phase D-E timing).
**Review trigger:** Reviewed quarterly. If a specific revenue stream meaningfully outperforms, adjust resource allocation.

## Decision 22 — Social brand voice posture
**Decision:** Per-platform variation with consistent core voice. Tonality varies; substance does not. Core voice is informed, data-first, regionally-aware, never partisan, never sensationalized.
**Per-platform register:**
- X: direct, slightly conversational, occasional dry wit. Analyst at coffee meeting.
- LinkedIn: professional but not stiff. Document carousels for deeper analysis. Analyst presenting at quarterly meeting.
- Instagram: visual-first, captions support visual. Brief and clear. Data journalist explaining work to smart non-specialist.
- YouTube (Phase D): presenter-led, scripted but not stiff. Trusted explainer like public-radio host.
- TikTok (Phase D): faster pacing, narrative hooks, never sensationalized. Smart explainer for younger audience.
**Non-negotiable:** Never partisan, never sensationalized. Trade engagement for trust.
**Review trigger:** If voice guidelines are causing measurable underperformance vs peers AND audience research suggests adjustment, revise. Default presumption is trust > engagement.

---

# Decisions 23–30: Search & Discovery

## Decision 23 — Search backbone choice
**Decision:** Brave Search API as primary backbone for general web search. Exa.ai as semantic backbone for Layer 2 advanced search. Add second general backbone (Mojeek or Bing replacement) in Phase D for redundancy.
**Rationale:** Brave (independent crawler, ~30B pages, Goggles ranking primitive, privacy posture, ~$3-9/1000 queries) gives independence and cost efficiency. Exa (semantic-first, AI-native) gives Layer 2 depth. Phase D second backbone gives operational redundancy and negotiation leverage. Google/Bing scrapers rejected (TOS violations and dependency lock-in).
**Review trigger:** If Brave changes pricing materially or quality degrades, accelerate second-backbone integration. If institutional clients require specific backbone (e.g., Bing for compliance), evaluate.

## Decision 24 — AI generative answer model
**Decision:** Multi-model routing — DeepSeek-R1 (or comparable cost-efficient model) for routine queries, Claude/GPT-class for complex analytical queries. Cost dashboards from Phase C launch.
**Rationale:** Single premium model would cost $50K-200K/month at 1M queries (unsustainable). Single cheap model produces noticeable quality gaps on complex queries. Multi-model routing keeps cost ~$14K/month at 1M queries with appropriate quality. Pattern already proven in DrJ's ARIA system. Self-hosted open-source rejected for Phase C-E (operational complexity outweighs marginal cost savings).
**Review trigger:** Cost dashboards reviewed monthly. If cost-per-answer exceeds $0.03 average, tighten routing thresholds. If quality complaints concentrate in specific query types, route those to premium tier.

## Decision 25 — Search ad model
**Decision:** Sponsored links only above organic results, clearly labeled, contextually relevant. No display ads on search results pages.
**Rationale:** Sponsored search links are highest-CPM ad format on the internet. Display ads clutter the experience and signal "portal" rather than "intelligence platform." Clear labeling is non-negotiable (FTC, EU consumer protection, plus strategic positioning).
**Categories rejected:** crypto pump-and-dump, gambling, pseudoscience, partisan advocacy.
**Categories pursued:** research databases, B2B SaaS, premium media subscriptions, executive education, conferences.
**Revenue projection:** ~$0.02-0.05 per query at typical CTRs. At 1M monthly queries: $10K-40K/month.
**Review trigger:** If sponsored link CTR falls below 1%, reassess advertiser quality and placement. If ad quality concerns emerge, tighten advertiser approval process.

## Decision 26 — Anonymous search query limits for Layer 1
**Decision:** Phase B-C: 50 queries/day for anonymous users. Phase D: tighten to 20/day once value proposition is established. Logged-in free users: 200/day. Premium subscribers: unlimited. Rate limits enforced soft (with sign-up/upgrade CTA), not hard.
**Rationale:** 50/day is generous for Phase B-C trial; 20/day in Phase D creates conversion pressure. Logged-in free users get meaningful uplift as reward for signing up. Premium gets unlimited because $19/month subscribers expect no usage friction.
**Review trigger:** If Phase D conversion-via-search-limit significantly underperforms, tighten Phase D anonymous limit further. If trial-to-signup falls below 5% in Phase B, loosen anonymous limit temporarily.

## Decision 27 — Layer 2 ad posture
**Decision:** Layer 2 entirely ad-free at launch. **Revisit triggers:** ALL three conditions must be met for revisit — (a) Layer 2 has ≥1,000 premium subscribers, (b) audience research confirms tolerance for clearly-labeled, contextually-relevant sponsored content, (c) a specific high-value sponsorship opportunity exists that justifies brand-positioning trade-off. Default position remains ad-free.
**Rationale:** "No ads" is concrete premium value, audience-aligned (researchers and analysts are highly ad-averse), operationally clean. Sponsored intelligence briefs (Phase E, fully disclosed and editorially separated) are not "ads on Layer 2" — they are sponsored content with full disclosure.
**Review trigger:** Quarterly check against the three revisit conditions. Default = no change.

## Decision 28 — AI hallucination tolerance
**Decision:** Zero-tolerance — every claim must be citable, "I don't know" preferred over fabrication. Implementation: citation discipline (every factual claim links to specific source), confidence thresholds (below threshold = fall back to organic results), restricted topics (medical, legal, investment advice = automatic fallback + disclaimer), public correction log, weekly accuracy audit on sample of 100 random + 50 sensitive-topic queries.
**Rationale:** One screenshot of a fabricated AI answer destroys credibility for years. The competitor here is Perplexity (citation-disciplined), not Google (which accepts some hallucination). Scoopfeeds positioning is honest > confident.
**Review trigger:** If weekly audit shows hallucination rate >1% for two consecutive weeks, halt AI summary feature pending root-cause investigation. If a fabricated answer goes viral, immediate platform-wide review.

## Decision 29 — Search portal branding (REVISED FROM ORIGINAL RECOMMENDATION)
**Decision:** **"Scoop"** as the named search product. Three letters, ownable, plays on parent brand "Scoopfeeds," intelligence-flavored, journalism-grounded. External marketing: "Scoop." UI nav: "Search" or "Scoop" depending on context.
**Naming rationale:** "Scoop" captures journalism (the verb "to scoop" matches breaking-news framing), intelligence (a "scoop" is privileged information), and brand continuity (parent brand recognition). Short enough to stand alone in social posts ("Just tried Scoop — top result for [event] was a real-time tracker"). Eventually grows into a verb ("did you scoop it?"). Alternatives considered: Veris (Latin for "truth" — strong but austere), Lume (Latin for "light" — softer alternative), Scoopfeeds Search (safe but less viral), regional names (Naqd, Khabar — would create accessibility barriers globally). Scoop wins on brand continuity + memorability + accessibility.
**Tagline candidate:** "Scoop tells you what's happening, why it matters, and what's likely next."
**Review trigger:** If trademark issue emerges with "Scoop" in any major market, fall back to Veris.

## Decision 30 — SEO posture for Scoopfeeds Search results pages
**Decision:** Noindex search results pages (`/search?q=*`). Index search portal landing page only (`/search`). Robots.txt blocks search-results URL pattern from crawlers. Sitemap includes landing page; excludes results pages.
**Rationale:** Indexing search results creates duplicate-content signals that hurt SEO for actual content (event pages, dossiers, trackers). User queries become Google-discoverable URL parameters (privacy concern). Results-page indexing competes with dossier indexing (the destination). Universal pattern across all major search engines.
**Review trigger:** None — pattern is industry-universal.

---

# Decision 31: Repository Posture and License (added May 2026)

## Decision 31 — License posture for Scoopfeeds repository
**Decision:** **Option C — Mixed posture.** Code is licensed permissively (Apache 2.0 recommended). Editorial content (Reality Index outputs, AI-generated briefs, trackers, dossiers, op-ed analyses, methodology documentation, social posts) remains proprietary with "All rights reserved" notice in README.
**Repository rename:** `nmc192-ux/scoop` → `nmc192-ux/scoopfeeds` (eliminates three-layer naming ambiguity: platform = Scoopfeeds, search product = Scoop, repo = scoopfeeds).
**Rationale:** Apache 2.0 over MIT for the patent grant clause (slightly stronger contributor protections at no cost to permissiveness). Open code attracts academic citations and potential community contributions to platform code, compounding the credibility moat. Proprietary content protects editorial output that is the actual differentiator. Pattern matches Bloomberg, Stratfor, and other intelligence platforms — code patterns can be open while editorial content is tightly held.
**Implementation:**
- LICENSE file at repo root: standard Apache 2.0 text
- README.md content notice: "Code in this repository is licensed under Apache 2.0. Editorial content (briefs, trackers, AI outputs, methodology) is proprietary and not licensed for reuse without explicit permission."
- Consider future copyright notices in AI-generated content rendering (e.g., footer on event dossiers: "© Scoopfeeds. Methodology: open. Content: proprietary.")
**Review trigger:** None for code license (Apache 2.0 is permanent for already-published code). If specific content licensing emerges as a revenue line in Phase D-E (e.g., a publisher offers to license Scoopfeeds tracker data), revisit content posture for those specific assets.


---

# Decision 32: Embedding Provider (added July 2026)

## Decision 32 — Embedding provider: interim paid Gemini; permanent decision deferred to Phase C
**Question:** Which embedding provider powers article vectors for the clustering/matching engine — after the 2026-07-09 discovery that prod embedding was silently capped by the Gemini free tier (~400 requests/day → only ~24% of the ~1,688 daily non-duplicate articles embedded, so the clustering engine saw a quarter of the news)?
**Decision:** **INTERIM (effective 2026-07-09):** Gemini API key flipped to PAID tier (billing change by DrJ in the Google console; budget alert set). Removes the free-tier request cap immediately; embedding coverage should climb toward ~100% over the next cycles. **PERMANENT provider decision is deferred to Phase C as its own gated work item** — it is explicitly NOT decided here.
**Rationale (concise):** The paid flip restores 100% clustering coverage immediately at trivial cost (~$/month at current volume) with ZERO risk to the freshly COW-validated matcher calibration (`EVENT_ENTITY_MIN=0.05`, `MATCH_TAU=0.78`, `MERGE_TAU=0.86` — all calibrated against Gemini vector geometry). Any provider switch invalidates those thresholds and forces a re-sweep; the wrong week to do that reactively. **This is a tourniquet, not the destination.**
**Drift lesson (recorded):** `docs/dependencies.md` documents Gemini as the LEGACY embedding provider (intended default: Cloudflare Workers AI), yet prod runs Gemini — because the embed-provider selector in `backend/src/realityIndex/llmQueue.js` prefers Gemini whenever `GEMINI_API_KEY` is set, and Cloudflare credentials are not set on prod. Configuration drift, not a decision: prod contradicted the documented default, and the quota stall was the symptom that exposed it. *Readiness note (no code change now): consider making `EMBED_PROVIDER` an explicit required env var so provider choice is always a stated decision, not an accident of which keys exist.*
**Requirements pre-scoped for the PERMANENT Phase-C decision:**
- **(a) MULTILINGUAL.** Phase E requires 7+ languages; the currently-documented Cloudflare default model `bge-base-en-v1.5` is English-only and therefore CANNOT be the end-state (migrating to it would force a SECOND vector-space break at Phase E). Candidate class: multilingual `bge-m3` (Cloudflare or local ollama) or staying on paid Gemini (already multilingual). Choose once; break the vector space exactly once.
- **(b) QUOTA-FREE or OWNED/FLAT-COST at scale.** Source trajectory is 110 → 150 (B) → 300 (C) → 500 (D) → 800+/7-languages (E), with DrJ's ambition in the 1000s; at ~15 articles/source/day that is ~12k–30k articles/day. Clustering is the core product promise (group similar coverage so users never see the same story repeated); core-product infra should not sit behind a third-party per-request meter. This quota already broke coverage silently once.
- **(c) BUNDLED with matcher re-calibration** (threshold re-sweep on a COW snapshot) as part of the same gated item — never ship a provider switch without it.
- **(d) SEQUENCED alongside R2 (event time-bounding).** Closed events never match new articles, so old-space vectors age out naturally — R2 makes the migration materially smaller. Note also: articles prune at 7 days, so live vectors turn over in ~a week; the migration is a transition window + recalibration, NOT a mass re-embed.
**Review trigger:** Phase C kickoff (the permanent decision is a scheduled Phase-C gated item). Escalate earlier if paid-tier Gemini cost or reliability materially changes.
---

# Summary Table

| # | Decision area | Final answer | Phase impact |
|---|---|---|---|
| 1 | URL strategy | `intel.scoopfeeds.com` | All phases |
| 2 | Premium pricing | $19/month, $190/year | Phase D launch |
| 3 | Phase D revenue stream sequencing | Stagger: subs week 1, API week 4, institutional after 100 subs | Phase D |
| 4 | Editorial layer | Yes, after ≥300 subscribers | Phase E |
| 5 | AgentX integration | Loose coupling Phase E (Scoopfeeds API → AgentX) | Phase E |
| 6 | Multilingual sequencing | EN+UR through D; AR added E; RU/ZH/ES/PT/FR ingestion-only Phase C | Phase C, E |
| 7 | Methodology posture | Open methodology; proprietary weights | All phases |
| 8 | Mobile native app | Phase E, iOS+Android simultaneous | Phase E |
| 9 | Brand identity refresh | Yes, Phase B alongside homepage redesign | Phase B |
| 10 | Postgres timing | Defer indefinitely | Phase E (revisit only) |
| 11 | Prediction sources Phase C | Polymarket + Kalshi + Metaculus + AI estimates | Phase C |
| 12 | Tracker build strategy | AI-generated from validated templates with human review; auto-detection engine | Phase B-C |
| 13 | Alert delivery | Free: web push + email + Telegram. Premium: WhatsApp + webhooks + Slack/Teams + custom rules. SMS dropped, Apple Messages dropped | Phase B-D |
| 14 | Video sourcing | YouTube broadcaster aggregation Phase B-D; partnerships Phase E | Phase B-E |
| 15 | Op-ed sourcing | RSS snippets + link-out free; licensing Phase E (Project Syndicate primary) | Phase B-E |
| 16 | Source onboarding | Hybrid: AI proposes cells AND candidates; DrJ approves both | All phases |
| 17 | Translation strategy | AI-only Phase B-C; second-AI verification on sensitive content Phase C+; human review on AI disagreement | Phase B-C |
| 18 | Source licensing budget | $0 → $1.5K/mo Phase D → $5K/mo Phase E | Phase D-E |
| 19 | Social platform priority Phase B | X + LinkedIn + Instagram (existing FB/Bluesky audited and upgraded) | Phase B |
| 20 | Social content generation | Phase B human review every post; Phase C AI agent + human gates on sensitive | Phase B-C |
| 21 | Social revenue priority | Brand partnerships → platform monetization → affiliate → newsletter sponsorships | Phase C-E |
| 22 | Social brand voice | Per-platform variation with consistent core voice; never partisan, never sensationalized | All phases |
| 23 | Search backbone | Brave (primary) + Exa.ai (semantic for L2) + second backbone Phase D | Phase B-D |
| 24 | AI answer model | Multi-model routing (DeepSeek for routine, Claude/GPT for complex) | Phase C+ |
| 25 | Search ad model | Sponsored links only, no display ads, strict advertiser quality | Phase D |
| 26 | Anonymous query limits | 50/day Phase B-C, 20/day Phase D; 200/day logged-in free; unlimited premium | Phase B-D |
| 27 | Layer 2 ad posture | Entirely ad-free; revisit only if 3 conditions met | Default |
| 28 | AI hallucination tolerance | Zero-tolerance; citation discipline; restricted topics; public correction log | Phase C+ |
| 29 | Search portal branding | "Scoop" | All phases |
| 30 | Search results SEO | Noindex results pages; index portal landing page only | All phases |
| 31 | License posture | Apache 2.0 code; proprietary content. Repo rename: `scoop` → `scoopfeeds` | Sprint 0 of Phase A |

---

# Major Plan Additions Beyond the 30 Decisions

These emerged during the decision walkthrough and require integration into v6 strategic plan:

## A. Entertainment & Culture as 17th source matrix category
**Rationale:** v1-v5 treated entertainment as kill-list candidate. DrJ's correction: structured entertainment data is genuinely valuable intelligence content with high traffic, clean monetization path (affiliate via streaming), and regional advantage (Bollywood, Pakistani drama, Korean content, Arabic series).
**Sources:** Box Office Mojo, The Numbers, Variety, Deadline, Hollywood Reporter, Nielsen, Parrot Analytics, Rotten Tomatoes, Metacritic, IMDb, Bollywood Hungama, Box Office India, regional industry publications.
**Tracker types:** Box office tracker, streaming performance tracker, critical reception tracker, franchise economics tracker, awards prediction tracker (Reality Index applied), regional industry tracker.
**Layer differentiation:** Layer 1 = daily entertainment news + top-10 trackers + reviews + perspective on critical-vs-audience divergence. Layer 2 = full historical box office data (downloadable), regional industry deep dives, awards prediction with multi-source triangulation, streaming-platform analytics.
**Already in stack:** TMDB ingestion exists in scheduler. Phase B work is presentation layer + tracker templates + curated source list.

## B. Tracker Auto-Detection Engine
**New sub-capability under Capability 2 (Event Dossier).**
**Function:** Platform intelligence layer monitors event signals and auto-proposes when a new tracker should be created. Triggers based on event type signatures: war/conflict (ACLED + multi-source), epidemic (WHO surveillance + case-count growth), accident (incident with casualty floor), sports (scheduled fixture + interest indicator), environmental (NOAA/USGS + ACLED), election (scheduled date + competitive race), study release (journal + media pickup), entertainment release (release date + opening signal).
**Workflow:** Auto-detect event → propose tracker template → DrJ (or AI agent) reviews and approves → tracker instantiated using validated template → tracker auto-updates from configured data sources.
**Integrates with:** Decision 12 (template-driven tracker generation with human review).

## C. Phase A scope addition: existing social media audit
**Rationale:** DrJ's note that auto-posting already exists on FB page, Instagram, and Bluesky changes Phase A scope. Phase A audit must include current social automation setup, content quality assessment, visual treatment review, and documented upgrade path for Phase B.
**Phase A deliverable additions:** Social media current-state audit. Social Media Engine v2 upgrade specification (what to keep, what to rebuild, what to add).

---

# Decisions Pending Future Review (Not Final)

These are flagged with explicit review triggers. They should be revisited at the milestones noted, not before.

| # | Decision | Review trigger |
|---|---|---|
| 2 | Premium pricing | After first 100 subscribers |
| 4 | Editorial layer hire | At ≥300 premium subscribers |
| 5 | AgentX integration depth | If both platforms cross ≥10,000 users by Phase E |
| 8 | Mobile native app simultaneous launch | If Phase E timeline pressure emerges |
| 10 | Postgres migration | If SQLite shows binding constraints |
| 17 | Translation human-review escalation | If a translation error of consequence is published |
| 18 | Source licensing budget | Quarterly against Layer 2 revenue |
| 27 | Layer 2 ad posture | Quarterly check against 3 revisit conditions; default ad-free |
| 32 | Embedding provider (permanent) | Phase C kickoff — bundled with matcher re-calibration, sequenced with R2 |

---

# Next Step

The Phase B Kickoff Brief becomes the next critical document. It translates Phase B's strategic goals (per v5 Section 9 + the decisions in this log + the v6 plan to be drafted) into concrete execution work:

- Homepage redesign brief with wireframes
- Brand refresh inputs (color, typography, voice)
- Kill list execution checklist
- The 10-15 flagship tracker categories (now framed as auto-detection priorities given Decision 12 revision)
- Source matrix priority cells for Phase B (≥150 sources, English + Urdu, ≥6 regions)
- Social Media Engine v2 spec (X + LinkedIn + Instagram new builds; FB + Instagram + Bluesky upgrades)
- Search portal v1 spec (internal search upgrade + Brave Search API integration as preview)
- Newsletter product specs (Daily Brief, Regional Brief, Topic Briefs)
- Translation pipeline v1 spec (AI-only with confidence scoring)
- Alert engine v1 spec (web push + email + Telegram)
- Phase B success metric instrumentation
- Phase B exit criteria checklist

---

*End of document. Decisions Log v1.0.*
