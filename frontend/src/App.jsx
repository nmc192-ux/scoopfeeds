import { useEffect } from "react";
import { Routes, Route, useLocation, useParams, Navigate } from "react-router-dom";
import { useSiteConfig } from "./hooks/useSiteConfig";
import { LANGUAGES as I18N_LANGUAGES, getCurrentLang } from "./lib/i18n";
import Header from "./components/layout/Header";
import TopicNav from "./components/layout/TopicNav";
import BreakingBanner from "./components/news/BreakingBanner";
import { BackendOffline } from "./components/ui/EmptyState";
import { useHealth, usePublicConfig } from "./hooks/useNews";
import { useNewsStore } from "./store/newsStore";
import { trackPageView, attachEngagementObservers } from "./lib/track";
import ScoopMascot from "./components/mascot/ScoopMascot";
import ToastViewport from "./components/ui/ToastViewport";
import { toast } from "./lib/toast";
import SkimlinksLoader from "./components/ads/SkimlinksLoader";
import ReaderModal from "./components/reader/ReaderModal";
import OnboardingModal from "./components/onboarding/OnboardingModal";
import NewsletterCaptureModal from "./components/newsletter/NewsletterCaptureModal";
import PushOptInBanner from "./components/push/PushOptInBanner";
import AuthModal from "./components/auth/AuthModal";

import HomePage            from "./pages/HomePage";
import TopicPage           from "./pages/TopicPage";
import SavedPage           from "./pages/SavedPage";
import AboutPage           from "./pages/AboutPage";
import ArticlePage         from "./pages/ArticlePage";
import LiveTvPage          from "./pages/LiveTvPage";
import RegionPage          from "./pages/RegionPage";
import CountryPage         from "./pages/CountryPage";
import MarketsPage         from "./pages/MarketsPage";
import WeatherPage         from "./pages/WeatherPage";
import NewsletterPage      from "./pages/NewsletterPage";
import SourcePage          from "./pages/SourcePage";
import TagPage             from "./pages/TagPage";
import SearchPage          from "./pages/SearchPage";
import PrivacyPage         from "./pages/PrivacyPage";
import TermsPage           from "./pages/TermsPage";
import EditorialPolicyPage from "./pages/EditorialPolicyPage";
import ContactPage         from "./pages/ContactPage";
import SendVideoPage       from "./pages/SendVideoPage";
import SponsorPage         from "./pages/SponsorPage";
import AnalysisPage        from "./pages/AnalysisPage";
import AnalysisExplainedPage from "./pages/AnalysisExplainedPage";
import PredictionsPage      from "./pages/PredictionsPage";
import EventsPage           from "./pages/EventsPage";
import EventPage            from "./pages/EventPage";
import TrackerPage          from "./pages/TrackerPage";  // Layer 2 tracker detail (Sprint 1.5.3)
import TimelinePage          from "./pages/TimelinePage";
import TruthGapPage         from "./pages/TruthGapPage";
import DashboardPage        from "./pages/DashboardPage";
import AnomaliesPage        from "./pages/AnomaliesPage";
import RealityIndexOpsPage  from "./pages/RealityIndexOpsPage";
import MetricsOpsPage       from "./pages/MetricsOpsPage";
import BriefsPage           from "./pages/BriefsPage";
import BriefPage            from "./pages/BriefPage";
import BriefsReviewPage     from "./pages/BriefsReviewPage";
import WorldMapPage         from "./pages/WorldMapPage";
import FinancePage          from "./pages/FinancePage";
import MacroPage            from "./pages/MacroPage";
import SyntheticMarketsPage from "./pages/SyntheticMarketsPage";
import SyntheticMarketPage  from "./pages/SyntheticMarketPage";
import LeaderboardPage      from "./pages/LeaderboardPage";
import SyntheticReviewPage  from "./pages/SyntheticReviewPage";
import MobileBottomBar      from "./components/layout/MobileBottomBar";
import { HeaderV2, BottomBarV2, FooterV2 } from "./components/layout/SiteChromeV2";
import RadioMiniPlayer from "./components/radio/RadioMiniPlayer";

