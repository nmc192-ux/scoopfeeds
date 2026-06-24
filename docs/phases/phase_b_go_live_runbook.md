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

### Phase 3 — Deploy code to Hostinger (flags OFF) — DONE
**Prod run model (actual):** Hostinger **LiteSpeed Node** — a single `lsnode` process, **not** Docker (docker is not installed on the box). The committed `Dockerfile` / `docker-compose.production.yml` describe an intended container model that prod does not currently use.
- **App dir:** `nodejs/` under the `scoopfeeds.com` domain root.
- **Live DB:** `news.db` (~8 GB) under the account's persisted data dir (outside the web root).

**Deploy mechanism (actual):** hPanel → **Deployments → "Settings and Deploy"** (Hostinger Git deploy; pulls the repo via the `scoop`→`scoopfeeds` 301 redirect). It advances the checkout to `origin/main` and **resets local working-tree edits to committed versions** — the local `scripts/*.sh` tweaks were discarded (confirmed not load-bearing).

**Migrations:** auto-apply on restart (`getDb` → `runMigrations`, idempotent via `schema_migrations`). 008/009/010 applied against the live DB — **new empty tables only; existing data untouched.**

**Delta deployed:** `66e1bfb → afdcfa8` = the entity stack (all flags default OFF) + docs. Verified clean / near-neutral; one new npm dep (`compromise`) is present but **not exercised until Phase 4a**.

- **GATE (met):** migrations applied cleanly; flags confirmed OFF/inert; site healthy (homepage 200, health 200).
- **ROLLBACK:** redeploy a prior commit via the same Git-deploy flow — trivial while flag-OFF.

> **Known issue (tracked).** `stderr.log` shows a Rust/tokio panic — *"OS can't spawn worker thread (os error 11)"* — a background worker hitting Hostinger's process/thread cap. **Not affecting the live site** (homepage/health return 200). **Investigate the thread ceiling before the Phase 4a backfill** (the backfill adds concurrent work and must not trip the same limit).

### Phase 4 — Ordered enablement on prod *(the actual go-live)*
> **Take a full prod DB backup before 4c** — the restore-point for the first graph-mutating step.

> **Env / flags mechanism (pinned).** Prod has **no `backend/.env`**; runtime env is injected by the hPanel Node.js app config. The loader (`backend/src/config/env.js`) **also** reads a persistent file at `$HOME/.scoopfeeds.env` (outside the repo → survives Git deploys) and sets a key **only if not already in `process.env`**. `ENABLE_SCHEDULER=true` is set in prod, so the single LiteSpeed-Node process runs the scheduler/enrich cycle. **Phase-4 flags belong in `$HOME/.scoopfeeds.env`**; they take effect on app restart. **CAUTION:** a restart briefly double-runs the app → watch the LVE ceiling; recover with hPanel stop/start if forking fails.

- **4a. Entity extraction + working-set backfill (OFF-HOST).**
  - **Constraint found:** running extraction inside the live web process is **not viable on this host.** At `ENTITY_EXTRACTION_BATCH=50` in the enrich cycle, extraction load + the brief process double-up at restart pushed the account past its **CloudLinux LVE process/memory ceiling** — the shell hit `fork: Resource temporarily unavailable` and SSH login was refused until a clean hPanel stop/start (via redeploy) reaped the pile-up. The public site stayed **200** throughout (the app serves on its event loop; only forking *new* processes failed). Same ceiling is behind the earlier tokio thread-spawn panic and the reason video rendering was offloaded to GitHub Actions.
  - **Resolution:** `ENTITY_EXTRACTION_ENABLED` stays **OFF** on prod. Extraction runs **off-host** on a copy of the prod DB (Mac, no LVE ceiling); the populated entity tables then **sync up to prod as a pure bulk-insert** (no NER, no Wikidata calls on the host).
  - **Scope:** go-live working set = **vectorized recent-3d ∪ event-members** (the Phase-1 set, ~3,209), newest-first — exactly what the matcher/breaker/IDF consume. The full historical corpus (~23.5k) is optional completeness, deferrable (~5–6 h off-host at ~865 ms/article; cache trims only the Wikidata tail, ~15–20%).
  - **Status — backfill DONE (off-host):**
    - Local copy = the gitignored copy of the snapshot. Pilot (300) + working-set (3,206) = **3,506 processed.**
    - Working-set coverage **3,209 / 3,209 = 100%**; QID resolution **78%** (pilot 75%); **46 min** wall, **~865 ms/article** warm. Prod untouched (snapshot pristine).
    - **SYNC TO PROD — DONE & VERIFIED.** Built a **2 MB sync DB** locally (3 tables; `article_entities` sans the autoincrement `id` so prod re-assigns — dedup is on the unique key `(article_id, COALESCE(qid,surface_norm))`), transferred, loaded on prod via atomic `INSERT OR IGNORE` (`BEGIN IMMEDIATE` + `busy_timeout=30000`; lock-tolerant, LVE-safe — 2 MB of finished rows, zero compute on host).
      - **Prod pre-load:** 0/0/0 (tables empty — the aborted flag-on run wrote nothing → clean first load).
      - **Prod post-load (VERIFIED):** `article_entities`=**14,283**, `surface_qid_cache`=**10,361**, `article_entity_processed`=**3,506**, `resolved_qids`=**11,048 (77%)** — exact match to the local working set. Site stayed **200** throughout.
      - **Rollback (unused):** `DELETE FROM` the 3 tables (inert until 4c).
    - `ENTITY_EXTRACTION_ENABLED` remains **OFF** on prod; tables inert behind the matcher gate (4c, OFF).
  - **GATE (met):** `article_entities` covers the working set on prod (100% of the ~3,209).

