import { z } from "zod";

const email = z
  .string()
  .trim()
  .min(1, "Enter your email address")
  .pipe(z.email("Enter a valid email address"));
const displayName = z
  .string()
  .trim()
  .min(1, "Enter your name")
  .max(80, "Use 80 characters or fewer");
const organizationName = z
  .string()
  .trim()
  .min(2, "Organization name must be at least 2 characters")
  .max(80, "Use 80 characters or fewer");

export const loginSchema = z.object({
  email,
  password: z.string().min(1, "Enter your password"),
});

export const registerSchema = z
  .object({
    displayName,
    organizationName,
    email,
    password: z
      .string()
      .min(10, "Use at least 10 characters")
      .max(128, "Use 128 characters or fewer"),
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export const forgotSchema = z.object({ email });

export const onboardingSchema = z.object({ displayName, organizationName });

export type LoginValues = z.infer<typeof loginSchema>;
export type RegisterValues = z.infer<typeof registerSchema>;
export type ForgotValues = z.infer<typeof forgotSchema>;
export type OnboardingValues = z.infer<typeof onboardingSchema>;
