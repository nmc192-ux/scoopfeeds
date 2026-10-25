/**
 * OnboardingModal — first-visit welcome. Lets a new user pick their
 * country, language, and preferred topics in ~20 seconds before entering
 * the feed. Sets onboardingComplete so it never shows again.
 *
 * Modal a11y (Escape / focus trap / scroll lock) is owned by the shared
 * <Modal /> primitive — this component just provides content.
 */
import { useMemo, useState } from "react";
import { ArrowRight, Check, Globe2, Sparkles } from "lucide-react";
import { useNewsStore } from "../../store/newsStore";
import { useGeo } from "../../hooks/useGeo";
import { useSiteConfig } from "../../hooks/useSiteConfig";
import ScoopMascot from "../mascot/ScoopMascot";
import Modal, { ModalFooter } from "../ui/Modal";

// Keep aligned with TOPICS in backend/src/config/sources.js.
const TOPIC_OPTIONS = [
  { id: "world",    emoji: "🌍", label: "World" },
  { id: "politics", emoji: "🏛️", label: "Politics" },
  { id: "business", emoji: "💼", label: "Business" },
  { id: "tech",     emoji: "🤖", label: "Tech & AI" },
  { id: "science",  emoji: "🔬", label: "Science & Health" },
  { id: "sports",   emoji: "🏆", label: "Sports" },
];

const QUICK_REGIONS = [
  { code: "US", label: "United States", flag: "🇺🇸", currency: "USD" },
  { code: "GB", label: "United Kingdom", flag: "🇬🇧", currency: "GBP" },
  { code: "IN", label: "India",          flag: "🇮🇳", currency: "INR" },
  { code: "PK", label: "Pakistan",       flag: "🇵🇰", currency: "PKR" },
  { code: "DE", label: "Germany",        flag: "🇩🇪", currency: "EUR" },
  { code: "AE", label: "UAE",            flag: "🇦🇪", currency: "AED" },
  { code: "CA", label: "Canada",         flag: "🇨🇦", currency: "CAD" },
  { code: "AU", label: "Australia",      flag: "🇦🇺", currency: "AUD" },
];

const LANGUAGE_OPTIONS = [
  { code: "en", flag: "🇺🇸", native: "English" },
  { code: "es", flag: "🇪🇸", native: "Español" },
  { code: "fr", flag: "🇫🇷", native: "Français" },
  { code: "de", flag: "🇩🇪", native: "Deutsch" },
  { code: "ar", flag: "🇸🇦", native: "العربية" },
  { code: "ur", flag: "🇵🇰", native: "اُردُو" },
  { code: "hi", flag: "🇮🇳", native: "हिन्दी" },
  { code: "zh", flag: "🇨🇳", native: "中文" },
  { code: "ja", flag: "🇯🇵", native: "日本語" },
];

// Class sets. CLASSIC is the flag-off look, character for character. V2 (#242) uses the #188
// tokens: an ink header band with the Anton wordmark, lime for the selected state and the main
// button, Newsreader for the step questions, Schibsted Grotesk for labels. Behaviour is identical.
const CLASSIC = {
  header: "px-6 pt-6 pb-4 flex items-center gap-3 border-b border-[var(--color-border)]",
  title: "text-lg font-bold",
  sub: "text-xs text-[var(--color-text-tertiary)]",
  dotOn: "bg-electric-600", dotOff: "bg-[var(--color-border)]",
  icon: "text-electric-600",
  h3: "font-semibold",
  ring: "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-500/40",
  on: "border-electric-500 bg-electric-50 text-electric-900",
  onSub: "text-electric-700",
  chipOn: "bg-electric-600 text-white border-electric-600",
  primary: "bg-electric-600 text-white hover:bg-electric-700",
  primaryRing: "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-500/50",
};
const V2 = {
  header: "px-6 pt-6 pb-4 flex items-center gap-3 bg-ink text-paper font-label",
  title: "font-display text-2xl tracking-wide uppercase leading-none",
  sub: "text-xs text-paper opacity-70 mt-1",
  dotOn: "bg-lime", dotOff: "bg-paper opacity-30",
  icon: "text-[var(--color-text)]",
  h3: "font-reading text-lg font-semibold",
  ring: "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-text)]",
  on: "border-ink bg-lime text-ink",
  onSub: "text-ink opacity-70",
  chipOn: "bg-lime text-ink border-ink",
  primary: "bg-lime text-ink hover:opacity-90 font-label uppercase tracking-wider",
  primaryRing: "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-text)] focus-visible:ring-offset-2",
};

