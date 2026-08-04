/**
 * tokenCache.js — the one freshness test every credential cache shares.
 *
 * THE BUG THIS EXISTS TO STOP, which shipped in two clients at once:
 *
 *   let _cached = null;              // { accessToken, expiresAt }
 *   function _readCached() {
 *     if (_cached) return _cached;   // ← no expiry check
 *     ...disk path, which DOES check expiresAt > Date.now() + 60_000
 *   }
 *
 * Both halves of that function answer the same question and only one of them
 * consults the expiry. The disk path is correct, the refresh path computes
 * `expiresAt` correctly, and the value is simply never read for the in-memory
 * hit — so the moment a process refreshes a token once, it pins that token for
 * the life of the process.
 *
 * The symptom is nastier than a plain outage because it is SPLIT BY PROCESS
 * LIFETIME. A long-running worker 401s on every upload while the same code in a
 * throwaway container succeeds, because the container has an empty module scope
 * and takes the disk path. That reads as a credential problem — a revoked
 * token, a wrong scope, a bad refresh token — and none of those are it.
 *
 * YouTube access tokens last 1h and TikTok's 24h, so both clients were
 * guaranteed to hit this; it is latent rather than absent anywhere the token is
 * long-lived. The lifetime is what decides when you notice, not whether the
 * code is wrong.
 *
 * So the test lives here rather than being written out twice, and `now` is a
 * parameter so a test can move the clock without mocking Date.
 */

/**
 * How far ahead of true expiry a token stops counting as usable.
 *
 * A token that expires during the request that carries it has already failed.
 * An upload is minutes of ffmpeg followed by a resumable PUT, so the margin
 * covers the gap between the check and the last byte, not just the round trip.
 */
export const TOKEN_EXPIRY_SKEW_MS = 60_000;

/**
 * True when `tok` is usable for a call starting now.
 *
 * Requires BOTH an access token and a finite numeric expiry. A cache entry with
 * no `expiresAt` is treated as NOT fresh rather than as "never expires": a
 * missing expiry means nothing has established when the token dies, and the
 * failure mode of guessing wrong is an unattributable 401 much later. Clients
 * whose credentials genuinely carry no expiry (a Facebook page token) should
 * not route through here at all.
 *
 * @param {{accessToken?: string, expiresAt?: number}|null} tok
 * @param {{now?: number, skewMs?: number}} [opts]
 */
export function isTokenFresh(tok, { now = Date.now(), skewMs = TOKEN_EXPIRY_SKEW_MS } = {}) {
  if (!tok || typeof tok.accessToken !== "string" || !tok.accessToken) return false;
  if (!Number.isFinite(tok.expiresAt)) return false;
  return tok.expiresAt > now + skewMs;
}
