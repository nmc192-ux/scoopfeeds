# Tracker Template — Sports

**Signal type:** `sports`
**Status:** draft v0.1 — Sprint 1.1.3 deliverable
**Pairs with:** `conflict.md` / `outbreak.md` / `incident.md` /
`environmental.md` (parallel 7-section structure)

> This is a markdown specification of what a *sports* tracker captures and
> displays for matches, tournaments, series, and standings. It is **not** a
> schema or code artifact — schema follows in Sprint 1.2 once all 8 templates
> are reviewed.

> **Reviewer note.** Sports data is fundamentally different in epistemic
> shape from the other tracker types: scores are *definitive once recorded*
> by the league-official scoring authority. The confidence model therefore
> collapses to a small temporal vocabulary (`scheduled` / `live` /
> `final`) rather than the multi-tier credibility vocabularies the
> conflict / outbreak / incident templates need. Section 2 leans into this
> contrast deliberately — sports is the low-uncertainty foil that helps
> frame why the other templates need their wider confidence models.

---

## 1. Purpose + Trigger

**Purpose.** A sports tracker quantifies a specific match, tournament,
series, or standings snapshot so a reader gets *score / result / context*
without scrolling a 12-paragraph game story for a number.

**Trigger.** Auto-detected when:
- A fixture for a covered league/tournament is within 24h or currently
  in-progress, **OR**
- Articles in `sports` cluster (≥ 3 distinct dispatches) around the same
  fixture or series, **OR**
- A major tournament context fires (Olympics opening, World Cup group
  draw, Grand Slam fortnight), **OR**
- Editorial seed (DrJ flags an emergent story — e.g., a player milestone
  approaching that elevates routine fixtures into trackers).

---

## 2. Core Metrics

Each metric below carries three fields per the Option-3 confidence pattern:
**headline value + confidence flag + source attribution.**

Confidence vocabulary (sports-specific — deliberately narrow):
- **scheduled** — fixture is upcoming; no in-play data yet. Tracker mostly
  surfaces participants, venue, kickoff/start time.
- **live** — fixture is in progress. Scores update at official-feed
  cadence; some figures (e.g., possession %, shots) are provider-estimated
  in-running.
- **final** — fixture is complete and league-official scoring authority
  has recorded the result. This is the confirmed tier and rarely flips
  (only via post-match disciplinary adjudication, e.g., a forfeit).

Unlike the conflict / outbreak / incident templates, sports metrics do not
need source-credibility tiers in their headline display — the
league-official source is canonical. The confidence flag is essentially
temporal (where in the fixture lifecycle are we?), not credibility-based.

Metrics tracked:

1. **Score / result** — primary headline figure. Format varies by sport
   (goals, runs, sets, frames, points); attribution: league-official.
2. **Standings / table position** — current rank in league or group; with
   matches-played, points, GD / NRR / equivalent tiebreakers.
3. **Series state** — for multi-match series (best-of-7 playoff, Test
   series, group-stage): games-completed / games-remaining and current
   series score.
4. **Key statistics** — sport-specific (e.g., goals + assists for football;
   strike rate + economy for cricket; shooting % for basketball). Captured
   when materially newsworthy, not as a default flood.
5. **Fixture schedule** — next match(es) with time/venue, for ongoing
   series and tournaments.
6. **League / tournament context** — qualification implications, knockout
   bracket position, relegation/promotion math — surfaced when the
   stakes-frame is the actual story.
7. **Player / team milestones** — record approaches, debut/farewell
   moments, sanctions; flagged when newsworthy, omitted otherwise.

---

## 3. Data Sources

Primary (authoritative):
- **SportsDB** — already-ingested aggregator covering many leagues; primary
  near-real-time source for fixtures, results, and league tables.
- **League-official feeds** — ATP/WTA, FIFA, ICC, NBA, NFL, etc. The
  league is the canonical scoring authority; specific official feeds vary
  by sport and licensing.

Secondary (corroboration / depth):
- ESPN, BBC Sport, Cricinfo, Reuters Sports — wire-quality reporting and
  context.
- Sport-specialist outlets (The Athletic, Football365, Wisden) — context,
  not score authority.

Excluded by default:
- Social-media-only score claims without official feed corroboration
  (especially around contentious decisions — refereeing calls etc.).
- Fantasy-projection / betting-line numbers (different epistemic frame;
  not historical fact).

---

## 4. Update Cadence

- **Live phase**: real-time per official-feed push cadence (often 5–15s
  for major sports). Trackers in `live` confidence update aggressively.
