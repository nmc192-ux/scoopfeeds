/**
 * srtTime.mjs — SRT timestamps, with the carry that was missing.
 *
 * Extracted from build.mjs so it can be tested: build.mjs runs an entire film
 * build on import, so nothing inside it was reachable from a test.
 *
 * THE BUG THIS FIXES. The original decomposed the time first and rounded the
 * fraction second:
 *
 *     const s = Math.floor(t % 60), ms = Math.round((t - Math.floor(t)) * 1000);
 *
 * At t = 28.9996 that yields s = 28 and ms = Math.round(999.6) = 1000 — so it
 * emitted `00:00:28,1000`, a FOUR-digit millisecond field. Valid SRT has
 * exactly three; 1000ms must carry into the next second.
 *
 * It was not cosmetic. The SRT is the timeline of record: shorts.mjs takes its
 * cut points from it, music.mjs derives chapter times from it, and
 * youtubeClient.uploadCaptions ships it to YouTube verbatim. Parsers reading
 * `(\d+)` for the millisecond field silently read 1000ms as a whole extra
 * second, so a malformed cue drifts everything keyed to it — and YouTube
 * receives a caption file that is not well-formed.
 *
 * The fix is to round ONCE, in milliseconds, and derive every field from that
 * integer, so the carry propagates by construction.
 */

export function srtTime(t) {
  const totalMs = Math.max(0, Math.round(Number(t) * 1000));
  const ms = totalMs % 1000;
  const totalSecs = (totalMs - ms) / 1000;
  const s = totalSecs % 60;
  const m = Math.floor(totalSecs / 60) % 60;
  const h = Math.floor(totalSecs / 3600);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:` +
         `${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}
