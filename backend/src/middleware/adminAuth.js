import crypto from "crypto";
export { requestIdMiddleware } from "../config/observability.js";
import { insertAdminAuditLog } from "../models/database.js";

const TEMP_QUERY_KEY_FLAG = "ALLOW_LEGACY_ADMIN_QUERY_KEY";
const PUBLIC_SCOOP_OPS_PREFIXES = [
  "/videos-gen/file/",
];

function setNoStoreHeaders(res) {
  res.setHeader("Cache-Control", "no-store, private, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");
}

function getConfiguredAdminToken() {
  const bearerToken = String(process.env.ADMIN_BEARER_TOKEN || "").trim();
  if (bearerToken) {
    return { token: bearerToken, source: "ADMIN_BEARER_TOKEN" };
  }

  const adminKey = String(process.env.ADMIN_KEY || "").trim();
  if (adminKey) {
    return { token: adminKey, source: "ADMIN_KEY" };
  }

  return null;
}

function safeEqual(leftValue, rightValue) {
  const left = Buffer.from(String(leftValue || ""), "utf8");
  const right = Buffer.from(String(rightValue || ""), "utf8");
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function extractBearerToken(req) {
  const header = req.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function isLegacyQueryKeyAllowed() {
  return String(process.env[TEMP_QUERY_KEY_FLAG] || "").toLowerCase() === "true";
}

function isPublicScoopOpsPath(pathname = "") {
  return PUBLIC_SCOOP_OPS_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function hashValue(value) {
  if (!value) return null;
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

export function adminAuth(req, res, next) {
  if (isPublicScoopOpsPath(req.path)) {
    return next();
  }

  setNoStoreHeaders(res);
  res.setHeader("Vary", "Authorization");

  const configured = getConfiguredAdminToken();
  if (!configured?.token) {
    return res.status(401).json({
      ok: false,
      error: "Admin access is not configured",
      requestId: req.requestId || null,
    });
  }

  const bearerToken = extractBearerToken(req);
  if (bearerToken && safeEqual(bearerToken, configured.token)) {
    req.adminAuth = {
      actorType: "bearer",
      tokenSource: configured.source,
    };
    return next();
  }

  if (isLegacyQueryKeyAllowed()) {
    const queryKey = String(req.query?.key || "").trim();
    if (queryKey && safeEqual(queryKey, configured.token)) {
      req.adminAuth = {
        actorType: "query_key_compat",
        tokenSource: configured.source,
      };
      res.setHeader("Warning", '299 - "Query-string admin auth is deprecated; use Authorization: Bearer"');
      return next();
    }
  }

  return res.status(401).json({
    ok: false,
    error: "Invalid admin token",
    requestId: req.requestId || null,
  });
}

export function adminAuditLogger(req, res, next) {
  if (isPublicScoopOpsPath(req.path) || !req.adminAuth) {
    return next();
  }

  const requestId = req.requestId || crypto.randomUUID();
  const createdAt = Date.now();
  const ipHash = hashValue(req.ip);
  const userAgentHash = hashValue(req.get("user-agent") || "");

  res.on("finish", () => {
    try {
      insertAdminAuditLog({
        method: req.method,
        path: req.originalUrl || req.path,
        requestId,
        actorType: req.adminAuth.actorType || "unknown",
        ipHash,
        userAgentHash,
        createdAt,
      });
    } catch {
      // Avoid breaking admin responses if audit persistence fails.
    }
  });

  next();
}
