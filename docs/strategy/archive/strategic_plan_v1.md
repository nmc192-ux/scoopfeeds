# Scoopfeeds Strategic Plan
## Building a World-Class AI-Native Intelligence Network

**Document type:** Strategic north-star
**Purpose:** Source of truth for "is this on strategy?" decisions across every phase
**Owner:** DrJ (Founder)
**Review cadence:** Quarterly

---

## 1. The Real Vision

### What Scoopfeeds is becoming

Scoopfeeds is an **AI-native intelligence network for events that matter** — covering the geopolitical, public health, climate, governance, and crisis stories that traditional financial intelligence platforms (Bloomberg, Reuters Eikon) under-serve. It tracks events, not articles. It surfaces probability shifts, not headlines. It triangulates source perspectives, not aggregates feeds.

In one sentence: **"The intelligence layer for the news that shapes the world but doesn't move markets — yet."**

### What Scoopfeeds is *not* trying to become

It is not trying to become Bloomberg. Bloomberg has ~2,700 journalists, decades of proprietary data, and a $24,000/year terminal. Direct competition is a category error.

It is not trying to become Yahoo News. Yahoo News is a portal — feature-rich, low-margin, advertising-dependent. That's the trap Scoopfeeds is currently *in* and needs to escape.

It is not trying to become Polymarket. Polymarket is a prediction-market exchange. Scoopfeeds uses prediction signals as *inputs* to intelligence, not as the product itself.

### The honest comparison set

| Platform | What they do well | Where they leave gaps |
|---|---|---|
| **Bloomberg / Reuters Eikon** | Markets, finance, real-time data | Geopolitics, health, climate as *intelligence* (not just headlines) |
| **Google News** | Aggregation, scale | Synthesis, probability, "what changed in 24h" |
| **Polymarket / Kalshi** | Probability signals | Editorial context, source triangulation |
| **The Economist / FT** | Analysis, depth | Real-time, machine-readable, programmatic access |
| **Reuters Connect / AP** | Wire feeds | Event-centric framing, AI synthesis |

**Scoopfeeds occupies the white space**: real-time + event-centric + AI-synthesized + source-triangulated + machine-readable, for the events Bloomberg doesn't prioritize.

---

## 2. Where We Stand (Honest Assessment)

Scoopfeeds today is a feature-rich monolith with strong architectural ambition but weak operational discipline. The backend has been substantially hardened in code (admin auth, web/scheduler/worker separation, Redis/BullMQ foundation, Postgres planning) but most of that work has not yet reached production. The frontend has not been touched by any modernization phase and still presents as a generic news portal: cars section, X feed, magazine modules, video grid, and tip jar all competing for attention on the homepage. The Reality Index — the actual differentiator — is buried as one of many features rather than positioned as the front door.

**The biggest leverage point is not technical. It is positioning.** The site doesn't know what it is, so visitors don't know what it is. Every fix in the Claude Code plan is real, but if shipped without repositioning, the site becomes "a working portal" rather than "an intelligence network."

### Assets (what to build on)
- Reality Index architecture (event tracking, timelines, actors, sentiment, anomalies)
- Multi-source ingestion pipeline (RSS, GDELT, USGS, NOAA, ACLED, FRED, World Bank, Polymarket)
- Public API + embeds infrastructure (the distribution play)
- Multilingual scaffolding (English, Urdu — a meaningful regional advantage)
- A founder (DrJ) with deep public-policy domain expertise

### Liabilities (what to fix or kill)
- Production deployment runs the old architecture (scheduler dead, hollow features)
- Homepage signals "portal" not "intelligence"
- Pakistan-source skew in the corpus
- Search is FTS5 keyword-only (no entity, no semantic, no facets)
- Dedup is fragile (Jaccard tokens)
- No success metrics defined

---

## 3. The Four Product Pillars

Every feature, page, and code change must serve one of these four pillars. If it doesn't, it gets killed or deprioritized.

### Pillar 1 — Live Event Stream
**The "what's happening" surface.** A clean, fast, prioritized feed of events (not articles) with severity, source count, and recency. Replaces the current article grid as the homepage default.

**Definition of done:** A user can land on Scoopfeeds and within 5 seconds know the 5 most important developing events globally, ranked by signal strength, not recency.

### Pillar 2 — Event Dossier
**The "what does it mean" surface.** Each tracked event has its own page: timeline, actors, geographic map, source perspectives (left/right/wire/regional), sentiment delta, AI brief, related events, market signals, watchlist trigger.

**Definition of done:** A journalist, researcher, or policy analyst can use a Scoopfeeds Event Dossier as a primary research artifact and cite it.

