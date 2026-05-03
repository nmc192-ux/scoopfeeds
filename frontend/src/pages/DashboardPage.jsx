/**
 * DashboardPage — /dashboard — per-user view of watchlisted events + the
 * recent anomaly stream filtered to those events.
 *
 * Two columns on desktop: watchlist on the left, activity feed on the right.
 * On mobile they stack.
 *
 * Auth-gated. Anonymous users see a sign-in prompt.
 */

import { Link } from "react-router-dom";
import { Star, Bell, LogIn, Activity, FileText } from "lucide-react";
import { useWatchlists, useWatchlistActivity } from "../hooks/useWatchlists";
import TruthGapBadge       from "../components/predictions/TruthGapBadge";
import AnomalyChip         from "../components/predictions/AnomalyChip";
import WatchlistPushPanel  from "../components/predictions/WatchlistPushPanel";
import { COPY }            from "../lib/copyGuide";
import { useT }           from "../lib/i18n";

function fmtPct(v) { return Number.isFinite(v) ? `${Math.round(v * 100)}%` : "—"; }

function relTime(ms) {
  if (!ms) return "";
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function EventRow({ entry }) {
  const e = entry.event;
  if (!e) {
    return (
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-xs text-[var(--color-text-secondary)]">
        Watched event no longer available (resolved or dormant).
      </div>
    );
  }
  return (
    <Link
      to={`/events/${e.slug}`}
      className="group block rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-accent)] hover:shadow-sm transition-all p-3"
    >
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        {e.category && (
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-[var(--color-accent)]/10 text-[var(--color-accent)] capitalize">
            {e.category}
          </span>
        )}
        <TruthGapBadge gap={e.truth_gap} size="sm" />
        {e.status === "active" && (
          <span className="ml-auto text-[10px] text-green-700 dark:text-green-300 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            Live
          </span>
        )}
      </div>
      <p className="text-sm font-medium text-[var(--color-text)] line-clamp-2 leading-snug group-hover:text-[var(--color-accent)] transition-colors">
        {e.title}
      </p>
      <div className="flex items-center gap-3 mt-1 text-[10px] text-[var(--color-text-secondary)] tabular-nums">
        {e.top_probability != null && <span>Market <span className="font-semibold">{fmtPct(e.top_probability)}</span></span>}
        {e.reality_score   != null && <span>RI <span className="font-semibold">{fmtPct(e.reality_score)}</span></span>}
        <span className="ml-auto">{relTime(e.last_activity_at)}</span>
      </div>
    </Link>
  );
}

function MarketRow({ entry }) {
  const m = entry.market;
  if (!m) return null;
  return (
    <a
      href={m.url}
      target="_blank"
      rel="noopener noreferrer"
      className="block rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-accent)] hover:shadow-sm transition-all p-3"
    >
      <p className="text-xs uppercase tracking-wide text-[var(--color-text-secondary)] font-semibold mb-1">
        Market · {m.source}
      </p>
      <p className="text-sm font-medium text-[var(--color-text)] line-clamp-2 leading-snug">
        {m.question}
      </p>
      <div className="flex items-center gap-3 mt-1 text-[10px] text-[var(--color-text-secondary)] tabular-nums">
        <span>YES <span className="font-semibold">{fmtPct(m.yes_price)}</span></span>
        {m.volume_24h > 0 && <span>Vol ${Math.round(m.volume_24h).toLocaleString()}</span>}
      </div>
    </a>
  );
}

function AnomalyRow({ a }) {
  return (
    <Link
      to={`/events/${a.event_slug}`}
      className="block rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-accent)] transition-colors p-3"
    >
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <AnomalyChip anomaly={a} size="sm" />
        <span className="ml-auto text-[10px] text-[var(--color-text-secondary)]">{relTime(a.detected_at)}</span>
      </div>
      <p className="text-xs text-[var(--color-text)] line-clamp-2">{a.event_title}</p>
    </Link>
  );
}

export default function DashboardPage() {
  const { t } = useT();
  const { data: wlData, isLoading: loadingWl, error: wlError } = useWatchlists();
  const { data: actData, isLoading: loadingAct, error: actError } = useWatchlistActivity({ limit: 30 });

  const isAuthError = wlError?.response?.status === 401 || actError?.response?.status === 401;
  const items     = wlData?.items ?? [];
  const anomalies = actData?.anomalies ?? [];

  if (isAuthError) {
    return (
      <div className="max-w-md mx-auto px-4 py-16 text-center">
        <Star size={28} className="mx-auto text-[var(--color-accent)] mb-3" />
        <h1 className="font-editorial italic text-2xl mb-2 text-[var(--color-text)]">Your dashboard</h1>
        <p className="text-sm text-[var(--color-text-secondary)] mb-6">
          Sign in to follow events and prediction markets, then track them in one place.
        </p>
        <a
          href="/login"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--color-accent)] text-white text-sm font-semibold hover:opacity-90 transition-opacity"
        >
          <LogIn size={14} /> Sign in with email
        </a>
      </div>
    );
  }

  const events  = items.filter(i => i.item_type === "event");
  const markets = items.filter(i => i.item_type === "market");

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
      <div className="mb-6 flex items-center gap-2">
        <Star size={18} className="text-[var(--color-accent)]" fill="currentColor" />
        <h1 className="font-editorial italic text-2xl text-[var(--color-text)]">Dashboard</h1>
      </div>

      <div className="grid lg:grid-cols-[1fr_22rem] gap-6">
        {/* Left: watchlist */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <FileText size={14} className="text-[var(--color-text-secondary)]" />
            <h2 className="font-semibold text-sm text-[var(--color-text)]">Watching ({items.length})</h2>
          </div>

          {loadingWl ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-20 rounded-lg bg-[var(--color-surface-2)] animate-pulse" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-lg border border-dashed border-[var(--color-border)] p-6 text-center text-sm text-[var(--color-text-secondary)]">
              <p>You're not watching anything yet.</p>
              <p className="mt-1">
                Open an{" "}
                <Link to="/events" className="text-[var(--color-accent)] hover:underline">event</Link>{" "}
                or{" "}
                <Link to="/predictions" className="text-[var(--color-accent)] hover:underline">market</Link>{" "}
                and tap "+ Watch".
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {events.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-[10px] uppercase tracking-wide text-[var(--color-text-secondary)] font-semibold">Events</h3>
                  {events.map(e => <EventRow key={e.item_id} entry={e} />)}
                </div>
              )}
              {markets.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-[10px] uppercase tracking-wide text-[var(--color-text-secondary)] font-semibold">Markets</h3>
                  {markets.map(m => <MarketRow key={m.item_id} entry={m} />)}
                </div>
              )}
            </div>
          )}
        </section>

        {/* Right: push opt-in + activity stream */}
        <aside className="space-y-5">
          <WatchlistPushPanel />

          <div className="flex items-center gap-2 mb-3">
            <Bell size={14} className="text-[var(--color-text-secondary)]" />
            <h2 className="font-semibold text-sm text-[var(--color-text)]">Recent activity</h2>
          </div>

          {loadingAct ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-16 rounded-lg bg-[var(--color-surface-2)] animate-pulse" />
              ))}
            </div>
          ) : anomalies.length === 0 ? (
            <div className="rounded-lg border border-dashed border-[var(--color-border)] p-4 text-xs text-[var(--color-text-secondary)] text-center">
              <Activity size={16} className="mx-auto mb-1 opacity-60" />
              No anomalies on your watched items in the last 7 days.
            </div>
          ) : (
            <div className="space-y-2">
              {anomalies.map(a => <AnomalyRow key={a.id} a={a} />)}
            </div>
          )}
        </aside>
      </div>

      <p className="text-[10px] text-[var(--color-text-tertiary)] italic mt-8 text-center">
        {COPY.brandTagline(t)}
      </p>
    </div>
  );
}
