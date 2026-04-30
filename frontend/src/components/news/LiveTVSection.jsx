import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Tv2, ChevronDown, ChevronUp, ExternalLink, RefreshCw } from "lucide-react";
import { useLiveStreams } from "../../hooks/useLiveStreams";

/* ─── Channel config ─────────────────────────────────────────────────────────
   noEmbed: true  → channel has disabled external YouTube embedding.
                    Show a branded link-card instead of an iframe.
   liveUrl        → where to send the user when they click "Watch Live"
   ────────────────────────────────────────────────────────────────────────── */
const LIVE_CHANNELS = [
  /* ── Embeddable channels ─────────────────────────────────────────────── */
  {
    id:              "aljazeera",
    name:            "Al Jazeera",
    flag:            "🌍",
    color:           "#C8A951",
    fallbackVideoId: "gCNeDWCI0vo",
    ytUrl:           "https://www.youtube.com/@AlJazeeraEnglish/live",
  },
  {
    id:              "bbc",
    name:            "BBC News",
    flag:            "🇬🇧",
    color:           "#BB1919",
    fallbackVideoId: "w_Ma8oQLmSM", // BBC News 24/7 live stream
    channelId:       "UC16niRr50-MSBwiO3YDb3RA",
    ytUrl:           "https://www.youtube.com/@BBCNews/live",
  },
  {
    id:              "skynews",
    name:            "Sky News",
    flag:            "🇬🇧",
    color:           "#E8000D",
    fallbackVideoId: "9Auq9mYxFEE", // Sky News 24/7 live stream
    ytUrl:           "https://www.youtube.com/@SkyNews/live",
  },
  {
    id:              "dw",
    name:            "DW News",
    flag:            "🇩🇪",
    color:           "#0000A0",
    fallbackVideoId: "LuKwFajn37U", // DW News 24/7 live stream
    ytUrl:           "https://www.youtube.com/@DWNews/live",
  },
  {
    id:              "france24",
    name:            "France 24",
    flag:            "🇫🇷",
    color:           "#003F8F",
    fallbackVideoId: "Ap-UM1O9RBU", // France 24 24/7 live stream
    ytUrl:           "https://www.youtube.com/c/FRANCE24English/live",
  },

  /* ── Link-only channels (embedding disabled by the channel) ──────────── */
  {
    id:      "geo",
    name:    "Geo News",
    flag:    "🇵🇰",
    color:   "#009900",
    noEmbed: true,
    liveUrl: "https://www.geo.tv/live/geotv",
    ytUrl:   "https://www.youtube.com/@geonews/live",
    note:    "Opens on geo.tv",
  },
  {
    id:      "ary",
    name:    "ARY News",
    flag:    "🇵🇰",
    color:   "#003399",
    noEmbed: true,
    liveUrl: "https://arynews.tv/live/",
    ytUrl:   "https://www.youtube.com/@arynewspk/live",
    note:    "Opens on arynews.tv",
  },
  {
    id:      "wion",
    name:    "WION",
    flag:    "🌏",
    color:   "#E63946",
    noEmbed: true,
    liveUrl: "https://www.youtube.com/@WION/live",
    ytUrl:   "https://www.youtube.com/@WION/live",
    note:    "Opens on YouTube",
  },
  {
    id:      "bloomberg",
    name:    "Bloomberg",
    flag:    "📈",
    color:   "#1F8EFA",
    noEmbed: true,
    liveUrl: "https://www.bloomberg.com/live",
    ytUrl:   "https://www.youtube.com/@Bloomberg/live",
    note:    "Opens on Bloomberg",
  },
];

const ORIGIN = "https://scoopfeeds.com";
// youtube-nocookie.com works without third-party cookies → no "Watch on YouTube"
// block on desktop browsers with cookie restrictions. enablejsapi not needed.
const EMBED_PARAMS = `autoplay=0&rel=0&modestbranding=1&showinfo=0&origin=${ORIGIN}`;

