/**
 * AnalysisExplainedPage — `/analysis/explained/:slug`
 *
 * Full long-form AI explainer page. Sections:
 *   • Hero image + title + summary
 *   • Key Numbers (FactTile grid)
 *   • Timeline (vertical with dots)
 *   • Article body HTML (Gemini-generated, rendered in reader-body prose)
 *   • Source list
 */
import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { ChevronLeft, ExternalLink } from "lucide-react";
import { useExplainedPiece } from "../hooks/useAnalysis";
import FactTile from "../components/analysis/FactTile";
import SafeImage from "../components/ui/SafeImage";

export default function AnalysisExplainedPage() {
  const { slug } = useParams();
  const { data: piece, isLoading } = useExplainedPiece(slug);

  useEffect(() => {
    const prev = document.title;
    document.title = piece
      ? `${piece.title} — Scoopfeeds Analysis`
      : "Analysis — Scoopfeeds";
    return () => { document.title = prev; };
  }, [piece]);

  if (isLoading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-8 w-32 rounded bg-[var(--color-surface2)]" />
        <div className="h-56 sm:h-80 rounded-2xl bg-[var(--color-surface2)]" />
        <div className="h-8 w-3/4 rounded bg-[var(--color-surface2)]" />
        <div className="h-4 rounded bg-[var(--color-surface2)]" />
        <div className="h-4 w-5/6 rounded bg-[var(--color-surface2)]" />
        <div className="h-4 w-4/6 rounded bg-[var(--color-surface2)]" />
      </div>
    );
  }

  if (!piece) {
    return (
      <div className="text-center py-20">
        <p className="text-4xl mb-3">📰</p>
        <p className="text-lg font-semibold text-[var(--color-text)]">
          Piece not found
        </p>
        <p className="text-sm text-[var(--color-text-tertiary)] mt-1">
          It may have expired or the link is broken.
        </p>
        <Link
          to="/analysis"
          className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold
                     text-electric-600 hover:underline"
        >
          <ChevronLeft size={14} /> Back to Analysis
        </Link>
      </div>
    );
  }

  return (
    <>
      {/* Back breadcrumb */}
      <div className="flex items-center gap-2 mb-6">
        <Link
          to="/analysis"
          className="p-2 rounded-full hover:bg-[var(--color-surface2)] transition-colors"
          aria-label="Back to analysis"
        >
          <ChevronLeft size={18} />
        </Link>
        <span className="text-xs text-[var(--color-text-tertiary)] uppercase tracking-wider">
          Analysis / Explained
        </span>
      </div>

      {/* Hero image */}
      {piece.image_url && (
        <div className="w-full h-52 sm:h-80 rounded-2xl overflow-hidden mb-6">
          <SafeImage
            src={piece.image_url}
            alt=""
            className="w-full h-full"
            imgClassName="w-full h-full object-cover"
          />
        </div>
      )}

      {/* Title block */}
      <span className="text-xs font-bold uppercase tracking-wider text-electric-600">
        Explained — {piece.category}
      </span>
      <h1
        className="mt-2 text-2xl sm:text-3xl leading-tight text-[var(--color-text)]"
        style={{ fontFamily: "'Playfair Display', serif", fontStyle: "italic" }}
      >
        {piece.title}
      </h1>
      {piece.summary && (
        <p className="mt-3 text-base sm:text-lg text-[var(--color-text-secondary)] leading-relaxed">
          {piece.summary}
        </p>
      )}

      {/* ── Key Numbers ─────────────────────────────────────────────── */}
      {piece.facts?.length > 0 && (
        <section className="mt-8">
          <h2 className="text-xs uppercase tracking-wider font-bold
                         text-[var(--color-text-tertiary)] mb-3">
            Key Numbers
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {piece.facts.map((f, i) => <FactTile key={i} fact={f} />)}
          </div>
        </section>
      )}

      {/* ── Timeline ─────────────────────────────────────────────────── */}
      {piece.timeline?.length > 0 && (
        <section className="mt-8">
          <h2 className="text-xs uppercase tracking-wider font-bold
                         text-[var(--color-text-tertiary)] mb-3">
            Timeline
          </h2>
          <div className="space-y-0">
            {piece.timeline.map((t, i) => (
              <div key={i} className="flex gap-3">
                {/* Spine */}
                <div className="flex flex-col items-center pt-1">
                  <div className="w-2.5 h-2.5 rounded-full bg-electric-500 shrink-0" />
                  {i < piece.timeline.length - 1 && (
                    <div className="w-0.5 flex-1 bg-[var(--color-border)] my-1" />
                  )}
                </div>
                {/* Content */}
                <div className="pb-4">
                  <span className="text-xs font-bold text-electric-600">{t.date}</span>
                  <p className="text-sm text-[var(--color-text)] mt-0.5 leading-snug">
                    {t.event}
                  </p>
                  {t.source && (
                    <span className="text-[10px] text-[var(--color-text-tertiary)]">
                      {t.source}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Article body ─────────────────────────────────────────────── */}
      {piece.content && (
        <section className="mt-8">
          <article
            className="reader-body prose prose-sm max-w-none
                       text-[var(--color-text)] leading-relaxed"
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: piece.content }}
          />
        </section>
      )}

      {/* ── Sources ───────────────────────────────────────────────────── */}
      {piece.sources?.length > 0 && (
        <section className="mt-8 pt-6 border-t border-[var(--color-border)]">
          <h2 className="text-xs uppercase tracking-wider font-bold
                         text-[var(--color-text-tertiary)] mb-3">
            Sources
          </h2>
          <div className="flex flex-wrap gap-2">
            {piece.sources.map((s, i) => (
              <a
                key={i}
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs font-medium text-electric-600
                           hover:underline"
              >
                <ExternalLink size={11} /> {s.name}
              </a>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
