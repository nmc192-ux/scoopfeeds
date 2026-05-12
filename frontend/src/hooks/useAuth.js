/**
 * useAuth — React hook for magic-link session state.
 *
 * The session is held server-side (httpOnly cookie). On mount we call
 * /api/auth/me to hydrate the user. All writes (save, unsave, prefs, logout)
 * are thin wrappers around the /api/auth/* endpoints.
 *
 * When the user is logged in, saved articles are synced from the server on
 * hydration so the cross-device state is immediately available.
 */
import { useState, useEffect, useCallback } from "react";
import { createApi } from "../lib/api";

const api = createApi({ withCredentials: true });

export function useAuth() {
  const [user, setUser]       = useState(undefined);   // undefined = loading, null = not logged in
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  // ── Hydrate session on mount ────────────────────────────────────────────
  useEffect(() => {
    api.get("/api/auth/me")
      .then((r) => setUser(r.data.user || null))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  // ── Request magic link ───────────────────────────────────────────────────
  const requestLink = useCallback(async (email) => {
    setError(null);
    await api.post("/api/auth/request", { email });
  }, []);

  // ── Logout ───────────────────────────────────────────────────────────────
  const logout = useCallback(async () => {
    await api.post("/api/auth/logout").catch(() => {});
    setUser(null);
  }, []);

  // ── Update prefs ─────────────────────────────────────────────────────────
  const updatePrefs = useCallback(async (prefs) => {
    if (!user) return;
    await api.put("/api/auth/prefs", prefs);
    setUser((u) => u ? { ...u, ...prefs } : u);
  }, [user]);

  // ── Saved articles (server-side) ──────────────────────────────────────────
  const [savedIds, setSavedIds] = useState(new Set());
  const [savedArticles, setSavedArticles] = useState([]);

  // Sync saved articles from server when user is authenticated.
  useEffect(() => {
    if (!user) { setSavedIds(new Set()); setSavedArticles([]); return; }
    api.get("/api/auth/saves")
      .then((r) => {
        const arts = r.data.articles || [];
        setSavedArticles(arts);
        setSavedIds(new Set(arts.map((a) => a.id)));
      })
      .catch(() => {});
  }, [user?.id]);

  const saveArticle = useCallback(async (articleId) => {
    if (!user) return;
    await api.post(`/api/auth/saves/${encodeURIComponent(articleId)}`);
    setSavedIds((s) => new Set([...s, articleId]));
  }, [user]);

  const unsaveArticle = useCallback(async (articleId) => {
    if (!user) return;
    await api.delete(`/api/auth/saves/${encodeURIComponent(articleId)}`);
    setSavedIds((s) => { const n = new Set(s); n.delete(articleId); return n; });
    setSavedArticles((a) => a.filter((x) => x.id !== articleId));
  }, [user]);

  const isSaved = useCallback((articleId) => savedIds.has(articleId), [savedIds]);

  return {
    user,          // null = not logged in, object = logged in
    loading,
    error,
    isLoggedIn: Boolean(user),
    isPremium: user?.tier === "premium",
    requestLink,
    logout,
    updatePrefs,
    saveArticle,
    unsaveArticle,
    isSaved,
    savedArticles,
  };
}
