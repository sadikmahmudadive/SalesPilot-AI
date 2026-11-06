import type { Metadata } from "next";
import { ShoppingCart } from "lucide-react";

import { ComingLater } from "@/components/dashboard/coming-later";

export const metadata: Metadata = { title: "Orders" };

export default function Page() {
  return (
    <ComingLater
      phase={5}
      title="Orders"
      icon={ShoppingCart}
      description="Orders created from conversations will be tracked here from request to fulfilment, linked to the customer and the products involved."
    />
  );
}
