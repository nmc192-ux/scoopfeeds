/**
 * <ToastViewport /> — renders the active toast queue.
 *
 * Mount once at the app root. Subscribes to the toast store (lib/toast.js)
 * and renders each toast as a stacked, animated pill at the bottom-center.
 *
 * Variants:
 *   success → emerald   (matches --color-status-live)
 *   error   → red       (--color-alert)
 *   info    → cobalt    (brand primary)
 *   warning → amber
 */
import { motion, AnimatePresence } from "framer-motion";
import { Check, X, Info, AlertTriangle, AlertCircle } from "lucide-react";
import clsx from "clsx";
import { useToasts, dismiss } from "../../lib/toast";

const VARIANT = {
  success: { Icon: Check,          className: "bg-emerald-600" },
  error:   { Icon: AlertCircle,    className: "bg-[var(--color-alert)]" },
  info:    { Icon: Info,           className: "bg-cobalt-600" },
  warning: { Icon: AlertTriangle,  className: "bg-amber-500" },
};

export default function ToastViewport() {
  const toasts = useToasts();

  return (
    <div
      role="region"
      aria-label="Notifications"
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] flex flex-col items-center gap-2 pointer-events-none"
    >
      <AnimatePresence>
        {toasts.map((t) => {
          const v = VARIANT[t.variant] || VARIANT.info;
          const Icon = t.icon ?? v.Icon;
          return (
            <motion.div
              key={t.id}
              role={t.variant === "error" ? "alert" : "status"}
              aria-live={t.variant === "error" ? "assertive" : "polite"}
              initial={{ opacity: 0, y: 32, scale: 0.96 }}
              animate={{ opacity: 1, y: 0,  scale: 1 }}
              exit={{    opacity: 0, y: 32, scale: 0.96 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              className={clsx(
                "pointer-events-auto flex items-center gap-2 px-4 py-2.5 rounded-full",
                "text-white text-sm font-medium shadow-2xl max-w-md",
                v.className
              )}
            >
              {Icon && <Icon size={15} className="flex-shrink-0" aria-hidden="true" />}
              <span className="flex-1">{t.message}</span>
              {t.action && (
                <button
                  type="button"
                  onClick={() => { t.action.onClick(); dismiss(t.id); }}
                  className="ml-1 px-2 py-0.5 rounded-full bg-white/20 hover:bg-white/30
                             text-xs font-semibold transition-colors
                             focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                >
                  {t.action.label}
                </button>
              )}
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss notification"
                className="text-white/70 hover:text-white p-0.5 rounded-full
                           focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
              >
                <X size={14} />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
