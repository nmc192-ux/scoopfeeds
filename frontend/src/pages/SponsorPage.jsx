/**
 * SponsorPage — `/sponsor`
 */
import { useEffect } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, Users, LayoutGrid, DollarSign, Mail } from "lucide-react";

export default function SponsorPage() {
  useEffect(() => {
    const prev = document.title;
    document.title = "Advertise with Scoopfeeds";
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

      <div className="mb-8">
        <h1
          className="text-3xl sm:text-4xl font-bold tracking-tight"
          style={{ fontFamily: "'Playfair Display', serif", fontStyle: "italic" }}
        >
          Advertise with Scoopfeeds
        </h1>
        <p className="text-sm text-[var(--color-text-tertiary)] mt-2">
          Reach an audience that actually reads the news.
        </p>
      </div>

      <div className="prose prose-lg dark:prose-invert max-w-none space-y-8 text-[var(--color-text-secondary)]">

        <Section title="Why Advertise">
          <div className="grid sm:grid-cols-3 gap-4 not-prose">
            <StatCard value="80+" label="Curated sources" />
            <StatCard value="21" label="Languages" />
            <StatCard value="Global" label="Reach" />
          </div>
          <p>
            Scoopfeeds attracts engaged, informed readers — people who seek out
            quality journalism rather than passively scrolling social feeds.
            Our audience spans tech professionals, policy watchers, business
            readers, and globally-minded consumers across North America, Europe,
            South Asia, and MENA.
          </p>
          <p>
            Unlike algorithmic platforms, every ad on Scoopfeeds appears alongside
            content that readers have actively chosen — no opaque targeting,
            no brand-safety surprises.
          </p>
        </Section>

        <Section title="Ad Formats">
          <div className="not-prose space-y-3">
            <FormatCard
              icon={<LayoutGrid size={18} className="text-electric-600" />}
              title="Sponsored Posts"
              description="A clearly labelled sponsored card in the feed — same visual treatment as editorial cards but with a 'Sponsored' badge. Includes headline, thumbnail, and a brief description linking to your landing page."
            />
            <FormatCard
              icon={<Mail size={18} className="text-electric-600" />}
              title="Newsletter Placements"
              description="A single sponsored section in our daily digest email. The newsletter goes to opted-in subscribers who have chosen to receive Scoopfeeds updates — high open rates, high intent."
            />
            <FormatCard
              icon={<LayoutGrid size={18} className="text-electric-600" />}
              title="Banner Ads"
              description="Sidebar and inline banner placements. Served direct — no programmatic middleman. Standard IAB sizes supported."
            />
          </div>
        </Section>

        <Section title="Pricing">
          <p>
            We do not publish rate cards because placement inventory, CPMs, and
            bundled packages vary by campaign type and volume. Contact us to discuss
            your goals and we'll put together a tailored proposal.
          </p>
          <p>
            We do not accept advertising for products or services that conflict
            with our editorial values — no misinformation sites, no predatory
            financial products, no spam tools.
          </p>
        </Section>

        <Section title="Contact">
          <div className="not-prose p-6 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]">
            <h3 className="text-base font-bold text-[var(--color-text)] mb-2 flex items-center gap-2">
              <DollarSign size={16} className="text-electric-600" />
              Start the conversation
            </h3>
            <p className="text-sm text-[var(--color-text-secondary)] mb-4">
              Tell us about your product, your target audience, and your budget.
              We'll come back with options within 2–3 business days.
            </p>
            <a
              href="mailto:ads@scoopfeeds.com"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-electric-600 hover:bg-electric-700 text-white text-sm font-semibold transition-colors"
            >
              ads@scoopfeeds.com
            </a>
          </div>
        </Section>

      </div>

      <footer className="mt-16 pt-6 border-t border-[var(--color-border)] text-xs text-[var(--color-text-tertiary)] flex flex-wrap gap-3">
        <Link to="/privacy" className="hover:text-[var(--color-text)]">Privacy</Link>
        <span>·</span>
        <Link to="/terms" className="hover:text-[var(--color-text)]">Terms</Link>
        <span>·</span>
        <Link to="/contact" className="hover:text-[var(--color-text)]">Contact</Link>
        <span>·</span>
        <Link to="/" className="hover:text-[var(--color-text)]">Home</Link>
      </footer>
    </article>
  );
}

function Section({ title, children }) {
  return (
    <section>
      <h2 className="text-2xl font-bold text-[var(--color-text)] mb-3">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function StatCard({ value, label }) {
  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 text-center">
      <p className="text-3xl font-bold text-[var(--color-text)]">{value}</p>
      <p className="text-sm text-[var(--color-text-tertiary)] mt-1">{label}</p>
    </div>
  );
}

function FormatCard({ icon, title, description }) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 flex gap-3">
      <div className="mt-0.5 shrink-0">{icon}</div>
      <div>
        <p className="font-semibold text-[var(--color-text)] mb-1">{title}</p>
        <p className="text-sm text-[var(--color-text-tertiary)] leading-relaxed">{description}</p>
      </div>
    </div>
  );
}
