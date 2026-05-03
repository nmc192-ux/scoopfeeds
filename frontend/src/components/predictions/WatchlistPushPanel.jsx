/**
 * WatchlistPushPanel — small card on /dashboard that lets the authed user
 * enable web push for their watchlisted events. Once enabled, the backend
 * dispatcher fans out anomaly_alerts for watched events to their device(s).
 *
 * States:
 *   unsupported / denied / granted+subscribed / granted+unsubscribed / default
 */

import { useEffect, useState, useCallback } from "react";
import { Bell, BellOff, BellRing, Info } from "lucide-react";
import {
  isPushSupported,
  currentPermission,
  isAlreadySubscribed,
  subscribeToPush,
  unsubscribeFromPush,
} from "../../lib/push";

export default function WatchlistPushPanel() {
  const [permission, setPermission] = useState(() => currentPermission());
  const [subscribed, setSubscribed] = useState(() => isAlreadySubscribed());
  const [pending, setPending]       = useState(false);
  const [error, setError]           = useState(null);

  // Re-check permission on mount in case the user changed it in browser settings.
  useEffect(() => { setPermission(currentPermission()); }, []);

  const onEnable = useCallback(async () => {
    setPending(true); setError(null);
    try {
      const out = await subscribeToPush({ topics: ["watchlist"] });
      setPermission(out.permission || currentPermission());
      setSubscribed(out.ok);
      if (!out.ok && out.permission === "denied") {
        setError("Notifications were blocked. Re-enable in your browser settings.");
      } else if (!out.ok) {
        setError("Could not enable notifications. Please try again.");
      }
    } catch (e) {
      setError(e.message || "Failed to enable notifications");
    } finally {
      setPending(false);
    }
  }, []);

  const onDisable = useCallback(async () => {
    setPending(true); setError(null);
    try {
      await unsubscribeFromPush();
      setSubscribed(false);
    } catch (e) {
      setError(e.message || "Failed to disable notifications");
    } finally {
      setPending(false);
    }
  }, []);

  if (!isPushSupported()) {
    return (
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-xs text-[var(--color-text-secondary)] flex items-start gap-2">
        <Info size={13} className="mt-0.5 flex-shrink-0" />
        <span>Push notifications aren't supported by this browser.</span>
      </div>
    );
  }

  const isOn = permission === "granted" && subscribed;

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 flex flex-col gap-2">
      <div className="flex items-start gap-2">
        {isOn ? <BellRing size={14} className="text-[var(--color-accent)] mt-0.5" />
              : <Bell      size={14} className="text-[var(--color-text-secondary)] mt-0.5" />}
        <div className="flex-1">
          <p className="text-xs font-semibold text-[var(--color-text)]">
            {isOn ? "Watchlist alerts on" : "Get watchlist alerts"}
          </p>
          <p className="text-[10px] text-[var(--color-text-secondary)] leading-snug mt-0.5">
            {isOn
              ? "We'll push an alert when one of your watched events fires an anomaly."
              : "Browser push for market shifts, divergence spikes, and sentiment flips on watched events."}
          </p>
        </div>
      </div>

      {permission === "denied" && (
        <p className="text-[10px] text-amber-700 dark:text-amber-400">
          Notifications are blocked. Re-enable them in your browser site settings.
        </p>
      )}
      {error && <p className="text-[10px] text-red-600 dark:text-red-400">{error}</p>}

      <div className="flex justify-end">
        {isOn ? (
          <button
            type="button"
            disabled={pending}
            onClick={onDisable}
            className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] transition-colors disabled:opacity-50"
          >
            <BellOff size={11} /> Turn off
          </button>
        ) : (
          <button
            type="button"
            disabled={pending || permission === "denied"}
            onClick={onEnable}
            className="inline-flex items-center gap-1 text-[11px] px-3 py-1 rounded-full bg-[var(--color-accent)] text-white font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            <Bell size={11} /> {pending ? "Enabling…" : "Enable"}
          </button>
        )}
      </div>
    </div>
  );
}
