# Phase A Source Audit — Phase 1

**Document type:** Source audit (Sprint 4 Phase 1: issues 4.1, 4.2, partial 4.3)
**Date:** 2026-05-15 (Session 24 Part 2)
**Author:** DrJ (Founder) + Claude Code
**Source of truth:** `backend/src/config/sources.js` (461 lines)
**Target taxonomy:** Strategic Plan v6 §3 Capability 1 (17 categories × 10 regions × 10 source types)
**Status:** Inventory + matrix categorization complete. Quality scoring (4.4), backfill (4.5), gap synthesis (4.6), Phase B priority list (4.7) defer to session 25.

**Source inputs:**
- `backend/src/config/sources.js` — current RSS + YouTube + X taxonomy
- `docs/strategy/strategic_plan_v6.md` §3 Capability 1 — target matrix
- `docs/phases/phase_a_retrospective_inputs.md` finding #75 UNCLEAR 5 — audit scope reframing
- Production `/api/health` — sourceCount + videoChannels verification

---

## 1. Inventory Totals

### 1.1 Source counts

| Source type | Count | Cross-check |
|---|---|---|
| RSS feeds (`RSS_SOURCES`) | **119** | ✓ matches `/api/health.sourceCount: 119` |
| YouTube channels (`YOUTUBE_SOURCES`) | **44** | ✓ matches `/api/health.videoChannels: 44` |
| X (Twitter) curated accounts (`X_ACCOUNTS`) | 19 topic groups, ~80 handles total | not tracked in `/api/health` |
| **RSS — primary audit scope** | **119 rows** | this audit's matrix-categorization main table |

### 1.2 Current category distribution (RSS, 19 distinct)

```
24 international      ← largest (20% of RSS)
14 business
 7 tech
 7 publications
 7 pakistan
 6 environment
 5 top
 5 science
 5 politics
 5 health
 5 cars
 5 ai
 4 sports
 4 computer-science
 4 agentic-ai
 3 self-help
 3 public-health
 3 medicine
 3 local
```

### 1.3 Current region distribution (RSS, 19 distinct)

```
78 global       ← 66% of total
13 us
 8 pk
 3 in
 2 il
 2 eu
 1 each: za, sa, latam, kr, ke, jp, fr, de, br, au
 1 each: us-west, us-east, us-midwest  ← Local-tab subregions
```

### 1.4 Self-described credibility distribution (RSS)

```
31 credibility: 10   (26%)
35 credibility: 9    (29%)
42 credibility: 8    (35%)
11 credibility: 7    (9%)
 0 credibility: ≤6
```

**Honest caveat (per DrJ guidance):** The credibility scores in `backend/src/config/sources.js` are **author-assigned by DrJ**, NOT measured. They reflect editorial taste at source-onboarding time. They do not constitute evidence of source quality. **Sprint 4.4 (quality scoring schema) in session 25 will design the measured replacement** per Decision 16 framework (multi-component scoring with audit-able breakdown). Until Sprint 4.4 ships, treat the current scores as provisional ordering only.

### 1.5 YouTube (parallel inventory, not in §2 main table)

