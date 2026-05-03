/**
 * RealityIndexOpsPage — /scoop-ops/reality-index — operator dashboard.
 *
 * Single page that renders the /scoop-ops/ri-ops/dashboard JSON snapshot.
 * Lets the operator answer "is the pipeline healthy?" in one glance:
 *   • Provider line (Cerebras / Cloudflare / etc.)
 *   • Scheduler cycles (last-run timestamps)
 *   • Table counts (articles / events / markets / RI snapshots / anomalies)
 *   • Top 5 events + top 5 markets + 5 most-recent anomalies
 *
 * Admin key is stored in localStorage as `scoop_admin_key`. First visit
 * shows a key-entry form. Wrong keys land on the upstream 404.
 */

import { useEffect, useState, useCallback } from "react";
import { Activity, BarChart3, Database, Zap, AlertTriangle, RefreshCw, Key, ExternalLink } from "lucide-react";

const KEY_STORAGE = "scoop_admin_key";

function fmtTs(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    if (diff < 60_000)   return "just now";
    if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3600_000)}h ago`;
    return d.toLocaleString();
  } catch { return iso; }
}
function fmtNum(n)  { return Number.isFinite(n) ? n.toLocaleString() : "—"; }
function fmtPct(v) { return Number.isFinite(v) ? `${Math.round(v * 100)}%` : "—"; }

function Card({ title, icon: Icon, children, className = "" }) {
  return (
    <section className={`rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 ${className}`}>
      <div className="flex items-center gap-2 mb-3 text-[10px] uppercase tracking-wide font-semibold text-[var(--color-text-secondary)]">
        {Icon && <Icon size={11} />}
        <span>{title}</span>
      </div>
      {children}
    </section>
  );
}

function Stat({ label, value, hint }) {
  return (
    <div>
      <div className="text-xl font-editorial italic tabular-nums text-[var(--color-text)]">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-[var(--color-text-secondary)]">{label}</div>
      {hint && <div className="text-[10px] text-[var(--color-text-tertiary)] mt-0.5">{hint}</div>}
    </div>
  );
}

function CycleRow({ label, last, isRunning }) {
  return (
    <div className="flex items-center justify-between py-1 text-xs border-b border-[var(--color-border)] last:border-0">
      <span className="text-[var(--color-text-secondary)]">{label}</span>
      <span className="flex items-center gap-2 tabular-nums">
        {isRunning && <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />}
        <span className={isRunning ? "text-green-700 dark:text-green-300 font-semibold" : "text-[var(--color-text)]"}>
          {fmtTs(last)}
        </span>
      </span>
    </div>
  );
}

export default function RealityIndexOpsPage() {
  const [key, setKey]       = useState(() => { try { return localStorage.getItem(KEY_STORAGE) || ""; } catch { return ""; } });
  const [data, setData]     = useState(null);
  const [error, setError]   = useState(null);
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const url = key ? `/scoop-ops/ri-ops/dashboard?key=${encodeURIComponent(key)}` : "/scoop-ops/ri-ops/dashboard";
      const res = await fetch(url);
      if (!res.ok) throw new Error(res.status === 404 ? "Wrong admin key (or endpoint not found)" : `HTTP ${res.status}`);
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Unknown error");
      setData(json);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [key]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const [calibration, setCalibration] = useState(null);
  const fetchCalibration = useCallback(async () => {
    try {
      const url = key
        ? `/scoop-ops/ri-ops/briefs/approval-rates?days=90&key=${encodeURIComponent(key)}`
        : "/scoop-ops/ri-ops/briefs/approval-rates?days=90";
      const res = await fetch(url);
      if (!res.ok) return;          // silent — calibration is non-critical
      const json = await res.json();
      if (json.ok) setCalibration(json);
    } catch { /* silent */ }
  }, [key]);
  useEffect(() => { fetchCalibration(); }, [fetchCalibration]);

  // Auto-refresh every 60s while page is open.
  useEffect(() => {
    const id = setInterval(() => { fetchData(); fetchCalibration(); }, 60_000);
    return () => clearInterval(id);
  }, [fetchData, fetchCalibration]);

  const saveKey = (e) => {
    e.preventDefault();
    const v = new FormData(e.currentTarget).get("key");
    try { localStorage.setItem(KEY_STORAGE, v); } catch { /* ignore */ }
    setKey(v);
  };

  if (error) {
    return (
      <div className="max-w-md mx-auto px-4 py-12">
        <div className="flex items-center gap-2 mb-3">
          <Key size={16} className="text-[var(--color-accent)]" />
          <h1 className="font-editorial italic text-xl text-[var(--color-text)]">Admin key</h1>
        </div>
        <p className="text-xs text-[var(--color-text-secondary)] mb-4">{error}</p>
        <form onSubmit={saveKey} className="flex gap-2">
          <input
            name="key"
            type="password"
            placeholder="ADMIN_KEY"
            className="flex-1 px-3 py-2 text-sm rounded border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)]"
          />
          <button type="submit" className="px-4 py-2 text-sm rounded bg-[var(--color-accent)] text-white font-semibold">
            Save
          </button>
        </form>
        <p className="text-[10px] text-[var(--color-text-tertiary)] mt-3">
          Stored in localStorage. The dashboard endpoint is gated by the same ADMIN_KEY env var as /scoop-ops/social-queue.
        </p>
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-10">
        <div className="h-8 w-48 bg-[var(--color-surface-2)] animate-pulse rounded mb-6" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-20 rounded-xl bg-[var(--color-surface-2)] animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { counts, provider, scheduler, topEvents, topMarkets, recentAnomalies } = data;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
      {/* Header */}
      <header className="flex items-start justify-between gap-3 mb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Activity size={18} className="text-[var(--color-accent)]" />
            <h1 className="font-editorial italic text-2xl text-[var(--color-text)]">Reality Index — Operator</h1>
          </div>
          <p className="text-xs text-[var(--color-text-secondary)]">
            One snapshot of the pipeline. Auto-refreshes every 60s.
          </p>
        </div>
        <button
          onClick={() => { fetchData(); fetchCalibration(); }}
          className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-full border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] transition-colors"
        >
          <RefreshCw size={11} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </header>

      {/* Admin nav strip */}
      <div className="flex flex-wrap gap-2 mb-5 text-xs">
        <a href="/scoop-ops/briefs"    className="px-3 py-1 rounded-full border border-[var(--color-border)] hover:border-[var(--color-accent)]">Briefs review →</a>
        <a href="/scoop-ops/synthetic" className="px-3 py-1 rounded-full border border-[var(--color-border)] hover:border-[var(--color-accent)]">Synthetic markets →</a>
      </div>

      {/* Provider line */}
      <Card title="Provider" icon={Zap} className="mb-5">
        <div className="text-xs font-mono text-[var(--color-text)] break-words">
          LLM=<b>{provider.provider}</b> ({provider.genModel}) · Embed=<b>{provider.embedProvider}</b> ({provider.embedModel}) · Premium=<b>{provider.premiumProvider}</b> ({provider.premiumModel})
        </div>
        <div className="text-[10px] text-[var(--color-text-tertiary)] mt-1">
          Pending {provider.pending} · in-flight {String(provider.inflight)} · embed in-flight {provider.embedInflight}
        </div>
      </Card>

      {/* Counts */}
      <Card title="Pipeline counts" icon={Database} className="mb-5">
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-4">
          <Stat label="Articles total"     value={fmtNum(counts.articles_total)} hint={`${fmtNum(counts.articles_24h)} in last 24h`} />
          <Stat label="Story clusters"     value={fmtNum(counts.story_clusters)} />
          <Stat label="Active events"      value={fmtNum(counts.events_active)}  hint={`${fmtNum(counts.events_dormant)} dormant`} />
          <Stat label="Active markets"     value={fmtNum(counts.markets_active)} />
          <Stat label="Cluster→market"     value={fmtNum(counts.cluster_market_links)} />
          <Stat label="Event→market"       value={fmtNum(counts.event_market_links)} />
          <Stat label="RI snapshots 24h"   value={fmtNum(counts.ri_snapshots_24h)} />
          <Stat label="Sentiment 24h"      value={fmtNum(counts.sentiment_snapshots_24h)} />
          <Stat label="Anomalies 24h"      value={fmtNum(counts.anomalies_24h)}   hint={`${fmtNum(counts.anomalies_unack)} unack`} />
          <Stat label="Embeddings"         value={fmtNum(counts.embeddings_total)} />
          <Stat label="Watchlists"         value={fmtNum(counts.watchlists)} />
          <Stat label="Push fan-outs 24h"  value={fmtNum(counts.pushed_anomalies_24h)} />
        </div>
      </Card>

      <div className="grid lg:grid-cols-2 gap-5 mb-5">
        {/* Scheduler cycles */}
        <Card title="Scheduler cycles" icon={RefreshCw}>
          <div className="space-y-0">
            <CycleRow label="Polymarket"      last={scheduler.lastPolymarketRun}     isRunning={scheduler.isPolymarketRun} />
            <CycleRow label="Market matcher"  last={scheduler.lastMatcherRun}        isRunning={scheduler.isMatcherRun} />
            <CycleRow label="Sentiment"       last={scheduler.lastSentimentRun}      isRunning={scheduler.isSentimentRun} />
            <CycleRow label="RI compose"      last={scheduler.lastRealityComposeRun} isRunning={scheduler.isRealityComposeRun} />
            <CycleRow label="Anomaly scan"    last={scheduler.lastAnomalyRun}        isRunning={scheduler.isAnomalyRun} />
            <CycleRow label="Watchlist push"  last={scheduler.lastWatchlistPushRun}  isRunning={scheduler.isWatchlistPushRun} />
            <CycleRow label="GDELT"           last={scheduler.lastGdeltRun}          isRunning={scheduler.isGdeltRun} />
            <CycleRow label="RSS ingest"      last={scheduler.lastRun}               isRunning={scheduler.isRunning} />
          </div>
          {scheduler.lastGdeltResult && (
            <p className="mt-2 text-[10px] text-[var(--color-text-tertiary)]">
              GDELT last cycle: {scheduler.lastGdeltResult.inserted} new, {scheduler.lastGdeltResult.skipped} dupes
            </p>
          )}
        </Card>

        {/* Recent anomalies */}
        <Card title="Recent anomalies" icon={AlertTriangle}>
          {!recentAnomalies?.length ? (
            <p className="text-xs text-[var(--color-text-secondary)]">No anomalies yet.</p>
          ) : (
            <div className="space-y-2">
              {recentAnomalies.map(a => (
                <a key={a.id} href={a.event_slug ? `/events/${a.event_slug}` : "#"}
                   className="block text-xs p-2 rounded border border-[var(--color-border)] hover:border-[var(--color-accent)] transition-colors">
                  <div className="flex justify-between items-baseline gap-2">
                    <span className="font-semibold text-[var(--color-text)]">{a.type}</span>
                    <span className="text-[10px] text-[var(--color-text-tertiary)]">{fmtTs(a.detected_at)}</span>
                  </div>
                  <div className="text-[var(--color-text-secondary)] line-clamp-1 mt-0.5">
                    {a.event_title || "(no event)"}
                  </div>
                </a>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        {/* Top events */}
        <Card title="Top active events" icon={Activity}>
          {!topEvents?.length ? (
            <p className="text-xs text-[var(--color-text-secondary)]">No active events.</p>
          ) : (
            <div className="space-y-2">
              {topEvents.map(e => (
                <a key={e.slug} href={`/events/${e.slug}`}
                   className="flex items-center justify-between gap-2 text-xs p-2 rounded border border-[var(--color-border)] hover:border-[var(--color-accent)] transition-colors">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-[var(--color-text)] line-clamp-1">{e.title}</div>
                    <div className="text-[10px] text-[var(--color-text-secondary)]">
                      {e.category} · {e.articles} articles · {e.markets} markets
                    </div>
                  </div>
                  <div className="text-right tabular-nums">
                    <div className="text-[var(--color-accent)] font-semibold">{fmtPct(e.reality_score)}</div>
                    <div className="text-[10px] text-[var(--color-text-tertiary)]">RI</div>
                  </div>
                </a>
              ))}
            </div>
          )}
        </Card>

        {/* Top markets */}
        <Card title="Top markets by 24h volume" icon={ExternalLink}>
          {!topMarkets?.length ? (
            <p className="text-xs text-[var(--color-text-secondary)]">No markets yet.</p>
          ) : (
            <div className="space-y-2">
              {topMarkets.map(m => (
                <div key={m.id} className="text-xs p-2 rounded border border-[var(--color-border)]">
                  <div className="font-semibold text-[var(--color-text)] line-clamp-1">{m.question}</div>
                  <div className="flex justify-between items-baseline mt-0.5 text-[10px] text-[var(--color-text-secondary)] tabular-nums">
                    <span>{m.source} · YES <b>{fmtPct(m.yes_price)}</b></span>
                    <span>Vol ${fmtNum(Math.round(m.volume_24h || 0))}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Brief calibration — Phase 7 self-improvement foundation (plan §5J #5).
          Until a category clears 100 decided briefs and ≥0.7 approval rate,
          everything publishes via manual review. This card shows progress. */}
      {calibration && (
        <Card title="Brief calibration (90d)" icon={BarChart3} className="mt-5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4 pb-4 border-b border-[var(--color-border)]">
            <Stat
              label="Overall approval"
              value={calibration.overall.approval_rate != null
                ? `${(calibration.overall.approval_rate * 100).toFixed(1)}%`
                : "—"}
              hint={`${fmtNum(calibration.overall.published)} pub / ${fmtNum(calibration.overall.rejected)} rej`}
            />
            <Stat label="Pending review"  value={fmtNum(calibration.overall.pending)} />
            <Stat label="Decided briefs"  value={fmtNum(calibration.overall.decided)} hint="of 100 needed for auto-promote" />
            <Stat
              label="Avg confidence (pub)"
              value={calibration.overall.avg_confidence_published != null
                ? `${(calibration.overall.avg_confidence_published * 100).toFixed(0)}%`
                : "—"}
            />
          </div>
          {!calibration.by_category.length ? (
            <p className="text-xs text-[var(--color-text-secondary)]">No briefs decided yet — generate some via /scoop-ops/briefs.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wide text-[var(--color-text-secondary)] text-left border-b border-[var(--color-border)]">
                    <th className="py-1.5 pr-2">Category</th>
                    <th className="py-1.5 px-2 text-right">Published</th>
                    <th className="py-1.5 px-2 text-right">Rejected</th>
                    <th className="py-1.5 px-2 text-right">Pending</th>
                    <th className="py-1.5 px-2 text-right">Approval</th>
                    <th className="py-1.5 pl-2 text-right">Auto-publish ready?</th>
                  </tr>
                </thead>
                <tbody>
                  {calibration.by_category.map(row => {
                    const ready = row.decided >= 100 && (row.approval_rate ?? 0) >= 0.7;
                    return (
                      <tr key={row.category} className="border-b border-[var(--color-border)] last:border-0">
                        <td className="py-1.5 pr-2 capitalize text-[var(--color-text)]">{row.category}</td>
                        <td className="py-1.5 px-2 text-right tabular-nums text-[var(--color-text)]">{fmtNum(row.published)}</td>
                        <td className="py-1.5 px-2 text-right tabular-nums text-[var(--color-text-secondary)]">{fmtNum(row.rejected)}</td>
                        <td className="py-1.5 px-2 text-right tabular-nums text-[var(--color-text-tertiary)]">{fmtNum(row.pending)}</td>
                        <td className="py-1.5 px-2 text-right tabular-nums">
                          {row.approval_rate != null
                            ? <span className={row.approval_rate >= 0.7 ? "text-green-600 dark:text-green-400 font-semibold" : "text-[var(--color-text)]"}>
                                {(row.approval_rate * 100).toFixed(0)}%
                              </span>
                            : <span className="text-[var(--color-text-tertiary)]">—</span>}
                        </td>
                        <td className="py-1.5 pl-2 text-right">
                          {ready
                            ? <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300 font-semibold">READY</span>
                            : <span className="text-[10px] text-[var(--color-text-tertiary)]">{row.decided}/100</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-[10px] text-[var(--color-text-tertiary)] italic mt-3">
            Per plan §5J: auto-publication unlocked when a category has ≥100 decided briefs AND ≥70% approval rate. Until then, every brief ships through manual review.
          </p>
        </Card>
      )}

      <p className="text-[10px] text-[var(--color-text-tertiary)] italic mt-6 text-center">
        Snapshot at {fmtTs(new Date(data.now).toISOString())}
      </p>
    </div>
  );
}
