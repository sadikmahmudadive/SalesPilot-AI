import type { Metadata } from "next";

import { InboxShell } from "@/components/inbox/inbox-shell";
import { requireDashboardContext } from "@/lib/auth/dashboard-context";
import { can } from "@/lib/security/permissions";

export const metadata: Metadata = { title: "Unified Inbox" };

export default async function InboxPage() {
  const ctx = await requireDashboardContext();
  if (!ctx) return null;
  const canWrite = can(ctx.role, "inbox:write");
  return <InboxShell canWrite={canWrite} />;
}
