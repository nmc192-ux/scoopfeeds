/**
 * FinancePage — /finance — RI-aware finance terminal.
 *
 * Distinct from /markets (traditional indices/FX/commodities). This view
 * combines:
 *   • Top market movers (24h |delta|) — a mini Polymarket terminal
 *   • Sector breakdown by category (markets per sector + median yes_price)
 *   • Top finance/business events with truth-gap divergence
 *   • Recent published analyst briefs in the finance lane
 *
 * Phase 5 first cut. Charts (sector heatmap treemap) come later.
 */
import { Link } from "react-router-dom";
import { TrendingUp, Activity, FileText, Briefcase, ExternalLink } from "lucide-react";
import { usePredictions, usePredictionMovers } from "../hooks/usePredictions";
import { useTruthGap } from "../hooks/useTruthGap";
import { useBriefs } from "../hooks/useBriefs";
import ProbabilityBar from "../components/predictions/ProbabilityBar";
import TruthGapBadge  from "../components/predictions/TruthGapBadge";
import SectorHeatmap  from "../components/charts/SectorHeatmap";
import { COPY } from "../lib/copyGuide";

function fmtMoney(n) {
  if (!Number.isFinite(n)) return "—";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${Math.round(n)}`;
}
function fmtPct(v) { return Number.isFinite(v) ? `${Math.round(v * 100)}%` : "—"; }
function relTime(ms) {
  if (!ms) return "";
  const diff = Date.now() - ms;
  if (diff < 3600_000)  return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}

function Card({ icon: Icon, title, children, link }) {
  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wide font-semibold text-[var(--color-text-secondary)]">
          {Icon && <Icon size={12} className="text-[var(--color-accent)]" />}
          <span>{title}</span>
        </div>
        {link && <Link to={link} className="text-[10px] text-[var(--color-accent)] hover:underline">See all →</Link>}
      </div>
      {children}
    </section>
  );
}

export default function FinancePage() {
  const { data: moversData, isLoading: loadingMovers } = usePredictionMovers({ limit: 8 });
  const { data: marketsData, isLoading: loadingMarkets } = usePredictions({ limit: 60 });
  const { data: tgData, isLoading: loadingTg }       = useTruthGap({ direction: "both", limit: 8, windowMs: 7 * 24 * 60 * 60 * 1000 });
  const { data: briefsData }                          = useBriefs({ limit: 6 });

  const movers      = moversData?.data ?? [];
  const allMarkets  = marketsData?.data ?? [];
  const tg          = tgData?.items ?? [];
  const briefs      = briefsData?.items ?? [];

  // Derived: by-category breakdown
  const byCategory = (() => {
    const m = new Map();
    for (const x of allMarkets) {
      const k = x.category || "Uncategorized";
      if (!m.has(k)) m.set(k, { count: 0, vol: 0, yesSum: 0 });
      const cur = m.get(k);
      cur.count += 1;
      cur.vol += x.volume_24h || 0;
      cur.yesSum += (x.yes_price || 0);
    }
    return Array.from(m.entries())
      .map(([category, v]) => ({ category, count: v.count, vol: v.vol, avgYes: v.yesSum / v.count }))
      .sort((a, b) => b.vol - a.vol)
      .slice(0, 8);
  })();

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
      <header className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <Briefcase size={18} className="text-[var(--color-accent)]" />
          <h1 className="font-editorial italic text-2xl text-[var(--color-text)]">Finance</h1>
        </div>
        <p className="text-sm text-[var(--color-text-secondary)]">
          {COPY.brandTagline()} Reality Index across the global event-market complex.
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* Top movers */}
        <Card icon={TrendingUp} title="Top market movers (24h)" link="/predictions">
          {loadingMovers ? (
            <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-12 bg-[var(--color-surface-2)] animate-pulse rounded" />)}</div>
          ) : movers.length === 0 ? (
            <p className="text-xs text-[var(--color-text-secondary)]">No movers yet — check back as Polymarket data fills.</p>
          ) : (
            <ul className="divide-y divide-[var(--color-border)]">
              {movers.map(m => (
                <li key={m.id} className="py-2.5 flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[var(--color-text)] line-clamp-1">{m.question}</p>
                    <div className="flex items-center gap-3 mt-1 text-[10px] text-[var(--color-text-tertiary)] tabular-nums">
                      <span>{m.source}</span>
                      <span>Vol {fmtMoney(m.volume_24h)}</span>
                      {Number.isFinite(m.delta_24h) && (
                        <span className={m.delta_24h >= 0 ? "text-emerald-500" : "text-red-500"}>
                          {m.delta_24h >= 0 ? "+" : ""}{(m.delta_24h * 100).toFixed(1)}pp
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="w-32 flex-shrink-0">
                    <ProbabilityBar yesPrice={m.yes_price} noPrice={1 - m.yes_price} size="sm" showLabel={false} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Sector breakdown */}
        <Card icon={Activity} title="Sectors" link="/predictions">
          {loadingMarkets ? (
            <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-8 bg-[var(--color-surface-2)] animate-pulse rounded" />)}</div>
          ) : (
            <>
              {/* Treemap: cell area ∝ 24h volume, color ∝ avg YES price.
                  Quick read of which sectors are loud and which way they're leaning. */}
              <div className="mb-3">
                <SectorHeatmap
                  items={byCategory.map(s => ({
                    key:   s.category,
                    label: s.category,
                    value: s.vol,
                    score: s.avgYes,
                  }))}
                  formatValue={fmtMoney}
                  height={220}
                />
              </div>
              <ul className="space-y-2">
                {byCategory.map(s => (
                  <li key={s.category} className="flex items-center justify-between text-xs">
                    <span className="font-medium text-[var(--color-text)] capitalize flex-1">{s.category}</span>
                    <span className="text-[var(--color-text-secondary)] tabular-nums">{s.count} markets</span>
                    <span className="text-[var(--color-text-tertiary)] tabular-nums w-16 text-right">{fmtMoney(s.vol)}</span>
                    <span className="ml-3 w-12 text-right tabular-nums" style={{ color: s.avgYes > 0.5 ? "#10b981" : "#dc2626" }}>
                      {fmtPct(s.avgYes)}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>

        {/* Top truth-gap events (any category — most newsworthy) */}
        <Card icon={Activity} title="Top truth-gap events (7d)" link="/truth-gap">
          {loadingTg ? (
            <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-14 bg-[var(--color-surface-2)] animate-pulse rounded" />)}</div>
          ) : tg.length === 0 ? (
            <p className="text-xs text-[var(--color-text-secondary)]">No tracked divergences this week.</p>
          ) : (
            <ul className="space-y-2">
              {tg.map(it => (
                <li key={it.event_id}>
                  <Link to={`/events/${it.slug}`} className="block p-2 -mx-2 rounded hover:bg-[var(--color-surface-2)] transition-colors">
                    <div className="flex items-center gap-2 mb-1">
                      <TruthGapBadge gap={it.truth_gap} size="sm" />
                      <span className="ml-auto text-[10px] text-[var(--color-text-tertiary)]">{relTime(it.last_activity_at)}</span>
                    </div>
                    <p className="text-xs text-[var(--color-text)] line-clamp-1">{it.title}</p>
                    <div className="flex gap-3 text-[10px] text-[var(--color-text-secondary)] mt-1 tabular-nums">
                      <span>Market <b>{fmtPct(it.market_probability)}</b></span>
                      <span>RI <b>{fmtPct(it.reality_score)}</b></span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Recent briefs */}
        <Card icon={FileText} title="Recent analyst briefs" link="/briefs">
          {!briefs?.length ? (
            <p className="text-xs text-[var(--color-text-secondary)]">No briefs published yet.</p>
          ) : (
            <ul className="space-y-2">
              {briefs.map(b => (
                <li key={b.slug}>
                  <Link to={`/briefs/${b.slug}`} className="block p-2 -mx-2 rounded hover:bg-[var(--color-surface-2)] transition-colors">
                    <p className="text-sm font-semibold text-[var(--color-text)] line-clamp-1">{b.title}</p>
                    <p className="text-xs text-[var(--color-text-secondary)] line-clamp-1 mt-0.5 italic">{b.thesis}</p>
                    <div className="flex gap-2 text-[10px] text-[var(--color-text-tertiary)] mt-1">
                      <span>{relTime(b.published_at)}</span>
                      <span>·</span>
                      <span>{b.evidence?.length ?? 0} citations</span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Outbound to traditional markets */}
      <div className="mt-5 text-center">
        <Link to="/markets" className="inline-flex items-center gap-1 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-accent)]">
          Traditional indices · FX · commodities → /markets <ExternalLink size={11} />
        </Link>
      </div>

      <p className="text-[10px] text-[var(--color-text-tertiary)] italic mt-6 text-center">{COPY.brandTagline()}</p>
    </div>
  );
}
