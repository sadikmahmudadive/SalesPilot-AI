/**
 * GET /api/search?q=  -> 200 SearchResults (customers, products, orders, conversations; a group the
 * role cannot read is null). `q` is 2-100 characters after trimming, else 400.
 */
import { withApi } from "@/lib/api/handler";
import { ValidationError } from "@/lib/errors";
import { globalSearch, searchQuerySchema } from "@/services/search/global-search";

export const dynamic = "force-dynamic";

export const GET = withApi(
  {
    permission: "any-member",
    rateLimit: { name: "search", limit: 120, windowSec: 60 },
  },
  async ({ req, organizationId, uid, role }) => {
    const parsed = searchQuerySchema.safeParse(new URL(req.url).searchParams.get("q") ?? "");
    if (!parsed.success) {
      throw new ValidationError([
        { path: "q", message: parsed.error.issues[0]?.message ?? "Invalid search" },
      ]);
    }
    return globalSearch({ organizationId, uid, role }, parsed.data);
  },
);
