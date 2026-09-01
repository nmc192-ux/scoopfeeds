// Dependency resolution for engine scripts.
//
// Scripts are invoked BY PATH from a per-video working directory, so resolution
// must not depend on the caller's cwd alone. The working directory wins first
// (a project may vendor its own copy), then the backend's real node_modules —
// which the engine now sits inside, so this resolves without any symlink.
import { createRequire } from "module";
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

// BACKEND is DERIVED, never hardcoded, and it is now the anchor rather than
// REPO_ROOT. The engine lives at <repo>/backend/src/services/longform/engine,
// so backend is four levels up and the repo is five.
//
// DERIVE FROM THE NEAREST STABLE ANCHOR, NOT BY COUNTING TO THE TOP. The engine
// moved from .claude/skills/video-factory/engine into the backend so it would
// ship in the production image; every path that counted levels to the repo root
// silently pointed somewhere else afterwards, and the first symptom was
// `cannot resolve "@ffmpeg-installer/ffmpeg"` — a dependency error for what was
// really a relocation. Anchoring on backend/ (which holds node_modules, assets
// and .env — everything the engine actually needs) means a future move inside
// the backend costs one constant, not an audit.
const ENGINE_DIR = path.dirname(fileURLToPath(import.meta.url));
export const BACKEND = path.resolve(ENGINE_DIR, "../../../..");
export const REPO_ROOT = path.resolve(BACKEND, "..");
export const FRONTEND = path.join(REPO_ROOT, "frontend");
/** backend/.env then ~/.scoopfeeds.env — the order src/config/env.js uses. */
export const ENV_FILES = [path.join(BACKEND, ".env"), `${process.env.HOME}/.scoopfeeds.env`];

const CANDIDATES = [
  path.join(process.cwd(), "node_modules"),
  path.join(BACKEND, "node_modules"),
];

function resolverFor(name) {
  for (const base of CANDIDATES) {
    if (!existsSync(base)) continue;
    try {
      const req = createRequire(path.join(base, "_.js"));
      return req(name);
    } catch { /* try the next base */ }
  }
  throw new Error(
    `video-factory: cannot resolve "${name}". Looked in:\n` +
    CANDIDATES.map((c) => "  " + c).join("\n") +
    `\nRun from a working directory whose node_modules symlinks the backend's.`
  );
}

/**
 * ffmpeg: THE SYSTEM ONE FIRST, the bundled one as a fallback.
 *
 * @ffmpeg-installer/ffmpeg's linux-x64 build is a 2018 static binary
 * ("N-47683 ... gcc 6.3.0"), and resolving it unconditionally meant the engine
 * ran on a seven-year-old ffmpeg even where a current one was installed —
 * including in production, whose Dockerfile explicitly `apt-get install`s
 * ffmpeg into the runtime stage for exactly this purpose.
 *
 * It is not a theoretical age problem. The final mux uses
 * `amix=...:normalize=0`, and `normalize` arrived in FFmpeg 4.4 (2021). On the
 * bundled binary the whole film failed at the last step with "Option
 * 'normalize' not found", after the entire render had been paid for. Worse
 * would have been the version where it silently averaged 116 inputs instead of
 * summing them, and the film came out near-silent.
 *
 * FFMPEG_PATH overrides both, for a box that keeps a build somewhere else.
 */
function resolveFfmpeg() {
  if (process.env.FFMPEG_PATH && existsSync(process.env.FFMPEG_PATH)) return process.env.FFMPEG_PATH;
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    if (!dir) continue;
    const cand = path.join(dir, "ffmpeg");
    if (existsSync(cand)) return cand;
  }
  return resolverFor("@ffmpeg-installer/ffmpeg").path;
}
export const ffmpegPath = resolveFfmpeg();
export const dep = resolverFor;

