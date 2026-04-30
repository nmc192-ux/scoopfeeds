/**
 * MarketsPage — `/markets`
 *
 * Global financial markets hub: indices, FX, crypto, commodities. Pulls from
 * the existing /api/market endpoint (cached 15min server-side). Layout is a
 * vertical stack of cards organized by asset class so users can scan
 * everything at a glance instead of navigating away.
 */
import { useEffect, useState, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ChevronLeft, TrendingUp, Loader2, RefreshCw, ArrowRightLeft } from "lucide-react";
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

function CurrencyConverter({ currencies }) {
  const [amount, setAmount] = useState("");
  const [fromCode, setFromCode] = useState("USD");
  const [toCode, setToCode] = useState("EUR");

  // Build a lookup: code → rate (relative to PKR base as stored in API)
  const rateMap = useMemo(() => {
    const map = {};
    currencies.forEach(c => { if (c.code && c.rate != null) map[c.code] = Number(c.rate); });
    return map;
  }, [currencies]);

  const codes = useMemo(() => Object.keys(rateMap).sort(), [rateMap]);

  // Convert: amount fromCode → PKR → toCode
  const result = useMemo(() => {
    const n = parseFloat(amount);
    if (!n || isNaN(n)) return null;
    const fromRate = rateMap[fromCode];
    const toRate   = rateMap[toCode];
    if (!fromRate || !toRate) return null;
    // amount * fromRate gives PKR; divide by toRate gives target currency
    return (n * fromRate) / toRate;
  }, [amount, fromCode, toCode, rateMap]);

  const swap = () => { setFromCode(toCode); setToCode(fromCode); };

  if (codes.length === 0) return null;

  return (
    <SectionCard
      title="Currency Converter"
      subtitle="Convert between any two currencies in the feed"
      icon={<ArrowRightLeft size={18} className="text-electric-600" />}
    >
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 mt-1">
        {/* Amount + from */}
        <div className="flex gap-2 flex-1">
          <input
            type="number"
            min="0"
            placeholder="Amount"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            className={clsx(
              "flex-1 min-w-0 px-3 py-2 text-sm rounded-lg border",
              "bg-[var(--color-surface2)] border-[var(--color-border)]",
              "text-[var(--color-text)] placeholder-[var(--color-text-tertiary)]",
              "focus:outline-none focus:ring-2 focus:ring-electric-600/40 focus:border-electric-600"
            )}
          />
          <select
            value={fromCode}
            onChange={e => setFromCode(e.target.value)}
            className={clsx(
              "px-2 py-2 text-sm rounded-lg border",
              "bg-[var(--color-surface2)] border-[var(--color-border)]",
              "text-[var(--color-text)]",
              "focus:outline-none focus:ring-2 focus:ring-electric-600/40"
            )}
          >
            {codes.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        {/* Swap button */}
        <button
          onClick={swap}
          title="Swap currencies"
          className="self-center p-2 rounded-full hover:bg-[var(--color-surface2)] text-[var(--color-text-secondary)] hover:text-electric-600 transition-colors"
        >
          <ArrowRightLeft size={16} />
        </button>

        {/* To currency */}
        <div className="flex gap-2 flex-1">
          <select
            value={toCode}
            onChange={e => setToCode(e.target.value)}
            className={clsx(
              "px-2 py-2 text-sm rounded-lg border",
              "bg-[var(--color-surface2)] border-[var(--color-border)]",
              "text-[var(--color-text)]",
              "focus:outline-none focus:ring-2 focus:ring-electric-600/40"
            )}
          >
            {codes.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <div className={clsx(
            "flex-1 min-w-0 px-3 py-2 text-sm rounded-lg border tabular-nums font-semibold",
            "bg-[var(--color-surface2)] border-[var(--color-border)]",
            result != null ? "text-[var(--color-text)]" : "text-[var(--color-text-tertiary)]"
          )}>
            {result != null
              ? result.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })
              : "Enter amount above"}
          </div>
        </div>
      </div>
    </SectionCard>
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

  // Backend shape (verified against /api/market):
  //   indices:    [{ sym, name, flag, price, changePct, currency }]
  //   crypto:     [{ symbol, name, price, changePct, image }]
  //   currencies: { USD: { code, name, rate } }    (keyed by ISO)
  //   metals:     {} (gold/silver — currently empty server-side)
  //   commodities:[] (oil/wheat — currently empty server-side)
  const indices    = Array.isArray(market?.indices)     ? market.indices     : [];
  const cryptos    = Array.isArray(market?.crypto)      ? market.crypto      : [];
  const currencies = market?.currencies && typeof market.currencies === "object"
    ? Object.values(market.currencies) : [];
  const metals     = market?.metals && typeof market.metals === "object"
    ? Object.entries(market.metals) : [];
  const commodities = Array.isArray(market?.commodities) ? market.commodities : [];

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
              className="font-editorial italic text-2xl sm:text-3xl font-bold tracking-tight"
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
        <>
        <div className="grid md:grid-cols-2 gap-4">
          {/* ── Indices ─────────────────────────────────────────────────────── */}
          <SectionCard
            title="Stock Indices"
            subtitle="Major exchanges worldwide"
            icon={<span className="text-xl" aria-hidden="true">📈</span>}
          >
            {indices.length === 0 ? (
              <p className="text-sm text-[var(--color-text-tertiary)] py-4 text-center">No index data right now.</p>
            ) : (
              indices.map((v) => (
                <PriceRow
                  key={v.sym || v.name}
                  label={`${v.flag ? v.flag + " " : ""}${v.name || v.sym}`}
                  value={fmtNum(v.price, 2)}
                  change={v.changePct}
                  suffix={v.currency}
                />
              ))
            )}
          </SectionCard>

          {/* ── FX ────────────────────────────────────────────────────────── */}
          <SectionCard
            title="Currencies"
            subtitle="vs PKR base · live FX rates"
            icon={<span className="text-xl" aria-hidden="true">💱</span>}
          >
            {currencies.length === 0 ? (
              <p className="text-sm text-[var(--color-text-tertiary)] py-4 text-center">No FX data right now.</p>
            ) : (
              currencies.slice(0, 12).map((v) => (
                <PriceRow
                  key={v.code}
                  label={`${v.code} · ${v.name}`}
                  value={fmtNum(v.rate, 4)}
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
            {cryptos.length === 0 ? (
              <p className="text-sm text-[var(--color-text-tertiary)] py-4 text-center">No crypto data right now.</p>
            ) : (
              cryptos.slice(0, 10).map((v) => (
                <PriceRow
                  key={v.id || v.symbol}
                  label={`${v.name} (${v.symbol?.toUpperCase()})`}
                  value={fmtNum(v.price, 2)}
                  change={v.changePct}
                  suffix="USD"
                />
              ))
            )}
          </SectionCard>

          {/* ── Commodities & Metals ───────────────────────────────────────── */}
          <SectionCard
            title="Commodities"
            subtitle="Precious metals, oil, and benchmarks"
            icon={<span className="text-xl" aria-hidden="true">🥇</span>}
          >
            {commodities.length === 0 && metals.length === 0 ? (
              <p className="text-sm text-[var(--color-text-tertiary)] py-4 text-center">
                Commodity feed is currently quiet — refreshes hourly.
              </p>
            ) : (
              <>
                {metals.map(([key, v]) => (
                  <PriceRow
                    key={key}
                    label={(v?.name || key).replace(/^\w/, c => c.toUpperCase())}
                    value={fmtNum(v?.price ?? v, 2)}
                    change={v?.changePct}
                    suffix="USD"
                  />
                ))}
                {commodities.map((v) => (
                  <PriceRow
                    key={v.sym || v.name}
                    label={v.name || v.sym}
                    value={fmtNum(v.price, 2)}
                    change={v.changePct}
                    suffix={v.currency || "USD"}
                  />
                ))}
              </>
            )}
          </SectionCard>
        </div>

        {/* Currency converter — shown below the grid when FX data is available */}
        {currencies.length > 0 && (
          <div className="mt-4">
            <CurrencyConverter currencies={currencies} />
          </div>
        )}
        </>
      )}

      <p className="mt-6 text-xs text-[var(--color-text-tertiary)] text-center">
        Data sourced from public market APIs · Not investment advice ·
        {" "}<Link to="/about" className="underline hover:text-[var(--color-text)]">methodology</Link>
      </p>
    </div>
  );
}
