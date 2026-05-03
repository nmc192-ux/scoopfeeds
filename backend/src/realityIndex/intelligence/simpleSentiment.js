/**
 * simpleSentiment — tiny AFINN-style sentiment scorer.
 *
 * Pure JS, zero deps, no LLM call. Returns:
 *   { polarity: -1..+1, intensity: 0..1, hits: { pos, neg } }
 *
 * Coverage is deliberately narrow but high-precision for news/social text.
 * For per-event sentiment we score N posts and average the polarity weighted
 * by the absolute score so neutral filler doesn't drag the signal.
 */

// ─── Lexicon ───────────────────────────────────────────────────────────────
// Curated subset of AFINN-111 + news-domain additions. Scores in [-3, +3].
const LEX = {
  // Strong negative
  crash: -3, plunge: -3, collapse: -3, catastrophe: -3, disaster: -3,
  killed: -3, deadly: -3, fatal: -3, massacre: -3, atrocity: -3,
  defeat: -2, scandal: -2, fraud: -2, corrupt: -2, corruption: -2,
  fired: -2, fires: -2, fire: -1, layoff: -2, layoffs: -2, lawsuit: -2,
  bankrupt: -3, bankruptcy: -3, recession: -3, slump: -2, downturn: -2,
  // Moderate negative
  drop: -1, drops: -1, fell: -1, falling: -1, falls: -1, decline: -1, declined: -1,
  loss: -2, losses: -2, lose: -1, losing: -1, lost: -1,
  warn: -1, warning: -1, warned: -1, alarm: -2, alarming: -2, alert: -1,
  threat: -2, threats: -2, threatens: -2, threatened: -2, attack: -2,
  worry: -1, worried: -1, worries: -2, fear: -2, fears: -2, panic: -3,
  bad: -1, worse: -2, worst: -3, awful: -2, terrible: -3, horrible: -3,
  fail: -2, fails: -2, failed: -2, failure: -2,
  hate: -2, hated: -2, hates: -2, anger: -2, angry: -2, outrage: -2,
  // Strong positive
  win: 2, wins: 2, won: 2, victory: 3, triumph: 3, breakthrough: 3,
  surge: 2, soared: 2, soar: 2, soars: 2, rally: 2, rallies: 2, rallied: 2,
  boom: 2, boomed: 2, record: 2, recordhigh: 3, ath: 3,
  rescue: 2, rescued: 2, saved: 2, hero: 2, heroic: 2,
  approve: 1, approved: 1, agreement: 1, deal: 1, deals: 1, accord: 1,
  // Moderate positive
  rise: 1, rises: 1, rose: 1, rising: 1, gain: 1, gains: 1, gained: 1,
  growth: 1, grew: 1, growing: 1, strong: 1, stronger: 2, strongest: 2,
  good: 1, great: 2, excellent: 3, amazing: 3, fantastic: 3, brilliant: 2,
  success: 2, successful: 2, succeed: 2, succeeded: 2,
  hope: 1, hopeful: 1, optimistic: 2, encouraging: 2, positive: 1,
  cheer: 2, celebrate: 2, celebrated: 2, congratulations: 2,
  // Neutral-ish hedges (small signals)
  uncertain: -1, uncertainty: -1, doubt: -1, doubts: -1, unclear: -1,
  stable: 1, steady: 1, calm: 1,
};

const NEGATORS = new Set(["not", "no", "never", "nothing", "neither", "nor", "without", "barely", "hardly"]);
const INTENSIFIERS = { very: 1.5, extremely: 2, highly: 1.4, deeply: 1.5, totally: 1.5, completely: 1.5 };

const TOKEN_RE = /[a-z][a-z']+/g;

/** Score a single piece of text. */
export function scoreText(text) {
  if (!text || typeof text !== "string") return { polarity: 0, intensity: 0, hits: { pos: 0, neg: 0 } };
  const tokens = text.toLowerCase().match(TOKEN_RE);
  if (!tokens?.length) return { polarity: 0, intensity: 0, hits: { pos: 0, neg: 0 } };

  let totalScore = 0;
  let totalAbs   = 0;
  let pos = 0, neg = 0;

  for (let i = 0; i < tokens.length; i++) {
    const word = tokens[i];
    const lex  = LEX[word];
    if (lex == null) continue;
    let s = lex;
    // Look back 1–2 tokens for negators / intensifiers.
    const prev1 = tokens[i - 1];
    const prev2 = tokens[i - 2];
    if (NEGATORS.has(prev1) || (prev2 && NEGATORS.has(prev2))) s = -s;
    const mult = INTENSIFIERS[prev1] ?? 1;
    s *= mult;
    totalScore += s;
    totalAbs   += Math.abs(s);
    if (s > 0) pos++; else if (s < 0) neg++;
  }

  if (totalAbs === 0) return { polarity: 0, intensity: 0, hits: { pos, neg } };
  // Polarity: signed-mean of charged tokens; clip to [-1, +1].
  const polarity = Math.max(-1, Math.min(1, totalScore / Math.max(totalAbs, 3)));
  // Intensity: how charged the text is, scaled by token density.
  const intensity = Math.min(1, totalAbs / Math.max(8, Math.sqrt(tokens.length) * 2));
  return { polarity: Number(polarity.toFixed(3)), intensity: Number(intensity.toFixed(3)), hits: { pos, neg } };
}

/**
 * Aggregate scores for a batch of posts. Weights each post by its absolute
 * score so neutral filler doesn't drown out the signal.
 *
 * Returns:
 *   { polarity, intensity, volume, weighted_engagement, samples }
 */
export function aggregateScores(posts) {
  if (!posts?.length) return { polarity: 0, intensity: 0, volume: 0, samples: 0 };

  let weightSum = 0;
  let polWeighted = 0;
  let intensitySum = 0;
  let charged = 0;

  for (const p of posts) {
    const s = scoreText(p.text);
    if (s.polarity === 0 && s.intensity === 0) continue;
    const w = Math.abs(s.polarity) * (1 + Math.log1p(p.engagement || 0));
    polWeighted  += s.polarity * w;
    intensitySum += s.intensity;
    weightSum    += w;
    charged++;
  }

  const polarity  = weightSum > 0 ? polWeighted / weightSum : 0;
  const intensity = charged > 0 ? intensitySum / charged : 0;
  return {
    polarity:  Number(polarity.toFixed(3)),
    intensity: Number(intensity.toFixed(3)),
    volume:    posts.length,
    samples:   charged,
  };
}
