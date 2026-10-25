/**
 * CollapsingImage — an image slot that disappears when its image does not load (#242).
 *
 * Publishers that block hotlinking (seen live 25 Oct: image.cnbcfm.com, investing.com)
 * answer the browser with an error or an empty image. A plain <img> then leaves an
 * empty box or the broken-image icon on a reader-facing page.
 *
 * <SafeImage /> keeps its container and shows an "Image unavailable" panel, which is
 * still a box. Under SITE_V2 the earn-render rule applies instead: an absent block is
 * correct, an empty container is not. So on failure the whole slot (wrapper included)
 * unmounts, and the caller's `fallback` (default: nothing) renders in its place; the
 * card's own category eyebrow and headline then carry it.
 *
 * Failure = the `error` event, or a load that finished with naturalWidth 0. Both are
 * also checked on mount, because a cached failure can settle before React's listener
 * is attached. No server fetch and no proxy (proxying publisher images is out of scope).
 */
import { useEffect, useRef, useState } from "react";

/** True when an <img> has finished and produced no pixels. Exported for tests. */
export function isBrokenImage(img) {
  return !!img && img.complete && img.naturalWidth === 0 && !!img.getAttribute("src");
}

export default function CollapsingImage({ src, alt = "", className = "", imgClassName = "", loading, fallback = null }) {
  const [failedSrc, setFailedSrc] = useState(null);
  const ref = useRef(null);
  const failed = !!src && failedSrc === src;   // a new src gets a fresh chance

  useEffect(() => {
    if (isBrokenImage(ref.current)) setFailedSrc(src);
  }, [src]);

  if (!src || failed) return fallback;
  return (
    <div className={className} data-image-slot="">
      <img
        ref={ref}
        src={src}
        alt={alt}
        loading={loading}
        className={imgClassName}
        onError={() => setFailedSrc(src)}
        onLoad={(e) => { if (e.currentTarget.naturalWidth === 0) setFailedSrc(src); }}
      />
    </div>
  );
}
