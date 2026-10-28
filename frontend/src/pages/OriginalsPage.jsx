/**
 * OriginalsPage — `/originals` under SITE_V2 (#260, plan v7 Phase 2).
 *
 * What ScoopFeeds itself writes and makes. First, when a quiz is published, the weekly
 * quiz card (#271) → /originals/quiz. Then the shelves:
 *   Latest analysis   — published briefs   → /briefs/:slug
 *   By the numbers    — one checked number a day (#272) → /events/:slug
 *   ScoopFeeds Stories — public films       → youtube.com (thumbnail, no autoplay embed)
 *   Explained          — live Explained     → /analysis/explained/:slug
 *
 * Earn-render: an empty list renders no shelf, no heading, no placeholder. With all
 * three empty only the page header renders. Without v2 the route redirects to /briefs
 * (App.jsx), so the classic site is unchanged.
 */
import { Link } from "react-router-dom";
import { useOriginals } from "../hooks/useOriginals";

const READING = 'var(--sf-reading, "Newsreader", Georgia, "Times New Roman", serif)';
const LABEL = 'var(--sf-label, "Schibsted Grotesk", system-ui, sans-serif)';
const DISPLAY = 'var(--sf-display, "Anton", Impact, system-ui, sans-serif)';
const INK = "var(--sf-ink, #090706)";
const LIME = "var(--sf-lime, #DDE706)";
const NUMBERS_NOTE = "Each number appears in reports from at least two outlets. The sentence was written by AI from those reports.";

function fmtDate(ts) {
  if (!ts) return null;
  try {
    return new Date(ts).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return null;
  }
}

