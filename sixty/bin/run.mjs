#!/usr/bin/env node
/**
 * run.mjs — the 60 · runner. Starts ONE headless Claude Code Producer session per job,
 * on the Mac mini, on DrJ's Claude subscription. Everything that must not be left to an
 * agent lives HERE, outside the model: the subscription check, the daily cap, the stop
 * switch, gate integrity, usage accounting and the stop-on-limit rule.
 *
 *   node sixty/bin/run.mjs pick  --day <dir> [--films 2]          Scout + Editor → <dir>/picks.json
 *   node sixty/bin/run.mjs film  --pick <pick.json> --dir <filmdir> [--variant top|mix]
 *   node sixty/bin/run.mjs ab    --pick <pick.json> --dir <storydir>   Phase 0: same story twice,
 *                                  top and mix, labelled A/B at random; key sealed in <storydir>/.ab-key.json
 *
 * Usage limits (DrJ 30 Sep 2026): stop IMMEDIATELY on any usage-limit or rate-limit
 * signal — kill the session, write ~/sixty/STOP, notify. Never switch to an API key,
 * never switch to a cheaper model, never use paid overage. Headroom low → fewer films.
 */
import { spawn, spawnSync } from "child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, appendFileSync, copyFileSync } from "fs";
import { createHash, randomInt } from "crypto";
import path from "path";
import { HOME, REPO } from "../tools/env.mjs";

const SIXTY = path.join(REPO, "sixty");
const args = process.argv.slice(2);
const mode = args[0];
const opt = (k, d = null) => { const i = args.indexOf(`--${k}`); return i > 0 ? args[i + 1] : d; };
const cfg = JSON.parse(readFileSync(path.join(SIXTY, "config/models.json"), "utf8"));
const log = (...a) => { const l = `[${new Date().toISOString()}] ${a.join(" ")}`; console.log(l); appendFileSync(path.join(HOME, "logs/runner.log"), l + "\n"); };
mkdirSync(path.join(HOME, "logs"), { recursive: true });

// ─── Child environment: subscription only ──────────────────────────────────
const childEnv = { ...process.env, SIXTY_REPO: REPO, SIXTY_HOME: HOME, SIXTY_PY: path.join(HOME, "shotengine/bin/python") };
delete childEnv.ANTHROPIC_API_KEY;          // brief: the job environment explicitly unsets it
delete childEnv.ANTHROPIC_AUTH_TOKEN;
delete childEnv.CLAUDE_CODE_USE_BEDROCK; delete childEnv.CLAUDE_CODE_USE_VERTEX;

function usageSnapshot() {
  const r = spawnSync("claude", ["-p", "/usage", "--model", "haiku", "--strict-mcp-config"], { env: childEnv, encoding: "utf8", cwd: HOME, input: "", timeout: 120000 });
  const t = r.stdout || "";
  const pct = (re) => { const m = re.exec(t); return m ? Number(m[1]) : null; };
  return { at: new Date().toISOString(), subscription: /using your subscription/i.test(t),
    session: pct(/Current session:\s*(\d+)% used/), week: pct(/Current week \(all models\):\s*(\d+)% used/),
    weekFable: pct(/Current week \(Fable\):\s*(\d+)% used/), raw: t.split("\n").slice(0, 5).join(" | ") };
}

// ─── Gate integrity: agents call gates, never change them ─────────────────
function gatesHash() {
  const h = createHash("sha256");
  for (const d of ["gates", "tools", "render", "config", "agents", "bin"]) {
    const dir = path.join(SIXTY, d);
    for (const f of readdirSync(dir).sort()) { h.update(`${d}/${f}`); h.update(readFileSync(path.join(dir, f))); }
  }
  return h.digest("hex");
}

