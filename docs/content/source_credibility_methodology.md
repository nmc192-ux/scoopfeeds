# Scoopfeeds Source Credibility Methodology v1.0

**Document type:** Public methodology specification
**Version:** 1.0
**Owner:** DrJ (Founder)
**Companion documents:** Strategic Plan v6.0 §3 Capability 1, Decisions Log v1.0 (Decisions 7 and 16), Phase A Kickoff Brief Sprint 4 Issue 4.4
**Audience:** External readers — academic citations, journalists, premium-tier subscribers, regulators
**Last updated:** May 2026

---

## 0. About this document

This is the public statement of how Scoopfeeds rates news sources. It is intended to be citable in academic and journalistic work and to give subscribers a complete account of what a score means before they rely on one.

Per Decision 7 in our Decisions Log, the rubric described here is open: anyone can read it, critique it, and reproduce its logic against their own corpus. The exact numerical weights applied during score combination, and the per-source scores themselves, are not published. The rationale for that split is explained in §8.

Methodology versioning follows the form `v<major>.<minor>`. Major versions reflect changes to which components exist or how scores are reported publicly. Minor versions reflect refinements to sub-criteria, posture labels, or band thresholds. Each scored source in our database records the methodology version used at the time of scoring, so a score is always interpretable against the rubric that produced it.

---

## 1. Purpose and scope

### 1.1 What this methodology does

It assigns each source in our corpus a **quality score** in the range 0–100 and a **source posture label** drawn from a fixed set of eight categories. Together they answer two related but separate questions:

- **"How reliable is this source on the topics it covers?"** — the quality score.
- **"Where does this source sit in the media ecosystem?"** — the posture label.

A source has exactly one quality score and one posture label at any given time. Both are revisited on a defined cadence (§7).

### 1.2 What this methodology does not do

It does not score **individual articles**. An exemplary source can publish a flawed piece; a low-rated source can break a true story. Article-level signals (corrections issued, retractions, fact-check matches) feed back into the source-level score over time, but the score is not an automatic verdict on any given byline.

It does not score **opinion content separately from reporting**. A source that mixes both is scored on its reporting practice; its opinion content inherits the score but is presented with an op-ed marker in our product UI.

It does not measure **political alignment**. Two sources can sit at opposite ends of a political spectrum and both score in the 80s. Political stance is encoded in the posture label (specifically the Advocacy category) and surfaced separately, never collapsed into the quality score.

It does not produce **a single verdict on truth**. A source score is a probability prior on the source's reliability. Combined with our Reality Index (Capability 3) and source triangulation (Capability 1), it informs how heavily a source's claims weigh on a given event — it does not adjudicate the event itself.

### 1.3 How the score is used

The quality score and posture label appear in three places:

1. **Public source profile pages** — visible to all readers without subscription. Show the score, the posture label, the methodology version, and the date last scored.
2. **In-article source attribution** — the score appears next to source attribution on every article and event dossier. Layer 1 (free tier) sees a banded label (§4); Layer 2 (premium tier) sees the numeric score plus the component scorecard.
3. **Internal ranking signals** — the score is one of several inputs into how stories cluster, how events get assembled, and which sources get queued first when multiple cover the same news. The score is not the only ranking input.

---

## 2. The five components

The quality score is constructed from five components, taken from Strategic Plan v6.0 §3 Capability 1:

1. Editorial track record (§2.1)
2. Methodology transparency (§2.2)
3. Domain expertise (§2.3)
4. Independence (§2.4)
5. Historical accuracy (§2.5)

Each component is scored 0–100 against a published rubric. The rubrics below were developed with reference to NewsGuard's nine-criterion framework, the SPJ Code of Ethics, the European Journalism Centre's transparency guidelines, and the Reynolds Journalism Institute's source-attribution standards. Where our criteria diverge from those frameworks, the divergence is noted in the relevant subsection.

### 2.1 Editorial track record

This component asks whether the source has a documented editorial practice and whether it follows that practice consistently.

**Sub-criteria.** Each is evaluated on the documented record of the source over the past 24 months:

- **2.1.a — Named, documented editorial leadership.** Editor-in-chief or equivalent is named, contactable, and accountable. (Scored yes/no with weighting; binary.)
- **2.1.b — Published editorial standards or stylebook.** A document exists, is publicly accessible, and is referenced when readers query editorial decisions. (Scored yes/no.)
- **2.1.c — Bylines on news content.** Reporters are named on stories; pseudonymous or unbylined news content is the exception, not the norm. (Graduated: never / sometimes / usually / always.)
- **2.1.d — Functioning corrections process.** Errors are corrected on the original page with timestamped notes; correction history is queryable. (Graduated: no corrections process / corrections issued but not transparent / transparent corrections within reasonable timeframe / public corrections log.)
- **2.1.e — Separation of news and opinion content.** Opinion content is clearly labelled at the article level, on the index, and in syndication. (Graduated: no separation / weak labelling / clear in product / clear across channels.)

