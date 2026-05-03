/**
 * BriefsPage — /briefs — gallery of published analyst briefs.
 *
 * All briefs here are editor-approved (status='published'). Each one was
 * drafted by an LLM, then human-reviewed in /scoop-ops/briefs.
 *
 * The "AI-drafted, editor-reviewed" badge is non-negotiable per
 * plan §5D-bis.
 */
import { Link } from "react-router-dom";
import { FileText, ShieldCheck } from "lucide-react";
import { useBriefs } from "../hooks/useBriefs";
import { COPY } from "../lib/copyGuide";
import { useT } from "../lib/i18n";

function relTime(ms) {
  if (!ms) return "";
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export default function BriefsPage() {
  const { t } = useT();
  const { data, isLoading } = useBriefs({ limit: 30 });
  const items = data?.items ?? [];

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-2">
          <FileText size={18} className="text-[var(--color-accent)]" />
          <h1 className="font-editorial italic text-2xl text-[var(--color-text)]">Analyst Briefs</h1>
          <span className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[var(--color-accent)]/10 text-[var(--color-accent)]">
            <ShieldCheck size={10} /> {COPY.briefBadge(t)}
          </span>
        </div>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Short, evidence-grounded analyst briefs — drafted by an LLM, reviewed by an editor before publication. Every claim cites a source.
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 rounded-lg bg-[var(--color-surface-2)] animate-pulse" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-[var(--color-text-secondary)] py-12 text-center">
          No briefs published yet — check back soon.
        </p>
      ) : (
        <div className="space-y-3">
          {items.map(b => (
            <Link key={b.slug} to={`/briefs/${b.slug}`}
                  className="block rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-accent)] hover:shadow-sm p-4 transition-all">
              <h2 className="text-base font-semibold text-[var(--color-text)] leading-snug mb-1">{b.title}</h2>
              <p className="text-sm text-[var(--color-text-secondary)] line-clamp-2 mb-2">{b.thesis}</p>
              <div className="flex items-center gap-3 text-[10px] text-[var(--color-text-tertiary)] tabular-nums">
                <span>{relTime(b.published_at)}</span>
                <span>·</span>
                <span>{b.evidence?.length ?? 0} citations</span>
                {b.confidence != null && <><span>·</span><span>Confidence {Math.round(b.confidence * 100)}%</span></>}
              </div>
            </Link>
          ))}
        </div>
      )}

      <p className="text-[10px] text-[var(--color-text-tertiary)] italic mt-8 text-center">{COPY.brandTagline(t)}</p>
    </div>
  );
}
