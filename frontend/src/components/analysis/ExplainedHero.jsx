/**
 * ExplainedHero — hero card for the top Explained piece on AnalysisPage.
 * Links to the full /analysis/explained/:slug page.
 */
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import SafeImage from "../ui/SafeImage";

export default function ExplainedHero({ piece }) {
  if (!piece) return null;

  return (
    <Link
      to={`/analysis/explained/${piece.slug}`}
      className="block rounded-2xl overflow-hidden border border-[var(--color-border)]
                 bg-[var(--color-surface)] hover:border-electric-400 transition-colors group"
    >
      {piece.image_url && (
        <div className="w-full h-48 sm:h-64 overflow-hidden">
          <SafeImage
            src={piece.image_url}
            alt=""
            className="w-full h-full"
            imgClassName="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-500"
          />
        </div>
      )}
      <div className="p-5 sm:p-6">
        <span className="text-xs font-bold uppercase tracking-wider text-electric-600">
          Explained — {piece.category}
        </span>
        <h2
          className="mt-2 text-xl sm:text-2xl leading-snug text-[var(--color-text)]"
          style={{ fontFamily: "'Playfair Display', serif", fontStyle: "italic" }}
        >
          {piece.title}
        </h2>
        {piece.summary && (
          <p className="mt-2 text-sm text-[var(--color-text-secondary)] leading-relaxed line-clamp-3">
            {piece.summary}
          </p>
        )}
        <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-electric-600 group-hover:gap-3 transition-all duration-200">
          Read full analysis <ArrowRight size={14} />
        </span>
      </div>
    </Link>
  );
}
