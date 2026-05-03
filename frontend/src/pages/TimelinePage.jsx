/**
 * TimelinePage — /timeline/:slug — standalone chronological view.
 *
 * The full event dossier (/events/:slug) embeds the timeline as one panel
 * among several. This page surfaces just the timeline at full width so it
 * can be shared, deep-linked, or embedded in a blog without dragging the
 * rest of the dossier along.
 *
 * Same data + same EventTimeline component as the dossier. Differences:
 *   - Tight header (event title + category + back link to full dossier)
 *   - Wider timeline column, no sidebar
 *   - Bigger default page size (showing 100 entries vs the dossier's 60)
 */

import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Clock, ArrowLeft, ExternalLink } from "lucide-react";
import { useEvent, useEventTimeline } from "../hooks/useEvents";
import EventTimeline from "../components/events/EventTimeline";

function relativeTime(ms) {
  if (!ms) return "";
  const diff = Date.now() - ms;
  if (diff < 60_000)   return "just now";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export default function TimelinePage() {
  const { slug } = useParams();
  const [kind, setKind] = useState("");
  const { data: ev,  isLoading: loadingEvent } = useEvent(slug);
  const { data: tl,  isLoading: loadingTl }    = useEventTimeline(slug, { kind, limit: 100 });

  const event   = ev?.event;
  const entries = tl?.timeline ?? [];

  if (loadingEvent && !event) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <div className="h-6 w-40 bg-[var(--color-surface-2)] animate-pulse rounded mb-4" />
        <div className="h-10 w-full bg-[var(--color-surface-2)] animate-pulse rounded mb-2" />
        <div className="h-4 w-2/3 bg-[var(--color-surface-2)] animate-pulse rounded mb-6" />
        <div className="space-y-3">{Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-16 rounded-lg bg-[var(--color-surface-2)] animate-pulse" />
        ))}</div>
      </div>
    );
  }

  if (!event) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12 text-center">
        <p className="text-sm text-[var(--color-text-secondary)] mb-3">
          Event not found.
        </p>
        <Link to="/events" className="text-xs text-[var(--color-accent)] hover:underline">
          ← Back to all events
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
      {/* Compact header — keeps the focus on the timeline below */}
      <header className="mb-6">
        <Link
          to={`/events/${event.slug}`}
          className="inline-flex items-center gap-1 text-[11px] text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] transition-colors mb-3"
        >
          <ArrowLeft size={11} /> Full dossier
        </Link>
        <div className="flex items-center gap-2 mb-1">
          <Clock size={16} className="text-[var(--color-accent)]" />
          <span className="text-[10px] uppercase tracking-wide font-semibold text-[var(--color-text-secondary)]">
            Timeline
          </span>
          {event.category && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--color-accent)]/10 text-[var(--color-accent)] capitalize">
              {event.category}
            </span>
          )}
        </div>
        <h1 className="font-editorial italic text-2xl sm:text-3xl leading-tight text-[var(--color-text)]">
          {event.title}
        </h1>
        {event.last_activity_at && (
          <p className="text-[11px] text-[var(--color-text-tertiary)] mt-1.5">
            Last activity {relativeTime(event.last_activity_at)} · {entries.length} entries shown
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <a
            href={`/embed/event/${event.slug}`}
            target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] transition-colors"
          >
            <ExternalLink size={10} /> Embed
          </a>
        </div>
      </header>

      {/* Same component the dossier uses — single source of truth for entry rendering */}
      <EventTimeline
        entries={entries}
        isLoading={loadingTl}
        onKindChange={setKind}
      />
    </div>
  );
}
