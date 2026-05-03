import { create } from "zustand";
import { persist } from "zustand/middleware";
import { isRtl } from "../lib/languages";

export const useNewsStore = create(
  persist(
    (set, get) => ({
      // ─── Theme ─────────────────────────────────────────────────────
      darkMode: window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false,
      toggleDarkMode: () => {
        const next = !get().darkMode;
        set({ darkMode: next });
        document.documentElement.classList.toggle("dark", next);
      },

      // ─── Density (Comfortable / Compact "Pro" mode) ────────────────
      // Sets a `data-density="compact"` attribute on <html>; tiny global
      // CSS rules in index.css then compress padding + font sizes across
      // common Tailwind utilities. No per-page edits required.
      density: "comfortable",
      toggleDensity: () => {
        const next = get().density === "compact" ? "comfortable" : "compact";
        set({ density: next });
        if (next === "compact") document.documentElement.setAttribute("data-density", "compact");
        else                    document.documentElement.removeAttribute("data-density");
      },
      setDensity: (v) => {
        const next = v === "compact" ? "compact" : "comfortable";
        set({ density: next });
        if (next === "compact") document.documentElement.setAttribute("data-density", "compact");
        else                    document.documentElement.removeAttribute("data-density");
      },

      // ─── Language ───────────────────────────────────────────────────
      // `language` is the user's chosen target (ISO 639-1). When
      // `autoLanguage` is true, each article is shown in its source language
      // and this field holds the most-recent explicit choice (used as a
      // fallback for UI chrome).
      language: "en",
      autoLanguage: true,
      setLanguage: (lang) => {
        set({ language: lang });
        document.documentElement.setAttribute("lang", lang);
        document.documentElement.setAttribute("dir", isRtl(lang) ? "rtl" : "ltr");
      },
      setAutoLanguage: (v) => set({ autoLanguage: !!v }),

      // ─── Active Topics ─────────────────────────────────────────────
      // Tabs are now single-select (Apple News–style). The array is kept as
      // the storage shape so "saved" can live alongside a topic id without a
      // breaking migration.
      activeTopics: ["top"],
      setActiveTopics: (topics) => set({ activeTopics: topics }),
      toggleTopic: (topicId) => {
        // Single-select: any tap replaces the current tab.
        set({ activeTopics: [topicId] });
      },

      // ─── Search ────────────────────────────────────────────────────
      searchQuery: "",
      setSearchQuery: (q) => set({ searchQuery: q }),

      // ─── Reading list ──────────────────────────────────────────────
      savedArticles: [],
      saveArticle: (article) => {
        const saved = get().savedArticles;
        if (!saved.find(a => a.id === article.id)) {
          set({ savedArticles: [article, ...saved].slice(0, 50) });
        }
      },
      unsaveArticle: (id) => set({ savedArticles: get().savedArticles.filter(a => a.id !== id) }),
      isArticleSaved: (id) => get().savedArticles.some(a => a.id === id),

      // ─── View mode ─────────────────────────────────────────────────
      viewMode: "grid",
      setViewMode: (mode) => set({ viewMode: mode }),

      // ─── Video tab ─────────────────────────────────────────────────
      videoTab: "all",   // "all" | "shorts" | "tiktok" | "facebook"
      setVideoTab: (tab) => set({ videoTab: tab }),

      // ─── Followed YouTube Channels ─────────────────────────────────
      followedChannels: [],
      toggleFollowChannel: (name) => {
        const c = get().followedChannels;
        set({ followedChannels: c.includes(name) ? c.filter(x => x !== name) : [...c, name] });
      },
      isChannelFollowed: (name) => get().followedChannels.includes(name),

      // ─── Refresh ───────────────────────────────────────────────────
      lastRefreshed: null,
      setLastRefreshed: (time) => set({ lastRefreshed: time }),

      // ─── Personalization ────────────────────────────────────────────
      // Preferred topics (boost these in ranking)
      preferredTopics: [],
      togglePreferredTopic: (topicId) => {
        const cur = get().preferredTopics;
        set({
          preferredTopics: cur.includes(topicId)
            ? cur.filter((t) => t !== topicId)
            : [...cur, topicId],
        });
      },
      setPreferredTopics: (topics) => set({ preferredTopics: Array.isArray(topics) ? topics : [] }),

      // Muted / preferred sources (boost/penalize in ranking)
      mutedSources:     [],
      preferredSources: [],
      toggleMutedSource: (name) => {
        const cur = get().mutedSources;
        set({
          mutedSources: cur.includes(name)
            ? cur.filter((s) => s !== name)
            : [...cur, name],
        });
      },
      togglePreferredSource: (name) => {
        const cur = get().preferredSources;
        set({
          preferredSources: cur.includes(name)
            ? cur.filter((s) => s !== name)
            : [...cur, name],
        });
      },

      // Onboarding state
      onboardingComplete: false,
      completeOnboarding: () => set({ onboardingComplete: true }),
      resetOnboarding:   () => set({ onboardingComplete: false }),

      // ─── Auth modal (not persisted) ───────────────────────────────
      authOpen: false,
      setAuthOpen: (v) => set({ authOpen: !!v }),

      // Reader preferences
      readerPrefs: { fontIdx: 1, sepia: false },
      setReaderPrefs: (patch) => set({ readerPrefs: { ...get().readerPrefs, ...patch } }),
    }),
    {
      name: "khabari-store",
      // Bump when the persisted shape changes incompatibly. v2 = Apple-News
      // style 9-tab topic list; old ids like "pakistan"/"medicine"/"cars" get
      // remapped or dropped so returning users don't land on a dead tab.
      version: 2,
      migrate: (persisted, fromVersion) => {
        if (!persisted) return persisted;
        if (fromVersion < 2 && Array.isArray(persisted.activeTopics)) {
          const remap = {
            international: "world",
            pakistan: "local", // user's Local tab + their country picker takes over
            ai: "tech",
            "agentic-ai": "tech",
            "computer-science": "tech",
            medicine: "science",
            health: "science",
            "public-health": "science",
            environment: "science",
            "self-help": "top",
            weather: "top",
            cars: "business",
            publications: "business",
          };
          const valid = new Set([
            "top", "live", "local", "world", "politics",
            "business", "tech", "science", "sports", "saved",
          ]);
          const next = persisted.activeTopics
            .map((t) => remap[t] || t)
            .filter((t) => valid.has(t));
          persisted.activeTopics = next.length ? [next[0]] : ["top"];
          // preferredTopics goes through the same filter (stored in settings).
          if (Array.isArray(persisted.preferredTopics)) {
            persisted.preferredTopics = [
              ...new Set(
                persisted.preferredTopics
                  .map((t) => remap[t] || t)
                  .filter((t) => valid.has(t) && t !== "saved")
              ),
            ];
          }
        }
        return persisted;
      },
      partialize: (state) => ({
        darkMode:            state.darkMode,
        density:             state.density,
        language:            state.language,
        autoLanguage:        state.autoLanguage,
        activeTopics:        state.activeTopics,
        savedArticles:       state.savedArticles,
        viewMode:            state.viewMode,
        followedChannels:    state.followedChannels,
        preferredTopics:     state.preferredTopics,
        mutedSources:        state.mutedSources,
        preferredSources:    state.preferredSources,
        onboardingComplete:  state.onboardingComplete,
        readerPrefs:         state.readerPrefs,
      }),
    }
  )
);

// Apply persisted settings on init
const { darkMode, language, density } = useNewsStore.getState();
document.documentElement.classList.toggle("dark", darkMode);
document.documentElement.setAttribute("lang",  language || "en");
document.documentElement.setAttribute("dir",   isRtl(language) ? "rtl" : "ltr");
if (density === "compact") document.documentElement.setAttribute("data-density", "compact");
