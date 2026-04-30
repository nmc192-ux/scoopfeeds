/**
 * SourcePage — `/source/:slug`
 *
 * Per-publisher hub. Backend already supports /api/news?source=<exactName>.
 * Reads from the curated source catalog (lib/sources.js) so URLs are clean
 * and the catalog can grow without changing the backend.
 */
import { useEffect } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import axios from "axios";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, Newspaper } from "lucide-react";
import NewsGrid from "../components/news/NewsGrid";
import { SOURCE_BY_SLUG, SOURCES } from "../lib/sources";
import { AdSenseBanner } from "../components/ads/AdSense";
import { usePublicConfig } from "../hooks/useNews";
import { useAuth } from "../hooks/useAuth";

async function fetchBySource(name) {
  const params = new URLSearchParams({ source: name, limit: "50" });
  const { data } = await axios.get(`/api/news?${params}`);
  return data?.data || data?.articles || [];
}

export default function SourcePage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const source = SOURCE_BY_SLUG[slug];
  const { isPremium } = useAuth();
  const { data: publicConfig } = usePublicConfig();
  const adSenseConfig = isPremium ? null : publicConfig?.adsense;

  const { data: articles = [], isLoading, error, refetch } = useQuery({
    queryKey: ["source", slug],
    queryFn: () => fetchBySource(source?.name),
    enabled: !!source,
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (!source) return;
    const prevTitle = document.title;
    document.title = `${source.name} — Scoopfeeds`;
    return () => { document.title = prevTitle; };
  }, [source]);

  if (!source) {
    return (
      <div className="text-center py-20">
        <p className="text-2xl font-semibold mb-2">Publisher not found</p>
        <p className="text-[var(--color-text-tertiary)] mb-6">No source registered for "{slug}".</p>
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

  // Suggest related sources from the same region — internal linking signal.
  const related = SOURCES
    .filter(s => s.region === source.region && s.slug !== source.slug)
    .slice(0, 6);

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
        <div className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl shrink-0 bg-[var(--color-surface)] border border-[var(--color-border)]">
          <span aria-hidden="true">{source.flag}</span>
        </div>
        <div className="min-w-0">
          <h1
            className="text-2xl sm:text-3xl font-bold tracking-tight"
            style={{ fontFamily: "'Playfair Display', serif", fontStyle: "italic" }}
          >
            {source.name}
          </h1>
          <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5 flex items-center gap-1.5">
            <Newspaper size={11} />
            Latest from {source.name} · {articles.length} {articles.length === 1 ? "story" : "stories"}
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
        slotName="source-inline"
        config={adSenseConfig}
        className="mt-8"
        label="Sponsored"
        format="auto"
      />

      {related.length > 0 && (
        <section className="mt-12 pt-6 border-t border-[var(--color-border)]">
          <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--color-text-tertiary)] mb-3">
            Other publishers in this region
          </h2>
          <div className="flex flex-wrap gap-2">
            {related.map(s => (
              <Link
                key={s.slug}
                to={`/source/${s.slug}`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface2)] hover:text-[var(--color-text)] transition-colors"
              >
                <span aria-hidden="true">{s.flag}</span>
                {s.name}
              </Link>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
