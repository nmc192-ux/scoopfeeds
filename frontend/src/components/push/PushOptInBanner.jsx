/**
 * PushOptInBanner — discreet bottom-right card that asks the user to enable
 * breaking news alerts. Strict triggering rules to avoid the modal-fatigue
 * trap many news sites fall into:
 *   - Push must be supported
 *   - Permission must still be "default" (not granted, not denied)
 *   - User mustn't have declined within the last 60 days
 *   - Page must have been open for 90s of active time
 *   - User must have scrolled at least once (signal of engagement)
 *   - Newsletter capture modal must not be visible (avoid stacking prompts)
 */
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bell, X } from "lucide-react";
import {
  isPushSupported,
  currentPermission,
  isDeclinedRecently,
  isAlreadySubscribed,
  subscribeToPush,
  markDeclined,
  noteOptInPromptShown,
} from "../../lib/push";

const VISIBLE_DELAY_MS = 90 * 1000;

export default function PushOptInBanner({ topics = [], language = "en" }) {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const scrolledRef = useRef(false);
  const triggeredRef = useRef(false);

  useEffect(() => {
    if (!isPushSupported()) return;
    if (currentPermission() !== "default") return;
    if (isAlreadySubscribed()) return;
    if (isDeclinedRecently()) return;

    const onScroll = () => { scrolledRef.current = true; };
    window.addEventListener("scroll", onScroll, { passive: true });

    const t = setTimeout(() => {
      if (!scrolledRef.current) return; // disengaged session
      if (document.visibilityState !== "visible") return;
      if (triggeredRef.current) return;
      triggeredRef.current = true;
      setVisible(true);
      noteOptInPromptShown("scroll_and_dwell");
    }, VISIBLE_DELAY_MS);

    return () => {
      clearTimeout(t);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  const dismiss = () => {
    markDeclined();
    setVisible(false);
  };

  const enable = async () => {
    setBusy(true);
    try {
      const result = await subscribeToPush({ topics, language });
      if (result.ok) setVisible(false);
      else if (result.permission === "denied") setVisible(false);
    } catch {
      // silent fail — user keeps banner visible to retry
    } finally {
      setBusy(false);
    }
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          className="fixed z-[90] bottom-4 right-4 left-4 sm:left-auto sm:max-w-sm bg-[var(--color-bg)] text-[var(--color-text)] rounded-2xl shadow-xl border border-[var(--color-border)] p-4"
        >
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss"
            className="absolute top-2 right-2 p-1.5 rounded-full text-[var(--color-text-secondary)] hover:bg-[var(--color-surface2)]"
          >
            <X size={14} />
          </button>
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 flex items-center justify-center">
              <Bell size={18} />
            </div>
            <div className="flex-1 min-w-0 pr-4">
              <h3 className="font-semibold text-sm leading-tight mb-1">Get breaking news alerts</h3>
              <p className="text-xs text-[var(--color-text-secondary)] mb-3">
                We'll only ping you for the day's biggest stories. Skip and we won't ask again for two months.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={enable}
                  disabled={busy}
                  className="flex-1 text-xs font-semibold px-3 py-1.5 rounded-full bg-electric-600 text-white hover:bg-electric-700 disabled:opacity-60"
                >
                  {busy ? "Enabling…" : "Turn on"}
                </button>
                <button
                  type="button"
                  onClick={dismiss}
                  className="text-xs font-medium px-3 py-1.5 rounded-full text-[var(--color-text-secondary)] hover:bg-[var(--color-surface2)]"
                >
                  Not now
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
