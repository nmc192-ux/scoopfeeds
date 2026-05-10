/**
 * /api/csp-report — receives Content Security Policy violation reports.
 *
 * Browsers POST a violation report whenever a resource load (or inline
 * script execution) violates the CSP. We log them at warn level so
 * operators can review the violation feed and decide whether to add a
 * domain to the policy allowlist (Stage 2 prep) or investigate a
 * possible attack/misconfiguration.
 *
 * Two report formats are accepted:
 *   - Legacy: application/csp-report  → { "csp-report": { ... } }
 *   - Modern: application/reports+json → [{ type: "csp-violation", body: { ... } }]
 *
 * Rate-limited at 10/min/IP to prevent log flooding from misbehaving
 * clients or hostile traffic. Browsers fire reports without auth or
 * CSRF tokens, so this endpoint must remain unauthenticated.
 */

import { Router } from "express";
import express from "express";
import rateLimit from "express-rate-limit";
import { logger } from "../services/logger.js";

const router = Router();

const cspReportLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "csp_report_rate_limited" },
});

// Browsers send CSP reports with content types not covered by the
// global express.json (which defaults to application/json only).
const cspReportBodyParser = express.json({
  type: ["application/csp-report", "application/reports+json", "application/json"],
  limit: "32kb",
});

router.post("/", cspReportLimiter, cspReportBodyParser, (req, res) => {
  try {
    const body = req.body;

    if (Array.isArray(body)) {
      // Modern Reporting API format: array of report envelopes.
      for (const entry of body) {
        if (entry && entry.type === "csp-violation" && entry.body) {
          const data = {
            disposition:        entry.body.disposition,
            documentURL:        entry.body.documentURL,
            blockedURL:         entry.body.blockedURL,
            effectiveDirective: entry.body.effectiveDirective,
            originalPolicy:     truncate(entry.body.originalPolicy, 200),
            sourceFile:         entry.body.sourceFile,
            lineNumber:         entry.body.lineNumber,
            sample:             truncate(entry.body.sample, 80),
          };
          logger.warn("CSP violation (reports+json)", data);
          // Stdout fallback so Hostinger's lsnode panel sees this (lsnode captures
          // console.* but not winston.transports.Console's process.stdout.write).
          // Without this, CSP reports accumulate invisibly and Stage 2 enforcement
          // can't be evaluated. Pattern mirrors f2fc7f5 (integration boot log).
          console.warn(`[csp-report] CSP violation (reports+json): ${JSON.stringify(data)}`);
        }
      }
    } else if (body && body["csp-report"]) {
      // Legacy report-uri format.
      const r = body["csp-report"];
      const data = {
        documentURI:        r["document-uri"],
        blockedURI:         r["blocked-uri"],
        effectiveDirective: r["effective-directive"] || r["violated-directive"],
        originalPolicy:     truncate(r["original-policy"], 200),
        sourceFile:         r["source-file"],
        lineNumber:         r["line-number"],
        scriptSample:       truncate(r["script-sample"], 80),
      };
      logger.warn("CSP violation (csp-report)", data);
      console.warn(`[csp-report] CSP violation (csp-report): ${JSON.stringify(data)}`);
    } else {
      const data = {
        keys: body && typeof body === "object" ? Object.keys(body) : null,
      };
      logger.warn("CSP violation (unrecognized format)", data);
      console.warn(`[csp-report] CSP violation (unrecognized format): ${JSON.stringify(data)}`);
    }
  } catch (err) {
    logger.warn(`CSP report parse failed: ${err.message}`);
    console.error(`[csp-report] parse failed:`, err.message);
  }

  // Browsers don't read the response body for CSP reports; 204 is the
  // canonical answer.
  res.status(204).end();
});

function truncate(value, max) {
  if (typeof value !== "string") return value;
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

export default router;
