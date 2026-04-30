import { motion } from "framer-motion";
import clsx from "clsx";

/**
 * Scout — the SCOOP mascot
 * A scrappy basset hound journalist with a press hat & magnifying glass
 * Sizes: sm (32) | md (48) | lg (80) | xl (120) | hero (200)
 */
export default function ScoopMascot({ size = "md", className = "", animated = true, mood = "happy" }) {
  const sizes = { sm: 32, md: 48, lg: 80, xl: 120, hero: 200 };
  const px = sizes[size] || sizes.md;
  const h  = Math.round(px * 120 / 100);

  const Wrapper = animated ? motion.div : "div";
  const wrapperProps = animated
    ? { animate: { y: [0, -4, 0] }, transition: { duration: 3.5, repeat: Infinity, ease: "easeInOut" } }
    : {};

  return (
    <Wrapper {...wrapperProps} className={clsx("inline-flex items-center justify-center select-none", className)}>
      <svg width={px} height={h} viewBox="0 0 100 120" fill="none"
           xmlns="http://www.w3.org/2000/svg" aria-label="Scout, the Scoop mascot">

        {/* ── Shadow ──────────────────────────────────────── */}
        <ellipse cx="50" cy="118" rx="24" ry="4" fill="black" fillOpacity="0.1" />

        {/* ── Left ear (long droopy) ──────────────────────── */}
        <path d="M26,24 Q13,50 11,82 Q9,104 18,112 Q24,116 30,110 Q36,104 36,82 Q37,50 32,24Z"
              fill="#7A4218" />
        <path d="M28,26 Q17,52 16,80 Q15,100 21,108 Q24,110 28,106 Q31,102 31,80 Q32,52 30,26Z"
              fill="#A06030" fillOpacity="0.45" />

        {/* ── Right ear ──────────────────────────────────── */}
        <path d="M74,24 Q87,50 89,82 Q91,104 82,112 Q76,116 70,110 Q64,104 64,82 Q63,50 68,24Z"
              fill="#7A4218" />
        <path d="M72,26 Q83,52 84,80 Q85,100 79,108 Q76,110 72,106 Q69,102 69,80 Q68,52 70,26Z"
              fill="#A06030" fillOpacity="0.45" />

        {/* ── Body ────────────────────────────────────────── */}
        <ellipse cx="50" cy="92" rx="27" ry="21" fill="#F5E0B8" />
        <ellipse cx="50" cy="94" rx="19" ry="13" fill="#EDD9A8" fillOpacity="0.5" />

        {/* ── Paws ────────────────────────────────────────── */}
        <rect x="28" y="109" width="15" height="9" rx="4.5" fill="#F5E0B8" stroke="#7A4218" strokeWidth="0.8" />
        <rect x="57" y="109" width="15" height="9" rx="4.5" fill="#F5E0B8" stroke="#7A4218" strokeWidth="0.8" />
        {/* Toe lines */}
        <path d="M30,118 Q32,115 34,118 Q36,115 38,118" stroke="#7A4218" strokeWidth="0.7" fill="none" strokeLinecap="round" />
        <path d="M59,118 Q61,115 63,118 Q65,115 67,118" stroke="#7A4218" strokeWidth="0.7" fill="none" strokeLinecap="round" />

        {/* ── Magnifying glass (right paw) ──────────────── */}
        <circle cx="74" cy="104" r="6" fill="none" stroke="#7A4218" strokeWidth="2" />
        <circle cx="74" cy="104" r="4.5" fill="#B3D4E8" fillOpacity="0.4" />
        <line x1="78.5" y1="108.5" x2="83" y2="113" stroke="#7A4218" strokeWidth="2.5" strokeLinecap="round" />

        {/* ── SCOOP press badge on chest ────────────────── */}
        <rect x="33" y="79" width="34" height="17" rx="3" fill="white" fillOpacity="0.97" />
        <rect x="33" y="79" width="34" height="17" rx="3" stroke="#2563EB" strokeWidth="1.5" />
        <text x="50" y="89.5" textAnchor="middle" fontSize="6.5" fontWeight="900"
              fill="#2563EB" fontFamily="system-ui, -apple-system, sans-serif">SCOOP</text>
        <text x="50" y="94" textAnchor="middle" fontSize="3.5"
              fill="#999" fontFamily="system-ui, sans-serif">press</text>

        {/* ── Head ────────────────────────────────────────── */}
        <circle cx="50" cy="42" r="30" fill="#F5E0B8" />

        {/* ── Press hat ───────────────────────────────────── */}
        <rect x="28" y="8" width="44" height="18" rx="5" fill="#111111" />
        <rect x="24" y="23" width="52" height="6" rx="3" fill="#1A1A1A" />
        {/* Badge */}
        <rect x="31" y="9" width="38" height="16" rx="3" fill="#2563EB" />
        <text x="50" y="20" textAnchor="middle" fontSize="7.5" fontWeight="900"
              fill="white" fontFamily="system-ui, -apple-system, sans-serif">PRESS</text>

        {/* ── Worried brows (classic basset) ──────────────── */}
        <path d="M30,33 Q37,29 44,33" fill="none" stroke="#7A4218" strokeWidth="2.2" strokeLinecap="round" />
        <path d="M56,33 Q63,29 70,33" fill="none" stroke="#7A4218" strokeWidth="2.2" strokeLinecap="round" />

        {/* ── Left eye ────────────────────────────────────── */}
        <circle cx="38" cy="43" r="8.5" fill="white" />
        <circle cx="38" cy="44" r="6" fill="#2C1810" />
        <circle cx="36.5" cy="42" r="2.2" fill="white" />
        <circle cx="36.5" cy="42" r="1.1" fill="white" fillOpacity="0.8" />
        {/* Droopy lower lid */}
        <path d="M29,49 Q38,54 47,49" fill="none" stroke="#7A4218" strokeWidth="1.2"
              strokeLinecap="round" strokeOpacity="0.65" />

        {/* ── Right eye ───────────────────────────────────── */}
        <circle cx="62" cy="43" r="8.5" fill="white" />
        <circle cx="62" cy="44" r="6" fill="#2C1810" />
        <circle cx="60.5" cy="42" r="2.2" fill="white" />
        <circle cx="60.5" cy="42" r="1.1" fill="white" fillOpacity="0.8" />
        <path d="M53,49 Q62,54 71,49" fill="none" stroke="#7A4218" strokeWidth="1.2"
              strokeLinecap="round" strokeOpacity="0.65" />

        {/* ── Muzzle / snout ──────────────────────────────── */}
        <ellipse cx="50" cy="57" rx="14" ry="10.5" fill="#EDD9A8" />

        {/* ── Nose ────────────────────────────────────────── */}
        <ellipse cx="50" cy="52" rx="7" ry="5.5" fill="#1A1A1A" />
        <ellipse cx="48" cy="50.5" rx="2.8" ry="2" fill="white" fillOpacity="0.35" />

        {/* ── Mouth ───────────────────────────────────────── */}
        {(mood === "happy") && (
          <path d="M41,62 Q50,68 59,62" fill="none" stroke="#7A4218" strokeWidth="1.8" strokeLinecap="round" />
        )}
        {(mood === "reading") && (
          <path d="M43,62 Q50,65 57,62" fill="none" stroke="#7A4218" strokeWidth="1.8" strokeLinecap="round" />
        )}
      </svg>
    </Wrapper>
  );
}

