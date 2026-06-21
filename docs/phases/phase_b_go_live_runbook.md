# Phase B — Go-Live Runbook
### Event-Graph Integrity + Comprehension Homepage

**Status:** pre-deployment. Full stack committed to `main`, all flags OFF (prod-neutral). Prod (Hostinger) untouched.

---

## Governing principle

All validation to date was **from-empty replay** — the matcher building a clean graph from scratch with the entity system enabled. **Prod is not empty.** Its durable graph was built by the old matcher and still contains the over-merge blob. So the spine of this runbook is:

> Validate the *migration* of the existing prod graph on a **fresh snapshot** before enabling anything on prod, then enable in a fixed order, with a full DB backup as the restore-point before the first graph-mutating step.

---

## The committed stack (all flags default OFF)

| Layer | Commit | Flag (default) |
|---|---|---|
| Entity extraction (ingest) | `6fb4eb2`, `0259dcf` | `ENTITY_EXTRACTION_ENABLED` (OFF) |
| Windowed entity IDF | `a78e89c` | `ENTITY_IDF_ENABLED` (OFF) |
| Entity-overlap gate (matcher) | `63e1adf` | `EVENT_ENTITY_MIN` (0 = OFF) |
| Entity-aware breaker (curative, scheduler-wired + detach) | `5cf0706`, `694d12f` | `EVENT_BREAKER_ENABLED`, `EVENT_BREAKER_DETACH` (OFF); `EVENT_BREAKER_MAX_PASSES`=6; `EVENT_MATCH_TAU`=0.78 |
| Display-layer grouping (render) | `9ee2c3a` | `HOMEPAGE_GROUPING` (OFF) |
| Migrations (additive empty tables) | 008 / 009 / 010 | — |

Comprehension homepage redesign: `c9862ef` (currently reverted via `a614599`; re-appliable). Consumes `related[]` from grouped `/api/events`.

> **Flag-OFF = prod-neutral.** With every flag off, the deployed code is behaviorally identical to today and the migrations only add empty tables. Nothing changes until flags are flipped, in order.

---

## Phases

### Phase 0 — Bank the code ✓ (done)
Full stack on `main`, flags OFF. The 3b-2 merge trigger is reverted/discarded (proven dead end).

### Phase 1 — Fresh-snapshot migration validation *(the gate everything hinges on)*
1. **Re-pull a current prod snapshot.** On Hostinger, take a `.backup` of the live `news.db`, copy it down, and replace the (weeks-stale) `backend/data/prod-snapshot.db` (gitignored).
2. On a **COW copy** of this snapshot, run the full enable sequence (extraction backfill → IDF → gate → breaker → grouping) via the replay/validation harness.
3. **Confirm:**
   - (a) the existing blob event **cleans up** — the breaker splits it, the gate prevents re-merge;
   - (b) the rest of the live graph **survives** — coherent events stay coherent, dossier ids stable, no mass churn;
   - (c) display-grouping yields the **shippable homepage** on this real graph.
4. **Possible spawn:** if the blob does *not* self-clean (the breaker fires on re-clustering; a fully-blended durable blob may sit stuck), build a one-time **re-cluster migration script** and re-validate.

- **No prod risk** (COW; read-only on prod).
- **GATE:** blob dissolved, coherent events + dossier ids preserved, homepage shippable. *Do not proceed until green.*

### Phase 2 — Wire the breaker into the scheduler
- The breaker (`5cf0706`) is committed but only ever run via the harness — it is **not** called in the live cycle. Add the post-promotion call in the scheduler/promoter cycle behind `EVENT_BREAKER_ENABLED`. Commit (flag OFF).
- Validate the wired path on COW reproduces the harness-tested behavior.
- **GATE:** flag OFF → scheduler unchanged; flag ON (COW) → breaker runs as validated.

### Phase 3 — Deploy code to Hostinger (flags OFF)
- Deploy `main`. Migrations 008/009/010 run (add empty tables). Prod behavior unchanged.
- **GATE:** migrations applied cleanly; flags confirmed OFF; homepage byte-identical to pre-deploy (smoke).
- **ROLLBACK:** `git revert` + redeploy — trivial while flag-OFF.

### Phase 4 — Ordered enablement on prod *(the actual go-live)*
> **Take a full prod DB backup before 4c** — the restore-point for the first graph-mutating step.

