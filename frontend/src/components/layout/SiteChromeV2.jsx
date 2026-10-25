/**
 * SiteChromeV2 — the five-door navigation (header, phone bottom bar, footer).
 *
 * Rendered only when the v2 flag is on (SITE_V2 or ?v2=1). English only: there
 * is deliberately no language switch here. Red is reserved for "live".
 */
import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { Search, Home, Newspaper, PenLine, LineChart, Radio, UserCircle } from "lucide-react";
import { useNewsStore } from "../../store/newsStore";
import { useAuth } from "../../hooks/useAuth";
import { useReaderStore } from "../../hooks/useReader";
import { useGeo } from "../../hooks/useGeo";
import { FEED_COUNTRIES, countryName } from "../../lib/feedCountries";
import clsx from "clsx";

const FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Anton&family=Newsreader:ital,wght@0,400;0,600;1,400&family=Schibsted+Grotesk:wght@400;500;700&display=swap";

export const DOORS = [
  { to: "/",         label: "Today",          icon: Home,      match: (p) => p === "/" },
  { to: "/events",   label: "News",           icon: Newspaper, match: (p) => /^\/(events|topic|article|region|country|health|climate|sports|crypto|ai|space)(\/|$)/.test(p) },
  { to: "/briefs",   label: "Originals",      icon: PenLine,   match: (p) => p.startsWith("/briefs") },
  { to: "/markets",  label: "Markets",        icon: LineChart, match: (p) => p.startsWith("/markets") },
  { to: "/live-tv",  label: "Watch & Listen", icon: Radio,     match: (p) => p.startsWith("/live-tv") },
];

// Real links to existing filtered views. `match` decides the active chip.
export const TOPIC_CHIPS = [
  { label: "All",             to: "/",                  match: (p) => p === "/" },
  { label: "World",           to: "/topic/world",       match: (p) => p.startsWith("/topic/world") },
  { label: "Business",        to: "/topic/business",    match: (p) => p.startsWith("/topic/business") },
  { label: "Tech & AI",       to: "/topic/ai",          match: (p) => /^\/topic\/(ai|tech)(\/|$)/.test(p) },
  { label: "Health",          to: "/topic/health",      match: (p) => p.startsWith("/topic/health") },
  { label: "Climate",         to: "/topic/environment", match: (p) => p.startsWith("/topic/environment") },
  { label: "Science & Space", to: "/topic/science",     match: (p) => p.startsWith("/topic/science") },
  { label: "Sports",          to: "/topic/sports",      match: (p) => p.startsWith("/topic/sports") },
  { label: "Crypto",          to: "/crypto",            match: (p) => p.startsWith("/crypto") },
];

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--v2-lime)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--v2-ink)]";

function Wordmark() {
  return (
    <Link to="/" aria-label="Scoopfeeds — Home" className={clsx("rounded", FOCUS)}
          style={{ fontFamily: "var(--v2-display)", fontSize: 24, letterSpacing: "0.02em", color: "var(--v2-paper)" }}>
      SCOOP<span style={{ color: "var(--v2-lime)" }}>*</span>FEEDS
    </Link>
  );
}

// #190: "Showing stories for: <country>". Writes through useGeo().setOverride, so
// the choice persists (localStorage) and every page reading useGeo follows it.
// "" = detect automatically (clears the override).
export function CountryControl() {
  const { countryCode, country, isOverridden, setOverride } = useGeo();
  const value = isOverridden ? countryCode : "";
  const onChange = (e) => {
    const code = e.target.value;
    if (!code) return setOverride(null);
    setOverride({ countryCode: code, country: countryName(code), currency: null, timezone: null, city: null });
  };
  return (
    <label className="flex items-center gap-1.5 text-xs font-bold" style={{ fontFamily: "var(--v2-label)", color: "var(--v2-paper)" }}>
      <span className="sr-only lg:not-sr-only whitespace-nowrap">Showing stories for:</span>
      <select value={value} onChange={onChange} data-testid="v2-country"
              aria-label="Showing stories for"
              className={clsx("h-9 max-w-[8.5rem] sm:max-w-[11rem] rounded px-2 text-xs font-bold bg-transparent", FOCUS)}
              style={{ color: "var(--v2-paper)", border: "1px solid rgba(244,239,230,0.3)" }}>
        <option value="" style={{ color: "#111" }}>{countryName(countryCode, isOverridden ? null : country)} (auto)</option>
        {FEED_COUNTRIES.map((c) => (
          <option key={c.code} value={c.code} style={{ color: "#111" }}>{c.name}</option>
        ))}
      </select>
    </label>
  );
}

