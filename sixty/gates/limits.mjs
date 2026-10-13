/**
 * limits.mjs — what the runner does with a `rate_limit_event`. Hard gate, outside the agents.
 *
 * DrJ, 13 Oct 2026: `allowed_warning` is only a heads-up ("you are getting close"), not a limit.
 * The 2 Oct film was killed on it. Stop ONLY on `rejected` or when the session starts drawing paid
 * overage; warnings are logged. Every other stop signal (a limit message in a result error, an API
 * retry on a limit, stderr, assistant text) is unchanged in run.mjs.
 *
 *   limitAction(info) -> { action: "stop" | "warn" | "ok", why }
 */
export function limitAction(info) {
  const r = info || {};
  const where = `type=${r.rateLimitType ?? "?"} resets=${r.resetsAt ?? "?"}`;
  if (r.isUsingOverage) return { action: "stop", why: "session started drawing paid overage (extra usage) — not allowed without DrJ" };
  if (r.status === "rejected") return { action: "stop", why: `rate_limit_event status=rejected ${where}` };
  if (!r.status || r.status === "allowed") return { action: "ok", why: "" };
  return { action: "warn", why: `rate_limit_event status=${r.status} ${where}` };   // allowed_warning, or a status we do not know: log, do not stop
}
