/**
 * NewsletterSignup — inline email capture. Posts to /api/newsletter/subscribe
 * with the user's current country + language + preferred topics so the digest
 * is pre-tailored on day one.
 *
 * Referral loop:
 *   • Reads ?ref=TOKEN from the URL (or localStorage scoop_ref_token set by a
 *     previous visit) and passes it as `referredBy` when subscribing.
 *   • On successful subscription, stores the returned token in localStorage as
 *     scoop_sub_token so the invite-friends card can build a referral URL.
 *   • Fetches live referral count from /api/newsletter/referral-stats.
 *
 * Used both as the "newsletter" HousePromo variant and anywhere else a CTA
 * needs an actual form (e.g. footer, settings panel).
 */
import { useState, useEffect } from "react";
import { Bell, Check, Copy, Loader2, Users } from "lucide-react";
import axios from "axios";
import { useNewsStore } from "../../store/newsStore";
import { useGeo } from "../../hooks/useGeo";
import { track } from "../../lib/track";

const SITE_URL = "https://scoopfeeds.com";
const TOKEN_KEY = "scoop_sub_token";
const REF_KEY   = "scoop_ref_token";

/** Extract ?ref= from current URL — called once on mount. */
function getRefFromUrl() {
  try {
    return new URLSearchParams(window.location.search).get("ref") || null;
  } catch { return null; }
}

/** Persist a referral origin token so it survives navigation before signup. */
function persistRefToken(token) {
  try { if (token) localStorage.setItem(REF_KEY, token); } catch {}
}

/** Read the source ref (someone referred this visitor). */
function readRefToken() {
  try { return localStorage.getItem(REF_KEY) || null; } catch { return null; }
}

/** Persist the subscriber's own token (returned by subscribe endpoint). */
function persistSubToken(token) {
  try { if (token) localStorage.setItem(TOKEN_KEY, token); } catch {}
}

/** Read the subscriber's own token (for building their referral link). */
export function readSubToken() {
  try { return localStorage.getItem(TOKEN_KEY) || null; } catch { return null; }
}

