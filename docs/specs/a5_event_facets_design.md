# A5 — Event Facets: persistence + render design (DESIGN GATE 🛑)

**Status:** design report, awaiting DrJ approval. No code written. Guardrails locked:
**zero matcher changes; facets are a persistence/presentation layer only; macro-events
stay whole.** A5 renders *what the breaker already computes* — it never re-decides graph
membership.

**Sequencing (updated):** A5 moves from "after W2.1 + W3" to "parallel, render gated by
coherence." Wave 3 remains queued and, when it lands, *improves facet coverage* (more
sub-threads clear the render bar) rather than blocking A5. The coherence render-gate is
what makes shipping pre-W3 safe.

---

## (a) What structure the breaker computes per sweep — GROUND

Per candidate event (`eventBreaker.js:104–143`), the breaker re-clusters the event's
**member articles** (not clusters) via `clusterMembers → clusterWindow`:

- `subs`: `Array<{ members: Article[], size:int, sources:int }>`, **sorted size-desc**
  (`semanticClusterer.js:76–82`). `sources` = distinct `source_name` count.
- `subs[0]` = the **anchor**; its fingerprint `core = affCtx.entitySet(anchorIds)` — the
  TOPK rarest, hub-filtered (`cat_span ≤ MAX_CATSPAN`) entity keys (`eventBreaker.js:108–109`).
- Per non-anchor sub *i*: `{ ent, band } = affinity(entitySet(subIds), core)` where `ent` is
  idf-weighted **containment** vs the anchor core (`eventBreaker.js:114`, `storyAffinity.js:104–112`).
  `band = FOREIGN` (ent < `T_DISJOINT` 0.19) → spun into a new event; `AFFINE/AMBIGUOUS` →
  kept (logged `🧭 breaker-keep`).

**Per-facet numbers already available each sweep:** `size`, `sources`, `ent` (containment vs
anchor core), `band`, and the sub's entity-key `Set`.

**Everything above is ephemeral.** `subs`, `core`, `ent`, `band` are locals discarded at the
end of each loop iteration. The only DB writes are the *actions* (new events + link moves on a
split). The topology survives solely as `🧭 breaker-keep`/`breaker-split` log lines — and the
**anchor sub[0] is never even logged**. There is no table, column, or blob persisting facets today.

