import { useEffect, useState, lazy, Suspense } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Header from "./components/layout/Header";
import TopicNav from "./components/layout/TopicNav";
import FeaturedCard from "./components/news/FeaturedCard";
import NewsGrid from "./components/news/NewsGrid";
import StatsBar from "./components/news/StatsBar";
import BreakingBanner from "./components/news/BreakingBanner";
import MarketStrip from "./components/news/MarketStrip";
import MostReadSidebar from "./components/news/MostReadSidebar";
import WeatherWidget from "./components/news/WeatherWidget";

const LiveEventsView  = lazy(() => import("./components/live/LiveEventsView"));
const VideoSection    = lazy(() => import("./components/news/VideoSection"));
const LiveTVSection   = lazy(() => import("./components/news/LiveTVSection"));
const XFeedSection    = lazy(() => import("./components/news/XFeedSection"));
const MagazineSection = lazy(() => import("./components/news/MagazineSection"));
const CarsSection     = lazy(() => import("./components/news/CarsSection"));

const SectionFallback = () => (
  <div className="h-40 my-8 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] animate-pulse" />
);
import { LoadingHero } from "./components/ui/LoadingCard";
import { BackendOffline } from "./components/ui/EmptyState";
import { useNews, useFeatured, useHealth, usePublicConfig, useRefresh } from "./hooks/useNews";
import { useNewsStore } from "./store/newsStore";
import { trackPageView, attachEngagementObservers } from "./lib/track";
import ScoopMascot from "./components/mascot/ScoopMascot";
import { topicColor } from "./lib/topicColors";
import SafeImage from "./components/ui/SafeImage";
import ToastViewport from "./components/ui/ToastViewport";
import { toast } from "./lib/toast";
import { AdSenseBanner, AdSenseSidebar, AdSenseUnit } from "./components/ads/AdSense";
import AffiliateWidget from "./components/ads/AffiliateWidget";
import TipJar from "./components/tips/TipJar";
import SkimlinksLoader from "./components/ads/SkimlinksLoader";
import ReaderModal from "./components/reader/ReaderModal";
import OnboardingModal from "./components/onboarding/OnboardingModal";
import NewsletterCaptureModal from "./components/newsletter/NewsletterCaptureModal";
import PushOptInBanner from "./components/push/PushOptInBanner";
import AuthModal from "./components/auth/AuthModal";
import { useAuth } from "./hooks/useAuth";

