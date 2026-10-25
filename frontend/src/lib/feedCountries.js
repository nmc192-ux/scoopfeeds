/**
 * feedCountries — the countries the v2 country control offers (#190).
 *
 * Mirrors COUNTRY_REGIONS in backend/src/config/sources.js (the countries the
 * site has a region mapping for), plus "Other / worldwide". WORLDWIDE sends no
 * `country` param at all, so the reader gets the plain prominence order.
 */
export const WORLDWIDE = "WW";

export const FEED_COUNTRIES = [
  { code: "US", name: "United States" },
  { code: "GB", name: "United Kingdom" },
  { code: "PK", name: "Pakistan" },
  { code: "IN", name: "India" },
  { code: "CA", name: "Canada" },
  { code: "AU", name: "Australia" },
  { code: "AE", name: "UAE" },
  { code: "SA", name: "Saudi Arabia" },
  { code: WORLDWIDE, name: "Other / worldwide" },
];

/** The ?country= value for a resolved geo, or undefined for worldwide / unknown shape. */
export function feedCountryParam(countryCode) {
  const cc = String(countryCode || "").toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc) || cc === WORLDWIDE) return undefined;
  return cc;
}

/** Display name for a code: the curated list first, then Intl, then the code. */
export function countryName(code, fallback) {
  const hit = FEED_COUNTRIES.find((c) => c.code === code);
  if (hit) return hit.name;
  if (fallback) return fallback;
  try { return new Intl.DisplayNames(["en"], { type: "region" }).of(code) || code; } catch { return code; }
}
