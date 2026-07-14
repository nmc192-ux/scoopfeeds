/**
 * HomePage — the stacked "spine" feed at `/` (Phase 1 rebuild).
 *
 * A Top Stories band (prominence-ranked semantic-cluster cards + a Developing /
 * Most-sourced rail) followed by full-width, category news sections. Everything is
 * a Reality Index event (semantic cluster) rendered as EventCard variant="news".
 *
 * Removed in this rebuild: StatsBar, mobile Market/Weather, the article hero
 * (FeaturedCard + SideCards), LiveEventsView, the old NewsGrid + right sidebar,
 * AdSense, and the lazy Video/Magazine/Cars/X sections. (Markets / tip-jar /
 * footer relocation + Local/Sports/Entertainment land in Phase 2+.)
 */
import { Link } from "react-router-dom";
import { Radio, Layers } from "lucide-react";
import EventCard from "../components/events/EventCard";
import { useEvents } from "../hooks/useEvents";
import ScoopMascot from "../components/mascot/ScoopMascot";

const DAY_MS = 86_400_000;
const MIN_SECTION_SOURCES = 2; // floor: single-source noise can't lead a category section

// Five display sections → primary event.category (frontend-only mapping, Phase 1).
// Confirmed categories in data: tech, international, business, top, pakistan, sports,
// politics, publications, cars, computer-science. Tech & AI maps to the primary "tech"
// (the lone "computer-science" event is skipped for now — a categories-IN endpoint
// filter is the Phase-3 cleanup). Science & Health has no matching category, so it
// self-hides via the empty-section guard.
// category = single or comma-separated super-category (endpoint does IN(...)).
// href = the section's "More →" destination. seo.js SSR hubs use category-name slugs
// (international, politics, ai…); only Politics overlaps the tab id exactly. World→the
// "International News" hub; Business/Tech have no SSR hub yet, so they use their real
// /topic tab pages (Phase-3 SEO follow-up could add hubs/aliases for them).
const SECTIONS = [
  { key: "world",    label: "World",            category: "international",                        href: "/topic/international" },
  { key: "politics", label: "Politics",         category: "politics",                            href: "/topic/politics" },
  { key: "business", label: "Business",         category: "business",                            href: "/topic/business" },
  { key: "tech",     label: "Tech & AI",        category: "tech,ai,computer-science,agentic-ai", href: "/topic/tech" },
  { key: "science",  label: "Science & Health", category: "science,health,environment,medicine", href: "/topic/science" },
];

// Same span logic the EventCard lifespan badge uses.
function isDeveloping(ev) {
  const span = (ev.last_activity_at ?? 0) - (ev.started_at ?? 0);
  return ev.status === "active" && !!ev.started_at && span >= DAY_MS;
}
function dayN(ev) {
  const span = (ev.last_activity_at ?? 0) - (ev.started_at ?? 0);
  return Math.max(1, Math.floor(span / DAY_MS) + 1);
}
const plural = (n, w) => `${n} ${w}${n !== 1 ? "s" : ""}`;

function SectionHeader({ title, href, cta }) {
  return (
    <div className="flex items-baseline justify-between mb-4 gap-3">
      <h2 className="text-xl font-bold tracking-tight text-[var(--color-text)]">{title}</h2>
      <Link to={href} className="text-sm font-semibold text-[var(--color-accent)] hover:underline whitespace-nowrap">
        {cta} →
      </Link>
    </div>
  );
}

// Compact rail row (Developing / Most-sourced).
function RailRow({ ev, meta }) {
  return (
    <Link
      to={`/events/${ev.slug}`}
      className="group flex gap-3 py-2.5 border-b border-[var(--color-border)] last:border-0"
    >
      {ev.hero_image_url && (
        <div className="w-14 h-14 rounded-lg overflow-hidden flex-shrink-0 bg-[var(--color-surface2)]">
          <img src={ev.hero_image_url} alt="" loading="lazy" className="w-full h-full object-cover" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <h4 className="text-sm font-semibold leading-snug line-clamp-2 text-[var(--color-text)] group-hover:text-[var(--color-accent)] transition-colors">
          {ev.title}
        </h4>
        <p className="mt-1 text-[11px] text-[var(--color-text-tertiary)]">{meta}</p>
      </div>
    </Link>
  );
}

function RailCard({ title, icon: Icon, children }) {
  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--color-text-secondary)] mb-1">
        <Icon size={14} className="text-[var(--color-accent)]" />
        {title}
      </h3>
      {children}
    </section>
  );
}

const SkeletonCard = () => (
  <div className="h-64 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] animate-pulse" />
);