export default function NewsletterSignup({ compact = false, source = "inline" }) {
  const { language, preferredTopics } = useNewsStore();
  const { countryCode } = useGeo();
  const [email, setEmail]   = useState("");
  const [state, setState]   = useState("idle"); // idle | loading | done | error
  const [error, setError]   = useState("");
  const [subToken, setSubToken]         = useState(() => readSubToken());
  const [referralCount, setReferralCount] = useState(null);
  const [copied, setCopied]             = useState(false);

  // On mount: if URL has ?ref=, persist it so we can attribute on subscribe.
  useEffect(() => {
    const urlRef = getRefFromUrl();
    if (urlRef) persistRefToken(urlRef);
  }, []);

  // If user already subscribed (token in LS), fetch their referral count.
  useEffect(() => {
    if (!subToken) return;
    axios.get(`/api/newsletter/referral-stats?token=${subToken}`)
      .then((r) => { if (r.data?.success) setReferralCount(r.data.referrals); })
      .catch(() => {});
  }, [subToken]);

  const referralUrl = subToken ? `${SITE_URL}/?ref=${subToken}` : null;

  const copyLink = () => {
    if (!referralUrl) return;
    navigator.clipboard.writeText(referralUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
    track("referral_link_copied", { metadata: { source } });
  };

  const submit = async (e) => {
    e.preventDefault();
    if (state === "loading" || state === "done") return;
    const val = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
      setError("Please enter a valid email"); setState("error"); return;
    }
    setState("loading"); setError("");
    track("newsletter_signup_start", { metadata: { source } });
    try {
      const referredBy = readRefToken();
      const resp = await axios.post("/api/newsletter/subscribe", {
        email: val,
        countryCode,
        language,
        topics: preferredTopics,
        ...(referredBy ? { referredBy } : {}),
      });
      const token = resp.data?.token;
      if (token) {
        persistSubToken(token);
        setSubToken(token);
      }
      setState("done");
      track("newsletter_signup_complete", { metadata: { source, countryCode, language } });
    } catch (err) {
      setError(err?.response?.data?.error || "Something went wrong");
      setState("error");
    }
  };

  const wrapClass = compact
    ? "rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
    : "rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4";

  // Already subscribed — show invite-friends card instead of form.
  if (subToken && state !== "done") {
    return (
      <div className={wrapClass}>
        <div className="flex items-start gap-2.5 mb-3">
          <div className="w-9 h-9 rounded-full bg-electric-50 text-electric-600 flex items-center justify-center flex-shrink-0">
            <Users size={18} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold leading-tight">Invite friends</p>
            <p className="text-[11px] text-[var(--color-text-tertiary)] mt-0.5 leading-snug">
              {referralCount !== null && referralCount > 0
                ? `You've referred ${referralCount} reader${referralCount === 1 ? "" : "s"} 🎉`
                : "Share your personal invite link."}
            </p>
          </div>
        </div>
        <div className="flex gap-1.5">
          <div className="flex-1 min-w-0 px-2.5 py-1.5 text-xs rounded-lg border border-[var(--color-border)] bg-[var(--color-surface2)] text-[var(--color-text-secondary)] truncate select-all">
            {referralUrl}
          </div>
          <button
            onClick={copyLink}
            className="px-2.5 py-1.5 rounded-lg bg-electric-600 text-white text-xs font-semibold hover:opacity-90 flex items-center gap-1"
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
    );
  }

  if (state === "done") {
    return (
      <div className={wrapClass}>
        <div className="flex items-start gap-2.5 mb-3">
          <div className="w-9 h-9 rounded-full bg-emerald-50 text-emerald-500 flex items-center justify-center flex-shrink-0">
            <Check size={18} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold">Check your inbox</p>
            <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
              We sent a confirmation link to {email}.
            </p>
          </div>
        </div>
        {subToken && (
          <div className="mt-1">
            <p className="text-[11px] text-[var(--color-text-tertiary)] mb-1.5">
              While you wait — share Scoop with a friend:
            </p>
            <div className="flex gap-1.5">
              <div className="flex-1 min-w-0 px-2.5 py-1.5 text-xs rounded-lg border border-[var(--color-border)] bg-[var(--color-surface2)] text-[var(--color-text-secondary)] truncate select-all">
                {referralUrl}
              </div>
              <button
                onClick={copyLink}
                className="px-2.5 py-1.5 rounded-lg bg-electric-600 text-white text-xs font-semibold hover:opacity-90 flex items-center gap-1"
              >
                {copied ? <Check size={13} /> : <Copy size={13} />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={submit} className={wrapClass} id="newsletter">
      <div className="flex items-start gap-2.5 mb-2.5">
        <div className="w-9 h-9 rounded-full bg-electric-50 text-electric-600 flex items-center justify-center flex-shrink-0">
          <Bell size={18} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-bold leading-tight">Daily digest</p>
          <p className="text-[11px] text-[var(--color-text-tertiary)] mt-0.5 leading-snug">
            Top stories + markets, 7am your time.
          </p>
        </div>
      </div>
      <div className="flex gap-1.5">
        <input
          type="email"
          required
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={state === "loading"}
          className="flex-1 min-w-0 px-3 py-1.5 text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-surface2)] text-[var(--color-text)] placeholder-[var(--color-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-electric-500/40"
        />
        <button
          type="submit"
          disabled={state === "loading"}
          className="px-3 py-1.5 rounded-lg bg-electric-600 text-white text-sm font-semibold hover:opacity-90 disabled:opacity-60 flex items-center gap-1.5"
        >
          {state === "loading" ? <Loader2 size={14} className="animate-spin" /> : "Subscribe"}
        </button>
      </div>
      {state === "error" && (
        <p className="text-[11px] text-red-500 mt-1.5">{error}</p>
      )}
      <p className="text-[10px] text-[var(--color-text-tertiary)] mt-2">
        Free. Unsubscribe anytime from any email.
      </p>
    </form>
  );
}
