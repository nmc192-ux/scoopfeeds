/**
 * 2.1.c byline cross-check (B.6.2b-4) — resolves the RSS-gap `pending` rows the
 * own-DB 2.1.c module (bylines_2_1_c) leaves when a feed omits <author>.
 *
 * It RESOLVES THE SAME "2.1.c" sub_criterion in place (upgrades B.6.2a's
 * pending row) — it does NOT create a competing sub-criterion. Its own module
 * id ("2.1.c-page-xcheck") exists only so the runner can schedule it; the gather
 * upserts "2.1.c" directly and returns null (a no-op sentinel the runner skips),
 * so no separate evidence row is written.
 *
 * Ordering (deliverable #3 decision): registered AFTER bylines_2_1_c, and it
 * READS the cached "2.1.c" row — so ordering is handled by the cache, not strict
 * loop position: it acts only when "2.1.c" is currently pending(rss-metadata-gap),
 * whether that pending was written earlier this run or in a prior pass. Because
 * it returns null (no own cache row), its cheap guard (one cache read) re-runs
 * every pass and re-resolves whenever bylines re-sets pending at its 30d TTL —
 * so a page-resolved value is never left clobbered.
 *
 * Q6: ≥1 byline-present sampled page → EVIDENCED, value records the page ratio
 *     (5/5 is stronger than 1/5). Q7: pages sampled, NO byline markup found →
 *     honest LOW-confidence EVIDENCED with an rss-and-page-both-absent flag
 *     (never confident "never", never pending-forever, never pending-llm —
 *     byline detection is deterministic DOM). ALL fetches failed → leave "2.1.c"
 *     pending (a fetch failure is not a byline absence) and retry next run.
 *
 * Budget: opens its OWN budgeted site (≤5 article-page fetches), separate from
 * the structure pass's ≤7 — robots + SSRF enforced by siteFetch. Evidence-only.
 */

import { EVIDENCE_STATUS, round2 } from "../contract.js";
import { getEvidence, upsertEvidence } from "../evidenceCache.js";
import { openSite } from "../siteFetch.js";
import { detectByline } from "../bylineDetect.js";

const TARGET_ID = "2.1.c";
const DEFAULT_SAMPLE = 5;

function normName(s) {
  return String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
}

// A detected author that matches the publisher/source name is NOT a reporter
// byline — §2.1.c measures NAMED REPORTERS, and an outlet stamping its own name
// ("Al Jazeera") is not that. Match on equality OR containment (to catch
// "Al Jazeera" vs "Al Jazeera English"), with a ≥4-char guard so a short source
// name can't trivially swallow real names. The rare solo-operator case
// (org name IS the person) defers to B.6.3 judgment.
function isPublisherName(author, sourceName) {
  const a = normName(author);
  const s = normName(sourceName);
  if (!a || !s) return false;
  if (a === s) return true;
  const shorter = a.length <= s.length ? a : s;
  if (shorter.length < 4) return false;
  return a.includes(s) || s.includes(a);
}
const SAMPLE_SQL = `
  SELECT url FROM articles
  WHERE source_name = ? AND is_duplicate = 0 AND url IS NOT NULL
  ORDER BY published_at DESC
  LIMIT ?
`;

export default {
  id: "2.1.c-page-xcheck",
  component: "ET",
  ttlDays: 30, // governed in practice by the "2.1.c" pending state (see header)
  needsDiscovery: false, // fetches article URLs directly; no homepage discovery

  async gather(source, ctx) {
    const db = ctx.db;
    const cur = getEvidence(source.id, TARGET_ID, db);

    // Act ONLY on the RSS-gap pending state. Already evidenced (RSS or a prior
    // page-resolve), unavailable, or not-yet-computed → no-op, NO fetches.
    if (!cur || cur.status !== EVIDENCE_STATUS.PENDING || cur.value?.signal !== "rss-metadata-gap") {
      return null;
    }

    const n = ctx.bylineSampleSize ?? DEFAULT_SAMPLE;
    const rows = db.prepare(SAMPLE_SQL).all(source.name, n);
    if (rows.length === 0) return null; // nothing to sample → leave pending

    const site = await openSite(source, { ...ctx, maxFetchesPerSource: n });
    if (!site.ok) return null; // no editorial domain / unreachable → leave pending

    let fetched = 0;
    let bylined = 0;          // pages with a genuine REPORTER byline
    let publisherStamped = 0; // pages whose "author" is just the publisher name
    let firstSignal = null;
    let sampleAuthor = null;
    let firstBylinedUrl = null;
    for (const r of rows) {
      const res = await site.fetch(r.url);
      if (!res.ok) continue; // blocked/timeout/budget — skip this page
      fetched += 1;
      const b = detectByline(res.doc);
      if (!b.found) continue;
      if (isPublisherName(b.value, source.name)) {
        // Publisher-name-as-author → not a reporter byline; don't count it.
        publisherStamped += 1;
        continue;
      }
      bylined += 1;
      if (!firstSignal) { firstSignal = b.signal; sampleAuthor = b.value; firstBylinedUrl = res.finalUrl || r.url; }
    }

    // ALL fetches failed → couldn't complete the check; a fetch failure is NOT a
    // byline absence. Leave "2.1.c" pending; retry next run.
    if (fetched === 0) return null;

    const ratio = round2(bylined / fetched); // genuine reporter bylines / fetched
    let resolved;
    if (bylined > 0) {
      // Q6 — at least one page names a real reporter; the feed merely dropped it.
      const confidence = round2(Math.min(0.9, (0.3 + 0.6 * ratio) * Math.min(1, fetched / 3)));
      resolved = {
        status: EVIDENCE_STATUS.EVIDENCED,
        value: {
          ratio,
          bylined,
          publisherStamped,
          sampled: fetched,
          via: "article-page",
          pageSignal: firstSignal,
          sampleAuthor,
          bucket: ratio >= 0.95 ? "always" : ratio >= 0.6 ? "usually" : "sometimes",
          ...(publisherStamped > 0 ? { note: `${publisherStamped} page(s) carried only the publisher name as author and were not counted as reporter bylines.` } : {}),
        },
        confidence,
        evidenceUrl: firstBylinedUrl,
        gatheredAt: ctx.now,
      };
    } else {
      // Q7 — no genuine reporter byline found. Honest LOW confidence: a real if
      // weak signal, NEVER a confident "never". Distinguish the two causes:
      //   - publisher-name-only: pages stamp the outlet's own name, not reporters
      //   - rss-and-page-both-absent: no recognizable byline markup at all
      const publisherOnly = publisherStamped > 0;
      resolved = {
        status: EVIDENCE_STATUS.EVIDENCED,
        value: {
          ratio: 0,
          bylined: 0,
          publisherStamped,
          sampled: fetched,
          via: "article-page",
          bucket: "inconclusive",
          flag: publisherOnly ? "publisher-name-author-only" : "rss-and-page-both-absent",
          note: publisherOnly
            ? `Sampled article pages carried only the publisher's own name as author (${publisherStamped} page(s)), not named reporters. Weak signal — not a confident 'never'.`
            : "Sampled article pages; no recognizable byline markup (meta / JSON-LD / itemprop / rel / class). Weak signal — not a confident 'never'.",
        },
        confidence: 0.2,
        evidenceUrl: null,
        gatheredAt: ctx.now,
      };
    }

    // Resolve the SAME 2.1.c row in place.
    upsertEvidence(source.id, TARGET_ID, resolved, ctx.methodologyVersion, db);
    return null; // wrote "2.1.c" directly; no separate tracking row
  },
};
