# State of play — 2026-07-20

Orientation for a fresh context (or future-you). Synced commit: **`6046e11`** — Mac,
`origin/main` and the server (`/opt/scoopfeeds`) are all on it.

- What the system actually does: [`docs/architecture/dossier_and_event_graph.md`](architecture/dossier_and_event_graph.md)
- Every flag, default, and prod value: [`docs/reference/env_reference.md`](reference/env_reference.md)
- How work is run (gates, COW discipline): [`docs/agentic-workflow.md`](agentic-workflow.md)

## Where things stand

**Shipped and default (reader-visible):** A2 restructured dossier · A6 occurrence timeline
(one row per occurrence, recency-pinned, rows link to the article) · storylines/ANGLES ·
Wave-2 unified affinity (treadmill dead) · gate-(a) LLM cost rails · timeline-writer
starvation fix.

**Shipped dark / disabled (deliberate):** A5 facet shelf behind `?facets=1` — built,
deployed, awaiting eyeball + flip · W2.1 merge floor shipped **disabled** pending
recalibration · sentiment module hidden on comprehensibility grounds.

**Working discipline that keeps paying off:** GROUND before building (read-only on a COW,
verbatim artifacts, 🛑 at the report) → build → COW-validate → dark behind a URL param →
live eyeball → default flip. DrJ deploys; agents never touch prod deploys. Two of the last
three workstreams were reshaped by the GROUND *before* code was written, and one live defect
(the timeline writer) was diagnosed entirely from code + COW without prod access.

## Open items — roughly in priority order

1. **Markets GROUND** *(next up)* — a resolved England–France market rendered on the
   Argentina event. With sentiment hidden, **prediction markets are the only Intelligence
   module left, and it is currently wrong**. Read-only GROUND on binding + staleness, 🛑 at
   the report.
2. **Merge-survivor `last_activity_at`** — one-liner. The promoter's merge path links the
   absorbed event's articles onto the survivor but never bumps the survivor's
   `last_activity_at` (`markMerged` updates the *absorbed* row). Real but latent: only 1
   event on the COW showed drift, because the triggering cluster usually re-matches the
   survivor in the same run. Fix: `touchActivity.run(now, now, survivor)` after the link loop.
3. **Machine-event quarantine at ingest** — USGS/NOAA create article-less events that have
   now caused **two** production failures (dominating the recency-sorted event list; starving
   the timeline writer's 500-event window). They should be quarantined at ingest or given a
   distinct status rather than competing as first-class events. Structural fix; both prior
   remedies were downstream patches.
4. **W2.1 floor recalibration** — after ~a week of 🧭 `promoter-merge` lines carrying
   decision-time `(ent, min-side)`, re-sweep and set a real threshold from the SAME/porous
   distributions. "No floor, use a different discriminator" is an acceptable outcome.
5. **Wave 3** — husk cleanup, blob dissolution, summary repair. Now also improves A5 facet
   coverage. Porous-absorb contamination is **reader-visible** today (a "French lawmakers
   social media ban" beat inside the World Cup event; Cuba and Putin–North-Korea articles in
   Iran's Coverage), which raises its priority.
6. **Gates (b) routing + (c) accounting** — outstanding from the LLM incident sequence.
7. **Sprint 3 hygiene** — junk faucet (raw machine-slug events reaching the reader),
   prominence ranking looks miscalibrated, single-source floor.
8. **A4 perf / SSR + SEO** — the site does not currently surface in search for its own
   headlines. Registered in the runbook addendum; unblocked once the graph settles.

## Known-good but worth watching

- **Narrow-title corollary** — third live sighting ("G.O.P. Boxed In…" titling a 300-article
  event). The facet structure can detect it; treatment is deferred to A5 v2 because
  rewriting titles is matcher-adjacent.
- **Two config hazards** in prod `.env`: a duplicated `STORYLINE_ENABLED`, and
  `EVENT_ENTITY_MAX_CATSPAN` read with different defaults in two modules. Both documented in
  the env reference; neither changed.