function getEmbedUrl(ch, liveVideoId) {
  const videoId = liveVideoId || ch.fallbackVideoId;
  if (videoId) {
    return `https://www.youtube-nocookie.com/embed/${videoId}?${EMBED_PARAMS}`;
  }
  // live_stream?channel= is deprecated — return null so we fall to the link card
  return null;
}

/* ─── Pulsing alert dot (live broadcast indicator) ────────────────────────── */
function LiveDot() {
  return (
    <span className="relative inline-flex h-2.5 w-2.5 flex-shrink-0">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: "var(--color-alert)" }} />
      <span className="relative inline-flex rounded-full h-2.5 w-2.5" style={{ background: "var(--color-alert)" }} />
    </span>
  );
}

/* ─── Link-only card (for channels that block embedding) ───────────────────── */
function NoEmbedCard({ ch }) {
  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ background: `linear-gradient(135deg, ${ch.color}28, ${ch.color}10)`, border: `1px solid ${ch.color}33` }}
    >
      <div className="flex flex-col items-center justify-center gap-4 py-14 px-6 text-center">
        <span className="text-6xl">{ch.flag}</span>
        <div>
          <p className="text-lg font-bold text-[var(--color-text)] mb-1">{ch.name} Live</p>
          <p className="text-sm text-[var(--color-text-tertiary)] mb-5">
            Live stream available on the channel's website
          </p>
          <div className="flex items-center justify-center gap-3 flex-wrap">
            <a
              href={ch.liveUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-bold text-white transition-opacity hover:opacity-90 shadow-md"
              style={{ backgroundColor: ch.color }}
            >
              <LiveDot />
              Watch Live
              <ExternalLink size={13} />
            </a>
            {ch.liveUrl !== ch.ytUrl && (
              <a
                href={ch.ytUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-semibold border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface2)] transition-colors"
              >
                YouTube <ExternalLink size={12} />
              </a>
            )}
          </div>
          <p className="text-[11px] text-[var(--color-text-tertiary)] mt-3 opacity-70">{ch.note}</p>
        </div>
      </div>
    </div>
  );
}

