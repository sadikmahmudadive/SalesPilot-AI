import type { Metadata } from "next";
import { Inbox } from "lucide-react";

import { ComingLater } from "@/components/dashboard/coming-later";

export const metadata: Metadata = { title: "Unified Inbox" };

export default function Page() {
  return (
    <ComingLater
      phase={4}
      title="Unified Inbox"
      icon={Inbox}
      description="Every customer conversation from WhatsApp, Messenger, Instagram and email will arrive in one shared inbox, with AI-suggested replies and clear handoff to your team."
    />
  );
}
