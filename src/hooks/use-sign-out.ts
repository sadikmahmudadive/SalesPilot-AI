"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { signOut } from "firebase/auth";
import { toast } from "sonner";

import { GENERIC_ERROR, signOutEverywhere, signOutNavigation } from "@/lib/auth/client-flow";
import { getFirebaseAuth } from "@/lib/firebase/client";

/**
 * Signs out of the server session and Firebase, drops cached query data, then navigates to /login.
 * Navigation is decided by the pure `signOutNavigation`: a failed server DELETE hard-navigates through
 * /api/auth/expired (clears the cookie) instead of /login, which the proxy would bounce back.
 */
export function useSignOut() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);

  const run = useCallback(async () => {
    if (pending) return;
    setPending(true);
    try {
      const result = await signOutEverywhere({
        fetch,
        firebaseSignOut: () => signOut(getFirebaseAuth()),
      });
      queryClient.clear();
      const nav = signOutNavigation(result);
      if (nav.toast) toast.error(nav.toast);
      if (nav.kind === "assign") window.location.assign(nav.url);
      else router.replace(nav.url);
      // Stay "pending" while navigating so the button cannot be double-clicked.
    } catch {
      // Unexpected failure before any navigation: let the user try again.
      toast.error(GENERIC_ERROR);
      setPending(false);
    }
  }, [pending, queryClient, router]);

  return { signOut: run, pending };
}
