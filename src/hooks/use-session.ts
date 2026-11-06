"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";

import { resolvePostSignIn } from "@/lib/auth/client-flow";
import { safeNextPath } from "@/lib/auth/redirect";

/**
 * Client helper for finishing a sign-in. Exchanges the Firebase ID token for the session
 * cookie, then navigates: members go to the (validated) `next` path, users without an
 * organization go to onboarding. Returns an error message to show, or null when navigating.
 */
export function useSession() {
  const router = useRouter();

  const completeSignIn = useCallback(
    async (idToken: string, next?: string | null): Promise<string | null> => {
      const result = await resolvePostSignIn(idToken, fetch);
      if (result.to === "error") return result.message;
      router.replace(result.to === "app" ? safeNextPath(next) : "/onboarding");
      return null;
    },
    [router],
  );

  return { completeSignIn };
}
