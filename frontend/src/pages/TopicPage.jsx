/**
 * TopicPage — `/topic/:slug`
 *
 * Renders an editorial hub for a single topic. URL is the source of truth:
 * navigating to `/topic/ai` syncs the store's activeTopics so the existing
 * fetch/grid components work unchanged. Per-page <title> is set for SEO,
 * augmenting the SSR'd /topic/:slug pages backend already serves to crawlers.
 */
import { useEffect } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import NewsGrid from "../components/news/NewsGrid";
import { useNews, useRefresh, usePublicConfig } from "../hooks/useNews";
import { useNewsStore } from "../store/newsStore";
import { useAuth } from "../hooks/useAuth";
import { AdSenseBanner } from "../components/ads/AdSense";
import { ChevronLeft } from "lucide-react";
import { topicLabel, topicEmoji, topicColor } from "../lib/topicColors";

const VALID_TOPICS = new Set([
  "top", "live", "politics", "business", "tech", "ai",
  "science", "health", "medicine", "public-health", "environment",
  "sports", "cars", "self-help", "international", "pakistan",
  "world", "local", "saved",
]);

export default function TopicPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { setActiveTopics, language } = useNewsStore();
  const { isPremium } = useAuth();
  const { data: publicConfig } = usePublicConfig();
  const adSenseConfig = isPremium ? null : publicConfig?.adsense;
  const isUrdu = language === "ur";

  // Sync URL → store so the existing useNews hook fetches the right category
  useEffect(() => {
    if (slug && VALID_TOPICS.has(slug)) {
      setActiveTopics([slug]);
    }
  }, [slug, setActiveTopics]);

  const { data: articles = [], isLoading, error, refetch } = useNews();
  const refresh = useRefresh();

  if (!VALID_TOPICS.has(slug)) {
    return (
      <div className="text-center py-20">
        <p className="text-2xl font-semibold mb-2">Topic not found</p>
        <p className="text-[var(--color-text-tertiary)] mb-6">No coverage hub for "{slug}".</p>
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-cobalt-600 text-white text-sm font-semibold"
        >
          <ChevronLeft size={14} />
          Back to home
        </Link>
      </div>
    );
  }

  const label = topicLabel(slug);
  const emoji = topicEmoji(slug);
  const color = topicColor(slug);

  // Per-route <title> + meta description for SEO. Backend SSRs the same
  // route for crawlers; this is for client-side hydration parity.
  useEffect(() => {
    const prevTitle = document.title;
    document.title = `${label} — Scoopfeeds`;
    const meta = document.querySelector('meta[name="description"]');
    const prevDesc = meta?.getAttribute("content");
    if (meta) meta.setAttribute("content", `Latest ${label.toLowerCase()} news, curated from trusted global sources. Updated every 30 minutes.`);
    return () => {
      document.title = prevTitle;
      if (meta && prevDesc) meta.setAttribute("content", prevDesc);
    };
  }, [label]);

  return (
    <>
      {/* Topic header banner */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="p-2 rounded-full hover:bg-[var(--color-surface2)] transition-colors"
            aria-label="Back"
          >
            <ChevronLeft size={18} />
          </button>
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0"
            style={{ background: `${color}15` }}
          >
            <span aria-hidden="true">{emoji}</span>
          </div>
          <div>
            <h1
              className="text-2xl sm:text-3xl font-bold tracking-tight"
              style={{ fontFamily: "'Playfair Display', serif", fontStyle: "italic" }}
            >
              {label}
            </h1>
            <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">
              {articles.length} {isUrdu ? "خبریں" : "stories"} · curated from global sources
            </p>
          </div>
        </div>
      </div>

      <NewsGrid
        articles={articles}
        isLoading={isLoading}
        error={error}
        onRefresh={() => { refetch(); refresh(); }}
      />

      <AdSenseBanner
        slotName="topic-inline"
        config={adSenseConfig}
        className="mt-8"
        label="Sponsored"
        format="auto"
      />
    </>
  );
}
