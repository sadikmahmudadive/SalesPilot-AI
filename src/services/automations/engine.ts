import "server-only";

import { FieldValue, Timestamp } from "firebase-admin/firestore";

import { isConfigured } from "@/config/env";
import { fetchOutbound } from "@/lib/api/outbound-http";
import { adminDb } from "@/lib/firebase/admin";
import { normalizePhone } from "@/lib/phone";
import { writeAudit } from "@/lib/security/audit";
import { unsealSecret } from "@/lib/security/secret-box";
import { createWhatsAppClient } from "@/lib/whatsapp/client";
import {
  hasExistingRunForDedupeKey,
  recordAutomationRun,
} from "@/repositories/automations";
import {
  CONVERSATIONS,
  conversationRepo,
  findConversationByContact,
} from "@/repositories/conversations";
import { customerRepo, CUSTOMERS, type CustomerDoc } from "@/repositories/customers";
import { addConversationMessage } from "@/repositories/inbox-messages";
import { orderRepo } from "@/repositories/orders";
import { productRepo } from "@/repositories/products";
import type {
  AutomationRule,
  AutomationRun,
  AutomationTargetType,
} from "@/schemas/automation";
import type { Order } from "@/schemas/order";
import type { Product } from "@/schemas/product";
import { initiateOutboundCall } from "@/services/voice/calls";

import { interpolateTemplate, signWebhookPayload } from "./helpers";

export interface AutomationExecutionContext {
  targetType: AutomationTargetType;
  targetId?: string;
  customerId?: string;
  orderId?: string;
  productId?: string;
  phone?: string;
  variables?: Record<string, string | number>;
  dedupeKey?: string;
  force?: boolean;
  actorUid: string;
  originUrl?: string;
}

async function resolveCustomer(
  orgId: string,
  customerId?: string,
  order?: Order | null,
  rawPhone?: string,
): Promise<CustomerDoc | null> {
  const id = customerId ?? order?.customerId;
  if (id) {
    const found = await customerRepo.get(orgId, id);
    if (found) return found;
  }

  const candidatePhone =
    rawPhone ?? order?.shippingAddress?.phoneE164 ?? order?.customerSnapshot?.phoneE164;
  const phoneE164 = candidatePhone ? normalizePhone(candidatePhone) : null;
  if (!phoneE164) return null;

  const snap = await adminDb()
    .collection(CUSTOMERS)
    .where("organizationId", "==", orgId)
    .where("phoneE164", "==", phoneE164)
    .limit(1)
    .get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return doc ? customerRepo.fromSnapshot(doc, orgId) : null;
}

