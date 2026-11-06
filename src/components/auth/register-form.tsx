"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { createUserWithEmailAndPassword, updateProfile } from "firebase/auth";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { AuthCardHeader, OrDivider } from "@/components/auth/auth-card-header";
import { FormAlert } from "@/components/auth/form-alert";
import { GoogleButton } from "@/components/auth/google-button";
import { SubmitButton } from "@/components/auth/submit-button";
import { TextField } from "@/components/auth/text-field";
import { useSession } from "@/hooks/use-session";
import { authErrorCode, exchangeSession, mapAuthError, registerOrganizationRequest } from "@/lib/auth/client-flow";
import { safeNextPath } from "@/lib/auth/redirect";
import { getFirebaseAuth } from "@/lib/firebase/client";
import { registerSchema, type RegisterValues } from "@/schemas/auth";

type Pending = "password" | "google" | null;

const LINK_CLASS =
  "rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50";

export function RegisterForm({ next }: { next?: string }) {
  const router = useRouter();
  const { completeSignIn } = useSession();
  const [pending, setPending] = useState<Pending>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { displayName: "", organizationName: "", email: "", password: "", confirmPassword: "" },
  });

  const busy = pending !== null;

  async function onSubmit(values: RegisterValues) {
    if (busy) return;
    setPending("password");
    setFormError(null);
    setNeedsSignIn(false);

    // Step 1: create the Firebase user. A failure here means no account exists yet.
    let idToken: string;
    try {
      const credential = await createUserWithEmailAndPassword(getFirebaseAuth(), values.email, values.password);
      try {
        await updateProfile(credential.user, { displayName: values.displayName });
      } catch {
        // Cosmetic only; the display name is also sent with the organization registration.
      }
      idToken = await credential.user.getIdToken();
    } catch (error) {
      setFormError(mapAuthError(authErrorCode(error)) || null);
      setPending(null);
      return;
    }

    // Step 2: session cookie. The account exists now, so a failure must not invite a re-register.
    const session = await exchangeSession(idToken, fetch);
    if (session.status !== "ok") {
      setFormError(`Your account was created, but we could not sign you in. ${session.message}`);
      setNeedsSignIn(true);
      setPending(null);
      return;
    }

    // Step 3: organization. On failure, send the user to onboarding (session exists) to retry.
    const org = await registerOrganizationRequest(
      { organizationName: values.organizationName, displayName: values.displayName },
      fetch,
    );
    if (org.status === "created" || org.status === "exists") {
      router.replace(safeNextPath(next));
      return;
    }
    toast.error("Your account was created, but we could not set up your organization. Please finish setup to continue.");
    router.replace("/onboarding");
  }

  return (
    <div>
      <AuthCardHeader title="Create your account" description="Set up your organization in under a minute." />
      <div className="space-y-5">
        <FormAlert message={formError}>
          {needsSignIn ? (
            <Link href="/login" className={`${LINK_CLASS} font-medium`}>
              Go to sign in
            </Link>
          ) : null}
        </FormAlert>
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
          <TextField
            label="Email"
            type="email"
            autoComplete="email"
            inputMode="email"
            placeholder="you@company.com"
            error={errors.email?.message}
            {...register("email")}
          />
          <TextField
            label="Password"
            type="password"
            autoComplete="new-password"
            placeholder="At least 10 characters"
            error={errors.password?.message}
            {...register("password")}
          />
          <TextField
            label="Confirm password"
            type="password"
            autoComplete="new-password"
            error={errors.confirmPassword?.message}
            {...register("confirmPassword")}
          />
          <SubmitButton loading={pending === "password"} disabled={busy}>
            Create account
          </SubmitButton>
        </form>
        <OrDivider />
        <GoogleButton
          loading={pending === "google"}
          disabled={busy}
          onStart={() => {
            setPending("google");
            setFormError(null);
            setNeedsSignIn(false);
          }}
          onToken={(idToken) => completeSignIn(idToken, next)}
          onFail={(message) => {
            setFormError(message);
            setPending(null);
          }}
        />
        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link href="/login" className={`${LINK_CLASS} font-medium text-foreground`}>
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
