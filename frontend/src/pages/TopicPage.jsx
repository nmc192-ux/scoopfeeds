/**
 * TopicPage — `/topic/:slug` and `/topic/:slug/:country`
 *
 * Two modes:
 *   1. Plain topic     — `/topic/ai` → store-driven feed via useNews()
 *   2. Compound        — `/topic/ai/japan` → custom query with both filters
 *      (tab=ai + search=Japan). These compound URLs are long-tail SEO gold:
 *      "AI news Japan", "Climate news Europe", etc.
 *
 * URL is the source of truth; per-page <title> + meta description set for SEO.
 */
import { useEffect } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import axios from "axios";
import { useQuery } from "@tanstack/react-query";
import NewsGrid from "../components/news/NewsGrid";
import { useNews, useRefresh, usePublicConfig } from "../hooks/useNews";
import { useNewsStore } from "../store/newsStore";
import { useAuth } from "../hooks/useAuth";
import { AdSenseBanner } from "../components/ads/AdSense";
import { ChevronLeft } from "lucide-react";
import { topicLabel, topicEmoji, topicColor } from "../lib/topicColors";
import { COUNTRY_BY_ISO, COUNTRIES } from "../lib/regions";

const VALID_TOPICS = new Set([
  "top", "live", "politics", "business", "tech", "ai",
  "science", "health", "medicine", "public-health", "environment",
  "sports", "cars", "self-help", "international", "pakistan",
  "world", "local", "saved",
]);

// Compound-mode fetcher: topic tab + country search keyword.
async function fetchTopicCountry(slug, country) {
  const params = new URLSearchParams({ tab: slug, limit: "50" });
  if (country?.query) params.set("search", country.query);
  if (country?.useLocalTab) {
    // Override: when the country has dedicated local-source tagging
    // (US, PK), prefer the regional path which yields better signal
    // than a name-keyword search.
    params.set("tab", "local");
    params.set("country", country.iso.toUpperCase());
  }
  const { data } = await axios.get(`/api/news?${params}`);
  return data?.data || data?.articles || [];
}

