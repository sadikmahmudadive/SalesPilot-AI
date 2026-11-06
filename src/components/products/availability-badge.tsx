import { Badge } from "@/components/ui/badge";
import { AVAILABILITY_LABELS, AVAILABILITY_VARIANTS } from "@/config/product-labels";
import type { Availability } from "@/schemas/product";

export function AvailabilityBadge({ availability }: { availability: Availability }) {
  return <Badge variant={AVAILABILITY_VARIANTS[availability]}>{AVAILABILITY_LABELS[availability]}</Badge>;
}
