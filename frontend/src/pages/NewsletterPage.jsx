/**
 * NewsletterPage — `/newsletter`
 *
 * Dedicated landing page for newsletter subscribers. Outperforms popup capture
 * on conversion (3–5×) because users arrive with intent. Uses the existing
 * <NewsletterSignup /> component to handle the actual email POST + ref-token
 * flow; this page wraps it with value props, social proof, and what-to-expect.
 */
import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronLeft, Mail, Clock, Globe, Shield, Sparkles, Check } from "lucide-react";
import NewsletterSignup from "../components/newsletter/NewsletterSignup";
import ScoopMascot from "../components/mascot/ScoopMascot";

const VALUE_PROPS = [
  {
    icon: <Clock size={20} className="text-electric-600" />,
    title: "Daily at 7 AM",
    body: "One curated digest each morning, delivered in your time zone. No surprise sends, no clickbait.",
  },
  {
    icon: <Globe size={20} className="text-electric-600" />,
    title: "Global by default",
    body: "Stories from 80+ trusted publishers across the Americas, Europe, Asia, MENA, and Africa.",
  },
  {
    icon: <Sparkles size={20} className="text-electric-600" />,
    title: "Topic-tailored",
    body: "Pick AI, Politics, Markets, Climate — your digest leads with what matters to you, not the average reader.",
  },
  {
    icon: <Shield size={20} className="text-electric-600" />,
    title: "Credibility-rated",
    body: "Every source is rated 1–10 for editorial standards. Mixed-credibility stories are flagged so you can trust what you're reading.",
  },
];

const SAMPLE_HEADLINES = [
  "🇺🇸 Fed signals 25bp cut likely in next session",
  "🤖 OpenAI ships GPT-5; benchmarks suggest 30% gain on reasoning tasks",
  "🌍 Climate: COP30 closes with binding methane pledge from 47 countries",
  "🇯🇵 Tokyo elections: opposition coalition flips three key prefectures",
  "📈 Markets: Nikkei +1.2%, FTSE flat, S&P futures point to soft open",
  "🏥 Public health: WHO updates avian flu guidance after EU clusters",
];

