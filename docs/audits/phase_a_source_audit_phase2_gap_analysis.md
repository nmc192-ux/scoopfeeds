# Phase A Source Audit Phase 2 — Gap Analysis Synthesis

**Document type:** Source audit Phase 2 (Sprint 4 Issue 4.6: gap analysis synthesis)
**Date:** 2026-05-15 (Session 25)
**Companion:** `docs/audits/phase_a_source_audit_phase1.md` (Sprint 4 issues 4.1, 4.2, 4.3 partial)
**Sprint 4 issues closed by this document:** 4.6 (gap analysis synthesis). Issues 4.4 (quality scoring schema), 4.5 (backfill), 4.7 (Phase B priority list specifics) defer to session 26 as design-heavy work.

**Source inputs:**
- `docs/audits/phase_a_source_audit_phase1.md` §3 coverage analysis (categorization-first baseline)
- `backend/src/config/sources.js` post-cleanup (110 RSS sources after session 25 Phase 25.B)
- `docs/strategy/strategic_plan_v6.md` §3 Capability 1 (target 17×10×10 matrix) + §9 Phase B exit criteria
- `docs/strategy/decisions_log_v1.md` Decisions 6, 12, 16
- `docs/strategy/strategic_tactical_reconciliation_v1.md` §8.1 (Track 1 product features)

---

## 1. Coverage Gap Summary (Post-Cleanup)

### 1.1 Source count change

| Snapshot | Count |
|---|---|
| Session 24 Phase 1 audit baseline | 119 RSS sources |
| Session 25 Phase 25.B cleanup deletions | -9 (6 Reuters + 1 AP + 1 WHO Headlines + 1 ICN duplicate) |
| **Post-cleanup baseline** | **110 RSS sources** |
| Strategic Plan v6 Phase B exit criterion | ≥150 active sources with quality scores |
| **Net new sources needed for Phase B** | **40** (was 31 pre-cleanup) |

The cleanup widened the Phase B onboarding gap by 9 sources. Phase B Track 1 source-onboarding workstream now sized at 40 net new sources, not 31.

### 1.2 Plan v6 categories with zero coverage (9 of 17)

Unchanged from Phase 1 audit §3.1 — cleanup did not affect category gap profile:

| Category | Current count | Phase B planning relevance |
|---|---|---|
| Religion | 0 | Lower priority — not core to Phase B audience |
| Migration & Refugees | 0 | **HIGH** — relevant to geopolitical platform positioning |
| Energy & Resources | 0 | **HIGH** — relevant to economics + climate intersection |
| Maritime & Shipping | 0 | Lower priority — specialty Phase C+ |
| Aviation | 0 | Lower priority — specialty Phase C+ |
| Agriculture & Food Security | 0 | **MEDIUM** — relevant to climate + economics intersection |
| Education | 0 | **MEDIUM** — relevant but narrower audience |
| Human Rights | 0 | **HIGH** — directly relevant to platform's intelligence positioning |
| Entertainment & Culture | 0 | **HIGH** — Decision 12 made Entertainment the 17th category explicitly |

**Conflict & Security** is not zero-coverage but is near-zero (2 sources, both North America-based: Defense News + War on the Rocks). Phase B Track 1 should treat Conflict & Security expansion alongside the zero-coverage categories.

### 1.3 Plan v6 regions with zero or near-zero coverage

Unchanged structurally; cleanup affected count totals slightly:

| Region | Current sources (post-cleanup) | Status |
|---|---|---|
| **Southeast Asia** | 0 | **ZERO** — no Indonesia, Vietnam, Philippines, Singapore, Thailand, Malaysia |
| **Russia & Central Asia** | 0 | **ZERO** — geopolitically significant gap |
| **Oceania & Pacific** | 1 (ABC Australia) | Effectively zero |
| **MENA** | 4 (Al Jazeera + Times of Israel + Haaretz + Arab News; -1 if Foreign Policy partial allocation dropped) | Near-zero; Israel-heavy (2 of 4); no Egypt/UAE/Qatar/Iran/Turkey national papers |
| **Sub-Saharan Africa** | 2 (Mail & Guardian + Daily Nation) | Near-zero; SA + Kenya only |
| **East Asia** | 2 (NHK + Korea Herald) | Near-zero; no China (PRC) at all |

