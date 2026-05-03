/**
 * predictionFormat — small pure helpers for displaying market data.
 * Intentionally framework-free so they can be unit-tested without React.
 */

/** "63%" from 0.628. Returns "—" for null/undefined/NaN. */
export function formatProbability(p, { decimals = 0 } = {}) {
  if (p == null || !Number.isFinite(p)) return "—";
  const pct = Math.max(0, Math.min(1, p)) * 100;
  return `${pct.toFixed(decimals)}%`;
}

/** "+12pp" / "−4pp" / "0pp" from a delta in [-1, 1]. */
export function formatDelta(d) {
  if (d == null || !Number.isFinite(d)) return "—";
  const pp = Math.round(d * 100);
  if (pp === 0) return "0pp";
  return `${pp > 0 ? "+" : "−"}${Math.abs(pp)}pp`;
}

/** "$54k" / "$1.2M" / "$320" from raw dollars. */
export function formatMoney(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000)     return `$${(n / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}k`;
  return `$${Math.round(n)}`;
}

/** "Mar 14" or "Apr 3, 2027" depending on year. Accepts ms or ISO. */
export function formatEndDate(input) {
  if (!input) return null;
  const d = typeof input === "number" ? new Date(input) : new Date(input);
  if (Number.isNaN(+d)) return null;
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString("en-US", {
    month: "short", day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/** "in 12d" / "in 4h" / "ended 3d ago". */
export function formatDistanceToEnd(input) {
  if (!input) return null;
  const target = typeof input === "number" ? input : Date.parse(input);
  if (!Number.isFinite(target)) return null;
  const diffMs = target - Date.now();
  const sign = diffMs >= 0 ? "in " : "ended ";
  const ago  = diffMs < 0 ? " ago" : "";
  const ms = Math.abs(diffMs);
  const day  = 24 * 60 * 60 * 1000;
  const hour = 60 * 60 * 1000;
  if (ms >= day)  return `${sign}${Math.round(ms / day)}d${ago}`;
  if (ms >= hour) return `${sign}${Math.round(ms / hour)}h${ago}`;
  return `${sign}${Math.max(1, Math.round(ms / 60_000))}m${ago}`;
}

/** Map a 0..1 probability to a HEX color: red→amber→emerald. */
export function probabilityColor(p) {
  if (p == null || !Number.isFinite(p)) return "#6B7280";
  const v = Math.max(0, Math.min(1, p));
  // Two-stop interpolation through amber.
  const stops = [
    { at: 0.0, hex: [239, 68, 68]   }, // red-500
    { at: 0.5, hex: [245, 158, 11]  }, // amber-500
    { at: 1.0, hex: [16, 185, 129]  }, // emerald-500
  ];
  for (let i = 1; i < stops.length; i++) {
    if (v <= stops[i].at) {
      const a = stops[i - 1], b = stops[i];
      const t = (v - a.at) / (b.at - a.at);
      const lerp = (x, y) => Math.round(x + (y - x) * t);
      const [r, g, bl] = a.hex.map((c, j) => lerp(c, b.hex[j]));
      return `rgb(${r}, ${g}, ${bl})`;
    }
  }
  return `rgb(${stops.at(-1).hex.join(",")})`;
}

/** Confidence label → bg/border classes. Used by ConfidenceDots. */
export const CONFIDENCE_TIER_COLOR = {
  high:   "bg-emerald-500",
  medium: "bg-amber-500",
  low:    "bg-rose-500",
};