export function HeaderV2() {
  const { pathname } = useLocation();
  const { setAuthOpen } = useNewsStore();
  const { isLoggedIn } = useAuth();
  const readerOpen = useReaderStore((s) => s.open);

  useEffect(() => {
    if (document.querySelector("link[data-v2-fonts]")) return;
    const l = document.createElement("link");
    l.rel = "stylesheet"; l.href = FONTS_HREF; l.dataset.v2Fonts = "1";
    document.head.appendChild(l);
  }, []);

  if (readerOpen) return null;
  const hideChips = pathname.startsWith("/scoop-ops");

  return (
    <header className="v2-chrome sticky top-0 z-50" data-testid="v2-header">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center gap-6 h-14">
        <Wordmark />
        <nav aria-label="Primary" className="hidden sm:flex items-center gap-1 flex-1">
          {DOORS.map((d) => {
            const active = d.match(pathname);
            return (
              <Link key={d.to} to={d.to} aria-current={active ? "page" : undefined}
                    className={clsx("px-3 py-2 rounded text-sm font-bold transition-colors", FOCUS)}
                    style={{ fontFamily: "var(--v2-label)", color: active ? "var(--v2-lime)" : "var(--v2-paper)" }}>
                {d.label}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center gap-1 ml-auto sm:ml-0">
          <CountryControl />
          <Link to="/search" aria-label="Search" className={clsx("w-10 h-10 rounded-full flex items-center justify-center", FOCUS)}
                style={{ color: "var(--v2-paper)" }}>
            <Search size={18} />
          </Link>
          {isLoggedIn ? (
            <Link to="/saved" className={clsx("px-3 py-2 rounded text-sm font-bold", FOCUS)}
                  style={{ fontFamily: "var(--v2-label)", color: "var(--v2-paper)" }}>My Scoop</Link>
          ) : (
            <button type="button" onClick={() => setAuthOpen(true)} aria-label="Sign in"
                    className={clsx("h-10 px-3 rounded text-sm font-bold flex items-center gap-1.5", FOCUS)}
                    style={{ fontFamily: "var(--v2-label)", color: "var(--v2-paper)" }}>
              <UserCircle size={18} /><span className="hidden sm:inline">Sign in</span>
            </button>
          )}
        </div>
      </div>
      {!hideChips && (
        <nav aria-label="Topics" className="border-t" style={{ borderColor: "rgba(244,239,230,0.12)" }}>
          <ul className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center gap-2 overflow-x-auto py-2">
            {TOPIC_CHIPS.map((c) => {
              const active = c.match(pathname);
              return (
                <li key={c.label} className="shrink-0">
                  <Link to={c.to} aria-current={active ? "true" : undefined}
                        className={clsx("inline-block px-3 py-1 rounded-full text-xs font-bold whitespace-nowrap", FOCUS)}
                        style={{
                          fontFamily: "var(--v2-label)",
                          background: active ? "var(--v2-lime)" : "transparent",
                          color: active ? "var(--v2-ink)" : "var(--v2-paper)",
                          border: "1px solid " + (active ? "var(--v2-lime)" : "rgba(244,239,230,0.3)"),
                        }}>
                    {c.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
    </header>
  );
}

export function BottomBarV2() {
  const { pathname } = useLocation();
  if (pathname.startsWith("/scoop-ops")) return null;
  return (
    <nav aria-label="Primary" data-testid="v2-bottom-bar"
         className="v2-chrome sm:hidden fixed bottom-0 inset-x-0 z-40 border-t"
         style={{ borderColor: "rgba(244,239,230,0.15)", paddingBottom: "env(safe-area-inset-bottom, 0)" }}>
      <ul className="flex items-stretch">
        {DOORS.map((d) => {
          const active = d.match(pathname);
          const Icon = d.icon;
          return (
            <li key={d.to} className="flex-1">
              <Link to={d.to} aria-current={active ? "page" : undefined}
                    className={clsx("flex flex-col items-center justify-center gap-0.5 min-h-[44px] py-1.5", FOCUS)}
                    style={{ fontFamily: "var(--v2-label)", color: active ? "var(--v2-lime)" : "var(--v2-paper)" }}>
                <Icon size={18} aria-hidden />
                <span className="text-[10px] font-bold leading-tight text-center">{d.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

const FOOTER_GROUPS = [
  { title: "Read", links: [["Today", "/"], ["News", "/events"], ["Originals", "/briefs"], ["Saved", "/saved"]] },
  { title: "Data", links: [["Markets", "/markets"], ["Weather", "/weather"]] },
  { title: "Watch & Listen", links: [["Live TV", "/live-tv"], ["Newsletter", "/newsletter"]] },
  { title: "About", links: [
    ["About", "/about"], ["Sources", "/about#sources"], ["Editorial policy", "/editorial-policy"], ["Contact", "/contact"],
    ["Advertise", "/sponsor"], ["Privacy", "/privacy"], ["Terms", "/terms"],
  ] },
];

export function FooterV2() {
  return (
    <footer className="v2-chrome mt-16 py-10" data-testid="v2-footer">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-8">
          {FOOTER_GROUPS.map((g) => (
            <nav key={g.title} aria-label={g.title}>
              <h2 className="text-xs font-bold uppercase tracking-widest mb-3"
                  style={{ fontFamily: "var(--v2-label)", color: "var(--v2-lime)" }}>{g.title}</h2>
              <ul className="space-y-2">
                {g.links.map(([label, to]) => (
                  <li key={label}>
                    <Link to={to} className={clsx("text-sm rounded", FOCUS)}
                          style={{ fontFamily: "var(--v2-label)", color: "var(--v2-paper)" }}>{label}</Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <p className="mt-8 text-xs" style={{ fontFamily: "var(--v2-label)", color: "rgba(244,239,230,0.6)" }}>
          SCOOP*FEEDS — Intelligent news, curated.
        </p>
      </div>
    </footer>
  );
}
