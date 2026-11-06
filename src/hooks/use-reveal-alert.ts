"use client";

import { useEffect, useRef } from "react";

/**
 * For long forms whose error banner may be off-screen when a save fails: whenever `trigger`
 * becomes a new non-null value, scroll the element into view and move focus to it (give it
 * `tabIndex={-1}`). Smooth scrolling is skipped for people who prefer reduced motion.
 * Pass `null` (or leave `trigger` unchanged) when focus already went to a field.
 */
export function useRevealAlert<T extends object>(trigger: T | null) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!trigger || !el) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
    el.focus({ preventScroll: true });
  }, [trigger]);
  return ref;
}
