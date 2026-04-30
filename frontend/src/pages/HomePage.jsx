/**
 * HomePage — the main feed view at `/`.
 *
 * Contains the hero/featured section, the topic-filtered article grid, the
 * desktop sidebar (weather, ads, markets, most-read), and the lazy-loaded
 * subordinate sections (videos, live TV strip, magazine, cars, X feed).
 *
 * Was inlined in App.jsx until Phase 1 routing — extracting to its own
 * component lets us reuse it as the default route and unlocks per-route
 * meta tags + code-splitting later.
 */
import { lazy, Suspense } from "react";
import { motion, AnimatePresence } from "framer-motion";
import FeaturedCard from "../components/news/FeaturedCard";
import NewsGrid from "../components/news/NewsGrid";
import StatsBar from "../components/news/StatsBar";
import MarketStrip from "../components/news/MarketStrip";
import MostReadSidebar from "../components/news/MostReadSidebar";
import WeatherWidget from "../components/news/WeatherWidget";
import { LoadingHero } from "../components/ui/LoadingCard";
import { useNews, useFeatured, usePublicConfig, useRefresh } from "../hooks/useNews";
import { useNewsStore } from "../store/newsStore";
import ScoopMascot from "../components/mascot/ScoopMascot";
import SafeImage from "../components/ui/SafeImage";
import { AdSenseBanner, AdSenseSidebar } from "../components/ads/AdSense";
import AffiliateWidget from "../components/ads/AffiliateWidget";
import TipJar from "../components/tips/TipJar";
import { useAuth } from "../hooks/useAuth";
import { useReaderStore } from "../hooks/useReader";

const LiveEventsView  = lazy(() => import("../components/live/LiveEventsView"));
const VideoSection    = lazy(() => import("../components/news/VideoSection"));
const LiveTVSection   = lazy(() => import("../components/news/LiveTVSection"));
const XFeedSection    = lazy(() => import("../components/news/XFeedSection"));
const MagazineSection = lazy(() => import("../components/news/MagazineSection"));
const CarsSection     = lazy(() => import("../components/news/CarsSection"));

const SectionFallback = () => (
  <div className="h-40 my-8 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] animate-pulse" />
);

function SideCard({ article }) {
  const { openReader } = useReaderStore();
  return (
    <motion.button
      whileHover={{ y: -2 }}
      onClick={() => openReader(article)}
      className="text-left rounded-xl overflow-hidden bg-[var(--color-surface)] border border-[var(--color-border)] hover:shadow-lg transition-shadow group"
    >
      <div className="aspect-video relative">
        <SafeImage
          src={article.image_url}
          alt={article.title}
          className="w-full h-full"
        />
      </div>
      <div className="p-3">
        <h3 className="font-semibold text-sm line-clamp-2 group-hover:text-cobalt-600 transition-colors">
          {article.title}
        </h3>
        <p className="text-xs text-[var(--color-text-tertiary)] mt-1.5">
          {article.source_name}
        </p>
      </div>
    </motion.button>
  );
}

export default function HomePage() {
  const { activeTopics, searchQuery, savedArticles } = useNewsStore();
  const showingSaved = activeTopics.includes("saved");
  const { data: fetchedArticles = [], isLoading: fetchedLoading, error, refetch } = useNews();
  const articles = showingSaved ? savedArticles : fetchedArticles;
  const isLoading = showingSaved ? false : fetchedLoading;
  const { data: featured = [], isLoading: featuredLoading } = useFeatured();
  const { data: publicConfig } = usePublicConfig();
  const { isPremium } = useAuth();
  const refresh = useRefresh();
  const { language } = useNewsStore();
  const isUrdu = language === "ur";
  const adSenseConfig = isPremium ? null : publicConfig?.adsense;

  const heroArticle  = featured[0] || null;
  const featuredGrid = featured.slice(1, 4);
  const showFeatured = activeTopics.includes("top") && !searchQuery;
  const showingLive  = activeTopics.includes("live");

  return (
    <>
      <StatsBar />

      <div className="lg:hidden">
        <MarketStrip defaultOpen={false} />
      </div>

      <div className="lg:hidden mb-4">
        <WeatherWidget />
      </div>

      <AnimatePresence mode="wait">
        {showFeatured && (
          <motion.section
            key="hero"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="mb-8"
          >
            {featuredLoading ? (
              <LoadingHero />
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {heroArticle && (
                  <div className="lg:col-span-2">
                    <FeaturedCard article={heroArticle} />
                  </div>
                )}
                {featuredGrid.length > 0 && (
                  <div className="flex flex-col gap-4">
                    {featuredGrid.map(a => <SideCard key={a.id} article={a} />)}
                  </div>
                )}
              </div>
            )}
          </motion.section>
        )}
      </AnimatePresence>

      {showingLive && (
        <Suspense fallback={<SectionFallback />}>
          <LiveEventsView />
        </Suspense>
      )}

      {!showingLive && (
        <div className="lg:grid lg:grid-cols-[1fr_300px] lg:gap-6 lg:items-start">
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className={isUrdu
                ? "text-lg font-bold text-[var(--color-text)] urdu-text"
                : "text-lg font-bold text-[var(--color-text)]"}>
                {searchQuery
                  ? (isUrdu ? `"${searchQuery}" کے نتائج` : `Results for "${searchQuery}"`)
                  : showingSaved
                  ? (isUrdu ? "محفوظ خبریں" : "Saved Stories")
                  : activeTopics.includes("top")
                  ? (isUrdu ? "تازہ ترین خبریں" : "Latest Stories")
                  : activeTopics.map(t => t.charAt(0).toUpperCase() + t.slice(1).replace(/-/g, " ")).join(" · ")}
              </h2>
              {articles.length > 0 && (
                <span className="text-xs text-[var(--color-text-tertiary)]">
                  {articles.length} {isUrdu ? "خبریں" : "stories"}
                </span>
              )}
            </div>

            <NewsGrid
              articles={articles}
              isLoading={isLoading}
              error={error}
              onRefresh={() => { refetch(); refresh(); }}
            />

            <AdSenseBanner
              slotName="inline"
              config={adSenseConfig}
              className="mt-6"
              label="Sponsored"
              format="auto"
            />

            {!isLoading && !error && articles.length === 0 && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-col items-center gap-4 py-16 text-center"
              >
                <ScoopMascot size="lg" mood="reading" animated />
                <div>
                  <p className="text-lg font-semibold text-[var(--color-text)]">
                    {isUrdu ? "کوئی خبر نہیں ملی" : "Nothing in this stream yet"}
                  </p>
                  <p className="text-sm text-[var(--color-text-tertiary)] mt-1">
                    {isUrdu ? "دوسرا موضوع منتخب کریں" : "Try a different topic or hit refresh"}
                  </p>
                </div>
              </motion.div>
            )}
          </div>

          <aside className="hidden lg:flex flex-col gap-4 sticky top-20 self-start">
            <WeatherWidget />
            <AdSenseSidebar
              slotName="sidebar"
              config={adSenseConfig}
              label="Sponsored"
              format="auto"
            />
            <AffiliateWidget category="default" />
            {publicConfig?.kofi?.url && <TipJar kofiUrl={publicConfig.kofi.url} />}
            <MarketStrip />
            <MostReadSidebar articles={articles} />
          </aside>
        </div>
      )}

      {!showingLive && (
        <Suspense fallback={<SectionFallback />}>
          <VideoSection />
          <LiveTVSection />
          <MagazineSection />
          <CarsSection />
          <XFeedSection />
        </Suspense>
      )}
    </>
  );
}
