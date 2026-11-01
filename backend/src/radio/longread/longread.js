/**
 * longread.js - The Long Read (#304, #281 note 5): a ~7-minute piece ScoopFeeds writes itself about one major
 * story, from that story's coverage in the event graph, read by one presenter.
 *
 * It is NOT another outlet's article read aloud (#281 decision 4: only text ScoopFeeds writes, or public-domain
 * text, is read in full). Outlets are summarised and credited; quotes are short. The fact base is what
 * scoopfeeds.com's public API serves for the event: article titles and summaries, and the dated timeline. No
 * article bodies are fetched.
 *
 *   make   pickEvent -> gather (articles + timeline, every article through the radio's Rule 0 layer)
 *          -> one Claude call (cli.mjs) -> checkLongread -> store (draft | ready | refused)
 *   air    produce.mjs, RADIO_LONGREAD_ENABLED=1 and the v1.5 clock, in a long-read hour: The News, Compared #2
 *          and the music block after it become "The Long Read" (addLongReadToClock), filled with the newest
 *          eligible piece (pickForAir) and re-checked with the hour's checkSegments
 *
 * Pure except fetchLongreadPack (network). The store is store.js.
 */
import { radioRulesVerdict } from "../radioRules.js";
import { airable } from "../programme/factPack.js";
import { checkSegments, toSpoken } from "../programme/checks.js";
import { wordBudget } from "../programme/clock.js";

// ─── flags ─────────────────────────────────────────────────────────────────────
/** RADIO_LONGREAD_ENABLED: literally "1" only. Off, every hour is exactly what it was. */
export const longReadOn = (env = process.env) => env.RADIO_LONGREAD_ENABLED === "1";
/** RADIO_LONGREAD_REVIEW: on unless literally "0". On, a piece waits as a draft until `cli.mjs approve`. */
export const reviewOn = (env = process.env) => String(env.RADIO_LONGREAD_REVIEW ?? "").trim() !== "0";
/** RADIO_LONGREAD_HOURS_ET: the New York hours a long read airs in; default 7, 12 and 20. */
export const DEFAULT_HOURS_ET = [7, 12, 20];
export function longReadHours(env = process.env) {
  const raw = String(env.RADIO_LONGREAD_HOURS_ET ?? "").trim();
  if (!raw) return DEFAULT_HOURS_ET;
  const hs = raw.split(",").map((x) => Number(x.trim())).filter((h) => Number.isInteger(h) && h >= 0 && h <= 23);
  return hs.length ? [...new Set(hs)] : DEFAULT_HOURS_ET;
}

// ─── the piece ─────────────────────────────────────────────────────────────────
export const STORY_ID = "lr1";
export const SLOT_ID = "longread";
export const TITLE = "The Long Read";
/** The slot: The News, Compared #2 (360 s) + the music block after it (90 s) in the v1.5 clock. */
export const SLOT_SEC = 450;
export const WORDS_MIN = 600;
export const WORDS_TARGET = [850, 1000];
export const QUOTE_MAX_WORDS = 25, QUOTES_PER_OUTLET = 2, OUTLETS_MIN = 3, DROP_MAX_SHARE = 0.15;
export const SECTIONS = [
  ["happened", "What happened"],
  ["background", "How we got here"],
  ["players", "Who is involved"],
  ["coverage", "How the coverage differs"],
  ["next", "What to watch"],
];
export const SECTION_LABEL = Object.fromEntries(SECTIONS);
/** Air: a piece is eligible for this long after it was made, and for this many distinct hours. */
export const MAX_AGE_MS = 36 * 3600_000, MAX_AIRINGS = 3;
/** Pick: an event needs this much coverage, and is not picked again within 7 days. */
export const PICK = { minSources: 4, minArticles: 6, activeWithinMs: 48 * 3600_000, repeatAfterMs: 7 * 86400_000, candidates: 6 };

/** Words the slot can carry (the hour's own sizing rule, clock.js wordBudget). */
export const slotWords = () => wordBudget({ lenSec: SLOT_SEC, sting: true });
export const wordCount = (t) => String(t || "").split(/\s+/).filter(Boolean).length;

