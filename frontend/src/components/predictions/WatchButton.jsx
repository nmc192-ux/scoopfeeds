/**
 * WatchButton — toggles a user's watchlist entry for an event/market.
 *
 * Renders three states:
 *   - signed-out → "Sign in to watch" (links to /api/auth — magic link flow)
 *   - off        → "+ Watch"
 *   - on         → "★ Watching" (click to remove)
 *
 * Uses optimistic-ish UX: the React Query mutation invalidates on success
 * and the button shows a transient pulse during pending.
 */

import { Star, StarOff, LogIn } from "lucide-react";
import { useWatchStatus, useToggleWatch } from "../../hooks/useWatchlists";

export default function WatchButton({ itemType, itemId, size = "md", className = "" }) {
  const { data, isLoading, error } = useWatchStatus(itemType, itemId);
  const isAuthError = error?.response?.status === 401;
  const watching    = !!data?.watching;
  const toggle      = useToggleWatch(itemType, itemId);

  // Sizing
  const padding = size === "sm" ? "px-2 py-1 text-[11px]" : "px-3 py-1.5 text-xs";
  const icon    = size === "sm" ? 11 : 13;

  if (isAuthError) {
    return (
      <a
        href="/login"
        className={`inline-flex items-center gap-1 rounded-full border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] transition-colors ${padding} ${className}`}
        title="Sign in to watch this"
      >
        <LogIn size={icon} />
        <span>Sign in to watch</span>
      </a>
    );
  }

  const onClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (toggle.isPending) return;
    toggle.mutate({ watching });
  };

  const Icon = watching ? Star : StarOff;
  const stateClass = watching
    ? "bg-[var(--color-accent)]/10 text-[var(--color-accent)] border-[var(--color-accent)]/30"
    : "border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isLoading || toggle.isPending}
      className={`inline-flex items-center gap-1 rounded-full border font-semibold transition-colors ${stateClass} ${padding} ${toggle.isPending ? "animate-pulse" : ""} ${className}`}
      title={watching ? "Remove from watchlist" : "Add to watchlist"}
    >
      <Icon size={icon} fill={watching ? "currentColor" : "none"} />
      <span>{watching ? "Watching" : "Watch"}</span>
    </button>
  );
}
