# Phase A Source Audit — Sprint 4.5 Phase 1 Methodology v1.0 Calibration

**Document type:** Source-scoring calibration (Sprint 4.5 Phase 1 of 2)
**Date:** 2026-05-17 (Session 27)
**Methodology under test:** [Source Credibility Methodology v1.0](../content/source_credibility_methodology.md) (committed at `7409dfe`, session 26)
**Companion documents:** `docs/audits/phase_a_source_audit_phase1.md` (Sprint 4 Phase 1 — HTTP audit); `docs/audits/phase_a_source_audit_phase2_gap_analysis.md` (Sprint 4 Phase 2 — gap analysis)
**Sprint 4 issues advanced by this document:** 4.5 (quality score backfill — Phase 1 calibration on 15 sources; full 154-source backfill defers to session 28+ pending Phase B Track 1 automated scoring service decision)

**Source inputs:**
- `docs/content/source_credibility_methodology.md` v1.0 (rubric, 8 posture labels, 6 score bands, score-combination rules)
- `backend/src/config/sources.js` (current corpus: 110 RSS + 44 YouTube + curated X handles)
- Session 27 calibration prompt (15 sources, expected ranges per source)
- Founder pre-scoring discussion (three architectural insights captured §5)

---

## 1. Calibration methodology + summary

### 1.1 Purpose

Sprint 4.5 applies the v1.0 methodology to every source in the corpus. Full 154-source scoring is estimated at 12–25 hours of manual scoring effort. Before committing to that effort — and before later database backfill rests on those scores — this calibration scores 15 representative publisher sources to:

1. Validate that methodology v1.0 produces score bands consistent with expert expectation.
2. Surface rubric edges where v1.0 needs sharpening (which become v1.1 candidates).
3. Produce a ground-truth dataset that an automated scoring service (per §5 architectural insights) can be tested against.

The calibration verdict drives whether full backfill proceeds, whether methodology revisions ship to v1.1 first, and what scope the eventual automated scoring service is built against.

### 1.2 Calibration setup

- **Scope:** 15 publisher-class sources. Creator/vlogger sources are out of scope for this calibration and largely out of scope for the current corpus (see §5).
- **Posture mix:** Government (5), Corporate-owned (8), Aggregator (1), Pakistani Corporate-owned subset (3 of the 8 Corporate-owned, surfaced separately as home-region validation).
- **Scoring weights** (within v1.0 §3.1 published bounds of 5%–40% per component):

  | Component | Weight |
  |---|---|
  | Editorial track record (ET) | 25% |
  | Independence (Ind) | 25% |
  | Historical accuracy (HA) | 20% |
  | Methodology transparency (MT) | 15% |
  | Domain expertise (DE) | 15% |

- **Floor rule:** if any single component scores below 30, overall quality score is capped at 50 regardless of weighted result.
- **Per-source output:** posture label + reasoning, 5 component sub-scores (0–100) with brief reasoning per component, combined quality_score, expected range from calibration prompt, PASS/FAIL verdict vs expected range, overall reasoning (~50–100 words).

### 1.3 Honest-scoring discipline applied

- No score was adjusted toward expected range. Rubric applied per source; expected range used for PASS/FAIL classification *after* scoring, not as a target.
- Where rubric was ambiguous (DW/France 24 Government sub-case fit, CoinDesk Corporate-owned vs Corporate-PR boundary, Hacker News Aggregator-vs-publisher rubric mismatch), tension is documented inline and tracked as v1.1 candidate rather than resolved arbitrarily during scoring.
- For sources where direct verification was not feasible (data-journalism methodology disclosure depth, 24-month corrections-log completeness), conservative scoring was applied with documented uncertainty.
- Pakistani sources were scored on the same rubric as international sources and the ordering was compared to founder home-region knowledge afterward as a validation check (§3.4).

### 1.4 Headline result

**15 / 15 PASS within expected ranges.** Methodology v1.0 validates as a calibration baseline for publisher scoring. No 3+-clearly-wrong threshold triggered (the hard-stop trigger from the calibration prompt did not fire). Floor rule did not trigger — closest call was Hacker News ET=35, 5 points above the 30 threshold.

Three v1.1 refinement candidates surfaced from rubric edges (catalogued §4). None block Sprint 4.5 Phase 2.

