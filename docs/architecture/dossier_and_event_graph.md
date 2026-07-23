# Dossier & event graph — how it actually works (2026-07-20)

Current as of commit `6046e11`. This describes **shipped, deployed behaviour**, not intent.
Flag defaults and prod values: [`docs/reference/env_reference.md`](../reference/env_reference.md).

---

## 1. The reader-facing dossier (`/events/:slug`)

### A2 restructured dossier — **DEFAULT** (legacy at `?a2=0`)

Section order, top to bottom:

**Header → Timeline → Coverage → Angles → Actors → Intelligence**

Design rules that are easy to mistake for bugs:

- **The header is mechanical only.** `N outlets · M articles · day D`, category, status
  (developing/dormant). No LLM-written text. The prose summary that used to sit here was
  removed deliberately — it was the vector for the 2e summary-contamination class (a Kannada
  obituary event wearing a Zelensky summary).
- **Credibility scores are hidden** from the reader. Coverage groups by outlet with no score.
- **Earn-render.** Every section below the header renders *only* when it has real data.
  **An absent section is correct, not broken.** There are no placeholders and no empty
  containers. This applies to Angles, Actors, Threads, and every Intelligence module.

### A6 occurrence timeline — **DEFAULT** (legacy at `?tl=0`)

The stored `event_timeline` table is **one row per article**, so six outlets covering one
occurrence produced six rows and the chronology could not be read. The default timeline is
now computed **read-time from `event_articles`** — one row per *occurrence*:

- **Grouping:** near-duplicate embedding cosine (`EVENT_TL_DEDUP_TAU`, 0.88) **within a
  bounded time window** (`EVENT_TL_DEDUP_WINDOW_H`, 6h). The window is load-bearing —
  see §3.
- **Timestamp:** the *earliest* article in the occurrence ("when it was first reported").
- **Ranking:** outlet count (breadth = significance), with the **3 most recent occurrences
  pinned** so "what just happened" is never buried. Top-15 shown, "show full timeline" for
  the rest. Day-grouping and latest-first are preserved.
- **Rows link to the representative article** — the highest-credibility outlet's article
  URL (tie → earliest). A real article URL, never an event slug.
- **Beats vs analysis.** Multi-outlet occurrences ("beats" — what happened) render with a
  solid dot, bold headline and `— Outlet A, Outlet B +N · N articles`. Single-outlet rows
  ("analysis" — what someone wrote) render muted with a lone byline. Both are legitimate
  timeline items; a lone op-ed *is* one occurrence and one row is its correct representation.
- **Thin-event guard:** below `EVENT_TL_MIN_DEDUP` (4) articles, dedup is a no-op.

Because it reads articles directly, this view is **immune to `event_timeline` writer
outages** (§3). `?tl=0` and the standalone `/timeline/:slug` page still read the stored table.

### A5 facet shelf — **DARK** behind `?facets=1`

"Threads in this story" — sub-threads *inside* one event. Built and deployed; awaiting the
eyeball and flip. Dual-sourced (§2). Earn-render: a facet needs ≥`FACET_MIN_ARTICLES`, a
coherent hub-filtered core, and ≤`FACET_MAX_SHARE` of the event; the **shelf needs ≥2
qualifying facets**. Cards are display-only — a tombstone-sourced facet's original URL 302s
back to the survivor, so linking would self-loop.

### Sentiment module — **HIDDEN** (`VITE_SENTIMENT_ENABLED=false`)

Hidden on **comprehensibility**, not data sufficiency. It rendered a single machine "media"
polarity as scaleless "streams" (the component supports 6 sources; 42,157 events have 1),
with "N mentions" that don't reconcile against the article count. A module a reader cannot
interpret is worse than an absent one. It returns when genuine multi-source social sentiment
exists. Consequence handled: **the Intelligence section now disappears cleanly** — no orphan
header, no empty container — when nothing qualifies. On most events that is now the case,
leaving prediction markets as the only Intelligence module (currently mis-bound — see
STATE_OF_PLAY).

### Storylines / ANGLES — **ENABLED**

`STORYLINE_ENABLED=true`. ANGLES renders temporal siblings chained via durable entity
signatures, deduped by the sibling guard (tombstones excluded; near-identical `-N`
duplicates collapsed by base-slug/normalized-title).

