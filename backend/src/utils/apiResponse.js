import { ZodError } from "zod";

const IS_PROD = String(process.env.NODE_ENV || "").toLowerCase() === "production";

function requestIdFor(req) {
  return req?.requestId || null;
}

export function sendSuccess(res, payload = {}, status = 200) {
  return res.status(status).json(payload);
}

export function sendError(res, req, {
  status = 500,
  error = "Internal server error",
  code = null,
  details = undefined,
} = {}) {
  const body = {
    success: false,
    error,
    request_id: requestIdFor(req),
  };

  if (code) body.code = code;
  if (details !== undefined) body.details = details;

  return res.status(status).json(body);
}

export function sendValidationError(res, req, validationError) {
  const details = validationError instanceof ZodError
    ? validationError.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      }))
    : validationError;

  return sendError(res, req, {
    status: 400,
    error: "Invalid request",
    code: "validation_error",
    details,
  });
}

export function sendNotFound(res, req, error = "Not found") {
  return sendError(res, req, { status: 404, error, code: "not_found" });
}

export function sendUnauthorized(res, req, error = "Unauthorized") {
  return sendError(res, req, { status: 401, error, code: "unauthorized" });
}

export function sendForbidden(res, req, error = "Forbidden") {
  return sendError(res, req, { status: 403, error, code: "forbidden" });
}

export function sendTooManyRequests(res, req, error = "Too many requests") {
  return sendError(res, req, { status: 429, error, code: "rate_limited" });
}

export function sendInternalError(res, req, error = "Internal server error", err = null) {
  const details = !IS_PROD && err?.message ? [{ path: "", message: err.message }] : undefined;
  return sendError(res, req, { status: 500, error, code: "internal_error", details });
}
