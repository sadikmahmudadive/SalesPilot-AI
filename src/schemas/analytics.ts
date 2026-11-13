import { z } from "zod";

import type { CustomerSegment } from "./customer";
import type { ConversationChannel, ConversationStatus } from "./inbox";
import type { OrderStatus } from "./order";

export const ANALYTICS_RANGES = ["7d", "30d", "90d", "all"] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];

export const ORDER_SOURCES = ["ai", "staff"] as const;
export type OrderSource = (typeof ORDER_SOURCES)[number];

export const analyticsQuerySchema = z.object({
  range: z.enum(ANALYTICS_RANGES).default("30d"),
});
export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;

export interface DailyOrderPoint {
  date: string;
  orders: number;
  revenueMinor: number;
}

export interface TopProductMetric {
  productId: string;
  productName: string;
  quantitySold: number;
  revenueMinor: number;
}

export interface AnalyticsSalesSummary {
  totalOrders: number;
  draftOrders: number;
  cancelledOrders: number;
  deliveredOrders: number;
  returnedOrders: number;
  grossRevenueMinor: number;
  pendingRevenueMinor: number;
  averageOrderValueMinor: number;
  codOrders: number;
  onlineOrders: number;
  byStatus: Record<OrderStatus, number>;
  bySource: Record<OrderSource, number>;
  dailySeries: DailyOrderPoint[];
  topProducts: TopProductMetric[];
}

export interface AnalyticsCustomerSummary {
  totalCustomers: number;
  newCustomersInRange: number;
  bySegment: Record<CustomerSegment, number>;
  consentBreakdown: {
    granted: number;
    denied: number;
    unknown: number;
  };
}

export interface AnalyticsInboxSummary {
  totalConversations: number;
  unreadConversations: number;
  byStatus: Record<ConversationStatus, number>;
  byChannel: Record<ConversationChannel, number>;
}

export interface AnalyticsOperationsSummary {
  totalVoiceCalls: number;
  completedVoiceCalls: number;
  totalTalkDurationSec: number;
  voiceOutcomes: Record<string, number>;
  activeAutomationRules: number;
  automationRunsSucceeded: number;
  automationRunsSkipped: number;
  automationRunsFailed: number;
}

export interface AnalyticsInventorySummary {
  activeProducts: number;
  totalSkus: number;
  totalOnHand: number;
  totalReserved: number;
  totalAvailable: number;
  lowStockCount: number;
  outOfStockCount: number;
}

export interface AnalyticsReport {
  range: AnalyticsRange;
  generatedAt: string;
  sales: AnalyticsSalesSummary;
  customers: AnalyticsCustomerSummary;
  inbox: AnalyticsInboxSummary;
  operations: AnalyticsOperationsSummary;
  inventory: AnalyticsInventorySummary;
}