> **Non-obvious finding, worth keeping:** ANGLES is **thin by construction**. Wave 2
> consolidation absorbs an event's distinct angles *into the macro-event as tombstones*, so
> the largest storyline chain (792 events, US-Iran) is 3 active / 789 merged and renders
> ~1 sibling. That is correct behaviour, not a bug — and it is exactly why **facets**, not
> storylines, are the vehicle for angle-browsing. Chain quality itself is sound: sampled
> mega-chains are single-story with no cross-story contamination; fat chains are 2a
> duplicate residue.

---

## 2. Event graph & pipeline

### Wave 2 — unified affinity (`EVENT_UNIFIED_AFFINITY=true`)

Before Wave 2 three judges asked three different questions on three different quantities, so
one pair could be simultaneously matchable, mergeable and splittable — the create-then-
merge-then-split treadmill that minted 174 slugs for one story. Now there is **one measure**
(`storyAffinity`: idf-weighted containment of TOPK rarest hub-filtered entity keys, built
identically for both sides) with **ordered bands + hysteresis**:

- `AFFINE` (ent ≥ `AFFINITY_T_MATCH` 0.23) — promoter may attach, merge may fire
- `AMBIGUOUS` — every judge holds current state
- `FOREIGN` (ent < `AFFINITY_T_DISJOINT` 0.19) — breaker may split, merge forbidden

Because the bands are ordered on one quantity, no pair can be accepted by one judge and
dismembered by another. **The treadmill is dead.**

### W2.1 — instrumentation live, merge floor shipped disabled

🧭 decision log now covers every promoter path: `promoter-create`, `promoter-merge` (now
including **decision-time min-side**), `promoter-hold`, `merge-hold`, `promoter-absorb`
(lost-1-to-1 fold-in) and `promoter-match` (the only path that rewrites a summary —
`adopt`/`keep-null`, the instrument for the 2e contamination class). Breaker logs
`breaker-keep` / `breaker-split`.

The **merge floor is shipped DISABLED** (`EVENT_MERGE_FLOOR_MIN_SIDE=0`). Rationale in the
env reference — short version: labeled SAME pairs span 0.248–0.377, entirely below the 0.50
ent floor, so the condition is always-true and the floor degenerates into blocking every
thin-sided merge (including the R1 newborn continuation). Recalibrate on the decision-time
corpus the 🧭 merge line now emits.

### A5 facet persistence — migrations 018 + 019

`event_facets` / `event_facet_articles`, written by the breaker behind `EVENT_FACETS_PERSIST`
after sweep convergence. **Dual source**, because neither alone suffices:

- **Tombstones** — each merged event keeps its `event_articles`, so a tombstone is a labeled
  article-subset of its survivor. Covers the *accreted past* (rich for today's mega-events).
- **Fine-tau sub-clusters** at `EVENT_FACET_TAU` (0.88) — covers the *future*, since post-Wave-1
  merges mint few tombstones. Presentation-only; the breaker's split tau stays 0.78.

Identity is a **stable hash of the facet's hub-filtered core keys** (not the churning
positional index), so a facet accumulates across sweeps. Gates and dedup are applied at
*write* time, so the read path is a dumb indexed SELECT and never renders a facet that
stopped earning its slot.

### Timeline writer starvation — fixed

**Failure mode worth remembering.** `eventTimelineBuilder` has no cursor: it re-scans the
freshest N active events every hour, so anything outside that window never gets rows —
permanently. The window was a hardcoded `LIMIT 500`, and **USGS/NOAA machine events consumed
59% of it** (295/500 live). Those events carry **no articles and yield zero timeline rows**,
so most of the window produced nothing while real stories starved outside it — new events
rendered "No timeline entries yet" (ranks: 591, 685, 3083).

Fix: `AND EXISTS (SELECT 1 FROM event_articles …)` + `EVENT_TIMELINE_MAX_EVENTS` (2000).
On the COW that took the window from 500 slots / 322 wasted to 423 used / 0 wasted, where
423 is the entire article-bearing active population.

**This is the second production failure caused by article-less machine events** (the first
being their domination of the recency-sorted event list). Quarantining them at ingest is an
open item.

### Gate (a) — LLM cost incident, CLOSED