// ── project vs engine ────────────────────────────────────────────────────
// The engine lives in the skill; the VIDEO lives in the working directory the
// user ran from. Scripts must never use their own location for project data —
// doing so wrote audio into the skill folder and made cross-file imports
// resolve to the engine instead of the project's storyboard.
import { pathToFileURL } from "url";
// PROJECT WORKING DIRECTORIES MUST LIVE OUTSIDE THE DEPLOY DIRECTORY.
// In production that means under SCOOP_PERSISTENT_DATA_DIR (/var/lib/scoop),
// never inside /opt/scoopfeeds — a redeploy wipes the deploy directory, and
// the same trap already cost this project its news.db once
// (docs/reference/env_reference.md). Locally, cwd is the project as before.
export const PROJECTS_ROOT = process.env.SCOOP_PERSISTENT_DATA_DIR
  ? path.join(path.resolve(process.env.SCOOP_PERSISTENT_DATA_DIR), "longform")
  : null;
/** Resolve a project working directory by slug, honouring the rule above. */
export const projectDir = (slug) =>
  PROJECTS_ROOT ? path.join(PROJECTS_ROOT, slug) : path.resolve(process.cwd());

export const PROJECT = process.cwd();
export const P = (...a) => path.join(PROJECT, ...a);
// Fonts, the genscene manifest and the evidence-asset registries. These live in
// backend/assets so they ship inside the production image — the skill's copies
// were byte-identical, so nothing about rendering changed with the move.
export const ASSETS = path.join(BACKEND, "assets");
/**
 * Load a project's storyboard.
 *
 * TWO FORMS, AND JSON WINS. A human-authored film supplies `storyboard.mjs`
 * (an ES module the engine imports). A GENERATED film supplies
 * `storyboard.json` — data validated by longformStoryboardSchema and turned
 * into this same shape by storyboardInterpreter, which is a fixed file.
 *
 * Preferring JSON is what completes #77's promise: the unattended path emits
 * DATA and no generated code is ever executed — not even a small shim that
 * re-exports it. A shim would be the crack that lets model-written JavaScript
 * back onto the worker.
 */
export const loadStoryboard = async () => {
  const json = P("storyboard.json");
  if (existsSync(json)) {
    const [{ interpretStoryboard }, { loadStatement }] = await Promise.all([
      import("../storyboardInterpreter.js"),
      import("../../longform/statement.mjs").catch(() => ({ loadStatement: null })),
    ]);
    const doc = JSON.parse(readFileSync(json, "utf8"));
    const out = interpretStoryboard(doc, { P, loadStatement: loadStatement || null });
    for (const w of out.warnings || []) console.log(`storyboard: ${w}`);
    return out;
  }
  const mjs = P("storyboard.mjs");
  if (!existsSync(mjs)) {
    throw new Error(
      `no storyboard in ${P(".")}: expected storyboard.json (generated) or storyboard.mjs (authored)`);
  }
  return import(pathToFileURL(mjs).href);
};

// NOTE ON BARE IMPORTS
// resolverFor() above only covers CommonJS require(). Bare *ESM* specifiers
// (`import satori from "satori"`) are resolved by Node against the importing
// FILE's directory, which no helper can intercept — so engine/node_modules is a
// symlink to the backend's. That link is what makes `import satori` work here;
// without it render.mjs throws ERR_MODULE_NOT_FOUND regardless of this module.

// ── project identity ─────────────────────────────────────────────────────
// Output filenames must be per-project, not a name inherited from whichever
// film the engine was last edited against. build.mjs shipped writing
// "out/who-pays-for-ai.mp4" for EVERY project — video 1's filename — because
// that string was never generalised when the engine was extracted. Any two
// projects built into sibling directories would each produce a file with that
// same name, and the name itself is actively wrong for anything else.
export function projectSlug() {
  const pj = path.join(PROJECT, "project.json");
  if (existsSync(pj)) {
    try {
      const j = JSON.parse(readFileSync(pj, "utf8"));
      if (j.slug) return j.slug;
    } catch { /* fall through to the directory-name default */ }
  }
  return path.basename(PROJECT).replace(/[^a-z0-9-]+/gi, "-").toLowerCase();
}
