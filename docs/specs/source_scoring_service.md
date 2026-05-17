# Source Scoring Service — Specification v1.0

**Document type:** Service specification
**Version:** 1.0
**Owner:** DrJ (Founder)
**Companion documents:** Source Credibility Methodology v1.1 (`docs/content/source_credibility_methodology.md`), Phase A Source Audit Phase 2 Calibration (`docs/audits/phase_a_source_audit_phase2_calibration.md`), Strategic Plan v6.0 §3 Capability 1, Decisions Log v1.0 (Decisions 7 and 16)
**Audience:** Phase B Track 1 implementation team, founder, external readers evaluating the scoring infrastructure
**Last updated:** May 17, 2026

---

## 0. About this document

This is the architectural specification for the Source Scoring Service — the Phase B Track 1 component that applies the Source Credibility Methodology programmatically to the corpus. It captures what the service does, what it consumes, what it produces, and how it integrates with adjacent services. It does not prescribe implementation choices (language, framework, storage details, LLM provider). Those decisions belong to the implementation phase.

Versioning is separate from the methodology. The methodology is currently v1.1 (committed `3d935ef`); this is service spec v1.0. Service version updates ship when the service's external contract changes; methodology version updates ship when the rubric changes. The service's `quality_score_methodology_version` field records which methodology version produced each score, so the two versioning tracks stay independently interpretable.

---

## 1. Purpose and scope

### 1.1 What this service does

- Applies the methodology rubric (currently v1.1) programmatically to source metadata to produce a quality score per source.
- Produces a structured output per source: five component sub-scores, one posture label, one combined quality_score, methodology version, timestamp.
- Runs on cadence (weekly batch per Decision 16) and on triggering events (ownership change, methodology version bump, editorial override).
- Maintains a per-scoring-run audit trail with reasoning at the sub-criterion level.
- Supports editorial override per methodology §6.5.

### 1.2 What this service does not do

- **Source discovery.** Finding candidate sources from RSS directories, news APIs, and language aggregators is a separate Phase B Track 1 service.
- **Source ingestion.** Fetching articles from approved sources is the existing `scheduler.js`. This service operates one layer above ingestion.
- **Per-article scoring.** Article-level scoring is a Reality Index function (Strategic Plan v6 Capability 3), not this service. This service scores sources, not articles.
- **Creator-methodology scoring.** Architectural slot reserved (§2.5) for Phase C per finding #86. Not in v1 implementation scope.

### 1.3 Why this service exists (architectural reframing)

Sprint 4.5 was originally framed as a manual scoring backfill: score all 154 sources by hand, write results into the `sources` table, ship. Session 27 calibration on 15 sources revealed the real shape of the work: source scoring is a recurring operation, not a one-time content deliverable. Methodology §7.1 mandates revisits every 6–12 months; corpus growth toward Strategic Plan v6 targets (Phase E exit 800 sources) compounds the annualized manual-scoring cost into unsustainability.

Finding #85 captured this institutional pattern as "infrastructure work disguised as content work in Phase planning." The architectural answer is automated scoring with editorial override, not manual marathon. This service is that automated layer.

The 15 sources scored in the v1.0 calibration (`docs/audits/phase_a_source_audit_phase2_calibration.md` §2) become the ground-truth validation set: the service must reproduce those 15 scores within ±5 points per source on methodology v1.0 before being trusted on the remaining corpus.

---

## 2. Service architecture

### 2.1 Position in Phase B Track 1

Phase B Track 1 source infrastructure consists of four cooperating services:

| Service | Role |
|---|---|
| Source discovery | Finds candidate sources from RSS directories, news APIs, Wikipedia infoboxes, language-specific aggregators. Outputs candidate list. |
| Source enrichment | Gathers metadata for each candidate or existing source: ownership, corrections-page URL, byline transparency, funding mix, masthead. Outputs metadata payload. |
| **Source scoring (this spec)** | Applies methodology rubric to source + enrichment metadata. Outputs scores per methodology component plus posture label. |
| Editorial review interface | Surfaces weekly batch for founder approval; supports per-source override per methodology §6.5. |

