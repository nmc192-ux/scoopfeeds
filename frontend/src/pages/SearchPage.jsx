/**
 * SearchPage — `/search?q=…`
 *
 * Dedicated full-page search results. Reads the query from the URL so results
 * are shareable and back-button-friendly. The header search box now navigates
 * here on submit instead of mutating the home feed via store state.
 */
import { useEffect, useState } from "react";
import { useSearchParams, useNavigate, Link } from "react-router-dom";
import axios from "axios";
import { useQuery } from "@tanstack/react-query";
import { Search, ChevronLeft, X } from "lucide-react";
import NewsGrid from "../components/news/NewsGrid";
import ScoopMascot from "../components/mascot/ScoopMascot";
import { TAGS } from "../lib/tags";

async function fetchSearch(q) {
  if (!q?.trim()) return [];
  const params = new URLSearchParams({ search: q.trim(), limit: "50" });
  const { data } = await axios.get(`/api/news?${params}`);
  return data?.data || data?.articles || [];
}

const SUGGESTED = TAGS.slice(0, 12);

export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const q = params.get("q") || "";
  const [draft, setDraft] = useState(q);

  useEffect(() => { setDraft(q); }, [q]);

  const { data: articles = [], isLoading, error, refetch } = useQuery({
    queryKey: ["search", q],
    queryFn:  () => fetchSearch(q),
    enabled:  q.length >= 2,
    staleTime: 60 * 1000,
  });

  useEffect(() => {
    const prev = document.title;
    document.title = q ? `Search: ${q} — Scoopfeeds` : "Search — Scoopfeeds";
    return () => { document.title = prev; };
  }, [q]);

  const submit = (e) => {
    e.preventDefault();
    const next = draft.trim();
    if (next.length >= 2) {
      setParams({ q: next });
    }
  };

  const clear = () => {
    setDraft("");
    setParams({});
  };

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
        <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-cobalt-50 dark:bg-cobalt-950/40 text-cobalt-600 dark:text-cobalt-400 shrink-0">
          <Search size={20} />
        </div>
        <div className="min-w-0">
          <h1
            className="text-2xl sm:text-3xl font-bold tracking-tight"
            style={{ fontFamily: "'Playfair Display', serif", fontStyle: "italic" }}
          >
            Search
          </h1>
          {q ? (
            <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">
              Results for <span className="text-[var(--color-text)] font-semibold">"{q}"</span>
              {" · "}{articles.length} {articles.length === 1 ? "story" : "stories"}
            </p>
          ) : (
            <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">
              Search across 7,000+ articles from 80+ trusted publishers.
            </p>
          )}
        </div>
      </div>

      {/* Search form */}
      <form onSubmit={submit} className="mb-6">
        <div className="relative">
          <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
          <input
            autoFocus
            type="search"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Search news, topics, people, places…"
            className="w-full pl-11 pr-12 py-3 rounded-full bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text)] placeholder-[var(--color-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-cobalt-600/40 focus:border-cobalt-600"
          />
          {draft && (
            <button
              type="button"
              onClick={clear}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-full hover:bg-[var(--color-surface2)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text)]"
              aria-label="Clear search"
            >
              <X size={16} />
            </button>
          )}
        </div>
      </form>

      {/* Empty state — landing view with suggested tags */}
      {!q && (
        <div className="space-y-8">
          <section>
            <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--color-text-tertiary)] mb-3">
              Trending searches
            </h2>
            <div className="flex flex-wrap gap-2">
              {SUGGESTED.map(t => (
                <Link
                  key={t.slug}
                  to={`/tag/${t.slug}`}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-cobalt-50 hover:text-cobalt-700 dark:hover:bg-cobalt-950/40 dark:hover:text-cobalt-300 transition-colors"
                >
                  <span aria-hidden="true">{t.emoji}</span>
                  {t.name}
                </Link>
              ))}
            </div>
          </section>

          <div className="text-center py-12 text-sm text-[var(--color-text-tertiary)]">
            <ScoopMascot size="md" mood="reading" animated />
            <p className="mt-3">Type a query above or pick a trending tag to start.</p>
          </div>
        </div>
      )}

      {/* Results */}
      {q && articles.length === 0 && !isLoading && !error && (
        <div className="text-center py-12">
          <ScoopMascot size="md" mood="reading" animated />
          <p className="mt-3 text-lg font-semibold">No matches for "{q}"</p>
          <p className="text-sm text-[var(--color-text-tertiary)] mt-1">
            Try a broader keyword, or browse the
            {" "}<Link to="/" className="text-cobalt-600 hover:underline">latest stories</Link>.
          </p>
        </div>
      )}

      {q && (
        <NewsGrid
          articles={articles}
          isLoading={isLoading}
          error={error}
          onRefresh={refetch}
        />
      )}
    </>
  );
}
