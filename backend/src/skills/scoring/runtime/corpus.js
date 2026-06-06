/**
 * corpus.js — loads the scoreable source set for the scoring runtime (B.6.4a).
 *
 * Predicate (Q6): editorial RSS sources only — source_type='rss' AND url IS NOT NULL
 * (YouTube-type sources have no editorial domain → excluded), minus a small aggregator
 * denylist. Aggregators like Hacker News have the domainResolver artifact (their article
 * URLs point off-domain, so the editorial domain can't be resolved); posture-aware
 * aggregator-substitution is a B.6.5 concern, so for now they are name-excluded.
 */

import { getDb } from "../../../models/database.js";

// Name-based aggregator exclusion (source_posture is not yet populated). The
// domainResolver artifact (#B.6.5) makes these unscoreable until posture-substitution.
export const AGGREGATOR_DENYLIST = ["Hacker News"];

const SCOREABLE_SQL = `
  SELECT id, name, url, category, region
  FROM sources
  WHERE source_type = 'rss' AND url IS NOT NULL
  ORDER BY id
`;

/**
 * loadScoreableSources(db) → [{id, name, url, category, region}]
 * Editorial RSS sources, excluding the aggregator denylist.
 */
export function loadScoreableSources(db = getDb()) {
  const deny = new Set(AGGREGATOR_DENYLIST.map((n) => n.toLowerCase()));
  return db.prepare(SCOREABLE_SQL).all().filter((s) => !deny.has(String(s.name).toLowerCase()));
}
