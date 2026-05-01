/**
 * AnalysisPage — `/analysis`
 *
 * The AI analysis hub. Four sections:
 *   A. Explained Hero    — top long-form AI explainer
 *   B. Story Briefings   — horizontal-scroll row of story cluster cards
 *   C. Topic Trends      — bar chart of 72h coverage volume
 *   D. Perspective Compare — expandable source-framing panels
 */
import { useEffect } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, Sparkles } from "lucide-react";
import { useStoryClusters, useExplainedList } from "../hooks/useAnalysis";
import ExplainedHero from "../components/analysis/ExplainedHero";
import TopicTrendChart from "../components/analysis/TopicTrendChart";
import PerspectivePanel from "../components/analysis/PerspectivePanel";
import ScoopMascot from "../components/mascot/ScoopMascot";

export default function AnalysisPage() {
  const { data: clusters = [], isLoading: clustersLoading } = useStoryClusters();
  const { data: explained = [] } = useExplainedList();

  useEffect(() => {
    const prev = document.title;
    document.title = "News Analysis — Scoopfeeds";
    return () => { document.title = prev; };
  }, []);

  const topExplained  = explained[0] || null;
  const withPersp     = clusters.filter(cl => cl.perspectives?.length);

  return (
    <>
      {/* Page header — matches SavedPage pattern */}
      <div className="flex items-center gap-3 mb-6">
        <Link
          to="/"
          className="p-2 rounded-full hover:bg-[var(--color-surface2)] transition-colors"
          aria-label="Back to home"
        >
          <ChevronLeft size={18} />
        </Link>
        <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0
                        bg-electric-50 text-electric-600">
          <Sparkles size={18} />
        </div>
        <div>
          <h1
            className="text-2xl sm:text-3xl font-bold tracking-tight"
            style={{ fontFamily: "'Playfair Display', serif", fontStyle: "italic" }}
          >
            News Analysis
          </h1>
          <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">
            AI-powered insights synthesised from across the feed
          </p>
        </div>
      </div>

      <div className="space-y-8">
        {/* ── A. Explained Hero ──────────────────────────────────────────── */}
        {topExplained && (
          <section>
            <SectionLabel label="Deep Dive" subtitle="In-depth AI analysis" />
            <ExplainedHero piece={topExplained} />
          </section>
        )}

        {/* ── B. Story Briefings ────────────────────────────────────────── */}
        {clusters.length > 0 && (
          <section>
            <SectionLabel label="Story Briefings" count={clusters.length} />
            <div className="flex gap-3 overflow-x-auto pb-2 snap-x snap-mandatory -mx-4 px-4
                            scrollbar-hide">
              {clusters.map(cl => (
                <Link
                  key={cl.id}
                  to={`/analysis`}
                  state={{ clusterId: cl.id }}
                  className="snap-start shrink-0 w-64 sm:w-72 rounded-2xl border
                             border-[var(--color-border)] bg-[var(--color-surface)] p-4
                             hover:border-electric-400 transition-colors"
                >
                  <span className="text-[10px] font-bold uppercase tracking-wider text-electric-600">
                    {cl.article_count} sources · {cl.category}
                  </span>
                  <h4
                    className="mt-1.5 text-sm leading-snug text-[var(--color-text)] line-clamp-3"
                    style={{ fontFamily: "'Playfair Display', serif", fontStyle: "italic" }}
                  >
                    {cl.title}
                  </h4>
                  {cl.summary && (
                    <p className="mt-1.5 text-[11px] text-[var(--color-text-tertiary)] line-clamp-2">
                      {cl.summary}
                    </p>
                  )}
                  {cl.brief?.[0] && (
                    <p className="mt-2 text-[10px] text-[var(--color-text-tertiary)] line-clamp-2
                                   border-l-2 border-electric-400 pl-2 italic">
                      {cl.brief[0].text}
                    </p>
                  )}
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* ── C. Topic Trends chart ─────────────────────────────────────── */}
        <section>
          <SectionLabel label="Topic Trends" subtitle="72h coverage volume" />
          <TopicTrendChart />
        </section>

        {/* ── D. Perspective Compare ────────────────────────────────────── */}
        {withPersp.length > 0 && (
          <section>
            <SectionLabel label="Perspective Compare" subtitle="How sources frame the story" />
            <div className="space-y-3">
              {withPersp.slice(0, 3).map(cl => (
                <PerspectivePanel key={cl.id} cluster={cl} />
              ))}
            </div>
          </section>
        )}

        {/* ── Empty state ────────────────────────────────────────────────── */}
        {!clustersLoading && clusters.length === 0 && !topExplained && (
          <div className="flex flex-col items-center gap-4 py-20 text-center">
            <ScoopMascot size="lg" animated />
            <div className="max-w-sm">
              <p className="text-lg font-semibold text-[var(--color-text)]">
                Analysis generating…
              </p>
              <p className="text-sm text-[var(--color-text-tertiary)] mt-1.5">
                The AI pipeline runs 5 minutes after server start and every 2 hours
                after that. Check back shortly.
              </p>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function SectionLabel({ label, subtitle, count }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h2 className="text-base font-bold text-[var(--color-text)]">
        {label}
        {count != null && (
          <span className="ml-2 text-xs font-normal text-[var(--color-text-tertiary)]">
            ({count})
          </span>
        )}
      </h2>
      {subtitle && (
        <span className="text-xs text-[var(--color-text-tertiary)]">{subtitle}</span>
      )}
    </div>
  );
}
