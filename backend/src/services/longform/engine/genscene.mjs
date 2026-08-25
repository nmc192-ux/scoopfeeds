// genscene.mjs — the generated-scene library: reuse first, generate last.
//
//   node genscene.mjs list                        # what exists, both aspects
//   node genscene.mjs find "deal collapses"       # match before you spend
//   node genscene.mjs add --concept chokepoint-queue --register map \
//        --aspect 9:16 --job <job_id> --url <result_url> --credits 30 \
//        --prompt-file prompt.txt
//   node genscene.mjs fetch chokepoint-queue-916  # cold cache → re-download
//   node genscene.mjs use chokepoint-queue-916    # copy into ./out/footage + LICENSES.md
//
// WHY A LIBRARY AND NOT A GENERATE BUTTON
// A generated metaphor scene contains no text, no likenesses, no dated event —
// that is what the editorial rules require of it, and it is also what makes it
// REUSABLE: "a document tears in half" serves any collapsed-agreement story.
// At 30 credits per 10s clip, the difference between a library and a button is
// the difference between a one-time asset cost and a per-video bill. DrJ
// approved three registers on 2026-08-23 (map-metaphor, document-metaphor,
// object-metaphor) from pilots that are this library's first three entries.
//
// GENERATION IS NOT DONE HERE. Clips are generated agent-side through the
// Higgsfield MCP (templates in references/genscenes.md, reuse-first rules
// included); this tool manages the manifest, the cache, and the project copy.
// The manifest is committed; the cache is gitignored (MP4s stay out of git).
// CDN result URLs can expire — the job id is recorded so a dead URL can be
// re-resolved via the MCP (show_generation_by_ids) and re-`add`-ed.
//
// THE AIGC CONTRACT. `use` stamps the project's LICENSES.md with an
// "AI-generated" provenance line. publish-all.mjs refuses to publish a project
// whose LICENSES.md carries that stamp while its description still claims "No
// AI-generated imagery" (or whose tiktok.json says isAigc:false). The stamp is
// what makes the disclosure mechanical rather than remembered.

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, appendFileSync, statSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { P } from "./_deps.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIB = path.resolve(HERE, "../assets/genscenes");
const MANIFEST = path.join(LIB, "manifest.json");
const CACHE = path.join(LIB, "cache");

const load = () => (existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : { scenes: [] });
const save = (m) => writeFileSync(MANIFEST, JSON.stringify(m, null, 2) + "\n");
const slugOf = (concept, aspect) => `${concept}-${aspect.replace(":", "")}`;
const cachePath = (s) => path.join(CACHE, `${s.slug}.mp4`);

const args = process.argv.slice(2);
const cmd = args[0];
const opt = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};

function totalCredits(m) { return m.scenes.reduce((a, s) => a + (s.credits || 0), 0); }

if (cmd === "list") {
  const m = load();
  if (!m.scenes.length) { console.log("library is empty"); process.exit(0); }
  for (const s of m.scenes) {
    const cached = existsSync(cachePath(s));
    console.log(`  ${s.slug.padEnd(28)} ${s.register.padEnd(9)} ${s.aspect.padEnd(5)} ` +
      `${String(s.credits).padStart(3)}cr  used ${String(s.uses || 0).padStart(2)}×  ${cached ? "cached" : "COLD — run fetch"}`);
  }
  const spent = totalCredits(m);
  const uses = m.scenes.reduce((a, s) => a + (s.uses || 0), 0);
  console.log(`\n  ${m.scenes.length} scenes · ${spent} credits invested · ${uses} placements` +
    (uses ? ` · ${(spent / uses).toFixed(1)} credits/placement and falling` : ""));
  process.exit(0);
}

if (cmd === "find") {
  const q = (args[1] || "").toLowerCase();
  if (!q) { console.error("usage: genscene.mjs find \"<concept words>\""); process.exit(1); }
  const m = load();
  const hits = m.scenes.filter((s) =>
    [s.slug, s.concept, s.register, ...(s.tags || [])].join(" ").toLowerCase().includes(q) ||
    q.split(/\s+/).every((w) => [s.slug, s.concept, ...(s.tags || [])].join(" ").toLowerCase().includes(w)));
  if (!hits.length) {
    console.log(`no match for "${q}" — check references/genscenes.md before generating:`);
    console.log(`reuse-first means a near-match beats a new 30-credit generation.`);
    process.exit(2);
  }
  for (const s of hits) console.log(`  ${s.slug}  (${s.register}, ${s.aspect}, ${s.credits}cr, used ${s.uses || 0}×)`);
  process.exit(0);
}

