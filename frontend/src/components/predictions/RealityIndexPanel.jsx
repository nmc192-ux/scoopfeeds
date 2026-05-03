/**
 * RealityIndexPanel — sits in the article reader.
 *
 * Given an article ID, fetches markets bound to its cluster(s) and renders
 * a tight panel: header + 1-3 market rows. Each row shows ProbabilityBar,
 * confidence dots, the LLM rationale ("why this market"), and an outbound
 * link to the source.
 *
 * Hides itself entirely when no markets are bound — no empty state on
 * articles that don't yet have predictions, so the panel adds noise only
 * when it has something useful to say.
 */

import { ExternalLink, Activity } from "lucide-react";
import { useArticlePredictions } from "../../hooks/usePredictions";
import { COPY } from "../../lib/copyGuide";
import { useT } from "../../lib/i18n";
import { formatMoney, formatDistanceToEnd } from "../../lib/predictionFormat";
import ProbabilityBar from "./ProbabilityBar";
import ConfidenceDots from "./ConfidenceDots";

export default function RealityIndexPanel({ articleId }) {
  const { t } = useT();
  const { data, isLoading, error } = useArticlePredictions(articleId);

  if (isLoading) {
    return (
      <div className="my-6 p-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] animate-pulse">
        <div className="h-4 w-40 bg-[var(--color-surface2)] rounded mb-3" />
        <div className="h-8 bg-[var(--color-surface2)] rounded" />
      </div>
    );
  }

  const markets = data?.data || [];
  if (error || !markets.length) return null;          // hide entirely on no-match

  return (
    <section
      className="my-6 p-5 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]"
      aria-labelledby="reality-index-title"
    >
      <header className="flex items-baseline justify-between mb-1 gap-3">
        <div className="flex items-center gap-2">
          <Activity size={16} className="text-[var(--color-accent)]" aria-hidden="true" />
          <h3 id="reality-index-title" className="font-editorial italic text-base sm:text-lg text-[var(--color-text)]">
            {COPY.panelTitle(t)}
          </h3>
        </div>
        <span className="text-[10px] uppercase tracking-wider text-[var(--color-text-tertiary)]">
          {COPY.brandTagline(t)}
        </span>
      </header>
      <p className="text-xs text-[var(--color-text-secondary)] mb-4">
        {COPY.panelSubtitle}
      </p>

      <ul className="space-y-4">
        {markets.map(m => <MarketRow key={m.id} market={m} />)}
      </ul>

      <p className="mt-4 text-[10px] text-[var(--color-text-tertiary)] italic">
        {COPY.probabilityNote(t)}
      </p>
    </section>
  );
}

function MarketRow({ market }) {
  const ends = market.end_date ? formatDistanceToEnd(market.end_date) : null;
  const vol  = formatMoney(market.volume_24h);
  const liq  = formatMoney(market.liquidity);
  const reason = market.link?.reason;

  return (
    <li className="border-t border-dashed border-[var(--color-border)] pt-4 first:border-0 first:pt-0">
      <div className="flex items-start justify-between gap-3 mb-2">
        <p className="text-sm font-medium text-[var(--color-text)] leading-snug">
          {market.question}
        </p>
        {market.url && (
          <a
            href={market.url}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 inline-flex items-center gap-1 text-[11px] text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] transition-colors"
            title={COPY.sourceLabel(market.source)}
          >
            {COPY.sourceLabel(market.source)}
            <ExternalLink size={11} />
          </a>
        )}
      </div>

      <ProbabilityBar
        yesPrice={market.yes_price}
        noPrice={market.no_price}
        size="md"
      />

      <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-[var(--color-text-tertiary)]">
        <div className="flex items-center gap-3">
          <span title={`Volume 24h ${vol}`}>Vol {vol}</span>
          <span className="opacity-50">·</span>
          <span title={`Liquidity ${liq}`}>Liq {liq}</span>
          {ends && (
            <>
              <span className="opacity-50">·</span>
              <span>{ends}</span>
            </>
          )}
        </div>
        {market.confidence && (
          <ConfidenceDots confidence={market.confidence} size="sm" />
        )}
      </div>

      {reason && (
        <p className="mt-2 text-[11px] text-[var(--color-text-secondary)] italic leading-relaxed">
          {reason}
        </p>
      )}
    </li>
  );
}
