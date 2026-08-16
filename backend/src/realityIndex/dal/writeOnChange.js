/**
 * writeOnChange — the shared change gate for the snapshot time-series tables.
 *
 * THE MEASUREMENT (2026-08-16, 6.6GB prod snapshot). Consecutive snapshots are
 * byte-identical almost always:
 *
 *   reality_index_snapshots   16,605 / 16,611 pairs identical  = 99.96%
 *   sentiment_snapshots       20,455 / 20,455 pairs identical  = 100.0%
 *                             (including `volume`, which was the one field that
 *                              might plausibly have moved every run — it did not)
 *
 * The busiest scope_id carried 1,127 snapshots over 13.9 days: 81 writes a day
 * storing the same numbers. Between them the two tables grow 129 MB/day —
 * 46 GB/year, unbounded — and 94% of that is re-recording a value that did not
 * change.
 *
 * So the fix is not retention. Retention deletes rows we should never have
 * written; this stops writing them. Retention is a separate, later decision, and
 * a much smaller one once this lands.
 *
 * THREE THINGS IT HAS TO GET RIGHT (DrJ):
 *
 * 1. EPSILON, NOT EQUALITY. The columns are REAL. `0.1 + 0.2 !== 0.3`, and a
 *    recomputed float that is identical in meaning can differ in its last bits —
 *    exact comparison would silently pass everything through and the gate would
 *    do nothing while appearing to work. Compared with a tolerance instead.
 *
 * 2. A 24h HEARTBEAT. A genuinely flat series must still have points, or the
 *    sparkline has nothing to draw; more importantly a GAP IN THE DATA MUST
 *    REMAIN DISTINGUISHABLE FROM AN OUTAGE. Without a heartbeat, "unchanged for
 *    six weeks" and "the scorer has been dead for six weeks" produce the same
 *    empty range, and there is no way to tell them apart afterwards. That
 *    distinction is worth more than the bytes it costs.
 *
 * 3. COUNTED AND LOGGED. Written vs skipped, per run. If the ratio is not
 *    ~1000:1 on the first day something is wrong, and that should be visible
 *    rather than assumed.
 */

/**
 * Tolerance for the REAL comparisons. The columns are bounded — probabilities in
 * [0,1], sentiment in [-1,1] — so 1e-6 is far below any change a human or a
 * chart could perceive, and far above float recomputation noise.
 */
export const SNAPSHOT_EPSILON = (() => {
  const raw = process.env.SNAPSHOT_CHANGE_EPSILON;
  if (raw === undefined || raw === "") return 1e-6;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) && n >= 0 ? n : 1e-6;
})();

/** Force a row at least this often even when nothing changed. */
export const SNAPSHOT_HEARTBEAT_MS = (() => {
  const raw = process.env.SNAPSHOT_HEARTBEAT_MS;
  if (raw === undefined || raw === "") return 24 * 60 * 60 * 1000;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 24 * 60 * 60 * 1000;
})();

/** Escape hatch: set to "0" to restore unconditional writes. */
export const writeOnChangeEnabled = () =>
  String(process.env.SNAPSHOT_WRITE_ON_CHANGE ?? "1") === "1";

/**
 * Are two snapshot values the same for our purposes?
 *
 * NULL IS NOT ZERO. A component that is absent (no market bound yet) and one
 * that is genuinely 0.0 are different facts, and collapsing them would hide the
 * moment a component starts reporting. So null matches only null.
 */
export function sameValue(a, b, eps = SNAPSHOT_EPSILON) {
  const aNull = a === null || a === undefined;
  const bNull = b === null || b === undefined;
  if (aNull || bNull) return aNull && bNull;
  if (typeof a === "number" && typeof b === "number") {
    if (Number.isNaN(a) || Number.isNaN(b)) return Number.isNaN(a) && Number.isNaN(b);
    return Math.abs(a - b) <= eps;
  }
  return a === b;
}

/**
 * Should this row be written?
 *
 * @param prev   the latest stored row for this key, or null/undefined if none
 * @param next   {field: value} of the columns that constitute a "change"
 * @param ts     the timestamp of the candidate row
 * @returns {write:boolean, reason:"first"|"changed"|"heartbeat"|"unchanged", field?:string}
 */
export function shouldWrite(prev, next, ts) {
  if (!prev) return { write: true, reason: "first" };
  for (const [field, value] of Object.entries(next)) {
    if (!sameValue(prev[field], value)) return { write: true, reason: "changed", field };
  }
  // Unchanged — but a flat series still needs points, and an absent row must not
  // be ambiguous between "steady" and "the scorer stopped".
  const age = Number(ts) - Number(prev.ts);
  if (Number.isFinite(age) && age >= SNAPSHOT_HEARTBEAT_MS) {
    return { write: true, reason: "heartbeat" };
  }
  return { write: false, reason: "unchanged" };
}

// ── Per-run accounting ─────────────────────────────────────────────────────
//
// Module-level so the DAL can count without every caller threading a stats
// object through. The cycle drains and logs it; draining resets, so two cycles
// never share a total.
const stats = new Map(); // table -> { written, skipped, heartbeat, first, changed }

const blank = () => ({ written: 0, skipped: 0, heartbeat: 0, first: 0, changed: 0 });

export function noteDecision(table, reason) {
  const s = stats.get(table) || blank();
  if (reason === "unchanged") s.skipped++;
  else { s.written++; s[reason] = (s[reason] || 0) + 1; }
  stats.set(table, s);
}

/**
 * Read and reset. Returns [{table, written, skipped, suppression}] — suppression
 * being the ratio DrJ wants to eyeball on day one: skipped per row written.
 */
export function drainSnapshotWriteStats() {
  const out = [];
  for (const [table, s] of stats) {
    out.push({
      table,
      ...s,
      total: s.written + s.skipped,
      suppression: s.written ? +(s.skipped / s.written).toFixed(1) : null,
      suppressedPct: (s.written + s.skipped)
        ? +(100 * s.skipped / (s.written + s.skipped)).toFixed(2)
        : 0,
    });
  }
  stats.clear();
  return out;
}

/** One line per table, or nothing when the run wrote nothing at all. */
export function formatSnapshotWriteStats(rows = drainSnapshotWriteStats()) {
  return rows.map(r =>
    `📉 ${r.table}: wrote ${r.written} (${r.changed} changed, ${r.heartbeat} heartbeat, ${r.first} new), ` +
    `skipped ${r.skipped} unchanged — ${r.suppressedPct}% suppressed, ${r.suppression ?? "n/a"}:1`
  );
}