**What the rubric does not cover.** Pre-publication peer review (more relevant to academic sources, captured in §2.3), and rate of publication (volume is not a quality signal in either direction).

**Honest difficulty.** 2.1.a and 2.1.b are easy to verify and easy to fake — a source can publish an editorial standards document without practicing it. We weight 2.1.c and 2.1.d more heavily because they reflect ongoing behaviour rather than one-time policy artifacts.

### 2.2 Methodology transparency

This component asks whether the source explains how it knows what it reports.

**Sub-criteria.** Each is evaluated on a sample of recent news articles from the source:

- **2.2.a — Source attribution.** Claims are attributed to specific sources, documents, or interviews; anonymous sourcing is used only when necessary and the rationale is explained inline. (Graduated.)
- **2.2.b — Primary documents linked.** When a story cites a study, a court filing, a dataset, or a government document, the document is linked directly rather than only summarized. (Graduated.)
- **2.2.c — Methodology disclosure on data journalism.** Stories using polls, surveys, or quantitative analysis disclose methodology, sample size, margin of error, and limitations. (Graduated.)
- **2.2.d — Conflicts of interest disclosed.** When a story touches the source's owners, advertisers, or named writers' affiliations, disclosure appears in the piece. (Graduated.)
- **2.2.e — AI and automation disclosure.** Where AI is used in production (translation, summary, image generation), this is disclosed at the article level. (Yes/no, with weighting that increases as AI use spreads industry-wide.)

**Why this matters more than it used to.** A decade ago, source attribution was the floor of basic practice. As content production has industrialized — wire repackaging, AI-generated summaries, syndicated wire copy treated as original reporting — the actual rate of primary-document linking has fallen across the industry. We treat 2.2.b as a high-signal differentiator.

**Honest difficulty.** Sub-criterion 2.2.e is recent and the industry has not converged on what disclosure means. We score it generously in v1.0 and expect the bar to rise in v1.1 as norms stabilize.

### 2.3 Domain expertise

This component asks whether the source has demonstrated competence in the subject areas it covers.

**Sub-criteria.** Evaluated by category, since most sources are stronger in some topic areas than others:

- **2.3.a — Beat reporters with verifiable subject background.** Reporters covering technical fields (medicine, science, finance, security) have relevant training, credentials, or sustained beat tenure. (Graduated.)
- **2.3.b — Specialist editors.** Editorial leadership in technical sections is staffed by editors with subject expertise, not generalists. (Yes/no per relevant section.)
- **2.3.c — Sustained coverage over time.** The source has covered the relevant beat continuously for at least 12 months, not opportunistically following news cycles. (Graduated.)
- **2.3.d — Quality of sourcing within the beat.** Stories in the beat cite domain experts, primary literature, or original data — not other news coverage as the primary source. (Graduated.)
- **2.3.e — Recognized professional standing.** Reporters are members of relevant professional associations, win category-specific awards, or are cited by other respected outlets within the beat. (Graduated.)

**Per-category scoring.** A source can legitimately score 90 in one category and 50 in another. The publicly displayed quality score is a weighted aggregate across the categories the source covers, with weights set by the source's actual publication volume per category. The per-category breakdown is visible on premium-tier (Layer 2) source profile pages.

**Honest difficulty.** Verifying credentials at scale is the largest manual-effort item in our scoring workflow (§6). For sources with hundreds of bylined contributors, we sample. For sources with one or two key bylines (smaller outlets, Substack-class), we verify directly.

### 2.4 Independence

This component asks whether the source's reporting practice is structurally free from systemic conflicts that would compromise its editorial judgment.

**Sub-criteria.**

- **2.4.a — Ownership disclosed.** Ownership structure is publicly known. For corporate-owned: parent company named. For state-affiliated: state body named. For non-profit: funders named. (Yes/no, with graduated penalty for opacity.)
- **2.4.b — Funding mix transparent.** Major revenue sources are disclosed at the source level. (Graduated: opaque / disclosed in aggregate / disclosed by category / disclosed by named funder.)
- **2.4.c — Editorial firewall demonstrable.** Where ownership or funding creates a potential conflict, an editorial firewall exists, is documented, and is observable in practice (e.g., critical coverage of the parent company, refusal of advertiser veto). (Graduated.)
- **2.4.d — Posture label assigned.** Each source is assigned exactly one of eight posture labels (§5). The label is not a sub-criterion to be scored — it is a structural attribute. But the label sets the typical band the Independence component falls into. (Categorical.)

