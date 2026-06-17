/**
 * Signal Service config — env-with-defaults (mirrors the app's process.env + default style).
 *
 * Deliberately NO credibility-floor here: filtering by a minimum score is an EDITORIAL
 * decision that lives in Studio, not in this neutral data-plane. This service serves raw
 * scored data; consumers decide what to do with it.
 */
function intEnv(name, def) {
  const v = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(v) ? v : def;
}

export const SIGNAL = {
  port:          intEnv("SIGNAL_PORT", 4100),
  bindHost:      process.env.SIGNAL_BIND_HOST || "127.0.0.1", // localhost by default
  defaultWindow: process.env.SIGNAL_DEFAULT_WINDOW || "48h",
  defaultLimit:  intEnv("SIGNAL_DEFAULT_LIMIT", 50),
  maxLimit:      intEnv("SIGNAL_MAX_LIMIT", 200),
};
