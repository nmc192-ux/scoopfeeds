import { motion } from "framer-motion";
import clsx from "clsx";

/**
 * Pulse — the Scoopfeeds mascot.
 * An Electric Signal hummingbird with a vivid-orange beak.
 * Sizes: sm (32) | md (48) | lg (80) | xl (120) | hero (200)
 *
 * Replaces the legacy basset-hound "Scout" mascot. The visual language is
 * cobalt body + orange beak (matches CSS tokens --color-accent / --color-orange)
 * with a soft-pulsing upper wing for the "always live" feel.
 *
 * Mood currently drives a subtle eye sparkle so empty states feel a touch
 * more inviting than info states. The shape is otherwise identical so the
 * brand mark stays consistent across surfaces.
 */
export default function ScoopMascot({
  size      = "md",
  className = "",
  animated  = true,
  mood      = "happy",
}) {
  const sizes = { sm: 32, md: 48, lg: 80, xl: 120, hero: 200 };
  const px = sizes[size] || sizes.md;

  const Wrapper = animated ? motion.div : "div";
  const wrapperProps = animated
    ? {
        animate:    { y: [0, -4, 0] },
        transition: { duration: 3.5, repeat: Infinity, ease: "easeInOut" },
      }
    : {};

  // Per-mount gradient ID so multiple instances on the same page can render
  // independently (otherwise SVG defs collide on duplicate ids).
  const gradId   = `pulse-grad-${size}`;
  const shadowId = `pulse-shadow-${size}`;

  return (
    <Wrapper
      {...wrapperProps}
      className={clsx("inline-flex items-center justify-center select-none", className)}
    >
      <svg
        width={px}
        height={px}
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label="Pulse, the Scoopfeeds hummingbird"
      >
        <defs>
          <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%"   stopColor="#3B82F6" />
            <stop offset="100%" stopColor="#1E3A8A" />
          </linearGradient>
          <radialGradient id={shadowId} cx="50%" cy="50%" r="50%">
            <stop offset="0%"   stopColor="#0F172A" stopOpacity="0.15" />
            <stop offset="100%" stopColor="#0F172A" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* ── Soft drop shadow ─────────────────────────────────── */}
        <ellipse cx="55" cy="90" rx="30" ry="5" fill={`url(#${shadowId})`} />

        {/* ── Wing (upper) — pulse ────────────────────────────── */}
        <path
          d="M20 50C20 35 32 20 45 20C48 20 48 30 45 45C45 45 35 50 20 50Z"
          fill="#3B82F6"
          fillOpacity="0.4"
          style={{ animation: "pulseSoft 2.4s ease-in-out infinite" }}
        />

        {/* ── Wing (lower) — solid gradient ───────────────────── */}
        <path
          d="M20 50C20 65 32 80 45 80C48 80 48 70 45 55C45 55 35 50 20 50Z"
          fill={`url(#${gradId})`}
        />

        {/* ── Body ────────────────────────────────────────────── */}
        <path
          d="M38 50C38 35 50 25 65 25C78 25 82 38 82 50C82 62 78 75 65 75C50 75 38 65 38 50Z"
          fill={`url(#${gradId})`}
        />

        {/* ── Belly highlight for depth ──────────────────────── */}
        <path
          d="M44 52C44 42 52 36 62 36C71 36 74 42 74 50"
          fill="none"
          stroke="white"
          strokeOpacity="0.18"
          strokeWidth="3"
          strokeLinecap="round"
        />

        {/* ── Beak — vivid orange accent ─────────────────────── */}
        <path d="M80 46L96 50L80 54V46Z" fill="#F97316" />

        {/* ── Eye ─────────────────────────────────────────────── */}
        <circle cx="70" cy="42" r="6.5" fill="white" />
        <circle cx="71" cy="43" r="3.5" fill="#0F172A" />
        <circle cx="72.5" cy="41.5" r="1.4" fill="white" />
        {mood === "happy" && (
          <circle cx="69.5" cy="42" r="0.8" fill="white" fillOpacity="0.7" />
        )}

        {/* ── Subtle chest mark — small orange dot, ties to beak */}
        <circle cx="58" cy="62" r="1.6" fill="#F97316" fillOpacity="0.55" />
      </svg>
    </Wrapper>
  );
}

// Backward-compat alias — the file used to export "Scout" as KhabriMascot.
export const KhabriMascot = ScoopMascot;