**Posture label and Independence score interact.** The posture label (§5) sits one level above the Independence sub-criteria. The label is the *structural* description of how the source relates to power; sub-criteria 2.4.a–c are the *practiced* test of whether that structural relationship is mitigated in day-to-day editorial behaviour. A Corporate-owned source with a strong, observable editorial firewall — critical coverage of its parent, refusal of advertiser veto, public escalation protocols — scores higher on Independence than a Corporate-owned source without one. The posture remains "Corporate-owned" either way, but the practice within that posture is what the sub-criteria measure.

**Why this is the most design-heavy component.** Three reasons:

1. **The X (formerly Twitter) precedent.** X's state-affiliated and government-affiliated labels established a public norm that *structural* relationships are worth disclosing as categorical attributes, distinct from any judgment about content quality. Our posture labels follow this pattern. Eight labels rather than two because the news ecosystem has more relevant categories than social platforms do.
2. **Independence is the component where "neutrality" can be lazy.** It would be easier to score every well-edited source 90+ on Independence regardless of ownership. We resist that because ownership and funding structures do, in fact, shape what gets covered and how — even when the firewall is real. The rubric encodes that ownership matters even when the firewall is present.
3. **Independence is the component where Decision 7's transparency commitment is most tested.** We publish the rubric and the posture labels; we publish the methodology version per source; we publish posture-to-band mappings (§5). What we do not publish is the exact numeric score the Independence component contributes to the overall score, for the reasons in §8. We are aware this is the tension point in our transparency commitment and have written §5 to be as specific as possible to compensate.

### 2.5 Historical accuracy

This component asks whether the source's past claims have held up.

**Sub-criteria.**

- **2.5.a — Documented track record on falsifiable claims.** Where the source has made specific, falsifiable predictions or factual claims, those claims are revisited and the source's accuracy is assessed. (Sampled; graduated.)
- **2.5.b — Correction rate and severity.** What fraction of the source's stories have been corrected? Were corrections cosmetic (typo, misspelled name) or substantive (factual error, headline misrepresentation, sourcing error)? (Quantitative where data permits; graduated otherwise.)
- **2.5.c — Behaviour during high-pressure news events.** How did the source perform during recent high-velocity stories where many outlets made errors? Specifically: rumour amplification, premature attribution, headline walkbacks, pulled stories without notice. (Sampled across at least three reference events per scoring window.)
- **2.5.d — Independent fact-check track record.** How frequently has the source been flagged by recognized fact-checking organizations (IFCN-signatory members)? Severity and disposition of those flags. (Quantitative.)
- **2.5.e — Retraction history.** Public, full retractions issued by the source; the severity of the underlying error; the time-to-retraction. (Quantitative.)

**Honest difficulty.** Historical accuracy at the source level is harder to measure than the other components because it requires verifiable ground truth and time has to pass. New sources (under 24 months of publication history) have a thinner sample. We score new sources on the other four components and add a documented "limited history" caveat on the public profile page until the source has accumulated sufficient track record (typically 24 months).

---

## 3. Score combination

### 3.1 What is published

The five components are combined into a single 0–100 quality score using weights that we treat as proprietary (rationale in §8). What we do publish:

- The five components themselves are the only inputs. There are no secret components.
- All five components contribute non-trivially. No component has a weight below 5% or above 40% of the total.
- The combination function is a weighted sum with a small set of additional rules (the "rules" are described qualitatively below — exact thresholds are proprietary).
- A floor rule: if any single component scores below a defined threshold, the overall score is capped regardless of the other four. This prevents a source with high methodology transparency but a poor historical accuracy record from scoring above its accuracy ceiling.
- A weighting rule on Domain expertise: the weight applied is the source's category-mix-weighted aggregate (§2.3), not a flat number.

### 3.2 What is not published

- The exact weight applied to each of the five components.
- The exact threshold for the floor rule.
- The exact category-weighting function for Domain expertise.
- The numeric score assigned to each individual source in our corpus (only the public-facing band — §4 — is shown to Layer 1; the numeric score is shown to Layer 2).

### 3.3 Why the split

