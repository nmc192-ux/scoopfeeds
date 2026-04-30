import { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Youtube, Play, Heart, Smartphone, ChevronLeft, ChevronRight,
  X as XIcon, Tv2, Flame,
} from "lucide-react";
import VideoCard from "./VideoCard";
import VideoModal from "./VideoModal";
import { useVideos, useAllVideos } from "../../hooks/useVideos";
import { useNewsStore } from "../../store/newsStore";
import clsx from "clsx";

/* ─── Tab config ─────────────────────────────────────────────────────────── */
const TABS = [
  { id: "all",       label: "For You",     Icon: Tv2        },
  { id: "following", label: "My Channels", Icon: Heart      },
  { id: "shorts",    label: "Shorts",      Icon: Smartphone },
];

/* ─── Skeleton loaders ────────────────────────────────────────────────────── */
function GridSkeleton({ count = 8 }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card animate-pulse">
          <div className="shimmer-bg aspect-video rounded-t-2xl" />
          <div className="p-3 space-y-2">
            <div className="shimmer-bg h-3.5 rounded w-full" />
            <div className="shimmer-bg h-3.5 rounded w-3/4" />
            <div className="shimmer-bg h-3 rounded w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

function ShortsSkeleton({ count = 8 }) {
  return (
    <div className="flex gap-3 overflow-x-auto hide-scrollbar">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="shimmer-bg rounded-2xl animate-pulse flex-shrink-0"
          style={{ width: "140px", aspectRatio: "9/16" }}
        />
      ))}
    </div>
  );
}

/* ─── Channel chip ────────────────────────────────────────────────────────── */
function ChannelChip({ name, isFollowed, onToggle, isActive, onSelect }) {
  return (
    <div
      className={clsx(
        "flex items-center rounded-full border text-xs font-medium whitespace-nowrap transition-all duration-200 overflow-hidden flex-shrink-0",
        isActive
          ? "bg-[var(--color-text)] text-[var(--color-bg)] border-transparent"
          : "bg-[var(--color-surface)] border-[var(--color-border)] text-[var(--color-text-secondary)]"
      )}
    >
      <button
        onClick={() => onSelect(name)}
        className="px-3 py-1.5 hover:opacity-75 transition-opacity"
      >
        {name}
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); onToggle(name); }}
        className={clsx(
          "pr-2.5 py-1.5 transition-colors",
          isFollowed
            ? "text-scoop-orange-500"
            : "text-[var(--color-text-tertiary)] hover:text-scoop-orange-400"
        )}
        title={isFollowed ? "Unfollow" : "Follow channel"}
      >
        <Heart size={11} fill={isFollowed ? "currentColor" : "none"} />
      </button>
    </div>
  );
}

/* ─── Channel row (My Channels tab) ──────────────────────────────────────── */
function ChannelRow({ channelName, videos, onPlay, onUnfollow }) {
  const scrollRef = useRef(null);
  const scroll = (dir) => scrollRef.current?.scrollBy({ left: dir * 280, behavior: "smooth" });

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 bg-red-600 rounded-full flex items-center justify-center flex-shrink-0">
            <Youtube size={12} className="text-white" />
          </div>
          <h3 className="text-sm font-bold text-[var(--color-text)]">{channelName}</h3>
          <span className="text-xs text-[var(--color-text-tertiary)]">
            {videos.length} video{videos.length !== 1 ? "s" : ""}
          </span>
        </div>
        <button
          onClick={() => onUnfollow(channelName)}
          className="flex items-center gap-1 text-xs text-scoop-orange-500 hover:text-scoop-orange-400 transition-colors"
        >
          <Heart size={11} fill="currentColor" />
          <span>Following</span>
        </button>
      </div>

      <div className="relative group/row">
        <button
          onClick={() => scroll(-1)}
          className="absolute left-0 top-1/2 -translate-y-1/2 z-10 w-8 h-8 rounded-full
                     bg-[var(--color-surface)] border border-[var(--color-border)] shadow-md
                     items-center justify-center hidden group-hover/row:flex -translate-x-3
                     text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"
        >
          <ChevronLeft size={14} />
        </button>

        <div ref={scrollRef} className="flex gap-3 overflow-x-auto hide-scrollbar pb-1">
          {videos.map((video, i) => (
            <div key={video.id} className="flex-shrink-0 w-56">
              <VideoCard video={video} index={i} onPlay={onPlay} />
            </div>
          ))}
        </div>

        <button
          onClick={() => scroll(1)}
          className="absolute right-0 top-1/2 -translate-y-1/2 z-10 w-8 h-8 rounded-full
                     bg-[var(--color-surface)] border border-[var(--color-border)] shadow-md
                     items-center justify-center hidden group-hover/row:flex translate-x-3
                     text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"
        >
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}

