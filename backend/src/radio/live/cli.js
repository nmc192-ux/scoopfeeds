#!/usr/bin/env node
/**
 * live/cli.js - the live events desk by hand (#202).
 *   node backend/src/radio/live/cli.js feeds              the allow-list
 *   node backend/src/radio/live/cli.js check <url>        pre-air check: on the allow-list? live, public, no login?
 *   node backend/src/radio/live/cli.js calendar [--fetch] events (manual file; --fetch adds publisher schedules)
 *   node backend/src/radio/live/cli.js audit              the live log: carries, refusals, clips (none over 30 s)
 * Needs yt-dlp and ffprobe on PATH for check / --fetch.
 */
import { OFFICIAL_FEEDS, entryForUrl, assertCanAir, isProposed, awaitingMacCheck, streamMonetised } from "./officialFeeds.js";
import { probeFeed } from "./feedProbe.js";
import { loadManualEvents, fetchPublisherEvents, mergeCalendar, eventsFile, airsAutomatically } from "./eventsCalendar.js";
import { createLiveLog, liveLogDir } from "./liveLog.js";
import { auditClipLog } from "./socialClips.js";

const [cmd, ...rest] = process.argv.slice(2);
const out = (x) => console.log(typeof x === "string" ? x : JSON.stringify(x, null, 2));

if (cmd === "feeds") {
  out(`RADIO_STREAM_MONETISED: ${streamMonetised() ? "on (nonCommercialOnly feeds refused)" : "off"}`);
  for (const f of OFFICIAL_FEEDS) {
    const tags = [isProposed(f) ? "PROPOSED, cannot air" : null, f.nonCommercialOnly ? "non-commercial only" : null, awaitingMacCheck(f) ? "AWAITING MAC CHECK" : null].filter(Boolean);
    out(`${f.id.padEnd(16)} ${f.publisher}  [${[...(f.youtube || []), ...(f.pages || [])].join(", ")}]${tags.length ? `  (${tags.join("; ")})` : ""}  ${f.why}`);
  }
} else if (cmd === "check") {
  const url = rest[0];
  if (!url) { console.error("usage: check <url>"); process.exit(2); }
  const probe = await probeFeed(url);
  const entry = entryForUrl(url, { probe });
  let verdict;
  // The Mac check itself: everything but the recorded macCheck is enforced, so a new #217 entry can pass.
  try {
    assertCanAir({ entryId: entry?.id, url, probe }, { ignoreMacCheck: true });
    verdict = `CAN AIR as "${entry.id}" (${entry.publisher})`;
    if (awaitingMacCheck(entry)) verdict += ` once its macCheck is recorded in officialFeeds.js: { passedAt: "${new Date().toISOString()}", url: "${url}", by: "<who ran it>" }`;
  }
  catch (e) { verdict = `CANNOT AIR: ${e.message}`; }
  out({ url, entry: entry?.id ?? null, probe: { ...probe, mediaUrl: probe.mediaUrl ? "(resolved)" : undefined, httpHeaders: undefined }, verdict });
  process.exit(verdict.startsWith("CAN AIR") ? 0 : 1);
} else if (cmd === "calendar") {
  const file = eventsFile();
  const man = loadManualEvents(file);
  const pub = rest.includes("--fetch") ? await fetchPublisherEvents({ log: (m) => console.error(m) }) : [];
  out(`manual file: ${file}`);
  for (const r of man.rejected) out(`  REJECTED ${JSON.stringify(r.raw ?? "")}: ${r.error}`);
  for (const e of mergeCalendar(man.events, pub)) {
    out(`  ${new Date(e.start).toISOString()} → ${new Date(e.end).toISOString()}  ${e.publisher}: ${e.title}  [${e.source}${airsAutomatically(e) ? ", airs" : ", listed only"}]  ${e.url}`);
  }
} else if (cmd === "audit") {
  const recs = createLiveLog({ dir: liveLogDir() }).readAll();
  const a = auditClipLog(recs);
  const by = (t) => recs.filter((r) => r.type === t).length;
  out({ dir: liveLogDir(), liveStarts: by("live-start"), liveEnds: by("live-end"), refused: by("live-skip"), clips: a.clips, clipProblems: a.problems });
  process.exit(a.problems.length ? 1 : 0);
} else {
  console.error("usage: cli.js feeds | check <url> | calendar [--fetch] | audit");
  process.exit(2);
}
