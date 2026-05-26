# Tracker Template — Study

**Signal type:** `study`
**Status:** draft v0.1 — Sprint 1.1.3 deliverable
**Pairs with:** `outbreak.md` (epistemic cousin — both depend on evidence-
hierarchy thinking) and the other six tracker templates (parallel
7-section structure)

> This is a markdown specification of what a *study* tracker captures and
> displays for major scientific findings and research publications. It is
> **not** a schema or code artifact — schema follows in Sprint 1.2 once all
> 8 templates are reviewed.

> **Data-source gap (explicit).** Scoopfeeds has **no journal-publication
> ingester** at the time of this template's authoring. The template ships
> documenting the gap; per-journal feed onboarding (PubMed, bioRxiv,
> medRxiv, arXiv, major-publisher APIs, Crossref) is future Track 1 source
> work. Until then, study trackers run on editorial seed + wire pickup
> only.

> **Reviewer note.** DrJ (MPH, Johns Hopkins) has direct domain relevance
> here. Evidence-hierarchy semantics, study-design language, and replication
> conventions in this template warrant his specific review — analogous to
> the `outbreak.md` MPH-review process.

---

## 1. Purpose + Trigger

**Purpose.** A study tracker quantifies the state of evidence for a
specific scientific finding so a reader can see *what was claimed, in
what kind of study, with what sample, with what peer-review and
replication status* — without confusing one headline-grabbing preprint
with established consensus.

**Trigger.** Auto-detected when:
- Articles in `science` / `medicine` / `public-health` / `health`
  clusters surface ≥ 5 distinct dispatches naming the same finding
  within 14 days (high wire-pickup density is itself the trigger, since
  the journal-feed ingester is pending), **OR**
- A major journal (NEJM, Lancet, Nature, Science, Cell, JAMA, BMJ)
  publishes a finding with WHO / CDC / NIH commentary attached (these
  often signal newsworthy clinical implications), **OR**
- Editorial seed (DrJ flags an emergent finding worth tracking — often
  before wire density rises, particularly for public-health relevant
  studies).

---

## 2. Core Metrics

Each metric below carries three fields per the Option-3 confidence pattern:
**headline value + confidence flag + source attribution.**

Confidence vocabulary (study-specific — driven by evidence hierarchy):
- **preprint** — manuscript posted to a preprint server (bioRxiv, medRxiv,
  arXiv, SSRN, etc.) without peer review. Most newsworthy preprints are
  legitimate science, but the peer-review gate has not been passed.
- **peer-reviewed** — published in a peer-reviewed venue. Strongest single-
  study tier; still subject to all the usual single-study caveats.
- **replicated-or-consensus** — finding has been independently replicated
  (ideally pre-registered) **or** is captured in a systematic review /
  meta-analysis / formal consensus statement (WHO guideline, NIH
  consensus development conference, professional-society position
  statement with evidence-grading).

This vocabulary leans into the evidence hierarchy explicitly because *the
study design and replication status are the headline metric*, not a
parenthetical caveat.

Metrics tracked:

1. **Finding summary** — single-sentence claim under tracker; confidence;
   source. Must reflect what the study actually shows, not what the press
   release or headline says (these routinely diverge).
2. **Study type** — the confidence-axis metric. Vocabulary:
   randomized-controlled-trial (RCT) / observational-cohort /
   observational-case-control / cross-sectional / case-series /
   case-report / in-vitro / animal-model / computational-modeling /
   systematic-review / meta-analysis. **This metric IS the dominant
   honesty signal.** A finding from an n=20 case series is not the same
   evidentiary weight as a finding from a 10,000-participant RCT.
3. **Sample size** — integer; confidence; source. n=12 means something
   very different from n=12,000; do not hide the number.
4. **Effect size** — where applicable: hazard ratio, odds ratio, relative
   risk, mean difference, etc. with confidence interval. Effect size +
   CI matters more than p-value; tracker should surface CI when reported.
5. **Peer-review status** — `preprint` / `submitted` / `peer-reviewed-
   published` / `retracted`; confidence; source. Retraction tracking is
   the long-tail update path; tracker must accept retraction updates
   even years after initial coverage.
6. **Replication status** — `not-yet-attempted` / `attempted-failed` /
   `partially-replicated` / `replicated`; confidence; source. Often only
   becomes assessable months / years after the initial finding.
7. **Conflicts of interest** — qualitative summary of funding source and
   declared COIs; source: the study's COI disclosure section. Industry-
   funded studies on industry products are not automatically wrong but
   warrant disclosure-visibility.

A single study, however well-designed, is **not** consensus. The tracker
must visually distinguish single-study findings (even peer-reviewed ones)
from `replicated-or-consensus` tier. Layer 1 (see §5) deliberately omits
single-study findings from headline framing.

---

## 3. Data Sources

Primary (authoritative):
- **PubMed / MEDLINE** — clinical and biomedical research index. Already
  used at Scoopfeeds for some lookup, but **no direct programmatic
  tracker-ingester exists**.