/* ─── Shorts card (9:16 vertical) ────────────────────────────────────────── */
function ShortsCard({ video, onPlay }) {
  return (
    <motion.div
      whileHover={{ scale: 1.03, y: -3 }}
      className="card group cursor-pointer flex-shrink-0 overflow-hidden"
      style={{ width: "140px" }}
      onClick={() => onPlay?.(video)}
    >
      <div className="relative" style={{ aspectRatio: "9/16" }}>
        <img
          src={video.thumbnail || `https://img.youtube.com/vi/${video.video_id}/hqdefault.jpg`}
          alt={video.title}
          loading="lazy"
          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
        />
        <div className="absolute inset-0 bg-black/20 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="w-10 h-10 bg-electric-600/90 rounded-full flex items-center justify-center shadow-xl">
            <Play size={16} fill="white" className="text-white ml-0.5" />
          </div>
        </div>
        <div className="absolute top-2 left-2">
          <span className="bg-electric-600 text-white text-[9px] font-bold px-1.5 py-0.5 rounded leading-none">
            SHORTS
          </span>
        </div>
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent p-2 pt-6">
          <p className="text-white text-[10px] font-semibold line-clamp-2 leading-tight">
            {video.title}
          </p>
          <p className="text-white/50 text-[9px] mt-0.5 truncate">{video.channel_name}</p>
        </div>
      </div>
    </motion.div>
  );
}

/* ─── Empty "My Channels" state ──────────────────────────────────────────── */
function EmptyFollowing() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center gap-4 py-14 text-center px-4"
    >
      <div className="w-14 h-14 bg-scoop-orange-500/10 rounded-2xl flex items-center justify-center">
        <Heart size={26} className="text-scoop-orange-500" strokeWidth={1.5} />
      </div>
      <div>
        <p className="text-sm font-semibold text-[var(--color-text)] mb-1">
          No channels followed yet
        </p>
        <p className="text-xs text-[var(--color-text-tertiary)] max-w-xs mx-auto leading-relaxed">
          Tap the <Heart size={10} className="inline text-scoop-orange-400" fill="currentColor" /> next to
          any channel name to follow it — their latest videos will appear here
        </p>
      </div>
    </motion.div>
  );
}

