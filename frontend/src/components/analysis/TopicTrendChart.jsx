/**
 * TopicTrendChart — bar chart showing article coverage volume per topic
 * over the last 24/48/72h. Uses recharts with CSS-variable theming so it
 * respects the app's dark/light mode automatically.
 */
import { useMemo, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Cell,
} from "recharts";
import { useTopicTrends } from "../../hooks/useAnalysis";
import { topicColor } from "../../lib/topicColors";

const WINDOWS = [
  { label: "24h", value: 24 },
  { label: "48h", value: 48 },
  { label: "72h", value: 72 },
];

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]
                    px-3 py-2 text-xs shadow-lg">
      <p className="font-bold text-[var(--color-text)] capitalize">{label}</p>
      <p className="text-[var(--color-text-secondary)]">{payload[0].value} articles</p>
    </div>
  );
};

export default function TopicTrendChart() {
  const [window, setWindow] = useState(72);
  const { data: trends = [], isLoading } = useTopicTrends(window);

  // Flatten to totals per category for the overview bar chart
  const chartData = useMemo(() =>
    trends
      .map(t => ({ category: t.category, count: t.total }))
      .sort((a, b) => b.count - a.count),
    [trends]
  );

  if (isLoading) {
    return (
      <div className="h-52 rounded-2xl border border-[var(--color-border)]
                      bg-[var(--color-surface)] animate-pulse" />
    );
  }

  if (!chartData.length) {
    return (
      <div className="h-52 rounded-2xl border border-[var(--color-border)]
                      bg-[var(--color-surface)] flex items-center justify-center">
        <p className="text-sm text-[var(--color-text-tertiary)]">No trend data yet</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-sm text-[var(--color-text)]">Coverage volume</h3>
        <div className="flex gap-1">
          {WINDOWS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setWindow(opt.value)}
              className={`px-2.5 py-1 rounded-full text-xs font-semibold transition-colors
                ${window === opt.value
                  ? "bg-electric-600 text-white"
                  : "bg-[var(--color-surface2)] text-[var(--color-text-secondary)] hover:bg-[var(--color-border)]"
                }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={200}>
        <BarChart
          data={chartData}
          margin={{ top: 0, right: 0, bottom: 0, left: -20 }}
          barCategoryGap="30%"
        >
          <XAxis
            dataKey="category"
            tick={{ fontSize: 11, fill: "var(--color-text-tertiary)" }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "var(--color-text-tertiary)" }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: "transparent" }} />
          <Bar dataKey="count" radius={[6, 6, 0, 0]}>
            {chartData.map(entry => (
              <Cell key={entry.category} fill={topicColor(entry.category)} fillOpacity={0.85} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
