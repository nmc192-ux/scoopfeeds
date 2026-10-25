/**
 * rollingStation.js - the 24/7 loop (#195): every hour of the day is a ScoopFeeds Radio hour.
 *
 *   H-45 min  PREPARE hour H (one job queue, one writer: jobs never overlap). The day clock (or #200's grid)
 *             says what H is: a PRODUCED hour (produce.mjs) or an overnight REPEAT (the strongest recent produced
 *             hour, retimed, with a fresh The Hour spliced in). The job is killed at H-15 min. Then the air check.
 *   H-30 min  REFRESH the hour on air: if the top story changed since it was written, re-produce it from the
 *             first music slot at least 12 min away (produce.mjs --from), queued behind any prepare job.
 *   H-60 s    HAND OVER: stop the playout of the hour ending, start hour H's programme playout. If H was not
 *             ready (producer or air check failed), the 24/7 headline screen + music bed airs instead:
 *             air never goes dark, and the next hour tries again. DrJ is alerted only when 2 hours in a row fail.
 *
 * PAUSE (#208): ~/scoopfeeds-radio/PAUSE, written by the standing watchdog or by DrJ, takes the stream OFF AIR,
 * not onto the headline screen. It is checked at least every 30 s, mid-hour included: the playout is stopped, the
 * YouTube broadcast is completed and the loop stops. Nothing airs again until PAUSE is removed by hand.
 *
 * Cost guard: every Claude writer call is counted per hour (status.json) and per day (WriterLedger). Over the
 * day's budget, or after a usage-limit error (then for a cool-down), produced hours become repeats with a
 * headline-reader top of the hour (no Claude), and refreshes are skipped.
 *
 * Nothing here is Mac-specific: processes, YouTube and the clock are injected (rolling.mjs wires the real ones;
 * the launchd wrapper is the only Mac piece). Times are epoch ms.
 */
import fs from "node:fs";
import path from "node:path";
import { planHour, broadcastRollDue } from "./dayClock.js";
import { pickStrongest, prepareRepeat } from "./repeat.js";
import { sameStory } from "./factPack.js";

export const HOUR = 3_600_000;
const MIN = 60_000;
export const DEFAULTS = Object.freeze({
  prepareLeadMin: 45,     // start producing hour H at H-45 (":15")
  produceByLeadMin: 15,   // ...and it must be done by H-15 (":45"), when its pre-roll would start
  refreshAtMin: 30,       // the breaking-news check, at :30 of the hour on air
  refreshLeadMin: 12,     // a refresh re-produces from the first music slot at least this far ahead
  minRepeatTimeMin: 8,    // after a usage-limit failure, a repeat is still tried if this much time is left
  handoverLeadSec: 60,    // switch playouts one minute before the top of the hour (the old hour is on its end card)
  alertAfter: 2,          // alert DrJ when this many hours IN A ROW fall back
  maxRestartsPerHour: 3,  // a playout that keeps dying in one hour gives way to the 24/7 screen
  rollEtHours: [4, 16],   // quiet hand-overs where the 12-hour YouTube broadcast rolls over
});

export const hourStamp = (ms) => new Date(ms).toISOString().slice(0, 13).replace(/[:]/g, "");

/** The first hour the loop can still prepare on time: at least 30 min away (producing takes ~10 of the 30). */
export function firstHour(nowMs, minLeadMin = 30) {
  return Math.ceil((nowMs + minLeadMin * MIN) / HOUR) * HOUR;
}

/** Did the top story change? Unmeasurable (no old or new top) is NOT a change: no refresh on a guess. */
export function topChanged(oldTop, newTop) {
  if (!oldTop?.headline || !newTop?.headline) return false;
  if (oldTop.id && oldTop.id === newTop.id && oldTop.headline === newTop.headline) return false;
  const asArticle = { title: newTop.headline, description: (newTop.outlets || []).map((o) => o.title).join(" ") };
  return !sameStory(asArticle, oldTop.headline);
}

/** The slot a refresh re-produces from: the first music slot that starts at or after `notBefore`. */
export function refreshSlot(prog, notBefore) {
  return (prog?.slots || []).find((s) => s.kind === "music" && s.start >= notBefore) || null;
}

