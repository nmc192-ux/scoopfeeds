/**
 * ammEngine — Polymarket-style constant-product (x*y=k) AMM for binary
 * outcome markets.
 *
 * Pool holds YES + NO shares. yes_price = no_pool / (yes_pool + no_pool).
 *
 * BUY YES with `amount` (in synthetic dollars):
 *   1. Mint `amount` YES + `amount` NO from the deposit (a complete set
 *      always sums to $1 since exactly one side resolves to $1).
 *   2. Sell the freshly-minted NO shares into the pool: pool's no_pool
 *      grows by `amount`, yes_pool shrinks to k/new_no_pool. We claim
 *      the YES shares released by the swap.
 *   3. Total YES received = amount (from mint) + (yes_pool - new_yes_pool).
 *
 * Result: avg_price ∈ (yes_price_before, 1] strictly, and 1 share resolves
 * to $1 if YES wins. Buying NO is symmetric.
 *
 * SELL is just the reverse — handled by the trade route, not here.
 *
 * No external deps; pure functions; safe for UI quote previews.
 */

const MIN_AMOUNT = 0.01;     // floor on a single trade
const MAX_SLIPPAGE = 0.50;   // refuse trades that would push avg_price beyond 50% from current

export function quote({ yes_pool, no_pool, side, amount }) {
  if (amount < MIN_AMOUNT) throw new Error(`amount below floor (${MIN_AMOUNT})`);
  if (yes_pool <= 0 || no_pool <= 0) throw new Error("invalid pool state");
  if (side !== "yes" && side !== "no") throw new Error("side must be yes|no");

  const k = yes_pool * no_pool;
  const yes_price_before = no_pool / (yes_pool + no_pool);

  let new_yes_pool, new_no_pool, swap_shares;
  if (side === "yes") {
    // Mint: pool gains nothing (the user holds the minted YES + NO).
    // Then user sells minted NO into pool: no_pool += amount.
    new_no_pool  = no_pool + amount;
    new_yes_pool = k / new_no_pool;
    swap_shares  = yes_pool - new_yes_pool;
  } else {
    new_yes_pool = yes_pool + amount;
    new_no_pool  = k / new_yes_pool;
    swap_shares  = no_pool - new_no_pool;
  }

  // Total shares = mint (= amount) + swap winnings.
  const shares = amount + swap_shares;
  if (!Number.isFinite(shares) || shares <= 0) throw new Error("trade produces no shares");

  const avg_price = amount / shares;
  const yes_price_after = new_no_pool / (new_yes_pool + new_no_pool);
  // Slippage: how much worse is our avg_price than the pre-trade fair price?
  const ideal = side === "yes" ? yes_price_before : (1 - yes_price_before);
  const slip = ideal > 0 ? Math.abs(avg_price - ideal) / ideal : 0;
  if (slip > MAX_SLIPPAGE) throw new Error(`slippage ${(slip * 100).toFixed(1)}% exceeds max ${MAX_SLIPPAGE * 100}%`);

  return {
    side,
    amount,
    shares:               Number(shares.toFixed(6)),
    avg_price:            Number(avg_price.toFixed(4)),
    yes_price_before:     Number(yes_price_before.toFixed(4)),
    yes_price_after:      Number(yes_price_after.toFixed(4)),
    new_yes_pool:         Number(new_yes_pool.toFixed(6)),
    new_no_pool:          Number(new_no_pool.toFixed(6)),
    slippage:             Number(slip.toFixed(4)),
  };
}

/**
 * Resolve a market — returns payout per share for each side.
 * yes_outcome: winners take 1.0 per share, losers take 0.
 * no_outcome:  symmetric.
 * cancel:      everyone gets refunded at avg cost (handled by trade-level reverse).
 */
export function payoutPerShare(outcome, side) {
  if (outcome === "cancel") return null;       // refund handled out-of-band
  if (outcome === side) return 1.0;
  return 0.0;
}
