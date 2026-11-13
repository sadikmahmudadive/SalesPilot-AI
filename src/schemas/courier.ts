import { z } from "zod";

import {
  INTEGRATION_MODES,
  sealedSecretSchema,
} from "./integration";

export const COURIER_PROVIDERS = ["steadfast", "pathao", "redx", "mock"] as const;
export type CourierProvider = (typeof COURIER_PROVIDERS)[number];

export const COURIER_STATUSES = [
  "booked",
  "pending_pickup",
  "picked_up",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "partial_delivered",
  "returned",
  "cancelled",
  "on_hold",
  "unknown",
] as const;
export type CourierStatus = (typeof COURIER_STATUSES)[number];

export const BOOKING_STATES = [
  "booking",
  "booked",
  "booking_unknown",
  "failed",
  "cancelled",
] as const;
export type BookingState = (typeof BOOKING_STATES)[number];

export const courierLocationSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  name: z.string().trim().min(1),
});
export type CourierLocation = z.infer<typeof courierLocationSchema>;

export const shipmentLocationSchema = z.object({
  cityId: z.string().nullable().optional(),
  cityName: z.string().nullable().optional(),
  zoneId: z.string().nullable().optional(),
  zoneName: z.string().nullable().optional(),
  areaId: z.string().nullable().optional(),
  areaName: z.string().nullable().optional(),
});
export type ShipmentLocation = z.infer<typeof shipmentLocationSchema>;

export const orderShipmentSchema = z.object({
  courierAccountId: z.string(),
  provider: z.enum(COURIER_PROVIDERS),
  bookingState: z.enum(BOOKING_STATES),
  bookingLockAt: z.string().nullable().optional(),
  consignmentId: z.string().nullable().optional(),
  trackingCode: z.string().nullable().optional(),
  trackingUrl: z.string().nullable().optional(),
  status: z.enum(COURIER_STATUSES),
  rawStatus: z.string().nullable().optional(),
  statusAt: z.string().nullable().optional(),
  chargeMinor: z.number().int().min(0).nullable().optional(),
  codAmountMinor: z.number().int().min(0),
  location: shipmentLocationSchema.nullable().optional(),
  weightKg: z.number().positive(),
  bookedAt: z.string().nullable().optional(),
  lastSyncedAt: z.string().nullable().optional(),
  errorMessage: z.string().nullable().optional(),
});
export type OrderShipment = z.infer<typeof orderShipmentSchema>;

export const courierAccountSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  provider: z.enum(COURIER_PROVIDERS),
  label: z.string().trim().min(1).max(50),
  mode: z.enum(INTEGRATION_MODES),
  enabled: z.boolean(),
  isDefault: z.boolean(),
  credentials: sealedSecretSchema,
  webhookSecret: sealedSecretSchema.optional(),
  tokenCache: sealedSecretSchema.optional(),
  publicConfig: z.record(z.string(), z.unknown()),
  lastTestedAt: z.custom<unknown>().optional(),
  lastTestResult: z.enum(["ok", "failed"]).optional(),
  createdAt: z.custom<unknown>(),
  updatedAt: z.custom<unknown>(),
});
export type CourierAccount = z.infer<typeof courierAccountSchema>;

export const courierAccountSummarySchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  provider: z.enum(COURIER_PROVIDERS),
  label: z.string(),
  mode: z.enum(INTEGRATION_MODES),
  enabled: z.boolean(),
  isDefault: z.boolean(),
  publicConfig: z.record(z.string(), z.unknown()),
  hasCredentials: z.boolean(),
  hasWebhookSecret: z.boolean(),
  lastTestedAt: z.string().nullable().optional(),
  lastTestResult: z.enum(["ok", "failed"]).nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CourierAccountSummary = z.infer<typeof courierAccountSummarySchema>;

export const courierAccountInputSchema = z.object({
  provider: z.enum(COURIER_PROVIDERS),
  label: z.string().trim().min(1, "Label is required").max(50),
  mode: z.enum(INTEGRATION_MODES),
  enabled: z.boolean().default(true),
  isDefault: z.boolean().default(false),
  credentials: z.record(z.string(), z.string()).optional(),
  webhookSecret: z.string().optional(),
  publicConfig: z.record(z.string(), z.unknown()).default({}),
});
export type CourierAccountInput = z.infer<typeof courierAccountInputSchema>;

export const courierAccountPatchSchema = courierAccountInputSchema.partial();
export type CourierAccountPatch = z.infer<typeof courierAccountPatchSchema>;

export function toCourierSummary(account: CourierAccount): CourierAccountSummary {
  const toIso = (ts: unknown): string | null => {
    if (!ts) return null;
    if (typeof ts === "string") return ts;
    if (typeof (ts as { toDate?: () => Date }).toDate === "function") {
      return (ts as { toDate: () => Date }).toDate().toISOString();
    }
    return new Date(ts as string | number).toISOString();
  };

  return {
    id: account.id,
    organizationId: account.organizationId,
    provider: account.provider,
    label: account.label,
    mode: account.mode,
    enabled: account.enabled,
    isDefault: account.isDefault,
    publicConfig: account.publicConfig ?? {},
    hasCredentials: !!account.credentials,
    hasWebhookSecret: !!account.webhookSecret,
    lastTestedAt: toIso(account.lastTestedAt),
    lastTestResult: account.lastTestResult ?? null,
    createdAt: toIso(account.createdAt) ?? new Date().toISOString(),
    updatedAt: toIso(account.updatedAt) ?? new Date().toISOString(),
  };
}
