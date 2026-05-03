import { useMemo, useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown } from "lucide-react";
import NewsCard from "./NewsCard";
import { useNewsStore } from "../../store/newsStore";
import { LoadingGrid } from "../ui/LoadingCard";
import EmptyState from "../ui/EmptyState";
import { AdSenseUnit } from "../ads/AdSense";
import SponsorCard from "../ads/SponsorCard";
import StoryBriefingCard from "../analysis/StoryBriefingCard";
import { usePublicConfig } from "../../hooks/useNews";
import { useArticleBadges } from "../../hooks/usePredictions";
import RIBadgeStrip from "../predictions/RIBadgeStrip";
import { topicColor } from "../../lib/topicColors";

const AD_INTERVAL = 6;        // show an in-feed ad after every N cards
const SPONSOR_POSITION = 3;   // inject the sponsor card after the Nth article (front-of-feed)
const ANALYSIS_POSITION = 8;  // inject the analysis briefing card after the Nth article

const PAGE_SIZE = 18;

export default function NewsGrid({ articles = [], isLoading, error, onRefresh }) {
  const { viewMode } = useNewsStore();
  const [page, setPage] = useState(1);
  const { data: publicConfig } = usePublicConfig();
  const adSenseConfig = publicConfig?.adsense;
  const sponsor = publicConfig?.sponsor;

  // Dedup by id
  const dedupedArticles = useMemo(() => {
    const seen = new Set();
    return articles.filter(a => {
      if (seen.has(a.id)) return false;
      seen.add(a.id);
      return true;
    });
  }, [articles]);

  // Reset to page 1 whenever the articles list changes (topic/search switch)
  useEffect(() => { setPage(1); }, [articles]);

  const visibleArticles = dedupedArticles.slice(0, page * PAGE_SIZE);
  const hasMore = dedupedArticles.length > page * PAGE_SIZE;

  // Phase 4i: bulk-fetch RI badges for visible cards (one round-trip).
  // Falls back to {} on error so cards render unchanged when the endpoint
  // is unreachable.
  const visibleIds = useMemo(() => visibleArticles.map(a => a.id).slice(0, 60), [visibleArticles]);
  const { data: badgeData } = useArticleBadges(visibleIds);
  const badges = badgeData?.badges ?? {};

  if (isLoading && dedupedArticles.length === 0) {
    return <LoadingGrid count={9} />;
  }

  if (error && dedupedArticles.length === 0) {
    return <EmptyState type="error" onRefresh={onRefresh} />;
  }

  if (!isLoading && dedupedArticles.length === 0) {
    return <EmptyState type="noArticles" onRefresh={onRefresh} />;
  }

  return (
    <div className="space-y-4">
      <AnimatePresence mode="popLayout">
        {viewMode === "grid" ? (
          <motion.div
            key="grid"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
          >
            {visibleArticles.flatMap((article, i) => {
              const items = [<NewsCard key={article.id} article={article} index={i} riBadge={badges[article.id]} />];
              // Native sponsor slot — appears once, near the top of the feed.
              if (i + 1 === SPONSOR_POSITION && sponsor?.enabled && i < visibleArticles.length - 1) {
                items.push(<SponsorCard key="sponsor" sponsor={sponsor} />);
              }
              // Analysis briefing card — injected once mid-feed after first page load
              if (i === ANALYSIS_POSITION && i < visibleArticles.length - 1) {
                items.push(<StoryBriefingCard key="analysis-brief" />);
              }
              if ((i + 1) % AD_INTERVAL === 0 && i < visibleArticles.length - 1) {
                items.push(
                  <AdSenseUnit
                    key={`ad-${i}`}
                    slotName="inline"
                    config={adSenseConfig}
                    label="Sponsored"
                    format="fluid"
                    layout="in-article"
                    minHeight={220}
                    className="h-full"
                  />
                );
              }
              return items;
            })}
          </motion.div>
        ) : (
          <motion.div
            key="list"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col gap-3"
          >
            {visibleArticles.map((article, i) => (
              <ListCard key={article.id} article={article} index={i} riBadge={badges[article.id]} />
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Loading spinner when refreshing */}
      {isLoading && dedupedArticles.length > 0 && (
        <div className="flex justify-center py-4">
          <div className="flex gap-1.5">
            {[0, 0.15, 0.3].map((d, i) => (
              <motion.div
                key={i}
                animate={{ y: [0, -8, 0] }}
                transition={{ duration: 0.6, repeat: Infinity, delay: d }}
                className="w-2 h-2 bg-electric-600 rounded-full"
              />
            ))}
          </div>
        </div>
      )}

      {/* Load More button */}
      {!isLoading && hasMore && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-col items-center gap-1.5 pt-2"
        >
          <button
            onClick={() => setPage(p => p + 1)}
            className="flex items-center gap-2 px-6 py-2.5 rounded-full text-sm font-semibold
                       bg-[var(--color-surface)] border border-[var(--color-border)]
                       text-[var(--color-text-secondary)] hover:bg-[var(--color-surface2)]
                       hover:text-[var(--color-text)] hover:border-[var(--color-text-tertiary)]
                       transition-all duration-200 shadow-sm"
          >
            <ChevronDown size={15} />
            Load more stories
          </button>
          <p className="text-xs text-[var(--color-text-tertiary)]">
            Showing {visibleArticles.length} of {dedupedArticles.length}
          </p>
        </motion.div>
      )}
    </div>
  );
}

// Compact list view card
function ListCard({ article, index, riBadge }) {
  const [imgError, setImgError] = useState(false);

  return (
    <motion.article
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: Math.min(index * 0.03, 0.3) }}
      className="card card-hover"
    >
      <a
        href={article.url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex gap-4 p-4"
      >
        {article.image_url && !imgError && (
          <div className="flex-shrink-0 w-20 h-20 sm:w-24 sm:h-24 rounded-xl overflow-hidden bg-[var(--color-surface2)]">
            <img
              src={article.image_url}
              alt={article.title}
              loading="lazy"
              onError={() => setImgError(true)}
              className="w-full h-full object-cover"
            />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span
              className="text-xs font-semibold px-2 py-0.5 rounded-full text-white"
              style={{ backgroundColor: topicColor(article.category) }}
            >
              {article.category}
            </span>
            <span className="text-xs text-[var(--color-text-tertiary)]">
              {article.source_name}
            </span>
          </div>
          <h3 className="font-semibold text-[var(--color-text)] text-sm leading-snug line-clamp-2">
            {article.title}
          </h3>
          <p className="text-xs text-[var(--color-text-tertiary)] mt-1">
            {new Date(article.published_at).toLocaleDateString()}
          </p>
          <RIBadgeStrip badge={riBadge} />
        </div>
      </a>
    </motion.article>
  );
}
