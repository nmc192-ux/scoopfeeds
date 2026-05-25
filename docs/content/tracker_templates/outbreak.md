# Tracker Template — Outbreak

**Signal type:** `outbreak`
**Status:** draft v0.1 — Sprint 1.1.1 deliverable
**Pairs with:** `conflict.md` (parallel structure)

> This is a markdown specification of what an *outbreak* tracker captures and
> displays. It is **not** a schema or code artifact — schema follows in
> Sprint 1.2 once the full template pattern (8 templates) has been reviewed.

> **Reviewer note.** Confidence vocabulary and validation conventions in this
> template follow WHO outbreak-surveillance terminology (case definitions and
> verification levels). Epidemiological soundness deserves DrJ's specific
> MPH-level review.

---

## 1. Purpose + Trigger

**Purpose.** An outbreak tracker quantifies an active epidemic / outbreak
event using WHO-compatible case classifications, so a reader can see *case
count, geographic extent, and verification level* without being misled by
early-outbreak figure volatility.

**Trigger.** Auto-detected when:
- Articles in `medicine` / `public-health` / `health` clusters surface ≥ 3
  distinct dispatches naming the same pathogen + same geographic locus
  within 14 days, **OR**
- A WHO Disease Outbreak News (DON) entry is published for a pathogen
  not currently tracked, **OR**
- ProMED-mail surfaces a sustained signal (≥ 2 posts) for a novel cluster,
  **OR**
- Editorial seed (DrJ flags an emergent outbreak — early signals where
  WHO/CDC channels lag the regional health-agency reporting).

---

## 2. Core Metrics

Each metric below carries three fields per the Option-3 confidence pattern:
**headline value + confidence flag + source attribution.**

Confidence vocabulary follows WHO case-definition surveillance conventions:
- **suspected** — clinical presentation consistent with the case definition;
  no laboratory confirmation yet. Highest count, lowest specificity.
- **probable** — meets clinical criteria *plus* an epidemiological link
  (known contact, travel history to affected area, vaccination status).
- **confirmed** — laboratory-verified per WHO / CDC criteria for the
  specific pathogen (PCR, culture, serology depending on disease).

Unlike conflict casualties, the three confidence tiers here are **not**
alternate views of one figure — they are **distinct case counts**. All
three should display; do not collapse to a single "case count" headline
without showing the breakdown on Layer 2.

Metrics tracked:

1. **Suspected cases** — integer; source; case-definition used (versions
   change as pathogen characterization improves).
2. **Probable cases** — integer; source.
3. **Confirmed cases** — integer; source; lab-confirmation method.
4. **Deaths** — integer; confidence tier; source. Deaths are tier-flagged
   the same way (lab-confirmed-death vs probable-attribution).
5. **Case-fatality rate (CFR)** — **relay-only, never self-computed.**
   Scoopfeeds does **not** compute CFR from its own deaths÷confirmed
   arithmetic. Live CFR computation is structurally misleading: deaths
   lag infections (inflates early), and mild-case under-ascertainment
   distorts the denominator (deflates later as testing expands). Caveats
   attached to a computed figure are routinely lost when the figure is
   screenshotted or republished. Display rule: CFR is shown **only** when
   an official body (WHO, CDC, national health agency) has published a
   CFR estimate; the figure is then surfaced as an attributed relay
   (e.g., "WHO estimates CFR at X%, [date]"). When no official CFR has
   been published, display deaths and confirmed cases as separate
   figures and surface no ratio of any kind.
6. **Geographic extent** — countries and (where available) sub-national
   regions affected; WHO region classification where applicable.
7. **Reproductive number (R₀ / Rₜ)** — **relay-only, official sources
   only.** Surface R₀ or Rₜ **only** when an official body (WHO, CDC,
   national health agency) has published an estimate; always cite source
   and date. Modeling preprints, academic-group estimates, and
   internally-computed values are **not** relayed regardless of
   plausibility. Rₜ is one of the most-misread epidemiological figures
   (readers interpret point estimates as precise, ignore confidence
   intervals, and conflate R₀ with Rₜ), which justifies the conservative
   posture.
8. **WHO designation** — current level: routine surveillance / DON
   notification / Public Health Emergency of International Concern
   (PHEIC). Designation drives display urgency.