**South Asia expansion gap not previously named:** South Asia is currently 10 sources (7 Pakistani + 3 Indian) — but only 2 countries represented. **Bangladesh + Sri Lanka + Nepal + Bhutan + Maldives = 0 sources.** The "South Asia covered" framing in Phase 1 audit masked this sub-regional gap. Phase B Track 1 South-Asia expansion is needed for genuine regional coverage, not just adding more Pakistani/Indian sources.

### 1.4 Plan v6 source types — post-cleanup

| Source type | Pre-cleanup | Post-cleanup | Change | Notes |
|---|---|---|---|---|
| Specialized publications | ~55-60 | ~55-60 | Unchanged | Still dominant (~50% now) |
| National newspapers | ~22 | ~22 | Unchanged | |
| International broadcasters | ~18 | ~18 | Unchanged | |
| **Wire services** | **~7** | **0 effective** | **−7** | All Reuters URLs + AP gone (see §4) |
| Academic sources | ~6 | ~6 | Unchanged | |
| Government & primary data | 5 | 4 | -1 | WHO Headlines removed; WHO News + CDC + NIH + NASA retained |
| Regional newspapers | 3 | 3 | Unchanged | All US |
| Independent journalism | 3 | 3 | Unchanged | |
| Think tanks & research orgs | 2 | 2 | Unchanged | Foreign Affairs (CFR) + War on the Rocks |
| **Local-language sources** | **0** | **0** | Unchanged | All sources still English |

**The largest single-type change is wire services going to zero.** Detailed framing in §4.

---

## 2. Phase B Track 1 Source Priority Ranking

Three-tier prioritization based on (a) Strategic Plan v6 audience targets (regional moats: South Asia + MENA + Muslim world per §2), (b) audit-revealed gaps, (c) Phase B exit criterion "≥150 active sources with ≥6 regions covered daily."

### Tier 1 — P0 (required for Phase B "≥6 regions covered daily" exit criterion)

Without these onboardings, Phase B cannot exit on the regional-coverage criterion. Each region needs minimum daily flow from authoritative sources.

| Region | Target source count | Rationale |
|---|---|---|
| Southeast Asia | 5-7 | Currently 0. Indonesia + Vietnam + Philippines as anchor countries; Singapore/Thailand/Malaysia as fill |
| Russia & Central Asia | 4-6 | Currently 0. Russian-language and English-translation sources both relevant per Decision 6 |
| East Asia (China coverage) | 3-5 | Currently 0 China; NHK + Korea Herald only cover JP + KR. China is structurally important for Phase B geopolitical audience |
| Sub-Saharan Africa expansion | 3-4 | Currently 2 (SA + Kenya); need Nigeria + Ethiopia + Francophone Africa coverage |
| MENA Arab-world expansion | 3-5 | Currently 1 Arab national paper (Arab News); need Egypt + UAE + Qatar + Turkey + Iran coverage |
| South Asia non-PK-IN coverage | 2-3 | Currently 0 Bangladesh/Sri Lanka/Nepal/Maldives — sub-regional gap previously masked |
| Oceania & Pacific expansion | 2-3 | Currently 1 (ABC Australia); need New Zealand + Pacific Islands |
| **Tier 1 total** | **~22-30 sources** | |

### Tier 2 — P1 (category breadth — fill zero-coverage categories relevant to Phase B positioning)

| Category | Target source count | Rationale |
|---|---|---|
| Conflict & Security expansion | 3-5 | Currently 2, both NA-based; need MENA-Africa-AsiaPac conflict coverage; ICG, regional defense pubs |
| Human Rights | 2-3 | Currently 0; HRW + Amnesty + Reporters Without Borders core set |
| Migration & Refugees | 2-3 | Currently 0; UNHCR + IOM + regional refugee NGO sources |
| Energy & Resources | 2-3 | Currently 0; Argus + Platts + regional energy ministries; intersection with climate |
| Entertainment & Culture | 2-3 | Currently 0 in Plan v6 mapping (cars/self-help mapped to Culture & Society but neither covers entertainment); Decision 12 made this 17th category explicit |
| Agriculture & Food Security | 1-2 | Currently 0; FAO + relevant farming-industry sources |
| Education | 1-2 | Currently 0; Times Higher Ed + Chronicle of Higher Ed |
| **Tier 2 total** | **~13-21 sources** | |