/** One writer at a time: jobs run strictly in order, never overlapping (the radio state queue's rule). */
export class SerialQueue {
  constructor() { this.tail = Promise.resolve(); this.running = 0; this.maxRunning = 0; this.history = []; }
  enqueue(name, fn) {
    const job = this.tail.then(async () => {
      this.running++; this.maxRunning = Math.max(this.maxRunning, this.running);
      const rec = { name, start: null, end: null }; this.history.push(rec);
      try { rec.start = this.now?.() ?? Date.now(); return await fn(); }
      finally { rec.end = this.now?.() ?? Date.now(); this.running--; }
    });
    this.tail = job.catch(() => {});
    return job;
  }
}

/** Claude writer calls per UTC day, and the cool-down after a usage limit. Files under `dir`. */
export class WriterLedger {
  constructor({ dir, maxPerDay = 96, cooldownMin = 60, now = Date.now }) { Object.assign(this, { dir, maxPerDay, cooldownMin, now }); fs.mkdirSync(dir, { recursive: true }); }
  file(ms = this.now()) { return path.join(this.dir, `${new Date(ms).toISOString().slice(0, 10)}.json`); }
  day(ms = this.now()) {
    try { return JSON.parse(fs.readFileSync(this.file(ms), "utf8")); }
    catch { return { date: new Date(ms).toISOString().slice(0, 10), calls: 0, failures: 0, limitHits: 0, byHour: {} }; }
  }
  add(hourStart, run, kind = "prepare") {
    if (!run) return this.day();
    const d = this.day();
    d.calls += run.calls || 0; d.failures += run.failures || 0; d.limitHits += run.limitHit ? 1 : 0;
    const k = hourStamp(hourStart);
    const h = d.byHour[k] || (d.byHour[k] = { calls: 0, failures: 0, jobs: [] });
    h.calls += run.calls || 0; h.failures += run.failures || 0; h.jobs.push(kind);
    fs.writeFileSync(this.file(), JSON.stringify(d, null, 1));
    if (run.limitHit) this.coolDown();
    return d;
  }
  coolDown() { fs.writeFileSync(path.join(this.dir, "cooldown.json"), JSON.stringify({ until: this.now() + this.cooldownMin * MIN })); }
  /** May the writer be called now? */
  guard() {
    const d = this.day();
    let until = 0; try { until = JSON.parse(fs.readFileSync(path.join(this.dir, "cooldown.json"), "utf8")).until || 0; } catch { /* none */ }
    if (until > this.now()) return { ok: false, reason: `usage limit cool-down until ${new Date(until).toISOString()}`, calls: d.calls, max: this.maxPerDay };
    if (d.calls >= this.maxPerDay) return { ok: false, reason: `day budget spent (${d.calls}/${this.maxPerDay} writer calls)`, calls: d.calls, max: this.maxPerDay };
    return { ok: true, calls: d.calls, max: this.maxPerDay };
  }
}

/** The last writer run recorded in <dir>/writer.json after `before` runs, or null. */
export function writerRunSince(dir, before) {
  try {
    const w = JSON.parse(fs.readFileSync(path.join(dir, "writer.json"), "utf8"));
    const runs = (w.runs || []).slice(before);
    if (!runs.length) return null;
    return runs.reduce((a, r) => ({ calls: a.calls + (r.calls || 0), failures: a.failures + (r.failures || 0), limitHit: a.limitHit || !!r.limitHit }), { calls: 0, failures: 0, limitHit: false });
  } catch { return null; }
}
export function writerRunCount(dir) {
  try { return (JSON.parse(fs.readFileSync(path.join(dir, "writer.json"), "utf8")).runs || []).length; } catch { return 0; }
}

/**
 * A continuous YouTube broadcast over the hourly hand-overs, rolled over at a quiet slot before 12 hours.
 * `yt` is youtubeLive.makeYouTubeLive(); `goLive` is goLiveWhenActive bound to it.
 */
/**
 * #208: the description ends with the music credits. One broadcast spans many hours, so it carries every track
 * that may air (the cleared library), or with `listAll: false` the link to the full list (RADIO_MUSIC_CREDITS_URL);
 * broadcastBody() throws rather than publish incomplete credits, and then no broadcast is created.
 */
