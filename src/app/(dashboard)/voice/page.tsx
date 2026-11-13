import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { VoiceConsole } from "@/components/voice/voice-console";
import { requireDashboardContext } from "@/lib/auth/dashboard-context";
import { can } from "@/lib/security/permissions";

export const metadata: Metadata = { title: "Voice Calls" };

export default async function VoicePage() {
  const ctx = await requireDashboardContext();
  if (!ctx) return null;
  if (!can(ctx.role, "voice:read")) {
    redirect("/");
  }
  return <VoiceConsole role={ctx.role} />;
}
