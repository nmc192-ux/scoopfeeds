/**
 * SankeyNarrative — two-column flow diagram (left → right).
 *
 * Use case: show how the current top stories flow into categories
 * (each story → its category, weight = article_count). The width of
 * each ribbon visualises which categories are dominating the news cycle
 * and which stories are driving each bucket.
 *
 * Pure SVG, no deps. Layout is intentionally simple (two columns,
 * Bezier connectors); for arbitrary multi-stage flows you'd want
 * d3-sankey, but this single-stage version handles the common case
 * with zero install footprint.
 *
 * Props:
 *   sources:  [{ id, label, value, color? }]   — left column
 *   targets:  [{ id, label, value, color? }]   — right column
 *   links:    [{ source: id, target: id, value }]
 *   width:    px (default 720)
 *   height:   px (default 360)
 *   nodeWidth: px (default 8)
 *   gap:       vertical gap between nodes in px (default 6)
 */

const DEFAULT_COLORS = [
  "#6366f1", "#10b981", "#f59e0b", "#ef4444", "#06b6d4",
  "#a855f7", "#ec4899", "#84cc16", "#eab308", "#0ea5e9",
];

function layoutColumn(nodes, totalHeight, gap) {
  const total = nodes.reduce((s, n) => s + Math.max(0, n.value || 0), 0);
  if (total <= 0) return [];
  const usable = Math.max(0, totalHeight - gap * Math.max(0, nodes.length - 1));
  let y = 0;
  return nodes.map(n => {
    const h = (Math.max(0, n.value || 0) / total) * usable;
    const placed = { ...n, _y: y, _h: h };
    y += h + gap;
    return placed;
  });
}

export default function SankeyNarrative({
  sources = [],
  targets = [],
  links = [],
  width = 720,
  height = 360,
  nodeWidth = 8,
  gap = 6,
}) {
  if (!sources.length || !targets.length || !links.length) {
    return (
      <div
        className="flex items-center justify-center text-xs text-[var(--color-text-secondary)] rounded-lg border border-[var(--color-border)]"
        style={{ width: "100%", aspectRatio: `${width}/${height}` }}
      >
        No flow data yet.
      </div>
    );
  }

  const padTop = 12, padBottom = 12;
  const colHeight = height - padTop - padBottom;

  const srcLayout = layoutColumn(sources, colHeight, gap);
  const tgtLayout = layoutColumn(targets, colHeight, gap);

  const srcMap = new Map(srcLayout.map(n => [n.id, n]));
  const tgtMap = new Map(tgtLayout.map(n => [n.id, n]));

  // Track how much vertical space we've consumed inside each node so stacked
  // outgoing/incoming link bands don't overlap.
  const srcUsed = new Map();
  const tgtUsed = new Map();

  // Per-node total link weight, so each link occupies a proportional slice
  // of the node's height.
  const srcTotal = new Map();
  const tgtTotal = new Map();
  for (const l of links) {
    srcTotal.set(l.source, (srcTotal.get(l.source) || 0) + Math.max(0, l.value || 0));
    tgtTotal.set(l.target, (tgtTotal.get(l.target) || 0) + Math.max(0, l.value || 0));
  }

  // Sort links by source vertical position so band stacking is monotonic.
  const orderedLinks = [...links].sort((a, b) => {
    const ay = srcMap.get(a.source)?._y ?? 0;
    const by = srcMap.get(b.source)?._y ?? 0;
    return ay - by;
  });

  const linkPaths = [];
  for (const l of orderedLinks) {
    const s = srcMap.get(l.source);
    const t = tgtMap.get(l.target);
    if (!s || !t) continue;

    const sTotalV = srcTotal.get(l.source) || 1;
    const tTotalV = tgtTotal.get(l.target) || 1;
    const sH = (l.value / sTotalV) * s._h;
    const tH = (l.value / tTotalV) * t._h;

    const sUsed = srcUsed.get(l.source) || 0;
    const tUsed = tgtUsed.get(l.target) || 0;

    const sy0 = padTop + s._y + sUsed;
    const sy1 = sy0 + sH;
    const ty0 = padTop + t._y + tUsed;
    const ty1 = ty0 + tH;

    srcUsed.set(l.source, sUsed + sH);
    tgtUsed.set(l.target, tUsed + tH);

    const x0 = nodeWidth;
    const x1 = width - nodeWidth;
    const cx = (x0 + x1) / 2;

    // Two cubic Bezier ribbons forming a filled flow band.
    const path = [
      `M${x0},${sy0}`,
      `C${cx},${sy0} ${cx},${ty0} ${x1},${ty0}`,
      `L${x1},${ty1}`,
      `C${cx},${ty1} ${cx},${sy1} ${x0},${sy1}`,
      "Z",
    ].join(" ");

    const color =
      s.color ||
      DEFAULT_COLORS[srcLayout.findIndex(n => n.id === l.source) % DEFAULT_COLORS.length];

    linkPaths.push({
      path, color,
      value: l.value,
      sourceLabel: s.label,
      targetLabel: t.label,
    });
  }

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Sankey flow: ${sources.length} sources flowing into ${targets.length} targets via ${links.length} links.`}
      className="w-full h-auto"
      preserveAspectRatio="xMidYMid meet"
    >
      {/* Flow ribbons (drawn first so node rects sit on top) */}
      {linkPaths.map((lp, i) => (
        <path key={i} d={lp.path} fill={lp.color} fillOpacity={0.25} stroke="none">
          <title>{`${lp.sourceLabel} → ${lp.targetLabel}: ${lp.value}`}</title>
        </path>
      ))}

      {/* Source column (left) */}
      {srcLayout.map((n, i) => {
        const color = n.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length];
        return (
          <g key={`s-${n.id}`}>
            <rect x={0} y={padTop + n._y} width={nodeWidth} height={n._h} fill={color}>
              <title>{`${n.label}: ${n.value}`}</title>
            </rect>
            <text
              x={nodeWidth + 6}
              y={padTop + n._y + n._h / 2}
              fontSize={11}
              dominantBaseline="middle"
              fill="var(--color-text)"
            >
              {n.label}
            </text>
          </g>
        );
      })}

      {/* Target column (right) */}
      {tgtLayout.map(n => {
        const color = n.color || "var(--color-text-secondary)";
        return (
          <g key={`t-${n.id}`}>
            <rect
              x={width - nodeWidth} y={padTop + n._y}
              width={nodeWidth} height={n._h}
              fill={color}
            >
              <title>{`${n.label}: ${n.value}`}</title>
            </rect>
            <text
              x={width - nodeWidth - 6}
              y={padTop + n._y + n._h / 2}
              fontSize={11}
              dominantBaseline="middle"
              textAnchor="end"
              fill="var(--color-text)"
              style={{ textTransform: "capitalize" }}
            >
              {n.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
