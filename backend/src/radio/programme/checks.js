/**
 * checks.js - every written line is checked against the fact pack before it is voiced.
 * A line that fails is DROPPED, not repaired: on air, silence (the bed) beats a wrong fact.
 *
 *   rule0     Pakistan politics / critical of Pakistan (the radio's own rules layer)
 *   story     a story line must point at a story in the pack
 *   outlet    a Compared line must name an outlet that actually covered that story
 *   numbers   every figure must appear in the pack (story text, market, crypto or weather row)
 *   quotes    quoted words must appear verbatim in the pack
 *   election  (#197) ScoopFeeds never calls a race: a result line must name the organisation that
 *             projected it, and match a projection in the election pack; polls are never results;
 *             a partial count says how much is in, as the source states it, or "counting continues".
 *             (#208) fraud/rigging or a winner, asserted without a named outlet or official, is dropped.
 *   markets   (#245) a row from the last session (closed) is never read as today's move.
 *   weather   (#247) every city in degrees Celsius: a line that says Fahrenheit is dropped, and a
 *             Fahrenheit figure is not a backed number.
 *   fresh     (#285) the v1.5 half-hour reads only stories The Hour did not read: a line on a story read at :00
 *             (same id, or the same story under another id) is dropped; under 3 lines left, the segment is its
 *             open, one "No major changes since the top of the hour." line and its close.
 */
import { radioRulesVerdict, hasPakistanSignal } from "../radioRules.js";
import { storyIndex, jaccard } from "./factPack.js";
import { electionText, canonOrg, ORGS, statesIn } from "./electionPack.js";
import { electionClaimVerdict } from "../safety/electionClaims.js";
import { staleMarketLine, stripCloseDates } from "./marketsClock.js";
import { weatherUnitReason } from "./weatherUnits.js";

export const toSpoken = (t) => String(t || "").replace(/\s*%/g, " percent").replace(/\s+/g, " ").trim();

