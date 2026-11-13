import {
  CONVERSATION_CHANNELS,
  CONVERSATION_STATUSES,
  type ConversationChannel,
  type ConversationStatus,
} from "@/schemas/inbox";

export const CONVERSATION_STATUS_LABELS: Readonly<Record<ConversationStatus, string>> = {
  ai_handling: "AI active",
  needs_reply: "Needs reply",
  human_handling: "Human active",
  resolved: "Resolved",
};

export const CONVERSATION_CHANNEL_LABELS: Readonly<Record<ConversationChannel, string>> = {
  whatsapp: "WhatsApp",
  messenger: "Messenger",
  instagram: "Instagram",
  email: "Email",
};

export const INBOX_FILTER_TABS: ReadonlyArray<{
  label: string;
  value: ConversationStatus | "all";
}> = [
  { label: "All", value: "all" },
  { label: "Needs reply", value: "needs_reply" },
  { label: "AI active", value: "ai_handling" },
  { label: "Human", value: "human_handling" },
  { label: "Resolved", value: "resolved" },
];

export const QUICK_REPLY_TEMPLATES: ReadonlyArray<{ label: string; text: string }> = [
  {
    label: "Confirm order",
    text: "Thank you! Could you please confirm your full delivery address and phone number so we can finalize your order?",
  },
  {
    label: "Payment link",
    text: "We have prepared your order. You can complete payment via the payment link or let us know if you prefer Cash on Delivery (COD).",
  },
  {
    label: "Stock check",
    text: "Let me check our live stock availability for that variant and get right back to you.",
  },
  {
    label: "Shipping update",
    text: "Your parcel has been booked with our courier partner. We will share the tracking number shortly.",
  },
];

export function conversationStatusLabel(status: ConversationStatus): string {
  return CONVERSATION_STATUS_LABELS[status] ?? status;
}

export function conversationChannelLabel(channel: ConversationChannel): string {
  return CONVERSATION_CHANNEL_LABELS[channel] ?? channel;
}

export { CONVERSATION_CHANNELS, CONVERSATION_STATUSES };

const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function formatRelativeActivity(isoString: string, nowMs: number = Date.now()): string {
  const ts = Date.parse(isoString);
  if (Number.isNaN(ts)) return "";
  const diffMs = Math.max(0, nowMs - ts);
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(ts).toLocaleDateString("en-GB", { month: "short", day: "numeric" });
}

export function formatMessageDayGroup(isoString: string, nowMs: number = Date.now()): string {
  const ts = Date.parse(isoString);
  if (Number.isNaN(ts)) return "";
  const msgDay = Math.floor((ts + DHAKA_OFFSET_MS) / DAY_MS);
  const todayDay = Math.floor((nowMs + DHAKA_OFFSET_MS) / DAY_MS);
  if (msgDay === todayDay) return "Today";
  if (msgDay === todayDay - 1) return "Yesterday";
  return new Date(ts).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Dhaka",
  });
}
