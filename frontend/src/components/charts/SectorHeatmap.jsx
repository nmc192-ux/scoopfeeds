/**
 * SectorHeatmap — squarified treemap of sectors by volume.
 *
 * Pure SVG, no deps. Same approach as WorldMap.jsx — the project's house
 * style is "if a chart can be done in <300 lines of SVG, don't pull in d3".
 *
 * Each cell:
 *   • area  ∝ item.value (e.g. 24h volume)
 *   • color keyed to item.score in [0,1]:
 *       <0.4  → red    (bearish / NO consensus)
 *        0.4-0.6 → neutral grey
 *       >0.6  → green  (bullish / YES consensus)
 *   • title attr provides full tooltip on hover
 *
 * Layout: squarified treemap (Bruls et al. 2000) — gives cells a balanced
 * aspect ratio without a layout library.
 *
 * Props:
 *   items:       [{ key, label, value, score, href? }]
 *   width:       px (default 600)
 *   height:      px (default 280)
 *   formatValue: (n) => string  (default: locale money)
 *   onClick:     (item) => void  optional
 */

function colorForScore(score) {
  if (!Number.isFinite(score)) return "var(--color-surface-2)";
  if (score < 0.4) {
    const t = Math.max(0, Math.min(1, (0.4 - score) / 0.4));
    return `rgba(220, 38, 38, ${0.35 + t * 0.45})`;
  }
  if (score > 0.6) {
    const t = Math.max(0, Math.min(1, (score - 0.6) / 0.4));
    return `rgba(16, 185, 129, ${0.35 + t * 0.45})`;
  }
  return "rgba(148, 163, 184, 0.35)";
}

// Squarified treemap (Bruls et al.) — minimal recursive impl.
function squarify(items, x, y, w, h) {
  const total = items.reduce((s, it) => s + Math.max(0, it.value || 0), 0);
  if (total <= 0 || w <= 0 || h <= 0) return [];

  const scaled = items
    .filter(it => (it.value || 0) > 0)
    .map(it => ({ ...it, _area: ((it.value || 0) / total) * w * h }))
    .sort((a, b) => b._area - a._area);

  const out = [];
  let cx = x, cy = y, cw = w, ch = h;

  const worstRatio = (row, side) => {
    if (row.length === 0 || side <= 0) return Infinity;
    const sum = row.reduce((s, r) => s + r._area, 0);
    if (sum <= 0) return Infinity;
    const max = Math.max(...row.map(r => r._area));
    const min = Math.min(...row.map(r => r._area));
    return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min));
  };

  const layoutRow = (row, side, isHoriz) => {
    const sum = row.reduce((s, r) => s + r._area, 0);
    if (sum <= 0 || side <= 0) return;
    const thickness = sum / side;
    let offset = 0;
    for (const r of row) {
      const len = r._area / thickness;
      if (isHoriz) {
        out.push({ ...r, _x: cx + offset, _y: cy, _w: len, _h: thickness });
        offset += len;
      } else {
        out.push({ ...r, _x: cx, _y: cy + offset, _w: thickness, _h: len });
        offset += len;
      }
    }
    if (isHoriz) { cy += thickness; ch -= thickness; }
    else         { cx += thickness; cw -= thickness; }
  };

  let row = [];
  let i = 0;
  while (i < scaled.length) {
    const isHoriz = cw >= ch;
    const side    = isHoriz ? cw : ch;
    const next    = scaled[i];
    const trial   = [...row, next];
    if (row.length === 0 || worstRatio(trial, side) <= worstRatio(row, side)) {
      row.push(next);
      i++;
    } else {
      layoutRow(row, side, isHoriz);
      row = [];
    }
  }
  if (row.length) {
    const isHoriz = cw >= ch;
    layoutRow(row, isHoriz ? cw : ch, isHoriz);
  }

  return out;
}

function fmtDefault(n) {
  if (!Number.isFinite(n)) return "—";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${Math.round(n)}`;
}

export default function SectorHeatmap({
  items = [],
  width = 600,
  height = 280,
  formatValue = fmtDefault,
  onClick,
}) {
  if (!items.length) {
    return (
      <div
        className="flex items-center justify-center text-xs text-[var(--color-text-secondary)] rounded-lg border border-[var(--color-border)]"
        style={{ width: "100%", aspectRatio: `${width}/${height}` }}
      >
        No sector data.
      </div>
    );
  }

  const cells = squarify(items, 0, 0, width, height);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Sector heatmap of ${items.length} sectors. Cell area is proportional to value; color shows score.`}
      className="w-full h-auto"
      preserveAspectRatio="none"
    >
      {cells.map(c => {
        const fill   = colorForScore(c.score);
        const stroke = "var(--color-surface)";
        const fontSize  = Math.max(8, Math.min(12, Math.sqrt(c._w * c._h) / 9));
        const showLabel = c._w > 60 && c._h > 28;
        const showSub   = c._w > 80 && c._h > 44;
        const Wrapper   = c.href ? "a" : "g";
        const titleStr  = `${c.label}: ${formatValue(c.value)}${
          Number.isFinite(c.score) ? ` · score ${Math.round(c.score * 100)}%` : ""
        }`;
        return (
          <Wrapper
            key={c.key}
            {...(c.href ? { href: c.href } : {})}
            onClick={() => onClick?.(c)}
            style={{ cursor: c.href || onClick ? "pointer" : "default" }}
          >
            <rect
              x={c._x} y={c._y} width={c._w} height={c._h}
              fill={fill} stroke={stroke} strokeWidth={1.5}
            >
              <title>{titleStr}</title>
            </rect>
            {showLabel && (
              <text
                x={c._x + 6} y={c._y + 14}
                fill="var(--color-text)"
                fontSize={fontSize}
                fontWeight={600}
                style={{ textTransform: "capitalize", pointerEvents: "none" }}
              >
                {c.label}
              </text>
            )}
            {showSub && (
              <text
                x={c._x + 6} y={c._y + 14 + fontSize + 2}
                fill="var(--color-text-secondary)"
                fontSize={fontSize - 1}
                style={{ pointerEvents: "none" }}
              >
                {formatValue(c.value)}{Number.isFinite(c.score) ? ` · ${Math.round(c.score * 100)}%` : ""}
              </text>
            )}
          </Wrapper>
        );
      })}
    </svg>
  );
}
