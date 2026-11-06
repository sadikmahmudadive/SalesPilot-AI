"use client";

import { GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { authErrorCode, isSilentAuthError, mapAuthError } from "@/lib/auth/client-flow";
import { getFirebaseAuth } from "@/lib/firebase/client";

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4 fill-current">
      <path d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z" />
    </svg>
  );
}

/**
 * Opens the Google popup and hands the fresh ID token to `onToken` (which returns an error
 * message, or null when it is navigating away). `onStart` clears the parent's error and marks it
 * pending; `onFail` is called only on failure (message null = failed silently, e.g. popup closed)
 * so the parent can show the banner and re-enable the form. On success nothing more is called.
 */
export function GoogleButton({
  loading,
  disabled,
  onStart,
  onToken,
  onFail,
}: {
  loading: boolean;
  disabled: boolean;
  onStart: () => void;
  onToken: (idToken: string) => Promise<string | null>;
  onFail: (message: string | null) => void;
}) {
  async function handleClick() {
    onStart();
    try {
      const credential = await signInWithPopup(getFirebaseAuth(), new GoogleAuthProvider());
      const message = await onToken(await credential.user.getIdToken());
      if (message) onFail(message);
    } catch (error) {
      const code = authErrorCode(error);
      onFail(isSilentAuthError(code) ? null : mapAuthError(code));
    }
  }

  return (
    <Button type="button" variant="outline" size="lg" className="w-full" disabled={disabled} onClick={handleClick}>
      {loading ? <Loader2 className="animate-spin" aria-hidden="true" /> : <GoogleMark />}
      Continue with Google
    </Button>
  );
}
