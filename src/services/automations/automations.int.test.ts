import { randomUUID } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";

import { ForbiddenError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";
import { sealSecret } from "@/lib/security/secret-box";
import { createAutomationRule, listAutomationRuns } from "@/repositories/automations";
import { customerRepo } from "@/repositories/customers";
import { listConversationMessages } from "@/repositories/inbox-messages";
import { findConversationByContact } from "@/repositories/conversations";
import { ORDERS } from "@/repositories/orders";

import {
  evaluateOrganizationAutomations,
  handleInboundAutomationWebhook,
} from "./sweep";

process.env.ENCRYPTION_KEY ??= "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("automations engine & sweep (integration)", () => {
  it("runs stale draft WhatsApp follow-up, skips opted-out customers, deduplicates, and verifies n8n webhooks", async () => {
    const orgId = `org_auto_srv_${randomUUID().slice(0, 8)}`;

    const optedInCustomer = await customerRepo.create(orgId, {
      fullName: "Nadia Rahman",
      fullNameLower: "nadia rahman",
      phone: "+8801711223355",
      phoneE164: "+8801711223355",
      customerType: "retail",
      segment: "interested",
      tags: [],
      tagsLower: [],
      lastInteractionAt: null,
      totalSpendMinor: 0,
      consent: { status: "granted" },
    });

    const optedOutCustomer = await customerRepo.create(orgId, {
      fullName: "Tariq Hasan",
      fullNameLower: "tariq hasan",
      phone: "+8801811223355",
      phoneE164: "+8801811223355",
      customerType: "retail",
      segment: "new_lead",
      tags: [],
      tagsLower: [],
      lastInteractionAt: null,
      totalSpendMinor: 0,
      consent: { status: "denied" },
    });

    const staleCreatedAt = Timestamp.fromMillis(Date.now() - 60 * 60_000);
    await adminDb()
      .collection(ORDERS)
      .doc(`ord_stale_1_${orgId}`)
      .set({
        organizationId: orgId,
        orderNumber: "SP-2001",
        status: "draft",
        paymentStatus: "unpaid",
        customerId: optedInCustomer.id,
        customerSnapshot: { name: optedInCustomer.fullName, phoneE164: optedInCustomer.phoneE164 },
        shippingAddress: {
          name: optedInCustomer.fullName,
          phoneE164: optedInCustomer.phoneE164,
          street: "Road 1",
          area: "Banani",
          district: "Dhaka",
        },
        lines: [{ productId: "p1", variantId: "default", productName: "Linen Shirt", quantity: 1, unitPriceMinor: 120000, lineTotalMinor: 120000, holdKey: "hk1" }],
        subtotalMinor: 120000,
        totalMinor: 120000,
        createdAt: staleCreatedAt,
        updatedAt: staleCreatedAt,
      });

    await adminDb()
      .collection(ORDERS)
      .doc(`ord_stale_2_${orgId}`)
      .set({
        organizationId: orgId,
        orderNumber: "SP-2002",
        status: "draft",
        paymentStatus: "unpaid",
        customerId: optedOutCustomer.id,
        customerSnapshot: { name: optedOutCustomer.fullName, phoneE164: optedOutCustomer.phoneE164 },
        shippingAddress: {
          name: optedOutCustomer.fullName,
          phoneE164: optedOutCustomer.phoneE164,
          street: "Road 2",
          area: "Gulshan",
          district: "Dhaka",
        },
        lines: [{ productId: "p1", variantId: "default", productName: "Linen Shirt", quantity: 1, unitPriceMinor: 150000, lineTotalMinor: 150000, holdKey: "hk2" }],
        subtotalMinor: 150000,
        totalMinor: 150000,
        createdAt: staleCreatedAt,
        updatedAt: staleCreatedAt,
      });

    await createAutomationRule({
      organizationId: orgId,
      name: "Stale Draft Follow-up",
      enabled: true,
      trigger: "draft_order_stale",
      triggerConfig: { delayMinutes: 30 },
      action: "send_whatsapp",
      actionConfig: {
        messageTemplate: "Hi {{customerName}}, order #{{orderNumber}} (৳{{totalBdt}}) awaits confirmation!",
      },
      createdBy: "u_owner",
    });

    // First sweep: processes 2 orders (1 succeeded, 1 skipped due to opt-out)
    const first = await evaluateOrganizationAutomations(orgId, new Date(), "u_owner");
    expect(first.evaluated).toBe(2);
    expect(first.succeeded).toBe(1);
    expect(first.skipped).toBe(1);

    // Check conversation + message was created for optedInCustomer
    const conv = await findConversationByContact(orgId, optedInCustomer.phoneE164, "whatsapp");
    expect(conv).not.toBeNull();
    const msgs = await listConversationMessages(orgId, conv!.id);
    expect(msgs.items[0]?.text).toContain("Nadia Rahman");
    expect(msgs.items[0]?.text).toContain("SP-2001");
    expect(msgs.items[0]?.text).toContain("৳1200");

    // Second sweep: deduplicated -> 0 evaluated
    const second = await evaluateOrganizationAutomations(orgId, new Date(), "u_owner");
    expect(second.evaluated).toBe(0);

    // Inbound n8n webhook rule updating customer CRM tags + segment
    const webhookRule = await createAutomationRule({
      organizationId: orgId,
      name: "n8n VIP Tagging",
      enabled: true,
      trigger: "inbound_webhook",
      triggerConfig: {},
      action: "update_customer",
      actionConfig: { addTags: ["n8n-vip"], segment: "repeat_customer" },
      webhookSecret: sealSecret("n8n_secret_99"),
      createdBy: "u_owner",
    });

    await expect(
      handleInboundAutomationWebhook(webhookRule.id, {
        headers: { "x-n8n-secret": "wrong" },
        body: { customerId: optedInCustomer.id },
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const webhookRun = await handleInboundAutomationWebhook(webhookRule.id, {
      headers: { "x-n8n-secret": "n8n_secret_99" },
      body: { customerId: optedInCustomer.id },
    });
    expect(webhookRun?.status).toBe("succeeded");

    const updatedCust = await customerRepo.get(orgId, optedInCustomer.id);
    expect(updatedCust?.tags).toContain("n8n-vip");
    expect(updatedCust?.segment).toBe("repeat_customer");

    const runs = await listAutomationRuns(orgId);
    expect(runs).toHaveLength(3);
  });
});
