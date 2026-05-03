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
} from "lucide-react";

const SECTIONS = [
  {
    title: "Reality Index",
    items: [
      { to: "/predictions", label: "Predictions",       icon: Activity },
      { to: "/events",      label: "Event Tracker",     icon: Newspaper },
      { to: "/truth-gap",   label: "Truth Gap",         icon: ArrowUpDown },
      { to: "/anomalies",   label: "Anomalies",         icon: AlertTriangle },
      { to: "/briefs",      label: "Analyst Briefs",    icon: FileText },
      { to: "/synthetic",   label: "Synthetic Markets", icon: Dice5 },
      { to: "/leaderboard", label: "Leaderboard",       icon: Trophy },
      { to: "/dashboard",   label: "My Dashboard",      icon: Star },
    ],
  },
  {
    title: "Markets & Live Data",
    items: [
      { to: "/finance",     label: "Finance",       icon: Briefcase },
      { to: "/macro",       label: "Macro",         icon: Database },
      { to: "/markets",     label: "Markets",       icon: Briefcase },
      { to: "/world-map",   label: "World Map",     icon: Globe2 },
      { to: "/weather",     label: "Weather",       icon: CloudSun },
      { to: "/live-tv",     label: "Live TV",       icon: Tv },
    ],
  },
];

export default function MoreMenu() {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

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
              <section key={s.title}>
                <h4 className="text-[10px] uppercase tracking-wide font-semibold text-[var(--color-text-secondary)] mb-1.5 px-2">
                  {s.title}
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
                        <span className="truncate">{it.label}</span>
                      </Link>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
          <div className="border-t border-[var(--color-border)] mt-3 pt-2 px-2">
            <p className="text-[10px] text-[var(--color-text-tertiary)] italic">
              A data-backed estimate, not a certainty.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
