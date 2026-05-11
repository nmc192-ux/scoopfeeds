/**
 * ArticlePage — `/article/:id`
 *
 * Standalone article view. When users land here directly (shared link, push
 * notification, search result), they see a full-page reader. When the same
 * URL is visited from inside the app, the existing in-feed modal reader still
 * takes over — this component is the canonical address for an article.
 *
 * Flow:
 *  1. Fetch the article metadata from /api/news/:id.
 *  2. Open the reader store with that article so ReaderModal renders the body.
 *  3. If the user closes the reader, navigate back to home (the URL no longer
 *     points at a meaningful resource on its own).
 */
import { useEffect, useRef } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import axios from "axios";
import { useQuery } from "@tanstack/react-query";
import { Loader2, ChevronLeft, ExternalLink } from "lucide-react";
import { useReaderStore } from "../hooks/useReader";

async function fetchArticle(id) {
  const { data } = await axios.get(`/api/news/${encodeURIComponent(id)}`);
  return data?.article || data?.data || data;
}

export default function ArticlePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { openReader, open } = useReaderStore();
  // Tracks whether we've already auto-opened the reader for this page mount.
  // Needed to distinguish "initial pre-open state" (open=false because nothing
  // has opened it yet — auto-open) from "user just closed it" (open=false
  // because user clicked X — navigate home, don't re-open). Without this
  // guard the useEffect re-fires on close and traps the user in the modal.
  const hasOpenedRef = useRef(false);

  const { data: article, isLoading, isError } = useQuery({
    queryKey: ["article", id],
    queryFn: () => fetchArticle(id),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  // Once we have the article, hand it to the reader store so the existing
  // ReaderModal — already mounted globally — renders the body. This is the
  // "URL-addressable modal" pattern: every article state has a real URL,
  // but the rendering itself reuses one component. Runs only on first
  // load (gated by hasOpenedRef) so user-initiated close doesn't re-trap.
  useEffect(() => {
    if (article && !open && !hasOpenedRef.current) {
      hasOpenedRef.current = true;
      openReader(article);
    }
  }, [article, open, openReader]);

  // After auto-open, honor the file-header step 3: when the user closes the
  // reader, navigate to home. The URL no longer points at a meaningful
  // resource on its own. replace:true prevents a back-button loop into the
  // just-closed article modal.
  useEffect(() => {
    if (hasOpenedRef.current && !open) {
      navigate("/", { replace: true });
    }
  }, [open, navigate]);

  // SEO meta — replaced once article loads
  useEffect(() => {
    if (!article) return;
    const prevTitle = document.title;
    const prevDescEl = document.querySelector('meta[name="description"]');
    const prevDesc   = prevDescEl?.getAttribute("content");
    document.title = `${article.title} — Scoopfeeds`;
    if (prevDescEl && article.description) {
      prevDescEl.setAttribute("content", article.description.slice(0, 160));
    }
    return () => {
      document.title = prevTitle;
      if (prevDescEl && prevDesc) prevDescEl.setAttribute("content", prevDesc);
    };
  }, [article]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 size={28} className="text-electric-600 animate-spin" />
      </div>
    );
  }

  if (isError || !article) {
    return (
      <div className="text-center py-20">
        <p className="text-2xl font-semibold mb-2">Article not found</p>
        <p className="text-[var(--color-text-tertiary)] mb-6">
          The link may be broken or the story has been removed.
        </p>
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-electric-600 text-white text-sm font-semibold hover:bg-electric-700 transition-colors"
        >
          <ChevronLeft size={14} />
          Back to home
        </Link>
      </div>
    );
  }

  // Fallback view shown beneath the modal — visible while the modal is
  // mounting/closing. Also used by SEO crawlers and screen readers.
  return (
    <article className="max-w-2xl mx-auto py-4">
      <button
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-1.5 text-sm text-[var(--color-text-tertiary)] hover:text-[var(--color-text)] mb-6 transition-colors"
      >
        <ChevronLeft size={14} />
        Back
      </button>

      {article.image_url && (
        <img
          src={article.image_url}
          alt={article.title}
          className="w-full aspect-video object-cover rounded-2xl mb-6"
        />
      )}

      <p className="text-xs uppercase tracking-wider text-[var(--color-text-tertiary)] mb-2">
        {article.source_name} · {article.category}
      </p>

      <h1
        className="text-3xl sm:text-4xl font-bold leading-tight mb-4"
        style={{ fontFamily: "'Playfair Display', serif" }}
      >
        {article.title}
      </h1>

      {article.description && (
        <p className="text-lg text-[var(--color-text-secondary)] leading-relaxed mb-6">
          {article.description}
        </p>
      )}

      <a
        href={article.url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-electric-600 hover:bg-electric-700 text-white text-sm font-semibold transition-colors"
      >
        <ExternalLink size={13} />
        Read full article
      </a>
    </article>
  );
}
