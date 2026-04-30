/**
 * ─── Modal a11y hooks ────────────────────────────────────────────────────
 * Three small hooks that handle the boring-but-essential modal mechanics.
 * Compose them in the <Modal /> primitive (or call directly from a custom
 * sheet like ReaderModal that needs its own layout).
 *
 *   useEscapeKey(onEscape, enabled)
 *   useBodyScrollLock(locked)
 *   useFocusTrap(ref, active)
 *
 * Together they satisfy WCAG 2.1.2 (No keyboard trap), 2.4.3 (Focus order),
 * 2.4.7 (Focus visible) and SC 1.4.13 (Hover content dismissable).
 */
import { useEffect, useRef } from "react";

/* ── Escape closes the modal ─────────────────────────────────────────────── */
export function useEscapeKey(onEscape, enabled = true) {
  useEffect(() => {
    if (!enabled || typeof onEscape !== "function") return;
    const onKey = (e) => { if (e.key === "Escape") onEscape(e); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, onEscape]);
}

/* ── Lock body scroll while modal is open ───────────────────────────────── */
export function useBodyScrollLock(locked = true) {
  useEffect(() => {
    if (!locked) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [locked]);
}

/* ── Focus trap: keep keyboard focus inside the modal ───────────────────── */
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function useFocusTrap(containerRef, active = true) {
  // Remember what was focused before opening so we can restore it on close
  const lastFocusedRef = useRef(null);

  useEffect(() => {
    if (!active || !containerRef.current) return;
    const container = containerRef.current;
    lastFocusedRef.current = document.activeElement;

    // Move focus to the first focusable element on open.
    const focusable = container.querySelectorAll(FOCUSABLE_SELECTOR);
    if (focusable.length > 0) {
      requestAnimationFrame(() => focusable[0].focus());
    } else {
      container.setAttribute("tabindex", "-1");
      container.focus();
    }

    const onKey = (e) => {
      if (e.key !== "Tab") return;
      const items = container.querySelectorAll(FOCUSABLE_SELECTOR);
      if (items.length === 0) return;
      const first = items[0];
      const last  = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    container.addEventListener("keydown", onKey);
    return () => {
      container.removeEventListener("keydown", onKey);
      // Restore focus to whatever opened the modal, if it still exists.
      if (lastFocusedRef.current?.focus) {
        try { lastFocusedRef.current.focus(); } catch {}
      }
    };
  }, [active, containerRef]);
}
