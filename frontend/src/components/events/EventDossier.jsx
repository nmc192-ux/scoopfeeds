/**
 * EventDossier — A2 restructured event dossier (design-locked by DrJ).
 *
 * Section order, top to bottom:
 *   1. HEADER        title, hero, consolidation badge (N outlets · M articles · day D),
 *                    status (developing/dormant), mechanical badge line. NO LLM brief.
 *   2. TIMELINE      latest development first, day-grouped. Mobile: latest-3 + expander.
 *   3. COVERAGE      member articles grouped BY OUTLET, one row per outlet. No cred scores.
 *   3b. THREADS      A5 facet shelf, DARK behind ?facets=1. Earn-render: >= 2 qualifying
 *                    facets or no shelf (absent ≠ broken). Display-only cards.
 *   4. ANGLES        related[] sub-events as cards. Absent when related[] is empty.
 *   5. ACTORS        event_actors chips, wrap freely (any number of rows),
 *                    sorted by mentions, cap 8 + "+N". (Flag 2: 3-row wrap is
 *                    accepted as-is — spec is "chips wrap, cap 8 + N", no CSS.)
 *   6. INTELLIGENCE  A3 "earn their render": RI only w/ bound question + trend + source
 *                    count; Sentiment only above a volume floor; Markets only if live.
 *
 * This is now the DEFAULT layout (EventPage renders it for all events after the
 * live-device flip). The legacy layout is untouched and remains reachable at ?a2=0.
 */

import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Clock, Newspaper, Users, BarChart3, MessageCircle, Activity, ChevronLeft,
  ExternalLink, TrendingUp, TrendingDown, GitBranch, User, Building2, Globe, Layers,
} from "lucide-react";
import {
  useEventTimeline, useEventMarkets, useEventActors, useEventCoverage,
  useEventSentiment, useEventRealityIndex, useEventFacets,
} from "../../hooks/useEvents";
import ProbabilityBar from "../predictions/ProbabilityBar";
import RealityGauge   from "../predictions/RealityGauge";
import SentimentSmallMultiples from "../predictions/SentimentSmallMultiples";

// A3 earn-render floor: sentiment streams render only when the story carries
// enough measured volume to be meaningful. Below this total-mention count the
// section stays absent rather than showing a thin, misleading chart.
const SENTIMENT_VOLUME_FLOOR = 10;

const DAY_MS = 24 * 60 * 60 * 1000;

// ─── helpers ────────────────────────────────────────────────────────────────

// "Day D" of the story — 1-indexed days since it started.
function dayIndex(startedAt) {
  if (!startedAt) return null;
  return Math.max(1, Math.floor((Date.now() - startedAt) / DAY_MS) + 1);
}

// Display status. The graph stores active|dormant|resolved|closed; the product
// speaks "developing" for a live story.
function statusLabel(status) {
  switch (status) {
    case "active":   return { label: "Developing", live: true };
    case "dormant":  return { label: "Dormant",    live: false };
    case "resolved": return { label: "Resolved",   live: false };
    case "closed":   return { label: "Closed",     live: false };
    default:         return null;
  }
}

function hostname(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return null; }
}

function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayHeading(ts) {
  const d = new Date(ts);
  const today = new Date();
  const yest  = new Date(Date.now() - DAY_MS);
  if (dayKey(ts) === dayKey(today.getTime())) return "Today";
  if (dayKey(ts) === dayKey(yest.getTime()))  return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function clockTime(ts) {
  return new Date(ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function SectionHeader({ icon: Icon, label, action }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <Icon size={15} className="text-[var(--color-accent)]" />
      <h2 className="font-semibold text-base text-[var(--color-text)]">{label}</h2>
      {action && <div className="ml-auto">{action}</div>}
    </div>
  );
}

// ─── 1. HEADER ──────────────────────────────────────────────────────────────

function DossierHeader({ event }) {
  const { title, category, hero_image_url, source_count = 0, article_count = 0, started_at, status } = event;
  const st = statusLabel(status);
  const d = dayIndex(started_at);

  // The mechanical consolidation line — this IS the header's summary. No prose,
  // no LLM brief (out of scope per design).
  const badge = [
    `${source_count} outlet${source_count !== 1 ? "s" : ""}`,
    `${article_count} article${article_count !== 1 ? "s" : ""}`,
    d ? `day ${d}` : null,
  ].filter(Boolean).join(" · ");

  return (
    <div className="rounded-xl overflow-hidden border border-[var(--color-border)] bg-[var(--color-surface)] mb-8">
      {hero_image_url && (
        <div className="aspect-[3/1] bg-[var(--color-surface-2)] overflow-hidden">
          <img src={hero_image_url} alt="" className="w-full h-full object-cover" loading="eager" />
        </div>
      )}
      <div className="p-5 sm:p-7 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {category && (
            <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-[var(--color-accent)]/10 text-[var(--color-accent)] capitalize">
              {category}
            </span>
          )}
          {st && (
            <span
              className={`flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                st.live
                  ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
                  : "bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]"
              }`}
            >
              {st.live && <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />}
              {st.label}
            </span>
          )}
        </div>

        <h1 className="font-editorial italic text-2xl sm:text-3xl leading-tight text-[var(--color-text)]">
          {title}
        </h1>

        {/* Mechanical consolidation badge — the header's only summary line. */}
        <p className="text-xs font-medium text-[var(--color-text-secondary)] tracking-wide">
          {badge}
        </p>
      </div>
    </div>
  );
}

