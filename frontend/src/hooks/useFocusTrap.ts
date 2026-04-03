import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Traps focus within a modal element and restores focus on unmount.
 * Also closes the modal on Escape key.
 */
export function useFocusTrap(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement;

    const el = ref.current;
    if (!el) return;

    // Focus the first focusable element inside the trap
    const focusableElements = el.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    if (focusableElements.length > 0) {
      focusableElements[0].focus();
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }

      if (e.key !== "Tab") return;

      const focusable = el.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    el.addEventListener("keydown", handleKeyDown);
    return () => {
      el.removeEventListener("keydown", handleKeyDown);
      // Restore focus to the element that triggered the modal
      previousFocusRef.current?.focus();
    };
  }, [onClose]);

  return ref;
}
