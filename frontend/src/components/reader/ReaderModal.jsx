/**
 * ReaderModal — distraction-free in-app article reader.
 *
 * Shows up as a full-screen overlay, fetches the Readability-extracted article
 * from /api/reader, renders the sanitized HTML with our typography, and lets
 * users bail to the source site if extraction fails or they want the full page.
 */
import { motion, AnimatePresence } from "framer-motion";
import { X, ExternalLink, Type, Sun, Bookmark, Share2, Languages, Loader2, ArrowRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useReaderStore, useReaderArticle, useTranslatedReader } from "../../hooks/useReader";
import { useNewsStore } from "../../store/newsStore";
import { useSaveArticle } from "../../hooks/useSaveArticle";
import { useAuth } from "../../hooks/useAuth";
import { usePublicConfig } from "../../hooks/useNews";
import { useEscapeKey, useBodyScrollLock, useFocusTrap } from "../../hooks/useModal";
import { isRtl, langFont, nativeName, LANG_BY_CODE } from "../../lib/languages";
import { track, trackShare, trackOutboundClick, trackSave } from "../../lib/track";
import TipJar from "../tips/TipJar";
import NewsletterSignup, { readSubToken } from "../newsletter/NewsletterSignup";
import { AdSenseUnit } from "../ads/AdSense";
import SafeImage from "../ui/SafeImage";
import ArticleDeepDive from "../analysis/ArticleDeepDive";
import RealityIndexPanel from "../predictions/RealityIndexPanel";

