import { useEffect, useMemo, useState } from "react";
import { useGeo } from "../../hooks/useGeo";
import { motion, AnimatePresence } from "framer-motion";
import {
  TrendingUp, TrendingDown, Minus,
  ChevronDown, ChevronUp, RefreshCw, BarChart2,
  Search, ArrowRightLeft,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useMarket } from "../../hooks/useMarket";

/* ──────────────────────────────────────────────────────────────────────────
 *  Shared primitives
 * ────────────────────────────────────────────────────────────────────────── */

function ChangeBadge({ pct, size = 11 }) {
  if (pct == null || Number.isNaN(pct)) return null;
  const abs = Math.abs(pct);
  const isPos = pct > 0.005;
  const isNeg = pct < -0.005;
  const Icon = isPos ? TrendingUp : isNeg ? TrendingDown : Minus;
  return (
    <span
      className={`inline-flex items-center gap-0.5 font-semibold tabular-nums ${
        isPos ? "text-green-500" : isNeg ? "text-red-500" : "text-[var(--color-text-tertiary)]"
      }`}
      style={{ fontSize: size }}
    >
      <Icon size={Math.round(size * 0.9)} strokeWidth={2.5} />
      {abs.toFixed(2)}%
    </span>
  );
}

/**
 * Responsive inline SVG sparkline. `values` is an array of numbers.
 * Colour auto-derives from first-vs-last value unless `color` is passed.
 */
function Sparkline({ values = [], width = 90, height = 28, color }) {
  if (!values || values.length < 2) return <div style={{ width, height }} />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const step = width / (values.length - 1);
  const pts = values
    .map((v, i) => `${(i * step).toFixed(1)},${(height - ((v - min) / range) * height).toFixed(1)}`)
    .join(" ");
  const stroke = color || (values[values.length - 1] >= values[0] ? "#10b981" : "#ef4444");
  const fill = values[values.length - 1] >= values[0] ? "rgba(16,185,129,0.12)" : "rgba(239,68,68,0.12)";
  const area = `0,${height} ${pts} ${width},${height}`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="block">
      <polygon points={area} fill={fill} />
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function GridSkeleton({ cols = 6, rows = 1 }) {
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {Array.from({ length: cols * rows }).map((_, i) => (
        <div key={i} className="h-[96px] rounded-xl bg-[var(--color-surface2)] animate-pulse" />
      ))}
    </div>
  );
}

const fmtNum = (n, d = 2) =>
  n == null ? "—" : Number(n).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d });

const fmtCompact = (n) =>
  n == null ? "—" : Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 2 }).format(n);

/* ──────────────────────────────────────────────────────────────────────────
 *  Cards
 * ────────────────────────────────────────────────────────────────────────── */

function CurrencyCard({ code, name, rate }) {
  if (rate == null) return null;
  return (
    <div className="flex flex-col gap-1 p-3 rounded-xl bg-[var(--color-surface2)] hover:bg-[var(--color-border)] transition-colors min-w-0">
      <div className="flex items-baseline gap-1">
        <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-tertiary)]">{code}</span>
        <span className="text-[9px] text-[var(--color-text-tertiary)] hidden sm:inline">/PKR</span>
      </div>
      <span className="text-sm font-bold text-[var(--color-text)] tabular-nums">
        ₨{fmtNum(rate, rate < 5 ? 3 : 2)}
      </span>
      <span className="text-[10px] text-[var(--color-text-tertiary)] truncate">{name}</span>
    </div>
  );
}

function IndexCard({ item }) {
  return (
    <div className="flex flex-col gap-1 p-3 rounded-xl bg-[var(--color-surface2)] hover:bg-[var(--color-border)] transition-colors min-w-0">
      <div className="flex items-center gap-1.5">
        <span className="text-sm leading-none">{item.flag}</span>
        <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-tertiary)] truncate">
          {item.name}
        </span>
      </div>
      <div className="flex items-end justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-bold text-[var(--color-text)] tabular-nums">
            {fmtNum(item.price, 2)}
          </div>
          <ChangeBadge pct={item.changePct} />
        </div>
        <Sparkline values={item.spark} width={60} height={24} />
      </div>
    </div>
  );
}

