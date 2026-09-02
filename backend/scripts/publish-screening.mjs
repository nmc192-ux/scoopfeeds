#!/usr/bin/env node
/**
 * publish-screening.mjs — put a cut where it can be watched, and print the URL.
 *
 *   node scripts/publish-screening.mjs <file.mp4> [--slug xylitol] [--replace]
 *
 * Copies the file into SCOOP_PERSISTENT_DATA_DIR/screening/<token>/ and prints
 * the link. server.js serves that directory at /screening with noindex and no
 * listing, so the token is the only thing standing between the file and the
 * open internet — which is why it is 128 bits from a CSPRNG rather than a slug
 * someone could guess from the film's name.
 *
 * A NEW TOKEN EACH TIME, unless --replace. Two cuts of the same film are two
 * different things to review, and silently overwriting the one a reviewer is
 * part-way through is worse than giving them a second link.
 */
import { randomBytes } from "node:crypto";
import { copyFileSync, mkdirSync, existsSync, statSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const src = args.find((a) => !a.startsWith("--"));
const flag = (n) => { const i = args.indexOf(`--${n}`); return i < 0 ? null : args[i + 1]; };
const REPLACE = args.includes("--replace");

if (!src) {
  console.error("usage: node scripts/publish-screening.mjs <file.mp4> [--slug name] [--replace]");
  process.exit(1);
}
if (!existsSync(src)) {
  console.error(`no such file: ${src}`);
  process.exit(1);
}

const ROOT = path.join(process.env.SCOOP_PERSISTENT_DATA_DIR || "/var/lib/scoop", "screening");
const slug = (flag("slug") || path.basename(src, path.extname(src))).replace(/[^a-z0-9-]/gi, "-").toLowerCase();

// If --replace, reuse the newest existing token for this slug so the link a
// reviewer already has keeps working.
let token = null;
if (REPLACE && existsSync(ROOT)) {
  const mine = readdirSync(ROOT)
    .filter((d) => existsSync(path.join(ROOT, d, `${slug}.mp4`)))
    .map((d) => ({ d, t: statSync(path.join(ROOT, d)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  if (mine.length) token = mine[0].d;
}
token ||= randomBytes(16).toString("hex");

const dir = path.join(ROOT, token);
mkdirSync(dir, { recursive: true });
const dest = path.join(dir, `${slug}.mp4`);
if (existsSync(dest) && !REPLACE) rmSync(dest);
copyFileSync(src, dest);

// A tiny page beside the file, so the link opens a player rather than
// downloading 40 MB into a Downloads folder.
writeFileSync(path.join(dir, "index.html"),
  `<!doctype html><meta name="robots" content="noindex,nofollow">`
  + `<title>${slug} — screening</title>`
  + `<style>html,body{margin:0;background:#090706;height:100%}`
  + `body{display:flex;align-items:center;justify-content:center}`
  + `video{max-width:100%;max-height:100%}</style>`
  + `<video src="${slug}.mp4" controls playsinline preload="metadata"></video>\n`);

const base = process.env.PUBLIC_BASE_URL || "https://scoopfeeds.com";
const mb = (statSync(dest).size / 1024 ** 2).toFixed(1);
console.log(`\n  ${mb} MB → ${dest}`);
console.log(`\n  ${base}/screening/${token}/\n`);
console.log(`  Unlisted, not private: anyone with the link can watch. noindex is set and`);
console.log(`  no directory listing is served, so it cannot be found by browsing.`);
console.log(`  Delete ${path.join(ROOT, token)} when the review is done.\n`);
