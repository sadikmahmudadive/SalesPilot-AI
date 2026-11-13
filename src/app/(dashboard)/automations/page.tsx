import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AutomationsConsole } from "@/components/automations/automations-console";
import { requireDashboardContext } from "@/lib/auth/dashboard-context";
import { can } from "@/lib/security/permissions";

export const metadata: Metadata = { title: "Automations" };

export default async function AutomationsPage() {
  const ctx = await requireDashboardContext();
  if (!ctx) return null;
  if (!can(ctx.role, "automations:read")) {
    redirect("/");
  }
  return <AutomationsConsole role={ctx.role} />;
}
