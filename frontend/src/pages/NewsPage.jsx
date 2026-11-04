/**
 * NewsPage — `/news` under SITE_V2 (issue #327, plan v7 Phase 1 item 4).
 *
 * One list of every tracked story, in four groups, each earn-rendered (an empty group is
 * absent: no heading, no container):
 *   1. Developing   — active events whose span is under 7 days.
 *   2. Long-running — active events whose span is 7 days or more ("day N").
 *   3. Settled      — dormant events, newest activity first, 24 at most.
 *   4. Trackers     — active trackers.
 *
 * Replaces /events and the six category pages (they redirect here under v2).
 * Two /api/events requests (active, dormant) plus one /api/ri/trackers request.
 * Mechanical card text only: title, category, "day N · N outlets", last activity.
 * No odds, no probabilities, no LLM prose.
 */
import { Link, useSearchParams } from "react-router-dom";
import { useEvents } from "../hooks/useEvents";
import { useTrackers } from "../hooks/useTrackers";
import { useGeo } from "../hooks/useGeo";
import { feedCountryParam } from "../lib/feedCountries";
import { isLiveNow } from "./TodayPage";
import TrackerCard from "../components/trackers/TrackerCard";
import LoadingCard from "../components/ui/LoadingCard";
import TimeoutNotice, { useTimedOut } from "../components/ui/TimeoutNotice";

const DAY_MS = 86_400_000;
const LONG_RUNNING_DAYS = 7; // the same 7 days as DORMANT_AFTER_MS in eventPromoter
const ACTIVE_LIMIT = 100;    // the endpoint cap
const SETTLED_LIMIT = 24;
const TRACKER_LIMIT = 12;

const READING = 'var(--sf-reading, "Newsreader", Georgia, "Times New Roman", serif)';
const LABEL = 'var(--sf-label, "Schibsted Grotesk", system-ui, sans-serif)';
const LIVE = "var(--sf-live, #D7261E)";

// The URL is the source of truth, so the category-page redirects (/health -> ?topic=health)
// land on the right chip.
export const TOPICS = [
  { id: "",            label: "All" },
  { id: "politics",    label: "Politics" },
  { id: "finance",     label: "Finance" },
  { id: "tech",        label: "Tech" },
  { id: "ai",          label: "AI" },
  { id: "science",     label: "Science" },
  { id: "space",       label: "Space" },
  { id: "health",      label: "Health" },
  { id: "sports",      label: "Sports" },
  { id: "geopolitics", label: "Geopolitics" },
  { id: "climate",     label: "Climate" },
  { id: "crypto",      label: "Crypto" },
];

const spanMs = (ev) => (ev.last_activity_at ?? 0) - (ev.started_at ?? 0);
export function dayN(ev) {
  return Math.max(1, Math.floor(spanMs(ev) / DAY_MS) + 1);
}

/**
 * Split one active prominence list into Developing and Long-running. Every event lands in
 * exactly one of them, and an id seen twice is placed once. Exported for tests.
 */
export function splitActive(events) {
  const seen = new Set();
  const developing = [];
  const longRunning = [];
  for (const ev of events ?? []) {
    if (!ev?.id || seen.has(ev.id)) continue;
    seen.add(ev.id);
    const long = !!ev.started_at && spanMs(ev) >= LONG_RUNNING_DAYS * DAY_MS;
    (long ? longRunning : developing).push(ev);
  }
  return { developing, longRunning };
}

const plural = (n, w) => `${n} ${w}${n !== 1 ? "s" : ""}`;

