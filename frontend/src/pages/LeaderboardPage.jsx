/**
 * LeaderboardPage — /leaderboard — Brier-scored top forecasters.
 *
 * Reads /api/synthetic-markets/leaderboard. Lower Brier = better-calibrated.
 * Reputation is a smoothed [0,1] derived from Brier so we have a stable
 * ranking signal even with tiny samples.
 */
import { Trophy, Crown, Star } from "lucide-react";
import { useLeaderboard } from "../hooks/useSyntheticMarkets";
import { COPY } from "../lib/copyGuide";

function fmtBrier(b) {
  if (b == null) return "—";
  return b.toFixed(3);
}
function fmtRep(r) {
  if (r == null) return "—";
  return `${(r * 100).toFixed(1)}%`;
}

function rankBadge(idx) {
  if (idx === 0) return { Icon: Crown, color: "text-amber-500" };
  if (idx === 1) return { Icon: Trophy, color: "text-gray-400" };
  if (idx === 2) return { Icon: Trophy, color: "text-amber-700" };
  return { Icon: Star, color: "text-[var(--color-text-tertiary)]" };
}

export default function LeaderboardPage() {
  const { data, isLoading } = useLeaderboard({ limit: 100 });
  const items = data?.items ?? [];

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
      <header className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <Trophy size={18} className="text-[var(--color-accent)]" />
          <h1 className="font-editorial italic text-2xl text-[var(--color-text)]">Leaderboard</h1>
        </div>
        <p className="text-sm text-[var(--color-text-secondary)]">
          {COPY.brandTagline} Top forecasters by Brier score on Scoopfeeds Synthetic markets. Lower Brier = better calibrated.
        </p>
      </header>

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-14 rounded-lg bg-[var(--color-surface-2)] animate-pulse" />)}</div>
      ) : items.length === 0 ? (
        <p className="text-sm text-[var(--color-text-secondary)] py-12 text-center">
          No ranked forecasters yet — trade ≥3 resolved synthetic markets to appear here.
        </p>
      ) : (
        <ol className="space-y-2">
          {items.map((u, idx) => {
            const { Icon, color } = rankBadge(idx);
            return (
              <li key={u.user_id} className="flex items-center gap-3 p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
                <span className={`flex items-center gap-1 w-12 text-xs font-semibold ${color}`}>
                  <Icon size={13} fill={idx < 3 ? "currentColor" : "none"} />
                  {idx + 1}
                </span>
                <span className="flex-1 text-sm font-medium text-[var(--color-text)]">{u.handle}</span>
                <span className="text-xs text-[var(--color-text-secondary)] tabular-nums w-20 text-right">{u.trades_resolved} trades</span>
                <span className="text-xs text-[var(--color-text-secondary)] tabular-nums w-16 text-right">Brier {fmtBrier(u.brier_score)}</span>
                <span className="text-sm font-semibold tabular-nums w-16 text-right text-[var(--color-accent)]">{fmtRep(u.reputation)}</span>
              </li>
            );
          })}
        </ol>
      )}

      <p className="text-[10px] text-[var(--color-text-tertiary)] italic mt-6 text-center">
        Reputation = 0.5 + (1 − Brier) × 0.5. Floors at 0.5 to avoid penalising small samples.
      </p>
    </div>
  );
}
