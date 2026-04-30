import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Zap } from "lucide-react";
import { useFeatured } from "../../hooks/useNews";
import { useNewsStore } from "../../store/newsStore";

export default function BreakingBanner() {
  const { data: featured = [] } = useFeatured();
  const [dismissedId, setDismissedId] = useState(null);
  const isUrdu = useNewsStore(s => s.language === "ur");

  const breaking = useMemo(() => {
    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
    return featured.find(a =>
      a && a.published_at > twoHoursAgo && (a.credibility ?? 0) >= 9
    );
  }, [featured]);

  if (!breaking || dismissedId === breaking.id) return null;

  return (
    <AnimatePresence>
      <motion.a
        key={breaking.id}
        href={breaking.url}
        target="_blank"
        rel="noopener noreferrer"
        initial={{ height: 0, opacity: 0 }}
        animate={{ height: "auto", opacity: 1 }}
        exit={{ height: 0, opacity: 0 }}
        className="block bg-gradient-to-r from-electric-800 via-electric-600 to-electric-800 text-white relative overflow-hidden group focus-ring"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2.5 flex items-center gap-3">
          <span className="flex items-center gap-1.5 flex-shrink-0 font-extrabold text-xs uppercase tracking-wider bg-scoop-orange-500 px-2 py-0.5 rounded shadow-sm">
            <Zap size={12} className="fill-white" />
            {isUrdu ? "تازہ ترین" : "Breaking"}
          </span>
          <span className="text-sm font-semibold truncate flex-1 group-hover:underline">
            {breaking.title}
          </span>
          <span className="hidden sm:inline text-xs opacity-80 flex-shrink-0">
            {breaking.source_name}
          </span>
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setDismissedId(breaking.id); }}
            aria-label="Dismiss"
            className="flex-shrink-0 w-6 h-6 rounded-full hover:bg-white/20 flex items-center justify-center"
          >
            <X size={14} />
          </button>
        </div>
      </motion.a>
    </AnimatePresence>
  );
}
