import { useQuery } from "@tanstack/react-query";
import { create } from "zustand";
import { createApi } from "../lib/api";

const api = createApi({ baseURL: "/api" });

/**
 * Tiny zustand store for the in-app reader modal.
 * Any component can call openReader(article) to launch the distraction-free view.
 */
export const useReaderStore = create((set) => ({
  article: null,           // { title, url, image_url, source_name, ... } or null
  open: false,
  openReader: (article) => set({ article, open: true }),
  closeReader:        () => set({ open: false }),
}));

/**
 * Fetch server-side extracted article HTML (Readability). Only runs when
 * an article URL is provided — the component gates rendering on `enabled`.
 */
export function useReaderArticle(url) {
  return useQuery({
    queryKey: ["reader", url],
    enabled: !!url,
    staleTime: 10 * 60 * 1000,
    gcTime:    60 * 60 * 1000,
    retry: false,           // backend already retries 3 strategies internally
    refetchOnWindowFocus: false,
    queryFn: async () => {
      try {
        const { data } = await api.get("/reader", { params: { url } });
        if (!data?.success) {
          const err = new Error(data?.error || "Extraction failed");
          err.hint = data?.hint || null;
          throw err;
        }
        return data.data;
      } catch (axiosErr) {
        // Axios throws on non-2xx — extract the structured error body
        const body = axiosErr?.response?.data;
        const err  = new Error(body?.error || axiosErr.message || "Extraction failed");
        err.hint   = body?.hint || null;
        err.status = axiosErr?.response?.status || null;
        throw err;
      }
    },
  });
}

/**
 * Translate the reader-extracted HTML + title into `target`. Skipped when
 * target equals the article's source language (or either is missing).
 * Returns `{ html, title, isTranslating }`; falls back to the original on
 * any failure so the reader never ends up blank.
 */
export function useTranslatedReader(data, target, source) {
  const shouldTranslate =
    !!data?.content && !!target && target !== (source || "en");

  const q = useQuery({
    queryKey: ["reader-translated", data?.url, target, source || "auto"],
    enabled: shouldTranslate,
    staleTime: 30 * 60 * 1000,
    gcTime:    60 * 60 * 1000,
    retry: 0,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const [htmlRes, titleRes] = await Promise.all([
        api.post("/translate/html", { html: data.content, lang: target, source: source || "auto" }),
        data.title
          ? api.post("/translate", { texts: [data.title], lang: target, source: source || "auto" })
          : Promise.resolve(null),
      ]);
      return {
        html:  htmlRes?.data?.html  || data.content,
        title: titleRes?.data?.data?.[0] || data.title,
      };
    },
  });

  if (!shouldTranslate) {
    return { html: data?.content, title: data?.title, isTranslating: false };
  }
  return {
    html:  q.data?.html  || data?.content,
    title: q.data?.title || data?.title,
    isTranslating: q.isLoading,
  };
}
