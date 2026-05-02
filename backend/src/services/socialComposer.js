// Generates per-platform social captions from an article, using only rule-based
// rewriting — no LLM cost, deterministic output. The Phase-0 editorial synthesis
// that already lives on the article SSR page (key takeaways, category framing)
// is the raw material.
//
// Output is a plain object keyed by platform name. Each caption embeds the
// canonical scoopfeeds.com URL with UTM tags so downstream clicks attribute
// back to the right social channel.

const SITE = (process.env.PRIMARY_SITE_URL || "https://scoopfeeds.com").replace(/\/+$/, "");

// Rough category-emoji mapping, reused for every platform.
const CATEGORY_EMOJI = {
  top: "📰", politics: "🏛️", pakistan: "🇵🇰", international: "🌍",
  science: "🔬", medicine: "💊", "public-health": "🏥", health: "💪",
  environment: "🌱", "self-help": "🌟", sports: "🏆", cars: "🚗", ai: "🤖",
};

// Category-aware hashtag bundles. Kept tight — 3-5 tags per platform-appropriate
// context is the sweet spot; any more reads as spam.
const CATEGORY_HASHTAGS = {
  top:          ["#news", "#breakingnews"],
  politics:     ["#politics", "#policy"],
  pakistan:     ["#Pakistan", "#news"],
  international:["#worldnews", "#global"],
  science:      ["#science", "#research"],
  medicine:     ["#medicine", "#health"],
  "public-health":["#publichealth", "#health"],
  health:       ["#health", "#wellness"],
  environment:  ["#environment", "#climate"],
  "self-help":  ["#selfhelp", "#personalgrowth"],
  sports:       ["#sports"],
  cars:         ["#cars", "#automotive"],
  ai:           ["#AI", "#tech"],
};

const BRAND_HASHTAG = "#ScoopFeeds";

// Articles published within this window get a "BREAKING" prefix on
// platforms that benefit from urgency cues (FB, Bluesky). We keep the
// threshold tight — overusing "breaking" trains readers to ignore it.
const BREAKING_WINDOW_MS = 60 * 60 * 1000; // 60 minutes

// Tags so generic they add zero targeting value as hashtags. We skip
// these in pickPrimaryHashtag so a story tagged ["top","global"] doesn't
// produce a vacuous "#Global" tail — better to fall through to the
// category default or omit the hashtag entirely.
const GENERIC_TAGS = new Set([
  "top", "news", "global", "world", "international", "us", "usa",
  "uk", "breaking", "latest", "today", "general", "headlines",
]);

// Categories where breaking-style urgency cues feel forced or crass —
// long-form lifestyle / advice content shouldn't carry a 🚨 BREAKING
// banner even when the article is fresh.
const NO_BREAKING_CATEGORIES = new Set([
  "self-help", "health", "cars",
]);

function truncate(str, limit) {
  const s = String(str || "").trim();
  if (s.length <= limit) return s;
  return s.slice(0, Math.max(0, limit - 1)).trimEnd() + "…";
}

