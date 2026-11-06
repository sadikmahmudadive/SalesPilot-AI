"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { createUserWithEmailAndPassword, updateProfile } from "firebase/auth";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { AuthCardHeader, OrDivider } from "@/components/auth/auth-card-header";
import { AuthLink } from "@/components/auth/auth-link";
import { FormAlert } from "@/components/auth/form-alert";
import { GoogleButton } from "@/components/auth/google-button";
import { SubmitButton } from "@/components/auth/submit-button";
import { TextField } from "@/components/auth/text-field";
import { useAuthSubmission } from "@/hooks/use-auth-submission";
import { registerAccount } from "@/lib/auth/client-flow";
import { getFirebaseAuth } from "@/lib/firebase/client";
import { registerSchema, type RegisterValues } from "@/schemas/auth";

export function RegisterForm({ next }: { next?: string }) {
  const router = useRouter();
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const { pending, busy, formError, begin, fail, googleProps } = useAuthSubmission(next, {
    onBegin: () => setNeedsSignIn(false),
  });
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { displayName: "", organizationName: "", email: "", password: "", confirmPassword: "" },
  });

  async function onSubmit(values: RegisterValues) {
    if (!begin("password")) return;
    const result = await registerAccount(
      {
        createUser: async (email, password) => (await createUserWithEmailAndPassword(getFirebaseAuth(), email, password)).user,
        updateProfile: (user, displayName) => updateProfile(user, { displayName }),
        getIdToken: (user) => user.getIdToken(),
        fetch,
      },
      { ...values, next },
    );

    switch (result.outcome) {
      case "success":
        router.replace(result.path);
        return;
      case "onboarding":
        // Account and session exist; let the user retry the organization step there.
        toast.error(result.message);
        router.replace("/onboarding");
        return;
      case "session-failed":
        setNeedsSignIn(true);
        fail(result.message);
        return;
      case "auth-failed":
        fail(result.message);
        return;
    }
  }

  return (
    <div>
      <AuthCardHeader title="Create your account" description="Set up your organization in under a minute." />
      <FormAlert message={formError}>
        {needsSignIn ? (
          <AuthLink href="/login" className="font-medium">
            Go to sign in
          </AuthLink>
        ) : null}
      </FormAlert>
      <div className="space-y-5">
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
        <GoogleButton {...googleProps} />
        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <AuthLink href="/login" className="font-medium text-foreground">
            Sign in
          </AuthLink>
        </p>
      </div>
    </div>
  );
}
