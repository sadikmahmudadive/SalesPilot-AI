import { z } from "zod";

import { withApi } from "@/lib/api/handler";
import { parseQueryParams } from "@/lib/list-params";
import { COURIER_PROVIDERS, type CourierProvider } from "@/schemas/courier";
import { getCourierLocations } from "@/services/couriers/locations";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  level: z.enum(["city", "zone", "area"]).default("city"),
  parentId: z.string().optional(),
});

export const GET = withApi(
  { permission: "orders:read" },
  async ({ req, params, organizationId }) => {
    const provider = params.provider as CourierProvider;
    if (!COURIER_PROVIDERS.includes(provider)) {
      return Response.json({ error: { message: "Invalid courier provider" } }, { status: 400 });
    }

    const url = new URL(req.url);
    const { level, parentId } = parseQueryParams(url.searchParams, querySchema);

    const items = await getCourierLocations(organizationId, provider, level, parentId);
    return { items };
  },
);
