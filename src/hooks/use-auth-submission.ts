"use client";

import { useCallback, useRef, useState } from "react";

import { useSession } from "@/hooks/use-session";

export type AuthPending = "password" | "google" | null;

/**
 * Shared submit state for the login and register forms: which action is in flight, the
 * top-level error, a synchronous double-submit lock, and the Google button wiring.
 *
 * `begin()` takes the lock before any await (a ref, so two rapid events cannot both pass) and
 * returns false when an action is already running. Call `fail()` to release it on failure; on
 * success leave it held while the router navigates away.
 */
export function useAuthSubmission(next?: string, options: { onBegin?: () => void } = {}) {
  const { completeSignIn } = useSession();
  const { onBegin } = options;
  const lock = useRef(false);
  const [pending, setPending] = useState<AuthPending>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const begin = useCallback(
    (kind: Exclude<AuthPending, null>): boolean => {
      if (lock.current) return false;
      lock.current = true;
      setPending(kind);
      setFormError(null);
      onBegin?.();
      return true;
    },
    [onBegin],
  );

  const fail = useCallback((message: string | null) => {
    lock.current = false;
    setPending(null);
    setFormError(message);
  }, []);

  const googleProps = {
    loading: pending === "google",
    disabled: pending !== null,
    onStart: () => begin("google"),
    onToken: (idToken: string) => completeSignIn(idToken, next),
    onFail: fail,
  };

  return { pending, busy: pending !== null, formError, begin, fail, completeSignIn, googleProps };
}
