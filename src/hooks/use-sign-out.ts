"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { signOut } from "firebase/auth";
import { toast } from "sonner";

import { signOutEverywhere } from "@/lib/auth/client-flow";
import { getFirebaseAuth } from "@/lib/firebase/client";

/**
 * Signs out of the server session and Firebase, drops cached query data, then navigates to /login.
 * A partial failure shows a toast but still navigates (see `signOutEverywhere`).
 */
export function useSignOut() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);

  const run = useCallback(async () => {
    if (pending) return;
    setPending(true);
    const result = await signOutEverywhere({
      fetch,
      firebaseSignOut: () => signOut(getFirebaseAuth()),
    });
    queryClient.clear();
    if (!result.ok) toast.error(result.message);
    router.replace("/login");
    // Stay "pending" while navigating so the button cannot be double-clicked.
  }, [pending, queryClient, router]);

  return { signOut: run, pending };
}
