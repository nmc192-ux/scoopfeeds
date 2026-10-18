import { useEffect, useState } from "react";

export const FETCH_TIMEOUT_MS = 10_000;

/** True once `pending` has stayed true for `ms`; resets when it goes false. */
export function useTimedOut(pending, ms = FETCH_TIMEOUT_MS) {
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    if (!pending) {
      setTimedOut(false);
      return undefined;
    }
    const id = setTimeout(() => setTimedOut(true), ms);
    return () => clearTimeout(id);
  }, [pending, ms]);
  return timedOut;
}

/** Calm failure line shown in place of an endless spinner. */
export default function TimeoutNotice({ onRetry, what = "This" }) {
  return (
    <div
      role="status"
      data-testid="timeout-notice"
      className="flex flex-wrap items-center justify-center gap-3 py-10 text-sm text-[var(--color-text-tertiary)]"
    >
      <span>{what} is taking longer than usual.</span>
      <button
        type="button"
        onClick={onRetry}
        className="px-3 py-1 rounded-full border border-[var(--color-border)] font-semibold text-[var(--color-text)] hover:bg-[var(--color-surface2)] transition-colors"
      >
        Retry
      </button>
    </div>
  );
}
