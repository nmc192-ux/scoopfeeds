/**
 * standing.js — #208 items 8-9: watch the channel's standing; on anything new, PAUSE, end the broadcast
 * cleanly, and alert DrJ. Resume is by hand only (rm ~/scoopfeeds-radio/PAUSE): nothing here removes it.
 *
 * WHAT CAN AND CANNOT BE READ (honesty rule: unread is "unknown", never "OK"):
 *   YouTube Data API v3, readable:  the channel exists / the account is suspended or closed (error reasons);
 *     channel status (longUploadsStatus "disallowed" follows strikes and live restrictions); each live
 *     broadcast's lifeCycleStatus ("revoked" = YouTube cut it); the broadcast video's rejectionReason
 *     ("copyright", "termsOfUse", ...) and region blocks.
 *   NOT readable through any API ScoopFeeds can use: Content ID claim counts, copyright strike counts,
 *     community-guideline warnings (Content ID API = partners only). These stay `null` = unknown, and the
 *     weekly line says "unknown". They reach the watchdog only as NOTICES (below).
 *   X: no API is used. Read from the playout's outputs.json (#207) when present: X refused for 15 min while
 *     YouTube stayed live = X ended or refused the broadcast. Otherwise unknown.
 *   NOTICES: any file dropped in ~/scoopfeeds-radio/notices/ named youtube-*.txt or x-*.txt (by DrJ, or a
 *     session that reads his email: YouTube and X send claim/strike/takedown emails) is an incident; its
 *     text is the reason.
 *
 * Pure functions (readStanding with injected clients, incidents, standingLine) + respond() with injected
 * side effects, so the tests drive a simulated claim end to end without a network.
 */
import fs from "node:fs";
import path from "node:path";

export const X_REFUSED_MS = 15 * 60_000;
const ACCOUNT_REASONS = /^(accountSuspended|accountClosed|accountDisabled|channelSuspended|channelClosed|channelNotFound|youtubeSignupRequired|accountDelegationForbidden|authenticatedUserAccountSuspended|authenticatedUserAccountClosed)$/;

/** Read everything readable. Never throws: what fails is recorded as unread. */
export async function readStanding({ yt = null, baseDir, now = Date.now(), prevActive = [] } = {}) {
  const snap = { at: now, youtube: { read: false, error: null, account: null, channel: null, broadcasts: [], videos: {}, strikes: null, claims: null, warnings: null }, x: { read: false, state: null, note: null }, notices: [] };

  if (yt) {
    try {
      snap.youtube.channel = await yt.channelStatus();
      snap.youtube.account = snap.youtube.channel.found ? "active" : "missing";
      snap.youtube.broadcasts = await yt.listBroadcasts("active");
      // a broadcast that was live last pass and is not now: read its own state ("revoked" = YouTube cut it)
      for (const id of prevActive) {
        if (snap.youtube.broadcasts.some((b) => b.id === id)) continue;
        snap.youtube.broadcasts.push({ id, title: "", life: await yt.broadcastState(id).catch(() => null), gone: true });
      }
      const ids = snap.youtube.broadcasts.map((b) => b.id);
      snap.youtube.videos = ids.length ? await yt.videoStatus(ids) : {};
      snap.youtube.read = true;
    } catch (e) {
      snap.youtube.error = String(e.message || e).slice(0, 300);
      if (ACCOUNT_REASONS.test(String(e.reason || ""))) { snap.youtube.account = "suspended"; snap.youtube.read = true; }
    }
  } else snap.youtube.error = "YouTube API not configured (RADIO_YT_*)";

  // X, from the playout's per-output status (#207), when it exists
  try {
    const o = JSON.parse(fs.readFileSync(path.join(baseDir, "outputs.json"), "utf8"));
    const x = o?.outputs?.find?.((d) => d.id === "x") || (o?.outputs?.x ? { id: "x", ...o.outputs.x } : null);
    const yts = o?.outputs?.find?.((d) => d.id === "youtube") || null;
    if (x) {
      snap.x.read = true; snap.x.state = x.state || null;
      const down = x.state && x.state !== "live" && x.state !== "off" && x.state !== "shed";
      const ytLive = yts?.state === "live";
      const since = Number(x.since) || null;
      if (down && ytLive && since && now - since >= X_REFUSED_MS) snap.x.note = `X has refused the stream for ${Math.round((now - since) / 60_000)} min while YouTube stayed live${x.lastError ? ` (${String(x.lastError).slice(0, 120)})` : ""}`;
    }
  } catch { /* no outputs.json: X unknown */ }

  // notices
  const nd = path.join(baseDir, "notices");
  try {
    for (const n of fs.readdirSync(nd).filter((f) => /^(youtube|x)-.*\.txt$/i.test(f)).sort()) {
      snap.notices.push({ name: n, platform: n.toLowerCase().startsWith("x-") ? "X" : "YouTube", text: fs.readFileSync(path.join(nd, n), "utf8").trim().slice(0, 500) });
    }
  } catch { /* no notices dir */ }
  return snap;
}

