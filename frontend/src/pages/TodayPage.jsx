/**
 * TodayPage — `/` under SITE_V2 (issue #189, plan v7 Phase 1 item 2).
 *
 * Four blocks, each earn-rendered (no placeholders, no empty containers):
 *   1. Lead story      — the top prominence event, large, mechanical text only
 *                        (headline, category, "day N · N outlets"; no LLM summary).
 *   2. Developing      — a horizontal strip of multi-day active events, minus the lead.
 *                        Red "Live" only on an event active in the last hour.
 *   3. Today's stories — everything else from the same list, once each.
 *   4. Radio card      — only when /api/radio/state.json answers 200 with a headline.
 *
 * The whole page comes from ONE /api/ri/events prominence request (the classic
 * HomePage made ~10: one per category band). Categories are reached via the topic chips.
 *
 * Tokens: reads the #188 variables (--sf-*) with their literal values as fallbacks,
 * so it renders the same whether or not #188 has merged.
 * TODO(#188): drop the fallbacks once tokens.css is on main.
 */
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import EventCard from "../components/events/EventCard";
import { useEvents } from "../hooks/useEvents";
import LoadingCard from "../components/ui/LoadingCard";
import TimeoutNotice, { useTimedOut } from "../components/ui/TimeoutNotice";
import ScoopMascot from "../components/mascot/ScoopMascot";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const FETCH_LIMIT = 40; // the endpoint caps at 100 (routes events.js)
const TODAY_MAX = 18;

const READING = 'var(--sf-reading, "Newsreader", Georgia, "Times New Roman", serif)';
const LABEL = 'var(--sf-label, "Schibsted Grotesk", system-ui, sans-serif)';
const LIVE = "var(--sf-live, #D7261E)";

// Same span logic as HomePage / the EventCard lifespan badge.
export function isDeveloping(ev) {
  const span = (ev.last_activity_at ?? 0) - (ev.started_at ?? 0);
  return ev.status === "active" && !!ev.started_at && span >= DAY_MS;
}
export function isLiveNow(ev, now = Date.now()) {
  return ev.status === "active" && !!ev.last_activity_at && now - ev.last_activity_at <= HOUR_MS;
}
function dayN(ev) {
  const span = (ev.last_activity_at ?? 0) - (ev.started_at ?? 0);
  return Math.max(1, Math.floor(span / DAY_MS) + 1);
}
const plural = (n, w) => `${n} ${w}${n !== 1 ? "s" : ""}`;

/**
 * Split one prominence list into the page's blocks; each event id appears at most once.
 * Exported for tests.
 */
export function layoutToday(events) {
  const lead = events[0] ?? null;
  const developing = events.filter(ev => ev.id !== lead?.id && isDeveloping(ev)).slice(0, 8);
  const placed = new Set([lead, ...developing].filter(Boolean).map(ev => ev.id));
  const today = [];
  for (const ev of events) {
    if (today.length >= TODAY_MAX) break;
    if (placed.has(ev.id)) continue;
    placed.add(ev.id); // also guards against a duplicate id inside the list itself
    today.push(ev);
  }
  return { lead, developing, today };
}

