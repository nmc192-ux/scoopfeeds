/**
 * worldBankFetcher — Phase 5 macro layer: World Bank Open Data.
 *
 * No API key required. Pulls a curated set of country-level development
 * indicators (GDP growth, inflation, unemployment, HDI proxies). Stores
 * the latest available year's value into macro_indicators with provider='wb'.
 *
 * Endpoint: https://api.worldbank.org/v2/country/{country}/indicator/{id}?format=json
 *
 * Default countries: WLD (World), USA, CHN, IND, EUU (EU). Configurable
 * via WB_COUNTRIES env. Series + countries default to a small high-signal set.
 */

import { getDb } from "../../../models/database.js";
import { logger } from "../../../services/logger.js";

const TIMEOUT_MS = 12_000;

// World Bank indicator IDs and their human labels.
const DEFAULT_SERIES = [
  { id: "NY.GDP.MKTP.KD.ZG", label: "GDP growth (annual %)",          units: "%",   freq: "yearly" },
  { id: "FP.CPI.TOTL.ZG",    label: "Inflation, consumer prices",     units: "%",   freq: "yearly" },
  { id: "SL.UEM.TOTL.ZS",    label: "Unemployment rate",              units: "%",   freq: "yearly" },
  { id: "NE.EXP.GNFS.ZS",    label: "Exports of goods+services",      units: "% GDP", freq: "yearly" },
  { id: "GC.DOD.TOTL.GD.ZS", label: "Central govt debt",              units: "% GDP", freq: "yearly" },
];

// Countries to track per series. WLD = World aggregate.
const DEFAULT_COUNTRIES = ["WLD", "USA", "CHN", "IND", "EUU"];

function loadConfig() {
  const seriesEnv = (process.env.WB_SERIES || "").trim();
  const countriesEnv = (process.env.WB_COUNTRIES || "").trim();
  const series = seriesEnv
    ? seriesEnv.split(",").map(s => {
        const [id, label, units = "", freq = "yearly"] = s.split(":").map(t => t.trim());
        return id && label ? { id, label, units, freq } : null;
      }).filter(Boolean)
    : DEFAULT_SERIES;
  const countries = countriesEnv ? countriesEnv.split(",").map(s => s.trim()).filter(Boolean) : DEFAULT_COUNTRIES;
  return { series, countries };
}

async function fetchWb(country, indicator) {
  // mrnev=2 returns the 2 most recent non-empty observations (latest + previous).
  // per_page is ignored when mrnev is set; documented in WB API v2 reference.
  const url = `https://api.worldbank.org/v2/country/${country}/indicator/${indicator}?format=json&mrnev=2`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) { logger.warn(`wb ${country}/${indicator}: HTTP ${r.status}`); return null; }
    const data = await r.json();
    // World Bank returns [meta, [observations]]
    if (!Array.isArray(data) || data.length < 2 || !Array.isArray(data[1])) return null;
    const obs = data[1].filter(o => o.value != null);
    if (!obs.length) return null;
    const latest = obs[0];
    const previous = obs[1] || null;
    return {
      latest:   { date: latest.date, value: parseFloat(latest.value) },
      previous: previous ? { date: previous.date, value: parseFloat(previous.value) } : null,
      country_name: latest.country?.value,
    };
  } catch (e) {
    if (e.name !== "AbortError") logger.warn(`wb ${country}/${indicator}: ${e.message}`);
    return null;
  } finally { clearTimeout(timer); }
}

export async function syncWorldBankCycle({ series, countries } = loadConfig()) {
  const cfg = { series: series ?? DEFAULT_SERIES, countries: countries ?? DEFAULT_COUNTRIES };
  const db = getDb();
  const upsert = db.prepare(`
    INSERT INTO macro_indicators
      (provider, series_id, label, units, frequency, observation_date,
       value, previous_value, previous_date, delta_pct, raw_meta, updated_at)
    VALUES ('wb', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
  let updated = 0, attempted = 0, skipped = 0;
  for (const c of cfg.countries) {
    for (const s of cfg.series) {
      attempted++;
      const out = await fetchWb(c, s.id);
      if (!out) { skipped++; continue; }
      const prev = out.previous?.value ?? null;
      const deltaPct = (prev != null && prev !== 0)
        ? Number((((out.latest.value - prev) / Math.abs(prev)) * 100).toFixed(3))
        : null;
      // Composite series_id ties country to indicator — keeps the unique
      // PK constraint clean across multi-country pulls.
      const seriesId = `${s.id}:${c}`;
      const label    = `${s.label} — ${out.country_name || c}`;
      const meta = JSON.stringify({
        country: c,
        country_name: out.country_name,
        indicator_id: s.id,
        url: `https://data.worldbank.org/indicator/${s.id}?locations=${c}`,
      });
      try {
        upsert.run(
          seriesId, label, s.units || null, s.freq || null,
          out.latest.date, out.latest.value,
          prev, out.previous?.date ?? null,
          deltaPct, meta, now,
        );
        updated++;
      } catch (err) {
        logger.warn(`wb upsert ${seriesId}: ${err.message}`);
        skipped++;
      }
    }
  }

  if (updated) logger.info(`🌐 World Bank: ${attempted} attempted, ${updated} updated, ${skipped} skipped`);
  return { attempted, updated, skipped };
}
