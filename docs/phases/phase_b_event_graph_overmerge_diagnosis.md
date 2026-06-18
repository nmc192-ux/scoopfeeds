# Event-Graph Over-Merge: Diagnosis and the Entity-Matching Decision

**Status:** Decision record — investigation complete; entity fix validated (GO), build pending.
**Subject:** Why the comprehension homepage is blocked, why every cheaper fix was refuted, and the entity-matching fix that resolves it.
**Scope:** ScoopFeeds event graph (durable `events`), the matcher (`eventPromoter`), and the homepage relaunch.

> Provenance note: this consolidates a multi-session diagnostic investigation. The reasoning and decisions are settled; exact file paths, line numbers, and constant names should be confirmed against the live repo at implementation time.

---

## 0. TL;DR

The comprehension homepage (commit `c9862ef`) was deployed and rolled back (`git revert` → `a614599`) because it led with an incoherent **blob** event — event `60063595` holding ~975 articles across 15 categories.

The investigation reached one conclusion, three times over, from three independent angles:

1. **The graph is broken in both directions.** It *over-merges* distinct stories into the blob **and** *under-merges* the same story into duplicate events (e.g. four near-duplicate "Musk trillionaire" events). These are not separate bugs — they are the same bug seen from two sides.
2. **The root cause is architectural, not a tunable.** In a dense same-period news embedding space, **no single pairwise similarity signal — cosine, title-token overlap, or the two combined — separates same-story from distinct-story.** The distributions overlap.
3. **No homepage display-trick reaches the quality bar.** Hiding the blob loses the day's headlines; recovering it restores headlines but strips the dossier layer; both leave the duplicate cards. The homepage's real dependency is a clean graph.

**Decision:** the fix is **rarity-weighted shared-entity/nugget matching** — the approach in Google's news-clustering patents — built by extending the existing Wikidata source-resolver to article-body entities. It addresses over-merge *and* under-merge, is language-agnostic, and produces coherent durable events natively, which is exactly what the homepage needs. **This is now the critical path to the homepage, not a deferred Phase-C enhancement.**

**Validated (GO).** The hypothesis was then tested on the *same* labeled pairs that refuted cosine and title. Rarity-weighted entity overlap is the first signal with a real separating gap — distinct-story median 0.002 (p90 0.037) vs same-story 0.184 (p10 0.065). See §7 for the verdict and the resolved build design.

---

## 1. The problem

**The blob.** Event `60063595` accreted ~975 articles spanning 15 categories — a domain-wide "everything" event rather than a story. It dominated the homepage for a structural reason:

- The homepage reads the durable `events` table via `GET /api/events` (mounted `/api/ri/events`), sorted by a computed `prominence` (Top Stories) and `last_activity_at` (category sections). No coherence filter.
- An event's `last_activity_at` is bumped every time it absorbs a new cluster. The blob, being the largest/most-central event, **wins the 1-to-1 argmax for high-activity clusters**, so it absorbs the most articles. That gives it both the highest prominence *and* the freshest activity — by a wide margin (975a / 54 sources vs ≤50 for any coherent event).
- Consequence: the blob is structurally the #1 card, and it **steals the freshness of the live stories** it absorbs. The genuine top stories of the day get sucked in; what survives as standalone events are the lower-activity stories that happened *not* to over-merge.

**The coupling.** Every homepage card links to `/events/:slug` — the durable dossier. The entire comprehension layer (dossier, trackers, timeline, sentiment, reality-index, following) hangs off the event slug. Anything that changes the homepage's data source must preserve durable event identity or that whole layer breaks.

---

## 2. Methodology — the faithful replay harness

Negative results are only trustworthy if the fix was tested against the **real** code paths, not a reimplementation. The harness:

- Runs the actual `refreshAnalysis → clusterWindow → runEventPromoter` pipeline against a **copy-on-write copy** of a clean production snapshot (`backend/data/prod-snapshot.db`, a consistent `.backup` of live `news.db`; gitignored).
- Starts from an **empty** events table and advances chronologically over the full ~5-day / ~12.7k-article corpus at the live cadence, so event ids accumulate exactly as in production.
- Every experimental change is **env-gated** so that defaults reproduce today's behavior bit-for-bit.

**Methodology gate (the harness validates itself):** the unmodified matcher (`MATCH_TAU = 0.78`) reproduces the blob from empty (~1035a / 15c). Because the harness faithfully reproduces the bug, it is a trustworthy bed for testing fixes — and, later, the entity fix.

---

## 3. Root-cause diagnosis — four refuted fixes

Each hypothesis was built behind an env flag and run through the harness. All four were refuted.

