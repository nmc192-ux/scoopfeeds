/**
 * writer.js - one Claude call writes every spoken segment of the hour from the fact pack.
 *
 * Runs the Claude Code CLI headless (`claude -p`) on the Mac Mini, so it draws on DrJ's
 * subscription, not API billing: ANTHROPIC_API_KEY is removed from the child env (if it
 * were set the CLI would bill the key instead). No tools, no MCP; the answer is JSON only.
 * The writer is injectable so tests and dry runs never call Claude.
 */
import { spawn } from "node:child_process";
import { wordBudget } from "./clock.js";
import { electionText } from "./electionPack.js";

export const SEGMENT_KINDS = ["the-hour", "markets", "compared", "desk", "half", "weather", "crypto", "signoff"];

function fmtPct(p) { return p == null ? "n/a" : `${p > 0 ? "+" : ""}${p.toFixed(2)}%`; }

/** The fact pack as plain text the writer can quote from, every story under its id. */
export function packText(pack) {
  const story = (s) => [`[${s.id}] ${s.headline}  (${s.count} outlet${s.count === 1 ? "" : "s"})`,
    ...s.outlets.map((o) => `    - ${o.source}: "${o.title}"${o.description ? ` — ${o.description}` : ""}`)].join("\n");
  const out = ["TOP STORIES", ...pack.top.map(story)];
  for (const [desk, list] of Object.entries(pack.desks)) out.push("", `DESK: ${desk}`, ...list.map(story));
  out.push("", "MARKETS (price, % change on the day)", ...pack.markets.map((m) => `    ${m.key} (${m.group}): ${m.price} ${fmtPct(m.pct)}`));
  out.push("", "WEATHER NOW", ...pack.weather.map((w) => `    ${w.city}: ${w.c}°C / ${w.f}°F, ${w.condition}`));
  if (pack.election) out.push("", electionText(pack.election));   // the Midterms desk (#197)
  if (pack.crypto?.length) out.push("", "CRYPTO (price in US dollars, % change over 24 hours)", ...pack.crypto.map((c) => `    ${c.key} (${c.sym}): ${c.price} ${fmtPct(c.pct)}`));
  return out.join("\n");
}

const SYSTEM = [
  "You are the writer for ScoopFeeds Radio, a 24/7 English news radio for a US-first, international audience, modelled on Bloomberg Radio.",
  "Its positioning is \"the news, compared\": where outlets cover a story differently, say so, plainly and fairly.",
  "You write words to be READ ALOUD by a synthetic voice: short sentences, active voice, no parentheses, no abbreviations a reader would stumble on, no emoji, no markdown.",
  "Hard rules, never broken:",
  "1. Use ONLY facts in the FACT PACK. Every name, number, date and claim you say must appear there. If it is not in the pack, do not say it.",
  "2. Attribute: say which outlet reported what (\"the Financial Times reports...\").",
  "3. Never put words in quotation marks unless those exact words appear in the pack.",
  "4. Neutral tone. No opinions, no predictions, no adjectives of judgement.",
  "5. Never cover Pakistan's domestic politics, and never say anything critical of Pakistan, its army or its politicians.",
  "6. Never read the same story in two segments, except that a story chosen for The News, Compared may also appear in The Hour.",
  "7. Numbers: write them as digits taken from the pack. Index levels and prices may be rounded to whole numbers (7802.9 -> 7,803), percentages to one decimal place (-0.11% -> \"down 0.1 percent\"). Always the word \"percent\", never the % sign.",
  "8. Stay within each segment's word budget. Under is fine; over is not.",
  "9. Never mention the fact pack, your sources list, or what you do or do not have. If only one outlet reported a story, simply attribute it to that outlet.",
  "11. Choose by news importance for an international, US-first audience: world affairs, conflict, US politics and the economy, and major business come first. Product launches and gadget news get at most ONE story in The Hour.",
  "12. Never cover the same subject (one company, one product family, one event) in more than two segments in the whole hour. The two Compared segments must be on DIFFERENT subjects, and at least one must be world or politics news.",
  "13. Skip opinion columns, op-eds, reviews, explainers and entertainment items: a headline that argues (\"... needs a ...\", \"Why ...\", \"... is wrong\") is not news. Read only reported news.",
  "14. A desk carries only stories on its own beat. If a desk has fewer than two fitting stories, use fitting TOP STORIES, or read fewer stories.",
  "10. Spell out acronyms a listener may not know the first time (e.g. \"the Election Commission\"), and never invent an expansion that is not in the pack.",
  "Reply with ONE JSON object and nothing else.",
].join("\n");

/**
 * @param {object} pack   buildFactPack() result
 * @param {object[]} slots  clock slots of kind "spoken"
 * @param {{ hourLabel: string, cityTimes: string }} when  e.g. { hourLabel: "noon in New York", cityTimes: "nine in the evening in Karachi" }
 */