/** What is NEW in `cur` relative to `prev` (the last saved snapshot), in plain English. */
export function incidents(prev, cur) {
  const out = [];
  const py = prev?.youtube || {}, cy = cur.youtube;
  if (cy.account === "suspended" && py.account !== "suspended") out.push(`YouTube reports the account as suspended or closed (${cy.error || "no detail"}).`);
  if (cy.account === "missing" && py.account === "active") out.push("The YouTube channel is no longer returned for this account.");
  const was = py.channel?.longUploadsStatus, is = cy.channel?.longUploadsStatus;
  if (is === "disallowed" && was !== "disallowed") out.push("YouTube now disallows long uploads on the channel. This usually follows a strike or a live-streaming restriction.");
  const seenRevoked = new Set((py.broadcasts || []).filter((b) => b.life === "revoked").map((b) => b.id));
  for (const b of cy.broadcasts || []) if (b.life === "revoked" && !seenRevoked.has(b.id)) out.push(`YouTube revoked the live broadcast "${b.title}" (${b.id}).`);
  for (const [id, v] of Object.entries(cy.videos || {})) {
    const pv = py.videos?.[id] || {};
    if (v.rejectionReason && v.rejectionReason !== pv.rejectionReason) out.push(`YouTube rejected broadcast ${id}: ${v.rejectionReason}.`);
    if ((v.regionBlocked || []).length && !(pv.regionBlocked || []).length) out.push(`Broadcast ${id} is now blocked in ${v.regionBlocked.length} region(s), which usually means a copyright claim.`);
  }
  for (const k of ["strikes", "claims", "warnings"]) if (Number.isFinite(cy[k]) && cy[k] > (Number(py[k]) || 0)) out.push(`New YouTube ${k}: ${cy[k]} (was ${Number(py[k]) || 0}).`);
  if (cur.x.note && !prev?.x?.note) out.push(`${cur.x.note}.`);
  const seen = new Set((prev?.notices || []).map((n) => n.name));
  for (const n of cur.notices) if (!seen.has(n.name)) out.push(`${n.platform} notice (${n.name}): ${n.text || "no text"}`);
  return out;
}

const u = (v) => (v == null ? "unknown" : String(v));
/** The weekly standing line for the daily report. Anything not read says "unknown", never "OK". */
export function standingLine(s) {
  const y = s?.youtube || {};
  const channel = !y.read ? "unknown" : y.account === "suspended" ? "SUSPENDED" : y.account === "missing" ? "channel not found" : y.channel?.longUploadsStatus === "disallowed" ? "restricted (long uploads disallowed)" : "in good standing as far as the API shows";
  const strikes = Number.isFinite(y.strikes) ? `${y.strikes}/3` : "unknown/3";
  const live = !y.read ? "unknown" : (y.broadcasts || []).some((b) => b.life === "revoked") ? "a broadcast was revoked" : "no live restriction seen";
  const x = !s?.x?.read ? "unknown" : s.x.note ? "refusing the stream" : `stream ${s.x.state}`;
  const notices = (s?.notices || []).length;
  return `Radio standing: YouTube channel ${channel} · strikes ${strikes} · open claims ${u(y.claims)} · live ${live} · X account ${x}${notices ? ` · ${notices} notice(s) on file` : ""}`;
}