function useRadioState() {
  return useQuery({
    queryKey: ["radio-state-card"],
    queryFn: async () => {
      const res = await fetch("/api/radio/state.json", { headers: { Accept: "application/json" } });
      if (!res.ok) return null; // 404 = radio dark, 503 = not built yet: no card either way
      return res.json();
    },
    retry: false,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
}

function MetaLine({ ev }) {
  return (
    <p className="text-xs uppercase tracking-wider text-[var(--color-text-tertiary)]" style={{ fontFamily: LABEL }}>
      {ev.category && <span className="font-semibold text-[var(--color-text-secondary)]">{ev.category}</span>}
      {ev.category && " · "}
      day {dayN(ev)} · {plural(ev.source_count || 0, "outlet")}
    </p>
  );
}

function LeadStory({ ev }) {
  return (
    <Link to={`/events/${ev.slug}`} className="group block" data-testid="today-lead" data-event-id={ev.id}>
      {ev.hero_image_url && (
        <div className="aspect-[16/9] rounded-xl overflow-hidden bg-[var(--color-surface2)] mb-4">
          <img src={ev.hero_image_url} alt="" className="w-full h-full object-cover" />
        </div>
      )}
      <MetaLine ev={ev} />
      <h2
        className="mt-2 text-3xl sm:text-4xl font-semibold leading-tight text-[var(--color-text)] group-hover:text-[var(--color-accent)] transition-colors"
        style={{ fontFamily: READING }}
      >
        {ev.title}
      </h2>
    </Link>
  );
}

function DevelopingStrip({ events }) {
  const now = Date.now();
  return (
    <section aria-labelledby="today-developing" data-testid="today-developing">
      <h2 id="today-developing" className="text-sm font-bold uppercase tracking-wider text-[var(--color-text-secondary)] mb-3" style={{ fontFamily: LABEL }}>
        Developing
      </h2>
      <ul className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4 snap-x">
        {events.map(ev => (
          <li key={ev.id} className="snap-start shrink-0 w-64">
            <Link
              to={`/events/${ev.slug}`}
              data-event-id={ev.id}
              className="block h-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 hover:border-[var(--color-accent)] transition-colors"
            >
              <p className="text-[11px] uppercase tracking-wider text-[var(--color-text-tertiary)]" style={{ fontFamily: LABEL }}>
                {isLiveNow(ev, now) && (
                  <span data-testid="live-badge" className="font-bold mr-1" style={{ color: LIVE }}>Live ·</span>
                )}
                day {dayN(ev)} · {plural(ev.source_count || 0, "outlet")}
              </p>
              <h3 className="mt-1 text-base font-semibold leading-snug line-clamp-3 text-[var(--color-text)]" style={{ fontFamily: READING }}>
                {ev.title}
              </h3>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function RadioCard({ state }) {
  const also = (state.alsoThisHour ?? []).filter(x => x && x.h).slice(0, 2);
  return (
    <Link
      to="/live-tv"
      data-testid="today-radio"
      className="block rounded-xl p-5 text-[var(--sf-paper,#F4EFE6)] hover:opacity-95 transition-opacity"
      style={{ background: "var(--radio-navy, #0F2238)" }}
    >
      <p className="text-xs font-bold uppercase tracking-wider opacity-80" style={{ fontFamily: LABEL }}>ScoopFeeds Radio</p>
      <p className="mt-2 text-xl font-semibold leading-snug" style={{ fontFamily: READING }}>{state.headline}</p>
      {also.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm opacity-90">
          {also.map((x, i) => <li key={i}>{x.h}</li>)}
        </ul>
      )}
      <p className="mt-3 text-sm font-semibold underline" style={{ fontFamily: LABEL }}>Listen →</p>
    </Link>
  );
}

export default function TodayPage() {
  const { data, isLoading, isError, isSuccess, refetch } = useEvents({ sort: "prominence", limit: FETCH_LIMIT });
  const [timedOut, restartTimer] = useTimedOut(isLoading);
  const { data: radio } = useRadioState();
  const events = data?.events ?? [];
  const { lead, developing, today } = layoutToday(events);
  const radioOn = !!(radio && typeof radio.headline === "string" && radio.headline.trim());

  return (
    <div className="space-y-10 py-2" data-testid="today-page">
      {/* The page's only h1. */}
      <h1 className="text-sm font-bold uppercase tracking-wider text-[var(--color-text-secondary)]" style={{ fontFamily: LABEL }}>
        Today
      </h1>

      {isLoading && timedOut ? (
        <TimeoutNotice what="Today's stories" onRetry={() => { restartTimer(); refetch(); }} />
      ) : isLoading ? (
        <div className="space-y-4">
          <LoadingCard />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {Array.from({ length: 4 }).map((_, i) => <LoadingCard key={i} />)}
          </div>
        </div>
      ) : events.length === 0 ? (
        <div className="flex flex-col items-center gap-4 py-20 text-center">
          <ScoopMascot size="lg" mood="reading" animated />
          {/* Positive evidence only: "no stories" needs a successful empty response. */}
          <p className="text-sm text-[var(--color-text-tertiary)]">
            {isSuccess && !isError
              ? "No stories right now — check back shortly."
              : "Temporarily busy — stories will be back in a moment. Retrying…"}
          </p>
        </div>
      ) : (
        <>
          <div className={radioOn ? "lg:grid lg:grid-cols-[1fr_320px] lg:gap-10 lg:items-start space-y-8 lg:space-y-0" : ""}>
            {lead && <LeadStory ev={lead} />}
            {radioOn && <RadioCard state={radio} />}
          </div>

          {developing.length > 0 && <DevelopingStrip events={developing} />}

          {today.length > 0 && (
            <section aria-labelledby="today-stories" data-testid="today-stories">
              <div className="flex items-baseline justify-between mb-4 gap-3">
                <h2 id="today-stories" className="text-xl font-bold tracking-tight text-[var(--color-text)]">
                  Today's stories
                </h2>
                <Link to="/events" className="text-sm font-semibold text-[var(--color-accent)] hover:underline whitespace-nowrap">
                  See all stories →
                </Link>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {today.map(ev => (
                  <div key={ev.id} data-event-id={ev.id}>
                    <EventCard event={ev} variant="news" />
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
