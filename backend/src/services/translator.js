/**
 * Multi-provider translator with a quality-ordered fallback chain.
 *
 *   1. LibreTranslate — free & unlimited when self-hosted (Docker).
 *                       Public endpoints also supported; set LIBRETRANSLATE_URL.
 *   2. DeepL          — best grammar.   Needs DEEPL_API_KEY.
 *   3. MyMemory       — free fallback, rate-limited, weaker quality.
 *
 * Google Cloud Translation was removed (DrJ, 2026-10-22): Google is kept for
 * embeddings only, to keep paid Google usage to one line on the bill.
 * GOOGLE_TRANSLATE_KEY now does nothing.
 *
 * Each provider returns the raw translation; callers run the shared
 * `polishText` pass afterwards to fix common grammatical glitches that tend
 * to survive free-tier translation (double spaces, stray punctuation,
 * missing sentence capitalization, etc.).
 *
 * Providers are retried in order: if the first one throws or returns the
 * source string unchanged we fall through to the next one. The caller
 * sees a single async `translate(text, target, source?)` function.
 *
 * ── Env vars ────────────────────────────────────────────────────────────
 *   LIBRETRANSLATE_URL      default: http://127.0.0.1:5000 (self-hosted)
 *                           set to https://libretranslate.com or any public
 *                           mirror if you don't want to run your own
 *   LIBRETRANSLATE_API_KEY  optional; required by some public instances
 *   DEEPL_API_KEY           optional (enables DeepL tier)
 *   MYMEMORY_EMAIL          optional registered email — gives 10k words/day
 */
import axios from "axios";
import { logger } from "./logger.js";

const LIBRE_URL   = (process.env.LIBRETRANSLATE_URL || "http://127.0.0.1:5000").replace(/\/+$/, "");
const LIBRE_KEY   = process.env.LIBRETRANSLATE_API_KEY || "";
const DEEPL_KEY   = process.env.DEEPL_API_KEY         || "";
const MYMEMORY_EMAIL = process.env.MYMEMORY_EMAIL     || "khabari.app@gmail.com";

// Circuit-breaker for LibreTranslate: if a call fails, stop trying for a
// short window so we don't block every translation on a dead endpoint.
let libreDeadUntil = 0;
function libreAvailable() { return Date.now() >= libreDeadUntil; }
function markLibreDead(ms = 60_000) { libreDeadUntil = Date.now() + ms; }

// DeepL target codes are mostly ISO 639-1 but with a few variations.
const DEEPL_TARGET_MAP = {
  en: "EN-US", pt: "PT-PT", zh: "ZH",
};
function deeplTarget(code) { return (DEEPL_TARGET_MAP[code] || code).toUpperCase(); }

// DeepL uses a different host for free vs pro keys.
function deeplHost() {
  return DEEPL_KEY.endsWith(":fx")
    ? "https://api-free.deepl.com"
    : "https://api.deepl.com";
}

// ─── Providers ─────────────────────────────────────────────────────────────
async function translateLibre(text, target, source) {
  if (!libreAvailable()) return null;
  try {
    const payload = {
      q: text,
      source: (source && source !== "auto") ? source : "auto",
      target,
      format: "text",
    };
    if (LIBRE_KEY) payload.api_key = LIBRE_KEY;
    const { data } = await axios.post(`${LIBRE_URL}/translate`, payload, {
      timeout: 20000,
      headers: { "Content-Type": "application/json" },
    });
    return data?.translatedText || null;
  } catch (err) {
    // 4xx means we reached the server but it rejected — don't blacklist it.
    const status = err?.response?.status;
    if (!status || status >= 500) markLibreDead();
    throw err;
  }
}

async function translateDeepL(text, target, source) {
  if (!DEEPL_KEY) return null;
  const params = new URLSearchParams();
  params.append("text", text);
  params.append("target_lang", deeplTarget(target));
  if (source && source !== "auto") params.append("source_lang", source.toUpperCase());
  const { data } = await axios.post(`${deeplHost()}/v2/translate`, params, {
    headers: {
      Authorization: `DeepL-Auth-Key ${DEEPL_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    timeout: 15000,
  });
  return data?.translations?.[0]?.text || null;
}

async function translateMyMemory(text, target, source) {
  const langpair = `${source || "en"}|${target}`;
  const { data } = await axios.get("https://api.mymemory.translated.net/get", {
    params: { q: text.slice(0, 500), langpair, de: MYMEMORY_EMAIL },
    timeout: 15000,
  });
  const result = data?.responseData?.translatedText || null;
  if (!result) return null;
  // MyMemory returns sentinel strings on failure or rate-limit.
  if (/^PLEASE SELECT|^INVALID|^MYMEMORY/i.test(result)) return null;
  if (data?.responseStatus === 429) return null;
  return result;
}

// ─── Grammar polish ────────────────────────────────────────────────────────
/**
 * Light-touch text cleanup applied to every translation. These are all
 * conservative — they only fix clearly wrong output — so they're safe to run
 * regardless of provider. For RTL targets we skip capitalization.
 */
export function polishText(text, target) {
  if (!text) return text;
  let t = String(text);

  // Normalize whitespace.
  t = t.replace(/[ \t]+/g, " ");
  t = t.replace(/\s+\n/g, "\n").replace(/\n\s+/g, "\n");

  // Common free-translator artifacts.
  t = t.replace(/\s+([,.!?:;])/g, "$1");            // " ," → ","
  t = t.replace(/([,.!?:;])([^\s"'\d])/g, "$1 $2"); // ",X" → ", X"
  t = t.replace(/\s{2,}/g, " ");
  t = t.replace(/\(\s+/g, "(").replace(/\s+\)/g, ")");
  t = t.replace(/"\s+([^"]+?)\s+"/g, '"$1"');

  // Sentence-start capitalization (LTR languages only; skip RTL scripts).
  const rtl = ["ar", "fa", "ur", "he", "ps", "sd"].includes(target);
  if (!rtl) {
    t = t.replace(/(^|[.!?]\s+)([a-z])/g, (_, pre, ch) => pre + ch.toUpperCase());
    // Standalone "i" → "I" (English pronoun).
    if (target === "en") t = t.replace(/\bi\b/g, "I");
  }

  // Trim.
  return t.trim();
}

// ─── Public API ────────────────────────────────────────────────────────────
const PROVIDERS = [
  { name: "libretranslate", fn: translateLibre,    enabled: () => !!LIBRE_URL  },
  { name: "deepl",          fn: translateDeepL,    enabled: () => !!DEEPL_KEY  },
  { name: "mymemory",       fn: translateMyMemory, enabled: () => true         },
];

export function availableProviders() {
  return PROVIDERS.filter((p) => p.enabled()).map((p) => p.name);
}

/**
 * Translate `text` to `target` (ISO 639-1). Returns the translated string,
 * or the original text if every provider fails. Never throws.
 */
export async function translate(text, target, source = "auto") {
  if (!text || !target || target === source) return text;
  for (const p of PROVIDERS) {
    if (!p.enabled()) continue;
    try {
      const out = await p.fn(text, target, source);
      if (out && out.trim() && out.trim() !== text.trim()) {
        return polishText(out, target);
      }
    } catch (err) {
      logger.warn(`translator: ${p.name} failed — ${err.message}`);
    }
  }
  return text;
}