The split is Decision 7. The methodology being open is what makes it citable in academic work and credible to journalists. The weights being proprietary is what makes the score a defensible product asset rather than a free input for competitors. The pattern follows Bloomberg, Reuters, Stratfor: methodology open, ratings closed. Our published rubric is sufficient for an external researcher to reproduce our work against their own corpus and converge on similar bands without recovering our exact weights.

### 3.4 What we promise about the weights

We commit publicly to the following:

1. Weights are not changed retroactively to alter a specific source's score. Weight revisions happen with methodology version bumps (§7) and are announced in the changelog.
2. Weights are not used to penalize or favour a source based on its political alignment. We rely on the posture label (§2.4 / §5) to encode structural attributes and the rubric to evaluate practice.
3. Weights are not derived from financial relationships with any source or third party. We do not accept payment from sources to influence scores.
4. When the founder overrides an auto-computed score, the override is logged with rationale and surfaces in the audit log (§6).

### 3.5 What the score is not

The quality score is not a probability that a given article from the source is true. It is a structural estimate of the source's reliability practice. Article-level truth claims are mediated through the Reality Index (Capability 3) and source triangulation (Capability 1), not through the source score alone.

---

## 4. Score bands and presentation

The numeric score is bucketed into six bands for public display. Bands are designed to communicate practical use guidance, not fine-grained source ranking.

| Band | Range | Label | Layer 1 presentation | Layer 2 presentation |
|---|---|---|---|---|
| A | 90–100 | Exemplary practice | Green badge, label text | Full numeric + component scorecard |
| B | 80–89 | High quality | Green badge, label text | Full numeric + component scorecard |
| C | 70–79 | Generally reliable | Yellow-green badge | Full numeric + component scorecard |
| D | 60–69 | Mixed quality | Yellow badge, label text | Full numeric + component scorecard |
| E | 50–59 | Caution warranted | Orange badge, label text | Full numeric + component scorecard |
| F | <50 | Heavily restricted use | Red badge, label text | Full numeric + component scorecard |

### 4.1 What the bands mean operationally

- **Band A (90–100).** Source meets all five components at a high level. Independence is verified by both posture and practice. Historical accuracy is exceptional over a multi-year window. Examples in our public corpus are rare; we expect Band A to represent under 10% of scored sources.
- **Band B (80–89).** Source is strong across all components but has at least one identifiable area where the rubric is not fully met. This is the band most quality international outlets land in.
- **Band C (70–79).** Source is reliable for its category and beat. May have notable but bounded gaps (e.g., excellent reporting but inconsistent corrections process; strong sourcing but a posture-driven independence ceiling).
- **Band D (60–69).** Source is useful but should be read in context. Often: a source that publishes good reporting but is structurally compromised on a specific category (e.g., a publication owned by a specific industry covering that industry), or a source whose historical accuracy has notable failures.
- **Band E (50–59).** Source has reliability concerns that affect day-to-day use. We may still ingest the source for breaking-news coverage or topical breadth but recommend explicit cross-referencing.
- **Band F (<50).** Source is included in our corpus only when no higher-quality source exists for a specific category or region. Always shown with explicit warning; weight in ranking is suppressed; cross-referencing is mandatory in event dossiers.

### 4.2 Why six bands rather than a continuous score

For free-tier (Layer 1) readers, a numeric score creates the illusion of precision the methodology does not deliver. The difference between an 82 and an 84 is not meaningful at this level of aggregation. Six bands give actionable categorical information without overstating precision.

For premium-tier (Layer 2) readers, the numeric score and component scorecard are visible because that audience has the context and use-cases (research, citation, editorial decisions) where the finer distinctions are relevant.

### 4.3 What the bands do not encode

Bands do not encode the posture label. A Band B source can be Independent, State-affiliated with a strong firewall, Academic, or Corporate-owned. The band and the posture are surfaced as two separate facts on the source profile.

### 4.4 How a source moves between bands

A source's band changes when its score crosses a threshold during a scoring revisit (§7). Movements of more than one band in a single revisit trigger an audit-log entry and require founder approval before publication. This is to prevent rubric drift or component-weight changes from cascading into surprise score moves.

---

## 5. Source posture detail

The posture label is a categorical attribute that describes where the source sits structurally in the media ecosystem. Each source has exactly one label.

The eight labels are drawn from X's state-affiliated / government-affiliated framework, expanded to cover the relevant categories in our news corpus.

### 5.1 The eight labels

