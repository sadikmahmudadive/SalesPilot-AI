import { withApi } from "@/lib/api/handler";
import { NotFoundError } from "@/lib/errors";
import { sealSecret } from "@/lib/security/secret-box";
import {
  deleteCourierAccount,
  getCourierAccount,
  updateCourierAccount,
} from "@/repositories/couriers";
import {
  courierAccountPatchSchema,
  toCourierSummary,
  type CourierAccount,
} from "@/schemas/courier";

export const dynamic = "force-dynamic";

export const GET = withApi(
  { permission: "orders:read" },
  async ({ params, organizationId }) => {
    const id = params.id ?? "";
    const account = await getCourierAccount(organizationId, id);
    if (!account) throw new NotFoundError("Courier account not found");
    return { data: toCourierSummary(account) };
  },
);

export const PATCH = withApi(
  {
    permission: "integrations:manage",
    schema: courierAccountPatchSchema,
    rateLimit: { name: "integrations.couriers.update", limit: 30, windowSec: 60 },
  },
  async ({ params, body, organizationId }) => {
    const id = params.id ?? "";
    const patch: Partial<Omit<CourierAccount, "id" | "organizationId" | "createdAt">> = {};

    if (body.label !== undefined) patch.label = body.label;
    if (body.mode !== undefined) patch.mode = body.mode;
    if (body.enabled !== undefined) patch.enabled = body.enabled;
    if (body.isDefault !== undefined) patch.isDefault = body.isDefault;
    if (body.publicConfig !== undefined) patch.publicConfig = body.publicConfig;
    if (body.credentials !== undefined) {
      patch.credentials = sealSecret(JSON.stringify(body.credentials));
    }
    if (body.webhookSecret !== undefined) {
      patch.webhookSecret = sealSecret(body.webhookSecret);
    }

    const updated = await updateCourierAccount(organizationId, id, patch);
    return { data: toCourierSummary(updated) };
  },
);

export const DELETE = withApi(
  {
    permission: "integrations:manage",
    rateLimit: { name: "integrations.couriers.delete", limit: 30, windowSec: 60 },
  },
  async ({ params, organizationId }) => {
    const id = params.id ?? "";
    await deleteCourierAccount(organizationId, id);
    return { ok: true };
  },
);