### Tier 3 — P2 (depth + structural rebalancing)

| Sub-priority | Target source count | Rationale |
|---|---|---|
| **Wire services rebuild** | 5-8 | Currently 0 effective post-cleanup; structural priority for Plan v6 source-type coverage |
| Think tanks expansion | 5-8 | Currently 2 (Foreign Affairs + War on the Rocks); add CSIS, Brookings, RAND, ICG, ECFR, SIPRI, IISS, Stratfor, Chatham House |
| Religion (low-priority category) | 0-1 | Defer to Phase C+ unless specific need emerges |
| Maritime & Shipping | 0-1 | Defer to Phase C+ |
| Aviation | 0-1 | Defer to Phase C+ |
| **Tier 3 total** | **~10-19 sources** | |

### Tier totals vs Phase B budget (40 net new)

| Tier | Min target | Max target |
|---|---|---|
| Tier 1 (P0 regional) | 22 | 30 |
| Tier 2 (P1 category) | 13 | 21 |
| Tier 3 (P2 depth) | 10 | 19 |
| **Sum** | **45** | **70** |

**Even the minimum-target sum (45) exceeds the 40-source Phase B budget by 5 sources.** Phase B Kickoff Brief drafting (Sprint 6.7) must make explicit allocation trade-offs:

- **Option α:** Strict 40-source limit. Drop ~5 sources from Tier 1 minimums (e.g., reduce Southeast Asia ambition from 5-7 → 3-4)
- **Option β:** Expand Phase B target to 150-155 sources to fit the priority list. Adjust Phase B exit criterion language
- **Option γ:** Move some Tier 3 (wire services rebuild OR think-tank expansion) to Phase C — accept that Phase B exits with wire-service coverage still effectively zero
- **Option δ:** Reduce Tier 2 ambition (e.g., defer Migration & Refugees + Education to Phase C)

This allocation decision is a Phase B Kickoff Brief item, not a gap-analysis decision.

---

## 3. Number-of-Sources Target Estimation

### 3.1 Headline number

```
Phase B exit criterion: ≥150 active sources with quality scores
Current post-cleanup baseline: 110 active sources (no quality scores yet)
Net new sources needed: 40
Plus: quality scoring (Sprint 4.4) must be designed + backfilled
      so existing 110 + new 40 = 150 all have quality scores
```

### 3.2 Distribution proposal (illustrative for Phase B Kickoff Brief)

Assuming Phase B uses **Option α (strict 40-source limit, drop ~5 from Tier 1 minimums)**:

| Tier | Allocation | Specifics |
|---|---|---|
| Tier 1 (P0 regional) | ~22 sources | SEA 4 + RU/CA 4 + East Asia China 3 + SSA expansion 3 + MENA Arab 3 + South Asia non-PK-IN 2 + Oceania 3 |
| Tier 2 (P1 category) | ~10 sources | Conflict & Security 3 + Human Rights 2 + Migration 2 + Energy 1 + Entertainment 2 |
| Tier 3 (P2 depth) | ~8 sources | Wire services 5 + Think tanks 3 |
| **Total** | **40 sources** | |

If Phase B chooses **Option β (expand target to 155)**:

| Tier | Allocation |
|---|---|
| Tier 1 | 28 |
| Tier 2 | 14 |
| Tier 3 | 13 |
| **Total** | **55 sources** |

### 3.3 What this estimate does NOT account for

- **Source attrition during Phase B** — if Phase B takes 4-7 months and a similar Reuters-style decommissioning happens to another publisher, sources will drop during the phase itself
- **Quality scoring gating** — Sprint 4.4's schema may set credibility floors that eliminate some current sources or filter some new candidates
- **YouTube channels (44 currently)** and **X accounts (~80 handles)** are NOT counted toward 150 target; whether they should be is an open question (§7)
- **Local-language sources** are 0 today; if Phase C ingestion-only sources count toward 150, the count semantics change

