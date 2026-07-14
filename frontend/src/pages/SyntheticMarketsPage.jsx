/**
 * SyntheticMarketsPage — /synthetic — gallery of Scoopfeeds synthetic markets.
 *
 * Phase 6 surfaces the LLM-extracted + editor-created play-money markets.
 * Tabs for Open vs Resolved.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { Activity, Trophy, ShieldCheck } from "lucide-react";
import { useSyntheticMarkets } from "../hooks/useSyntheticMarkets";
import ProbabilityBar from "../components/predictions/ProbabilityBar";
import { COPY } from "../lib/copyGuide";

function fmtMoney(n) {
  if (!Number.isFinite(n)) return "—";
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}K`;
  return `$${Math.round(n)}`;
}

function relTime(ms) {
  if (!ms) return "";
  const diff = Date.now() - ms;
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function MarketCard({ m }) {
  const ends = m.end_date ? new Date(m.end_date).toISOString().slice(0, 10) : null;
  return (
    <Link
      to={`/synthetic/${m.id}`}
      className="block rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-accent)] transition-all p-4"
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-[var(--color-accent)]/10 text-[var(--color-accent)]">
          Scoopfeeds Synthetic
        </span>
        {m.resolved && (
          <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300">
            Resolved · {m.outcome}
          </span>
        )}
      </div>
      <h3 className="text-sm font-semibold text-[var(--color-text)] leading-snug mb-2 line-clamp-2">
        {m.question}
      </h3>
      <ProbabilityBar yesPrice={m.yes_price} noPrice={1 - m.yes_price} size="sm" showLabel={true} />
      <div className="flex items-center gap-3 mt-2 text-[10px] text-[var(--color-text-tertiary)] tabular-nums">
        <span>Vol {fmtMoney(m.total_volume)}</span>
        {ends && <span>· Ends {ends}</span>}
        <span className="ml-auto">Created {relTime(m.created_at)}</span>
      </div>
    </Link>
  );
}

export default function SyntheticMarketsPage() {
  const [tab, setTab] = useState("open");
  const { data, isLoading } = useSyntheticMarkets({ resolved: tab === "resolved", limit: 60 });
  const items = data?.items ?? [];

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
      <header className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <Activity size={18} className="text-[var(--color-accent)]" />
          <h1 className="font-editorial italic text-2xl text-[var(--color-text)]">Scoopfeeds Synthetic</h1>
          <span className="ml-2 inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[var(--color-accent)]/10 text-[var(--color-accent)]">
            <ShieldCheck size={10} /> Play money
          </span>
        </div>
        <p className="text-sm text-[var(--color-text-secondary)]">
          {COPY.brandTagline()} Binary markets for stories Polymarket doesn't cover. Editorial + LLM-drafted, you trade with virtual currency.
        </p>
      </header>

      <div className="flex items-center gap-2 mb-4">
        {["open", "resolved"].map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors capitalize ${
              tab === t
                ? "bg-[var(--color-accent)] text-white border-[var(--color-accent)]"
                : "border-[var(--color-border)] text-[var(--color-text-secondary)]"
            }`}
          >
            {t}
          </button>
        ))}
        <Link
          to="/leaderboard"
          className="ml-auto inline-flex items-center gap-1 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-accent)]"
        >
          <Trophy size={11} /> Leaderboard →
        </Link>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-32 rounded-lg bg-[var(--color-surface-2)] animate-pulse" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-[var(--color-text-secondary)] py-12 text-center">
          No {tab} synthetic markets yet. Editor + LLM extractor will populate this list as high-divergence events appear.
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {items.map(m => <MarketCard key={m.id} m={m} />)}
        </div>
      )}

      <p className="text-[10px] text-[var(--color-text-tertiary)] italic mt-6 text-center">
        {COPY.brandTagline()}
      </p>
    </div>
  );
}
