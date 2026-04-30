/**
 * LiveTvPage — `/live-tv`
 *
 * 24/7 free YouTube news livestreams, embedded inline. Channels are grouped
 * by region and language. The active stream plays in a sticky 16:9 player at
 * the top; the channel grid below lets users switch with one click.
 *
 * Backend: hits /api/live-stream which returns { id → videoId } for channels
 * with live streams active right now (cached 10 min server-side).
 *
 * Embedding: uses youtube-nocookie.com to avoid setting tracking cookies until
 * the user explicitly interacts. Autoplay requires mute=1 per Chrome policy
 * — the unmute button is the most-used control on the page.
 */
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import axios from "axios";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Volume2, VolumeX, Maximize2, Loader2, AlertCircle, Globe } from "lucide-react";
import clsx from "clsx";

/* ─── Channel catalog ──────────────────────────────────────────────────────
   id           — matches the backend liveStream.js channel id (when present)
   fallbackId   — a known stable video ID used if the API doesn't return one
   handle       — used for the "Open on YouTube" link; not required for embed
   ──────────────────────────────────────────────────────────────────────── */
const CHANNELS = [
  // ── Global English ──────────────────────────────────────────────────────
  { id: "aljazeera",  name: "Al Jazeera English", flag: "🌍", lang: "EN", region: "global",   handle: "AlJazeeraEnglish" },
  { id: "france24",   name: "France 24 English",  flag: "🇫🇷", lang: "EN", region: "global",   handle: "FRANCE24English" },
  { id: "dw",         name: "DW News",            flag: "🇩🇪", lang: "EN", region: "europe",   handle: "DWNews" },
  { id: "bbc",        name: "BBC News",           flag: "🇬🇧", lang: "EN", region: "europe",   handle: "BBCNews" },
  { id: "skynews",    name: "Sky News",           flag: "🇬🇧", lang: "EN", region: "europe",   handle: "SkyNews" },
  { id: "bloomberg",  name: "Bloomberg TV",       flag: "🇺🇸", lang: "EN", region: "americas", fallbackId: "iEpJwprxDdk", handle: "Bloomberg" },
  { id: "abcnews",    name: "ABC News Live",      flag: "🇺🇸", lang: "EN", region: "americas", fallbackId: "vOTiJkg1voo", handle: "ABCNews" },
  { id: "cbsnews",    name: "CBS News",           flag: "🇺🇸", lang: "EN", region: "americas", fallbackId: "BfL2pudZbBM", handle: "CBSNews" },
  // ── Asia ────────────────────────────────────────────────────────────────
  { id: "wion",       name: "WION",               flag: "🇮🇳", lang: "EN", region: "asia",     handle: "WION" },
  { id: "ndtv",       name: "NDTV 24x7",          flag: "🇮🇳", lang: "EN", region: "asia",     fallbackId: "MtnAtxiK_eQ" },
  { id: "cna",        name: "Channel News Asia",  flag: "🇸🇬", lang: "EN", region: "asia",     fallbackId: "XWq5kBlakcQ", handle: "channelnewsasia" },
  { id: "nhkworld",   name: "NHK World Japan",    flag: "🇯🇵", lang: "EN", region: "asia",     fallbackId: "f0lYjLstM-A", handle: "NHKWORLDJAPAN" },
  { id: "cgtn",       name: "CGTN",               flag: "🇨🇳", lang: "EN", region: "asia",     fallbackId: "hxFunHjj8FM", handle: "CGTN" },
  { id: "trtworld",   name: "TRT World",          flag: "🇹🇷", lang: "EN", region: "mena",     fallbackId: "wXnCOvgnUKQ", handle: "trtworld" },
  // ── MENA / Africa ──────────────────────────────────────────────────────
  { id: "i24",        name: "i24NEWS English",    flag: "🇮🇱", lang: "EN", region: "mena",     fallbackId: "Z_5YDUlj_CY", handle: "i24NEWSEnglish" },
  { id: "africanews", name: "Africanews",         flag: "🌍", lang: "EN", region: "africa",   fallbackId: "Lgi2y36jb2M", handle: "africanews" },
  // ── European languages ─────────────────────────────────────────────────
  { id: "f24fr",      name: "France 24 (Français)",flag: "🇫🇷", lang: "FR", region: "europe",  fallbackId: "tkDUSYHoKxE" },
  { id: "dwde",       name: "DW (Deutsch)",       flag: "🇩🇪", lang: "DE", region: "europe",   fallbackId: "tQ0yjYUFKAE" },
  { id: "euronews",   name: "Euronews",           flag: "🇪🇺", lang: "EN", region: "europe",   fallbackId: "9Auq9mYxFEE" },
  // ── Latin America ──────────────────────────────────────────────────────
  { id: "globonews",  name: "Globo News",         flag: "🇧🇷", lang: "PT", region: "americas", fallbackId: "U8kkUngclWY" },
  { id: "dwes",       name: "DW (Español)",       flag: "🇪🇸", lang: "ES", region: "americas", fallbackId: "AXC2dGCk9Yw" },
  // ── South Asia ─────────────────────────────────────────────────────────
  { id: "geo",        name: "Geo News",           flag: "🇵🇰", lang: "UR", region: "asia",     handle: "geonews" },
  { id: "ary",        name: "ARY News",           flag: "🇵🇰", lang: "UR", region: "asia",     handle: "arynews" },
  { id: "aajtak",     name: "Aaj Tak",            flag: "🇮🇳", lang: "HI", region: "asia",     fallbackId: "Nq2wYlWFucg" },
];