9. **Testing / surveillance intensity** — **Layer 2 only, not a headline
   metric.** Tests performed and/or test-positivity rate where available;
   source. Rationale: confirmed-case counts are uninterpretable without
   a testing denominator — 500 confirmed cases from 600 tests performed
   is a fundamentally different signal from 500 confirmed cases from
   60,000 tests performed. Per-outbreak testing data is often unavailable
   (especially in low-resource settings and for rare-pathogen outbreaks);
   capture when published, caveat explicitly when absent. Explicitly
   excluded from Layer 1 cards because the figure requires context to
   read responsibly and headline real-estate is hostile to caveats.

---

## 3. Data Sources

Primary (authoritative):
- **WHO Disease Outbreak News (DONs)** — official international outbreak
  notifications. Authoritative for cross-border outbreaks.
- **WHO situation reports** — for sustained outbreaks, weekly or more
  frequent structured updates.
- **National health agencies** — CDC (US), ECDC (EU), national equivalents
  (NDMA, NICD, etc.). Authoritative for in-country case counts.
- **ProMED-mail** — moderated physician-network early-warning system. High
  signal for early outbreaks, often days ahead of official channels.

Secondary (corroboration / characterization):
- Peer-reviewed clinical and epidemiological literature (NEJM, Lancet, MMWR)
  for pathogen characterization, vaccine efficacy, sequencing.
- Reuters Health, AP Health desks for wire coverage.

Excluded by default:
- Social-media-only signals without health-agency or wire pickup.
- Government claims contradicted by WHO field assessments — flag and
  attribute, do not adopt as headline.
- Modeling preprints not yet peer-reviewed, unless explicitly framed as
  modeling estimate (not measurement).

---

## 4. Update Cadence

- **PHEIC-declared outbreaks**: daily check; metrics re-pulled at least
  every 24h.
- **Active DON-listed outbreaks**: every 48–72h or per WHO update rhythm.
- **ProMED-only / early-warning** outbreaks (no formal WHO designation
  yet): daily check during emergence; downgrade to weekly if quiescent.
- **Major-event triggers** (PHEIC declaration / lifting, new country
  involvement, novel variant identified, vaccine campaign launch):
  immediate update flagged `breaking`.
- **Endemic transition**: when an outbreak becomes endemic (e.g., mpox
  clade in established geographies, cholera in Yemen), tracker either
  closes out or transitions to long-running "burden tracker" framing —
  editorial decision per outbreak. Defer mechanism to Sprint 1.2.

---

## 5. Display Considerations

**Layer 1 — Homepage / category card.**
Compact widget showing:
- Tracker title (e.g., "Marburg outbreak — Equatorial Guinea").
- Confirmed-case count as the headline figure (conservative choice — do not
  surface suspected count alone as headline, as it overstates verified
  burden).
- WHO designation badge (DON / PHEIC / monitoring).
- Last-updated timestamp.
- Affected-countries count or comma-list (≤ 3 countries).

Layer 1 deliberately under-states scale by using confirmed-only — readers
clicking through see the fuller suspected/probable/confirmed breakdown on
Layer 2. This trade-off is intentional: early-outbreak suspected counts
are often 5-10× the eventual confirmed count, and putting a suspected
figure on the homepage card invites misinterpretation.

**Layer 2 — Full tracker page.**
Expanded view showing:
- All three case-count tiers (suspected / probable / confirmed) side by side
  with case-definition version notes.
- Deaths broken down by confidence tier.
- CFR display per §2 metric 5: show the official CFR figure with source
  and date attribution if one has been published; otherwise show deaths
  and confirmed cases as separate figures and surface no ratio. Never
  Scoopfeeds-computed.
- Testing / surveillance-intensity panel per §2 metric 9: tests performed
  and/or test-positivity rate when published, with source. Shown here
  (Layer 2) and never on Layer 1 cards.
- Geographic map (countries/regions affected; WHO region overlay where
  applicable).
- Time-series chart: confirmed cases by date (epidemic curve). Suspected
  often shown as faded series behind confirmed.
- Source-attribution panel (WHO / national agency / ProMED) with last-pulled
  timestamps per source.
- Pathogen-characterization panel — incubation period, vaccine availability,
  variant landscape. Rₜ / R₀ shown only when an official body has published
  an estimate, cited and dated (no modeling-preprint relay). All figures
  here are explicitly versioned, as pathogen characterization refines over
  weeks.
- Related-articles list.

---

## 6. Validation Source

