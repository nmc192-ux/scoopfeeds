# Tracker Template — Incident

**Signal type:** `incident`
**Status:** draft v0.1 — Sprint 1.1.3 deliverable
**Pairs with:** `conflict.md` / `outbreak.md` / `environmental.md` (parallel 7-section structure)

> This is a markdown specification of what an *incident* tracker captures and
> displays for aviation / maritime / industrial / rail accidents and
> disasters. It is **not** a schema or code artifact — schema follows in
> Sprint 1.2 once all 8 templates are reviewed.

---

## 1. Purpose + Trigger

**Purpose.** An incident tracker quantifies a single discrete accident or
industrial-disaster event so a reader can see *what happened, at what
human/economic scale, and how trustworthy the cause attribution is right
now* — without absorbing the most-clicky early-cause guess as fact.

**Trigger.** Auto-detected when:
- Articles in `top` / `international` / `politics` clusters surface ≥ 3
  distinct dispatches naming the same accident (flight number / vessel name
  / facility / train route) within 24h, **OR**
- An official investigation body (NTSB, ICAO, IMO, national equivalent)
  opens or publishes a file on the event, **OR**
- Editorial seed (DrJ flags a developing incident with under-the-radar
  significance before wire pickup density rises).

---

## 2. Core Metrics

Each metric below carries three fields per the Option-3 confidence pattern:
**headline value + confidence flag + source attribution.**

Confidence vocabulary (incident-specific):
- **preliminary** — first-24h figures from operators, witnesses, and early
  wires. Most early casualty counts and almost all early cause attributions
  start here. Often revised significantly.
- **investigating** — official investigation has been opened and is
  publishing interim updates; figures and contributing-factor language are
  becoming more stable but the investigation is not closed.
- **official-finding** — investigation has issued its final report (NTSB
  final report, ICAO Annex 13 final, IMO MSC report). This is the confirmed
  tier for cause attribution; casualty figures normally stabilize earlier.

Metrics tracked:

1. **Casualties (killed)** — integer; confidence; source. Early figures
   from operators frequently conflict with morgue/hospital counts.
2. **Casualties (injured)** — integer; confidence; source. Often
   under-reported initially as walking-wounded discharge before counts settle.
3. **Casualties (missing)** — integer; confidence; source. Most volatile
   figure in maritime and earthquake-adjacent incidents; flag explicitly.
4. **People affected / evacuated** — integer; confidence; source. Covers
   evacuation zones (industrial, derailment-with-haz-mat) where direct
   casualties may be low but population impact is large.
5. **Cause attribution** — short text; confidence; source. **The
   highest-risk metric.** Early cause claims (pilot error / mechanical /
   weather / sabotage / structural) are wrong more often than right;
   `preliminary` cause text must never be displayed without the flag.
6. **Economic damage** — currency value + range; confidence; source. Often
   absent or wildly variable in early reporting; insurance figures and
   asset-write-off figures differ substantially.
7. **Response status** — qualitative (e.g., "search-and-rescue active",
   "recovery phase", "investigation only"); confidence; source.

Cause attribution should **never** be elevated above `preliminary` until
the relevant investigation body has published an interim or final finding.

---

## 3. Data Sources

Primary (institutional):
- **NTSB** (US National Transportation Safety Board) — aviation, rail,
  highway, marine, pipeline, haz-mat investigations.
- **ICAO** + national aviation authorities (FAA, EASA, DGCA, CAA-PK) —
  international aviation investigation conventions.
- **IMO** + national maritime authorities — marine casualty investigation.
- **National rail safety bodies** (FRA in the US, RAIB in the UK, etc.).
- **National disaster-management agencies** (NDMA-Pakistan, NDRF-India,
  FEMA situation reports) — for industrial / multi-modal incidents.

Secondary (corroboration):
- Major international wires (Reuters, AP, AFP).
- Industry-specialist outlets (Aviation Herald, gCaptain for maritime,
  Railway Gazette) — often the most accurate early-phase reporting because
  the reporters know the operational context.
- Operator press releases — treated as primary-source-but-self-interested;
  surface figures, attribute clearly, flag as `preliminary`.

Excluded by default:
- Social-media-only photos/videos without wire pickup (too noisy for headline
  figures; may inform `preliminary` early-warning entries).
- Cause-speculation in op-ed or analysis pieces before investigation opens.

---

## 4. Update Cadence

- **Active phase** (first 72h): metrics re-checked every 6–12h; casualty
  figures usually settle within this window, cause figures usually do not.
