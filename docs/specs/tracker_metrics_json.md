# Tracker Metrics JSON — Canonical Block Spec

**Spec type:** Data-contract specification
**Owner:** Phase B Sprint 1.2 (data layer) + Sprint 1.3+ (detection / scheduler / frontend)
**Status:** v1.0 — Sprint 1.2 deliverable
**Implements:** `tracker_instances.metrics`, `tracker_instances.template_meta`, `tracker_instances.data_source_provenance`, and the validation surface in `backend/src/models/trackers.js`
**Derived from:** the 8 markdown templates at `docs/content/tracker_templates/` (Sprint 1.1 + 1.1.3)

> This spec is the **binding contract** that Sprint 1.3 (detection engine), Sprint 1.4 (scheduler) and Sprint 1.5 (frontend) write against. DAO-layer validation in `backend/src/models/trackers.js` enforces it; SQL only enforces the envelope.

---

## 1. The shared metric-block shape

Every entry in `tracker_instances.metrics` is keyed by a **metric_name** (string, per-template, see §2). Each value is a **block** object. The minimum required block shape — the Option-3 confidence pattern locked across all 8 templates — is:

```
{
  "value":      <any>,            // required. Integer / float / string / array / object per metric.
  "confidence": <string>,         // required. Must be in the template's confidence vocabulary (§2).
  "source":     <string|null>,    // optional but strongly recommended. Attribution string.
  "as_of":      <integer|null>    // optional. ms-epoch when this value was last verified.
}
```

Additional fields are **permitted** beyond the minimum; the validator does not reject extra keys. Per-template special-case fields are listed in §3.

DAO validation (per locked decision 1) enforces:
- `metrics` is parseable JSON object (not array, not scalar).
- Each `metric_name` belongs to the template's allowed set (§2).
- Each block has `value` and `confidence`.
- `confidence` value is in the template's vocabulary (§2).

The validator does **not** type-check `value` against the metric's expected payload (integer vs string vs array) — that level of conformance lives in the detection engine (Sprint 1.3) and any future per-template DTO. The DAO surface is deliberately schema-shaped, not semantics-shaped.

---

## 2. Per-template metric names + confidence vocabulary

| template_type | Allowed `metric_name` set | Confidence vocabulary |
|---|---|---|
| **conflict** | `casualties_killed`, `casualties_wounded`, `casualties_missing`, `displaced`, `event_count`, `geographic_scope`, `escalation` | `provisional`, `disputed`, `confirmed` |
| **outbreak** | `suspected_cases`, `probable_cases`, `confirmed_cases`, `deaths`, `cfr`, `geographic_extent`, `r0_rt`, `who_designation`, `testing_intensity` | `suspected`, `probable`, `confirmed` |
| **incident** | `casualties_killed`, `casualties_injured`, `casualties_missing`, `people_affected`, `cause_attribution`, `economic_damage`, `response_status` | `preliminary`, `investigating`, `official-finding` |
| **sports** | `score`, `standings`, `series_state`, `key_stats`, `fixture_schedule`, `context`, `milestones` | `scheduled`, `live`, `final` |
| **environmental** | `magnitude_intensity`, `affected_area`, `affected_population`, `casualties`, `damage_estimate`, `alert_level`, `hazard_chain` | `preliminary-reading`, `revised`, `confirmed` |
| **election** | `votes_by_contestant`, `seats`, `turnout`, `count_completion_pct`, `race_called_by`, `provisional_final_flag`, `recount_dispute` | `projected`, `partial-count`, `certified-official` |
| **entertainment** | `box_office_opening`, `box_office_cumulative`, `worldwide_total`, `budget`, `critical_reception`, `audience_reception`, `awards_milestones` | `estimated`, `studio-reported`, `final-actuals` |
| **study** | `finding_summary`, `study_type`, `sample_size`, `effect_size`, `peer_review_status`, `replication_status`, `coi` | `preprint`, `peer-reviewed`, `replicated-or-consensus` |

The confidence vocabularies are **deliberately heterogeneous** — each template's vocabulary reflects the epistemic shape of its domain. Per §2 of each template, no cross-template confidence mapping is meaningful (a `confirmed` outbreak case-count is not the same epistemic posture as a `confirmed` conflict casualty figure; a `final` sports score is not in the same epistemic shape as either).

---

## 3. Special-case block variants