const REGIONS = [
  { id: "all",      label: "All",      icon: Globe },
  { id: "global",   label: "Global" },
  { id: "americas", label: "Americas" },
  { id: "europe",   label: "Europe" },
  { id: "asia",     label: "Asia" },
  { id: "mena",     label: "MENA" },
  { id: "africa",   label: "Africa" },
];

const LANGUAGES = ["All", "EN", "ES", "FR", "DE", "PT", "AR", "HI", "UR"];

/* ─── API ────────────────────────────────────────────────────────────────── */
async function fetchLiveIds() {
  try {
    const { data } = await axios.get("/api/live-stream");
    // Backend returns { success: true, streams: { id: videoId, … } }
    const map = {};
    const streams = data?.streams || {};
    for (const [id, videoId] of Object.entries(streams)) {
      if (videoId) map[id] = videoId;
    }
    return map;
  } catch {
    return {};
  }
}

export default function LiveTvPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [region, setRegion] = useState("all");
  const [lang, setLang]     = useState("All");
  const [muted, setMuted]   = useState(true);

  // Active channel from ?ch= query param (so URL is shareable)
  const activeId = searchParams.get("ch") || "bbc";

  const { data: liveMap = {}, isLoading } = useQuery({
    queryKey: ["live-stream-map"],
    queryFn: fetchLiveIds,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000, // refresh every 10 min in case stream rotates
  });

  // Resolve the active channel's video ID — prefer live API result, fall back
  // to hardcoded video ID, fall back further to channel handle search.
  const activeChannel = CHANNELS.find(c => c.id === activeId) || CHANNELS[0];
  const videoId = liveMap[activeChannel.id] || activeChannel.fallbackId || null;

  const filteredChannels = useMemo(() => {
    return CHANNELS.filter(c =>
      (region === "all" || c.region === region) &&
      (lang === "All" || c.lang === lang)
    );
  }, [region, lang]);

  const setActiveChannel = (id) => {
    setSearchParams({ ch: id }, { replace: false });
  };

  // SEO meta
  useEffect(() => {
    const prev = document.title;
    document.title = `Live TV — ${activeChannel.name} — Scoopfeeds`;
    return () => { document.title = prev; };
  }, [activeChannel.name]);

  const embedUrl = videoId
    ? `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&mute=${muted ? 1 : 0}&modestbranding=1&playsinline=1&rel=0`
    : null;

  return (
    <div className="space-y-6">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-red-500">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            Live
          </span>
          <span className="text-xs text-[var(--color-text-tertiary)]">·  {filteredChannels.length} channels available</span>
        </div>
        <h1
          className="text-3xl sm:text-4xl font-bold tracking-tight"
          style={{ fontFamily: "'Playfair Display', serif", fontStyle: "italic" }}
        >
          Live TV
        </h1>
        <p className="text-sm text-[var(--color-text-tertiary)] mt-1">
          Free 24/7 news streams from publishers around the world. Click any channel to switch.
        </p>
      </div>

      {/* ── Two-column layout: player + channel grid ─────────────── */}
      <div className="lg:grid lg:grid-cols-[1fr_320px] lg:gap-6">

        {/* ── Player + controls ───────────────────────────────────── */}
        <div className="space-y-3">
          <div className="relative aspect-video w-full rounded-xl overflow-hidden bg-black border border-[var(--color-border)]">
            {isLoading ? (
              <div className="absolute inset-0 flex items-center justify-center text-white/70">
                <Loader2 size={28} className="animate-spin" />
              </div>
            ) : embedUrl ? (
              <iframe
                key={`${activeChannel.id}-${videoId}`}
                src={embedUrl}
                title={`${activeChannel.name} — live`}
                className="absolute inset-0 w-full h-full"
                allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                referrerPolicy="strict-origin-when-cross-origin"
                allowFullScreen
              />
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/70 text-center px-6">
                <AlertCircle size={28} />
                <p className="text-sm font-semibold">Stream temporarily unavailable</p>
                <p className="text-xs opacity-70">{activeChannel.name} isn't broadcasting right now. Pick another channel.</p>
              </div>
            )}
          </div>

          {/* Now-playing strip */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <span className="text-2xl shrink-0" aria-hidden="true">{activeChannel.flag}</span>
              <div className="min-w-0">
                <p className="font-semibold text-[var(--color-text)] truncate">{activeChannel.name}</p>
                <p className="text-xs text-[var(--color-text-tertiary)]">
                  Now playing · {activeChannel.lang} · {activeChannel.region}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setMuted(m => !m)}
                className="p-2 rounded-full hover:bg-[var(--color-surface2)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors"
                aria-label={muted ? "Unmute" : "Mute"}
                title={muted ? "Unmute" : "Mute"}
              >
                {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
              </button>
              {activeChannel.handle && (
                <a
                  href={`https://www.youtube.com/@${activeChannel.handle}/live`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2 rounded-full hover:bg-[var(--color-surface2)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors"
                  aria-label="Open on YouTube"
                  title="Open on YouTube"
                >
                  <Maximize2 size={16} />
                </a>
              )}
            </div>
          </div>

          {muted && (
            <div className="text-xs text-[var(--color-text-tertiary)] bg-[var(--color-surface2)] rounded-lg px-3 py-2">
              🔇 Muted — browsers block autoplay with sound. Tap the speaker icon above to unmute.
            </div>
          )}
        </div>

        {/* ── Channel grid + filters ─────────────────────────────── */}
        <aside className="mt-6 lg:mt-0">
          {/* Filters */}
          <div className="space-y-3 mb-4">
            <div className="flex flex-wrap gap-1.5">
              {REGIONS.map(r => (
                <button
                  key={r.id}
                  onClick={() => setRegion(r.id)}
                  className={clsx(
                    "px-3 py-1 rounded-full text-xs font-medium transition-colors",
                    region === r.id
                      ? "bg-cobalt-600 text-white"
                      : "bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface2)] border border-[var(--color-border)]"
                  )}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {LANGUAGES.map(l => (
                <button
                  key={l}
                  onClick={() => setLang(l)}
                  className={clsx(
                    "px-2.5 py-0.5 rounded-full text-[11px] font-bold tracking-wider uppercase transition-colors",
                    lang === l
                      ? "bg-[var(--color-text)] text-[var(--color-bg)]"
                      : "bg-[var(--color-surface)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text)] border border-[var(--color-border)]"
                  )}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>

          {/* Channel list */}
          <div className="space-y-1 max-h-[60vh] overflow-y-auto pr-1">
            {filteredChannels.map(ch => {
              const isActive = ch.id === activeChannel.id;
              const hasLive  = !!liveMap[ch.id] || !!ch.fallbackId;
              return (
                <motion.button
                  key={ch.id}
                  whileHover={{ x: 2 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setActiveChannel(ch.id)}
                  className={clsx(
                    "w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left transition-colors",
                    isActive
                      ? "bg-cobalt-50 dark:bg-cobalt-950/40 border border-cobalt-200 dark:border-cobalt-800"
                      : "border border-transparent hover:bg-[var(--color-surface)]"
                  )}
                >
                  <span className="text-xl shrink-0" aria-hidden="true">{ch.flag}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className={clsx(
                        "text-sm font-semibold truncate",
                        isActive ? "text-cobalt-700 dark:text-cobalt-300" : "text-[var(--color-text)]"
                      )}>
                        {ch.name}
                      </p>
                      {hasLive && (
                        <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" title="Live" />
                      )}
                    </div>
                    <p className="text-[11px] text-[var(--color-text-tertiary)] uppercase tracking-wider">
                      {ch.lang} · {ch.region}
                    </p>
                  </div>
                </motion.button>
              );
            })}
            {filteredChannels.length === 0 && (
              <div className="text-center py-8 text-sm text-[var(--color-text-tertiary)]">
                No channels match these filters.
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
