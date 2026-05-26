# Tracker Template — Election

**Signal type:** `election`
**Status:** draft v0.1 — Sprint 1.1.3 deliverable
**Pairs with:** `conflict.md` / `outbreak.md` / `incident.md` /
`environmental.md` / `sports.md` (parallel 7-section structure)

> This is a markdown specification of what an *election* tracker captures
> and displays for national and major sub-national elections. It is **not**
> a schema or code artifact — schema follows in Sprint 1.2 once all 8
> templates are reviewed.

> **Data-source gap (explicit).** Scoopfeeds has **no election-results
> ingester** at the time of this template's authoring. The template ships
> documenting the gap; per-election ingester onboarding (electoral-
> commission feeds, AP / Reuters race-call APIs, etc.) is future Track 1
> source work. Until then, election trackers run on editorial seed + wire
> aggregation only — count-completion-% (see §2) is the key honesty metric
> that prevents that limitation from misleading readers.

---

## 1. Purpose + Trigger

**Purpose.** An election tracker quantifies the state of a major election
— votes, seats, turnout, count-completion — so a reader can see *who is
ahead, by how much, with how much of the count actually in* — without
mistaking partial returns for the final outcome.

**Trigger.** Auto-detected when:
- A scheduled election date for a covered jurisdiction is within 7 days
  or actively in count (currently editorial-calendar driven; ingester
  pending — see header note), **OR**
- Articles in `politics` / `international` clusters surface ≥ 5 distinct
  dispatches naming the same election within 24h, **OR**
- Editorial seed (DrJ flags an election worth tracking — primary contests,
  off-cycle specials, referenda).

---

## 2. Core Metrics

Each metric below carries three fields per the Option-3 confidence pattern:
**headline value + confidence flag + source attribution.**

Confidence vocabulary (election-specific):
- **projected** — a major news organization (AP, Reuters, BBC, national
  equivalent) has projected the outcome based on partial returns and
  modeling, but the electoral commission has not certified. Different
  outlets sometimes project at different times — track which.
- **partial-count** — actual ballot tallies are in but the count is not
  complete. **Count-completion-% is the headline honesty metric here.**
- **certified-official** — the electoral commission has issued certified
  final results. This is the confirmed tier and is what gets entered into
  the historical record.

Metrics tracked:

1. **Votes / percentage by party or candidate** — per-contestant values;
   confidence; source. Format depends on electoral system (FPTP, party-
   list PR, ranked-choice, two-round runoff).
2. **Seats won** (for legislative elections) — per-party integer;
   confidence; source. May lag the vote-share figure when seat-allocation
   formulas are complex (D'Hondt, Sainte-Laguë, MMP).
3. **Turnout** — percentage of eligible voters; confidence; source.
   Useful comparative metric across elections; itself revises as late
   ballots (postal, absentee) are counted.
4. **Count-completion percentage** — **the critical honesty metric.**
   What percentage of expected ballots have been counted. Without this,
   partial-count figures mislead. Display rule (§5): partial-count
   metrics MUST be shown with the completion-% alongside; never present
   a partial count as if it were final.
5. **Race-called-by status** — which organizations have projected the
   race and at what time. AP, Reuters, BBC, Fox, CNN, and national
   equivalents sometimes call at different points; record which.
6. **Provisional-vs-final flag** — qualitative status (counting in
   progress / preliminary complete / certified); confidence; source:
   electoral commission.
7. **Recount / dispute status** — qualitative flag when applicable
   (recount triggered, legal challenge filed, contested results);
   confidence; source.

Partial counts must **never** be presented as final or near-final without
the explicit count-completion-% visible. A "Party A leads with 54%" with
12% counted is a different fact from the same lead with 95% counted.

---

## 3. Data Sources

Primary (authoritative):
- **Electoral commissions** — country-specific official authorities:
  ECP (Pakistan), ECI (India), FEC + state-level secretaries (US), EC
  (UK), Elections Canada, Australian Electoral Commission, IFE/INE
  (Mexico), etc. **Direct ingester does not exist at Scoopfeeds yet.**
- **AP** — the US wire-service consensus for race-calling; widely
  cross-referenced.
- **Reuters** — international race-calling and results aggregation.

Secondary (corroboration):
- BBC, national broadcasters (NHK, ABC, etc.) for country-specific
  context.
- Election-monitoring organizations (OSCE/ODIHR, Carter Center, NDI)
  for procedural-integrity context — not vote totals.
- Country-specific specialist outlets (e.g., Dawn for Pakistan, The Hindu
  for India, FiveThirtyEight for US horse-race analytics).

Excluded by default:
- Campaign-issued vote-count claims (every campaign claims to be winning
  during the count; treat as commentary, not data).
- Social-media-only "calling" of races (network projections only).
- Polling — different epistemic frame entirely; polls are not results
  and belong in a separate tracker template variant (not in scope here).

---

## 4. Update Cadence

- **Active-count phase** (election night through count completion):
  hourly or finer, per source-feed cadence. Count-completion-% and
  leading-candidate figures move fastest here.
- **Provisional-results phase** (post-count, pre-certification): every
  12–24h until certification. Late ballots (postal, absentee, military)
  can shift figures meaningfully.
- **Certified phase**: single update when electoral commission certifies
  the final result; figures flip to `certified-official`. Tracker enters
  archived state.
- **Recount / dispute triggers**: immediate update flagged `breaking`
  when recount is ordered or legal challenge is filed.
- **Off-cycle update triggers**: rare but real — court-ordered re-runs,
  by-elections triggered by vacancy. Treated as a new tracker, not
  resumed update of the old one.

---

## 5. Display Considerations

**Layer 1 — Homepage / category card.**
Compact widget showing:
- Tracker title (e.g., "Pakistan general election 2024").
- Leading party/candidate + vote share (if `partial-count` or
  `certified-official`); **count-completion-% immediately adjacent.**
- Confidence flag prominently — `projected` and `partial-count` look
  visually different from `certified-official`.
- For `projected`: which organization(s) have called the race.
- Last-updated timestamp (loud during active count phase).

The Layer 1 card has to convey "this race is X% counted" as clearly as it
conveys "Party A leads" — these are inseparable facts during the count.

**Layer 2 — Full tracker page.**
Expanded view showing:
- All seven metrics from §2 with their confidence flags and source
  attribution.
- Vote breakdown table (per-party / per-candidate, votes + percentage).
- Seat-allocation panel (for legislative elections), with the seat-
  allocation formula named when non-trivial.
- Turnout panel with historical comparison if available.
- Race-call timeline: which org called when, in chronological order.
- Geographic map of vote share by sub-national unit where the granularity
  is reliable.
- Source-attribution panel; explicit "ingested via [editorial / wire
  aggregation / official feed]" tag per metric while the official-feed
  ingester is pending.
