/**
 * PerspectivePanel — expandable card showing how different outlets frame
 * the same story. One panel per story cluster that has perspectives data.
 */
import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function PerspectivePanel({ cluster }) {
  const [expanded, setExpanded] = useState(false);

  if (!cluster?.perspectives?.length) return null;

  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between px-5 py-4
                   hover:bg-[var(--color-surface2)] transition-colors text-left"
      >
        <div>
          <h3 className="font-bold text-sm text-[var(--color-text)] line-clamp-1">
            {cluster.title}
          </h3>
          <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">
            {cluster.perspectives.length} editorial angles · {cluster.article_count} sources
          </p>
        </div>
        {expanded
          ? <ChevronUp size={16} className="text-[var(--color-text-tertiary)] shrink-0 ml-3" />
          : <ChevronDown size={16} className="text-[var(--color-text-tertiary)] shrink-0 ml-3" />
        }
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-5 grid grid-cols-1 sm:grid-cols-2 gap-3 border-t border-[var(--color-border)] pt-4">
              {cluster.perspectives.map((p, i) => (
                <div
                  key={i}
                  className="rounded-xl border border-[var(--color-border)]
                             bg-[var(--color-surface2)] p-4"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-bold text-electric-600 uppercase tracking-wider">
                      {p.sourceName}
                    </span>
                    {p.outlets?.length > 1 && (
                      <span className="text-[10px] text-[var(--color-text-tertiary)]">
                        +{p.outlets.length - 1} more
                      </span>
                    )}
                  </div>
                  <p className="text-sm font-semibold text-[var(--color-text)] leading-snug mb-2">
                    {p.angle}
                  </p>
                  {p.quote && (
                    <blockquote className="text-xs text-[var(--color-text-secondary)] italic
                                           border-l-2 border-electric-400 pl-2">
                      "{p.quote}"
                    </blockquote>
                  )}
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
