/**
 * SavedPage — `/saved`
 *
 * Renders the user's saved-articles list. Shareable URL means power users can
 * bookmark their reading queue. Empty state nudges sign-in for cross-device
 * sync since unauthenticated saves only persist in localStorage.
 */
import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Bookmark, BookmarkPlus, ChevronLeft, LogIn } from "lucide-react";
import NewsGrid from "../components/news/NewsGrid";
import { useNewsStore } from "../store/newsStore";
import { useAuth } from "../hooks/useAuth";
import ScoopMascot from "../components/mascot/ScoopMascot";

export default function SavedPage() {
  const { savedArticles, language, setAuthOpen } = useNewsStore();
  const { isLoggedIn } = useAuth();
  const isUrdu = language === "ur";

  useEffect(() => {
    const prev = document.title;
    document.title = "Saved Stories — Scoopfeeds";
    return () => { document.title = prev; };
  }, []);

  return (
    <>
      <div className="flex items-center gap-3 mb-6">
        <Link
          to="/"
          className="p-2 rounded-full hover:bg-[var(--color-surface2)] transition-colors"
          aria-label="Back to home"
        >
          <ChevronLeft size={18} />
        </Link>
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-electric-50 text-electric-600"
        >
          <Bookmark size={18} fill="currentColor" />
        </div>
        <div>
          <h1
            className="text-2xl sm:text-3xl font-bold tracking-tight"
            style={{ fontFamily: "'Playfair Display', serif", fontStyle: "italic" }}
          >
            {isUrdu ? "محفوظ خبریں" : "Saved Stories"}
          </h1>
          <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">
            {savedArticles.length} {isUrdu ? "خبریں" : savedArticles.length === 1 ? "story" : "stories"}
          </p>
        </div>
      </div>

      {savedArticles.length === 0 ? (
        <div className="flex flex-col items-center gap-4 py-20 text-center">
          <ScoopMascot size="lg" mood="reading" animated />
          <div className="max-w-md">
            <p className="text-lg font-semibold text-[var(--color-text)]">
              {isUrdu ? "ابھی تک کوئی خبر محفوظ نہیں" : "No saved stories yet"}
            </p>
            <p className="text-sm text-[var(--color-text-tertiary)] mt-1.5">
              {isUrdu
                ? "کسی بھی خبر پر بک مارک آئیکن دبائیں تاکہ وہ یہاں محفوظ ہو جائے۔"
                : "Hit the bookmark icon on any article to save it here for later."}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-3 mt-2">
            <Link
              to="/"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-electric-600 hover:bg-electric-700 text-white text-sm font-semibold transition-colors"
            >
              <BookmarkPlus size={14} />
              {isUrdu ? "خبریں دیکھیں" : "Browse stories"}
            </Link>
            {!isLoggedIn && (
              <button
                onClick={() => setAuthOpen(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full border border-[var(--color-border)] hover:bg-[var(--color-surface2)] text-[var(--color-text-secondary)] text-sm font-semibold transition-colors"
              >
                <LogIn size={14} />
                {isUrdu ? "سائن ان کریں" : "Sign in to sync"}
              </button>
            )}
          </div>
        </div>
      ) : (
        <NewsGrid articles={savedArticles} isLoading={false} error={null} />
      )}
    </>
  );
}