### Pillar 3 — Reality Index
**The "what may happen next" surface — and the moat.** Probability shifts from prediction markets, anomaly detection, truth-gap analysis (what sources agree/disagree on), confidence scoring. This is what Bloomberg does not do for non-financial events. This is the reason people come back.

**Definition of done:** Reality Index is the default view on the homepage for returning users. Anomaly alerts are a primary engagement driver.

### Pillar 4 — Intelligence API
**The distribution and revenue play.** Public API, embeds, newsletter feeds, programmatic access for newsrooms, researchers, and trading desks who don't want to build their own ingestion stack.

**Definition of done:** At least 10 external consumers (newsrooms, research orgs, data teams) actively use Scoopfeeds API or embeds, and there is a paid tier.

---

## 4. The Kill List

A world-class platform is defined as much by what it excludes as what it includes. The current homepage has too many modules competing for attention. The following must be killed, hidden, or moved:

| Module | Decision | Rationale |
|---|---|---|
| Cars section | Kill or move to footer link | Off-strategy. Not intelligence. |
| Magazine section | Kill on homepage | Generic content; doesn't serve any pillar. |
| X feed section | Kill on homepage; consider as Event Dossier source | Current placement says "portal" loud. |
| Tip jar widget | Move to footer | Premature monetization signal. |
| Affiliate widget | Move below the fold or kill | Erodes credibility on the homepage. |
| Live TV section | Move to a dedicated route, off homepage | Off-strategy unless reframed as breaking-event coverage. |
| `LiveTVChannelEmbed` (dead component) | Delete | Already dead in code. |
| Generic "most read" sidebar | Replace with "most-tracked events" | Article-centric, not event-centric. |

The homepage above the fold should contain only: the Reality Index strip, the top 5 developing events, an anomalies/divergence band, and a single search affordance. Everything else moves below the fold or off the homepage entirely.

---

## 5. The Audience Decision

Scoopfeeds cannot serve all audiences well. A strategic choice must be made.

| Audience | Pros | Cons |
|---|---|---|
| **Generalist news consumers** | Largest market, ad-revenue path | Hyper-competitive, low-margin, optimizes for clutter |
| **Researchers, journalists, policy professionals** | Premium, intelligence-hungry, high LTV | Smaller audience, requires editorial trust |
| **Developers / API consumers** | Recurring revenue, scales with their products, network effects | Requires API maturity and SLAs |

**Recommendation: Drop the generalist audience as a primary target. Build for researchers/journalists/policy professionals (the human audience) and developers/API consumers (the machine audience).** These two reinforce each other: the human surface validates the data quality, the machine surface monetizes it. The generalist audience comes for free as a byproduct, but is not optimized for.

This decision cascades:
- Homepage copy speaks to professionals, not commuters
- Ad placement is minimal or absent above the fold
- Premium tier (Reality Index Pro) targets the human audience
- API tier targets the machine audience
- SEO strategy targets long-tail intelligence queries, not breaking-news traffic

---

## 6. Success Metrics

"World-class" must mean something quantifiable. The following metrics define success in 12 months. Each phase must move at least one of these in a measurable way.

### Coverage metrics
- **Events tracked simultaneously:** target 500+ active events at any moment
- **Source diversity index:** no single source >10% of corpus, ≥6 regions covered daily, ≥3 source types (wire, regional, primary data)
- **Event coverage depth:** average event has ≥4 sources, timeline of ≥5 nodes, sentiment from ≥3 perspectives

### Quality metrics
- **Time-to-first-cluster:** new event identified and dossier created within 30 minutes of first article
- **Dedup accuracy:** <5% false-positive duplicate suppression on cross-source verification set
- **Brief accuracy:** human-reviewed AI briefs achieve ≥90% factual accuracy on weekly audit

### Engagement metrics
- **Returning user rate (7-day):** ≥35%
- **Reality Index DAU / Total DAU:** ≥40% (means RI is the reason people come back)
- **Average session depth:** ≥3 events viewed per session for returning users
- **Newsletter open rate:** ≥35% (vs industry 22%)

### Platform metrics
- **External API consumers (active):** ≥10 within 6 months
- **Embed installs:** ≥50 within 12 months
- **Premium subscribers:** ≥500 within 12 months at $15-30/month tier

### Operational metrics
- **Production uptime:** ≥99.5% on the web tier
- **Scheduler last-run age:** ≤15 minutes 99% of the time
- **Failed BullMQ job rate:** <1% over 24-hour rolling window

---

## 7. Phased Roadmap (Strategic, Not Tactical)

The Claude Code plan describes the *tactical* work. This roadmap describes the *strategic* phases. Tactical items must map to a strategic phase.

### Phase A — Stabilize (Now → 4 weeks)
**Strategic goal:** Site works in production. Backend hardening is actually deployed. Hollow features fill in.

Maps to: Step 0, all P0 items, P1-1 through P1-7 from the Claude Code plan.

