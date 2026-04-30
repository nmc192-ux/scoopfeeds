/**
 * LanguagePicker — header dropdown for choosing the display/translation
 * language. Replaces the earlier binary EN/UR toggle.
 *
 * - Shows the active language as `🇵🇰 UR` (flag + ISO code) on the button.
 * - Dropdown: searchable list with native name + English label.
 * - "Auto (article's language)" option clears the override so each article
 *   renders in its own source language.
 * - Persists to `useNewsStore.language` (string) + `autoLanguage` (bool).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Globe2, Languages } from "lucide-react";
import { useNewsStore } from "../../store/newsStore";
import { LANGUAGES, LANG_BY_CODE } from "../../lib/languages";

export default function LanguagePicker() {
  const { language, setLanguage, autoLanguage, setAutoLanguage } = useNewsStore();
  const [open,  setOpen]  = useState(false);
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return LANGUAGES;
    return LANGUAGES.filter((l) =>
      l.code.toLowerCase().includes(q) ||
      l.label.toLowerCase().includes(q) ||
      l.native.toLowerCase().includes(q)
    );
  }, [query]);

  const active = LANG_BY_CODE[language];

  const selectLang = (code) => {
    setAutoLanguage(false);
    setLanguage(code);
    setOpen(false);
  };
  const selectAuto = () => {
    setAutoLanguage(true);
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title={autoLanguage
          ? "Auto — matches each article's source language"
          : `Language: ${active?.label || language}`}
        className="flex items-center gap-1 px-2 py-1 rounded-full bg-[var(--color-surface2)] border border-[var(--color-border)] hover:bg-[var(--color-border)] transition-colors"
      >
        {autoLanguage ? (
          <>
            <Languages size={13} className="text-[var(--color-text-tertiary)]" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-secondary)]">
              AUTO
            </span>
          </>
        ) : (
          <>
            <span className="text-sm leading-none">{active?.flag || "🌐"}</span>
            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-secondary)]">
              {language.toUpperCase()}
            </span>
          </>
        )}
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
                  placeholder="Search language…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="flex-1 bg-transparent text-sm py-2 outline-none focus-visible:ring-1 focus-visible:ring-cobalt-500/40 rounded placeholder:text-[var(--color-text-tertiary)]"
                />
              </div>
              <button
                onClick={selectAuto}
                className={`w-full flex items-center gap-2 mt-1 px-2 py-1.5 text-xs rounded hover:bg-[var(--color-surface2)] ${
                  autoLanguage ? "text-cobalt-600 font-semibold" : "text-[var(--color-text-secondary)]"
                }`}
              >
                <Languages size={13} />
                <span className="flex-1 text-left">Auto — article's language</span>
                {autoLanguage && <Check size={13} />}
              </button>
            </div>

            <div className="overflow-y-auto flex-1 py-1">
              {filtered.map((l) => {
                const isActive = !autoLanguage && l.code === language;
                return (
                  <button
                    key={l.code}
                    onClick={() => selectLang(l.code)}
                    className={`w-full flex items-center gap-3 px-3 py-2 text-sm hover:bg-[var(--color-surface2)] text-left ${
                      isActive ? "bg-[var(--color-surface2)]" : ""
                    }`}
                  >
                    <span className="text-lg leading-none">{l.flag}</span>
                    <span
                      className="flex-1 min-w-0 truncate text-[var(--color-text)]"
                      style={l.font ? { fontFamily: l.font } : undefined}
                    >
                      {l.native}
                    </span>
                    <span className="text-[10px] text-[var(--color-text-tertiary)] uppercase tracking-wider tabular-nums">
                      {l.code}
                    </span>
                    {isActive && <Check size={14} className="text-cobalt-600" />}
                  </button>
                );
              })}
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
