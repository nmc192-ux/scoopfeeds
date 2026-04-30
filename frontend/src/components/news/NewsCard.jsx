import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bookmark, BookmarkCheck, ExternalLink, Clock, Share2, Copy, Check } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useNewsStore } from "../../store/newsStore";
import { useTranslatedTexts } from "../../hooks/useTranslation";
import { useReaderStore } from "../../hooks/useReader";
import { useSaveArticle } from "../../hooks/useSaveArticle";
import { track, trackShare, trackSave, trackUnsave, trackOutboundClick } from "../../lib/track";
import PaywallCTA from "../ads/PaywallCTA";
import { topicColor, topicLabel, topicEmoji, COBALT_PRIMARY } from "../../lib/topicColors";
import clsx from "clsx";

// Append scoopfeeds-visible UTM so clicks from shared posts land with a source
// marker the frontend/GA4 can attribute. Share URLs point at scoopfeeds.com
// (our own SSR article page), not at the original source — so UTMs here
// don't leak to publishers.
function withShareUtm(url, network) {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}utm_source=share_${network}&utm_medium=social&utm_campaign=scoop`;
}

function formatTime(timestamp) {
  try { return formatDistanceToNow(new Date(timestamp), { addSuffix: true }); }
  catch { return "recently"; }
}

function CredibilityDots({ score }) {
  return (
    <div className="flex gap-0.5" title={`Credibility: ${score}/10`}>
      {[...Array(5)].map((_, i) => (
        <div key={i} className={clsx(
          "w-1.5 h-1.5 rounded-full",
          i < Math.ceil(score / 2) ? "bg-brand-green" : "bg-[var(--color-border)]"
        )} />
      ))}
    </div>
  );
}

export default function NewsCard({ article, index = 0, size = "normal" }) {
  const { toggle: toggleSave, isSaved } = useSaveArticle();
  const openReader = useReaderStore(s => s.openReader);
  const saved = isSaved(article.id);
  const [imgError, setImgError] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [copied, setCopied] = useState(false);
  const shareUrl = `${typeof window !== "undefined" ? window.location.origin : "https://scoopfeeds.com"}/article/${article.id}`;

  const color = topicColor(article.category);
  const label = topicLabel(article.category);
  const emoji = topicEmoji(article.category);
  const isRecent = Date.now() - article.published_at < 3 * 60 * 60 * 1000;

  // Translation — source lang defaults to article's own language (so e.g.
  // German feeds stay German when user is on Auto, but translate when user
  // picks English).
  const textsToTranslate = [article.title || "", article.description || ""];
  const { texts: translatedTexts, isUrdu } = useTranslatedTexts(
    textsToTranslate, article.language || "en"
  );
  const displayTitle = translatedTexts[0] || article.title;
  const displayDesc  = translatedTexts[1] || article.description;

  const handleSave = (e) => {
    e.preventDefault(); e.stopPropagation();
    toggleSave(article);
    if (saved) {
      trackUnsave(article.id, article.category);
    } else {
      trackSave(article.id, article.category);
    }
  };

  const handleShare = (e) => {
    e.preventDefault(); e.stopPropagation();
    setShowShare(s => !s);
  };

  const shareVia = (platform) => (e) => {
    e.preventDefault(); e.stopPropagation();
    const shareUrlWithUtm = withShareUtm(shareUrl, platform);
    const text = encodeURIComponent(article.title);
    const url = encodeURIComponent(shareUrlWithUtm);
    const targets = {
      x:        `https://twitter.com/intent/tweet?text=${text}&url=${url}`,
      whatsapp: `https://wa.me/?text=${text}%20${url}`,
      facebook: `https://www.facebook.com/sharer/sharer.php?u=${url}`,
      linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${url}`,
    };
    trackShare(article.id, platform);
    if (platform === "copy") {
      navigator.clipboard.writeText(shareUrlWithUtm);
      setCopied(true);
      setTimeout(() => { setCopied(false); setShowShare(false); }, 1500);
    } else if (platform === "native" && navigator.share) {
      navigator.share({ title: article.title, url: shareUrlWithUtm }).catch(() => {});
      setShowShare(false);
    } else {
      window.open(targets[platform], "_blank", "noopener,noreferrer,width=600,height=500");
      setShowShare(false);
    }
  };

  return (
    <motion.article
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.05, 0.5), duration: 0.4, ease: "easeOut" }}
      className={clsx("card card-hover group relative", size === "large" && "sm:col-span-2")}
    >
      <a
        href={article.url}
        onClick={(e) => {
          // If user cmd/ctrl/middle-clicks or holds shift, let the browser open the source URL.
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) {
            trackOutboundClick(article.id, article.category, article.url);
            return;
          }
          e.preventDefault();
          track("reader_open", { articleId: article.id, category: article.category });
          openReader(article);
        }}
        target="_blank" rel="noopener noreferrer" className="block">
        {/* Image */}
        {article.image_url && !imgError ? (
          <div className={clsx("relative overflow-hidden bg-[var(--color-surface2)]", size === "large" ? "h-56 sm:h-72" : "h-44")}>
            <img
              src={article.image_url} alt={article.title} loading="lazy"
              onError={() => setImgError(true)}
              className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
            <div className="absolute top-3 left-3">
              <span className="topic-pill text-white text-xs px-2.5 py-1 shadow-lg" style={{ backgroundColor: color }}>
                {label}
              </span>
            </div>
            {isRecent && (
              <div className="absolute top-3 right-3">
                <span className="breaking-badge">New</span>
              </div>
            )}
          </div>
        ) : (
          <div
            className={clsx("relative flex items-center justify-center", size === "large" ? "h-32" : "h-28")}
            style={{ background: `linear-gradient(135deg, ${color}22, ${color}44)` }}
          >
            <span className="text-4xl opacity-60">{emoji}</span>
            <div className="absolute top-3 left-3">
              <span className="topic-pill text-white text-xs px-2.5 py-1 shadow" style={{ backgroundColor: color }}>
                {label}
              </span>
            </div>
          </div>
        )}

        {/* Content */}
        <div className={clsx("p-4", isUrdu && "text-right")}>
          {/* Source + Time */}
          <div className={clsx("flex items-center justify-between mb-2", isUrdu && "flex-row-reverse")}>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-[var(--color-text-secondary)]">
                {article.source_name}
              </span>
              <CredibilityDots score={article.credibility} />
              <PaywallCTA sourceName={article.source_name} />
            </div>
            <div className="flex items-center gap-1 text-xs text-[var(--color-text-tertiary)]">
              <Clock size={10} />
              <span>{formatTime(article.published_at)}</span>
            </div>
          </div>

          {/* Title */}
          <h3 className={clsx(
            "font-semibold text-[var(--color-text)] leading-snug mb-2 truncate-title",
            size === "large" ? "text-xl" : "text-base",
            isUrdu && "urdu-text"
          )}>
            {displayTitle}
          </h3>

          {/* Description */}
          {article.description && (
            <p className={clsx(
              "text-sm text-[var(--color-text-secondary)] line-clamp-2 leading-relaxed",
              isUrdu && "urdu-text"
            )}>
              {displayDesc}
            </p>
          )}

          {/* Author */}
          {article.author && !isUrdu && (
            <p className="text-xs text-[var(--color-text-tertiary)] mt-2 truncate">
              By {article.author}
            </p>
          )}
        </div>
      </a>

      {/* Action Bar */}
      <div className="px-4 pb-3 flex items-center justify-between border-t border-[var(--color-border)] pt-2.5">
        <div className="flex items-center gap-1">
          <motion.button
            whileTap={{ scale: 0.85 }} onClick={handleSave}
            className={clsx(
              "p-1.5 rounded-lg transition-colors",
              saved ? "text-cobalt-600 bg-cobalt-50" : "text-[var(--color-text-tertiary)] hover:text-cobalt-600 hover:bg-cobalt-50"
            )}
            title={saved ? "Remove bookmark" : "Bookmark"}
          >
            {saved ? <BookmarkCheck size={14} /> : <Bookmark size={14} />}
          </motion.button>

          <div className="relative">
            <motion.button
              whileTap={{ scale: 0.85 }} onClick={handleShare}
              className="p-1.5 rounded-lg text-[var(--color-text-tertiary)] hover:text-cobalt-600 hover:bg-cobalt-50 transition-colors"
              title="Share"
            >
              <Share2 size={14} />
            </motion.button>
            <AnimatePresence>
              {showShare && (
                <>
                  <div className="fixed inset-0 z-30" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowShare(false); }} />
                  <motion.div
                    initial={{ opacity: 0, y: 5, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
                    className="absolute bottom-full left-0 mb-2 z-40 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl shadow-xl p-1 flex items-center gap-0.5"
                  >
                    <button onClick={shareVia("x")} title="Share on X" className="w-8 h-8 rounded-lg hover:bg-[var(--color-surface2)] flex items-center justify-center text-[var(--color-text)]">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                    </button>
                    <button onClick={shareVia("whatsapp")} title="WhatsApp" className="w-8 h-8 rounded-lg hover:bg-[var(--color-surface2)] flex items-center justify-center text-[#25D366]">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                    </button>
                    <button onClick={shareVia("facebook")} title="Facebook" className="w-8 h-8 rounded-lg hover:bg-[var(--color-surface2)] flex items-center justify-center text-[#1877F2]">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
                    </button>
                    <button onClick={shareVia("copy")} title="Copy link" className="w-8 h-8 rounded-lg hover:bg-[var(--color-surface2)] flex items-center justify-center text-[var(--color-text-secondary)]">
                      {copied ? <Check size={14} className="text-brand-green" /> : <Copy size={14} />}
                    </button>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
        </div>

        <a
          href={article.url} target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-1 text-xs font-medium text-cobalt-600 hover:text-brand-indigo transition-colors"
          onClick={(e) => {
            e.stopPropagation();
            trackOutboundClick(article.id, article.category, article.url);
          }}
        >
          {isUrdu ? "پڑھیں" : "Read"} <ExternalLink size={11} />
        </a>
      </div>
    </motion.article>
  );
}
