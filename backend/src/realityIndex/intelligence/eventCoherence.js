/**
 * eventCoherence — #179. "Does this event actually hold ONE story?"
 *
 * The audit found a dossier presenting 216 unrelated articles as one event.
 * This module scores that, and gates new attachments against it.
 *
 * NO SECOND SIMILARITY MEASURE. Everything here is storyAffinity's measure
 * (idf-weighted containment over hub-filtered entity keys) and its bands:
 *
 *   core(event)          = storyAffinity's coreSet — keys present in at least
 *                          CORE_FRAC of the event's members;
 *   member is coherent   ⇔ affinity(member's own keys, core).band !== FOREIGN;
 *   coherence(event)     = coherent members / members that HAVE entity keys.
 *
 * So "coherence 0.6" reads as "60% of the members share the event's core
 * entities", which is the audit's wording, measured on the same instrument the
 * promoter, merge and breaker already use.
 *
 * UNMEASURED IS NOT A PASS AND NOT A FAIL. A member with no entity keys is not
 * counted either way. An event with fewer than MIN_MEASURED keyed members
 * scores `null` — the gate never acts on null, and the API reports
 * `level: null`, not "ok". An event with enough keyed members but an EMPTY core
 * (no key shared by CORE_FRAC of them — the 216-article blob) scores 0.
 *
 * KNOWN LIMIT, stated so it is not oversold: the core admits every key held by
 * at least CORE_FRAC (30%) of members, so an event that is already two stories
 * split 50/50 reads as coherent on this score. Preventing that mix from forming
 * is the gate's job (the core is taken from the EXISTING members, so the second
 * story arrives FOREIGN and is held); splitting one that already formed is the
 * breaker's, on the same measure.
 *
 * The gate is OFF unless EVENT_COHERENCE_GATE=true (read at call time). The
 * floor (EVENT_COHERENCE_FLOOR, default 0.60) is the audit's suggestion; the
 * GROUND run that should calibrate it is `scripts/coherence-report.mjs`.
 */

import { affinity, BANDS, buildAffinityCtx } from "./storyAffinity.js";

export const DEFAULT_FLOOR = 0.6;
export const MIN_MEASURED = 3;

/** Read at call time, so a flip needs no rebuild and tests can toggle it. */
export function coherenceGateOn() {
  return String(process.env.EVENT_COHERENCE_GATE ?? "false").toLowerCase() === "true";
}
export function coherenceFloor() {
  const f = Number.parseFloat(process.env.EVENT_COHERENCE_FLOOR ?? "");
  return Number.isFinite(f) && f >= 0 && f <= 1 ? f : DEFAULT_FLOOR;
}

/**
 * Per-member hub-filtered key sets for many articles in one batched query.
 * Same hub filter as storyAffinity's entitySet (ctx.keepKey), without one query
 * per member. Unlike entitySet there is no TOPK trim: a single article's keys
 * are few. Members without keys are simply absent from the map.
 */
export function memberKeySets(ctx, db, ids) {
  const out = new Map();
  if (!ids?.length) return out;
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const ph = chunk.map(() => "?").join(",");
    for (const r of db.prepare(`SELECT DISTINCT article_id, COALESCE(qid, surface_norm) k FROM article_entities WHERE article_id IN (${ph})`).all(...chunk)) {
      if (!ctx.keepKey(r.k)) continue;
      let s = out.get(r.article_id);
      if (!s) { s = new Set(); out.set(r.article_id, s); }
      s.add(r.k);
    }
  }
  return out;
}

/** Is one member's key set coherent with a core? null = unmeasured. */
export function memberCoherent(ctx, keySet, core) {
  if (!keySet?.size || !core?.size) return null;
  return affinity(ctx, keySet, core).band !== BANDS.FOREIGN;
}

/** Tally coherent / measured over ids against a core. */
function tally(ctx, sets, ids, core) {
  let coherent = 0, measured = 0;
  for (const id of ids) {
    const keys = sets.get(id);
    if (!keys?.size) continue;            // no entity keys → unmeasured, not counted
    measured++;
    if (memberCoherent(ctx, keys, core)) coherent++; // empty core → never coherent
  }
  return { coherent, measured };
}

// An EMPTY core over enough keyed members is the degenerate case storyAffinity's
// isIncoherent already names: nothing is shared, so no member is coherent → 0,
// not null. null is reserved for "too few keyed members to say".
const ratio = ({ coherent, measured }, coreSize) =>
  (measured >= MIN_MEASURED ? (coreSize ? coherent / measured : 0) : null);