export function buildPrompt(pack, slots, when) {
  const spec = slots.map((s) => {
    const budget = wordBudget(s);
    const base = `- "${s.id}" (${s.title}, ${Math.round(s.lenSec)} s, max ${budget} words)`;
    switch (s.segment) {
      case "the-hour": return `${base}: line "open" = "It's ${when.hourLabel}, ${when.cityTimes}. This is ScoopFeeds Radio, the news, compared." then one sentence naming the five stories; then exactly ${s.stories} story lines ("s1".."s${s.stories}"), the five most important stories from TOP STORIES or any DESK (rule 11), each ~45-55 words: what happened, why it matters, and, where the pack shows two or more outlets, how their coverage differs; then line "close" = a one-line handoff to ${(slots[slots.indexOf(s) + 1] || {}).title || "the next segment"}. Each story line carries "story": its id.`;
      case "markets": return `${base}: lines "m1".. using only MARKETS rows; lead with the US indices, then Europe, then oil, gold, bitcoin. Say "as of" the time given here: ${when.marketsAsOf[s.id] || "the latest figures"}. "story": null.`;
      case "compared": return `${base}: pick ONE story with 3 or more outlets (a different one for each Compared segment, give its id in "story" at segment level and "outlets": the 3-4 source names you compare, exactly as written in the pack). Lines: "intro" (the story in two sentences), then one line per outlet ("o1".."o4", each with "outlet": name) on how THAT outlet framed it — its headline's emphasis and the words it chose, "gap" (what some leave out), "agree" (what all agree on), "watch" (what to watch next, only if the pack supports it), "close" ("That was the news, compared.").`;
      case "desk": return `${base}: the ${s.desk} desk. Use stories from DESK: ${s.desk} (or TOP STORIES if clearly from that beat). Line "open" ("On the ${s.title}..." style, one sentence), then 2-3 story lines ("d1".., each with "story": id), then "close" (one short sentence).`;
      case "half": return `${base}: "Headlines at the half hour." Line "open", then ${s.stories} lines "h1".., 25-30 words each, each with "story": id; you may repeat The Hour's stories here (it is a recap) but prefer any newer TOP STORIES or desk stories not yet used.`;
      case "weather": return `${base}: lines "w1".. using only WEATHER NOW, US cities first, then Europe, the Gulf, South Asia, Tokyo; give °F for US cities and °C elsewhere.`;
      case "midterms": return `${base}: the Midterms desk, on the 3 November 2026 US midterm elections. Line "open" (one sentence, "The Midterms, on ScoopFeeds Radio." style). Lines "b1".. ("what's on the ballot") may be added for you after "open": do not write them, and leave about 130 words of the budget for them. Then up to 3 story lines ("e1".., each with "story": an id from DESK: midterms) on what the outlets report about the campaigns. Then, only if ELECTION PROJECTIONS lists any, one line per projected race ("p1"..): name the organisation that projected it, in its own words ("The Associated Press projects ..."); where outlets disagree, say so and name each; if a race is not in ELECTION PROJECTIONS, never say anyone won it, leads it or will win it. A poll is never a result. A partial count must say how much of the count is in, exactly as in COUNTS, or say that counting continues. ScoopFeeds never calls a race. Then "close" (one short sentence).`;
      case "crypto": return `${base}: lines "c1".. using only CRYPTO rows, bitcoin first, then ether, then at most three others; price and 24-hour change only. Never predict prices, never advise buying or selling, never call a coin safe or risky. "story": null.`;
      case "signoff": return `${base}: line "s1": "That was the first hour of ScoopFeeds Radio. Every newsroom, one stream." plus one sentence inviting listeners to subscribe to ScoopFeeds on YouTube.`;
      default: return base;
    }
  }).join("\n");
  return [
    "Write every spoken segment of this hour.",
    "",
    "SEGMENTS (in air order):",
    spec,
    "",
    'JSON shape: {"segments": {"<slot id>": {"story"?: "<id>", "outlets"?: ["<source>"], "lines": [{"id": "<line id>", "story"?: "<id>|null", "outlet"?: "<source>", "text": "<what is said>"}]}}}',
    "",
    "FACT PACK",
    packText(pack),
  ].join("\n");
}

/** Pull the first balanced JSON object out of a model reply (tolerates code fences). */
export function extractJson(text) {
  const s = String(text || "");
  const start = s.indexOf("{");
  if (start < 0) throw new Error("no JSON object in the reply");
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === "\"") inStr = false; continue; }
    if (c === "\"") inStr = true; else if (c === "{") depth++; else if (c === "}" && --depth === 0) return JSON.parse(s.slice(start, i + 1));
  }
  throw new Error("unbalanced JSON in the reply");
}

/** Run `claude -p` with the prompt on stdin; resolves to the parsed JSON object. */
export function claudeWriter({ model = "sonnet", timeoutMs = 15 * 60_000, bin = "claude", log = () => {} } = {}) {
  return (system, prompt) => new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;   // subscription, never the API key
    const args = ["-p", "--model", model, "--output-format", "json", "--tools", "", "--strict-mcp-config", "--system-prompt", system];
    const ch = spawn(bin, args, { env, stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    const t = setTimeout(() => { ch.kill("SIGKILL"); reject(new Error(`claude timed out after ${timeoutMs / 1000} s`)); }, timeoutMs);
    ch.stdout.on("data", (d) => { out += d; });
    ch.stderr.on("data", (d) => { err += d; });
    ch.on("error", (e) => { clearTimeout(t); reject(e); });
    ch.on("close", (code) => {
      clearTimeout(t);
      try {
        const env1 = JSON.parse(out);
        if (env1.is_error) return reject(new Error(`claude error: ${String(env1.result).slice(0, 300)}`));
        log(`writer: ${env1.num_turns ?? "?"} turn(s), ${Math.round((env1.duration_ms || 0) / 1000)} s`);
        resolve(extractJson(env1.result));
      } catch (e) { reject(new Error(`claude exit ${code}: ${e.message}; stderr: ${err.slice(-300)}`)); }
    });
    ch.stdin.end(prompt);
  });
}

/** Write all segments; one retry on a malformed reply. */
export async function writeSegments(pack, slots, when, { write = claudeWriter(), log = () => {} } = {}) {
  const prompt = buildPrompt(pack, slots, when);
  let last;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await write(SYSTEM, prompt);
      if (!res?.segments || typeof res.segments !== "object") throw new Error("reply has no segments object");
      return res.segments;
    } catch (e) { last = e; log(`writer attempt ${attempt} failed: ${e.message}`); }
  }
  throw last;
}

export const _internals = { SYSTEM };
