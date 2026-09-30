#!/usr/bin/env node
/**
 * commons.mjs — Wikimedia Commons for the Researcher, through the shot engine's own
 * polite client (one request at a time, 1.5–4 s apart, descriptive UA, transcodes for
 * video, content-sniffed downloads, readable licence required).
 *
 *   node sixty/tools/commons.mjs search "<query>" [--mime video/webm|image] [--limit 8]
 *   node sixty/tools/commons.mjs info "File:Title.webm" ["File:Other.jpg" ...]
 *   node sixty/tools/commons.mjs fetch "File:Title.webm" <out.mp4> [--start s --end s] [--height 1080]
 *   node sixty/tools/commons.mjs fetch "File:Title.jpg"  <out.jpg> [--width 2400]
 * Every result carries licence, usable (licenceUsable), and the credit line to put on screen.
 */
import "./env.mjs";
import { writeFileSync } from "fs";
const C = await import("../../backend/src/services/shots/commons.js");
const { fetchWindow, probeVideo } = await import("../../backend/src/services/shots/media.js");

const [cmd, ...rest] = process.argv.slice(2);
const opt = (k, d) => { const i = rest.indexOf(`--${k}`); return i >= 0 ? rest[i + 1] : d; };
const pos = rest.filter((x, i) => !x.startsWith("--") && !(i > 0 && rest[i - 1].startsWith("--")));
const describe = (i) => ({ ...i, usable: C.licenceUsable(i.licence), credit_line: i.licence ? C.creditLine(i, /video/.test(i.mime || "") ? "Video" : "Photo") : null });

if (cmd === "search") {
  const titles = await C.searchFiles(pos[0], { mime: opt("mime", "video/webm"), limit: Number(opt("limit", 8)) });
  const info = await C.fileInfo(titles);
  console.log(JSON.stringify(info.map(describe), null, 1));
} else if (cmd === "info") {
  console.log(JSON.stringify((await C.fileInfo(pos)).map(describe), null, 1));
} else if (cmd === "fetch") {
  const [title, out] = pos;
  const [info] = await C.fileInfo([title]);
  if (!info) { console.error("no such file"); process.exit(2); }
  if (!C.licenceUsable(info.licence)) { console.error(`licence not usable without a human: ${info.licence}`); process.exit(3); }
  if (/video/.test(info.mime || "")) {
    const h = Number(opt("height", 1080));
    const url = C.transcodeUrl(title, h);
    const start = Number(opt("start", 0)), end = Number(opt("end", Math.min(info.duration || 30, start + 30)));
    await fetchWindow(url, { start, end }, out, { height: h });
  } else {
    const w = Number(opt("width", 2400));
    const url = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(C.underscored(title))}?width=${w}`;
    const img = await C.fetchCommonsImage(url);
    if (!img) { console.error("download failed or not an image (content-sniffed)"); process.exit(4); }
    writeFileSync(out, img.buf);
  }
  console.log(JSON.stringify({ saved: out, ...describe(info) }));
} else { console.error("usage: commons.mjs search|info|fetch ..."); process.exit(1); }