/**
 * Act on incidents: PAUSE first (so nothing new starts), then end broadcasts cleanly, stop the 24/7
 * playout, alert. Each step is injected; a failing step is logged and the next one still runs.
 */
export async function respond(found, { baseDir, yt = null, broadcasts = [], stopRadio = async () => {}, alert = async () => {}, log = () => {}, now = Date.now() }) {
  if (!found.length) return { acted: false };
  const reason = found.join(" ");
  const pause = path.join(baseDir, "PAUSE");
  try { fs.mkdirSync(baseDir, { recursive: true }); fs.writeFileSync(pause, `${new Date(now).toISOString()} standing watchdog: ${reason}\nResume by hand only: read the alert, then rm ${pause}\n`); log(`PAUSE written: ${pause}`); }
  catch (e) { log(`could not write PAUSE: ${e.message}`); }
  const ended = [];
  if (yt) for (const b of broadcasts) {
    if (b.life !== "live" && b.life !== "testing") continue;
    try { await yt.transition(b.id, "complete"); ended.push(b.id); log(`ended broadcast ${b.id}`); } catch (e) { log(`could not end broadcast ${b.id}: ${e.message}`); }
  }
  try { await stopRadio(); log("24/7 playout stop done"); } catch (e) { log(`could not stop the 24/7 playout: ${e.message}`); }
  const msg = `ScoopFeeds Radio is PAUSED. ${reason} ${ended.length ? `Ended ${ended.length} live broadcast(s).` : "No live broadcast was ended."} Nothing resumes until you remove ~/scoopfeeds-radio/PAUSE by hand.`;
  try { await alert(msg); } catch (e) { log(`alert failed: ${e.message}`); }
  return { acted: true, reason, ended, msg };
}

/**
 * One watchdog pass: read, compare with the saved BASELINE, act, save. The baseline keeps the last
 * successful YouTube reading, so a pass that cannot read YouTube neither raises nor forgets anything.
 */
export async function watchOnce({ baseDir, yt = null, stopRadio, alert, log = () => {}, now = Date.now() }) {
  const stateFile = path.join(baseDir, "standing.json");
  let saved0 = {};
  try { saved0 = JSON.parse(fs.readFileSync(stateFile, "utf8")) || {}; } catch { /* first run */ }
  const prev = saved0.baseline || null;
  const prevActive = (prev?.youtube?.broadcasts || []).filter((b) => !b.gone && (b.life === "live" || b.life === "testing")).map((b) => b.id);
  const cur = await readStanding({ yt, baseDir, now, prevActive });
  const found = incidents(prev, cur);
  const r = await respond(found, { baseDir, yt, broadcasts: cur.youtube.broadcasts, stopRadio, alert, log, now });
  if (!cur.youtube.read && cur.youtube.error) log(`YouTube standing not read this pass: ${cur.youtube.error}`);
  const line = standingLine(cur);
  const baseline = { ...cur, youtube: cur.youtube.read ? cur.youtube : (prev?.youtube || cur.youtube), x: cur.x.read ? cur.x : (prev?.x || cur.x) };
  const saved = { updatedAt: now, line, snapshot: cur, baseline, lastIncident: r.acted ? { at: now, reason: r.reason } : saved0.lastIncident ?? null };
  try { fs.mkdirSync(baseDir, { recursive: true }); fs.writeFileSync(`${stateFile}.tmp`, JSON.stringify(saved, null, 1)); fs.renameSync(`${stateFile}.tmp`, stateFile); }
  catch (e) { log(`could not save ${stateFile}: ${e.message}`); }
  log(line);
  return { found, line, ...r };
}