**Authoritative.** WHO DONs and WHO situation reports are the validation
source for international outbreaks. A figure surfaced by wires that does
not appear in the next WHO update is downgraded from `confirmed` to
`probable` (and noted as such on the tracker).

**Cross-reference.** National health agencies are authoritative for
in-country counts (CDC for US, ECDC for EU, etc.). When WHO and national
agency counts diverge, show both — divergence is itself a story.

**Lab-confirmation status.** `confirmed` tier requires explicit
lab-confirmation method per WHO case definition (e.g., PCR for novel
respiratory virus, sequencing for novel variants). The method is captured
as part of the source attribution.

**Editorial override.** DrJ may set tier classification manually when
domain knowledge contradicts automated classification (e.g., known
under-testing in a region inflating "suspected" relative to true
incidence). Override action is logged, not silently applied.

---

## 7. Open Questions / Limitations

Captured as prose so Sprint 1.2 (schema) can absorb them, not pre-resolved.

- **Surveillance bias.** Low-resource settings under-report systematically;
  confirmed counts there understate true burden, while suspected counts
  may either understate (no presentation to clinic) or overstate (broad
  syndromic surveillance casting a wide net). Should we add a
  `surveillance-quality` flag per geography, or treat as caveat-only?
- **CFR display rule — RESOLVED (DrJ MPH).** The earlier draft proposed
  a computational threshold (4 weeks + > 100 confirmed cases). The
  resolution is stricter: Scoopfeeds **never** self-computes CFR. CFR
  is displayed only as a relayed figure when an official body (WHO /
  CDC / national health agency) has published one, with explicit source
  and date attribution. When no official CFR exists, deaths and
  confirmed cases display as separate figures with no ratio surfaced.
  Schema implication for Sprint 1.2: CFR is an **attributed-relayed**
  field (value + source + date + as-of), not a computed field — i.e.
  it cannot be derived from other tracker fields, only ingested.
- **Endemic / outbreak transition.** No clean trigger for "outbreak ended
  and became endemic" (cholera in Yemen, mpox in MSM networks in some
  geographies). Risks tracker staying open indefinitely. Editorial-driven
  closeout for now; consider quantitative trigger in v2.
- **Case-definition versioning.** Case definitions evolve during outbreaks
  as the pathogen is characterized — early COVID-19 definitions changed
  multiple times in weeks. Tracker needs to record which case-definition
  version is in force for each historical figure, otherwise the time
  series misleads.
- **Vaccine campaign tracking.** When a vaccine campaign launches mid-outbreak,
  is it a separate tracker entity or an integrated panel on this one?
  Lean integrated (avoids fragmentation), but Sprint 1.5 (frontend) calls.
- **Pathogen characterization metrics drift.** R₀ estimates published in
  week 2 are often revised significantly by week 8. The relay-only-official
  posture (see §2 metric 7) **reduces** this problem — we only ever
  surface figures already vetted by WHO / CDC / national agencies — but
  does not eliminate it, since official bodies themselves revise estimates
  as evidence accumulates. Display rule: show most-recent official
  estimate with source and publication date; do not retro-edit historical
  article references that quoted earlier official values.
- **Outbreak vs epidemic vs pandemic.** Often used loosely in coverage.
  Tracker should default to *outbreak* terminology unless WHO uses
  *epidemic* or *pandemic* formally. Don't lead a story's terminology.
- **Multi-pathogen co-circulation.** During seasonal periods, multiple
  pathogens co-circulate (e.g., flu + RSV + COVID). One tracker per
  pathogen or a combined respiratory-illness tracker? Lean one-per-pathogen
  for clarity; defer to Sprint 1.5.
- **Animal-reservoir / zoonotic signal.** Many outbreaks (avian flu,
  Nipah, Marburg) have animal-reservoir signals that precede human
  cases. Capture as a separate `pre-spillover` tier, or use existing
  `suspected` semantics? Lean separate tier — different epistemics.
- **Antimicrobial-resistance integration.** AMR is a slow-burn outbreak-like
  phenomenon that doesn't fit acute-outbreak framing. Likely needs its
  own template variant rather than overloading this one. Defer to
  template-set v2.
- **Sequencing / variant tracking.** For viral outbreaks, variant
  identification (via GISAID etc.) is increasingly central. Integrated
  panel here or separate `variant` tracker? Defer to Sprint 1.5.
