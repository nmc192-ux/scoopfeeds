/**
 * PredictionsPage — minimal /predictions index for Phase 1.
 *
 * Lists active markets sorted by 24h volume. Each row shows the market
 * question, ProbabilityBar, confidence dots, microstructure footnotes
 * (volume / liquidity / time-to-end), and a link to the source.
 *
 * Phase 5 will replace this with a fully-featured Bloomberg-lite finance
 * terminal across crypto, macro, sectors, etc. For now: clean, scannable
 * proof that the data pipeline is real.
 */

import { useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink, Activity } from "lucide-react";
import { usePredictions } from "../hooks/usePredictions";
import { COPY } from "../lib/copyGuide";
import { formatMoney, formatDistanceToEnd } from "../lib/predictionFormat";
import ProbabilityBar from "../components/predictions/ProbabilityBar";
import ConfidenceDots from "../components/predictions/ConfidenceDots";
import WatchButton    from "../components/predictions/WatchButton";

const CATEGORIES = [
  { id: "",          label: "All" },
  { id: "Politics",  label: "Politics" },
  { id: "Crypto",    label: "Crypto" },
  { id: "Sports",    label: "Sports" },
  { id: "Economy",   label: "Economy" },
  { id: "Geopolitics", label: "Geopolitics" },
];

export default function PredictionsPage() {
  const [category, setCategory] = useState("");
  const { data, isLoading, error } = usePredictions({
    category: category || undefined,
    minVolume: 1000,
    limit: 50,
  });

  const markets = data?.data || [];

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
      <header className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <Activity size={18} className="text-[var(--color-accent)]" />
          <h1 className="font-editorial italic text-2xl sm:text-3xl text-[var(--color-text)]">
            {COPY.panelTitle}
          </h1>
        </div>
        <p className="text-sm text-[var(--color-text-secondary)]">
          {COPY.brandTagline} {COPY.panelSubtitle}
        </p>
      </header>

      {/* Category filter */}
      <div className="mb-5 flex flex-wrap gap-2">
        {CATEGORIES.map(c => (
          <button
            key={c.id}
            onClick={() => setCategory(c.id)}
            className={
              "px-3 py-1.5 text-xs rounded-full border transition-colors " +
              (c.id === category
                ? "bg-[var(--color-accent)] text-white border-[var(--color-accent)]"
                : "bg-[var(--color-surface)] text-[var(--color-text-secondary)] border-[var(--color-border)] hover:border-[var(--color-accent)]")
            }
          >
            {c.label}
          </button>
        ))}
      </div>

      {isLoading && <SkeletonList />}
      {error && (
        <p className="text-sm text-rose-500">Couldn't load markets right now.</p>
      )}

      {!isLoading && !error && (
        markets.length === 0
          ? (
            <p className="text-sm text-[var(--color-text-secondary)]">
              No markets match this filter yet.
            </p>
          )
          : (
            <ul className="divide-y divide-[var(--color-border)]">
              {markets.map(m => <Row key={m.id} market={m} />)}
            </ul>
          )
      )}

      <p className="mt-8 text-[11px] text-[var(--color-text-tertiary)] italic">
        {COPY.probabilityNote} Data refreshes every 15 minutes.
      </p>
    </div>
  );
}

function Row({ market }) {
  const ends = market.end_date ? formatDistanceToEnd(market.end_date) : null;

  return (
    <li className="py-4 grid grid-cols-12 gap-3 items-center">
      <div className="col-span-12 sm:col-span-7 min-w-0">
        <p className="text-sm font-medium text-[var(--color-text)] truncate sm:whitespace-normal">
          {market.question}
        </p>
        <div className="mt-1 flex items-center gap-3 text-[11px] text-[var(--color-text-tertiary)]">
          <span>{market.source}</span>
          {market.category && (
            <>
              <span className="opacity-50">·</span>
              <span>{market.category}</span>
            </>
          )}
          {ends && (
            <>
              <span className="opacity-50">·</span>
              <span>{ends}</span>
            </>
          )}
          <ConfidenceDots confidence={market.confidence} size="sm" className="ml-1" />
        </div>
      </div>
      <div className="col-span-9 sm:col-span-4">
        <ProbabilityBar yesPrice={market.yes_price} noPrice={market.no_price} size="sm" />
        <div className="mt-1 text-[10px] text-[var(--color-text-tertiary)]">
          Vol {formatMoney(market.volume_24h)} · Liq {formatMoney(market.liquidity)}
        </div>
      </div>
      <div className="col-span-3 sm:col-span-1 flex justify-end items-center gap-2">
        <WatchButton itemType="market" itemId={market.id} size="sm" />
        {market.url && (
          <a
            href={market.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] text-[var(--color-text-secondary)] hover:text-[var(--color-accent)]"
            aria-label={`Open on ${market.source}`}
          >
            Open <ExternalLink size={11} />
          </a>
        )}
      </div>
    </li>
  );
}

function SkeletonList() {
  return (
    <ul className="divide-y divide-[var(--color-border)] animate-pulse">
      {Array.from({ length: 6 }).map((_, i) => (
        <li key={i} className="py-4 grid grid-cols-12 gap-3 items-center">
          <div className="col-span-12 sm:col-span-7">
            <div className="h-4 w-3/4 bg-[var(--color-surface2)] rounded" />
            <div className="mt-2 h-3 w-1/3 bg-[var(--color-surface2)] rounded" />
          </div>
          <div className="col-span-9 sm:col-span-4">
            <div className="h-2.5 w-full bg-[var(--color-surface2)] rounded-full" />
          </div>
          <div className="col-span-3 sm:col-span-1 h-3 bg-[var(--color-surface2)] rounded" />
        </li>
      ))}
    </ul>
  );
}