- **Major journals' RSS / Crossref feeds** — NEJM, Lancet, Nature,
  Science, Cell, JAMA, BMJ, PLOS family, plus discipline-specific
  flagships. **Ingester pending.**
- **Preprint servers** — bioRxiv, medRxiv, arXiv, SSRN, ChemRxiv,
  EarthArXiv. **Ingester pending.**
- **WHO / CDC / NIH / professional-society guideline publications** —
  authoritative for `replicated-or-consensus` tier.
- **Cochrane systematic reviews + Cochrane CENTRAL** — the gold standard
  for synthesized evidence in clinical questions.

Secondary (corroboration):
- Wire-service science desks (Reuters, AP, AFP) for accessible framing.
- Specialist science outlets (Stat News, Science News, Nature News,
  Quanta) for context — often catch the gap between press release and
  study substance.

Excluded by default:
- Press releases as primary source (notorious for over-stating findings).
- Conference-abstract-only data without full publication (sample sizes,
  effect sizes, and even basic study designs often unreported in
  abstracts).
- Industry-issued claims about industry products without independent
  publication.

---

## 4. Update Cadence

- **Initial-coverage phase** (publication week): daily check; tracker
  captures the finding, study type, sample size, and initial
  peer-review status.
- **Commentary phase** (weeks 1–8): weekly; track formal commentary
  responses, letters-to-editor, expert reaction roundups (e.g., Science
  Media Centre). These often surface flaws or caveats not visible in
  initial coverage.
- **Replication-window phase** (months 6+): monthly; track replication
  attempts, retraction events, citation of the finding in subsequent
  systematic reviews.
- **Retraction / correction triggers**: immediate update flagged
  `breaking`. Retraction tracking is one of the most important late-stage
  responsibilities; the tracker must keep accepting updates indefinitely.
- **Consensus-integration trigger**: when the finding gets folded into a
  guideline (WHO / professional-society) or systematic review, confidence
  tier flips to `replicated-or-consensus` and tracker closeout is
  considered.

---

## 5. Display Considerations

**Layer 1 — Homepage / category card.**
Compact widget showing:
- Tracker title (e.g., "GLP-1 agonist long-term cardiovascular outcomes").
- **Finding summary** — what the study actually says, in one sentence.
  The reader gets the claim.
- **Evidence-quality badge** — dominant, visually distinct, *inseparable
  from the finding on the card*. The badge carries: confidence tier
  (`preprint` / `peer-reviewed` / `replicated-or-consensus`) + study type
  + sample size — for example, "PREPRINT · animal model · n=200" or
  "META-ANALYSIS · 12 RCTs · n≈18,400". The badge is **color-coded by
  position in the evidence hierarchy**: replicated-or-consensus and
  meta-analyses sit at the strong end of the scale; single preprints,
  animal-model findings, and small-n studies sit at the weak end. Strength
  is glanceable without reading.
- Last-updated timestamp.

The design principle is that the finding and its evidence-quality badge
are **inseparable** on the card — a reader cannot see the claim without
simultaneously seeing what kind of evidence it rests on. This is the
mechanism that breaks the hype-cycle pattern (single n=200 preprint
headlined as settled medicine) *without* hiding the finding itself. An
austere study-type-only headline was considered and rejected as worse for
reader experience; no gold-standard tool in this space (GRADE, Cochrane,
Consensus, evidence-based-medicine teaching materials) hides the finding
behind quality framing — they pair the two visibly. See §6 for the
grounding convention.

**Layer 2 — Full tracker page.**
Expanded view showing:
- All seven metrics from §2 with their confidence flags and source
  attribution.
- Finding summary, with explicit "what the study shows" vs "what
  surrounding coverage has claimed" panel when these diverge meaningfully.
- Effect size with confidence interval, plotted where applicable.
- Study-design panel: RCT vs observational vs animal-model framing made
  explicit with one-line "what this design can and cannot show" notes.
- Replication timeline: when replication attempts have been published.
- Citation tracker: how the finding has been cited in subsequent reviews
  / guidelines (when crossref / Semantic Scholar style data is available).
- Retraction-status badge (visually prominent if the study is retracted).
- COI panel: funding source and declared conflicts.
- Source-attribution panel.
- Related-articles list.

---

## 6. Validation Source

**Authoritative.** Tiered by evidence type:
- For `peer-reviewed` tier: the publishing journal's editorial process is
  the validation source.
- For `replicated-or-consensus` tier: independent replication (ideally
  pre-registered, in a peer-reviewed venue) **or** a recognized
  systematic-review body (Cochrane), guideline body (WHO, professional
  societies), or formal consensus statement (NIH consensus development).
- For `preprint` tier: there is no validation; the tier label itself is
  the honesty signal.

**Cross-reference.** Science Media Centre expert-reaction roundups,
Retraction Watch (for retraction signals), PubPeer (for post-publication
peer review), and Cochrane reviews collectively validate or contextualize
single-study findings.

