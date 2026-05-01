/**
 * FactTile — displays a single key statistic from an Explained piece.
 * Used in a responsive grid on AnalysisExplainedPage.
 */
export default function FactTile({ fact }) {
  if (!fact) return null;
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-center">
      <div className="text-3xl font-bold text-electric-600 tabular-nums leading-tight">
        {fact.value}
        {fact.unit && (
          <span className="text-base ml-1 font-normal text-[var(--color-text-tertiary)]">
            {fact.unit}
          </span>
        )}
      </div>
      <p className="mt-1.5 text-sm font-semibold text-[var(--color-text)] leading-snug">
        {fact.label}
      </p>
      {fact.source && (
        <p className="mt-0.5 text-[10px] text-[var(--color-text-tertiary)]">
          Source: {fact.source}
        </p>
      )}
    </div>
  );
}
