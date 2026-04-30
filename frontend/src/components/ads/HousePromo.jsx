/**
 * HousePromo — internal promos that replace unfilled AdSense slots so we
 * never show empty grey boxes. Rotates between a few messages so the same
 * user doesn't see the same promo every time.
 */
import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Bell, Download, TrendingUp, Bookmark, Globe2, X } from "lucide-react";
import NewsletterSignup from "../newsletter/NewsletterSignup";

const PROMOS = [
  {
    id: "newsletter",
    icon: Bell,
    tint: "bg-cobalt-50 text-cobalt-600",
    title: "Get the morning digest",
    body:  "Top headlines + market summary in your inbox at 8am, your time.",
    cta:   "Sign me up",
    href:  "#newsletter",
  },
  {
    id: "pwa",
    icon: Download,
    tint: "bg-emerald-50 text-emerald-600",
    title: "Install Scoop on your phone",
    body:  "One tap to your home screen. Works offline, loads instantly.",
    cta:   "How to install",
    href:  "#install",
  },
  {
    id: "market",
    icon: TrendingUp,
    tint: "bg-amber-500/10 text-amber-500",
    title: "Markets at a glance",
    body:  "Live FX, indices, crypto, commodities & Fear/Greed — all free.",
    cta:   "Open Market Hub",
    href:  "#markets",
  },
  {
    id: "bookmarks",
    icon: Bookmark,
    tint: "bg-purple-500/10 text-purple-500",
    title: "Save stories for later",
    body:  "Bookmark any article. Your list syncs across devices once you sign in.",
    cta:   "Try it",
    href:  "#saved",
  },
  {
    id: "personalize",
    icon: Globe2,
    tint: "bg-pink-500/10 text-pink-500",
    title: "Make it yours",
    body:  "Pick topics, sources and language — Scoop tailors the feed to you.",
    cta:   "Personalize",
    href:  "#topics",
  },
];

export default function HousePromo({
  minHeight = 0,
  onDismiss,
  variant = "card",
  label = "Scoop",
}) {
  const promo = useMemo(
    () => PROMOS[Math.floor(Math.random() * PROMOS.length)],
    []
  );
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  const Icon = promo.icon;

  // Newsletter promo: render the real inline signup form instead of a static CTA.
  if (promo.id === "newsletter" && variant !== "compact") {
    return (
      <div style={minHeight ? { minHeight } : undefined}>
        <NewsletterSignup />
      </div>
    );
  }

  if (variant === "compact") {
    // For sticky mobile anchor — short, one line
    return (
      <div className="flex items-center gap-2 px-3 py-2">
        <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${promo.tint}`}>
          <Icon size={16} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-[var(--color-text)] leading-tight truncate">
            {promo.title}
          </p>
          <p className="text-[11px] text-[var(--color-text-tertiary)] truncate">{promo.body}</p>
        </div>
        <a
          href={promo.href}
          className="text-xs font-semibold text-cobalt-600 hover:underline px-2 py-1 rounded whitespace-nowrap"
        >
          {promo.cta}
        </a>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden relative"
      style={minHeight ? { minHeight } : undefined}
    >
      <div className="px-3 py-2 flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface2)]/60">
        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--color-text-tertiary)]">
          {label}
        </span>
        <button
          type="button"
          onClick={() => { setDismissed(true); onDismiss?.(); }}
          className="text-[var(--color-text-tertiary)] hover:text-[var(--color-text)]"
          aria-label="Dismiss"
        >
          <X size={12} />
        </button>
      </div>
      <a
        href={promo.href}
        className="flex items-start gap-3 p-4 hover:bg-[var(--color-surface2)]/50 transition-colors"
      >
        <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${promo.tint}`}>
          <Icon size={22} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-[var(--color-text)] leading-tight">
            {promo.title}
          </p>
          <p className="text-xs text-[var(--color-text-secondary)] mt-1 leading-relaxed">
            {promo.body}
          </p>
          <span className="mt-2 inline-block text-xs font-semibold text-cobalt-600">
            {promo.cta} →
          </span>
        </div>
      </a>
    </motion.div>
  );
}
