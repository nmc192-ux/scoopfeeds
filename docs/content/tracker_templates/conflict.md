# Tracker Template — Conflict

**Signal type:** `conflict`
**Status:** draft v0.1 — Sprint 1.1.1 deliverable
**Pairs with:** `outbreak.md` (parallel structure)

> This is a markdown specification of what a *conflict* tracker captures and
> displays. It is **not** a schema or code artifact — schema follows in
> Sprint 1.2 once the full template pattern (8 templates) has been reviewed.

---

## 1. Purpose + Trigger

**Purpose.** A conflict tracker quantifies an ongoing armed-conflict event
so a reader can see *what is happening, at what scale, with what confidence*
without having to stitch together 12 dispatches across 3 weeks.

**Trigger.** Auto-detected when:
- Articles in `politics` or `international` clusters surface ≥ 3 distinct
  events tagged with ACLED-style categories (battles, explosions, violence
  against civilians) for the same geographic locus within 14 days, **OR**
- A new sustained-fire incident attracts ≥ 5 wire dispatches within 72h,
  **OR**
- Editorial seed (DrJ flags an emergent conflict — Sudan-style situations
  where international wire coverage lags ground reality).

---

## 2. Core Metrics

Each metric below carries three fields per the Option-3 confidence pattern:
**headline value + confidence flag + source attribution.**

Confidence vocabulary (conflict-specific):
- **provisional** — single-source, breaking-news dispatches, social-media
  reports not yet corroborated. Most early figures.
- **disputed** — parties to the conflict give materially different numbers
  (e.g., attacker-claimed vs defender-claimed casualties). Both numbers
  shown side-by-side, not averaged.
- **confirmed** — ACLED-coded, independently corroborated by ≥ 2 major
  international wires, or appearing in an official UN OCHA situation report.

Metrics tracked:

1. **Casualties (killed)** — integer; confidence; source.
2. **Casualties (wounded)** — integer; confidence; source.
3. **Casualties (missing)** — integer; confidence; source. Often the most
   provisional figure; flag explicitly when reported.
4. **Displaced population (IDPs + refugees)** — integer + breakdown;
   confidence; UN OCHA or UNHCR-attributed if available.
5. **Event count** — count of distinct ACLED-coded events in tracker
   window (battles / explosions / violence-against-civilians split).
6. **Geographic scope** — list of affected administrative regions
   (country → region/oblast/governorate granularity).
7. **Escalation indicator** — qualitative (e.g., "ceasefire holding",
   "renewed offensive", "new front opened"); confidence; editorial source.

Casualty figures should **never** be averaged across party-issued
discrepancies. When parties disagree, display both with `disputed` flag.

---

## 3. Data Sources

Primary (academic / institutional):
- **ACLED** (Armed Conflict Location & Event Data Project) — peer-validated
  event database. Lags real-time by ~7 days but is the gold standard for
  event verification.
- **UN OCHA** — humanitarian impact, displacement figures, situation reports.
- **UNHCR** — refugee and IDP numbers.
- **GDELT** — automated event extraction from global news. High recall, lower
  precision than ACLED; useful for early signals.

Secondary (corroboration):
- Major international wires (Reuters, AP, AFP).
- National governments and military communiques — treated as
  **primary-source-but-self-interested**: include figures, attribute clearly,
  flag as `disputed` when peer party gives contrary number.
- Specialist outlets per conflict (e.g., Institute for the Study of War,
  Crisis Group reports).

Excluded by default:
- Social-media-only signals without wire pickup (too noisy for headline
  figures; may inform `provisional` early-warning entries).
- Single-belligerent press releases without independent corroboration.

---

## 4. Update Cadence

- **Active phase** (recent events within trailing 7 days): metrics re-checked
  daily; provisional figures upgraded to confirmed as ACLED catches up.
- **Smoldering phase** (no new events 7–30 days): weekly check; no display
  changes unless escalation.
- **Major-escalation triggers** (single strike with ≥ 50 casualties,
  ceasefire announcement, new belligerent entry): immediate update,
  flagged as `breaking` on display.
- **Closeout candidate**: 30 consecutive days no ACLED-coded events; goes
  to editorial review for "conflict ended" vs "conflict frozen" classification.

---

## 5. Display Considerations

**Layer 1 — Homepage / category card.**
Compact widget showing:
- Tracker title (e.g., "Sudan civil war").
- Single headline figure (typically confirmed-killed count).
- Confidence flag visible next to figure.
- Last-updated timestamp.
- One-line escalation indicator.

The Layer 1 card optimizes for *scannability*; readers should grasp scale and
recency in under 2 seconds.

**Layer 2 — Full tracker page.**
Expanded view showing:
- All seven metrics from §2 with their confidence flags and source attribution.
- Time-series chart (event count and casualties over tracker lifetime).
- Geographic map where applicable (regions affected highlighted; not
  point-precision plotting — that misrepresents data granularity).
- Source-attribution panel listing data sources and last-pulled timestamps.
- Dispute panel: when figures are `disputed`, show all party-attributed
  numbers side-by-side with attribution.
- Related-articles list (articles that fed the tracker).

Both layers must surface the confidence flag prominently; a confirmed-killed
count alongside provisional-wounded count is a common pattern that requires
visual differentiation, not a single "trust this figure" gloss.

---

## 6. Validation Source

**Authoritative.** ACLED is the validation source for event existence and
classification. A figure that fails ACLED corroboration after the ~7-day lag
stays at `provisional` indefinitely with a "ACLED-unconfirmed" note.

**Cross-reference.** UN OCHA situation reports validate displacement and
humanitarian figures. Country-specific UN missions (UNAMA, MONUSCO, UNMISS)
add granularity where they operate.

**Editorial override.** DrJ may set confidence manually for any metric when
domain knowledge contradicts automated classification (e.g., known
under-reporting in a region). Override action is logged, not silently applied.

---

## 7. Open Questions / Limitations

These are intentionally captured as prose so Sprint 1.2 (data model) can
absorb them into schema decisions, not pre-resolved here.

- **Party-figure dispute resolution.** Current proposal is "show both, flag
  `disputed`". Alternative: pick the higher figure as headline (more
  conservative for human impact), show both in Layer 2. DrJ to decide.
- **ACLED lag handling.** ~7-day lag means tracker freshness vs verification
  trade-off. Current proposal: show provisional figures during lag window
  with explicit "ACLED-confirmation pending" badge. Acceptable?
- **Geographic granularity.** Country / region / district — district-level
  often unavailable for casualty data. Default to coarsest reliable level
  per metric.
- **Multi-front conflicts.** Ukraine has multiple distinct fronts (Donbas,
  Kherson, etc.) with separate event series. One tracker or many?
- **Tracker closeout criteria.** 30-day-no-events is a draft heuristic;
  ceasefires that hold often see no events for 30+ days while remaining
  alive politically. Editorial close-out preferable?
- **Casualty inflation in long conflicts.** Cumulative figures over years
  become hard to update reliably (Syria, Yemen). Tracker may need a
  "cumulative-since-date" framing rather than running total.
- **Civilian vs combatant breakdown.** Often unreported or contested. Capture
  when available; do not impute when absent.
- **Concurrent active conflicts.** No mechanism here for editorial
  prioritization across multiple active conflict trackers — Sprint 1.5
  (frontend) decides display ordering.
- **Internal-conflict vs interstate distinction.** Both fit this template;
  metric semantics may differ (e.g., "displaced" includes refugees only
  when crossing borders, IDPs only when internal). Tracker entry should
  carry an explicit `conflict_type` field — defer to Sprint 1.2 schema.
