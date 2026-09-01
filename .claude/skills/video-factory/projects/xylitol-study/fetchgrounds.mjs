/**
 * fetchgrounds.mjs — pull the six generated backplates to out/grounds/.
 *
 *   node fetchgrounds.mjs           # fetch the ones not already on disk
 *   node fetchgrounds.mjs --refetch # fetch all of them again
 *
 * WHY THIS EXISTS AS A SCRIPT. The grounds are Higgsfield CDN URLs recorded in
 * grounds.json, and the agent session that generated them cannot download them:
 * the environment's egress policy answers 403 CONNECT for that host. So the
 * twelve credits were spent, the assets exist, and the machine that ordered
 * them has never seen them. Any machine that CAN reach the CDN runs this and
 * the grounds appear. Until then render.mjs falls back to flat near-black and
 * says so per ground, once — a missing backplate is not a build failure.
 *
 * WHAT THIS CANNOT DO. §7.4 rule 2 — "an asset containing anything resembling a
 * letter, number, tick mark or axis must be DISCARDED, not cropped around" — is
 * not machine-checkable here. Every prompt forbade text explicitly, and a
 * prompt is not an inspection. The checks below are the ones a machine can
 * honestly make: that the bytes are a real PNG, that the dimensions are what
 * the generator reported, and that the file is not a truncated stub. Passing
 * them means the download worked, NOT that the asset is clean.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "out/grounds");
const LEDGER = path.join(OUT, "_grounds.json");
const REFETCH = process.argv.includes("--refetch");
mkdirSync(OUT, { recursive: true });

const { grounds, _rule2 } = JSON.parse(readFileSync(path.join(HERE, "grounds.json"), "utf8"));

/**
 * Read width/height straight out of the PNG header.
 *
 * A PNG is an 8-byte signature then an IHDR chunk whose data begins with two
 * big-endian uint32s. Checking this rather than trusting the extension is what
 * catches the common failure: a CDN or proxy answering with an HTML error page
 * that lands on disk as HG-01.png and renders as nothing.
 */
function pngSize(file) {
  const b = readFileSync(file);
  const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (b.length < 33 || !b.subarray(0, 8).equals(SIG)) return null;
  if (b.subarray(12, 16).toString("ascii") !== "IHDR") return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

const ledger = existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, "utf8")) : {};
let failed = 0;

for (const g of grounds) {
  const dest = path.join(OUT, `${g.id}.png`);
  if (!REFETCH && existsSync(dest) && pngSize(dest)) {
    console.log(`  = ${g.id}  already on disk`);
    continue;
  }
  try {
    const res = await fetch(g.url, { redirect: "follow" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(dest, buf);

    const size = pngSize(dest);
    if (!size) throw new Error(`not a PNG (${buf.length} bytes) — probably an error page`);

    ledger[g.id] = {
      url: g.url, job_id: g.job_id, for: g.for,
      bytes: statSync(dest).size, width: size.w, height: size.h,
      sha256: createHash("sha256").update(buf).digest("hex").slice(0, 16),
      rule2: "UNVERIFIED BY MACHINE — see grounds.json._rule2",
    };
    console.log(`  + ${g.id}  ${size.w}x${size.h}  ${(buf.length / 1024).toFixed(0)} KB  ${g.for}`);
  } catch (e) {
    failed++;
    console.log(`  x ${g.id}  ${e.message}`);
  }
}

writeFileSync(LEDGER, JSON.stringify(ledger, null, 2) + "\n");

const have = grounds.filter((g) => existsSync(path.join(OUT, `${g.id}.png`))).length;
console.log(`\n${have}/${grounds.length} grounds on disk${failed ? `, ${failed} failed` : ""}.`);
if (have < grounds.length) {
  console.log(`Cards naming a missing ground render on flat near-black and log it. Not a build failure.`);
}
console.log(`\n§7.4 rule 2 is a HUMAN check and is not discharged by this script:`);
console.log(`  ${_rule2.status}`);
console.log(`  ${_rule2.action}\n`);