**Three gaps A5 must close:**
1. **The writer must run.** The breaker is gated `EVENT_BREAKER_ENABLED` (default **false**,
   `eventBreaker.js:22`, re-checked `scheduler.js:403`). ⚠️ **NEEDS-PROD-ENV CHECK** — if the
   breaker is off in prod, no facets populate. A5 must not force the breaker on as a side effect;
   see the persist-hook placement below (facets can be written by a sweep run in a
   compute-only mode without applying splits, if we don't want to enable splitting yet).
2. **Persist the kept-whole case.** The breaker early-returns when `subs.length <= 1` and when
   `!spin.length` (coherent macro-event left whole) *before* any write. But the kept-whole
   macro-event's internal sub-threads are **exactly** what A5 surfaces. The persist hook must sit
   right after `subs` is computed (~`eventBreaker.js:106`), independent of the split decision.
3. **Capture the anchor.** `subs[0]` is facet 0 and must be persisted like any other sub.

Also note the **`MAX_CATSPAN` mismatch** (GROUND): the breaker's local ctx defaults to 5,
`storyAffinity` to 3. A5 must build facet entity sets from the **unified `storyAffinity` ctx
(cat_span 3)** so facet coherence matches the rest of the system.

---

## (b) Persistence design — additive, breaker-written, accumulates from day one

**New migration (additive only — no changes to `events`/`event_articles`):**

```
event_facets (
  facet_id        TEXT PRIMARY KEY,      -- uuid
  event_id        TEXT NOT NULL,         -- FK events.id
  facet_key       TEXT NOT NULL,         -- STABLE identity: hash of hub-filtered core keys
  is_anchor       INTEGER NOT NULL DEFAULT 0,
  size            INTEGER NOT NULL,      -- article count this sweep
  sources         INTEGER NOT NULL,      -- distinct source_name count
  ent             REAL,                  -- containment vs anchor core (anchor: 1.0)
  band            TEXT,                  -- AFFINE|AMBIGUOUS|FOREIGN vs anchor
  core_keys       TEXT NOT NULL,         -- JSON entity-key set (render-time coherence gate)
  label           TEXT,                  -- derived display title (see below)
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  last_seen_at    INTEGER NOT NULL,
  UNIQUE(event_id, facet_key)
)
event_facet_articles ( facet_id, article_id, added_at, PRIMARY KEY(facet_id, article_id) )
```

**The crux is facet IDENTITY, not position.** Sub-clusters are recomputed every sweep and
`sub_index` is unstable, so keying on position would churn a fresh row per sweep. Instead key on
`facet_key = hash(sorted hub-filtered core keys)` (fall back to the most-cited stable member
article id when the core is thin). Same sub-thread → same `facet_key` → the row **accumulates**
(`UPSERT`: union members, refresh `size/sources/ent/band/last_seen_at`) across sweeps. This gives
the "accumulating from day one" property and a durable facet the render layer can trust.

**Written behind `EVENT_FACETS_PERSIST` (default off) — byte-identical breaker behavior when off.**
When on, the hook (after `subs` at ~`:106`, before any split logic) UPSERTs one `event_facets` row
per sub for **every** candidate event, including coherent macro-events left whole. Split decisions
are untouched — **zero matcher changes**; this is a pure additional write.

`label` (v1): the title of the sub's most-cited / highest-credibility member article. Cheap,
deterministic, no LLM. (Facet-aware *event* titling is deferred — see (d).)

**Accumulate before render ships.** Turning on `EVENT_FACETS_PERSIST` alone (render still dark)
starts building history so the shelf has real data the day render lands.

---

## (c) Render design — A2 facet shelf, dark behind a URL param, earn-render gated

A new A2 dossier section — **"Threads in this story"** — a shelf of facet cards, placed after
COVERAGE / before ACTORS. Dark-shipped behind a URL param (`?facets=1`), **exactly the pattern A2
itself used behind `?a2`**, so it can be live-verified on prod before default-on.

**EARN-RENDER coherence gates (the safety mechanism that makes pre-W3 shipping safe):**

- A **facet renders** only when **both**:
  1. `size ≥ FACET_MIN_ARTICLES` (env, default 5), **AND**
  2. its `core_keys` clear the **coherence contract** — reuse `isIncoherent`'s thresholds:
     `≥ MIN_CORE_KEYS` (2) keys carrying `≥ MIN_CORE_IDF` (4) idf mass. A porous/contaminated
     facet (generic keys, weak core) fails this and is **not rendered**.
- The **shelf renders** only when **≥ 2 facets qualify** (one facet = the event itself, no value).

**Why this is safe to ship before Wave 3.** Contaminated sub-threads — the porosity/over-accretion
junk W3 will clean — have weak, generic cores and won't clear the coherence bar, so they never reach
a reader. W3 cleanup then *raises* the number of qualifying facets (better coverage) instead of being
a prerequisite. The render bar, not graph purity, is the gate.

v1 cards are read-only: label, article count, source count, top sources. Facet-filtered
timeline/coverage views are a deferred interaction.

**Consistency with ANGLES:** note that A2's ANGLES section already renders live storyline data
(`routes/events.js:361–363` calls `getRelatedEvents` on every dossier) — see the Track-3 note.
Facets and ANGLES are distinct: ANGLES = *sibling events* across a storyline; Facets = *sub-threads
within one event*. Both follow the same "empty → no render" discipline.

---

## (d) Facet-aware title/summary (Messi/Yamal narrow-title corollary) — **DEFER to v2**

The corollary: a macro-event whose title is drawn from one narrow sub-thread (e.g. a broad World
Cup event titled *"Messi and Brady on 'prophetic' Lamine Yamal photos"*) is *detectable* from the
facet structure — the title's facet is small relative to the event.

**Defer, for two reasons:** (1) rewriting or annotating the event title touches the promoter's
title-adopt path (`updateNewTitle` / `title_cluster_size`) — **matcher-adjacent**, which the locked
guardrails forbid for A5. (2) It depends on facets being proven first. **v1 = persist + render the
read-only shelf.** v2 (separate gate) can use facet coherence to flag narrow-title events and
annotate ("part of a larger story") — a presentation-only change if it only affects the *displayed*
title, never the stored one.

---

## Open questions for DrJ (before any build)

1. **Prod `EVENT_BREAKER_ENABLED` state?** Facets need a writer. If off, do we (a) enable the
   breaker (separate behavior gate), or (b) add a compute-only facet pass that forms sub-clusters
   and persists without applying splits? (b) keeps splitting decoupled from facet accumulation.
2. Confirm `facet_key = hash(core keys)` as the stable identity (vs anchor-article id).
3. Confirm the earn-render thresholds (`FACET_MIN_ARTICLES` 5; coherence = `isIncoherent` reuse;
   shelf ≥ 2 facets).
4. Confirm v1 is read-only cards; interaction + narrow-title treatment deferred to v2.

🛑 **Design gate. No implementation until approved.**
*(Superseded for Phase 2 by the post-spike revision below; Phase 1 shipped as designed.)*

---
---

# Phase 2 REVISED design (post-spike, 2026-07-19) — 🛑 at this revision

Phase 1 shipped and is live (EVENT_FACETS_PERSIST=true, 406 rows first sweep). The Phase-2
GROUND + spike (top-20 events, 07-16 COW; harnesses `_a5_facet_ground.mjs`, `_a5_tau_probe.mjs`,
`_a5_spike.mjs`) overturned the original render design's data assumption:

**Spike facts (verbatim label sets in the session record):**
- At the shipped breaker tau 0.78, mega-events collapse to ONE sub-cluster → **1/20 top events
  would render the shelf**. Iran and World Cup yield ZERO facets — the exact angle-browsing case.
- Finer tau helps only modestly: at 0.88 Iran fragments into 8 subs but **0 pass the coherence
  gate** (fine fragments have thin cores); top-20 render rate peaks at **3/20** (0.88/0.90).
- **Tombstone-derived facets are the richest source for today's mega-events**: each merged
  tombstone keeps its event_articles (confirmed: Iran survivor has 666 tombstones, 485 with
  links). After sibling-guard dedup: Iran 22 distinct (2 qualifying), Graham 6 (5 qualifying),
  Zelensky 5 (2), Kannada 21 (1 — the real S. Janaki story inside the garbage attractor).
  Top-20 render rate from tombstones alone: **4/20**, with two events at 5–6 facets.
- **Asymmetry (accepted honestly):** tombstones cover the accreted PAST (rich for current
  mega-events, built by pre-W1 churn); the Wave-1 no-shells absorb + W2.1 mean future merges
  mint few tombstones → fine-tau sub-clustering covers the FUTURE. The design needs BOTH.
- Data-quality traps found: (i) a Graham tombstone titled "Hormuz Route Open…" whose members
  are all Graham articles (2a-era mis-merge; the TITLE lies about the members) → labels need an
  entity-sanity check; (ii) Graham's qualifying tombstones include near-duplicate angles with
  different headlines ("dies suddenly" / "US Senator dies") → title-dedup is insufficient,
  member-overlap dedup required; (iii) Iran's 67-article "Hormuz" tombstone = 52% of the event's
  members — not an angle, a pseudo-event → explicit size-share cap required.

## Revised facet sourcing — DUAL SOURCE, unioned

1. **Source A — tombstones (the past):** per survivor, every `status='merged'` event with
   `meta.merged_into = survivor`, members = tombstone links ∩ survivor's live members.
   Candidate label = tombstone title.
2. **Source B — fine-tau sub-clusters (the present/future):** breaker facet pass re-clusters at
   `EVENT_FACET_TAU` (default **0.88**) — a NEW env, presentation-only; the breaker's split
   decision stays on DEFAULT_TAU 0.78 and is untouched (guardrail: zero matcher changes).
   Candidate label = representative member headline.

**Dedup (both sources together):** sibling-guard logic (base-slug strip "-N" / normalized title)
PLUS **member-overlap collapse**: two facets sharing ≥ 0.5 Jaccard of members merge (keep the
larger; tombstone label wins on ties — it names the angle at the moment it was a story).

## Revised earn-render gate

A facet renders only if ALL of:
- `size ≥ FACET_MIN_ARTICLES` (5) — unchanged;
- coherent hub-filtered core (`isIncoherent` thresholds: ≥2 keys, ≥4 idf mass) — unchanged;
- **NEW: size ≤ FACET_MAX_SHARE (0.6) × event member count** — a facet that IS most of the
  event is not an angle (kills the 67a Hormuz pseudo-facet class); the anchor sub is likewise
  never rendered as a facet (it's the event itself).

Shelf renders only with **≥ 2 qualifying facets** — unchanged. Kannada-class garbage stays out
(spike-verified: 0 qualifying tau facets on the attractor at every tau; 20/21 junk tombstones
rejected). **Partial coverage is accepted** (A3 philosophy): a single-thread story rendering no
shelf is correct, not broken. Expected initial coverage ~4–6/20 mega-events, growing as W3
cleans the graph and future coverage accrues via Source B.

## Revised labels — mechanical hybrid (NO LLM, hot-path safe)

- **Primary = the candidate headline** (tombstone title or representative member headline),
  guarded by an **entity-sanity check**: the label's entities must intersect the facet's member
  core; on mismatch (the "Hormuz on the Graham page" trap) fall back to the entity label.
- **Secondary eyebrow = entity label**: top-2 DISTINCTIVE core entities (rank facet-unique keys
  before event-shared ones, by idf), display via `article_entities.label || surface`, with
  case-insensitive variant dedup ("Graham · Lindsey Graham" → one) and a per-part length cap
  (~28 chars — kills the Wikidata long-surface blowup observed in the spike).

## Persistence + render deltas

- `event_facets` gains a `source` column ('tau' | 'tombstone'); `EVENT_FACET_TAU` env (0.88).
- **Recompute:** the 406 rows at 0.78 are truncated + recomputed under the new scheme
  (additive tables, cheap; flag stays on).
- Render: "Threads in this story" A2 section, dark behind `?facets=1`, its own ship gate.
  **Facet cards are NOT links to tombstone events** — a tombstone URL 302s to the survivor
  (self-loop). v1 cards are display-only (label + N articles · M sources); in-page
  timeline/coverage filtering is v2.

🛑 **Phase 2 revised design gate — no shelf implementation until DrJ approves this revision.**
