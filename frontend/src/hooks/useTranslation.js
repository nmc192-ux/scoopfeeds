import { useState, useEffect, useRef } from "react";
import axios from "axios";
import { useNewsStore } from "../store/newsStore";

const api = axios.create({ baseURL: "/api" });

// ─── In-memory cache (session-scoped) ─────────────────────────────────────
const translationCache = new Map();
function getCacheKey(text, lang) { return `${lang}::${text}`; }

// ─── Global pending deduplication — same text = same promise ─────────────
const pendingRequests = new Map();

async function fetchTranslation(texts, lang, source = "auto") {
  const cacheKey = texts.join("|||") + ":::" + lang + ":::" + source;
  if (pendingRequests.has(cacheKey)) return pendingRequests.get(cacheKey);

  const promise = (async () => {
    // Split into cache hits vs misses
    const results = new Array(texts.length);
    const toFetch = [];

    texts.forEach((text, i) => {
      const key = getCacheKey(text, lang);
      if (translationCache.has(key)) {
        results[i] = translationCache.get(key);
      } else {
        toFetch.push({ i, text });
      }
    });

    if (toFetch.length > 0) {
      try {
        const { data } = await api.post("/translate", {
          texts: toFetch.map(f => f.text),
          lang,
          source,
        });
        if (data.success) {
          data.data.forEach((translated, j) => {
            const { i, text } = toFetch[j];
            // Only cache if genuinely translated (not same as source)
            if (translated && translated !== text) {
              translationCache.set(getCacheKey(text, lang), translated);
            }
            results[i] = translated || text;
          });
        } else {
          toFetch.forEach(({ i, text }) => { results[i] = text; });
        }
      } catch {
        toFetch.forEach(({ i, text }) => { results[i] = text; });
      }
    }
    return results;
  })();

  pendingRequests.set(cacheKey, promise);
  promise.finally(() => pendingRequests.delete(cacheKey));
  return promise;
}

/**
 * Translate an array of strings into the user's chosen language.
 *
 * @param {string[]} texts       — source strings
 * @param {string}   sourceLang  — the strings' source language ("en" by default)
 *
 * Behavior:
 *  - If `autoLanguage` is true OR target === sourceLang, returns texts as-is.
 *  - Otherwise hits /api/translate with source + target.
 *  - Session cache + in-flight dedup keep this cheap on re-renders.
 */
export function useTranslatedTexts(texts = [], sourceLang = "en") {
  const { language, autoLanguage } = useNewsStore();
  const [translated, setTranslated] = useState(texts);
  const [isTranslating, setIsTranslating] = useState(false);
  const prevKey = useRef(null);

  const target = autoLanguage ? sourceLang : language;
  const skip   = !target || target === sourceLang;

  useEffect(() => {
    if (skip) {
      setTranslated(texts);
      setIsTranslating(false);
      prevKey.current = texts.join("|||") + ":::" + (target || "x");
      return;
    }

    const currentKey = texts.join("|||") + ":::" + target + ":::" + sourceLang;
    if (currentKey === prevKey.current) return;
    prevKey.current = currentKey;

    // Serve cache hits immediately for snappy UX
    const immediate = texts.map(t => translationCache.get(getCacheKey(t, target)) ?? t);
    setTranslated(immediate);

    // Check if any texts need a network round-trip (not in cache)
    const needsFetch = texts.some(t => !translationCache.has(getCacheKey(t, target)));
    if (needsFetch) setIsTranslating(true);

    let cancelled = false;
    (async () => {
      const result = await fetchTranslation(texts, target, sourceLang);
      if (!cancelled) {
        setTranslated([...result]);
        setIsTranslating(false);
      }
    })();

    return () => { cancelled = true; };
  }, [target, sourceLang, skip, texts.join("|||")]);

  return {
    texts:         skip ? texts : translated,
    isRtl:         ["ar", "fa", "ur", "he", "ps"].includes(target),
    isUrdu:        target === "ur",
    isTranslating: !skip && isTranslating,
  };
}

/** Convenience hook for a single string */
export function useTranslated(text, sourceLang = "en") {
  const { texts } = useTranslatedTexts(text ? [text] : [""], sourceLang);
  return texts[0] || text;
}
