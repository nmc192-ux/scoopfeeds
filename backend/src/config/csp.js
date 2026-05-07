/**
 * Content Security Policy — Sprint 2 Issue 2.2.
 *
 * Single source of truth for CSP directives. Used by:
 *   - server.js: emits Content-Security-Policy-Report-Only header on
 *     non-/api/ responses (Stage 1, this commit).
 *   - server.js: emits Reporting-Endpoints header on the same responses.
 *
 * Stage 1 (current): report-only. Violations log but don't block.
 * Stage 2 (future): switch the emission header from
 *   Content-Security-Policy-Report-Only to Content-Security-Policy.
 *   That switch — plus likely tightening based on observed reports —
 *   is the only difference between Stage 1 and Stage 2.
 *
 * Allowlists are derived from the production resource inventory of
 * frontend/index.html and backend/src/routes/seo.js (server-rendered
 * HTML pages). Any new third-party resource added in the future should
 * be reflected here.
 */

/**
 * Directive-keyed object. Order doesn't matter; values are arrays of
 * source expressions.
 */
export const CSP_DIRECTIVES = {
  "default-src": ["'self'"],

  // Scripts. 'unsafe-inline' is a Stage 1 compromise to avoid drowning
  // the violation log with index.html JSON-LD + gtag init blocks and
  // seo.js SSR'd inline scripts. Stage 2 prerequisite: refactor those
  // to external files or nonced inline blocks, then drop 'unsafe-inline'.
  "script-src": [
    "'self'", "'unsafe-inline'",
    "https://www.googletagmanager.com",
    "https://pagead2.googlesyndication.com",
    "https://googleads.g.doubleclick.net",
    "https://*.adtrafficquality.google",
    "https://www.google-analytics.com",
    "https://s.skimresources.com",
    "https://www.gstatic.com",
    "https://js.stripe.com",
    "https://m.stripe.com",
  ],

  "script-src-elem": [
    "'self'", "'unsafe-inline'",
    "https://www.googletagmanager.com",
    "https://pagead2.googlesyndication.com",
    "https://googleads.g.doubleclick.net",
    "https://*.adtrafficquality.google",
    "https://www.google-analytics.com",
    "https://s.skimresources.com",
    "https://www.gstatic.com",
    "https://js.stripe.com",
    "https://m.stripe.com",
  ],

  // Styles. 'unsafe-inline' is effectively permanent for React (inline
  // style props) and Tailwind atomic-class injection. Google Fonts CSS
  // lives at fonts.googleapis.com.
  "style-src": [
    "'self'", "'unsafe-inline'",
    "https://fonts.googleapis.com",
  ],

  // Fonts. data: covers any base64-encoded fallback font payload.
  "font-src": [
    "'self'",
    "https://fonts.gstatic.com",
    "data:",
  ],

  // Images. Permissive https: is intentional — RSS-feed publishers'
  // CDN domains are too numerous and dynamic to enumerate. Tightening
  // would force constant maintenance and break articles whose images
  // come from new sources. data: covers inline base64 thumbnails;
  // blob: covers client-generated previews.
  "img-src": [
    "'self'",
    "https:",
    "data:",
    "blob:",
  ],

  // Audio/video. Same heterogeneity rationale as images.
  "media-src": [
    "'self'",
    "https:",
    "blob:",
  ],

  // XHR / fetch / SSE / WebSocket destinations.
  "connect-src": [
    "'self'",
    "https://www.google-analytics.com",
    "https://*.googletagmanager.com",
    "https://pagead2.googlesyndication.com",
    "https://googleads.g.doubleclick.net",
    "https://*.g.doubleclick.net",
    "https://*.adtrafficquality.google",
    "https://*.skimresources.com",
    "https://api.stripe.com",
    "https://m.stripe.com",
  ],

  // Iframes. YouTube + nocookie variant for live TV / video embeds,
  // AdSense iframe rendering, Stripe Checkout / 3D-Secure flow.
  "frame-src": [
    "'self'",
    "https://www.youtube.com",
    "https://www.youtube-nocookie.com",
    "https://googleads.g.doubleclick.net",
    "https://tpc.googlesyndication.com",
    "https://*.adtrafficquality.google",
    "https://www.google.com",
    "https://js.stripe.com",
    "https://hooks.stripe.com",
    "https://checkout.stripe.com",
  ],

  // Web/service workers (frontend/src/main.jsx registers /sw.js).
  "worker-src": ["'self'"],

  // PWA manifest (frontend/public/manifest.json, declared in index.html).
  "manifest-src": ["'self'"],

  // Disable legacy plugins (Flash, Java applets) entirely.
  "object-src": ["'none'"],

  // Prevent <base href="..."> injection attacks.
  "base-uri": ["'self'"],

  // Form submission targets. checkout.stripe.com for hosted Checkout.
  "form-action": ["'self'", "https://checkout.stripe.com"],

  // Embedding allowlist. Note: routes/embed.js sets a per-route
  // override of frame-ancestors * for public embed iframes; that
  // per-route response header takes precedence over this default.
  "frame-ancestors": ["'self'"],

  // Reporting. report-uri is the legacy mechanism (broad browser
  // support); report-to is the modern Reporting API named endpoint
  // configured via the separate Reporting-Endpoints HTTP header
  // (set in server.js).
  "report-uri": ["/api/csp-report"],
  "report-to": ["csp-endpoint"],
};

/**
 * Format the directives object as a CSP header value string.
 *
 * @param {object} directives — defaults to CSP_DIRECTIVES
 * @returns {string} header value, semicolon-separated
 */
export function formatCspHeader(directives = CSP_DIRECTIVES) {
  return Object.entries(directives)
    .map(([directive, sources]) => `${directive} ${sources.join(" ")}`)
    .join("; ");
}

/**
 * Reporting-Endpoints HTTP header value (modern Reporting API).
 * Pairs with the `report-to csp-endpoint` directive in CSP_DIRECTIVES.
 */
export const REPORTING_ENDPOINTS_HEADER = 'csp-endpoint="/api/csp-report"';

/**
 * Pre-formatted Stage 1 header value, computed once at module load.
 */
export const CSP_HEADER_VALUE = formatCspHeader();