| # | Hypothesis | Result | Why it failed |
|---|---|---|---|
| **H1** | Recency-windowed event centroid + gated shared-article shortcut | **Inert** | Drift never happens. The blob is a ~3-day burst; its centroid stays ~0.96 cosine to its dominant story. At each sub-story's actual absorption time, 51/53 cleared `MATCH_TAU = 0.78` directly; 0 absorptions occurred below the shortcut floor. There was no drift to correct. |
| **H2** | Raise `MATCH_TAU` | **Refuted** | Even at **0.95** the blob is still 414a / 10c, while a *third of genuine stories shatter*. Clusters are compared to the event's **blended accumulating centroid** — a domain-average that sits ≥0.85–0.95 to many clusters — plus a merge cascade. Raising the bar can't separate what the centroid has already averaged together. |
| **H3** | Coherence guard as a per-cycle janitor (re-split breaching events) | **Refuted** | A one-time split **re-forms within one cycle** and is back to ~1000 within a day. A per-cycle janitor can't hold: persistent breaches, and severe id thrash (top identity changes ~2/3 of cycles) — which would break dossier URLs. The guard's own `clusterWindow` inherits the same cosine weakness and lumps tight mid-scale multi-category events back together. |
| **H4** | Cosine **+** title-token discriminator (AND-gate) | **Refuted (standalone)** | Title dominant-token Jaccard separates *distinct* stories cleanly (98.7% < 0.1), but **same-story has a heavy disjoint tail: 54% of same-story article pairs share ~zero title tokens** — different outlets headline the same event differently. AND-gating shrinks the blob (1035→167) but never eliminates it and pushes under-merge up (38%→51%). |

**The separability post-mortem.** `MATCH_TAU = 0.78` sits almost exactly at the *median* cosine of genuinely distinct same-period stories (0.757). ~0.85 is the highest "safe" threshold and even then statically blocks only ~19/53 over-merges. The picture is unambiguous:

```
cosine alone:  over-merges  (good recall, no precision)
title alone:   under-merges (good precision, no recall)
both AND-gated: still both, just less of each
```

The same-story and distinct-story distributions **overlap** under every similarity signal tried. There is no threshold that admits all same-story pairs without also admitting distinct-story pairs. **The over-merge is architectural.**

---

## 4. The two-grain finding and competitive context

The investigation surfaced a distinction that had been silently conflated:

- **Grain 1 — article → development.** The per-window `story_clusters`. Coherent. Tractable. It is what `clusterWindow` already produces. But **ephemeral**: id = `sha256(title)[:16]`, overwritten on each refresh, `expires_at = now + 24h`, no slug, no dossier route. Grain-1 clusters cannot carry durable identity.
- **Grain 2 — development → durable event.** The `events` table. Durable (slugs, dossiers, trackers, following). **This is where the over-merge lives, and what the entire comprehension layer is built on.**

**Competitive read** (teardowns + a live read-only browser probe of Perplexity Discover and Google News):

- **Perplexity Discover** resolves identity at **grain 1**: aggressive article→story dedup (12–90 sources per item) but it **deliberately punts the durable grain-2 merge**. The same fact appears simultaneously over-merged (folded into a larger item) *and* fragmented (its own item); items have durable per-item URLs but no event-cluster identity. A $21B product **chose not to build durable story→event merge** — strong evidence the merge is genuinely hard.
- **Google News** is event-centric: one durable Full-Coverage node, many outlets nested under it. It achieves this via **information-nugget matching** (patents `US7577655B2`, `US9361369B1`) — i.e., shared specific facts/entities, not raw text similarity.

The durable event graph is both the hard part *and* the differentiator. Entities are how the one product that does this well, does it.

---

## 5. Why no homepage display-trick works

The homepage coupling and a **hide-vs-recover measurement** on real snapshot data closed off the display-layer options.

**HIDE** — add a coherence filter to `/api/events` (`article_count ≤ 50 AND distinct_category_count ≤ 5`, reusing the guard's 50/5 predicate). Among *active* events the homepage shows, exactly one breaches: the blob. But the filtered homepage:

- Leads with a 12-article Norwegian court story and **four near-duplicate Musk-trillionaire cards**.
- Is missing the three biggest stories of the day — Iran ceasefire (159a / 26src), AI-bubble (99a / 22src), Israel–Lebanon (37a / 14src) — all trapped in the hidden blob.
- Shows the Iran story only as **stale 3–6-day fragments**, because the live coverage was siphoned into the blob.

→ Coherent but **headline-gutted**. Unacceptable for a comprehension homepage.

**RECOVER** — re-cluster the blob's members at read time (`coherenceGuard.planEventSplit`) and surface the coherent sub-stories. This restores the headlines (Iran returns at prominence 172.7 — **5× the entire HIDE list's top card**), but:

- **7 of the top 10 cards (12 of top 20) are grain-1-recovered with no durable dossier, tracker, or following** — the comprehension layer that is the homepage's whole promise.
- The split costs **203 ms** for one event — too slow per-request; production would need to cache it on the refresh cycle.

**Both options still show the duplicate Musk/tanker cards** — neither touches the under-merge.

**Conclusion.** Each display trick patches one symptom — hide (over-merge) → recover (coverage) → dedup (under-merge) → developing-view (dossier gap) — and they accumulate into roughly as much work as the real fix **while still shipping a visibly compromised homepage**. The homepage does not need a cleverer display layer. It needs a clean graph.

---

## 6. Decision — rarity-weighted entity/nugget matching

**The fix.** Add a **shared-entity** signal to the matcher. Extract entities from article *bodies* (extending the existing Wikidata source-resolver, which already resolves entities for source scoring, from publisher-owners to article-body entities), weight them by **rarity**, and use shared-rare-entity overlap as the merge signal where cosine and title both fail.

**Why it works where similarity fails:**

- **Same-story** articles share the *specific rare entities* of that story (the particular people, places, organizations, instruments) even when the prose and headlines differ — this recovers the same-story pairs that cosine-blended centroids drift past and that title-tokens miss. **Fixes under-merge (recall).**
- **Distinct stories** in the same domain share only *common* entities ("US", "AI", "market"), not the rare specific ones — so they no longer collapse into a domain blob. **Fixes over-merge (precision).**

This is the precision-and-recall combination that no single similarity signal provides, because rare entities are a sparse, discriminative signal rather than a dense, averaged one.

