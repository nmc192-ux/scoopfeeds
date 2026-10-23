#!/usr/bin/env node
/**
 * footageCli.mjs - the Mac side of "Send us your video" (#219), run by DrJ or an editor he names.
 *
 *   list                                       every submission and its status
 *   show <id>                                  the full record (licence, checks, approval, history)
 *   pull [--site https://scoopfeeds.com]       copy new submissions from the website (needs
 *                                              ADMIN_BEARER_TOKEN in the Mac's env; setting that up is DrJ's)
 *   verify <id> --by NAME --story-time ISO [--story-lat N --story-lon N]
 *               [--reverse-search "how it was searched" --no-older-copies | --older-copy URL]
 *                                              metadata vs the story, reverse search, credited air copy,
 *                                              DrJ's content rule (#218) on the air copy
 *   approve <id> --by NAME [--note TEXT]       the approval tap (RADIO_FOOTAGE_APPROVERS, default DrJ)
 *   reject <id> --by NAME [--note TEXT]
 *   queue <id>                                 put an approved submission in the breaking-news insert queue
 *   pending                                    what the insert queue holds
 *
 * There is no reverse-search service wired in yet (a paid API is a cost decision for DrJ). Until one is,
 * the reverse search is a check a named editor attests to, with how they did it. Without it the
 * submission fails verification: unmeasured never passes.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { createIntakeStore, footageDir } from "./intakeStore.js";
import { verifyFootage, ffprobeMetadata } from "./verify.js";
import { approveSubmission, rejectSubmission, isApprover, approverList } from "./approval.js";
import { createInsertQueue, InsertRefused } from "./insertQueue.js";
import { defaultCheckers } from "../safety/mediaCheckers.js";
import { jsonlLog } from "../safety/contentSafety.js";

const { positionals, values: v } = parseArgs({
  allowPositionals: true,
  options: {
    by: { type: "string" }, note: { type: "string" }, site: { type: "string" },
    "story-time": { type: "string" }, "story-lat": { type: "string" }, "story-lon": { type: "string" },
    "reverse-search": { type: "string" }, "no-older-copies": { type: "boolean" }, "older-copy": { type: "string" },
  },
});
const [cmd, id] = positionals;
const HOME = os.homedir();
const BASE = path.resolve(String(process.env.RADIO_BASE_DIR || "~/scoopfeeds-radio").replace(/^~/, HOME));
fs.mkdirSync(BASE, { recursive: true });
const store = createIntakeStore({ dir: footageDir() });
const log = jsonlLog(path.join(BASE, "footage.jsonl"));
const queue = createInsertQueue({ probe: (f) => ({ durationSec: ffprobeMetadata(f).durationSec }), intake: store, log });

function need(x, what) { if (!x) { console.error(`missing ${what}`); process.exit(2); } return x; }

try {
  if (cmd === "list") {
    for (const r of store.list()) console.log(`${r.id}  ${r.status.padEnd(13)}  ${r.credit}  ${r.claims?.storyId || "-"}  ${r.file ? `${Math.round(r.file.bytes / 1024)} KB` : "no file"}`);
  } else if (cmd === "show") {
    const r = store.get(need(id, "<id>")); if (!r) throw new Error("no such submission");
    const { uploadTokenSha256, ...rest } = r; console.log(JSON.stringify(rest, null, 2));
  } else if (cmd === "pull") {
    const site = (v.site || process.env.PRIMARY_SITE_URL || "https://scoopfeeds.com").replace(/\/+$/, "");
    const token = need(process.env.ADMIN_BEARER_TOKEN, "ADMIN_BEARER_TOKEN in the environment");
    const h = { authorization: `Bearer ${token}` };
    const list = await (await fetch(`${site}/scoop-ops/footage`, { headers: h })).json();
    let n = 0;
    for (const r of list.submissions || []) {
      if (r.status !== "received" || store.get(r.id)) continue;
      if (!/^original\.(mp4|mov|webm|mkv|3gp)$/.test(String(r.file?.name))) { console.log(`⛔ ${r.id}: unexpected file name, skipped`); continue; }
      const folder = store.folder(r.id); fs.mkdirSync(folder, { recursive: true });
      const res = await fetch(`${site}/scoop-ops/footage/${r.id}/original`, { headers: h });
      if (!res.ok) { console.log(`⛔ ${r.id}: download failed (${res.status})`); fs.rmSync(folder, { recursive: true, force: true }); continue; }
      fs.writeFileSync(path.join(folder, r.file.name), Buffer.from(await res.arrayBuffer()));
      fs.writeFileSync(path.join(folder, "submission.json"), JSON.stringify({ ...r, uploadTokenSha256: "used", history: [...r.history, { at: new Date().toISOString(), status: "received", pulledFrom: site }] }, null, 1) + "\n");
      n++; console.log(`⬇️  ${r.id}  ${r.credit}`);
    }
    console.log(`${n} new submission(s)`);
  } else if (cmd === "verify") {
    const rec = store.get(need(id, "<id>")); if (!rec) throw new Error("no such submission");
    const by = need(v.by, "--by NAME (who is entering the story details and the reverse search)");
    if (!isApprover(by)) throw new Error(`"${by}" is not a named editor (${approverList().join(", ")})`);
    const story = v["story-time"] ? { startedAt: v["story-time"], lat: v["story-lat"] ? Number(v["story-lat"]) : null, lon: v["story-lon"] ? Number(v["story-lon"]) : null, enteredBy: by } : null;
    let reverse = null;
    if (v["older-copy"]) reverse = { verdict: "older-copy-found", matches: [{ url: v["older-copy"] }], attestedBy: by };
    else if (v["no-older-copies"]) reverse = { verdict: "no-older-copies", method: v["reverse-search"] || "", attestedBy: by };
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "footage-verify-"));
    try {
      const checks = await verifyFootage(store, rec, {
        storyLookup: () => story,
        reverseSearch: reverse ? () => reverse : undefined,
        safetyCheckers: defaultCheckers({ workDir: work }),
        safetyLog: jsonlLog(path.join(BASE, "content-safety.jsonl")),
      });
      store.setChecks(rec.id, checks);
      log({ type: checks.ok ? "footage-verified" : "footage-verify-failed", id: rec.id, by, reasons: checks.reasons });
      if (checks.ok) console.log(`✅ ${rec.id}: verified. Waiting for the approval tap: footageCli.mjs approve ${rec.id} --by <name>`);
      else { console.log(`⛔ ${rec.id}: NOT verified`); for (const r of checks.reasons) console.log(`   - ${r}`); process.exitCode = 1; }
    } finally { fs.rmSync(work, { recursive: true, force: true }); }
  } else if (cmd === "approve") {
    const r = approveSubmission(store, need(id, "<id>"), { by: need(v.by, "--by NAME"), note: v.note || null });
    log({ type: "footage-approved", id: r.id, by: r.approval.by });
    console.log(`✅ ${r.id}: approved by ${r.approval.by}. Queue it with: footageCli.mjs queue ${r.id}`);
  } else if (cmd === "reject") {
    const r = rejectSubmission(store, need(id, "<id>"), { by: need(v.by, "--by NAME"), note: v.note || null });
    log({ type: "footage-rejected", id: r.id, by: r.approval.by, note: r.approval.note });
    console.log(`${r.id}: rejected`);
  } else if (cmd === "queue") {
    const it = await queue.admitPublicFootage(need(id, "<id>"));
    console.log(`✅ ${id}: in the insert queue as ${it.qid} (${it.durationSec?.toFixed(1)} s, credit "${it.credit}")`);
  } else if (cmd === "pending") {
    for (const it of queue.pending()) console.log(`${it.qid}  ${it.kind.padEnd(14)}  ${it.credit}  ${it.durationSec?.toFixed?.(1) ?? "?"} s`);
  } else {
    console.error("usage: footageCli.mjs list | show <id> | pull | verify <id> --by N --story-time T [...] | approve <id> --by N | reject <id> --by N | queue <id> | pending");
    process.exitCode = 2;
  }
} catch (e) {
  if (e instanceof InsertRefused) { console.log(`⛔ refused by the insert queue:`); for (const r of e.reasons) console.log(`   - ${r}`); process.exitCode = 1; }
  else { console.error(`footage: ${e.message}`); process.exitCode = 2; }
}