export default function OnboardingModal() {
  const { v2 } = useSiteConfig();
  const T = v2 ? V2 : CLASSIC;
  const {
    onboardingComplete, completeOnboarding,
    language, setLanguage,
    autoLanguage, setAutoLanguage,
    setPreferredTopics, setActiveTopics,
  } = useNewsStore();

  const { countryCode, country, setOverride } = useGeo();
  const [step, setStep] = useState(0);   // 0 region · 1 language · 2 topics
  const [picks, setPicks] = useState([]);

  const open = !onboardingComplete;

  const regionOptions = useMemo(() => {
    const detected = QUICK_REGIONS.find((r) => r.code === countryCode);
    const others   = QUICK_REGIONS.filter((r) => r.code !== countryCode);
    return detected ? [detected, ...others] : QUICK_REGIONS;
  }, [countryCode]);

  const pickRegion = (r) => {
    setOverride({
      countryCode: r.code, country: r.label, currency: r.currency,
      timezone: null, city: null,
    });
    setStep(1);
  };

  const togglePick = (id) => {
    setPicks((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  };

  const finish = () => {
    const finalPicks = picks.length ? picks : ["top"];
    setPreferredTopics(finalPicks);
    setActiveTopics(["top"]);
    completeOnboarding();
  };

  return (
    <Modal
      open={open}
      onClose={completeOnboarding}
      variant="centered"
      size="lg"
      hideClose
      closeOnBackdrop={false}
      ariaLabel="Welcome to Scoopfeeds"
      zIndex={100}
      panelClassName="overflow-hidden"
    >
      {/* Header */}
      <div className={T.header} data-testid="onboarding-header">
        <ScoopMascot size="md" animated />
        <div>
          <h2 className={T.title}>{v2 ? <>Welcome to Scoop<span className="text-lime">*</span>Feeds</> : "Welcome to Scoopfeeds"}</h2>
          <p className={T.sub}>
            Intelligent news, curated — takes 20 seconds to personalise
          </p>
        </div>
        <div className="ml-auto flex items-center gap-1" aria-label={`Step ${step + 1} of 3`}>
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className={`w-2 h-2 rounded-full transition-colors ${
                i <= step ? T.dotOn : T.dotOff
              }`}
            />
          ))}
        </div>
      </div>

      {/* Body */}
      <div className="px-6 py-5 min-h-[280px]">
        {step === 0 && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Globe2 size={16} className={T.icon} />
              <h3 className={T.h3}>Where are you based?</h3>
            </div>
            <p className="text-xs text-[var(--color-text-tertiary)] mb-4">
              We detected <b>{country || "your region"}</b>. Confirm or pick another — this tailors markets, weather and local news.
            </p>
            <div className="grid grid-cols-2 gap-2">
              {regionOptions.map((r) => (
                <button
                  key={r.code}
                  onClick={() => pickRegion(r)}
                  aria-label={r.label}
                  aria-pressed={r.code === countryCode}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm text-left transition
                    ${T.ring}
                    ${r.code === countryCode
                      ? T.on
                      : "border-[var(--color-border)] hover:bg-[var(--color-surface2)]"}`}
                >
                  <span className="text-xl">{r.flag}</span>
                  <span className="flex-1 truncate">{r.label}</span>
                  <span className={`text-[10px] ${r.code === countryCode ? T.onSub : "text-[var(--color-text-tertiary)]"}`}>{r.currency}</span>
                </button>
              ))}
            </div>
            <button
              onClick={() => setStep(1)}
              className={`w-full mt-3 text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text)] py-2
                         ${T.ring} rounded`}
            >
              Skip — use auto-detection
            </button>
          </div>
        )}

        {step === 1 && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Sparkles size={16} className={T.icon} />
              <h3 className={T.h3}>Choose your language</h3>
            </div>
            <p className="text-xs text-[var(--color-text-tertiary)] mb-4">
              Articles show in their original language by default. Pick one to translate everything, or keep Auto. You can change this anytime from the header.
            </p>
            <button
              onClick={() => { setAutoLanguage(true); setStep(2); }}
              aria-pressed={autoLanguage}
              className={`w-full px-4 py-3 rounded-xl border text-left mb-2 transition
                ${T.ring} ${
                autoLanguage
                  ? T.on
                  : "border-[var(--color-border)] hover:bg-[var(--color-surface2)]"
              }`}
            >
              <div className="font-semibold text-sm">🌐 Auto — article's language</div>
              <div className={`text-[11px] ${autoLanguage ? T.onSub : "text-[var(--color-text-tertiary)]"}`}>Recommended — original grammar and nuance preserved</div>
            </button>
            <div className="grid grid-cols-3 gap-2">
              {LANGUAGE_OPTIONS.map((l) => {
                const on = !autoLanguage && language === l.code;
                return (
                  <button
                    key={l.code}
                    onClick={() => { setAutoLanguage(false); setLanguage(l.code); setStep(2); }}
                    aria-label={l.native}
                    aria-pressed={on}
                    className={`px-2 py-2 rounded-xl border text-left transition
                      ${T.ring} ${
                      on
                        ? T.on
                        : "border-[var(--color-border)] hover:bg-[var(--color-surface2)]"
                    }`}
                  >
                    <div className="text-lg leading-none">{l.flag}</div>
                    <div className="text-[11px] mt-1 truncate">{l.native}</div>
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] text-[var(--color-text-tertiary)] mt-3">
              21 languages total — pick more from the header selector.
            </p>
          </div>
        )}

        {step === 2 && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Sparkles size={16} className={T.icon} />
              <h3 className={T.h3}>Pick what you like</h3>
            </div>
            <p className="text-xs text-[var(--color-text-tertiary)] mb-4">
              We'll boost these in your feed. Pick as many as you want — skip to see everything.
            </p>
            <div className="flex flex-wrap gap-2 max-h-[240px] overflow-y-auto pr-1">
              {TOPIC_OPTIONS.map((t) => {
                const on = picks.includes(t.id);
                return (
                  <button
                    key={t.id}
                    onClick={() => togglePick(t.id)}
                    aria-pressed={on}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm border transition
                      ${T.ring} ${
                      on
                        ? T.chipOn
                        : "bg-[var(--color-surface2)] border-[var(--color-border)] hover:bg-[var(--color-border)]"
                    }`}
                  >
                    <span>{t.emoji}</span>
                    <span>{t.label}</span>
                    {on && <Check size={14} />}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <ModalFooter>
        <button
          onClick={completeOnboarding}
          className={`text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text)]
                     ${T.ring} rounded px-2 py-1`}
        >
          Skip all
        </button>
        {step < 2 ? (
          <button
            onClick={() => setStep(step + 1)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-full ${T.primary} text-sm font-semibold
                       transition-colors
                       ${T.primaryRing}`}
          >
            Next <ArrowRight size={14} />
          </button>
        ) : (
          <button
            onClick={finish}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-full ${T.primary} text-sm font-semibold
                       transition-colors
                       ${T.primaryRing}`}
          >
            Start reading <ArrowRight size={14} />
          </button>
        )}
      </ModalFooter>
    </Modal>
  );
}
