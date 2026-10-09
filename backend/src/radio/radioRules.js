/**
 * radioRules.js — the D1 editorial gate for ScoopFeeds Radio. FAILS CLOSED.
 *
 * Every candidate passes these in order; the first that objects drops it:
 *
 *   1. d1:*                      isVideoEligible() from videoEditorialPolicy.js,
 *                                IMPORTED, not copied (DrJ, R2 gate decision 3).
 *                                PK-domestic categories and institution/party terms.
 *   2. radio:pk-politics-names   named Pakistani politicians, generals, parties and
 *                                institutions — domestic politics the D1 term list
 *                                does not cover by name.
 *   3. radio:indian-outlet-pk    any story from an Indian outlet that mentions
 *                                Pakistan at all.
 *   4. radio:critical-of-pk      any story, from any outlet, that mentions Pakistan,
 *                                its army or its politicians next to critical
 *                                language. Deliberately broad: a false drop costs one
 *                                headline, a false keep breaks the boundary.
 *   5. radio:judge               an LLM judge for what the keywords miss — run only
 *                                on items with a Pakistan signal (an item that never
 *                                mentions Pakistan cannot be a D1 story). An error,
 *                                a malformed answer, a missing verdict or anything
 *                                short of a confident "keep" DROPS the item.
 *
 * THE TRAGEDY REGEX IS NOT HERE ON PURPOSE. A news radio has to report deaths and
 * disasters; editorialSensitivity.js only MARKS items sensitive (radioState.js).
 */
import { isVideoEligible } from "../services/videoEditorialPolicy.js";
import { isSensitiveHeadline } from "../services/editorialSensitivity.js";
import { isIndianOutlet } from "./sourceRegions.js";

// Anything that makes a story "about Pakistan" for rules 3–5.
const PK_SIGNAL = new RegExp(
  "\\b(" + [
    "pakistan", "pakistani", "pakistanis", "islamabad", "rawalpindi", "lahore", "karachi",
    "peshawar", "quetta", "balochistan", "baluchistan", "khyber", "waziristan", "sindh", "punjab province",
    "pak army", "pak-army", "isi", "ispr", "ghq", "imran khan", "shehbaz", "shahbaz", "nawaz sharif",
    "maryam nawaz", "asim munir", "bilawal", "zardari", "bhutto", "ishaq dar", "khawaja asif",
    "mohsin naqvi", "pti", "pml-n", "pmln", "ppp", "tehreek-e-insaf", "tlp", "jui-f",
  ].map((t) => t.replace(/[-]/g, "[- ]?").replace(/\s+/g, "\\s+")).join("|") + ")\\b",
  "i"
);

// Rule 2 — named people, parties and institutions of Pakistani domestic politics.
const PK_POLITICS_NAMES = new RegExp(
  "\\b(" + [
    "imran khan", "shehbaz sharif", "shahbaz sharif", "nawaz sharif", "maryam nawaz",
    "asim munir", "bilawal bhutto", "asif (?:ali )?zardari", "ishaq dar", "khawaja asif",
    "mohsin naqvi", "faiz hameed", "aleema khan", "bushra bibi", "ali amin gandapur",
    "maulana fazlur rehman", "fazlur rehman", "pti", "pml-?n", "ppp", "tehreek-?e-?insaf",
    "tehreek-?e-?labbaik", "tlp", "jui-?f", "mqm-?p?", "ispr",
  ].join("|") + ")\\b",
  "i"
);

// Rule 4 — critical language. Matched only on items that carry a Pakistan signal.
const CRITICAL_TERMS = new RegExp(
  "\\b(" + [
    "terror(?:ist|ism)?\\s*(?:state|sponsor\\w*|haven\\w*|hub|nursery|export\\w*)", "state[- ]sponsored",
    "sponsor\\w* (?:of )?terror\\w*", "rogue (?:state|nation|army)", "failed state", "pariah",
    "crackdown", "crush\\w*", "rigg(?:ed|ing)", "stolen (?:election|mandate)", "martial law", "coup",
    "dictator\\w*", "junta", "military (?:rule|regime|establishment)", "abduct\\w*", "disappear\\w*",
    "enforced disappearance\\w*", "torture\\w*", "human rights abuse\\w*", "atrocit\\w*", "persecut\\w*",
    "massacre\\w*", "war crime\\w*", "genocide", "corrupt\\w*", "scandal\\w*", "bankrupt\\w*",
    "begging bowl", "debt trap", "blacklist\\w*", "grey list", "gray list", "fatf", "sanction\\w*",
    "condemn\\w*", "slam\\w*", "blast\\w* (?:pakistan|islamabad)", "accus\\w*", "blame\\w*",
    "expos\\w*", "lies", "lying", "propaganda", "duplicit\\w*", "double game", "betray\\w*",
    "humiliat\\w*", "defeat\\w*", "embarrass\\w*", "isolat\\w*", "censor\\w*", "silenc\\w*",
    "jail\\w*", "arrest\\w*", "imprison\\w*", "protest\\w*", "unrest", "chaos", "crisis",
  ].join("|") + ")\\b",
  "i"
);

