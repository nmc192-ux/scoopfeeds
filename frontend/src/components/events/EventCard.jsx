/**
 * EventCard — Polymarket-style card for the /events grid.
 * Shows title, category, top market probability, article count, and activity timestamp.
 */

import { Link } from "react-router-dom";
import { Activity, FileText, Clock } from "lucide-react";
import ProbabilityBar from "../predictions/ProbabilityBar";
import TruthGapBadge  from "../predictions/TruthGapBadge";
import AnomalyChip    from "../predictions/AnomalyChip";

const CATEGORY_COLORS = {
  politics:    "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  finance:     "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  tech:        "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  sports:      "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
  science:     "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300",
  health:      "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  climate:     "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  geopolitics: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
};

function severityColor(severity) {
  if (severity >= 0.7) return "bg-red-500";
  if (severity >= 0.4) return "bg-amber-400";
  return "bg-green-500";
}

function relativeTime(ms) {
  if (!ms) return "";
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

const DAY_MS = 86_400_000;

// Lifespan badge: a multi-day, still-active story reads "developing · day N"
// (N = inclusive days from started_at → last_activity_at, min 1); otherwise a
// relative "Xh ago". For live events last_activity_at ≈ now, so day N == age in days.
function lifespan(started_at, last_activity_at, status) {
  const span = (last_activity_at ?? 0) - (started_at ?? 0);
  if (status === "active" && started_at && span >= DAY_MS) {
    return { text: `developing · day ${Math.max(1, Math.floor(span / DAY_MS) + 1)}`, developing: true };
  }
  return { text: relativeTime(last_activity_at), developing: false };
}

function initials(name = "") {
  const w = name.trim().split(/\s+/).filter(Boolean);
  if (!w.length) return "?";
  if (w.length === 1) return w[0].slice(0, 2).toUpperCase();
  return (w[0][0] + w[1][0]).toUpperCase();
}

const AVATAR_BG = ["bg-blue-500", "bg-emerald-500", "bg-amber-500", "bg-purple-500", "bg-rose-500", "bg-teal-500", "bg-indigo-500"];
function avatarColor(name = "") {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_BG[h % AVATAR_BG.length];
}

export default function EventCard({ event, variant = "default", featured = false }) {
  const {
    slug, title, summary, category, severity = 0,
    article_count = 0, source_count = 0, top_sources = [], market_count = 0,
    top_probability, truth_gap, latest_anomaly, status,
    hero_image_url, started_at, last_activity_at,
  } = event;

  const catKey    = (category ?? "").toLowerCase();
  const catColor  = CATEGORY_COLORS[catKey] ?? "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300";

  // ── News variant (Phase 5b): the cluster-homepage card. No prediction-market
  // chrome (probability/markets/truth-gap/anomaly/severity); the source
  // trust-marker is the centerpiece, with a lifespan badge in the header. ──────
  if (variant === "news") {
    const life     = lifespan(started_at, last_activity_at, status);
    const shown    = (top_sources ?? []).slice(0, 4);
    const overflow = Math.max(0, source_count - shown.length);

    const header = (
      <div className="flex items-center gap-2">
        <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full capitalize ${catColor}`}>
          {category ?? "General"}
        </span>
        <span className={`ml-auto text-[10px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${
          life.developing ? "bg-[var(--color-surface2)] text-[var(--color-accent)]" : "text-[var(--color-text-tertiary)]"}`}>
          {life.developing && <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] mr-1 align-middle animate-pulse" />}
          {life.text}
        </span>
      </div>
    );

    const trustMarker = (
      <div className="mt-auto pt-3 border-t border-[var(--color-border)] flex items-center gap-2.5">
        <div className="flex items-center">
          {shown.map((s, i) => (
            <span key={i} title={s}
              className={`-ml-1.5 first:ml-0 inline-flex items-center justify-center w-6 h-6 rounded-full ring-2 ring-[var(--color-surface)] text-[9px] font-bold text-white ${avatarColor(s)}`}>
              {initials(s)}
            </span>
          ))}
          {overflow > 0 && (
            <span className="-ml-1.5 inline-flex items-center justify-center w-6 h-6 rounded-full ring-2 ring-[var(--color-surface)] bg-[var(--color-surface2)] text-[9px] font-bold text-[var(--color-text-secondary)]">
              +{overflow}
            </span>
          )}
        </div>
        <p className="text-xs font-semibold text-[var(--color-text)] truncate">
          {source_count} outlet{source_count !== 1 ? "s" : ""}
          <span className="font-normal text-[var(--color-text-tertiary)]"> · {article_count} article{article_count !== 1 ? "s" : ""}</span>
        </p>
        {/* Phase C: credibility marker mounts here — layout room reserved */}
      </div>
    );

    if (featured) {
      return (
        <Link to={`/events/${slug}`}
          className="group flex flex-col sm:flex-row rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-accent)] hover:shadow-md transition-all overflow-hidden">
          {hero_image_url && (
            <div className="sm:w-2/5 lg:w-1/2 aspect-video overflow-hidden bg-[var(--color-surface2)] flex-shrink-0">
              <img src={hero_image_url} alt="" loading="lazy"
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
            </div>
          )}
          <div className="flex flex-col gap-2.5 p-4 sm:p-5 flex-1 min-w-0">
            {header}
            <h3 className="font-bold text-[var(--color-text)] text-base sm:text-lg leading-snug line-clamp-3 group-hover:text-[var(--color-accent)] transition-colors">
              {title}
            </h3>
            {summary && <p className="text-xs sm:text-sm text-[var(--color-text-secondary)] line-clamp-2">{summary}</p>}
            {trustMarker}
          </div>
        </Link>
      );
    }

    return (
      <Link to={`/events/${slug}`}
        className="group flex flex-col rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-accent)] hover:shadow-md transition-all overflow-hidden">
        {hero_image_url && (
          <div className="aspect-video overflow-hidden bg-[var(--color-surface2)]">
            <img src={hero_image_url} alt="" loading="lazy"
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
          </div>
        )}
        <div className="flex flex-col gap-2.5 p-4 flex-1">
          {header}
          <h3 className="font-semibold text-[var(--color-text)] text-sm leading-snug line-clamp-3 group-hover:text-[var(--color-accent)] transition-colors">
            {title}
          </h3>
          {trustMarker}
        </div>
      </Link>
    );
  }

  return (
    <Link
      to={`/events/${slug}`}
      className="group flex flex-col rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-accent)] hover:shadow-md transition-all overflow-hidden"
    >
      {/* Hero image */}
      {hero_image_url && (
        <div className="aspect-video overflow-hidden bg-[var(--color-surface2)]">
          <img
            src={hero_image_url}
            alt=""
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            loading="lazy"
          />
        </div>
      )}

      <div className="flex flex-col gap-3 p-4 flex-1">
        {/* Header row: category badge + truth-gap + severity dot */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize ${catColor}`}>
            {category ?? "General"}
          </span>
          {Number.isFinite(truth_gap) && Math.abs(truth_gap) > 0.15 && (
            <TruthGapBadge gap={truth_gap} size="sm" />
          )}
          <span
            className={`w-2 h-2 rounded-full flex-shrink-0 ml-auto ${severityColor(severity)}`}
            title={`Severity: ${(severity * 100).toFixed(0)}%`}
          />
        </div>

        {/* Inline anomaly chip — surfaces fresh activity at a glance */}
        {latest_anomaly && (
          <AnomalyChip anomaly={latest_anomaly} size="sm" />
        )}

        {/* Title */}
        <h3 className="font-semibold text-[var(--color-text)] text-sm leading-snug line-clamp-3 group-hover:text-[var(--color-accent)] transition-colors">
          {title}
        </h3>

        {/* Summary */}
        {summary && (
          <p className="text-xs text-[var(--color-text-secondary)] line-clamp-2">{summary}</p>
        )}

        {/* Market probability strip */}
        {top_probability != null && (
          <div className="mt-auto pt-2 border-t border-[var(--color-border)]">
            <p className="text-[10px] text-[var(--color-text-secondary)] mb-1 flex items-center gap-1">
              <Activity size={10} className="text-[var(--color-accent)]" />
              Market probability
            </p>
            <ProbabilityBar yesPrice={top_probability} noPrice={1 - top_probability} size="sm" />
          </div>
        )}

        {/* Footer: article count + time */}
        <div className="flex items-center gap-3 text-[10px] text-[var(--color-text-secondary)] mt-1">
          <span className="flex items-center gap-1">
            <FileText size={10} />
            {article_count} article{article_count !== 1 ? "s" : ""}
          </span>
          {market_count > 0 && (
            <span className="flex items-center gap-1">
              <Activity size={10} />
              {market_count} market{market_count !== 1 ? "s" : ""}
            </span>
          )}
          <span className="flex items-center gap-1 ml-auto">
            <Clock size={10} />
            {relativeTime(last_activity_at)}
          </span>
        </div>
      </div>
    </Link>
  );
}
