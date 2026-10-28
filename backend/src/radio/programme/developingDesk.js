/**
 * developingDesk.js - the "Developing" desk of the 24/7 station (#201), the Mac side.
 *
 *   DETECT    every few minutes the rolling station reads GET /api/radio/developing.json (built on the worker by
 *             ../developing.js from the event graph, Rule 0 applied) and takes the events that FIRE.
 *   AIR       a "Developing" bulletin is produced (bulletin.mjs) and spliced into the programme on air at the next
 *             segment boundary that is at most 15 minutes after the event was first detected. The slot that starts
 *             at that boundary gives way: the bulletin, then headlines and music, and the grid resumes at the next
 *             segment (grid.applyOverride's rule). The screen shows the BREAKING banner on the story card.
 *   FOLLOW UP an aired story that keeps growing is handed to the next hours' producer (followups.json -> produce.mjs
 *             --developing), which puts it in the headlines.
 *   LIMITS    never two interruptions less than 20 minutes apart (air time), one bulletin per event per 6 hours,
 *             a sensitive story (the radio's sensitivity switch) is read with no music bed and no sting.
 *
 * What is said: only what the outlets in the list report. A line is CONFIRMED only when two or more of the listed
 * outlets are named as reporting it; every other line must say it is unconfirmed (checkBulletin drops it otherwise).
 *
 * Dark unless RADIO_DEVELOPING_ENABLED is literally "1" on the Mac. Pure apart from the state files and the
 * programme lock; the clock and every process are injected.
 */
import fs from "node:fs";
import path from "node:path";
import { spliceProgramme } from "./repeat.js";
import { checkSegments } from "./checks.js";
import { airable, sameStory } from "./factPack.js";

const MIN = 60_000;
export const DESK_DEFAULTS = Object.freeze({
  maxDelayMin: 15,     // on air within 15 minutes of detection
  minGapMin: 20,       // never more than one interruption per 20 minutes
  bulletinSec: 75,     // the bulletin itself; the rest of the displaced slot is headlines and music
  minSlotSec: 60,      // a boundary whose slot is shorter cannot carry a bulletin
  prepSec: 240,        // producing a bulletin (writer + voice + mix) must fit before the boundary
  tailSec: 5,          // shorter than this after the bulletin: no resume music, the bulletin runs to the boundary
  repeatAfterH: 6,     // the same event interrupts again at most once in this many hours
  followH: 6,          // an aired story stays in the headlines this long while it keeps growing
  staleMin: 15,        // a developing list older than this is not acted on
  pollMin: 2,          // the station reads the list this often
});

export const deskEnabled = (env = process.env) => env.RADIO_DEVELOPING_ENABLED === "1";

/** Slots a bulletin may displace: never an ident, the countdown, the feature, the sign-off or the end card. */
export const INSERTABLE = new Set(["spoken", "music", "series", "film"]);
const NEVER = new Set(["signoff", "ident-top", "ident-half", "ident-end", "endcard", "countdown"]);

/**
 * Where a bulletin goes in programme `prog`: the first slot boundary that is (a) far enough ahead to produce it,
 * (b) no later than detection + maxDelayMin, (c) at least minGapMin after the last interruption. Pure.
 * @returns {{ slot, cut, end, resumeAt, next } | { none: string }}
 */
