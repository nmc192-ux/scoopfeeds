// Search-demand probe using Google/YouTube autocomplete.
//
// WHY: our first long-form targeted "who pays for ai" — which returns an EMPTY
// suggestion list on YouTube, i.e. nobody types it. The film got 2 views against
// a channel average of 36. Autocomplete is the cheapest honest proxy for real
// search demand: Google only suggests completions people actually enter, so
// a rich list means demand exists and an empty list means it does not.
//
// Depth heuristic: we probe the phrase AND the phrase + each letter a-z, and
// count distinct completions. A phrase with genuine demand branches widely.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function suggest(q, ds = "yt") {
  const url = `https://suggestqueries.google.com/complete/search?client=firefox&ds=${ds}&q=${encodeURIComponent(q)}`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(12000) });
    const j = JSON.parse(await r.text());
    return j[1] || [];
  } catch { return []; }
}

/** Breadth = completions for the seed plus a few letter-expansions. */
export async function demand(seed, ds = "yt") {
  const base = await suggest(seed, ds);
  const set = new Set(base);
  for (const ch of ["a", "b", "c", "h", "i", "w"]) {
    await sleep(90);
    (await suggest(`${seed} ${ch}`, ds)).forEach((s) => set.add(s));
  }
  return { seed, direct: base.length, breadth: set.size, top: base.slice(0, 6) };
}

const SEEDS = process.argv.slice(2);
if (!SEEDS.length) { console.log("usage: node demand.mjs <phrase> [phrase...]"); process.exit(0); }

console.log("phrase".padEnd(38), "direct".padStart(7), "breadth".padStart(8), "  top completions");
console.log("-".repeat(120));
for (const s of SEEDS) {
  const d = await demand(s);
  const flag = d.direct === 0 ? "  ← DEAD" : d.direct >= 8 ? "  ← strong" : "";
  console.log(
    s.slice(0, 37).padEnd(38),
    String(d.direct).padStart(7),
    String(d.breadth).padStart(8),
    "  " + d.top.slice(0, 3).join(" | ").slice(0, 62) + flag
  );
  await sleep(140);
}
