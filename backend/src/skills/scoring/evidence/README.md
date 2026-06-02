# skills/scoring/evidence — the evidence-gathering layer (B.6.2)

The layer that gathers per-sub-criterion **evidence** for the Source Scoring
Service. Established in Sprint **B.6.2a** with the framework + the two own-DB
sub-criteria; extended by later sub-sprints.

> This README documents the evidence-module **contract**, which is the
> precedent for every future sub-criterion. It is a new file (not an edit to
> the skill's top-level `README.md`) so B.6.2a stays greenfield.

## The reframe: evidence, not scores

No methodology component is fully deterministic — each of the five has ≥1
LLM-required sub-criterion (deferred to B.6.3). So this layer produces
**per-sub-criterion evidence with explicit status**, and **never writes
`sources.quality_score`**. A partial combined score would be dishonest
precision (Finding #99/#100). The headline score waits until every component is
complete (B.6.3).

## The evidence-module contract (PRECEDENT)

Every sub-criterion is a module exporting:

```js
{
  id:        "2.1.c",     // sub-criterion id
  component: "ET",        // ET | MT | DE | Ind | HA
  ttlDays:   30,          // re-gather only when the cached row is older
  gather(source, ctx) {   // → Evidence (sync or async)
    return {
      status:      "evidenced" | "pending-llm" | "unavailable" | "blocked",
      value:       <JSON-serializable measure>,
      confidence:  0..1,
      evidenceUrl: <provenance URL | null>,   // null for own-DB criteria
      gatheredAt:  <unix ms>,
    };
  },
}
```

`ctx` is **injected by the runner** — `{ db, now, sampleSize, methodologyVersion }`.
Modules **never** import `getDb` or read the clock directly, which keeps them
pure and unit-testable against a temp DB.

**Status semantics:** `evidenced` (real, trustworthy value) · `pending` (a value
was computed but is inconclusive from this source and needs deterministic
corroboration — e.g. 2.1.c: a low/absent RSS byline is *unknown, not negative*;
it awaits a B.6.2b article-page cross-check) · `pending-llm` (deterministic part
done, judgment awaits B.6.3) · `unavailable` (needed data absent) · `blocked`
(external fetch refused/timed out — B.6.2b+ only).

**2.1.c RSS-gap honesty:** the byline signal is asymmetric — a *present* byline
is reliable positive evidence (high ratio → `evidenced`), but *absence* in RSS
is unknown, not negative (many feeds omit the author field). A low ratio is
therefore `pending` with an `rss-metadata-gap` flag, never a confident "never".

## Adding a sub-criterion

1. Write `modules/<name>_<id>.js` conforming to the contract.
2. Append it to `registry.js`.
3. Add a test. Nothing else changes — the runner + cache + TTL handle it.

## Files

| File | Role |
|---|---|
| `contract.js` | The contract: status constants, sample-size default, shape validator, helpers. |
| `evidenceCache.js` | DAO over `scoring_evidence_cache` (Migration 007): get / list / upsert / staleness. |
| `registry.js` | The list of registered modules. |
| `runner.js` | Runs modules for a source / all sources; TTL-aware; failure-isolated; evidence-only. |
| `modules/bylines_2_1_c.js` | 2.1.c byline ratio (own-DB). |
| `modules/sustainedCoverage_2_3_c.js` | 2.3.c sustained coverage (own-DB). |
| `index.js` | Framework public entry point. |

## Caching & staleness

`scoring_evidence_cache` holds one current row per (source, sub-criterion). The
runner re-gathers a sub-criterion only when its cached row is missing or older
than the module's `ttlDays` — so a weekly run doesn't re-scrape stable evidence
(ownership, corrections pages) every week. Distinct from `scoring_audit_log`
(Migration 006), which records scoring-run outputs, not gathered facts.

## Scope (B.6.2a)

**In:** the framework (contract, cache DAO, registry, runner) + the two own-DB
sub-criteria (2.1.c, 2.3.c) — zero external fetch.

**Deferred:** B.6.2b site-scraping (reuse `routes/reader.js`'s axios + linkedom
+ UA-rotation + error-taxonomy pattern), B.6.2c structured-data lookup
(Wikidata / SEC EDGAR / Companies House), B.6.2d link-ratio. The runner +
contract already accommodate async fetching modules.
