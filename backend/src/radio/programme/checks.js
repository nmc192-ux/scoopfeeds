/**
 * checks.js - every written line is checked against the fact pack before it is voiced.
 * A line that fails is DROPPED, not repaired: on air, silence (the bed) beats a wrong fact.
 *
 *   rule0     Pakistan politics / critical of Pakistan (the radio's own rules layer)
 *   story     a story line must point at a story in the pack
 *   outlet    a Compared line must name an outlet that actually covered that story
 *   numbers   every figure must appear in the pack (story text, market row or weather row)
 *   quotes    quoted words must appear verbatim in the pack
 */
import { radioRulesVerdict, hasPakistanSignal } from "../radioRules.js";
import { storyIndex } from "./factPack.js";

export const toSpoken = (t) => String(t || "").replace(/\s*%/g, " percent").replace(/\s+/g, " ").trim();

// Sentences about our own sourcing ("only X is in our pack", "we have no second account") never go on air: cut the sentence, keep the line.
const BACKSTAGE = /\b(fact pack|our pack|the pack|in our sources|our sources list|we have no (other|second)|no second account|our data|the data we have)\b/i;
const BACKSTAGE_PHRASE = /\b(in|from) the (text|reporting|material|articles) we have,?\s*/gi;
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

export function checkSegments(segments, slots, pack, { log = () => {} } = {}) {
  const idx = storyIndex(pack);
  const marketNums = pack.markets.flatMap((m) => [m.price, m.pct, Math.round(m.price), m.pct == null ? null : Math.round(m.pct * 10) / 10].filter((x) => x != null));
  const weatherNums = pack.weather.flatMap((w) => [w.c, w.f]);
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
        const judged = text.replace(OWN_PHRASES, " ");
        const v = radioRulesVerdict({ title: judged, description: "", source_name: line.outlet || "" });
        if (!v.allowed && (String(v.rule || "").startsWith("radio:") || hasPakistanSignal({ title: judged }))) return `rule0 ${v.rule}`;
        const story = line.story ? idx.get(line.story) : segStory;
        if (line.story && !story) return `story "${line.story}" not in pack`;
        if (line.outlet && (!story || !story.outlets.some((o) => o.source === line.outlet))) return `outlet "${line.outlet}" did not cover this story`;
        const src = story ? storyText(story) : "";
        const pool = slot.segment === "markets" ? marketNums : slot.segment === "weather" ? weatherNums : numsIn(src, { all: true }).concat(marketNums);
        const bad = numsIn(text).filter((n) => !backed(n, pool) && !src.includes(String(n)));
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
  return { segments: out, report };
}