Five patterns extend the minimum block shape for specific metrics. The DAO validator does **not** require these extensions (per §1) — they are documentation discipline for the detection engine (Sprint 1.3) writing the blocks.

### 3.1 Disputed party-figures (conflict)

When `template_type='conflict'` and `confidence='disputed'`, casualty figures from multiple parties must be preserved per-party (never averaged):

```
{
  "value":      null,                              // or omitted; the headline-figure choice is editorial
  "confidence": "disputed",
  "parties": [
    { "party": "<attribution>", "value": <int>, "source": "<src>" },
    ...
  ]
}
```

The `parties` array is required for `disputed` conflict casualty metrics. Layer 2 display shows all party-attributed values side-by-side per `conflict.md` §5.

### 3.2 Per-hazard scale (environmental)

The `magnitude_intensity` metric carries a `scale` qualifier identifying which hazard scale the value is on. Cross-hazard "severity" synthesis is forbidden per `environmental.md` §2.

```
{
  "value":      7.2,
  "confidence": "revised",
  "source":     "USGS",
  "as_of":      <ms>,
  "scale":      "Mw"   // one of: Mw, Richter, Saffir-Simpson, EF, VEI, NWS-flood-stage, fire-weather-index
}
```

### 3.3 Relay-only fields (outbreak)

The `cfr` and `r0_rt` metrics are **relay-only** per `outbreak.md` §2 (DrJ MPH ruling — never Scoopfeeds-computed). Block carries a `derived: false` marker and a required `date` for the official-source attribution:

```
{
  "value":      "X%",
  "confidence": "confirmed",
  "source":     "WHO",
  "date":       "<YYYY-MM-DD>",     // publication date of the official figure
  "as_of":      <ms>,
  "derived":    false               // discipline marker — must remain false; ingestion never computes
}
```

If no official body has published a figure, the metric is **absent from `metrics`** entirely (not present-with-null). Absence is the signal that no relay exists.

### 3.4 Evidence-quality badge (study)

Per `study.md` §5 DrJ ruling (GRADE + Consensus convention), study trackers carry a compound `evidence_badge`.

**Important — derived, not source of truth.** The badge is a **derived display structure** computed at render time (Sprint 1.5) from the underlying study metrics: `study_type` + `sample_size` + `peer_review_status` (→ `tier`) + a hierarchy lookup. v1.2 permits storing it in `template_meta` as a **cached snapshot** for convenience, but treat it as cache, not authority. The metric values are the source of truth; Sprint 1.5 should re-derive the badge at render to avoid drift when the underlying metrics revise (a preprint that gets peer-reviewed needs the badge re-computed, not stale).

The badge structure (when cached or freshly derived):

```
{
  "tier":           <one of study's confidence vocab>,
  "study_type":     <one of: RCT, observational-cohort, observational-case-control,
                            cross-sectional, case-series, case-report, in-vitro,
                            animal-model, computational-modeling, systematic-review,
                            meta-analysis>,
  "sample_size":    <integer>,
  "hierarchy_rank": <integer 1..10>   // drives Layer 1 color: 1=weak (red end), 10=strong (green end)
}
```

`hierarchy_rank` is the dominant honesty signal; recommended scoring:
1 = single case-report; 2 = case-series; 3 = in-vitro / animal preprint; 4 = preprint observational;
5 = observational case-control peer-reviewed; 6 = observational-cohort peer-reviewed; 7 = single RCT;
8 = multi-site RCT; 9 = systematic review; 10 = meta-analysis or formal consensus statement.

### 3.5 Companion-field invariant (election)

Per `election.md` §2: any vote/seat/turnout metric at `confidence='partial-count'` must be accompanied by a non-null `count_completion_pct` metric in the same `metrics` object. The DAO validator surfaces missing-companion as a warning; the detection engine (Sprint 1.3) is responsible for enforcement on writes.

---

## 4. `template_meta` allowed fields per template_type

`template_meta` holds tracker-level qualifiers that are **not metrics** — they typically don't change over the tracker lifetime and don't carry confidence flags. JSON object; per-template allowed keys:

| template_type | Allowed `template_meta` keys |
|---|---|
| **conflict** | `conflict_type` (interstate / civil / mixed), `primary_belligerents` |
| **outbreak** | `pathogen`, `who_disease_category`, `case_definition_version` |
| **incident** | `mode` (aviation / maritime / industrial / rail), `validating_authority` (NTSB / ICAO / IMO / FRA / national-equivalent), `operator` |
| **sports** | `fixture_kind` (match / series / tournament / standings-snapshot), `league`, `sport` |
| **environmental** | `hazard_kind` (earthquake / cyclone / flood / wildfire / volcanic / tornado), `primary_agency` (USGS / NHC / NWS / national-agency) |
| **election** | `electoral_system` (FPTP / party-list-PR / MMP / ranked-choice / two-round-runoff / referendum), `jurisdiction`, `office`, `election_date` |
| **entertainment** | `title_kind` (theatrical-release / streaming-release / series-arc / awards-event), `title`, `studio_or_platform` |
| **study** | `evidence_badge` (per §3.4 — **derived display structure, cached snapshot only**; metric values remain the source of truth, Sprint 1.5 re-derives at render), `doi`, `pubmed_id`, `venue` |

The DAO validator does not enforce `template_meta` key constraints in v1 (low-cost extension for v2). Sprint 1.3 ingestion is responsible for filling these consistently.

---

## 5. `data_source_provenance`

`data_source_provenance` is an optional JSON object recording **per-metric** provenance details that don't fit cleanly in the block's `source` string. Primary use: surfacing the ingester-gap status documented in `election.md` and `study.md` headers.

> **Shape stability.** v1.2 leaves this field **intentionally freeform JSON**. The illustrative shape below is a *recommendation*, not a contract — the DAO does not validate keys here. Sprint 1.3 (detection engine) will formalize the schema once real ingesters exist and the actual provenance fields stabilize from observation. v1.2 loose; v1.3 will lock.

```
{
  "<metric_name>": {
    "ingester_status": "live" | "wire-aggregation-only" | "editorial-seed-only",
    "ingester_gap_note": "<free text — optional>",
    "last_pulled_at":    <ms>
  }
}
```

Election + study trackers carry `ingester_status: "wire-aggregation-only"` until per-source ingesters (electoral-commission feeds, PubMed / bioRxiv / Crossref) land in future Track 1 source-onboarding work.

---

## 6. Reserved + extension rules

### 6.1 Adding a new metric to an existing template

1. Edit the template's `docs/content/tracker_templates/<template>.md` to document the new metric in §2 with its confidence and source attribution discipline.
2. Add the metric name to the template's row in §2 of this spec.
3. Add it to `METRIC_NAMES_BY_TEMPLATE` in `backend/src/models/trackers.js`.
4. No migration required (metrics live in JSON).

### 6.2 Adding a new template (a 9th tracker type)

Substantially heavier per locked decision 5:

1. Author the new template at `docs/content/tracker_templates/<new>.md` following the 7-section structure.
2. Add to §2 of this spec.
3. Add to `TEMPLATE_TYPES` and the per-template constants in `backend/src/models/trackers.js`.
4. **Migration required** to update the `template_type` CHECK constraint on `tracker_instances`. Migrations are forward-only; the constraint change requires CREATE-new-table + INSERT-from-old + DROP-old pattern (SQLite limitation).

The migration cost is the deliberate friction that makes "add a new template" a real decision, not a casual add.

### 6.3 Reserved keys

- `parties`, `scale`, `derived`, `date` — reserved per §3 for the special-case patterns. Detection engine (Sprint 1.3) must honor these semantics; ingestion writes must not re-use these keys for unrelated purposes.
- `hierarchy_rank` reserved for the study evidence-badge.

---

## 7. Sprint 1.3 contract note

Sprint 1.3 (detection engine) writes against this spec via the DAO at `backend/src/models/trackers.js`. The detection engine is responsible for:

- Producing `metrics` blocks that conform to this spec.
- Filling `template_meta` per §4.
- Setting `data_source_provenance` per §5 when ingester gaps apply.
- Calling `updateTrackerMetrics(id, updates, reason, ...)` with a documented `reason` from the 6-value vocabulary (`ingestion-update`, `source-revision`, `editorial-override`, `retraction`, `recount`, `closeout`).

The DAO surface is the stable boundary; this spec defines the data shape that crosses it.

---

## Changelog

**v1.0 — Phase B Sprint 1.2.** Initial spec derived from the 8 Sprint 1.1 templates. 8 metric_name sets + 8 confidence vocabularies tabulated. 5 special-case block variants captured. template_meta + data_source_provenance scope defined. Extension rules locked. DAO-layer validation contract specified.