---

## 2. Per-source scoring (15 sources)

Posture-band cells use the v1.0 §5.1 typical-band column. Combined score uses the §1.2 weighted formula. Floor-rule trigger noted where relevant.

### 2.1 Government posture (5 sources)

| # | Source | URL | Legacy | ET | MT | DE | Ind | HA | Combined | Expected | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | BBC News | `feeds.bbci.co.uk/news/rss.xml` | 10 | 87 | 82 | 88 | 82 | 80 | **84** | 80–85 | PASS (top) |
| 2 | NPR News | `feeds.npr.org/1001/rss.xml` | 9 | 84 | 80 | 82 | 78 | 76 | **80** | 78–83 | PASS |
| 3 | France 24 ⚠️ | `france24.com/en/rss` | 9 | 78 | 73 | 78 | 72 | 73 | **75** | 75–82 | PASS (bottom) |
| 4 | DW English ⚠️ | `rss.dw.com/rdf/rss-en-all` | 9 | 80 | 75 | 80 | 75 | 74 | **77** | 75–82 | PASS |
| 5 | NASA News | `nasa.gov/rss/dyn/breaking_news.rss` | 10 | 78 | 88 | 92 | 80 | 87 | **84** | 80–85 | PASS (top) |

**Source 1 — BBC News.** Charter (Royal Charter / license-fee) sub-case per §5.2, squarely in named upper Government band. DG named; Editorial Guidelines public; Corrections page + Editorial Complaints Unit operational. BBC Verify era strengthened primary-document linking. Global correspondent network top-tier. Independence ceiling at §5.2 charter sub-case 85; practice strong (firewall demonstrable via #defundthebbc complaints from both political wings). Historical accuracy has Bashir/Diana and Gilligan/Hutton in the asterisk column.

**Source 2 — NPR News.** Charter sub-case per §5.2 (CPB appropriation + member fees explicitly listed). Ethics Handbook public. Federal-funding political pressure cycles are real (current US defunding battles). Berliner internal critique noted on the historical-accuracy asterisk. Lands mid-Government band.

**Source 3 — France 24 ⚠️ posture-fit tension.** v1.0 §5.2 charter sub-case names BBC/NPR/NHK/ABC Australia/NRK explicitly — license-fee or charter mechanism. France 24 is funded by French government via France Médias Monde holding (direct state appropriation, not license-fee). Per calibration prompt scored as Government but methodology doesn't strictly support this sub-case fit. Practice — criticism of French government less consistent than BBC criticism of UK government; partial editorial firewall. Lands at bottom of expected range. v1.1 candidate (§4.1).

**Source 4 — DW English ⚠️ posture-fit tension.** Same v1.0 §5.2 fit problem as France 24 — funded by Bundeshaushalt direct federal appropriation, not license-fee. Deutsche Welle Gesetz (legal charter) provides stronger structural firewall than France 24's arrangement. Practice — has criticized German politics. v1.1 candidate (§4.1).

**Source 5 — NASA News.** Technical-agency sub-case per §5.2 (70–85 band). Methodology transparency exceptional — NTRS reports + mission-instrument methodology exhaustively published. Domain expertise at 92 reflects peer-reviewed-tier scientists in every relevant beat; category-mix essentially 100% science. Historical accuracy on factual scientific claims is the strongest of the calibration set.

### 2.2 Corporate-owned high-tier (2 sources)

| # | Source | URL | Legacy | ET | MT | DE | Ind | HA | Combined | Expected | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 6 | The Atlantic | `theatlantic.com/feed/all/` | 9 | 86 | 83 | 85 | 82 | 82 | **84** | 80–88 | PASS |
| 10 | Bloomberg Markets | `feeds.bloomberg.com/markets/news.rss` | 10 | 90 | 88 | 92 | 78 | 85 | **86** | 80–87 | PASS (top) |

**Source 6 — The Atlantic.** Emerson Collective majority (Laurene Powell Jobs). Goldberg as editor; standards public; formal corrections. Long-form analysis specialty (Applebaum / Flanagan multi-year beats). Firewall demonstrable — has published critically on tech industry where parent has portfolio interest. Upper half of Corporate-owned band.

**Source 10 — Bloomberg Markets.** Bloomberg LP (Michael Bloomberg). Bloomberg Way standards; data-journalism is core competency with Terminal-grade integration. Best-in-class financial-markets expertise (category-mix essentially 100% financial). Editorial-firewall weakness on Michael Bloomberg coverage is the documented asterisk (2020 presidential leaked-memo episode); otherwise strong. Lands at top of Corporate-owned band but ceiling of 100 unreachable by methodology design.

### 2.3 Corporate-owned mid-tier (2 sources)

| # | Source | URL | Legacy | ET | MT | DE | Ind | HA | Combined | Expected | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 7 | Politico | `rss.politico.com/politics-news.xml` | 9 | 80 | 74 | 84 | 76 | 76 | **78** | 75–82 | PASS |
| 11 | CNBC | `cnbc.com/id/100003114/device/rss/rss.html` | 9 | 75 | 72 | 80 | 72 | 72 | **74** | 70–78 | PASS |

**Source 7 — Politico.** Axel Springer SE (acquired 2021). Heavy DC-norm anonymous sourcing (weaker form of MT attribution). Dominant DC beat depth (narrow but deep). Döpfner-memo controversies raised industry-press concern about parent editorial values; practice generally independent.

**Source 11 — CNBC.** NBCUniversal / Comcast. News/opinion separation imperfect on anchor-led shows. Strong financial-markets coverage but less depth than Bloomberg. "Talking your book" pattern from frequent guest analysts on the asterisk; Cramer/Bear Stearns 2008 type moments in historical record.

### 2.4 Corporate-owned specialty / lower-tier (2 sources)

| # | Source | URL | Legacy | ET | MT | DE | Ind | HA | Combined | Expected | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 8 | CoinDesk ⚠️ | `coindesk.com/arc/outboundfeeds/rss/` | 8 | 70 | 65 | 78 | 55 | 65 | **66** | 60–72 | PASS |
| 9 | Psychology Today | `psychologytoday.com/us/front-page/rss.xml` | 8 | 60 | 50 | 70 | 65 | 55 | **60** | 50–62 | PASS (top) |

**Source 8 — CoinDesk ⚠️ posture-line case.** Ownership chain DCG → Bullish (sold to Bullish 2023). Bullish IS a crypto exchange whose business is directly affected by CoinDesk coverage — that's exactly the §5.2 Corporate-PR definition. Per calibration prompt scored as Corporate-owned but Editorial-firewall sub-criterion 2.4.c had to carry the Independence load alone. Practice — broke FTX story despite COI risk, diverging from structural pressure. v1.1 candidate (§4.2).

**Source 9 — Psychology Today.** Sussex Publishers. Blog-network model where individual licensed practitioners post less editor-curated content. Contributors credentialed but methodology transparency low (clinical-experience citations dominate over primary research). Pop-psych over-claiming pattern (neuroplasticity, attachment styles, etc.) at publication level. Lands top of expected E-band range.

### 2.5 Aggregator (1 source)

| # | Source | URL | Legacy | ET | MT | DE | Ind | HA | Combined | Expected | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 12 | Hacker News ⚠️ | `news.ycombinator.com/rss` | 8 | 35 | 40 | 65 | 55 | 50 | **48** | 38–50 | PASS (top) |

**Source 12 — Hacker News ⚠️ rubric mismatch.** §2.1 ET sub-criteria (named editor, published standards, bylines, corrections, news/opinion separation) are publisher-shaped and don't translate to user-submitted link aggregator with algorithmic moderation. HN scored low on ET *because the sub-criteria don't fit the publication model*, not because the publication is bad at what it does. Aggregator posture §5.2 mentions "selection quality and source-mix transparency" as scoring dimensions but the 5-component rubric still applies publisher ET sub-criteria. Y Combinator-owned (VC firm) creates COI on YC-portfolio coverage — documented soft-handling pattern surfaces in Independence sub-score. **Floor-rule edge:** ET=35 was 5 points above the 30 threshold. v1.1 candidate (§4.3).

### 2.6 Pakistani Corporate-owned (3 sources — home-region validation subset)

| # | Source | URL | Legacy | ET | MT | DE | Ind | HA | Combined | Expected | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 13 | Dawn News | `dawn.com/feed` | 9 | 80 | 75 | 85 | 80 | 78 | **80** | 75–83 | PASS |
| 14 | Geo News | `geo.tv/rss/1/1` | 8 | 60 | 60 | 72 | 65 | 65 | **64** | 60–72 | PASS |
| 15 | The News Intl | `thenews.com.pk/rss/1/8` | 8 | 72 | 68 | 72 | 68 | 68 | **70** | 62–75 | PASS |

**Source 13 — Dawn News.** Pakistan Herald Publications (Haroon family). Pakistani broadsheet of record. Editor Zaffar Abbas named; clear news/opinion separation; Almeida / Husain multi-decade beats cited internationally. Firewall demonstrable — has criticized governments of all parties; targeted by state pressure (Dawn Leaks 2016, distribution restrictions). Strong "newspaper of record" track record.

**Source 14 — Geo News.** Independent Media Corporation / Jang Group (Mir Shakil-ur-Rehman). Largest Pakistani commercial broadcast. Tabloid-leaning style; talk shows blend news/opinion/speculation. State pressure tested firewall (Shakil-ur-Rehman 2020 arrest, distribution shutdowns); practice mixed. Sensationalist style produces some over-reaching headlines.

**Source 15 — The News International.** Jang Group (sister publication to Geo). Print-broadsheet conventions apply (clearer news/opinion separation than Geo broadcast). Same Jang Group state-pressure history; English-print typically less pressured than vernacular broadcast.

**Home-region ordering validation:** Dawn (80) > The News Intl (70) > Geo (64). Matches founder's home-region knowledge anchor. See §3.4.

---

## 3. Calibration analysis

### 3.1 PASS/FAIL tally

**15 / 15 PASS within expected ranges.** No outliers. No 3+-clearly-wrong threshold triggered.

Distribution within expected ranges:

| Position in expected range | Count |
|---|---|
| Top of range (within 1–2 points of upper bound) | 6 (BBC 84/85, NPR 80/83 mid, NASA 84/85, Atlantic 84/88 mid, Bloomberg 86/87, NPR 80, Hacker News 48/50, Psychology Today 60/62) |
| Middle of range | 4 (DW 77, Politico 78, CNBC 74, The News Intl 70) |
| Bottom of range (within 1–2 points of lower bound) | 2 (France 24 75/75, CoinDesk 66 mid) |

(Some sources straddle "top" vs "middle" — categorization is impressionistic.)

The notable clustering at the top of expected ranges suggests calibration ranges may have been slightly conservative. Not a methodology defect; a calibration-target observation worth noting for the next calibration set. With N=15 there is no statistical basis for inferring weight-set bias.

### 3.2 Posture-band consistency

Government posture (5 sources): 75–84, mean 80, span 9 points. Sits squarely in v1.0 §5.2 Government band (30–85 overall, with the three sub-cases). The five Government sources stratify cleanly by sub-case:

- Charter/license-fee sub-case (BBC, NPR): 80–84
- Technical-agency sub-case (NASA): 84
- Direct-state-funded-international sub-case (DW, France 24, ⚠️ not strictly named): 75–77

Corporate-owned posture (8 sources, excluding the ⚠️ CoinDesk Corporate-PR edge): 60–86 range. Wide spread is by design — methodology §5.2 Corporate-owned band is 55–95, the widest of the eight labels. Stratification observed:

- Premium / firewall-strong (Atlantic, Bloomberg): 84–86
- Strong-beat with documented Independence asterisks (Politico, CNBC, Dawn): 74–80
- Industry-affiliated or specialty (CoinDesk, The News Intl, Geo): 64–70
- Blog-network / weak MT (Psychology Today): 60

Aggregator posture (1 source, Hacker News): 48. v1.0 §5.2 Aggregator band is 30–80; landed at lower end consistent with the rubric mismatch noted §4.3.

### 3.3 Three v1.1 candidates (catalogued §4)

All three surfaced during honest scoring as legitimate rubric edges that the calibration could not resolve without methodology revision:

1. Government posture sub-case for direct-state-funded international broadcasters (DW, France 24 pattern) — §4.1.
2. Corporate-owned with industry-participant parent guidance (CoinDesk pattern) — §4.2.
3. Aggregator posture ET sub-criteria substitution (Hacker News pattern) — §4.3.

None block Sprint 4.5 Phase 2. All three should ship to methodology v1.1 before Phase 2 backfill commits.

### 3.4 Pakistani home-region validation

Three Pakistani sources scored against the same v1.0 rubric as international sources. Output ordering Dawn (80) > The News Intl (70) > Geo (64) matches founder's home-region knowledge:

- Dawn is the recognized Pakistani newspaper of record; Almeida, Husain bylines cited internationally; Editor Zaffar Abbas accountable; firewall demonstrable.
- The News International is a solid English broadsheet, second to Dawn in editorial-rigor reputation.
- Geo News is the largest commercial broadcaster but tabloid-leaning, with talk shows that blend formats.

The rubric produced the right ordering without home-region knowledge being injected into scoring. Strong validation signal — the rubric is not Anglo-American-biased to the point of failing on local-tradition sources.

### 3.5 Floor rule did not trigger

Floor rule (any component <30 → cap overall at 50) did not trigger in any of 15 sources. Closest call: Hacker News ET=35, 5 points above the 30 threshold. If threshold were 40, HN would have been capped at 50 (which would have moved its score from 48 → 50, a 2-point change and same band).

The 30 threshold appears to be appropriately calibrated for the publisher set under test. Validation against creator/aggregator-heavy corpus is needed before claiming the threshold generalizes.

### 3.6 §2.5.c operationalization gap noted

Methodology §2.5.c asks for "behaviour during recent high-pressure news events" with "sampled across at least three reference events per scoring window." The calibration applied this sub-criterion using implicit reference events that the scorer selected per source — not a documented common reference-event set. For inter-scorer reproducibility, the methodology (or an operational appendix to it) should specify a rotating reference-event list. Captured as a minor v1.x candidate, not blocking Sprint 4.5 Phase 2.

---

## 4. Methodology v1.1 candidate list

Three candidates, prioritized by impact on Sprint 4.5 Phase 2 backfill quality.

### 4.1 P1 — Government posture sub-case for direct-state-funded international broadcasters

**Problem.** v1.0 §5.2 Government posture has three named sub-cases: technical agencies, charter/license-fee public broadcasters (BBC/NPR/NHK/ABC Australia/NRK explicitly named), and ministry political communications. DW (German federal-budget direct appropriation) and France 24 (French government via France Médias Monde holding) do not fit any of these three sub-cases cleanly:

- They are not technical agencies publishing primary data.
- They are not funded by license-fee or autonomous charter (DW has the Deutsche Welle Gesetz which approximates a charter; France 24 has weaker legal-firewall structure).
- They are not ministry political communications (they have editorial-independence claims supported by observable practice).

**Resolution options:**

- **Option A:** Expand §5.2 Government public-broadcaster sub-case definition to admit direct-state-funded international broadcasters with charter or charter-equivalent editorial firewall. Keep them inside Government posture. Recommend Option A because it preserves the eight-label posture taxonomy.
- **Option B:** Introduce a 9th posture label ("International public broadcaster — direct state funded"). Rejected for label-proliferation cost.
- **Option C:** Reclassify DW + France 24 as State-affiliated. Rejected — band ceiling 55 is too low for sources whose practice demonstrates editorial independence on most topics.

**Leading candidate:** Option A. The expansion would extend §5.2 Government sub-case 2 language to admit charter-equivalent legal protection plus demonstrable editorial independence, with the upper band (75–85) reserved for sources where both conditions hold strongly. The alternatives (B: 9th label; C: reclassify as State-affiliated) are documented for completeness. **Decision deferred to v1.1 review.**

### 4.2 P2 — Corporate-owned with industry-participant parent guidance

**Problem.** CoinDesk is owned by Bullish (crypto exchange). v1.0 §5.2 has two labels that could apply: Corporate-owned (55–95) and Corporate-PR (25–55). Corporate-PR is defined as "source owned by or representing an entity reporting on itself, its industry, or its commercial interests." Bullish→CoinDesk fits this definition strictly. But Corporate-PR's 25–55 ceiling is inconsistent with CoinDesk's observed editorial practice (broke FTX story despite COI risk).

The methodology lacks guidance on when a Corporate-owned source whose parent participates in the industry the source covers should escalate to Corporate-PR posture, or whether escalation depends on parent's market share / regulatory influence / direct-vs-indirect business overlap.

**Resolution options:**

- **Option A:** Add an explicit Corporate-owned sub-case for "industry-affiliated parent." Sub-case has lower Independence ceiling than mainstream Corporate-owned (e.g., upper bound 80 rather than 95) but is not Corporate-PR-capped at 55. Posture remains Corporate-owned; the sub-case captures the structural-conflict pattern.
- **Option B:** Introduce an automatic posture-escalation rule: if parent company's primary business is in the industry the source covers, posture is Corporate-PR regardless of practice. Rejected — too rigid; practice does matter, and the rule would force CoinDesk to a band that its FTX coverage doesn't merit.
- **Option C:** Leave Corporate-PR scope unchanged; rely on case-by-case founder judgment per §6.5 (founder override) for edge cases. Rejected — defeats the purpose of operational rubric.

**Leading candidate:** Option A. A new Corporate-owned sub-case for "industry-affiliated parent" with a lower Independence ceiling (e.g., 80 rather than 95) would capture the structural-conflict pattern without forcing Corporate-PR's 55 cap. Options B (auto-escalation rule) and C (rely on §6.5 founder override) are documented for completeness. **Decision deferred to v1.1 review.**

### 4.3 P3 — Aggregator posture ET sub-criteria substitution

**Problem.** v1.0 §2.1 Editorial track record sub-criteria a–e (named editor, published standards, bylines, corrections, news/opinion separation) are designed for publisher-class sources. Aggregator posture per §5.2 explicitly notes that aggregators "score on two dimensions: selection quality and transparency about source mix" — but the 5-component rubric (§2) does not adjust to this. Hacker News scored 35 on ET *because the sub-criteria don't fit user-submitted link aggregator format*, not because HN is operationally bad at what it does.

**Resolution options:**

- **Option A:** Aggregator posture introduces ET sub-criteria substitution. The five sub-criteria a–e become:
  - 2.1.a (Aggregator) — Selection criteria documented (algorithmic or editorial)
  - 2.1.b (Aggregator) — Source-mix transparency (per-item underlying source visible)
  - 2.1.c (Aggregator) — Moderation policy published and enforced consistently
  - 2.1.d (Aggregator) — Removal / takedown log queryable
  - 2.1.e (Aggregator) — Community-governance mechanisms documented (where applicable)
- **Option B:** Aggregator posture defaults ET to "n/a" and rebalances component weights for Aggregator-posture sources. Rejected — would require weight publication exceptions which conflicts with Decision 7's proprietary-weights principle.
- **Option C:** Leave rubric as-is and accept that Aggregators will score low on ET by definition. Rejected — produces calibration noise on a posture category that has legitimate quality variance.

**Leading candidate:** Option A. A v1.1 §2.1 Aggregator sub-criteria substitution table applied when posture is Aggregator. Similar substitution patterns may apply to other posture categories that don't fit publisher-class rubric (creator methodology will likely need this same machinery — see §5). Options B (n/a + weight rebalance) and C (status quo) are documented for completeness. **Decision deferred to v1.1 review.**

### 4.4 v1.1 work estimate

- 1 session (3–4 hours) for v1.1 rubric revisions + changelog + side-by-side re-scoring of the 15 calibration sources to validate v1.1 against v1.0 baseline.
- v1.1 should ship before Sprint 4.5 Phase 2 (full 154-source scoring or automated-scoring-service build).
- v1.1 ship target: session 28 or 29.

---

## 5. Architectural insights from session 27 discussion

Three insights were surfaced during pre-scoring discussion (before Phase 27.B began) and apply to the broader Sprint 4.5+ workstream, not just this calibration. They are captured here so the calibration document carries forward the architectural context.

### 5.1 Sprint 4.5 backfill should not be a manual marathon — spec as Phase B Track 1 automated scoring service

Sprint 4.5 was originally framed as full 154-source manual scoring (12–25 hour effort estimate). The calibration confirms the rubric is operationalizable — every sub-criterion has a definable evidence-gathering procedure, and the score-combination function is deterministic given sub-scores. This means an automated scoring service can apply the same framework if it has access to the evidence inputs:

- Editorial track record: scrape source's about/editorial-standards/corrections pages; named-leadership and corrections-process verification.
- Methodology transparency: sample N recent articles, parse for source attribution patterns, primary-document linking rate, COI disclosure language.
- Domain expertise: cross-reference reporter bylines against credential databases (LinkedIn, professional-association rosters, prior-publication graphs); per-category publication-volume analysis.
- Independence: ownership data from public registries; founder/editor-board political-contribution data where public; firewall practice via critical-coverage detection on parent-company-related stories.
- Historical accuracy: IFCN fact-check database matches; retraction-log scraping; reference-event behaviour analysis via sampled coverage.

**Implication for Sprint 4.5 scope:** the manual full backfill should not happen. Sprint 4.5 closes with this calibration document + v1.1 methodology (if shipped). Full 154-source scoring becomes a Phase B Track 1 deliverable executed by an automated scoring service whose ground-truth dataset is the 15-source calibration in §2 of this document. This architectural commitment can be revisited if Phase B scoring service timeline shifts substantially.

**Implication for the 15 scored sources:** they are not just calibration outputs. They are the ground-truth test set for the future scoring service's validation. The future service should reproduce these 15 scores within tight tolerance (recommended: ±5 points per source) before being trusted on the remaining 139 sources.

### 5.2 Publisher methodology v1.0 does not handle individual creators

Methodology v1.0 §1.1 says it scores "each source in our corpus." The calibration confirmed v1.0 works for publisher-class sources. It does not work for individual creators (YouTube channels, podcast hosts, Substack writers operating solo) — the sub-criteria assume an editorial-organization shape that creators do not have:

- 2.1.a (named editorial leadership) — for a creator, the creator IS the leadership.
- 2.1.b (published editorial standards) — creators rarely publish standards documents.
- 2.1.e (separation of news and opinion) — many creator formats are explicitly opinion+commentary.
- 2.4 Independence — creator independence is structurally different (sponsorship vs ownership; platform-dependency vs publisher-charter).

The current Scoopfeeds corpus is publisher-heavy by design (110 RSS publishers + 44 YouTube channels operated by publishers / news organizations rather than solo creators + curated X handles). Solo creator scoring is largely out of scope for the current corpus but will become in-scope as Phase B / C expand the source matrix per Strategic Plan v6.

**Implication:** a creator methodology v1.0 needs to be developed as separate work in Phase B or C, with its own rubric, its own posture labels (or extensions to the existing 8), and its own scoring service. Cross-references between publisher and creator methodologies should preserve the v1.0 / v1.1 / v2.0 versioning discipline so source profiles always state which methodology produced the score.

### 5.3 Creator methodology requires a three-layer structure for interview-format content

For interview-format content (podcasts, YouTube interviews, panel discussions), source credibility is not a single number. The credibility of a given episode is a composite of:

- **Host / channel credibility** — the show's own editorial practice, sponsorship transparency, prior-guest selection patterns, retraction history.
- **Guest credibility** — the specific guest's own domain expertise, prior-claim track record, conflicts of interest.
- **Per-episode composite** — how the host handled the guest (challenged claims? fact-checked in real time? added context? let claims pass unchallenged?). The episode score is not just host × guest — it's host's *practice on this specific guest*.

This three-layer structure is meaningfully more complex than publisher methodology v1.0 and likely warrants Phase C scope rather than Phase B. Capturing it here as architectural foresight; not in-scope for Sprint 4.5 Phase 2.

---

## 6. Implications for Sprint 4.5 Phase 2 + Sprint 4.7 + Phase B Track 1

### 6.1 Sprint 4.5 Phase 2 — reframed

**Before this calibration:** Sprint 4.5 Phase 2 was full 154-source manual backfill, 12–25 hours.

**After this calibration:**

- Manual full backfill is the wrong shape. Methodology is operationalizable; build automation.
- Sprint 4.5 Phase 2 deliverable becomes: methodology v1.1 (per §4.1–§4.3) + automated scoring service specification (handed to Phase B Track 1).
- The 15 sources in §2 of this document become the ground-truth validation set for the eventual scoring service.
- Sprint 4.5 remains **PARTIAL** within Phase A. Phase 1 (this calibration) is done; Phase 2 (v1.1 + scoring-service spec) is the next session work. The corpus-wide backfill itself executes within Phase B Track 1 and does not close Sprint 4.5 within Phase A.

### 6.2 Sprint 4.7 — expanded scope

**Original scope:** Phase B source priority list (catalogue of 40 candidate new sources for Phase B Track 1 onboarding, by category × region × type cells).

**Expanded scope** (additive, not replacement):

- Publisher source priority list (unchanged from original Sprint 4.7 scope).
- Creator/episode/guest methodology specification draft (per §5.2 + §5.3). Deferred to Phase C scope but architectural framing captured during Sprint 4.7.

### 6.3 Phase B Track 1 — Source Scoring Service specification

A new Phase B Track 1 deliverable: automated source scoring service that applies methodology v1.1 to the corpus. Spec requirements:

- **Input contract:** source identifier (URL or channel_id), posture label (assigned by founder per Decision 16 workflow), methodology version.
- **Output contract:** five component sub-scores (0–100) + combined quality_score + floor-rule trigger indicator + evidence trail (per-sub-criterion evidence pointers) + scoring confidence (low/medium/high based on data availability).
- **Validation harness:** reproduce the 15 calibration scores (this document §2) within ±5 points per source on a fixed methodology version.
- **Founder review hook:** all scores flagged for founder review before publication per Decision 16 + methodology §6.1 step 3.
- **Audit-trail integration:** every score writes to `sources.quality_score_*` columns (Migration 002) plus audit log.

### 6.4 Phase A close-out unchanged

Sprint 4.5 Phase 1 calibration does not close any Phase A sprint by itself. Sprint 4 progress unchanged at 5 of 7 DONE + 1 PARTIAL + 1 NOT STARTED. Sprint 4.5 status moves from NOT STARTED to PARTIAL (Phase 1 of 2 ships this session; Phase 2 = methodology v1.1 + scoring service spec; full backfill ships in Phase B).

Phase A close-out estimate remains 5–9 sessions to clear binding kickoff gate (unchanged from session 26 accounting).

---

## 7. Honest limitations of this calibration

- **N=15 publisher sources.** Statistical claims about rubric validity require larger samples. This calibration validates that v1.0 is operationally usable, not that it is statistically calibrated. A second-round calibration of 30+ sources (including creator and edge-posture cases) should follow methodology v1.1 publication.
- **Single scorer.** All 15 sources were scored by the same scorer (this session's AI agent). Inter-scorer reproducibility — which is the real test of operationalizable methodology — was not measured. Phase B Track 1 scoring service development should include a multi-scorer reproducibility study (target: 80%+ of source scores within ±5 points across three independent scorers applying v1.1 against the same evidence).
- **No live evidence verification.** Where the methodology asks for current-state evidence (e.g., corrections pages today, methodology disclosure on recent data pieces), scores rely on the scorer's stored knowledge rather than freshly-verified evidence at scoring time. An automated scoring service per §5.1 would close this gap by gathering live evidence per source.
- **Expected ranges were calibration-prompt-provided.** PASS/FAIL verdict is against ranges supplied in the calibration prompt by the founder, not against an independent ground-truth dataset. This is appropriate for calibration purpose (validating that the rubric produces founder-expected bands) but not for statistical validation.
- **Pakistani sources only home-region validated subset.** The Pakistani sample (Dawn, Geo, The News Intl) validated that rubric ordering matches local-knowledge expectation. Other non-Anglo-American sources were not in the calibration set. v1.0's §9.1 limitation about Anglo-American journalism-norm bias remains an open methodology question that this calibration did not resolve.
- **Creator and aggregator-heavy corpus stress-tests not performed.** v1.0 is validated for publisher-class scoring. Aggregator (1 source, Hacker News) revealed rubric mismatch that v1.1 should fix. Creator-class scoring (out of scope today) will require separate methodology work per §5.2.

---

**Verdict:** Methodology v1.0 is operationally usable for publisher-class source scoring. Three v1.1 refinements are identified and prioritized. Full Sprint 4.5 Phase 2 should ship as v1.1 + automated scoring service spec (Phase B Track 1 deliverable) rather than as manual full backfill. The 15 sources scored in §2 become the ground-truth validation set for that service.
