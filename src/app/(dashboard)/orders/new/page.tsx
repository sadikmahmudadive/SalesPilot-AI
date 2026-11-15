import type { Metadata } from "next";
import { Lock } from "lucide-react";

import { PlaceholderCard } from "@/components/dashboard/placeholder-card";
import { OrderForm } from "@/components/orders/order-form";
import { BackLink } from "@/components/shared/back-link";
import { requireDashboardContext } from "@/lib/auth/dashboard-context";
import { can } from "@/lib/security/permissions";

export const metadata: Metadata = { title: "New order" };

export default async function NewOrderPage() {
  const ctx = await requireDashboardContext();
  if (!ctx) return null;
  if (!can(ctx.role, "orders:write")) {
    return (
      <div>
        <BackLink href="/orders">All orders</BackLink>
        <PlaceholderCard icon={Lock} heading="You cannot create orders">
          Your role can view orders but not create them. Ask an owner or admin for access.
        </PlaceholderCard>
      </div>
    );
  }
  return <OrderForm />;
}