// ─── 2. TIMELINE ────────────────────────────────────────────────────────────

function TimelineEntry({ entry }) {
  const isMove = entry.kind === "market_move";
  const isUp = isMove && entry.headline?.includes("UP");
  const dot = isMove ? (isUp ? "bg-green-500" : "bg-red-500")
    : entry.importance >= 0.75 ? "bg-red-500"
    : entry.importance >= 0.55 ? "bg-amber-400"
    : "bg-[var(--color-border)]";
  const Icon = isMove ? (isUp ? TrendingUp : TrendingDown) : Newspaper;
  const iconColor = isMove ? (isUp ? "text-green-500" : "text-red-500") : "text-[var(--color-text-secondary)]";

  return (
    <div className="flex gap-3 py-3">
      <div className="flex flex-col items-center gap-1 flex-shrink-0 w-6">
        <div className={`w-2 h-2 rounded-full mt-1 ${dot}`} />
        <div className="w-px flex-1 bg-[var(--color-border)]" />
      </div>
      <div className="flex-1 pb-1 min-w-0">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <Icon size={12} className={iconColor} />
          <span className="text-[10px] text-[var(--color-text-secondary)]">{entry.source_name ?? "Unknown"}</span>
          <span className="text-[10px] text-[var(--color-text-secondary)] ml-auto">{clockTime(entry.ts)}</span>
        </div>
        <p className="text-sm font-medium text-[var(--color-text)] leading-snug">{entry.headline}</p>
        {entry.body && entry.kind !== "market_attribution" && (
          <p className="text-xs text-[var(--color-text-secondary)] mt-1 line-clamp-2">{entry.body}</p>
        )}
      </div>
    </div>
  );
}