YouTube channels (44 total) span **14 current categories** (vs RSS's 19) and only **3 regions** (29 global / 9 us / 6 pk). The narrower regional coverage on YouTube reflects channel-availability constraints (fewer regional broadcasters publish to YouTube). YouTube is not categorized against Plan v6 matrix in this audit phase — RSS-only scope per DrJ.

---

## 2. Matrix Categorization (119 RSS Rows)

Each row maps a current `sources.js` entry to its Plan v6 target taxonomy. Organized by current-category cluster for navigability.

Columns: **Name** | **Current cat** | **Current region** | **Cred** | **Plan v6 category** | **Plan v6 region** | **Inferred source type** | **Notes**

### 2.A "Top news / general" (5 sources)

| Name | Cur cat | Cur reg | Cred | Plan v6 category | Plan v6 region | Inferred type | Notes |
|---|---|---|---|---|---|---|---|
| Reuters | top | global | 10 | Politics & Government | Global¹ | Wire services | General feed; mixed content |
| BBC News | top | global | 10 | Politics & Government | Europe | International broadcasters | UK-anchored; UNCLEAR-A |
| Associated Press | top | global | 10 | Politics & Government | Global¹ | Wire services | URL `apf-topnews` may be defunct (§4) |
| NPR News | top | us | 9 | Politics & Government | North America | International broadcasters | Public radio |
| The Guardian | top | global | 9 | Politics & Government | Europe | National newspapers | UK national daily |

¹ "Global" sources (multi-region or true wire) preserved as `Global` rather than forced into a Plan v6 region. Plan v6 region mapping does not include "Global" as an explicit region, but treating wire services as belonging to a single region would be misleading. **Mapping decision logged in §5.**

### 2.B "Politics" (5 sources)

| Name | Cur cat | Cur reg | Cred | Plan v6 category | Plan v6 region | Inferred type | Notes |
|---|---|---|---|---|---|---|---|
| Politico | politics | us | 9 | Politics & Government | North America | Specialized publications | |
| The Hill | politics | us | 8 | Politics & Government | North America | Specialized publications | |
| NPR Politics | politics | us | 9 | Politics & Government | North America | International broadcasters | |
| BBC Politics | politics | global | 10 | Politics & Government | Europe | International broadcasters | UK-anchored |
| Reuters Politics | politics | global | 10 | Politics & Government | Global | Wire services | Feed may be defunct (§4) |

### 2.C "International" (5 sources, base set)

| Name | Cur cat | Cur reg | Cred | Plan v6 category | Plan v6 region | Inferred type | Notes |
|---|---|---|---|---|---|---|---|
| BBC World | international | global | 10 | Politics & Government | Europe | International broadcasters | UK; covers Conflict & Security materially |
| Al Jazeera | international | global | 8 | Politics & Government | MENA² | International broadcasters | Qatar-anchored; covers Conflict & Security materially |
| DW English | international | global | 9 | Politics & Government | Europe | International broadcasters | German broadcaster |
| France 24 | international | global | 9 | Politics & Government | Europe | International broadcasters | French broadcaster |
| Reuters World | international | global | 10 | Politics & Government | Global | Wire services | Feed may be defunct (§4) |

² Al Jazeera is technically global-framed but publisher is MENA-anchored. **Mapping decision: anchor by publisher origin where editorial focus material to region. Logged in §5.**

### 2.D "Pakistan" (7 sources)

| Name | Cur cat | Cur reg | Cred | Plan v6 category | Plan v6 region | Inferred type | Notes |
|---|---|---|---|---|---|---|---|
| Dawn News | pakistan | pk | 9 | Politics & Government | South Asia | National newspapers | English-language Pakistani daily |
| The News Intl | pakistan | pk | 8 | Politics & Government | South Asia | National newspapers | |
| Geo News | pakistan | pk | 8 | Politics & Government | South Asia | International broadcasters | TV-first |
| ARY News | pakistan | pk | 8 | Politics & Government | South Asia | International broadcasters | TV-first |
| Express Tribune | pakistan | pk | 8 | Politics & Government | South Asia | National newspapers | |
| Business Recorder | pakistan | pk | 8 | Economics & Markets | South Asia | Specialized publications | Financial-focused |
| Pakistan Observer | pakistan | pk | 7 | Politics & Government | South Asia | National newspapers | |

### 2.E "Sports" (4 sources)

| Name | Cur cat | Cur reg | Cred | Plan v6 category | Plan v6 region | Inferred type | Notes |
|---|---|---|---|---|---|---|---|
| ESPN | sports | us | 9 | Sports | North America | Specialized publications | |
| BBC Sport | sports | global | 10 | Sports | Europe | International broadcasters | UK-anchored |
| Sports Illustrated | sports | us | 8 | Sports | North America | Specialized publications | |
| Reuters Sports | sports | global | 10 | Sports | Global | Wire services | Feed may be defunct (§4) |

### 2.F "Science" (5 sources)

| Name | Cur cat | Cur reg | Cred | Plan v6 category | Plan v6 region | Inferred type | Notes |
|---|---|---|---|---|---|---|---|
| Science Daily | science | global | 9 | Science & Technology | Global | Specialized publications | |
| NASA News | science | global | 10 | Science & Technology | North America | Government & primary data | US gov agency |
| New Scientist | science | global | 9 | Science & Technology | Europe | Specialized publications | UK-based |
| Nature News | science | global | 10 | Science & Technology | Europe | Academic sources | UK journal |
| Scientific American | science | global | 10 | Science & Technology | North America | Specialized publications | US-based |

### 2.G "Medicine + Health + Public Health" (12 sources combined)

| Name | Cur cat | Cur reg | Cred | Plan v6 category | Plan v6 region | Inferred type | Notes |
|---|---|---|---|---|---|---|---|
| Medical News Today | medicine | global | 8 | Health & Medicine | Global | Specialized publications | |
| WHO News | medicine | global | 10 | Health & Medicine | Global | Government & primary data | UN body; URL collision with WHO Headlines below (§4) |
| NIH News | medicine | us | 10 | Health & Medicine | North America | Government & primary data | |
| WebMD | health | global | 8 | Health & Medicine | Global | Specialized publications | |
| Healthline | health | global | 8 | Health & Medicine | Global | Specialized publications | |
| Harvard Health | health | global | 9 | Health & Medicine | North America | Academic sources | Harvard Med |
| CDC Newsroom | public-health | us | 10 | Health & Medicine | North America | Government & primary data | |
| WHO Headlines | public-health | global | 10 | Health & Medicine | Global | Government & primary data | Second WHO entry; verify which is canonical |
| Reuters Health | public-health | global | 10 | Health & Medicine | Global | Wire services | Feed may be defunct (§4) |
| STAT News | health | global | 9 | Health & Medicine | North America | Specialized publications | Phase 5 |
| BMJ News | health | global | 10 | Health & Medicine | Europe | Academic sources | UK medical journal; Phase 5 |

(11 rows total: 3 medicine + 3 health + 3 public-health + 2 Phase 5 health additions)

### 2.H "Self-help" (3 sources — Plan v6 ambiguous)

| Name | Cur cat | Cur reg | Cred | Plan v6 category | Plan v6 region | Inferred type | Notes |
|---|---|---|---|---|---|---|---|
| Psychology Today | self-help | us | 8 | Culture & Society | North America | Specialized publications | UNCLEAR-B: no Plan v6 self-help category |
| Mind Body Green | self-help | global | 7 | Culture & Society | Global | Specialized publications | UNCLEAR-B |
| Verywell Mind | self-help | global | 8 | Culture & Society | Global | Specialized publications | UNCLEAR-B |

UNCLEAR-B in §5.

### 2.I "Environment" (3 base + 3 Phase 5 = 6 sources)

| Name | Cur cat | Cur reg | Cred | Plan v6 category | Plan v6 region | Inferred type | Notes |
|---|---|---|---|---|---|---|---|
| The Guardian Environment | environment | global | 9 | Climate & Environment | Europe | National newspapers | UK Guardian section |
| Inside Climate News [#1] | environment | global | 8 | Climate & Environment | Global | Specialized publications | DUP candidate — see §4 |
| Carbon Brief | environment | global | 9 | Climate & Environment | Europe | Specialized publications | UK think-tank-style |
| Inside Climate News [#2] | environment | global | 9 | Climate & Environment | Global | Specialized publications | **DUPLICATE** of #1 — see §4 |
| Grist | environment | global | 8 | Climate & Environment | North America | Specialized publications | Phase 5 |
| Climate Home News | environment | global | 8 | Climate & Environment | Europe | Specialized publications | Phase 5 |

### 2.J "Cars" (5 sources — Plan v6 ambiguous)

| Name | Cur cat | Cur reg | Cred | Plan v6 category | Plan v6 region | Inferred type | Notes |
|---|---|---|---|---|---|---|---|
| PakWheels Blog | cars | pk | 8 | Culture & Society | South Asia | Specialized publications | UNCLEAR-C |
| Car and Driver | cars | global | 9 | Culture & Society | North America | Specialized publications | UNCLEAR-C |
| Top Gear | cars | global | 9 | Culture & Society | Europe | Specialized publications | UK; UNCLEAR-C |
| MotorTrend | cars | global | 8 | Culture & Society | North America | Specialized publications | UNCLEAR-C |
| Road & Track | cars | global | 8 | Culture & Society | North America | Specialized publications | UNCLEAR-C |

UNCLEAR-C in §5.

### 2.K "AI + Computer Science + Agentic AI + Tech" (20 sources → Science & Technology)

These four current categories collapse to one Plan v6 category.

| Name | Cur cat | Cur reg | Cred | Plan v6 category | Plan v6 region | Inferred type | Notes |
|---|---|---|---|---|---|---|---|
| MIT Technology Review | ai | global | 10 | Science & Technology | North America | Academic sources | MIT-published |
| VentureBeat AI | ai | global | 8 | Science & Technology | North America | Specialized publications | |
| The Verge AI | ai | global | 8 | Science & Technology | North America | Specialized publications | |
| Wired | ai | global | 9 | Science & Technology | North America | Specialized publications | |
| TechCrunch AI | ai | global | 8 | Science & Technology | North America | Specialized publications | |
| Hacker News | computer-science | global | 8 | Science & Technology | Global | Independent journalism | Community aggregator |
| IEEE Spectrum | computer-science | global | 9 | Science & Technology | Global | Academic sources | IEEE professional body |
| TechCrunch | computer-science | global | 8 | Science & Technology | North America | Specialized publications | |
| Ars Technica | computer-science | global | 9 | Science & Technology | North America | Specialized publications | |
| Anthropic Blog | agentic-ai | global | 10 | Science & Technology | North America | Specialized publications | UNCLEAR-D: company blog vs journalism |
| OpenAI Blog | agentic-ai | global | 10 | Science & Technology | North America | Specialized publications | UNCLEAR-D |
| LessWrong | agentic-ai | global | 8 | Science & Technology | Global | Independent journalism | Community-driven |
| The Gradient | agentic-ai | global | 9 | Science & Technology | Global | Specialized publications | Academic-leaning |
| The Verge | tech | global | 9 | Science & Technology | North America | Specialized publications | |
| Engadget | tech | global | 8 | Science & Technology | North America | Specialized publications | |
| CNET | tech | global | 8 | Science & Technology | North America | Specialized publications | |
| Gizmodo | tech | global | 7 | Science & Technology | North America | Specialized publications | |
| MacRumors | tech | global | 8 | Science & Technology | North America | Specialized publications | |
| 9to5Mac | tech | global | 8 | Science & Technology | North America | Specialized publications | |
| Bloomberg Tech | tech | global | 10 | Economics & Markets | North America | Specialized publications | UNCLEAR-E: tech-business overlap |

UNCLEAR-D and UNCLEAR-E in §5.

### 2.L "Local" (3 sources — US sub-regional)

| Name | Cur cat | Cur reg | Cred | Plan v6 category | Plan v6 region | Inferred type | Notes |
|---|---|---|---|---|---|---|---|
| LA Times | local | us-west | 9 | Politics & Government | North America | Regional newspapers | |
| NY Times Local | local | us-east | 10 | Politics & Government | North America | Regional newspapers | |
| Chicago Tribune | local | us-midwest | 8 | Politics & Government | North America | Regional newspapers | |

### 2.M "Business" (8 base + 6 Phase 5 = 14 sources)

| Name | Cur cat | Cur reg | Cred | Plan v6 category | Plan v6 region | Inferred type | Notes |
|---|---|---|---|---|---|---|---|
| Reuters Business | business | global | 10 | Economics & Markets | Global | Wire services | Feed may be defunct (§4) |
| BBC Business | business | global | 10 | Economics & Markets | Europe | International broadcasters | |
| CNBC | business | us | 9 | Economics & Markets | North America | International broadcasters | |
| Forbes | business | global | 8 | Economics & Markets | North America | Specialized publications | |
| Bloomberg Markets | business | global | 10 | Economics & Markets | North America | Specialized publications | |
| Financial Times | business | global | 10 | Economics & Markets | Europe | National newspapers | UK national paper |
| Fortune | business | global | 8 | Economics & Markets | North America | Specialized publications | |
| Fast Company | business | global | 8 | Economics & Markets | North America | Specialized publications | |
| MarketWatch | business | us | 8 | Economics & Markets | North America | Specialized publications | Phase 5 |
| Yahoo Finance | business | us | 7 | Economics & Markets | North America | Specialized publications | Phase 5 |
| Investing.com | business | global | 7 | Economics & Markets | Global | Specialized publications | Phase 5 |
| CoinDesk | business | global | 8 | Economics & Markets | Global | Specialized publications | Phase 5 crypto |
| The Block | business | global | 8 | Economics & Markets | Global | Specialized publications | Phase 5 crypto |
| Decrypt | business | global | 7 | Economics & Markets | Global | Specialized publications | Phase 5 crypto |

### 2.N "Publications" (6 sources — high-credibility magazines)

| Name | Cur cat | Cur reg | Cred | Plan v6 category | Plan v6 region | Inferred type | Notes |
|---|---|---|---|---|---|---|---|
| The Economist | publications | global | 10 | Economics & Markets | Europe | Specialized publications | UK; UNCLEAR-F: also covers Politics & Government materially |
| Foreign Affairs | publications | global | 10 | Politics & Government | North America | Think tanks & research orgs | Council on Foreign Relations |
| The Atlantic | publications | global | 9 | Culture & Society | North America | Specialized publications | |
| Smithsonian | publications | global | 9 | Culture & Society | North America | Specialized publications | Covers history + science also |
| NY Times | publications | us | 10 | Politics & Government | North America | National newspapers | Homepage feed |
| The New Yorker | publications | global | 10 | Culture & Society | North America | Specialized publications | Long-form |

UNCLEAR-F in §5.

### 2.O Phase 5 — India (3 sources)

| Name | Cur cat | Cur reg | Cred | Plan v6 category | Plan v6 region | Inferred type | Notes |
|---|---|---|---|---|---|---|---|
| The Hindu | international | in | 9 | Politics & Government | South Asia | National newspapers | |
| Times of India | international | in | 7 | Politics & Government | South Asia | National newspapers | |
| Indian Express | international | in | 8 | Politics & Government | South Asia | National newspapers | |

### 2.P Phase 5 — MENA (3 sources, Israel-heavy)

| Name | Cur cat | Cur reg | Cred | Plan v6 category | Plan v6 region | Inferred type | Notes |
|---|---|---|---|---|---|---|---|
| Times of Israel | international | il | 8 | Politics & Government | MENA | National newspapers | |
| Haaretz | international | il | 9 | Politics & Government | MENA | National newspapers | |
| Arab News | international | sa | 7 | Politics & Government | MENA | National newspapers | Saudi-published |

### 2.Q Phase 5 — Europe non-UK (4 sources)

| Name | Cur cat | Cur reg | Cred | Plan v6 category | Plan v6 region | Inferred type | Notes |
|---|---|---|---|---|---|---|---|
| Le Monde (English) | international | fr | 9 | Politics & Government | Europe | National newspapers | |
| Der Spiegel (Eng) | international | de | 9 | Politics & Government | Europe | National newspapers | |
| Politico Europe | international | eu | 9 | Politics & Government | Europe | Specialized publications | |
| Euronews | international | eu | 8 | Politics & Government | Europe | International broadcasters | |

### 2.R Phase 5 — Asia-Pacific (3 sources)

| Name | Cur cat | Cur reg | Cred | Plan v6 category | Plan v6 region | Inferred type | Notes |
|---|---|---|---|---|---|---|---|
| ABC Australia | international | au | 9 | Politics & Government | Oceania & Pacific | International broadcasters | |
| NHK World | international | jp | 9 | Politics & Government | East Asia | International broadcasters | |
| Korea Herald | international | kr | 7 | Politics & Government | East Asia | National newspapers | |

### 2.S Phase 5 — Latin America (2 sources)

| Name | Cur cat | Cur reg | Cred | Plan v6 category | Plan v6 region | Inferred type | Notes |
|---|---|---|---|---|---|---|---|
| Folha (English) | international | br | 8 | Politics & Government | Latin America | National newspapers | Brazilian; English edition |
| MercoPress | international | latam | 7 | Politics & Government | Latin America | Independent journalism | South Atlantic regional wire |

### 2.T Phase 5 — Africa (2 sources)

| Name | Cur cat | Cur reg | Cred | Plan v6 category | Plan v6 region | Inferred type | Notes |
|---|---|---|---|---|---|---|---|
| Mail & Guardian | international | za | 8 | Politics & Government | Sub-Saharan Africa | National newspapers | South African |
| Daily Nation | international | ke | 7 | Politics & Government | Sub-Saharan Africa | National newspapers | Kenyan |

### 2.U Phase 5 — Defense / Geopolitics (3 sources)

| Name | Cur cat | Cur reg | Cred | Plan v6 category | Plan v6 region | Inferred type | Notes |
|---|---|---|---|---|---|---|---|
| Defense News | international | global | 8 | Conflict & Security | North America | Specialized publications | US-based industry pub |
| War on the Rocks | international | global | 9 | Conflict & Security | North America | Think tanks & research orgs | National security analysis |
| Foreign Policy | publications | global | 9 | Politics & Government | North America | Specialized publications | Slate Group; covers Conflict materially |

---

## 3. Coverage Analysis (RSS Against Plan v6 Matrix)

### 3.1 Plan v6 category coverage (after mapping)

| Plan v6 category | Mapped count | Status |
|---|---|---|
| **Politics & Government** | ~60 (50%+) | **OVERWEIGHTED** — dominant category; expected for a general-news platform |
| **Economics & Markets** | ~23 (19%) | Well covered |
| **Science & Technology** | ~18 (15%) | Well covered (AI + CS + Tech + Science collapsed) |
| **Health & Medicine** | ~11 (9%) | Adequate |
| **Climate & Environment** | 6 (5%) | Marginal (1 duplicate inflates count) |
| **Culture & Society** | ~9 (8%) | Marginal (self-help + cars + Atlantic/Smithsonian/New Yorker make up most) |
| **Sports** | 4 (3%) | Marginal |
| **Conflict & Security** | 2 (2%) | **CRITICAL GAP** — only Defense News + War on the Rocks |
| **Religion** | 0 | **ZERO COVERAGE** |
| **Migration & Refugees** | 0 | **ZERO COVERAGE** |
| **Energy & Resources** | 0 | **ZERO COVERAGE** |
| **Maritime & Shipping** | 0 | **ZERO COVERAGE** |
| **Aviation** | 0 | **ZERO COVERAGE** |
| **Agriculture & Food Security** | 0 | **ZERO COVERAGE** |
| **Education** | 0 | **ZERO COVERAGE** |
| **Human Rights** | 0 | **ZERO COVERAGE** |
| **Entertainment & Culture** | 0 | **ZERO COVERAGE** |

**9 of 17 Plan v6 categories have ZERO coverage.** This is the category-side headline finding.

### 3.2 Plan v6 region coverage (after mapping)

Per DrJ's guidance — explicit gap callouts:

#### Zero coverage (3 regions)

| Region | Sources mapped | Notes |
|---|---|---|
| **Southeast Asia** | 0 | No Indonesia, Vietnam, Philippines, Singapore, Thailand, Malaysia coverage |
| **Russia & Central Asia** | 0 | No Russian, Kazakh, Uzbek, Mongolian coverage; geopolitically significant gap |
| **Oceania & Pacific** | 1 (ABC Australia) | Effectively zero — 1 source from 1 country; no Pacific Islands, no New Zealand |

#### Near-zero coverage (3 regions)

| Region | Sources mapped | Detail |
|---|---|---|
| **MENA** | 5 (Al Jazeera + Times of Israel + Haaretz + Arab News + [Foreign Policy partial]) | Israel-heavy (2 of 5); no Egyptian, UAE, Qatari, Iranian, Turkish national papers. Al Jazeera and Arab News are the only Arab-published. |
| **Sub-Saharan Africa** | 2 (Mail & Guardian + Daily Nation) | South Africa + Kenya only; nothing from West Africa (Nigeria), Horn of Africa (Ethiopia), Francophone Africa, Lusophone Africa |
| **East Asia** | 2 (NHK + Korea Herald) | Japan + South Korea only; no China (PRC) coverage at all — major geopolitical gap |

#### Overweighted coverage (3 regions)

| Region | Sources mapped | Detail |
|---|---|---|
| **Global** | ~20 | Wire services + global broadcasters (Reuters/AP/BBC World/AJ/DW/Sci Daily/WHO/Investing.com/etc.) |
| **North America** | ~55 | US sources + many "global" brands HQ'd in NA (NASA/Anthropic/OpenAI/NYT/CNBC/Bloomberg/Forbes/etc.) — single largest absolute count |
| **Europe** | ~22 | UK-heavy (BBC/FT/Economist/Guardian/Top Gear/Carbon Brief/IEEE-style sources counted via UK presence) + Phase 5 Le Monde/Spiegel/Politico EU/Euronews |
| **South Asia** | 10 | Pakistan x 7 + India x 3 — Pakistan-heavy reflects DrJ founding-team locale |

**Phase B exit criterion "≥6 regions covered daily"** (per Strategic Plan v6 §9 Phase B exit criteria): Phase B will count if and only if Southeast Asia, Russia/Central Asia, Oceania regions get genuine onboarding. Current state covers 4 regions cleanly (North America, Europe, South Asia, plus partial Global wire) + 3 marginal (MENA, Sub-Saharan Africa, East Asia) + 3 zero. The exit criterion **requires non-trivial new source onboarding work**, not just categorization. Categorization-first audit (this document) doesn't address the underlying coverage gap.

### 3.3 Plan v6 source type coverage (inferred)

| Plan v6 source type | Inferred RSS count | Status |
|---|---|---|
| **Specialized publications** | ~55-60 | **DOMINANT** (~48% of total) |
| **National newspapers** | ~22 | Well covered |
| **International broadcasters** | ~18 | Well covered |
| **Wire services** | ~7 | Limited (Reuters + AP; both URL-questionable per §4) |
| **Academic sources** | ~6 | Sparse (Nature + IEEE Spectrum + Harvard Health + MIT Tech Review + BMJ + Gradient) |
| **Government & primary data** | 5 | Sparse (NASA + NIH + CDC + WHO News + WHO Headlines) |
| **Regional newspapers** | 3 | Sparse (LA Times + NY Times Local + Chicago Tribune — all US) |
| **Independent journalism** | 3 | Sparse (Hacker News + MercoPress + LessWrong) |
| **Think tanks & research orgs** | 2 | **CRITICAL GAP** — only Foreign Affairs (CFR) + War on the Rocks |
| **Local-language sources** | **0** | **ZERO COVERAGE** |

**Notable findings:**

1. **Local-language sources = 0.** All 119 RSS feeds are English. Even Pakistani sources (Dawn, Geo, ARY) ingest in English. Per Decision 6 (multilingual sequencing), Russian/Mandarin/Spanish/Portuguese/French ingestion-only adds Phase C. Until then, every translation requires going through English first.

2. **Specialized publications dominance (48%) is a structural skew.** Phase B work on quality scoring (Sprint 4.4) will need to distinguish between "high-volume specialized publication" (CoinDesk, Decrypt) and "high-authority specialized publication" (Foreign Affairs, BMJ, IEEE Spectrum) — the current 1-10 credibility score can't articulate the difference precisely.

3. **Think tank coverage near-zero.** Two think-tank-adjacent sources (Foreign Affairs as CFR-published; War on the Rocks as independent analysis). No CSIS, Brookings, RAND, Chatham House, ICG, ECFR, SIPRI, IISS, IFRI, Stratfor, etc. Phase B Track 1 work on intelligence-grade analysis (per Strategic Plan v6 Layer 2) will need think-tank source onboarding.

4. **Wire service coverage looks decent (7 entries) but most are at risk** — 6 Reuters URLs + 1 AP URL all use `feeds.reuters.com` and `apnews.com/apf-*` patterns that may be defunct (§4). If those go dead, wire service count collapses to ~0.

---

## 4. Dead / Duplicate Candidates

This audit FLAGS candidates. Actual cleanup is Sprint 4.3 full completion in session 25.

### 4.1 Confirmed exact duplicate

| # | Source | Location | Action recommendation |
|---|---|---|---|
| 1 | **Inside Climate News** | Line 71 (original Environment section) + Line 180 (Phase 5 Climate/Energy section) — same URL `https://insideclimatenews.org/feed/`; same category; same region; slightly different credibility (8 → 9) | Drop line 180; keep line 71. Single-line edit in Sprint 4.3. |

No other URL or name duplicates in `RSS_SOURCES`.

### 4.2 Dead source candidates (verification needed)

These need HTTP HEAD verification before declaring dead. **Inference is honest reasoning from publisher history, not measurement.** All deferred to Sprint 4.3 in session 25.

| # | Source(s) | URL pattern | Concern | Action |
|---|---|---|---|---|
| 1 | Reuters (6 entries: topNews, politicsNews, worldnews, sportsNews, healthNews, businessNews) | `feeds.reuters.com/reuters/<feed>` | Reuters restructured public RSS around 2023; the `feeds.reuters.com` paths may return 404/redirect or empty | `curl -I` each URL in session 25; if defunct, replace with alternative wire (UPI, AFP English) or remove |
| 2 | Associated Press | `apnews.com/apf-topnews` | AP also restructured RSS; `apf-*` paths likely defunct format | `curl -I` in session 25 |
| 3 | WHO News (`/rss-feeds/news-english.xml`) vs WHO Headlines (`/feeds/entity/mediacentre/news/en/rss.xml`) | Two different paths | Both may be valid (different scope) OR one is deprecated | `curl -I` both; document scope of each |

**Total at-risk:** 7 entries (6 Reuters + 1 AP) plus 2 WHO URL questions = 9 verification items for Sprint 4.3.

If all 7 Reuters/AP go dead and only 1 WHO is canonical, RSS active count drops from 119 to ~111. **Phase B "150+ sources" target adjusts accordingly** — onboarding gap widens from +31 to +39.

### 4.3 Suspect-but-likely-fine

These are flagged for awareness but don't warrant verification effort:

- Bloomberg feeds (3 entries: technology, markets, businessweek-esque) — Bloomberg has restructured RSS multiple times; current URLs may work but are not stable signals
- BBC feeds (5 entries with various paths) — BBC RSS is generally stable but has had path changes
- The Hindu / Times of India / Indian Express — Phase 5 additions; verify they actually deliver content in production (cross-check with `articles` table by `source_name`)

These can wait for Sprint 4.3 audit pass without forcing immediate action.

---

## 5. Mapping Ambiguities

Sources where Plan v6 mapping required judgment. Each ambiguity is noted in §2 with letter code; this section explains.

### UNCLEAR-A: BBC News (and "global" UK-anchored broadcasters)

**The question:** BBC News covers global news but is a UK national broadcaster. Plan v6 region = Europe or Global?

**Resolution applied:** Europe (UK-anchored). Reasoning: publisher origin is UK; editorial perspective is UK-centric (even on world stories); BBC counts toward Europe regional coverage, not Global wire coverage.

**Applied also to:** BBC Politics, BBC World, BBC Business, BBC Sport, The Guardian (sections), Financial Times, The Economist, Carbon Brief, Top Gear, IEEE Spectrum (US-based but global membership)

### UNCLEAR-B: Self-help (Psychology Today, Mind Body Green, Verywell Mind)

**The question:** Plan v6 has no "Self-help" or "Wellness" category. Closest fits: Culture & Society OR Health & Medicine.

**Resolution applied:** Culture & Society. Reasoning: self-help content is primarily about mental wellness, social behavior, lifestyle — not clinical health. The 17-category framework's "Culture & Society" is the catchall for human-experience content not covered by other categories.

**Alternative considered:** Health & Medicine. Rejected because would dilute the Health & Medicine category with non-clinical lifestyle content; would mislead Phase B Track 1 work on Health & Medicine to think it has more clinical coverage than it does.

**Phase B implication:** Self-help sources don't really serve any of Plan v6's 17 categories cleanly. Consider whether to retain them (current Culture & Society mapping) or drop them entirely. They contribute little to Scoopfeeds' intelligence-platform positioning per Strategic Plan §2.

### UNCLEAR-C: Cars (PakWheels, Car & Driver, Top Gear, MotorTrend, Road & Track)

**The question:** Plan v6 has no Auto/Vehicles category. Closest fits: Culture & Society (consumer culture) OR Economics & Markets (automotive industry).

**Resolution applied:** Culture & Society. Reasoning: bulk of automotive content is consumer-facing reviews, not industry trade analysis. Could argue Economics & Markets for industry-trade aspects but the publications listed are all consumer-leaning.

**Alternative considered:** Drop the entire cars category. Scoopfeeds' Layer 1 (Newsroom) coverage of cars is borderline relevant to platform intelligence positioning. Phase B Track 1 decision: keep cars OR drop them. If kept, Culture & Society is the home.

### UNCLEAR-D: Company blogs (Anthropic Blog, OpenAI Blog)

**The question:** Anthropic and OpenAI blogs are publisher-authored corporate communications, not journalism. Plan v6's source types treat them as either "Specialized publications" (broadest fit) or arguably as PR content not appropriate for a news source matrix at all.

**Resolution applied:** Specialized publications. Reasoning: while these are corporate blogs, they publish substantive technical content that fills a gap (frontier-model announcements, safety research, deployment policy) that no journalism source covers as quickly. Marking them as specialized publications acknowledges they're not journalism but recognizes their factual signal value.

**Phase B implication:** Quality scoring (Sprint 4.4) should distinguish "publisher-authored corporate communications" from "third-party journalism." The current 1-10 credibility score can't articulate the difference. Consider adding a "source posture" field (journalism / corporate-PR / government / academic) for Sprint 4.4 design.

### UNCLEAR-E: Bloomberg Tech (tech ∩ business overlap)

**The question:** Bloomberg Tech covers technology from an investor/business angle. Plan v6 category: Science & Technology OR Economics & Markets?

**Resolution applied:** Economics & Markets. Reasoning: Bloomberg's primary editorial angle on tech is "what's happening to share prices and corporate strategy" not "what's the underlying science." Mapping Bloomberg Tech to Economics & Markets reflects publisher's actual editorial frame.

**Other Bloomberg feeds:** Bloomberg Markets → Economics & Markets (uncontroversial); Bloomberg Originals (YouTube only) → Economics & Markets when mapped.

### UNCLEAR-F: The Economist (politics ∩ economics overlap)

**The question:** The Economist covers politics and economics roughly equally with global scope. Plan v6 category?

**Resolution applied:** Economics & Markets. Reasoning: Economist's brand positioning is economics-first; politics coverage is filtered through economic implications. Mapping to Economics & Markets reflects editorial frame.

**Caveat:** A Plan v6 mapping that allowed multi-category tagging would handle this cleanly. Current single-category mapping forces a choice. Phase B Track 1 work on event tagging may revisit whether sources need primary + secondary category tags.

### UNCLEAR-G: "Global" as Plan v6 region

**The question:** Plan v6 lists 10 regions; "Global" is not one of them. But many RSS sources are genuinely multi-region (Reuters wire, WHO, Investing.com).

**Resolution applied:** Preserved "Global" as a non-Plan-v6 region tag for wire services and true multi-region publishers. Treating wire feeds as belonging to any single Plan v6 region would be misleading.

**Phase B implication:** Phase B Track 1's source matrix data model should explicitly distinguish "regional source" (anchored in a Plan v6 region) from "global source" (wire/multi-region). Current `sources.js` `region` field conflates these.

---

## 6. Sprint 4 Close-Out Context

### 6.1 What this Phase 1 audit delivers

This document closes:

- **Issue 4.1 Inventory active sources** — 119 RSS counted with categorization data
- **Issue 4.2 Categorize against matrix** — all 119 sources mapped to Plan v6 17×10×10 matrix
- **Issue 4.3 partial: dead/duplicate flagging** — 1 confirmed duplicate flagged; 9 dead-candidate verifications enumerated

### 6.2 What remains for Sprint 4 (defer to session 25)

| Issue | Effort | Notes |
|---|---|---|
| **4.3 full** — verify dead candidates via HTTP HEAD; execute duplicate cleanup | 0.5 session | Inside Climate News drop + 9 URL probes |
| **4.4 — Build source quality scoring schema** | 1 session | Per Decision 16; ≥4 components (editorial track record, methodology transparency, domain expertise, independence); document at `docs/content/source_credibility_methodology.md`; add `quality_score` column to `sources` table or in-memory mapping |
| **4.5 — Backfill quality scores** | 0.5-1 session | Apply schema from 4.4 to current 119; document scores with components |
| **4.6 — Gap analysis synthesis** | 0.5 session | Build on §3 of this document; produce ranked-priority gap list for Phase B |
| **4.7 — Phase B source priority list** | 0.5 session | 30-40 candidate sources to fill ranked gaps; map to Plan v6 17×10×10 matrix |

**Estimated remaining Sprint 4 effort:** 1-2 sessions (session 25).

### 6.3 Cross-references for Sprint 4.6 (gap synthesis)

The gap synthesis in session 25 should build on §3 above to produce a ranked priority list. Highest-priority gaps:

1. **Conflict & Security category** (2 sources, both NA-based) — Phase B Track 1 dossier work on geopolitical events requires more diverse Conflict & Security sources (currently zero from MENA/East Asia/Sub-Saharan Africa/etc.)
2. **Southeast Asia region** (0 sources) — Phase B exit criterion "≥6 regions covered daily" cannot complete without filling this gap
3. **Russia & Central Asia region** (0 sources) — same exit-criterion driver
4. **East Asia coverage of China (PRC)** — 0 sources; no Xinhua, Caixin, SCMP (HK), Nikkei (JP regional perspective on China)
5. **Local-language sources** (0 sources) — Decision 6 puts Russian/Mandarin/Spanish/Portuguese/French at Phase C; but evaluating now means Phase C ingestion has source candidates ready
6. **Think tanks & research orgs** (2 sources, both US-based) — Layer 2 intelligence-grade analysis depends on think tank diversity
7. **9 zero-coverage Plan v6 categories** (Religion, Migration & Refugees, Energy & Resources, Maritime & Shipping, Aviation, Agriculture & Food Security, Education, Human Rights, Entertainment & Culture) — Phase B needs explicit decision on which of these to ingest

The 119 → ≥150 source target (Phase B exit criterion) is realistic if these gaps are tackled, but the +31 source count masks the underlying re-distribution work. A naive 31 additional US sources wouldn't move Phase B exit criteria; the additions need to be specifically gap-filling.

---

## 7. Honest Caveats

### 7.1 Plan v6 category mapping is judgment, not measurement

Every entry in §2's "Plan v6 category" column is a judgment call applied to publisher's primary editorial focus. Sources that materially cover multiple Plan v6 categories (BBC News, Al Jazeera, The Economist, etc.) are forced into one primary category in this audit. A future event-level tagging system might handle multi-category sources cleanly; this source-level audit does not.

### 7.2 "Inferred source type" is inferred from publisher identity, not measured

The "Inferred source type" column reflects judgment from publisher name + business model + content shape. Not measured against Plan v6 §3's full source-type definitions. Phase B Track 1 work on source taxonomy may refine this.

### 7.3 The 9-of-17 zero-coverage Plan v6 categories may not all warrant filling

Plan v6's category framework includes some categories (Religion, Aviation, Maritime & Shipping, Agriculture & Food Security) that are valuable for intelligence-grade analysis but may be premature for Phase B's audience. Phase B's category prioritization should explicitly decide which zero-coverage categories to start populating vs which to defer to Phase C+.

### 7.4 Credibility scores in `sources.js` are NOT used in this audit's quality assessment

§1.4 shows the distribution but Sprint 4.4 (session 25) will design the measured replacement. The current scores are documented for historical context, not validated quality signal. Phase B should NOT base ranking decisions on these scores until the measured methodology lands.

### 7.5 Audit scope is RSS-only

YouTube (44 channels) and X (Twitter, ~80 handles) are inventoried in §1 but not categorized against Plan v6. YouTube is a parallel video-source layer; X is a curated social-account layer. Both have their own taxonomies that don't map 1:1 to news-source matrix. Phase B Track 1 work on multi-modal source coverage will need to design how those layers integrate with the Plan v6 matrix.

---

## 8. References

- `backend/src/config/sources.js` — source of truth (461 lines)
- `docs/strategy/strategic_plan_v6.md` §3 Capability 1 — target taxonomy
- `docs/strategy/decisions_log_v1.md` Decision 16 (hybrid source onboarding) and Decision 6 (multilingual sequencing)
- `docs/phases/phase_a_kickoff_brief.md` Sprint 4 issues — operational source
- `docs/phases/phase_a_retrospective_inputs.md` finding #75 UNCLEAR 5 — categorization-first reframing
- `docs/phases/phase_a_retrospective.md` §10.3 — close-out forward path
- Production `/api/health` 2026-05-15T15:30 UTC — sourceCount + videoChannels verification

---

*End of document. Phase A Source Audit Phase 1.*
