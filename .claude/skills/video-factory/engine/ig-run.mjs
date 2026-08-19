// Serve → tunnel → publish → tear down. The whole Instagram post in one shot.
//
//   node ig-run.mjs            # dry run: opens the tunnel, proves Meta could
//                              # fetch, posts nothing, closes it
//   node ig-run.mjs --confirm  # actually posts 5 Reels + 5 Stories
//
// WHY A TUNNEL AT ALL
// Instagram has no upload endpoint — it fetches media from a public URL. These
// files exist only on this Mac, so for the two minutes Meta needs to pull them
// we expose exactly the five MP4s behind a Cloudflare quick tunnel, then close
// it. Nothing is left listening and nothing is written to production.
//
// The server is deliberately not a static-file handler: it serves from an
// explicit allowlist built at startup, so no path, symlink or traversal can
// reach anything but those five files.

import { createServer } from "http";
import { spawn } from "child_process";
import { readFileSync, existsSync, statSync, createReadStream, readdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHORTS = path.join(HERE, "out/shorts");
const confirm = process.argv.includes("--confirm");

// Hard ceiling on the entire run. launchd will start us again in 30 minutes;
// a wedged process that never exits is far worse than one that gives up.
const WATCHDOG_MS = 12 * 60 * 1000;
setTimeout(() => {
  console.error(`WATCHDOG: run exceeded ${WATCHDOG_MS / 60000} min — aborting so the tunnel closes`);
  process.exit(3);
}, WATCHDOG_MS).unref();

// Derived from what is actually in out/shorts. This was a hardcoded list of one
// film's filenames, so a copied job crashed on startup on the next film.
const FILES = readdirSync(path.join(HERE, "out/shorts"))
  .filter((f) => /^\d.*\.mp4$/.test(f)).sort();

// Allowlist: name → absolute path. Built once, never derived from the request.
const ALLOW = new Map();
for (const f of FILES) {
  const p = path.join(SHORTS, f);
  if (!existsSync(p)) throw new Error("missing " + p);
  ALLOW.set("/" + f, p);
}

const server = createServer((req, res) => {
  const name = (req.url || "").split("?")[0];
  const file = ALLOW.get(name);
  if (!file) { res.writeHead(404).end("no"); return; }
  const size = statSync(file).size;
  // Meta's fetcher issues a HEAD first and then a ranged GET.
  const range = req.headers.range;
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range) || [];
    const start = m[1] ? parseInt(m[1], 10) : 0;
    const end = m[2] ? parseInt(m[2], 10) : size - 1;
    res.writeHead(206, { "Content-Type": "video/mp4", "Accept-Ranges": "bytes",
      "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": end - start + 1 });
    if (req.method === "HEAD") return res.end();
    return createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": size, "Accept-Ranges": "bytes" });
  if (req.method === "HEAD") return res.end();
  createReadStream(file).pipe(res);
});

const port = await new Promise((r) => server.listen(0, "127.0.0.1", () => r(server.address().port)));
console.log(`local server : http://127.0.0.1:${port}  (${ALLOW.size} files, allowlisted)`);

// ── tunnel ────────────────────────────────────────────────────────────────
// localtunnel, not cloudflared. cloudflared was installed first and cannot
// reach api.trycloudflare.com from this machine — the POST that mints a quick
// tunnel exceeds its internal client deadline every time, sandboxed or not.
// localtunnel was verified end to end with Meta's own user agent
// (facebookexternalhit): 200, content-type video/mp4, byte-exact download, no
// interstitial. If that ever changes, the failure is loud — the reachability
// probe below refuses to continue.
//
// Required from the sidecar directory: `node_modules` here is a SYMLINK to the
// backend's, so installing into it destroys the link and breaks ffmpeg/satori
// for every other script in this folder.
const ltMod = await import(path.join(HERE, ".lt_modules/localtunnel/localtunnel.js"));
const localtunnel = ltMod.default ?? ltMod;

const tunnel = await localtunnel({ port });
const publicUrl = tunnel.url;
console.log(`tunnel       : ${publicUrl}`);
tunnel.on("error", (e) => console.error("tunnel error:", e.message));

const shutdown = () => { try { tunnel.close(); } catch {} try { server.close(); } catch {} };
process.on("exit", shutdown);
process.on("SIGINT", () => { shutdown(); process.exit(130); });

try {
  // The tunnel edge takes a few seconds to route. Poll a real file rather than
  // sleeping a guessed amount.
  let ready = false;
  for (let i = 0; i < 30 && !ready; i++) {
    try {
      // AbortSignal.timeout is not optional here: fetch has NO default timeout,
      // and a request that never settles stalls this loop forever.
      const r = await fetch(`${publicUrl}/${FILES[0]}`,
        { method: "HEAD", signal: AbortSignal.timeout(15000) });
      ready = r.ok;
    } catch {}
    if (!ready) await new Promise((r) => setTimeout(r, 2000));
  }
  if (!ready) throw new Error("tunnel never served the first file");
  console.log("tunnel ready : Meta can reach the files\n");

  const args = ["ig-publish.mjs", "--base", publicUrl, "--require-live", ...(confirm ? ["--confirm"] : [])];
  const child = spawn(process.execPath, args, { cwd: HERE, stdio: "inherit" });
  const code = await new Promise((r) => child.on("exit", r));
  console.log(`\nig-publish exited ${code}`);
  process.exitCode = code;
} finally {
  shutdown();
  console.log("tunnel closed, local server stopped");
}
