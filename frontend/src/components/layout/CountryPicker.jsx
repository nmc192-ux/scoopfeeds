/**
 * CountryPicker — small flag dropdown in the header that lets users override
 * the IP-detected country. Stored in localStorage via useGeo.setOverride.
 * Shows a small "• Auto" hint when using detection, "• Override" when explicit.
 */
import { useState, useRef, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Globe2 } from "lucide-react";
import { useGeo } from "../../hooks/useGeo";

// Curated list — covers the biggest user markets + strong currency coverage.
// Extendable; users in unlisted countries still get auto-detection.
const COUNTRIES = [
  { code: "US", name: "United States",   flag: "🇺🇸", currency: "USD" },
  { code: "GB", name: "United Kingdom",  flag: "🇬🇧", currency: "GBP" },
  { code: "CA", name: "Canada",          flag: "🇨🇦", currency: "CAD" },
  { code: "AU", name: "Australia",       flag: "🇦🇺", currency: "AUD" },
  { code: "DE", name: "Germany",         flag: "🇩🇪", currency: "EUR" },
  { code: "FR", name: "France",          flag: "🇫🇷", currency: "EUR" },
  { code: "NL", name: "Netherlands",     flag: "🇳🇱", currency: "EUR" },
  { code: "ES", name: "Spain",           flag: "🇪🇸", currency: "EUR" },
  { code: "IT", name: "Italy",           flag: "🇮🇹", currency: "EUR" },
  { code: "JP", name: "Japan",           flag: "🇯🇵", currency: "JPY" },
  { code: "CN", name: "China",           flag: "🇨🇳", currency: "CNY" },
  { code: "IN", name: "India",           flag: "🇮🇳", currency: "INR" },
  { code: "PK", name: "Pakistan",        flag: "🇵🇰", currency: "PKR" },
  { code: "BD", name: "Bangladesh",      flag: "🇧🇩", currency: "BDT" },
  { code: "AE", name: "UAE",             flag: "🇦🇪", currency: "AED" },
  { code: "SA", name: "Saudi Arabia",    flag: "🇸🇦", currency: "SAR" },
  { code: "TR", name: "Türkiye",         flag: "🇹🇷", currency: "TRY" },
  { code: "BR", name: "Brazil",          flag: "🇧🇷", currency: "BRL" },
  { code: "MX", name: "Mexico",          flag: "🇲🇽", currency: "MXN" },
  { code: "ZA", name: "South Africa",    flag: "🇿🇦", currency: "ZAR" },
  { code: "NG", name: "Nigeria",         flag: "🇳🇬", currency: "NGN" },
  { code: "EG", name: "Egypt",           flag: "🇪🇬", currency: "EGP" },
  { code: "SG", name: "Singapore",       flag: "🇸🇬", currency: "SGD" },
  { code: "HK", name: "Hong Kong",       flag: "🇭🇰", currency: "HKD" },
  { code: "KR", name: "South Korea",     flag: "🇰🇷", currency: "KRW" },
  { code: "ID", name: "Indonesia",       flag: "🇮🇩", currency: "IDR" },
  { code: "MY", name: "Malaysia",        flag: "🇲🇾", currency: "MYR" },
  { code: "PH", name: "Philippines",     flag: "🇵🇭", currency: "PHP" },
];

export default function CountryPicker() {
  const { countryCode, isOverridden, setOverride } = useGeo();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const onKey   = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = useMemo(
    () => COUNTRIES.find((c) => c.code === countryCode) || null,
    [countryCode]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return COUNTRIES;
    return COUNTRIES.filter(
      (c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q)
    );
  }, [query]);

  const select = (country) => {
    setOverride({
      countryCode: country.code,
      country:     country.name,
      currency:    country.currency,
      timezone:    null,
      city:        null,
    });
    setOpen(false);
  };

  const clearOverride = () => {
    setOverride(null);
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title={current ? `${current.name}${isOverridden ? " (manual)" : " (auto)"}` : "Pick region"}
        className="flex items-center gap-1 px-2 py-1 rounded-full hover:bg-[var(--color-surface2)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text)] transition-colors"
      >
        <span className="text-base leading-none">{current?.flag || "🌐"}</span>
        <span className="hidden sm:inline text-[11px] font-bold uppercase tracking-wider">
          {current?.code || "—"}
        </span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0,  scale: 1 }}
            exit={{   opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 mt-2 w-72 max-h-[70vh] overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl z-50 flex flex-col"
          >
            <div className="p-2 border-b border-[var(--color-border)]">
              <div className="flex items-center gap-2 px-2">
                <Globe2 size={14} className="text-[var(--color-text-tertiary)]" />
                <input
                  autoFocus
                  placeholder="Search region…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="flex-1 bg-transparent text-sm py-2 outline-none focus-visible:ring-1 focus-visible:ring-cobalt-500/40 rounded placeholder:text-[var(--color-text-tertiary)]"
                />
              </div>
              {isOverridden && (
                <button
                  onClick={clearOverride}
                  className="w-full text-left mt-1 px-2 py-1 text-xs text-cobalt-600 hover:bg-[var(--color-surface2)] rounded"
                >
                  ← Use auto-detected region
                </button>
              )}
            </div>

            <div className="overflow-y-auto flex-1 py-1">
              {filtered.map((c) => (
                <button
                  key={c.code}
                  onClick={() => select(c)}
                  className="w-full flex items-center gap-3 px-3 py-2 text-sm hover:bg-[var(--color-surface2)] text-left"
                >
                  <span className="text-lg leading-none">{c.flag}</span>
                  <span className="flex-1 min-w-0 truncate text-[var(--color-text)]">{c.name}</span>
                  <span className="text-[10px] text-[var(--color-text-tertiary)] tabular-nums">{c.currency}</span>
                  {c.code === countryCode && <Check size={14} className="text-cobalt-600" />}
                </button>
              ))}
              {!filtered.length && (
                <p className="text-center text-xs text-[var(--color-text-tertiary)] py-6">No matches</p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