function CommodityCard({ item }) {
  return (
    <div className="flex flex-col gap-1 p-3 rounded-xl bg-[var(--color-surface2)] hover:bg-[var(--color-border)] transition-colors min-w-0">
      <div className="flex items-center gap-1.5">
        <span className="text-sm leading-none">{item.icon}</span>
        <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-tertiary)] truncate">
          {item.name}
        </span>
      </div>
      <div className="flex items-end justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-bold text-[var(--color-text)] tabular-nums">
            ${fmtNum(item.price, 2)}
            <span className="text-[10px] font-normal text-[var(--color-text-tertiary)]"> /{item.unit}</span>
          </div>
          <ChangeBadge pct={item.changePct} />
        </div>
        <Sparkline values={item.spark} width={56} height={22} />
      </div>
    </div>
  );
}

function MetalCard({ metal, usdPerPkr }) {
  if (!metal) return (
    <div className="flex flex-col gap-1 p-3 rounded-xl bg-[var(--color-surface2)] animate-pulse min-w-0">
      <div className="h-3 w-16 bg-[var(--color-border)] rounded" />
      <div className="h-4 w-20 bg-[var(--color-border)] rounded" />
    </div>
  );
  const pkr = usdPerPkr && metal.price ? metal.price * usdPerPkr : null;
  return (
    <div className="flex flex-col gap-1 p-3 rounded-xl bg-[var(--color-surface2)] hover:bg-[var(--color-border)] transition-colors min-w-0">
      <div className="flex items-center gap-1.5">
        <span className="text-sm leading-none">{metal.icon}</span>
        <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-tertiary)]">{metal.name}</span>
      </div>
      <div className="flex items-end justify-between gap-2">
        <div>
          <div className="text-sm font-bold text-[var(--color-text)] tabular-nums">
            ${fmtNum(metal.price, 2)}
            <span className="text-[10px] font-normal text-[var(--color-text-tertiary)]">/oz</span>
          </div>
          {pkr != null && (
            <div className="text-[10px] text-[var(--color-text-tertiary)] tabular-nums">
              ≈ ₨{Math.round(pkr).toLocaleString()}
            </div>
          )}
          <ChangeBadge pct={metal.changePct} />
        </div>
        <Sparkline values={metal.spark} width={48} height={22} />
      </div>
    </div>
  );
}

function CryptoCard({ coin }) {
  return (
    <div className="flex flex-col gap-1 p-3 rounded-xl bg-[var(--color-surface2)] hover:bg-[var(--color-border)] transition-colors min-w-0">
      <div className="flex items-center gap-1.5">
        {coin.image && <img src={coin.image} alt={coin.symbol} className="w-4 h-4" loading="lazy" />}
        <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-tertiary)] truncate">
          {coin.symbol}
        </span>
      </div>
      <div className="flex items-end justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-bold text-[var(--color-text)] tabular-nums">
            ${fmtNum(coin.price, coin.price < 1 ? 4 : 2)}
          </div>
          <ChangeBadge pct={coin.changePct} />
          <div className="text-[9px] text-[var(--color-text-tertiary)] tabular-nums">
            MC {fmtCompact(coin.marketCap)}
          </div>
        </div>
        <Sparkline values={coin.spark} width={56} height={26} />
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 *  Fear & Greed gauge
 * ────────────────────────────────────────────────────────────────────────── */

function FearGreedGauge({ fg }) {
  if (!fg) return null;
  const { value, classification } = fg;
  // colour map 0-100
  const hue = Math.round((value / 100) * 120); // 0=red, 60=yellow, 120=green
  const color = `hsl(${hue}, 75%, 45%)`;
  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-xl bg-[var(--color-surface2)]">
      <div
        className="flex flex-col items-center justify-center rounded-full font-bold tabular-nums text-white shrink-0"
        style={{ backgroundColor: color, width: 44, height: 44, fontSize: 14 }}
      >
        {value}
      </div>
      <div className="min-w-0">
        <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-tertiary)]">
          Crypto Fear &amp; Greed
        </div>
        <div className="text-sm font-bold text-[var(--color-text)] truncate">{classification}</div>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 *  Converter tab
 * ────────────────────────────────────────────────────────────────────────── */