- **Investigation phase** (days 4–N): weekly check tied to investigation-
  body release rhythm. Interim findings (e.g., NTSB preliminary report at
  ~30 days) are major-update triggers.
- **Final-report phase**: tracker is updated when the official final report
  drops (sometimes years after the incident). Cause attribution may flip
  from `preliminary` to `official-finding` long after public attention has
  moved on; the tracker carries that update faithfully.
- **Closeout candidate**: 30 days after recovery phase ends *and* no active
  investigation; closeout deferred when a final report is still expected.

---

## 5. Display Considerations

**Layer 1 — Homepage / category card.**
Compact widget showing:
- Tracker title (e.g., "Air India 171 — Jun 2024").
- Single headline figure (confirmed-killed count where available; otherwise
  people-affected).
- Confidence flag visible next to figure.
- One-line response status.
- Last-updated timestamp.

Layer 1 deliberately surfaces casualty count over cause; early cause claims
are too volatile to headline.

**Layer 2 — Full tracker page.**
Expanded view showing:
- All seven metrics from §2 with their confidence flags and source attribution.
- Cause-attribution panel: explicit "preliminary cause: X (operator-reported,
  not investigator-confirmed)" framing during `preliminary` phase; revision
  history kept visible when the investigation contradicts early claims.
- Timeline of investigation milestones (file opened, interim report, final).
- Source-attribution panel listing data sources and last-pulled timestamps.
- Related-articles list.

Cause-attribution presentation matters more here than for most templates:
the difference between "engine failure caused the crash" (often wrong early)
and "operator reports possible engine issue; NTSB investigating" (honest) is
the difference between a tracker and a rumor mill.

---

## 6. Validation Source

**Authoritative.** The relevant investigation body is the validation source
for cause attribution: NTSB for US-modal incidents, ICAO state-of-occurrence
authority for international aviation, IMO-aligned national authority for
maritime, national rail safety body for rail. A `preliminary` cause claim
remains `preliminary` until an interim or final investigation document
confirms or supersedes it.

**Cross-reference.** Industry-specialist outlets (Aviation Herald etc.) are
valuable for early-phase accuracy because their reporters often have
operational context the general wires lack — but they are not validation
authorities, only high-quality early-phase signal.

**Editorial override.** DrJ may downgrade cause-attribution confidence
manually when public/wire reporting has out-run the investigation — the
default should err toward caution, not currency.

---

## 7. Open Questions / Limitations

Captured as prose so Sprint 1.2 (schema) can absorb them, not pre-resolved.

- **Cause-attribution stability over time.** A non-trivial fraction of
  incidents see the cause attribution change between operator's first
  statement and the official final report. Should the tracker preserve a
  full revision history of cause claims, or only display the current
  best-confidence value? Argument for history: it documents how confidently
  early claims were made vs how they aged. Defer to Sprint 1.2 schema.
- **Final-report lag.** Aviation final reports often take 1–3 years. Most
  readers have lost interest by then. Tracker must keep accepting the
  authoritative update even when the news cycle has moved on; no automatic
  closeout based on news-cycle quiet.
- **Severity classification across modes.** Aviation has Class A/B/C
  classifications; maritime uses tonnage + casualty thresholds; rail uses
  derailment-class. No single cross-mode severity scale exists; tracker
  surfaces the mode-appropriate classification rather than synthesizing one.
- **Economic damage vs insurance claim.** Hard damage estimates and
  insurance-claim figures often differ by an order of magnitude. Capture
  both when available with their respective attributions; do not collapse
  to a single "damage" number.
- **Industrial incidents with diffuse impact.** Chemical leaks and
  pipeline ruptures may have casualty figures that emerge over months
  (cancer-cluster studies, long-tail health effects). Tracker should keep
  open for elongated update windows when health-impact studies are pending.
- **Multi-vehicle / multi-vessel incidents** (e.g., a mid-air collision, a
  ship collision): one tracker or two? Lean one (the incident is the shared
  event), with both parties' details captured in the cause-attribution and
  source panels.
- **Operator-vs-investigator disagreement.** When the operator's
  preliminary report and the investigator's interim finding diverge, the
  tracker should surface both with explicit attribution — not silently
  prefer one. Defer display mechanics to Sprint 1.5 (frontend).
- **Cross-border incidents.** A crash in international airspace / waters
  raises which-authority questions (ICAO Annex 13 state-of-occurrence vs
  state-of-registry vs state-of-operator). Tracker needs to record which
  authority is the validation source per-incident — defer to Sprint 1.2
  schema.
