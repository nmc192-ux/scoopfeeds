/**
 * AffiliateWidget — single tasteful sidebar card showing the one affiliate
 * program we've chosen for this reader's country + (optional) category hint.
 *
 * Collapses to null when:
 *   - backend has no program configured for this country
 *   - the category has no match AND default fallback is also empty
 *   - user dismissed it (remembered via localStorage)
 *
 * Same visual language as HousePromo — small "Partner" label in the header
 * so it's transparent that it's an affiliate slot. One per sidebar.
 */
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  ShoppingBag, Bitcoin, Send, Shield, ExternalLink, X,
} from "lucide-react";
import { useAffiliatePick } from "../../hooks/useAffiliate";

const ICONS = {
  "shopping-bag": ShoppingBag,
  "bitcoin":      Bitcoin,
  "send":         Send,
  "shield":       Shield,
};

const TINTS = {
  amazon:  "bg-amber-500/10 text-amber-500",
  binance: "bg-yellow-500/10 text-yellow-500",
  wise:    "bg-emerald-500/10 text-emerald-500",
  nordvpn: "bg-electric-500/10 text-electric-500",
};

const DISMISS_KEY = "scoop.affiliate.dismissed";

function isDismissed(id) {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY);
    const map = raw ? JSON.parse(raw) : {};
    const until = map[id];
    return until && Date.now() < until;
  } catch { return false; }
}

function markDismissed(id) {
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY);
    const map = raw ? JSON.parse(raw) : {};
    // Hide this program for 7 days.
    map[id] = Date.now() + 7 * 24 * 60 * 60 * 1000;
    window.localStorage.setItem(DISMISS_KEY, JSON.stringify(map));
  } catch {}
}

export default function AffiliateWidget({ category = "default", className = "" }) {
  const { program } = useAffiliatePick(category);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (program?.id && isDismissed(program.id)) setDismissed(true);
  }, [program?.id]);

  if (!program || dismissed) return null;

  const Icon = ICONS[program.icon] || ShoppingBag;
  const tint = TINTS[program.id] || "bg-electric-500/10 text-electric-500";

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className={`card overflow-hidden relative ${className}`}
    >
      <div className="px-3 py-2 flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface2)]/60">
        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--color-text-tertiary)]">
          Partner · {program.network}
        </span>
        <button
          type="button"
          onClick={() => { markDismissed(program.id); setDismissed(true); }}
          className="text-[var(--color-text-tertiary)] hover:text-[var(--color-text)]"
          aria-label="Dismiss"
        >
          <X size={12} />
        </button>
      </div>
      <a
        href={program.url}
        target="_blank"
        rel="sponsored noopener noreferrer"
        className="flex items-start gap-3 p-4 hover:bg-[var(--color-surface2)]/50 transition-colors"
      >
        <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${tint}`}>
          <Icon size={22} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-[var(--color-text)] leading-tight">
            {program.label}
          </p>
          {program.blurb && (
            <p className="text-xs text-[var(--color-text-secondary)] mt-1 leading-relaxed">
              {program.blurb}
            </p>
          )}
          <span className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-electric-600">
            Learn more <ExternalLink size={11} />
          </span>
        </div>
      </a>
    </motion.div>
  );
}
