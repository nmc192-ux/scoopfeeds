import { useEffect, useMemo, useRef } from "react";
import clsx from "clsx";
import { adsenseConfig, getAdSlot, normalizeAdSenseConfig } from "../../config/adsense";

function ensureScriptLoaded(clientId) {
  if (typeof document === "undefined") return null;

  const existing = document.querySelector('script[data-scoop-adsense="true"]');
  if (existing) return existing;

  const script = document.createElement("script");
  script.async = true;
  script.crossOrigin = "anonymous";
  script.dataset.scoopAdsense = "true";
  script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(clientId)}`;
  document.head.appendChild(script);
  return script;
}

export function AdSenseUnit({
  slotName,
  config,
  className,
  label = "Advertisement",
  format = "auto",
  layout = undefined,
  style = {},
  minHeight = 0,
}) {
  const adRef = useRef(null);
  const resolvedConfig = useMemo(() => normalizeAdSenseConfig(config || adsenseConfig), [config]);
  const slot = useMemo(() => getAdSlot(slotName, resolvedConfig), [slotName, resolvedConfig]);

  useEffect(() => {
    if (!resolvedConfig.enabled || !resolvedConfig.clientId || !slot || !adRef.current) return;

    ensureScriptLoaded(resolvedConfig.clientId);

    const el = adRef.current;
    if (el.dataset.scoopAdsenseRendered === "true") return;

    const schedulePush = () => {
      if (!window.adsbygoogle) return;
      el.dataset.scoopAdsenseRendered = "true";
      try {
        (window.adsbygoogle = window.adsbygoogle || []).push({});
      } catch {}
    };

    if (window.adsbygoogle) {
      schedulePush();
      return;
    }

    const onLoad = () => schedulePush();
    const script = ensureScriptLoaded(resolvedConfig.clientId);
    script?.addEventListener("load", onLoad, { once: true });
    return () => script?.removeEventListener("load", onLoad);
  }, [slot, resolvedConfig]);

  if (!resolvedConfig.enabled || !resolvedConfig.clientId || !slot) return null;

  return (
    <div className={clsx("rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden", className)}>
      <div className="px-3 py-2 flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface2)]/60">
        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--color-text-tertiary)]">
          {label}
        </span>
        <span className="text-[10px] text-[var(--color-text-tertiary)]">Sponsored</span>
      </div>
      <div className="p-3">
        <ins
          ref={adRef}
          className="adsbygoogle block"
          style={{ display: "block", minHeight, ...style }}
          data-ad-client={resolvedConfig.clientId}
          data-ad-slot={slot}
          data-ad-format={format}
          data-full-width-responsive="true"
          data-adtest={resolvedConfig.testMode ? "on" : undefined}
          {...(layout ? { "data-ad-layout": layout } : {})}
        />
      </div>
    </div>
  );
}

export function AdSenseBanner(props) {
  return <AdSenseUnit {...props} minHeight={90} />;
}

export function AdSenseSidebar(props) {
  return <AdSenseUnit {...props} minHeight={250} />;
}
