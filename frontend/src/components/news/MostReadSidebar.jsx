import { useMemo } from "react";
import { motion } from "framer-motion";
import { TrendingUp } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { topicColor } from "../../lib/topicColors";

export default function MostReadSidebar({ articles = [] }) {
  const topArticles = useMemo(() => {
    if (!articles.length) return [];
    return [...articles]
      .sort((a, b) => {
        // Score = credibility (0-10) + recency bonus that decays over 24 h
        const hoursA = (Date.now() - new Date(a.published_at)) / (1000 * 60 * 60);
        const hoursB = (Date.now() - new Date(b.published_at)) / (1000 * 60 * 60);
        const scoreA = (a.credibility || 5) + Math.max(0, 5 - hoursA / 4.8);
        const scoreB = (b.credibility || 5) + Math.max(0, 5 - hoursB / 4.8);
        return scoreB - scoreA;
      })
      .slice(0, 8);
  }, [articles]);

  if (topArticles.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.25, duration: 0.4 }}
      className="card overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--color-border)]">
        <TrendingUp size={14} className="text-cobalt-600" />
        <h3 className="text-sm font-bold text-[var(--color-text)]">Most Read</h3>
      </div>

      {/* Ranked article list */}
      <ol className="divide-y divide-[var(--color-border)]">
        {topArticles.map((article, i) => {
          const accentColor = topicColor(article.category);
          return (
            <li key={article.id}>
              <a
                href={article.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex gap-3 px-4 py-3 hover:bg-[var(--color-surface2)] transition-colors group"
              >
                {/* Rank number — top-3 in cobalt, rest muted */}
                <span
                  className="flex-shrink-0 text-xl font-black tabular-nums leading-tight mt-0.5 w-5 text-right select-none"
                  style={{ color: i < 3 ? "#2563EB" : "var(--color-border)" }}
                >
                  {i + 1}
                </span>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  {/* Category dot */}
                  <div className="flex items-center gap-1.5 mb-1">
                    <span
                      className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: accentColor }}
                    />
                    <span
                      className="text-[10px] font-bold uppercase tracking-wider"
                      style={{ color: accentColor }}
                    >
                      {article.category}
                    </span>
                  </div>

                  <p className="text-xs font-semibold text-[var(--color-text)] line-clamp-3 leading-snug group-hover:text-cobalt-600 transition-colors">
                    {article.title}
                  </p>
                  <p className="text-[10px] text-[var(--color-text-tertiary)] mt-1 truncate">
                    {article.source_name}
                    {" · "}
                    {formatDistanceToNow(new Date(article.published_at), { addSuffix: true })}
                  </p>
                </div>
              </a>
            </li>
          );
        })}
      </ol>
    </motion.div>
  );
}
