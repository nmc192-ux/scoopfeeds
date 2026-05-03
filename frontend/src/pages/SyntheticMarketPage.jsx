/**
 * SyntheticMarketPage — /synthetic/:id — single market with trade UI.
 *
 * Reads market state + last trades. Authed users can trade $X play-money
 * on YES or NO. Live AMM quote previews as the user adjusts amount.
 * Shows recent trades as a price-history feed.
 */
import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { ChevronLeft, Trophy, ShieldCheck, LogIn } from "lucide-react";
import { useSyntheticMarket, useTradeQuote, useExecuteTrade } from "../hooks/useSyntheticMarkets";
import ProbabilityBar from "../components/predictions/ProbabilityBar";
import { COPY } from "../lib/copyGuide";
import { useT } from "../lib/i18n";

const PRESET_AMOUNTS = [5, 10, 25, 100];

export default function SyntheticMarketPage() {
  const { t } = useT();
  const { id } = useParams();
  const { data, isLoading, error } = useSyntheticMarket(id);
  const [side, setSide] = useState("yes");
  const [amount, setAmount] = useState(10);
  const quote = useTradeQuote(id);
  const execute = useExecuteTrade(id);
  const [traded, setTraded] = useState(null);

  // Live quote preview: re-quote on side/amount change with debounce.
  useEffect(() => {
    if (!data?.market || data.market.resolved) return;
    const t = setTimeout(() => quote.mutate({ side, amount: Number(amount) }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [side, amount, data?.market?.id]);

  if (isLoading) return <div className="max-w-3xl mx-auto px-4 py-10"><div className="h-32 bg-[var(--color-surface-2)] animate-pulse rounded" /></div>;
  if (error || !data?.market) return (
    <div className="max-w-3xl mx-auto px-4 py-16 text-center text-sm text-[var(--color-text-secondary)]">
      Market not found. <Link to="/synthetic" className="text-[var(--color-accent)] underline">All synthetic markets</Link>
    </div>
  );

  const m = data.market;
  const trades = data.trades ?? [];
  const isOpen = !m.resolved && (!m.end_date || m.end_date > Date.now());
  const ends = m.end_date ? new Date(m.end_date).toISOString().slice(0, 10) : null;

  const onTrade = async () => {
    setTraded(null);
    try {
      const r = await execute.mutateAsync({ side, amount: Number(amount) });
      setTraded({ ok: true, ...r });
    } catch (err) {
      const status = err?.response?.status;
      const msg = err?.response?.data?.error || err?.message || "Trade failed";
      setTraded({ ok: false, status, msg });
    }
  };

  const isAuthError = traded?.ok === false && traded?.status === 401;

  return (
    <article className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
      <Link to="/synthetic" className="inline-flex items-center gap-1 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text)] mb-5">
        <ChevronLeft size={13} /> All synthetic markets
      </Link>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-[var(--color-accent)]/10 text-[var(--color-accent)]">
          <ShieldCheck size={10} className="inline mr-1" /> Play money
        </span>
        {m.resolved && <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-full bg-gray-200 dark:bg-gray-800">Resolved · {m.outcome}</span>}
      </div>

      <h1 className="font-editorial italic text-2xl leading-tight text-[var(--color-text)] mb-3">{m.question}</h1>
      {m.description && <p className="text-sm text-[var(--color-text-secondary)] mb-4">{m.description}</p>}

      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 mb-4">
        <ProbabilityBar yesPrice={m.yes_price} noPrice={1 - m.yes_price} size="lg" showLabel={true} showDisclaimer={false} />
        <div className="flex items-center gap-3 mt-2 text-[10px] text-[var(--color-text-secondary)] tabular-nums">
          <span>Vol ${Math.round(m.total_volume).toLocaleString()}</span>
          {ends && <span>· Ends {ends}</span>}
          {m.event_id && <Link to={`/events/`} className="ml-auto text-[var(--color-accent)] hover:underline">Bound event ↗</Link>}
        </div>
      </div>

      {/* Trade UI */}
      {isOpen ? (
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 mb-4">
          <h3 className="text-sm font-semibold mb-3">Place a trade</h3>
          <div className="flex gap-2 mb-3">
            {["yes", "no"].map(s => (
              <button
                key={s}
                onClick={() => setSide(s)}
                className={`flex-1 text-sm font-semibold py-2 rounded uppercase ${
                  side === s
                    ? (s === "yes" ? "bg-emerald-500 text-white" : "bg-red-500 text-white")
                    : "border border-[var(--color-border)] text-[var(--color-text-secondary)]"
                }`}
              >
                Buy {s}
              </button>
            ))}
          </div>
          <div className="flex gap-2 mb-3 flex-wrap">
            {PRESET_AMOUNTS.map(a => (
              <button
                key={a}
                onClick={() => setAmount(a)}
                className={`text-xs px-3 py-1 rounded-full border ${
                  amount === a
                    ? "bg-[var(--color-accent)] text-white border-[var(--color-accent)]"
                    : "border-[var(--color-border)] text-[var(--color-text-secondary)]"
                }`}
              >${a}</button>
            ))}
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(Math.max(0.01, Number(e.target.value) || 0))}
              className="w-24 px-3 py-1 text-xs rounded border border-[var(--color-border)] bg-[var(--color-surface)] tabular-nums"
            />
          </div>

          {/* Live quote */}
          {quote.data?.quote ? (
            <div className="text-xs space-y-1 text-[var(--color-text-secondary)] tabular-nums mb-3 p-2 bg-[var(--color-surface-2)] rounded">
              <div>You receive: <strong className="text-[var(--color-text)]">{quote.data.quote.shares.toFixed(2)} {side.toUpperCase()} shares</strong></div>
              <div>Avg price: <strong className="text-[var(--color-text)]">${quote.data.quote.avg_price.toFixed(3)}</strong> · Slippage {(quote.data.quote.slippage * 100).toFixed(2)}%</div>
              <div>YES price moves to <strong className="text-[var(--color-text)]">{(quote.data.quote.yes_price_after * 100).toFixed(1)}%</strong></div>
            </div>
          ) : quote.isError ? (
            <p className="text-xs text-red-500 mb-3">Quote failed: {quote.error?.response?.data?.error || quote.error?.message}</p>
          ) : null}

          <button
            onClick={onTrade}
            disabled={execute.isPending || !quote.data?.quote}
            className="w-full text-sm font-semibold py-2 rounded bg-[var(--color-accent)] text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {execute.isPending ? "Submitting…" : `Buy ${side.toUpperCase()} for $${amount}`}
          </button>

          {traded?.ok && (
            <p className="text-xs text-emerald-600 mt-2">✓ Bought {traded.trade.shares.toFixed(2)} {traded.trade.side.toUpperCase()} shares at avg ${traded.trade.avg_price.toFixed(3)}</p>
          )}
          {traded?.ok === false && (
            <p className="text-xs text-red-500 mt-2">
              {isAuthError ? (
                <>Sign in to trade. <a href="/login" className="underline"><LogIn size={11} className="inline" /> Sign in</a></>
              ) : (
                <>{traded.msg}</>
              )}
            </p>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4 mb-4 text-sm text-[var(--color-text-secondary)] text-center">
          Trading closed{m.resolved ? ` · resolved as ${m.outcome}` : ""}.
        </div>
      )}

      {/* Recent trades feed */}
      {trades.length > 0 && (
        <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)] mb-2 flex items-center gap-1">
            <Trophy size={11} /> Recent trades
          </h3>
          <ul className="space-y-1.5 text-xs tabular-nums">
            {trades.slice(0, 10).map(t => (
              <li key={t.id} className="flex items-center justify-between">
                <span className={t.side === "yes" ? "text-emerald-500 font-semibold" : "text-red-500 font-semibold"}>
                  {t.side.toUpperCase()}
                </span>
                <span className="text-[var(--color-text-secondary)]">${t.amount.toFixed(2)} → {t.shares.toFixed(2)} shares @ ${t.avg_price.toFixed(3)}</span>
                <span className="text-[var(--color-text-tertiary)]">{new Date(t.ts).toLocaleTimeString()}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-[10px] text-[var(--color-text-tertiary)] italic mt-6 text-center">{COPY.brandTagline(t)}</p>
    </article>
  );
}