const DATE = (ms) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" }).format(new Date(ms));
const list = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

// ─── pick ──────────────────────────────────────────────────────────────────────
/**
 * Candidate events, best first: active, with enough outlets and articles (never a machine event: no articles),
 * a title that passes Rule 0, not already a long read in the last 7 days. `events` in the API's prominence order.
 */
export function candidateEvents(events, { now = Date.now(), recentSlugs = new Set() } = {}) {
  const out = [];
  for (const e of events || []) {
    if (!e?.slug || !e.title) continue;
    if (e.status && e.status !== "active") continue;
    if ((e.article_count || 0) < PICK.minArticles || (e.source_count || 0) < PICK.minSources) continue;
    if (e.last_activity_at && now - Number(e.last_activity_at) > PICK.activeWithinMs) continue;
    if (recentSlugs.has(e.slug)) continue;
    if (!radioRulesVerdict({ title: e.title, description: e.summary || "", source_name: "", category: e.category }).allowed) continue;
    out.push(e);
  }
  return out;
}

const OPINION = /\/(opinion|opinions|op-ed|oped|commentary|columns?|editorials?|analysis\/opinion)\//i;

/**
 * The piece's fact base from the event's articles and timeline. `story` has the shape the hour's fact pack uses
 * ({ id, headline, outlets: [{ source, title, description, published, url }], count }), so checkSegments and the
 * screen read it unchanged. Timeline items are dated entries ("On 28 October 2026: ...") so a date the writer
 * gives is backed. The headline is an outlet's own title (on-screen text is never model text).
 * @returns {{ story, articles, timeline, sources: string[], dropped: string[] } | { refused: string }}
 */
