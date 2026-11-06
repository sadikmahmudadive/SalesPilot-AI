import { SEGMENT_LABELS, SEGMENT_VARIANTS } from "@/config/customer-labels";
import { Badge } from "@/components/ui/badge";
import type { CustomerSegment } from "@/schemas/customer";

export function SegmentBadge({ segment }: { segment: CustomerSegment }) {
  return <Badge variant={SEGMENT_VARIANTS[segment]}>{SEGMENT_LABELS[segment]}</Badge>;
}
