/**
 * incidentDigest.js — the daily review, and the only review there now is.
 *
 * DrJ's Ruling 1 removed pre-publication human verification. What stands in its
 * place is this: everything published with incident media in the last 24 hours,
 * with source links and the checks' own evidence, in one place that can be
 * scanned in five minutes.
 *
 * IT MUST BE EFFORTLESS OR IT WILL NOT HAPPEN — DrJ's words, and the design
 * constraint that matters most here. So:
 *
 *   THE UNREVIEWED ITEMS COME FIRST. A digest sorted by time buries the one
 *     candidate that was waved on beneath nine that passed cleanly. Anything
 *     auto-resolved leads, and says which check was waved on and what that
 *     check had actually found.
 *   EVERY LINE CARRIES ITS SOURCE LINK. Post-hoc review means opening the
 *     original post; a digest that describes a video without linking it makes
 *     the reviewer go hunting, and hunting is what does not happen at 8am.
 *   KILLS ARE SHOWN TOO, briefly. They are the evidence the machine is still
 *     refusing things, which is what makes the passes credible.
 *
 * Read-only. It reports what happened; it changes nothing.
 */

import { logger } from "../logger.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Everything with incident media that reached publication in the window, plus
 * what was killed, plus — first — what proceeded without ever being settled.
 */
export function collectDigest(db, { since = Date.now() - DAY_MS, now = Date.now() } = {}) {
  const rows = db.prepare(`
    SELECT c.id, c.platform, c.post_url, c.poster_handle, c.poster_display,
           c.status, c.kill_reason, c.clearance_basis, c.story_kind, c.story_id,
           c.media_type, c.constructed_video_id, c.created_at
    FROM media_candidates c
    WHERE c.created_at >= ?
    ORDER BY c.created_at DESC
  `).all(since);

  const events = db.prepare(`
    SELECT candidate_id, ts, from_status, to_status, check_name, actor, evidence
    FROM media_candidate_events
    WHERE ts >= ?
    ORDER BY ts ASC
  `).all(since);

  const byCandidate = new Map();
  for (const e of events) {
    if (!byCandidate.has(e.candidate_id)) byCandidate.set(e.candidate_id, []);
    let evidence = null;
    try { evidence = e.evidence ? JSON.parse(e.evidence) : null; } catch { evidence = null; }
    byCandidate.get(e.candidate_id).push({ ...e, evidence });
  }

  const items = rows.map((r) => {
    const trail = byCandidate.get(r.id) || [];
    // A check the machine could not settle, waved on by auto mode. This is the
    // only thing in the digest that represents an unmeasured decision.
    const auto = trail.filter((t) => t.actor === "auto" || t.evidence?.autoResolved);
    return {
      id: r.id,
      platform: r.platform,
      postUrl: r.post_url,
      poster: r.poster_display || r.poster_handle || null,
      status: r.status,
      killReason: r.kill_reason,
      clearanceBasis: r.clearance_basis,
      mediaType: r.media_type,
      videoId: r.constructed_video_id,
      createdAt: r.created_at,
      autoResolved: auto.map((a) => ({
        check: a.check_name,
        // What the check actually FOUND, before it was waved on. Without this
        // the digest is a list of things that look decided.
        machineVerdict: a.evidence?.machineVerdict ?? null,
        machineReason: a.evidence?.machineReason ?? null,
        note: a.evidence?.note ?? null,
      })),
    };
  });

  // UNREVIEWED FIRST, then published, then killed. Time order buries the one
  // item that needs a human under nine that do not.
  const rank = (i) => (i.autoResolved.length ? 0 : i.status === "killed" ? 2 : 1);
  items.sort((a, b) => rank(a) - rank(b) || b.createdAt - a.createdAt);

  return {
    since, now,
    total: items.length,
    unreviewed: items.filter((i) => i.autoResolved.length).length,
    published: items.filter((i) => i.status !== "killed" && i.constructedVideoId !== null).length,
    killed: items.filter((i) => i.status === "killed").length,
    items,
  };
}

/** Plain text, because it has to be readable wherever it is delivered. */
export function renderDigest(d) {
  const when = new Date(d.since).toISOString().slice(0, 16).replace("T", " ");
  const out = [
    `INCIDENT MEDIA — 24h to ${new Date(d.now).toISOString().slice(0, 16).replace("T", " ")}Z`,
    `${d.total} candidate(s) since ${when}Z · ${d.unreviewed} proceeded UNREVIEWED · ${d.killed} killed`,
    "",
  ];
  if (!d.items.length) { out.push("Nothing with incident media in the window."); return out.join("\n"); }

  for (const i of d.items) {
    const flag = i.autoResolved.length ? "⚠ UNREVIEWED" : i.status === "killed" ? "✕ KILLED   " : "· published ";
    out.push(`${flag} ${i.platform}${i.poster ? ` @${i.poster}` : ""}${i.videoId ? ` → youtube:${i.videoId}` : ""}`);
    out.push(`   ${i.postUrl}`);
    if (i.status === "killed") out.push(`   killed: ${i.killReason || "unstated"}`);
    for (const a of i.autoResolved) {
      // The whole point of the line: what was NOT measured, and what the check
      // had found when it gave up.
      out.push(`   waved on: ${a.check} — machine said ${a.machineVerdict || "?"}` +
        `${a.machineReason ? ` (${a.machineReason})` : ""}${a.note ? ` · ${String(a.note).slice(0, 90)}` : ""}`);
    }
    if (i.clearanceBasis) out.push(`   basis: ${i.clearanceBasis}`);
    out.push("");
  }
  out.push("Anything above that should not have gone out: reply and it comes down.");
  return out.join("\n");
}

/** Build and log the digest. Never throws — a failed digest must not break a cycle. */
export function emitDigest(db, opts = {}) {
  try {
    const d = collectDigest(db, opts);
    const text = renderDigest(d);
    logger.info(`🎥 incident digest — ${d.total} candidate(s), ${d.unreviewed} unreviewed, ${d.killed} killed\n${text}`);
    return { ...d, text };
  } catch (err) {
    logger.warn(`🎥 incident digest failed — ${String(err?.message).slice(0, 140)}`);
    return null;
  }
}
