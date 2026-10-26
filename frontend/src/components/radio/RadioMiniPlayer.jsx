/**
 * RadioMiniPlayer — a small persistent ScoopFeeds Radio bar (#261), v2 chrome only. DARK.
 *
 * Shown only when the server publishes a watch URL (RADIO_PUBLIC_WATCH_URL → /api/radio/now.json `watchUrl`)
 * AND the reader opted in with ?radio=1 (kept in sessionStorage, like ?v2=1) or the build sets
 * VITE_RADIO_MINIPLAYER=true. ?radio=0 turns the per-visit opt-in off again.
 *
 * Collapsed: station name, "Scheduled now: <label>", Listen. Listen expands a small YouTube embed — the iframe is
 * created only after that click, so no request reaches youtube.com on page load, and it never autoplays. When the
 * watch URL has no embed form (a @handle URL), Listen opens it in a new tab instead. Mounted outside <Routes>, so
 * it survives route changes; "Close" hides it for the rest of the session. On mobile it sits above BottomBarV2.
 *
 * The label is the grid's PLAN (basis "schedule"), so it says "Scheduled now", never "Live".
 */
import { useState } from "react";
import { useLocation } from "react-router-dom";
import { Radio, X, ChevronDown } from "lucide-react";
import { useRadioNow, youtubeEmbedUrl } from "../../hooks/useRadio";

const ENV_ON = String(import.meta.env.VITE_RADIO_MINIPLAYER ?? "false").toLowerCase() === "true";
const OPT_KEY = "scoop_radio";
const DISMISS_KEY = "scoop_radio_dismissed";

function optedIn() {
  try {
    const q = new URLSearchParams(window.location.search).get("radio");
    if (q === "1") sessionStorage.setItem(OPT_KEY, "1");
    if (q === "0") sessionStorage.removeItem(OPT_KEY);
    return sessionStorage.getItem(OPT_KEY) === "1";
  } catch {
    return false;
  }
}

function wasDismissed() {
  try { return sessionStorage.getItem(DISMISS_KEY) === "1"; } catch { return false; }
}

export default function RadioMiniPlayer() {
  const { pathname } = useLocation();
  const [enabled] = useState(() => ENV_ON || optedIn());
  const [dismissed, setDismissed] = useState(wasDismissed);
  const [open, setOpen] = useState(false);
  const { data } = useRadioNow();

  const watchUrl = data?.watchUrl || null;
  if (!enabled || dismissed || !watchUrl || pathname.startsWith("/scoop-ops")) return null;

  const embed = youtubeEmbedUrl(watchUrl);
  const nowLabel = data?.basis === "schedule" ? data.now?.label : null;

  const dismiss = () => {
    try { sessionStorage.setItem(DISMISS_KEY, "1"); } catch { /* private mode: dismiss for this page only */ }
    setDismissed(true);
  };

  return (
    <>
      <div className="h-14 sm:hidden" aria-hidden />
      <section
        aria-label="ScoopFeeds Radio"
        data-testid="radio-mini-player"
        className="v2-chrome fixed z-40 inset-x-2 bottom-[calc(3.75rem+env(safe-area-inset-bottom,0px))] sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-80 rounded-xl shadow-lg border overflow-hidden"
        style={{ borderColor: "rgba(244,239,230,0.15)", background: "var(--radio-navy, #0F2238)", color: "var(--v2-paper, #F4EFE6)" }}
      >
        {open && embed && (
          <div className="aspect-video bg-black" data-testid="radio-mini-embed">
            <iframe
              src={embed}
              title="ScoopFeeds Radio"
              className="w-full h-full"
              allow="encrypted-media; picture-in-picture"
              allowFullScreen
              loading="lazy"
              referrerPolicy="strict-origin-when-cross-origin"
            />
          </div>
        )}
        <div className="flex items-center gap-2 px-3 py-2">
          <Radio size={18} aria-hidden className="shrink-0" />
          <div className="min-w-0 flex-1" style={{ fontFamily: "var(--v2-label)" }}>
            <p className="text-xs font-bold leading-tight">ScoopFeeds Radio</p>
            {nowLabel && <p className="text-[11px] leading-tight opacity-80 truncate" data-testid="radio-mini-label">Scheduled now: {nowLabel}</p>}
          </div>
          {embed ? (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              data-testid="radio-mini-listen"
              className="shrink-0 rounded-md px-2.5 py-1 text-xs font-bold min-h-[32px]"
              style={{ background: "var(--v2-lime, #DDE706)", color: "#0F2238" }}
            >
              {open ? <span className="inline-flex items-center gap-1"><ChevronDown size={14} aria-hidden />Hide</span> : "Listen"}
            </button>
          ) : (
            <a
              href={watchUrl}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="radio-mini-listen"
              className="shrink-0 rounded-md px-2.5 py-1 text-xs font-bold min-h-[32px] inline-flex items-center"
              style={{ background: "var(--v2-lime, #DDE706)", color: "#0F2238" }}
            >
              Listen
            </a>
          )}
          <button type="button" onClick={dismiss} aria-label="Close radio player" data-testid="radio-mini-close"
                  className="shrink-0 p-1 opacity-80 hover:opacity-100 min-h-[32px]">
            <X size={16} aria-hidden />
          </button>
        </div>
      </section>
    </>
  );
}
