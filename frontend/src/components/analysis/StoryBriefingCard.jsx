/**
 * StoryBriefingCard — compact analysis teaser injected into the news feed
 * at position 9. Shows the top story cluster with an "⚡ Analysis" badge
 * and links to the /analysis page.
 *
 * Returns null while loading or when no clusters exist so the grid is
 * unaffected before the first scheduler run.
 */
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { Zap, ArrowRight } from "lucide-react";
import { useStoryClusters } from "../../hooks/useAnalysis";

export default function StoryBriefingCard() {
  const { data: clusters = [], isLoading } = useStoryClusters();
  const top = clusters[0];

  if (isLoading || !top) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="rounded-2xl border-2 border-electric-500/25
                 bg-gradient-to-br from-electric-50/70 to-blue-50/30
                 dark:from-electric-900/20 dark:to-blue-950/10
                 p-4 flex flex-col gap-3 h-full min-h-[200px]"
    >
      {/* Badge row */}
      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1 px-2 py-0.5 rounded-full
                         bg-electric-600 text-white text-[10px] font-bold uppercase tracking-wider">
          <Zap size={9} fill="currentColor" />
          Analysis
        </span>
        <span className="text-[10px] text-[var(--color-text-tertiary)] font-medium">
          {top.article_count} sources · {top.category}
        </span>
      </div>

      {/* Story title */}
      <h3
        className="text-base leading-snug text-[var(--color-text)] line-clamp-3"
        style={{ fontFamily: "'Playfair Display', serif", fontStyle: "italic" }}
      >
        {top.title}
      </h3>

      {/* One-line summary */}
      {top.summary && (
        <p className="text-xs text-[var(--color-text-secondary)] line-clamp-2 flex-1">
          {top.summary}
        </p>
      )}

      {/* First brief point preview */}
      {top.brief?.[0] && (
        <p className="text-[11px] text-[var(--color-text-tertiary)] line-clamp-2
                       border-l-2 border-electric-400 pl-2 italic">
          {top.brief[0].text}
        </p>
      )}

      {/* CTA */}
      <Link
        to="/analysis"
        className="mt-auto flex items-center gap-1 text-xs font-bold
                   text-electric-600 hover:text-electric-700 transition-colors"
      >
        Full analysis <ArrowRight size={11} />
      </Link>
    </motion.div>
  );
}
