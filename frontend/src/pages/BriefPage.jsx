/**
 * BriefPage — /briefs/:slug — single brief reader.
 *
 * Renders the markdown body with inline citation badges. Each evidence
 * entry is shown in a footer panel so the reader can audit grounding.
 */
import { Link, useParams } from "react-router-dom";
import { ChevronLeft, ShieldCheck, Activity } from "lucide-react";
import { useBrief } from "../hooks/useBriefs";
import { COPY } from "../lib/copyGuide";
import { useT } from "../lib/i18n";

function citationKindLabel(k) {
  switch (k) {
    case "market":   return "Market";
    case "article":  return "Article";
    case "sentiment": return "Sentiment";
    default: return k;
  }
}

// Lightweight Markdown renderer for our limited subset:
// paragraphs, **bold**, _italic_, and [bracket:id] citations.
function renderMd(md) {
  if (!md) return null;
  const paras = md.split(/\n\n+/);
  return paras.map((p, i) => {
    const tokens = [];
    let last = 0;
    const re = /\[([a-z]+):([^\]]+)\]/g;
    let m;
    while ((m = re.exec(p)) !== null) {
      if (m.index > last) tokens.push({ kind: "text", value: p.slice(last, m.index) });
      tokens.push({ kind: "cite", citeKind: m[1], citeId: m[2] });
      last = m.index + m[0].length;
    }
    if (last < p.length) tokens.push({ kind: "text", value: p.slice(last) });
    return (
      <p key={i} className="text-[var(--color-text)] leading-relaxed mb-4 text-base">
        {tokens.map((t, j) =>
          t.kind === "text" ? (
            <span key={j} dangerouslySetInnerHTML={{ __html:
              t.value
                .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                .replace(/_(.+?)_/g, '<em>$1</em>')
            }} />
          ) : (
            <sup key={j} className="ml-0.5 px-1 py-0.5 rounded text-[9px] font-semibold bg-[var(--color-accent)]/10 text-[var(--color-accent)]" title={`${t.citeKind}:${t.citeId}`}>
              {citationKindLabel(t.citeKind)[0]}
            </sup>
          )
        )}
      </p>
    );
  });
}

export default function BriefPage() {
  const { t } = useT();
  const { slug } = useParams();
  const { data: b, isLoading, error } = useBrief(slug);

  if (isLoading) return <div className="max-w-3xl mx-auto px-4 py-10"><div className="h-6 w-2/3 bg-[var(--color-surface-2)] animate-pulse rounded mb-4" /><div className="h-32 bg-[var(--color-surface-2)] animate-pulse rounded" /></div>;
  if (error || !b) return (
    <div className="max-w-3xl mx-auto px-4 py-16 text-center text-sm text-[var(--color-text-secondary)]">
      Brief not found. <Link to="/briefs" className="text-[var(--color-accent)] underline">All briefs</Link>
    </div>
  );

  return (
    <article className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
      <Link to="/briefs" className="inline-flex items-center gap-1 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text)] mb-5">
        <ChevronLeft size={13} /> All briefs
      </Link>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[var(--color-accent)]/10 text-[var(--color-accent)]">
          <ShieldCheck size={10} /> {COPY.briefBadge(t)}
        </span>
        {b.confidence != null && (
          <span className="text-[10px] text-[var(--color-text-secondary)] tabular-nums">
            Confidence {Math.round(b.confidence * 100)}%
          </span>
        )}
        {b.provider && (
          <span className="text-[10px] text-[var(--color-text-tertiary)] tabular-nums">via {b.provider}</span>
        )}
      </div>

      <h1 className="font-editorial italic text-3xl leading-tight text-[var(--color-text)] mb-3">{b.title}</h1>
      <p className="text-lg text-[var(--color-text-secondary)] leading-snug mb-6 italic">{b.thesis}</p>

      <div className="prose prose-sm max-w-none">
        {renderMd(b.body_md)}
      </div>

      {b.evidence?.length > 0 && (
        <section className="mt-8 pt-5 border-t border-[var(--color-border)]">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)] mb-3 flex items-center gap-1.5">
            <Activity size={11} /> Evidence
          </h3>
          <ol className="space-y-2 list-decimal pl-5 text-sm">
            {b.evidence.map((e, i) => (
              <li key={i} className="text-[var(--color-text-secondary)]">
                <span className="font-semibold text-[var(--color-text)]">{citationKindLabel(e.kind)}:</span>{" "}
                <span>{e.claim}</span>
                <code className="ml-2 text-[10px] text-[var(--color-text-tertiary)] font-mono break-all">{e.ref_id}</code>
              </li>
            ))}
          </ol>
        </section>
      )}

      <p className="text-[10px] text-[var(--color-text-tertiary)] italic mt-8 text-center">{COPY.brandTagline(t)}</p>
    </article>
  );
}