// ─── Agents: prompt files + model routing from config ─────────────────────
function agentsJson(variant) {
  const models = cfg.variants[variant];
  if (!models) throw new Error(`unknown variant ${variant}`);
  const contract = readFileSync(path.join(SIXTY, "agents/_contract.md"), "utf8");
  const out = {};
  for (const f of readdirSync(path.join(SIXTY, "agents"))) {
    if (!f.endsWith(".md") || f.startsWith("_") || f === "producer.md") continue;
    const src = readFileSync(path.join(SIXTY, "agents", f), "utf8");
    const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(src);
    const fm = Object.fromEntries(m[1].split("\n").map((l) => { const i = l.indexOf(":"); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
    const role = f.replace(/\.md$/, "");
    out[fm.name] = { description: fm.description, tools: fm.tools.split(",").map((s) => s.trim()), model: models[role], prompt: `${contract}\n\n${m[2]}` };
  }
  return out;
}

// Permissions: an allowlist for an unattended session. Denies are belt and braces; the
// gate hash is the real guarantee.
function settingsFile(dir) {
  const repoAbs = `/${REPO}`;
  const settings = { permissions: {
    allow: ["Read", "Write", "Edit", "Glob", "Grep", "WebSearch", "WebFetch", "Agent", "Task",
      "Bash(node:*)", "Bash(ffmpeg:*)", "Bash(ffprobe:*)", "Bash(file:*)", "Bash(ls:*)", "Bash(mkdir:*)", "Bash(cp:*)",
      "Bash(mv:*)", "Bash(cat:*)", "Bash(head:*)", "Bash(tail:*)", "Bash(wc:*)", "Bash(jq:*)", "Bash(python3:*)",
      `Bash(${childEnv.SIXTY_PY}:*)`, "Bash(curl:*)", "Bash(shasum:*)", "Bash(grep:*)", "Bash(sed -n:*)", "Bash(echo:*)", "Bash(date:*)"],
    deny: [`Edit(${repoAbs}/**)`, `Write(${repoAbs}/**)`, "Bash(git:*)", "Bash(ssh:*)", "Bash(scp:*)", "Bash(sudo:*)",
      "Bash(rm -rf:*)", "Bash(curl -X POST:*)", "Bash(curl --data:*)", "Bash(curl -d:*)", "Bash(crontab:*)", "Bash(launchctl:*)",
      "Bash(osascript:*)", "Bash(open:*)", "Read(~/.ssh/**)", "Read(~/.scoopfeeds.env)", `Read(${repoAbs}/backend/.env)`, "Read(~/.claude/**)"],
  } };
  const f = path.join(dir, ".claude-run-settings.json");
  writeFileSync(f, JSON.stringify(settings, null, 1));
  return f;
}

// ─── Usage accounting from the stream ─────────────────────────────────────
function newLedger() { return { byAgent: {}, seen: new Set(), toolAgent: {}, limits: [], results: [] }; }
function account(L, ev) {
  if (ev.type === "rate_limit_event") L.limits.push({ at: Date.now(), ...ev.rate_limit_info });
  if (ev.type === "result") L.results.push({ modelUsage: ev.modelUsage, total_cost_usd: ev.total_cost_usd, is_error: ev.is_error, num_turns: ev.num_turns, duration_ms: ev.duration_ms, result: String(ev.result || "").slice(0, 400) });
  if (ev.type !== "assistant") return;
  const msg = ev.message || {};
  for (const c of msg.content || []) if (c?.type === "tool_use" && (c.name === "Agent" || c.name === "Task")) L.toolAgent[c.id] = c.input?.subagent_type || "?";
  if (!msg.id || L.seen.has(msg.id)) return;
  L.seen.add(msg.id);
  const agent = ev.parent_tool_use_id ? (L.toolAgent[ev.parent_tool_use_id] || "subagent?") : "producer";
  const key = `${agent}|${msg.model}`;
  const u = msg.usage || {};
  const a = (L.byAgent[key] ||= { agent, model: msg.model, turns: 0, input: 0, output: 0, cacheWrite: 0, cacheRead: 0 });
  a.turns++; a.input += u.input_tokens || 0; a.output += u.output_tokens || 0;
  a.cacheWrite += u.cache_creation_input_tokens || 0; a.cacheRead += u.cache_read_input_tokens || 0;
}
const LIMIT_TEXT = /usage limit|hit your limit|limit reached|rate.?limit(ed)?|out of (extra )?usage|weekly limit|session limit|5-hour limit/i;

// ─── One headless Producer session ────────────────────────────────────────
async function session({ dir, prompt, variant, tag }) {
  const settings = settingsFile(dir);
  const agents = agentsJson(variant);
  const producerPrompt = readFileSync(path.join(SIXTY, "agents/producer.md"), "utf8");
  const L = newLedger();
  const cliArgs = ["-p", prompt, "--model", cfg.producer, "--output-format", "stream-json", "--verbose",
    "--strict-mcp-config", "--setting-sources", "project", "--settings", settings, "--add-dir", REPO,
    "--agents", JSON.stringify(agents), "--append-system-prompt", producerPrompt,
    "--disallowedTools", "CronCreate,CronDelete,ScheduleWakeup,RemoteTrigger,PushNotification,Workflow,DesignSync,EnterWorktree,ExitWorktree,SendMessage,Skill,Monitor"];
  const stream = path.join(dir, `stream-${tag}.jsonl`);
  log(`▶ ${tag}: claude ${cfg.producer} producer, variant=${variant}, dir=${dir}`);
  const t0 = Date.now();
  const stopped = await new Promise((resolve) => {
    const ch = spawn("claude", cliArgs, { cwd: dir, env: childEnv, stdio: ["ignore", "pipe", "pipe"] });
    let buf = "", stop = null;
    const kill = (why) => { if (stop) return; stop = why; log(`⛔ STOP (${tag}): ${why}`); ch.kill("SIGTERM"); setTimeout(() => ch.kill("SIGKILL"), 10000); };
    const timer = setTimeout(() => kill("timeout: session exceeded 4 h"), 4 * 3600_000);
    ch.stdout.on("data", (d) => {
      buf += d; let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        appendFileSync(stream, line + "\n");
        let ev; try { ev = JSON.parse(line); } catch { continue; }
        account(L, ev);
        if (ev.type === "rate_limit_event") {
          const r = ev.rate_limit_info || {};
          if (r.status && r.status !== "allowed") kill(`rate_limit_event status=${r.status} type=${r.rateLimitType} resets=${r.resetsAt}`);
          if (r.isUsingOverage) kill("session started drawing paid overage (extra usage) — not allowed without DrJ");
        }
        if (ev.type === "result" && ev.is_error && LIMIT_TEXT.test(String(ev.result || ""))) kill(`result error: ${String(ev.result).slice(0, 200)}`);
        if (ev.type === "system" && ev.subtype === "api_retry" && LIMIT_TEXT.test(JSON.stringify(ev))) kill(`api retry on a limit: ${JSON.stringify(ev).slice(0, 200)}`);
        if (ev.type === "assistant" && !ev.parent_tool_use_id) {
          for (const c of ev.message?.content || []) if (c.type === "text" && /Claude AI usage limit reached|You've hit your (session|weekly) limit/i.test(c.text)) kill(`assistant text: ${c.text.slice(0, 200)}`);
        }
      }
    });
    ch.stderr.on("data", (d) => { appendFileSync(path.join(dir, `stderr-${tag}.log`), d); if (LIMIT_TEXT.test(String(d))) kill(`stderr: ${String(d).slice(0, 200)}`); });
    ch.on("close", (code) => { clearTimeout(timer); resolve({ code, stop }); });
  });
  const rows = Object.values(L.byAgent).sort((a, b) => a.agent.localeCompare(b.agent));
  const lastResult = L.results.at(-1) || {};
  const firstLim = L.limits[0], lastLim = L.limits.at(-1);
  const usage = { tag, variant, dir, minutes: +((Date.now() - t0) / 60000).toFixed(1), exit: stopped.code, stopped: stopped.stop,
    byAgent: rows,
    modelUsage: lastResult.modelUsage || null,
    apiListEquivalentUSD: lastResult.total_cost_usd ?? null,   // NOT billed: what the same tokens would cost at API list price
    window: firstLim && lastLim ? {
      fiveHourFrom: firstLim.unifiedWindows?.five_hour?.utilization, fiveHourTo: lastLim.unifiedWindows?.five_hour?.utilization,
      sevenDayFrom: firstLim.unifiedWindows?.seven_day?.utilization, sevenDayTo: lastLim.unifiedWindows?.seven_day?.utilization,
      overageStatus: lastLim.overageStatus, isUsingOverage: lastLim.isUsingOverage } : null,
    results: L.results };
  writeFileSync(path.join(dir, `usage-${tag}.json`), JSON.stringify(usage, null, 1));
  if (stopped.stop && !/timeout/.test(stopped.stop)) {
    writeFileSync(path.join(HOME, "STOP"), `${new Date().toISOString()} ${stopped.stop}\nDelete this file to allow 60 · to run again.\n`);
    notify(`60 · stopped: ${stopped.stop}`);
  }
  return usage;
}

function notify(text) {
  // Phase 0: a local notification + the log. Email to DrJ needs the mail credential on the
  // Mac, which is DrJ's call (credential use) — not wired yet, and said so in the brief.
  log(`🔔 ${text}`);
  appendFileSync(path.join(HOME, "logs/notifications.log"), `${new Date().toISOString()} ${text}\n`);
}

function preflight({ needKokoro = false } = {}) {
  if (existsSync(path.join(HOME, "STOP"))) throw new Error(`STOP present: ${readFileSync(path.join(HOME, "STOP"), "utf8").trim()}`);
  if (process.env.ANTHROPIC_API_KEY) log("ℹ ANTHROPIC_API_KEY is set in the parent shell — removed from the job environment");
  const u = usageSnapshot();
  if (!u.subscription) throw new Error(`not on subscription login — refusing to run. /usage said: ${u.raw}`);
  if (needKokoro) {
    const r = spawnSync("curl", ["-s", "-m", "5", "-o", "/dev/null", "-w", "%{http_code}", "http://127.0.0.1:8880/v1/audio/voices"], { encoding: "utf8" });
    if (r.stdout !== "200") throw new Error("local Kokoro is not up — start ~/sixty/kokoro-start.sh");
  }
  return u;
}
function cap() {
  const r = spawnSync(process.execPath, [path.join(SIXTY, "gates/cap.mjs"), "check"], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`cap gate: ${r.stdout.trim()}`);
}

async function runFilm(pickPath, dir, variant, tag) {
  cap();
  mkdirSync(dir, { recursive: true });
  copyFileSync(pickPath, path.join(dir, "pick.json"));
  spawnSync(process.execPath, [path.join(SIXTY, "gates/cap.mjs"), "record", path.basename(dir), "started"]);
  const prompt = `Make ONE 60 · film from pick.json in this folder (${dir}). Run, in order: sixty-researcher → ` +
    `Rule 0 gate (node ${SIXTY}/gates/pakistan.mjs film .) → sixty-factchecker → sixty-writer → sixty-render → ` +
    `QA gate (node ${SIXTY}/gates/qa.mjs .) → sixty-qa → Rule 0 gate again → sixty-packager. ` +
    `Retry per your instructions. Do not post anything. Finish with producer.md.`;
  return session({ dir, prompt, variant, tag });
}

// ─── Modes ────────────────────────────────────────────────────────────────
try {
  if (mode === "pick") {
    const day = opt("day"); const films = Number(opt("films", 2));
    mkdirSync(day, { recursive: true });
    const before = preflight();
    const intake = spawnSync(process.execPath, [path.join(SIXTY, "tools/trends.mjs"), path.join(day, "candidates.json")], { encoding: "utf8" });
    writeFileSync(path.join(day, "intake.log"), intake.stdout + intake.stderr);
    spawnSync(process.execPath, [path.join(SIXTY, "gates/pakistan.mjs"), "selection", path.join(day, "candidates.json")]);
    const h0 = gatesHash();
    const usage = await session({ dir: day, variant: opt("variant", cfg.live_variant), tag: "pick",
      prompt: `Pick today's 60 · films. In this folder: run sixty-scout (reads candidates.rule0.json, intake.log; writes stories.json), ` +
        `then sixty-editor for ${films} films + 2 reserves (writes picks.json, picks.md). Then run ` +
        `node ${SIXTY}/gates/pakistan.mjs selection picks-flat.json after writing picks-flat.json = the picks as ` +
        `[{id, title, description: promise, category}] — any pick it blocks is dropped. Finish with producer.md.` });
    usage.gatesIntact = gatesHash() === h0;
    usage.usageBefore = before; usage.usageAfter = usageSnapshot();
    writeFileSync(path.join(day, "usage-pick.json"), JSON.stringify(usage, null, 1));
    log(`✔ pick done in ${usage.minutes} min, gates intact=${usage.gatesIntact}`);
  } else if (mode === "film") {
    const before = preflight({ needKokoro: true }); const h0 = gatesHash();
    const variant = opt("variant", cfg.live_variant);
    const usage = await runFilm(opt("pick"), opt("dir"), variant, "film");
    usage.gatesIntact = gatesHash() === h0; usage.usageBefore = before; usage.usageAfter = usageSnapshot();
    writeFileSync(path.join(opt("dir"), "usage-film.json"), JSON.stringify(usage, null, 1));
    if (!usage.gatesIntact) log("❌ a gate/tool/config file changed during the run — film VOID");
  } else if (mode === "ab") {
    const story = opt("dir"); mkdirSync(story, { recursive: true });
    const keyFile = path.join(story, ".ab-key.json");
    const key = existsSync(keyFile) ? JSON.parse(readFileSync(keyFile, "utf8")) : (randomInt(2) ? { A: "top", B: "mix" } : { A: "mix", B: "top" });
    writeFileSync(keyFile, JSON.stringify({ ...key, note: "SEALED — open only after DrJ has rated A and B." }));
    for (const label of (opt("only") ? [opt("only")] : ["A", "B"])) {
      const before = preflight({ needKokoro: true }); const h0 = gatesHash();
      const dir = path.join(story, label);
      const usage = await runFilm(opt("pick"), dir, key[label], "film");
      usage.gatesIntact = gatesHash() === h0; usage.usageBefore = before; usage.usageAfter = usageSnapshot();
      writeFileSync(path.join(dir, "usage-film.json"), JSON.stringify(usage, null, 1));
      log(`✔ ${label} done in ${usage.minutes} min, gates intact=${usage.gatesIntact}, stopped=${usage.stopped}`);
      if (usage.stopped) break;
    }
  } else {
    console.error("usage: run.mjs pick --day <dir> [--films n] | film --pick <f> --dir <d> [--variant v] | ab --pick <f> --dir <d> [--only A|B]");
    process.exit(1);
  }
} catch (e) { log(`❌ ${e.message}`); process.exit(2); }