Model pinned via `GEMINI_GENERATION_MODEL` (prod: `gemini-3.1-flash-lite`), `thinkingBudget: 0`,
output token caps, an actor-attempts ledger (migration 016) so retries can't loop, and
`LLM_DAILY_CALL_CAP`. A dead model pin now returns a clear 404 diagnostic and falls back
deterministically rather than failing silently.

---

## Open question: should durable signatures be hub-filtered? (DEFERRED)

The live matcher (storyAffinity) runs on a hub-**filtered** entity vocabulary
(`EVENT_ENTITY_MAX_CATSPAN=3` — Iran, England, India are dropped as category-promiscuous
hubs). The durable `event_entity_signature` path — which feeds `chainStoryline` — runs on a
hub-**unfiltered** vocabulary (`EVENT_SIGNATURE_MAX_CATSPAN=999`). On the 2026-07-16 COW,
**43% of stored signature key-instances are hub keys** a cat-span≤3 filter would drop; the
most frequent are exactly Q794 (Iran), Q668 (India), Q21 (England).

**Registered as an open question, not scheduled — do not change without a GROUND.**

- **Argument to filter (align to 3):** two subsystems measuring two vocabularies is the shape
  of the original treadmill bug.
- **Argument to leave unfiltered (999):** the matcher and the chainer **answer different
  questions**. The matcher decides "are these two clusters the same event *right now*", where
  a hub like "Iran" is noise that bridges distinct stories. The chainer decides "is this new
  event the next episode of a months-long story", where "Iran" may be the legitimate
  connective tissue. Different question ⇒ a different vocabulary may be *correct*, not a bug.
- **Empirical: chains are clean today.** The 2026-07-19 chain replay found all labeled
  cross-story pairs rejected — kannada↔vietnam 0.186, zelensky↔wheat 0.189, and two ov=1.0
  pairs killed by the ≥2-shared-keys floor. `chainStoryline` has independent rare-evidence
  guards (≥2 shared keys, idf mass ≥10, symmetric weighted-Jaccard) that partly compensate
  for the unfiltered vocabulary.
- **Correction to the framing:** the initial audit called this "the treadmill class." That was
  too strong. The treadmill was three judges disagreeing about the *same* decision; this is two
  judges making *different* decisions. Revisit only if chain quality degrades — and if
  signatures are ever migrated, **rebuild the table in full** rather than let `chainStoryline`
  compare newly-filtered signatures against old unfiltered ones (13%/day refresh ⇒ weeks of
  mixed-vintage, which *would* re-introduce an asymmetric-measure comparison).
- **Related — source-name strings in the entity vocabulary (GROUND'd 2026-07-20, HYGIENE not
  chain-quality):** 56 publisher-pattern keys leak into the entity vocabulary via NER on
  article text (`"day first show news"` alone appears 2,035× in signatures; also `"ary news"`,
  `"al arabiya tv"`, `"bss news agency"`, …). The concern was that two unrelated events sharing
  a junk key + one real key could clear `chainStoryline`'s ≥2-shared-keys floor with only one
  genuine signal. **Tested on the COW's would-form chains: 4,533 chains, 501 have a junk key
  among the shared keys, but 0 DEPEND on one to clear the floor** — in every case there are ≥2
  *non-junk* shared keys, so removing the junk key never drops a chain below the floor. The
  reason: chaining's other guards (shared idf mass ≥10, overlap ≥0.25) independently force a
  real shared signal, so the junk keys ride along without being load-bearing. Fixing the leak
  is Sprint-3 hygiene (source strings shouldn't be entities), not a chain-quality defect.

## 3. Things that look like bugs but are correct

| Observation | Why it's correct |
|---|---|
| A dossier section is missing entirely | Earn-render. Absent ≠ broken. |
| ANGLES shows ~1 sibling on a huge storyline | Wave 2 consolidated the angles into the macro-event as tombstones (§1). |
| The facet shelf doesn't render on a big story | It needs ≥2 *qualifying* facets; a genuinely single-thread story correctly shows none. |
| A single-outlet op-ed gets its own timeline row | It *is* a distinct occurrence. One row is its correct representation. |
| Intelligence is absent on most events | Sentiment is hidden and markets rarely qualify. Clean disappear is the designed behaviour. |
