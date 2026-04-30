/**
 * PaywallCTA — subtle "Subscribe via Scoop" link rendered next to the source
 * badge on articles from paywalled outlets (NYT, WSJ, FT, Economist, Bloomberg).
 *
 * Returns null unless the backend has an affiliate URL configured for this
 * source — so the CTA simply doesn't appear until you sign up on Impact.com
 * for that outlet's program.
 */
import { usePaywallAffiliate } from "../../hooks/useAffiliate";

export default function PaywallCTA({ sourceName, className = "" }) {
  const entry = usePaywallAffiliate(sourceName);
  if (!entry?.url) return null;

  return (
    <a
      href={entry.url}
      target="_blank"
      rel="sponsored noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className={`text-[10px] font-semibold uppercase tracking-wider text-cobalt-600 hover:underline ${className}`}
      title={`Subscribe to ${sourceName} via Scoop`}
    >
      Subscribe
    </a>
  );
}