export function buildStory(event, articles, occurrences = []) {
  const dropped = [];
  const arts = [];
  for (const a of articles || []) {
    const title = String(a.title || "").trim();
    if (!title) continue;
    if (OPINION.test(a.url || "")) { dropped.push(`opinion: ${title}`); continue; }
    const desc = String(a.summary ?? a.description ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!airable({ title, description: desc, source_name: a.source_name, category: a.category })) { dropped.push(`rule0: ${title}`); continue; }
    arts.push({ id: `a${arts.length + 1}`, source: a.source_name || "?", title, description: desc.slice(0, 600), published: Number(a.published_at) || null, url: a.url || null, credibility: a.credibility ?? null });
  }
  const sources = [...new Set(arts.map((a) => a.source).filter((s) => s && s !== "?"))];
  if (arts.length < PICK.minArticles || sources.length < PICK.minSources) return { refused: `after Rule 0: ${arts.length} article(s) from ${sources.length} outlet(s) (needs ${PICK.minArticles} from ${PICK.minSources})`, dropped };
  const timeline = (occurrences || [])
    .filter((o) => o?.headline && Number.isFinite(Number(o.ts)) && airable({ title: o.headline, description: "", source_name: o.source_name }))
    .map((o, i) => ({ id: `tl${i + 1}`, ts: Number(o.ts), headline: String(o.headline).trim(), outlets: (o.outlets || []).filter(Boolean), source: o.source_name || (o.outlets || [])[0] || "?" }))
    .sort((a, b) => a.ts - b.ts)
    .slice(-24);
  // headline, always an outlet's own words: the article the event is titled after; else the newest straight (not a
  // question) headline from the event's most-covering outlet; else that outlet's newest
  const bySource = new Map();
  for (const a of arts) bySource.set(a.source, (bySource.get(a.source) || 0) + 1);
  const leadSource = [...bySource.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
  const newest = (xs) => [...xs].sort((a, b) => (b.published || 0) - (a.published || 0))[0];
  const fromLead = arts.filter((a) => a.source === leadSource);
  const lead = arts.find((a) => event?.title && a.title === String(event.title).trim()) || newest(fromLead.filter((a) => !a.title.includes("?"))) || newest(fromLead);
  const outlets = [
    ...arts.map(({ source, title, description, published, url }) => ({ source, title, description, published, url })),
    ...timeline.map((t) => ({ source: t.source, title: t.headline, description: `On ${DATE(t.ts)}: ${t.headline}${t.outlets.length ? ` (reported by ${list(t.outlets)})` : ""}.`, published: t.ts, url: null, timeline: true })),
  ];
  const story = { id: STORY_ID, headline: lead.title, outlets, count: sources.length, event: event?.slug || null };
  return { story, articles: arts, timeline, sources, dropped };
}

/** Network: candidates from /api/ri/events, then the first whose coverage survives buildStory. */
export async function fetchLongreadPack({ base = "https://scoopfeeds.com", fetchImpl = fetch, now = Date.now(), recentSlugs = new Set(), log = () => {} } = {}) {
  const get = async (p) => {
    const r = await fetchImpl(`${base}${p}`, { headers: { Accept: "application/json", "User-Agent": "ScoopFeedsRadio/1.0 longread" }, signal: AbortSignal.timeout(60_000) });
    if (!r.ok) throw new Error(`${p} -> HTTP ${r.status}`);
    return r.json();
  };
  const evs = (await get("/api/ri/events?sort=prominence&limit=40")).events || [];
  const cands = candidateEvents(evs, { now, recentSlugs }).slice(0, PICK.candidates);
  log(`longread: ${evs.length} events, ${cands.length} candidate(s)`);
  const tried = [];
  for (const e of cands) {
    try {
      const [arts, tl] = await Promise.all([get(`/api/ri/events/${encodeURIComponent(e.slug)}/articles?limit=100`), get(`/api/ri/events/${encodeURIComponent(e.slug)}/timeline-log`).catch(() => ({ occurrences: [] }))]);
      const r = buildStory(e, arts.articles || [], tl.occurrences || []);
      if (r.refused) { tried.push({ slug: e.slug, why: r.refused }); log(`longread: ${e.slug}: ${r.refused}`); continue; }
      return { event: { slug: e.slug, title: e.title, category: e.category || null, source_count: e.source_count, article_count: e.article_count }, ...r, tried, builtAt: now };
    } catch (err) { tried.push({ slug: e.slug, why: err.message }); log(`longread: ${e.slug} failed: ${err.message}`); }
  }
  return { event: null, refused: cands.length ? "no candidate survived the checks" : "no event has enough coverage", tried, builtAt: now };
}

// ─── write ─────────────────────────────────────────────────────────────────────
export const SYSTEM = [
  "You write The Long Read for ScoopFeeds Radio: one story at length, in plain spoken English, for listeners around the world.",
  "ScoopFeeds is 'the news, compared': it brings together what many outlets report and says where they differ, fairly.",
  "Rules:",
  "1. Use ONLY the material given (articles and timeline). No outside knowledge, no guesses, no figures that are not in it.",
  "2. Attribute: every paragraph names, in its text, at least one outlet from the material ('Reuters reports', 'according to the BBC'), and lists every outlet it draws on in \"sources\", spelled exactly as in the material.",
  `3. Quotes: only words that appear verbatim in the material, in double quotes, at most ${QUOTE_MAX_WORDS} words each, at most ${QUOTES_PER_OUTLET} from any one outlet. Summarise; never reproduce an article.`,
  "4. Dates: as written in the timeline ('on 28 October') or as weekdays; never invent a date.",
  "5. No opinion of your own, no prediction, no speculation. 'What to watch' is only what the material says is due or expected.",
  "6. Never talk about your sources as material, a pack or data ('in the articles we have'); talk about the outlets.",
  "7. Written to be heard: short sentences, numbers as a listener hears them, no lists, no headings read out, no URLs.",
  "Reply with JSON only.",
].join("\n");

export function buildPrompt(pk, { budget = slotWords() } = {}) {
  const [lo, hi] = WORDS_TARGET;
  const arts = pk.articles.map((a) => `[${a.id}] ${a.source}${a.published ? `, ${DATE(a.published)}` : ""}: ${a.title}${a.description ? ` — ${a.description}` : ""}`).join("\n");
  const tl = pk.timeline.map((t) => `[${t.id}] ${DATE(t.ts)}: ${t.headline}${t.outlets.length ? ` (${t.outlets.join(", ")})` : ""}`).join("\n");
  return [
    `STORY: ${pk.story.headline}`,
    `OUTLETS IN THE MATERIAL: ${pk.sources.join(", ")}`,
    "", "ARTICLES (outlet, date: title — summary):", arts,
    "", "TIMELINE (oldest first):", tl || "(none)",
    "",
    `Write The Long Read on this story: ${lo}-${hi} words in all (never more than ${budget}), in paragraphs of 60-120 words, in these five sections, in this order:`,
    ...SECTIONS.map(([id, label]) => `- "${id}": ${label}${id === "coverage" ? " (where outlets differ in emphasis, framing or facts; if they agree, say what they agree on)" : ""}`),
    "Do not write an introduction or a sign-off: they are added for you.",
    'JSON: {"lines": [{"id": "p1", "section": "happened", "sources": ["Outlet", ...], "text": "..."}, ...]} with ids p1, p2, ... in reading order.',
  ].join("\n");
}

/**
 * 1 Nov 2026: one repair round instead of refusing a whole piece over a few paragraphs. The paragraphs the checks
 * dropped go back to the writer with the exact reason, and it rewrites only those. The whole revised piece is then
 * checked again from scratch with checkLongread(): nothing is waved through, and the refusal rules are unchanged.
 * @returns {string|null} the revision prompt, or null when nothing was dropped
 */
export function revisionPrompt(written, report) {
  const failed = new Map();
  for (const r of report || []) if (r?.line && /^p\d+$/.test(r.line) && !failed.has(r.line)) failed.set(r.line, r.drop);
  if (!failed.size) return null;
  const items = [...failed].map(([id, why]) => {
    const l = written.lines[Number(id.slice(1)) - 1] || {};
    return `- ${id} (section "${l.section}"): FAILED because ${why}\n  TEXT: ${String(l.text || "").replace(/\s+/g, " ")}`;
  });
  return [
    "Some paragraphs of your Long Read failed the ScoopFeeds checks. Rewrite ONLY these paragraphs so they pass, keeping",
    "their place, section and length. Every rule from before still applies. In particular: a quote must be copied",
    "verbatim from an article title or summary in the material (otherwise paraphrase and attribute it); at most",
    `${QUOTES_PER_OUTLET} quotes from any one outlet across the whole piece; a past election result is background, so give`,
    "its year (e.g. 'the 2022 election') and never present it as a new result.",
    "",
    ...items,
    "",
    'JSON: {"lines": [{"id": "p3", "section": "...", "sources": ["Outlet", ...], "text": "..."}, ...]} with the SAME ids.',
  ].join("\n");
}

/** The writer's revised paragraphs put back in place (same ids); anything else in the reply is ignored. */
export function applyRevision(written, revised) {
  const lines = written.lines.map((l) => ({ ...l }));
  let n = 0;
  for (const r of revised?.lines || []) {
    const i = /^p(\d+)$/.test(String(r?.id)) ? Number(String(r.id).slice(1)) - 1 : -1;
    if (i < 0 || i >= lines.length || typeof r?.text !== "string" || !r.text.trim()) continue;
    lines[i] = { section: r.section || lines[i].section, sources: Array.isArray(r.sources) ? r.sources : lines[i].sources, text: r.text };
    n++;
  }
  return { written: { ...written, lines }, replaced: n };
}

/** The mechanical open and close (not model text): the outlets' own headline, and every outlet credited. */
export function frameLines(story, credited) {
  return {
    open: { id: "open", story: STORY_ID, mechanical: true, text: `This is ${TITLE}, on ScoopFeeds Radio. ${toSpoken(story.headline).replace(/[.!?]?$/, ".")}` },
    close: { id: "close", story: STORY_ID, mechanical: true, text: `That was ${TITLE}, put together by ScoopFeeds from the reporting of ${list(credited)}.` },
  };
}

// ─── checks ────────────────────────────────────────────────────────────────────
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const namesOutlet = (text, src) => new RegExp(`(^|[^A-Za-z])${esc(src)}([^A-Za-z]|$)`, "i").test(text);
const quotesIn = (t) => [...String(t).matchAll(/[“"]([^”"]{4,})[”"]/g)].map((m) => m[1]);

/**
 * Check a written piece. Every line first goes through the hour's own checkSegments (Rule 0, figures, verbatim
 * quotes, outlets, the election rules) against the piece's fact base; then the long read's own rules. A line that
 * fails is dropped; the piece is refused when what is left is not a whole piece. A check that cannot run is a
 * refusal (unmeasured is a fail).
 * @param {{ lines: object[] }} written   the writer's reply
 * @returns {{ ok: boolean, reasons: string[], segment: { story, lines }, report: object[], words: number, written: number, credited: string[] }}
 */
export function checkLongread(written, story, { log = () => {}, budget = slotWords() } = {}) {
  const fail = (why) => ({ ok: false, reasons: [why], segment: { story: STORY_ID, lines: [] }, report: [], words: 0, written: 0, credited: [] });
  if (!Array.isArray(written?.lines) || !written.lines.length) return fail("the writer returned no lines");
  const sections = new Set(SECTIONS.map(([id]) => id));
  const lines = written.lines.map((l, i) => ({ id: `p${i + 1}`, story: STORY_ID, section: l?.section, sources: Array.isArray(l?.sources) ? l.sources.map(String) : [], text: String(l?.text || "") }));
  const writtenWords = lines.reduce((n, l) => n + wordCount(l.text), 0);
  const known = new Set(story.outlets.map((o) => o.source));
  const report = [];
  const drop = (l, why) => { report.push({ slot: SLOT_ID, line: l.id, drop: why, text: l.text.slice(0, 120) }); log(`✂ longread/${l.id}: ${why}`); };

  // 1 · the hour's checks, on a pack that holds only this story
  let checked;
  try {
    const pack = { top: [], desks: {}, longread: { story }, markets: [], weather: [], crypto: [] };
    const slot = { id: SLOT_ID, kind: "spoken", segment: "longread", title: TITLE };
    const r = checkSegments({ [SLOT_ID]: { story: STORY_ID, lines } }, [slot], pack, { log });
    checked = r.segments[SLOT_ID]?.lines;
    report.push(...r.report);
    if (!Array.isArray(checked)) return fail("checkSegments returned no segment (unmeasured)");
  } catch (e) { return fail(`checks could not run: ${e.message}`); }

  // 2 · the long read's own rules
  const quoteCount = new Map();
  const kept = [];
  for (const l of checked) {
    if (!sections.has(l.section)) { drop(l, `section "${l.section}" is not one of ${[...sections].join(", ")}`); continue; }
    const unknown = l.sources.filter((s) => !known.has(s));
    if (!l.sources.length) { drop(l, "no sources listed"); continue; }
    if (unknown.length) { drop(l, `source(s) not in the material: ${unknown.join(", ")}`); continue; }
    if (!l.sources.some((s) => namesOutlet(l.text, s))) { drop(l, "attribution: the paragraph names none of its sources"); continue; }
    const qs = quotesIn(l.text);
    const long = qs.find((q) => wordCount(q) > QUOTE_MAX_WORDS);
    if (long) { drop(l, `quote over ${QUOTE_MAX_WORDS} words: "${long.slice(0, 60)}…"`); continue; }
    // a quote belongs to the outlet(s) whose own text holds it
    const owners = qs.map((q) => [...new Set(story.outlets.filter((o) => `${o.title} ${o.description}`.toLowerCase().includes(q.toLowerCase())).map((o) => o.source))]);
    const over = owners.flat().find((src) => (quoteCount.get(src) || 0) + owners.filter((o) => o.includes(src)).length > QUOTES_PER_OUTLET);
    if (over) { drop(l, `more than ${QUOTES_PER_OUTLET} quotes from ${over}`); continue; }
    for (const o of owners) for (const src of o) quoteCount.set(src, (quoteCount.get(src) || 0) + 1);
    kept.push(l);
  }

  // 3 · is it still a whole piece?
  const words = kept.reduce((n, l) => n + wordCount(l.text), 0);
  const credited = [...new Set(kept.flatMap((l) => l.sources))];
  const reasons = [];
  const missing = SECTIONS.filter(([id]) => !kept.some((l) => l.section === id)).map(([, label]) => label);
  if (missing.length) reasons.push(`section(s) lost: ${missing.join(", ")}`);
  if (credited.length < OUTLETS_MIN) reasons.push(`only ${credited.length} outlet(s) credited (needs ${OUTLETS_MIN})`);
  const frame = frameLines(story, credited);
  const total = words + wordCount(frame.open.text) + wordCount(frame.close.text);
  if (words < WORDS_MIN) reasons.push(`${words} words survived (needs ${WORDS_MIN})`);
  if (total > budget) reasons.push(`${total} words with the open and close; the slot carries ${budget}`);
  const droppedShare = writtenWords ? 1 - words / writtenWords : 1;
  if (droppedShare > DROP_MAX_SHARE) reasons.push(`${Math.round(droppedShare * 100)}% of the words were dropped (at most ${Math.round(DROP_MAX_SHARE * 100)}%)`);
  return { ok: reasons.length === 0, reasons, segment: { story: STORY_ID, lines: [frame.open, ...kept, frame.close] }, report, words, written: writtenWords, credited };
}

// ─── air ───────────────────────────────────────────────────────────────────────
/** Is H a long-read hour (its New York hour is in `hours`)? */
export function isLongReadHour(hourStart, hours = longReadHours()) {
  const h = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" }).format(new Date(hourStart)));
  return hours.includes(h);
}

/** May this piece air? null when it may, else why not. */
export function airVerdict(p, { now = Date.now(), review = reviewOn(), hourStart = null } = {}) {
  if (!p || !p.segment || !p.story) return "not a long read";
  if (p.status === "refused") return "refused";
  if (review && p.status !== "approved") return `review is on and the piece is ${p.status || "unknown"}, not approved`;
  if (!review && !["ready", "approved"].includes(p.status)) return `the piece is ${p.status || "unknown"}`;
  if (!(now - Number(p.createdAt) <= MAX_AGE_MS)) return `older than ${MAX_AGE_MS / 3600_000} h`;
  const aired = new Set(p.airings || []);
  if (hourStart != null && aired.has(hourStart)) return null;   // this hour again (a refresh): same piece, not a new airing
  if (aired.size >= MAX_AIRINGS) return `already aired in ${aired.size} hours`;
  return null;
}

/** The piece for this hour: the newest that may air (an hour that already carries one keeps it). */
export function pickForAir(pieces, opts = {}) {
  const ok = (pieces || []).filter((p) => !airVerdict(p, opts));
  const same = opts.hourStart != null ? ok.find((p) => (p.airings || []).includes(opts.hourStart)) : null;
  return same || ok.sort((a, b) => Number(b.createdAt) - Number(a.createdAt))[0] || null;
}

/**
 * The Long Read takes The News, Compared #2 and the music block straight after it (v1.5 clock: 2880-3330, 450 s).
 * IN PLACE, like electionDesk.addDeskToClock. Returns the slot, or null when this clock has no such pair (a feature
 * hour that gave them away, or the old clock): then the hour is unchanged.
 */
export function addLongReadToClock(clock) {
  const i = clock.findIndex((s) => s.id === "compared-2");
  const c = clock[i], m = clock[i + 1];
  if (i < 0 || !m || m.kind !== "music" || m.startSec !== c.endSec || m.endSec - c.startSec !== SLOT_SEC) return null;
  const slot = { id: SLOT_ID, kind: "spoken", segment: "longread", title: TITLE, sting: true, daypart: "evening", mechanical: true,
    startSec: c.startSec, endSec: m.endSec, lenSec: m.endSec - c.startSec, start: c.start, end: m.end, ...(c.elements ? { elements: c.elements } : {}) };
  clock.splice(i, 2, slot);
  return slot;
}

/** Screen: the section a line opens, and the outlets it draws on (mechanical text only). */
export function sectionCards(lines) {
  const out = [];
  let prev = null;
  for (const l of lines || []) {
    if (!l.section || l.section === prev) continue;
    prev = l.section;
    out.push({ line: l, label: SECTION_LABEL[l.section] || l.section, text: l.sources?.length ? `Drawing on ${list([...new Set(l.sources)].slice(0, 4))}` : "" });
  }
  return out;
}
