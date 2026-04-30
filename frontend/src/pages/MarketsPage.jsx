/**
 * MarketsPage — `/markets`
 *
 * Global financial markets hub: indices, FX, crypto, commodities. Pulls from
 * the existing /api/market endpoint (cached 15min server-side). Layout is a
 * vertical stack of cards organized by asset class so users can scan
 * everything at a glance instead of navigating away.
 */
import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ChevronLeft, TrendingUp, TrendingDown, Loader2, RefreshCw } from "lucide-react";
import clsx from "clsx";
import { useMarket } from "../hooks/useMarket";
import { useGeo } from "../hooks/useGeo";

function pctClass(p) {
  if (p == null) return "text-[var(--color-text-tertiary)]";
  return p >= 0 ? "text-emerald-500" : "text-red-500";
}

function fmtNum(n, frac = 2) {
  if (n == null || isNaN(n)) return "—";
  return Number(n).toLocaleString(undefined, {
    minimumFractionDigits: frac,
    maximumFractionDigits: frac,
  });
}

function PriceRow({ label, value, change, suffix }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-[var(--color-border)] last:border-0">
      <span className="text-sm font-medium text-[var(--color-text-secondary)]">{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-sm font-bold tabular-nums text-[var(--color-text)]">
          {value}{suffix && <span className="text-[var(--color-text-tertiary)] font-medium ml-1">{suffix}</span>}
        </span>
        {change != null && (
          <span className={clsx("text-xs font-semibold tabular-nums w-16 text-right", pctClass(change))}>
            {change >= 0 ? "+" : ""}{fmtNum(change, 2)}%
          </span>
        )}
      </div>
    </div>
  );
}

function SectionCard({ title, subtitle, icon, children }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5"
    >
      <header className="flex items-center gap-2 mb-3">
        {icon}
        <div>
          <h2 className="font-bold text-[var(--color-text)]">{title}</h2>
          {subtitle && <p className="text-xs text-[var(--color-text-tertiary)]">{subtitle}</p>}
        </div>
      </header>
      {children}
    </motion.section>
  );
}

export default function MarketsPage() {
  const { data: market, isLoading, isFetching, refetch } = useMarket();
  const { country } = useGeo();
  const navigate = useNavigate();

  useEffect(() => {
    const prev = document.title;
    document.title = "Markets — Scoopfeeds";
    return () => { document.title = prev; };
  }, []);

  // Defensive readers — backend can return shapes that differ slightly between
  // the cached snapshot and a freshly synced response. Default to {} so the
  // skeleton renders cleanly without prop-type errors.
  const indices    = market?.indices    || {};
  const fx         = market?.fx         || {};
  const crypto     = market?.crypto     || {};
  const commodities= market?.commodities|| market?.gold ? {
    gold:   market?.gold   || market?.commodities?.gold,
    silver: market?.silver || market?.commodities?.silver,
    oil:    market?.oil    || market?.commodities?.oil,
  } : {};

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-6">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => navigate(-1)}
            className="p-2 rounded-full hover:bg-[var(--color-surface2)] transition-colors"
            aria-label="Back"
          >
            <ChevronLeft size={18} />
          </button>
          <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 shrink-0">
            <TrendingUp size={20} />
          </div>
          <div className="min-w-0">
            <h1
              className="text-2xl sm:text-3xl font-bold tracking-tight"
              style={{ fontFamily: "'Playfair Display', serif", fontStyle: "italic" }}
            >
              Markets
            </h1>
            <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">
              Global indices, FX, crypto, and commodities
              {country ? ` · localized for ${country}` : ""} · refreshed every 15 min
            </p>
          </div>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="p-2 rounded-full hover:bg-[var(--color-surface2)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors disabled:opacity-40"
          aria-label="Refresh markets"
          title="Refresh"
        >
          <RefreshCw size={16} className={isFetching ? "animate-spin" : ""} />
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 size={28} className="animate-spin text-[var(--color-text-tertiary)]" />
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {/* ── Indices ─────────────────────────────────────────────────────── */}
          <SectionCard
            title="Stock Indices"
            subtitle="Major exchanges worldwide"
            icon={<span className="text-xl" aria-hidden="true">📈</span>}
          >
            {Object.keys(indices).length === 0 ? (
              <p className="text-sm text-[var(--color-text-tertiary)] py-4 text-center">No index data right now.</p>
            ) : (
              Object.entries(indices).map(([key, v]) => (
                <PriceRow
                  key={key}
                  label={v?.label || key.toUpperCase()}
                  value={fmtNum(v?.value ?? v?.price, 2)}
                  change={v?.changePct ?? v?.change_percent ?? v?.change}
                />
              ))
            )}
          </SectionCard>

          {/* ── FX ────────────────────────────────────────────────────────── */}
          <SectionCard
            title="FX / Forex"
            subtitle="Major currency pairs"
            icon={<span className="text-xl" aria-hidden="true">💱</span>}
          >
            {Object.keys(fx).length === 0 ? (
              <p className="text-sm text-[var(--color-text-tertiary)] py-4 text-center">No FX data right now.</p>
            ) : (
              Object.entries(fx).map(([pair, v]) => (
                <PriceRow
                  key={pair}
                  label={v?.label || pair.toUpperCase()}
                  value={fmtNum(v?.rate ?? v?.value, 4)}
                  change={v?.changePct ?? v?.change_percent}
                />
              ))
            )}
          </SectionCard>

          {/* ── Crypto ────────────────────────────────────────────────────── */}
          <SectionCard
            title="Crypto"
            subtitle="Top digital assets"
            icon={<span className="text-xl" aria-hidden="true">🪙</span>}
          >
            {Object.keys(crypto).length === 0 ? (
              <p className="text-sm text-[var(--color-text-tertiary)] py-4 text-center">No crypto data right now.</p>
            ) : (
              Object.entries(crypto).map(([sym, v]) => (
                <PriceRow
                  key={sym}
                  label={v?.label || sym.toUpperCase()}
                  value={fmtNum(v?.price ?? v?.value, 2)}
                  change={v?.changePct ?? v?.change24h ?? v?.change_percent}
                  suffix="USD"
                />
              ))
            )}
          </SectionCard>

          {/* ── Commodities ───────────────────────────────────────────────── */}
          <SectionCard
            title="Commodities"
            subtitle="Gold, silver, and oil benchmarks"
            icon={<span className="text-xl" aria-hidden="true">🥇</span>}
          >
            {Object.values(commodities).every(v => !v) ? (
              <p className="text-sm text-[var(--color-text-tertiary)] py-4 text-center">No commodity data right now.</p>
            ) : (
              <>
                {commodities.gold && (
                  <PriceRow label="Gold (oz)"   value={fmtNum(commodities.gold?.price ?? commodities.gold,   2)} change={commodities.gold?.changePct} suffix="USD" />
                )}
                {commodities.silver && (
                  <PriceRow label="Silver (oz)" value={fmtNum(commodities.silver?.price ?? commodities.silver, 2)} change={commodities.silver?.changePct} suffix="USD" />
                )}
                {commodities.oil && (
                  <PriceRow label="Oil (Brent)" value={fmtNum(commodities.oil?.price    ?? commodities.oil,    2)} change={commodities.oil?.changePct}    suffix="USD" />
                )}
              </>
            )}
          </SectionCard>
        </div>
      )}

      <p className="mt-6 text-xs text-[var(--color-text-tertiary)] text-center">
        Data sourced from public market APIs · Not investment advice ·
        {" "}<Link to="/about" className="underline hover:text-[var(--color-text)]">methodology</Link>
      </p>
    </div>
  );
}