// Fetches 4 related stories in the same category, used by the recirculation
// block at the bottom of the reader. Cached per category to avoid re-fetching
// as the user jumps between articles in the same topic.
async function fetchRelated(category) {
  if (!category) return [];
  const res = await fetch(`/api/news?category=${encodeURIComponent(category)}&limit=8`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.articles || data.data || [];
}

const FONT_SIZES = [
  { id: "sm",  label: "A",  size: 15 },
  { id: "md",  label: "A",  size: 17 },
  { id: "lg",  label: "A",  size: 19 },
  { id: "xl",  label: "A",  size: 22 },
];

export default function ReaderModal() {
  const { article, open, closeReader, openReader } = useReaderStore();
  const { language, autoLanguage, setAuthOpen } = useNewsStore();
  const { toggle: toggleSave, isSaved: checkSaved } = useSaveArticle();
  const { isPremium } = useAuth();
  const { data: publicConfig } = usePublicConfig();
  const adSenseConfig = isPremium ? null : publicConfig?.adsense;
  const url = open ? article?.url : null;
  const { data, isLoading, isError, error } = useReaderArticle(url);

  // Meter disabled — all readers have unlimited access.

  // Related stories — fetched only once the modal is open and we know the
  // article's category. Cached for 2 minutes to avoid thrashing when the user
  // jumps between articles.
  const { data: related = [] } = useQuery({
    queryKey: ["related", article?.category],
    queryFn:  () => fetchRelated(article?.category),
    enabled:  open && !!article?.category,
    staleTime: 2 * 60 * 1000,
  });
  const relatedFiltered = related.filter((r) => r.id !== article?.id).slice(0, 3);

  const sourceLang = article?.language || data?.lang?.slice(0, 2) || "en";
  // Target language: if user has picked an explicit language, translate to it
  // unless it matches the article's source. "Auto" = show source language.
  const targetLang = autoLanguage ? sourceLang : language;
  const { html, title: translatedTitle, isTranslating } = useTranslatedReader(
    data, targetLang, sourceLang
  );

  const [fontIdx, setFontIdx] = useState(1);
  const [sepia,   setSepia]   = useState(false);
  const rtl = isRtl(targetLang);
  const font = langFont(targetLang);

  const isSaved = article ? checkSaved(article.id) : false;

  // Modal a11y: scroll lock + Escape close + focus trap (with focus restore)
  const sheetRef = useRef(null);
  useBodyScrollLock(open);
  useEscapeKey(closeReader, open);
  useFocusTrap(sheetRef, open);

  const fontPx = FONT_SIZES[fontIdx].size;

  const handleShare = () => {
    if (!article) return;
    const network = navigator.share ? "native" : "copy";
    trackShare(article.id, network);
    if (navigator.share) {
      navigator.share({ title: article.title, url: article.url }).catch(() => {});
    } else {
      navigator.clipboard?.writeText(article.url);
    }
  };

  const handleSaveClick = () => {
    if (!article) return;
    toggleSave(article);
    trackSave(article.id, article.category);
  };

  const handleSourceClick = () => {
    if (!article) return;
    trackOutboundClick(article.id, article.category, article.url);
  };

  const handleRelatedClick = (rel) => {
    track("reader_open", { articleId: rel.id, category: rel.category, metadata: { via: "recirculation" } });
    openReader(rel);
  };

  return (
    <AnimatePresence>
      {open && article && (
        <motion.div
          key="reader-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[90] flex items-stretch justify-center bg-black/60 backdrop-blur-sm"
          onClick={closeReader}
        >
          <motion.div
            ref={sheetRef}
            key="reader-sheet"
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 24, opacity: 0 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={article?.title || "Article reader"}
            className={`relative w-full max-w-[780px] mx-auto my-0 sm:my-8 flex flex-col overflow-hidden shadow-2xl
                        ${sepia ? "bg-[#f7f1e3] text-[#3a2e1f]" : "bg-[var(--color-bg)] text-[var(--color-text)]"}
                        sm:rounded-2xl`}
          >
            {/* ── Top bar ── */}
            <div className="sticky top-0 z-10 flex items-center justify-between gap-2 px-4 py-3 border-b border-[var(--color-border)] bg-inherit">
              <button
                onClick={closeReader}
                className="p-2 rounded-full hover:bg-[var(--color-surface2)]"
                aria-label="Close reader"
              >
                <X size={18} />
              </button>

              <div className="flex items-center gap-1">
                {/* Translation indicator — small pill showing target language */}
                {sourceLang !== targetLang && (
                  <span
                    className="flex items-center gap-1 px-2 py-1 rounded-full bg-electric-50 text-electric-600 text-[10px] font-bold uppercase tracking-wider"
                    title={`Translated from ${nativeName(sourceLang)} to ${nativeName(targetLang)}`}
                  >
                    {isTranslating
                      ? <Loader2 size={11} className="animate-spin" />
                      : <Languages size={11} />}
                    {LANG_BY_CODE[targetLang]?.flag} {targetLang.toUpperCase()}
                  </span>
                )}
                <button
                  onClick={() => setFontIdx((i) => (i + 1) % FONT_SIZES.length)}
                  className="p-2 rounded-full hover:bg-[var(--color-surface2)]"
                  aria-label="Change font size"
                  title={`Font size: ${FONT_SIZES[fontIdx].id}`}
                >
                  <Type size={16} />
                </button>
                <button
                  onClick={() => setSepia((s) => !s)}
                  className={`p-2 rounded-full ${sepia ? "bg-amber-500/20" : "hover:bg-[var(--color-surface2)]"}`}
                  aria-label="Toggle sepia"
                >
                  <Sun size={16} />
                </button>
                <button
                  onClick={handleSaveClick}
                  className={`p-2 rounded-full ${isSaved ? "bg-electric-100 text-electric-700" : "hover:bg-[var(--color-surface2)]"}`}
                  aria-label="Save article"
                >
                  <Bookmark size={16} />
                </button>
                <button
                  onClick={handleShare}
                  className="p-2 rounded-full hover:bg-[var(--color-surface2)]"
                  aria-label="Share"
                >
                  <Share2 size={16} />
                </button>
                <a
                  href={article.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={handleSourceClick}
                  className="ml-1 flex items-center gap-1 text-xs font-semibold text-electric-600 hover:underline px-2 py-1 rounded whitespace-nowrap"
                >
                  <ExternalLink size={13} />
                  Source
                </a>
              </div>
            </div>

            {/* ── Body ── */}
            <div
              className="overflow-y-auto flex-1 px-5 sm:px-10 py-8"
              style={{ fontSize: fontPx, fontFamily: font, direction: rtl ? "rtl" : "ltr", textAlign: rtl ? "right" : "left" }}
              lang={targetLang}
            >
              {article.image_url && (
                <SafeImage
                  src={article.image_url}
                  alt=""
                  className="w-full rounded-xl mb-6 h-[280px] sm:h-[360px]"
                  imgClassName="w-full h-full object-cover"
                />
              )}

              <p className="text-xs uppercase tracking-wider opacity-60 mb-2">
                {article.source_name} · {article.category}
              </p>
              <h1 className="text-2xl sm:text-3xl font-bold leading-tight mb-4">
                {translatedTitle || data?.title || article.title}
              </h1>
              {(data?.byline || article.author) && (
                <p className="text-sm opacity-70 mb-6">
                  By {data?.byline || article.author}
                </p>
              )}

              {isLoading && (
                <div className="space-y-3 animate-pulse">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} className="h-4 rounded bg-[var(--color-surface2)]" style={{ width: `${80 + Math.random() * 20}%` }} />
                  ))}
                </div>
              )}

              {isError && (
                <div className="rounded-2xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-6 text-center space-y-3">
                  <div className="text-3xl">🔒</div>
                  <p className="font-semibold text-amber-900 dark:text-amber-200">
                    {error?.message || "Couldn't extract this article"}
                  </p>
                  <p className="text-sm text-amber-700 dark:text-amber-400">
                    {error?.hint || "This publisher restricts automated access. Read the full article directly."}
                  </p>
                  <a
                    href={article.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={handleSourceClick}
                    className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-full bg-electric-600 text-white text-sm font-semibold hover:bg-electric-700 transition-colors"
                  >
                    <ExternalLink size={13} />
                    Read on {new URL(article.url).hostname}
                  </a>
                </div>
              )}

              {/* Paywall preview banner — shown when backend fell back to meta-only */}
              {data?.isMeta && (
                <div className="flex items-start gap-3 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 mb-5 text-sm text-amber-800 dark:text-amber-300">
                  <span className="text-base shrink-0">🔒</span>
                  <div className="flex-1 min-w-0">
                    <span className="font-semibold">Preview only</span>
                    {" — "}this article is behind a paywall at{" "}
                    <a
                      href={article.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={handleSourceClick}
                      className="underline font-medium"
                    >
                      {new URL(article.url).hostname.replace(/^www\./, "")}
                    </a>
                    . The summary below is from public metadata.
                  </div>
                </div>
              )}

              {html && (
                <article
                  className="reader-body"
                  style={{ lineHeight: 1.7 }}
                  dangerouslySetInnerHTML={{ __html: html }}
                />
              )}

              {data?.length > 0 && (
                <p className="text-xs opacity-50 mt-10 pt-6 border-t border-[var(--color-border)]">
                  Extracted from {new URL(article.url).hostname} · approx {Math.max(1, Math.round(data.length / 1100))} min read ·{" "}
                  <a href={article.url} target="_blank" rel="noopener noreferrer" onClick={handleSourceClick} className="underline">original</a>
                </p>
              )}

              {/* After-article AdSense unit — highest-viewability placement;
                  only shown to free users once article content has rendered. */}
              {adSenseConfig?.enabled && html && (
                <div className="mt-8 pt-2">
                  <AdSenseUnit
                    slotName="inline"
                    config={adSenseConfig}
                    label="Ad"
                    format="auto"
                    minHeight={100}
                  />
                </div>
              )}

              {/* Continue reading — recirculation block. Raises pages-per-session
                  and gives us a second shot at monetizing the engaged reader. */}
              {relatedFiltered.length > 0 && (
                <section className="mt-10 pt-8 border-t border-[var(--color-border)]">
                  <h2 className="text-xs uppercase tracking-wider opacity-60 mb-4">
                    Continue reading · More in {article.category}
                  </h2>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {relatedFiltered.map((rel) => (
                      <button
                        key={rel.id}
                        onClick={() => handleRelatedClick(rel)}
                        className="text-left p-3 rounded-xl border border-[var(--color-border)] hover:border-electric-500 transition-colors group"
                      >
                        {rel.image_url && (
                          <SafeImage
                            src={rel.image_url}
                            alt=""
                            className="aspect-video rounded-lg mb-2"
                            imgClassName="w-full h-full object-cover group-hover:scale-105 transition-transform duration-normal ease-smooth"
                          />
                        )}
                        <p className="text-[10px] uppercase tracking-wider opacity-60 mb-1">
                          {rel.source_name}
                        </p>
                        <p className="text-sm font-semibold leading-snug line-clamp-3">
                          {rel.title}
                        </p>
                        <span className="inline-flex items-center gap-1 text-xs text-electric-600 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          Read <ArrowRight size={11} />
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {/* Inline newsletter signup — shown after article body to capture
                  readers at peak engagement. Hidden once they're subscribed. */}
              {!readSubToken() && (
                <div className="mt-8 pt-6 border-t border-[var(--color-border)]">
                  <NewsletterSignup compact source="reader_modal" />
                </div>
              )}

              {/* Reality Index — markets bound to this article's cluster.
                  Self-hides when no markets are matched, so it adds noise only
                  when it has something useful to say. */}
              {(!meterResult || meterResult.allowed) && article?.id && (
                <RealityIndexPanel articleId={article.id} />
              )}

              {/* AI Deep Dive — lazy analysis panel, only fires when expanded */}
              {html && article && (
                <ArticleDeepDive article={article} />
              )}

              {/* Support Scoop tip CTA — renders when Ko-fi is configured */}
              {publicConfig?.kofi?.url && (
                <div className="mt-8 pt-6 border-t border-[var(--color-border)]">
                  <TipJar compact kofiUrl={publicConfig.kofi.url} />
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