// One stacked category band; renders nothing when the category has no events.
function NewsSection({ label, category, moreHref = "/events", moreCta }) {
  // Recency order (endpoint default = last_activity_at DESC — freshest leads); fetch a few
  // extra so the source_count floor still yields a full row of 4.
  const { data, isLoading } = useEvents({ category, limit: 10 });
  const events = (data?.events ?? [])
    .filter(e => (e.source_count || 0) >= MIN_SECTION_SOURCES)
    .slice(0, 4);

  if (isLoading) {
    return (
      <section>
        <div className="h-7 w-44 rounded bg-[var(--color-surface)] border border-[var(--color-border)] animate-pulse mb-4" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      </section>
    );
  }
  if (events.length === 0) return null; // hide empty bands — no "no data" placeholders

  return (
    <section>
      <SectionHeader title={label} href={moreHref} cta={moreCta ?? `More in ${label}`} />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {events.map(ev => <EventCard key={ev.id} event={ev} variant="news" />)}
      </div>
    </section>
  );
}

// Entertainment: honest placeholder while there are no entertainment sources. Auto-populates
// (recency + floor, like any news band) the moment such events exist; until then a quiet card.
function EntertainmentSection() {
  const { data, isLoading } = useEvents({ category: "entertainment", limit: 10 });
  const events = (data?.events ?? [])
    .filter(e => (e.source_count || 0) >= MIN_SECTION_SOURCES)
    .slice(0, 4);

  if (isLoading) return null;

  if (events.length > 0) {
    return (
      <section>
        <SectionHeader title="Entertainment" href="/events" cta="More in Entertainment" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {events.map(ev => <EventCard key={ev.id} event={ev} variant="news" />)}
        </div>
      </section>
    );
  }

  return (
    <section>
      <h2 className="text-xl font-bold tracking-tight text-[var(--color-text)] mb-4">Entertainment</h2>
      <div className="rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-10 text-center">
        <p className="text-sm font-semibold text-[var(--color-text-secondary)]">Entertainment is on the way</p>
        <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">
          This section fills in as we add entertainment sources to the feed.
        </p>
      </div>
    </section>
  );
}

export default function HomePage() {
  // One prominence fetch powers the whole Top Stories band: the main shows the top 7
  // (lead + 6); the rail derives Developing + Most-sourced from the fuller list.
  const { data, isLoading, isError, isSuccess } = useEvents({ sort: "prominence", limit: 24 });
  const events = data?.events ?? [];
  const [lead, ...rest] = events;
  const topGrid     = rest.slice(0, 6);
  const developing  = events.filter(isDeveloping).slice(0, 6);
  const mostSourced = [...events].sort((a, b) => (b.source_count || 0) - (a.source_count || 0)).slice(0, 6);

  return (
    <div className="space-y-14 py-2">
      {/* ── TOP STORIES band: main + 320px rail ─────────────────────────── */}
      <div className="lg:grid lg:grid-cols-[1fr_320px] lg:gap-10 lg:items-start">
        <div>
          <SectionHeader title="Top stories" href="/events" cta="See all stories" />
          {isLoading ? (
            <div className="space-y-4">
              <SkeletonCard />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
              </div>
            </div>
          ) : events.length === 0 ? (
            <div className="flex flex-col items-center gap-4 py-20 text-center">
              <ScoopMascot size="lg" mood="reading" animated />
              {/* Positive evidence only: "no stories" requires a SUCCESSFUL
                  response with an empty list. An error, or a paused retry
                  (offline: no data AND no error), is a transient condition —
                  never claim the feed is empty on its account. */}
              <p className="text-sm text-[var(--color-text-tertiary)]">
                {isSuccess && !isError
                  ? "No stories right now — check back shortly."
                  : "Temporarily busy — stories will be back in a moment. Retrying…"}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {lead && <EventCard event={lead} variant="news" featured />}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {topGrid.map(ev => <EventCard key={ev.id} event={ev} variant="news" />)}
              </div>
            </div>
          )}
        </div>

        {/* Rail */}
        <aside className="mt-8 lg:mt-0 flex flex-col gap-4 lg:sticky lg:top-24 self-start">
          {developing.length > 0 && (
            <RailCard title="Developing" icon={Radio}>
              {developing.map(ev => (
                <RailRow key={ev.id} ev={ev} meta={`day ${dayN(ev)} · ${plural(ev.source_count, "outlet")}`} />
              ))}
            </RailCard>
          )}
          {mostSourced.length > 0 && (
            <RailCard title="Most-sourced today" icon={Layers}>
              {mostSourced.map(ev => (
                <RailRow key={ev.id} ev={ev} meta={`${plural(ev.source_count, "outlet")} · ${plural(ev.article_count, "article")}`} />
              ))}
            </RailCard>
          )}
        </aside>
      </div>

      {/* ── NEWS SECTIONS, stacked full-width (empty categories self-hide) ─ */}
      {SECTIONS.map(s => <NewsSection key={s.key} label={s.label} category={s.category} moreHref={s.href} />)}

      {/* ── Local · Sports · Entertainment (Phase 2) ───────────────────── */}
      <NewsSection label="Local · Pakistan" category="pakistan" moreHref="/country/pk" moreCta="More local" />
      <NewsSection label="Sports" category="sports" moreHref="/sports" moreCta="More in Sports" />
      <EntertainmentSection />
    </div>
  );
}