// Category alias pages — thin wrappers around EventsPage with locked filter.
import HealthEventsPage  from "./pages/category/HealthEventsPage";
import ClimateEventsPage from "./pages/category/ClimateEventsPage";
import SportsEventsPage  from "./pages/category/SportsEventsPage";
import CryptoEventsPage  from "./pages/category/CryptoEventsPage";
import AIEventsPage      from "./pages/category/AIEventsPage";
import SpaceEventsPage   from "./pages/category/SpaceEventsPage";

// Routes that hide the sub-header topic strip (keeps focus on the page).
const HIDE_TOPICNAV_ON = [
  "/live-tv", "/about", "/article", "/saved",
  "/region", "/country",
  "/markets", "/weather", "/newsletter",
  "/source", "/tag", "/search",
  "/privacy", "/terms", "/editorial-policy", "/contact", "/sponsor",
  "/analysis", "/predictions", "/events", "/timeline", "/truth-gap", "/dashboard", "/anomalies", "/scoop-ops", "/briefs", "/world-map", "/finance", "/macro", "/synthetic", "/leaderboard",
  "/health", "/climate", "/sports", "/crypto", "/ai", "/space",
];

/* Issue #173. With the v2 flag on, an old address redirects into the five-door site;
   with it off the old page renders untouched (the two addresses that never existed keep their 404). */
function V2Redirect({ to, children }) {
  const { v2, loading } = useSiteConfig();
  const params = useParams();
  if (!v2) return loading ? null : (children ?? <NotFound />);
  return <Navigate to={typeof to === "function" ? to(params) : to} replace />;
}