export function insertionPlan(prog, { now, detectedAt, lastInsertAt = -Infinity, opts = {} }) {
  const o = { ...DESK_DEFAULTS, ...opts };
  if (!prog || !Array.isArray(prog.slots)) return { none: "no programme" };
  const deadline = detectedAt + o.maxDelayMin * MIN;
  const earliest = Math.max(now + o.prepSec * 1000, lastInsertAt + o.minGapMin * MIN);
  if (earliest > deadline) return { none: lastInsertAt + o.minGapMin * MIN > deadline ? "held by the 20-minute rule past the 15-minute window" : "too late to produce within the 15-minute window" };
  const taken = (prog.inserts || []).map((i) => [i.cut, i.resumeAt]);
  const slots = [...prog.slots].sort((a, b) => a.start - b.start);
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    if (s.start < earliest) continue;
    if (s.start > deadline) break;
    if (!INSERTABLE.has(s.kind) || NEVER.has(s.id) || s.insert || s.cut) continue;
    if (/^update-\d\d$/.test(s.id)) continue;   // #198: an election night update slot is never displaced
    if ((s.end - s.start) / 1000 < o.minSlotSec) continue;
    if (s.end > prog.endsAt) continue;
    if (taken.some(([a, b]) => s.start < b && a < s.end)) continue;
    const len = Math.min(o.bulletinSec * 1000, s.end - s.start);
    const end = s.end - (s.start + len) < o.tailSec * 1000 ? s.end : s.start + len;
    const next = slots.slice(i + 1).find((x) => x.title) || null;
    return { slot: s, cut: s.start, end, resumeAt: s.end, next: next ? { title: next.title, at: next.start } : null };
  }
  return { none: "no segment boundary in the window" };
}

/** GET <base>/api/radio/developing.json. Throws on HTTP errors or a body without an events list. */
export async function fetchDevelopingList(base, { fetchImpl = fetch, timeoutMs = 20_000 } = {}) {
  const res = await fetchImpl(`${base}/api/radio/developing.json`, { headers: { Accept: "application/json", "User-Agent": "ScoopFeedsRadio/1.0" }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`developing.json -> HTTP ${res.status}`);
  const j = await res.json();
  if (!Array.isArray(j?.events)) throw new Error("developing.json has no events list");
  return j;
}

// ── the desk's memory: what fired when, what aired, when the last interruption was ───────────────────────────
export class DevelopingDesk {
  constructor({ dir, now = Date.now, opts = {}, log = () => {} }) {
    Object.assign(this, { dir, now, log });
    this.opts = { ...DESK_DEFAULTS, ...opts };
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, "state.json");
    try { this.state = JSON.parse(fs.readFileSync(this.file, "utf8")); } catch { this.state = null; }
    if (!this.state || !Array.isArray(this.state.aired)) this.state = { seen: {}, aired: [], missed: [] };
  }
  save() { const t = `${this.file}.tmp`; fs.writeFileSync(t, JSON.stringify(this.state, null, 1)); fs.renameSync(t, this.file); }

  /** Firing events this desk may still interrupt for, strongest first. Registers first detection. */
  candidates(list, now = this.now()) {
    const out = [];
    const at = Math.min(now, Number(list?.updatedAt) || now);
    for (const e of list?.events || []) {
      if (!e?.fires || !e.id || !(e.outlets || []).length) continue;
      const aired = this.state.aired.filter((a) => a.eventId === e.id).at(-1);
      if (aired && now - aired.at < this.opts.repeatAfterH * 3_600_000) continue;
      const seen = this.state.seen[e.id];
      if (!seen || (aired && seen < aired.at) || now - seen > this.opts.repeatAfterH * 3_600_000) this.state.seen[e.id] = at;
      if (this.state.missed.some((m) => m.eventId === e.id && m.seen === this.state.seen[e.id])) continue;
      out.push({ ...e, detectedAt: this.state.seen[e.id] });
    }
    // forget detections older than a day
    for (const [id, t] of Object.entries(this.state.seen)) if (now - t > 24 * 3_600_000) delete this.state.seen[id];
    this.state.missed = this.state.missed.filter((m) => now - m.at < 24 * 3_600_000);
    this.save();
    return out;
  }
  lastInsertAt() { return this.state.aired.reduce((m, a) => Math.max(m, a.cut || 0), -Infinity); }
  record(entry) { this.state.aired.push({ ...entry, at: this.now() }); this.state.aired = this.state.aired.slice(-200); this.save(); }
  miss(e, why) { this.state.missed.push({ eventId: e.id, seen: e.detectedAt, at: this.now(), why, headline: e.headline }); this.save(); }

  /** Aired stories still growing (follow: true in the latest list) within followH: the next hours' headlines carry them. */
  followups(list, now = this.now()) {
    const live = new Map((list?.events || []).filter((e) => e.follow).map((e) => [e.id, e]));
    const ids = [...new Set(this.state.aired.filter((a) => now - a.at < this.opts.followH * 3_600_000).map((a) => a.eventId))];
    return ids.filter((id) => live.has(id)).map((id) => { const e = live.get(id); return { eventId: id, headline: e.headline, outlets: e.outlets, sensitive: !!e.sensitive }; });
  }
  writeFollowups(list, now = this.now()) {
    const f = path.join(this.dir, "followups.json");
    fs.writeFileSync(`${f}.tmp`, JSON.stringify({ at: now, stories: this.followups(list, now) }, null, 1));
    fs.renameSync(`${f}.tmp`, f);
    return f;
  }
}