**Properties.** Language-agnostic (entities, not words — important for English/Urdu coverage). Evidence-backed (it is Google's published approach). Reuses existing infrastructure (the source-resolver).

**What it fixes, end to end.** The blob dissolves into coherent durable events, so the headlines arrive **with** their dossiers; the Musk/tanker duplicates consolidate. The homepage then works natively — no hide, no recover, no display dedup.

**Validation gate.** Build behind an env flag and test against the **same faithful replay harness**. The pass condition: entity-matching from empty produces coherent durable events — no blob, no duplicate cards — on the exact corpus where the cosine matcher produced the blob. Same env-gating discipline (defaults reproduce today; entity path behind a flag) so the result is measurable and reversible.

---

## 7. Scoping outcome — entity hypothesis validated (GO)

A read-only scoping pass surveyed the existing entity infrastructure and then ran the decisive separability probe on the **same** labeled pairs that refuted cosine and title.

**Infrastructure recon.**
- The Wikidata resolver (`wikidataClient.js`) is **publisher-only** — `resolveOrgByDomain(domain)` maps an outlet domain to an org/owner QID. Reusable for body extraction: its `searchEntities()` (label/alias → QID) plus the rate-limit/backoff/UA plumbing — i.e. the **resolve** half, not the detect half.
- The only article-body extractor is `eventActorExtractor.js` — **LLM-based, event-scoped, free-text names, no QIDs** — and its table `event_actors` is **empty (0 rows)** in the snapshot. No usable persisted entity data exists today.
- Corpus is **~99.9% English** (0 Arabic/Urdu-script titles — pk-region outlets publish in English). The Urdu coverage concern is theoretical for the current corpus; a Latin-script extractor covers it now, and QIDs are language-agnostic for later multilingual sources.

**Separability verdict → GO.** A lightweight capitalized-phrase extractor + rarity-weighted Jaccard, at the aggregated (cluster↔event) grain the matcher actually uses:

| Signal | same-story median | distinct-story median | separating gap? |
|---|---|---|---|
| cosine (baseline) | 0.84+ | **0.757** | ✗ heavily overlapping |
| title dominant Jaccard | 0.143 | 0.000 | ✗ same-story p10 = 0 collides |
| **entity, rarity-weighted** | **0.184** (p10 **0.065**) | **0.002** (p90 **0.037**) | ✅ distinct-p90 < same-p10 |

This is the first signal with an actual gap: a threshold in **[0.037, 0.065]** sits above ~90% of distinct pairs and below ~90% of same-story pairs. **Rarity weighting is load-bearing** — it pulls distinct-story p90 from 0.058 (unweighted) to 0.037 (weighted), suppressing common tokens (`world`, `us`, `india`) so only rare shared entities count.

**The probe is conservative, with two honest caveats:**
1. The crude extractor left 21.8% of articles with no entity and 67.6% of same-story *article* pairs sharing nothing — but the matcher operates at the **aggregated** grain, where coverage recovers. A real NER+resolve pipeline (QID canonicalization unifying "US"/"United States"/"America") only lifts the same-story floor. True separation is **≥** what's shown.
2. The distinct-story tail reaches 0.343 (two unrelated stories both heavy on "iran"/"hormuz"). So entity is a strong **primary** signal that must **compose with cosine as a guard**, not stand alone.

**Resolved design.**
- **Extraction — NER-then-resolve, per article, at ingest.** Local English NER (PERSON/ORG/GPE) over title+description+lead → `wikidataClient.searchEntities()` to canonicalize mentions to QIDs (this directly attacks both the article-grain sparsity *and* the under-merge — the Musk-×4 / Iran fragments share canonical QIDs). Surface→QID cache; runs in the existing enrich batch, persisted to a new `article_entities` table; match-time cost is set lookups, not in the request path.
- **Rarity weighting — rolling 14–30d windowed IDF** (corpus-wide IDF goes stale when a rare entity becomes ubiquitous during a crisis), recomputed daily, cached as a `qid → idf` map.
- **Matcher integration — entity primary, cosine guard.** In both `qualifies()` (cluster↔event) and `tryMerge()` (event↔event): `match = entityOverlap ≥ EVENT_ENTITY_MIN AND cosine ≥ floor`. Entity is the discriminator (blocks the distinct-story merges cosine admitted); cosine guards against entity-coincidence in the tail. Event/cluster entity set = union/top-K-by-IDF of member entities (the aggregated grain). `EVENT_ENTITY_MIN` env-flag, default 0 = OFF (today's behavior).
- **Harness gate (acceptance test).** Extend the from-empty replay: extract entities for the slice once, then replay. GO criteria: old matcher reproduces the blob; the entity-gated arm holds the largest event coherent (no >50a/>5c breach), collapses the duplicate Musk cards, and keeps ground-truth splitting low. Sweep `EVENT_ENTITY_MIN` ∈ [0.04, 0.08], seeded from the probe gap (~0.05).

---

## 8. Status — built, parked, carried

**Committed**
- Signal Service — `6d2a2cf` (local; off the critical path; pushable anytime).
- Retro — `05f3796`. Status audit — `b264579`.

**Built, uncommitted, parked** (raw material for the entity work — keep OUT of any homepage commit)
- `backend/src/realityIndex/intelligence/coherenceGuard.js` — `planEventSplit`, `isGuardCandidate` (50/5), `KEEP_CORE_SHARE` 0.60. Useful as a coherence metric and for the entity-driven re-split/migration.
- `eventPromoter.js` Phase 2/3b env-gated edits (recency-window constants, title-Jaccard gate). Behavior-neutral at defaults.

**Carried**
- `backend/data/prod-snapshot.db` — clean `.backup`, gitignored; the replay basis.
- The faithful replay harness pattern (throwaway scripts, untracked).
- The homepage redesign `c9862ef` — reverted by `a614599`, cleanly re-appliable once the graph fix lands.

**Homepage.** Stays on the current pre-redesign state until the graph fix lands. Do **not** ship hide/recover as a permanent solution. An interim RECOVER could ship *only* if there is a business reason to put a comprehension homepage in front of users immediately, and only with grain-1 cards degrading gracefully to a cluster/article view — accepting visible duplicate cards in the meantime.

---

## 9. Build plan and remaining questions

Scoping resolved the extraction path, weighting, and integration (§7). The build, in order:

1. **Entity extraction at ingest** — NER-then-resolve into a new `article_entities(article_id, qid, surface, …)` table, populated by the enrich batch; surface→QID cache reusing the resolver's plumbing.
2. **Windowed IDF** — rolling 14–30d `qid → idf` map, daily recompute, cached for the matcher.
3. **Matcher entity-gate** — `entityOverlap ≥ EVENT_ENTITY_MIN AND cosine ≥ floor` in `qualifies()` and `tryMerge()`, behind `EVENT_ENTITY_MIN` (default 0 = OFF).
4. **Harness validation** — extend the from-empty replay; sweep `EVENT_ENTITY_MIN` ∈ [0.04, 0.08]; gate on no-blob + collapsed-duplicates + low GT-split.
5. **Graph migration** — once validated, a one-time, harness-checked re-cluster that dissolves the blob and consolidates the duplicates.
6. **Homepage relaunch** — re-apply `c9862ef` against the now-coherent graph and ship through the Level-2 visual smoke.

**Remaining questions for the build:**
- NER engine choice (spaCy `en_core_web_sm` vs a JS NER) and the no-entity fallback for short/quote-only articles.
- IDF window length and recompute cadence — tuned on the harness.
- Wikidata resolution cost/latency under load; cache hit-rate; offline-resolution fallback if the API is slow.
- Multilingual NER deferred until non-English share is non-trivial (≈0% today); capitalized fallback meanwhile, resolving to the same QIDs.