**Exit criteria:**
- All P0 items closed
- `/api/health` reports scheduler running, all integrations active or explicitly off
- Urdu RTL working
- Admin auth secured everywhere
- 5 success metrics being captured (even if values are baseline-poor)

### Phase B — Reposition (Months 1–2)
**Strategic goal:** The site stops looking like a portal and starts looking like an intelligence network. The kill list is executed. The four pillars are visible.

Maps to: P2-1 (homepage repositioning) — but expanded from "add events rail" to "kill list + four-pillar layout."

**Work in this phase:**
- Execute the kill list
- New homepage: above-the-fold = Reality Index strip + Top 5 events + anomalies band + search
- New tagline / hero copy aligned to the positioning sentence
- Mobile-first redesign of homepage and Event Dossier
- Accessibility audit (WCAG 2.1 AA minimum)
- New about/positioning pages

**Exit criteria:**
- Homepage above the fold contains only intelligence content
- Mobile layout passes Lighthouse ≥90 on all four pillars
- Bounce rate measurable; baseline established
- Reality Index visible as the front door

### Phase C — Deepen (Months 2–4)
**Strategic goal:** Event Dossier becomes industry-leading. Reality Index becomes the reason returning users come back. Search becomes intelligence-grade.

Maps to: P2-2 (search overhaul), P2-3 (semantic dedup), P2-4 (source diversity), P2-5 (Reality Index as front door).

**Work in this phase:**
- Entity extraction + entity pages (people, places, organizations)
- Semantic search with hybrid scoring (BM25 + cosine)
- Semantic dedup using sqlite-vec embeddings
- Source diversity caps and ≥10 new non-South-Asian sources
- Source credibility scoring (reliability score per source)
- "Why this matters" and "What changed in 24h" AI briefs as default
- Watchlist + alert system surfaced as a primary feature

**Exit criteria:**
- Event Dossier has ≥4 sources, timeline, map, sentiment, brief — for ≥80% of active events
- Search returns entity + semantic results
- Source diversity index meets target
- Reality Index DAU ≥30% of total

### Phase D — Distribute (Months 4–6)
**Strategic goal:** The platform becomes a *network*, not a destination. APIs, embeds, newsletters become channels.

Maps to: extension of existing public API + embeds infrastructure (already in code) + new editorial CMS layer.

**Work in this phase:**
- Public API v2 with rate-limited tiers (free / paid / partner)
- Embed widgets: event card, Reality Index strip, anomaly band
- Newsletter products: Daily Brief, Weekly Reality Index, Watchlist Digest
- Editorial CMS for human-reviewed AI briefs
- Partner outreach to ≥10 newsrooms / research orgs

**Exit criteria:**
- ≥10 active external API consumers
- ≥50 embed installs
- ≥3 newsletter products with target open rates met
- First paid tier launched

### Phase E — Expand (Months 6–12)
**Strategic goal:** The platform compounds. Premium tier monetizes. Editorial layer adds defensibility.

**Work in this phase:**
- Premium tier (Reality Index Pro): historical event archive, advanced alerts, API access
- Editorial layer: 1–2 part-time editors reviewing AI briefs for premium tier
- Mobile native app (read-only, alerts-first)
- Partnership with 1–2 universities or think tanks for credibility
- Postgres migration if and only if SQLite has become the binding constraint
- AgentX integration: Scoopfeeds as a data source for AI agents on AgentX network

**Exit criteria:**
- ≥500 premium subscribers
- Coverage metrics met
- Quality metrics met
- Operational metrics met
- Self-sustaining or growth-funded

---

## 8. Strategic Decisions Required

These are decisions only the founder can make. They should be made now, before Phase B starts, because they cascade into every subsequent phase.

1. **Audience confirmation.** Is the recommendation in Section 5 accepted (drop generalists, target professionals + developers)? Decision: ___

2. **Postgres timing.** SQLite or Postgres for Phase E? Recommendation: defer Postgres until SQLite shows binding constraints. Kill the conversation for Phase A–D. Decision: ___

3. **Editorial layer.** Will Phase E include human editors, or remain fully AI-curated? Recommendation: 1–2 part-time editors for premium tier, AI-only for free tier. Decision: ___

4. **Monetization model.** Premium subscription, API tiers, sponsored briefs, or all three? Recommendation: all three, but only one launches per phase to avoid distraction. Decision: ___

5. **AgentX relationship.** Is Scoopfeeds intended to integrate with AgentX as a data source / agent host, or stay independent? Strategic synergy is real (Scoopfeeds events → AgentX agents acting on signals), but execution risk doubles. Decision: ___

6. **Open vs closed Reality Index.** Is the Reality Index methodology open (academic credibility, third-party audit) or closed (competitive moat)? Recommendation: methodology open, models and weightings closed. Decision: ___

