import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/** Placeholder rows shown on the first load; same footprint as a table (md+) and a card list (below md). */
export function ListSkeleton() {
  return (
    <div aria-hidden="true">
      <Card className="hidden gap-0 py-0 md:block">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex items-center gap-4 border-b px-4 py-4 last:border-b-0">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-5 w-24 rounded-4xl" />
            <Skeleton className="ml-auto h-4 w-24" />
          </div>
        ))}
      </Card>
      <div className="space-y-3 md:hidden">
        {Array.from({ length: 4 }, (_, i) => (
          <Card key={i} size="sm" className="gap-3 px-4">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-full" />
          </Card>
        ))}
      </div>
    </div>
  );
}
