import type { Metadata } from "next";
import { Boxes } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent } from "@/components/ui/card";

export const metadata: Metadata = { title: "Products" };

// TEMPORARY stub: replaced by the real products page in Task 19.
export default function Page() {
  return (
    <div>
      <PageHeader title="Products" />
      <Card className="border border-dashed shadow-none ring-0">
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center sm:py-16">
          <span className="flex size-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <Boxes className="size-5" aria-hidden="true" />
          </span>
          <p className="max-w-md text-sm text-muted-foreground">
            Your product catalogue, prices and images will be managed here. This page is being built.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
