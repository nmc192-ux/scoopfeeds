/**
 * i18n.js — no-deps i18n hook + helpers for the 10-language set.
 *
 * Architecture:
 *  • LANGUAGES is the canonical list (en, ur, es, ar, fr, de, pt, hi, zh, ja)
 *    with rtl flags.
 *  • Locale dictionaries are lazy-loaded via dynamic import() on first use
 *    and cached in module scope so subsequent calls are synchronous.
 *  • useT() subscribes to newsStore.language so consumers re-render on
 *    language change without any extra wiring.
 *  • t(key, fallback?) resolution order:
 *      locale[key] → en[key] → fallback arg → key itself
 */

import { useState, useEffect, useCallback } from "react";
import { useNewsStore } from "../store/newsStore";

// ─── Language registry ──────────────────────────────────────────────────────
// Intentionally a slimmer list than lib/languages.js — only the locales we
// ship translation files for. The full picker still uses lib/languages.js.
export const LANGUAGES = [
  { code: "en", label: "English",   rtl: false },
  { code: "ur", label: "اردو",      rtl: true  },
  { code: "es", label: "Español",   rtl: false },
  { code: "ar", label: "العربية",   rtl: true  },
  { code: "fr", label: "Français",  rtl: false },
  { code: "de", label: "Deutsch",   rtl: false },
  { code: "pt", label: "Português", rtl: false },
  { code: "hi", label: "हिन्दी",    rtl: false },
  { code: "zh", label: "中文",       rtl: false },
  { code: "ja", label: "日本語",     rtl: false },
];

export const LANG_CODES = new Set(LANGUAGES.map((l) => l.code));

// ─── Module-level dict cache ─────────────────────────────────────────────────
// { "en": { "brand.name": "Reality Index", ... }, "es": {...}, ... }
const _cache = {};
// Tracks in-flight promises so parallel callers don't double-fetch.
const _loading = {};

async function loadDict(code) {
  if (_cache[code]) return _cache[code];
  if (_loading[code]) return _loading[code];

  _loading[code] = (async () => {
    try {
      // Vite resolves these at build time — all four files must exist.
      const mod = await import(`../locales/${code}.json`);
      _cache[code] = mod.default ?? mod;
    } catch {
      // Graceful degradation: treat missing locale as empty dict.
      _cache[code] = {};
    }
    delete _loading[code];
    return _cache[code];
  })();

  return _loading[code];
}

// ─── getCurrentLang ───────────────────────────────────────────────────────────
/**
 * Returns the active 2-letter language code.
 * Priority: store.language → navigator.language[0..1] → "en"
 * Note: This is a non-reactive helper — use useT() for reactive access.
 * Importing useNewsStore here would create a circular dependency if called
 * at module init time; instead we read directly from the Zustand store
 * singleton via its getState() escape hatch.
 */
export function getCurrentLang() {
  try {
    // useNewsStore.getState() is a Zustand static accessor that works
    // outside of React (no hook rules apply).
    const lang = useNewsStore.getState?.().language;
    if (lang && LANG_CODES.has(lang)) return lang;
  } catch {}
  // Navigator fallback (2-char BCP-47 prefix).
  const nav = (navigator?.language || "").slice(0, 2).toLowerCase();
  if (nav && LANG_CODES.has(nav)) return nav;
  return "en";
}

// ─── useT ─────────────────────────────────────────────────────────────────────
/**
 * React hook — returns a t(key, fallback?) translator that is always in sync
 * with the current language. Triggers a re-render when the language changes
 * or when the async locale dict finishes loading.
 *
 * Usage:
 *   const { t } = useT();
 *   <h1>{t("brand.name")}</h1>
 *   <p>{t("some.key", "Default text")}</p>
 */
export function useT() {
  const language = useNewsStore((s) => s.language);
  // Normalise: if the user picked a language we don't have a file for, fall
  // back to "en" so translation still works.
  const code = LANG_CODES.has(language) ? language : "en";

  // Force re-render when the async dict finishes loading.
  const [, setTick] = useState(0);

  useEffect(() => {
    if (_cache[code]) return; // already loaded — no re-render needed.
    let cancelled = false;
    loadDict(code).then(() => {
      if (!cancelled) setTick((n) => n + 1);
    });
    // Also pre-load English so cross-language fallback is instant.
    if (code !== "en" && !_cache["en"]) {
      loadDict("en");
    }
    return () => { cancelled = true; };
  }, [code]);

  const t = useCallback(
    (key, fallback) => {
      const dict = _cache[code] || {};
      if (key in dict) return dict[key];
      // English fallback.
      const en = _cache["en"] || {};
      if (key in en) return en[key];
      // Explicit fallback arg.
      if (fallback !== undefined) return fallback;
      // Last resort: the key itself (readable dot-path).
      return key;
    },
    // Re-compute whenever language changes or a new dict loads (tick bump).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [code, _cache[code], _cache["en"]]
  );

  return { t, lang: code };
}
