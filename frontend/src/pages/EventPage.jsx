/**
 * EventPage — /events/:slug — full event dossier.
 *
 * Sections:
 *  1. EventHero (title, severity, top market probability)
 *  2. Reality Index gauge (4-component composite + truth gap)         [Phase 3]
 *  3. Sentiment small-multiples (per-source polarity time-series)     [Phase 3]
 *  4. Timeline (chronological articles + market moves)
 *  5. Key Actors
 *  6. Bound Markets
 *  7. Perspectives (multi-outlet comparison)
 *  8. All Articles
 */

import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ChevronLeft, Activity, Users, Newspaper, Clock, Layers, BarChart3, MessageCircle, ExternalLink, Radar } from "lucide-react";
import {
  useEvent,
  useEventTimeline,
  useEventMarkets,
  useEventActors,
  useEventArticles,
  useEventPerspectives,
  useEventSentiment,
  useEventRealityIndex,
} from "../hooks/useEvents";
import { useEventTrackers } from "../hooks/useTrackers";
import { trackerStrength } from "../lib/trackerRank";
import TrackerCard from "../components/trackers/TrackerCard";
import EventHero     from "../components/events/EventHero";
import EventTimeline from "../components/events/EventTimeline";
import EventActorPanel from "../components/events/EventActorPanel";
import ProbabilityBar  from "../components/predictions/ProbabilityBar";
import RealityGauge    from "../components/predictions/RealityGauge";
import SentimentSmallMultiples from "../components/predictions/SentimentSmallMultiples";

function SectionHeader({ icon: Icon, label }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <Icon size={15} className="text-[var(--color-accent)]" />
      <h2 className="font-semibold text-base text-[var(--color-text)]">{label}</h2>
    </div>
  );
}

