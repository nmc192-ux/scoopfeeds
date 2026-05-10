import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { X, Zap } from "lucide-react";
import { useFeatured } from "../../hooks/useNews";
import { useNewsStore } from "../../store/newsStore";

// TV-news-style horizontal marquee. All matching headlines concatenated
// into one continuous right-to-left scrolling track. CSS-driven (transform
// + animation) for performance; React handles only the dismiss state and
// reduced-motion preference.
//
// Filter: same as the prior single-item banner — articles published in the
// last 2 hours with credibility >= 9. Typically 0-3 of the 7 featured items
// pass.
//
//   0 matches  → render nothing
//   1 match    → render statically (no scroll, just the headline)
//   2+ matches → continuous scrolling marquee
//   reduced-motion → render only the first match statically

const SPEED_PX_PER_SEC = 65; // target scroll speed
const MIN_DURATION_S = 20;   // floor — short content shouldn't scroll too fast

export default function BreakingBanner() {
  const { data: featured = [] } = useFeatured();
  const [dismissed, setDismissed] = useState(false);
  const isUrdu = useNewsStore((s) => s.language === "ur");

  // Filter to fresh + high-credibility articles.
  const items = useMemo(() => {
    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
    return featured.filter(
      (a) => a && a.published_at > twoHoursAgo && (a.credibility ?? 0) >= 9
    );
  }, [featured]);

  // Reduced-motion preference (pause autorotate; show only first item).
  const [reducedMotion, setReducedMotion] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const listener = (e) => setReducedMotion(e.matches);
    mq.addEventListener("change", listener);
    return () => mq.removeEventListener("change", listener);
  }, []);

  const shouldScroll = items.length >= 2 && !reducedMotion;

  // Measure track width to compute animation duration so scroll speed is
  // a consistent ~65 px/sec regardless of headline count or screen width.
  const trackRef = useRef(null);
  const [animationDuration, setAnimationDuration] = useState(MIN_DURATION_S);
  useLayoutEffect(() => {
    if (!shouldScroll || !trackRef.current) return;
    // Track contains 2 copies of the items (for seamless looping).
    // Animation translates by 50% of track width, which equals one copy.
    const halfWidth = trackRef.current.scrollWidth / 2;
    const seconds = Math.max(MIN_DURATION_S, halfWidth / SPEED_PX_PER_SEC);
    setAnimationDuration(seconds);
  }, [items, shouldScroll]);

  if (dismissed || items.length === 0) return null;

  // Render one item as: <a> Title — Source </a><span> • </span>
  // The trailing bullet joins this item to the next; on the loop seam,
  // the last bullet of copy A joins seamlessly to the first item of copy B
  // (which is identical content to copy A, so the visual is continuous).
  const renderItem = (a, isDup) => (
    <>
      <a
        href={a.url}
        target="_blank"
        rel="noopener noreferrer"
        tabIndex={isDup ? -1 : undefined}
        className="text-sm font-semibold hover:underline"
      >
        {a.title}
        <span className="opacity-80 font-normal"> — {a.source_name}</span>
      </a>
      <span className="opacity-60 px-2 select-none" aria-hidden="true">
        •
      </span>
    </>
  );

  return (
    <>
      {/* Inline keyframes + marquee styles. Co-located with the component
          to satisfy the one-file constraint and to keep the animation
          parameters (timing function, play-state on hover/focus) discoverable
          alongside the markup that uses them. */}
      <style>{`
        @keyframes breaking-banner-marquee {
          from { transform: translate3d(0, 0, 0); }
          to   { transform: translate3d(-50%, 0, 0); }
        }
        .breaking-banner-marquee__track {
          display: inline-flex;
          align-items: center;
          white-space: nowrap;
          animation-name: breaking-banner-marquee;
          animation-timing-function: linear;
          animation-iteration-count: infinite;
          will-change: transform;
        }
        .breaking-banner-marquee:hover .breaking-banner-marquee__track,
        .breaking-banner-marquee:focus-within .breaking-banner-marquee__track {
          animation-play-state: paused;
        }
      `}</style>

      <div className="block bg-gradient-to-r from-electric-800 via-electric-600 to-electric-800 text-white relative overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2.5 flex items-center gap-3">
          {/* Static BREAKING pill */}
          <span className="flex items-center gap-1.5 flex-shrink-0 font-extrabold text-xs uppercase tracking-wider bg-scoop-orange-500 px-2 py-0.5 rounded shadow-sm">
            <Zap size={12} className="fill-white" />
            {isUrdu ? "تازہ ترین" : "Breaking"}
          </span>

          {shouldScroll ? (
            // Marquee container. dir="ltr" isolates the inner scroll
            // direction from any RTL parent (Urdu mode) — the marquee
            // always scrolls right-to-left regardless of locale.
            <div
              className="breaking-banner-marquee flex-1 min-w-0 overflow-hidden"
              dir="ltr"
              aria-label={isUrdu ? "تازہ ترین خبریں" : "Breaking news ticker"}
            >
              <div
                ref={trackRef}
                className="breaking-banner-marquee__track"
                style={{ animationDuration: `${animationDuration}s` }}
              >
                {/* First (canonical) copy of items — accessible to a11y and tab order. */}
                {items.map((a) => (
                  <span key={`a-${a.id}`} className="inline-flex items-center">
                    {renderItem(a, false)}
                  </span>
                ))}
                {/* Duplicate copy purely for seamless looping; hidden from
                    a11y tree and tab order so screen readers don't double-read
                    and keyboards don't double-visit. */}
                {items.map((a) => (
                  <span
                    key={`b-${a.id}`}
                    className="inline-flex items-center"
                    aria-hidden="true"
                  >
                    {renderItem(a, true)}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            // Static single-item view — used when only 1 item passes the
            // filter, or when prefers-reduced-motion is set.
            <a
              href={items[0].url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 flex-1 min-w-0 group"
            >
              <span className="text-sm font-semibold truncate flex-1 group-hover:underline">
                {items[0].title}
              </span>
              <span className="hidden sm:inline text-xs opacity-80 flex-shrink-0">
                {items[0].source_name}
              </span>
            </a>
          )}

          {/* Static dismiss — outside the marquee so it doesn't scroll past. */}
          <button
            onClick={() => setDismissed(true)}
            aria-label="Dismiss"
            className="flex-shrink-0 w-6 h-6 rounded-full hover:bg-white/20 flex items-center justify-center"
          >
            <X size={14} />
          </button>
        </div>
      </div>
    </>
  );
}