export default function App() {
  const { activeTopics, searchQuery, lastRefreshed, language, savedArticles, authOpen, setAuthOpen } = useNewsStore();
  const showingSaved = activeTopics.includes("saved");
  const { data: fetchedArticles = [], isLoading: fetchedLoading, error, refetch } = useNews();
  const articles = showingSaved ? savedArticles : fetchedArticles;
  const isLoading = showingSaved ? false : fetchedLoading;
  const { data: featured = [], isLoading: featuredLoading } = useFeatured();
  const { data: health, isError: isOffline } = useHealth();
  const { data: publicConfig } = usePublicConfig();
  const { isPremium } = useAuth();
  const refresh = useRefresh();
  const isUrdu = language === "ur";
  // Premium users get an ad-free experience — skip rendering all AdSense units.
  const adSenseConfig = isPremium ? null : publicConfig?.adsense;

  // SSE live update stream
  useEffect(() => {
    let es;
    try {
      es = new EventSource("/api/events");
      es.onerror = () => es.close();
    } catch {}
    return () => es?.close();
  }, []);

  // Analytics: fire a page_view on load + wire up scroll/dwell observers.
  // Also persist ?ref= token so newsletter referral attribution survives SPA navigation.
  // Handle ?auth=verified, ?payment=success, ?newsletter=confirmed redirects.
  useEffect(() => {
    trackPageView({ topics: activeTopics, language });
    attachEngagementObservers();
    try {
      const params = new URLSearchParams(window.location.search);
      const ref = params.get("ref");
      if (ref && /^[0-9a-f]{48}$/.test(ref)) localStorage.setItem("scoop_ref_token", ref);
      if (params.get("auth") === "verified") {
        toast.success("Signed in — your saves sync across devices now");
        window.history.replaceState({}, "", window.location.pathname);
      }
      if (params.get("payment") === "success") {
        toast.success("Thank you for supporting Scoopfeeds! ❤️", { duration: 5000 });
        window.history.replaceState({}, "", window.location.pathname);
      }
      if (params.get("newsletter") === "confirmed") {
        toast.info("You're subscribed! First digest arrives at 7am.", { duration: 5000 });
        window.history.replaceState({}, "", window.location.pathname);
      }
    } catch {}
    // Intentionally run once on mount; topic-change events are fired from TopicNav.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fire a toast each time the user kicks off a refresh
  useEffect(() => {
    if (!lastRefreshed) return;
    toast.info(isUrdu ? "خبریں تازہ ہو رہی ہیں..." : "Refreshing news + videos…", { duration: 2500 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastRefreshed]);

  if (isOffline) return <BackendOffline />;

  const heroArticle  = featured[0] || null;
  const featuredGrid = featured.slice(1, 4);
  const showFeatured = activeTopics.includes("top") && !searchQuery;
  const showingLive  = activeTopics.includes("live");

  return (
    <div className="min-h-screen bg-[var(--color-bg)] transition-colors duration-300">
      <SkimlinksLoader publisherId={publicConfig?.affiliate?.skimlinksId} />
      <Header />
      <BreakingBanner />
      <TopicNav />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">

        {/* ── Stats bar ──────────────────────────────────────────────── */}
        <StatsBar />

        {/* Top banner removed: hurts CTR vs in-feed units AND fights hero
            visibility above the fold. Keeping the sidebar unit on desktop
            and an in-feed unit below the grid is plenty. */}

        {/* ── Mobile-only: Markets at top (collapsed) ─────────────── */}
        <div className="lg:hidden">
          <MarketStrip defaultOpen={false} />
        </div>

        {/* ── Mobile weather (desktop has it in the sidebar) ────────── */}
        <div className="lg:hidden mb-4">
          <WeatherWidget />
        </div>

        {/* ── Hero / Featured (Top Stories only) ─────────────────── */}
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

        {/* ── Live Events tab — replaces the normal feed grid ───── */}
        {showingLive && (
          <Suspense fallback={<SectionFallback />}>
            <LiveEventsView />
          </Suspense>
        )}

        {/* ── Two-column layout: News + Desktop Sidebar ──────────── */}
        {!showingLive && (
        <div className="lg:grid lg:grid-cols-[1fr_300px] lg:gap-6 lg:items-start">

          {/* ── LEFT: Article count header + grid ─────────────────── */}
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

            {/* Empty mascot state */}
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

          {/* ── RIGHT: Desktop Sidebar ──────────────────────────────── */}
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

      </main>

      {/* ── Footer ─────────────────────────────────────────────────── */}
      <footer className="mt-12 py-8 border-t border-[var(--color-border)]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-[var(--color-text-tertiary)]">
            <div className="flex items-center gap-2.5">
              <ScoopMascot size="sm" animated={false} />
              <div>
                <span
                  className="text-[var(--color-text)]"
                  style={{ fontFamily: "'Inter', system-ui, sans-serif", fontSize: "14px", fontWeight: 800, letterSpacing: "-0.04em" }}
                >Scoop<span style={{ color: "var(--color-orange)" }}>feeds</span></span>
                <span className="ml-2 text-[var(--color-text-tertiary)] font-editorial text-[13px]">— Intelligent news, curated.</span>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <span>📰 {health?.articles || 0} articles</span>
              <span>•</span>
              <span>📺 {health?.videos || 0} videos</span>
              <span>•</span>
              <span>🔄 Refreshes every 30 min</span>
              <span>•</span>
              <span>🌐 EN + اردو</span>
              <span>•</span>
              <span className="text-emerald-500">● Live</span>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-4 text-xs text-[var(--color-text-tertiary)]">
            <a href="/about" className="hover:text-[var(--color-text)] transition-colors">About</a>
            <span>·</span>
            <a href="/editorial-policy" className="hover:text-[var(--color-text)] transition-colors">Editorial policy</a>
            <span>·</span>
            <a href="/corrections" className="hover:text-[var(--color-text)] transition-colors">Corrections</a>
            <span>·</span>
            <a href="/contact" className="hover:text-[var(--color-text)] transition-colors">Contact</a>
            <span>·</span>
            <a href="/privacy" className="hover:text-[var(--color-text)] transition-colors">Privacy</a>
            <span>·</span>
            <a href="/sponsor" className="hover:text-[var(--color-text)] transition-colors">Advertise</a>
          </div>
          {/* Topic hubs — internal linking signal + discoverability for SSR'd /topic/:slug pages */}
          <div className="mt-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-[var(--color-text-tertiary)]">
            <span className="font-semibold text-[var(--color-text-secondary)]">Topics:</span>
            <a href="/topic/ai"            className="hover:text-[var(--color-text)] transition-colors">AI</a>
            <a href="/topic/politics"      className="hover:text-[var(--color-text)] transition-colors">Politics</a>
            <a href="/topic/pakistan"      className="hover:text-[var(--color-text)] transition-colors">Pakistan</a>
            <a href="/topic/international" className="hover:text-[var(--color-text)] transition-colors">International</a>
            <a href="/topic/science"       className="hover:text-[var(--color-text)] transition-colors">Science</a>
            <a href="/topic/health"        className="hover:text-[var(--color-text)] transition-colors">Health</a>
            <a href="/topic/cars"          className="hover:text-[var(--color-text)] transition-colors">Cars</a>
            <a href="/topic/sports"        className="hover:text-[var(--color-text)] transition-colors">Sports</a>
          </div>
        </div>
      </footer>

      {/* Sticky mobile anchor ad removed — too invasive on small screens,
          and our in-feed inline unit covers mobile monetization. */}

      {/* ── In-app reader + onboarding + newsletter capture ─────── */}
      <ReaderModal />
      <OnboardingModal />
      <NewsletterCaptureModal />
      <PushOptInBanner topics={activeTopics} language={language} />
      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />

      {/* ── Toast notifications ─────────────────────────────────────
          All status messages (auth/payment/newsletter/refresh) now flow
          through the shared toast queue. Fire from anywhere via:
            toast.success(msg) / toast.info(msg) / toast.error(msg)        */}
      <ToastViewport />
    </div>
  );
}

/* ── Sticky mobile bottom anchor ad ─────────────────────────────────────── */
function MobileAnchorAd({ config }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <div className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-[var(--color-bg)]/95 backdrop-blur border-t border-[var(--color-border)] shadow-lg">
      <button
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        className="absolute -top-3 right-2 w-6 h-6 rounded-full bg-gray-900 text-white text-xs flex items-center justify-center shadow-md z-10"
      >×</button>
      <div className="px-1 py-1">
        <AdSenseUnit
          slotName="banner"
          config={config}
          label="Ad"
          format="auto"
          minHeight={60}
          style={{ maxHeight: 100 }}
          houseVariant="compact"
        />
      </div>
    </div>
  );
}

/* ── Side card used in the hero grid ───────────────────────────────────────── */
function SideCard({ article }) {
  return (
    <motion.a
      href={article.url} target="_blank" rel="noopener noreferrer"
      whileHover={{ scale: 1.01 }}
      className="card card-hover flex gap-3 p-4"
    >
      {article.image_url && (
        <SafeImage
          src={article.image_url}
          alt={article.title}
          className="flex-shrink-0 w-20 h-20 rounded-xl"
          imgClassName="w-full h-full object-cover"
        />
      )}
      <div className="flex-1 min-w-0">
        <span
          className="text-xs font-bold text-white px-2 py-0.5 rounded"
          style={{ backgroundColor: topicColor(article.category) }}
        >
          {article.category}
        </span>
        <h4 className="text-sm font-semibold text-[var(--color-text)] leading-snug mt-1 line-clamp-3">
          {article.title}
        </h4>
        <p className="text-xs text-[var(--color-text-tertiary)] mt-1">{article.source_name}</p>
      </div>
    </motion.a>
  );
}