Source ingestion (existing `scheduler.js`) operates downstream of these four services — it picks up approved sources for RSS / YouTube fetching.

### 2.2 Inputs

Per source:

- Identity: `name`, `url` (RSS) or `channel_id` (YouTube) — from `sources` table columns established in Migration 002.
- Classification: `source_type` (`rss` | `youtube`), `category`, `region`.
- Methodology version to apply (currently v1.1; future v1.x+).
- Source enrichment metadata (from source enrichment service): ownership, funding structure, corrections-page URL, masthead, byline-pattern indicators, AI-disclosure-page URL where present.
- Previous score, posture label, and component sub-scores (for delta detection and override-conflict resolution).

### 2.3 Outputs

Per source, written to `sources` table columns from Migration 002:

| Output | Migration 002 column | Type |
|---|---|---|
| Combined quality score (0–100) | `quality_score` | INTEGER |
| Five component sub-scores | `quality_score_components` | TEXT (JSON) |
| Posture label (one of 8 per methodology §5) | `source_posture` | TEXT |
| Methodology version applied | `quality_score_methodology_version` | TEXT |
| Scoring timestamp | `quality_score_last_updated` | INTEGER (unix ms) |

Plus an audit log entry (per §6.4) capturing per-sub-criterion reasoning, confidence, and any LLM-evaluation outputs.

### 2.4 Methodology version routing

Each source's `quality_score_methodology_version` records which version produced its current score. On methodology version bump (v1.x → v1.y), the service:

1. Compares old vs new rubric to identify changed components / sub-criteria.
2. For changed components: triggers selective rescore of all sources (because the rubric for those components has changed).
3. For unchanged components: scores are preserved with version-bump-only metadata update.
4. Per methodology §7.2, side-by-side score reporting is maintained during the transition window so prior published material remains interpretable.

This means methodology bumps are not always full-corpus rescores — they are scoped to the actual rubric changes. v1.0 → v1.1, for example, changes §5.2 (Government sub-case 2 expansion), introduces a new §5.2 sub-case (Corporate-owned industry-affiliated parent), and adds §2.1 Aggregator ET substitution. Only sources affected by those changes need rescore (Government-posture sources, suspected industry-affiliated Corporate-owned sources, and Aggregator-posture sources).

### 2.5 Multi-methodology slot (Phase C placeholder)

Per finding #86, creator methodology is Phase C scope. The service architecture reserves a methodology-routing slot:

- Publisher methodology branch (this spec, v1 implementation)
- Creator methodology branch (Phase C, not implemented in v1)

Routing is determined at scoring time by source classification: publisher-shaped sources route to publisher methodology; creator-shaped sources (Substack-class solo writers, podcast hosts, single-operator YouTube channels) route to creator methodology when that branch ships. The branch selection is exposed as a service input so future adjustments don't require a service version bump.

