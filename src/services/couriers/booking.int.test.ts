import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";

import { ConflictError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";
import { createCourierAccount } from "@/repositories/couriers";
import { orderRepo } from "@/repositories/orders";
import { customerInputSchema } from "@/schemas/customer";
import { shippingAddressSchema, type PaymentMethod } from "@/schemas/order";
import { productInputSchema } from "@/schemas/product";
import { createCustomer } from "@/services/crm/customers";
import { adjustStock } from "@/services/inventory/stock";
import { createDraftOrder, type DraftInput } from "@/services/orders/drafts";
import { confirmOrder } from "@/services/orders/lifecycle";
import type { OrderCtx } from "@/services/orders/settings";
import { createProduct } from "@/services/products/products";

import { MockCourierAdapter } from "./adapters/mock";
import { bookShipment, refreshShipmentStatus } from "./booking";
import { registerCourierAdapter } from "./registry";

const orgs: string[] = [];
function newCtx(): OrderCtx {
  const organizationId = `org-${randomUUID()}`;
  orgs.push(organizationId);
  return { organizationId, uid: `uid-${randomUUID()}` };
}
type Ctx = ReturnType<typeof newCtx>;

let phoneCounter = 0;
const phone = () => `01713${String(1000000 + ++phoneCounter).slice(1)}`;

async function seedProduct(ctx: Ctx, stockUnits: number) {
  const product = await createProduct(
    ctx,
    productInputSchema.parse({
      name: `Book ${randomUUID().slice(0, 6)}`,
      sku: `sku-${randomUUID().slice(0, 8)}`,
      regularPriceMinor: 50000,
      availability: "active",
      variants: [],
    }),
  );
  await adjustStock(ctx, product.id, "default", { delta: stockUnits, reason: "seed" });
  return product;
}

const address = () =>
  shippingAddressSchema.parse({
    recipientName: "Adnan",
    phone: "01712345678",
    line1: "House 10, Road 5",
    area: "Banani",
    district: "Dhaka",
    zone: "inside_dhaka",
  });

async function seedConfirmedOrder(ctx: Ctx, opts: { method?: PaymentMethod } = {}) {
  const customer = await createCustomer(
    ctx,
    customerInputSchema.parse({ fullName: "Adnan Sami", phone: phone() }),
  );
  const product = await seedProduct(ctx, 10);
  const input: DraftInput = {
    customerId: customer.id,
    lines: [{ productId: product.id, quantity: 1 }],
    shippingAddress: address(),
    paymentMethod: opts.method ?? "cod",
    discountMinor: 0,
    idempotencyKey: `key-${randomUUID()}`,
    source: "staff",
  };
  const draft = await createDraftOrder(ctx, input);
  const confirmed = await confirmOrder(ctx, draft.id);
  return { order: confirmed, product, customer };
}

async function seedCourierAccount(orgId: string, overrides: Record<string, unknown> = {}) {
  return createCourierAccount({
    organizationId: orgId,
    provider: "mock",
    label: "Mock Express",
    mode: "mock",
    enabled: true,
    isDefault: true,
    credentials: { v: 1, iv: "iv", tag: "tag", data: "data" },
    publicConfig: {},
    ...overrides,
  });
}

describe("Shipment booking service", () => {
  afterAll(async () => {
    const db = adminDb();
    for (const orgId of orgs) {
      const snap = await db.collection("orders").where("organizationId", "==", orgId).get();
      for (const d of snap.docs) await d.ref.delete();
      const accounts = await db.collection("courierAccounts").where("organizationId", "==", orgId).get();
      for (const d of accounts.docs) await d.ref.delete();
      const events = await db.collection("orderEvents").where("organizationId", "==", orgId).get();
      for (const d of events.docs) await d.ref.delete();
    }
  });

  it("books shipment successfully for confirmed COD order", async () => {
    const ctx = newCtx();
    const { order } = await seedConfirmedOrder(ctx, { method: "cod" });
    const account = await seedCourierAccount(ctx.organizationId);

    const booked = await bookShipment(ctx, order.id, {
      courierAccountId: account.id,
      weightKg: 1.0,
      note: "Handle carefully",
    });

    expect(booked.shipment).toBeDefined();
    expect(booked.shipment?.bookingState).toBe("booked");
    expect(booked.shipment?.courierAccountId).toBe(account.id);
    expect(booked.shipment?.provider).toBe("mock");
    expect(booked.shipment?.consignmentId).toBe(`mock_cid_${order.orderNumber}`);
    expect(booked.shipment?.trackingCode).toBe(`MOCK_${order.orderNumber}`);
    expect(booked.shipment?.trackingUrl).toContain(order.orderNumber);
    expect(booked.shipment?.codAmountMinor).toBe(order.totalMinor);
    expect(booked.shipment?.weightKg).toBe(1.0);
    expect(booked.shipment?.status).toBe("booked");

    // Calling bookShipment again idempotently returns the already booked order
    const idempotent = await bookShipment(ctx, order.id, {
      courierAccountId: account.id,
      weightKg: 1.0,
    });
    expect(idempotent.shipment?.consignmentId).toBe(booked.shipment?.consignmentId);
  });

  it("refuses booking when another booking is in progress (< 60s)", async () => {
    const ctx = newCtx();
    const { order } = await seedConfirmedOrder(ctx, { method: "cod" });
    const account = await seedCourierAccount(ctx.organizationId);

    // Simulate an ongoing booking lock
    const ref = orderRepo.docRef(order.id);
    await ref.update({
      "shipment.bookingState": "booking",
      "shipment.bookingLockAt": new Date().toISOString(),
    });

    await expect(
      bookShipment(ctx, order.id, {
        courierAccountId: account.id,
        weightKg: 0.5,
      }),
    ).rejects.toThrow(ConflictError);
  });

  it("adopts existing parcel when recovering from booking_unknown state", async () => {
    const ctx = newCtx();
    const { order } = await seedConfirmedOrder(ctx, { method: "cod" });
    const account = await seedCourierAccount(ctx.organizationId);

    // Set order to booking_unknown
    const ref = orderRepo.docRef(order.id);
    await ref.update({
      shipment: {
        courierAccountId: account.id,
        provider: "mock",
        bookingState: "booking_unknown",
        bookingLockAt: null,
        status: "unknown",
        codAmountMinor: order.totalMinor,
        weightKg: 0.5,
      },
    });

    const recovered = await bookShipment(ctx, order.id, {
      courierAccountId: account.id,
      weightKg: 0.5,
    });

    expect(recovered.shipment?.bookingState).toBe("booked");
    expect(recovered.shipment?.consignmentId).toBe(`mock_cid_${order.orderNumber}`);
  });

  it("handles transient failure by transitioning to booking_unknown", async () => {
    const ctx = newCtx();
    const { order } = await seedConfirmedOrder(ctx, { method: "cod" });
    const account = await seedCourierAccount(ctx.organizationId);

    // Register a failing adapter with timeout
    class TimeoutAdapter extends MockCourierAdapter {
      override async createParcel(): Promise<never> {
        throw new Error("Courier API timed out after 15s");
      }
    }
    const customAdapter = new TimeoutAdapter();
    registerCourierAdapter(customAdapter);

    await expect(
      bookShipment(ctx, order.id, {
        courierAccountId: account.id,
        weightKg: 0.5,
      }),
    ).rejects.toThrow(/timed out|unknown/);

    const stored = (await orderRepo.get(ctx.organizationId, order.id))!;
    expect(stored.shipment?.bookingState).toBe("booking_unknown");

    // Restore mock adapter
    registerCourierAdapter(new MockCourierAdapter());
  });

  it("handles definite error by transitioning to failed", async () => {
    const ctx = newCtx();
    const { order } = await seedConfirmedOrder(ctx, { method: "cod" });
    const account = await seedCourierAccount(ctx.organizationId);

    class DefiniteErrorAdapter extends MockCourierAdapter {
      override async createParcel(): Promise<never> {
        throw new Error("Invalid recipient phone number format");
      }
    }
    registerCourierAdapter(new DefiniteErrorAdapter());

    await expect(
      bookShipment(ctx, order.id, {
        courierAccountId: account.id,
        weightKg: 0.5,
      }),
    ).rejects.toThrow(/Invalid recipient phone number/);

    const stored = (await orderRepo.get(ctx.organizationId, order.id))!;
    expect(stored.shipment?.bookingState).toBe("failed");
    expect(stored.shipment?.errorMessage).toContain("Invalid recipient phone number format");

    // Restore mock adapter
    registerCourierAdapter(new MockCourierAdapter());
  });

  it("refuses booking on online unpaid order", async () => {
    const ctx = newCtx();
    const { order } = await seedConfirmedOrder(ctx, { method: "online" });
    const account = await seedCourierAccount(ctx.organizationId);

    await expect(
      bookShipment(ctx, order.id, {
        courierAccountId: account.id,
        weightKg: 0.5,
      }),
    ).rejects.toThrow(/Online orders must be paid/);
  });

  it("refuses booking on disabled courier account", async () => {
    const ctx = newCtx();
    const { order } = await seedConfirmedOrder(ctx, { method: "cod" });
    const account = await seedCourierAccount(ctx.organizationId, { enabled: false });

    await expect(
      bookShipment(ctx, order.id, {
        courierAccountId: account.id,
        weightKg: 0.5,
      }),
    ).rejects.toThrow(/disabled/);
  });

  it("refreshes shipment status from adapter", async () => {
    const ctx = newCtx();
    const { order } = await seedConfirmedOrder(ctx, { method: "cod" });
    const account = await seedCourierAccount(ctx.organizationId);

    const booked = await bookShipment(ctx, order.id, {
      courierAccountId: account.id,
      weightKg: 0.5,
    });
    expect(booked.shipment?.status).toBe("booked");

    const refreshed = await refreshShipmentStatus(ctx, order.id);
    expect(refreshed.shipment?.lastSyncedAt).toBeDefined();
    expect(refreshed.shipment?.status).toBe("booked");
  });
});