export default function App() {
  const { v2 } = useSiteConfig();
  const { activeTopics, lastRefreshed, language, authOpen, setAuthOpen } = useNewsStore();
  const setLanguage = useNewsStore((s) => s.setLanguage);
  // v2 has no language switch, so a saved non-English (possibly RTL) language
  // would trap the reader. Under v2 the site is English only.
  useEffect(() => {
    if (v2 && language && language !== "en") setLanguage("en");
  }, [v2, language, setLanguage]);
  // #188: the v2 page base (tokens, paper/ink, Schibsted + Newsreader) hangs off html.sf-v2.
  useEffect(() => {
    document.documentElement.classList.toggle("sf-v2", Boolean(v2));
  }, [v2]);
  const { data: health, isError: isOffline } = useHealth();
  const { data: publicConfig } = usePublicConfig();
  const location = useLocation();
  // isRtl: check the i18n LANGUAGES list (covers ar + ur in the starter set).
  const isRtlLang = I18N_LANGUAGES.find((l) => l.code === language)?.rtl ?? false;
  const isUrdu = language === "ur";

  const hideTopicNav = HIDE_TOPICNAV_ON.some(p => location.pathname.startsWith(p));

  // The old /api/events EventSource was removed here: no handler ever consumed
  // its messages, and holding an idle SSE connection per visitor triggered
  // Cloudflare 524s when compression buffered the stream (audit finding P0-2).
  // Reintroduce only together with a consumer.

  // Analytics: fire a page_view on load + wire up scroll/dwell observers.
  // Also persist ?ref= token so newsletter referral attribution survives SPA navigation.
  // Handle ?auth=verified, ?payment=success, ?newsletter=confirmed redirects.
  useEffect(() => {
    trackPageView({ topics: activeTopics, language, path: location.pathname });
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  // Fire a toast each time the user kicks off a refresh
  useEffect(() => {
    if (!lastRefreshed) return;
    toast.info(isUrdu ? "خبریں تازہ ہو رہی ہیں..." : "Refreshing news + videos…", { duration: 2500 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastRefreshed]);

  // Scroll to top on route change so users always land at the top of a new page
  // ...unless the address carries a #hash (e.g. /events/x#timeline): then scroll to that element once it exists.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
    if (!location.hash) return;
    const id = decodeURIComponent(location.hash.slice(1));
    let tries = 0;
    const t = setInterval(() => {
      const el = document.getElementById(id);
      if (el) { el.scrollIntoView(); clearInterval(t); }
      else if (++tries > 20) clearInterval(t);
    }, 150);
    return () => clearInterval(t);
  }, [location.pathname, location.hash]);

  if (isOffline) return <BackendOffline />;

  return (
    <div dir={isRtlLang ? "rtl" : "ltr"} className="min-h-screen bg-[var(--color-bg)] transition-colors duration-300">
      <SkimlinksLoader publisherId={publicConfig?.affiliate?.skimlinksId} />
      {v2 ? <HeaderV2 /> : <Header />}
      <BreakingBanner />
      {!v2 && !hideTopicNav && <TopicNav />}

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        <Routes>
          <Route path="/"               element={<HomePage />} />
          <Route path="/topic/:slug"            element={<TopicPage />} />
          <Route path="/topic/:slug/:country"   element={<TopicPage />} />
          <Route path="/article/:id"            element={<ArticlePage />} />
          <Route path="/saved"          element={<SavedPage />} />
          <Route path="/about"          element={<AboutPage />} />
          <Route path="/live-tv"        element={<LiveTvPage />} />
          <Route path="/region/:slug"   element={<RegionPage />} />
          <Route path="/country/:iso"   element={<CountryPage />} />
          <Route path="/markets"        element={<MarketsPage />} />
          <Route path="/weather"        element={<WeatherPage />} />
          <Route path="/newsletter"     element={<NewsletterPage />} />
          <Route path="/source/:slug"        element={<SourcePage />} />
          <Route path="/tag/:slug"           element={<TagPage />} />
          <Route path="/search"              element={<SearchPage />} />
          <Route path="/privacy"             element={<PrivacyPage />} />
          <Route path="/terms"               element={<TermsPage />} />
          <Route path="/editorial-policy"    element={<EditorialPolicyPage />} />
          <Route path="/contact"             element={<ContactPage />} />
          <Route path="/send-video"          element={<SendVideoPage />} />
          <Route path="/sponsor"             element={<SponsorPage />} />
          <Route path="/analysis"            element={<V2Redirect to="/briefs"><AnalysisPage /></V2Redirect>} />
          <Route path="/analysis/explained/:slug" element={<AnalysisExplainedPage />} />
          <Route path="/predictions"         element={<V2Redirect to="/markets?tab=predictions"><OddsOnly><PredictionsPage /></OddsOnly></V2Redirect>} />
          <Route path="/events"             element={<EventsPage />} />
          <Route path="/events/:slug"       element={<EventPage />} />
          <Route path="/trackers/:id"       element={<TrackerPage />} />
          <Route path="/timeline/:slug"     element={<V2Redirect to={({ slug }) => `/events/${slug}#timeline`}><TimelinePage /></V2Redirect>} />
          <Route path="/health"             element={<V2Redirect to="/topic/health"><HealthEventsPage /></V2Redirect>} />
          <Route path="/climate"            element={<V2Redirect to="/topic/environment"><ClimateEventsPage /></V2Redirect>} />
          <Route path="/sports"             element={<V2Redirect to="/topic/sports"><SportsEventsPage /></V2Redirect>} />
          <Route path="/crypto"             element={<CryptoEventsPage />} />
          <Route path="/ai"                 element={<V2Redirect to="/topic/ai"><AIEventsPage /></V2Redirect>} />
          <Route path="/space"              element={<V2Redirect to="/topic/science"><SpaceEventsPage /></V2Redirect>} />
          <Route path="/truth-gap"          element={<V2Redirect to="/markets?tab=truth-gap"><OddsOnly><TruthGapPage /></OddsOnly></V2Redirect>} />
          <Route path="/dashboard"          element={<V2Redirect to="/saved"><DashboardPage /></V2Redirect>} />
          <Route path="/sources"            element={<V2Redirect to="/about#sources" />} />
          <Route path="/live"               element={<V2Redirect to="/live-tv" />} />
          <Route path="/anomalies"          element={<OddsOnly><AnomaliesPage /></OddsOnly>} />
          <Route path="/scoop-ops/reality-index" element={<RealityIndexOpsPage />} />
          <Route path="/scoop-ops/metrics"        element={<MetricsOpsPage />} />
          <Route path="/scoop-ops/briefs"     element={<BriefsReviewPage />} />
          <Route path="/briefs"               element={<BriefsPage />} />
          <Route path="/briefs/:slug"         element={<BriefPage />} />
          <Route path="/world-map"            element={<V2Redirect to="/markets?tab=world-map"><WorldMapPage /></V2Redirect>} />
          <Route path="/finance"              element={<V2Redirect to="/markets?tab=finance"><FinancePage /></V2Redirect>} />
          <Route path="/macro"                element={<V2Redirect to="/markets?tab=macro"><MacroPage /></V2Redirect>} />
          <Route path="/synthetic"            element={<SyntheticMarketsPage />} />
          <Route path="/synthetic/:id"        element={<SyntheticMarketPage />} />
          <Route path="/leaderboard"          element={<LeaderboardPage />} />
          <Route path="/scoop-ops/synthetic"  element={<SyntheticReviewPage />} />
          <Route path="*"                    element={<NotFound />} />
        </Routes>
      </main>

      {v2 ? <FooterV2 /> : <Footer kofiUrl={publicConfig?.kofi?.url} />}

      <ReaderModal />
      <OnboardingModal />
      <NewsletterCaptureModal />
      <PushOptInBanner topics={activeTopics} language={language} />
      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />
      <ToastViewport />

      {/* Mobile-only bottom navigation. Adds matching bottom padding so
          fixed-position bar doesn't crowd content. */}
      {v2 && <RadioMiniPlayer />}
      {v2 ? <BottomBarV2 /> : <MobileBottomBar />}
      <div className="h-14 sm:hidden" aria-hidden />
    </div>
  );
}

/* ─── Footer ─────────────────────────────────────────────────────────────── */
function Footer({ kofiUrl }) {
  return (
    <footer className="mt-16 py-8 border-t border-[var(--color-border)]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <ScoopMascot size="sm" animated={false} />
          <span
            className="text-[var(--color-text)]"
            style={{ fontFamily: "'Inter', system-ui, sans-serif", fontSize: "14px", fontWeight: 800, letterSpacing: "-0.04em" }}
          >Scoop<span style={{ color: "var(--color-orange)" }}>feeds</span></span>
          <span className="text-[var(--color-text-tertiary)] font-editorial text-[13px]">— Intelligent news, curated.</span>
        </div>
        <nav className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-[var(--color-text-tertiary)]">
          {kofiUrl && (
            <a href={kofiUrl} target="_blank" rel="noopener noreferrer"
               className="inline-flex items-center gap-1 font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors">
              ☕ Support Scoop
            </a>
          )}
          <a href="/markets"          className="hover:text-[var(--color-text)] transition-colors">Markets</a>
          <a href="/editorial-policy" className="hover:text-[var(--color-text)] transition-colors">Sources</a>
          <a href="/about"            className="hover:text-[var(--color-text)] transition-colors">About</a>
          <a href="/privacy"          className="hover:text-[var(--color-text)] transition-colors">Privacy</a>
          <a href="/terms"            className="hover:text-[var(--color-text)] transition-colors">Terms</a>
        </nav>
      </div>
    </footer>
  );
}

/* Pages that exist only to show market odds: with SITE_MARKET_ODDS off they send readers home. */
function OddsOnly({ children }) {
  const { marketOdds, loading } = useSiteConfig();
  if (loading) return null; // redirecting before the answer arrives would bounce readers even when the flag is on
  return marketOdds ? children : <Navigate to="/" replace />;
}

/* ─── 404 ────────────────────────────────────────────────────────────────── */
function NotFound() {
  const { v2 } = useSiteConfig();
  return (
    <div className="text-center py-24">
      <ScoopMascot size="lg" mood="reading" animated />
      <p className="text-3xl font-bold mt-6 mb-2">{v2 ? "This page went off the record." : "Page not found"}</p>
      <p className="text-[var(--color-text-tertiary)] mb-6">
        The page you're looking for doesn't exist or has moved.
      </p>
      <a
        href="/"
        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-electric-600 text-white text-sm font-semibold hover:bg-electric-700 transition-colors"
      >
        Go to homepage
      </a>
    </div>
  );
}