> **Host / LVE note.** The transfer hit the CloudLinux LVE ceiling a **3rd time** — SSH/SCP refused (*"connection reset / closed by remote host"*) under process/memory pressure; a redeploy did **not** clear it; it cleared only after a **Hostinger resource boost**, after which `scp` succeeded. The pattern (tokio panic → extraction fork-storm → SSH/SCP refusal) makes the **VPS migration** (Hostinger KVM: root, real process headroom, Docker for the committed stack, no LVE wall) increasingly **non-optional**. Scope it before 4b/4c add scheduler-side entity load.
>
> **Ongoing-extraction gap.** In-process extraction stays **OFF**, so **new articles ingested going forward get no entities** — matcher coverage is the synced working set, **not self-updating**. Fine for go-live validation, but "keep new stories covered" is **unsolved on this host** (in-process = the LVE wall). This is the **strongest driver for the VPS migration** — scope it before relying on the matcher long-term.
- **4b. Entity IDF — DONE & VERIFIED.**
  - **Mechanism:** the `entity_idf` recompute is **pure SQL** (windowed `COUNT` + `GROUP BY` over `article_entities ⨝ articles`, atomic table-replace) — light and host-safe, **not** the LVE risk extraction was. The scheduler recompute is **cron-only** (daily 03:30); there is **no run-at-startup**, so `entity_idf` was **pre-populated via a one-shot** so the matcher (4c) never reads an empty table.
  - **Run:** a one-shot ran the committed `runEntityIdfRecompute()` against the **live DB** (no restart). **NOTE:** the app runs on **alt-nodejs18** (better-sqlite3 `NODE_MODULE_VERSION 108`) — a standalone node one-shot must use the alt-nodejs18 node binary and set `SCOOP_PERSISTENT_DATA_DIR` explicitly (standalone procs don't inherit hPanel-injected env; the login shell has no node on `PATH`).
  - **Result (VERIFIED on prod):** `entity_idf` keys=**5,101**, `n_window`=**2,637** (windowed subset of the 3,506 synced — older/pruned rows correctly drop out), idf range **1.77–7.88** (=`ln(N)` ceiling at df=1), max `cat_span`=**14**. Common keys (Q668 India, Q794 Iran, Q30 USA) correctly **low-idf**; hubs (Q30 span 14, Q794 span 11) carry **high cat_span** for the matcher to down-weight (3b-1b). Known benign noise: unresolved site-name boilerplate ("day first show news") is high-df → low-idf → self-discounting, no action.
  - **Flag:** `ENTITY_IDF_ENABLED=true` appended to `$HOME/.scoopfeeds.env` (arms the daily 03:30 cron; takes effect on next restart). **No restart performed in 4b.** `ENTITY_EXTRACTION_ENABLED` stays `false`.
  - **GATE (met):** `entity_idf` populated, `cat_span` computed and sane (hubs high, common-entity rarity low).
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

**Phase 3 — Deploy to prod (flags OFF): DONE.** Deployed `afdcfa8` via Hostinger Git deploy (`66e1bfb → afdcfa8`) onto the **LiteSpeed Node** run model (single `lsnode` process, not Docker). Migrations 008/009/010 applied on restart (new empty tables only; existing data untouched); site healthy (homepage 200, health 200); all flags OFF/inert. **Known:** a Rust/tokio thread-spawn panic (*os error 11*) from a background worker hitting the host's thread cap — env/resource, non-blocking to the live site.

**Phase 4a (off-host extraction) — backfill DONE, sync pending.** Confirmed in-process extraction is **not viable** (LVE ceiling: `fork` exhaustion at batch 50 + restart double-up; site stayed 200; recovered via hPanel stop/start). Pivoted **off-host**: working set **3,209 / 3,209 = 100%**, 78% resolved; prod untouched; `ENTITY_EXTRACTION_ENABLED=OFF` on prod. Env mechanism mapped (`$HOME/.scoopfeeds.env`, deploy-safe; `ENABLE_SCHEDULER=true`).

**Phase 4a — COMPLETE** (extraction off-host + sync to prod). **VERIFIED on prod: 14,283 / 10,361 / 3,506** (`article_entities` / `surface_qid_cache` / `article_entity_processed`), resolved **11,048**; prod **200** throughout; `ENTITY_EXTRACTION_ENABLED=OFF`. The transfer cleared an LVE block via a Hostinger resource boost (redeploy did not clear it).

**Phase 4b — COMPLETE.** `entity_idf` pre-populated + validated on prod (**5,101 keys / n_window 2,637 / idf 1.77–7.88 / cat_span ≤ 14**; hubs + rarity sane). Daily-refresh armed (`ENTITY_IDF_ENABLED=true`, cron 03:30, applies next restart). No restart; LVE untouched. App runtime = **alt-nodejs18** (pinned for server-side one-shots).

**Next:** **4c** (entity matcher gate + curative breaker) — the **first behavior-changing + graph-mutating step**. **Requires:** full DB backup first; a **restart** (LVE flashpoint — use hPanel stop/start, watch for double-up); **before/after homepage validation** (the honest gate). Recommend a **fresh session + cooperative connection**. Then **4d** (`HOMEPAGE_GROUPING`) → **4e** (re-apply homepage). **VPS scoping recommended before 4c** if doing it on this host.
