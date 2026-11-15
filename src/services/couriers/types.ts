import type {
  CourierAccount,
  CourierLocation,
  CourierProvider,
  CourierStatus,
} from "@/schemas/courier";

export interface ParcelInput {
  invoice: string; // usually orderNumber
  recipientName: string;
  recipientPhone: string;
  recipientAddress: string;
  deliveryZone?: "inside_dhaka" | "outside_dhaka";
  cityId?: string;
  cityName?: string;
  zoneId?: string;
  zoneName?: string;
  areaId?: string;
  areaName?: string;
  codAmountMinor: number;
  weightKg: number;
  itemDescription?: string;
  note?: string;
}

export interface CourierStatusEvent {
  consignmentId?: string;
  trackingCode?: string;
  invoice?: string;
  rawStatus: string;
  status: CourierStatus;
  at?: Date;
}

export interface ParcelResult {
  consignmentId: string;
  trackingCode?: string;
  trackingUrl?: string;
  chargeMinor?: number;
  raw: unknown;
}

export interface CourierAdapter {
  id: CourierProvider;
  requiresLocation: boolean;
  testConnection(account: CourierAccount): Promise<void>;
  listLocations?(
    account: CourierAccount,
    level: "city" | "zone" | "area",
    parentId?: string,
  ): Promise<CourierLocation[]>;
  createParcel(account: CourierAccount, input: ParcelInput): Promise<ParcelResult>;
  findParcelByInvoice?(
    account: CourierAccount,
    invoice: string,
  ): Promise<{
    consignmentId: string;
    trackingCode?: string;
    trackingUrl?: string;
  } | null>;
  getStatus(
    account: CourierAccount,
    consignmentId: string,
  ): Promise<{
    status: CourierStatus;
    rawStatus: string;
    at?: Date;
  }>;
  verifyWebhook(
    headers: Record<string, string | undefined>,
    rawBody: string,
    secret?: string,
  ): boolean;
  parseWebhook(body: unknown): CourierStatusEvent[];
  webhookHandshake?(req: Request): Response | null;
}
