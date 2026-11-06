"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { signOut } from "firebase/auth";
import { Loader2 } from "lucide-react";
import { useForm } from "react-hook-form";

import { AuthCardHeader } from "@/components/auth/auth-card-header";
import { FormAlert } from "@/components/auth/form-alert";
import { SubmitButton } from "@/components/auth/submit-button";
import { TextField } from "@/components/auth/text-field";
import { Button } from "@/components/ui/button";
import { endSession, fetchMe, registerOrganizationRequest } from "@/lib/auth/client-flow";
import { getFirebaseAuth } from "@/lib/firebase/client";
import { onboardingSchema, type OnboardingValues } from "@/schemas/auth";

type Phase = "checking" | "ready";

/** Best-effort prefill from the Firebase user: display name, else the email local part. */
async function suggestedDisplayName(): Promise<string> {
  try {
    const auth = getFirebaseAuth();
    await auth.authStateReady();
    const user = auth.currentUser;
    if (!user) return "";
    return user.displayName?.trim() || user.email?.split("@")[0] || "";
  } catch {
    return "";
  }
}

export function OnboardingForm() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("checking");
  const [formError, setFormError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [navigating, setNavigating] = useState(false);
  const {
    register,
    handleSubmit,
    setValue,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<OnboardingValues>({
    resolver: zodResolver(onboardingSchema),
    defaultValues: { displayName: "", organizationName: "" },
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const me = await fetchMe(fetch);
      if (cancelled) return;
      if (me.status === "ok") {
        router.replace("/dashboard");
        return;
      }
      if (me.status === "unauthenticated") {
        // Drop any stale cookie first, otherwise the proxy would bounce /login straight back.
        await endSession(fetch);
        if (!cancelled) router.replace("/login?next=%2Fonboarding");
        return;
      }
      if (me.status !== "no_organization") setFormError(me.message);
      const name = await suggestedDisplayName();
      if (cancelled) return;
      if (name && !getValues("displayName")) setValue("displayName", name);
      setPhase("ready");
    })();
    return () => {
      cancelled = true;
    };
  }, [router, setValue, getValues]);

  async function onSubmit(values: OnboardingValues) {
    setFormError(null);
    const result = await registerOrganizationRequest(values, fetch);
    if (result.status === "created" || result.status === "exists") {
      setNavigating(true);
      router.replace("/dashboard");
      return;
    }
    if (result.status === "unauthenticated") {
      setNavigating(true);
      await endSession(fetch);
      router.replace("/login?next=%2Fonboarding");
      return;
    }
    setFormError(result.message);
  }

  async function useDifferentAccount() {
    setLeaving(true);
    await endSession(fetch);
    try {
      await signOut(getFirebaseAuth());
    } catch {
      // The server session is already cleared; nothing else to do.
    }
    router.replace("/login");
  }

  if (phase === "checking") {
    return (
      <div role="status" className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Checking your account...
      </div>
    );
  }

  return (
    <div>
      <AuthCardHeader
        title="Set up your organization"
        description="One last step. Name your workspace to get started."
      />
      <div className="space-y-5">
        <FormAlert message={formError} />
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
          <TextField
            label="Your name"
            autoComplete="name"
            placeholder="Ada Lovelace"
            error={errors.displayName?.message}
            {...register("displayName")}
          />
          <TextField
            label="Organization name"
            autoComplete="organization"
            placeholder="Acme Trading"
            error={errors.organizationName?.message}
            {...register("organizationName")}
          />
          <SubmitButton loading={isSubmitting || navigating} disabled={leaving}>
            Continue
          </SubmitButton>
        </form>
        <p className="text-center text-sm text-muted-foreground">
          Not you?{" "}
          <Button
            type="button"
            variant="link"
            className="h-auto p-0 text-foreground"
            disabled={isSubmitting || navigating || leaving}
            onClick={useDifferentAccount}
          >
            Use a different account
          </Button>
        </p>
      </div>
    </div>
  );
}
