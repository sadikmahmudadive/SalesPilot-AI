import type { Metadata } from "next";

import { InboxShell } from "@/components/inbox/inbox-shell";
import { requireDashboardContext } from "@/lib/auth/dashboard-context";
import { textParam } from "@/lib/search-param";
import { can } from "@/lib/security/permissions";

export const metadata: Metadata = { title: "Unified Inbox" };

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireDashboardContext();
  if (!ctx) return null;
  const canWrite = can(ctx.role, "inbox:write");
  // `?q=` starts with that search; `?c=` opens that conversation (header search links).
  const sp = await searchParams;
  const initialSearch = textParam(sp.q);
  const initialConversationId = textParam(sp.c, 200) || null;
  return (
    <InboxShell
      key={`${initialSearch}|${initialConversationId ?? ""}`}
      canWrite={canWrite}
      initialSearch={initialSearch}
      initialConversationId={initialConversationId}
    />
  );
}
