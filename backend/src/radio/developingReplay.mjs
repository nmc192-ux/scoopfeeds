#!/usr/bin/env node
/**
 * developingReplay.mjs - replay a recorded day through the developing desk (#201): which "Developing" bulletins
 * would have fired, when each was detected and when it would have gone on air. READ-ONLY: the database is opened
 * with { readonly: true } and nothing is written to it; the desk's memory goes to a temp folder.
 *
 *   node src/radio/developingReplay.mjs --db /path/to/news.db --day 2026-10-26 [--step 5] [--json out.json]
 *        [--from ISO --to ISO] [--min-outlets 3 --min-articles 4 --growth 3 --window 30 --baseline 6]
 *
 * Every step runs ../developing.js buildDeveloping() "as of" that minute (rows linked or fetched later are
 * invisible), then the Mac desk's own rules (developingDesk.js): the 15-minute window, the next segment boundary of
 * that hour's base clock (clock.js buildClock: no feature, weather in, which shifts no boundary before :33), the
 * 20-minute gap, one bulletin per event per 6 hours.
 * Assumed, and stated in the output: a produced programme is on air every hour (never the 24/7 screen), and a
 * bulletin takes prepSec (4 min) to produce. Run it on a copy-on-write copy of a prod snapshot
 * (scripts/pull-prod-db.mjs) and paste the table into the PR: that is the GROUND run that sets the thresholds.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { buildDeveloping, devThresholds } from "./developing.js";
import { buildClock } from "./programme/clock.js";
import { DevelopingDesk, insertionPlan, DESK_DEFAULTS } from "./programme/developingDesk.js";

const HOUR = 3_600_000, MIN = 60_000;

/** The base clock of the hour that starts at `h`, as a programme.json-shaped object (slots + endsAt). */
export function baseProgramme(h) {
  const slots = buildClock(h);
  return { hourStart: h, endsAt: slots.at(-1).end, slots: slots.map(({ id, kind, start, end, title }) => ({ id, kind, start, end, title: title || null })), inserts: [] };
}

/**
 * @returns {{ bulletins: object[], missed: object[], steps: number, thresholds, deskOpts, assumptions: string[] }}
 */
export function replayDay(db, { from, to, stepMin = 5, thresholds = null, deskOpts = {}, log = () => {} }) {
  const t = thresholds || devThresholds({});
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dev-replay-"));
  let clockNow = from;
  const desk = new DevelopingDesk({ dir, now: () => clockNow, opts: deskOpts });
  const progs = new Map();
  const prog = (h) => { if (!progs.has(h)) progs.set(h, baseProgramme(h)); return progs.get(h); };
  const bulletins = [], missed = [];
  let steps = 0;
  for (let now = from; now <= to; now += stepMin * MIN) {
    clockNow = now; steps++;
    const list = buildDeveloping(db, { now, thresholds: t });
    const cands = desk.candidates(list, now);
    for (const ev of cands) {
      const H = Math.floor(now / HOUR) * HOUR;
      let plan = null, target = null;
      for (const h of [H, H + HOUR]) {
        const p = insertionPlan(prog(h), { now, detectedAt: ev.detectedAt, lastInsertAt: desk.lastInsertAt(), opts: desk.opts });
        if (!p.none) { plan = p; target = h; break; }
      }
      if (!plan) {
        if (now + desk.opts.prepSec * 1000 > ev.detectedAt + desk.opts.maxDelayMin * MIN) { desk.miss(ev, "no boundary in the window"); missed.push({ eventId: ev.id, headline: ev.headline, detectedAt: ev.detectedAt }); }
        continue;
      }
      progs.set(target, { ...prog(target), inserts: [...prog(target).inserts, { cut: plan.cut, resumeAt: plan.resumeAt }] });
      desk.record({ eventId: ev.id, headline: ev.headline, detectedAt: ev.detectedAt, cut: plan.cut, resumeAt: plan.resumeAt, slot: plan.slot.id });
      const b = { eventId: ev.id, slug: ev.slug, headline: ev.headline, kind: ev.kind, sensitive: ev.sensitive, detectedAt: ev.detectedAt, airsAt: plan.cut,
        delayMin: Math.round((plan.cut - ev.detectedAt) / MIN * 10) / 10, slot: plan.slot.id, recent: ev.recent, baseline: ev.baseline, ratio: ev.ratio, outlets: ev.outlets.map((o) => o.source) };
      bulletins.push(b);
      log(b);
      break;   // one bulletin per step, like the live desk
    }
  }
  fs.rmSync(dir, { recursive: true, force: true });
  return {
    bulletins, missed, steps, thresholds: t, deskOpts: { ...DESK_DEFAULTS, ...deskOpts },
    assumptions: ["a produced programme is on air every hour (never the 24/7 screen)", "boundaries are the base clock's (no feature)", `detection every ${stepMin} min`, "bulletin production takes prepSec"],
  };
}