function ago(ms, now = Date.now()) {
  if (!ms) return "";
  const diff = now - ms;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < DAY_MS) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / DAY_MS)}d ago`;
}

function lastDate(ms) {
  if (!ms) return "";
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function NewsCard({ ev, mode }) {
  const live = mode !== "settled" && isLiveNow(ev);
  const parts = [];
  if (mode === "long") parts.push(`day ${dayN(ev)}`);
  if (ev.source_count > 0) parts.push(plural(ev.source_count, "outlet"));
  const meta = parts.join(" · ");
  return (
    <Link
      to={`/events/${ev.slug}`}
      data-testid="news-card"
      data-event-id={ev.id}
      className="group block rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 hover:border-[var(--color-accent)] transition-colors"
    >
      <div className="flex items-center gap-2 text-xs" style={{ fontFamily: LABEL }}>
        {live && (
          <span data-testid="live-badge" className="inline-flex items-center gap-1 font-bold uppercase tracking-wide" style={{ color: LIVE }}>
            <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: LIVE }} aria-hidden="true" />
            Live
          </span>
        )}
        {ev.category && (
          <span className="uppercase tracking-wider font-semibold text-[var(--color-text-secondary)]">{ev.category}</span>
        )}
      </div>
      <h3
        className="mt-1.5 text-base font-semibold leading-snug text-[var(--color-text)] line-clamp-3 group-hover:text-[var(--color-accent)] transition-colors"
        style={{ fontFamily: READING }}
      >
        {ev.title}
      </h3>
      <p className="mt-2 text-xs text-[var(--color-text-secondary)]" style={{ fontFamily: LABEL }}>
        {meta && <span>{meta} · </span>}
        {mode === "settled" ? `last activity ${lastDate(ev.last_activity_at)}` : ago(ev.last_activity_at)}
      </p>
    </Link>
  );
}

function Group({ id, title, children }) {
  return (
    <section aria-labelledby={`news-${id}`} data-testid={`news-${id}`}>
      <h2 id={`news-${id}`} className="text-xl font-bold tracking-tight text-[var(--color-text)] mb-4">{title}</h2>
      {children}
    </section>
  );
}

const Grid = ({ children }) => <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">{children}</div>;

export default function NewsPage() {
  const [params, setParams] = useSearchParams();
  const topic = TOPICS.some(t => t.id === params.get("topic")) ? params.get("topic") : "";
  const category = topic || undefined;

  // #190: the reader's country first. Wait for geo so the page makes ONE request per status.
  const geo = useGeo();
  const country = feedCountryParam(geo.countryCode);
  const enabled = !geo.isLoading;
  const active = useEvents({ category, status: "active", sort: "prominence", limit: ACTIVE_LIMIT, country, enabled });
  const dormant = useEvents({ category, status: "dormant", limit: SETTLED_LIMIT, country, enabled });
  const trackers = useTrackers({ status: "active", limit: TRACKER_LIMIT });

  const isLoading = geo.isLoading || active.isLoading;
  const [timedOut, restartTimer] = useTimedOut(isLoading);

  const { developing, longRunning } = splitActive(active.data?.events);
  const activeIds = new Set([...developing, ...longRunning].map(ev => ev.id));
  const settled = (dormant.data?.events ?? []).filter(ev => !activeIds.has(ev.id)).slice(0, SETTLED_LIMIT);
  const trackerList = trackers.data?.trackers ?? [];
  const nothing = !developing.length && !longRunning.length && !settled.length && !trackerList.length;

  const pickTopic = (id) => {
    const next = new URLSearchParams(params);
    if (id) next.set("topic", id); else next.delete("topic");
    setParams(next, { replace: true });
  };

  return (
    <div className="space-y-8 py-2" data-testid="news-page">
      {/* The page's only h1. */}
      <h1 className="text-sm font-bold uppercase tracking-wider text-[var(--color-text-secondary)]" style={{ fontFamily: LABEL }}>
        News
      </h1>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Topic">
        {TOPICS.map(t => (
          <button
            key={t.id || "all"}
            type="button"
            onClick={() => pickTopic(t.id)}
            aria-pressed={topic === t.id}
            className={`text-sm px-3 py-1.5 rounded-full border transition-colors ${
              topic === t.id
                ? "bg-[var(--color-accent)] text-white border-[var(--color-accent)]"
                : "border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-accent)] hover:text-[var(--color-text)]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {isLoading && timedOut ? (
        <TimeoutNotice what="the news" onRetry={() => { restartTimer(); active.refetch(); }} />
      ) : isLoading ? (
        <Grid>{Array.from({ length: 6 }).map((_, i) => <LoadingCard key={i} />)}</Grid>
      ) : nothing ? (
        /* Positive evidence only: "none" needs a successful, empty response. */
        <p className="text-sm text-[var(--color-text-tertiary)] py-16 text-center">
          {active.isSuccess && !active.isError
            ? "No active events yet — they appear automatically as stories gain coverage."
            : "Temporarily busy — retrying…"}
        </p>
      ) : (
        <>
          {developing.length > 0 && (
            <Group id="developing" title="Developing">
              <Grid>{developing.map(ev => <NewsCard key={ev.id} ev={ev} mode="developing" />)}</Grid>
            </Group>
          )}
          {longRunning.length > 0 && (
            <Group id="long-running" title="Long-running">
              <Grid>{longRunning.map(ev => <NewsCard key={ev.id} ev={ev} mode="long" />)}</Grid>
            </Group>
          )}
          {settled.length > 0 && (
            <Group id="settled" title="Settled">
              <Grid>{settled.map(ev => <NewsCard key={ev.id} ev={ev} mode="settled" />)}</Grid>
            </Group>
          )}
          {trackerList.length > 0 && (
            <Group id="trackers" title="Trackers">
              <Grid>{trackerList.map(tr => <TrackerCard key={tr.id} tracker={tr} />)}</Grid>
            </Group>
          )}
        </>
      )}
    </div>
  );
}