| Label | Structural definition | Typical Independence sub-score band |
|---|---|---|
| Independent | No corporate, state, or political-mission ownership. Editorial decisions made by journalists without owner or funder veto. | 65–100 |
| Academic | University-affiliated, research-institute, or peer-reviewed journal publication. | 70–95 |
| Corporate-owned | Privately-held or publicly-traded media business. | 55–95 |
| State-affiliated | Editorial decisions subject to state influence or direction. Excludes editorially-independent public broadcasters (see Government). | 20–55 |
| Government | Government agencies publishing primary data; editorially-independent public broadcasters funded via charter or license-fee mechanism (BBC, NPR, NHK class); and ministry official communications. | 30–85 |
| Corporate-PR | Source is owned by or representing an entity reporting on itself, its industry, or its commercial interests. | 25–55 |
| Advocacy | Mission-driven publishing with explicit advocacy purpose (think tanks, single-issue organizations, NGOs). | 35–70 |
| Aggregator | Source primarily republishes content from other primary sources. Score reflects selection quality and source-mix transparency. | 30–80 |

The "typical Independence sub-score band" column is the **expected range** for the Independence component (§2.4) given the posture. A source can score outside this range in either direction when its practice diverges from the structural prior — but the deviation is documented in the source's profile.

### 5.2 Per-label reasoning

**Independent (65–100).** The ceiling is 100 because true editorial independence has no structural deduction. The floor is 65 because Independence alone does not guarantee accurate or competent reporting — the four other components still need to support the overall band, and a structurally-independent source with weak methodology will score in the 60s on Independence.

**Academic (70–95).** Selection effects (peer review, institutional standards, citation accountability) put the floor at 70. The ceiling at 95 rather than 100 reflects that academic sources can be over-specialized for general news use, slow to current events, and occasionally compromised by funding-source pressure (industry-funded studies, advocacy-funded research). Academic sources shine on context, less on speed.

**Corporate-owned (55–95).** The widest band among the eight labels. The top end of the band is reserved for sources that demonstrate editorial firewall in observable practice — critical coverage of the parent company, refusal of advertiser veto, journalists holding ownership to public account. The bottom end of the band reflects corporate ownership where editorial independence is weak — content shaped by advertiser relationships, owner political projects, or commercial product tie-ins. Most major international outlets sit in the upper half of this band. The ceiling never reaches 100 because incentive structures, however well-managed, are non-trivial.

**State-affiliated (20–55).** State-affiliated denotes sources whose editorial decisions are subject to state influence or direction. The label does not require formal state ownership — funding patterns, executive appointment power, regulatory pressure, or operational coordination can each produce the same effect. Indicators include state appointment of senior editorial leadership, content guidelines issued or enforced by state actors, and coverage on state-priority topics that demonstrably tracks state messaging. The label specifically excludes editorially-independent public broadcasters funded via charter or license-fee mechanisms (BBC, NPR, NHK, ABC Australia, NRK class), which are captured under Government. The ceiling at 55 reflects the structural ceiling on Independence: a source under state editorial direction cannot, by definition, exceed the upper threshold of Band E on the Independence component. State-affiliated sources can still produce useful wire-style coverage on topics outside state-priority issues, and that practice is scored on its merits — but the structural attribute caps the ceiling regardless of practice.

**Government (30–85).** Government covers three distinct cases. First, **technical agencies publishing primary data** — USGS earthquake feeds, NOAA weather data, WHO surveillance reports, national statistical agencies. Methodology is transparent, the data is the data, and political pressure on data production is publicly observable when it occurs. These score in the upper band (70–85). Second, **editorially-independent public broadcasters funded via charter or license-fee mechanism** — BBC, NPR, NHK, ABC Australia, NRK. The funding source is the state or a state-mandated levy, but editorial decisions are protected by charter and demonstrably independent in observable practice: critical coverage of the funding government is regular, editorial appointments are insulated from political cycles, and editorial standards are public and enforced. These score in the upper band (75–85). The reason this class lives in Government rather than State-affiliated is precisely that the charter mechanism removes state editorial direction even though the funding chain runs through the state. Third, **ministry political communications** — press releases, official statements, party-controlled communications offices. These are by construction advocacy for the issuing government and score in the lower band (30–50). The Government label spans all three because all three are forms of government-mediated communication, but the per-source position within the band is determined by which sub-case the source occupies plus its practice on the four other components.