export function continuousBroadcast({ yt, goLive, title = (ms) => `ScoopFeeds Radio LIVE · The news, compared`, description = "", credits = [], creditsUrl = null, listAll = true, privacy = "public", log = () => {}, alert = async () => {} }) {
  const b = {
    current: null, startedAt: NaN, next: null, streamId: null,
    async create(at) {
      if (!b.streamId) b.streamId = (await yt.findStream()).id;
      const r = await yt.createBroadcast({ title: title(at), description, startMs: at, privacy, autoStop: false, credits, creditsUrl, listAll });
      await yt.bind(r.id, b.streamId);
      log(`youtube: broadcast ${r.id} created and bound to stream ${b.streamId}`);
      return r.id;
    },
    async open(at) {
      try { await yt.checkScope(); b.current = await b.create(at); b.startedAt = at; }
      catch (e) { b.current = null; await alert(`YouTube setup failed (${e.message}). The stream still goes out: go live by hand in YouTube Studio.`); }
    },
    /** Before the hand-over that rolls: the next broadcast exists and is bound, so the switch costs no extra seconds. */
    async prepareRoll(at) {
      try { b.next = await b.create(at); return true; }
      catch (e) { log(`youtube: could not create the next broadcast (${e.message}); keeping ${b.current} one more hour`); b.next = null; return false; }
    },
    async swap(at) {
      if (!b.next) return;
      const old = b.current;
      if (old) await yt.transition(old, "complete").then(() => log(`youtube: broadcast ${old} complete (rolled at 12 h)`)).catch((e) => log(`youtube: completing ${old} failed: ${e.message}`));
      b.current = b.next; b.next = null; b.startedAt = at;
    },
    /** Off air (PAUSE, or the loop stopping): complete the broadcast; auto-stop is off, so nothing else would. */
    async end(why = "stopping") {
      for (const id of [b.current, b.next].filter(Boolean)) {
        await yt.transition(id, "complete").then(() => log(`youtube: broadcast ${id} complete (${why})`)).catch((e) => log(`youtube: completing ${id} failed: ${e.message}`));
      }
      b.current = null; b.next = null;
    },
    goLive() {
      if (!b.current) return Promise.resolve(null);
      const id = b.current;
      return goLive({ broadcastId: id, streamId: b.streamId, log })
        .then(() => { log(`youtube: ${id} is live; the channel's /live URL points at it`); return id; })
        .catch((e) => alert(`the broadcast did not go live by itself (${e.message}). Click Go live in YouTube Studio.`));
    },
  };
  return b;
}