// ── the bulletin's words ──────────────────────────────────────────────────────────────────────────────────────
export const OPEN_LINE = "This is a developing story on ScoopFeeds Radio.";
export const CLOSE_LINE = "We will follow this story in our headlines.";
const UNCONFIRMED = /\b(unconfirmed|not (yet )?(been )?(independently )?(confirmed|verified)|(has|have|had)( not|n['’]t) (yet )?(been )?(independently )?(confirmed|verified)|yet to be (independently )?(confirmed|verified)|could not (yet )?be (independently )?(confirmed|verified)|no other outlet has (yet )?(confirmed|reported))\b/i;

/** The fact pack for one developing story: the outlets' own headlines and summaries, nothing else. */
export function bulletinPack(ev, now = Date.now()) {
  const outlets = (ev.outlets || []).map((o) => ({ source: o.source, title: o.title, description: o.description || "", published: o.published || null }));
  return { builtAt: now, state: null, top: [{ id: "dv1", headline: ev.headline, outlets, count: outlets.length, developing: true }], desks: {}, markets: [], weather: [], dropped: [] };
}

export const BULLETIN_SYSTEM = [
  "You write a short DEVELOPING STORY bulletin for ScoopFeeds Radio, read aloud by a synthetic voice: short sentences, active voice, no parentheses, no emoji, no markdown.",
  "Hard rules, never broken:",
  "1. Use ONLY facts in the FACT PACK. Every name, number and claim must appear there. Never speculate about causes, casualties or what happens next.",
  "2. Every line names the outlet or outlets that report what it says.",
  "3. A fact is CONFIRMED only when two or more outlets in the pack report it: say so (\"Reuters and the BBC both report ...\") and list them in \"confirmedBy\".",
  "4. A fact only one outlet reports is UNCONFIRMED: say \"<outlet> reports ..., which has not been confirmed by other outlets\", or use the word \"unconfirmed\". Never present it as established.",
  "5. Never put words in quotation marks unless those exact words appear in the pack.",
  "6. Neutral tone, no adjectives of judgement. Never cover Pakistan's domestic politics.",
  "7. Never mention the fact pack or what you do or do not have.",
  "Reply with ONE JSON object and nothing else.",
].join("\n");

export function bulletinPrompt(pack, budgetWords) {
  const s = pack.top[0];
  return [
    `Write the bulletin in at most ${budgetWords} words in total, as 2 to 4 lines "c1".."c4" (do not write an opening or closing line; they are added for you).`,
    'JSON shape: {"lines": [{"id": "c1", "text": "<what is said>", "confirmedBy": ["<outlet>", ...]}]}',
    "",
    "FACT PACK",
    `[${s.id}] ${s.headline}`,
    ...s.outlets.map((o) => `    - ${o.source}: "${o.title}"${o.description ? ` — ${o.description}` : ""}`),
  ].join("\n");
}

const listNames = (n) => (n.length <= 2 ? n.join(" and ") : `${n.slice(0, -1).join(", ")} and ${n.at(-1)}`);
const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

/** No Claude (cost guard, or the writer is busy with an hour): the outlets' own headlines, attributed and labelled. */
export function mechanicalBulletin(pack) {
  const s = pack.top[0];
  const names = s.outlets.map((o) => o.source);
  const lines = [];
  if (names.length >= 2) lines.push({ id: "c1", text: `${listNames(names.slice(0, 4))} are all reporting this story${names.length > 4 ? `, with ${WORDS[Math.min(10, names.length - 4)]} more outlets` : ""}.`, confirmedBy: names.slice(0, 4) });
  s.outlets.slice(0, 2).forEach((o) => lines.push({ id: `c${lines.length + 1}`, text: `${o.source} reports: ${o.title.replace(/[.!?\s]+$/, "")}. That detail has not been confirmed by other outlets.`, confirmedBy: [o.source] }));
  return { lines };
}

const named = (text, sources) => sources.filter((src) => String(text).toLowerCase().includes(src.toLowerCase()));

/**
 * Check a written bulletin. Every line goes through checks.js (Rule 0, figures, quotes, the election rules), then
 * the developing rules: a line must name an outlet of the story; it is confirmed only with two or more named
 * outlets that are in `confirmedBy`; anything else must be labelled unconfirmed. Lines that fail are DROPPED.
 * The opening and closing lines are always ours, never the model's.
 * @returns {{ segment: { story, lines }, report, ok }}
 */
export function checkBulletin(raw, slot, pack) {
  const s = pack.top[0];
  const sources = s.outlets.map((o) => o.source);
  const body = (raw?.lines || []).filter((l) => l && !["open", "close"].includes(l.id)).map((l, i) => ({ ...l, id: /^c\d+$/.test(l.id || "") ? l.id : `c${i + 1}`, story: "dv1" }));
  const { segments, report } = checkSegments({ [slot.id]: { story: "dv1", lines: body } }, [slot], pack);
  const kept = [];
  for (const l of segments[slot.id]?.lines || []) {
    const who = named(l.text, sources);
    const by = (Array.isArray(l.confirmedBy) ? l.confirmedBy : []).filter((x) => sources.includes(x) && who.includes(x));
    let why = null;
    if (!who.length) why = "developing: names no outlet that reports the story";
    else if (by.length < 2 && !UNCONFIRMED.test(l.text)) why = "developing: a fact only one outlet reports, not labelled unconfirmed";
    if (why) { report.push({ slot: slot.id, line: l.id, drop: why, text: String(l.text).slice(0, 120) }); continue; }
    kept.push({ ...l, confirmed: by.length >= 2, confirmedBy: by });
  }
  const lines = kept.length ? [{ id: "open", text: OPEN_LINE }, ...kept, { id: "close", text: CLOSE_LINE }] : [];
  return { segment: { story: "dv1", lines }, report, ok: kept.length > 0 };
}

// ── splicing into the programme ───────────────────────────────────────────────────────────────────────────────
/** A short exclusive lock around programme.json's read-modify-write (produce.mjs and bulletin.mjs both take it). */
export function withProgrammeLock(dir, fn, { timeoutMs = 30_000, staleMs = 60_000 } = {}) {
  const lock = path.join(dir, "programme.lock");
  const t0 = Date.now();
  for (;;) {
    try { fs.writeFileSync(lock, String(process.pid), { flag: "wx" }); break; }
    catch {
      let age = 0; try { age = Date.now() - fs.statSync(lock).mtimeMs; } catch { continue; }
      if (age > staleMs) { try { fs.unlinkSync(lock); } catch { /* raced */ } continue; }
      if (Date.now() - t0 > timeoutMs) throw new Error("programme.json is locked by another writer");
      const until = Date.now() + 50; while (Date.now() < until) { /* short spin: the holder is a JSON write */ }
    }
  }
  try { return fn(); } finally { try { fs.unlinkSync(lock); } catch { /* gone */ } }
}

/** The slot list with an insert in place of the slot it displaces. Pure. */
export function insertSlots(slots, ins) {
  const out = (slots || []).filter((s) => !(s.start >= ins.cut && s.start < ins.resumeAt) && s.id !== ins.id && s.id !== `${ins.id}-resume`);
  out.push({ id: ins.id, kind: "breaking", start: ins.cut, end: ins.end, title: ins.title || "Developing story", insert: true });
  if (ins.end < ins.resumeAt) out.push({ id: `${ins.id}-resume`, kind: "music", start: ins.end, end: ins.resumeAt, title: null, insert: true });
  return out.sort((a, b) => a.start - b.start);
}

/** Put an insert into a programme object: audio and cues spliced, the displaced slot replaced. Pure. */
export function applyInsert(prog, ins) {
  const out = spliceProgramme(prog, { cut: ins.cut, resumeAt: ins.resumeAt, partFile: ins.partFile, cues: ins.cues, lines: ins.lines || [] });
  out.slots = insertSlots(prog.slots, ins);
  out.inserts = [...(prog.inserts || []).filter((x) => x.id !== ins.id), ins];
  return out;
}

/**
 * After a refresh re-produced the hour from `cut` (produce.mjs --from), put every insert back: those at or after
 * the cut are spliced in again over the new audio, the earlier ones (already aired) keep their place in the slot
 * list. Pure.
 */
export function reapplyInserts(prog, inserts, cut) {
  const list = inserts || [];
  let p = { ...prog, inserts: list.filter((i) => i.cut < cut) };
  for (const ins of p.inserts) p.slots = insertSlots(p.slots, ins);
  for (const ins of list.filter((i) => i.cut >= cut).sort((a, b) => a.cut - b.cut)) p = applyInsert(p, ins);
  return p;
}

/** Splice a produced bulletin into <dir>/programme.json, atomically, under the lock. Refuses once the cut has passed. */
export function insertBulletin(dir, ins, { now = Date.now, marginMs = 1500 } = {}) {
  return withProgrammeLock(dir, () => {
    const pf = path.join(dir, "programme.json");
    const prog = JSON.parse(fs.readFileSync(pf, "utf8"));
    if (now() > ins.cut - marginMs) throw new Error(`too late: the boundary at ${new Date(ins.cut).toISOString()} has passed`);
    if (ins.cut < prog.hourStart || ins.resumeAt > prog.endsAt) throw new Error("the insert is outside this programme");
    if ((prog.inserts || []).some((x) => ins.cut < x.resumeAt && x.cut < ins.resumeAt)) throw new Error("another insert already holds that slot");
    const out = applyInsert(prog, ins);
    fs.writeFileSync(`${pf}.tmp`, JSON.stringify(out, null, 1));
    fs.renameSync(`${pf}.tmp`, pf);
    return out;
  });
}

// ── one tick of the desk ──────────────────────────────────────────────────────────────────────────────────────
/**
 * @param {object} o
 * @param {DevelopingDesk} o.desk
 * @param {object|null} o.list         the developing list (GET /api/radio/developing.json)
 * @param {{dir, hourStart}[]} o.targets  programmes that may take an insert: the hour on air, then the next if ready
 * @param {Function} o.produceBulletin async ({ dir, hourStart, event, plan, writer, deadline }) => exit code
 * @param {boolean} [o.useClaude]      false: the mechanical headline writer (cost guard, or the writer is busy)
 * @returns {Promise<object>} what happened, for the log and status.json
 */
export async function developingTick({ desk, list, targets = [], produceBulletin, now = Date.now(), useClaude = true, log = () => {} }) {
  if (!list || !Array.isArray(list.events)) return { result: "no developing list" };
  desk.writeFollowups(list, now);
  if (now - (Number(list.updatedAt) || 0) > desk.opts.staleMin * MIN) return { result: `developing list is stale (${new Date(Number(list.updatedAt) || 0).toISOString()})` };
  const cands = desk.candidates(list, now);
  if (!cands.length) return { result: "nothing firing" };
  for (const ev of cands) {
    let plan = null, target = null, why = null;
    for (const t of targets) {
      let prog = null;
      try { prog = JSON.parse(fs.readFileSync(path.join(t.dir, "programme.json"), "utf8")); } catch { continue; }
      const p = insertionPlan(prog, { now, detectedAt: ev.detectedAt, lastInsertAt: desk.lastInsertAt(), opts: desk.opts });
      if (p.none) { why = why || p.none; continue; }
      plan = p; target = t; break;
    }
    if (!plan) {
      const late = now + desk.opts.prepSec * 1000 > ev.detectedAt + desk.opts.maxDelayMin * MIN;
      const reason = targets.length ? (why || "no programme") : "no produced programme on air (the 24/7 screen)";
      if (late) { desk.miss(ev, reason); log(`developing: "${ev.headline}" MISSED its 15-minute window (${reason}); it goes to the headlines`); }
      else log(`developing: "${ev.headline}" waiting (${reason})`);
      continue;
    }
    log(`developing: "${ev.headline}" (${ev.recent?.articles} articles, ${ev.recent?.outlets} outlets in ${list.thresholds?.windowMin ?? "?"} min) -> ${plan.slot.id} at ${new Date(plan.cut).toISOString()} (${Math.round((plan.cut - ev.detectedAt) / 1000)} s after detection), ${useClaude ? "Claude writer" : "headline writer"}${ev.sensitive ? ", SENSITIVE: no bed" : ""}`);
    const code = await produceBulletin({ dir: target.dir, hourStart: target.hourStart, event: ev, plan, writer: useClaude ? "claude" : "headlines", deadline: plan.cut - 20_000 });
    if (code !== 0) { log(`developing: bulletin for "${ev.headline}" failed (exit ${code}); the next tick tries a later boundary`); return { result: `bulletin failed (exit ${code})`, eventId: ev.id }; }
    desk.record({ eventId: ev.id, headline: ev.headline, detectedAt: ev.detectedAt, cut: plan.cut, resumeAt: plan.resumeAt, slot: plan.slot.id, hourStart: target.hourStart, sensitive: !!ev.sensitive, writer: useClaude ? "claude" : "headlines" });
    desk.writeFollowups(list, now);
    return { result: "inserted", eventId: ev.id, cut: plan.cut, slot: plan.slot.id, delaySec: Math.round((plan.cut - ev.detectedAt) / 1000) };
  }
  return { result: "no insertion this tick" };
}

// ── follow-up: the next hours' headlines ─────────────────────────────────────────────────────────────────────
/**
 * Put aired developing stories that are still growing at the head of the fact pack's top stories (produce.mjs
 * --developing followups.json). Each outlet passes Rule 0 again; a story already in the pack is only marked.
 * The writer is told to lead The Hour with stories marked DEVELOPING. Mutates and returns `pack`.
 */
export function addDevelopingStories(pack, stories, { max = 2, log = () => {} } = {}) {
  let n = 0;
  for (const st of (stories || []).slice(0, max)) {
    const outlets = (st.outlets || []).filter((o) => o?.source && o?.title && airable({ title: o.title, description: o.description, source_name: o.source }))
      .map((o) => ({ source: o.source, title: o.title, description: o.description || "", published: o.published || null }));
    if (!outlets.length || !st.headline) { log(`developing follow-up "${st.headline}": no outlet passes Rule 0 now; not carried`); continue; }
    const same = pack.top.find((t) => sameStory({ title: st.headline, description: outlets.map((o) => o.title).join(" ") }, t.headline));
    if (same) { same.developing = true; log(`developing follow-up "${st.headline}": already in the pack as ${same.id}`); continue; }
    pack.top.unshift({ id: `dv${++n}`, headline: st.headline, outlets: outlets.slice(0, 6), count: outlets.length, developing: true });
    log(`developing follow-up "${st.headline}": carried into the headlines (${outlets.length} outlets)`);
  }
  return pack;
}