/* ─── Main component ─────────────────────────────────────────────────────────── */
export default function LiveTVSection() {
  const [isOpen,     setIsOpen]     = useState(true);
  const [activeId,   setActiveId]   = useState(LIVE_CHANNELS[0].id);
  const [loadFailed, setLoadFailed] = useState({});

  const { streams } = useLiveStreams();

  const activeChannel = LIVE_CHANNELS.find(c => c.id === activeId) || LIVE_CHANNELS[0];
  const embedUrl      = (!activeChannel.noEmbed)
    ? getEmbedUrl(activeChannel, streams[activeChannel.id])
    : null;

  const handleChannelChange = (id) => {
    setActiveId(id);
    setLoadFailed(prev => ({ ...prev, [id]: false }));
  };

  const embedChannels = LIVE_CHANNELS.filter(c => !c.noEmbed).length;

  return (
    <section className="mb-8">
      {/* ── Section header ────────────────────────────────────────────── */}
      <div
        className="flex items-center justify-between mb-4 cursor-pointer select-none"
        onClick={() => setIsOpen(v => !v)}
      >
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 bg-gray-900 dark:bg-gray-800 rounded-xl flex items-center justify-center shadow-md flex-shrink-0 border border-[var(--color-border)]">
            <Tv2 size={18} className="text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-[var(--color-text)] leading-tight">Live TV</h2>
              <LiveDot />
            </div>
            <p className="text-xs text-[var(--color-text-tertiary)] leading-tight">
              {LIVE_CHANNELS.length} channels · {embedChannels} embeddable
            </p>
          </div>
        </div>
        <button className="p-1.5 rounded-full hover:bg-[var(--color-surface2)] text-[var(--color-text-tertiary)] transition-colors">
          {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
      </div>

      {/* ── Collapsible body ──────────────────────────────────────────── */}
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            key="livetv-body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            {/* Channel selector tabs */}
            <div className="flex gap-2 overflow-x-auto hide-scrollbar mb-4 pb-1">
              {LIVE_CHANNELS.map(ch => (
                <button
                  key={ch.id}
                  onClick={() => handleChannelChange(ch.id)}
                  className={`
                    flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold
                    whitespace-nowrap flex-shrink-0 transition-all duration-200 border
                    ${activeId === ch.id
                      ? "text-white shadow-md border-transparent"
                      : "bg-[var(--color-surface)] border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface2)]"
                    }
                  `}
                  style={activeId === ch.id ? { backgroundColor: ch.color } : {}}
                >
                  <span>{ch.flag}</span>
                  {ch.name}
                  {ch.noEmbed && (
                    <ExternalLink size={11} className="opacity-60 ml-0.5" />
                  )}
                </button>
              ))}
            </div>

            {/* Player / Link card */}
            <motion.div
              key={activeId}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              {(activeChannel.noEmbed || !embedUrl) ? (
                <NoEmbedCard ch={activeChannel} />
              ) : !loadFailed[activeId] ? (
                <div className="card overflow-hidden">
                  <div className="relative bg-black" style={{ paddingTop: "56.25%" }}>
                    <iframe
                      key={embedUrl}
                      className="absolute inset-0 w-full h-full"
                      src={embedUrl}
                      title={`${activeChannel.name} Live`}
                      frameBorder="0"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                      allowFullScreen
                      onError={() => setLoadFailed(prev => ({ ...prev, [activeId]: true }))}
                    />
                    <div className="absolute top-3 left-3 flex items-center gap-2 pointer-events-none">
                      <span
                        className="text-white text-xs font-bold px-2.5 py-1 rounded-full backdrop-blur-sm"
                        style={{ backgroundColor: activeChannel.color + "cc" }}
                      >
                        {activeChannel.flag} {activeChannel.name}
                      </span>
                      <span className="flex items-center gap-1 text-white text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider backdrop-blur-sm" style={{ background: "color-mix(in srgb, var(--color-alert) 90%, transparent)" }}>
                        <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                        Live
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--color-border)]">
                    <div className="flex items-center gap-2">
                      <LiveDot />
                      <span className="text-sm font-semibold text-[var(--color-text)]">{activeChannel.name}</span>
                      <span className="text-xs text-[var(--color-text-tertiary)]">· Live stream</span>
                    </div>
                    <a
                      href={activeChannel.ytUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-xs font-medium text-cobalt-600 hover:underline"
                    >
                      YouTube <ExternalLink size={11} />
                    </a>
                  </div>
                </div>
              ) : (
                <div className="card overflow-hidden">
                  <div
                    className="flex flex-col items-center justify-center gap-4 py-16"
                    style={{ background: `linear-gradient(135deg, ${activeChannel.color}22, ${activeChannel.color}11)` }}
                  >
                    <span className="text-5xl">{activeChannel.flag}</span>
                    <div className="text-center">
                      <p className="font-semibold text-[var(--color-text)] mb-1">{activeChannel.name} Live</p>
                      <p className="text-sm text-[var(--color-text-tertiary)] mb-4">Stream unavailable in embedded view</p>
                      <div className="flex items-center justify-center gap-3">
                        <button
                          onClick={() => setLoadFailed(prev => ({ ...prev, [activeId]: false }))}
                          className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface2)] transition-colors"
                        >
                          <RefreshCw size={13} /> Retry
                        </button>
                        <a
                          href={activeChannel.ytUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 px-5 py-2 rounded-full text-sm font-semibold text-white transition-opacity hover:opacity-90"
                          style={{ backgroundColor: activeChannel.color }}
                        >
                          Watch on YouTube <ExternalLink size={13} />
                        </a>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