- **Final phase**: single update at fixture end; figure flips to `final`.
- **Series / tournament phase**: tracker stays active across the
  multi-match arc; updates at the cadence of constituent fixtures plus
  context-level updates (bracket changes, qualification math).
- **Closeout**: at series / tournament end, tracker moves to archive with
  final outcome preserved. Standings trackers (league-table) are
  long-running and don't close out within a season.
- **Disciplinary / forfeit triggers**: rare but real (a result overturned
  on appeal); tracker accepts late updates flagged accordingly.

---

## 5. Display Considerations

**Layer 1 — Homepage / category card.**
Compact widget showing:
- Tracker title (e.g., "India vs Australia, 2nd Test, Day 3").
- Score / result as the headline figure.
- Confidence flag (`live` / `final` / minutes-to-`scheduled`).
- For series, the series score (e.g., "Aus lead 1-0").
- Last-updated timestamp (especially important during `live`).

Layer 1 for sports is the closest of all eight templates to a traditional
scoreboard — readers expect score-first, context-after.

**Layer 2 — Full tracker page.**
Expanded view showing:
- All seven metrics from §2 (score, standings, series state, key stats,
  schedule, context, milestones) — only the materially-relevant ones
  surfaced; sports trackers can be lean.
- Match-progression chart (innings-by-innings for cricket; quarter-by-quarter
  for basketball; etc.) when applicable.
- Standings table for league-context trackers.
- Source-attribution panel (SportsDB + league-official feed).
- Related-articles list.

Sports trackers should default to LESS visual complexity than the other
seven templates — the data is high-confidence and self-explanatory; over-
decorating obscures rather than illuminates.

---

## 6. Validation Source

**Authoritative.** The league or tournament's official scoring authority
is the validation source. SportsDB is the operational ingestion layer for
many of these but is itself sourcing league-official data.

**Cross-reference.** Wire reporting (ESPN, BBC Sport, etc.) is used to
catch occasional SportsDB-feed lag (a final result not yet propagated)
and to source context that doesn't show up in raw scoring (managerial
decisions, injury news in fixture aftermath).

**Editorial override.** DrJ may add narrative context — e.g., flagging
that a particular milestone is in play, or that a series implication
matters more than the surface score — without overriding any factual
figures. Score figures are authoritative; the editorial overlay is
contextual, not corrective.

---

## 7. Open Questions / Limitations

Captured as prose so Sprint 1.2 (schema) can absorb them, not pre-resolved.

- **League coverage scope.** SportsDB covers many leagues but not all.
  Which leagues qualify for tracker-eligibility? Top-N football leagues +
  Test cricket + major franchise leagues (NBA, NFL, MLB, NHL) + tennis
  Grand Slams + Olympics is a sensible default; broader requires explicit
  source onboarding. Defer to Sprint 1.5 (frontend) for visibility scope.
- **Real-time vs post-game tracker variants.** A `live` tracker and a
  next-day `final` tracker are different reader-need shapes. Same template
  serves both, but the Layer 1 emphasis differs. Defer display semantics
  to Sprint 1.5.
- **Multi-sport edge cases.** Combined events (decathlon), team-vs-team
  formats with individual sub-events (Davis Cup ties), and asynchronous
  events (golf majors, Tour de France) stretch the "single fixture"
  framing. Tracker schema (Sprint 1.2) should support a `fixture_group`
  parent above individual fixtures.
- **Statistical depth ceiling.** Sport-specific stats can run very deep
  (every cricket ball, every NBA possession). Tracker is a scorecard, not
  a stat-aggregation product; cap depth at "what would a generalist reader
  need to feel oriented." Defer ceiling decisions to Sprint 1.5.
- **Contested calls / VAR / overturned results.** Late corrections
  (referee overturns, anti-doping disqualifications) need a clean
  late-update path. Confidence stays `final` but the headline value can
  shift; revision visible on Layer 2.
- **Non-Western league coverage.** PSL (Pakistan Super League),
  Bundesliga 2, J-League, etc. matter to specific reader segments. Scope
  decisions interact with the broader Scoopfeeds source-onboarding plan.
- **Womens' sports coverage parity.** Default sources skew male; explicit
  decision needed on whether tracker scope mirrors source-availability
  (which would be biased) or imposes parity targets. Editorial call, not
  a technical one.
- **Olympics / World Cup tournament-level trackers.** A four-week
  tournament can spawn dozens of tracker children (per event / per sport).
  Tournament-level umbrella tracker with child fixture trackers — same
  `fixture_group` pattern as above.
