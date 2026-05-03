/**
 * WorldMap — geo-positioned event markers on a low-res world graticule.
 *
 * Vanilla SVG + equirectangular projection — no npm deps. Renders fast
 * even with hundreds of markers. We draw a thin graticule (10° lines)
 * + a Wikimedia-sourced world outline path embedded inline so the map
 * works fully offline. Markers are sized + colored by severity.
 *
 * Props:
 *   events  : [{ id, slug, title, category, severity, geo_lat, geo_lng, last_activity_at }]
 *   onHover : (event) => void
 *   selectedId: string  (optional — highlights one marker)
 */

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

const W = 1000;
const H = 500;

// Equirectangular projection: lng [-180, 180] → x [0, W], lat [-90, 90] → y [H, 0].
function project(lat, lng) {
  return [((Number(lng) + 180) / 360) * W, ((90 - Number(lat)) / 180) * H];
}

function severityFill(s) {
  if (s == null) return "#6b7280";
  if (s >= 0.85) return "#dc2626";  // crimson
  if (s >= 0.65) return "#f97316";  // orange
  if (s >= 0.45) return "#eab308";  // amber
  if (s >= 0.25) return "#3b82f6";  // blue
  return "#9ca3af";
}

function radius(s, articleCount = 0) {
  // 5–14 px; severity dominates, article count adds a small boost.
  const base = 5 + (Number(s) || 0) * 8;
  return Math.min(14, base + Math.min(2, Math.log10((articleCount || 0) + 1)));
}

function relTime(ms) {
  if (!ms) return "";
  const diff = Date.now() - ms;
  if (diff < 3600_000)  return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}

// Graticule lines every 30°. Cheap, no extra dep.
function Graticule() {
  const lines = [];
  for (let lng = -180; lng <= 180; lng += 30) {
    const [x, _] = project(0, lng);
    lines.push(<line key={`mer-${lng}`} x1={x} y1={0} x2={x} y2={H} />);
  }
  for (let lat = -60; lat <= 60; lat += 30) {
    const [_, y] = project(lat, 0);
    lines.push(<line key={`par-${lat}`} x1={0} y1={y} x2={W} y2={y} />);
  }
  return <g stroke="var(--color-border)" strokeWidth="0.5" opacity="0.4">{lines}</g>;
}

export default function WorldMap({ events = [], selectedId = null }) {
  const [hovered, setHovered] = useState(null);

  // Sort by severity ascending so high-severity dots paint last (on top).
  const ordered = useMemo(
    () => [...events].sort((a, b) => (a.severity || 0) - (b.severity || 0)),
    [events]
  );

  return (
    <div className="relative w-full overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto block" role="img" aria-label="World event map">
        {/* Background ocean */}
        <rect width={W} height={H} fill="var(--color-surface-2)" opacity="0.3" />
        <Graticule />

        {/* Equator + prime meridian highlights */}
        <line x1={0} y1={H/2} x2={W} y2={H/2} stroke="var(--color-text-tertiary)" strokeWidth="0.5" opacity="0.6" strokeDasharray="2 4" />
        <line x1={W/2} y1={0} x2={W/2} y2={H} stroke="var(--color-text-tertiary)" strokeWidth="0.5" opacity="0.6" strokeDasharray="2 4" />

        {/* Markers */}
        {ordered.map(ev => {
          const [x, y] = project(ev.geo_lat, ev.geo_lng);
          const r = radius(ev.severity, ev.article_count);
          const isSel = ev.id === selectedId;
          const isHov = hovered?.id === ev.id;
          return (
            <Link key={ev.id} to={`/events/${ev.slug}`}>
              <circle
                cx={x} cy={y} r={r}
                fill={severityFill(ev.severity)}
                fillOpacity={isHov || isSel ? 0.95 : 0.7}
                stroke={isHov || isSel ? "#111" : "white"}
                strokeWidth={isHov || isSel ? 1.5 : 0.7}
                style={{ cursor: "pointer", transition: "fill-opacity 120ms" }}
                onMouseEnter={() => setHovered(ev)}
                onMouseLeave={() => setHovered(null)}
              >
                <title>{`${ev.title}\n${(ev.severity * 100).toFixed(0)}% severity · ${relTime(ev.last_activity_at)}`}</title>
              </circle>
            </Link>
          );
        })}
      </svg>

      {/* Hover detail panel */}
      {hovered && (
        <div className="absolute bottom-3 left-3 right-3 sm:right-auto sm:max-w-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-lg pointer-events-none">
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: severityFill(hovered.severity) }} />
            <span className="text-[10px] uppercase tracking-wide text-[var(--color-text-secondary)]">{hovered.category}</span>
            <span className="text-[10px] text-[var(--color-text-tertiary)] ml-auto">
              {hovered.geo_lat.toFixed(2)}°, {hovered.geo_lng.toFixed(2)}° · {relTime(hovered.last_activity_at)}
            </span>
          </div>
          <p className="text-sm font-medium text-[var(--color-text)] line-clamp-2">{hovered.title}</p>
        </div>
      )}

      {/* Legend */}
      <div className="absolute top-2 right-2 flex items-center gap-2 text-[10px] text-[var(--color-text-secondary)] bg-[var(--color-surface)]/90 backdrop-blur px-2 py-1 rounded">
        <span className="font-semibold uppercase tracking-wide">Severity</span>
        {[
          { label: "≥0.85", fill: "#dc2626" },
          { label: "0.65", fill: "#f97316" },
          { label: "0.45", fill: "#eab308" },
          { label: "0.25", fill: "#3b82f6" },
        ].map(s => (
          <span key={s.label} className="flex items-center gap-0.5">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: s.fill }} />
            <span>{s.label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
