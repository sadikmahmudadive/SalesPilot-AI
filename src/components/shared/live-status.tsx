"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A polite live-region message that is announced every time, even when the text is the same as the
 * last one (screen readers ignore an unchanged region). `announce` clears the region and sets the
 * message on a later tick. Render `<LiveStatus message={message} />` once.
 */
export function useAnnouncer() {
  const [message, setMessage] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const announce = useCallback((text: string) => {
    clearTimeout(timer.current);
    setMessage("");
    timer.current = setTimeout(() => setMessage(text), 50);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  return { message, announce };
}

/** The visually hidden live region for `useAnnouncer`. */
export function LiveStatus({ message }: { message: string }) {
  return (
    <p role="status" className="sr-only">
      {message}
    </p>
  );
}
