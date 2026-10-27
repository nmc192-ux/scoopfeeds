/**
 * numberCard — the 1080×1350 (Instagram 4:5) image of a "By the numbers" item (#272).
 *
 * MANUAL POSTING ONLY. This renders a PNG that DrJ downloads from
 * /scoop-ops/originals/numbers/:day.png and posts by hand. Nothing here, or
 * anywhere in #272, posts it automatically: an automatic post would be a new
 * kind of automated post (stop-list item 4) and needs DrJ's own decision.
 *
 * Signal identity: ink #090706, paper #F4EFE6, lime #DDE706, the number in Anton.
 * Cached at CARDS_DIR/numbers/<day>.png; a day's row is never rewritten, so the
 * cache never goes stale (the source fingerprint is in the file name in case
 * the layout code changes).
 */
import fs from "node:fs";
import path from "node:path";
import { renderTreeToPng, fontsReady, sourceFingerprint } from "./renderCore.js";
import { CARDS_DIR } from "./cardRenderer.js";
import { DISCLOSURE } from "../realityIndex/generation/byTheNumbers.js";

export const NUMBER_CARD = Object.freeze({ width: 1080, height: 1350 });
const INK = "#090706", PAPER = "#F4EFE6", LIME = "#DDE706";
const FINGERPRINT = sourceFingerprint([import.meta.url]);
export const NUMBERS_DIR = path.join(CARDS_DIR, "numbers");

const div = (style, children) => ({ type: "div", props: { style: { display: "flex", ...style }, children } });

/** The satori tree. Pure; exported for tests. */
export function numberCardTree(row) {
  const sources = (row.sources || []).map((s) => s.source_name).filter(Boolean);
  const num = String(row.number_text || "");
  const numSize = num.length <= 5 ? 300 : num.length <= 9 ? 210 : 150;
  return div({ width: NUMBER_CARD.width, height: NUMBER_CARD.height, flexDirection: "column", background: PAPER, color: INK, fontFamily: "Inter" }, [
    div({ padding: "56px 72px 0", fontSize: 34, fontWeight: 700, letterSpacing: 4, textTransform: "uppercase" }, "By the numbers"),
    div({ margin: "40px 72px 0", padding: "24px 40px", background: LIME, fontFamily: "Anton", fontSize: numSize, lineHeight: 1.05, alignSelf: "flex-start" }, num),
    div({ margin: "48px 72px 0", fontSize: 50, fontWeight: 600, lineHeight: 1.25 }, String(row.fact_text || "")),
    div({ flexGrow: 1 }, []),
    div({ margin: "0 72px", fontSize: 30, fontWeight: 600, opacity: 0.85 }, sources.length ? `Sources: ${sources.join(", ")}` : ""),
    div({ margin: "16px 72px 0", fontSize: 24, fontWeight: 600, opacity: 0.7, lineHeight: 1.3 }, DISCLOSURE),
    div({ marginTop: 40, padding: "28px 72px", background: INK, color: PAPER, fontSize: 34, fontWeight: 700, justifyContent: "space-between" }, [
      div({}, "scoopfeeds.com"),
      div({ color: LIME }, row.day || ""),
    ]),
  ]);
}

/** PNG buffer, or null when the fonts are missing (the caller reports it; never a silent blank card). */
export async function renderNumberCard(row) {
  if (!fontsReady({ requireAnton: true })) return null;
  return renderTreeToPng(numberCardTree(row), { ...NUMBER_CARD, background: PAPER });
}

/** Cached render for a day. → file path, or null when fonts are missing. */
export async function ensureNumberCard(row) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(row?.day))) throw new Error("bad day");
  const file = path.join(NUMBERS_DIR, `${row.day}-${FINGERPRINT}.png`);
  if (fs.existsSync(file)) return file;
  const png = await renderNumberCard(row);
  if (!png) return null;
  fs.mkdirSync(NUMBERS_DIR, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, png);
  fs.renameSync(tmp, file);
  return file;
}
