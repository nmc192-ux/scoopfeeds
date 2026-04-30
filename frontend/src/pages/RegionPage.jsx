/**
 * RegionPage — `/region/:slug`
 *
 * Geographic news hub: World / Americas / Europe / Asia / MENA / Africa /
 * Oceania. Backed by /api/news?search=<keyword> for v1; v1.1 will switch
 * to per-source country tagging once that's wired up.
 */
import { useEffect } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import axios from "axios";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";
import NewsGrid from "../components/news/NewsGrid";
import { REGION_BY_SLUG, COUNTRIES } from "../lib/regions";
import { AdSenseBanner } from "../components/ads/AdSense";
import { usePublicConfig } from "../hooks/useNews";
import { useAuth } from "../hooks/useAuth";

async function fetchRegion(query) {
  const params = new URLSearchParams({ limit: "50" });
  if (query) params.set("search", query);
  const { data } = await axios.get(`/api/news?${params}`);
  return data?.data || data?.articles || [];
}

export default function RegionPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const region = REGION_BY_SLUG[slug];
  const { isPremium } = useAuth();
  const { data: publicConfig } = usePublicConfig();
  const adSenseConfig = isPremium ? null : publicConfig?.adsense;

  const { data: articles = [], isLoading, error, refetch } = useQuery({
    queryKey: ["region", slug],
    queryFn: () => fetchRegion(region?.query),
    enabled: !!region,
    staleTime: 5 * 60 * 1000,
  });

  // Per-page meta
  useEffect(() => {
    if (!region) return;
    const prevTitle = document.title;
    const meta = document.querySelector('meta[name="description"]');
    const prevDesc = meta?.getAttribute("content");
    document.title = `${region.label} News — Scoopfeeds`;
    if (meta) meta.setAttribute("content", `${region.blurb} Updated every 30 minutes.`);
    return () => {
      document.title = prevTitle;
      if (meta && prevDesc) meta.setAttribute("content", prevDesc);
    };
  }, [region]);

  if (!region) {
    return (
      <div className="text-center py-20">
        <p className="text-2xl font-semibold mb-2">Region not found</p>
        <p className="text-[var(--color-text-tertiary)] mb-6">No coverage hub for "{slug}".</p>
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

  // Country chips related to this region — cosmetic but boosts internal
  // linking and helps users drill down from region → country.
  const REGION_COUNTRY_HINTS = {
    americas: ["us", "ca", "mx", "br", "ar", "cl", "co"],
    europe:   ["gb", "de", "fr", "it", "es", "nl", "ua"],
    asia:     ["in", "cn", "jp", "kr", "id", "pk", "sg", "th", "vn"],
    mena:     ["ae", "sa", "qa", "il", "ir", "eg", "tr"],
    africa:   ["ng", "za", "ke", "et", "gh", "eg"],
    oceania:  ["au", "nz"],
    world:    ["us", "gb", "in", "jp", "br", "de"],
  };
  const countryHints = (REGION_COUNTRY_HINTS[slug] || [])
    .map(iso => COUNTRIES.find(c => c.iso === iso))
    .filter(Boolean);

  return (
    <>
      {/* Header */}
      <div className="flex items-center gap-3 mb-3">
        <button
          onClick={() => navigate(-1)}
          className="p-2 rounded-full hover:bg-[var(--color-surface2)] transition-colors"
          aria-label="Back"
        >
          <ChevronLeft size={18} />
        </button>
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0 bg-electric-50 dark:bg-electric-950/40"
        >
          <span aria-hidden="true">{region.emoji}</span>
        </div>
        <div className="min-w-0">
          <h1
            className="text-2xl sm:text-3xl font-bold tracking-tight"
            style={{ fontFamily: "'Playfair Display', serif", fontStyle: "italic" }}
          >
            {region.label}
          </h1>
          <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">
            {region.blurb}
          </p>
        </div>
      </div>

      {/* Country drill-down chips */}
      {countryHints.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-6">
          {countryHints.map(c => (
            <Link
              key={c.iso}
              to={`/country/${c.iso}`}
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
        onRefresh={refetch}
      />

      <AdSenseBanner
        slotName="region-inline"
        config={adSenseConfig}
        className="mt-8"
        label="Sponsored"
        format="auto"
      />
    </>
  );
}
