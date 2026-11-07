"use client";

import { useState } from "react";
import Link from "next/link";
import { zodResolver } from "@hookform/resolvers/zod";
import { sendPasswordResetEmail } from "firebase/auth";
import { MailCheck } from "lucide-react";
import { useForm } from "react-hook-form";

import { AuthCardHeader } from "@/components/auth/auth-card-header";
import { AuthLink } from "@/components/auth/auth-link";
import { FormAlert } from "@/components/auth/form-alert";
import { SubmitButton } from "@/components/auth/submit-button";
import { TextField } from "@/components/auth/text-field";
import { buttonVariants } from "@/components/ui/button";
import { authErrorCode, mapAuthError } from "@/lib/auth/client-flow";
import { getFirebaseAuth } from "@/lib/firebase/client";
import { cn } from "@/lib/utils";
import { forgotSchema, type ForgotValues } from "@/schemas/auth";

export function ForgotForm() {
  const [sent, setSent] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotValues>({
    resolver: zodResolver(forgotSchema),
    defaultValues: { email: "" },
  });

  async function onSubmit(values: ForgotValues) {
    setFormError(null);
    try {
      await sendPasswordResetEmail(getFirebaseAuth(), values.email);
      setSent(true);
    } catch (error) {
      const code = authErrorCode(error);
      // Never reveal whether an account exists: an unknown email looks exactly like success.
      if (code === "auth/user-not-found") {
        setSent(true);
        return;
      }
      setFormError(mapAuthError(code));
    }
  }

  if (sent) {
    return (
      <div className="space-y-6">
        <div className="space-y-3">
          <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <MailCheck className="size-5" aria-hidden="true" />
          </span>
          <h1 className="text-2xl font-semibold tracking-tight">Check your email</h1>
          <p role="status" className="text-sm text-muted-foreground">
            If an account exists for that email address, we have sent a link to reset your password.
          </p>
        </div>
        <Link
          href="/login"
          className={cn(buttonVariants({ variant: "outline", size: "lg" }), "w-full")}
        >
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <div>
      <AuthCardHeader
        title="Reset your password"
        description="Enter your email and we will send you a link to choose a new one."
      />
      <FormAlert message={formError} />
      <div className="space-y-5">
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
          <TextField
            label="Email"
            type="email"
            autoComplete="email"
            inputMode="email"
            placeholder="you@company.com"
            error={errors.email?.message}
            {...register("email")}
          />
          <SubmitButton loading={isSubmitting}>Send reset link</SubmitButton>
        </form>
        <p className="text-center text-sm text-muted-foreground">
          Remembered it?{" "}
          <AuthLink href="/login" className="font-medium text-foreground">
            Back to sign in
          </AuthLink>
        </p>
      </div>
    </div>
  );
}
