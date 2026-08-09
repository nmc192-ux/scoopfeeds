# Code vs docs reconciliation — 2026-08

GROUND exercise: read-only, four parallel passes over the whole documentation set against
shipped code. Nothing was modified. Every claim below cites `file:line`. Where a check
required prod data or the prod `.env`, it is marked **unverified** rather than inferred.

Companion to `docs_gap_analysis_2026-08.md` (doc-vs-doc drift). This one is doc-vs-code.

**Headline:** the docs are broadly honest, but they are wrong in both directions — some
things are described as built that are not, and **several significant capabilities are built
and filed as deferred**. The second kind is more expensive: it hides finished work.

---

## 1. Things that are DONE but the docs say otherwise

### 1.1 The Tracker Auto-Detection Engine shipped. STATE_OF_PLAY lists it as deferred.
`STATE_OF_PLAY.md:103` files "Tracker Auto-Detection Engine and tracker surfaces" under
*Deferred capabilities*. It is live: `realityIndex/intelligence/trackerDetector.js` (589
lines, **all 8 detectors**, self-documented at `:501` "all 8 detectors implemented as of
Sprint 1.3.3b"), DAO `models/trackers.js`, migration `005_tracker_instances.js`, API
`routes/trackers.js`, cron `scheduler.js:296`, frontend `pages/TrackerPage.jsx` +
`components/trackers/`. This is a headline Phase B capability sitting in the "not built" bin.

### 1.2 Multi-language UI ships. The README says it's Phase E.
`README` says Arabic/Russian/Mandarin are "on the Phase E roadmap". `frontend/src/locales/`
contains **10 locales** (en, ur, ar, de, es, fr, hi, ja, pt, zh) and RTL is flagged for
`ur`/`ar` in both `lib/languages.js:25` and `lib/i18n.js:23`.

### 1.3 `EVENT_ENTITY_MAX_CATSPAN` hazard is already fixed.
`STATE_OF_PLAY.md:114-116` still lists it as an open config hazard. Split on 2026-07-20:
sole reader `storyAffinity.js:46` (default 3); the signature path reads its own
`EVENT_SIGNATURE_MAX_CATSPAN` (`eventPromoter.js:84`). `env_reference.md:20-24` already
records the fix — STATE_OF_PLAY simply wasn't updated.

### 1.4 Bot-facing SSR exists; open item 8 implies none does.
`routes/seo.js` (~1400 lines, mounted `server.js:454`) does UA-sniffed SSR with NewsArticle
JSON-LD for `/article/:id` and `/topic/:slug`, plus sitemaps/robots/RSS. **The real gap is
narrower and worse than stated: there is no `/events/:slug` handler and no event URLs in
either sitemap** — the dossiers, the product's distinctive surface, are invisible to crawlers.

## 2. Things the docs claim that the code contradicts

### 2.1 `EVENT_UNIFIED_AFFINITY` is a retired flag still tabled as live prod config.
`env_reference.md` lists it first in the matcher table with prod `true`. **Zero
`process.env` readers exist** — retired 2026-07-20, legacy paths deleted
(`storyAffinity.js:38-39`, `.env.example:317`). `EVENT_BREAKER_DISJOINT` is likewise dead
(commented at `.env.example:351`, no readers) but documented without a tombstone.

### 2.2 Earn-render has one undocumented exception.
`dossier_and_event_graph.md:23` says every section below the header renders only with real
data. **Timeline renders a placeholder on empty** — "No timeline entries yet — check back as
the story develops" (`EventDossier.jsx:225-228` legacy, `:351-354` A6). Either the rule has
an exception or the component does.

### 2.3 "One measure" is actually two gates.
The doc's §2 says promoter/merge/breaker all read one affinity measure. A **`MERGE_COSINE_FLOOR`
centroid veto runs before the band check on every merge** (`eventPromoter.js:416`), and a
**coherence contract** (`isIncoherent`, `AFFINITY_MIN_CORE_KEYS`, newborn exemptions —
`storyAffinity.js:51-54,134-142`) gates which events can attract clusters at all. Neither
appears in the doc. Both are load-bearing.

### 2.4 `chainStoryline` is a function, not a module.
`eventPromoter.js:123`. Both the architecture doc and `CLAUDE.md` list it under
`intelligence/` as if it were a file.

### 2.5 Phase A exit verification (May) contains at least three claims the code refutes.
"No `/scoop-ops/metrics` route exists" — `routes/metrics-ops.js` exists. "3.1 raw_signals NOT
STARTED" — `003_drop_raw_signals.js` exists. "`phase_b_kickoff_brief.md` does not exist" — it
does, 537 lines, real scope. The July correction caught the pattern; the May document was
never amended in place, so it still misleads anyone who reads it directly.

## 3. Open items — all eight verified STILL REAL

Verified against code, so `/plan` can spec them without re-grounding from zero:

| # | Item | Status | Key evidence |
|---|---|---|---|
| 1 | Markets GROUND | **Still real — worse than documented** | No status/staleness filter anywhere: `marketMatcher.js:129-138` filters on liquidity only; rerank prompt never sees `end_date` (`:97-127`); `deactivateMarket` (`dal/marketsDao.js:130`) has **zero callers**; bindings never re-evaluated (`dal/linksDao.js:68-78`); client guard `!m.resolved` can never fire because `resolved` is never set. Fully explains the England–France sighting. |
| 2 | Merge-survivor `last_activity_at` | Still real, exactly as described | `eventPromoter.js:445-463`; `markMerged` (`:355`) touches only the absorbed row; `touchActivity` (`:339`) is called on absorb (`:529`) but not merge. One-liner is correct. |
| 3 | Machine-event quarantine | Still real | `usgsEarthquakeFetcher.js:70`, `noaaAlertsFetcher.js:90` insert first-class `active` events. Guard is per-query and inconsistent — real in `eventTimelineBuilder.js:133`, only an `ORDER BY` tiebreak in `eventActorExtractor.js:189`, **absent** from the public list/prominence queries (`routes/events.js:280-322`). |
| 4 | W2.1 floor recalibration | Still real | `eventPromoter.js:104` default `0`; guard needs `> 0` (`:428`). Decision-time `minSide` instrumentation is in place (`:439,456-461`), so the corpus should now exist. |
| 5 | Wave 3 | Still real; blob dissolution **partially done** | Husk *prevention* shipped (`eventPromoter.js:470-473,517-539`) but nothing deletes ~172 existing husks; `migrations/011:22-24` explicitly declines. Dissolution mechanism is live (`coherenceGuard.js`, `eventBreaker.js:429`). Summary repair is protection-only (`:550-560`), no backfill. |
| 6 | Gates (b) + (c) | Still real | (a) shipped (`migrations/016`, `llmQueue.js:85-124`). (b) is explicit provider selection, still auto-detecting at `llmQueue.js:34-63`. (c) has no table, no persisted cost; `getLlmBudgetStatus()` (`:127-136`) has **zero callers**. **New finding: gate (a) is bypassed by the three biggest spenders** — `videoSpecWriter.js`, `scriptWriter.js`, `igSummaryService.js` call Gemini via axios without `consumeLlmBudget`. |
| 7 | Sprint 3 hygiene | Still real; single-source floor partial | Junk faucet: no code. Prominence unchanged (`routes/events.js:111-113,317-321`). Floor is **frontend-only and sections-only** (`HomePage.jsx:20,107,137`) — Top Stories and `sort=prominence` have none, so the documented defect is still reachable. `EditorialPolicyPage.jsx:69` claims behaviour no ranking code implements. |
| 8 | A4 SSR + SEO | Still real, narrower | See 1.4. No React SSR, no code-splitting (`App.jsx:148-187` eager imports). |

Narrow-title corollary: still real, untreated — only a `title_cluster_size` size-guard exists
(`eventPromoter.js:325,544-549`).

## 4. Config drift — the fresh-deploy hazard

**~9 load-bearing flags where the code default reverts prod behaviour.** If prod's `.env`
were lost or a new host were provisioned from `.env.example`, the platform would silently
run an older, worse product:

| Flag | Code default | Prod | Effect if lost |
|---|---|---|---|
| `ENTITY_EXTRACTION_ENABLED` | false | set | **Highest blast radius** — entity feed to affinity dies, whole matcher degrades (`scheduler.js:825`) |
| `EVENT_BREAKER_ENABLED` / `_DETACH` | false | true | Curative splitter stops; blobs accrete (`eventBreaker.js:23,25`) |
| `EVENT_CLOSE_ENABLED` | false | true | Dormant events never close; re-absorb resumes (`eventPromoter.js:46`) |
| `EVENT_FACETS_PERSIST` | false | true | `event_facets` stops being written → **ANGLES vanishes and looks correct** by earn-render (`eventBreaker.js:32`) |
| `STORYLINE_ENABLED` | false | true | Chaining stops (`eventPromoter.js:50`) |
| `EVENT_ENTITY_MIN` | 0 | 0.05 | Signature-write gate disables (`eventPromoter.js:66`) |
| `VIDEO_MAX_PER_DAY` | 4 | 12 | **Cascades to three throttles** — min-interval 1.6h→4.8h (`videoAutopost.js:120`), FB cap 12→4 (`:139`) |
| `VIDEO_AUTOPOST_ENABLED` | off | 1 | Video goes dark silently (`videoAutopost.js:123`) |
| `SCOOP_PERSISTENT_DATA_DIR` | `backend/data` | `/var/lib/scoop` | **DB inside deploy dir → next redeploy destroys `news.db`** |

**Same var, different defaults in different modules** — the bug class the docs already warn
about, with a live instance nobody has flagged:
`GEMINI_GENERATION_MODEL` defaults to `gemini-2.5-flash` in `llmQueue.js:183`,
`analysisService.js:47`, `liveEvents.js:42` — and `gemini-3.1-flash-lite` in
`videoSpecWriter.js:82`, `igSummaryService.js:35`, `scriptWriter.js:62`. Prod's single line
masks it; without it the platform runs **two generation models at once**.
Also: `routes/social.js:394` hardcodes a Facebook page id as a fallback.

**Scale of undocumented config:** ~320 distinct `process.env` reads in shipped source;
**~222 undocumented**. Load-bearing omissions include `ENABLE_SCHEDULER`, `USE_BULLMQ`,
`DATABASE_PRIMARY`, `ENABLE_AUTO_SOCIAL` / `ENABLE_BREAKING_PUSH` (**default ON**),
`METER_ENABLED`/`METER_FREE_LIMIT` (the paywall), `ALLOWED_ORIGINS`,
`VIDEO_AUTO_APPROVE_ALLOW_SILENT` (publishes audio-less video), and the
`EVENT_CAROUSEL_MIN_*` reader-facing earn-render thresholds (`eventsDao.js:74`).

**Unverified:** the duplicated `STORYLINE_ENABLED` in prod `.env` (lines 53/59). The code
side is clean — exactly one reader. Needs eyes on the prod file.

## 5. Strategic capabilities — measured

| Capability | Real | Notes |
|---|---|---|
| Event stream + source matrix | **~35%** | 110 RSS in `config/sources.js`. **All three matrix axes are unimplemented**: categories are product tags not the 17 strategic ones; `region` is `"global"` on 98 of 110 rows; `source_type` is `CHECK (source_type IN ('rss','youtube'))` (`migrations/002:56`) — a transport flag, not the 10 strategic types. Scoring cron registered **disabled** (`scheduler.js:193-203`). |
| Dossier + Tracker engine | **~75%** | See 1.1 — better than documented. |
| Reality Index (multi-source) | **~20%** | Polymarket only. No Kalshi, Metaculus, or AI-estimate source; no cross-source aggregation. Decision 11's four sources are one. |
| Distribution | **~40%** | Six platforms publish. **X does not** — `xPostDigest.js` emails a copy-paste list. **Telegram does not exist in the backend at all.** One newsletter (`digest.js:117`), plan requires three. Web push is real; there is no rules-based alert engine. |
| Scoop search | **~10%** | FTS5 keyword only (`models/database.js:576-751`). **Zero Brave, zero Exa, zero multi-model answers** — grep returns nothing. |

## 6. Invisible gaps — in the plan, absent from code AND from the deferred list

These are the dangerous ones. Deferred is a decision; invisible is an accident.

1. **Telegram.** Three Phase B exit criteria depend on it, including "≥5,000 subscribers".
   Zero backend code. Not deferred, not queued — and the amendments separately record
   Telegram as "unstable in Pakistan", the core market.
2. **The source-matrix axes.** The deferred list says "expand ~110 → 150 sources". Reaching
   150 would still not satisfy the criterion, because the taxonomy doesn't exist.
3. **Source discovery / enrichment / editorial-review services** (Phase B brief §3.1, §3.2,
   §3.4) — the entire Decision-16 weekly onboarding loop. No code, no mention anywhere.
4. **Track 2 architectural exit criteria** (§8.2): skill-contract docs, lint-enforced skill
   boundaries, image/video isolation POC. `backend/src/skills/` contains only `scoring/`.
5. **Track 3 performance sprints 0–3** (Cache-Control immutable, CDN edge, s-maxage/SWR).
6. **Op-ed aggregation MVP** — exit criterion "op-eds on ≥80% of major events". No
   ideological-tagging or op-ed-ingest code.
7. **Carried-forward Phase A criteria**: CSP still disabled verbatim
   (`server.js:154` `helmet({ contentSecurityPolicy: false })`); `dependencies.md` still has
   **18 TBD** markers; criteria 7 (social audit) and 8 (search audit) have no artifact.

## 7. What to do with this

Cheapest first, and each is J-Loop-sized:

1. **Move the tracker engine out of "deferred"** in STATE_OF_PLAY and say what remains
   (template library, activation count). One edit; stops the plan understating itself.
2. **Tombstone the two retired flags** in `env_reference.md`; add the
   `GEMINI_GENERATION_MODEL` split-default to the hazards list. One edit.
3. **Narrow open item 8** to its true form: "`/events/:slug` has no bot SSR and no sitemap
   entries" — a much smaller, more shippable statement than "no SSR".
4. **Fix gate (a) bypass** — three services spend the most and skip the budget. Small,
   and it makes the cost rail mean something.
5. **Add the invisible gaps to the deferred list** (§6). Deferring is fine. Forgetting is not.
6. **Correct the May Phase A verification in place**, or mark it superseded, so its three
   false claims stop misleading readers.

Two items deserve their own decision rather than a queue slot: **Telegram** (three exit
criteria resting on a channel with no code and a flagged reliability problem) and the
**source-matrix taxonomy** (a target that cannot be met by adding sources).
