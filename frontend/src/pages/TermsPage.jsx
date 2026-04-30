/**
 * TermsPage — `/terms`
 */
import { useEffect } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft } from "lucide-react";

export default function TermsPage() {
  useEffect(() => {
    const prev = document.title;
    document.title = "Terms of Use — Scoopfeeds";
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
          Terms of Use
        </h1>
        <p className="text-sm text-[var(--color-text-tertiary)] mt-2">Last updated: May 2025</p>
      </div>

      <div className="prose prose-lg dark:prose-invert max-w-none space-y-8 text-[var(--color-text-secondary)]">

        <Section title="Acceptance">
          <p>
            By accessing or using Scoopfeeds ("the Service"), you agree to these Terms
            of Use. If you do not agree, please do not use the Service. We may update
            these terms from time to time; continued use after changes are posted
            constitutes acceptance of the updated terms.
          </p>
        </Section>

        <Section title="What Scoopfeeds Is">
          <p>
            Scoopfeeds is a <strong>news aggregator</strong>, not a news publisher.
            We do not produce original journalism. The Service collects, indexes, and
            links to articles published by independent third-party news organisations.
            All editorial decisions about what to publish remain with those original
            publishers.
          </p>
          <p>
            Reader-mode extraction is provided as a distraction-free reading aid.
            It does not circumvent paywalls — if a publisher restricts access,
            reader mode will reflect that restriction.
          </p>
        </Section>

        <Section title="Intellectual Property">
          <p>
            Article headlines, summaries, and images displayed on Scoopfeeds are the
            intellectual property of their respective publishers and are reproduced
            under fair-use / headline-snippet principles consistent with international
            press-aggregation norms.
          </p>
          <p>
            We link to, but do not host, full article text. If you are a publisher and
            believe content is being displayed beyond what is permissible, contact us at{" "}
            <a href="mailto:hello@scoopfeeds.com" className="underline hover:text-[var(--color-text)]">
              hello@scoopfeeds.com
            </a>{" "}and we will act promptly.
          </p>
          <p>
            The Scoopfeeds name, logo, mascot, and site design are owned by Scoopfeeds
            and may not be reproduced without written permission.
          </p>
        </Section>

        <Section title="Disclaimer">
          <p>
            Scoopfeeds does not verify the accuracy, completeness, or timeliness of
            third-party content. Articles linked from the Service represent the views
            of their respective authors and publishers, not Scoopfeeds.
          </p>
          <p>
            The Service is provided <strong>"as is"</strong> without warranties of
            any kind, express or implied, including but not limited to accuracy,
            reliability, or fitness for a particular purpose.
          </p>
        </Section>

        <Section title="Limitation of Liability">
          <p>
            To the maximum extent permitted by applicable law, Scoopfeeds and its
            operators shall not be liable for any indirect, incidental, special,
            consequential, or punitive damages arising from your use of — or inability
            to use — the Service, including any reliance on content published by
            third-party news sources.
          </p>
        </Section>

        <Section title="Changes to Terms">
          <p>
            We reserve the right to modify these terms at any time. Material changes
            will be announced via a notice on the homepage for at least 14 days before
            taking effect. Your continued use of the Service after that period
            constitutes acceptance.
          </p>
        </Section>

        <Section title="Contact">
          <p>
            Legal enquiries:{" "}
            <a href="mailto:hello@scoopfeeds.com" className="underline hover:text-[var(--color-text)]">
              hello@scoopfeeds.com
            </a>
          </p>
        </Section>

      </div>

      <footer className="mt-16 pt-6 border-t border-[var(--color-border)] text-xs text-[var(--color-text-tertiary)] flex flex-wrap gap-3">
        <Link to="/privacy" className="hover:text-[var(--color-text)]">Privacy</Link>
        <span>·</span>
        <Link to="/editorial-policy" className="hover:text-[var(--color-text)]">Editorial Policy</Link>
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