7. **Brand and tagline.** Current "Scoopfeeds — Intelligent news, curated" is generic. New positioning sentence (Section 1) suggests "The intelligence layer for events that shape the world." Decision: ___

---

## 9. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Single-developer bottleneck** (DrJ is the only operator) | High | Critical | Heavy reliance on Claude Code + structured handoff documents. Eventually 1 part-time engineer. |
| **Scope creep** (returning to portal patterns) | High | High | This document. Kill list. Reject any new feature that doesn't map to a pillar. |
| **AI brief accuracy failures** | Medium | Critical (credibility) | Human-review queue for premium briefs. Accuracy audits weekly. Prominent labels: "AI-generated," "human-reviewed." |
| **Competitive entry** (a Moltbook-like player pivots into events) | Medium | High | Move fast on Phase B (repositioning). Reality Index as moat. Build API consumer lock-in early. |
| **Source legal exposure** (RSS reproduction, fair use) | Medium | High | Brief excerpts only. Strong source attribution. Legal review before Phase D. |
| **Cost runaway on AI inference** | Medium | Medium | Local model routing for low-stakes work (already pattern in ARIA). Cost dashboards from Phase A. |
| **Hostinger / infrastructure limits** | Medium | Medium | Containerization plan exists (Dockerfile committed). Migration to Fly.io / Railway / Render if Hostinger binds. |
| **Geopolitical content risk** (covering Pakistan, India, Middle East from Pakistan) | Low | High | Editorial guidelines. Disclosed methodology. No partisan framing. Multiple-source requirement for sensitive events. |
| **Codex / AI agent execution drift** (deploys not matching code) | High (already happened once) | High | Mandatory deploy-verification step in every phase. Post-merge production smoke tests. |

---

## 10. How to Use This Document

This document is the **source of truth for "is this on strategy?"** for every subsequent decision.

**Before adding any feature, ask:**
- Which of the four pillars does this serve?
- Which audience does this serve?
- Which success metric will it move?
- If none of the above, it gets killed.

**Before approving any code change, ask:**
- Which strategic phase is this in?
- What is the exit criterion this contributes to?
- Is there a deploy-verification step?

**Before each phase kicks off:**
- Re-read Section 1 (the vision) and Section 6 (metrics)
- Confirm the prior phase exit criteria are met
- Update Section 8 (decisions) if any have shifted

**Quarterly review:**
- Score against Section 6 metrics
- Update the risk register (Section 9)
- Reaffirm or revise the kill list (Section 4)
- Reaffirm or revise the audience decision (Section 5)

**This document is not a contract. It is a compass.** When the world changes (a competitor pivots, a metric surprises, an audience signals differently), the document updates. But every update is deliberate, written down, and dated — not silent drift.

---

## Appendix A — Mapping Tactical Plans to Strategic Phases

| Tactical Item (from Claude Code plan) | Strategic Phase | Pillar Served |
|---|---|---|
| Step 0 (worktree sync) | Phase A | All (foundation) |
| P0-1 to P0-6 (stop-the-bleeding) | Phase A | All (foundation) |
| P1-1 to P1-7 (debt) | Phase A | All (foundation) |
| P2-1 (homepage rail) — *expanded* | Phase B | Pillars 1, 3 |
| P2-2 (search overhaul) | Phase C | Pillar 2 |
| P2-3 (semantic dedup) | Phase C | Pillars 1, 2 |
| P2-4 (source diversity) | Phase C | Pillars 1, 2 |
| P2-5 (Reality Index home) | Phase B + C | Pillar 3 |
| P3-1 to P3-5 (hygiene) | Phase A | All (foundation) |
| Postgres migration | Phase E (only if needed) | Foundation |
| API v2 + embeds | Phase D | Pillar 4 |
| Newsletter products | Phase D | Pillar 4 |
| Premium tier | Phase E | Pillars 3, 4 |
| Editorial CMS | Phase D / E | Pillars 2, 3 |
| Mobile native app | Phase E | Pillars 1, 2, 3 |

---

## Appendix B — One-Sentence Tests

When in doubt, run any decision through these:

- **"Does Bloomberg do this for our events?"** If no, it's an opportunity. If yes, do it 10× better or skip.
- **"Would a researcher cite this?"** If yes, it's Pillar 2 quality. If no, deepen it.
- **"Would a developer pay for this via API?"** If yes, it's Pillar 4. If no, ask why.
- **"Does this make returning users come back?"** If yes, it's Pillar 3. If no, it's Pillar 1 at best.
- **"Could this run on the homepage of a portal?"** If yes, kill it.
- **"Would I bet my reputation on this brief?"** If no, don't publish it.

---

*End of document.*