export default function NewsletterPage() {
  const navigate = useNavigate();

  useEffect(() => {
    const prev = document.title;
    document.title = "Daily Newsletter — Scoopfeeds";
    const meta = document.querySelector('meta[name="description"]');
    const prevDesc = meta?.getAttribute("content");
    if (meta) meta.setAttribute("content", "One curated news digest, delivered at 7 AM your time. Global stories, credibility-rated, topic-tailored. Free forever.");
    return () => {
      document.title = prev;
      if (meta && prevDesc) meta.setAttribute("content", prevDesc);
    };
  }, []);

  return (
    <article className="max-w-4xl mx-auto py-2">
      <Link
        to="/"
        className="inline-flex items-center gap-1.5 text-sm text-[var(--color-text-tertiary)] hover:text-[var(--color-text)] mb-6 transition-colors"
      >
        <ChevronLeft size={14} />
        Back to home
      </Link>

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <header className="text-center mb-10 pt-4">
        <ScoopMascot size="lg" mood="reading" animated />
        <h1
          className="text-4xl sm:text-5xl font-bold tracking-tight mt-4 mb-3"
          style={{ fontFamily: "'Playfair Display', serif", fontStyle: "italic" }}
        >
          The Scoopfeeds Daily
        </h1>
        <p className="text-lg text-[var(--color-text-secondary)] max-w-xl mx-auto leading-relaxed">
          One email each morning with the news that actually matters — global, credibility-rated, and tailored to your interests.
        </p>
        <div className="mt-3 flex items-center justify-center gap-1.5 text-xs text-[var(--color-text-tertiary)]">
          <Mail size={12} />
          <span>Free · No spam · Unsubscribe in one click</span>
        </div>
      </header>

      {/* ── Signup form ─────────────────────────────────────────────────── */}
      <div className="max-w-md mx-auto mb-12">
        <NewsletterSignup source="landing" />
      </div>

      {/* ── Value props grid ────────────────────────────────────────────── */}
      <section className="grid sm:grid-cols-2 gap-4 mb-12">
        {VALUE_PROPS.map((p, i) => (
          <div key={i} className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
            <div className="flex items-center gap-2 mb-1.5">
              {p.icon}
              <h2 className="font-bold text-[var(--color-text)]">{p.title}</h2>
            </div>
            <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">{p.body}</p>
          </div>
        ))}
      </section>

      {/* ── Sample digest ───────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 mb-12">
        <header className="flex items-center justify-between mb-4 pb-4 border-b border-[var(--color-border)]">
          <div className="flex items-center gap-2">
            <ScoopMascot size="sm" animated={false} />
            <div>
              <p className="text-xs uppercase tracking-wider text-[var(--color-text-tertiary)] font-bold">Sample Digest</p>
              <p
                className="text-sm font-bold"
                style={{ fontFamily: "'Playfair Display', serif", fontStyle: "italic" }}
              >
                The Scoopfeeds Daily
              </p>
            </div>
          </div>
          <span className="text-[11px] text-[var(--color-text-tertiary)]">Monday · 7:00 AM</span>
        </header>
        <p className="text-sm text-[var(--color-text-secondary)] mb-3 italic">
          Good morning. Here are six stories shaping the day, ranked by significance to your topics.
        </p>
        <ol className="space-y-2.5">
          {SAMPLE_HEADLINES.map((h, i) => (
            <li key={i} className="flex items-start gap-2.5">
              <span className="text-[11px] font-bold text-[var(--color-text-tertiary)] tabular-nums mt-0.5">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="text-sm text-[var(--color-text)] leading-relaxed">{h}</span>
            </li>
          ))}
        </ol>
        <footer className="mt-4 pt-4 border-t border-[var(--color-border)] text-[11px] text-[var(--color-text-tertiary)]">
          Plus: market snapshot, weather for your city, and one long-read worth your weekend.
        </footer>
      </section>

      {/* ── FAQ ─────────────────────────────────────────────────────────── */}
      <section className="space-y-4 mb-12">
        <h2 className="text-2xl font-bold mb-4">Frequently asked</h2>
        {[
          { q: "Is it really free?",         a: "Yes. Always free. We monetize the website with non-tracking ads and optional premium tips — never the newsletter." },
          { q: "How is my data handled?",     a: "Your email address is the only data we store. We don't share it, sell it, or hand it to third-party tracking pixels." },
          { q: "Can I change my topics later?", a: "Anytime. Each digest has a one-tap link to refine your preferences. Unsubscribing is one click." },
          { q: "What about other languages?",  a: "We currently send in English. Translations into Spanish, French, Arabic, and Hindi are on the roadmap for 2026." },
        ].map((f, i) => (
          <details key={i} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 group">
            <summary className="cursor-pointer list-none flex items-center justify-between font-semibold text-[var(--color-text)]">
              {f.q}
              <span className="text-electric-600 group-open:rotate-180 transition-transform">▾</span>
            </summary>
            <p className="text-sm text-[var(--color-text-secondary)] mt-2 leading-relaxed">{f.a}</p>
          </details>
        ))}
      </section>

      {/* ── Final CTA ────────────────────────────────────────────────────── */}
      <section className="text-center pt-4 pb-12 border-t border-[var(--color-border)]">
        <p className="text-lg font-semibold mb-1">Ready to start your mornings smarter?</p>
        <p className="text-sm text-[var(--color-text-tertiary)] mb-4">
          Join readers in 80+ countries who get the day's news in five minutes.
        </p>
        <div className="flex items-center justify-center gap-3 text-xs text-[var(--color-text-tertiary)]">
          <span className="flex items-center gap-1"><Check size={12} className="text-emerald-500" /> Free forever</span>
          <span className="flex items-center gap-1"><Check size={12} className="text-emerald-500" /> No tracking</span>
          <span className="flex items-center gap-1"><Check size={12} className="text-emerald-500" /> One click to unsubscribe</span>
        </div>
      </section>
    </article>
  );
}
