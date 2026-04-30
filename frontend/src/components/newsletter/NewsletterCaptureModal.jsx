/**
 * NewsletterCaptureModal — gently prompts for an email subscription once per
 * engaged session. Fires on whichever comes first:
 *   - exit-intent  (mouse leaves the top of the viewport, desktop only)
 *   - scroll depth 60%
 *   - 60 seconds of active page time
 *
 * Dismissal is sticky: once the user closes or subscribes, the modal stays
 * hidden for 30 days. Skipped entirely if the user is already subscribed.
 *
 * Modal mechanics owned by the shared <Modal /> primitive.
 */
import { useEffect, useRef, useState } from "react";
import NewsletterSignup from "./NewsletterSignup";
import { track } from "../../lib/track";
import Modal, { ModalBody } from "../ui/Modal";

const STORAGE_KEY = "scoop.newsletterCapture.dismissedAt";
const COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MIN_SESSION_MS = 15 * 1000;
const TIME_TRIGGER_MS = 60 * 1000;

function isDismissed() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const at = Number(raw) || 0;
    return Date.now() - at < COOLDOWN_MS;
  } catch { return false; }
}

function isAlreadySubscribed() {
  try { return Boolean(localStorage.getItem("scoop_sub_token")); }
  catch { return false; }
}

function markDismissed() {
  try { localStorage.setItem(STORAGE_KEY, String(Date.now())); } catch {}
}

export default function NewsletterCaptureModal() {
  const [open, setOpen] = useState(false);
  const shownRef = useRef(false);
  const mountedAtRef = useRef(Date.now());

  useEffect(() => {
    if (isDismissed() || isAlreadySubscribed()) return;

    const show = (reason) => {
      if (shownRef.current) return;
      if (Date.now() - mountedAtRef.current < MIN_SESSION_MS) return;
      shownRef.current = true;
      setOpen(true);
      track("newsletter_signup_start", { metadata: { source: "capture_modal", trigger: reason } });
    };

    const onMouseOut = (e) => {
      if (e.clientY <= 0 && !e.relatedTarget) show("exit_intent");
    };

    const onScroll = () => {
      const doc = document.documentElement;
      const pct = (window.scrollY + window.innerHeight) / Math.max(doc.scrollHeight, 1);
      if (pct > 0.6) show("scroll_60");
    };

    const timer = setTimeout(() => {
      if (document.visibilityState === "visible") show("time_60s");
    }, TIME_TRIGGER_MS);

    document.addEventListener("mouseout", onMouseOut);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      document.removeEventListener("mouseout", onMouseOut);
      window.removeEventListener("scroll", onScroll);
      clearTimeout(timer);
    };
  }, []);

  const dismiss = () => {
    setOpen(false);
    markDismissed();
  };

  return (
    <Modal
      open={open}
      onClose={dismiss}
      size="md"
      ariaLabel="Subscribe to the Scoopfeeds newsletter"
      zIndex={95}
    >
      <ModalBody className="pt-6">
        <div className="text-4xl mb-2">📰</div>
        <h2 className="text-xl font-bold leading-tight mb-2">
          Get Scoopfeeds in your inbox
        </h2>
        <p className="text-sm text-[var(--color-text-secondary)] mb-5">
          The day's biggest stories, curated and delivered at 7am your time.
          Free, and you can unsubscribe anytime.
        </p>
        <NewsletterSignup source="capture_modal" />
      </ModalBody>
    </Modal>
  );
}