/* ─── Main VideoSection ───────────────────────────────────────────────────── */
export default function VideoSection() {
  const { data: topicVideos = [], isLoading: topicLoading } = useVideos();
  const { data: allVideos   = [], isLoading: allLoading   } = useAllVideos(60);
  const { followedChannels, toggleFollowChannel } = useNewsStore();

  const [activeVideo,     setActiveVideo]     = useState(null);
  const [activeTab,       setActiveTab]       = useState("all");
  const [categoryFilter,  setCategoryFilter]  = useState("all");
  const [selectedChannel, setSelectedChannel] = useState(null);
  const [isExpanded,      setIsExpanded]      = useState(false);

  const isLoading = topicLoading || allLoading;

  // All unique channels sorted alphabetically
  const allChannels = [...new Set(allVideos.map(v => v.channel_name).filter(Boolean))].sort();

  // ── "For You" content ─────────────────────────────────────────────────
  // Use topic-filtered videos when available; fall back to all videos
  const forYouBase = topicVideos.length > 0 ? topicVideos : allVideos;
  const forYouVideos = selectedChannel
    ? allVideos.filter(v => v.channel_name === selectedChannel)
    : categoryFilter === "all"
      ? forYouBase
      : forYouBase.filter(v => v.category === categoryFilter);

  // Categories always derived from full video set for complete filter options
  const categories = ["all", ...new Set(allVideos.map(v => v.category).filter(Boolean))];

  // ── "My Channels" content ─────────────────────────────────────────────
  const videosByChannel = followedChannels.reduce((acc, ch) => {
    const vids = allVideos.filter(v => v.channel_name === ch);
    if (vids.length > 0) acc[ch] = vids;
    return acc;
  }, {});

  // ── "Shorts" content ──────────────────────────────────────────────────
  const shortsVideos = allVideos.filter(v =>
    v.title?.toLowerCase().includes("#shorts") ||
    v.title?.toLowerCase().includes("shorts")  ||
    v.description?.toLowerCase().includes("#shorts")
  );
  const shortsDisplay = shortsVideos.length >= 5 ? shortsVideos : allVideos.slice(0, 20);

  const totalCount = allVideos.length || topicVideos.length;

  if (!isLoading && topicVideos.length === 0 && allVideos.length === 0) return null;

  const handleTabChange = (id) => {
    setActiveTab(id);
    setSelectedChannel(null);
    setCategoryFilter("all");
    setIsExpanded(false);
  };

  return (
    <section className="mb-8">

      {/* ── Section header ────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 bg-red-600 rounded-xl flex items-center justify-center shadow-md flex-shrink-0">
            <Youtube size={18} className="text-white" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-[var(--color-text)] leading-tight">YouTube</h2>
            <p className="text-xs text-[var(--color-text-tertiary)] leading-tight">
              {totalCount} videos · {allChannels.length} channels
            </p>
          </div>
        </div>

        {followedChannels.length > 0 && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex items-center gap-1.5 text-xs text-[var(--color-text-tertiary)]"
          >
            <Heart size={11} className="text-scoop-orange-500" fill="currentColor" />
            <span>{followedChannels.length} following</span>
          </motion.div>
        )}
      </div>

      {/* ── Tabs ──────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 mb-4">
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => handleTabChange(id)}
            className={clsx(
              "flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all duration-200 border",
              activeTab === id
                ? "bg-electric-600 text-white shadow-md border-transparent"
                : "bg-[var(--color-surface)] border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface2)]"
            )}
          >
            <Icon size={13} />
            {label}
            {id === "following" && followedChannels.length > 0 && (
              <span className={clsx(
                "ml-0.5 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center",
                activeTab === id ? "bg-white/25 text-white" : "bg-electric-50 text-electric-600"
              )}>
                {followedChannels.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Channel browser — "For You" tab ──────────────────────────── */}
      {activeTab === "all" && allChannels.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-4"
        >
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] font-bold text-[var(--color-text-tertiary)] uppercase tracking-wider">
              Channels
            </span>
            {selectedChannel && (
              <button
                onClick={() => setSelectedChannel(null)}
                className="flex items-center gap-0.5 text-[10px] text-[var(--color-text-tertiary)] hover:text-[var(--color-text)] transition-colors"
              >
                <XIcon size={9} /> Clear
              </button>
            )}
          </div>
          <div className="flex gap-2 overflow-x-auto hide-scrollbar pb-1">
            {allChannels.map(ch => (
              <ChannelChip
                key={ch}
                name={ch}
                isFollowed={followedChannels.includes(ch)}
                onToggle={toggleFollowChannel}
                isActive={selectedChannel === ch}
                onSelect={(name) => setSelectedChannel(selectedChannel === name ? null : name)}
              />
            ))}
          </div>
        </motion.div>
      )}

      {/* ── Content ───────────────────────────────────────────────────── */}
      <AnimatePresence mode="wait">

        {/* ── For You tab ── */}
        {activeTab === "all" && (
          <motion.div
            key="all"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {/* Category filter — hidden when a specific channel is selected */}
            {!selectedChannel && (
              <div className="flex gap-2 overflow-x-auto hide-scrollbar mb-4 pb-1">
                {categories.map(cat => (
                  <button
                    key={cat}
                    onClick={() => setCategoryFilter(cat)}
                    className={clsx(
                      "flex items-center gap-1 text-xs px-3 py-1.5 rounded-full font-medium whitespace-nowrap transition-all flex-shrink-0",
                      categoryFilter === cat
                        ? "bg-electric-600 text-white shadow-sm"
                        : "bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface2)]"
                    )}
                  >
                    {cat === "all" && <Flame size={10} />}
                    {cat === "all" ? "All" : cat.replace(/-/g, " ")}
                  </button>
                ))}
              </div>
            )}

            {/* Selected channel header */}
            {selectedChannel && (
              <div className="mb-3 flex items-center gap-2">
                <div className="w-5 h-5 bg-red-600 rounded-full flex items-center justify-center">
                  <Youtube size={10} className="text-white" />
                </div>
                <span className="text-sm font-bold text-[var(--color-text)]">{selectedChannel}</span>
                <span className="text-xs text-[var(--color-text-tertiary)]">
                  {forYouVideos.length} video{forYouVideos.length !== 1 ? "s" : ""}
                </span>
              </div>
            )}

            {isLoading ? (
              <GridSkeleton count={4} />
            ) : forYouVideos.length === 0 ? (
              <p className="text-center py-10 text-sm text-[var(--color-text-tertiary)]">
                No videos found — try a different filter
              </p>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                  {(isExpanded ? forYouVideos : forYouVideos.slice(0, 4)).map((video, i) => (
                    <VideoCard key={video.id} video={video} index={i} onPlay={setActiveVideo} />
                  ))}
                </div>

                {/* Expand / Collapse button */}
                {forYouVideos.length > 4 && (
                  <div className="flex justify-center mt-5">
                    <button
                      onClick={() => setIsExpanded(v => !v)}
                      className="flex items-center gap-2 px-5 py-2 rounded-full text-sm font-semibold
                                 bg-[var(--color-surface)] border border-[var(--color-border)]
                                 text-[var(--color-text-secondary)] hover:bg-[var(--color-surface2)]
                                 hover:text-[var(--color-text)] transition-all duration-200"
                    >
                      {isExpanded ? (
                        <><ChevronLeft size={14} className="rotate-90" /> Show less</>
                      ) : (
                        <><ChevronRight size={14} className="-rotate-90" /> Show all {forYouVideos.length} videos</>
                      )}
                    </button>
                  </div>
                )}
              </>
            )}
          </motion.div>
        )}

        {/* ── My Channels tab ── */}
        {activeTab === "following" && (
          <motion.div
            key="following"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {/* Channel browser inside My Channels tab */}
            {allChannels.length > 0 && (
              <div className="mb-5">
                <p className="text-[10px] font-bold text-[var(--color-text-tertiary)] uppercase tracking-wider mb-2">
                  All Channels — tap ♡ to follow
                </p>
                <div className="flex gap-2 overflow-x-auto hide-scrollbar pb-1">
                  {allChannels.map(ch => (
                    <ChannelChip
                      key={ch}
                      name={ch}
                      isFollowed={followedChannels.includes(ch)}
                      onToggle={toggleFollowChannel}
                      isActive={false}
                      onSelect={() => {}}
                    />
                  ))}
                </div>
              </div>
            )}

            {followedChannels.length === 0 ? (
              <EmptyFollowing />
            ) : Object.keys(videosByChannel).length === 0 && !isLoading ? (
              <p className="text-center py-8 text-sm text-[var(--color-text-tertiary)]">
                Videos from your channels are loading…
              </p>
            ) : (
              <div>
                {followedChannels
                  .filter(ch => videosByChannel[ch])
                  .map(ch => (
                    <ChannelRow
                      key={ch}
                      channelName={ch}
                      videos={videosByChannel[ch]}
                      onPlay={setActiveVideo}
                      onUnfollow={toggleFollowChannel}
                    />
                  ))}
                {followedChannels.filter(ch => !videosByChannel[ch]).length > 0 && (
                  <p className="text-xs text-[var(--color-text-tertiary)] mt-2">
                    No recent videos yet from:{" "}
                    {followedChannels.filter(ch => !videosByChannel[ch]).join(", ")}
                  </p>
                )}
              </div>
            )}
          </motion.div>
        )}

        {/* ── Shorts tab ── */}
        {activeTab === "shorts" && (
          <motion.div
            key="shorts"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <p className="text-xs text-[var(--color-text-tertiary)] mb-3">
              {shortsVideos.length > 0
                ? `${shortsVideos.length} Shorts · tap to play`
                : `${shortsDisplay.length} recent videos in Shorts format · tap to play`}
            </p>
            {isLoading ? (
              <ShortsSkeleton count={8} />
            ) : (
              <div className="flex gap-3 overflow-x-auto hide-scrollbar pb-2">
                {shortsDisplay.map((video, i) => (
                  <motion.div
                    key={video.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(i * 0.04, 0.3) }}
                  >
                    <ShortsCard video={video} onPlay={setActiveVideo} />
                  </motion.div>
                ))}
              </div>
            )}
          </motion.div>
        )}

      </AnimatePresence>

      {/* ── Video modal ───────────────────────────────────────────────── */}
      <AnimatePresence>
        {activeVideo && (
          <VideoModal video={activeVideo} onClose={() => setActiveVideo(null)} />
        )}
      </AnimatePresence>
    </section>
  );
}