- **4a. Entity extraction + backfill.** Set `ENTITY_EXTRACTION_ENABLED`. The enrich batch populates `article_entities` going forward; run the **backfill** over the existing ~33k corpus for history. **Long pole** — batch rate + Wikidata rate limits; plan for hours, run off-peak. **GATE:** `article_entities` coverage ≥ ~99%.
- **4b. Entity IDF.** Set `ENTITY_IDF_ENABLED`. Run/await the IDF recompute (needs `article_entities` populated). **GATE:** `entity_idf` populated, `cat_span` computed and sane (spot-check a known hub has high `cat_span`).
- **4c. Gate + breaker.** Set `EVENT_ENTITY_MIN > 0` and `EVENT_BREAKER_ENABLED`. The matcher now uses entities; the breaker splits the existing blob. The blob dissolves on the FIRST enabled cycle (the sweep converges within-cycle, bounded by `EVENT_BREAKER_MAX_PASSES`=6); steady-state is ~2 small splits/cycle. **GATE:** blob dissolved, new matching coherent, dossier ids stable, no oscillation. *(Backup taken before this step.)*
- **4d. Display grouping.** Set `HOMEPAGE_GROUPING`. Facet cards consolidate. **GATE:** Iran → one card (+ related), distinct stories separate, lead coherent.
- **4e. Re-apply the comprehension homepage.** Re-apply `c9862ef` on the now-coherent + grouped graph (it consumes `related[]`). **GATE:** homepage renders the redesign and leads coherently.

### Phase 5 — Level-2 visual smoke + go / no-go
- Eyeball the **live** homepage: coherent lead, Iran consolidated, distinct stories separate, dossiers resolve, no blob, no thrash.
- **Decision:** relaunch or hold.

---

## Rollback posture
- Every layer is flag-gated → flip any flag **OFF** to disable it.
- The comprehension homepage re-apply is **git-revertible** (as it was once before).
- The one thing that is **not** a simple flag-flip-back is the durable graph re-clustering from 4c — covered by the **pre-4c full prod DB backup** (restore point). Keep-core preserves dossier ids through enablement, so dossier URLs survive.

---

## Deferred / off the critical path
- **Entity-disjoint guard** on the breaker/grouping confirm (for the 2 benign near-duplicate market-filler fusions): later, only-if-needed. It reaches back for the entity signal proven unreliable across three levers, so avoid unless a real user complaint surfaces.
- **`stash@{0}`** (superseded Phase 2/3b matcher edits): droppable anytime.
- **Promote the faithful replay harness** (`_phase2b_replay.mjs`) to a committed location (e.g. `backend/scripts/`): non-urgent, but it is the validation bed for Phase 1 and currently lives only as an untracked working-tree file.

---

## Reference — what "done" looks like
The incoherent over-merge blob no longer exists in the durable graph; the homepage leads with a coherent real story; the Iran-class macro-stories present as a single card with facets as `related[]`; distinct same-domain stories remain separate cards; every card resolves to a stable durable dossier; and none of it required a fragile threshold — the cluster-window arbiter carries the grouping, and the durable graph is never mutated at render.

---

## Execution log

**Phase 0 — Bank the code: DONE.** Full stack on `main`, flags OFF.

**Phase 1 — Migration validation: VALIDATED (GREEN).** On a COW of the fresh prod snapshot (1807a/16c blob — the real present-day graph), enabling the entity system dissolves the blob in place to a coherent ~324a Iran event, 100% id-stability (all live durable ids retained, dossier URLs survive), 0 collateral splits, no new blob over 3 forward cycles. The curative breaker is a viable migration mechanism — **no Phase 1b re-cluster migration needed.** (Backfill: 3,393 articles, 99.7% coverage; IDF 5,043 keys.)

**Phase 2 — Scheduler wiring + singleton-detach: DONE** (`694d12f`, flags OFF). The breaker runs to convergence as a post-promotion curative sweep over active events (`EVENT_BREAKER_ENABLED`); `detachOrphans()` un-events orphans that are both entity-disjoint and cosine-far (`EVENT_BREAKER_DETACH`). Validated on COW: blob → 278a/9c clean (46 orphans detached / 0 from the Iran core, 20/20 spot-check foreign), ids 100% stable, no re-absorb, homepage clean.

**Next:** Phase 3 — deploy `main` to Hostinger flags-OFF.
