import { AuthShell } from "@/components/auth/auth-shell";

export default function OnboardingLayout({ children }: LayoutProps<"/">) {
  return <AuthShell>{children}</AuthShell>;
}