const round3 = (x) => (x === null ? null : Math.round(x * 1000) / 1000);

/**
 * Coherence of one event's member set.
 * → { score: number|null, measured, coherent, members, coreSize }
 */
export function eventCoherence(ctx, db, memberIds, { core = null, sets = null } = {}) {
  const ids = memberIds ?? [];
  const c = core ?? ctx.coreSet(ids);
  const s = sets ?? memberKeySets(ctx, db, ids);
  const t = tally(ctx, s, ids, c);
  return { score: round3(ratio(t, c.size)), measured: t.measured, coherent: t.coherent, members: ids.length, coreSize: c.size };
}

/** Reader-facing level for a score. */
export function coherenceLevel(score, floor = coherenceFloor()) {
  if (score === null || score === undefined) return null;
  return score < floor ? "low" : "ok";
}

/**
 * The attach gate. Given an event's current members and the articles about to
 * be linked into it, decide which incoming articles to hold out.
 *
 *   - The event's core is computed from its EXISTING members only, so the
 *     incoming batch cannot redefine what the story is about.
 *   - projected = coherence of (existing ∪ incoming) against that core.
 *   - projected ≥ floor, or unmeasured → link everything (today's behaviour).
 *   - projected < floor → hold out exactly the incoming articles that are
 *     FOREIGN to the core; incoming articles with no keys are kept (unmeasured
 *     is not evidence of foreignness).
 *
 * For a NEW event (no existing members) pass existingIds = [] and the core is
 * the incoming batch's own core: the gate then removes the batch's own
 * outliers before the event is minted.
 *
 * → { keep: string[], held: string[], before, projected, after }
 */
export function gateAttach(ctx, db, { existingIds, incomingIds, floor = coherenceFloor() }) {
  const existing = [...(existingIds ?? [])];
  const have = new Set(existing);
  const incoming = [...new Set(incomingIds ?? [])];
  const fresh = incoming.filter((id) => !have.has(id));
  const base = existing.length ? existing : incoming;
  const core = ctx.coreSet(base);
  const sets = memberKeySets(ctx, db, [...new Set([...existing, ...fresh])]);

  const before = existing.length ? round3(ratio(tally(ctx, sets, existing, core), core.size)) : null;
  const all = [...existing, ...fresh];
  const projected = round3(ratio(tally(ctx, sets, all, core), core.size));

  // No core → nothing to be FOREIGN to; holding would need a story to compare
  // against. (An established event with no core cannot attract anyway —
  // storyAffinity.isIncoherent.)
  if (!fresh.length || !core.size || projected === null || projected >= floor) {
    return { keep: incoming, held: [], before, projected, after: projected };
  }
  const held = fresh.filter((id) => memberCoherent(ctx, sets.get(id), core) === false);
  const heldSet = new Set(held);
  const keep = incoming.filter((id) => !heldSet.has(id));
  const after = round3(ratio(tally(ctx, sets, [...existing, ...fresh.filter((id) => !heldSet.has(id))], core), core.size));
  return { keep, held, before, projected, after };
}

// ── Dossier read path ───────────────────────────────────────────────────────
// buildAffinityCtx loads the whole entity_idf table, so the read path shares
// one ctx per DB handle for CTX_TTL_MS. The idf window moves on the hour, not
// per request, so a few minutes' staleness changes no band.
const CTX_TTL_MS = 10 * 60 * 1000;
const ctxCache = new WeakMap(); // db → { ctx, at }
function readCtx(db, now) {
  const hit = ctxCache.get(db);
  if (hit && now - hit.at < CTX_TTL_MS) return hit.ctx;
  const ctx = buildAffinityCtx(db);
  ctxCache.set(db, { ctx, at: now });
  return ctx;
}

/**
 * The dossier's coherence block. Off with EVENT_COHERENCE_API=false (kill
 * switch; default on — it is an additive API field, nothing renders it yet).
 * → { score, level: "ok"|"low"|null, floor, measured, members } | undefined
 */
export function dossierCoherence(db, eventId, { now = Date.now() } = {}) {
  if (String(process.env.EVENT_COHERENCE_API ?? "true").toLowerCase() === "false") return undefined;
  const ids = db.prepare("SELECT article_id FROM event_articles WHERE event_id = ?").all(eventId).map((r) => r.article_id);
  const r = eventCoherence(readCtx(db, now), db, ids);
  const floor = coherenceFloor();
  return { score: r.score, level: coherenceLevel(r.score, floor), floor, measured: r.measured, members: r.members };
}