- Related-articles list.

---

## 6. Validation Source

**Authoritative.** The electoral commission's certified final result is
the validation source. Until certification, no figure displays as
`certified-official`.

**Cross-reference.** AP and Reuters are the canonical race-calling
sources for international consumption. When their calls disagree with
country-specific outlets (e.g., during contested counts), surface the
disagreement explicitly — divergence between race-callers is itself a
story.

**Editorial override.** DrJ may downgrade confidence manually when wire
reporting has out-run the official count, or when an election-monitoring
body has flagged procedural concerns that should temper the headline
treatment.

---

## 7. Open Questions / Limitations

Captured as prose so Sprint 1.2 (schema) can absorb them, not pre-resolved.

- **Electoral-commission ingester gap.** No direct programmatic feed
  exists at Scoopfeeds today. Until built, trackers depend on
  editorial-seed + wire-aggregation. This limits real-time freshness
  meaningfully. Per-jurisdiction ingester onboarding is on the Track 1
  source-onboarding backlog. Sprint 1.2 schema should make the data-
  source provenance an explicit field so the gap is visible per metric.
- **Race-calling consensus differences.** AP, Reuters, the major US
  networks, BBC, and national outlets sometimes call at different times.
  Showing only one risks under-stating or over-stating uncertainty.
  Display proposal: list all callers with timestamps in chronological
  order; do not adopt any single one as "the call." Acceptable?
- **Electoral-system heterogeneity.** FPTP, party-list PR (closed and
  open), mixed-member proportional, ranked-choice / instant-runoff,
  two-round runoff, single transferable vote — different metric shapes.
  Tracker schema needs `electoral_system` as an explicit field; some
  metrics (e.g., seats vs vote share) require different formulas to
  derive cleanly.
- **Recount and contest handling.** Recount-triggered shifts can change
  the leader after a tracker has effectively closed. Tracker must accept
  late updates and flag them prominently (revision history with explicit
  "recount" cause).
- **Off-cycle / by-election reporting.** Different cadence and stakes
  framing than general elections; same template applies but Layer 1
  prominence should be lower. Defer prominence rules to Sprint 1.5.
- **Referenda.** Yes/no votes (or multi-option) fit this template with
  candidates replaced by options. Schema should accept either contestant
  type. Defer mechanics to Sprint 1.2.
- **Pre-election polling integration.** Polls are not results; including
  them in this tracker would mix epistemics. If a polls tracker is
  desired, it should be a distinct template variant.
- **Country-specific quirks.** US Electoral College (popular vote ≠
  outcome), French two-round runoff (first vs second round meaning
  shifts), Pakistani reserved seats (added on top of contested seats),
  etc. The headline figure that "means" the outcome varies by
  jurisdiction; tracker authoring should pick the meaning-bearing
  figure per election, not default to popular-vote everywhere.
- **Disputed elections / irregular processes.** When election integrity
  itself is contested (annulled results, banned candidates, suspended
  parties), the tracker has to surface the procedural-integrity story
  alongside the figures; numbers without that frame mislead. Editorial
  override is the mechanism; defer process to Sprint 1.5.