export async function executeAutomationRule(
  rule: AutomationRule,
  context: AutomationExecutionContext,
): Promise<AutomationRun | null> {
  const orgId = rule.organizationId;

  if (context.dedupeKey && !context.force) {
    const exists = await hasExistingRunForDedupeKey(orgId, context.dedupeKey);
    if (exists) {
      return null;
    }
  }

  const order = context.orderId ? await orderRepo.get(orgId, context.orderId) : null;
  const product: Product | null = context.productId
    ? await productRepo.get(orgId, context.productId)
    : null;
  const customer = await resolveCustomer(orgId, context.customerId, order, context.phone);

  const rawPhone =
    context.phone ??
    customer?.phoneE164 ??
    order?.shippingAddress?.phoneE164 ??
    order?.customerSnapshot?.phoneE164 ??
    "";
  const phoneE164 = rawPhone ? normalizePhone(rawPhone) : null;
  const customerName = customer?.fullName ?? order?.customerSnapshot?.name ?? "Customer";

  const templateVars: Record<string, string | number | null | undefined> = {
    customerName,
    phone: phoneE164 ?? rawPhone,
    orderNumber: order?.orderNumber ?? "",
    totalBdt: order ? (order.totalMinor / 100).toFixed(0) : "",
    productName: product?.name ?? order?.lines?.[0]?.productName ?? "",
    ...(context.variables ?? {}),
  };

  // Strict opt-out enforcement for direct outreach actions
  if (
    (rule.action === "send_whatsapp" || rule.action === "place_voice_call") &&
    customer?.consent?.status === "denied"
  ) {
    return recordAutomationRun({
      organizationId: orgId,
      ruleId: rule.id,
      ruleName: rule.name,
      trigger: rule.trigger,
      action: rule.action,
      status: "skipped",
      targetType: context.targetType,
      targetId: context.targetId ?? customer.id ?? null,
      dedupeKey: context.dedupeKey ?? null,
      summary: "Skipped: customer has opted out (consent denied)",
      errorMessage: null,
      actorUid: context.actorUid,
    });
  }

  let status: "succeeded" | "failed" | "skipped" = "succeeded";
  let summary = "";
  let errorMessage: string | null = null;

  try {
    if (rule.action === "send_whatsapp") {
      if (!phoneE164) {
        status = "skipped";
        summary = "Skipped: no valid mobile phone number for WhatsApp follow-up";
      } else {
        const messageText = interpolateTemplate(
          rule.actionConfig.messageTemplate ?? "Hi {{customerName}}, checking in from our store.",
          templateVars,
        ).trim();

        let externalId: string | null = `wamid_auto_${Date.now()}`;
        if (isConfigured("whatsapp")) {
          const wa = createWhatsAppClient();
          const sent = await wa.sendTextMessage(phoneE164, messageText);
          externalId = sent.messageId;
        }

        const nowIso = new Date().toISOString();
        let conv = await findConversationByContact(orgId, phoneE164, "whatsapp");
        if (!conv) {
          conv = await conversationRepo.create(orgId, {
            channel: "whatsapp",
            contactPhoneE164: phoneE164,
            contactName: customerName,
            customerId: customer?.id ?? null,
            assignedAgentId: rule.actionConfig.agentId ?? null,
            assignedUserId: null,
            status: "human_handling",
            unreadCount: 0,
            lastMessage: {
              text: messageText,
              sender: "system",
              senderName: rule.name,
              at: nowIso,
            },
            lastActivityAt: nowIso,
            searchLower: `${customerName} ${phoneE164}`.toLowerCase(),
          });
        } else {
          await adminDb()
            .collection(CONVERSATIONS)
            .doc(conv.id)
            .update({
              lastMessage: {
                text: messageText,
                sender: "system",
                senderName: rule.name,
                at: nowIso,
              },
              lastActivityAt: nowIso,
              updatedAt: FieldValue.serverTimestamp(),
            });
        }

        await addConversationMessage(orgId, conv.id, {
          direction: "outbound",
          sender: "system",
          senderName: `Automation: ${rule.name}`,
          type: "text",
          text: messageText,
          status: "sent",
          externalId,
        });

        if (customer) {
          await adminDb()
            .collection(CUSTOMERS)
            .doc(customer.id)
            .update({
              lastInteractionAt: Timestamp.now(),
              updatedAt: Timestamp.now(),
            });
        }

        summary = `Sent WhatsApp follow-up to ${phoneE164}`;
      }
    } else if (rule.action === "place_voice_call") {
      if (!phoneE164 && !customer?.id && !order?.id) {
        status = "skipped";
        summary = "Skipped: no phone, customer, or order to place voice call";
      } else {
        const purpose = rule.actionConfig.callPurpose
          ? interpolateTemplate(rule.actionConfig.callPurpose, templateVars)
          : `Automation: ${rule.name}`;
        const call = await initiateOutboundCall(
          { organizationId: orgId, uid: context.actorUid },
          {
            phoneE164: phoneE164 ?? undefined,
            customerId: customer?.id,
            orderId: order?.id,
            agentId: rule.actionConfig.agentId,
            purpose,
          },
          context.originUrl ?? "https://salespilot.local",
        );
        summary = `Initiated AI voice call (${call.provider}) to ${call.phoneE164}`;
      }
    } else if (rule.action === "update_customer") {
      if (!customer) {
        status = "skipped";
        summary = "Skipped: no matching customer record found to update";
      } else {
        const patch: Record<string, unknown> = {
          updatedAt: Timestamp.now(),
        };
        const addTags = rule.actionConfig.addTags ?? [];
        if (addTags.length > 0) {
          const seen = new Set<string>(customer.tagsLower ?? []);
          const mergedTags = [...(customer.tags ?? [])];
          for (const tag of addTags) {
            const lower = tag.trim().toLowerCase();
            if (lower && !seen.has(lower)) {
              seen.add(lower);
              mergedTags.push(tag.trim());
            }
          }
          patch.tags = mergedTags.slice(0, 20);
          patch.tagsLower = mergedTags.slice(0, 20).map((t) => t.toLowerCase());
        }
        if (rule.actionConfig.segment) {
          patch.segment = rule.actionConfig.segment;
        }
        await adminDb().collection(CUSTOMERS).doc(customer.id).update(patch);
        summary = `Updated CRM profile for ${customer.fullName}`;
      }
    } else if (rule.action === "outbound_webhook") {
      const webhookUrl = rule.actionConfig.webhookUrl;
      if (!webhookUrl) {
        status = "failed";
        errorMessage = "Missing webhookUrl";
        summary = "Failed: webhookUrl is not configured";
      } else {
        const eventBody = JSON.stringify({
          event: rule.trigger,
          ruleId: rule.id,
          ruleName: rule.name,
          organizationId: orgId,
          targetType: context.targetType,
          targetId: context.targetId ?? null,
          variables: templateVars,
          customer: customer
            ? {
                id: customer.id,
                fullName: customer.fullName,
                phoneE164: customer.phoneE164,
                segment: customer.segment,
                tags: customer.tags,
              }
            : null,
          order: order
            ? {
                id: order.id,
                orderNumber: order.orderNumber,
                status: order.status,
                paymentStatus: order.paymentStatus,
                totalMinor: order.totalMinor,
              }
            : null,
          product: product
            ? {
                id: product.id,
                name: product.name,
              }
            : null,
          timestamp: new Date().toISOString(),
        });

        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (rule.webhookSecret) {
          const plainSecret = unsealSecret(rule.webhookSecret);
          headers["x-salespilot-signature"] = signWebhookPayload(plainSecret, eventBody);
        }

        const resp = await fetchOutbound(webhookUrl, {
          method: "POST",
          headers,
          body: eventBody,
        });

        if (!resp.ok) {
          status = "failed";
          errorMessage = `Webhook responded with HTTP ${resp.status}`;
          summary = `Outbound webhook failed (HTTP ${resp.status})`;
        } else {
          summary = `Delivered signed webhook to ${new URL(webhookUrl).hostname} (HTTP ${resp.status})`;
        }
      }
    }
  } catch (err) {
    status = "failed";
    errorMessage = err instanceof Error ? err.message : "Automation execution failed";
    summary = `Failed: ${errorMessage}`;
  }

  const run = await recordAutomationRun({
    organizationId: orgId,
    ruleId: rule.id,
    ruleName: rule.name,
    trigger: rule.trigger,
    action: rule.action,
    status,
    targetType: context.targetType,
    targetId: context.targetId ?? customer?.id ?? order?.id ?? product?.id ?? null,
    dedupeKey: context.dedupeKey ?? null,
    summary,
    errorMessage,
    actorUid: context.actorUid,
  });

  await writeAudit({
    organizationId: orgId,
    actorUid: context.actorUid,
    action: "automations.execute",
    resource: "automationRule",
    resourceId: rule.id,
    after: {
      runId: run.id,
      status: run.status,
      trigger: rule.trigger,
      action: rule.action,
    },
  });

  return run;
}