export default function TopicPage() {
  const { slug, country: countryParam } = useParams();
  const navigate = useNavigate();
  const { setActiveTopics, language } = useNewsStore();
  const { isPremium } = useAuth();
  const { data: publicConfig } = usePublicConfig();
  const adSenseConfig = isPremium ? null : publicConfig?.adsense;
  const isUrdu = language === "ur";

  const country = countryParam ? COUNTRY_BY_ISO[String(countryParam).toLowerCase()] : null;
  const isCompound = !!country;

  // Sync URL → store so the standard useNews hook fetches the right category
  // (used in plain-topic mode only)
  useEffect(() => {
    if (slug && VALID_TOPICS.has(slug) && !isCompound) {
      setActiveTopics([slug]);
    }
  }, [slug, isCompound, setActiveTopics]);

  // Plain mode: use the global useNews() feed
  const plainQ = useNews();
  // Compound mode: dedicated query that filters by topic + country
  const compoundQ = useQuery({
    queryKey: ["topic-country", slug, countryParam],
    queryFn:  () => fetchTopicCountry(slug, country),
    enabled:  isCompound && VALID_TOPICS.has(slug) && !!country,
    staleTime: 5 * 60 * 1000,
  });

  const articles  = isCompound ? (compoundQ.data || []) : (plainQ.data || []);
  const isLoading = isCompound ? compoundQ.isLoading   : plainQ.isLoading;
  const error     = isCompound ? compoundQ.error       : plainQ.error;
  const refetch   = isCompound ? compoundQ.refetch     : plainQ.refetch;
  const refresh   = useRefresh();

  // Bad URL guards
  if (!VALID_TOPICS.has(slug)) {
    return <NotFoundCard message={`No coverage hub for "${slug}".`} />;
  }
  if (countryParam && !country) {
    return <NotFoundCard message={`No country hub for "${countryParam}".`} />;
  }

  const label = topicLabel(slug);
  const emoji = topicEmoji(slug);
  const color = topicColor(slug);

  // Per-route <title> + meta. Different copy for compound vs plain mode.
  useEffect(() => {
    const prevTitle = document.title;
    const meta = document.querySelector('meta[name="description"]');
    const prevDesc = meta?.getAttribute("content");
    if (isCompound) {
      document.title = `${label} News in ${country.name} — Scoopfeeds`;
      if (meta) meta.setAttribute("content", `${label} coverage focused on ${country.name}, curated from trusted global sources.`);
    } else {
      document.title = `${label} — Scoopfeeds`;
      if (meta) meta.setAttribute("content", `Latest ${label.toLowerCase()} news, curated from trusted global sources. Updated every 30 minutes.`);
    }
    return () => {
      document.title = prevTitle;
      if (meta && prevDesc) meta.setAttribute("content", prevDesc);
    };
  }, [label, isCompound, country]);

  // Suggest other countries to drill into the same topic — internal linking
  // for compound long-tail SEO.
  const COUNTRY_HINTS_BY_TOPIC = {
    ai:        ["us", "cn", "jp", "kr", "in", "gb", "fr", "de"],
    politics:  ["us", "gb", "in", "br", "tr", "ru", "fr", "de"],
    business:  ["us", "cn", "jp", "de", "gb", "in", "br"],
    tech:      ["us", "cn", "jp", "kr", "tw", "in", "il"],
    sports:    ["us", "gb", "br", "ar", "fr", "de", "in", "jp"],
    science:   ["us", "gb", "de", "jp", "cn", "ch", "fr"],
    health:    ["us", "gb", "in", "br", "de", "fr"],
    cars:      ["us", "de", "jp", "kr", "cn", "fr", "it"],
    international: ["us", "gb", "ru", "cn", "in"],
  };
  const drillHints = (COUNTRY_HINTS_BY_TOPIC[slug] || ["us", "gb", "in", "jp", "br", "de"])
    .filter(iso => iso !== countryParam)
    .map(iso => COUNTRY_BY_ISO[iso])
    .filter(Boolean)
    .slice(0, 8);

  return (
    <>
      {/* Topic header */}
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
          <div className="min-w-0">
            <h1
              className="text-2xl sm:text-3xl font-bold tracking-tight flex items-center gap-2 flex-wrap"
              style={{ fontFamily: "'Playfair Display', serif", fontStyle: "italic" }}
            >
              {label}
              {isCompound && (
                <>
                  <span className="text-[var(--color-text-tertiary)] not-italic font-normal text-lg">in</span>
                  <span className="inline-flex items-center gap-1.5">
                    <span aria-hidden="true">{country.flag}</span>
                    {country.name}
                  </span>
                </>
              )}
            </h1>
            <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">
              {articles.length} {isUrdu ? "خبریں" : "stories"}
              {isCompound
                ? ` · ${label} coverage focused on ${country.name}`
                : " · curated from global sources"}
            </p>
          </div>
        </div>
        {isCompound && (
          <Link
            to={`/topic/${slug}`}
            className="text-xs text-electric-600 hover:text-electric-700 hover:underline transition-colors hidden sm:inline-block"
          >
            ← Global {label}
          </Link>
        )}
      </div>

      {/* Compound mode: drill-down country chips for the same topic */}
      {!isCompound && drillHints.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-5">
          <span className="text-xs uppercase tracking-wider font-bold text-[var(--color-text-tertiary)] py-1">
            By country:
          </span>
          {drillHints.map(c => (
            <Link
              key={c.iso}
              to={`/topic/${slug}/${c.iso}`}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface2)] hover:text-[var(--color-text)] transition-colors"
            >
              <span aria-hidden="true">{c.flag}</span>
              {c.name}
            </Link>
          ))}
        </div>
      )}

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

      {/* Compound: switch to other countries within this topic */}
      {isCompound && drillHints.length > 0 && (
        <section className="mt-12 pt-6 border-t border-[var(--color-border)]">
          <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--color-text-tertiary)] mb-3">
            {label} in other countries
          </h2>
          <div className="flex flex-wrap gap-2">
            {drillHints.map(c => (
              <Link
                key={c.iso}
                to={`/topic/${slug}/${c.iso}`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface2)] hover:text-[var(--color-text)] transition-colors"
              >
                <span aria-hidden="true">{c.flag}</span>
                {c.name}
              </Link>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function NotFoundCard({ message }) {
  return (
    <div className="text-center py-20">
      <p className="text-2xl font-semibold mb-2">Not found</p>
      <p className="text-[var(--color-text-tertiary)] mb-6">{message}</p>
      <Link
        to="/"
        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-electric-600 text-white text-sm font-semibold"
      >
        <ChevronLeft size={14} />
        Back to home
      </Link>
    </div>
  );
}
