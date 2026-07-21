# Environment / feature-flag reference

**Status:** current as of 2026-07-20 (commit `6046e11`). This is the single list — it did
not exist before; `backend/.env.example` documented 77 of the ~262 vars the code reads.

**How to read this**

- **Default** = what the *code* falls back to when the var is unset. Most prod behaviour
  runs on these — prod's `.env` sets only ~57 keys.
- **Prod** = whether the value is explicitly set on the server (`/opt/scoopfeeds/backend/.env`).
  "default" means the code default is in force.
- **Runtime-flip** = safe to change and restart the affected container without a migration
  or rebuild. `build` = frontend build-time (requires a rebuild). `migration` = needs one.
- Booleans are parsed as the literal string `"true"` unless noted; anything else is false.

> ⚠️ **Two live config hazards found during this audit** (not changed — DrJ's call):
> 1. `STORYLINE_ENABLED` appears **twice** in prod `.env` (lines 53 and 59, both `true`).
>    dotenv takes the last one, so editing the first has no effect. Harmless today, a trap later.
> 2. `EVENT_ENTITY_MAX_CATSPAN` is read in **two places with different defaults** — `3` in
>    `storyAffinity.js`, `5` in `eventBreaker.js`'s local entity ctx. Setting it in `.env`
>    silently changes both; leaving it unset means the breaker's legacy path hub-filters
>    differently from everything else.

---

## Event graph — matcher / promoter

| Var | Default | Prod | Runtime-flip | Purpose |
|---|---|---|---|---|
| `EVENT_UNIFIED_AFFINITY` | `false` | **`true`** | yes | Wave 2. One `storyAffinity` measure shared by promoter/merge/breaker. Killed the create-merge-split treadmill. |
| `EVENT_MIN_ARTICLES` | `5` | default | yes | Cluster size (or ≥1 bound market) required to promote an event. |
| `EVENT_MATCH_TAU` | `0.78` | default | yes | Cluster↔event centroid-cosine floor for a match. |
| `EVENT_MERGE_TAU` | `0.86` | default | yes | Event↔event cosine floor confirming a convergence merge. |
| `EVENT_MATCH_COSINE_FLOOR` | = `MATCH_TAU` | default | yes | Override the match cosine floor independently. |
| `EVENT_MERGE_COSINE_FLOOR` | = `MERGE_TAU` | default | yes | Override the merge cosine floor independently. |
| `EVENT_ENTITY_MIN` | `0` (off) | **`0.05`** | yes | Legacy rarity-weighted entity gate. `0` disables. Superseded by unified affinity but still gates signature writes. |
| `EVENT_ENTITY_TOPK` | `40` | default | yes | Top-K rarest entity keys kept per entity set. |
| `EVENT_ENTITY_CORE_FRAC` | `0.3` | default | yes | Key must appear in ≥ this fraction of members to count as "core". |
| `EVENT_ENTITY_MAX_CATSPAN` | `3` / `5` ⚠️ | default | yes | Hub filter: drop entities spanning more than N categories. See hazard #2 above. |
| `EVENT_PROMOTE_MAX_CLUSTER_AGE_MS` | `48h` | default | yes | Only clusters refreshed within this window may spawn NEW events. |
| `EVENT_CLOSE_ENABLED` | `false` | **`true`** | yes | R2a temporal bounds: dormant events eventually close and can never re-absorb. |
| `EVENT_CLOSE_AFTER_MS` | `21d` | default | yes | Inactivity before a dormant event closes. |

### Affinity thresholds (`storyAffinity.js`)

| Var | Default | Prod | Runtime-flip | Purpose |
|---|---|---|---|---|
| `AFFINITY_T_MATCH` | `0.23` | default | yes | ent ≥ this ⇒ AFFINE (attach/merge allowed). |
| `AFFINITY_T_DISJOINT` | `0.19` | default | yes | ent < this ⇒ FOREIGN (breaker may split). Between the two ⇒ AMBIGUOUS, everything holds. |
| `AFFINITY_MIN_CORE_KEYS` | `2` | default | yes | Coherence contract: fewer core keys ⇒ incoherent. |
| `AFFINITY_MIN_CORE_IDF` | `4` | default | yes | Coherence contract: core idf mass floor. |
| `AFFINITY_NEWBORN_MAX_MEMBERS` | `8` | default | yes | Newborn exemption from the incoherence check (R1). |
| `AFFINITY_NEWBORN_MAX_AGE_MS` | `24h` | default | yes | Newborn exemption by age. |

### W2.1 merge floor — **shipped DISABLED, do not enable without recalibration**

| Var | Default | Prod | Runtime-flip | Purpose |
|---|---|---|---|---|
| `EVENT_MERGE_FLOOR_MIN_SIDE` | `0` (**disabled**) | default | yes | Block an AFFINE merge when the smaller side has fewer than N articles. `0` = no-op. |
| `EVENT_MERGE_FLOOR_ENT` | `0.50` | default | yes | The ent below which the thin-side block applies. |

**Why it is off:** calibration on the 2026-07-16 COW showed labeled SAME pairs span
containment **0.248–0.377 — entirely below the 0.50 floor**, so the `ent < 0.50` condition is
always-true for real merges and the floor collapses to "block every thin-sided merge",
including the R1 newborn continuation (0.248 / min-side 5). That would re-open under-merge
churn through the anti-blob door. Recalibrate on the decision-time `(ent, min-side)` corpus
the 🧭 `promoter-merge` line now logs, then set a threshold from real distributions — or
conclude no floor is the honest answer.

## Event breaker + A5 facets

| Var | Default | Prod | Runtime-flip | Purpose |
|---|---|---|---|---|
| `EVENT_BREAKER_ENABLED` | `false` | **`true`** | yes | Curative splitter: spins genuinely foreign sub-clusters out of an event. |
| `EVENT_BREAKER_MIN_ARTICLES` | `6` | default | yes | Minimum members before an event is a breaker candidate. |
| `EVENT_BREAKER_DISJOINT` | `0.06` | default | yes | Legacy (non-unified) core-overlap split threshold. |
| `EVENT_BREAKER_DETACH` | `false` | **`true`** | yes | Trim un-clusterable orphan tails from kept events. |
| `EVENT_BREAKER_MAX_PASSES` | `6` | default | yes | Sweep convergence bound. |
| `EVENT_FACETS_PERSIST` | `false` | **`true`** | yes | A5: persist render-ready facets (`event_facets`). Requires unified affinity. |
| `EVENT_FACET_TAU` | `0.88` | default | yes | **Presentation-only** sub-clustering tau for facets. Does NOT affect the breaker's split decision (still 0.78). |
| `FACET_MIN_ARTICLES` | `5` | default | yes | Earn-render: minimum articles for a facet to qualify. |
| `FACET_MAX_SHARE` | `0.5` | default | yes | A facet holding more than this share of the event is a pseudo-event, not an angle — rejected. |
| `FACET_DEDUP_OVMIN` | `0.5` | default | yes | Member **overlap-over-min** (containment) dedup threshold. Chosen empirically over Jaccard: tombstone duplicates are *nested* accretion stages, where Jaccard misses (0.22–0.25) and overlap-over-min catches (0.5–1.0). |

## Storylines (R2b)

| Var | Default | Prod | Runtime-flip | Purpose |
|---|---|---|---|---|
| `STORYLINE_ENABLED` | `false` | **`true`** ⚠️dup | yes | Chain a new event to a prior episode's storyline. Feeds the dossier ANGLES section. |
| `STORYLINE_MIN` | `0.25` | default | yes | Weighted-Jaccard floor for chaining. |
| `STORYLINE_MIN_SHARED_IDF` | `10` | default | yes | Rare-evidence floor: ≥2 shared keys carrying this idf mass. Prevents the subset-degeneracy failure (a police seizure chained to a singer obituary). |
| `STORYLINE_LOOKBACK_MS` | `90d` | default | yes | How far back to search for a prior episode. |

## Dossier timeline (A6)

| Var | Default | Prod | Runtime-flip | Purpose |
|---|---|---|---|---|
| `EVENT_TL_DEDUP_TAU` | `0.88` | default | yes | Near-dup cosine for grouping articles into one occurrence. |
| `EVENT_TL_DEDUP_WINDOW_H` | `6` | default | yes | **Load-bearing.** Caps an occurrence's time span. Without it, near-dup clustering chains distinct beats across days (78 articles / 100h into one row). At 12h two same-day strike rounds wrongly merged; 6h separates them. |
| `EVENT_TL_MIN_DEDUP` | `4` | default | yes | Below this article count, dedup is a no-op so thin events never over-collapse. |
| `EVENT_TIMELINE_MAX_EVENTS` | `2000` | default | yes | Selection window for the `event_timeline` writer (was a hardcoded 500). See the starvation failure mode in the architecture doc. |

## LLM (gate (a) cost rails — incident closed)

| Var | Default | Prod | Runtime-flip | Purpose |
|---|---|---|---|---|
| `GEMINI_GENERATION_MODEL` | `gemini-2.5-flash` | **`gemini-3.1-flash-lite`** | yes | Pinned generation model. A dead pin returns 404 and falls back deterministically — see `--list-models`. |
| `GEMINI_API_KEY` | — | set | yes | Credential. |
| `LLM_DAILY_CALL_CAP` | `2000` | default | yes | Hard daily ceiling on LLM calls. Part of the cost rails after the gate-(a) incident. |
| `LLM_DISABLED` / `GEMINI_DISABLED` | unset | default | yes | Kill switches; deterministic fallbacks take over. |
| `ANALYSIS_MAX_OUTPUT_TOKENS` | see code | default | yes | Output cap (cost rail). `thinkingBudget` is pinned to 0 in `llmQueue.js`. |
| `ENTITY_EXTRACTION_ENABLED` | `false` | **set** | yes | LLM/NER entity extraction feeding the affinity measure. |
| `ENTITY_EXTRACTION_BATCH` | `100` | **set** | yes | Articles per extraction batch. |
| `ENTITY_IDF_ENABLED` | `false` | default | yes | Maintain the rolling entity-IDF window that all rarity weighting depends on. |
| `ENTITY_IDF_WINDOW_MS` | `30d` | default | yes | IDF rolling window. |
| `ACTOR_EXTRACT_PER_CYCLE` | `25` | default | yes | Events per actor-extraction cycle (ledgered; see migration 016). |

## Frontend (build-time — `VITE_*` requires a rebuild)

| Var | Default | Prod | Runtime-flip | Purpose |
|---|---|---|---|---|
| `VITE_SENTIMENT_ENABLED` | `false` (**hidden**) | default | **build** | Sentiment module. Hidden because it fails comprehensibility, not data sufficiency — see the architecture doc. |

## Scheduler / ingestion

| Var | Default | Prod | Runtime-flip | Purpose |
|---|---|---|---|---|
| `ENABLE_REALITY_INDEX` | `true` | default | yes | Master gate for the whole Reality-Index cron block (markets, promoter, breaker, timeline, actors, sentiment, GDELT/USGS/NOAA/ACLED/FRED). |
| `ENABLE_GDELT` / `ENABLE_USGS` / `ENABLE_NOAA` / `ENABLE_ACLED` / `ENABLE_SPORTSDB` / `ENABLE_TMDB` | varies | varies | yes | Per-source ingestion toggles. **USGS/NOAA create article-less machine events — see the quarantine open item.** |
| `SCOOP_PERSISTENT_DATA_DIR` | `backend/data` | set | restart | SQLite location. Prod: `/var/lib/scoop`. |
| `SCOOP_PROCESS_ROLE` | — | set | restart | `web` \| `worker` \| `scheduler`. Determines which crons a container runs. |
| `HOMEPAGE_GROUPING` | `false` | default | yes | Group homepage cards by story. |
| `HOMEPAGE_GROUP_TAU` | `0.86` | default | yes | Grouping threshold. |

## Undocumented-var audit

`262` distinct `process.env.*` reads in `backend/`; `backend/.env.example` covered `77`.
The behaviour-critical gaps are now covered above and mirrored into `.env.example`. The
remaining undocumented names are third-party credentials and per-integration tuning
(social posting, TTS/video, translation, affiliate IDs) — self-describing, and several are
for features that are off. If you add a var, add it here **and** to `.env.example`.
