/**
 * MacroPage — /macro — economic indicators dashboard.
 *
 * Renders the macro_indicators table as a clean grid: rates, inflation,
 * labour, commodities, vol, FX. Currently FRED-only; World Bank / IMF
 * will append to the same table later.
 *
 * For each indicator: latest value · previous value · % delta with
 * green/red coloring · units · last observation date · source link.
 */

import { ArrowDown, ArrowUp, Minus, Database, ExternalLink } from "lucide-react";
import { useMacroIndicators } from "../hooks/useMacro";
import { COPY } from "../lib/copyGuide";

function fmtVal(v, units) {
  if (v == null || !Number.isFinite(v)) return "—";
  // Heuristic precision based on magnitude.
  const abs = Math.abs(v);
  let str;
  if (abs >= 1000)      str = v.toLocaleString(undefined, { maximumFractionDigits: 0 });
  else if (abs >= 100)  str = v.toLocaleString(undefined, { maximumFractionDigits: 1 });
  else if (abs >= 1)    str = v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  else                  str = v.toLocaleString(undefined, { maximumFractionDigits: 4 });
  if (units === "%") return `${str}%`;
  return str;
}

function deltaColor(d) {
  if (d == null || Math.abs(d) < 0.01) return "text-[var(--color-text-secondary)]";
  return d >= 0 ? "text-emerald-500" : "text-red-500";
}

function IndicatorCard({ ind }) {
  const url = (() => {
    try { return JSON.parse(ind.raw_meta || "{}").url; } catch { return null; }
  })();
  const Arrow = ind.delta_pct == null
    ? Minus
    : ind.delta_pct >= 0 ? ArrowUp : ArrowDown;

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 hover:border-[var(--color-accent)] transition-colors">
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="text-xs uppercase tracking-wide font-semibold text-[var(--color-text-secondary)] line-clamp-1">
          {ind.label}
        </h3>
        <span className="text-[10px] text-[var(--color-text-tertiary)] font-mono">{ind.series_id}</span>
      </div>
      <div className="flex items-baseline gap-2 mb-1">
        <span className="text-2xl font-editorial italic tabular-nums text-[var(--color-text)]">
          {fmtVal(ind.value, ind.units)}
        </span>
        <span className={`flex items-center gap-0.5 text-xs tabular-nums ${deltaColor(ind.delta_pct)}`}>
          <Arrow size={11} />
          {ind.delta_pct == null ? "" : `${ind.delta_pct >= 0 ? "+" : ""}${ind.delta_pct.toFixed(2)}%`}
        </span>
      </div>
      <div className="flex items-center justify-between text-[10px] text-[var(--color-text-tertiary)]">
        <span>
          Prev <span className="tabular-nums">{fmtVal(ind.previous_value, ind.units)}</span>
          {ind.previous_date && <span className="ml-1">({ind.previous_date})</span>}
        </span>
        {url ? (
          <a href={url} target="_blank" rel="noopener noreferrer" className="hover:text-[var(--color-accent)] inline-flex items-center gap-0.5">
            FRED <ExternalLink size={9} />
          </a>
        ) : (
          <span>{ind.frequency || ""}</span>
        )}
      </div>
      <div className="text-[10px] text-[var(--color-text-tertiary)] mt-0.5">
        {ind.observation_date} · {ind.units || ""}
      </div>
    </div>
  );
}

export default function MacroPage() {
  const { data, isLoading } = useMacroIndicators();
  const indicators = data?.indicators ?? [];

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
      <header className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <Database size={18} className="text-[var(--color-accent)]" />
          <h1 className="font-editorial italic text-2xl text-[var(--color-text)]">Macro</h1>
          <span className="text-[10px] text-[var(--color-text-secondary)] tabular-nums ml-1">
            {indicators.length} indicators
          </span>
        </div>
        <p className="text-sm text-[var(--color-text-secondary)]">
          {COPY.brandTagline} Curated rates, inflation, labour, commodities, FX from St. Louis Fed (FRED).
        </p>
      </header>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="h-28 rounded-xl bg-[var(--color-surface-2)] animate-pulse" />
          ))}
        </div>
      ) : indicators.length === 0 ? (
        <div className="text-center py-16 text-sm text-[var(--color-text-secondary)]">
          <Database size={28} className="mx-auto mb-3 opacity-50" />
          <p>No macro indicators yet.</p>
          <p className="mt-1 text-[10px] text-[var(--color-text-tertiary)]">
            Set <code>FRED_API_KEY</code> on Hostinger to enable the 6-hour pull.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {indicators.map(ind => (
            <IndicatorCard key={`${ind.provider}-${ind.series_id}`} ind={ind} />
          ))}
        </div>
      )}

      <p className="text-[10px] text-[var(--color-text-tertiary)] italic mt-6 text-center">
        {data?.disclaimer || COPY.brandTagline}
      </p>
    </div>
  );
}
