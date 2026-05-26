# Tracker Template — Entertainment

**Signal type:** `entertainment`
**Status:** draft v0.1 — Sprint 1.1.3 deliverable
**Pairs with:** the other seven tracker templates (parallel 7-section
structure)

> This is a markdown specification of what an *entertainment* tracker
> captures and displays for box-office runs, releases, awards, and major
> industry events. It is **not** a schema or code artifact — schema follows
> in Sprint 1.2 once all 8 templates are reviewed.

> **Reviewer note.** Entertainment is the lowest-epistemic-stakes template
> in the set — box-office numbers are commercial measurements, not
> casualty counts or election results. The 7-section structure is preserved
> for consistency, but tonal weight in §6 (Validation) and §7 (Open
> Questions) is deliberately lighter than the public-impact templates.

---

## 1. Purpose + Trigger

**Purpose.** An entertainment tracker quantifies a single film / show /
album / awards-event arc so a reader can see *opening weekend, cumulative
performance, critical and audience reception, and milestone events*
without scrolling a release calendar to find one number.

**Trigger.** Auto-detected when:
- A tracked title has a wide-release opening within 7 days or the current
  weekend, **OR**
- Articles in `entertainment` / `top` clusters surface ≥ 3 distinct
  dispatches naming the same title or awards event within 24h, **OR**
- A major industry event begins (Oscars, Golden Globes, BAFTAs, Cannes,
  Grammys, Emmys, MTV VMAs, major-festival opening), **OR**
- Editorial seed (DrJ flags a release worth tracking — sleeper hits,
  controversial reception, milestone records in reach).

---

## 2. Core Metrics

Each metric below carries three fields per the Option-3 confidence pattern:
**headline value + confidence flag + source attribution.**

Confidence vocabulary (entertainment-specific):
- **estimated** — opening-weekend Sunday estimates from studios are
  posted before Monday actuals; analyst forecasts before opening fall
  here too.
- **studio-reported** — figures the studio has published but third-party
  trackers (Comscore, Box Office Mojo) have not yet finalized.
- **final-actuals** — figures finalized by Comscore / Box Office Mojo
  for box office; equivalent finalized data for streaming where
  available; certified-final results for awards.

Box office in particular has a well-established "Sunday estimate vs
Monday actual" convention where estimates routinely shift 5–10% in
either direction; the confidence flag should always make clear which.

Metrics tracked:

1. **Box-office gross (opening weekend)** — domestic + international,
   currency value; confidence; source. The headline figure for most
   theatrical-release trackers.
2. **Box-office gross (cumulative)** — domestic + international running
   total; confidence; source. Updated through theatrical-run completion.
3. **Worldwide total** — combined figure with breakdown; confidence;
   source.
4. **Production budget** — currency value where reported (often
   undisclosed or contested); confidence; source. Useful denominator for
   profitability framing but routinely incomplete.
5. **Critical reception** — Rotten Tomatoes Tomatometer + Metacritic
   Metascore + count of reviews; confidence; source.
6. **Audience reception** — Rotten Tomatoes audience score + CinemaScore
   (opening-weekend audience grade) + IMDb rating where stable;
   confidence; source. **Display separately from critic scores** —
   critic-audience divergence is itself a story and should not be
   averaged.
7. **Awards / milestone events** — qualitative list with attribution
   (nominations, wins, festival selections, box-office records broken);
   confidence; source.

For ongoing awards events (Oscars night, Grammys night) confidence
operates differently — the event-progression confidence is closer to the
sports `live` / `final` shape than to the box-office estimates pattern.

---

## 3. Data Sources

Primary (industry-standard):
- **TMDB** (The Movie Database) — already-ingested aggregator;
  authoritative for release metadata, cast / crew, basic discoverability.
- **Box Office Mojo / IMDbPro** — the canonical US box-office figures
  (Comscore is the underlying measurement firm).
- **Comscore** (direct industry data) — box-office measurement firm
  whose figures back most published box-office reporting.
- **Variety / Deadline / The Hollywood Reporter** — industry trades with
  reliable opening-weekend reporting and analyst context.
- **Awards-event official sources** — AMPAS for Oscars, HFPA / CCA for
  Globes, BAFTA for BAFTAs, etc. Authoritative for nominations and
  winners.

