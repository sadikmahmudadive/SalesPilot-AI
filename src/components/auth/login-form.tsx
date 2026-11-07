"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { signInWithEmailAndPassword } from "firebase/auth";
import { useForm } from "react-hook-form";

import { AuthCardHeader, OrDivider } from "@/components/auth/auth-card-header";
import { AuthLink } from "@/components/auth/auth-link";
import { FormAlert } from "@/components/auth/form-alert";
import { GoogleButton } from "@/components/auth/google-button";
import { SubmitButton } from "@/components/auth/submit-button";
import { TextField } from "@/components/auth/text-field";
import { useAuthSubmission } from "@/hooks/use-auth-submission";
import { authErrorCode, mapAuthError } from "@/lib/auth/client-flow";
import { getFirebaseAuth } from "@/lib/firebase/client";
import { loginSchema, type LoginValues } from "@/schemas/auth";

export function LoginForm({ next }: { next?: string }) {
  const { pending, busy, formError, begin, fail, completeSignIn, googleProps } =
    useAuthSubmission(next);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  async function onSubmit(values: LoginValues) {
    if (!begin("password")) return;
    try {
      const credential = await signInWithEmailAndPassword(
        getFirebaseAuth(),
        values.email,
        values.password,
      );
      const message = await completeSignIn(await credential.user.getIdToken(), next);
      if (message) fail(message);
    } catch (error) {
      fail(mapAuthError(authErrorCode(error)));
    }
  }

  return (
    <div>
      <AuthCardHeader title="Welcome back" description="Sign in to your SalesPilot AI workspace." />
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
          <TextField
            label="Password"
            type="password"
            autoComplete="current-password"
            error={errors.password?.message}
            labelAction={
              <AuthLink
                href="/forgot-password"
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                Forgot password?
              </AuthLink>
            }
            {...register("password")}
          />
          <SubmitButton loading={pending === "password"} disabled={busy}>
            Sign in
          </SubmitButton>
        </form>
        <OrDivider />
        <GoogleButton {...googleProps} />
        <p className="text-center text-sm text-muted-foreground">
          New to SalesPilot AI?{" "}
          <AuthLink href="/register" className="font-medium text-foreground">
            Create an account
          </AuthLink>
        </p>
      </div>
    </div>
  );
}
