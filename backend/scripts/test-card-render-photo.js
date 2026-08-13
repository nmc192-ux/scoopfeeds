// Photo-mode render test for the ARTICLE-photo cascade.
//
// This script exists to answer one question that cannot be answered by reading
// code: does the current host's @resvg/resvg-js actually rasterise an embedded
// JPEG, or does it silently drop it?
//
// History: resvg-js v2.6.x on Hostinger's shared linux-x64 container let JPEG
// data URIs through satori and then rasterised them as TRANSPARENT. That bug is
// why photo-backed cards were gated off behind CARD_USE_ARTICLE_PHOTO for so
// long. The project has since moved to a KVM VPS, so the finding has to be
// re-established on whatever host you are actually shipping to — run this there,
// not only on a Mac (the bug never reproduced on macOS arm64).
//
// Method. For each sample we render the SAME article twice: once forced
// typographic (`usePhoto: false`) and once through the real cascade. A photo
// that rasterises correctly produces a substantially larger PNG, because the
// photo pixels are high-entropy; a photo that resvg dropped collapses back to
// flat background and compresses to roughly the typographic size. So the size
// RATIO is the evidence, not the `withPhoto` flag — that flag only reports that
// we handed satori a data URI, which was true even while the bug was live.
//
// Usage:
//   cd backend && node --require ./load-env.cjs scripts/test-card-render-photo.js
//
// Exits non-zero if any sample fails to embed, so it can gate a deploy.

import path from "path";
import { fileURLToPath } from "url";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { ensureCard } from "../src/services/cardRenderer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "..", "data", "cards-test");
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

// A dropped photo collapses to near-typographic size. 1.8× is well clear of
// both outcomes: observed good renders land 8-15×, observed drops land at 1.0×.
const MIN_SIZE_RATIO = 1.8;

// Real publisher images on CDNs that content-negotiate — chosen deliberately:
// both of these return WebP if you advertise it, so they also regression-test
// the Accept header. If these URLs eventually rot the script says
// "fetch failed", which is distinguishable from a resvg drop, so a stale
// fixture can never be mistaken for the bug this script exists to catch.
const SAMPLES = [
  {
    id: "photoverify-thehill",
    title: "Senate panel advances health funding package",
    description: "The bill clears committee with bipartisan support after weeks of negotiation.",
    category: "politics",
    source_name: "The Hill",
    url: "https://thehill.com/",
    image_url: "https://thehill.com/wp-content/uploads/sites/2/2026/08/cassidybill_071626gn01_w.jpg?w=900",
    published_at: Date.now(),
    tags: ["us politics"],
  },
  {
    id: "photoverify-ary",
    title: "German economy posts modest quarterly growth",
    description: "Output edged up despite continued weakness in industrial orders.",
    category: "international",
    source_name: "ARY News",
    url: "https://arynews.tv/",
    image_url: "https://static.arynews.tv/zip-archives/wp-content/uploads/2026/08/German.jpg",
    published_at: Date.now(),
    tags: ["economy"],
  },
];

(async () => {
  console.log("Article-photo render verification (resvg embedded-JPEG check)\n");
  console.log(`platform: ${process.platform}/${process.arch}  node: ${process.version}\n`);

  let failures = 0;

  for (const article of SAMPLES) {
    try {
      // ORDER MATTERS. ensureCard deliberately prefers an already-cached
      // typographic render (the `-p0` file) over re-attempting a photo for the
      // same content hash — that is how it avoids re-fetching a known-bad image
      // on every request. So the photo render must run FIRST; doing the
      // baseline first writes the p0 file and the photo run silently returns it,
      // which looks exactly like a resvg drop.
      const photo = await ensureCard(article, "og");
      const plain = await ensureCard(article, "og", { usePhoto: false });

      const ratio = photo.buffer.length / plain.buffer.length;
      const embedded = photo.withPhoto && ratio >= MIN_SIZE_RATIO;

      const dest = path.join(OUT_DIR, `${article.id}-og.png`);
      writeFileSync(dest, photo.buffer);

      const verdict = embedded
        ? "PASS photo rasterised"
        : photo.withPhoto
          ? "FAIL photo handed to satori but did NOT rasterise (resvg drop)"
          : "FAIL no photo resolved (fetch failed — check network/CDN, not resvg)";

      if (!embedded) failures += 1;

      console.log(
        `${embedded ? "✓" : "✗"} ${article.source_name.padEnd(14)} ` +
        `typographic=${String(Math.round(plain.buffer.length / 1024)).padStart(4)}KB ` +
        `photo=${String(Math.round(photo.buffer.length / 1024)).padStart(4)}KB ` +
        `ratio=${ratio.toFixed(1)}×  ${verdict}`
      );
    } catch (e) {
      failures += 1;
      console.error(`✗ ${article.id}: ${e.message}`);
    }
  }

  console.log(`\nWrote cards to ${OUT_DIR}. Open them — the size check proves pixels landed, your eyes prove they are the RIGHT pixels.`);

  if (failures) {
    console.error(`\n${failures}/${SAMPLES.length} sample(s) failed. Do NOT ship photo-backed cards on this host until this is green.`);
    process.exit(1);
  }
  console.log(`\nAll ${SAMPLES.length} samples embedded correctly on this host.`);
})();
