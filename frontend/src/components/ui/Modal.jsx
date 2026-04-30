/**
 * ─── <Modal /> primitive ─────────────────────────────────────────────────
 * Accessible modal shell that owns the four boring concerns every dialog
 * shares so the consumer can focus on content:
 *
 *   1. Escape closes
 *   2. Body scroll lock
 *   3. Focus trap (with restore on close)
 *   4. Backdrop click closes (configurable)
 *
 * Plus consistent backdrop blur, fade+scale animation, and ARIA attrs.
 *
 * Usage:
 *   <Modal open={open} onClose={close} title="Sign in">
 *     <ModalBody>…</ModalBody>
 *     <ModalFooter>…</ModalFooter>
 *   </Modal>
 *
 *   <Modal open={open} onClose={close} variant="sheet" maxWidth="780px">
 *     …mobile sheet that takes full width on small screens…
 *   </Modal>
 */
import { useRef, useId } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import clsx from "clsx";
import { useEscapeKey, useBodyScrollLock, useFocusTrap } from "../../hooks/useModal";

const SIZE_CLASS = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-2xl",
  "2xl": "max-w-3xl",
};

const VARIANT_CLASS = {
  /* Centered card on desktop, bottom sheet on mobile */
  dialog: "items-end sm:items-center",
  /* Centered card on every breakpoint */
  centered: "items-center",
  /* Full-height sheet (ReaderModal style); content scrolls */
  sheet: "items-stretch",
};

export default function Modal({
  open,
  onClose,
  title,
  description,
  children,
  size = "md",
  variant = "dialog",
  hideClose = false,
  closeOnBackdrop = true,
  className = "",
  zIndex = 90,
  panelClassName = "",
  ariaLabel,
}) {
  const panelRef = useRef(null);
  const titleId = useId();
  const descId  = useId();

  useEscapeKey(onClose, open);
  useBodyScrollLock(open);
  useFocusTrap(panelRef, open);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className={clsx(
            "fixed inset-0 flex justify-center bg-black/60 backdrop-blur-sm p-4",
            VARIANT_CLASS[variant] || VARIANT_CLASS.dialog,
            className
          )}
          style={{ zIndex }}
          onClick={(e) => {
            if (closeOnBackdrop && e.target === e.currentTarget) onClose?.();
          }}
        >
          <motion.div
            ref={panelRef}
            key="modal-panel"
            initial={{ y: variant === "sheet" ? 24 : 16, scale: variant === "centered" ? 0.96 : 1, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: variant === "sheet" ? 24 : 16, scale: variant === "centered" ? 0.96 : 1, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            role="dialog"
            aria-modal="true"
            aria-label={!title ? ariaLabel : undefined}
            aria-labelledby={title ? titleId : undefined}
            aria-describedby={description ? descId : undefined}
            className={clsx(
              "relative w-full bg-[var(--color-bg)] text-[var(--color-text)]",
              "border border-[var(--color-border)] shadow-2xl overflow-hidden",
              variant === "sheet"
                ? "max-w-[780px] mx-auto my-0 sm:my-8 flex flex-col sm:rounded-2xl"
                : `${SIZE_CLASS[size] || SIZE_CLASS.md} rounded-t-2xl sm:rounded-2xl`,
              panelClassName
            )}
          >
            {!hideClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="absolute top-3 right-3 z-10 p-1.5 rounded-full
                           text-[var(--color-text-tertiary)] hover:text-[var(--color-text)]
                           hover:bg-[var(--color-surface2)]
                           focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-500/50"
              >
                <X size={18} />
              </button>
            )}

            {(title || description) && (
              <header className="px-6 pt-6 pb-3">
                {title && (
                  <h2 id={titleId} className="text-lg font-bold leading-tight">
                    {title}
                  </h2>
                )}
                {description && (
                  <p id={descId} className="text-xs text-[var(--color-text-tertiary)] mt-1">
                    {description}
                  </p>
                )}
              </header>
            )}

            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ── Slots for consumers who want the standard layout ────────────────────── */

export function ModalBody({ children, className = "" }) {
  return <div className={clsx("px-6 pb-6", className)}>{children}</div>;
}

export function ModalFooter({ children, className = "" }) {
  return (
    <footer className={clsx(
      "px-6 py-4 border-t border-[var(--color-border)] flex items-center justify-between gap-2",
      className
    )}>
      {children}
    </footer>
  );
}

export function ModalHeader({ children, className = "" }) {
  return (
    <header className={clsx(
      "px-6 pt-6 pb-3 flex items-center gap-3 border-b border-[var(--color-border)]",
      className
    )}>
      {children}
    </header>
  );
}