export class RollingStation {
  /**
   * @param {object} o
   * @param {string} o.airDir        one folder per hour: <airDir>/<YYYY-MM-DDTHH>/
   * @param {Function} o.produce     async ({ hourStart, out, from?, to?, weather, headlineWriter, deadline }) => exit code
   * @param {Function} o.check       (dir, { hourStart }) => { ok, problems, stats }   (airCheck)
   * @param {Function} o.topStory    async () => the current top story (factPack top[0]) or null
   * @param {object} o.playout       { start({ kind: "programme"|"247", dir?, hourStart }) => { stop(): Promise, done: Promise<number> } }
   * @param {WriterLedger} o.ledger
   * @param {Function} [o.grid]      (hourStart) => plan (dayClock.planHour, or #200's grid)
   * @param {object} [o.broadcast]   continuousBroadcast(), live runs only
   */
  constructor(o) {
    Object.assign(this, { now: Date.now, sleep: (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms))), log: () => {}, alert: async () => {}, isPaused: () => false, grid: planHour, broadcast: null, forceFail: new Set(), forceTopChange: false }, o);
    this.opts = { ...DEFAULTS, ...(o.opts || {}) };
    this.queue = new SerialQueue(); this.queue.now = () => this.now();
    this.ready = new Map();      // hourStart -> { dir, decision, plan } | { fallback: reason, failed: bool }
    this.onAir = null;           // { kind, dir?, hourStart, decision, plan, handle }
    this.streak = 0;             // hours in a row that fell back because they failed
    this.hours = [];             // per-hour summary (for the rehearsal report and tests)
    this.stopping = false;
    this.offAir = null;          // { at, hour } once PAUSE took the stream off air
  }

  /** Sleep until `t`, looking for PAUSE at least every 30 s (#208: it takes the stream off air, mid-hour too). */
  async sleepUntil(t) {
    while (!this.stopping && this.now() < t) {
      if (this.isPaused()) { await this.goOffAir(); break; }
      await this.sleep(Math.min(30_000, t - this.now()));
    }
  }

  /** PAUSE: stop the playout (no headline screen), complete the broadcast, stop the loop. Resume is by hand. */
  async goOffAir() {
    if (this.offAir) return;
    const air = this.onAir;
    this.offAir = { at: this.now(), hour: air?.hourStart ? hourStamp(air.hourStart) : null };
    this.stopping = true;
    this.log("PAUSE: taking the stream OFF AIR (no headline screen); nothing airs until PAUSE is removed by hand");
    if (air) { air.retired = true; await air.handle?.stop(); if (air.hourStart) this.status(air.hourStart, { stage: "paused-off-air", pausedAt: this.now() }); }
    this.onAir = null;
    if (this.broadcast) await this.broadcast.end("PAUSE");
  }
  dirFor(h) { return path.join(this.airDir, hourStamp(h)); }

  status(h, patch) {
    const f = path.join(this.dirFor(h), "status.json");
    let s = {}; try { s = JSON.parse(fs.readFileSync(f, "utf8")); } catch { /* new */ }
    s = { ...s, ...patch, updatedAt: this.now() };
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify(s, null, 1));
    return s;
  }

  /** Run the loop for `hours` hours (Infinity = until stopped). */
  async run({ hours = Infinity, signal } = {}) {
    signal?.addEventListener("abort", () => { this.stopping = true; }, { once: true });
    fs.mkdirSync(this.airDir, { recursive: true });
    if (this.isPaused()) { this.offAir = { at: this.now(), hour: null }; this.log("PAUSE is set: not going on air"); return this.hours; }
    if (this.broadcast) await this.broadcast.open(this.now());
    await this.handover(null);   // until the first prepared hour, the 24/7 screen is on air
    if (this.broadcast) this.broadcast.goLive();
    let H = firstHour(this.now());
    const jobs = [];
    for (let n = 0; n < hours && !this.stopping; n++, H += HOUR) {
      await this.sleepUntil(H - this.opts.prepareLeadMin * MIN);
      if (this.stopping) break;
      const h = H;
      jobs.push(this.queue.enqueue(`prepare ${hourStamp(h)}`, () => this.prepare(h)).catch((e) => this.log(`prepare ${hourStamp(h)} crashed: ${e.stack || e.message}`)));
      await this.sleepUntil(H - this.opts.refreshAtMin * MIN);
      if (this.stopping) break;
      const air = this.onAir;
      if (air?.kind === "programme" && air.decision === "produced") jobs.push(this.queue.enqueue(`refresh ${hourStamp(air.hourStart)}`, () => this.refresh(air)).catch((e) => this.log(`refresh crashed: ${e.message}`)));
      await this.sleepUntil(H - this.opts.handoverLeadSec * 1000);
      if (this.stopping) break;
      await this.handover(H);
    }
    if (!this.stopping && Number.isFinite(hours) && hours > 0) await this.sleepUntil(H - this.opts.handoverLeadSec * 1000);   // let the last hour play out
    this.stopping = true;
    if (this.onAir) this.onAir.retired = true;
    await this.onAir?.handle?.stop();   // off air first; a producer still running cannot air anything now
    if (this.broadcast) await this.broadcast.end(this.offAir ? "PAUSE" : "the loop stopped");
    await Promise.allSettled(jobs);
    this.log(`stopped after ${this.hours.length} hour(s)${this.offAir ? " (PAUSE: off air)" : ""}`);
    return this.hours;
  }

  /** Make hour H ready to air, or record why it cannot be. */
  async prepare(H) {
    const plan = this.grid(H);
    const dir = this.dirFor(H);
    const deadline = H - this.opts.produceByLeadMin * MIN;
    const st = { hourStart: H, hour: new Date(H).toISOString(), plan, stage: "preparing", writer: { calls: 0, failures: 0, limitHit: false }, startedAt: this.now() };
    this.status(H, st);
    const fail = (reason, failed = true) => {
      this.ready.set(H, { fallback: reason, failed, plan });
      this.status(H, { stage: "fallback", decision: "fallback", failure: reason, failed, writer: st.writer });
      this.log(`hour ${hourStamp(H)}: NOT READY (${reason}); the 24/7 headline screen will air`);
    };
    if (this.isPaused()) return fail("PAUSE file present", false);

    const produceStep = async (args, kind) => {
      const before = writerRunCount(dir);
      const forced = this.forceFail.has(H) || this.forceFail.has(hourStamp(H));
      const code = forced ? (this.log(`hour ${hourStamp(H)}: FORCED producer failure (rehearsal switch)`), 1) : await this.produce({ hourStart: H, out: dir, weather: plan.weather, deadline, ...args });
      const run = writerRunSince(dir, before);
      if (run) {
        st.writer.calls += run.calls; st.writer.failures += run.failures; st.writer.limitHit ||= run.limitHit;
        const day = this.ledger.add(H, run, kind);
        this.log(`hour ${hourStamp(H)}: writer ${run.calls} call(s), ${run.failures} failure(s)${run.limitHit ? ", usage limit hit" : ""}; today ${day.calls}/${this.ledger.maxPerDay}`);
      }
      this.status(H, { writer: st.writer });
      return code;
    };

    let decision = plan.format;
    let guard = this.ledger.guard();
    if (!guard.ok) { this.log(`hour ${hourStamp(H)}: cost guard: ${guard.reason}`); st.costGuard = guard.reason; this.status(H, { costGuard: guard.reason }); }
    if (decision === "produced" && !guard.ok) decision = "repeat";

    if (decision === "produced") {
      this.status(H, { stage: "producing", decision });
      const code = await produceStep({}, "produce");
      if (code !== 0) {
        guard = this.ledger.guard();
        if (!guard.ok && this.now() < deadline - this.opts.minRepeatTimeMin * MIN) {
          this.log(`hour ${hourStamp(H)}: producer failed (exit ${code}) and ${guard.reason}: trying a repeat instead`);
          decision = "repeat";
        } else return fail(`producer failed (exit ${code})`);
      }
    }
    if (decision === "repeat") {
      const src = pickStrongest(this.airDir, H);
      if (!src) return fail("no produced hour in the last 18 h to repeat");
      this.status(H, { stage: "repeating", decision, repeatOf: path.basename(src.dir) });
      let moved;
      try { moved = prepareRepeat(src.dir, dir, H, { now: this.now() }); } catch (e) { return fail(`repeat copy failed: ${e.message}`); }
      // #249: the repeated Markets Now, re-checked at this hour's air time
      for (const m of moved.repeatMarkets?.slots || []) if (m.action !== "kept") this.log(`hour ${hourStamp(H)}: repeat ${m.id}: ${m.action} (${m.measured ? m.stale[0] : m.why})`);
      this.status(H, { repeatMarkets: moved.repeatMarkets?.slots.map(({ id, action }) => ({ id, action })) || null });
      const code = await produceStep({ from: "the-hour", to: "markets-1", headlineWriter: !this.ledger.guard().ok }, "repeat-top");
      if (code !== 0) return fail(`fresh top of the hour for the repeat failed (exit ${code})`);
    }
    const check = this.check(dir, { hourStart: H });
    this.status(H, { check });
    if (!check.ok) return fail(`air check: ${check.problems.join("; ")}`);
    this.ready.set(H, { dir, decision, plan });
    this.status(H, { stage: "ready", decision, readyAt: this.now() });
    this.log(`hour ${hourStamp(H)}: READY (${decision}) ${JSON.stringify(check.stats)}`);
  }

  /** :30 breaking-news refresh of the hour on air. */
  async refresh(air) {
    const H = air.hourStart, dir = air.dir;
    const note = (r) => { this.status(H, { refresh: { at: this.now(), ...r } }); this.log(`hour ${hourStamp(H)}: refresh: ${r.result}`); };
    if (this.isPaused()) return note({ result: "skipped (PAUSE)" });
    const guard = this.ledger.guard();
    if (!guard.ok) return note({ result: `skipped (cost guard: ${guard.reason})` });
    let oldTop = null, prog = null;
    try { oldTop = JSON.parse(fs.readFileSync(path.join(dir, "pack.json"), "utf8")).top?.[0] || null; prog = JSON.parse(fs.readFileSync(path.join(dir, "programme.json"), "utf8")); } catch { /* unreadable */ }
    let top = null;
    try { top = await this.topStory(); } catch (e) { return note({ result: `skipped (top story unavailable: ${e.message})` }); }
    const changed = this.forceTopChange ? true : topChanged(oldTop, top);
    if (!changed) return note({ result: "top story unchanged", top: top?.headline || null });
    const slot = refreshSlot(prog, this.now() + this.opts.refreshLeadMin * MIN);
    if (!slot) return note({ result: "top story changed, but no music slot is far enough ahead", top: top?.headline });
    const before = writerRunCount(dir);
    const code = await this.produce({ hourStart: H, out: dir, from: slot.id, weather: air.plan?.weather !== false, deadline: slot.start - MIN });
    const run = writerRunSince(dir, before);
    if (run) {
      const day = this.ledger.add(H, run, "refresh");
      const s = this.status(H, {});
      const w = s.writer || { calls: 0, failures: 0 };
      this.status(H, { writer: { ...w, calls: w.calls + run.calls, failures: w.failures + run.failures, limitHit: !!(w.limitHit || run.limitHit) } });
      this.log(`hour ${hourStamp(H)}: refresh writer ${run.calls} call(s), ${run.failures} failure(s); today ${day.calls}/${this.ledger.maxPerDay}`);
    }
    note({ result: code === 0 ? `re-produced from ${slot.id} (top story changed)` : `refresh failed (exit ${code}); the hour keeps its script`, from: slot.id, top: top?.headline, was: oldTop?.headline, forced: this.forceTopChange || undefined, ok: code === 0 });
  }

  /** Switch the air to hour H (null: the 24/7 screen, at start-up). */
  async handover(H) {
    if (this.isPaused()) return this.goOffAir();   // #208: PAUSE is off air, never the headline screen
    const r = H === null ? null : this.ready.get(H) || { fallback: "not prepared in time", failed: true, plan: this.grid(H) };
    const want = r?.dir ? { kind: "programme", dir: r.dir } : { kind: "247" };

    if (H !== null) {
      if (r.dir) this.streak = 0;
      else if (r.failed) {
        this.streak++;
        const n = this.streak, a = this.opts.alertAfter;
        if (n === a || (n > a && (n - a) % 6 === 0)) await this.alert(`${n} hours in a row have fallen back to the 24/7 headline screen. Latest: ${hourStamp(H)}: ${r.fallback}. Air is not dark.`);
      }
    }

    const roll = H !== null && this.broadcast?.current && broadcastRollDue({ startedAt: this.broadcast.startedAt, at: this.now(), rollEtHours: this.opts.rollEtHours })
      ? await this.broadcast.prepareRoll(this.now()) : false;

    const keep = this.onAir?.kind === "247" && want.kind === "247" && !roll;
    if (!keep) {
      const old = this.onAir?.handle;
      if (this.onAir) this.onAir.retired = true;
      await old?.stop();
      if (roll) await this.broadcast.swap(this.now());
      this.onAir = { ...want, hourStart: H, decision: r?.decision || "fallback", plan: r?.plan || null, restarts: 0 };
      this.startHandle(this.onAir);
      if (roll) this.broadcast.goLive();
    } else Object.assign(this.onAir, { hourStart: H, decision: "fallback", plan: r?.plan || null, restarts: 0 });   // same object: its restart watcher stays attached

    if (H !== null) {
      const summary = { hour: hourStamp(H), hourStart: H, aired: want.kind, decision: r.dir ? r.decision : "fallback", reason: r.fallback || null, rolled: !!roll };
      this.hours.push(summary);
      this.status(H, { stage: want.kind === "programme" ? "on-air" : "fallback-on-air", aired: want.kind, onAirAt: this.now(), streak: this.streak, rolledBroadcast: !!roll || undefined });
      this.log(`HAND-OVER ${hourStamp(H)}: ${want.kind === "programme" ? `programme (${r.decision})` : `24/7 headline screen (${r.fallback})`}${keep ? ", kept running" : ""}${roll ? "; YouTube broadcast rolled" : ""}`);
    } else this.log("on air: 24/7 headline screen until the first prepared hour");
  }

  startHandle(air) {
    air.handle = this.playout.start({ kind: air.kind, dir: air.dir, hourStart: air.hourStart });
    air.handle.done.then(async (code) => {
      if (air.retired || this.stopping || this.onAir !== air) return;
      await this.sleep(5_000);   // no tight restart loop against a broken encoder or network
      if (air.retired || this.stopping || this.onAir !== air) return;
      air.restarts++;
      if (air.kind === "programme" && air.restarts > this.opts.maxRestartsPerHour) {
        this.log(`programme playout died ${air.restarts} times this hour; the 24/7 screen takes over`);
        this.alert(`the programme playout keeps failing (exit ${code}); the 24/7 headline screen is on air for the rest of the hour.`);
        Object.assign(air, { kind: "247", dir: undefined, restarts: 0 });
      } else this.log(`${air.kind} playout exited (${code}); restarting (${air.restarts})`);
      this.startHandle(air);
    });
  }
}
