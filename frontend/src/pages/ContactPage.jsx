/**
 * ContactPage — `/contact`
 */
import { useEffect } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, Mail, Newspaper, Megaphone, Bug, Clock } from "lucide-react";

export default function ContactPage() {
  useEffect(() => {
    const prev = document.title;
    document.title = "Contact — Scoopfeeds";
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
          Get in Touch
        </h1>
        <p className="text-sm text-[var(--color-text-tertiary)] mt-2">
          We're a small team — we read every email.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">

        <ContactCard
          icon={<Mail size={20} className="text-electric-600" />}
          title="General Enquiries"
          description="Questions about the product, feedback, source suggestions, or anything else."
          email="hello@scoopfeeds.com"
        />

        <ContactCard
          icon={<Newspaper size={20} className="text-electric-600" />}
          title="Press & Media"
          description="Media requests, interview enquiries, and official statements."
          email="press@scoopfeeds.com"
        />

        <ContactCard
          icon={<Megaphone size={20} className="text-electric-600" />}
          title="Advertise"
          description="Sponsored placements, newsletter ads, and banner partnerships."
          email="ads@scoopfeeds.com"
          linkTo="/sponsor"
          linkLabel="See advertising options"
        />

        <ContactCard
          icon={<Bug size={20} className="text-electric-600" />}
          title="Bug Reports"
          description="Found something broken? We'd love to fix it. Email us or open an issue on GitHub."
          email="hello@scoopfeeds.com"
          emailSubject="Bug report"
        />

      </div>

      <div className="mt-8 p-5 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] flex items-start gap-3">
        <Clock size={18} className="text-[var(--color-text-tertiary)] mt-0.5 shrink-0" />
        <div>
          <p className="text-sm font-semibold text-[var(--color-text)] mb-1">Response time</p>
          <p className="text-sm text-[var(--color-text-secondary)]">
            We typically reply within <strong>2–3 business days</strong>. For urgent press
            enquiries, put "URGENT" in the subject line and we'll prioritise.
          </p>
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

function ContactCard({ icon, title, description, email, emailSubject, linkTo, linkLabel }) {
  const href = emailSubject
    ? `mailto:${email}?subject=${encodeURIComponent(emailSubject)}`
    : `mailto:${email}`;

  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        {icon}
        <h2 className="font-bold text-[var(--color-text)]">{title}</h2>
      </div>
      <p className="text-sm text-[var(--color-text-tertiary)] leading-relaxed">{description}</p>
      <div className="mt-auto flex flex-col gap-1.5">
        <a
          href={href}
          className="text-sm font-medium text-electric-600 hover:underline"
        >
          {email}
        </a>
        {linkTo && (
          <Link
            to={linkTo}
            className="text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text)] transition-colors"
          >
            {linkLabel} →
          </Link>
        )}
      </div>
    </div>
  );
}