function TimelineSection({ slug, entries, isLoading }) {
  const [expanded, setExpanded] = useState(false);

  // Group by calendar day, newest first (entries already arrive ts DESC).
  const groups = [];
  const seen = new Map();
  for (const e of entries) {
    const k = dayKey(e.ts);
    if (!seen.has(k)) { seen.set(k, groups.length); groups.push({ key: k, ts: e.ts, items: [] }); }
    groups[seen.get(k)].items.push(e);
  }

  // Mobile-collapse cutoff: the first 3 entries (across groups) always show;
  // the rest are hidden on mobile until "full timeline" is tapped. Desktop
  // always shows everything.
  let rank = 0;

  return (
    <section className="mb-8">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Clock size={15} className="text-[var(--color-accent)]" />
          <h2 className="font-semibold text-base text-[var(--color-text)]">Timeline</h2>
        </div>
        <Link to={`/timeline/${slug}`} className="text-[10px] text-[var(--color-accent)] hover:underline inline-flex items-center gap-1">
          Open standalone <ExternalLink size={9} />
        </Link>
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-4 py-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-12 rounded-lg bg-[var(--color-surface-2)] animate-pulse" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <p className="text-sm text-[var(--color-text-secondary)] py-8 text-center">
          No timeline entries yet — check back as the story develops.
        </p>
      ) : (
        <>
          {groups.map(g => (
            <div key={g.key} className="mb-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)] mb-1 sticky top-0">
                {dayHeading(g.ts)}
              </div>
              <div className="divide-y divide-[var(--color-border)]">
                {g.items.map(entry => {
                  const hideOnMobile = rank++ >= 3 && !expanded;
                  return (
                    <div key={entry.id} className={hideOnMobile ? "hidden sm:block" : ""}>
                      <TimelineEntry entry={entry} />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          {entries.length > 3 && !expanded && (
            <button
              onClick={() => setExpanded(true)}
              className="sm:hidden w-full mt-2 text-xs font-medium text-[var(--color-accent)] py-2 rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
            >
              Show full timeline (+{entries.length - 3})
            </button>
          )}
        </>
      )}
    </section>
  );
}

// ─── 3. COVERAGE (by outlet) ─────────────────────────────────────────────────

function OutletFavicon({ url, name }) {
  const [failed, setFailed] = useState(false);
  const host = hostname(url);
  const letter = (name || "?").trim().charAt(0).toUpperCase();
  if (failed || !host) {
    return (
      <div className="w-6 h-6 rounded flex items-center justify-center flex-shrink-0 bg-[var(--color-surface-2)] text-[10px] font-bold text-[var(--color-text-secondary)]">
        {letter}
      </div>
    );
  }
  // The outlet's OWN favicon — a direct request to their domain, not a third-
  // party tracker. onError degrades to the monogram above.
  return (
    <img
      src={`https://${host}/favicon.ico`}
      alt=""
      className="w-6 h-6 rounded flex-shrink-0 object-contain bg-[var(--color-surface-2)]"
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

function CoverageSection({ outlets = [], isLoading }) {
  const [showAll, setShowAll] = useState(false);

  // outlets arrive pre-grouped from /coverage — one row per outlet over ALL
  // event articles (not the 100-capped /articles), so the count here matches
  // the header badge exactly. Already sorted by article_count DESC.

  if (isLoading) {
    return (
      <section className="mb-8">
        <SectionHeader icon={Newspaper} label="Coverage" />
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-14 rounded-lg bg-[var(--color-surface-2)] animate-pulse" />
          ))}
        </div>
      </section>
    );
  }
  if (outlets.length === 0) return null;

  return (
    <section className="mb-8">
      <SectionHeader icon={Newspaper} label={`Coverage · ${outlets.length} outlet${outlets.length !== 1 ? "s" : ""}`} />
      <div className="space-y-2">
        {outlets.map((o, i) => {
          // Mobile: top-3 outlets, rest behind "show all". Desktop: all.
          const hideOnMobile = i >= 3 && !showAll;
          return (
            <a
              key={o.source_name}
              href={o.url}
              target="_blank"
              rel="noopener noreferrer"
              className={`flex items-center gap-3 p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-2)] transition-colors ${hideOnMobile ? "hidden sm:flex" : "flex"}`}
            >
              <OutletFavicon url={o.url} name={o.source_name} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-[var(--color-text)]">{o.source_name}</span>
                  {o.article_count > 1 && (
                    <span className="text-[10px] text-[var(--color-text-secondary)]">+{o.article_count - 1} more</span>
                  )}
                </div>
                <p className="text-sm text-[var(--color-text-secondary)] leading-snug line-clamp-1 mt-0.5">
                  {o.title}
                </p>
              </div>
              <ExternalLink size={12} className="text-[var(--color-text-secondary)] flex-shrink-0" />
            </a>
          );
        })}
      </div>
      {outlets.length > 3 && !showAll && (
        <button
          onClick={() => setShowAll(true)}
          className="sm:hidden w-full mt-2 text-xs font-medium text-[var(--color-accent)] py-2 rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
        >
          Show all {outlets.length} outlets
        </button>
      )}
    </section>
  );
}

// ─── 3b. THREADS (A5 facets — dark behind ?facets=1) ─────────────────────────
// Render-ready facets from event_facets (breaker facet pass: dual-source, gated,
// deduped, mechanically labeled — see docs/specs/a5_event_facets_design.md).
// EARN-RENDER: the shelf renders only with >= 2 facets; absent ≠ broken (A3 stance).
// Cards are DISPLAY-ONLY: a tombstone-sourced facet's original URL 302s back to
// this very dossier, so linking would self-loop.

function FacetShelf({ facets }) {
  if (!facets || facets.length < 2) return null;   // earn-render: < 2 threads → no shelf
  return (
    <section className="mb-8">
      <SectionHeader icon={Layers} label="Threads in this story" />
      <div className="grid sm:grid-cols-2 gap-3">
        {facets.map(f => (
          <div
            key={f.facet_id}
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 flex flex-col gap-1.5"
          >
            {f.label_entity && (
              <p className="text-[10px] uppercase tracking-wide text-[var(--color-accent)] font-semibold">
                {f.label_entity}
              </p>
            )}
            <p className="text-sm font-medium text-[var(--color-text)] leading-snug line-clamp-2">{f.label}</p>
            <p className="text-[10px] text-[var(--color-text-secondary)] mt-auto">
              {f.size} article{f.size !== 1 ? "s" : ""} · {f.sources} source{f.sources !== 1 ? "s" : ""}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── 4. ANGLES (related sub-events) ──────────────────────────────────────────

function AnglesSection({ related }) {
  if (!related || related.length === 0) return null;   // empty → no render (design)
  return (
    <section className="mb-8">
      <SectionHeader icon={GitBranch} label="Related angles" />
      <div className="grid sm:grid-cols-2 gap-3">
        {related.map(r => (
          <Link
            key={r.id}
            to={`/events/${r.slug}`}
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 hover:border-[var(--color-accent)] transition-colors flex flex-col gap-2"
          >
            <p className="text-sm font-medium text-[var(--color-text)] leading-snug line-clamp-2">{r.title}</p>
            <div className="flex items-center gap-2 text-[10px] text-[var(--color-text-secondary)]">
              {r.category && <span className="capitalize">{r.category}</span>}
              <span className="ml-auto">{r.source_count} outlet{r.source_count !== 1 ? "s" : ""}</span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

// ─── 5. ACTORS ───────────────────────────────────────────────────────────────

const ACTOR_ICON = { person: User, org: Building2, country: Globe };
const ACTOR_COLOR = {
  person:  "bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300",
  org:     "bg-purple-100 text-purple-600 dark:bg-purple-900/40 dark:text-purple-300",
  country: "bg-green-100 text-green-600 dark:bg-green-900/40 dark:text-green-300",
};
const ACTOR_CAP = 8;

function ActorChip({ actor }) {
  const [open, setOpen] = useState(false);
  const Icon = ACTOR_ICON[actor.actor_type] ?? Users;
  const color = ACTOR_COLOR[actor.actor_type] ?? "bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]";
  return (
    <button
      type="button"
      onClick={() => setOpen(o => !o)}
      title={actor.role || undefined}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-[var(--color-border)] text-xs ${color} max-w-full`}
    >
      <Icon size={12} className="flex-shrink-0" />
      <span className="font-medium truncate">{actor.actor_name}</span>
      {open && actor.role && (
        <span className="text-[10px] font-normal opacity-80 whitespace-normal">— {actor.role}</span>
      )}
    </button>
  );
}

function ActorsSection({ actors, isLoading }) {
  const [showAll, setShowAll] = useState(false);
  if (isLoading) {
    return (
      <section className="mb-8">
        <SectionHeader icon={Users} label="Key actors" />
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-7 w-24 rounded-full bg-[var(--color-surface-2)] animate-pulse" />
          ))}
        </div>
      </section>
    );
  }
  if (!actors || actors.length === 0) return null;

  const shown = showAll ? actors : actors.slice(0, ACTOR_CAP);
  const overflow = actors.length - shown.length;

  return (
    <section className="mb-8">
      <SectionHeader icon={Users} label="Key actors" />
      <div className="flex flex-wrap gap-2">
        {shown.map(a => <ActorChip key={a.actor_name} actor={a} />)}
        {overflow > 0 && (
          <button
            onClick={() => setShowAll(true)}
            className="inline-flex items-center px-2.5 py-1 rounded-full border border-[var(--color-border)] text-xs text-[var(--color-accent)] hover:bg-[var(--color-surface-2)]"
          >
            +{overflow} more
          </button>
        )}
      </div>
    </section>
  );
}

// ─── 6. INTELLIGENCE ─────────────────────────────────────────────────────────

function MarketRow({ market }) {
  return (
    <div className="flex flex-col gap-2 p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-[var(--color-text)] leading-snug flex-1">{market.question}</p>
        {market.url && (
          <a href={market.url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-[var(--color-accent)] hover:underline flex-shrink-0">
            Source ↗
          </a>
        )}
      </div>
      {market.yes_price != null && (
        <ProbabilityBar yesPrice={market.yes_price} noPrice={market.no_price ?? (1 - market.yes_price)} size="sm" />
      )}
      <div className="flex items-center gap-3 text-[10px] text-[var(--color-text-secondary)]">
        {market.volume_24h > 0 && <span>Vol 24h: ${market.volume_24h.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>}
        <span className="ml-auto">{market.source ?? "Polymarket"}</span>
      </div>
    </div>
  );
}

function RiTrend({ history }) {
  // Delta between the two most recent snapshots (history arrives ts DESC).
  const latest = history[0]?.reality_score;
  const prior  = history[1]?.reality_score;
  if (!Number.isFinite(latest) || !Number.isFinite(prior)) return null;
  const delta = latest - prior;
  const up = delta >= 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-medium ${up ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400"}`}>
      <Icon size={11} />
      {up ? "+" : ""}{(delta * 100).toFixed(1)} pt
    </span>
  );
}

function IntelligenceSection({ event, riData, sentData, markets }) {
  const riSnapshot = riData?.latest ?? null;
  const riHistory  = riData?.history ?? [];
  const sourceCount = event.source_count ?? 0;

  // Live markets = has a price and isn't resolved.
  const liveMarkets = markets.filter(m => m.yes_price != null && !m.resolved);

  // A3 earn-render for Reality Index: bound prediction question (a live/bound
  // market with a question) + trend (≥2 snapshots) + source count present.
  const hasBoundQuestion = markets.some(m => m.question);
  const hasTrend = riHistory.length >= 2;
  const riEarns = !!riSnapshot && hasBoundQuestion && hasTrend && sourceCount > 0;

  // A3 earn-render for Sentiment: total measured volume above the floor.
  const totalVolume = (sentData?.latest ?? []).reduce((s, x) => s + (x.volume ?? 0), 0);
  const sentimentEarns = totalVolume >= SENTIMENT_VOLUME_FLOOR;

  const marketsEarn = liveMarkets.length > 0;

  // Nothing earns render → the whole section is absent. No placeholders.
  if (!riEarns && !sentimentEarns && !marketsEarn) return null;

  return (
    <section className="mb-8">
      <SectionHeader icon={BarChart3} label="Intelligence" />
      <div className="flex flex-col gap-6">
        {riEarns && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs font-semibold text-[var(--color-text)]">Reality Index</span>
              <RiTrend history={riHistory} />
              <span className="ml-auto text-[10px] text-[var(--color-text-secondary)]">
                {sourceCount} source{sourceCount !== 1 ? "s" : ""}
              </span>
            </div>
            <RealityGauge snapshot={riSnapshot} />
          </div>
        )}

        {sentimentEarns && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <MessageCircle size={13} className="text-[var(--color-accent)]" />
              <span className="text-xs font-semibold text-[var(--color-text)]">Sentiment streams</span>
              <span className="ml-auto text-[10px] text-[var(--color-text-secondary)]">{totalVolume} mentions</span>
            </div>
            <SentimentSmallMultiples sentiment={sentData} />
          </div>
        )}

        {marketsEarn && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Activity size={13} className="text-[var(--color-accent)]" />
              <span className="text-xs font-semibold text-[var(--color-text)]">Prediction markets</span>
            </div>
            <div className="space-y-3">
              {liveMarkets.map(m => <MarketRow key={m.id} market={m} />)}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

// ─── orchestrator ────────────────────────────────────────────────────────────

export default function EventDossier({ event }) {
  const slug = event.slug;
  // A5 facet shelf — dark-shipped behind ?facets=1 (the A2 playbook). The enabled
  // flag means the dark path costs nothing: no /facets fetch unless the param is set.
  const [searchParams] = useSearchParams();
  const facetsOn = searchParams.get("facets") === "1";

  const { data: tlData,   isLoading: loadingTimeline }  = useEventTimeline(slug, { limit: 60 });
  const { data: covData,  isLoading: loadingCoverage }  = useEventCoverage(slug);
  const { data: actData,  isLoading: loadingActors }    = useEventActors(slug);
  const { data: mkData }                                = useEventMarkets(slug);
  const { data: riData }                                = useEventRealityIndex(slug, { history: true });
  const { data: sentData }                              = useEventSentiment(slug);
  const { data: facetData }                             = useEventFacets(slug, { enabled: facetsOn });

  const timeline = tlData?.timeline ?? [];
  const outlets  = covData?.outlets ?? [];
  const actors   = actData?.actors  ?? [];
  const markets  = mkData?.markets  ?? [];

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
      <Link to="/events" className="inline-flex items-center gap-1 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text)] mb-5 transition-colors">
        <ChevronLeft size={13} /> All events
      </Link>
      <DossierHeader event={event} />
      <TimelineSection slug={slug} entries={timeline} isLoading={loadingTimeline} />
      <CoverageSection outlets={outlets} isLoading={loadingCoverage} />
      {facetsOn && <FacetShelf facets={facetData?.facets} />}
      <AnglesSection related={event.related} />
      <ActorsSection actors={actors} isLoading={loadingActors} />
      <IntelligenceSection event={event} riData={riData} sentData={sentData} markets={markets} />
    </div>
  );
}