/** ─── Compact header logo mark — cobalt hummingbird badge ───────────────── */
export function ScoopLogo({ size = 32, className = "", dark = false }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none"
         xmlns="http://www.w3.org/2000/svg" className={className} aria-label="Scoop">
      <defs>
        <linearGradient id="electric-badge-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#3B82F6" />
          <stop offset="100%" stopColor="#1E3A8A" />
        </linearGradient>
      </defs>

      {/* ── Electric Signal badge ────────────────────────────── */}
      <rect width="40" height="40" rx="9" fill="url(#electric-badge-grad)" />
      <rect x="0.5" y="0.5" width="39" height="39" rx="8.5"
            fill="none" stroke="white" strokeOpacity="0.15" strokeWidth="1" />

      {/* ── Hummingbird wing — pulse ─────────────────────────── */}
      <path d="M10 20C10 14 15 9 20 9C21.5 9 21.5 13 20 19C20 19 15 21 10 20Z"
            fill="white" fillOpacity="0.35"
            style={{ animation: "pulseSoft 2.4s ease-in-out infinite" }} />
      <path d="M10 20C10 26 15 31 20 31C21.5 31 21.5 27 20 21C20 21 15 21 10 20Z"
            fill="white" fillOpacity="0.85" />

      {/* ── Body ─────────────────────────────────────────────── */}
      <path d="M18 20C18 14.5 22 11 27 11C32 11 33.5 16 33.5 20C33.5 24 32 29 27 29C22 29 18 25.5 18 20Z"
            fill="white" />

      {/* ── Beak — vivid orange accent ───────────────────────── */}
      <path d="M31 18.5L38 20L31 21.5V18.5Z" fill="#F97316" />

      {/* ── Eye ──────────────────────────────────────────────── */}
      <circle cx="28.5" cy="17" r="2.5" fill="#1E3A8A" />
      <circle cx="29" cy="16.5" r="1" fill="white" fillOpacity="0.9" />
    </svg>
  );
}

// Backward-compat alias
export const KhabriLogo = ScoopLogo;

/**
 * ─── Full Cobalt Intelligence Logo — Pulse Hummingbird ──────────────────────
 * Sizes: sm | md | lg | xl
 * Variants: light (default) | dark
 * Palettes: electric | gold
 */
export const Logo = ({
  className = "",
  showText = true,
  size = "md",
  variant = "light",
  mascot = "bird",
  palette = "electric",
}) => {
  const sizes      = { sm: "h-6", md: "h-10", lg: "h-16", xl: "h-24" };
  const textSizes  = { sm: "text-lg", md: "text-2xl", lg: "text-4xl", xl: "text-6xl" };
  const isDark = variant === "dark";

  const palettes = {
    // Electric Signal — current brand
    electric: { primary: isDark ? "#60A5FA" : "#3B82F6", accent: "#F97316", secondary: "#1E3A8A" },
    // Legacy alias kept for old `palette="cobalt"` callers
    cobalt:   { primary: isDark ? "#60A5FA" : "#3B82F6", accent: "#F97316", secondary: "#1E3A8A" },
    gold:     { primary: isDark ? "#FDE047" : "#EAB308", accent: "#0F172A", secondary: "#CA8A04" },
  };

  const theme = palettes[palette] || palettes.electric;
  const gradId = `logo-grad-${palette}-${variant}`;

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <div className={`${sizes[size]} aspect-square relative`}>
        <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
          <defs>
            <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={theme.primary} />
              <stop offset="100%" stopColor={theme.secondary} />
            </linearGradient>
          </defs>
          {/* Wing — upper (pulse) */}
          <path d="M20 50C20 35 32 20 45 20C48 20 48 30 45 45C45 45 35 50 20 50Z"
                fill={theme.primary} className="opacity-40"
                style={{ animation: "pulseSoft 2.4s ease-in-out infinite" }} />
          {/* Wing — lower */}
          <path d="M20 50C20 65 32 80 45 80C48 80 48 70 45 55C45 55 35 50 20 50Z"
                fill={`url(#${gradId})`} />
          {/* Body */}
          <path d="M38 50C38 35 50 25 65 25C78 25 82 38 82 50C82 62 78 75 65 75C50 75 38 65 38 50Z"
                fill={isDark ? "white" : "#0F172A"} />
          {/* Beak */}
          <path d="M80 46L96 50L80 54V46Z" fill={theme.accent} />
          {/* Eye */}
          <circle cx="70" cy="42" r="7" fill={isDark ? "#0F172A" : "white"} />
          <circle cx="72" cy="41" r="3" fill={theme.primary} />
        </svg>
      </div>
      {showText && (
        <span
          className={`font-bold tracking-tight ${textSizes[size]} ${isDark ? "text-white" : "text-slate-900"}`}
          style={{ fontFamily: "'Inter', system-ui, sans-serif", letterSpacing: "-0.03em" }}
        >
          Scoop<span style={{ color: theme.primary }}>feeds</span>
        </span>
      )}
    </div>
  );
};
