/**
 * liveLog.js - the record of everything third-party that went to air (#202).
 *
 * One JSON line per record, one file per UTC day, under RADIO_LIVE_LOG_DIR
 * (default ~/.scoopfeeds-radio/live-log). Records:
 *   live-start / live-end / live-skip   a carried (or refused) official feed
 *   clip                                a social clip played inside a segment
 * Append-only; nothing here records media, only what aired, from where, and for how long.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function liveLogDir(env = process.env) {
  return (env.RADIO_LIVE_LOG_DIR || "").trim() || path.join(os.homedir(), ".scoopfeeds-radio", "live-log");
}

export function createLiveLog({ dir = liveLogDir(), now = () => new Date() } = {}) {
  const fileFor = (d) => path.join(dir, `live-${d.toISOString().slice(0, 10)}.jsonl`);
  return {
    dir,
    write(record) {
      const at = now();
      const line = JSON.stringify({ at: at.toISOString(), ...record });
      fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(fileFor(at), line + "\n");
      return JSON.parse(line);
    },
    /** Every record in the log directory, oldest file first (for checks and reports). */
    readAll() {
      let files = [];
      try { files = fs.readdirSync(dir).filter((f) => /^live-\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).sort(); } catch { return []; }
      const out = [];
      for (const f of files) {
        for (const l of fs.readFileSync(path.join(dir, f), "utf8").split("\n")) {
          if (!l.trim()) continue;
          try { out.push(JSON.parse(l)); } catch { out.push({ type: "corrupt-line", file: f }); }
        }
      }
      return out;
    },
  };
}
