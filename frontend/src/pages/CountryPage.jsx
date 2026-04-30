/**
 * CountryPage — `/country/:iso`
 *
 * Per-country news hub. Two strategies:
 *  - countries with proper source tagging (US, PK) → `tab=local&country=XX`
 *  - everyone else → search by country name (`search=Japan` etc.)
 *
 * URL is the source of truth — also sets the geo override so other parts
 * of the app (Local tab, weather, currency) reflect the user's choice.
 */
import { useEffect } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import axios from "axios";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, MapPin } from "lucide-react";
import NewsGrid from "../components/news/NewsGrid";
import { COUNTRY_BY_ISO } from "../lib/regions";
import { useGeo } from "../hooks/useGeo";
import { AdSenseBanner } from "../components/ads/AdSense";
import { usePublicConfig } from "../hooks/useNews";
import { useAuth } from "../hooks/useAuth";

async function fetchCountry(country) {
  const params = new URLSearchParams({ limit: "50" });
  if (country.useLocalTab) {
    params.set("tab",     "local");
    params.set("country", country.iso.toUpperCase());
  } else if (country.query) {
    params.set("search", country.query);
  }
  const { data } = await axios.get(`/api/news?${params}`);
  return data?.data || data?.articles || [];
}

export default function CountryPage() {
  const { iso } = useParams();
  const navigate = useNavigate();
  const country = COUNTRY_BY_ISO[String(iso || "").toLowerCase()];
  const { setOverride } = useGeo();
  const { isPremium } = useAuth();
  const { data: publicConfig } = usePublicConfig();
  const adSenseConfig = isPremium ? null : publicConfig?.adsense;

  // Sync URL → geo override so Local tab, weather, currency all update.
  // Skipped for invalid ISO so we don't poison the override.
  useEffect(() => {
    if (!country) return;
    setOverride({
      countryCode: country.iso.toUpperCase(),
      country:     country.name,
      currency:    null,
      timezone:    null,
      city:        null,
    });
  }, [country, setOverride]);

  const { data: articles = [], isLoading, error, refetch } = useQuery({
    queryKey: ["country", iso],
    queryFn: () => fetchCountry(country),
    enabled: !!country,
    staleTime: 5 * 60 * 1000,
  });

  // Per-page meta
  useEffect(() => {
    if (!country) return;
    const prevTitle = document.title;
    const meta = document.querySelector('meta[name="description"]');
    const prevDesc = meta?.getAttribute("content");
    document.title = `${country.name} News — Scoopfeeds`;
    if (meta) meta.setAttribute("content", `Latest news from and about ${country.name}, curated from trusted global sources.`);
    return () => {
      document.title = prevTitle;
      if (meta && prevDesc) meta.setAttribute("content", prevDesc);
    };
  }, [country]);

  if (!country) {
    return (
      <div className="text-center py-20">
        <p className="text-2xl font-semibold mb-2">Country not found</p>
        <p className="text-[var(--color-text-tertiary)] mb-6">
          We don't have a hub for "{iso}". Try a country from the picker.
        </p>
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

  return (
    <>
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate(-1)}
          className="p-2 rounded-full hover:bg-[var(--color-surface2)] transition-colors"
          aria-label="Back"
        >
          <ChevronLeft size={18} />
        </button>
        <div
          className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl shrink-0 bg-[var(--color-surface)] border border-[var(--color-border)]"
        >
          <span aria-hidden="true">{country.flag}</span>
        </div>
        <div className="min-w-0">
          <h1
            className="text-2xl sm:text-3xl font-bold tracking-tight"
            style={{ fontFamily: "'Playfair Display', serif", fontStyle: "italic" }}
          >
            {country.name}
          </h1>
          <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5 flex items-center gap-1.5">
            <MapPin size={11} />
            {articles.length} {articles.length === 1 ? "story" : "stories"} ·
            curated from international sources
          </p>
        </div>
      </div>

      <NewsGrid
        articles={articles}
        isLoading={isLoading}
        error={error}
        onRefresh={refetch}
      />

      <AdSenseBanner
        slotName="country-inline"
        config={adSenseConfig}
        className="mt-8"
        label="Sponsored"
        format="auto"
      />

      {articles.length === 0 && !isLoading && (
        <div className="text-center py-12 text-sm text-[var(--color-text-tertiary)]">
          No recent stories tagged for {country.name} in our feed yet — check the
          {" "}<Link to="/" className="text-electric-600 hover:underline">global feed</Link>{" "}
          for related coverage.
        </div>
      )}
    </>
  );
}
