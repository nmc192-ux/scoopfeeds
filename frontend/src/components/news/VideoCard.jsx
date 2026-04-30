import { useState } from "react";
import { motion } from "framer-motion";
import { Play, Youtube, Clock, ExternalLink } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { topicColor } from "../../lib/topicColors";
import clsx from "clsx";

export default function VideoCard({ video, index = 0, onPlay, size = "normal" }) {
  const [thumbError, setThumbError] = useState(false);
  const color = topicColor(video.category);
  const thumbUrl = video.thumbnail || `https://img.youtube.com/vi/${video.video_id}/hqdefault.jpg`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.06, 0.4), duration: 0.35 }}
      className={clsx(
        "card card-hover group cursor-pointer",
        size === "wide" && "flex gap-0"
      )}
      onClick={() => onPlay?.(video)}
    >
      {/* Thumbnail */}
      <div className={clsx(
        "relative overflow-hidden bg-black flex-shrink-0",
        size === "wide" ? "w-40 h-28 rounded-l-2xl rounded-r-none" : "rounded-t-2xl",
        size !== "wide" && "aspect-video"
      )}>
        {!thumbError ? (
          <img
            src={thumbUrl}
            alt={video.title}
            loading="lazy"
            onError={() => setThumbError(true)}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gray-900">
            <Youtube size={32} className="text-red-600 opacity-60" />
          </div>
        )}

        {/* Play overlay */}
        <div className="absolute inset-0 bg-black/30 flex flex-col items-center justify-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
          <motion.div
            whileHover={{ scale: 1.1 }}
            className="w-12 h-12 bg-red-600/90 rounded-full flex items-center justify-center shadow-xl"
          >
            <Play size={18} fill="white" className="text-white ml-0.5" />
          </motion.div>
          <span className="text-white text-xs font-semibold bg-black/50 px-2.5 py-0.5 rounded-full tracking-wide">
            ▶ Play in Scoop
          </span>
        </div>

        {/* Always-visible play button (subtle) */}
        <div className="absolute bottom-2 right-2 w-8 h-8 bg-black/70 rounded-full flex items-center justify-center group-hover:opacity-0 transition-opacity">
          <Play size={12} fill="white" className="text-white ml-0.5" />
        </div>

        {/* Category badge */}
        <div className="absolute top-2 left-2">
          <span
            className="text-xs font-bold px-2 py-0.5 rounded text-white"
            style={{ backgroundColor: color + "cc" }}
          >
            {video.category?.replace(/-/g, " ")}
          </span>
        </div>

        {/* YouTube logo */}
        <div className="absolute top-2 right-2 bg-red-600 rounded px-1.5 py-0.5 flex items-center gap-1">
          <Youtube size={10} className="text-white" />
          <span className="text-white text-[10px] font-bold">YT</span>
        </div>
      </div>

      {/* Content */}
      <div className={clsx("p-3 flex flex-col", size === "wide" && "flex-1 min-w-0")}>
        <h4 className={clsx(
          "font-semibold text-[var(--color-text)] leading-snug line-clamp-2 group-hover:text-cobalt-600 transition-colors",
          size === "wide" ? "text-sm" : "text-sm"
        )}>
          {video.title}
        </h4>

        <div className="mt-2 flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs text-[var(--color-text-tertiary)]">
            <div className="w-4 h-4 bg-red-600 rounded-full flex items-center justify-center flex-shrink-0">
              <Youtube size={8} className="text-white" />
            </div>
            <span className="truncate max-w-[100px] font-medium text-[var(--color-text-secondary)]">
              {video.channel_name}
            </span>
          </div>
          <span className="text-xs text-[var(--color-text-tertiary)] flex items-center gap-1 flex-shrink-0">
            <Clock size={10} />
            {formatDistanceToNow(new Date(video.published_at), { addSuffix: true })}
          </span>
        </div>

        {size !== "wide" && video.description && (
          <p className="text-xs text-[var(--color-text-tertiary)] mt-1.5 line-clamp-2 leading-relaxed">
            {video.description}
          </p>
        )}
      </div>
    </motion.div>
  );
}