---

## 4. Source-Type Composition Target — Wire-Service Collapse

### 4.1 The honest framing

**Wire services collapsed from 7 entries to 0 effective post-cleanup.** This is not refinement work; it is rebuild-from-scratch work.

- Reuters subdomain `feeds.reuters.com` returned NXDOMAIN on all 6 probed paths (`topNews`, `politicsNews`, `worldnews`, `sportsNews`, `healthNews`, `businessNews`). The entire subdomain has been decommissioned by Reuters. There is no replacement URL pattern at Reuters; their public RSS strategy appears retired.
- Associated Press URL `apnews.com/apf-topnews` returned 301 redirect to an HTML hub page. Probed alternative AP RSS paths (`apnews.com/index.rss`, `/rss`, `/feed`, `/apf-topnews/feed`, `feeds.ap.org`) all returned 404 or DNS-fail. AP appears to have retired or paywalled public RSS.

**WHO News (line 53, kept) is government health source, not wire service.** It serves Health & Medicine content under "Government & primary data" type. It does not fill the wire-service gap.

### 4.2 Implications for Phase B

Phase B's source-type composition target needs explicit wire-service rebuild work. Without wire services, Plan v6's source-type framework cannot be satisfied — the type was deliberately included as a primary intelligence-platform source category.

**Phase B target distribution** (proposed; subject to Phase B Kickoff Brief refinement):

| Source type | Current (post-cleanup) | Phase B target (≥150) | Phase B work |
|---|---|---|---|
| Specialized publications | ~55 (50%) | ~70-75 (~50%) | Maintain proportion; add via natural Tier 1+2 onboarding |
| National newspapers | ~22 (20%) | ~35-40 (~25%) | Grow via Tier 1 regional expansion (most new sources are national papers) |
| International broadcasters | ~18 (16%) | ~22-25 (~16%) | Maintain via Tier 1 (Euronews-style regional broadcasters) |
| **Wire services** | **0 effective** | **5-8** | **Rebuild from scratch — see §5** |
| Academic sources | ~6 (5%) | ~10 (~6-7%) | Expand alongside think-tank expansion |
| Government & primary data | 4 (4%) | ~8-10 | Add UNHCR + IOM + IPCC + regional gov health ministries |
| Regional newspapers | 3 (3%) | ~5-8 | Currently all US; add international regional papers via Tier 1 |
| Independent journalism | 3 (3%) | ~5-8 | Some Tier 2 Human Rights + Migration sources will fall here |
| Think tanks & research orgs | 2 (2%) | ~10-15 | Tier 3 expansion (CSIS, Brookings, RAND, etc.) |
| **Local-language sources** | **0** | **0 in Phase B**, ~10-15 in Phase C | Decision 6 puts non-EN/UR ingestion in Phase C |

---

## 5. Specific Source Candidates (Illustrative — Not Pre-Verified)

**Important caveat:** Candidates below are publisher-knowledge-based, not pre-verified for RSS availability or licensing/access constraints. Phase B Track 1 onboarding will need to:
1. Locate the publisher's actual RSS feed URL (search publisher site)
2. HTTP HEAD verify the feed is live (same protocol as Phase 25.A)
3. Sample feed content to confirm it's actual RSS not HTML
4. Apply Sprint 4.4 quality scoring schema (session 26)
5. Add to `backend/src/config/sources.js` with categorization

The candidates are illustrative for Phase B Kickoff Brief drafting (Sprint 6.7) — they help size the work and show coverage shape, but they are not a commitment.

### 5.1 Wire services rebuild candidates

Plan v6 source-type "Wire services" rebuild from 0 effective:

| Candidate | Publisher background | Note |
|---|---|---|
| **AFP English** | Agence France-Presse English service | Major non-Anglosphere wire; French-based with global desks |
| **UPI** | United Press International | US-based wire, historical alternative to Reuters/AP |
| **EFE English** | Spanish state wire English service | LatAm + Spain coverage |
| **Kyodo English** | Japanese wire English service | East Asia + Asia-Pacific |
| **Xinhua English** | Chinese state wire English service | China + East Asia; note state-affiliation flag in quality scoring |
| **Tass English** | Russian state wire English service | Russia + Central Asia; same flag note |
| **DPA International** | German wire international service | Europe + global |

