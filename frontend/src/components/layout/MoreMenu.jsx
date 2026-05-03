/**
 * MoreMenu — Tier-2 navigation drop-down per plan §5A.
 *
 * Surfaces all the Reality Index pages and the new category routes
 * without overwhelming the top bar. Click to open, click outside to
 * close. Keyboard-accessible (Esc closes, Tab traps inside while open).
 *
 * Sections mirror plan §5A grouping. Items are flagged "live" today vs.
 * "planned" so the menu is honest about what works.
 */

import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ChevronDown, Activity, Briefcase, Globe2, FileText, AlertTriangle,
  ArrowUpDown, Star, Tv, CloudSun, Newspaper, Database, Trophy, Dice5,
  Heart, CloudRain, Bitcoin, Cpu, Rocket,
} from "lucide-react";
import { useT } from "../../lib/i18n";
import { COPY } from "../../lib/copyGuide";

export default function MoreMenu() {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  // Build sections inside render so section titles + item labels are reactive.
  const SECTIONS = [
    {
      titleKey: "nav.reality_index",
      items: [
        { to: "/predictions", labelKey: "nav.predictions",        icon: Activity },
        { to: "/events",      labelKey: "nav.event_tracker",      icon: Newspaper },
        { to: "/truth-gap",   labelKey: "nav.truth_gap",          icon: ArrowUpDown },
        { to: "/anomalies",   labelKey: "nav.anomalies",          icon: AlertTriangle },
        { to: "/briefs",      labelKey: "nav.analyst_briefs",     icon: FileText },
        { to: "/synthetic",   labelKey: "nav.synthetic_markets",  icon: Dice5 },
        { to: "/leaderboard", labelKey: "nav.leaderboard",        icon: Trophy },
        { to: "/dashboard",   labelKey: "nav.my_dashboard",       icon: Star },
      ],
    },
    {
      titleKey: "nav.markets_live",
      items: [
        { to: "/finance",     labelKey: "nav.finance",    icon: Briefcase },
        { to: "/macro",       labelKey: "nav.macro",      icon: Database },
        { to: "/markets",     labelKey: "nav.markets",    icon: Briefcase },
        { to: "/world-map",   labelKey: "nav.world_map",  icon: Globe2 },
        { to: "/weather",     labelKey: "nav.weather",    icon: CloudSun },
        { to: "/live-tv",     labelKey: "nav.live_tv",    icon: Tv },
      ],
    },
    {
      titleKey: "nav.categories",
      items: [
        { to: "/health",  labelKey: "nav.health",  icon: Heart },
        { to: "/climate", labelKey: "nav.climate", icon: CloudRain },
        { to: "/sports",  labelKey: "nav.sports",  icon: Trophy },
        { to: "/crypto",  labelKey: "nav.crypto",  icon: Bitcoin },
        { to: "/ai",      labelKey: "nav.ai",      icon: Cpu },
        { to: "/space",   labelKey: "nav.space",   icon: Rocket },
      ],
    },
  ];

  useEffect(() => {
    if (!open) return;
    const onClick = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="inline-flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-full border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] transition-colors"
      >
        More
        <ChevronDown size={11} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-72 sm:w-80 max-h-[80vh] overflow-y-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg z-50 p-3">
          <div className="space-y-4">
            {SECTIONS.map(s => (
              <section key={s.titleKey}>
                <h4 className="text-[10px] uppercase tracking-wide font-semibold text-[var(--color-text-secondary)] mb-1.5 px-2">
                  {t(s.titleKey)}
                </h4>
                <div className="grid grid-cols-2 gap-1">
                  {s.items.map(it => {
                    const Icon = it.icon;
                    return (
                      <Link
                        key={it.to}
                        to={it.to}
                        onClick={() => setOpen(false)}
                        className="flex items-center gap-2 px-2 py-2 rounded text-xs text-[var(--color-text)] hover:bg-[var(--color-surface-2)] transition-colors"
                      >
                        <Icon size={12} className="text-[var(--color-accent)] flex-shrink-0" />
                        <span className="truncate">{t(it.labelKey)}</span>
                      </Link>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
          <div className="border-t border-[var(--color-border)] mt-3 pt-2 px-2">
            <p className="text-[10px] text-[var(--color-text-tertiary)] italic">
              {COPY.brandTagline(t)}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
