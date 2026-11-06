import type { Metadata } from "next";
import { Phone } from "lucide-react";

import { ComingLater } from "@/components/dashboard/coming-later";

export const metadata: Metadata = { title: "Voice Calls" };

export default function Page() {
  return (
    <ComingLater
      phase={6}
      title="Voice Calls"
      icon={Phone}
      description="Inbound and outbound AI voice calls, with transcripts, outcomes and recordings, will be managed from this section."
    />
  );
}
