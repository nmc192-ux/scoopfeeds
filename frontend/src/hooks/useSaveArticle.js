/**
 * useSaveArticle — unified save/unsave hook that bridges the local Zustand
 * reading list and the server-synced saved articles for logged-in users.
 *
 * Behaviour:
 *   - Not logged in: saves/unsaves only in the local Zustand store (localStorage-persisted).
 *   - Logged in:     saves/unsaves in the server AND reflects the change in the
 *     local Zustand store so the UI updates instantly without a re-fetch.
 *
 * On first mount after login, if `auth.savedArticles` is populated, they are
 * merged into the Zustand store so the full cross-device reading list is
 * visible even in components that read from the Zustand store directly.
 */
import { useEffect, useCallback, useRef } from "react";
import { useNewsStore } from "../store/newsStore";
import { useAuth } from "./useAuth";

export function useSaveArticle() {
  const store        = useNewsStore();
  const auth         = useAuth();
  const mergedRef    = useRef(false);   // prevent merging repeatedly on every render

  // ── Merge server saves into local Zustand on login (once per session) ──
  useEffect(() => {
    if (!auth.user || mergedRef.current) return;
    if (!auth.savedArticles?.length) return;
    mergedRef.current = true;

    const existingIds = new Set(store.savedArticles.map((a) => a.id));
    const incoming    = auth.savedArticles.filter((a) => !existingIds.has(a.id));
    if (incoming.length > 0) {
      // Merge server articles at the front (they're "canonical")
      store.saveArticle.__mergeFromServer?.(incoming) ??
        incoming.forEach((a) => store.saveArticle(a));
    }
  }, [auth.user?.id, auth.savedArticles?.length]);  // eslint-disable-line react-hooks/exhaustive-deps

  // ── isSaved: check both local + server list ─────────────────────────────
  const isSaved = useCallback((articleId) => {
    if (auth.user) return auth.isSaved ? auth.isSaved(articleId) : false;
    return store.isArticleSaved(articleId);
  }, [auth.user, auth.isSaved, store.isArticleSaved]);

  // ── save ─────────────────────────────────────────────────────────────────
  const save = useCallback(async (article) => {
    if (!article) return;
    // Optimistic local update first — instant UI feedback.
    store.saveArticle(article);
    // Server write if logged in.
    if (auth.user) {
      try {
        await auth.saveArticle(article.id);
      } catch {
        // Server write failed — local state is still updated; not critical.
      }
    }
  }, [auth.user, auth.saveArticle, store.saveArticle]);

  // ── unsave ───────────────────────────────────────────────────────────────
  const unsave = useCallback(async (articleId) => {
    // Optimistic local update.
    store.unsaveArticle(articleId);
    // Server write if logged in.
    if (auth.user) {
      try {
        await auth.unsaveArticle(articleId);
      } catch {
        // Non-critical; local state is already cleared.
      }
    }
  }, [auth.user, auth.unsaveArticle, store.unsaveArticle]);

  // ── toggle ────────────────────────────────────────────────────────────────
  const toggle = useCallback(async (article) => {
    if (isSaved(article.id)) {
      await unsave(article.id);
    } else {
      await save(article);
    }
  }, [isSaved, save, unsave]);

  return { save, unsave, toggle, isSaved };
}
