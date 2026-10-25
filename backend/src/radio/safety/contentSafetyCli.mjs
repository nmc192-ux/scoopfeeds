#!/usr/bin/env node
/**
 * contentSafetyCli.mjs - run DrJ's media rule (#218) over files on the Mac.
 *
 *   node src/radio/safety/contentSafetyCli.mjs check <file> [<file> ...]   # gate each file; writes <file>.safety.json on a pass
 *   node src/radio/safety/contentSafetyCli.mjs library [--dir <films dir>] # gate every film and Short in the radio library
 *   node src/radio/safety/contentSafetyCli.mjs status <file> [...]          # is the clearance still valid?
 *
 * Every result (pass or refusal, with reasons and timestamps) is appended to
 * ~/scoopfeeds-radio/content-safety.jsonl (under RADIO_BASE_DIR when set). Exit 1 if anything was refused.
 * Checkers: ffmpeg/ffprobe, `claude -p` (subscription) for pictures and the transcript, the whisper CLI for
 * transcription. No sound-event classifier is installed yet, so a file WITH SOUND is refused until one is
 * (see mediaCheckers.js); that is the honesty rule, not a bug.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { assertMediaSafe, hasValidClearance, jsonlLog, MediaRefused } from "./contentSafety.js";
import { defaultCheckers } from "./mediaCheckers.js";
import { loadLibrary, filmsDir } from "../filmLibrary.js";

const { positionals, values: v } = parseArgs({ allowPositionals: true, options: { dir: { type: "string" } } });
const [cmd, ...files] = positionals;
const HOME = os.homedir();
const BASE = path.resolve(String(process.env.RADIO_BASE_DIR || "~/scoopfeeds-radio").replace(/^~/, HOME));
fs.mkdirSync(BASE, { recursive: true });
const log = jsonlLog(path.join(BASE, "content-safety.jsonl"));

async function gate(items) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "content-safety-"));
  const checkers = defaultCheckers({ workDir: work });
  let refused = 0;
  try {
    for (const it of items) {
      try {
        const r = await assertMediaSafe(it, checkers, { log });
        console.log(`✅ ${it.id || it.file}: cleared (${r.checks.vision?.frames ?? 0} frames, worst gap ${r.checks.sampling?.worstGapSec ?? "-"} s)`);
      } catch (e) {
        if (!(e instanceof MediaRefused)) throw e;
        refused++;
        console.log(`⛔ ${it.id || it.file}: REFUSED`);
        for (const r of e.report.reasons.slice(0, 20)) console.log(`   - [${r.check}] ${r.reason}`);
        if (e.report.reasons.length > 20) console.log(`   … ${e.report.reasons.length - 20} more in the log`);
      }
    }
  } finally { fs.rmSync(work, { recursive: true, force: true }); }
  return refused;
}

try {
  if (cmd === "check" && files.length) {
    process.exitCode = (await gate(files.map((f) => ({ file: path.resolve(f) })))) ? 1 : 0;
  } else if (cmd === "library") {
    const lib = loadLibrary(v.dir || filmsDir());
    process.exitCode = (await gate(lib.items.map((i) => ({ id: i.id, file: i.file, kind: i.kind })))) ? 1 : 0;
  } else if (cmd === "status" && files.length) {
    let bad = 0;
    for (const f of files) { const c = hasValidClearance(path.resolve(f)); if (!c.ok) bad++; console.log(`${c.ok ? "✅" : "⛔"} ${f}: ${c.ok ? `cleared ${new Date(c.clearedAt).toISOString()}` : c.why}`); }
    process.exitCode = bad ? 1 : 0;
  } else {
    console.error("usage: contentSafetyCli.mjs check <file...> | library [--dir D] | status <file...>");
    process.exitCode = 2;
  }
} catch (e) {
  console.error(`content-safety: ${e.message}`);
  process.exitCode = 2;
}
