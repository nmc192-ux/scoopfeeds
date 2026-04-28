/**
 * TipJar — "Support Scoop" Ko-fi donation button.
 *
 * Clicking any amount opens the Ko-fi page in a new tab. Ko-fi handles
 * payment collection (card, PayPal, Stripe) without requiring a US entity.
 *
 * Only renders when publicConfig.stripe.configured is true (reused as a
 * generic "tip jar enabled" flag — rename to kofi.configured in a future
 * cleanup pass).
 *
 * Props:
 *   compact — render a single smaller CTA (for in-article use)
 */
import { Heart } from "lucide-react";
import { track } from "../../lib/track";

const DEFAULT_KO_FI_URL = "https://ko-fi.com/drjahanzeb";
const AMOUNTS           = [3, 5, 10];

export default function TipJar({ compact = false, kofiUrl = DEFAULT_KO_FI_URL }) {
  function openKofi(amount) {
    track("tip_click", { metadata: { amount, platform: "kofi" } });
    // Ko-fi accepts ?amount=N as a pre-filled suggestion on the tip page.
    window.open(`${kofiUrl}?amount=${amount}`, "_blank", "noopener,noreferrer");
  }
  if (compact) {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <Heart size={14} className="text-red-400 flex-shrink-0" />
        <span className="text-xs text-[var(--color-text-secondary)]">Support Scoop:</span>
        {AMOUNTS.map((a) => (
          <button
            key={a}
            onClick={() => openKofi(a)}
            className="px-2.5 py-1 rounded-md bg-[var(--color-surface2)] border border-[var(--color-border)] text-xs font-semibold hover:bg-red-50 hover:border-red-300 hover:text-red-600 dark:hover:bg-red-900/20 transition-colors"
          >
            ${a}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="flex items-start gap-2.5 mb-3">
        <div className="w-9 h-9 rounded-full bg-red-500/10 text-red-500 flex items-center justify-center flex-shrink-0">
          <Heart size={18} />
        </div>
        <div>
          <p className="text-sm font-bold leading-tight">Support Scoop ☕</p>
          <p className="text-[11px] text-[var(--color-text-tertiary)] mt-0.5 leading-snug">
            Independent news curation, free forever. One-time tip.
          </p>
        </div>
      </div>

      <div className="flex gap-2">
        {AMOUNTS.map((a) => (
          <button
            key={a}
            onClick={() => openKofi(a)}
            className="flex-1 py-2 rounded-lg border border-[var(--color-border)] text-sm font-semibold
                       hover:bg-red-50 hover:border-red-300 hover:text-red-600
                       dark:hover:bg-red-900/20
                       transition-colors"
          >
            ${a}
          </button>
        ))}
      </div>

      <p className="text-[10px] text-[var(--color-text-tertiary)] mt-2 text-center">
        Via Ko-fi — card, PayPal or Stripe. No account needed.
      </p>
    </div>
  );
}