**5-8 of these become Tier 3 wire-service rebuild target.** State-affiliated wires (Xinhua, Tass) flagged for Sprint 4.4 quality scoring methodology — they will score differently from independent wires (AFP, UPI, Kyodo, EFE, DPA).

### 5.2 Southeast Asia candidates

| Candidate | Country | Note |
|---|---|---|
| Jakarta Globe | Indonesia | English-language daily |
| Bangkok Post | Thailand | English-language daily |
| Manila Bulletin / Philippine Star | Philippines | Multiple English options |
| The Straits Times | Singapore | Major English daily |
| VnExpress International | Vietnam | English edition |
| Malay Mail | Malaysia | English-language |

### 5.3 Russia & Central Asia candidates

| Candidate | Region | Note |
|---|---|---|
| Moscow Times | Russia | Independent English-language (currently relocated, but RSS may exist) |
| Meduza English | Russia | Independent investigative, English edition |
| Kazinform | Kazakhstan | English state agency |
| Astana Times | Kazakhstan | English-language |
| Eurasianet | Regional | Central Asia-focused English |
| Tass English | Russia | (Also in wire-service list above) |

### 5.4 East Asia (China specifically)

| Candidate | Note |
|---|---|
| South China Morning Post | HK-based, sometimes restricted access |
| Caixin Global | Mainland independent business; English |
| Sixth Tone | Chinese state-affiliated but reputable English |
| Xinhua English | (Also in wire-service list) |
| China Daily | State broadcaster equivalent |
| Nikkei Asia | Japanese publisher covering Asia incl. China |

### 5.5 Sub-Saharan Africa expansion

| Candidate | Country | Note |
|---|---|---|
| The Premium Times | Nigeria | Independent investigative |
| Punch Nigeria | Nigeria | National daily |
| Addis Standard | Ethiopia | Independent English |
| Ethiopian News Agency | Ethiopia | State agency |
| The Africa Report | Continental | French-publisher English |
| RFI Africa English | Continental | Francophone-Africa coverage |
| Daily Maverick | South Africa | (Currently 0 SA beyond M&G) |

### 5.6 MENA Arab-world expansion

| Candidate | Country | Note |
|---|---|---|
| Egypt Independent / Ahram Online | Egypt | English Egyptian dailies |
| The National | UAE | English UAE daily |
| Doha News | Qatar | English Qatar daily |
| Hurriyet Daily News | Turkey | English Turkish |
| Daily Sabah | Turkey | English Turkish (pro-government tilt) |
| Tehran Times | Iran | English Iranian state media |
| L'Orient Today | Lebanon | English-French Beirut publication |
| Middle East Eye | Continental | UK-published independent ME coverage |

### 5.7 Oceania & Pacific expansion

| Candidate | Country/Region | Note |
|---|---|---|
| The Guardian Australia | Australia | English-language with Australian editorial |
| New Zealand Herald | New Zealand | National daily |
| RNZ (Radio New Zealand) | New Zealand | Public broadcaster |
| Pacific Beat (ABC) | Pacific Islands | Australia-published Pacific coverage |
| Islands Business | Pacific Islands | Regional magazine |

### 5.8 Tier 2 category candidates

| Category | Candidate | Note |
|---|---|---|
| Conflict & Security | International Crisis Group (ICG) | Multi-regional conflict reporting |
| Conflict & Security | Janes Defence | Industry-trade |
| Conflict & Security | Long War Journal | US-focused |
| Human Rights | Human Rights Watch | Global HR NGO |
| Human Rights | Amnesty International | Global HR NGO |
| Human Rights | Reporters Without Borders | Press-freedom focus |
| Migration & Refugees | UNHCR News | UN refugee agency |
| Migration & Refugees | IOM (Migration Org) | UN migration body |
| Migration & Refugees | Refugees International | NGO |
| Energy & Resources | Argus Media | Industry trade |
| Energy & Resources | S&P Global Platts | Commodities pricing |
| Entertainment & Culture | Hollywood Reporter | Industry trade |
| Entertainment & Culture | Variety | Industry trade |
| Entertainment & Culture | Box Office Mojo | Data-focused |
| Entertainment & Culture | Bollywood Hungama | South Asian industry |
| Education | Times Higher Education | UK-based education sector |
| Education | Inside Higher Ed | US-based |