const iso = (ms) => new Date(ms).toISOString().slice(0, 16).replace("T", " ");
export function formatTable(r) {
  const rows = r.bulletins.map((b) => `| ${iso(b.detectedAt)} | ${iso(b.airsAt)} | ${b.delayMin} | ${b.slot} | ${b.kind}${b.sensitive ? ", sensitive" : ""} | ${b.recent.articles} / ${b.recent.outlets} | ${b.ratio ?? "new"} | ${String(b.headline).replace(/\|/g, "/").slice(0, 90)} |`);
  return [
    `Thresholds: ${r.thresholds.minArticles} articles from ${r.thresholds.minOutlets} outlets in ${r.thresholds.windowMin} min, ${r.thresholds.growthRatio}x the ${r.thresholds.baselineHours} h baseline. ${r.steps} steps.`,
    `Assumed: ${r.assumptions.join("; ")}.`,
    "",
    "| detected (UTC) | on air (UTC) | min | displaces | kind | articles / outlets in window | x baseline | headline |",
    "|---|---|---|---|---|---|---|---|",
    ...rows,
    "",
    `${r.bulletins.length} bulletin(s); ${r.missed.length} event(s) fired but missed the 15-minute window.`,
  ].join("\n");
}

async function main() {
  const { values: v } = parseArgs({ options: {
    db: { type: "string" }, day: { type: "string" }, from: { type: "string" }, to: { type: "string" }, step: { type: "string" }, json: { type: "string" },
    "min-outlets": { type: "string" }, "min-articles": { type: "string" }, growth: { type: "string" }, window: { type: "string" }, baseline: { type: "string" },
  } });
  if (!v.db) { console.error("--db is required (a COPY of a prod snapshot)"); process.exit(2); }
  const from = v.from ? Date.parse(v.from) : Date.parse(`${v.day}T00:00:00Z`);
  const to = v.to ? Date.parse(v.to) : from + 24 * HOUR - 1;
  if (!Number.isFinite(from) || !Number.isFinite(to)) { console.error("--day YYYY-MM-DD or --from/--to ISO"); process.exit(2); }
  const { default: Database } = await import("better-sqlite3");
  const db = new Database(path.resolve(v.db), { readonly: true, fileMustExist: true });
  const thresholds = devThresholds({ RADIO_DEV_MIN_OUTLETS: v["min-outlets"], RADIO_DEV_MIN_ARTICLES: v["min-articles"], RADIO_DEV_GROWTH: v.growth, RADIO_DEV_WINDOW_MIN: v.window, RADIO_DEV_BASELINE_H: v.baseline });
  const r = replayDay(db, { from, to, stepMin: Number(v.step) || 5, thresholds });
  console.log(formatTable(r));
  if (v.json) fs.writeFileSync(v.json, JSON.stringify(r, null, 1));
}

const isMain = process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
