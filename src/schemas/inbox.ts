/**
 * Unified inbox and channel schemas. Pure (shared by API routes, services, and the UI).
 *
 * Source hygiene: pure ASCII; no non-ASCII literals in regex.
 */
import { z } from "zod";

import { isValidIdSegment } from "@/lib/ids";
import { cleanName, isBlank } from "@/lib/text";

import { clearable } from "./helpers";

export const CONVERSATION_CHANNELS = ["whatsapp", "messenger", "instagram", "email"] as const;
export type ConversationChannel = (typeof CONVERSATION_CHANNELS)[number];

export const CONVERSATION_STATUSES = [
  "ai_handling",
  "needs_reply",
  "human_handling",
  "resolved",
] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

export const MESSAGE_SENDERS = ["customer", "agent", "user", "system"] as const;
export type MessageSender = (typeof MESSAGE_SENDERS)[number];

export const MESSAGE_STATUSES = ["received", "sent", "delivered", "read", "failed"] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export const MESSAGE_TYPES = ["text", "interactive", "system"] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];

export const lastMessageSchema = z.object({
  text: z.string().max(4096),
  sender: z.enum(MESSAGE_SENDERS),
  senderName: z.string().max(120),
  at: z.string().datetime(),
});
export type LastMessage = z.infer<typeof lastMessageSchema>;

export const conversationSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  channel: z.enum(CONVERSATION_CHANNELS),
  contactPhoneE164: z.string(),
  contactName: z.string().max(120),
  customerId: z.string().nullable(),
  assignedAgentId: z.string().nullable(),
  assignedUserId: z.string().nullable(),
  status: z.enum(CONVERSATION_STATUSES),
  unreadCount: z.number().int().min(0),
  lastMessage: lastMessageSchema.nullable(),
  lastActivityAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Conversation = z.infer<typeof conversationSchema>;

export const inboxMessageSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  conversationId: z.string(),
  direction: z.enum(["inbound", "outbound"]),
  sender: z.enum(MESSAGE_SENDERS),
  senderName: z.string().max(120),
  type: z.enum(MESSAGE_TYPES),
  text: z.string().max(4096),
  status: z.enum(MESSAGE_STATUSES),
  errorMessage: z.string().nullable().optional(),
  externalId: z.string().nullable().optional(),
  aiMetadata: z.record(z.string(), z.unknown()).nullable().optional(),
  createdAt: z.string().datetime(),
});
export type InboxMessage = z.infer<typeof inboxMessageSchema>;

export const conversationListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
  status: z.enum(CONVERSATION_STATUSES).optional(),
  search: z
    .string()
    .transform((s) => cleanName(s))
    .refine((s) => !isBlank(s), "Search query cannot be empty")
    .optional(),
});
export type ConversationListQuery = z.infer<typeof conversationListQuerySchema>;

export const sendMessageInputSchema = z.object({
  text: z
    .string()
    .transform((t) => t.trim())
    .refine((t) => t.length >= 1, "Message text cannot be empty")
    .refine((t) => t.length <= 4096, "Message text cannot exceed 4096 characters"),
});
export type SendMessageInput = z.infer<typeof sendMessageInputSchema>;

export const updateConversationSchema = z
  .object({
    status: z.enum(CONVERSATION_STATUSES).optional(),
    assignedUserId: clearable(
      z.string().refine(isValidIdSegment, "Invalid user id"),
    ),
    assignedAgentId: clearable(
      z.string().refine(isValidIdSegment, "Invalid agent id"),
    ),
  })
  .refine(
    (data) =>
      data.status !== undefined ||
      data.assignedUserId !== undefined ||
      data.assignedAgentId !== undefined,
    "At least one field must be updated",
  );
export type UpdateConversationInput = z.infer<typeof updateConversationSchema>;