**Corporate-PR (25–55).** A source covering its owner's industry, products, or commercial interests is structurally compromised on the topic that matters most. The ceiling at 55 is intentional: even a well-edited corporate-PR source, on its core topic, cannot exceed Band E. The score reflects what the source is structurally fit to do — communicate the perspective of its owner — rather than what it is structurally unfit to do (independent investigation of its owner). Corporate-PR sources can be legitimate inputs to a story (the company's own framing of an event matters) but are never the only source.

**Advocacy (35–70).** Mission-driven publishing covers a wide quality range, from rigorous-method advocacy organizations that produce some of the most carefully sourced reporting in their domain (the Human Rights Watch, Amnesty International, EFF tier) to single-issue partisan publications. The ceiling at 70 is honest about structural fact: even rigorous advocacy publishes with a defined purpose, and a 70+ would require editorial independence that advocacy organizations do not have by definition.

**Aggregator (30–80).** Aggregators score on two dimensions: selection quality (do they pick reliable underlying sources? do they pick across a balanced source mix?) and transparency (do they disclose the underlying sources for each item? do they disclose their editorial algorithm or curation principles?). The ceiling at 80 reflects that even the best aggregator adds real value (curation, deduplication, accessibility) but is not original reporting and inherits the limitations of its source pool.

### 5.3 How posture labels are assigned

Posture assignment is the first step in source onboarding (§6). The label is assigned by the founder based on:

1. Ownership and funding structure as publicly documented.
2. Editorial-charter language.
3. Observed editorial practice over a sample period.
4. Where the source is recognized in regulatory or platform classification (e.g., a source that platforms classify as state-affiliated is so labelled by default unless practice clearly diverges).

A source's label can change. Label changes are rare and trigger a full re-scoring on the next cycle. Label changes are logged with rationale.

### 5.4 What posture labels do not do

Posture labels do not encode political alignment within the Advocacy category. A Band C left-leaning advocacy source and a Band C right-leaning advocacy source are surfaced identically; the political stance is described in the source profile's narrative text rather than encoded as a categorical signal.

Posture labels do not differentiate between subscale variations within a label (e.g., among State-affiliated sources, we do not have a separate "openly partisan" sub-label vs "firewalled public broadcaster" sub-label). That information is captured in the Independence sub-score and the narrative text.

---

## 6. Scoring workflow

Per Decision 16, source onboarding and scoring is a hybrid AI + human workflow. The workflow described here is the operating model as of methodology v1.0.

### 6.1 New source onboarding

1. **Candidate proposal.** AI agent runs weekly analysis of source-matrix gaps (which category × region × type cells are below target source count) and proposes up to 50 candidate sources per week, with metadata: ownership, language, frequency, RSS or feed health, sample headlines, estimated quality band, proposed posture label.
2. **Founder review.** The founder reviews the batch in a ~30-minute weekly review, accepts or rejects each candidate, and approves the proposed posture label or assigns a different one.
3. **Initial scoring.** Approved sources are scored against the v1.0 rubric. The AI agent assembles evidence per sub-criterion; the founder reviews the assembled evidence and finalizes the score on the four observable components (§2.1, §2.2, §2.3, §2.4). The fifth component (§2.5 historical accuracy) is provisional for sources with under 24 months of history and is flagged on the public profile until sufficient track record is accumulated.
4. **Publication.** Score, band, and posture become visible on the source's public profile. Methodology version is recorded with the score.

### 6.2 Periodic re-scoring

- All sources are revisited at the cadence defined in §7.
- Revisit triggers a fresh evidence assembly from the AI agent against the current rubric version.
- The founder reviews and finalizes any score changes.
- Band changes are published in our public changelog.

### 6.3 Event-driven re-scoring

Outside the regular cadence, the following events trigger an immediate re-score:

- Ownership change (acquisition, merger, sale).
- Editorial leadership change.
- Documented retraction or correction failure on a high-impact story.
- IFCN-signatory fact-check finding of significant inaccuracy.
- Public allegation of ethical violation that is substantiated by independent reporting.

Event-driven re-scores are logged with the triggering event and rationale.

### 6.4 Audit trail

Every score has an audit trail:

- Date of scoring.
- Methodology version used.
- Per-component sub-score (Layer 2 visible).
- Founder override flag (if applicable) with rationale.
- Score history (all prior scores with dates).

The audit trail is queryable by Layer 2 subscribers and by academic researchers on request.

### 6.5 Founder override

The founder retains the authority to override an auto-computed score in either direction. Overrides are exceptional, are logged with rationale, and are surfaced on the source profile. The override mechanism exists for edge cases the rubric does not cover well (e.g., a source whose practice has materially changed faster than the revisit cycle) — it is not used to manage score distributions, hit quotas, or favour or disadvantage specific sources.

