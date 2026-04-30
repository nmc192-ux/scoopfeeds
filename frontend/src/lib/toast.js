/**
 * ─── Toast store + useToast() ────────────────────────────────────────────
 * Zustand-style minimal store with a tiny imperative API. Mount a single
 * <ToastViewport /> at the app root and call `toast.success(...)` etc.
 * from anywhere — no provider/context needed.
 *
 * Variants: success | error | info | warning
 * Default duration: 4s. Pass `duration: 0` to make a toast sticky.
 *
 * Usage:
 *   import { toast } from "@/lib/toast";
 *   toast.success("Saved!");
 *   toast.error("Couldn't fetch", { action: { label: "Retry", onClick: refetch } });
 */
import { useSyncExternalStore } from "react";

const listeners = new Set();
let toasts = [];
let nextId = 1;

function notify() {
  for (const l of listeners) l();
}

function subscribe(l) {
  listeners.add(l);
  return () => listeners.delete(l);
}

function push(variant, message, opts = {}) {
  const id = nextId++;
  const duration = opts.duration ?? 4000;
  const t = {
    id,
    variant,
    message,
    icon:    opts.icon,
    action:  opts.action,
    duration,
    createdAt: Date.now(),
  };
  toasts = [...toasts, t];
  notify();
  if (duration > 0) {
    setTimeout(() => dismiss(id), duration);
  }
  return id;
}

export function dismiss(id) {
  const before = toasts.length;
  toasts = toasts.filter((t) => t.id !== id);
  if (toasts.length !== before) notify();
}

export function dismissAll() {
  if (toasts.length === 0) return;
  toasts = [];
  notify();
}

/* ── Imperative API ─────────────────────────────────────────────────────── */
export const toast = {
  success: (message, opts) => push("success", message, opts),
  error:   (message, opts) => push("error",   message, opts),
  info:    (message, opts) => push("info",    message, opts),
  warning: (message, opts) => push("warning", message, opts),
  dismiss,
  dismissAll,
};

/* ── React hook ─────────────────────────────────────────────────────────── */
export function useToasts() {
  return useSyncExternalStore(subscribe, () => toasts, () => toasts);
}
