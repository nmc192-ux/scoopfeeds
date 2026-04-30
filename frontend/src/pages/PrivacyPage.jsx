/**
 * PrivacyPage — `/privacy`
 */
import { useEffect } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft } from "lucide-react";

export default function PrivacyPage() {
  useEffect(() => {
    const prev = document.title;
    document.title = "Privacy Policy — Scoopfeeds";
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
          Privacy Policy
        </h1>
        <p className="text-sm text-[var(--color-text-tertiary)] mt-2">Last updated: May 2025</p>
      </div>

      <div className="prose prose-lg dark:prose-invert max-w-none space-y-8 text-[var(--color-text-secondary)]">

        <Section title="Information We Collect">
          <p>
            Scoopfeeds does not require an account to use. We collect limited,
            anonymous usage data to improve the service:
          </p>
          <ul>
            <li><strong>Usage data</strong> — pages visited, topics selected, search queries,
              and dwell time. This data is aggregated and never tied to an individual identity.</li>
            <li><strong>Cookies &amp; local storage</strong> — we store your topic preferences,
              dark-mode setting, language choice, and saved articles in your browser's local
              storage. No tracking cookies are set by Scoopfeeds itself.</li>
            <li><strong>No account required</strong> — all personalisation is client-side.
              If you choose to create an account for cross-device save syncing, we store only
              your email address (hashed) and your saves list.</li>
          </ul>
        </Section>

        <Section title="How We Use It">
          <p>Usage data is used solely to:</p>
          <ul>
            <li>Personalise your feed ordering and surface topics relevant to your reading history.</li>
            <li>Generate aggregate analytics that help us improve the product (e.g. which
              topics are trending, which sources perform well).</li>
            <li>Debug errors and improve reliability.</li>
          </ul>
          <p>
            We do not sell, rent, or share your data with third parties for marketing
            purposes. We do not build individual advertising profiles.
          </p>
        </Section>

        <Section title="Third-Party Services">
          <p>We embed content or load scripts from the following third parties:</p>
          <ul>
            <li><strong>YouTube</strong> — the Live TV section embeds YouTube iframes.
              YouTube may set its own cookies under{" "}
              <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer"
                className="underline hover:text-[var(--color-text)]">Google's Privacy Policy</a>.</li>
            <li><strong>Google Analytics (GA4)</strong> — loaded only on server-rendered
              article pages to measure reach. Analytics data is collected under Google's data
              processing terms. You can opt out via the{" "}
              <a href="https://tools.google.com/dlpage/gaoptout" target="_blank" rel="noopener noreferrer"
                className="underline hover:text-[var(--color-text)]">Google Analytics Opt-out Add-on</a>.</li>
            <li><strong>Skimlinks</strong> — affiliate link conversion for outbound article
              links. Skimlinks may set a cookie to attribute purchases. No personal browsing
              data is shared with Skimlinks beyond the URL clicked.</li>
          </ul>
        </Section>

        <Section title="Your Rights">
          <p>
            Because we don't collect personally identifiable information by default, most
            data is already under your control:
          </p>
          <ul>
            <li><strong>Clear local data</strong> — open your browser settings → clear
              site data for scoopfeeds.com. This resets all preferences and saved articles.</li>
            <li><strong>Account deletion</strong> — if you created an account, email us at{" "}
              <a href="mailto:hello@scoopfeeds.com" className="underline hover:text-[var(--color-text)]">
                hello@scoopfeeds.com
              </a>{" "}and we will delete your record within 7 days.</li>
            <li><strong>Analytics opt-out</strong> — use the Google Analytics Opt-out browser
              add-on linked above, or a browser with tracking protection enabled.</li>
          </ul>
        </Section>

        <Section title="Contact">
          <p>
            Privacy questions or data requests:{" "}
            <a href="mailto:hello@scoopfeeds.com" className="underline hover:text-[var(--color-text)]">
              hello@scoopfeeds.com
            </a>. We aim to respond within 5 business days.
          </p>
        </Section>

      </div>

      <footer className="mt-16 pt-6 border-t border-[var(--color-border)] text-xs text-[var(--color-text-tertiary)] flex flex-wrap gap-3">
        <Link to="/terms" className="hover:text-[var(--color-text)]">Terms</Link>
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
