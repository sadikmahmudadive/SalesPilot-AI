import { Badge } from "@/components/ui/badge";

/** Up to `max` tag badges plus a "+N" overflow count. */
export function CustomerTags({ tags, max = 3 }: { tags: readonly string[]; max?: number }) {
  if (tags.length === 0) return null;
  const shown = tags.slice(0, max);
  const extra = tags.length - shown.length;
  return (
    <ul className="flex flex-wrap gap-1" aria-label="Tags">
      {shown.map((tag) => (
        <li key={tag}>
          <Badge variant="outline" className="max-w-32 truncate font-normal">
            {tag}
          </Badge>
        </li>
      ))}
      {extra > 0 ? (
        <li>
          <Badge variant="ghost" className="font-normal text-muted-foreground">
            +{extra} more
          </Badge>
        </li>
      ) : null}
    </ul>
  );
}
