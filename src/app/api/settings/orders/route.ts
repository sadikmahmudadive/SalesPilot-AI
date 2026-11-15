/**
 * GET   /api/settings/orders  -> 200 OrderSettings
 *   { deliveryChargeInsideDhakaMinor, deliveryChargeOutsideDhakaMinor, draftHoldMinutes,
 *     paymentHoldHours }; the defaults when nothing is stored.
 * PATCH /api/settings/orders  orderSettingsSchema.partial() (at least one field) -> 200 OrderSettings
 *   Merges the given fields over the current settings. Audited. Owner and admin only.
 *
 * Errors: 400 validation (including an empty patch), 401, 403, 415, 429.
 */
import { withApi } from "@/lib/api/handler";
import { orderSettingsSchema } from "@/schemas/order";
import { getOrderSettings, updateOrderSettings } from "@/services/orders/settings";

const settingsPatchSchema = orderSettingsSchema
  .partial()
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    error: "At least one field is required",
  });

export const GET = withApi({ permission: "orders:read" }, async ({ organizationId }) =>
  getOrderSettings(organizationId),
);

export const PATCH = withApi(
  {
    permission: "org:manage",
    schema: settingsPatchSchema,
    rateLimit: { name: "orders.settings", limit: 20, windowSec: 60 },
  },
  async ({ body, organizationId, uid }) => updateOrderSettings({ organizationId, uid }, body),
);
