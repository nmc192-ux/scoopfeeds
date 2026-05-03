/**
 * wikipediaPageviewsFetcher — proxy for public attention.
 *
 * For an event we resolve a Wikipedia article (search → titles[0]), then pull
 * the per-day pageviews for the last `days` days via the metrics REST API.
 *
 * Volume is the relevant signal here (not polarity). We synthesize a weak
 * polarity = 0 with intensity proportional to recent vs baseline.
 *
 * Endpoints:
 *   https://en.wikipedia.org/w/api.php?action=opensearch&search=...&limit=1
 *   https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/all-agents/{title}/daily/{start}/{end}
 */

import { safeFetchJson } from "../social/baseSocialFetcher.js";

const SEARCH_ENDPOINT = "https://en.wikipedia.org/w/api.php";
const METRICS_HOST    = "https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/all-agents";
const UA              = "scoopfeeds/1.0 (+https://scoopfeeds.com)";

function fmtDay(d) {
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
}

export async function resolveTitle(query) {
  const params = new URLSearchParams({
    action:    "opensearch",
    format:    "json",
    search:    query,
    limit:     "1",
    namespace: "0",
  });
  const data = await safeFetchJson(`${SEARCH_ENDPOINT}?${params}`, {
    label:   "wiki-resolve",
    headers: { "User-Agent": UA },
  });
  // opensearch returns [query, [titles], [descriptions], [urls]]
  return Array.isArray(data) && Array.isArray(data[1]) ? (data[1][0] ?? null) : null;
}

export async function fetchPageviews(title, { days = 7 } = {}) {
  if (!title) return [];
  const end   = new Date();
  const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const enc   = encodeURIComponent(title.replace(/ /g, "_"));
  const url   = `${METRICS_HOST}/${enc}/daily/${fmtDay(start)}/${fmtDay(end)}`;
  const data  = await safeFetchJson(url, {
    label:   "wiki-pageviews",
    headers: { "User-Agent": UA },
  });
  return Array.isArray(data?.items) ? data.items.map(it => ({
    day:    it.timestamp.slice(0, 8),
    views:  it.views ?? 0,
  })) : [];
}

/** High-level: returns { title, recent, baseline, ratio, views_today } or null. */
export async function pageviewSignal(query) {
  const title = await resolveTitle(query);
  if (!title) return null;
  const series = await fetchPageviews(title, { days: 14 });
  if (!series.length) return { title, recent: 0, baseline: 0, ratio: 1, series: [] };
  const recent   = series.slice(-3).reduce((s, x) => s + x.views, 0) / 3;
  const baseline = series.slice(0, -3).reduce((s, x) => s + x.views, 0) / Math.max(1, series.length - 3);
  const ratio    = baseline > 0 ? recent / baseline : 1;
  return {
    title,
    recent:    Math.round(recent),
    baseline:  Math.round(baseline),
    ratio:     Number(ratio.toFixed(3)),
    series,
  };
}
