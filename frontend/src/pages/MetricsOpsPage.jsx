/**
 * MetricsOpsPage — /scoop-ops/metrics — Phase A baseline metrics dashboard.
 *
 * Sprint 3.4. Renders the /scoop-ops/metrics JSON snapshot from the
 * backend (backend/src/routes/scoop-ops-metrics.js). 4 live metrics +
 * 1 explicit BridgedStub for the metric (#4 returning user rate) that
 * is bridged to Phase B Track 1 Distribution / Layer 1 analytics per
 * session 28-extension DEC1.
 *
 * Admin key is stored in localStorage as `scoop_admin_key` (same key
 * pattern as RealityIndexOpsPage). First visit shows a key-entry form.
 * Auto-refreshes every 60s while page is open.
 */

import { useEffect, useState, useCallback, useRef } from "react";
import {
  Activity, AlertTriangle, BarChart3, Clock, Users,
  Key, RefreshCw,
} from "lucide-react";

const KEY_STORAGE = "scoop_admin_key";

function fmtTs(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    if (diff < 60_000)     return "just now";
    if (diff < 3600_000)   return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3600_000)}h ago`;
    return d.toLocaleString();
  } catch { return iso; }
}

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

function Stat({ label, value, hint, footnote }) {
  return (
    <div>
      <div className="text-3xl font-editorial italic tabular-nums text-[var(--color-text)]">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-[var(--color-text-secondary)] mt-1">{label}</div>
      {hint && <div className="text-[10px] text-[var(--color-text-tertiary)] mt-1">{hint}</div>}
      {footnote && <div className="text-[10px] text-[var(--color-text-tertiary)] mt-2 italic">{footnote}</div>}
    </div>
  );
}

function BridgedStub({ label, note, bridgedTo }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded bg-[var(--color-accent)] text-white">
          BRIDGED
        </span>
        <span className="text-3xl font-editorial italic text-[var(--color-text-tertiary)]">—</span>
      </div>
      <div className="text-[10px] uppercase tracking-wide text-[var(--color-text-secondary)]">{label}</div>
      <div className="text-[10px] text-[var(--color-text-tertiary)] mt-2 leading-relaxed">{note}</div>
      <div className="text-[10px] text-[var(--color-text-secondary)] mt-2 font-mono">→ {bridgedTo}</div>
    </div>
  );
}

export default function MetricsOpsPage() {
  const [key, setKey]         = useState(() => { try { return localStorage.getItem(KEY_STORAGE) || ""; } catch { return ""; } });
  const [data, setData]       = useState(null);
  const [error, setError]     = useState(null);
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const url = key ? `/scoop-ops/metrics-ops?key=${encodeURIComponent(key)}` : "/scoop-ops/metrics-ops";
      const res = await fetch(url);
      if (!res.ok) throw new Error(res.status === 404 ? "Wrong admin key (or endpoint not found)" : `HTTP ${res.status}`);
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Unknown error");
      setData(json);
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    } finally {
      setLoading(false);
    }
  }, [key]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Auto-refresh every 60s while page is open. Skips ticks while the tab is
  // hidden, and doubles the effective interval per consecutive failure
  // (capped at 16 min) so a failing backend isn't hammered (audit S1a).
  const failsRef = useRef(0);
  useEffect(() => {
    let tick = 0;
    const id = setInterval(async () => {
      tick += 1;
      if (document.hidden) return;
      if (tick % Math.min(2 ** failsRef.current, 16) !== 0) return;
      const ok = await fetchData();
      failsRef.current = ok ? 0 : failsRef.current + 1;
    }, 60_000);
    return () => clearInterval(id);
  }, [fetchData]);

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
          Stored in localStorage. The metrics endpoint is gated by the same ADMIN_KEY env var as /scoop-ops/reality-index.
        </p>
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-10">
        <div className="h-8 w-64 bg-[var(--color-surface-2)] animate-pulse rounded mb-6" />
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-28 rounded-xl bg-[var(--color-surface-2)] animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (!data) return null;

  const m = data.metrics;
  const totalJobs = m.uptime.denominator;
  const inFlight  = totalJobs - (m.uptime.numerator + m.bullmq_failure_rate_24h.numerator);

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
      <header className="flex items-start justify-between gap-3 mb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Activity size={18} className="text-[var(--color-accent)]" />
            <h1 className="font-editorial italic text-2xl text-[var(--color-text)]">Phase A Baseline Metrics</h1>
          </div>
          <p className="text-xs text-[var(--color-text-secondary)]">
            Sprint 3.4 dashboard. 4 of 5 metrics live; metric #4 bridged to Phase B Track 1 analytics.
            Updated {fmtTs(data.computed_at)} · {data.window_hours}h window · methodology {data.methodology_version}
          </p>
        </div>
        <button
          onClick={() => fetchData()}
          className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-full border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] transition-colors"
        >
          <RefreshCw size={11} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </header>

      {/* Admin nav strip */}
      <div className="flex flex-wrap gap-2 mb-5 text-xs">
        <a href="/scoop-ops/reality-index" className="px-3 py-1 rounded-full border border-[var(--color-border)] hover:border-[var(--color-accent)]">Reality Index ops →</a>
      </div>

      <div className="space-y-3">
        <Card title="Production uptime" icon={Activity}>
          <Stat
            label="Job success ratio (24h)"
            value={m.uptime.display}
            hint={`${m.uptime.numerator} of ${m.uptime.denominator} jobs · ${inFlight} in-flight`}
            footnote={m.uptime.denominator_notes}
          />
        </Card>

        <Card title="Scheduler last-run age" icon={Clock}>
          <Stat
            label="Most recent scheduler tick"
            value={m.scheduler_last_run_age.display}
            hint={`${m.scheduler_last_run_age.observed_job_types} job types tracked`}
          />
        </Card>

        <Card title="BullMQ failure rate (24h)" icon={AlertTriangle}>
          <Stat
            label="Failed / total jobs"
            value={m.bullmq_failure_rate_24h.display}
            hint={`${m.bullmq_failure_rate_24h.numerator} of ${m.bullmq_failure_rate_24h.denominator} jobs · ${inFlight} in-flight`}
            footnote={m.bullmq_failure_rate_24h.denominator_notes}
          />
        </Card>

        <Card title="Layer 1 returning user rate (7-day)" icon={Users}>
          <BridgedStub
            label={m.returning_user_rate.label}
            note={m.returning_user_rate.note}
            bridgedTo={m.returning_user_rate.bridged_to}
          />
        </Card>

        <Card title="Source diversity index" icon={BarChart3}>
          <Stat
            label="Distinct (category × region) cells"
            value={m.source_diversity_index.display}
            hint={`${m.source_diversity_index.total_sources} sources across ${m.source_diversity_index.distinct_categories} categories × ${m.source_diversity_index.distinct_regions} regions`}
          />
        </Card>
      </div>

      <footer className="text-[10px] text-[var(--color-text-tertiary)] mt-6 leading-relaxed">
        Phase A close-out artifact. Sprint 6.3 baseline snapshot will be captured against this endpoint after deploy.
      </footer>
    </div>
  );
}