Secondary (corroboration / depth):
- Rotten Tomatoes, Metacritic — review aggregators (different
  methodologies; surface both, don't average).
- CinemaScore — opening-weekend audience surveys (specific to that
  data point).
- Specialist outlets (IndieWire, Screen International) for indie /
  international film context.

Excluded by default:
- Studio-issued claims about box-office records without third-party
  corroboration ("biggest opening for an X" claims often parse a
  category specifically to be technically true).
- Pre-release tracking surveys treated as predictions (different
  epistemic frame; not measurement).
- Streaming-viewership claims from platforms (see §7 — Netflix
  reporting is famously opaque).

---

## 4. Update Cadence

- **Pre-release phase** (1–2 weeks out): weekly check on tracking
  numbers, advance-ticket sales where reported, festival-circuit
  reception for prestige titles.
- **Opening-weekend phase** (Fri–Mon): aggressive updates — Friday
  estimates → Saturday estimates → Sunday estimates → Monday actuals.
  Confidence flag flips through `estimated` → `studio-reported` →
  `final-actuals` as the cycle progresses.
- **Theatrical-run phase** (weeks 2–N): weekly updates on cumulative
  gross until the title drops below tracking thresholds.
- **Closeout**: theatrical run ends or sustained week-over-week drop
  past a configurable threshold for ≥ 3 weeks.
- **Awards-event triggers** (nomination announcement, ceremony night,
  upset wins): immediate update flagged `breaking`.

---

## 5. Display Considerations

**Layer 1 — Homepage / category card.**
Compact widget showing:
- Tracker title (e.g., "Oppenheimer — opening weekend").
- Single headline figure: opening-weekend gross during opening cycle,
  cumulative total thereafter, awards-count for awards-event trackers.
- Confidence flag visible (`estimated` looks visually different from
  `final-actuals` — Sunday-estimate vs Monday-actual matters).
- One-line context (e.g., "biggest opening for IMAX-format release").
- Last-updated timestamp.

**Layer 2 — Full tracker page.**
Expanded view showing:
- All seven metrics from §2 with their confidence flags and source
  attribution.
- Domestic vs international split panel.
- Critic-vs-audience reception side-by-side (deliberately not averaged).
- Budget-to-gross ratio when both available, with profitability framing
  caveats explicit (marketing costs typically excluded from published
  budgets).
- Comparable-titles panel where useful (e.g., "vs other Nolan films
  opening weekends").
- Source-attribution panel.
- Related-articles list.

Entertainment trackers should generally be visually lighter than the
public-impact trackers — the data is commercial measurement, not
public-interest stakes. Resist over-decorating.

---

## 6. Validation Source

**Authoritative.** Box Office Mojo / Comscore is the validation source
for theatrical box-office figures. Studio-issued numbers are corrected
to Comscore-final when they differ.

For awards: the awarding body itself is authoritative (AMPAS for Oscars,
etc.) — no real validation question once the envelope is open.

**Cross-reference.** Variety / Deadline / THR provide independent
checking on box-office reporting and surface methodology context
(e.g., "this opening would have been bigger but for the SAG-AFTRA
promotional restrictions").

**Editorial override.** DrJ may adjust contextual framing — e.g., noting
when a "record" claim parses a narrow category, or when a streaming
metric should be treated with extra skepticism — without overriding the
underlying figure when sourced from Comscore.

---

## 7. Open Questions / Limitations

Captured as prose so Sprint 1.2 (schema) can absorb them, not pre-resolved.

- **Streaming-era measurement.** Netflix and other streamers publish
  selective metrics (Top 10 lists, hours-watched figures) without
  third-party audit. Tracker should accept these as platform-reported
  with explicit "self-reported, not independently measured" attribution,
  and not present them as comparable to box-office figures. Discipline:
  do not let "X had Y million hours watched" hide that no one outside
  Netflix can verify the figure.
- **Critic vs audience score divergence.** When Rotten Tomatoes
  Tomatometer and Audience Score disagree by > 30 points, that gap is
  the story. Tracker must surface both separately, never average. Defer
  display threshold for "loud divergence" flag to Sprint 1.5.
- **Opening-weekend tracker closeout.** When does an opening-weekend
  tracker transition to a cumulative tracker? Same tracker with phase
  flag, or separate trackers? Lean same-tracker-with-phase; defer to
  Sprint 1.2 schema.
- **Critics-aggregate reliability.** Rotten Tomatoes Tomatometer (binary
  fresh/rotten threshold) and Metacritic Metascore (weighted average)
  have different methodologies; neither is the "true" critical
  reception. Always surface both with their methodologies named.
- **Award-eligibility windows.** Eligibility periods differ (Oscars
  calendar-year, BAFTAs different window, Cannes festival-screening
  basis); a film's qualifications differ by award. Tracker schema
  should accept multi-award arrays per title.
- **International vs domestic split.** US domestic box-office reporting
  is the most thoroughly tracked; international markets vary by
  reporting infrastructure. Tracker should surface what's reliable and
  flag what isn't.
- **Independent film + festival-circuit coverage.** Smaller releases
  may have meaningful festival data (Sundance / SXSW / Cannes audience
  award) but no wide-release box-office. Tracker still applies but
  Layer 1 emphasis shifts to festival recognition.
- **Music industry equivalents.** Billboard chart performance,
  certifications (RIAA gold/platinum, BPI equivalents), streaming play
  counts — same template structure works; data-source ecosystem is
  different. Defer music-specific source onboarding to Sprint 1.5.
- **Television-series arcs** vs single-film releases. Series have
  multi-season cadence, mid-season episode reception arcs, and "did
  it get renewed" milestone events. Same template applies; tracker
  lifecycle is longer than for single films.
- **Awards-night live trackers** (the Oscars themselves, the Grammys).
  Closer to the sports `live` / `final` shape than to box-office
  estimates. Sprint 1.5 should consider whether awards-night trackers
  warrant a sub-template variant.