### 5.9 Tier 3 think-tank expansion

| Candidate | Country | Specialty |
|---|---|---|
| CSIS (Center for Strategic & International Studies) | US | Geopolitics |
| Brookings | US | Domestic + foreign policy |
| RAND Corporation | US | National security |
| ECFR (European Council on Foreign Relations) | Europe | EU foreign policy |
| Chatham House | UK | International affairs |
| SIPRI (Stockholm International Peace Research Institute) | Sweden | Arms control, conflict data |
| IISS (International Institute for Strategic Studies) | UK | Defense + security |
| Stratfor / RANE | US | Geopolitical intelligence (commercial) |
| Wilson Center | US | Regional studies |
| Atlantic Council | US | Transatlantic relations |

---

## 6. Effort Estimate for Phase B Track 1 Source Onboarding

### 6.1 Per-source onboarding cost

Based on Sprint 4 Phase 1 + Phase 2 work pace:

| Step | Time per source | Notes |
|---|---|---|
| Find feed URL on publisher site | 5-10 min | Some publishers hide RSS; some have no RSS |
| HTTP HEAD verify | 1-2 min | Same as Phase 25.A protocol |
| Sample feed content to confirm | 2-3 min | Check it's XML not HTML |
| Categorize against Plan v6 matrix | 5-10 min | Use Phase 1 audit §2 + §5 mapping rules |
| Apply Sprint 4.4 quality scoring | 5-10 min | Once schema designed in session 26 |
| Add to sources.js with comment | 2-3 min | Single-line edit + ASCII section header if new region/category |
| Smoke test in production | 5-15 min | Verify next ingestion cycle picks up new source |
| **Total per source** | **30-60 min** | Lower end for known publishers with obvious RSS; upper end for harder-to-find feeds |

### 6.2 Total Phase B Track 1 source-onboarding effort

For 40-source rebuild (Phase B exit target 150):

| Scenario | Sources | Hours (30 min/src) | Hours (60 min/src) |
|---|---|---|---|
| Minimum | 40 | 20 | 40 |
| Per-tier breakdown: Tier 1 | 22 | 11 | 22 |
| Tier 2 | 10 | 5 | 10 |
| Tier 3 | 8 | 4 | 8 |

**Total: ~20-40 hours of Phase B Track 1 work, just for source onboarding.**

### 6.3 What this estimate does NOT include

- **Sprint 4.4 quality scoring schema design** (session 26 work): ~1 session of design effort, plus methodology document
- **Sprint 4.5 backfill quality scores for existing 110 sources**: 110 × 5-10 min = 9-18 hours
- **Source attrition response during Phase B**: replacing sources that go dead mid-phase (like Reuters did)
- **Quality scoring re-runs at quarterly cadence per Decision 16**: ongoing maintenance, not Phase B-specific

### 6.4 Phase B Kickoff Brief allocation implication

If Phase B Track 1 source-onboarding is **~30 hours** (mid-point estimate), and Phase B duration estimate per `strategic_tactical_reconciliation_v1.md` §8.4 is **Months 4-7 estimated, Months 6-9 realistic**, then source onboarding represents roughly **0.5-1 session per week** sustained across Phase B duration.

This is meaningful Phase B coordination overhead: source onboarding work threads through every Track 1 sprint, not bunched into a single source-onboarding sprint.

---

## 7. Open Questions for Phase B Kickoff Brief Drafting

These questions surfaced during gap analysis but defer to Phase B Kickoff Brief (Sprint 6.7) for resolution.

### 7.1 What counts toward "≥150 sources" exit criterion?

| Item | Current count | Counts toward 150 target? |
|---|---|---|
| RSS sources (post-cleanup) | 110 | YES — primary count |
| YouTube channels | 44 | **OPEN** — video sources are content but may not match "source" semantics in Plan v6 |
| X (Twitter) account handles | ~80 | **OPEN** — curated social accounts vs publishing entities |
| Local-language sources (Phase C ingestion-only per Decision 6) | 0 | **OPEN** — if they count, target 150 may be easier; if separate count, harder |