// Sentence-aware truncation. Tries to cut on sentence boundaries (".", "!",
// "?") so the trimmed text reads as a complete thought instead of "End of
// senten…". Aware of common abbreviations ("Dr.", "U.S.") so we don't cut
// mid-attribution. Falls back to character truncation if no sentence
// boundary is available within the budget.
function truncateBySentence(str, limit) {
  const s = String(str || "").trim();
  if (s.length <= limit) return s;
  const slice = s.slice(0, limit);
  // Iterate sentence-end candidates from rightmost to leftmost, skipping
  // any that look like abbreviations.
  const candidates = [...slice.matchAll(/[.!?][\s)"']/g)];
  for (let i = candidates.length - 1; i >= 0; i--) {
    const m = candidates[i];
    const cut = m.index + 1;
    if (cut < Math.floor(limit * 0.55)) break;
    const before = slice.slice(0, cut);
    if (ABBREV.test(before + " ")) continue;
    return slice.slice(0, cut).trim();
  }
  // No good sentence boundary — try last complete clause (comma / semicolon).
  const clauseMatch = slice.lastIndexOf(", ");
  if (clauseMatch >= Math.floor(limit * 0.7)) return slice.slice(0, clauseMatch).trim() + "…";
  // Final fallback: word-aware character truncation.
  const wordCut = slice.lastIndexOf(" ");
  if (wordCut >= Math.floor(limit * 0.7)) return slice.slice(0, wordCut).trim() + "…";
  return truncate(s, limit);
}

function utmUrl(articleId, network) {
  const base = `${SITE}/article/${encodeURIComponent(articleId)}`;
  return `${base}?utm_source=social_${network}&utm_medium=social&utm_campaign=scoop_auto`;
}

// Strip noise that wire feeds bake into headlines. Source prefixes like
// "BBC Sport: ...", trailing dashes ("- BBC News"), bracketed annotations
// ("[VIDEO]", "(Reuters)"), and ALL-CAPS prefixes ("EXCLUSIVE: ...") all
// either duplicate info we already show or read as templated.
function cleanHeadline(raw) {
  let h = String(raw || "").trim();
  if (!h) return "";
  // Trailing " - Source" / " — Source" / " | Source" — but ONLY when the
  // tail looks like a publication name (multi-word, contains "News",
  // "Times", "Press", "BBC", "CNN" etc.). Single-word speaker tags like
  // " - Emery" carry information ("Emery said X") and must be preserved.
  h = h.replace(
    /\s+[-—|·]\s+(?:[A-Z][\w&.'’]+\s){1,3}(?:News|Times|Post|Press|Tribune|Herald|Observer|Daily|Mail|Gazette|Standard|Wire|Magazine|Review|Journal|Today|Guardian|Telegraph|Reuters|BBC|CNN|NPR|FT|Bloomberg|Sky|Dawn|Al\s*Jazeera|AP|AFP)\s*$/i,
    ""
  );
  // Leading "EXCLUSIVE:" / "BREAKING:" / "WATCH:" — we control urgency cues
  // ourselves below; let the headline carry the news, not the label.
  h = h.replace(/^(EXCLUSIVE|BREAKING|WATCH|JUST IN|UPDATE|UPDATED|LIVE|REPORT)\s*:\s*/i, "");
  // Leading source attribution "Reuters: X happened"
  h = h.replace(/^[A-Z][\w&.'’]{2,30}\s*:\s+/, (m) => /^[A-Z]{3,}\s*:/.test(m) ? "" : m);
  // Stray bracketed annotations like " [VIDEO]" or " (PHOTOS)"
  h = h.replace(/\s*[\[(](?:VIDEO|PHOTO|PHOTOS|PICS|GALLERY|AUDIO|LIVE)[\])]\s*/gi, " ");
  // Collapse whitespace
  h = h.replace(/\s+/g, " ").trim();
  return h;
}

// Pull a numeric sport score (e.g. "62-24", "2-1") out of a string. Used to
// add a stat-led hook on sports posts.
function extractScore(text) {
  const m = String(text || "").match(/\b(\d{1,3})\s*[-–]\s*(\d{1,3})\b/);
  return m ? { a: m[1], b: m[2] } : null;
}

// Common abbreviations whose periods don't end a sentence. Used by
// firstSentence so we don't cut "Dr." mid-attribution.
const ABBREV = /\b(?:Dr|Mr|Mrs|Ms|Prof|Sr|Jr|St|Mt|vs|etc|i\.e|e\.g|U\.S|U\.K|U\.N|Inc|Ltd|Co|Capt|Lt|Sgt|Gen|Rep|Sen|Gov|No)\.\s+$/i;

// Pull a LEADING quoted phrase out of text. We only count it as a "lead"
// if the opening quote appears very early (within the first ~12 chars) —
// i.e. the description LITERALLY opens with a quote. This avoids stealing
// mid-sentence quotes (e.g. `No 10 brands the move "a desperate stunt"`,
// where the speaker context "No 10 brands" is the news, not the quote).
//
// Returns { quote, rest } where `rest` is the text following the closing
// quote (used to attach attribution like ', said Dr. X.').
function extractLeadQuote(text) {
  const s = String(text || "").trim();
  // Quote must open within the first ~12 chars (allows for openers like
  // 'He said: "...' or '"...'). Mid-sentence quotes do NOT qualify — they
  // need the prefix for context, so we leave them embedded in the body.
  const m = s.match(/^([^"“]{0,12})([“"])([^"”]{20,200})([”"])/);
  if (!m) return null;
  // Reject if prefix contains a verb-like word implying the quote is the
  // object of a sentence ("X says \"...\"") — those need the prefix.
  if (/\b(?:says?|said|told|argues?|warns?|claims?|brands?|calls?|labels?|describes?)\b/i.test(m[1])) {
    return null;
  }
  const closeIdx = (m.index || 0) + m[0].length;
  return { quote: m[3].trim(), rest: s.slice(closeIdx) };
}

// Word-count guarded sentence-1 of a description. Aware of common
// abbreviations so "Dr." / "U.S." / "Mr." don't trigger a false sentence
// cut. Used for FB / Bluesky hook lines.
function firstSentence(text, maxLen = 180) {
  const s = String(text || "").trim();
  if (!s) return "";
  // Walk forward looking for [.!?] that's NOT preceded by a known abbrev.
  let cursor = 0;
  while (cursor < s.length) {
    const next = s.slice(cursor).search(/[.!?]/);
    if (next < 0) break;
    const idx = cursor + next;
    const before = s.slice(0, idx + 1);
    if (ABBREV.test(before + " ")) {
      cursor = idx + 1;
      continue;
    }
    // Confirm there's a space or end-of-string after — otherwise it's an
    // initialism in the middle of a token.
    const after = s[idx + 1];
    if (after && !/[\s)"']/.test(after)) {
      cursor = idx + 1;
      continue;
    }
    const sent = s.slice(0, idx + 1).trim();
    return sent.length <= maxLen ? sent : truncateBySentence(sent, maxLen);
  }
  return s.length <= maxLen ? s : truncateBySentence(s, maxLen);
}

function isBreaking(article) {
  if (!article?.published_at) return false;
  if (article.category && NO_BREAKING_CATEGORIES.has(article.category)) return false;
  // Both unix-seconds and unix-ms accepted (legacy data is mixed).
  const pub = article.published_at < 1e12 ? article.published_at * 1000 : article.published_at;
  return Date.now() - pub < BREAKING_WINDOW_MS;
}

function parseTags(article) {
  if (Array.isArray(article?.tags)) return article.tags;
  try { return JSON.parse(article?.tags || "[]"); } catch { return []; }
}

// ── Per-platform composers ──────────────────────────────────────────────
// Each returns { caption, url, characterCount, meta? } so the admin preview
// can render character budgets and spot overflows at a glance.

function composeX(article) {
  // X: 280 chars hard cap. URL counts as 23 chars (t.co shortener) regardless
  // of actual length, but we count actual length to be safe — leaves a tiny
  // buffer for unicode emoji widening. We include the URL so posts auto-unfurl
  // into the article card.
  const url = utmUrl(article.id, "x");
  const emoji = CATEGORY_EMOJI[article.category] || "📰";
  const hashtags = [...(CATEGORY_HASHTAGS[article.category] || []), BRAND_HASHTAG].slice(0, 3);
  const tail = `\n\n${url}\n${hashtags.join(" ")}`;
  const head = `${emoji} ${article.title}`;

  // If the headline alone is short enough, try to add a 1-line description
  // preview so the tweet reads as more than a bare link drop. Tweets that
  // bundle headline + tease tend to outperform raw headlines on engagement.
  const baseLen = head.length + tail.length;
  const descBudget = 280 - baseLen - 2; // -2 for the "\n\n" separator
  let body = head;
  if (descBudget >= 50 && article.description) {
    const desc = truncate(article.description, descBudget);
    if (desc && desc.length >= 30) body = `${head}\n\n${desc}`;
  } else if (head.length > 280 - tail.length) {
    // Headline alone is too long — truncate it.
    body = truncate(head, 280 - tail.length);
  }

  const caption = `${body}${tail}`;
  return { caption, url, characterCount: caption.length };
}

function composeThreads(article) {
  // Threads: 500 char limit. Similar shape to X but a bit more room for color.
  const url = utmUrl(article.id, "threads");
  const emoji = CATEGORY_EMOJI[article.category] || "📰";
  const hashtags = [...(CATEGORY_HASHTAGS[article.category] || []), BRAND_HASHTAG].slice(0, 4);
  const lead = `${emoji} ${article.title}`;
  const preview = truncate(article.description || "", 260);
  const body = preview ? `${lead}\n\n${preview}` : lead;
  const tail = `\n\n${url}\n${hashtags.join(" ")}`;
  const headroom = 500 - tail.length;
  const caption = `${truncate(body, headroom)}${tail}`;
  return { caption, url, characterCount: caption.length };
}

// Facebook engagement-question pool, keyed by category. We only include
// a question when the article warrants discussion — never on tragedy or
// breaking-death stories (where a "What do you think?" reads as crass).
// Picks deterministically from the article ID hash so the same article
// always gets the same question (idempotent re-renders).
const FB_QUESTIONS = {
  politics:      ["What do you make of this?", "Where do you stand?", "Is this the right call?"],
  pakistan:      ["Your thoughts on this?", "How will this play out?"],
  international: ["How does this look from where you are?", "Where does this go next?"],
  science:       ["Surprised by this?", "What's the next question this raises?"],
  medicine:      ["Would you change anything based on this?", "Worth telling your doctor about?"],
  "public-health":["What's the right response?", "Is this getting enough attention?"],
  health:        ["Trying anything similar?", "Have you noticed this in your own life?"],
  environment:   ["Is enough being done?", "What's working in your area?"],
  "self-help":   ["What would you add?", "Tried anything like this yourself?"],
  sports:        ["How do you see the rest of the season?", "Game-changer or one-off?"],
  cars:          ["Would you drive one?", "Game-changer for the industry?"],
  ai:            ["Game-changer or hype cycle?", "Where does this leave us?"],
};

// Headlines / categories where a question is inappropriate (deaths,
// tragedies, sensitive crime). Detected on the cleaned headline.
const TRAGEDY_KEYWORDS = /\b(dies?|killed|death|murdered|fatal|tragedy|massacre|crash|attack|shooting|terror|disaster|funeral|mourns?|stabbed|drowned)\b/i;

function pickFbQuestion(article, cleanTitle) {
  if (!cleanTitle || TRAGEDY_KEYWORDS.test(cleanTitle)) return null;
  if (article.category === "top" || !FB_QUESTIONS[article.category]) return null;
  const pool = FB_QUESTIONS[article.category];
  // Stable hash from article id → pool index (deterministic).
  const id = String(article.id || "");
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return pool[h % pool.length];
}

function composeFacebook(article) {
  // Facebook: ~63k char technical limit. Engagement peaks well before 600
  // chars, but long-form analysis on news pages reliably outperforms 1-line
  // link drops on news Pages. Shape:
  //
  //   [optional 🚨 BREAKING line]
  //   [emoji] [cleaned headline]
  //
  //   [hook: lead quote or first sentence — primes click intent]
  //
  //   [body: rest of description, sentence-trimmed]
  //
  //   📖 Read more from [source]: [URL]
  //
  //   [optional category-aware engagement question]
  //
  //   #tag1 #tag2 #ScoopFeeds
  //
  // The hook line is the single biggest engagement lever on FB news posts —
  // it's what shows above the "...See more" fold on mobile.
  const url = utmUrl(article.id, "facebook");
  const emoji = CATEGORY_EMOJI[article.category] || "📰";
  const hashtags = [...(CATEGORY_HASHTAGS[article.category] || []), BRAND_HASHTAG].slice(0, 3);

  const cleanTitle = cleanHeadline(article.title) || article.title || "";
  const desc = String(article.description || "").trim();

  // Pick a hook line + remaining body.
  // Priority:
  //   1. Lead quote from the description, kept WITH its attribution so the
  //      attribution doesn't dangle at the start of the next paragraph.
  //   2. First sentence of description, if it differs from headline.
  //   3. Skip hook — let the headline + body carry the post.
  let hook = null;
  let body = "";
  const lead = extractLeadQuote(desc);

  if (lead) {
    // Pull the attribution sentence (',' said Dr. X.) from `rest`. We use
    // firstSentence so abbreviations like "Dr." don't truncate mid-name.
    const restTrim = lead.rest.replace(/^[\s,]*/, "");
    const attribution = firstSentence(restTrim, 140);
    hook = attribution ? `“${lead.quote}” ${attribution}` : `“${lead.quote}”`;
    // Body = whatever's after the attribution sentence.
    body = attribution
      ? restTrim.slice(attribution.length).trim()
      : restTrim;
  } else {
    const first = firstSentence(desc, 200);
    if (first && first.toLowerCase().slice(0, 30) !== cleanTitle.toLowerCase().slice(0, 30)) {
      hook = first;
      const idx = desc.indexOf(first);
      body = idx >= 0 ? desc.slice(idx + first.length).trim() : "";
    } else {
      body = desc;
    }
  }

  if (body) body = truncateBySentence(body, 360);

  const breakingPrefix = isBreaking(article) ? "🚨 BREAKING" : null;
  const headline = `${emoji} ${cleanTitle}`;
  const cta = article.source_name
    ? `📖 Read the full story from ${article.source_name}: ${url}`
    : `📖 Read more: ${url}`;
  const question = pickFbQuestion(article, cleanTitle);

  const parts = [
    breakingPrefix,
    headline,
    hook,
    body || null,
    cta,
    question,
    hashtags.join(" "),
  ].filter(Boolean);

  const caption = parts.join("\n\n");
  return { caption, url, characterCount: caption.length };
}

// Category-keyed hook lines for LinkedIn. The first 1-2 lines of a LinkedIn
// post are the only thing visible above the "...see more" fold, so leading
// with a curiosity-pitch instead of a bare headline meaningfully lifts
// expand-rate. These are intentionally short (≤ ~50 chars) and category-
// relevant so they don't read as templated.
const LINKEDIN_HOOKS = {
  top:           "Today's top story 👇",
  politics:      "Worth tracking 👇",
  pakistan:      "From Pakistan 👇",
  international: "On the global desk 👇",
  science:       "New research worth knowing 👇",
  medicine:      "Healthcare update 👇",
  "public-health": "Public health watch 👇",
  health:        "Health & wellness 👇",
  environment:   "Climate desk 👇",
  "self-help":   "For the personal-growth crowd 👇",
  sports:        "Sports update 👇",
  cars:          "Auto industry move 👇",
  ai:            "AI watch 👇",
};

function composeLinkedIn(article) {
  // LinkedIn: 3000 char hard cap, engagement peaks around 1300-1500 chars.
  // Successful structure for B2B news posts:
  //   Line 1 — curiosity hook (above-fold)
  //   Line 2 — title in TITLE CASE for emphasis (LI strips markdown)
  //   Para  — analytical context (description)
  //   Line  — source attribution + clickable URL
  //   Line  — 4 hashtags max (more reads as spam on LI)
  const url = utmUrl(article.id, "linkedin");
  const hashtags = [...(CATEGORY_HASHTAGS[article.category] || []), BRAND_HASHTAG].slice(0, 4);

  const hook  = LINKEDIN_HOOKS[article.category] || "Worth a read 👇";
  const title = String(article.title || "").trim();
  const body  = String(article.description || "").trim();
  const src   = article.source_name || "the source";

  const parts = [
    hook,
    title,
    body || null,
    `📍 Full reporting from ${src}: ${url}`,
    hashtags.length ? hashtags.join(" ") : null,
  ].filter(Boolean);

  let caption = parts.join("\n\n");
  // Hard 3000ch cap — extremely unlikely to hit, but truncate the body if so.
  if (caption.length > 3000) caption = truncate(caption, 3000);
  return { caption, url, characterCount: caption.length };
}

// ── Instagram-specific constants ──────────────────────────────────────────

// Per-category hashtag pools. These combine with IG_BASE_HASHTAGS → 12-15
// total tags, the sweet spot for news accounts (enough for discovery,
// not enough to look spammy).
const IG_CATEGORY_HASHTAGS = {
  top:          ["#breakingnews", "#headlines", "#worldnews", "#topnews", "#newsalert", "#latestnews", "#newsfeed", "#newsbreak"],
  politics:     ["#politics", "#politicalnews", "#government", "#worldpolitics", "#policywatch", "#politico", "#elections", "#democracy"],
  pakistan:     ["#Pakistan", "#PakistanNews", "#pakistani", "#southasia", "#desi", "#PakNews", "#islamabad", "#karachi"],
  international:["#worldnews", "#international", "#globalaffairs", "#geopolitics", "#foreignpolicy", "#diplomacy", "#worldaffairs", "#globalnews"],
  science:      ["#science", "#sciencenews", "#research", "#discovery", "#STEM", "#innovation", "#sciencefacts", "#newresearch"],
  medicine:     ["#medicine", "#healthcare", "#medicalresearch", "#healthnews", "#doctors", "#medicalbreakthrough", "#clinicalresearch", "#globalhealth"],
  "public-health":["#publichealth", "#healthpolicy", "#healthcare", "#globalhealth", "#pandemic", "#epidemiology", "#healthawareness", "#wellness"],
  health:       ["#health", "#wellness", "#healthtips", "#selfcare", "#healthylifestyle", "#wellbeing", "#mentalhealth", "#healthyliving"],
  environment:  ["#environment", "#climatechange", "#climate", "#sustainability", "#greennews", "#climatecrisis", "#ecofriendly", "#savetheplanet"],
  "self-help":  ["#selfimprovement", "#selfhelp", "#personaldevelopment", "#motivation", "#growthmindset", "#mindset", "#successmindset", "#positivity"],
  sports:       ["#sports", "#sportsnews", "#athlete", "#sportsupdate", "#football", "#cricket", "#sportsmotivation", "#sportslife"],
  cars:         ["#cars", "#automotive", "#carporn", "#carlife", "#EVs", "#autoshow", "#carlover", "#carsofinstagram"],
  ai:           ["#AI", "#artificialintelligence", "#tech", "#technology", "#MachineLearning", "#futuretech", "#AItools", "#deeplearning"],
};

// Always included in every IG post.
const IG_BASE_HASHTAGS = ["#ScoopFeeds", "#news", "#currentevents", "#dailynews", "#newsoftheday"];

// Category-aware engagement CTAs. Two signals drive IG algorithm reach for
// news accounts: comments and saves. Mix question types (opinion / share /
// save) so posts don't all read identically.
const IG_ENGAGEMENTS = {
  politics:      ["💬 What's your take? Drop it below! 👇", "📢 Agree or disagree? Comment below!", "💭 Where do you stand? Let us know 👇"],
  pakistan:      ["🇵🇰 Your thoughts? Drop them below! 👇", "💬 How will this play out? Comment below!", "📢 Share your take 👇"],
  international: ["🌍 How does this look from your country? 👇", "💬 What does this mean globally? Drop a comment!", "📢 Your thoughts 👇"],
  science:       ["🔬 Surprised? Comment below! 👇", "💬 What's the next big question this raises? 🤔", "📢 Mind blown? Share this post! 🚀"],
  medicine:      ["💊 Would this change how you think about your health? 👇", "💬 Share this with someone who needs to see it! 📲", "🏥 Thoughts? Drop a comment below 👇"],
  "public-health":["💬 Is this getting enough attention? 👇", "📢 Tag someone who should see this! 📲", "🏥 Share your thoughts 👇"],
  health:        ["💪 Have you noticed this yourself? Comment below! 👇", "💬 Save this for later 🔖 then tell us your thoughts 👇", "🌟 Tag a friend who needs to see this! 📲"],
  environment:   ["🌱 Is enough being done? Comment below! 👇", "💬 Share this — awareness is the first step 📲", "🌍 What's one thing you're doing for the planet? 👇"],
  "self-help":   ["🌟 Save this post for when you need a reminder 🔖", "💬 What would you add to this? 👇", "📲 Share with someone who needs to hear it!"],
  sports:        ["🏆 Game-changer or one-off? Comment below! 👇", "💬 Hot take? Drop it below! 🔥", "📢 Tag a fellow fan! 📲"],
  cars:          ["🚗 Would you drive one? Comment below! 👇", "💬 Hot take? Drop it below! 🔥", "📢 Tag a car lover! 📲"],
  ai:            ["🤖 Game-changer or hype? Comment below! 👇", "💬 Excited or concerned? Tell us 👇", "📢 Tag a tech friend who should see this! 📲"],
  top:           ["💬 What do you think? Drop a comment below! 👇", "📲 Share this with someone who should see it!", "🔥 Hot take? We're listening 👇"],
};

// Build the hashtag list: base + category-specific, deduplicated, capped at 15.
function buildIgHashtags(article) {
  const catTags = IG_CATEGORY_HASHTAGS[article.category] || IG_CATEGORY_HASHTAGS.top;
  const seen = new Set();
  const result = [];
  for (const t of [...IG_BASE_HASHTAGS, ...catTags]) {
    const lower = t.toLowerCase();
    if (!seen.has(lower)) { seen.add(lower); result.push(t); }
    if (result.length >= 15) break;
  }
  return result;
}

// Pick a stable engagement CTA from the pool (same article always → same CTA).
function pickIgEngagement(article, cleanTitle) {
  if (TRAGEDY_KEYWORDS.test(cleanTitle)) return null;
  const pool = IG_ENGAGEMENTS[article.category] || IG_ENGAGEMENTS.top;
  const id = String(article.id || "");
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return pool[h % pool.length];
}

function composeInstagramFeed(article) {
  // Instagram captions: no clickable links in body — pin them in bio.
  // Best-practice structure for news accounts (maximises comments + saves,
  // the two signals that most boost IG reach in the feed algorithm):
  //
  //   [emoji] [cleaned headline]          ← hook (visible before "…more")
  //
  //   [2-3 sentence context]              ← brief, readable
  //
  //   [engagement CTA — question/share]   ← drives comments & saves
  //
  //   🔗 Full story → Link in bio @handle ← explicit CTA
  //
  //   .                                   ← dots collapse hashtags
  //   .
  //   .
  //   #tag1 #tag2 … (12-15 tags)          ← discovery, below the fold
  const emoji = CATEGORY_EMOJI[article.category] || "📰";
  const cleanTitle = cleanHeadline(article.title) || article.title || "";
  const desc = String(article.description || "").trim();
  const url = utmUrl(article.id, "instagram");

  // Hook line — emoji + cleaned headline, stays above the "more" fold.
  const hook = `${emoji} ${cleanTitle}`;

  // Body — first 2-3 sentences of description, sentence-aware truncation so
  // it reads as a complete thought rather than a cut-off string.
  const body = desc ? truncateBySentence(desc, 300) : "";

  // Engagement CTA — category-aware, avoids tragedy topics.
  const engagement = pickIgEngagement(article, cleanTitle);

  // Bio-link instruction with the handle so followers know exactly where to go.
  const igHandle = (process.env.INSTAGRAM_HANDLE || "scoop.feeds").trim();
  const linkCta = `🔗 Full story → Link in bio @${igHandle}`;

  // Hashtags (12-15). Three-dot separator pushes them below the "more" fold
  // on mobile — keeps the main caption clean while preserving discovery value.
  const hashtags = buildIgHashtags(article);

  const parts = [
    hook,
    body || null,
    engagement || null,
    linkCta,
    ".\n.\n.",
    hashtags.join(" "),
  ].filter(Boolean);

  const caption = parts.join("\n\n");
  return {
    caption,
    url,
    characterCount: caption.length,
    meta: { note: `Link goes in bio (@${igHandle}). Hashtags after the dot-separator.` },
  };
}

function composePinterest(article) {
  // Pinterest pins ARE clickable. 500 char description limit. Keep the hook
  // concise and hashtag-light.
  const url = utmUrl(article.id, "pinterest");
  const emoji = CATEGORY_EMOJI[article.category] || "📰";
  const desc = truncate(article.description || "", 280);
  const caption = [
    `${emoji} ${article.title}`,
    desc || null,
    `Read the full story at scoopfeeds.com`,
  ].filter(Boolean).join("\n\n");
  return { caption, url, characterCount: caption.length };
}

// Build the hashtag for the post tail. Prefer article tags (more
// targeted, e.g. #PremierLeague, #IPCC) over generic category hashtags
// (#sports, #news). Filters out tags so generic they add no targeting
// value (#Global, #News, #Us). Falls back to the category default.
function pickPrimaryHashtag(article) {
  const tags = parseTags(article);
  for (const t of tags) {
    const s = String(t || "").trim();
    if (!s) continue;
    const lower = s.toLowerCase();
    // Skip tags that are just the bare category name, or generic noise.
    if (lower === String(article.category || "").toLowerCase()) continue;
    if (GENERIC_TAGS.has(lower)) continue;
    // PascalCase the tag (premier-league → PremierLeague).
    const tag = s
      .split(/[-_\s]+/)
      .filter(Boolean)
      .map(w => w[0].toUpperCase() + w.slice(1))
      .join("")
      .replace(/[^A-Za-z0-9]/g, "");
    if (tag.length >= 3 && tag.length <= 24) return `#${tag}`;
  }
  return (CATEGORY_HASHTAGS[article.category] || [])[0] || "";
}

function composeBluesky(article) {
  // Bluesky: 300 grapheme limit. The post also carries an external embed
  // (link card with thumb), so we DON'T put the URL in the text — that
  // would double up with the card. The audience here is news-savvy and
  // rewards substance over clickbait, so we lead with what actually
  // happened, not just the headline.
  //
  // Layout:
  //   [optional 🚨 BREAKING — only if <90 min old]
  //   [emoji] [cleaned headline]
  //
  //   [body: first 1-2 sentences of description, or quote+attribution]
  //
  //   [📍 Source · #SpecificHashtag]
  const url = utmUrl(article.id, "bluesky");
  const emoji = CATEGORY_EMOJI[article.category] || "📰";
  const cleanTitle = cleanHeadline(article.title) || article.title || "";
  const desc = String(article.description || "").trim();

  // Tail: source attribution + 1 hashtag.
  const baseHashtag = pickPrimaryHashtag(article);
  const srcLine = article.source_name ? `📍 ${article.source_name}` : "";
  const tailParts = [srcLine, baseHashtag].filter(Boolean);
  const tail = tailParts.length ? `\n\n${tailParts.join(" · ")}` : "";

  // Optional breaking prefix — only for very fresh stories.
  const breakingPrefix = isBreaking(article) ? "🚨 BREAKING\n" : "";
  const head = `${breakingPrefix}${emoji} ${cleanTitle}`;

  // Body: spend the remaining budget on the description. Sentence-aware
  // truncation makes it read like a complete thought, not a chopped string.
  // We pack as much as the budget allows so the post reads substantive
  // (the entire reason a Bluesky reader follows a news account).
  const SAFETY = 6;
  const bodyBudget = 300 - head.length - tail.length - 2 - SAFETY;

  let body = head;
  if (desc && bodyBudget >= 50) {
    // If the headline already conveys most of the description, prefer a
    // quote (when present) or skip the body entirely rather than re-state.
    const headLower = cleanTitle.toLowerCase();
    const descLower = desc.toLowerCase();
    const overlap = descLower.startsWith(headLower.slice(0, 30));

    let bodyText = "";
    const lead = extractLeadQuote(desc);
    if (lead && lead.quote.length >= 20) {
      // Quote-led, with attribution if we can find one just after the
      // closing quote ("…", said Dr. X.). firstSentence() handles
      // abbreviations so "Dr." doesn't truncate mid-name.
      const restTrim = lead.rest.replace(/^[\s,]*/, "");
      const attribution = firstSentence(restTrim, 100);
      bodyText = attribution
        ? `“${lead.quote}” ${attribution}`
        : `“${lead.quote}”`;
    } else if (!overlap) {
      bodyText = desc;
    }

    if (bodyText) {
      body += `\n\n${truncateBySentence(bodyText, bodyBudget)}`;
    }
  }

  let caption = `${body}${tail}`;
  if (caption.length > 300) caption = truncateBySentence(caption, 300);

  return { caption, url, characterCount: caption.length };
}

// ── Public entry ────────────────────────────────────────────────────────

export function composeAllPlatforms(article) {
  if (!article || !article.id || !article.title) {
    throw new Error("composeAllPlatforms: article with id + title required");
  }
  return {
    article: {
      id: article.id,
      title: article.title,
      source_name: article.source_name,
      category: article.category,
      published_at: article.published_at,
      image_url: article.image_url || null,
    },
    platforms: {
      x:              composeX(article),
      threads:        composeThreads(article),
      facebook:       composeFacebook(article),
      linkedin:       composeLinkedIn(article),
      instagram_feed: composeInstagramFeed(article),
      pinterest:      composePinterest(article),
      bluesky:        composeBluesky(article),
    },
  };
}
