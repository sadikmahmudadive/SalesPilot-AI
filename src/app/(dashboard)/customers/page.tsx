import type { Metadata } from "next";
import { Users } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent } from "@/components/ui/card";

export const metadata: Metadata = { title: "Customers" };

// TEMPORARY stub: replaced by the real customers page in Task 16.
export default function Page() {
  return (
    <div>
      <PageHeader title="Customers" />
      <Card className="border border-dashed shadow-none ring-0">
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center sm:py-16">
          <span className="flex size-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <Users className="size-5" aria-hidden="true" />
          </span>
          <p className="max-w-md text-sm text-muted-foreground">
            Customer records, contact details and conversation history will be listed here. This page is being built.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
