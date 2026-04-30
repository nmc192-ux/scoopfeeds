/**
 * <SafeImage /> — image with built-in loading skeleton + error fallback.
 *
 * Replaces the inline `imgError` state machine that used to live in NewsCard,
 * VideoCard, FeaturedCard, ReaderModal, and the SideCard renderer. All five
 * had the same shape (useState → onError → conditional render) reproduced
 * 5 different ways. This consolidates them.
 *
 * Container always renders at the requested aspect (or className-driven
 * dimensions) so a failed image doesn't collapse the layout.
 *
 * Props:
 *   src           — URL (string)
 *   alt           — alt text (required for non-decorative images)
 *   className     — applied to the outer wrapper (controls dimensions)
 *   imgClassName  — applied to the <img> itself (object-fit, etc.)
 *   fallback      — ReactNode rendered when src is missing or fails
 *                   (defaults to a brand-tinted ImageOff icon)
 *   showSkeleton  — show a shimmer skeleton while loading (default true)
 *   loading       — "lazy" | "eager" (default "lazy")
 *   onLoaded      — callback on successful load
 *   onErrored     — callback on load failure (use to swap layouts entirely)
 *
 * Examples:
 *   <SafeImage src={article.image_url} alt={article.title}
 *              className="aspect-video rounded-xl" />
 *
 *   <SafeImage src={video.thumbnail} alt=""
 *              className="w-full aspect-video"
 *              fallback={<YouTubeFallback />} />
 */
import { useEffect, useState } from "react";
import { ImageOff } from "lucide-react";
import clsx from "clsx";

export default function SafeImage({
  src,
  alt = "",
  className = "",
  imgClassName = "w-full h-full object-cover",
  fallback,
  showSkeleton = true,
  loading = "lazy",
  onLoaded,
  onErrored,
}) {
  const [state, setState] = useState(() => (src ? "loading" : "error"));

  // If src changes (e.g. user navigates between articles), reset state.
  useEffect(() => {
    setState(src ? "loading" : "error");
  }, [src]);

  const isError   = state === "error" || !src;
  const isLoading = state === "loading";

  return (
    <div className={clsx("relative overflow-hidden bg-[var(--color-surface2)]", className)}>
      {/* Skeleton shimmer while loading */}
      {showSkeleton && isLoading && (
        <div className="absolute inset-0 shimmer-bg" aria-hidden="true" />
      )}

      {/* The image itself — only render if we have a src */}
      {src && (
        <img
          src={src}
          alt={alt}
          loading={loading}
          onLoad={() => { setState("loaded"); onLoaded?.(); }}
          onError={() => { setState("error"); onErrored?.(); }}
          className={clsx(
            imgClassName,
            "transition-opacity duration-normal ease-smooth",
            isLoading || isError ? "opacity-0" : "opacity-100"
          )}
        />
      )}

      {/* Error fallback */}
      {isError && (
        <div className="absolute inset-0 flex items-center justify-center
                        bg-gradient-to-br from-electric-50 to-electric-100
                        dark:from-electric-950/40 dark:to-electric-900/40">
          {fallback ?? (
            <div className="flex flex-col items-center gap-1 text-electric-600 dark:text-electric-300">
              <ImageOff size={24} strokeWidth={1.5} />
              <span className="text-[10px] uppercase tracking-wider opacity-60">
                Image unavailable
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
