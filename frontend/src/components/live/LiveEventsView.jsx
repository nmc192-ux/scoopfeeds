/**
 * LiveEventsView — rendered when the user picks the "Live" tab.
 *
 * Two layers:
 *   1. Index — a vertical list of active event cards (US-Iran, …). Each
 *      card shows the event title, one-sentence summary, and "updated N
 *      min ago". Clicking opens the dossier.
 *   2. Dossier — the full briefing: metric tiles (casualties, economic
 *      losses, Brent crude, ceasefire countdown) + a timestamped point-
 *      wise timeline synthesized from recent articles (Gemini 1.5 Flash
 *      where configured; deterministic headlines otherwise).
 *
 * The design borrows from Apple News' event pages: big hero, metric
 * strip, reverse-chronological timeline with source citations inline.
 */
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronRight, ArrowLeft, ExternalLink, RefreshCw, TrendingUp } from "lucide-react";
import { useLiveEvents, useEventDossier, useEventCandidates } from "../../hooks/useLiveEvents";

function timeAgo(iso) {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export default function LiveEventsView() {
  const [selectedId, setSelectedId] = useState(null);
  const { data: events = [], isLoading } = useLiveEvents();
  const { data: candidates = [] } = useEventCandidates();

  if (selectedId) {
    return <EventDossier id={selectedId} onBack={() => setSelectedId(null)} />;
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
        <h2 className="text-lg font-bold text-[var(--color-text)]">Live Events</h2>
        <span className="text-xs text-[var(--color-text-tertiary)]">
          AI-synthesized dossiers, updated hourly
        </span>
      </div>

      {isLoading && (
        <div className="space-y-3">
          {[0, 1].map((i) => (
            <div key={i} className="h-28 rounded-2xl bg-[var(--color-surface)] border border-[var(--color-border)] animate-pulse" />
          ))}
        </div>
      )}

      <div className="space-y-3">
        {events.map((evt) => (
          <motion.button
            key={evt.id}
            whileHover={{ y: -1 }}
            onClick={() => setSelectedId(evt.id)}
            className="w-full text-left card card-hover p-4 flex items-start gap-4"
          >
            <div className="flex-shrink-0 text-2xl">{evt.emoji || "🛰️"}</div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-semibold text-[var(--color-text)]">{evt.title}</h3>
                <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide font-bold px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-500">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500" /> Live
                </span>
              </div>
              {evt.subtitle && (
                <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">{evt.subtitle}</p>
              )}
              <p className="text-sm text-[var(--color-text-secondary)] mt-2 line-clamp-2">
                {evt.summary || "Synthesizing first brief — check back shortly."}
              </p>
              <div className="text-[11px] text-[var(--color-text-tertiary)] mt-2">
                Updated {timeAgo(evt.updated_at)}
              </div>
            </div>
            <ChevronRight size={18} className="text-[var(--color-text-tertiary)] flex-shrink-0 mt-1" />
          </motion.button>
        ))}
      </div>

      {!isLoading && events.length === 0 && (
        <div className="text-center py-12 text-[var(--color-text-tertiary)]">
          No live events tracked yet
        </div>
      )}

      {candidates.length > 0 && (
        <div className="mt-8">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp size={14} className="text-amber-500" />
            <h3 className="text-sm font-bold uppercase tracking-wide text-[var(--color-text)]">
              Emerging
            </h3>
            <span className="text-[11px] text-[var(--color-text-tertiary)]">
              Spiking in the feed — candidates for a new dossier
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {candidates.slice(0, 8).map((c, i) => (
              <div
                key={i}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--color-surface2)] border border-[var(--color-border)] text-xs"
                title={`${c.articles} articles across ${c.sources} outlets · avg authenticity ${c.avgAuthenticity}/10`}
              >
                <span className="font-semibold">{c.phrase}</span>
                <span className="text-[var(--color-text-tertiary)]">
                  {c.articles}×
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-[11px] text-[var(--color-text-tertiary)] mt-6 text-center max-w-xl mx-auto">
        Scoop picks global events from geopolitics and breaking-news signals, synthesizes
        timestamped briefs from trusted outlets (Al Jazeera, Reuters, AP, BBC…), and layers
        live market data on top. Phase C adds X / Truth Social signals and auto-discovery via
        Google Trends.
      </p>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Dossier view
// ────────────────────────────────────────────────────────────────────────

function EventDossier({ id, onBack }) {
  const { data: evt, isLoading, refetch, isFetching } = useEventDossier(id);

  if (isLoading || !evt) {
    return (
      <div>
        <button onClick={onBack} className="text-sm text-[var(--color-text-tertiary)] mb-4 inline-flex items-center gap-1">
          <ArrowLeft size={14} /> Back to events
        </button>
        <div className="h-64 rounded-2xl bg-[var(--color-surface)] border border-[var(--color-border)] animate-pulse" />
      </div>
    );
  }

  const metrics = evt.metrics || {};
  const provenance = metrics._provenance;
  const metricTiles = [
    { key: "casualties",     label: "Reported casualties",   icon: "🕊️" },
    { key: "economicLoss",   label: "Economic losses (est.)", icon: "💸" },
    { key: "crudeOil",       label: "Brent crude",            icon: "🛢️" },
    { key: "ceasefireClock", label: "Ceasefire status",       icon: "⏳" },
  ].map((t) => ({ ...t, data: metrics[t.key] }));

  return (
    <div>
      <button onClick={onBack} className="text-sm text-[var(--color-text-tertiary)] mb-4 inline-flex items-center gap-1 hover:text-[var(--color-text)]">
        <ArrowLeft size={14} /> Back to events
      </button>

      {/* Hero */}
      <div className="card p-5 mb-4">
        <div className="flex items-start gap-3">
          <div className="text-3xl">{evt.emoji || "🛰️"}</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-xl font-bold text-[var(--color-text)]">{evt.title}</h2>
              <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide font-bold px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-500">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" /> Live
              </span>
            </div>
            {evt.subtitle && <p className="text-sm text-[var(--color-text-tertiary)] mt-1">{evt.subtitle}</p>}
            {evt.summary && <p className="text-sm text-[var(--color-text-secondary)] mt-3">{evt.summary}</p>}
            <div className="flex items-center gap-3 text-[11px] text-[var(--color-text-tertiary)] mt-3">
              <span>Updated {timeAgo(evt.updated_at)}</span>
              <button
                onClick={() => refetch()}
                className="inline-flex items-center gap-1 hover:text-[var(--color-text)]"
                disabled={isFetching}
              >
                <RefreshCw size={11} className={isFetching ? "animate-spin" : ""} />
                Refresh
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Metric tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {metricTiles.map((t) => <MetricTile key={t.key} {...t} />)}
      </div>

      {/* Brief timeline */}
      <h3 className="text-sm font-bold text-[var(--color-text)] uppercase tracking-wide mb-3">
        Timestamped Brief
      </h3>
      {evt.brief.length === 0 ? (
        <div className="text-sm text-[var(--color-text-tertiary)] py-4">
          No briefing points synthesized yet — the scheduler runs hourly and needs a few
          matching articles in the feed. Check back shortly.
        </div>
      ) : (
        <ol className="relative border-l-2 border-[var(--color-border)] ml-2 space-y-4">
          <AnimatePresence initial={false}>
            {evt.brief.map((point, i) => (
              <motion.li
                key={i}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                className="ml-4 pl-2"
              >
                <span className="absolute -left-[7px] w-3 h-3 rounded-full bg-red-500 ring-2 ring-[var(--color-bg)]" />
                <div className="text-[11px] font-mono text-[var(--color-text-tertiary)]">
                  {new Date(point.ts).toLocaleString(undefined, {
                    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
                  })}
                </div>
                <p className="text-sm text-[var(--color-text)] mt-0.5">{point.text}</p>
                {point.sources && point.sources.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-1.5">
                    {point.sources.map((s, j) => (
                      <a
                        key={j}
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] text-cobalt-600 hover:underline"
                      >
                        {s.name}
                        <ExternalLink size={10} />
                      </a>
                    ))}
                  </div>
                )}
              </motion.li>
            ))}
          </AnimatePresence>
        </ol>
      )}

      {provenance && (
        <div className="mt-8 pt-4 border-t border-[var(--color-border)]">
          <h4 className="text-[11px] uppercase tracking-wide font-bold text-[var(--color-text-tertiary)] mb-2">
            Sources used for this dossier
          </h4>
          <div className="flex flex-wrap gap-1.5">
            {(provenance.outlets || []).map((o, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-[var(--color-surface2)] border border-[var(--color-border)]"
                title={`Media authenticity score: ${o.score}/10`}
              >
                {o.name}
                <span className="text-[var(--color-text-tertiary)] font-mono">
                  {Number(o.score).toFixed(1)}
                </span>
              </span>
            ))}
          </div>
          <p className="text-[10px] text-[var(--color-text-tertiary)] mt-2">
            {provenance.llmUsed
              ? "AI synthesis: Gemini 1.5 Flash"
              : "AI synthesis: off (deterministic headline timeline)"}
            {provenance.socialEnabled
              ? ` · ${provenance.socialPosts} social posts considered (X + Truth Social via RSSHub)`
              : " · social signals: off"}
          </p>
        </div>
      )}
    </div>
  );
}

function MetricTile({ label, icon, data }) {
  const hasValue = data && data.value !== null && data.value !== undefined && data.value !== "";
  return (
    <div className="card p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide font-bold text-[var(--color-text-tertiary)]">
        <span>{icon}</span>
        <span className="truncate">{label}</span>
      </div>
      <div className="text-xl font-bold text-[var(--color-text)] mt-1">
        {hasValue ? (
          <>
            {typeof data.value === "number" ? data.value.toLocaleString() : data.value}
            {data.unit && <span className="text-xs font-normal text-[var(--color-text-tertiary)] ml-1">{data.unit}</span>}
          </>
        ) : (
          <span className="text-[var(--color-text-tertiary)] text-sm font-normal">—</span>
        )}
      </div>
      {data?.pctChange != null && (
        <div className={`text-xs font-semibold mt-0.5 ${data.pctChange >= 0 ? "text-green-500" : "text-red-500"}`}>
          {data.pctChange >= 0 ? "▲" : "▼"} {Math.abs(data.pctChange).toFixed(2)}%
        </div>
      )}
      {data?.note && (
        <div className="text-[10px] text-[var(--color-text-tertiary)] mt-1 line-clamp-2">{data.note}</div>
      )}
    </div>
  );
}
