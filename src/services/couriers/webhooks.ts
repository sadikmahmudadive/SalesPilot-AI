import "server-only";

import { adminDb } from "@/lib/firebase/admin";
import { logger } from "@/lib/logger";
import { unsealSecret } from "@/lib/security/secret-box";
import { orderNumberRef } from "@/repositories/orders";
import { recordWebhookEvent } from "@/repositories/payments";
import type { CourierProvider } from "@/schemas/courier";
import type { OrderCtx } from "@/services/orders/settings";

import { syncCourierStatus } from "./booking";
import { getCourierAdapter } from "./registry";

const MAX_BODY_BYTES = 64 * 1024; // 64 KB cap

/**
 * Handles incoming webhooks for a specific courier provider and account.
 */
export async function handleCourierWebhook(
  provider: CourierProvider,
  accountId: string,
  req: Request,
): Promise<Response> {
  const adapter = getCourierAdapter(provider);

  // 1. Answer handshake challenges (e.g. Pathao hub.challenge) before body parsing
  if (adapter.webhookHandshake) {
    const handshakeResponse = adapter.webhookHandshake(req);
    if (handshakeResponse) {
      return handshakeResponse;
    }
  }

  // 2. Load and validate the tenant courier account
  const snap = await adminDb().collection("courierAccounts").doc(accountId).get();
  if (!snap.exists) {
    return new Response(JSON.stringify({ error: "Courier account not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const courierAccount = { ...snap.data(), id: snap.id } as ReturnType<typeof snap.data> & {
    id: string;
    organizationId: string;
    provider: CourierProvider;
    enabled: boolean;
    webhookSecret?: { v: 1; iv: string; tag: string; data: string };
  };

  if (courierAccount.provider !== provider) {
    return new Response(JSON.stringify({ error: "Provider mismatch" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 3. Read body with 64 KB cap
  const rawBody = await req.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
    return new Response(JSON.stringify({ error: "Payload too large" }), {
      status: 413,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 4. Verify signature / secret
  const headers: Record<string, string | undefined> = {};
  req.headers.forEach((val, key) => {
    headers[key.toLowerCase()] = val;
  });

  let secret: string | undefined;
  if (courierAccount.webhookSecret) {
    try {
      secret = unsealSecret(courierAccount.webhookSecret);
    } catch {
      logger.error("Failed to unseal courier webhook secret", { accountId });
    }
  }

  const isValid = adapter.verifyWebhook(headers, rawBody, secret);
  if (!isValid) {
    return new Response(JSON.stringify({ error: "Invalid webhook signature" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 5. Parse webhook payload
  let bodyJson: unknown;
  try {
    bodyJson = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    bodyJson = {};
  }

  const events = adapter.parseWebhook(bodyJson);
  const orgId = courierAccount.organizationId;
  const ctx: OrderCtx = {
    organizationId: orgId,
    uid: "system:webhook",
    actor: { kind: "system", id: `courier-webhook:${provider}` },
  };

  let processedCount = 0;

  for (const event of events) {
    let orderId: string | null = null;

    // Look up by invoice (orderNumber)
    if (event.invoice) {
      const numSnap = await orderNumberRef(orgId, event.invoice).get();
      if (numSnap.exists) {
        orderId = numSnap.get("orderId") as string;
      }
    }

    // Fallback: look up by consignmentId
    if (!orderId && event.consignmentId) {
      const orderQuery = await adminDb()
        .collection("orders")
        .where("organizationId", "==", orgId)
        .where("shipment.consignmentId", "==", event.consignmentId)
        .limit(1)
        .get();

      if (!orderQuery.empty && orderQuery.docs[0]) {
        orderId = orderQuery.docs[0].id;
      }
    }

    if (!orderId) {
      logger.warn("Courier webhook event did not match any order", {
        provider,
        accountId,
        event,
      });
      continue;
    }

    // Deduplication via webhookEvents
    const eventKey = `${event.consignmentId ?? event.invoice}_${event.rawStatus}_${event.at ? event.at.toISOString() : ""}`;
    const isNew = await recordWebhookEvent(provider, eventKey);
    if (!isNew) {
      logger.info("Ignoring duplicate courier webhook event", { provider, eventKey });
      continue;
    }

    // Apply status update
    try {
      await syncCourierStatus(ctx, orderId, event);
      processedCount++;
    } catch (err) {
      logger.error("Failed to sync courier status from webhook", { err, orderId, event });
    }
  }

  return new Response(JSON.stringify({ received: true, processed: processedCount }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
