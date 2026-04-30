/**
 * EditorialPolicyPage — `/editorial-policy`
 */
import { useEffect } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft } from "lucide-react";

export default function EditorialPolicyPage() {
  useEffect(() => {
    const prev = document.title;
    document.title = "Editorial Policy — Scoopfeeds";
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
          Editorial Policy
        </h1>
        <p className="text-sm text-[var(--color-text-tertiary)] mt-2">
          How we decide what ends up in the feed — and what stays out.
        </p>
      </div>

      <div className="prose prose-lg dark:prose-invert max-w-none space-y-8 text-[var(--color-text-secondary)]">

        <Section title="Source Selection">
          <p>
            Every publisher in the Scoopfeeds index is assigned a credibility score
            from <strong>1 to 10</strong> based on a structured assessment of:
          </p>
          <ul>
            <li>Editorial independence from government and commercial pressure.</li>
            <li>Transparent correction and retraction policies.</li>
            <li>Sourcing standards — named vs. anonymous sources, primary vs. secondary reporting.</li>
            <li>Track record on factual accuracy, including third-party fact-check outcomes.</li>
            <li>Separation of news and opinion in presentation.</li>
          </ul>
          <p>
            The default feed surfaces only sources scoring <strong>7 or above</strong>.
            Sources rated 5–6 are available but visually flagged. Sources rated below 5
            are excluded entirely. Global tier-1 outlets (Reuters, AP, BBC, NHK, DW,
            Al Jazeera, and equivalents) anchor the index.
          </p>
        </Section>

        <Section title="What We Don't Publish">
          <p>The following content types are excluded from the default feed:</p>
          <ul>
            <li><strong>Opinion and commentary</strong> — unless explicitly labelled as such
              in the source feed. Opinion pieces are filtered out of the main news stream.</li>
            <li><strong>Clickbait and engagement-bait headlines</strong> — articles whose
              headlines are structurally misleading or withhold information to manufacture
              clicks are down-ranked or removed.</li>
            <li><strong>Unverified breaking news</strong> — a story is only elevated to
              "Breaking" status when at least two independent tier-1 sources have published
              it. Single-source breaking claims are held in a lower prominence slot.</li>
            <li><strong>Sponsored content passed off as news</strong> — native advertising
              or press releases re-packaged as journalism are excluded.</li>
          </ul>
        </Section>

        <Section title="Corrections Policy">
          <p>
            Scoopfeeds links to original articles. Factual errors in the underlying
            reporting should be directed to the publisher.
          </p>
          <p>
            Where Scoopfeeds itself makes an error — in a category label, a summary,
            or a credibility rating — corrections are applied inline and noted with a
            "Corrected [date]" tag visible on the affected item. We do not silently
            edit published content.
          </p>
          <p>
            To flag a correction: email{" "}
            <a href="mailto:hello@scoopfeeds.com" className="underline hover:text-[var(--color-text)]">
              hello@scoopfeeds.com
            </a>{" "}with the article URL and the nature of the error.
          </p>
        </Section>

        <Section title="Independence">
          <p>
            Scoopfeeds has no investors, political backers, or advertisers with editorial
            access. Revenue comes from affiliate links (Skimlinks) and direct advertising
            placements. No advertiser has any influence over which stories are included,
            excluded, promoted, or suppressed in the feed.
          </p>
          <p>
            The credibility scoring system and source-selection criteria are applied
            consistently regardless of whether a source advertises with us.
          </p>
        </Section>

        <Section title="AI Use">
          <p>
            Scoopfeeds uses AI assistance in the following limited ways:
          </p>
          <ul>
            <li><strong>Article summaries</strong> — the one-sentence summaries shown on cards
              may be AI-generated from the article text. They are always accompanied by a
              link to the original source and are not presented as original reporting.</li>
            <li><strong>Categorisation</strong> — topic tags are assigned by a classifier
              model and are reviewed periodically for accuracy.</li>
            <li><strong>Translation</strong> — on-demand reader-mode translations use a
              machine translation service. Translations are marked as such.</li>
          </ul>
          <p>
            AI is not used to generate news content, write headlines, or produce
            editorial judgements about a story's significance.
          </p>
        </Section>

      </div>

      <footer className="mt-16 pt-6 border-t border-[var(--color-border)] text-xs text-[var(--color-text-tertiary)] flex flex-wrap gap-3">
        <Link to="/privacy" className="hover:text-[var(--color-text)]">Privacy</Link>
        <span>·</span>
        <Link to="/terms" className="hover:text-[var(--color-text)]">Terms</Link>
        <span>·</span>
        <Link to="/about" className="hover:text-[var(--color-text)]">About</Link>
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
