/**
 * fredFetcher — Phase 5 macro layer: FRED (St. Louis Fed) curated series.
 *
 * Pulls a small set of high-signal macro indicators every 6 hours (most
 * are daily-or-slower). Free API; requires FRED_API_KEY (sign up at
 * fred.stlouisfed.org/docs/api/api_key.html — instant). When the key is
 * absent, syncFredCycle returns { skipped: 'no_key' } so the cron stays
 * silent in dev and on cold deploys.
 *
 * Endpoint: https://api.stlouisfed.org/fred/series/observations
 */

import { getDb } from "../../../models/database.js";
import { logger } from "../../../services/logger.js";

const ENDPOINT = "https://api.stlouisfed.org/fred/series/observations";
const TIMEOUT_MS = 12_000;

// Curated set: covers the rate / inflation / labour / commodity / vol /
// FX / money-supply / GDP families. Override with FRED_SERIES env var.
const DEFAULT_SERIES = [
  { id: "DFF",         label: "Federal Funds Rate",       units: "%",   freq: "daily"     },
  { id: "DGS10",       label: "10-Year Treasury Yield",   units: "%",   freq: "daily"     },
  { id: "DGS2",        label: "2-Year Treasury Yield",    units: "%",   freq: "daily"     },
  { id: "T10Y2Y",      label: "10Y-2Y Yield Curve",       units: "%",   freq: "daily"     },
  { id: "CPIAUCSL",    label: "CPI (All Items)",          units: "Index 1982-84=100", freq: "monthly" },
  { id: "UNRATE",      label: "Unemployment Rate",        units: "%",   freq: "monthly"   },
  { id: "DCOILWTICO",  label: "WTI Crude Oil",            units: "USD/bbl", freq: "daily" },
  { id: "VIXCLS",      label: "VIX (Volatility Index)",   units: "Index", freq: "daily"   },
  { id: "DEXUSEU",     label: "USD / EUR",                units: "FX",  freq: "daily"     },
  { id: "M2SL",        label: "M2 Money Supply",          units: "USD bn", freq: "monthly"},
];

function loadSeries() {
  const env = (process.env.FRED_SERIES || "").trim();
  if (!env) return DEFAULT_SERIES;
  // "DFF:Federal Funds Rate:%:daily,DGS10:..." (4 fields per series, ":" separated)
  return env.split(",").map(s => {
    const [id, label, units = "", freq = ""] = s.split(":").map(t => t.trim());
    return id && label ? { id, label, units, freq } : null;
  }).filter(Boolean);
}

async function fetchSeries(id, key) {
  const params = new URLSearchParams({
    series_id: id, api_key: key, file_type: "json",
    sort_order: "desc", limit: "2",
  });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`${ENDPOINT}?${params}`, { signal: ctrl.signal });
    if (!r.ok) { logger.warn(`fred ${id}: HTTP ${r.status}`); return null; }
    const data = await r.json();
    const obs = (data?.observations || []).filter(o => o.value !== "." && o.value != null);
    if (!obs.length) return null;
    return {
      latest: { date: obs[0].date, value: parseFloat(obs[0].value) },
      previous: obs[1] ? { date: obs[1].date, value: parseFloat(obs[1].value) } : null,
    };
  } catch (e) {
    if (e.name !== "AbortError") logger.warn(`fred ${id}: ${e.message}`);
    return null;
  } finally { clearTimeout(timer); }
}

export async function syncFredCycle({ series = loadSeries() } = {}) {
  const key = process.env.FRED_API_KEY;
  if (!key) return { skipped: "no_key" };

  const db = getDb();
  const upsert = db.prepare(`
    INSERT INTO macro_indicators
      (provider, series_id, label, units, frequency, observation_date,
       value, previous_value, previous_date, delta_pct, raw_meta, updated_at)
    VALUES ('fred', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(provider, series_id) DO UPDATE SET
      label            = excluded.label,
      units            = excluded.units,
      frequency        = excluded.frequency,
      observation_date = excluded.observation_date,
      value            = excluded.value,
      previous_value   = excluded.previous_value,
      previous_date    = excluded.previous_date,
      delta_pct        = excluded.delta_pct,
      raw_meta         = excluded.raw_meta,
      updated_at       = excluded.updated_at
  `);

  const now = Date.now();
  let updated = 0, skipped = 0;
  for (const s of series) {
    const out = await fetchSeries(s.id, key);
    if (!out) { skipped++; continue; }
    const prev = out.previous?.value ?? null;
    const deltaPct = (prev != null && prev !== 0)
      ? Number((((out.latest.value - prev) / Math.abs(prev)) * 100).toFixed(3))
      : null;
    const meta = JSON.stringify({ url: `https://fred.stlouisfed.org/series/${s.id}` });
    try {
      upsert.run(
        s.id, s.label, s.units || null, s.freq || null,
        out.latest.date, out.latest.value,
        prev, out.previous?.date ?? null,
        deltaPct, meta, now,
      );
      updated++;
    } catch (err) {
      logger.warn(`fred upsert ${s.id}: ${err.message}`);
      skipped++;
    }
  }

  if (updated) logger.info(`📈 FRED: ${series.length} series, ${updated} updated, ${skipped} skipped`);
  return { attempted: series.length, updated, skipped };
}
