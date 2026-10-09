/**
 * llmBreaker — per-provider circuit breaker for HARD failures only.
 *
 * Hard = a failure no retry can fix (auth, billing, permission, dead model).
 * `threshold` consecutive hard failures open the breaker for `cooldownMs`;
 * while open, callers should route around the provider instead of paying a
 * doomed round trip on every call. After the cooldown one probe is allowed
 * (isOpen() returns false): a success closes the breaker, a hard failure
 * re-opens it for another cooldown. Transient failures neither count nor
 * reset — they are the retry loop's business, never the breaker's.
 *
 * Exactly one warn line per open and one per close, naming provider + error.
 */

export function createBreaker({
  threshold = 3,
  cooldownMs = 15 * 60_000,
  now = Date.now,
  logger,
} = {}) {
  const state = new Map(); // provider -> { fails, openUntil, everOpened }
  const get = (p) => {
    let s = state.get(p);
    if (!s) state.set(p, (s = { fails: 0, openUntil: 0, open: false }));
    return s;
  };

  return {
    isOpen(provider) {
      const s = get(provider);
      return s.open && now() < s.openUntil;
    },
    recordSuccess(provider) {
      const s = get(provider);
      const wasOpen = s.open;
      s.fails = 0; s.openUntil = 0; s.open = false;
      if (wasOpen) logger?.warn?.(`🔌 LLM breaker CLOSED for ${provider} — a probe call succeeded, routing resumed`);
    },
    recordHardFailure(provider, errorSummary = "") {
      const s = get(provider);
      s.fails += 1;
      if (s.open) { // failed probe after cooldown → re-open
        s.openUntil = now() + cooldownMs;
        logger?.warn?.(`🔌 LLM breaker RE-OPENED for ${provider} for ${Math.round(cooldownMs / 60000)}m — probe failed: ${errorSummary}`);
      } else if (s.fails >= threshold) {
        s.open = true;
        s.openUntil = now() + cooldownMs;
        logger?.warn?.(`🔌 LLM breaker OPEN for ${provider} for ${Math.round(cooldownMs / 60000)}m after ${s.fails} consecutive hard failures — last error: ${errorSummary}`);
      }
    },
    snapshot() {
      const t = now();
      return Object.fromEntries([...state].map(([p, s]) => [p, {
        open: s.open && t < s.openUntil, consecutiveHardFailures: s.fails,
        reopensInMs: s.open && t < s.openUntil ? s.openUntil - t : 0,
      }]));
    },
  };
}
