import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sun, Moon, Search, X, RefreshCw,
  Grid3x3, List, UserCircle, Tv, Sparkles,
  Rows3, Rows4, Menu,
} from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useNewsStore } from "../../store/newsStore";
import { useHealth, useRefresh } from "../../hooks/useNews";
import { useAuth } from "../../hooks/useAuth";
import { ScoopLogo } from "../mascot/ScoopMascot";
import CountryPicker from "./CountryPicker";
import LanguagePicker from "./LanguagePicker";
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
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const readerOpen = useReaderStore((s) => s.open);
  const onLiveTv   = location.pathname === "/live-tv";
  const onAnalysis = location.pathname.startsWith("/analysis");

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

  // Close the overflow menu on outside click / Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e) => { if (!menuRef.current?.contains(e.target)) setMenuOpen(false); };
    const onKey   = (e) => { if (e.key === "Escape") setMenuOpen(false); };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refresh();
    setTimeout(() => setIsRefreshing(false), 4000);
  };

  const isUrdu = language === "ur"; // keeps legacy Urdu-specific styling for the search box

  // Hide the global Header entirely while ReaderModal is open (self-contained surface).
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

          {/* ── Search bar (expands inline) ─────────────────────────────── */}
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
                <button type="submit" className="sr-only">Search</button>
              </motion.form>
            )}
          </AnimatePresence>

          {/* ── Actions: search · overflow menu · account ───────────────── */}
          <div className="flex items-center gap-1 sm:gap-1.5 rtl:flex-row-reverse">
            <HeaderBtn
              onClick={() => { setShowSearch(s => !s); if (showSearch) setSearchQuery(""); }}
              title="Search"
            >
              {showSearch ? <X size={16} /> : <Search size={16} />}
            </HeaderBtn>

            {/* ── ONE overflow menu — everything else lives here ──────────── */}
            <div ref={menuRef} className="relative">
              <HeaderBtn onClick={() => setMenuOpen(v => !v)} title="Menu" active={menuOpen}>
                {menuOpen ? <X size={16} /> : <Menu size={16} />}
              </HeaderBtn>

              <AnimatePresence>
                {menuOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -6, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -6, scale: 0.98 }}
                    transition={{ duration: 0.15 }}
                    className="absolute right-0 mt-2 w-60 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl z-50 p-1.5"
                  >
                    <MenuLink to="/live-tv"  icon={Tv}       label="Live TV"  active={onLiveTv}   accent="red"   onClick={() => setMenuOpen(false)} />
                    <MenuLink to="/analysis" icon={Sparkles} label="Analysis" active={onAnalysis}                onClick={() => setMenuOpen(false)} />
                    <MenuButton icon={RefreshCw} label={isRefreshing ? "Refreshing…" : "Refresh news"} spinning={isRefreshing} onClick={handleRefresh} />

                    <Divider />

                    <MenuField label="View">
                      <div className="flex items-center rounded-lg bg-[var(--color-surface2)] border border-[var(--color-border)] p-0.5 gap-0.5">
                        <ViewBtn active={viewMode === "grid"} onClick={() => setViewMode("grid")}><Grid3x3 size={14} /></ViewBtn>
                        <ViewBtn active={viewMode === "list"} onClick={() => setViewMode("list")}><List size={14} /></ViewBtn>
                      </div>
                    </MenuField>

                    <Divider />

                    <MenuField label="Translate"><LanguagePicker /></MenuField>
                    <MenuField label="Region"><CountryPicker /></MenuField>

                    <Divider />

                    <MenuButton icon={darkMode ? Sun : Moon} label={darkMode ? "Light mode" : "Dark mode"} onClick={toggleDarkMode} />
                    <MenuButton
                      icon={density === "compact" ? Rows3 : Rows4}
                      label={density === "compact" ? "Comfortable spacing" : "Compact (Pro) spacing"}
                      onClick={toggleDensity}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Sign in / profile */}
            <HeaderBtn
              onClick={() => setAuthOpen(true)}
              title={isLoggedIn ? "Your profile" : "Sign in"}
            >
              <UserCircle size={16} className={isLoggedIn ? "text-electric-600" : undefined} />
            </HeaderBtn>
          </div>
        </div>
      </div>
    </header>
  );
}

function HeaderBtn({ children, onClick, title, disabled = false, active = false }) {
  return (
    <motion.button
      whileTap={{ scale: 0.9 }}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={clsx(
        "w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center transition-all duration-200",
        active
          ? "bg-[var(--color-surface2)] text-[var(--color-text)]"
          : "text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface2)]",
        disabled && "opacity-50 cursor-not-allowed"
      )}
    >
      {children}
    </motion.button>
  );
}

// ── Overflow-menu primitives ──────────────────────────────────────────────
function MenuLink({ to, icon: Icon, label, active, accent, onClick }) {
  return (
    <Link
      to={to}
      onClick={onClick}
      className={clsx(
        "flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition-colors",
        active
          ? "bg-[var(--color-surface2)] text-[var(--color-text)] font-medium"
          : "text-[var(--color-text)] hover:bg-[var(--color-surface2)]"
      )}
    >
      <Icon size={16} className={accent === "red" ? "text-red-500" : "text-[var(--color-text-tertiary)]"} />
      <span>{label}</span>
    </Link>
  );
}

function MenuButton({ icon: Icon, label, onClick, spinning = false }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-[var(--color-text)] hover:bg-[var(--color-surface2)] transition-colors text-left"
    >
      <Icon size={16} className={clsx("text-[var(--color-text-tertiary)]", spinning && "animate-spin")} />
      <span>{label}</span>
    </button>
  );
}

function MenuField({ label, children }) {
  return (
    <div className="flex items-center justify-between gap-2 px-2.5 py-1.5">
      <span className="text-sm text-[var(--color-text-secondary)]">{label}</span>
      {children}
    </div>
  );
}

function ViewBtn({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "p-1.5 rounded-md transition-all",
        active
          ? "bg-[var(--color-surface)] shadow-sm text-[var(--color-text)]"
          : "text-[var(--color-text-tertiary)] hover:text-[var(--color-text)]"
      )}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <div className="my-1 border-t border-[var(--color-border)]" />;
}
