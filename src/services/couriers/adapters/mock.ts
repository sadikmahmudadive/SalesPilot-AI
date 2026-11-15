import type { CourierAccount, CourierLocation } from "@/schemas/courier";
import { mapMockStatus } from "../status-map";
import type { CourierAdapter, CourierStatusEvent, ParcelInput, ParcelResult } from "../types";

export class MockCourierAdapter implements CourierAdapter {
  readonly id = "mock" as const;
  readonly requiresLocation = false;

  async testConnection(_account: CourierAccount): Promise<void> {
    void _account;
    return Promise.resolve();
  }

  async listLocations(
    _account: CourierAccount,
    level: "city" | "zone" | "area",
    _parentId?: string,
  ): Promise<CourierLocation[]> {
    void _account;
    void _parentId;
    if (level === "city") {
      return [
        { id: "1", name: "Dhaka" },
        { id: "2", name: "Chittagong" },
      ];
    }
    if (level === "zone") {
      return [
        { id: "101", name: "Gulshan" },
        { id: "102", name: "Banani" },
      ];
    }
    return [
      { id: "1001", name: "Road 1-10" },
      { id: "1002", name: "Road 11-20" },
    ];
  }

  async createParcel(_account: CourierAccount, input: ParcelInput): Promise<ParcelResult> {
    void _account;
    const consignmentId = `mock_cid_${input.invoice}`;
    const trackingCode = `MOCK_${input.invoice}`;
    const trackingUrl = `https://track.mockcourier.local/${input.invoice}`;

    return {
      consignmentId,
      trackingCode,
      trackingUrl,
      chargeMinor: 6000,
      raw: {
        success: true,
        invoice: input.invoice,
        consignmentId,
        trackingCode,
      },
    };
  }

  async findParcelByInvoice(
    _account: CourierAccount,
    invoice: string,
  ): Promise<{
    consignmentId: string;
    trackingCode?: string;
    trackingUrl?: string;
  } | null> {
    void _account;
    if (!invoice) return null;
    return {
      consignmentId: `mock_cid_${invoice}`,
      trackingCode: `MOCK_${invoice}`,
      trackingUrl: `https://track.mockcourier.local/${invoice}`,
    };
  }

  async getStatus(
    _account: CourierAccount,
    consignmentId: string,
  ): Promise<{
    status: ReturnType<typeof mapMockStatus>;
    rawStatus: string;
    at?: Date;
  }> {
    void _account;
    void consignmentId;
    return {
      status: "booked",
      rawStatus: "booked",
      at: new Date(),
    };
  }

  verifyWebhook(
    headers: Record<string, string | undefined>,
    _rawBody: string,
    secret?: string,
  ): boolean {
    void _rawBody;
    if (!secret) return true;
    const headerSecret = headers["x-mock-secret"] || headers["x-webhook-secret"];
    return headerSecret === secret;
  }

  parseWebhook(body: unknown): CourierStatusEvent[] {
    if (!body || typeof body !== "object") return [];
    const b = body as Record<string, unknown>;

    const consignmentId = typeof b.consignmentId === "string" ? b.consignmentId : undefined;
    const trackingCode = typeof b.trackingCode === "string" ? b.trackingCode : undefined;
    const invoice = typeof b.invoice === "string" ? b.invoice : undefined;
    const rawStatus = typeof b.status === "string" ? b.status : "booked";
    const status = mapMockStatus(rawStatus);
    const at = b.at ? new Date(String(b.at)) : new Date();

    return [
      {
        consignmentId,
        trackingCode,
        invoice,
        rawStatus,
        status,
        at,
      },
    ];
  }
}

export const mockCourierAdapter = new MockCourierAdapter();
