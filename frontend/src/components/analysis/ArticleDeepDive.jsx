/**
 * ArticleDeepDive — collapsible AI analysis panel shown inside ReaderModal
 * below the article body. The API call is lazy — only fires when the user
 * expands the panel.
 */
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { useArticleDeepDive } from "../../hooks/useAnalysis";

const TONE_CONFIG = {
  neutral:    { label: "Neutral",    classes: "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300" },
  critical:   { label: "Critical",   classes: "bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400" },
  optimistic: { label: "Optimistic", classes: "bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400" },
  alarming:   { label: "Alarming",   classes: "bg-orange-50 dark:bg-orange-950/30 text-orange-700 dark:text-orange-400" },
  analytical: { label: "Analytical", classes: "bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400" },
};

export default function ArticleDeepDive({ article }) {
  const [open, setOpen] = useState(false);
  // Only call the API once the panel is expanded (lazy)
  const { data, isLoading } = useArticleDeepDive(open ? article?.id : null);

  if (!article) return null;

  const toneConfig = data ? (TONE_CONFIG[data.tone] || TONE_CONFIG.neutral) : null;

  return (
    <div className="mt-8 pt-6 border-t border-[var(--color-border)]">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-2 group"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2">
          <Sparkles size={15} className="text-electric-500 shrink-0" />
          <span className="text-sm font-bold text-[var(--color-text)]
                           group-hover:text-electric-600 transition-colors">
            AI Analysis
          </span>
        </div>
        {open
          ? <ChevronUp size={15} className="text-[var(--color-text-tertiary)] shrink-0" />
          : <ChevronDown size={15} className="text-[var(--color-text-tertiary)] shrink-0" />
        }
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="dive"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="mt-4 space-y-4">
              {isLoading && (
                <div className="flex items-center gap-2 text-sm text-[var(--color-text-tertiary)]">
                  <Loader2 size={14} className="animate-spin shrink-0" />
                  Analyzing article…
                </div>
              )}

              {data && (
                <>
                  {/* Tone pill */}
                  {toneConfig && (
                    <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold ${toneConfig.classes}`}>
                      {toneConfig.label} tone
                      {data.tone_reason && (
                        <span className="font-normal opacity-75 ml-1">— {data.tone_reason}</span>
                      )}
                    </div>
                  )}

                  {/* Key takeaways */}
                  {data.takeaways?.length > 0 && (
                    <div>
                      <h4 className="text-[10px] uppercase tracking-wider font-bold
                                     text-[var(--color-text-tertiary)] mb-2">
                        Key Takeaways
                      </h4>
                      <ul className="space-y-2">
                        {data.takeaways.map((t, i) => (
                          <li key={i} className="flex gap-2 text-sm text-[var(--color-text-secondary)]">
                            <span className="text-electric-500 mt-0.5 shrink-0">•</span>
                            {t}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* No content message */}
                  {!data.takeaways?.length && !isLoading && (
                    <p className="text-sm text-[var(--color-text-tertiary)]">
                      Analysis unavailable for this article.
                    </p>
                  )}
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