if (cmd === "add") {
  const concept = opt("concept"), register = opt("register"), aspect = opt("aspect");
  const job = opt("job"), url = opt("url"), credits = Number(opt("credits", "30"));
  const promptFile = opt("prompt-file");
  for (const [k, v] of [["concept", concept], ["register", register], ["aspect", aspect], ["job", job], ["url", url]]) {
    if (!v) { console.error(`--${k} is required`); process.exit(1); }
  }
  if (!["map", "document", "object"].includes(register)) {
    console.error(`register must be one of the approved three: map | document | object`);
    console.error(`(a new register is a DrJ approval, not a flag)`);
    process.exit(1);
  }
  const m = load();
  const slug = slugOf(concept, aspect);
  if (m.scenes.some((s) => s.slug === slug)) { console.error(`${slug} already exists`); process.exit(1); }
  m.scenes.push({
    slug, concept, register, aspect, job_id: job, result_url: url, credits,
    model: opt("model", "gemini_omni"),
    prompt: promptFile && existsSync(promptFile) ? readFileSync(promptFile, "utf8").trim() : null,
    tags: (opt("tags", "") || "").split(",").map((t) => t.trim()).filter(Boolean),
    addedAt: new Date().toISOString().slice(0, 10),
    uses: 0,
  });
  save(m);
  console.log(`added ${slug} — now run: node genscene.mjs fetch ${slug}`);
  process.exit(0);
}

if (cmd === "fetch") {
  const slug = args[1];
  const m = load();
  const s = m.scenes.find((x) => x.slug === slug);
  if (!s) { console.error(`unknown scene ${slug}`); process.exit(1); }
  mkdirSync(CACHE, { recursive: true });
  const out = cachePath(s);
  const r = await fetch(s.result_url);
  if (!r.ok) {
    console.error(`download failed (HTTP ${r.status}) — the CDN URL may have expired.`);
    console.error(`Re-resolve job ${s.job_id} via the Higgsfield MCP (show_generation_by_ids),`);
    console.error(`then update result_url in the manifest and fetch again.`);
    process.exit(1);
  }
  writeFileSync(out, Buffer.from(await r.arrayBuffer()));
  console.log(`cached ${slug} (${(statSync(out).size / 1048576).toFixed(1)} MB)`);
  process.exit(0);
}

if (cmd === "use") {
  const slug = args[1];
  const m = load();
  const s = m.scenes.find((x) => x.slug === slug);
  if (!s) { console.error(`unknown scene ${slug}`); process.exit(1); }
  const src = cachePath(s);
  if (!existsSync(src)) { console.error(`${slug} is not cached — run: node genscene.mjs fetch ${slug}`); process.exit(1); }
  const destDir = P("out/footage");
  mkdirSync(destDir, { recursive: true });
  const name = `GS_${s.concept.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
  const dest = path.join(destDir, `${name}.mp4`);
  copyFileSync(src, dest);
  // The provenance stamp publish-all's AIGC gate keys on. Format is load-bearing.
  const lic = P("out/footage/LICENSES.md");
  const line = `\n| \`${name}\` | AI-generated scene (${s.model}, Higgsfield) — stylized metaphor, no text, no likeness | ` +
    `library: ${s.slug} · job ${s.job_id} · added ${s.addedAt} |\n` +
    `\n**AI-generated content present in this project.** The published description must NOT claim ` +
    `"No AI-generated imagery", and tiktok.json must set \`isAigc: true\`. publish-all.mjs enforces both.\n`;
  appendFileSync(lic, existsSync(lic) ? line : `# Footage provenance\n${line}`);
  s.uses = (s.uses || 0) + 1;
  save(m);
  console.log(`${name}.mp4 → out/footage/ (placement #${s.uses} — ${(s.credits / s.uses).toFixed(1)} credits/placement)`);
  console.log(`LICENSES.md stamped: this project now REQUIRES the AIGC disclosure.`);
  process.exit(0);
}

console.error("usage: genscene.mjs list | find <q> | add … | fetch <slug> | use <slug>");
process.exit(1);
