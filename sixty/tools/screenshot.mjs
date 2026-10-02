#!/usr/bin/env node
/**
 * screenshot.mjs — a screenshot of a public page (newspaper front page, headline, article,
 * public social post) for 60 · (DrJ footage ruling, 2 Oct 2026).
 *
 *   node sixty/tools/screenshot.mjs <url> <out.png> [--width 1080] [--height 1350] [--wait 4000]
 *
 * NEVER LOGGED IN: headless Chrome with a brand-new, empty, throwaway profile every run — no
 * cookies, no sessions, nothing from DrJ's browser. If a page needs a login it shows the login
 * wall, and the agent must treat the post as not public. The outlet's/account's logo and name
 * must stay in frame (never crop them out).
 */
import { execFileSync } from "child_process";
import { mkdtempSync, rmSync, existsSync, statSync } from "fs";
import { tmpdir } from "os";
import path from "path";

const [url, out, ...rest] = process.argv.slice(2);
if (!url || !out || !/^https?:\/\//.test(url)) { console.error("usage: screenshot.mjs <http(s) url> <out.png> [--width --height --wait]"); process.exit(1); }
const opt = (k, d) => { const i = rest.indexOf(`--${k}`); return i >= 0 ? Number(rest[i + 1]) : d; };
// Playwright's standalone headless Chromium (no clash with DrJ's open Chrome, which made
// `Google Chrome --headless` hang on 2 Oct 2026); desktop Chrome only as a fallback.
import { readdirSync } from "fs";
import os from "os";
const PW = path.join(os.homedir(), "Library/Caches/ms-playwright");
const shell = (() => { try { const d = readdirSync(PW).filter((x) => x.startsWith("chromium_headless_shell-")).sort().pop();
  const p = d && path.join(PW, d, "chrome-headless-shell-mac-arm64/chrome-headless-shell"); return p && existsSync(p) ? p : null; } catch { return null; } })();
const CHROME = shell || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const profile = mkdtempSync(path.join(tmpdir(), "sixty-chrome-"));
try {
  execFileSync(CHROME, [...(shell ? [] : ["--headless=new"]), `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check",
    "--disable-extensions", "--disable-sync", "--hide-scrollbars", "--force-device-scale-factor=2",
    `--window-size=${opt("width", 1080) / 2},${opt("height", 1350) / 2}`, `--virtual-time-budget=${opt("wait", 4000)}`,
    `--screenshot=${path.resolve(out)}`, url], { stdio: ["ignore", "ignore", "pipe"], timeout: 60000 });
} catch (e) { console.error(`screenshot failed or timed out (60 s): ${String(e.message).slice(0, 160)}`); }
finally { rmSync(profile, { recursive: true, force: true }); }
if (!existsSync(out) || statSync(out).size < 2000) { console.error("no screenshot produced"); process.exit(2); }
console.log(JSON.stringify({ saved: out, url, bytes: statSync(out).size, logged_in: false }));