**Editorial override.** DrJ may downgrade confidence manually when a
finding has been criticized in expert commentary that hasn't yet appeared
in formal journal-level critique — important during the gap between
preprint hype and formal letter-to-editor response.

**Display-convention grounding.** The Layer 1 finding-with-inseparable-
badge pattern (§5) is modeled on **GRADE** (Grading of Recommendations,
Assessment, Development and Evaluations — the international standard for
visually grading evidence quality alongside the recommendation it supports)
and on the **Consensus app** convention of pairing a research finding with
a color-coded quality badge. The deliberate counter-example is the
*citation-without-quality-grading* failure mode (a search result listing
the finding with a journal name but no evidence-tier signal), which has
been documented to over-weight reader credence in low-quality sources.
Pairing finding-and-grade visibly is the gold-standard practice; this
template adopts it.

---

## 7. Open Questions / Limitations

Captured as prose so Sprint 1.2 (schema) can absorb them, not pre-resolved.
DrJ (MPH) review especially welcomed on this section.

- **Journal-publication ingester gap.** No direct programmatic feed
  exists at Scoopfeeds today. Per-source onboarding (PubMed,
  bioRxiv/medRxiv, Crossref, major-publisher APIs) is on the Track 1
  source-onboarding backlog. Until then, the trigger relies on wire
  pickup density — which has its own bias (studies that get press-
  released travel further than studies that don't).
- **Single-study-hype resistance — RESOLVED (DrJ, GRADE + Consensus
  convention).** An earlier draft proposed an austere Layer 1 that
  *omitted* the finding effect-size and headlined study-type + sample-size
  only. The resolution is the GRADE / Consensus pattern instead: Layer 1
  shows the **finding with a dominant, inseparable evidence-quality
  badge** carrying tier + study type + sample size, color-coded by
  position in the evidence hierarchy. This breaks the hype-cycle pattern
  (single n=200 preprint headlined as settled medicine) without hiding
  the finding — which the austere version did, rejected because no
  gold-standard tool in evidence-based medicine hides the claim behind
  quality framing. Schema implication for Sprint 1.2: each tracker entry
  carries `tier`, `study_type`, `sample_size`, and a derived
  `hierarchy_rank` value (used to drive the badge color). Compare with
  the citation-without-quality-grading anti-pattern (some search-engine
  result presentations) — explicitly avoided.
- **Animal / in-vitro misframing.** Headlines routinely report "study
  shows X" without noting the study was in mice or cells. Tracker must
  surface study type on Layer 1 specifically to break this pattern. Edge
  cases (computational modeling, single-arm phase I trials) deserve
  explicit treatment.
- **Retraction tracking.** Retractions often hit months / years after
  initial coverage when public memory has moved on. Tracker must keep
  accepting retraction updates indefinitely; closeout policy should not
  auto-close on news-cycle quiet for studies that haven't reached
  consensus tier.
- **Conflicts-of-interest disclosure.** Disclosure quality varies
  enormously across journals and across decades (older studies often
  have minimal COI disclosure). Tracker should surface declared COIs
  when present and flag absence explicitly; never impute COIs from
  surrounding context.
- **Replication-crisis-affected fields.** Psychology (Many Labs / Open
  Science Collaboration), social-priming, much of cancer-cell-line
  biology, and parts of behavioral economics have known low replication
  rates. Tracker should surface field-level replication base-rates as
  context where credible meta-research exists. Defer to Sprint 1.5
  whether this becomes a Layer 2 panel.
- **Predatory journals.** Some journals do peer review in name only.
  Treating "peer-reviewed" as binary masks this. Cabells / Beall's-list
  data could feed a `venue-quality` qualifier — defer scope to Sprint
  1.2 schema.
- **Preprint relaxation of standards.** Preprints are by definition
  pre-peer-review. Some preprint servers have light screening, others
  do not. Tracker should record which preprint server (different
  servers, different baseline filtering).
- **Cochrane vs other systematic-review bodies.** Cochrane reviews are
  the gold standard for clinical questions but cover only a fraction of
  publishable questions. Other systematic-review traditions (PRISMA-
  compliant from other groups) vary in quality; tracker should not flat-
  ten this to "systematic-review = consensus."
- **Meta-analysis-of-bad-studies risk.** A meta-analysis can synthesize
  garbage and produce a precise-looking effect estimate. Garbage-in
  warning: replication tier should account for study-design quality of
  the underlying corpus, not just count of studies.
- **Press-release vs paper divergence.** Press releases routinely
  overstate findings. Tracker authoring discipline: read the abstract
  (and ideally results section) before summarizing, not the press
  release. Defer authoring workflow to Sprint 1.5.
- **Discipline coverage scope.** Biomedical + public-health are
  Scoopfeeds' obvious primary domains; physics, climate, social science
  have their own conventions and venue ecosystems. Template generalizes,
  but per-discipline source onboarding is independent.
