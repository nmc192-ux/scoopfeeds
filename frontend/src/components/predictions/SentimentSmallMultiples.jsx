/**
 * SentimentSmallMultiples — one tiny line chart per source showing the
 * polarity time-series for an event.
 *
 * Layout: 2-column grid on desktop, stacked on mobile. Each panel shows
 * source name + latest polarity + sparkline. Wikipedia (no polarity) is
 * shown as a volume bar instead.
 */

import { LineChart, Line, ResponsiveContainer, YAxis, ReferenceLine, Tooltip, BarChart, Bar } from "recharts";
import { useMemo } from "react";

const SOURCE_META = {
  bluesky:   { color: "#0ea5e9", label: "Bluesky"   },
  reddit:    { color: "#ff4500", label: "Reddit"    },
  mastodon:  { color: "#6364ff", label: "Mastodon"  },
  hn:        { color: "#ff6600", label: "HN"        },
  media:     { color: "#7c3aed", label: "Media"     },
  wikipedia: { color: "#10b981", label: "Wikipedia" },
};

function bucketHistory(history) {
  const bySource = {};
  for (const h of history ?? []) {
    if (!bySource[h.source]) bySource[h.source] = [];
    bySource[h.source].push({ ts: h.ts, polarity: h.polarity, intensity: h.intensity, volume: h.volume });
  }
  // Reverse to chronological order for charts.
  for (const k of Object.keys(bySource)) bySource[k].sort((a, b) => a.ts - b.ts);
  return bySource;
}

function PolarityPanel({ source, points, latest }) {
  const meta = SOURCE_META[source] ?? { color: "#6b7280", label: source };
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: meta.color }}>
          {meta.label}
        </span>
        <span className="text-[10px] tabular-nums text-[var(--color-text-secondary)]">
          {Number.isFinite(latest?.polarity)
            ? `${latest.polarity > 0 ? "+" : ""}${latest.polarity.toFixed(2)}`
            : "—"}
        </span>
      </div>
      <div className="h-12">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
            <YAxis hide domain={[-1, 1]} />
            <ReferenceLine y={0} stroke="var(--color-border)" strokeDasharray="2 2" />
            <Tooltip
              contentStyle={{
                background:  "var(--color-surface)",
                border:      "1px solid var(--color-border)",
                borderRadius: 6,
                fontSize:    10,
              }}
              labelFormatter={(ts) => new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit" })}
              formatter={(v, k) => k === "polarity" ? [v?.toFixed?.(2), "polarity"] : [v, k]}
            />
            <Line
              type="monotone"
              dataKey="polarity"
              stroke={meta.color}
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="text-[10px] text-[var(--color-text-tertiary)] tabular-nums">
        {latest?.volume ?? 0} mentions · last update {latest?.ts ? relTime(latest.ts) : "—"}
      </div>
    </div>
  );
}

function VolumePanel({ source, points, latest }) {
  const meta = SOURCE_META[source] ?? { color: "#10b981", label: source };
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: meta.color }}>
          {meta.label}
        </span>
        <span className="text-[10px] tabular-nums text-[var(--color-text-secondary)]">
          {latest?.volume ?? 0} views
        </span>
      </div>
      <div className="h-12">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={points} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
            <YAxis hide />
            <Tooltip
              contentStyle={{
                background: "var(--color-surface)",
                border: "1px solid var(--color-border)",
                borderRadius: 6,
                fontSize: 10,
              }}
              formatter={(v) => [v, "views"]}
              labelFormatter={(ts) => new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric" })}
            />
            <Bar dataKey="volume" fill={meta.color} radius={[2, 2, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="text-[10px] text-[var(--color-text-tertiary)] tabular-nums">
        attention spike (vs 14d baseline)
      </div>
    </div>
  );
}

function relTime(ms) {
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export default function SentimentSmallMultiples({ sentiment, isLoading = false }) {
  const buckets = useMemo(() => bucketHistory(sentiment?.history), [sentiment?.history]);
  const latestBySource = useMemo(() => {
    const m = {};
    for (const s of sentiment?.latest ?? []) m[s.source] = s;
    return m;
  }, [sentiment?.latest]);

  const sourcesPresent = Object.keys(buckets);

  if (isLoading) {
    return (
      <div className="grid sm:grid-cols-2 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 rounded-lg bg-[var(--color-surface-2)] animate-pulse" />
        ))}
      </div>
    );
  }

  if (!sourcesPresent.length) {
    return (
      <p className="text-sm text-[var(--color-text-secondary)]">
        No sentiment signal yet — check back as social coverage develops.
      </p>
    );
  }

  return (
    <div className="grid sm:grid-cols-2 gap-3">
      {sourcesPresent.map(src =>
        src === "wikipedia"
          ? <VolumePanel   key={src} source={src} points={buckets[src]} latest={latestBySource[src]} />
          : <PolarityPanel key={src} source={src} points={buckets[src]} latest={latestBySource[src]} />
      )}
    </div>
  );
}
