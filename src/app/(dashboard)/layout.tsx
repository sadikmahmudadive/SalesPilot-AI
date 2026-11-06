import { DashboardProviders } from "@/components/dashboard/dashboard-providers";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { NoOrganization } from "@/components/dashboard/no-organization";
import { loadDashboardContext, redirectToExpiredSession } from "@/lib/auth/dashboard-context";

// Reads the session cookie via cookies(), so every request renders dynamically; nothing here is cached.

/**
 * Guard + chrome for every signed-in page.
 *  1. No valid session (missing, expired, revoked) -> /api/auth/expired, which clears the stale cookie
 *     and redirects to /login. A server component cannot delete cookies, and the proxy would otherwise
 *     bounce /login straight back here.
 *  2. Signed in without an organization -> an in-place panel (no redirect, so it cannot loop).
 *  3. Otherwise the shell. The role filtering of the nav is cosmetic; data access is enforced server-side.
 *
 * Layouts are not re-rendered on soft navigation, so this check runs on page loads, not every click.
 * Pages and APIs that touch data verify the session themselves.
 */
export default async function DashboardLayout({ children }: LayoutProps<"/">) {
  const ctx = await loadDashboardContext();
  if (ctx.status === "unauthenticated") return redirectToExpiredSession();

  if (ctx.status === "no-organization") {
    return (
      <DashboardProviders>
        <NoOrganization email={ctx.email} />
      </DashboardProviders>
    );
  }

  return (
    <DashboardProviders>
      <DashboardShell
        organizationName={ctx.organizationName}
        role={ctx.role}
        email={ctx.email}
        displayName={ctx.displayName}
      >
        {children}
      </DashboardShell>
    </DashboardProviders>
  );
}