Resolution needed in Phase B Kickoff Brief. Default assumption (this gap analysis): RSS sources only count; YouTube + X are parallel inventories.

### 7.2 Should Phase B target be 150 or 150-with-quality-scores?

Strategic Plan v6 says "≥150 active sources **with quality scores**." Two interpretations:

- **A:** 150 sources active, all have quality scores applied (current 110 + new 40 all scored)
- **B:** 150 sources active, of which a subset has quality scores; the rest are pending

Interpretation A is stricter and more honest. Interpretation B allows "we have 150 sources but only scored 80 of them." Phase B Kickoff Brief should pick.

### 7.3 Allocation trade-off if 40-source budget is binding

Per §2 tier sums (45 minimum), strict 40 budget requires choosing one of:
- **α:** Drop ~5 sources from Tier 1 minimums (accept thinner regional coverage)
- **β:** Expand target to 155 (revise Plan v6 exit criterion)
- **γ:** Defer wire-services or think-tank expansion to Phase C
- **δ:** Reduce Tier 2 category breadth

Phase B Kickoff Brief must pick.

### 7.4 State-affiliated wire-service quality scoring

Xinhua + Tass are state-affiliated; AFP/UPI/Kyodo/EFE/DPA are independent (or quasi-independent). Sprint 4.4 quality scoring schema should explicitly handle the state-affiliation dimension — not as automatic disqualification but as a documented attribute that ranks differently from independent wires.

This is connected to Decision 7 (open methodology) — the state-affiliation handling becomes part of the public methodology document.

### 7.5 China coverage strategy

Currently 0 China sources. Several candidates (Caixin, SCMP, Sixth Tone, Xinhua) have different characteristics:
- Caixin: independent but mainland-published; access may be intermittent
- SCMP: HK-published; English-friendly but coverage scope contested
- Sixth Tone: state-affiliated but reputable
- Xinhua: state wire

Phase B Kickoff Brief should set an explicit China-coverage strategy: which mix of mainland + Hong Kong + diaspora-publisher sources?

### 7.6 Decision 6 multilingual sequencing

Decision 6 puts Russian/Mandarin/Spanish/Portuguese/French ingestion-only at Phase C. But several Tier 1 candidates (Le Monde EN, Spiegel EN, Folha EN) are already English editions of non-English originals. Are those "English sources covering non-Anglosphere" or "pre-Phase-C multilingual"?

Phase B Kickoff Brief should clarify the distinction.

### 7.7 Quality scoring methodology dependencies

Sprint 4.4 design depends on resolving:
- 1-5 vs 1-10 vs 0-100 scale
- Components and weights (per Decision 16: editorial track record + methodology transparency + domain expertise + independence + historical accuracy)
- Update cadence per Decision 16 review trigger ("quarterly audit if accuracy < 95%")
- Public methodology document scope (per Decision 7)

These are session 26 design questions, not Phase B Kickoff Brief questions, but resolution affects Phase B Track 1 onboarding (every new source needs scoring before Phase B exit).

---

## 8. Honest Caveats

### 8.1 Gap analysis is illustrative, not binding

The tier allocations and candidate lists in this document are Phase B planning inputs, not commitments. Phase B Kickoff Brief drafting will refine. Specifically:

- §5 candidates are publisher-knowledge based; RSS availability NOT verified
- §6 effort estimates assume 30-60 min per source; actual will vary
- §3.2 distribution proposal is a starting point, not a final allocation

### 8.2 Wire-service collapse honest framing preserved

Phase 25.A verification showed Reuters + AP RSS infrastructure has been decommissioned. This is not a content gap that emerged during Phase A — it pre-dated Phase A. The sources were in `backend/src/config/sources.js` returning silent zero ingestion for an unknown period before session 24 audit surfaced the issue.

Phase B Track 1 work to rebuild wire-service coverage is genuinely needed; no current source covers the gap. WHO News (line 53, kept) is gov health, not wire.

### 8.3 South Asia sub-regional gap discovery

