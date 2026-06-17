/**
 * contract — serializers that produce the canonical Signal contract shapes. Single source of
 * truth for the response shapes, used by BOTH transports (HTTP + MCP) so they stay identical.
 *
 * All timestamps ISO-8601 UTC.
 *
 * Credibility semantics:
 *   - credibility_status is the AUTHORITATIVE scored/unscored signal — read it (not the score's
 *     presence) to decide whether an outlet is scored. Honesty rule: an unscored source renders
 *     credibility_score: null + credibility_status: "unscored" — never 0.0. A genuine 0 score is
 *     preserved (we null-out only true NULL, via `?? null`; status keys off `== null`).
 *   - credibility_version is evaluation PROVENANCE only — "evaluated under version X", NOT "scored".
 *     A version on an UNSCORED source means the B.6 scorer evaluated it but coverage fell below the
 *     floor (evaluated-but-below-floor); it never implies the source was scored.
 *   - Credibility maps to an outlet BY source_name (a string) — articles carry no source_id FK —
 *     so it is fragile to source-name collisions and renames. Known limitation.
 *
 * is_duplicate is a passthrough of the ingest dedup flag (articles.is_duplicate, set by
 * markDuplicateIfSimilar: a higher-credibility/earlier cross-source near-duplicate exists). The
 * service does NOT filter on it — the consumer (Studio) collapses or weights duplicates itself.
 */
import { SCORER_VERSION } from "../skills/scoring/scorer.js";

const iso = (ms) => (ms == null ? null : new Date(Number(ms)).toISOString());
const credStatus = (qs) => (qs == null ? "unscored" : "scored");

export function publicSource(r) {
  return {
    source_id: r.id,
    name: r.name,
    credibility_score: r.quality_score ?? null,
    credibility_status: credStatus(r.quality_score),
    credibility_version: r.quality_score_methodology_version ?? null,
  };
}

export function publicArticle(r) {
  return {
    article_id: r.id,
    source_id: r.source_id ?? null,
    source_name: r.source_name,
    title: r.title,
    lede: r.description ?? null,
    url: r.url,
    published_at: iso(r.published_at),
    fetched_at: iso(r.fetched_at),
    is_duplicate: !!r.is_duplicate,
    credibility_score: r.quality_score ?? null,
    credibility_status: credStatus(r.quality_score),
    credibility_version: r.quality_score_methodology_version ?? null,
  };
}

export function publicHealth(facts) {
  return {
    status: facts.db_connected ? "ok" : "degraded",
    db_connected: facts.db_connected,
    scorer_version: facts.scorer_version ?? SCORER_VERSION,
    scored_source_count: facts.scored_source_count,
    total_source_count: facts.total_source_count,
    served_at: new Date().toISOString(),
  };
}

export function publicArticlesPage(res) {
  return {
    window: res.window,
    count: res.rows.length,
    next_offset: res.next_offset,
    articles: res.rows.map(publicArticle),
  };
}