function MarketRow({ market }) {
  return (
    <div className="flex flex-col gap-2 p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-[var(--color-text)] leading-snug flex-1">
          {market.question}
        </p>
        {market.url && (
          <a
            href={market.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] text-[var(--color-accent)] hover:underline flex-shrink-0"
          >
            Source ↗
          </a>
        )}
      </div>
      {market.yes_price != null && (
        <ProbabilityBar yesPrice={market.yes_price} noPrice={market.no_price ?? (1 - market.yes_price)} size="sm" />
      )}
      <div className="flex items-center gap-3 text-[10px] text-[var(--color-text-secondary)]">
        {market.volume_24h > 0 && (
          <span>Vol 24h: ${market.volume_24h.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
        )}
        {market.liquidity > 0 && (
          <span>Liquidity: ${market.liquidity.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
        )}
        <span className="ml-auto">{market.source ?? "Polymarket"}</span>
      </div>
    </div>
  );
}

function ArticleRow({ article }) {
  return (
    <a
      href={article.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-start gap-3 py-3 hover:bg-[var(--color-surface-2)] px-2 -mx-2 rounded-lg transition-colors"
    >
      {article.image_url && (
        <img
          src={article.image_url}
          alt=""
          className="w-14 h-10 object-cover rounded flex-shrink-0"
          loading="lazy"
        />
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[var(--color-text)] leading-snug line-clamp-2">
          {article.title}
        </p>
        <div className="flex items-center gap-2 mt-0.5 text-[10px] text-[var(--color-text-secondary)]">
          <span>{article.source_name}</span>
          {article.published_at && (
            <span>·{" "}
              {new Date(article.published_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
            </span>
          )}
        </div>
      </div>
    </a>
  );
}

export default function EventPage() {
  const { slug } = useParams();
  const [timelineKind, setTimelineKind] = useState(undefined);

  const { data: event,   isLoading: loadingEvent }     = useEvent(slug);
  const { data: tlData,  isLoading: loadingTimeline }  = useEventTimeline(slug, { kind: timelineKind, limit: 60 });
  const { data: mkData,  isLoading: loadingMarkets }   = useEventMarkets(slug);
  const { data: actData, isLoading: loadingActors }    = useEventActors(slug);
  const { data: artData, isLoading: loadingArticles }  = useEventArticles(slug, { limit: 30 });
  const { data: pvData,  isLoading: loadingPerspectives } = useEventPerspectives(slug);
  const { data: riData,  isLoading: loadingRI }        = useEventRealityIndex(slug);
  const { data: sentData, isLoading: loadingSentiment } = useEventSentiment(slug);
  const { data: trkData, isLoading: loadingTrackers }  = useEventTrackers(slug);

  const timeline     = tlData?.timeline     ?? [];
  const markets      = mkData?.markets      ?? [];
  const actors       = actData?.actors      ?? [];
  const articles     = artData?.articles    ?? [];
  const perspectives = pvData?.perspectives ?? [];
  const riSnapshot   = riData?.latest                 ?? null;

  // Tracker Auto-Detection Engine scorecards for this event (Sprint 1.5.3).
  // An event can carry MULTIPLE trackers via multi-template fan-out (e.g. a
  // politics event → conflict + incident + election). Stack ALL of them,
  // ordered by confidence strength (highest first; recency tiebreak — the
  // same ordering pickHeadlineTracker uses for the compact case).
  const trackers = [...(trkData?.trackers ?? [])].sort((a, b) => {
    const d = trackerStrength(b) - trackerStrength(a);
    return d !== 0 ? d : (b.last_updated_at ?? 0) - (a.last_updated_at ?? 0);
  });

  if (loadingEvent) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-10">
        <div className="h-64 rounded-xl bg-[var(--color-surface-2)] animate-pulse" />
      </div>
    );
  }

  if (!event) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center">
        <p className="text-[var(--color-text-secondary)] text-sm">Event not found.</p>
        <Link to="/events" className="mt-4 inline-flex items-center gap-1 text-sm text-[var(--color-accent)] hover:underline">
          <ChevronLeft size={14} /> Back to events
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
      {/* Back link */}
      <Link
        to="/events"
        className="inline-flex items-center gap-1 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text)] mb-5 transition-colors"
      >
        <ChevronLeft size={13} /> All events
      </Link>

      {/* Hero */}
      <EventHero event={event} markets={markets} truthGap={riSnapshot?.truth_gap} />

      {/* Reality Index gauge */}
      {(riSnapshot || loadingRI) && (
        <section className="mb-8">
          <SectionHeader icon={BarChart3} label="Reality Index" />
          {loadingRI ? (
            <div className="h-44 rounded-xl bg-[var(--color-surface-2)] animate-pulse" />
          ) : (
            <RealityGauge snapshot={riSnapshot} />
          )}
        </section>
      )}

      {/* Trackers — Tracker Auto-Detection Engine Layer 1 cards (Sprint 1.5.3).
          Conditional-gated like every other section: renders only when this
          event has trackers (or while loading). Each card links to its Layer 2
          page (/trackers/:id). Stacked, confidence-ordered (see above). */}
      {(trackers.length > 0 || loadingTrackers) && (
        <section className="mb-8">
          <SectionHeader icon={Radar} label="Trackers" />
          {loadingTrackers ? (
            <div className="grid sm:grid-cols-2 gap-4">
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className="h-32 rounded-xl bg-[var(--color-surface-2)] animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 gap-4">
              {trackers.map(tr => <TrackerCard key={tr.id} tracker={tr} />)}
            </div>
          )}
        </section>
      )}

      {/* Sentiment small-multiples */}
      {((sentData?.latest?.length ?? 0) > 0 || loadingSentiment) && (
        <section className="mb-8">
          <SectionHeader icon={MessageCircle} label="Sentiment streams" />
          <SentimentSmallMultiples sentiment={sentData} isLoading={loadingSentiment} />
        </section>
      )}

      {/* Timeline */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Clock size={15} className="text-[var(--color-accent)]" />
            <h2 className="font-semibold text-base text-[var(--color-text)]">Timeline</h2>
          </div>
          <Link
            to={`/timeline/${slug}`}
            className="text-[10px] text-[var(--color-accent)] hover:underline inline-flex items-center gap-1"
          >
            Open standalone <ExternalLink size={9} />
          </Link>
        </div>
        <EventTimeline entries={timeline} isLoading={loadingTimeline} onKindChange={setTimelineKind} />
      </section>

      {/* Key Actors */}
      {(actors.length > 0 || loadingActors) && (
        <section className="mb-8">
          <SectionHeader icon={Users} label="Key Actors" />
          <EventActorPanel actors={actors} isLoading={loadingActors} />
        </section>
      )}

      {/* Markets */}
      {(markets.length > 0 || loadingMarkets) && (
        <section className="mb-8">
          <SectionHeader icon={Activity} label="Prediction Markets" />
          {loadingMarkets ? (
            <div className="space-y-2">
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className="h-24 rounded-lg bg-[var(--color-surface-2)] animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {markets.map(m => <MarketRow key={m.id} market={m} />)}
            </div>
          )}
        </section>
      )}

      {/* Perspectives — same story across outlets */}
      {(perspectives.length > 1 || loadingPerspectives) && (
        <section className="mb-8">
          <SectionHeader icon={Layers} label="Perspectives" />
          {loadingPerspectives ? (
            <div className="grid sm:grid-cols-2 gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-28 rounded-lg bg-[var(--color-surface-2)] animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 gap-3">
              {perspectives.slice(0, 6).map(p => (
                <div
                  key={p.source}
                  className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 flex flex-col gap-2"
                >
                  <p className="text-xs font-semibold text-[var(--color-text)] uppercase tracking-wide">
                    {p.source}
                  </p>
                  <ul className="space-y-1.5">
                    {p.articles.map(a => (
                      <li key={a.id} className="text-xs leading-snug">
                        <a
                          href={a.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] line-clamp-2"
                        >
                          {a.title}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Articles */}
      <section>
        <SectionHeader icon={Newspaper} label={`Articles (${artData?.total ?? articles.length})`} />
        {loadingArticles ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-12 rounded bg-[var(--color-surface-2)] animate-pulse" />
            ))}
          </div>
        ) : articles.length > 0 ? (
          <div className="divide-y divide-[var(--color-border)]">
            {articles.map(a => <ArticleRow key={a.id} article={a} />)}
          </div>
        ) : (
          <p className="text-sm text-[var(--color-text-secondary)]">No articles linked yet.</p>
        )}
      </section>
    </div>
  );
}