// Backward-compat alias
export const KhabriMascot = ScoopMascot;

/** ─── Compact header logo mark — cobalt hummingbird badge ───────────────── */
export function ScoopLogo({ size = 32, className = "", dark = false }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none"
         xmlns="http://www.w3.org/2000/svg" className={className} aria-label="Scoop">
      <defs>
        <linearGradient id="cobalt-badge-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#2563EB" />
          <stop offset="100%" stopColor="#1E3A8A" />
        </linearGradient>
      </defs>

      {/* ── Cobalt badge background ──────────────────────────── */}
      <rect width="40" height="40" rx="9" fill="url(#cobalt-badge-grad)" />
      <rect x="0.5" y="0.5" width="39" height="39" rx="8.5"
            fill="none" stroke="white" strokeOpacity="0.15" strokeWidth="1" />

      {/* ── Hummingbird body ─────────────────────────────────── */}
      <path d="M10 20C10 14 15 9 20 9C21.5 9 21.5 13 20 19C20 19 15 21 10 20Z"
            fill="white" fillOpacity="0.35" />
      <path d="M10 20C10 26 15 31 20 31C21.5 31 21.5 27 20 21C20 21 15 21 10 20Z"
            fill="white" fillOpacity="0.85" />

      {/* ── Body ─────────────────────────────────────────────── */}
      <path d="M18 20C18 14.5 22 11 27 11C32 11 33.5 16 33.5 20C33.5 24 32 29 27 29C22 29 18 25.5 18 20Z"
            fill="white" />

      {/* ── Beak ─────────────────────────────────────────────── */}
      <path d="M31 18.5L38 20L31 21.5V18.5Z" fill="#60a5fa" />

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
 * Palettes: cobalt | electric | gold
 */
export const Logo = ({
  className = "",
  showText = true,
  size = "md",
  variant = "light",
  mascot = "bird",
  palette = "cobalt",
}) => {
  const sizes      = { sm: "h-6", md: "h-10", lg: "h-16", xl: "h-24" };
  const textSizes  = { sm: "text-lg", md: "text-2xl", lg: "text-4xl", xl: "text-6xl" };
  const isDark = variant === "dark";

  const palettes = {
    cobalt:  { primary: isDark ? "#60A5FA" : "#2563EB",  accent: isDark ? "#93C5FD" : "#1D4ED8", secondary: "#1E3A8A" },
    electric:{ primary: isDark ? "#60A5FA" : "#3B82F6",  accent: "#F97316",                      secondary: "#1D4ED8" },
    gold:    { primary: isDark ? "#FDE047" : "#EAB308",  accent: "#0F172A",                      secondary: "#CA8A04" },
  };

  const theme = palettes[palette] || palettes.cobalt;
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
          {/* Wing — upper */}
          <path d="M20 50C20 35 32 20 45 20C48 20 48 30 45 45C45 45 35 50 20 50Z"
                fill={theme.primary} className="opacity-40" />
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
