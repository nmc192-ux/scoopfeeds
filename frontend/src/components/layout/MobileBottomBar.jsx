/**
 * MobileBottomBar — fixed bottom tab bar for small screens (plan §5F).
 *
 * Visible only at sm-: hidden on tablet+. Five primary destinations chosen
 * to mirror what plan §5F called out (For You / Events / Markets / Search /
 * Saved). For You doesn't exist yet → swap in Home; Search routes to the
 * existing /search page.
 *
 * Active route highlighted by matching the current pathname's prefix.
 */

import { Link, useLocation } from "react-router-dom";
import { Home, Activity, Briefcase, Search, Bookmark } from "lucide-react";

const TABS = [
  { to: "/",            label: "Home",    icon: Home },
  { to: "/events",      label: "Events",  icon: Activity },
  { to: "/finance",     label: "Markets", icon: Briefcase },
  { to: "/search",      label: "Search",  icon: Search },
  { to: "/saved",       label: "Saved",   icon: Bookmark },
];

function isActive(pathname, to) {
  if (to === "/") return pathname === "/" || pathname.startsWith("/topic") || pathname === "/breaking";
  return pathname === to || pathname.startsWith(`${to}/`);
}

export default function MobileBottomBar() {
  const { pathname } = useLocation();
  // Hide on /scoop-ops (operator surfaces) so the bar doesn't crowd admin views.
  if (pathname.startsWith("/scoop-ops")) return null;

  return (
    <nav
      role="navigation"
      aria-label="Primary"
      className="sm:hidden fixed bottom-0 inset-x-0 z-40 border-t border-[var(--color-border)] bg-[var(--color-surface)]/95 backdrop-blur"
      // iPhone safe-area inset.
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0)" }}
    >
      <ul className="flex items-stretch justify-around">
        {TABS.map(t => {
          const Icon = t.icon;
          const active = isActive(pathname, t.to);
          return (
            <li key={t.to} className="flex-1">
              <Link
                to={t.to}
                className={`flex flex-col items-center justify-center gap-0.5 py-2 transition-colors ${
                  active
                    ? "text-[var(--color-accent)]"
                    : "text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"
                }`}
                aria-current={active ? "page" : undefined}
              >
                <Icon size={18} fill={active ? "currentColor" : "none"} strokeWidth={active ? 2 : 1.5} />
                <span className="text-[10px] font-medium">{t.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
