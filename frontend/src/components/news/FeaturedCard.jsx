import { motion } from "framer-motion";
import { ExternalLink, Clock, Bookmark, BookmarkCheck } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useNewsStore } from "../../store/newsStore";
import { useTranslatedTexts } from "../../hooks/useTranslation";
import { useReaderStore } from "../../hooks/useReader";
import { useSaveArticle } from "../../hooks/useSaveArticle";
import { topicColor, topicLabel } from "../../lib/topicColors";
import SafeImage from "../ui/SafeImage";
import clsx from "clsx";

export default function FeaturedCard({ article }) {
  const { toggle: toggleSave, isSaved } = useSaveArticle();
  const openReader = useReaderStore(s => s.openReader);
  const saved = isSaved(article.id);
  const color = topicColor(article.category);
  const label = topicLabel(article.category);
  const isRecent = Date.now() - article.published_at < 2 * 60 * 60 * 1000;

  // Translation — source language comes from the article's metadata.
  const { texts: translated, isUrdu } = useTranslatedTexts(
    [article.title || "", article.description || ""],
    article.language || "en"
  );
  const displayTitle = translated[0] || article.title;
  const displayDesc  = translated[1] || article.description;

  const handleSave = (e) => {
    e.preventDefault(); e.stopPropagation();
    toggleSave(article);
  };

  return (
    <motion.article
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className="card card-hover group relative overflow-hidden"
    >
      <a
        href={article.url}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
          e.preventDefault();
          openReader(article);
        }}
        target="_blank" rel="noopener noreferrer">
        {/* Hero image */}
        <div className="relative overflow-hidden h-72 sm:h-96">
          <SafeImage
            src={article.image_url}
            alt={article.title}
            loading="eager"
            className="w-full h-full"
            imgClassName="w-full h-full object-cover transition-transform duration-slow ease-smooth group-hover:scale-105"
            fallback={
              <div
                className="w-full h-full flex items-center justify-center"
                style={{ background: `linear-gradient(135deg, ${color}33, ${color}66)` }}
              >
                <span className="text-8xl opacity-40">
                  {article.category === "ai" ? "🤖" :
                   article.category === "sports" ? "🏆" :
                   article.category === "science" ? "🔬" :
                   article.category === "environment" ? "🌱" :
                   article.category === "weather" ? "🌤️" :
                   article.category === "pakistan" ? "🇵🇰" : "📰"}
                </span>
              </div>
            }
          />

          {/* Gradient overlay — stronger scrim keeps text readable across all image tones */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/35 to-transparent" />

          {/* Overlay content */}
          <div className={clsx("absolute bottom-0 left-0 right-0 p-5 sm:p-7", isUrdu && "text-right")}>
            <div className={clsx("flex items-center gap-2 mb-3", isUrdu && "flex-row-reverse justify-end")}>
              <span
                className="text-xs font-bold uppercase tracking-widest px-2.5 py-1 rounded-md text-white"
                style={{ backgroundColor: color }}
              >
                {label}
              </span>
              {isRecent && (
                <span className="live-badge">
                  <span className="w-1.5 h-1.5 rounded-full bg-white inline-block" />
                  LIVE
                </span>
              )}
              {article.credibility >= 9 && (
                <span className="text-xs text-white/70">✓ Verified</span>
              )}
            </div>

            <h2 className={clsx(
              "text-xl sm:text-2xl lg:text-3xl font-bold text-white leading-tight mb-2 line-clamp-3",
              isUrdu && "urdu-text text-white"
            )}>
              {displayTitle}
            </h2>

            {article.description && (
              <p className={clsx(
                "text-white/75 text-sm sm:text-base line-clamp-2 leading-relaxed",
                isUrdu && "urdu-text text-white/75"
              )}>
                {displayDesc}
              </p>
            )}

            <div className={clsx("flex items-center justify-between mt-4", isUrdu && "flex-row-reverse")}>
              <div className="flex items-center gap-3 text-white/60 text-xs">
                <span className="font-semibold text-white/80">{article.source_name}</span>
                <span className="flex items-center gap-1">
                  <Clock size={11} />
                  {formatDistanceToNow(new Date(article.published_at), { addSuffix: true })}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <motion.button
                  whileTap={{ scale: 0.85 }} onClick={handleSave}
                  className={clsx(
                    "p-2 rounded-full transition-colors",
                    saved ? "bg-electric-600 text-white" : "bg-white/20 text-white hover:bg-white/30"
                  )}
                >
                  {saved ? <BookmarkCheck size={14} /> : <Bookmark size={14} />}
                </motion.button>
                <span className="flex items-center gap-1 text-white/70 text-xs">
                  <ExternalLink size={12} />
                  {isUrdu ? "پڑھیں" : "Read"}
                </span>
              </div>
            </div>
          </div>
        </div>
      </a>
    </motion.article>
  );
}
