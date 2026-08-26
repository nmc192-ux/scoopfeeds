/**
 * longformRunner.js — the wiring (#78/#80).
 *
 * `produceLongformFilm` is the chain; this is what plugs the real
 * implementations into it. It owns the two things the chain deliberately does
 * not: a project working directory on disk, and shelling out to the engine.
 *
 * NO node_modules SYMLINK. `engine/new-project.sh` creates one, and that made
 * sense when the engine lived under `.claude/` where bare ESM specifiers had
 * nothing to walk up to. Since the engine moved into `backend/` (#76), `dep()`
 * resolves against the real `backend/node_modules` by construction — verified
 * by rendering a film from a scratch directory with no symlink present. Not
 * creating one also keeps this well clear of the hazard that put an absolute
 * symlink into git earlier: nothing here writes a link anywhere.
 *
 * THE PROJECT DIRECTORY LIVES OUTSIDE THE DEPLOY DIRECTORY. In production that
 * is under SCOOP_PERSISTENT_DATA_DIR; a redeploy wipes /opt/scoopfeeds, and
 * that trap already cost this project its news.db once.
 *
 * THE STORYBOARD IS WRITTEN AS JSON, NEVER AS A MODULE. loadStoryboard prefers
 * storyboard.json and runs it through the fixed interpreter, so the unattended
 * path emits data and no generated code is executed — not even a shim.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import { mkdirSync, writeFileSync, existsSync, readdirSync } from "fs";
import path from "path";
import { createRequire } from "module";

import { logger } from "../logger.js";
import { produceLongformFilm } from "./produceLongformFilm.js";
import { makeAcquireMedia } from "./longformAcquire.js";
import { makeThumbnailStage } from "./longformThumbnail.js";

const execFileP = promisify(execFile);
const require = createRequire(import.meta.url);

/** Where the engine lives, derived — never a path to anyone's checkout. */
const ENGINE = path.join(path.dirname(new URL(import.meta.url).pathname), "engine");

/**
 * Create a project working directory.
 * Returns its path. Refuses to reuse a directory that already has output —
 * a half-finished render silently reused is worse than a clean failure.
 */
export function scaffoldProject(slug, { root }) {
  if (!slug) throw new Error("scaffoldProject: slug is required");
  if (!root) throw new Error("scaffoldProject: root is required (SCOOP_PERSISTENT_DATA_DIR in production)");
  const dir = path.join(root, slug);
  if (existsSync(path.join(dir, "out")) && readdirSync(path.join(dir, "out")).length) {
    throw new Error(`project ${dir} already has output — refusing to reuse a half-finished render`);
  }
  mkdirSync(path.join(dir, "out"), { recursive: true });
  mkdirSync(path.join(dir, "out/footage"), { recursive: true });
  writeFileSync(path.join(dir, "project.json"), JSON.stringify({ slug, title: slug }, null, 2));
  return dir;
}

/**
 * The title segment, synthesized MECHANICALLY when the storyboard has none.
 *
 * build.mjs refuses a storyboard without TITLE_SEGMENT — correctly, a film
 * needs a title card — but the schema never asked the model for one, which
 * the first real render found at the build step, after narration was paid
 * for. The card is the film's title split across lines plus the spine's
 * question: there is no creative decision in it, and the dossier-header rule
 * applies — mechanical surfaces get mechanical content, not model prose.
 */
