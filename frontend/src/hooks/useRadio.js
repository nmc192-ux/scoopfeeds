/**
 * useRadio — the two public ScoopFeeds Radio feeds the site reads.
 *
 *   useRadioState()  GET /api/radio/state.json  the worker-built headline card (Today page, #189)
 *   useRadioNow()    GET /api/radio/now.json    what the grid SCHEDULES this hour and next (#261).
 *                                               `basis: "schedule"`: the plan, not a now-playing feed,
 *                                               so the UI says "Scheduled now", never "Live".
 *
 * Both return null on any non-200 (404 = radio dark, 503 = not built yet), so callers earn-render.
 */
import { useQuery } from "@tanstack/react-query";

async function getJson(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) return null;
  return res.json();
}

export function useRadioState() {
  return useQuery({
    queryKey: ["radio-state-card"],
    queryFn: () => getJson("/api/radio/state.json"),
    retry: false,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
}

const FIVE_MIN = 5 * 60_000;

/** ms until the next refetch: the next hour boundary or 5 minutes, whichever is sooner (min 5 s). */
export function radioNowRefetchMs(nowMs = Date.now()) {
  const toHour = 3_600_000 - (nowMs % 3_600_000);
  return Math.max(5_000, Math.min(FIVE_MIN, toHour + 2_000));
}

export function useRadioNow() {
  return useQuery({
    queryKey: ["radio-now"],
    queryFn: () => getJson("/api/radio/now.json"),
    retry: false,
    staleTime: 60_000,
    refetchInterval: () => radioNowRefetchMs(),
    refetchOnWindowFocus: false,
  });
}

/**
 * The YouTube embed form of a public watch URL, or null when there is none (then the UI links out instead).
 *   youtube.com/watch?v=ID, youtu.be/ID, youtube.com/live/ID  → /embed/ID
 *   youtube.com/channel/UC…/live                              → /embed/live_stream?channel=UC…
 * A handle URL (youtube.com/@name/live) has no embed form, so it returns null.
 */
export function youtubeEmbedUrl(watchUrl) {
  let u;
  try { u = new URL(watchUrl); } catch { return null; }
  const host = u.hostname.replace(/^www\.|^m\./, "");
  const ID = /^[A-Za-z0-9_-]{6,}$/;
  let id = null, channel = null;
  if (host === "youtu.be") id = u.pathname.split("/")[1];
  else if (host === "youtube.com") {
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts[0] === "watch") id = u.searchParams.get("v");
    else if (parts[0] === "live" || parts[0] === "embed") id = parts[1];
    else if (parts[0] === "channel" && parts[2] === "live") channel = parts[1];
  }
  if (id && ID.test(id)) return `https://www.youtube.com/embed/${id}?autoplay=0`;
  if (channel && ID.test(channel)) return `https://www.youtube.com/embed/live_stream?channel=${channel}&autoplay=0`;
  return null;
}