// Sentences about our own sourcing ("only X is in our pack", "we have no second account") never go on air: cut the sentence, keep the line.
const BACKSTAGE = /\b(fact pack|our pack|the pack|next update|follow in our|come in our|figures (are|were) not available|no (market )?figures|in our sources|our sources list|we have no (other|second)|no second account|our data|the data we have)\b/i;
const BACKSTAGE_PHRASE = /,?\s*\b(in|from) (the|its|their) (text|reporting|material|articles?|summary|summaries|excerpts?|copy) (we have|we were given|available( to us)?|on hand)\b,?/gi;
export function dropBackstage(text) {
  return String(text).replace(BACKSTAGE_PHRASE, "").replace(/(^|[.!?]\s+)([a-z])/g, (m, a, b) => a + b.toUpperCase()).split(/(?<=[.!?])\s+/).filter((sn) => !BACKSTAGE.test(sn)).join(" ").trim();
}
// Our own station lines name Karachi as a time zone; that is not a Pakistan story.
const OWN_PHRASES = /\b(nine|ten|eleven|one|two|three|four|five|six|seven|eight|twelve|midnight|noon)( o'clock)?( in the (morning|afternoon|evening))? in Karachi\b/gi;

// Numbers that are part of a name, not a figure ("S&P 500", "FTSE 100", "Nikkei 225", "Fortune 500", "G7").
const NAMED = /\b(S&P|FTSE|Nasdaq|Nikkei|Fortune|Russell|Euro Stoxx|KSE-?|Hang Seng|Stoxx|Dow Jones|G|F|Boeing|Airbus A|COVID-?)\s?-?\d+\b/gi;
const CLOCK = /\b\d{1,2}(:\d{2})?\s?(a\.?m\.?|p\.?m\.?)|\b\d{1,2}:\d{2}\b/gi;   // "as of 11:30 AM": a time, not a figure
/** Figures in a text. A small whole number counts as a figure only with money or scale ("$9 billion", "5 percent"); "five stories" does not. */
const numsIn = (t, { all = false } = {}) => {
  const s = String(t).replace(NAMED, " ").replace(CLOCK, " ");
  const out = [];
  for (const m of s.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const n = Number(m[0].replace(/,/g, "")); if (!Number.isFinite(n)) continue;
    const money = s[m.index - 1] === "$" || /^\s*(billion|million|trillion|bn|mn|percent|%|dollars?|pounds?|euros?)/i.test(s.slice(m.index + m[0].length));
    if (all || money || !(Number.isInteger(n) && n <= 12)) out.push(n);
  }
  return out;
};

function storyText(s) {
  return [s.headline, ...s.outlets.flatMap((o) => [o.title, o.description, o.source])].join(" \n ");
}

/** A spoken number is backed when some pack number matches it (rounding allowed: ±0.6 % or ±0.06 absolute). */
export function backed(n, packNums) {
  return packNums.some((m) => Math.abs(m - n) <= Math.max(0.06, Math.abs(m) * 0.006) || Math.abs(Math.abs(m) - n) <= 0.06);
}

// ─── election rules (#197) ──────────────────────────────────────────────────
/** A line about the 2026 races (a line naming an earlier year is background, not a result). */
const RACE_TALK = /\b(midterms?|(senate|governor['’]?s?|gubernatorial|house|congressional) (race|seat|contest|election|majority)s?|race for (the )?(senate|house|governor(ship)?)|called the (race|seat|contest)|(majority in|control of) the (house|senate)|election night)\b/i;
const US_POLITICS = /\b(senate|senator|governor|gubernatorial|house|congress(ional)?|republicans?|democrats?|gop)\b/i;
const ELECT_WORD = /\b(elections?|ballots?|projects?|projected|re-?elected|elected|wins?|won|polls?)\b/i;
const WIN_CLAIM = /\b(wins?|won|winner|will win|victor(y|ious)|re-?elected|elected|defeat(s|ed)?|beat(s|en)?|projects?|projected|called the (race|seat|contest)|declared)\b|\b(holds?|held|keeps?|kept|retains?|retained|takes?|took|captures?|captured|flips?|flipped)( on to| onto)? (control|the (seat|house|senate|majority|governorship)|(a|its|their|his|her) (seat|majority))\b/i;
const NO_CALL = /\b(not (yet )?(been )?(called|projected|declared)|too (early|close|soon) to (call|project)|yet to be (called|projected)|no (call|projection|winner)( has been| yet)?|(has|have)n['’]?t (yet )?(been )?(called|projected)|never calls?)\b/i;
const ATTRIB = /\b(projects?|projected|called|calls|declared|declares|according to)\b/i;
const POLL = /\b(polls?|polling|pollsters?|surveys?|forecasts?|odds)\b/i;
const POLLS_CLOSED = /\bpolls? (have |had )?(closed|close[sd]?|closing|open(ed)?)\b/gi;
const RESULT = /\b(wins?|won|winner|will win|victor(y|ious)|results?|elected|defeat(s|ed)?)\b/i;
const COUNTING = /\b(early returns|votes? counted|counted so far|partial (count|results)|precincts reporting)\b/i;
const LEADS = /\b(leads?|leading|ahead|trails?|trailing)\b/i, COUNT_CTX = /\b(race|count|votes?|returns|ballots|reporting)\b/i;
const HOW_MUCH = /\b\d+(\.\d+)? percent of (the )?(expected |estimated )?(vote|votes|ballots|precincts)\b|\bcounting continues\b/i;
const ORG_NAMES = ORGS.map(([c, names]) => [c, new RegExp(`\\b(${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "i")]);

/** Segments that carry election results: the Midterms desk (#197) and the election night special and day after (#198). */
export const ELECTION_SEGMENTS = new Set(["midterms", "roundup", "update", "results", "counting"]);

/** Is this line about this year's races? */
export function isElectoral(text, slot) {
  const desk = ELECTION_SEGMENTS.has(slot?.segment);
  if (/\b(19|20)(?!26)\d{2}\b/.test(text) && !desk) return false;
  if (desk || RACE_TALK.test(text)) return true;
  return US_POLITICS.test(text.replace(/\bwhite house\b/gi, " ")) && ELECT_WORD.test(text);
}

/** null when an electoral line may air; otherwise why it may not. */
export function electionReason(text, election) {
  const plain = text.replace(POLLS_CLOSED, " ");
  if (POLL.test(plain) && RESULT.test(plain)) return "election: a poll read as a result";
  if ((COUNTING.test(plain) || (LEADS.test(plain) && COUNT_CTX.test(plain))) && !POLL.test(plain) && !HOW_MUCH.test(plain)) return "election: a partial count must say how much is in, or that counting continues";
  if (NO_CALL.test(plain) || !WIN_CLAIM.test(plain)) return null;
  // a result: it must name the projecting organisation, and that projection must be in the pack
  const named = ORG_NAMES.filter(([, re]) => re.test(plain)).map(([c]) => c);
  if (!named.length || !ATTRIB.test(plain)) return "election: a result without the organisation that projected it";
  const states = statesIn(plain);
  const items = (election?.races || []).flatMap((r) => r.calls).concat((election?.items || []).filter((i) => i.kind === "house-seats"));
  const match = items.some((i) => named.includes(canonOrg(i.outlet) || i.outlet) && (
    i.kind === "house-seats" ? /\bseats?\b/i.test(plain)
      : i.race === "house-control" ? /\bhouse\b/i.test(plain) && !states.length
        : i.race === "senate-control" ? /\bsenate\b/i.test(plain) && !states.length
          : states.includes(i.state)));
  return match ? null : "election: no matching attributed projection in the election pack";
}

/** 1 Nov 2026: every crypto change in the pack is a 24-hour change, so "over the past 24 hours" is backed by the data. */
export const CRYPTO_WINDOW_H = 24;

/**
 * 1 Nov 2026 (DrJ): a line that tells listeners what an outlet PUBLISHED ("BBC World has also published a piece in which
 * its correspondent explains how the ceasefire has been unfolding") carries no news. Dropped, whatever segment.
 */
export const ABOUT_PUBLISHING = /\b(has|have|had)( also)? (published|posted|released|put out|run) (a|an|its|their) (piece|article|story|report|video|explainer|analysis|live (page|blog)|feature|podcast|interview|guide)\b|\b(in|on) (a|an|its|their) (piece|article|video|explainer|live (page|blog)|podcast)( in which| where)?\b|\b(correspondent|reporter|editor|analyst)s? [A-Z]?[\w'’.-]*( [A-Z][\w'’.-]*)? (explains?|explained|walks? (us|you|listeners) through|breaks? down|looks? at|unpacks?)\b|\b(read|watch|listen to) (the|our|their|its) (full )?(story|piece|article|report|video|coverage)\b|\b(live (page|blog)|live updates page)\b/i;

export function checkSegments(segments, slots, pack, { log = () => {} } = {}) {
  const idx = storyIndex(pack);
  const marketNums = pack.markets.flatMap((m) => [m.price, m.pct, Math.round(m.price), m.pct == null ? null : Math.round(m.pct * 10) / 10].filter((x) => x != null));
  const weatherNums = pack.weather.map((w) => w.c);   // #247: Celsius only on air
  const elText = pack.election ? electionText(pack.election) : "";
  const elOutlets = new Set((pack.election?.items || []).flatMap((i) => [i.outlet, i.source]).filter(Boolean));
  const cryptoNums = (pack.crypto || []).flatMap((c) => [c.price, c.pct, Math.round(c.price), c.pct == null ? null : Math.round(c.pct * 10) / 10].filter((x) => x != null));
  const report = [];
  const out = {};

  for (const slot of slots) {
    const seg = segments?.[slot.id];
    if (!seg || !Array.isArray(seg.lines)) { report.push({ slot: slot.id, drop: "segment missing" }); continue; }
    const segStory = seg.story ? idx.get(seg.story) : null;
    if (slot.segment === "compared" && !segStory) { report.push({ slot: slot.id, drop: `compared story "${seg.story}" not in pack` }); continue; }
    const kept = [];
    for (const line of seg.lines) {
      const text = dropBackstage(toSpoken(line?.text));
      const why = (() => {
        if (!text) return "empty";
        if (ABOUT_PUBLISHING.test(text)) return "about what an outlet published, not what happened";
        const judged = text.replace(OWN_PHRASES, " ");
        const v = radioRulesVerdict({ title: judged, description: "", source_name: line.outlet || "" });
        if (!v.allowed && (String(v.rule || "").startsWith("radio:") || hasPakistanSignal({ title: judged }))) return `rule0 ${v.rule}`;
        const story = line.story ? idx.get(line.story) : segStory;
        if (line.story && !story) return `story "${line.story}" not in pack`;
        const electoral = isElectoral(text, slot);
        if (line.outlet && (!story || !story.outlets.some((o) => o.source === line.outlet)) && !(electoral && elOutlets.has(line.outlet))) return `outlet "${line.outlet}" did not cover this story`;
        if (electoral) { const e = electionReason(text, pack.election); if (e) return e; }
        // #208: both rules apply; an election-pack outlet counts as a named source for an electoral line
        const election = electionClaimVerdict(text, { outlets: [...(story?.outlets || []).map((o) => o.source), ...(electoral ? [...elOutlets] : [])], outlet: line.outlet || null });
        if (election) return election;
        if (slot.segment === "markets") { const m = staleMarketLine(text, pack.markets); if (m) return m; }
        if (slot.segment === "weather") { const w = weatherUnitReason(text); if (w) return w; }
        const src = (story ? storyText(story) : "") + (electoral && elText ? ` \n ${elText}` : "");
        const pool = slot.segment === "markets" ? marketNums : slot.segment === "weather" ? weatherNums : slot.segment === "crypto" ? cryptoNums.concat(CRYPTO_WINDOW_H) : numsIn(src, { all: true }).concat(marketNums);
        const bad = numsIn(slot.segment === "markets" ? stripCloseDates(text, pack.markets) : text).filter((n) => !backed(n, pool) && !src.includes(String(n)));
        if (bad.length) return `unbacked figure(s) ${bad.join(", ")}`;
        for (const q of text.match(/[“"]([^”"]{4,})[”"]/g) || []) {
          const inner = q.slice(1, -1).toLowerCase();
          if (!src.toLowerCase().includes(inner)) return `quote not in pack: ${q}`;
        }
        return null;
      })();
      if (why) { report.push({ slot: slot.id, line: line?.id, drop: why, text: text.slice(0, 120) }); log(`✂ ${slot.id}/${line?.id}: ${why}`); continue; }
      kept.push({ ...line, text, story: line.story || seg.story || null });
    }
    out[slot.id] = { ...seg, lines: kept };
  }
  for (const slot of slots.filter((s) => s.segment === "half" && s.fresh && out[s.id])) out[slot.id] = freshHalf(out[slot.id], slot, out["the-hour"], idx, report, log);
  return { segments: out, report };
}

export const NO_CHANGE = "No major changes since the top of the hour.";
export const FRESH_MIN = 3;

/** Two pack stories are the same story: same id, near-identical headlines, or an article in common. */
export function sameStoryAs(a, b) {
  if (!a || !b) return false;
  if (a.id === b.id) return true;
  if (jaccard(a.headline, b.headline) >= 0.5) return true;
  const titles = new Set((a.outlets || []).map((o) => o.title).filter(Boolean));
  return (b.outlets || []).some((o) => o.title && titles.has(o.title));
}

/**
 * #285: the v1.5 half-hour after the line checks. Without The Hour in the same run there is nothing to compare against
 * and the half is left as written. In a produced hour the two are always written in the same run (every refresh
 * starts after the half). Known gap: an overnight repeat splices a fresh The Hour over the repeated hour, and the
 * repeated hour's own half (checked against ITS The Hour) is not re-checked against the fresh one.
 */
export function freshHalf(seg, slot, hour, idx, report, log = () => {}) {
  if (!hour) return seg;
  const read = (hour.lines || []).map((l) => idx.get(l.story)).filter(Boolean);
  const isStory = (l) => /^h\d+$/.test(l.id || "");
  const kept = [];
  for (const l of seg.lines) {
    if (isStory(l) && read.some((r) => sameStoryAs(r, idx.get(l.story)))) {
      report.push({ slot: slot.id, line: l.id, drop: "fresh: a story The Hour read", text: String(l.text).slice(0, 120) });
      log(`✂ ${slot.id}/${l.id}: fresh: a story The Hour read`);
      continue;
    }
    kept.push(l);
  }
  const stories = kept.filter(isStory);
  if (stories.length >= FRESH_MIN) return { ...seg, lines: kept.filter((l) => l.id !== "nochange") };
  for (const l of stories) report.push({ slot: slot.id, line: l.id, drop: `fresh: only ${stories.length} new stor${stories.length === 1 ? "y" : "ies"} (under ${FRESH_MIN}): the half says there are no major changes`, text: String(l.text).slice(0, 120) });
  const open = kept.find((l) => l.id === "open"), close = kept.find((l) => l.id === "close");
  const own = kept.find((l) => l.id === "nochange");
  return { ...seg, lines: [...(open ? [open] : []), own || { id: "nochange", story: null, text: NO_CHANGE, mechanical: true }, ...(close ? [close] : [])] };
}