function Converter({ currencies, defaultTo = "USD" }) {
  const codes = useMemo(
    () => Object.values(currencies || {}).filter((c) => c.rate != null).map((c) => c.code).concat("PKR"),
    [currencies]
  );
  const [amount, setAmount] = useState("1");
  // "From" defaults to USD (global reserve); "To" defaults to the user's
  // local currency (passed in from useGeo), falling back to USD.
  const [from, setFrom] = useState("USD");
  const [to, setTo]     = useState(defaultTo);
  // Keep the "To" currency in sync when geo resolves after mount
  useEffect(() => {
    if (defaultTo && codes.includes(defaultTo)) setTo(defaultTo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultTo]);

  const ratePkrPer = (code) => (code === "PKR" ? 1 : currencies?.[code]?.rate ?? null);

  const result = useMemo(() => {
    const a = parseFloat(amount);
    if (!a || Number.isNaN(a)) return null;
    const fr = ratePkrPer(from);
    const tr = ratePkrPer(to);
    if (!fr || !tr) return null;
    return (a * fr) / tr;
  }, [amount, from, to, currencies]);

  const swap = () => { setFrom(to); setTo(from); };

  const selectCls = "bg-[var(--color-surface2)] text-[var(--color-text)] text-sm font-semibold px-3 py-2 rounded-lg border border-[var(--color-border)] focus:outline-none focus:border-cobalt-500 focus:ring-2 focus:ring-cobalt-500/30";

  return (
    <div className="max-w-xl">
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] gap-3 items-center">
        <div className="flex gap-2">
          <input
            type="number"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Amount"
            className="flex-1 bg-[var(--color-surface2)] text-[var(--color-text)] text-sm font-semibold px-3 py-2 rounded-lg border border-[var(--color-border)] focus:outline-none focus:border-cobalt-500 focus:ring-2 focus:ring-cobalt-500/30 tabular-nums"
          />
          <select value={from} onChange={(e) => setFrom(e.target.value)} className={selectCls}>
            {codes.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <button
          onClick={swap}
          className="p-2 rounded-full bg-[var(--color-surface2)] hover:bg-[var(--color-border)] text-[var(--color-text-secondary)] transition-colors justify-self-center"
          title="Swap"
        >
          <ArrowRightLeft size={14} />
        </button>
        <div className="flex gap-2">
          <div className="flex-1 bg-[var(--color-surface2)] text-[var(--color-text)] text-sm font-bold px-3 py-2 rounded-lg border border-[var(--color-border)] tabular-nums">
            {result == null ? "—" : result.toLocaleString(undefined, { maximumFractionDigits: 4 })}
          </div>
          <select value={to} onChange={(e) => setTo(e.target.value)} className={selectCls}>
            {codes.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>
      {result != null && (
        <p className="mt-3 text-xs text-[var(--color-text-tertiary)]">
          {fmtNum(parseFloat(amount), 2)} {from} = <span className="font-bold text-[var(--color-text)]">{result.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span> {to}
        </p>
      )}
      <p className="mt-2 text-[10px] text-[var(--color-text-tertiary)]">
        Rates via open.er-api.com · Informational only, not for trading.
      </p>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 *  Tab bar + main
 * ────────────────────────────────────────────────────────────────────────── */

const TABS = [
  { id: "forex",       label: "💱 Forex"       },
  { id: "indices",     label: "📈 Indices"     },
  { id: "crypto",      label: "₿ Crypto"       },
  { id: "commodities", label: "🛢️ Commodities" },
  { id: "metals",      label: "🏅 Metals"      },
  { id: "converter",   label: "🔁 Converter"   },
];

// Regional index affinity — for a given country, which indices should
// appear first. The match is by `region` code on each index def.
const COUNTRY_TO_REGIONS = {
  PK: ["PK"],
  IN: ["IN"],
  US: ["US"],
  GB: ["UK"],
  DE: ["DE", "EU"], FR: ["FR", "EU"], IT: ["EU"], ES: ["EU"], NL: ["EU"], BE: ["EU"], IE: ["EU"], AT: ["EU"], PT: ["EU"], GR: ["EU"], FI: ["EU"],
  JP: ["JP"],
  HK: ["HK"], CN: ["HK"],
  AU: ["AU"], NZ: ["AU"],
  CA: ["US"], // Canadians usually follow US markets
};

function sortIndicesByGeo(indices, countryCode) {
  const prefer = COUNTRY_TO_REGIONS[countryCode] || [];
  if (!prefer.length) return indices;
  const score = (i) => {
    const idx = prefer.indexOf(i.region);
    return idx === -1 ? 99 : idx;
  };
  return [...indices].sort((a, b) => score(a) - score(b));
}

export default function MarketStrip({ defaultOpen = true }) {
  const [isOpen,    setIsOpen]    = useState(defaultOpen);
  const [activeTab, setTab]       = useState("forex");
  const [query,     setQuery]     = useState("");
  const { data: market, isLoading, isError, refetch, isFetching } = useMarket();
  const { countryCode, currency: localCurrency } = useGeo();

  if (isError && !market) return null;

  const currencies       = market?.currencies       ?? {};
  const indicesRaw       = market?.indices          ?? [];
  const commodities      = market?.commodities      ?? [];
  const commodityIndices = market?.commodityIndices ?? [];
  const metals           = market?.metals           ?? {};
  const crypto           = market?.crypto           ?? [];
  const fearGreed        = market?.fearGreed        ?? null;
  const updatedAt   = market?.updatedAt;
  const usdRate     = currencies.USD?.rate;
  const currencyList = Object.values(currencies).filter((c) => c.rate != null);

  // Reorder indices so the user's region appears first
  const indices = useMemo(
    () => sortIndicesByGeo(indicesRaw, countryCode),
    [indicesRaw, countryCode]
  );

  // Apply search filter to whatever tab is showing
  const q = query.trim().toLowerCase();
  const filterFx   = currencyList.filter((c) => !q || c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q));
  const filterIdx  = indices.filter((i) => !q || i.name.toLowerCase().includes(q) || i.sym.toLowerCase().includes(q));
  const filterComm = commodities.filter((c) => !q || c.name.toLowerCase().includes(q) || (c.group || "").toLowerCase().includes(q));
  const filterCIdx = commodityIndices.filter((c) => !q || c.name.toLowerCase().includes(q) || c.sym.toLowerCase().includes(q));
  // Group commodities by category for the Commodities tab
  const commGroupOrder = ["Energy", "Metals", "Grains", "Softs", "Livestock"];
  const commByGroup = commGroupOrder
    .map((g) => ({ group: g, items: filterComm.filter((c) => c.group === g) }))
    .filter((x) => x.items.length > 0);
  const filterCry  = crypto.filter((c) => !q || c.name.toLowerCase().includes(q) || (c.symbol || "").toLowerCase().includes(q));

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-6 card overflow-hidden"
    >
      {/* ── Header ── */}
      <div
        className="flex items-center justify-between px-4 py-3 cursor-pointer select-none"
        onClick={() => setIsOpen((v) => !v)}
      >
        <div className="flex items-center gap-2 min-w-0">
          <BarChart2 size={16} className="text-[var(--color-text-secondary)]" />
          <span className="text-sm font-bold text-[var(--color-text)]">Markets</span>
          {updatedAt && !isLoading && (
            <span className="text-xs text-[var(--color-text-tertiary)] hidden sm:inline truncate">
              · updated {formatDistanceToNow(new Date(updatedAt), { addSuffix: true })}
            </span>
          )}
          {isFetching && (
            <span className="text-[10px] text-cobalt-600 animate-pulse font-medium">Updating…</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); refetch(); }}
            title="Refresh market data"
            className={`p-1.5 rounded-full hover:bg-[var(--color-surface2)] text-[var(--color-text-tertiary)] transition-colors ${isFetching ? "animate-spin" : ""}`}
          >
            <RefreshCw size={12} />
          </button>
          {isOpen
            ? <ChevronUp size={15} className="text-[var(--color-text-tertiary)]" />
            : <ChevronDown size={15} className="text-[var(--color-text-tertiary)]" />}
        </div>
      </div>

      {/* ── Body ── */}
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            {/* Tab bar */}
            <div className="flex items-center gap-2 px-4 pb-3 border-b border-[var(--color-border)] overflow-x-auto hide-scrollbar">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`flex-shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full transition-all ${
                    activeTab === t.id
                      ? "bg-[var(--color-text)] text-[var(--color-bg)]"
                      : "bg-[var(--color-surface2)] text-[var(--color-text-secondary)] hover:bg-[var(--color-border)]"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* Search (hidden on converter) */}
            {activeTab !== "converter" && (
              <div className="px-4 pt-3">
                <div className="flex items-center gap-2 bg-[var(--color-surface2)] rounded-lg px-3 py-1.5 max-w-xs">
                  <Search size={12} className="text-[var(--color-text-tertiary)]" />
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Filter…"
                    className="bg-transparent text-xs text-[var(--color-text)] placeholder-[var(--color-text-tertiary)] focus:outline-none focus-visible:ring-1 focus-visible:ring-cobalt-500/40 rounded flex-1 min-w-0"
                  />
                </div>
              </div>
            )}

            {/* Tab content */}
            <div className="p-4">
              <AnimatePresence mode="wait">
                {activeTab === "forex" && (
                  <motion.div key="forex" initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 4 }} transition={{ duration: 0.15 }}>
                    {isLoading ? <GridSkeleton cols={6} rows={2} /> : filterFx.length > 0 ? (
                      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
                        {filterFx.map((c) => <CurrencyCard key={c.code} {...c} />)}
                      </div>
                    ) : (
                      <p className="text-sm text-[var(--color-text-tertiary)] text-center py-4">No matches</p>
                    )}
                  </motion.div>
                )}

                {activeTab === "indices" && (
                  <motion.div key="indices" initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 4 }} transition={{ duration: 0.15 }}>
                    {isLoading ? <GridSkeleton cols={4} rows={2} /> : filterIdx.length > 0 ? (
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                        {filterIdx.map((i) => <IndexCard key={i.sym} item={i} />)}
                      </div>
                    ) : (
                      <p className="text-sm text-[var(--color-text-tertiary)] text-center py-4">No index data available</p>
                    )}
                  </motion.div>
                )}

                {activeTab === "crypto" && (
                  <motion.div key="crypto" initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 4 }} transition={{ duration: 0.15 }}>
                    {fearGreed && (
                      <div className="mb-3 max-w-xs">
                        <FearGreedGauge fg={fearGreed} />
                      </div>
                    )}
                    {isLoading ? <GridSkeleton cols={4} rows={2} /> : filterCry.length > 0 ? (
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                        {filterCry.map((c) => <CryptoCard key={c.id} coin={c} />)}
                      </div>
                    ) : (
                      <p className="text-sm text-[var(--color-text-tertiary)] text-center py-4">No crypto data available</p>
                    )}
                  </motion.div>
                )}

                {activeTab === "commodities" && (
                  <motion.div key="commodities" initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 4 }} transition={{ duration: 0.15 }} className="space-y-5">
                    {isLoading ? <GridSkeleton cols={3} rows={2} /> : commByGroup.length > 0 ? (
                      commByGroup.map(({ group, items }) => (
                        <div key={group}>
                          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)] mb-2">{group}</h4>
                          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                            {items.map((c) => <CommodityCard key={c.sym} item={c} />)}
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-[var(--color-text-tertiary)] text-center py-4">No commodity data available</p>
                    )}

                    {filterCIdx.length > 0 && (
                      <div>
                        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)] mb-2">Commodity Indices (ETFs)</h4>
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                          {filterCIdx.map((c) => <CommodityCard key={c.sym} item={c} />)}
                        </div>
                      </div>
                    )}
                  </motion.div>
                )}

                {activeTab === "metals" && (
                  <motion.div key="metals" initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 4 }} transition={{ duration: 0.15 }}>
                    {isLoading ? <GridSkeleton cols={4} /> : (
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <MetalCard metal={metals.gold}      usdPerPkr={usdRate} />
                        <MetalCard metal={metals.silver}    usdPerPkr={usdRate} />
                        <MetalCard metal={metals.platinum}  usdPerPkr={usdRate} />
                        <MetalCard metal={metals.palladium} usdPerPkr={usdRate} />
                      </div>
                    )}
                  </motion.div>
                )}

                {activeTab === "converter" && (
                  <motion.div key="converter" initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 4 }} transition={{ duration: 0.15 }}>
                    <Converter currencies={currencies} defaultTo={localCurrency} />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