---

## 7. Review and update cadence

### 7.1 Source-level revisit cadence

- **Bands A and B (80–100):** revisited every 12 months.
- **Bands C and D (60–79):** revisited every 9 months.
- **Bands E and F (<60):** revisited every 6 months.
- **All sources:** event-triggered re-scoring per §6.3 at any time.

Higher-band sources are revisited less frequently because their practice is more stable. Lower-band sources are revisited more frequently because their state is more volatile and the cost of missing a quality decline is higher.

### 7.2 Methodology versioning cadence

- **Minor versions (v1.x):** issued as the rubric is refined — sub-criteria sharpened, posture-band ranges adjusted, definitions tightened. Target: roughly once per quarter while the methodology is young.
- **Major versions (v2.0+):** issued when the set of components changes, when score bands are restructured, or when the public/proprietary split changes. Target: not more than once every 18 months.

Each version is published with:
- A changelog describing every change from the prior version.
- A re-scoring window: all sources are re-scored against the new version within a defined window (typically 90 days).
- Side-by-side score reporting during the transition window so academic citations and prior published material remain interpretable.

### 7.3 What does not trigger a methodology update

- Single-source disagreements.
- Pressure from rated sources to be re-rated outside the cadence.
- Commercial considerations.
- Public commentary on individual scores.

Methodology revisions are driven by rubric improvement based on observed scoring outcomes across the full corpus, not by individual cases.

---

## 8. Public methodology vs proprietary weights

This methodology is published in full. The exact numeric weights applied during score combination, the threshold of the floor rule (§3.1), and the per-source numeric scores (Layer 1 sees bands; only Layer 2 sees numbers) are not published.

### 8.1 Why the split exists

Per Decision 7 in our Decisions Log:

> Methodology open and citable; weights, models, and source-credibility scores proprietary.
> Rationale: Open methodology = academic credibility = citation = free distribution. Proprietary weights/models = competitive moat. Bloomberg/Reuters/Stratfor pattern.

The methodology being public makes it usable by academics, regulators, journalists, and readers who want to understand what a score means. It also makes the methodology accountable — anyone can read it, identify gaps or biases, and provide critique that improves the next version.

The weights being closed reflects that the score is a product asset. Scoopfeeds invests substantial editorial and engineering effort in scoring sources well. If the exact weights were public, a competitor could reproduce our score for any source without doing the underlying work and without the per-source evidence assembly that produces a defensible score. Holding the weights closed preserves the incentive to keep producing accurate scores.

### 8.2 What is verifiable without the weights

Any external researcher can:

- Read the rubric and assess whether it is well-designed.
- Apply the rubric to their own source corpus and produce comparable scores.
- Compare their bands to ours on overlapping sources and detect systemic bias if it exists.
- Critique the rubric, the posture labels, or the band thresholds and propose improvements.

What is not verifiable without the weights:

- The exact arithmetic that produced a specific source's specific numeric score from its component scores.

We accept this asymmetry. The rubric is the substance; the weights are the implementation.

### 8.3 Audit by external parties

We commit to:

- Responding to good-faith methodology questions from academic researchers, journalists, and regulators.
- Providing per-source component sub-scores to academic researchers on request, under a use agreement that prevents redistribution of the proprietary data.
- Publishing aggregate statistics about our score distribution annually.
- Annual external review of a sampled subset of scores by an editorial advisory panel (planned Phase D, not yet established).

---

## 9. Honest limitations

This section does not soften. Source credibility scoring is editorial judgment encoded into a rubric — not algorithmic truth. The rubric is a structured way to apply expert judgment consistently across a large corpus; it is not a measurement of an objective property of a source.

### 9.1 Limitations of the rubric

- **The rubric does not fully describe a source.** Five components and one posture label cannot capture the texture of a publication's editorial culture, the seasonality of its quality (sources rise and fall as people come and go), or the regional and political context in which it operates. A score is a useful summary; it is not the source.
- **The rubric is biased by what is documentable.** Sources that publish editorial standards documents, that have English-language verifiable bylines, that operate in jurisdictions with public corporate filings — these score more easily on §2.1 and §2.4 than sources that practice high editorial standards without the documentary apparatus. We try to compensate via 2.3.c (sustained coverage) and direct verification for smaller outlets, but the bias exists.
- **The rubric privileges certain journalistic traditions.** The criteria are derived from Anglo-American and European journalism norms (named bylines, separation of news and opinion, written editorial standards, primary-document linking). Some legitimate journalistic traditions do not share all these conventions. A source operating within a different tradition is not penalized for tradition itself, but is evaluated against criteria that reflect a specific tradition's understanding of credibility.

