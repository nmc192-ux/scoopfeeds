/**
 * LeaderboardPage — /leaderboard — Brier-scored top forecasters.
 *
 * Two tabs: Humans (auth users with ≥3 resolved trades) and AI Agents
 * (skeptic / optimist / contrarian). Lower Brier = better calibrated.
 * Reputation is a smoothed [0,1] derived from Brier so we have a stable
 * ranking signal even with tiny samples.
 */
import { useState } from "react";
import { Trophy, Crown, Star, Bot, User } from "lucide-react";
import { useLeaderboard, useAgentLeaderboard } from "../hooks/useSyntheticMarkets";
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

const AGENT_DESCRIPTIONS = {
  skeptic:    "Mean-reversion: bets against extreme prices.",
  optimist:   "Conviction: trades with the Reality Index composite.",
  contrarian: "Fades anomalies: takes the opposite side of fresh shifts.",
};

function LeaderRow({ idx, name, label, sub, brier, trades, reputation }) {
  const { Icon, color } = rankBadge(idx);
  return (
    <li className="flex items-center gap-3 p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
      <span className={`flex items-center gap-1 w-12 text-xs font-semibold ${color}`}>
        <Icon size={13} fill={idx < 3 ? "currentColor" : "none"} />
        {idx + 1}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-[var(--color-text)] truncate">{name}</div>
        {sub && <div className="text-[10px] text-[var(--color-text-secondary)] truncate">{sub}</div>}
        {label && <div className="text-[10px] text-[var(--color-text-tertiary)]">{label}</div>}
      </div>
      <span className="text-xs text-[var(--color-text-secondary)] tabular-nums w-20 text-right">{trades} trades</span>
      <span className="text-xs text-[var(--color-text-secondary)] tabular-nums w-16 text-right">Brier {fmtBrier(brier)}</span>
      <span className="text-sm font-semibold tabular-nums w-16 text-right text-[var(--color-accent)]">{fmtRep(reputation)}</span>
    </li>
  );
}

export default function LeaderboardPage() {
  const [tab, setTab] = useState("humans");
  const { data: humansData, isLoading: humansLoading } = useLeaderboard({ limit: 100 });
  const { data: agentsData, isLoading: agentsLoading } = useAgentLeaderboard();

  const humans = humansData?.items ?? [];
  const agents = agentsData?.items ?? [];
  const isLoading = tab === "humans" ? humansLoading : agentsLoading;
  const items    = tab === "humans" ? humans : agents;

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

      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={() => setTab("humans")}
          className={`text-xs px-3 py-1.5 rounded-full border inline-flex items-center gap-1 transition-colors ${
            tab === "humans"
              ? "bg-[var(--color-accent)] text-white border-[var(--color-accent)]"
              : "border-[var(--color-border)] text-[var(--color-text-secondary)]"
          }`}
        >
          <User size={11} /> Humans <span className="opacity-70 tabular-nums">({humans.length})</span>
        </button>
        <button
          onClick={() => setTab("agents")}
          className={`text-xs px-3 py-1.5 rounded-full border inline-flex items-center gap-1 transition-colors ${
            tab === "agents"
              ? "bg-[var(--color-accent)] text-white border-[var(--color-accent)]"
              : "border-[var(--color-border)] text-[var(--color-text-secondary)]"
          }`}
        >
          <Bot size={11} /> AI Agents <span className="opacity-70 tabular-nums">({agents.length})</span>
        </button>
      </div>

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-14 rounded-lg bg-[var(--color-surface-2)] animate-pulse" />)}</div>
      ) : items.length === 0 ? (
        <p className="text-sm text-[var(--color-text-secondary)] py-12 text-center">
          {tab === "humans"
            ? "No ranked forecasters yet — trade ≥3 resolved synthetic markets to appear here."
            : "No agent stats yet — agents need at least one resolved market to score."}
        </p>
      ) : (
        <ol className="space-y-2">
          {items.map((row, idx) => tab === "humans" ? (
            <LeaderRow
              key={row.user_id}
              idx={idx}
              name={row.handle}
              brier={row.brier_score}
              trades={row.trades_resolved}
              reputation={row.reputation}
            />
          ) : (
            <LeaderRow
              key={row.agent_id}
              idx={idx}
              name={row.agent_id}
              sub={AGENT_DESCRIPTIONS[row.agent_id] || ""}
              brier={row.brier_score}
              trades={row.trades_resolved}
              reputation={row.reputation}
            />
          ))}
        </ol>
      )}

      <p className="text-[10px] text-[var(--color-text-tertiary)] italic mt-6 text-center">
        Reputation = 0.5 + (1 − Brier) × 0.5. Floors at 0.5 to avoid penalising small samples.
      </p>
    </div>
  );
}