// ─── Hard news only ─────────────────────────────────────────────────────────
// A news radio airs news. Each pattern is its own named rule so radio_dropped and the
// cycle log show how many candidates each one removes. Anchored where a bare word
// would eat real news ("Pentagon review of strikes", "How Iran's fuel ban changes…"
// is soft, "Court to review ruling" is not).
export const SOFT_RULES = [
  ["radio:soft-shopping", /\b(prime day|black friday|cyber monday|on sale|best deals?|deals? (?:of|on|for)|discount(?:ed|s)?|coupons?|promo codes?|gift guide|where to buy|buy now|\d+% off)\b/i],
  ["radio:soft-review", /(?:^review\b|\breview\s*[:|–—-]|\breview\s*$|\b(?:movie|film|album|game|laptop|phone|tv|car|show|book|hands-on) review\b|\b(?:hands-on|first look|we tested|i tested|our review)\b)/i],
  ["radio:soft-howto", /(?:\bhow to\b|^how (?:do|does|can|should|will|would)\b|^how\b.*\b(?:change[sd]?|changing)\b|\b(?:what you need to know|everything you need to know|a beginner'?s guide|step[- ]by[- ]step|explainer)\b)/i],
  ["radio:soft-listicle", /(?:^\d{1,2}\s+(?:[a-z'’-]+\s+){0,3}(?:things|ways|reasons|tips|signs|facts|ideas|mistakes|tricks|hacks|best|worst|foods|moves|questions|lessons)\b|\b\d{1,2}\s+(?:things|ways|reasons|tips|signs|facts|ideas|mistakes|tricks|hacks)\b)/i],
  ["radio:soft-first-person", /(?:^(?:i|my|we|our)\s|\bI\s+(?:only |just |never |always |finally )?(?:bought|tried|spent|quit|learned|lost|used|tested|ate|wore|switched|stopped|started|stayed|asked)\b)/],
  // Opinion is not news. Labels ("Opinion:", "Op-Ed") and the rewritten form the headline
  // LLM produces ("…, an opinion piece argues") — live leak 10 Oct 2026.
  ["radio:soft-opinion", /(?:^(?:opinion|op-ed|editorial|commentary|analysis|column|perspective|viewpoint)\s*[:|–—-]|\b(?:an? )?(?:opinion|op-ed) (?:piece|column|essay|writer|contributor)\b|\b(?:op-ed|opinion column|editorial board)\b|\b(?:columnist|commentator)s? (?:argues?|says|writes)\b)/i],
  // Roundups, podcasts and newsletters are packaging, not a story.
  ["radio:soft-roundup", /(?:\b(?:daily|weekly|morning|evening)\s*:|\bpodcast\b|\bnewsletter\b|^(?:live updates?|live)\s*[:|–—-]|\bthe week in\b|\bweekly (?:roundup|recap|digest)\b)/i],
];

/** @returns {{ allowed: boolean, rule: string|null, reason: string|null }} */
export function softNewsVerdict(article) {
  const title = String(article?.title || "");
  for (const [rule, re] of SOFT_RULES) {
    const m = title.match(re);
    if (m) return { allowed: false, rule, reason: `"${m[0].trim()}"` };
  }
  return { allowed: true, rule: null, reason: null };
}

// ─── Sensitive topics (music is never allowed to sit under these) ───────────
// The shared isSensitiveHeadline() catches tragedy WORDS (killed, dead, attack…) but not
// topics phrased without them — "Suicide is up among Black Americans" matched nothing and
// reached the music rotator. This list is radio-local on purpose: widening the shared
// guard would also change social CTAs, card photos and video stock.
export const SENSITIVE_TOPICS = new RegExp(
  "\\b(" + [
    "suicid\\w*", "self[- ]?harm\\w*", "overdos\\w*", "fentanyl deaths?",
    "sexual(?:ly)? (?:abus\\w*|assault\\w*|exploit\\w*|misconduct)", "child (?:sex(?:ual)?\\s+)?(?:abus\\w*|exploit\\w*|molest\\w*|porn\\w*|trafficking)",
    "(?:sex|child) abuse", "molest\\w*", "rap(?:e|ed|es|ist|ists)", "sex(?:ual)? trafficking",
    "mass (?:shooting|shootings|killing|killings|casualty)", "school shooting\\w*", "shooting spree", "gunman",
    "terror(?:ist)? attacks?", "terrorist", "terrorists", "suicide (?:bomb\\w*|attack\\w*)", "bombing",
    // Capital punishment — live leak 10 Oct 2026 ("…live-streamed execution…" under music).
    // Explicit per DrJ: executions, death sentences, capital punishment. The bare singular
    // "execution" needs a qualifier (trade/strategy execution is business news).
    "capital punishment", "death sentences?", "sentenced to death", "death row", "death penalty",
    "executions", "executed",
    "(?:live[- ]?stream(?:ed)?|public|televised|state|firing[- ]squad|botched|scheduled|planned|stay of) executions?",
    "executions? (?:of|by|under|plan|date|order|warrant|chamber)",
    "lethal injection", "firing squad", "hanged", "gallows", "beheaded\\w*", "beheading\\w*",
  ].join("|") + ")\\b",
  "i"
);

/** Shared tragedy-word guard OR the radio topic list. Empty text is sensitive (fail closed). */
export function isRadioSensitive(...texts) {
  const list = texts.flat().filter((t) => String(t || "").trim());
  if (!list.length) return true;
  return list.some((t) => isSensitiveHeadline(t) || SENSITIVE_TOPICS.test(String(t)));
}

const textOf = (a) => `${a?.title || ""} ${a?.description || ""}`;

/** True when an item mentions Pakistan, its cities, army, politicians or parties. */
export function hasPakistanSignal(article) {
  return PK_SIGNAL.test(textOf(article));
}

/**
 * The rules layer (1–4). Synchronous and side-effect free.
 * @returns {{ allowed: boolean, rule: string|null, reason: string|null }}
 */
export function radioRulesVerdict(article) {
  // 1 · D1 as the video track defines it — imported, not copied.
  const d1 = isVideoEligible(article);
  if (!d1.allowed) return { allowed: false, rule: d1.rule || "d1", reason: d1.reason || "D1" };

  // 1b · hard news only
  const soft = softNewsVerdict(article);
  if (!soft.allowed) return soft;

  const text = textOf(article);
  // 2 · Named Pakistani politicians, parties and institutions.
  const name = text.match(PK_POLITICS_NAMES);
  if (name) return { allowed: false, rule: "radio:pk-politics-names", reason: `names "${name[0]}"` };

  const pk = hasPakistanSignal(article);
  // 3 · Indian outlet + any mention of Pakistan.
  if (pk && isIndianOutlet(article?.source_name)) {
    return { allowed: false, rule: "radio:indian-outlet-pk", reason: `${article.source_name} story mentioning Pakistan` };
  }
  // 4 · Critical of Pakistan, its army or its politicians — any outlet.
  if (pk) {
    const crit = text.match(CRITICAL_TERMS);
    if (crit) return { allowed: false, rule: "radio:critical-of-pk", reason: `Pakistan + "${crit[0]}"` };
  }
  return { allowed: true, rule: null, reason: null };
}

const JUDGE_PROMPT = (items) => [
  "You are an editorial gate for a 24/7 English news radio aimed at the US.",
  "For EACH item decide whether it may air. It must be DROPPED if it is any of:",
  "  (a) Pakistani domestic politics (parties, elections, governments, courts, politicians, the army's role in politics);",
  "  (b) from an Indian outlet and about Pakistan;",
  "  (c) critical of Pakistan, the Pakistani army or Pakistani politicians, from any outlet.",
  "Neutral international news that merely involves Pakistan (a disaster, a sports result, a trade figure) may air.",
  "If you are not sure, answer drop.",
  'Reply ONLY with JSON: {"verdicts":[{"id":"<id>","verdict":"keep"|"drop","reason":"<short>"}]} with one entry per item.',
  "",
  ...items.map((a) => `id=${a.id} | outlet=${a.source_name || "?"} | headline=${String(a.title || "").slice(0, 200)} | summary=${String(a.description || "").slice(0, 300)}`),
].join("\n");

/**
 * Rule 5 — the LLM judge, batched. Only items with a Pakistan signal are sent.
 *
 * @param {object[]} items
 * @param {(prompt:string)=>Promise<any>} callJson  injected (llmQueue.callJson in prod)
 * @returns {Promise<Map<string,{allowed:boolean, rule:string, reason:string}>>}
 *          a verdict for every item that needed judging; items without a Pakistan
 *          signal are absent (allowed by the rules layer).
 */
export async function judgeItems(items, callJson) {
  const out = new Map();
  const needs = items.filter(hasPakistanSignal);
  if (!needs.length) return out;
  const failAll = (why) => {
    for (const a of needs) out.set(a.id, { allowed: false, rule: "radio:judge", reason: why });
    return out;
  };
  let res;
  try {
    res = await callJson(JUDGE_PROMPT(needs), { task: "radio-judge" });
  } catch (err) {
    return failAll(`judge error: ${String(err?.message || err).slice(0, 120)}`);
  }
  const verdicts = Array.isArray(res?.verdicts) ? res.verdicts : null;
  if (!verdicts) return failAll("judge unavailable or malformed answer");
  const byId = new Map(verdicts.map((v) => [String(v?.id), v]));
  for (const a of needs) {
    const v = byId.get(String(a.id));
    const keep = String(v?.verdict || "").trim().toLowerCase() === "keep";
    out.set(a.id, keep
      ? { allowed: true, rule: "radio:judge", reason: String(v?.reason || "").slice(0, 160) }
      : { allowed: false, rule: "radio:judge", reason: v ? `judge: ${String(v.reason || v.verdict || "drop").slice(0, 160)}` : "judge gave no verdict" });
  }
  return out;
}

export const _internals = { PK_SIGNAL, PK_POLITICS_NAMES, CRITICAL_TERMS, JUDGE_PROMPT };
