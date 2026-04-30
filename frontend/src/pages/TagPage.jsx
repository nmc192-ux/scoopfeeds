/**
 * TagPage — `/tag/:slug`
 *
 * Entity / topic-keyword pages. Each tag in lib/tags.js maps to a search
 * keyword that finds related coverage via /api/news?search=…. These are
 * evergreen long-tail SEO targets: "OpenAI news", "Tesla news", "Olympics
 * coverage" — high-intent queries with compounding traffic over time.
 */
import { useEffect } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import axios from "axios";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, Hash } from "lucide-react";
import NewsGrid from "../components/news/NewsGrid";
import { TAG_BY_SLUG, TAGS } from "../lib/tags";
import { AdSenseBanner } from "../components/ads/AdSense";
import { usePublicConfig } from "../hooks/useNews";
import { useAuth } from "../hooks/useAuth";

async function fetchByTag(query) {
  const params = new URLSearchParams({ search: query, limit: "50" });
  const { data } = await axios.get(`/api/news?${params}`);
  return data?.data || data?.articles || [];
}

export default function TagPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const tag = TAG_BY_SLUG[slug];
  const { isPremium } = useAuth();
  const { data: publicConfig } = usePublicConfig();
  const adSenseConfig = isPremium ? null : publicConfig?.adsense;

  const { data: articles = [], isLoading, error, refetch } = useQuery({
    queryKey: ["tag", slug],
    queryFn: () => fetchByTag(tag?.query),
    enabled: !!tag,
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (!tag) return;
    const prevTitle = document.title;
    const meta = document.querySelector('meta[name="description"]');
    const prevDesc = meta?.getAttribute("content");
    document.title = `${tag.name} News — Scoopfeeds`;
    if (meta && tag.blurb) meta.setAttribute("content", tag.blurb);
    return () => {
      document.title = prevTitle;
      if (meta && prevDesc) meta.setAttribute("content", prevDesc);
    };
  }, [tag]);

  if (!tag) {
    return (
      <div className="text-center py-20">
        <p className="text-2xl font-semibold mb-2">Tag not found</p>
        <p className="text-[var(--color-text-tertiary)] mb-6">No tag registered for "{slug}".</p>
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

  // Sibling tags in the same group — improves internal linking and helps
  // Google build a tighter topical cluster around each entity.
  const related = TAGS
    .filter(t => t.group === tag.group && t.slug !== tag.slug)
    .slice(0, 8);

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
        <div className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl shrink-0 bg-electric-50 dark:bg-electric-950/40">
          <span aria-hidden="true">{tag.emoji}</span>
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-[var(--color-text-tertiary)] mb-0.5">
            <Hash size={11} />
            <span>{tag.group}</span>
          </div>
          <h1
            className="text-2xl sm:text-3xl font-bold tracking-tight"
            style={{ fontFamily: "'Playfair Display', serif", fontStyle: "italic" }}
          >
            {tag.name}
          </h1>
          <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">
            {tag.blurb}
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
        slotName="tag-inline"
        config={adSenseConfig}
        className="mt-8"
        label="Sponsored"
        format="auto"
      />

      {related.length > 0 && (
        <section className="mt-12 pt-6 border-t border-[var(--color-border)]">
          <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--color-text-tertiary)] mb-3">
            Related tags
          </h2>
          <div className="flex flex-wrap gap-2">
            {related.map(t => (
              <Link
                key={t.slug}
                to={`/tag/${t.slug}`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-electric-50 hover:text-electric-700 dark:hover:bg-electric-950/40 dark:hover:text-electric-300 transition-colors"
              >
                <span aria-hidden="true">{t.emoji}</span>
                {t.name}
              </Link>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
