/**
 * OriginalsPage — `/originals` under SITE_V2 (#260, plan v7 Phase 2).
 *
 * What ScoopFeeds itself writes and makes, in three shelves:
 *   Latest analysis   — published briefs   → /briefs/:slug
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

export default function OriginalsPage() {
  const { data } = useOriginals();
  const analysis = data?.analysis ?? [];
  const stories = data?.stories ?? [];
  const explained = data?.explained ?? [];

  return (
    <main className="max-w-5xl mx-auto px-4 py-8" data-testid="originals-page">
      <header>
        <h1 className="uppercase text-4xl sm:text-5xl" style={{ fontFamily: DISPLAY, color: INK }}>Originals</h1>
        <p className="mt-2 text-lg opacity-80" style={{ fontFamily: READING }}>
          Our analysis, films and explainers.
        </p>
      </header>
      {analysis.length > 0 && <AnalysisShelf items={analysis} />}
      {stories.length > 0 && <StoriesShelf items={stories} />}
      {explained.length > 0 && <ExplainedShelf items={explained} />}
    </main>
  );
}
