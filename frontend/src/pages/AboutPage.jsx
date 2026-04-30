/**
 * AboutPage — `/about`
 *
 * Editorial mission, sourcing methodology, and team contact. Required for
 * AdSense approval/renewal and for user trust on a news product. Real
 * content — never ship a 3-line about page.
 */
import { useEffect } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, Globe, Shield, Sparkles, Mail } from "lucide-react";
import ScoopMascot from "../components/mascot/ScoopMascot";

export default function AboutPage() {
  useEffect(() => {
    const prev = document.title;
    document.title = "About — Scoopfeeds";
    return () => { document.title = prev; };
  }, []);

  return (
    <article className="max-w-3xl mx-auto py-4">
      <Link
        to="/"
        className="inline-flex items-center gap-1.5 text-sm text-[var(--color-text-tertiary)] hover:text-[var(--color-text)] mb-6 transition-colors"
      >
        <ChevronLeft size={14} />
        Back to home
      </Link>

      <div className="flex items-center gap-3 mb-8">
        <ScoopMascot size="lg" animated />
        <div>
          <h1
            className="font-editorial italic text-3xl sm:text-4xl font-bold tracking-tight"
          >
            About Scoopfeeds
          </h1>
          <p className="text-sm text-[var(--color-text-tertiary)] mt-1">
            Intelligent news, curated.
          </p>
        </div>
      </div>

      <div className="prose prose-lg dark:prose-invert max-w-none space-y-6 text-[var(--color-text-secondary)]">
        <p className="text-lg leading-relaxed">
          Scoopfeeds is a global news aggregator built around a simple idea:
          you shouldn't have to choose between reading widely and reading
          quickly. We collect stories from trusted publishers across every
          continent, surface what's worth your attention, and stay out of your
          way.
        </p>

        <div className="grid sm:grid-cols-3 gap-4 my-8 not-prose">
          <Pillar
            icon={<Globe size={22} className="text-electric-600" />}
            title="Global by default"
            body="Coverage spans 80+ sources across the Americas, Europe, Asia, MENA, and Africa — in multiple languages."
          />
          <Pillar
            icon={<Shield size={22} className="text-electric-600" />}
            title="Credibility-rated"
            body="Every source is rated 1–10 for editorial standards. Mixed-credibility stories are flagged in the UI."
          />
          <Pillar
            icon={<Sparkles size={22} className="text-electric-600" />}
            title="No infinite scroll"
            body="Curated lists, not algorithmic feeds. We'd rather you finish a session feeling informed than addicted."
          />
        </div>

        <h2 className="text-2xl font-bold mt-10 mb-3">How we pick stories</h2>
        <p>
          Articles enter the feed through RSS pulls and direct API integrations
          with publishers. Each item is auto-categorized, deduplicated against
          its alternate-source coverage, and ranked using a credibility-weighted
          freshness score. Breaking news is promoted manually only when at
          least two independent sources have reported it.
        </p>

        <h2 className="text-2xl font-bold mt-10 mb-3">What we don't do</h2>
        <ul className="list-disc pl-6 space-y-2">
          <li>We don't write our own articles — we link to the original source and credit the publisher.</li>
          <li>We don't paywall reading. The reader-mode extraction is for distraction-free reading, not bypassing paywalls.</li>
          <li>We don't sell your data. Analytics are aggregate and anonymous.</li>
          <li>We don't run intrusive ads. Affiliate links and a single sidebar/inline ad keep the lights on.</li>
        </ul>

        <h2 className="text-2xl font-bold mt-10 mb-3">Languages &amp; regions</h2>
        <p>
          The interface is available in 21 languages. Article translation runs
          on demand via the reader. Regional news pages cover the major news
          markets — pick your country from the header to see locally relevant
          coverage alongside the global wire.
        </p>

        <h2 className="text-2xl font-bold mt-10 mb-3">Who we are</h2>
        <p>
          Scoopfeeds is an independent product. There is no editorial agenda
          beyond accuracy and breadth. If you spot a factual error in an
          article we link to, the right place to flag it is with the
          original publisher; if our framing is off, we want to hear about it
          directly.
        </p>

        <div className="mt-10 p-6 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] not-prose">
          <h3 className="text-lg font-bold mb-3 flex items-center gap-2">
            <Mail size={18} className="text-electric-600" />
            Get in touch
          </h3>
          <p className="text-sm text-[var(--color-text-secondary)] mb-4">
            Press inquiries, source pitches, partnership questions, or
            corrections — email us and we'll reply within 48 hours.
          </p>
          <a
            href="mailto:hello@scoopfeeds.com"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-electric-600 hover:bg-electric-700 text-white text-sm font-semibold transition-colors"
          >
            hello@scoopfeeds.com
          </a>
        </div>
      </div>

      <footer className="mt-16 pt-6 border-t border-[var(--color-border)] text-xs text-[var(--color-text-tertiary)] flex flex-wrap gap-3">
        <Link to="/privacy" className="hover:text-[var(--color-text)]">Privacy</Link>
        <span>·</span>
        <Link to="/terms" className="hover:text-[var(--color-text)]">Terms</Link>
        <span>·</span>
        <Link to="/" className="hover:text-[var(--color-text)]">Home</Link>
      </footer>
    </article>
  );
}

function Pillar({ icon, title, body }) {
  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
      <div className="mb-2">{icon}</div>
      <h3 className="font-bold text-[var(--color-text)] mb-1.5">{title}</h3>
      <p className="text-sm text-[var(--color-text-tertiary)] leading-relaxed">{body}</p>
    </div>
  );
}