function Shelf({ title, children }) {
  return (
    <section className="mt-10">
      <h2 className="uppercase tracking-wide text-2xl mb-4 border-b pb-2"
          style={{ fontFamily: DISPLAY, color: INK, borderColor: INK }}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function AnalysisShelf({ items }) {
  return (
    <Shelf title="Latest analysis">
      <ul className="grid gap-6 sm:grid-cols-2">
        {items.map((b) => (
          <li key={b.slug}>
            <Link to={`/briefs/${b.slug}`} className="block group">
              <h3 className="text-xl leading-snug group-hover:underline" style={{ fontFamily: READING, color: INK }}>
                {b.title}
              </h3>
              {b.thesis && (
                <p className="mt-1 text-base opacity-80 line-clamp-3" style={{ fontFamily: READING }}>{b.thesis}</p>
              )}
              {fmtDate(b.published_at ?? b.created_at) && (
                <p className="mt-2 text-xs uppercase tracking-wider opacity-60" style={{ fontFamily: LABEL }}>
                  {fmtDate(b.published_at ?? b.created_at)}
                </p>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </Shelf>
  );
}

function NumberSources({ sources }) {
  const list = (sources || []).filter((x) => x?.source_name);
  if (!list.length) return null;
  return (
    <p className="mt-2 text-sm" style={{ fontFamily: LABEL }}>
      Sources:{" "}
      {list.map((x, i) => (
        <span key={`${x.source_name}-${i}`}>
          {i > 0 && ", "}
          {x.url ? <a href={x.url} target="_blank" rel="noopener noreferrer" className="underline">{x.source_name}</a> : x.source_name}
        </span>
      ))}
    </p>
  );
}

function NumbersShelf({ items }) {
  const [today, ...earlier] = items;
  return (
    <Shelf title="By the numbers">
      <p className="-mt-2 mb-4 text-xs opacity-70" style={{ fontFamily: LABEL }} data-testid="numbers-note">{NUMBERS_NOTE}</p>
      <article data-testid="numbers-today">
        <p className="inline-block px-4 py-1 text-6xl sm:text-7xl leading-none" style={{ fontFamily: DISPLAY, color: INK, background: LIME }}>
          {today.number_text}
        </p>
        <p className="mt-3 text-xl leading-snug" style={{ fontFamily: READING, color: INK }}>{today.fact_text}</p>
        <NumberSources sources={today.sources} />
        <p className="mt-1 text-xs uppercase tracking-wider opacity-60" style={{ fontFamily: LABEL }} data-testid="numbers-today-date">{fmtDate(`${today.day}T12:00:00Z`)}</p>
        {today.event?.slug && (
          <p className="mt-2 text-sm" style={{ fontFamily: LABEL }}>
            <Link to={`/events/${today.event.slug}`} className="underline">Read the dossier</Link>
          </p>
        )}
      </article>
      {earlier.length > 0 && (
        <ul className="mt-6 grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6" data-testid="numbers-earlier">
          {earlier.map((n) => (
            <li key={n.day}>
              <Link to={n.event?.slug ? `/events/${n.event.slug}` : "#"} className="block group">
                <p className="text-2xl leading-none" style={{ fontFamily: DISPLAY, color: INK }}>{n.number_text}</p>
                <p className="mt-1 text-sm leading-snug line-clamp-3 group-hover:underline" style={{ fontFamily: READING }}>{n.fact_text}</p>
                <p className="mt-1 text-xs uppercase tracking-wider opacity-60" style={{ fontFamily: LABEL }}>{fmtDate(`${n.day}T12:00:00Z`)}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Shelf>
  );
}

function StoriesShelf({ items }) {
  return (
    <Shelf title="ScoopFeeds Stories">
      <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((f) => (
          <li key={f.slug}>
            <a href={`https://www.youtube.com/watch?v=${encodeURIComponent(f.youtube_id)}`}
               target="_blank" rel="noopener noreferrer" className="block group">
              <img src={`https://i.ytimg.com/vi/${encodeURIComponent(f.youtube_id)}/hqdefault.jpg`}
                   alt="" loading="lazy" className="w-full aspect-video object-cover"
                   onError={(ev) => { ev.currentTarget.style.display = "none"; }} />
              <h3 className="mt-2 text-lg leading-snug group-hover:underline" style={{ fontFamily: READING, color: INK }}>
                {f.title || "ScoopFeeds film"}
              </h3>
              {fmtDate(f.published_at) && (
                <p className="mt-1 text-xs uppercase tracking-wider opacity-60" style={{ fontFamily: LABEL }}>
                  {fmtDate(f.published_at)} · YouTube
                </p>
              )}
            </a>
          </li>
        ))}
      </ul>
    </Shelf>
  );
}

function ExplainedShelf({ items }) {
  return (
    <Shelf title="Explained">
      <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((e) => (
          <li key={e.slug}>
            <Link to={`/analysis/explained/${e.slug}`} className="block group">
              {e.image_url && (
                <img src={e.image_url} alt="" loading="lazy" className="w-full aspect-video object-cover mb-2"
                     onError={(ev) => { ev.currentTarget.style.display = "none"; }} />
              )}
              {e.category && (
                <p className="text-xs uppercase tracking-wider opacity-60" style={{ fontFamily: LABEL }}>{e.category}</p>
              )}
              <h3 className="text-lg leading-snug group-hover:underline" style={{ fontFamily: READING, color: INK }}>
                {e.title}
              </h3>
              {e.summary && (
                <p className="mt-1 text-sm opacity-80 line-clamp-3" style={{ fontFamily: READING }}>{e.summary}</p>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </Shelf>
  );
}

function QuizCard({ quiz }) {
  return (
    <section className="mt-8" data-testid="originals-quiz-card">
      <Link to="/originals/quiz" className="block group border-2 p-5" style={{ borderColor: INK }}>
        <h2 className="uppercase text-3xl group-hover:underline" style={{ fontFamily: DISPLAY, color: INK }}>
          Did you scoop it?
        </h2>
        <p className="mt-1 text-lg opacity-80" style={{ fontFamily: READING }}>
          {quiz.count} questions on this week's news
        </p>
      </Link>
    </section>
  );
}

export default function OriginalsPage() {
  const { data } = useOriginals();
  const analysis = data?.analysis ?? [];
  const stories = data?.stories ?? [];
  const explained = data?.explained ?? [];
  const numbers = (data?.numbers ?? []).filter((n) => n?.number_text && n?.fact_text);

  return (
    <main className="max-w-5xl mx-auto px-4 py-8" data-testid="originals-page">
      <header>
        <h1 className="uppercase text-4xl sm:text-5xl" style={{ fontFamily: DISPLAY, color: INK }}>Originals</h1>
        <p className="mt-2 text-lg opacity-80" style={{ fontFamily: READING }}>
          Our analysis, films and explainers.
        </p>
      </header>
      {data?.quiz && data.quiz.count > 0 && <QuizCard quiz={data.quiz} />}
      {analysis.length > 0 && <AnalysisShelf items={analysis} />}
      {numbers.length > 0 && <NumbersShelf items={numbers} />}
      {stories.length > 0 && <StoriesShelf items={stories} />}
      {explained.length > 0 && <ExplainedShelf items={explained} />}
    </main>
  );
}
