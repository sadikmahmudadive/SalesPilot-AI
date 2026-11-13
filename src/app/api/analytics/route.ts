import { withApi, zodIssuesToDetails } from "@/lib/api/handler";
import { ValidationError } from "@/lib/errors";
import { analyticsQuerySchema } from "@/schemas/analytics";
import { getAnalyticsReport } from "@/services/analytics/analytics";

export const dynamic = "force-dynamic";

export const GET = withApi(
  {
    permission: "analytics:read",
    rateLimit: { name: "analytics.read", limit: 60, windowSec: 60 },
  },
  async ({ req, organizationId }) => {
    const sp = new URL(req.url).searchParams;
    const rawRange = sp.get("range") ?? undefined;
    const parsed = analyticsQuerySchema.safeParse(rawRange ? { range: rawRange } : {});
    if (!parsed.success) {
      throw new ValidationError(zodIssuesToDetails(parsed.error.issues));
    }
    const report = await getAnalyticsReport(organizationId, parsed.data.range);
    return { report };
  },
);