The "South Asia covered" framing in Phase 1 audit was misleading. South Asia has 10 sources from 2 countries (PK + IN); 5 South Asian countries have 0 sources. This is a structural finding from gap analysis that the categorization-first Phase 1 audit didn't surface — same pattern as finding #82's presence-vs-completeness distinction.

### 8.4 Quality-scoring dependencies

Almost every recommendation in this document depends on Sprint 4.4 quality scoring schema being designed in session 26. Without the schema:
- "New source onboarding" lacks a quality gate
- "Existing 110 sources backfill" cannot proceed
- "150 sources with quality scores" exit criterion is uninterpretable

Session 26 (Sprint 4.4 + 4.5 + 4.7) is therefore a prerequisite for actual Phase B Track 1 source-onboarding work, not just a documentation step.

### 8.5 Phase B duration vs source-onboarding pace

If Phase B is 4-7 months (estimate) and source-onboarding is 20-40 hours, the work distributes to ~5-10 hours per month. That is sustainable for a solo + AI execution model. But Phase B Track 1 has many other concurrent demands (Tracker Auto-Detection Engine, op-ed aggregation, video integration, Social Media Engine v2, alert engine, newsletters, Entertainment surfaces, accessibility audit, brand refresh — per `strategic_tactical_reconciliation_v1.md` §8.1). Source onboarding competes for Track 1 attention with these. Phase B Kickoff Brief sequencing should treat source onboarding as a sustained-cadence sub-track within Track 1.

---

## 9. References

### Phase A documents

- `docs/audits/phase_a_source_audit_phase1.md` — categorization-first baseline (Sprint 4.1-4.3-partial)
- `docs/phases/phase_a_retrospective.md` v1.0 §10 — inputs to Phase B
- `docs/phases/phase_a_retrospective_inputs.md` findings #75 (audit context), #81 (Brief inaccuracy), #82 (presence-vs-completeness)
- `docs/phases/phase_a_exit_verification.md` §3.5 (Sprint 4 issue status)

### Strategic documents

- `docs/strategy/strategic_plan_v6.md` §3 Capability 1 (target 17×10×10 matrix), §9 Phase B (exit criteria), §2 (audience positioning)
- `docs/strategy/decisions_log_v1.md` Decisions 6 (multilingual), 7 (open methodology), 12 (Entertainment as 17th category), 16 (source onboarding)
- `docs/strategy/strategic_tactical_reconciliation_v1.md` §8.1 (Track 1 product features), §8.4 (Phase B duration)

### Code

- `backend/src/config/sources.js` post-cleanup (110 RSS sources)

### Phase 25.A verification

- Reuters subdomain `feeds.reuters.com` NXDOMAIN on all 6 probed feeds
- AP `apnews.com/apf-topnews` 301 → HTML hub page; alternative paths all dead
- WHO Headlines `/feeds/entity/mediacentre/news/en/rss.xml` returns 404
- WHO News `/rss-feeds/news-english.xml` returns 200 application/rss+xml ✓
- Inside Climate News `insideclimatenews.org/feed/` returns 200 application/rss+xml ✓

---

## 10. Sprint 4 Status After This Document

| Sprint 4 issue | Status |
|---|---|
| 4.1 Inventory active sources | DONE (session 24, audit Phase 1) |
| 4.2 Categorize against Plan v6 matrix | DONE (session 24, audit Phase 1 §2) |
| 4.3 Identify + handle dead sources | **DONE** (session 25 Phase 25.A verify + Phase 25.B cleanup; 9 entries removed) |
| 4.4 Build source quality scoring schema | NOT STARTED (session 26 work) |
| 4.5 Backfill quality scores for active sources | NOT STARTED (depends on 4.4; session 26) |
| 4.6 Gap analysis synthesis | **DONE** (this document) |
| 4.7 Document Phase B source priority list (30-40 specific candidates) | PARTIAL — §5 illustrative candidates surfaced; pre-verification + final selection defers to session 26 |

**Sprint 4 progress: 4 of 7 issues DONE; 1 PARTIAL; 2 NOT STARTED.** Remaining session 26 effort: ~1-2 sessions for issues 4.4 + 4.5 + 4.7.

---

*End of document. Phase A Source Audit Phase 2 — Gap Analysis Synthesis.*
