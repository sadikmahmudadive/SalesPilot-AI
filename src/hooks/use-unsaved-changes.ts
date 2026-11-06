"use client";

import { useEffect } from "react";

/**
 * Asks the browser to confirm before the page is closed, reloaded or navigated away from by the
 * address bar while `active` is true. (In-app route changes are not covered by `beforeunload`;
 * screens confirm those themselves where they control the navigation.)
 */
export function useBeforeUnloadGuard(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = ""; // required by some browsers to show the prompt
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [active]);
}