For interview-format content (per finding #86), the eventual creator methodology produces three composite scores per episode (host + guest + per-episode). The service architecture admits this multi-output shape; v1 publisher-only implementation produces one score per source.

---

## 3. Sub-criteria operationalization (representative sample)

For each sub-criterion the service evaluates, three operationalization patterns exist:

1. **Structured data lookup.** Sub-criterion answer comes from public structured data — Wikipedia / Wikidata, regulatory databases, platform classifications (X's state-affiliated labelling, for example), source's own published metadata.
2. **Website scraping + pattern matching.** Sub-criterion answer comes from analyzing the source's website: presence of corrections page, presence of editorial standards page, byline patterns in sampled articles.
3. **LLM evaluation.** Sub-criterion answer requires a judgment call: does this corrections policy describe a "functioning corrections process"? Does this byline pattern qualify as "usually" vs "sometimes" vs "always"? Is this a State-affiliated source under v1.1 §5.2 indicators?

Most sub-criteria combine patterns — structured-data lookup where available, scraping for source-specific signals, LLM evaluation for the judgment portion. Each sub-criterion's operationalization is a small pipeline: input → evidence gathering → scoring → confidence.

### 3.1 Five representative operationalizations

The five examples below span the five methodology components and show the operationalization pattern. The remaining sub-criteria (approximately 20) follow the same patterns; full per-sub-criterion operationalization is implementation-phase work (§8.1).

**§2.1.a — Named, documented editorial leadership.**

- Patterns: Website scraping + structured-data lookup fallback.
- Implementation:
  1. Look for `/about`, `/masthead`, `/editorial-team`, `/our-team` URL patterns on source domain.
  2. Extract editor-in-chief name from headings or labeled fields.
  3. Verify contact info (email / form) present on the same page.
  4. Fallback: Wikipedia / Wikidata page for the publication; LLM extraction of named editor from infobox or article body.
- Output: yes / no + extracted name + source URL of evidence.
- Confidence: high if found on source's own site with contact; medium if Wikipedia-only; low if name-only without verification.

**§2.1.d — Functioning corrections process.**

- Patterns: Website scraping + LLM evaluation.
- Implementation:
  1. Look for `/corrections`, `/clarifications`, `/errata` URL patterns or links labeled accordingly.
  2. Scrape recent corrections published in the past 30 days.
  3. LLM evaluates whether the process is "functioning": timely (correction issued within reasonable window of original publication), transparent (original error described), proportional (severity acknowledged).
- Output: graduated score on the methodology's 4-step scale (no corrections process / corrections issued but not transparent / transparent corrections within reasonable timeframe / public corrections log) + observed correction rate per past 30 days + sample correction URLs.
- Confidence: high when corrections log is queryable; lower when only inferred from individual corrections on article pages.

**§2.2.b — Primary documents linked.**

- Patterns: Website scraping + statistical analysis.
- Implementation:
  1. Sample N recent articles from the source (default N=20; larger for noisier signals).
  2. For each article, extract all outbound links and classify each as: primary document (regulatory filing, court document, press release, dataset, academic paper, government statement) vs secondary (other news coverage, internal articles, social media).
  3. Compute ratio: articles with ≥1 primary-document link / sampled articles.
- Output: graduated score derived from the ratio + sample article URLs + classification breakdown.
- Confidence: high (ratio is observable); statistical sampling uncertainty is explicit.

**§2.3 Domain expertise (per-category aggregate).**

- Patterns: Multiple methods combined; per-category scoring per methodology §2.3.
- Implementation per category the source covers:
  1. Sustained coverage (§2.3.c): parse historical RSS or article archive to compute months of continuous coverage in the category.
  2. Specialist editors (§2.3.b): cross-reference editorial-team page with category beats; LLM verification of editorial roles per beat.
  3. Sourcing quality within the beat (§2.3.d): LLM evaluation of source attribution patterns in a sample of category-specific articles (does the source cite domain experts and primary literature, or only other news coverage?).
  4. Professional standing (§2.3.e): cross-reference reporter bylines with professional-association rosters, awards, and citations by peer outlets.
- Output: per-category sub-score + aggregate volume-weighted score for the source (per methodology §2.3 category-mix weighting rule).
- Confidence: bounded by category-mix observability and reporter-credential lookup completeness.

**§2.4 Independence — posture label assignment.**

- Patterns: Structured-data lookup + LLM evaluation + manual override flag.
- Implementation:
  1. Ownership lookup: Wikipedia / Wikidata, regulatory filings (SEC EDGAR for US public companies, Companies House for UK, equivalent for other jurisdictions where queryable), corporate-registry databases.
  2. Funding-source lookup: source's own "About" / "Funding" / "Support us" pages; Wikipedia funding section; for public broadcasters, charter or enabling-statute reference.
  3. Platform-classification cross-reference: X's state-affiliated and government-affiliated labelling as one input among several.
  4. LLM evaluation of edge cases — particularly:
     - Government posture sub-case routing per v1.1 §5.2 (charter / license-fee / charter-equivalent direct-state-funded). DW under Deutsche Welle Gesetz and France 24 under France Médias Monde are the v1.1 reference cases.
     - Corporate-owned with industry-affiliated parent per v1.1 §5.2 (CoinDesk under Bullish is the reference case).
     - State-affiliated assignment per v1.1 §5.2 indicators (state appointment of senior editorial leadership, content-guideline coordination, state-priority-topic tracking).
  5. Founder review flag: posture assignments at confidence below threshold escalate to founder per methodology §6.5.
- Output: one of 8 posture labels + reasoning trail + confidence + recommended-band placement within the posture's typical Independence range.

### 3.2 Operationalization for remaining sub-criteria

The remaining sub-criteria (approximately 20) follow the same three-pattern shape. The full operationalization table — every sub-criterion mapped to its evidence-gathering pipeline, scoring function, and confidence model — is implementation-phase work in Phase B Track 1. This spec captures the architecture; the implementation phase fills in the per-sub-criterion details.

### 3.3 Posture-specific substitutions

Per methodology v1.1 §2.1, Aggregator posture uses substituted Editorial track record sub-criteria (selection criteria documented, source-mix transparency, moderation policy, removal log, community governance). The service routes to the correct sub-criteria set based on the source's posture label.

When the creator-methodology branch ships in Phase C, additional posture-specific substitutions will apply across all five components (creator methodology will have its own component definitions, not just substitutions of publisher sub-criteria). The substitution table extension point is a service architecture concern, not just a sub-criterion concern.

---

## 4. Scoring runtime

### 4.1 Cadence

- **Weekly batch (per Decision 16).** All sources rescored or spot-checked weekly. Per methodology §7.1, revisit cadence within the batch varies by current band — Band A/B sources are revisited every 12 months, Band C/D every 9 months, Band E/F every 6 months. The weekly batch picks up sources due for revisit.
- **Triggered rescore.** Out-of-cycle rescore is triggered by:
  - Methodology version bump → selective rescore per §2.4 of affected sources.
  - Source ownership change detected (via enrichment service signal) → that source rescored.
  - Editorial leadership change detected → that source rescored.
  - Public IFCN-signatory fact-check flag on a high-impact story (per methodology §6.3) → that source rescored.
  - Editorial override registered → audit log updated; score recomputed if underlying components changed since override.

### 4.2 Execution pattern

- Runs as a scheduled Node.js task, following the existing `scheduler.js` operational pattern.
- Writes outputs to `sources` table (Migration 002 columns) within a transaction per source.
- Writes audit log to `scoring_audit_log` table (to be added in Phase B Track 1 implementation — schema in §6.4).
- Failure isolation: a single source's scoring failure (network error, malformed source metadata, LLM provider outage) logs the failure and proceeds to the next source. One bad source does not halt the batch.
- Retry policy: source failures retry up to N times within the batch window; persistent failures surface in the editorial review interface (§5).

### 4.3 Throughput targets

| Phase | Source count | Weekly batch target |
|---|---|---|
| Phase B exit | 150–300 | < 1 hour |
| Phase C exit | 300–500 | < 90 minutes |
| Phase D exit | 500–800 | < 2 hours |
| Phase E exit | 800+ | < 3 hours |

Throughput is bounded by LLM-evaluation latency more than by data fetching. Implementation should support parallelism across sources (each source's scoring is independent) and caching of stable LLM evaluations (a source's editorial-standards page interpretation doesn't change weekly).

---

## 5. Editorial override per methodology §6.5

### 5.1 Override mechanism

The founder (or future editorial advisory panel per methodology §9.4) can override any auto-computed score in either direction. An override:

- Is captured in the audit log with rationale text (required field).
- Is tagged with `override_by` (founder identity for the audit period) and `override_timestamp`.
- Overrides the auto-computed score until the next scoring run, when conflict-resolution applies (§5.2).
- Is reflected in the source's public profile per methodology §6.4 audit visibility.

### 5.2 Conflict resolution

When auto-rescoring produces a different score from a current override:

1. Override persists by default (the founder's judgment is the authoritative score until reviewed).
2. The conflict is flagged for review in the founder's next weekly review batch.
3. Founder options:
   - Accept the new auto-computed score (clear the override; audit log records override-cleared with reason).
   - Refresh the override with new rationale (audit log records override-refreshed; new auto-score absorbed into reasoning if relevant).
   - Defer (override persists, conflict re-flagged at next batch).

### 5.3 Audit visibility

All overrides visible in the audit log queryable by Layer 2 subscribers and academic researchers (per methodology §8.3). Public-facing Layer 2 source profile may optionally surface a "founder override present" indicator. The decision whether to surface this on Layer 1 is a Phase B implementation decision; the spec's position is that surfacing it preserves Decision 7's transparency commitment.

---

## 6. Service dependencies

### 6.1 Source enrichment service

This service consumes metadata produced by the source enrichment service. Without enrichment, this service falls back to:

- Website scraping directly from the source's domain (slower, less reliable, may be rate-limited).
- Manual founder input for high-priority sources via the editorial review interface.

When enrichment metadata is stale or low-confidence, the service flags the source for either enrichment refresh or founder review rather than producing a low-confidence score silently.

### 6.2 Methodology document

The service reads the methodology rubric in a structured form. Implementation phase decides whether the rubric lives as code (TypeScript / JavaScript module imported by the service) or as JSON config the service reads at startup. The methodology document remains the canonical human-readable source; the structured form is generated or maintained in parallel.

Version coherence between document and code is a Phase B Track 1 implementation requirement: a test guarantees that the structured rubric matches the document at each methodology version.

### 6.3 Sources table (Migration 002)

The service reads from and writes to `sources` table columns established in Migration 002 (commit `2c67764`): `quality_score`, `quality_score_components`, `source_posture`, `quality_score_methodology_version`, `quality_score_last_updated`. Migration 002 was designed with this service as the eventual consumer; no schema changes are required for the v1 service.

### 6.4 Audit log table (Phase B addition)

Phase B Track 1 implementation adds a `scoring_audit_log` table. Suggested schema (final design is implementation-phase work):

| Column | Type | Purpose |
|---|---|---|
| `id` | INTEGER PRIMARY KEY | Audit log row identity |
| `source_id` | INTEGER (FK to `sources.id`) | Which source this entry concerns |
| `scoring_run_id` | TEXT | Groups all per-source entries from a single batch run |
| `methodology_version` | TEXT | Methodology version applied |
| `component_scores` | TEXT (JSON) | Five component sub-scores as scored |
| `posture_label` | TEXT | One of 8 posture labels |
| `combined_score` | INTEGER | Final combined quality score |
| `reasoning_per_subcriterion` | TEXT (JSON) | Evidence + reasoning per sub-criterion |
| `confidence_per_subcriterion` | TEXT (JSON) | Confidence score per sub-criterion |
| `override_present` | INTEGER | 0/1 flag |
| `override_rationale` | TEXT | Required when `override_present = 1` |
| `created_at` | INTEGER | Unix ms timestamp |

Indexes on `source_id`, `scoring_run_id`, `created_at` for query patterns (per-source history, per-run inspection, time-range queries).

Retention policy TBD in Phase B implementation. The audit log will grow unbounded over weekly batch cycles; Phase B Track 1 implementation must specify retention (e.g., archive entries older than N months, keep summary statistics only, full retention for sources with active overrides).

---

## 7. Honest limitations

### 7.1 Rubric-as-code is an approximation

The methodology rubric is human editorial judgment encoded. Translating it into code introduces approximation. Some sub-criteria are intrinsically hard to automate — methodology §2.5.c ("behaviour during recent high-pressure news events") needs a curated reference-event set the service does not yet possess. The implementation phase must either build the reference-event set or fall back to founder-input for that sub-criterion.

### 7.2 Source metadata quality bounds service quality

The service is upper-bounded by source enrichment service quality. If enrichment fails to find a source's corrections page, the service falls back to "no corrections page observed" — which may underscore a source that does have a corrections process the enrichment service missed. The audit log preserves this as a confidence signal so founder review can correct missed enrichment.

### 7.3 LLM evaluation is non-deterministic

Sub-criteria requiring LLM judgment produce slightly different scores across runs. The service mitigates this by:

- Running multiple LLM evaluations per sub-criterion and aggregating (mean / median / consensus).
- Storing confidence scores per evaluation.
- Flagging sources for founder review when confidence is low or when scoring volatility across runs is high.

Decision 7's "weights are proprietary" principle covers the aggregation function; the underlying per-evaluation outputs are inputs to the audit log.

### 7.4 Methodology version drift across the corpus

Sources scored at different methodology versions occupy slightly different score-space. The service maintains `quality_score_methodology_version` per source to preserve interpretability. Per methodology §7.2, when a major-version bump happens, side-by-side score reporting persists for a 90-day transition window so external citations and prior published material remain interpretable. The v1.0 calibration document (`docs/audits/phase_a_source_audit_phase2_calibration.md`) is preserved as the v1.0 validation artifact and is not rescored under v1.1 — per the session 27 + 28.A decisions, the next calibration runs when this service first produces v1.1 corpus-wide scores.

### 7.5 The service is bounded by what is observable

Sources that publish in languages our enrichment and LLM-evaluation tools handle well are scored more reliably than sources in less-supported languages. This is the same limitation documented in methodology §9.4. The service's confidence reporting should make this bias visible per source rather than producing low-confidence scores that look high-confidence.

---

## 8. Phase B Track 1 implementation scope

### 8.1 v1 implementation scope (Phase B)

- Publisher methodology v1.1 only (creator branch declared per §2.5 but not implemented).
- Approximately 25 sub-criteria operationalized per the three-pattern shape in §3.
- Weekly batch cadence per §4.1.
- Triggered rescore per §4.1 (methodology bump, ownership change, fact-check flag, override registration).
- Founder override mechanism per §5.
- Audit log persistence per §6.4.
- Validation harness: the service must reproduce the 15-source v1.0 calibration scores (`docs/audits/phase_a_source_audit_phase2_calibration.md` §2) within ±5 points per source on methodology v1.0 before being trusted on the remaining corpus. Validation failure modes: (1) if service scores diverge beyond ±5 points in directions matching the methodology v1.1 hypothesized deltas captured in the methodology Changelog (Hacker News +5 to +12 points; minimal change for others), validation passes — the divergence is intentional per v1.1 refinements; (2) if service scores produce unpredicted divergence (e.g., BBC News drops 10 points or CoinDesk rises 15 points), validation fails and requires investigation before Phase B Track 1 implementation ships to production.

### 8.2 v2+ enhancements (Phase C and beyond)

- Creator methodology branch (per finding #86): host / channel credibility, guest credibility, per-episode composite for interview-format content.
- Per-episode scoring shape (three-output rather than one-output per source).
- Guest credibility database (guest scored once, reused across appearances).
- Three-layer composite scoring (host × guest × episode) per finding #86 architectural artifact.

### 8.3 Out of scope for this service entirely

- Article-level scoring (Reality Index function per Strategic Plan v6 Capability 3).
- Per-event source-credibility weighting in event dossiers (Capability 2 function).
- Public methodology authorship (the human-readable methodology document is maintained by the founder; the service consumes it).

---

## 9. Related documents

- **[Source Credibility Methodology v1.1](../content/source_credibility_methodology.md)** — the rubric this service applies.
- **[Phase A Source Audit Phase 2 Calibration](../audits/phase_a_source_audit_phase2_calibration.md)** — the v1.0 ground-truth dataset the service must reproduce on validation.
- **[Strategic Plan v6.0](../strategy/strategic_plan_v6.md)** — §3 Capability 1 source matrix; §9 Phase B exit criteria.
- **[Decisions Log v1.0](../strategy/decisions_log_v1.md)** — Decision 7 (open methodology + proprietary weights); Decision 16 (source onboarding workflow + weekly batch cadence).
- **[Phase A Retrospective Inputs](../phases/phase_a_retrospective_inputs.md)** — findings #85 (architectural reframing) and #86 (creator methodology scope gap) — the institutional context that produced this spec.
- **Migration 002:** `backend/src/db/migrations/002_sources_table.js` — the table schema this service reads from and writes to.

---

## Changelog

**v1.0 — May 17, 2026.** Initial spec. Architecture captured for Phase B Track 1 implementation. Methodology v1.1 baseline. Publisher methodology branch detailed; creator methodology slot reserved for Phase C per finding #86. Validation harness defined against the v1.0 15-source calibration.
