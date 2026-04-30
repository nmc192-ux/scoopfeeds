import { useState } from "react";
import { motion } from "framer-motion";
import { Play, Youtube, X } from "lucide-react";

function getYouTubeId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/,
    /youtube\.com\/embed\/([^&\n?#]+)/,
    /youtube\.com\/v\/([^&\n?#]+)/,
  ];
  for (const pattern of patterns) {
    const match = url?.match(pattern);
    if (match) return match[1];
  }
  return null;
}

export function YouTubeEmbed({ videoId, title }) {
  const [loaded, setLoaded] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  if (!videoId || dismissed) return null;

  const thumbnailUrl = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
  const embedUrl = `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative rounded-xl overflow-hidden bg-black my-4"
      style={{ paddingTop: "56.25%" }}
    >
      {!loaded ? (
        <div
          className="absolute inset-0 cursor-pointer group"
          onClick={() => setLoaded(true)}
        >
          <img
            src={thumbnailUrl}
            alt={title || "Video"}
            className="w-full h-full object-cover"
            onError={e => { e.target.src = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`; }}
          />
          <div className="absolute inset-0 bg-black/40 flex items-center justify-center group-hover:bg-black/30 transition-colors">
            <motion.div
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.95 }}
              className="w-16 h-16 bg-red-600 rounded-full flex items-center justify-center shadow-2xl"
            >
              <Play size={24} fill="white" className="text-white ml-1" />
            </motion.div>
          </div>
          <div className="absolute top-3 left-3 flex items-center gap-1 bg-red-600 text-white text-xs font-bold px-2 py-1 rounded">
            <Youtube size={12} /> YouTube
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); setDismissed(true); }}
            className="absolute top-3 right-3 p-1.5 rounded-full bg-black/60 text-white hover:bg-black/80"
          >
            <X size={12} />
          </button>
          {title && (
            <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/80 to-transparent">
              <p className="text-white text-sm font-medium line-clamp-2">{title}</p>
            </div>
          )}
        </div>
      ) : (
        <iframe
          className="absolute inset-0 w-full h-full"
          src={embedUrl}
          title={title || "YouTube video"}
          frameBorder="0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      )}
    </motion.div>
  );
}

export function TwitterEmbed({ tweetUrl }) {
  const [dismissed, setDismissed] = useState(false);
  if (!tweetUrl || dismissed) return null;

  // Convert to embed URL
  const embedUrl = tweetUrl.replace("twitter.com", "twitterwidgets.com");

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="relative my-4 p-4 border border-[var(--color-border)] rounded-xl bg-[var(--color-surface2)]"
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 text-sm font-medium text-[var(--color-text-secondary)]">
          <span className="text-[#1DA1F2]">𝕏</span> Related Post
        </div>
        <button
          onClick={() => setDismissed(true)}
          className="text-[var(--color-text-tertiary)] hover:text-[var(--color-text)]"
        >
          <X size={14} />
        </button>
      </div>
      <a
        href={tweetUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="text-cobalt-600 hover:underline text-sm break-all"
      >
        View post on X →
      </a>
    </motion.div>
  );
}