### 9.2 Limitations of the score

- **The score is one number summarizing a complex object.** Reasonable observers can look at the same source and arrive at different scores within a band. We treat the band as the meaningful unit; numeric differences within a band should not be treated as significant.
- **The score is a snapshot.** Sources change. Our revisit cadence (§7) catches large changes within months and small changes within a year. Between revisits, a score can be stale. Event-driven re-scoring (§6.3) catches catastrophic changes but not gradual ones.
- **The score is not predictive of any single article.** A Band A source can publish a flawed article tomorrow. A Band E source can break a true story tomorrow. The score is a base rate, not a forecast of a specific publication event.

### 9.3 Limitations of the posture label

- **Eight labels cannot exhaustively describe ownership and structural relationships in the global media ecosystem.** Some sources do not cleanly fit any of the eight; we apply the closest fit and document the deviation in the narrative profile text.
- **Posture labels can be politically contested.** Reasonable observers disagree on whether specific sources are "state-affiliated" or "government-funded but independent" or "advocacy disguised as journalism." We make a categorical assignment based on the criteria in §5.3, document our reasoning, and accept that some assignments will be contested.

### 9.4 Limitations of the workflow

- **The scoring workflow is human-bottlenecked at the founder level.** This is a deliberate choice (Decision 16) to keep scoring decisions accountable to a single human reviewer. It also means scoring throughput is capped by founder review capacity. As the corpus grows, the workflow will need to evolve — likely toward a delegated editorial advisory panel under founder oversight rather than founder-direct review on every source.
- **The scoring workflow is biased toward sources we can observe.** Sources that publish in languages our team and tools can process well are scored more easily than sources in less-supported languages. We are expanding language coverage but the bias is real at v1.0.

### 9.5 Limitations of the public methodology / proprietary weights split

- **The split is honest about what we are doing, but it is also self-serving.** We publish the rubric because openness is credible and citable; we hold the weights closed because they are a commercial asset. We do not pretend this is purely an editorial decision. The Bloomberg / Reuters / Stratfor precedent shows the pattern works commercially; the burden is on us to keep the methodology good enough that the closed weights are not protecting a weak rubric.
- **The split limits external verification.** A researcher can reproduce the rubric and produce their own bands, but cannot verify that our exact numeric score for a source was computed correctly from its component sub-scores. We compensate by publishing the component sub-scores on Layer 2 source profiles, so the gap is at the arithmetic-of-combination step, not at the underlying judgment step.

### 9.6 Limitations of this version

- Version 1.0 is the first public methodology release. It will have rough edges. We expect substantive critique from external readers and have built versioning into the methodology so we can respond.
- Sub-criterion 2.2.e (AI and automation disclosure) is industry-immature; the bar for it will rise in v1.1 as industry norms develop.
- Per-category Domain expertise scoring (§2.3) is currently weighted by source publication volume per category; a more sophisticated weighting (by event-level relevance) is planned for v1.x.
- The eight posture labels were derived from X's framework plus our own corpus needs. We do not commit to keeping the labels stable across major versions if the global media ecosystem evolves in ways that make the labels insufficient.

---

## 10. Related documents

- **[Strategic Plan v6.0](../strategy/strategic_plan_v6.md)** — Section 3, Capability 1: defines the five-component scoring framework and the source matrix.
- **[Decisions Log v1.0](../strategy/decisions_log_v1.md)** — Decision 7 (open methodology + proprietary weights), Decision 16 (source onboarding workflow).
- **[Phase A Kickoff Brief](../phases/phase_a_kickoff_brief.md)** — Sprint 4 Issue 4.4: quality scoring infrastructure work.
- **Source list:** `backend/src/config/sources.js` is the canonical source list for ingestion as of methodology v1.0. The `sources` database table (Migration 002) is parallel infrastructure for scoring.
- **Migration 002:** `backend/src/db/migrations/002_sources_table.js` defines the scoring columns (`quality_score`, `quality_score_components`, `source_posture`, `quality_score_methodology_version`, `quality_score_last_updated`) that will be populated against this methodology in Sprint 4.5.

---

## Changelog

**v1.0 — May 2026.** Initial public release. Five components and eight posture labels per Strategic Plan v6.0. Public/proprietary split per Decision 7. Six-band presentation. Hybrid AI + founder scoring workflow per Decision 16.
