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
