/**
 * feedProbe.js - the pre-air check for a live feed (#202 item 5).
 *
 * Before a feed is carried we check that it is live, public and plays WITHOUT A LOGIN:
 *   1. `yt-dlp -J` on the page/channel URL with no cookies and --ignore-config (so a user config
 *      that adds cookies cannot sneak a login in). Refused if the extractor reports a login,
 *      members-only, age or region gate, if `availability` is anything but public, or if the
 *      stream is not live right now.
 *   2. `ffprobe` on the resolved media URL, with a timeout: it must report a video and an audio stream.
 *
 * Nothing is recorded or re-hosted: the probe reads metadata only.
 * `run` is injectable so tests need neither yt-dlp nor the network.
 */
import { spawn } from "node:child_process";

export const PROBE_TIMEOUT_MS = 45_000;

/** Spawn a command and collect its output; never throws (a spawn failure is code -1). */
export function runCommand(cmd, args, { timeoutMs = PROBE_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    let out = "", err = "", done = false;
    let p;
    try { p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] }); }
    catch (e) { return resolve({ code: -1, stdout: "", stderr: String(e.message) }); }
    const t = setTimeout(() => { try { p.kill("SIGKILL"); } catch { /* gone */ } }, timeoutMs);
    p.stdout.on("data", (d) => { out += d; if (out.length > 8e6) out = out.slice(-8e6); });
    p.stderr.on("data", (d) => { err = (err + d).slice(-8000); });
    const end = (code) => { if (done) return; done = true; clearTimeout(t); resolve({ code, stdout: out, stderr: err }); };
    p.on("error", (e) => { err += e.message; end(-1); });
    p.on("close", (code, sig) => end(code ?? (sig ? -2 : -1)));
  });
}

export function ytDlpArgs(url) {
  return ["--ignore-config", "--no-cookies", "--no-cookies-from-browser", "--no-playlist", "--no-warnings", "-J",
    "-f", "best[height<=1080][vcodec!=none][acodec!=none]/best", url];
}

export function ffprobeArgs(mediaUrl, headers = {}) {
  const a = ["-v", "error", "-rw_timeout", "15000000", "-show_entries", "stream=codec_type", "-of", "json"];
  const h = Object.entries(headers || {}).filter(([k]) => /^(user-agent|referer|origin)$/i.test(k));
  if (h.length) a.push("-headers", h.map(([k, v]) => `${k}: ${v}`).join("\r\n") + "\r\n");
  a.push(mediaUrl);
  return a;
}

const LOGIN_PATTERNS = [
  /sign in/i, /log ?in/i, /members[- ]only/i, /join this channel/i, /confirm your age/i, /age[- ]restricted/i,
  /private video/i, /cookies/i, /not available in your country/i, /geo[- ]?restrict/i, /premium/i, /requires payment/i,
];

/** Interpret yt-dlp's output. Pure. */
export function interpretYtDlp({ code, stdout, stderr }) {
  if (code !== 0) {
    const login = LOGIN_PATTERNS.some((re) => re.test(stderr || ""));
    return { ok: false, reason: login ? "needs a login or is gated" : `could not read the feed (yt-dlp exit ${code})` };
  }
  let info;
  try { info = JSON.parse(stdout); } catch { return { ok: false, reason: "yt-dlp output was not JSON" }; }
  const availability = info.availability ?? null;
  if (availability && availability !== "public") return { ok: false, reason: `availability is "${availability}", not public` };
  if (info.age_limit && info.age_limit > 0) return { ok: false, reason: "age-gated" };
  const isLive = info.is_live === true || info.live_status === "is_live";
  if (!isLive) return { ok: false, reason: `not live now (live_status=${info.live_status ?? "unknown"})` };
  const fmt = Array.isArray(info.requested_formats) && info.requested_formats.length === 1 ? info.requested_formats[0] : info;
  const mediaUrl = fmt.url || info.manifest_url || null;
  if (!mediaUrl) return { ok: false, reason: "no single playable stream URL (needs separate audio and video)" };
  const handle = typeof info.uploader_id === "string" && info.uploader_id.startsWith("@") ? info.uploader_id : null;
  return {
    ok: true, reason: "live, public, plays without a login",
    title: info.title || info.fulltitle || "", mediaUrl, httpHeaders: fmt.http_headers || info.http_headers || {},
    uploaderHandle: handle, channelUrl: info.channel_url || info.uploader_url || null,
    availability, extractor: info.extractor_key || info.extractor || null,
  };
}

/** Interpret ffprobe's output. Pure. */
export function interpretFfprobe({ code, stdout }) {
  if (code !== 0) return { ok: false, reason: `the stream did not open (ffprobe exit ${code})` };
  let types = [];
  try { types = (JSON.parse(stdout).streams || []).map((s) => s.codec_type); } catch { /* bad json */ }
  if (!types.includes("video")) return { ok: false, reason: "the stream has no picture" };
  if (!types.includes("audio")) return { ok: false, reason: "the stream has no sound" };
  return { ok: true };
}

/**
 * Full pre-air check. Never throws; returns { ok, reason, ...details }.
 * A passing result carries `mediaUrl` (+ `httpHeaders`) for the playout and the channel facts that
 * officialFeeds.assertCanAir needs to tie a watch?v= URL to its publisher.
 */
export async function probeFeed(url, { run = runCommand, ytDlp = "yt-dlp", ffprobe = "ffprobe" } = {}) {
  const y = interpretYtDlp(await run(ytDlp, ytDlpArgs(url), { timeoutMs: PROBE_TIMEOUT_MS }));
  if (!y.ok) return { ...y, url };
  const f = interpretFfprobe(await run(ffprobe, ffprobeArgs(y.mediaUrl, y.httpHeaders), { timeoutMs: 20_000 }));
  if (!f.ok) return { ...y, ...f, url };
  return { ...y, url, checkedAt: new Date().toISOString() };
}