export function synthesizeTitleSegment({ title, spine }) {
  const words = String(title || "").toUpperCase().replace(/[^\w\s'&-]/g, "").split(/\s+/).filter(Boolean);
  // Widen until the whole title fits in three lines — a truncated title is
  // not a title.
  let lines = [];
  for (let width = Math.max(20, Math.ceil(words.join(" ").length / 3) + 2); ; width += 2) {
    lines = [];
    for (const w of words) {
      if (lines.length && (lines[lines.length - 1] + " " + w).length <= width) {
        lines[lines.length - 1] += ` ${w}`;
      } else lines.push(w);
    }
    if (lines.length <= 3) break;
  }
  return {
    after: 2, seconds: 3.2,
    spec: {
      card: "title", kicker: "ScoopFeeds · Long-form",
      lines,
      ...(spine?.question ? { sub: spine.question } : {}),
    },
  };
}

/** Write the artifacts the engine reads: beats.json and storyboard.json. */
export function writeProjectInputs({ dir, slug, title, script, board, licenses }) {
  writeFileSync(path.join(dir, "project.json"), JSON.stringify({ slug, title }, null, 2));
  // beats.json drives narration: one entry per beat, in order.
  writeFileSync(path.join(dir, "beats.json"), JSON.stringify(
    (script.doc.beats || []).map((b, i) => ({ id: i + 1, text: b.text })), null, 2));
  // JSON, not a module. See the header.
  const withTitle = board.titleSegment
    ? board
    : { ...board, titleSegment: synthesizeTitleSegment({ title, spine: board.spine }) };
  writeFileSync(path.join(dir, "storyboard.json"), JSON.stringify(withTitle, null, 2));
  if (licenses) writeFileSync(path.join(dir, "out/footage/LICENSES.md"), licenses);
}

/** Run one engine script inside the project directory. */
async function engine(script, dir, args = []) {
  const { stdout, stderr } = await execFileP(process.execPath, [path.join(ENGINE, script), ...args], {
    cwd: dir, maxBuffer: 1 << 26,
    env: { ...process.env },
  });
  return `${stdout || ""}${stderr || ""}`;
}

/**
 * The render stage: narrate → build → music → shorts, in the project dir.
 *
 * Each step is a separate process because that is how the engine is designed
 * to be driven (by path, from a working directory) and because a crash in one
 * does not then take the runner with it.
 */
export function makeRenderStage({ dir, runEngine = engine }) {
  return async ({ slug }) => {
    logger.info(`🎬 ${slug}: narrating`);
    await runEngine("narrate.mjs", dir);
    logger.info(`🎬 ${slug}: building`);
    await runEngine("build.mjs", dir);
    logger.info(`🎬 ${slug}: scoring`);
    await runEngine("music.mjs", dir);
    logger.info(`🎬 ${slug}: cutting shorts`);
    await runEngine("shorts.mjs", dir);

    const shortsDir = path.join(dir, "out/shorts");
    const shortFiles = existsSync(shortsDir)
      ? readdirSync(shortsDir).filter((f) => f.endsWith(".mp4")).sort().map((f) => path.join(shortsDir, f))
      : [];
    return {
      // The SCORED film is what publishes — the unscored one is an
      // intermediate, and uploading it would ship a silent-bed film.
      film: path.join(dir, `out/${slug}-scored.mp4`),
      srt: path.join(dir, `out/${slug}.srt`),
      shotsJson: path.join(dir, "out/shots.json"),
      shortFiles,
    };
  };
}

/**
 * Assemble every stage and produce one film.
 *
 * @param {object} topic  from longformTopicSelector
 * @param {object} deps
 * @param {string} deps.root        where project directories live
 * @param {function} deps.search    footage search client
 * @param {function} deps.download  HTTP downloader
 * @param {function} deps.publish   the publisher (called ONLY by publishIfPassed)
 */
export async function runProduction(topic, {
  root, search, download, publish, resolveDownload = null, sources = [], sourceText = "",
  runEngine = engine, now = Date.now(),
} = {}) {
  const slug = topic?.slug || String(topic?.id || "film");
  // Selection's source gate already assembled the corpus (fetch-extract-
  // discard); reuse it rather than fetching the same articles twice.
  if (topic?.sourceCorpus) {
    sources = sources.length ? sources : topic.sourceCorpus.sources;
    sourceText = sourceText || topic.sourceCorpus.sourceText;
  }
  const dir = scaffoldProject(slug, { root });
  logger.info(`🎬 ${slug}: project at ${dir}`);

  const ffmpegPath = require("@ffmpeg-installer/ffmpeg").path;
  const _s = require("satori");
  const satori = _s.default ?? _s;
  const { Resvg } = require("@resvg/resvg-js");
  const fontsDir = path.join(path.dirname(new URL(import.meta.url).pathname), "../../../assets/fonts");

  const probe = async (file) => {
    const { measureDimensions } = await import("./longformMeasure.js");
    return measureDimensions(ffmpegPath, file);
  };

  return produceLongformFilm(topic, {
    sources, sourceText, now, ffmpegPath,

    acquireMedia: makeAcquireMedia({
      search, download, probe, resolveDownload,
      destDir: path.join(dir, "out/footage"), want: 6, min: 3 }),

    // The render stage also writes the project inputs, because the engine
    // reads them from disk and they are only knowable once the script and
    // storyboard exist.
    render: async ({ slug: s, script, board, assets }) => {
      writeProjectInputs({ dir, slug: s, title: topic?.title || s, script, board,
                           licenses: null });
      const out = await makeRenderStage({ dir, runEngine })({ slug: s });
      // The plate comes from FOOTAGE, never the film — a card-based film's own
      // frames would put the headline over its own type.
      const firstClip = assets?.find((a) => !a.synthetic)?.file;
      return { ...out, plateFrom: firstClip };
    },

    makeThumbnail: async ({ slug: s, title, spine, film, plateFrom }) => {
      if (!plateFrom) {
        throw new Error(`${s}: no footage clip to take a thumbnail plate from — the film would need its own frames, which puts the headline over its own type`);
      }
      return makeThumbnailStage({
        outDir: path.join(dir, "out"), ffmpegPath, fontsDir, satori, Resvg,
        plateFrom, plateAt: 2,
      })({ slug: s, title, spine });
    },

    publish,
  });
}
