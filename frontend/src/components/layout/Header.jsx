import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sun, Moon, Search, X, RefreshCw,
  Activity, Grid3x3, List, UserCircle, Tv, Sparkles,
  Rows3, Rows4
} from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useNewsStore } from "../../store/newsStore";
import { useHealth, useRefresh } from "../../hooks/useNews";
import { useAuth } from "../../hooks/useAuth";
import { ScoopLogo } from "../mascot/ScoopMascot";
import CountryPicker from "./CountryPicker";
import LanguagePicker from "./LanguagePicker";
import MoreMenu from "./MoreMenu";
import { isRtl } from "../../lib/languages";
import { useReaderStore } from "../../hooks/useReader";
import clsx from "clsx";

export default function Header() {
  const {
    darkMode, toggleDarkMode,
    density, toggleDensity,
    searchQuery, setSearchQuery,
    viewMode, setViewMode,
    language, setAuthOpen,
  } = useNewsStore();
  const { data: health } = useHealth();
  const refresh = useRefresh();
  const { isLoggedIn } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const readerOpen = useReaderStore((s) => s.open);
  const onLiveTv      = location.pathname === "/live-tv";
  const onAnalysis    = location.pathname.startsWith("/analysis");

  const submitSearch = (e) => {
    e.preventDefault();
    const q = searchQuery.trim();
    if (q.length >= 2) {
      navigate(`/search?q=${encodeURIComponent(q)}`);
      setShowSearch(false);
    }
  };

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 10);
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refresh();
    setTimeout(() => setIsRefreshing(false), 4000);
  };

  const articleCount = health?.articles || 0;
  const rtl = isRtl(language);
  const isUrdu = language === "ur"; // keeps legacy Urdu-specific styling for the search box

  // Hide the global Header entirely while ReaderModal is open. The modal is
  // a self-contained reading surface with its own minimal nav (logo + tagline
  // linking to "/"). The 12+ Header controls for homepage browsing aren't
  // appropriate while a user is focused on a single article. See session 17.
  if (readerOpen) return null;

  return (
    <header
      className={clsx(
        "sticky top-0 z-50 transition-all duration-300",
        scrolled
          ? "glass border-b border-[var(--color-border)] shadow-sm"
          : "bg-transparent"
      )}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-14 sm:h-16">

          {/* ── Logo / Brand ───────────────────────────────────────────── */}
          <Link to="/" aria-label="Scoopfeeds — Home" className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-600/40 rounded-lg">
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              className="flex items-center gap-2.5"
            >
              <div className="relative">
                <ScoopLogo size={36} />
                {health?.status === "ok" && (
                  <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-500 rounded-full border-2 border-[var(--color-bg)] animate-pulse" />
                )}
              </div>
              <div className="hidden sm:flex flex-col leading-none gap-[3px]">
                <span className="font-brand text-[21px] font-extrabold tracking-[-0.04em] leading-none text-[var(--color-text)]">
                  Scoop<span className="text-[var(--color-orange)]">feeds</span>
                </span>
                <span className="font-editorial italic text-[11px] tracking-[0.01em] text-[var(--color-text-tertiary)]">
                  Intelligent news, curated.
                </span>
              </div>
            </motion.div>
          </Link>

          {/* ── Live indicator ──────────────────────────────────────────── */}
          <AnimatePresence>
            {articleCount > 0 && !showSearch && (
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                className="hidden sm:flex items-center gap-2 text-xs text-[var(--color-text-tertiary)]"
              >
                <Activity size={12} className="text-emerald-500" />
                <span>{articleCount.toLocaleString()} articles</span>
                {health?.scheduler?.isRunning && (
                  <span className="breaking-badge">Live</span>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Search bar ──────────────────────────────────────────────── */}
          <AnimatePresence>
            {showSearch && (
              <motion.form
                onSubmit={submitSearch}
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: "auto" }}
                exit={{ opacity: 0, width: 0 }}
                className="flex-1 max-w-sm mx-4"
              >
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
                  <input
                    autoFocus
                    type="search"
                    placeholder={isUrdu ? "خبریں تلاش کریں..." : "Search news…"}
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className={clsx(
                      "w-full pl-8 pr-10 py-2 text-sm rounded-full",
                      "bg-[var(--color-surface2)] border border-[var(--color-border)]",
                      "text-[var(--color-text)] placeholder-[var(--color-text-tertiary)]",
                      "focus:outline-none focus:ring-2 focus:ring-electric-600/40 focus:border-electric-600",
                      isUrdu && "text-right pr-8 pl-4"
                    )}
                    style={isUrdu ? { fontFamily: "'Noto Nastaliq Urdu', serif" } : {}}
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery("")}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)] hover:text-[var(--color-text)]"
                      aria-label="Clear"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
                {/* Keyboard-accessible submit (form Enter handles primary path) */}
                <button type="submit" className="sr-only">Search</button>
              </motion.form>
            )}
          </AnimatePresence>

          {/* ── Actions ─────────────────────────────────────────────────── */}
          <div className="flex items-center gap-1 sm:gap-1.5 rtl:flex-row-reverse">
            {/* Live TV pill — high-visibility entry point */}
            <Link
              to="/live-tv"
              title="Live TV channels"
              className={clsx(
                "inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider transition-all",
                "border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/50",
                onLiveTv
                  ? "bg-red-500 text-white border-red-500"
                  : "bg-red-500/10 text-red-600 border-red-500/30 hover:bg-red-500 hover:text-white hover:border-red-500"
              )}
            >
              <Tv size={13} />
              <span className="hidden sm:inline">Live TV</span>
              <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
            </Link>

            {/* Analysis pill */}
            <Link
              to="/analysis"
              title="AI News Analysis"
              className={clsx(
                "inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider transition-all",
                "border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-600/40",
                onAnalysis
                  ? "bg-electric-600 text-white border-electric-600"
                  : "bg-electric-500/10 text-electric-600 border-electric-500/30 hover:bg-electric-600 hover:text-white hover:border-electric-600"
              )}
            >
              <Sparkles size={13} />
              <span className="hidden sm:inline">Analysis</span>
            </Link>

            <HeaderBtn
              onClick={() => { setShowSearch(s => !s); if (showSearch) setSearchQuery(""); }}
              title="Search"
            >
              {showSearch ? <X size={16} /> : <Search size={16} />}
            </HeaderBtn>

            <HeaderBtn onClick={handleRefresh} title="Refresh news" disabled={isRefreshing}>
              <RefreshCw size={16} className={clsx(isRefreshing && "animate-spin")} />
            </HeaderBtn>

            {/* View mode */}
            <div className="hidden sm:flex items-center rounded-lg bg-[var(--color-surface2)] border border-[var(--color-border)] p-0.5 gap-0.5">
              <button
                onClick={() => setViewMode("grid")}
                className={clsx(
                  "p-1.5 rounded-md transition-all",
                  viewMode === "grid"
                    ? "bg-[var(--color-surface)] shadow-sm text-[var(--color-text)]"
                    : "text-[var(--color-text-tertiary)] hover:text-[var(--color-text)]"
                )}
              >
                <Grid3x3 size={14} />
              </button>
              <button
                onClick={() => setViewMode("list")}
                className={clsx(
                  "p-1.5 rounded-md transition-all",
                  viewMode === "list"
                    ? "bg-[var(--color-surface)] shadow-sm text-[var(--color-text)]"
                    : "text-[var(--color-text-tertiary)] hover:text-[var(--color-text)]"
                )}
              >
                <List size={14} />
              </button>
            </div>

            {/* RI / category mega-menu */}
            <MoreMenu />

            {/* Language picker (21 languages + auto) */}
            <LanguagePicker />

            {/* Country picker */}
            <CountryPicker />

            {/* Sign in / profile */}
            <HeaderBtn
              onClick={() => setAuthOpen(true)}
              title={isLoggedIn ? "Your profile" : "Sign in"}
            >
              <UserCircle
                size={16}
                className={isLoggedIn ? "text-electric-600" : undefined}
              />
            </HeaderBtn>

            {/* Density toggle (Comfortable ↔ Compact / Pro mode) */}
            <HeaderBtn
              onClick={toggleDensity}
              title={density === "compact" ? "Switch to comfortable spacing" : "Switch to compact (Pro) spacing"}
            >
              {density === "compact" ? <Rows3 size={16} /> : <Rows4 size={16} />}
            </HeaderBtn>

            {/* Dark mode */}
            <HeaderBtn onClick={toggleDarkMode} title="Toggle dark mode">
              <AnimatePresence mode="wait">
                <motion.div
                  key={darkMode ? "moon" : "sun"}
                  initial={{ rotate: -90, opacity: 0 }}
                  animate={{ rotate: 0, opacity: 1 }}
                  exit={{ rotate: 90, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  {darkMode ? <Sun size={16} /> : <Moon size={16} />}
                </motion.div>
              </AnimatePresence>
            </HeaderBtn>
          </div>
        </div>
      </div>
    </header>
  );
}

function HeaderBtn({ children, onClick, title, disabled = false }) {
  return (
    <motion.button
      whileTap={{ scale: 0.9 }}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={clsx(
        "w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center",
        "text-[var(--color-text-secondary)] hover:text-[var(--color-text)]",
        "hover:bg-[var(--color-surface2)] transition-all duration-200",
        disabled && "opacity-50 cursor-not-allowed"
      )}
    >
      {children}
    </motion.button>
  );
}
