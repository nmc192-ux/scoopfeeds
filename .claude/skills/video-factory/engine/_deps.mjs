// Dependency resolution for engine scripts.
//
// The engine lives in the skill directory, which has NO node_modules. Scripts
// are invoked BY PATH from a per-video working directory, so
// createRequire(import.meta.url) — which resolves relative to the script — looks
// in the skill dir and fails. Resolve against the backend's real node_modules
// instead, falling back to the working directory so a project that vendors its
// own copy still wins.
import { createRequire } from "module";
import { readFileSync, existsSync } from "fs";
import path from "path";

const CANDIDATES = [
  path.join(process.cwd(), "node_modules"),
  "/Users/jahanzebhussain/Downloads/scoop-news/backend/node_modules",
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

export const ffmpegPath = resolverFor("@ffmpeg-installer/ffmpeg").path;
export const dep = resolverFor;

// ── project vs engine ────────────────────────────────────────────────────
// The engine lives in the skill; the VIDEO lives in the working directory the
// user ran from. Scripts must never use their own location for project data —
// doing so wrote audio into the skill folder and made cross-file imports
// resolve to the engine instead of the project's storyboard.
import { pathToFileURL } from "url";
export const PROJECT = process.cwd();
export const P = (...a) => path.join(PROJECT, ...a);
// Bundled assets ship with the skill, so these DO resolve from the engine.
export const ASSETS = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../assets");
// storyboard.mjs is authored per video and lives in the project.
export const loadStoryboard = () => import(pathToFileURL(P("storyboard.mjs")).href);

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
