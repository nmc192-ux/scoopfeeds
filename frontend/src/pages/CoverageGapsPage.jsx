/**
 * CoverageGapsPage — /gaps (#262). DARK: shown only with ?gaps=1 or VITE_COVERAGE_GAPS=true
 * (App.jsx renders the 404 page otherwise).
 *
 * Stories that many outlets in one region are covering while a region that was publishing
 * in the same window carries nothing on them. MEASURED BY REGION, NEVER BY LEANING: the copy
 * names regions only, with no political framing.
 *
 * Earn-render: the daily list renders only when it has items; the weekly section only when a
 * report is stored. The method line always shows, because it is what makes the list honest.
 */
import { Link } from "react-router-dom";
import { useCoverageGapsDaily, useCoverageGapsWeekly } from "../hooks/useCoverageGaps";

function labelOf(method, id) {
  return method?.buckets?.find((b) => b.id === id)?.label ?? id;
}

function MethodLine({ method }) {
  if (!method) return null;
  const pct = method.unknownShare == null ? null : Math.round(method.unknownShare * 100);
  return (
    <p className="text-sm text-[var(--color-text-tertiary)]" data-testid="gaps-method">
      Measured by where outlets publish from.
      {pct != null && ` ${pct}% of outlets have no known region and are not counted.`}
      {` A story counts when at least ${method.minPresent} outlets from one region cover it and none of the outlets from another region do, where that region had at least ${method.minBase} outlets publishing in the same period.`}
    </p>
  );
}

function GapList({ items, method, testid }) {
  return (
    <ol className="space-y-4" data-testid={testid}>
      {items.map((g) => (
        <li key={g.slug} className="border-b border-[var(--color-border)] pb-3">
          <Link to={`/events/${g.slug}`} className="font-semibold hover:underline">{g.title}</Link>
          <p className="text-sm text-[var(--color-text-secondary)] mt-1">
            {g.present.outlets} of {method?.bases?.[g.present.bucket] ?? "?"} active {labelOf(method, g.present.bucket)} outlets covered this.
            {" "}None of {g.absent.activeBase} active {labelOf(method, g.absent.bucket)} outlets did.
          </p>
        </li>
      ))}
    </ol>
  );
}

export default function CoverageGapsPage() {
  const { data: daily, isLoading } = useCoverageGapsDaily();
  const { data: weekly } = useCoverageGapsWeekly();
  const items = daily?.items ?? [];

  return (
    <main className="max-w-3xl mx-auto px-4 py-8" data-testid="coverage-gaps-page">
      <h1 className="text-3xl font-bold">Coverage Gaps</h1>
      <p className="mt-2 text-[var(--color-text-secondary)]">
        Stories that are big in one region and missing in another, over the last 24 hours.
      </p>
      <div className="mt-3"><MethodLine method={daily?.method} /></div>

      {!isLoading && items.length > 0 && (
        <section className="mt-8">
          <GapList items={items} method={daily.method} testid="gaps-daily" />
        </section>
      )}

      {weekly?.items?.length > 0 && (
        <section className="mt-12" data-testid="gaps-weekly">
          <h2 className="text-xl font-bold">Gap Report, week of {weekly.week_start}</h2>
          <div className="mt-2"><MethodLine method={weekly.method} /></div>
          <div className="mt-4"><GapList items={weekly.items} method={weekly.method} testid="gaps-weekly-list" /></div>
        </section>
      )}
    </main>
  );
}
