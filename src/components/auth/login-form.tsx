"use client";

import { useState } from "react";
import Link from "next/link";
import { zodResolver } from "@hookform/resolvers/zod";
import { signInWithEmailAndPassword } from "firebase/auth";
import { useForm } from "react-hook-form";

import { AuthCardHeader, OrDivider } from "@/components/auth/auth-card-header";
import { FormAlert } from "@/components/auth/form-alert";
import { GoogleButton } from "@/components/auth/google-button";
import { SubmitButton } from "@/components/auth/submit-button";
import { TextField } from "@/components/auth/text-field";
import { useSession } from "@/hooks/use-session";
import { authErrorCode, mapAuthError } from "@/lib/auth/client-flow";
import { getFirebaseAuth } from "@/lib/firebase/client";
import { loginSchema, type LoginValues } from "@/schemas/auth";

type Pending = "password" | "google" | null;

const LINK_CLASS =
  "rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50";

export function LoginForm({ next }: { next?: string }) {
  const { completeSignIn } = useSession();
  const [pending, setPending] = useState<Pending>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const busy = pending !== null;

  async function onSubmit(values: LoginValues) {
    if (busy) return;
    setPending("password");
    setFormError(null);
    try {
      const credential = await signInWithEmailAndPassword(getFirebaseAuth(), values.email, values.password);
      const message = await completeSignIn(await credential.user.getIdToken(), next);
      if (message) {
        setFormError(message);
        setPending(null);
      }
    } catch (error) {
      setFormError(mapAuthError(authErrorCode(error)) || null);
      setPending(null);
    }
  }

  return (
    <div>
      <AuthCardHeader title="Welcome back" description="Sign in to your SalesPilot AI workspace." />
      <div className="space-y-5">
        <FormAlert message={formError} />
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
          <TextField
            label="Password"
            type="password"
            autoComplete="current-password"
            error={errors.password?.message}
            labelAction={
              <Link href="/forgot-password" className={`${LINK_CLASS} text-sm text-muted-foreground hover:text-foreground`}>
                Forgot password?
              </Link>
            }
            {...register("password")}
          />
          <SubmitButton loading={pending === "password"} disabled={busy}>
            Sign in
          </SubmitButton>
        </form>
        <OrDivider />
        <GoogleButton
          loading={pending === "google"}
          disabled={busy}
          onStart={() => {
            setPending("google");
            setFormError(null);
          }}
          onToken={(idToken) => completeSignIn(idToken, next)}
          onFail={(message) => {
            setFormError(message);
            setPending(null);
          }}
        />
        <p className="text-center text-sm text-muted-foreground">
          New to SalesPilot AI?{" "}
          <Link href="/register" className={`${LINK_CLASS} font-medium text-foreground`}>
            Create an account
          </Link>
        </p>
      </div>
    </div>
  );
}
