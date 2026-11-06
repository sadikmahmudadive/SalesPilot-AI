import type { Metadata } from "next";
import { Plug } from "lucide-react";

import { ComingLater } from "@/components/dashboard/coming-later";

export const metadata: Metadata = { title: "Integrations" };

export default function Page() {
  return (
    <ComingLater
      phase={8}
      title="Integrations"
      icon={Plug}
      description="Connect messaging channels, payment and delivery providers, and manage their credentials and health from this page."
    />
  );
}
