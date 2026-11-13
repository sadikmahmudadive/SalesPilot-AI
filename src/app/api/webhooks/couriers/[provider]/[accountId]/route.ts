import type { CourierProvider } from "@/schemas/courier";
import { handleCourierWebhook } from "@/services/couriers/webhooks";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ provider: string; accountId: string }> },
) {
  const { provider, accountId } = await params;
  return handleCourierWebhook(provider as CourierProvider, accountId, req);
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ provider: string; accountId: string }> },
) {
  const { provider, accountId } = await params;
  return handleCourierWebhook(provider as CourierProvider, accountId, req);
}
